/* =========================================
   SLAPS ENGINE v8.1 - ANIMATION & LOGIC FIXES
   ========================================= */

const gameState = {
    playerDeck: [],
    aiDeck: [],
    playerHand: [],
    aiHand: [],
    centerPileLeft: [],
    centerPileRight: [],
    
    gameActive: false,
    playerReady: false,
    aiReady: false,
    
    draggedCard: null,
    globalZ: 100,
    
    difficulty: 1, 
    aiProcessing: false 
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png'; 

// AI Lane positions (Percent)
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
    console.log("AI Difficulty Loaded:", gameState.difficulty);
    initGame();
};

function initGame() {
    let fullDeck = createDeck();
    shuffle(fullDeck);

    gameState.playerDeck = fullDeck.slice(0, 26);
    gameState.aiDeck = fullDeck.slice(26, 52);

    dealFoundation(gameState.playerDeck, 'player');
    dealFoundation(gameState.aiDeck, 'ai');
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

        currentLeftPercent += 24; 
    });
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
    }
    
    if (gameState.aiDeck.length > 0) {
        let aCard = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(aCard);
        renderCenterPile('left', aCard);
    }

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

// --- SMART AI BRAIN ---
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

    // 1. PRIORITY: PLAY CARD
    let bestMove = null;
    for (let card of activeCards) {
        if (checkPileLogic(card, gameState.centerPileLeft)) { bestMove = { c: card, t: 'left' }; break; }
        if (checkPileLogic(card, gameState.centerPileRight)) { bestMove = { c: card, t: 'right' }; break; }
    }

    if (bestMove) {
        gameState.aiProcessing = true; 
        setTimeout(() => {
            animateAIMove(bestMove.c, bestMove.t, () => {
                playCardToCenter(bestMove.c, bestMove.c.element);
                gameState.aiProcessing = false; 
            });
        }, reactionDelay);
        return; 
    }

    // 2. PRIORITY: SORT (Smart Human Logic)
    if (activeCards.length < 4) {
        let lanes = [[], [], [], []];
        gameState.aiHand.forEach(c => lanes[c.laneIndex].push(c));
        let blockerInfo = null;
        let emptyLaneIndex = -1;

        for (let i = 0; i < 4; i++) {
            if (lanes[i].length === 0) emptyLaneIndex = i;
        }

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
            console.log("AI Sorting Board...");
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

    // 3. PRIORITY: DRAW CARD (The Fix)
    // Draw if we have no moves AND (we have 4 cards up OR no hidden cards left to flip)
    const hiddenCardsLeft = gameState.aiHand.filter(c => !c.isFaceUp).length;
    
    if (!bestMove) {
        if (activeCards.length === 4 || hiddenCardsLeft === 0) {
            if (!gameState.aiReady) {
                gameState.aiProcessing = true;
                setTimeout(() => {
                    console.log("AI Stuck -> Requesting Draw");
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

// --- ANIMATION FIX: FORCE RECT CALCULATION ---
function animateAIMove(card, targetSide, callback) {
    const el = card.element;
    const targetId = targetSide === 'left' ? 'center-pile-left' : 'center-pile-right';
    const targetEl = document.getElementById(targetId);

    // FIX: Force browser to recognize current location before moving
    const startRect = el.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    // If startRect is 0 (hidden), default to AI foundation top-left to avoid weird jumps
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

function animateAIMoveToLane(card, laneIdx, callback) {
    const el = card.element;
    const leftPercent = AI_LANES[laneIdx];
    
    el.style.transition = 'all 0.5s ease';
    el.style.left = `${leftPercent}%`;
    el.style.top = '10px'; 
    el.style.zIndex = 10;  

    setTimeout(() => { callback(); }, 500);
}

// --- UNLOCKED PLAYER PHYSICS ---
function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault();

        gameState.globalZ++;
        img.style.zIndex = gameState.globalZ;
        img.style.transition = 'none'; 

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

            if (gameState.gameActive && parseInt(img.style.top) < -10 && checkLegalPlay(cardData)) {
                playCardToCenter(cardData, img);
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

// --- RULES ---
function checkLegalPlay(card) {
    if (!gameState.gameActive) return false;
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

function playCardToCenter(card, imgElement) {
    let target = null;
    let side = '';

    if (checkPileLogic(card, gameState.centerPileLeft)) {
        target = gameState.centerPileLeft;
        side = 'left';
    } else if (checkPileLogic(card, gameState.centerPileRight)) {
        target = gameState.centerPileRight;
        side = 'right';
    }

    if (target) {
        target.push(card);
        if (card.owner === 'player') {
            gameState.playerHand = gameState.playerHand.filter(c => c !== card);
            gameState.playerReady = false;
            document.getElementById('player-draw-deck').classList.remove('deck-ready');
        } else {
            gameState.aiHand = gameState.aiHand.filter(c => c !== card);
            gameState.aiReady = false;
            document.getElementById('ai-draw-deck').classList.remove('deck-ready');
        }

        imgElement.remove(); 
        renderCenterPile(side, card); 
    }
}
