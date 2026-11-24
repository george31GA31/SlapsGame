/* The bot plans from visible information and submits the same actions as a player. */
(() => {
    if (typeof gameState === 'undefined' || typeof SlapsEngine === 'undefined') return;

    const skill = () => Math.max(0, Math.min(1, (Number(gameState.difficulty || 1) - 1) / 9));
    const bellJitter = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    let lastDecisionAt = 0;
    let lastStrategicDraw;
    let pendingSlap;

    function humanDelay(kind = 'move') {
        const level = skill();
        const timing = {
            move: [2250 - 1450 * level, 650 - 220 * level, 480],
            slap: [1080 - 760 * level, 360 - 120 * level, 250],
            flip: [730 - 440 * level, 220 - 80 * level, 160],
            rearrange: [760 - 460 * level, 230 - 90 * level, 180],
            draw: [1010 - 620 * level, 260 - 100 * level, 240]
        }[kind];
        const [base, spread, minimum] = timing;
        let delay = base + bellJitter() * spread;
        const hesitationChance = (kind === 'slap' ? 0.10 : 0.17) - 0.07 * level;
        if (Math.random() < hesitationChance) delay += 180 + Math.random() * 340;
        if (kind === 'move' && gameState.aiInChain) delay *= 0.57 + Math.random() * 0.14;
        if (kind !== 'slap') delay += Math.max(0, 130 - (performance.now() - lastDecisionAt));
        return Math.round(Math.max(minimum, delay));
    }

    function visibleFoundation(hand) {
        const exposed = new Set(SlapsEngine.getExposedCards(hand));
        return hand.map(card => {
            const layout = {
                id: card.id,
                isFaceUp: card.isFaceUp,
                foundation: SlapsEngine.getFoundationPosition(hand, card)
            };
            if (card.isFaceUp && exposed.has(card)) {
                layout.value = card.value;
                layout.rank = card.rank;
            }
            return layout;
        });
    }

    function visibleTop(pile) {
        const top = pile.at(-1);
        return top ? [{ value: top.value, rank: top.rank }] : [];
    }

    function observeBoard() {
        return {
            phase: gameState.phase,
            playerHand: visibleFoundation(gameState.playerHand),
            aiHand: visibleFoundation(gameState.aiHand),
            centerPileLeft: visibleTop(gameState.centerPileLeft),
            centerPileRight: visibleTop(gameState.centerPileRight),
            drawAvailable: gameState.playerDeck.length + gameState.aiDeck.length > 0
        };
    }

    function legalCandidates(board = observeBoard()) {
        return SlapsEngine.availableMoves(board, 'ai').map(({ card, side }) => ({ c: card, t: side }));
    }

    function projectedBoard(board, move) {
        const pile = move.t === 'left' ? 'centerPileLeft' : 'centerPileRight';
        return { ...board, [pile]: [move.c], aiHand: board.aiHand.filter(card => card !== move.c) };
    }

    function chooseMove(board, moves) {
        if (moves.length < 2) return moves[0];
        const level = skill();
        if (Math.random() > 0.35 + 0.63 * level) {
            return moves[Math.floor(Math.random() * moves.length)];
        }

        const exposedBefore = new Set(SlapsEngine.getExposedCards(board.aiHand).map(card => card.id));
        const scored = moves.map(move => {
            const projected = projectedBoard(board, move);
            const continuations = SlapsEngine.availableMoves(projected, 'ai');
            const replies = SlapsEngine.availableMoves(projected, 'player');
            const opensHidden = SlapsEngine.getExposedCards(projected.aiHand)
                .some(card => !card.isFaceUp && !exposedBefore.has(card.id));
            const makesSlap = projected.aiHand.length > 0 &&
                SlapsEngine.isSlapAvailable(projected.centerPileLeft, projected.centerPileRight);
            const opponentCanFinish = board.playerHand.length === 1 && replies.length > 0;
            const score = continuations.length * (1 + level) + (opensHidden ? 3.5 : 0) +
                (makesSlap ? 1.5 + 5 * level : 0) - replies.length * (0.35 + level) -
                (opponentCanFinish ? 12 : 0) + Math.random() * (3 - 2.5 * level);
            return { move, score };
        });
        return scored.reduce((best, next) => next.score > best.score ? next : best).move;
    }

    function foundationProgress(board) {
        return gameState.roundSerial + ':' + board.playerHand.length + ':' + board.aiHand.length;
    }

    function shouldForceRestart(board, moves) {
        if (!board.drawAvailable || foundationProgress(board) === lastStrategicDraw ||
            board.aiHand.length === 1 && moves.length > 0) return false;

        const visiblePlayerMoves = SlapsEngine.availableMoves(board, 'player');
        if (board.playerHand.length === 1 && visiblePlayerMoves.length > 0) {
            // Prefer a visible move that removes a finishing reply. Otherwise redraw once.
            return moves.every(move => SlapsEngine.availableMoves(projectedBoard(board, move), 'player').length > 0);
        }
        return skill() >= 2 / 3 && board.aiHand.length > board.playerHand.length &&
            visiblePlayerMoves.length >= 4 && moves.length === 1;
    }

    function inActivity(serial) {
        return gameState.gameActive && serial === gameState.activitySerial;
    }

    window.triggerAISlap = function () {
        const left = gameState.centerPileLeft.at(-1);
        const right = gameState.centerPileRight.at(-1);
        const serial = gameState.activitySerial;
        if (pendingSlap?.left === left && pendingSlap?.right === right && pendingSlap?.serial === serial) return;
        if (pendingSlap) clearTimeout(pendingSlap.timer);

        const timer = setTimeout(() => {
            pendingSlap = null;
            if (!inActivity(serial) || !gameState.slapActive ||
                gameState.centerPileLeft.at(-1) !== left || gameState.centerPileRight.at(-1) !== right) return;
            lastDecisionAt = performance.now();
            resolveSlap('ai');
        }, humanDelay('slap'));
        pendingSlap = { left, right, serial, timer };
    };

    function scheduleAction(kind, action) {
        const serial = gameState.activitySerial;
        gameState.aiProcessing = true;
        setTimeout(() => {
            if (!inActivity(serial)) return;
            if (gameState.slapActive) {
                gameState.aiProcessing = false;
                return;
            }
            lastDecisionAt = performance.now();
            action(serial);
        }, humanDelay(kind));
    }

    function scheduleRestart(strategic) {
        const expectedReveal = gameState.revealRevision;
        scheduleAction('draw', () => {
            const board = observeBoard();
            const proceed = strategic ? shouldForceRestart(board, legalCandidates(board)) : SlapsEngine.canRestart(gameState);
            if (proceed && requestSoloReveal(expectedReveal) && strategic) {
                lastStrategicDraw = foundationProgress(board);
            }
            gameState.aiProcessing = false;
        });
    }

    function schedulePreparation(preparation) {
        const moving = preparation.type === 'move';
        scheduleAction(moving ? 'rearrange' : 'flip', serial => {
            const card = gameState.aiHand.find(entry => entry.id === preparation.card.id);
            if (card && moving && moveFoundationCard('ai', card, preparation.position)) {
                // The layout is committed first. Show the movement before the next flip.
                setTimeout(() => {
                    if (inActivity(serial)) gameState.aiProcessing = false;
                }, 140);
                return;
            }
            if (card && !moving) tryFlipCard(card.element, card, 'ai');
            gameState.aiProcessing = false;
        });
    }

    function tryBotPlay(move, serial) {
        const side = move.t;
        const card = gameState.aiHand.find(entry => entry.id === move.c.id);
        if (!card || !SlapsEngine.availableMoves(gameState, 'ai').some(option => option.card === card && option.side === side)) {
            gameState.aiProcessing = false;
            return;
        }

        animateAIMove(card, side, restore => {
            const played = inActivity(serial) && playCardToCenter(card, card.element, side);
            if (!played && card.element?.isConnected) {
                restore();
                syncFoundationLayout(gameState.aiHand, 'ai');
            }
            if (inActivity(serial)) {
                gameState.aiInChain = played;
                gameState.aiProcessing = false;
            }
        });
    }

    window.attemptAIMove = function () {
        if (!gameState.gameActive || gameState.aiProcessing) return;
        if (gameState.slapActive) {
            triggerAISlap();
            return;
        }

        const board = observeBoard();
        const moves = legalCandidates(board);
        if (shouldForceRestart(board, moves)) {
            scheduleRestart(true);
            return;
        }

        const move = chooseMove(board, moves);
        const liveCount = SlapsEngine.countFaceUp(board.aiHand);
        const preparation = SlapsEngine.planFoundationPreparation(board.aiHand, SlapsEngine.getFoundationBounds(gameState, 'ai'));
        if (preparation && (!move || liveCount < 3 || gameState.aiInChain)) {
            gameState.aiInChain = false;
            schedulePreparation(preparation);
        } else if (move) {
            scheduleAction('move', serial => tryBotPlay(move, serial));
        } else {
            gameState.aiInChain = false;
            if (SlapsEngine.canRestart(gameState)) scheduleRestart(false);
        }
    };

    function animateAIMove(card, targetSide, callback) {
        const element = card.element;
        const target = document.getElementById('center-pile-' + targetSide);
        if (!element || !target) return callback(() => {});

        GameVisuals.stopFlip(element);
        const start = element.getBoundingClientRect();
        const destination = target.getBoundingClientRect();
        const style = element.style;
        const saved = {
            left: style.left, top: style.top, width: style.width, height: style.height,
            position: style.position, zIndex: style.zIndex, transition: style.transition, transform: style.transform
        };

        const duration = Math.round(155 + Math.random() * 55);
        const transition = ' cubic-bezier(.2,.82,.22,1)';
        element.classList.add('is-ai-moving');
        Object.assign(style, {
            width: start.width + 'px',
            height: start.height + 'px',
            position: 'fixed',
            left: start.left + 'px',
            top: start.top + 'px',
            zIndex: '2000',
            transition: ['left', 'top', 'transform'].map(property => property + ' ' + duration + 'ms' + transition).join(', ')
        });

        requestAnimationFrame(() => {
            style.left = destination.left + (destination.width - start.width) / 2 + 'px';
            style.top = destination.top + (destination.height - start.height) / 2 + 'px';
            style.transform = 'rotate(' + (Math.random() * 5 - 2.5).toFixed(2) + 'deg) scale(1.01)';
        });
        setTimeout(() => {
            element.classList.remove('is-ai-moving');
            callback(() => Object.assign(style, saved));
        }, duration);
    }

    window.SlapsAI = Object.freeze({ humanDelay, legalCandidates });
})();
