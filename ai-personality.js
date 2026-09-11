/*
   Bot presentation + decision cadence.
   This layer makes the local AI feel less mechanical without changing legal-play rules.
   It is loaded after game.js / tournament-game.js and replaces only bot timing/choice helpers.
*/
(() => {
    if (typeof gameState === 'undefined' || typeof checkPileLogic !== 'function') return;

    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const skill = () => clamp((Number(gameState.difficulty || 1) - 1) / 9, 0, 1);
    const bellJitter = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    let lastDecisionAt = 0;

    function humanDelay(kind = 'move') {
        const s = skill();
        let base;
        let spread;
        let minimum;

        if (kind === 'slap') {
            base = 1080 - (760 * s);
            spread = 360 - (120 * s);
            minimum = 230;
        } else if (kind === 'flip') {
            base = 1120 - (520 * s);
            spread = 430 - (120 * s);
            minimum = 420;
        } else if (kind === 'draw') {
            base = 1500 - (620 * s);
            spread = 520 - (170 * s);
            minimum = 620;
        } else {
            base = 2700 - (1650 * s);
            spread = 760 - (260 * s);
            minimum = 720;
        }

        let delay = base + bellJitter() * spread;

        /* Humans occasionally double-check a board instead of acting on a perfect metronome. */
        const hesitationChance = (kind === 'slap' ? .045 : .17) - (.07 * s);
        if (Math.random() < hesitationChance) delay += 240 + Math.random() * (kind === 'slap' ? 260 : 620);

        /* Consecutive plays accelerate, but never to an inhuman instant chain. */
        if (kind === 'move' && gameState.aiInChain) delay *= .56 + Math.random() * .16;

        const sinceLast = performance.now() - lastDecisionAt;
        if (sinceLast < 180 && kind !== 'slap') delay += 180 - sinceLast;

        return Math.round(Math.max(minimum, delay));
    }

    function wouldFeedLastPlayerCard(card) {
        if (gameState.playerHand.length !== 1 || gameState.aiHand.length <= 1) return false;
        const playerLast = gameState.playerHand[0];
        const difference = Math.abs(playerLast.value - card.value);
        return difference === 1 || difference === 12;
    }

    function legalCandidates(activeCards) {
        const s = skill();
        /* Low levels often miss the strategic danger; high levels usually notice it, not always. */
        const noticesThreat = Math.random() < (.3 + .63 * s);
        const moves = [];

        for (const card of activeCards) {
            if (noticesThreat && wouldFeedLastPlayerCard(card)) continue;
            const laneDepth = gameState.aiHand.filter(c => c.laneIndex === card.laneIndex).length;
            if (checkPileLogic(card, gameState.centerPileLeft)) moves.push({c:card,t:'left',laneDepth});
            if (checkPileLogic(card, gameState.centerPileRight)) moves.push({c:card,t:'right',laneDepth});
        }
        return moves;
    }

    function chooseMove(moves) {
        if (!moves.length) return null;
        const s = skill();
        if (Math.random() > .22 + .7 * s) return moves[Math.floor(Math.random() * moves.length)];

        /* Better bots usually choose a move that uncovers more of their own foundation. */
        return [...moves].sort((a, b) => {
            const aScore = a.laneDepth * 3 + Math.random() * (4 - 2.6 * s);
            const bScore = b.laneDepth * 3 + Math.random() * (4 - 2.6 * s);
            return bScore - aScore;
        })[0];
    }

    function freshMoveExists() {
        return legalCandidates(gameState.aiHand.filter(c => c.isFaceUp)).length > 0;
    }

    triggerAISlap = function () {
        const reaction = humanDelay('slap');
        setTimeout(() => {
            if (gameState.slapActive && gameState.gameActive) {
                lastDecisionAt = performance.now();
                resolveSlap('ai');
            }
        }, reaction);
    };

    attemptAIMove = function () {
        const activeCards = gameState.aiHand.filter(c => c.isFaceUp);
        const bestMove = chooseMove(legalCandidates(activeCards));

        if (bestMove) {
            gameState.aiProcessing = true;
            const reactionDelay = humanDelay('move');
            setTimeout(() => {
                if (!gameState.gameActive || !bestMove.c.isFaceUp || !gameState.aiHand.includes(bestMove.c)) {
                    gameState.aiProcessing = false;
                    return;
                }

                const targetPile = bestMove.t === 'left' ? gameState.centerPileLeft : gameState.centerPileRight;
                if (!checkPileLogic(bestMove.c, targetPile)) {
                    gameState.aiProcessing = false;
                    return;
                }

                lastDecisionAt = performance.now();
                animateAIMove(bestMove.c, bestMove.t, () => {
                    const laneIdx = bestMove.c.laneIndex;
                    const success = playCardToCenter(bestMove.c, bestMove.c.element, bestMove.t);
                    if (success) {
                        gameState.aiInChain = true;
                        const laneCards = gameState.aiHand.filter(c => c.laneIndex === laneIdx);
                        if (laneCards.length > 0) {
                            const newTop = laneCards[laneCards.length - 1];
                            if (!newTop.isFaceUp) setCardFaceUp(newTop.element, newTop, 'ai');
                        }
                    } else {
                        animateSnapBack(bestMove.c);
                        gameState.aiInChain = false;
                    }
                    gameState.aiProcessing = false;
                });
            }, reactionDelay);
            return;
        }

        gameState.aiInChain = false;

        /* Human-like housekeeping: reveal or move a blocker only after looking for a real play. */
        if (activeCards.length < 4) {
            const lanes = [[],[],[],[]];
            gameState.aiHand.forEach(card => lanes[card.laneIndex].push(card));
            const emptyLanes = lanes.map((pile,index) => pile.length === 0 ? index : -1).filter(index => index >= 0);

            if (emptyLanes.length) {
                const blockers = [];
                for (let i = 0; i < lanes.length; i++) {
                    const pile = lanes[i];
                    if (pile.length > 1) {
                        const top = pile[pile.length - 1];
                        const below = pile[pile.length - 2];
                        if (top.isFaceUp && !below.isFaceUp) blockers.push({card:top,oldLane:i,depth:pile.length});
                    }
                }

                if (blockers.length) {
                    const s = skill();
                    const blocker = Math.random() < .35 + .55 * s
                        ? [...blockers].sort((a,b) => b.depth - a.depth)[0]
                        : blockers[Math.floor(Math.random() * blockers.length)];
                    const emptyLane = emptyLanes[Math.floor(Math.random() * emptyLanes.length)];
                    gameState.aiProcessing = true;
                    setTimeout(() => {
                        if (!gameState.gameActive || !gameState.aiHand.includes(blocker.card)) {
                            gameState.aiProcessing = false;
                            return;
                        }
                        animateAIMoveToLane(blocker.card, emptyLane, () => {
                            blocker.card.laneIndex = emptyLane;
                            const oldPile = gameState.aiHand.filter(c => c.laneIndex === blocker.oldLane);
                            const revealedCard = oldPile[oldPile.length - 1];
                            if (revealedCard && !revealedCard.isFaceUp) setCardFaceUp(revealedCard.element, revealedCard, 'ai');
                            lastDecisionAt = performance.now();
                            gameState.aiProcessing = false;
                        });
                    }, humanDelay('flip'));
                    return;
                }
            }

            const simpleHidden = gameState.aiHand.find(c => !c.isFaceUp && isTopOffPile(c));
            if (simpleHidden) {
                gameState.aiProcessing = true;
                setTimeout(() => {
                    if (gameState.gameActive && gameState.aiHand.includes(simpleHidden) && !simpleHidden.isFaceUp) {
                        setCardFaceUp(simpleHidden.element, simpleHidden, 'ai');
                        lastDecisionAt = performance.now();
                    }
                    gameState.aiProcessing = false;
                }, humanDelay('flip'));
                return;
            }
        }

        const hiddenCardsLeft = gameState.aiHand.filter(c => !c.isFaceUp).length;
        if ((activeCards.length === 4 || hiddenCardsLeft === 0) && !gameState.aiReady) {
            gameState.aiProcessing = true;
            setTimeout(() => {
                if (!gameState.gameActive) {
                    gameState.aiProcessing = false;
                    return;
                }
                if (freshMoveExists()) {
                    gameState.aiProcessing = false;
                    return;
                }
                gameState.aiReady = true;
                document.getElementById('ai-draw-deck')?.classList.add('deck-ready');
                lastDecisionAt = performance.now();
                gameState.aiProcessing = false;
                checkDrawCondition();
            }, humanDelay('draw'));
        }
    };

    animateAIMove = function (card, targetSide, callback) {
        const el = card.element;
        const targetId = targetSide === 'left' ? 'center-pile-left' : 'center-pile-right';
        const targetEl = document.getElementById(targetId);
        if (!el || !targetEl) return callback();

        GameVisuals?.stopFlip?.(el);
        const startRect = el.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        card.originalLeft = el.style.left;
        card.originalTop = el.style.top;

        const duration = Math.round(255 + Math.random() * 85);
        const landingTilt = (Math.random() * 5 - 2.5).toFixed(2);
        el.classList.add('is-ai-moving');
        el.style.width = startRect.width + 'px';
        el.style.height = startRect.height + 'px';
        el.style.position = 'fixed';
        el.style.left = startRect.left + 'px';
        el.style.top = startRect.top + 'px';
        el.style.zIndex = 2000;
        el.style.transition = `left ${duration}ms cubic-bezier(.2,.82,.22,1), top ${duration}ms cubic-bezier(.2,.82,.22,1), transform ${duration}ms cubic-bezier(.2,.82,.22,1)`;
        el.style.transform = `rotate(${(Math.random() * 3 - 1.5).toFixed(2)}deg) scale(1.025)`;

        requestAnimationFrame(() => {
            const destX = targetRect.left + targetRect.width / 2 - startRect.width / 2;
            const destY = targetRect.top + targetRect.height / 2 - startRect.height / 2;
            el.style.left = destX + 'px';
            el.style.top = destY + 'px';
            el.style.transform = `rotate(${landingTilt}deg) scale(1.01)`;
        });

        setTimeout(() => {
            el.classList.remove('is-ai-moving');
            el.style.transform = 'rotate(0deg)';
            callback();
        }, duration);
    };

    animateAIMoveToLane = function (card, laneIdx, callback) {
        const el = card.element;
        if (!el) return callback();
        const duration = Math.round(230 + Math.random() * 80);
        el.classList.add('is-ai-moving');
        el.style.transition = `left ${duration}ms cubic-bezier(.2,.82,.22,1), top ${duration}ms cubic-bezier(.2,.82,.22,1), translate ${duration}ms ease`;
        el.style.translate = '0 -4px';
        requestAnimationFrame(() => {
            el.style.left = `${AI_LANES[laneIdx]}%`;
            el.style.top = '4px';
            el.style.translate = '0 0';
        });
        setTimeout(() => {
            el.classList.remove('is-ai-moving');
            callback();
        }, duration);
    };

    window.SlapsAI = Object.freeze({humanDelay, legalCandidates});
})();
