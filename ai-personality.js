/* Bot cadence and tactics. The shared engine accepts or rejects every action. */
(() => {
    if (typeof gameState === 'undefined' || typeof SlapsEngine === 'undefined') return;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const skill = () => clamp((Number(gameState.difficulty || 1) - 1) / 9, 0, 1);
    const bellJitter = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    let lastDecisionAt = 0;

    function humanDelay(kind = 'move') {
        const level = skill();
        let base;
        let spread;
        let minimum;

        if (kind === 'slap') {
            base = 1080 - 760 * level;
            spread = 360 - 120 * level;
            minimum = 250;
        } else if (kind === 'flip') {
            base = 1120 - 520 * level;
            spread = 430 - 120 * level;
            minimum = 420;
        } else {
            base = 2700 - 1650 * level;
            spread = 760 - 260 * level;
            minimum = 720;
        }

        let delay = base + bellJitter() * spread;
        const hesitationChance = (kind === 'slap' ? 0.10 : 0.17) - 0.07 * level;
        if (Math.random() < hesitationChance) {
            delay += 240 + Math.random() * (kind === 'slap' ? 260 : 620);
        }
        if (kind === 'move' && gameState.aiInChain) delay *= 0.56 + Math.random() * 0.16;

        const sinceLast = performance.now() - lastDecisionAt;
        if (sinceLast < 180 && kind !== 'slap') delay += 180 - sinceLast;
        return Math.round(Math.max(minimum, delay));
    }

    function wouldFeedLastPlayerCard(card) {
        if (gameState.playerHand.length !== 1 || gameState.aiHand.length <= 1) return false;
        const playerLast = gameState.playerHand[0];
        return playerLast.isFaceUp && SlapsEngine.canPlayOnPile(playerLast, [card]);
    }

    function legalCandidates() {
        return SlapsEngine.availableMoves(gameState, 'ai').map(({ card, side }) => {
            const laneDepth = gameState.aiHand.filter(other => other.laneIndex === card.laneIndex).length;
            return { c: card, t: side, laneDepth };
        });
    }

    function chooseMove(moves) {
        if (moves.length === 0) return null;
        const level = skill();
        if (Math.random() > 0.22 + 0.7 * level) return moves[Math.floor(Math.random() * moves.length)];

        const seesThreat = Math.random() < 0.3 + 0.63 * level;
        const scored = moves.map(move => ({
            move,
            score: move.laneDepth * 3 + Math.random() * (4 - 2.6 * level) -
                (seesThreat && wouldFeedLastPlayerCard(move.c) ? 20 : 0)
        }));
        return scored.reduce((best, option) => option.score > best.score ? option : best).move;
    }

    function inActivity(serial) {
        return gameState.gameActive && serial === gameState.activitySerial;
    }

    let pendingSlap = null;
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
            if (inActivity(serial)) action(serial);
        }, humanDelay(kind));
    }

    function tryBotPlay(move, serial) {
        const { c: card, t: side } = move;
        if (!SlapsEngine.availableMoves(gameState, 'ai').some(option => option.card === card && option.side === side)) {
            gameState.aiProcessing = false;
            return;
        }

        animateAIMove(card, side, () => {
            const played = inActivity(serial) && playCardToCenter(card, card.element, side);
            if (!played && card.element?.isConnected) animateSnapBack(card);
            if (inActivity(serial)) {
                gameState.aiInChain = played;
                gameState.aiProcessing = false;
            }
        });
    }

    window.attemptAIMove = function () {
        if (!gameState.gameActive || gameState.aiProcessing) return;
        const move = chooseMove(legalCandidates());
        if (move) {
            scheduleAction('move', serial => {
                lastDecisionAt = performance.now();
                tryBotPlay(move, serial);
            });
            return;
        }

        gameState.aiInChain = false;
        const next = SlapsEngine.getExposedCards(gameState.aiHand)
            .find(card => SlapsEngine.canFlipCard(gameState.aiHand, card).ok);
        if (next) {
            scheduleAction('flip', () => {
                if (tryFlipCard(next.element, next, 'ai')) lastDecisionAt = performance.now();
                gameState.aiProcessing = false;
            });
        }
    };

    function animateAIMove(card, targetSide, callback) {
        const element = card.element;
        const target = document.getElementById('center-pile-' + targetSide);
        if (!element || !target) return callback();

        GameVisuals.stopFlip(element);
        const start = element.getBoundingClientRect();
        const destination = target.getBoundingClientRect();
        card.originalLeft = element.style.left;
        card.originalTop = element.style.top;
        card.originalZIndex = element.style.zIndex;

        const duration = Math.round(255 + Math.random() * 85);
        const transition = ' cubic-bezier(.2,.82,.22,1)';
        element.classList.add('is-ai-moving');
        element.style.width = start.width + 'px';
        element.style.height = start.height + 'px';
        element.style.position = 'fixed';
        element.style.left = start.left + 'px';
        element.style.top = start.top + 'px';
        element.style.zIndex = '2000';
        element.style.transition = ['left', 'top', 'transform'].map(property => property + ' ' + duration + 'ms' + transition).join(', ');

        requestAnimationFrame(() => {
            element.style.left = destination.left + (destination.width - start.width) / 2 + 'px';
            element.style.top = destination.top + (destination.height - start.height) / 2 + 'px';
            element.style.transform = 'rotate(' + (Math.random() * 5 - 2.5).toFixed(2) + 'deg) scale(1.01)';
        });
        setTimeout(() => {
            element.classList.remove('is-ai-moving');
            element.style.transform = '';
            callback();
        }, duration);
    }

    function animateSnapBack(card) {
        const { style } = card.element;
        style.left = card.originalLeft;
        style.top = card.originalTop;
        style.zIndex = card.originalZIndex;
        style.position = 'absolute';
        style.width = '';
        style.height = '';
        style.transition = '';
    }

    window.SlapsAI = Object.freeze({ humanDelay, legalCandidates });
})();
