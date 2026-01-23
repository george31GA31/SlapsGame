/* =========================================
   SLAPS ENGINE v3.0 - GAME LOOP & BOUNDARIES
   ========================================= */

const gameState = {
    playerDeck: [],
    aiDeck: [],
    centerPileLeft: [],
    centerPileRight: [],
    
    // State Flags
    gameActive: false,
    playerReady: false,
    aiReady: false,
    
    // Dragging
    draggedCard: null,
    originalPos: { left: 0, top: 0 }
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
        this.element = null; 
    }
}

// --- INITIALIZATION ---
window.onload = function() {
    initGame();
};

function initGame() {
    let fullDeck = createDeck();
    shuffle(fullDeck);

    gameState.playerDeck = fullDeck.slice(0, 26);
    gameState.aiDeck = fullDeck.slice(26, 52);

    // Initial Deal (Foundations)
    dealFoundation(gameState.playerDeck, 'player');
    dealFoundation(gameState.aiDeck, 'ai');
}

function createDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach((rank, index) => {
            // Logic: 2=2, ... King=13, Ace=14
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

// --- DEALING LOGIC (4-3-2-1) ---
function dealFoundation(deck, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 

    const pileSizes = [4, 3, 2, 1]; 
    let currentLeftPercent = 10;    

    pileSizes.forEach(size => {
        let pileCards = deck.splice(0, size);
        
        pileCards.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card';
            
            const isTopCard = (index === size - 1);

            // STATE: Face Up or Down
            if (isTopCard) {
                setCardFaceUp(img, card, owner);
            } else {
                setCardFaceDown(img, card, owner);
            }

            // POSITIONING
            img.style.left = `${currentLeftPercent}%`;
            
            let stackOffset = index * 5; 
            if (owner === 'ai') {
                 img.style.top = `${20 + stackOffset}px`;
            } else {
                 img.style.top = `${50 - stackOffset}px`;
            }
            img.style.zIndex = index;

            card.element = img;
            container.appendChild(img);
        });

        currentLeftPercent += 20; 
    });
}

// Helper: Make Card Face Up
function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc;
    img.classList.remove('card-face-down');
    card.isFaceUp = true;
    
    if (owner === 'player') {
        img.classList.add('player-card');
        img.onclick = null; // Remove flip listener
        makeDraggable(img, card); // Make interactive
    } else {
        img.classList.add('opponent-card');
    }
}

// Helper: Make Card Face Down
function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    card.isFaceUp = false;
    
    // Add Click-to-Flip Listener
    if (owner === 'player') {
        img.onclick = () => tryFlipCard(img, card);
    }
}

// --- FLIP LOGIC (Limit 4 Live Cards) ---
function tryFlipCard(img, card) {
    // 1. Count current face-up cards
    const container = document.getElementById('player-foundation-area');
    const liveCards = container.querySelectorAll('.player-card').length;

    // 2. Enforce Rule: Max 4
    if (liveCards < 4) {
        setCardFaceUp(img, card, 'player');
    } else {
        console.log("Cannot flip: Max 4 cards active!");
        // Optional: Shake animation here
    }
}

// --- THE REVEAL SEQUENCE (3-2-1) ---
function handlePlayerDeckClick() {
    if (gameState.gameActive || gameState.playerReady) return;

    // 1. Player Set Ready
    gameState.playerReady = true;
    document.getElementById('player-draw-deck').classList.add('deck-ready');

    // 2. Sim AI Ready (Delay 500ms for realism)
    setTimeout(() => {
        gameState.aiReady = true;
        document.getElementById('ai-draw-deck').classList.add('deck-ready');
        startCountdown();
    }, 500);
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
            // Retrigger animation
            overlay.style.animation = 'none';
            overlay.offsetHeight; /* trigger reflow */
            overlay.style.animation = 'popIn 0.5s ease';
        } else {
            clearInterval(timer);
            overlay.classList.add('hidden');
            performReveal();
        }
    }, 800);
}

function performReveal() {
    // 1. Remove Glow
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');

    // 2. Move Logic: Take 1 card from each deck
    if (gameState.playerDeck.length > 0) {
        let pCard = gameState.playerDeck.pop();
        gameState.centerPileRight.push(pCard); // Player reveals to Right
        renderCenterPile('right', pCard);
    }
    
    if (gameState.aiDeck.length > 0) {
        let aCard = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(aCard); // AI reveals to Left
        renderCenterPile('left', aCard);
    }

    gameState.gameActive = true;
    gameState.playerReady = false;
    gameState.aiReady = false;
}

function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    
    // Create new image for center
    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.position = 'absolute';
    
    // Random rotation for realism
    const rot = Math.random() * 20 - 10;
    img.style.transform = `rotate(${rot}deg)`;
    
    container.appendChild(img);
}

// --- DRAG ENGINE WITH PHYSICAL BOUNDARY ---
function makeDraggable(img, cardData) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    const box = document.getElementById('player-foundation-area');

    img.onmousedown = (e) => {
        e.preventDefault();
        if (!gameState.gameActive) return; // Can't drag before start

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = img.offsetLeft;
        initialTop = img.offsetTop;
        
        gameState.originalPos = { left: img.style.left, top: img.style.top };
        
        img.style.cursor = 'grabbing';
        img.style.zIndex = 1000; 
    };

    window.onmousemove = (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        let newTop = initialTop + dy;
        let newLeft = initialLeft + dx;

        // BOUNDARY LOGIC:
        // -50 is roughly the "Exit Threshold" to leave the box
        if (newTop < -40) {
            // We are trying to leave the box!
            // CHECK: Is it a legal play?
            if (!checkLegalPlay(cardData)) {
                // ILLEGAL! WALL COLLISION!
                // We clamp 'newTop' so it cannot go higher than -40
                // It feels like hitting a physical ceiling.
                newTop = -40; 
            }
            // If it IS legal, we let it go through (no clamp)
        }

        img.style.left = `${newLeft}px`;
        img.style.top = `${newTop}px`;
    };

    window.onmouseup = (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        img.style.cursor = 'grab';
        img.style.zIndex = 10; 

        // DROP LOGIC
        if (img.offsetTop < -50 && checkLegalPlay(cardData)) {
            // It crossed the line AND is legal -> Play it!
            playCardToCenter(cardData, img);
        } else {
            // It didn't leave, or was illegal -> Snap back or stay put
            // If it's inside the box, we leave it (Free move).
            // If it's pushed against the wall (illegal attempt), we snap back to be tidy.
            if (img.offsetTop <= -40) snapBack(img);
        }
    };
}

function snapBack(img) {
    img.style.transition = "all 0.2s ease";
    img.style.left = gameState.originalPos.left;
    img.style.top = gameState.originalPos.top;
    setTimeout(() => { img.style.transition = ""; }, 200);
}

// --- RULE LOGIC: +/- 1 ---
function checkLegalPlay(card) {
    // Check both piles
    return checkPileLogic(card, gameState.centerPileLeft) || 
           checkPileLogic(card, gameState.centerPileRight);
}

function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false;
    
    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);
    
    // Normal +/- 1 rule
    if (diff === 1) return true;
    
    // Ace Loop (14 vs 2) -> Diff is 12
    if (diff === 12) return true;
    
    return false;
}

function playCardToCenter(card, imgElement) {
    // Determine which pile to play on
    // Preference: Left first if valid, else Right
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
        // 1. Update Data
        target.push(card);
        
        // 2. Visual Move
        imgElement.remove(); // Remove from foundation
        renderCenterPile(side, card); // Add to center
    }
}
