/* =========================================
   SLAPS ENGINE v7.1 - COMPLETE & FIXED
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
    
    // AI State
    difficulty: 1, 
    aiProcessing: false 
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png'; 

class Card {
    constructor(suit, rank, value) {
        this.suit = suit;
        this.rank = rank;
        this.value = value; 
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false;
        this.owner = null;
        this.element = null; 
    }
}

// --- INITIALIZATION ---
window.onload = function() {
    // 1. Get Difficulty from Setup Page (Defaults to 1 if missing)
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

// --- DEALING LOGIC ---
function dealFoundation(deck, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 

    if (owner === 'player') gameState.playerHand = [];
    else gameState.aiHand = [];

    const pileSizes = [4, 3, 2, 1]; 
    let currentLeftPercent = 5; 

    pileSizes.forEach(size => {
        let pileCards = deck.splice(0, size);
        
        pileCards.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card'; 
            card.owner = owner; 

            const isTopCard = (index === size - 1);

            if (isTopCard) {
                setCardFaceUp(img, card, owner);
            } else {
                setCardFaceDown(img, card, owner);
            }

            // Position
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

    // In-Game Draw Request
    if (gameState.gameActive) {
        gameState.playerReady = true; 
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        checkDrawCondition();
    }
}

function checkDrawCondition() {
    if (gameState.playerReady && gameState.aiReady) {
        setTimeout(() => {
            performReveal();
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

// --- INTELLIGENT AI SYSTEM ---
function startAILoop() {
    gameState.aiLoopRunning = true;
    
    setInterval(() => {
        if (!gameState.gameActive || gameState.aiProcessing) return;
        attemptAIMove();
    }, 500);
}

function attemptAIMove() {
    // 1. CALCULATE REACTION SPEED
    const diff = gameState.difficulty;
    const minTime = 4000 - ((diff - 1) * 388); 
    const maxTime = 6000 - ((diff - 1) * 500); 
    const reactionDelay = Math.random() * (maxTime - minTime) + minTime;

    // 1. PRIORITY: CAN I PLAY A CARD?
    const activeCards = gameState.aiHand.filter(c => c.isFaceUp);
    let bestMove = null;

    for (let card of activeCards) {
        if (checkPileLogic(card, gameState.centerPileLeft)) {
            bestMove = { card: card, target: 'left' };
            break; 
        }
        if (checkPileLogic(card, gameState.centerPileRight)) {
            bestMove = { card: card, target: 'right' };
            break;
        }
    }

    if (bestMove) {
        gameState.aiProcessing = true; 
        console.log(`AI Reacting in ${Math.round(reactionDelay)}ms`);
        
        setTimeout(() => {
            animateAIMove(bestMove.card, bestMove.target, () => {
                playCardToCenter(bestMove.card, bestMove.card.element);
                gameState.aiProcessing = false; 
            });
        }, reactionDelay);
        return; 
    }

    // 2. PRIORITY: FLIP A CARD
    if (activeCards.length < 4) {
        const hiddenCard = gameState.aiHand.find(c => !c.isFaceUp);
        if (hiddenCard) {
            gameState.aiProcessing = true;
            setTimeout(() => {
                setCardFaceUp(hiddenCard.element, hiddenCard, 'ai');
                gameState.aiProcessing = false;
            }, reactionDelay * 0.5); 
            return;
        }
    }

    // 3. PRIORITY: STUCK? CLICK DRAW DECK
    if (!bestMove && activeCards.length === 4) {
        if (!gameState.aiReady) {
            gameState.aiProcessing = true;
            setTimeout(() => {
                console.log("AI Stuck -> Drawing");
                gameState.aiReady = true;
                document.getElementById('ai-draw-deck').classList.add('deck-ready');
                gameState.aiProcessing = false;
                checkDrawCondition();
            }, 2000 + reactionDelay);
        }
    }
}

// --- AI ANIMATION ---
function animateAIMove(card, targetSide, callback) {
    const el = card.element;
    const targetId = targetSide === 'left' ? 'center-pile-left' : 'center-pile-right';
    const targetEl = document.getElementById(targetId);

    const startRect = el.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    el.style.position = 'fixed';
    el.style.left = startRect.left + 'px';
    el.style.top = startRect.top + 'px';
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

// --- HYBRID PHYSICS ENGINE (Player) ---
function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        if (!gameState.gameActive) return; 
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
                if (!checkLegalPlay(cardData)) newTop = 0; 
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

            if (parseInt(img.style.top) < -10 && checkLegalPlay(cardData)) {
                playCardToCenter(cardData, img);
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

// --- RULES & LOGIC ---
function checkLegalPlay(card) {
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
