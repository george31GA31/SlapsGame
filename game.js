/* =========================================
   SLAPS ENGINE v9.0 - SPEED CHECK & SCORING
   ========================================= */

const gameState = {
    playerDeck: [],
    aiDeck: [],
    playerHand: [],
    aiHand: [],
    centerPileLeft: [],
    centerPileRight: [],
    
    // SCORE TRACKING
    playerCount: 26,
    aiCount: 26,

    gameActive: false,
    playerReady: false,
    aiReady: false,
    aiLoopRunning: false,
    
    draggedCard: null,
    globalZ: 100,
    
    difficulty: 1, 
    aiProcessing: false 
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png'; 
const AI_LANES = [5, 29, 53, 77]; 

class Card {
    constructor(suit, rank, value) {
        this.suit = suit;
        this.rank = rank;
        this.value = value; 
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false;
        this.owner = null;
        this.element = null; 
        this.laneIndex = 0; 
    }
}

window.onload = function() {
    const storedDiff = localStorage.getItem('slapsDifficulty');
    if (storedDiff) gameState.difficulty = parseInt(storedDiff);
    initGame();
};

function initGame() {
    let fullDeck = createDeck();
    shuffle(fullDeck);

    gameState.playerDeck = fullDeck.slice(0, 26);
    gameState.aiDeck = fullDeck.slice(26, 52);

    dealFoundation(gameState.playerDeck, 'player');
    dealFoundation(gameState.aiDeck, 'ai');
    
    updateScoreboard();
}

function updateScoreboard() {
    document.getElementById('score-player').innerText = gameState.playerCount;
    document.getElementById('score-ai').innerText = gameState.aiCount;
}

function createDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach((rank, index) => {
            deck.push(new Card(suit, rank, index + 2)); 
        });
    });
    return deck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// --- DEALING ---
function dealFoundation(deck, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 

    if (owner === 'player') gameState.playerHand = [];
    else gameState.aiHand = [];

    const pileSizes = [4, 3, 2, 1]; 
    let currentLeftPercent = 5; 

    pileSizes.forEach((size, laneIdx) => {
        let pileCards = deck.splice(0, size);
        
        pileCards.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card'; 
            card.owner = owner; 
            card.laneIndex = laneIdx; 

            const isTopCard = (index === size - 1);

            if (isTopCard) {
                setCardFaceUp(img, card, owner);
            } else {
                setCardFaceDown(img, card, owner);
            }

            img.style.left = `${currentLeftPercent}%`;
            
            let stackOffset = index * 5; 
            if (owner === 'ai') img.style.top = `${10 + stackOffset}px`;
            else img.style.top = `${60 - stackOffset}px`;
            
            img.style.zIndex = index + 10; 

            card.element = img;
            container.appendChild(img);
            
            if (owner === 'player') gameState.playerHand.push(card);
            else gameState.aiHand.push(card);
        });
        
        // Update counts as we remove from deck
        if(owner === 'player') gameState.playerCount -= size;
        else gameState.aiCount -= size;

        currentLeftPercent += 24; 
    });
    
    // Since we subtracted during deal, reset to 26 initially? 
    // Actually, logic is: Count = Cards Remaining (Hand + Deck).
    // So we should just set it to 26 at start of `initGame` and subtract when played to center.
    gameState.playerCount = 26;
    gameState.aiCount = 26;
}

function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc;
    img.classList.remove('card-face-down');
    card.isFaceUp = true;
    
    if (owner === 'player') {
        img.classList.add('player-card');
        img.onclick = null; 
        makeDraggable(img, card); 
    } else {
        img.classList.add('opponent-card');
    }
}

function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    card.isFaceUp = false;
    
    if (owner === 'player') {
        img.onclick = () => tryFlipCard(img, card);
    }
}

function tryFlipCard(img, card) {
    const liveCards = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (liveCards < 4) {
        setCardFaceUp(img, card, 'player');
    }
}

// --- GAME FLOW ---
function handlePlayerDeckClick() {
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;
        gameState.playerReady = true;
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        setTimeout(() => {
            gameState.aiReady = true;
            document.getElementById('ai-draw-deck').classList.add('deck-ready');
            startCountdown();
        }, 800);
        return;
    }

    if (gameState.gameActive) {
        if (!gameState.playerReady) {
            gameState.playerReady = true; 
            document.getElementById('player-draw-deck').classList.add('deck-ready');
            checkDrawCondition();
        }
    }
}

function checkDrawCondition() {
    if (gameState.playerReady && gameState.aiReady) {
        setTimeout(() => {
            startCountdown();
        }, 500);
    }
}

function startCountdown() {
    const overlay = document.getElementById('countdown-overlay');
    overlay.classList.remove('hidden');
    let count = 3;
    overlay.innerText = count;

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.innerText = count;
            overlay.style.animation = 'none';
            overlay.offsetHeight; 
            overlay.style.animation = 'popIn 0.5s ease';
        } else {
            clearInterval(timer);
            overlay.classList.add('hidden');
            performReveal();
        }
    }, 800);
}

function performReveal() {
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');

    if (gameState.playerDeck.length > 0) {
        let pCard = gameState.playerDeck.pop();
        gameState.centerPileRight.push(pCard);
        renderCenterPile('right', pCard);
        gameState.playerCount--; // Decrement score
    }
    
    if (gameState.aiDeck.length > 0) {
        let aCard = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(aCard);
        renderCenterPile('left', aCard);
        gameState.aiCount--; // Decrement score
    }
    
    updateScoreboard();

    gameState.gameActive = true;
    gameState.playerReady = false;
    gameState.aiReady = false;
    
    if (!gameState.aiLoopRunning) {
        startAILoop();
    }
}

function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    
    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.className = 'game-card'; 
    
    img.style.left = '50%';
    img.style.top = '50%';
    const rot = Math.random() * 20 - 10;
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    
    container.appendChild(img);
}

// --- AI BRAIN ---
function startAILoop() {
    gameState.aiLoopRunning = true;
    setInterval(() => {
        if (!gameState.gameActive || gameState.aiProcessing) return;
        attemptAIMove();
    }, 500);
}

function attemptAIMove() {
    const diff = gameState.difficulty;
    const minTime = 4000 - ((diff - 1) * 388); 
    const maxTime = 6000 - ((diff - 1) * 500); 
    const reactionDelay = Math.random() * (maxTime - minTime) + minTime;

    const activeCards = gameState.aiHand.filter(c => c.isFaceUp);

    // 1. PLAY CARD
    let bestMove = null;
    for (let card of activeCards) {
        if (checkPileLogic(card, gameState.centerPileLeft)) { bestMove = { c: card, t: 'left' }; break; }
        if (checkPileLogic(card, gameState.centerPileRight)) { bestMove = { c: card, t: 'right' }; break; }
    }

    if (bestMove) {
        gameState.aiProcessing = true; 
        setTimeout(() => {
            animateAIMove(bestMove.c, bestMove.t, () => {
                // TRY TO PLAY (Race Condition Check happens inside playCardToCenter)
                let success = playCardToCenter(bestMove.c, bestMove.c.element);
                
                if (!success) {
                    // Snap back if failed
                    console.log("AI was too slow! Snapping back.");
                    animateSnapBack(bestMove.c);
                }
                gameState.aiProcessing = false; 
            });
        }, reactionDelay);
        return; 
    }

    // 2. SORT
    if (activeCards.length < 4) {
        let lanes = [[], [], [], []];
        gameState.aiHand.forEach(c => lanes[c.laneIndex].push(c));
        let blockerInfo = null;
        let emptyLaneIndex = -1;

        for (let i = 0; i < 4; i++) { if (lanes[i].length === 0) emptyLaneIndex = i; }

        if (emptyLaneIndex !== -1) {
            for (let i = 0; i < 4; i++) {
                let pile = lanes[i];
                if (pile.length > 1) {
                    let top = pile[pile.length - 1];
                    let below = pile[pile.length - 2];
                    if (top.isFaceUp && !below.isFaceUp) {
                        blockerInfo = { card: top, oldLane: i };
                        break;
                    }
                }
            }
        }

        if (blockerInfo) {
            gameState.aiProcessing = true;
            setTimeout(() => {
                animateAIMoveToLane(blockerInfo.card, emptyLaneIndex, () => {
                    blockerInfo.card.laneIndex = emptyLaneIndex;
                    let pile = lanes[blockerInfo.oldLane];
                    let revealedCard = pile[pile.length - 2]; 
                    setCardFaceUp(revealedCard.element, revealedCard, 'ai');
                    gameState.aiProcessing = false;
                });
            }, reactionDelay * 0.8);
            return;
        }

        const simpleHidden = gameState.aiHand.find(c => !c.isFaceUp && isTopOffPile(c));
        if (simpleHidden) {
            gameState.aiProcessing = true;
            setTimeout(() => {
                setCardFaceUp(simpleHidden.element, simpleHidden, 'ai');
                gameState.aiProcessing = false;
            }, reactionDelay * 0.5); 
            return;
        }
    }

    // 3. DRAW
    const hiddenCardsLeft = gameState.aiHand.filter(c => !c.isFaceUp).length;
    if (!bestMove) {
        if (activeCards.length === 4 || hiddenCardsLeft === 0) {
            if (!gameState.aiReady) {
                gameState.aiProcessing = true;
                setTimeout(() => {
                    gameState.aiReady = true;
                    document.getElementById('ai-draw-deck').classList.add('deck-ready');
                    gameState.aiProcessing = false;
                    checkDrawCondition();
                }, 1000 + reactionDelay);
            }
        }
    }
}

function isTopOffPile(card) {
    let cardsInLane = gameState.aiHand.filter(c => c.laneIndex === card.laneIndex);
    return cardsInLane[cardsInLane.length - 1] === card;
}

// --- ANIMATION ---
function animateAIMove(card, targetSide, callback) {
    const el = card.element;
    const targetId = targetSide === 'left' ? 'center-pile-left' : 'center-pile-right';
    const targetEl = document.getElementById(targetId);

    const startRect = el.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    
    // Store original for snapback
    card.originalLeft = el.style.left;
    card.originalTop = el.style.top;

    const startLeft = startRect.left || 100;
    const startTop = startRect.top || 50;

    el.style.position = 'fixed';
    el.style.left = startLeft + 'px';
    el.style.top = startTop + 'px';
    el.style.zIndex = 2000;
    el.style.transition = 'all 0.6s ease-in-out'; 

    requestAnimationFrame(() => {
        const destX = targetRect.left + (targetRect.width / 2) - (startRect.width / 2);
        const destY = targetRect.top + (targetRect.height / 2) - (startRect.height / 2);
        el.style.left = destX + 'px';
        el.style.top = destY + 'px';
        el.style.transform = 'rotate(0deg)'; 
    });

    setTimeout(() => { callback(); }, 600); 
}

function animateSnapBack(card) {
    const el = card.element;
    // We need to revert 'fixed' position to the foundation container
    // But since it's fixed, we can just animate it back to original Screen Coordinates?
    // Simpler: Reset to foundation box styles
    
    // For now, let's just snap it visually
    el.style.transition = 'none';
    el.style.position = 'absolute';
    el.style.left = card.originalLeft;
    el.style.top = card.originalTop;
    el.style.zIndex = 10;
    // Add a red flash to show it failed
    el.style.border = '2px solid red';
    setTimeout(() => { el.style.border = 'none'; }, 500);
}

function animateAIMoveToLane(card, laneIdx, callback) {
    const el = card.element;
    const leftPercent = AI_LANES[laneIdx];
    el.style.transition = 'all 0.5s ease';
    el.style.left = `${leftPercent}%`;
    el.style.top = '10px'; 
    el.style.zIndex = 10;  
    setTimeout(() => { callback(); }, 500);
}

// --- PLAYER PHYSICS ---
function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault();
        gameState.globalZ++;
        img.style.zIndex = gameState.globalZ;
        img.style.transition = 'none'; 
        
        // Store original for snapback
        cardData.originalLeft = img.style.left;
        cardData.originalTop = img.style.top;

        let shiftX = e.clientX - img.getBoundingClientRect().left;
        let shiftY = e.clientY - img.getBoundingClientRect().top;
        const box = document.getElementById('player-foundation-area');
        
        function moveAt(pageX, pageY) {
            const boxRect = box.getBoundingClientRect();
            let newLeft = pageX - shiftX - boxRect.left;
            let newTop = pageY - shiftY - boxRect.top;
            if (newTop < 0) { 
                if (!gameState.gameActive || !checkLegalPlay(cardData)) newTop = 0; 
            }
            img.style.left = newLeft + 'px';
            img.style.top = newTop + 'px';
        }

        moveAt(e.pageX, e.pageY);

        function onMouseMove(event) { moveAt(event.pageX, event.pageY); }

        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            img.style.transition = 'all 0.1s ease-out'; 

            if (gameState.gameActive && parseInt(img.style.top) < -10) {
                // ATTEMPT TO PLAY
                let success = playCardToCenter(cardData, img);
                
                if (!success) {
                    // IF FAILED (Race condition), Snap Back
                    img.style.left = cardData.originalLeft;
                    img.style.top = cardData.originalTop;
                }
            }
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

// --- RULES & LOGIC ---
function checkLegalPlay(card) {
    if (!gameState.gameActive) return false;
    // This is the "Pre-Check" for UI feedback
    return checkPileLogic(card, gameState.centerPileLeft) || 
           checkPileLogic(card, gameState.centerPileRight);
}

function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false;
    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);
    if (diff === 1) return true;
    if (diff === 12) return true;
    return false;
}

// UPDATED: Now returns TRUE if successful, FALSE if failed
function playCardToCenter(card, imgElement) {
    let target = null;
    let side = '';

    // DOUBLE CHECK: Is it STILL legal? (Race Condition Check)
    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    if (isLeftLegal) {
        target = gameState.centerPileLeft;
        side = 'left';
    } else if (isRightLegal) {
        target = gameState.centerPileRight;
        side = 'right';
    }

    if (target) {
        // SUCCESS: The move is valid right now
        target.push(card);
        
        if (card.owner === 'player') {
            gameState.playerHand = gameState.playerHand.filter(c => c !== card);
            gameState.playerReady = false;
            document.getElementById('player-draw-deck').classList.remove('deck-ready');
            gameState.playerCount--;
        } else {
            gameState.aiHand = gameState.aiHand.filter(c => c !== card);
            gameState.aiReady = false;
            document.getElementById('ai-draw-deck').classList.remove('deck-ready');
            gameState.aiCount--;
        }

        imgElement.remove(); 
        renderCenterPile(side, card); 
        updateScoreboard();
        return true; // Move Accepted
    } else {
        // FAILURE: The board changed before we arrived!
        return false; // Move Rejected
    }
}
