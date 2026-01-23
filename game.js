/* =========================================
   SLAPS ENGINE v4.0 - PILES & BOUNDARY FIX
   ========================================= */

const gameState = {
    playerDeck: [],
    aiDeck: [],
    centerPileLeft: [],
    centerPileRight: [],
    gameActive: false,
    playerReady: false,
    aiReady: false,
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

    // Deal exact 4-3-2-1 piles for both
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

// --- DEALING LOGIC (STRICT 4-3-2-1) ---
function dealFoundation(deck, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 

    // The Official Pile Counts
    const pileSizes = [4, 3, 2, 1]; 
    let currentLeftPercent = 5; // Start slightly more to the left to fit everything

    pileSizes.forEach(size => {
        // Take cards for this specific pile
        let pileCards = deck.splice(0, size);
        
        pileCards.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card'; // CSS size is 12vh
            
            // The last card in the pile is the TOP card (Face Up)
            const isTopCard = (index === size - 1);

            if (isTopCard) {
                setCardFaceUp(img, card, owner);
            } else {
                setCardFaceDown(img, card, owner);
            }

            // HORIZONTAL POSITION (Spread piles out)
            img.style.left = `${currentLeftPercent}%`;
            
            // VERTICAL STACKING
            // AI stacks downwards, Player stacks upwards
            let stackOffset = index * 5; 
            if (owner === 'ai') {
                 img.style.top = `${10 + stackOffset}px`;
            } else {
                 // Push player cards down so the pile grows "up" towards the camera
                 img.style.top = `${60 - stackOffset}px`;
            }
            
            // Z-Index: Ensure top card is always clickable and visible
            img.style.zIndex = index + 10; 

            card.element = img;
            container.appendChild(img);
        });

        // Move to next pile position (Wider gap)
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
        // THIS IS CRITICAL: Every face-up card gets drag logic
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
    const container = document.getElementById('player-foundation-area');
    const liveCards = container.querySelectorAll('.player-card').length;

    if (liveCards < 4) {
        setCardFaceUp(img, card, 'player');
    } else {
        console.log("Cannot flip: Max 4 cards active!");
    }
}

// --- REVEAL SEQUENCE ---
function handlePlayerDeckClick() {
    if (gameState.gameActive || gameState.playerReady) return;

    gameState.playerReady = true;
    document.getElementById('player-draw-deck').classList.add('deck-ready');

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
}

function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    
    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.className = 'game-card'; // CSS size 12vh
    
    img.style.left = '50%';
    img.style.top = '50%';
    const rot = Math.random() * 20 - 10;
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    
    container.appendChild(img);
}

// --- THE FIXED WALL LOGIC ---
function makeDraggable(img, cardData) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    
    // We get the box so we know where the "Wall" is
    const box = document.getElementById('player-foundation-area');

    img.onmousedown = (e) => {
        e.preventDefault();
        if (!gameState.gameActive) return; 

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

        // BOUNDARY CHECK (THE FIX)
        // 0 is exactly the top white line of the player box.
        // If we go higher than 0 (negative numbers), we are trying to leave.
        if (newTop < 0) {
            
            // If it is NOT a legal move...
            if (!checkLegalPlay(cardData)) {
                // STOP AT THE WALL (0px)
                newTop = 0; 
            }
            // If it IS legal, we allow it to pass (newTop stays negative)
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
        // If we crossed the line (-10 buffer) AND it's legal
        if (img.offsetTop < -10 && checkLegalPlay(cardData)) {
            playCardToCenter(cardData, img);
        } else {
            // If we are stuck at the wall (0) or inside positive space
            // If it was an illegal attempt (stuck at 0), snap back for tidiness
            // If it was a normal move inside the box, stay there.
            if (img.offsetTop <= 0 && !checkLegalPlay(cardData)) {
                 // Optional: Snap back if they slammed the wall
                 // snapBack(img); 
            }
        }
    };
}

function snapBack(img) {
    img.style.transition = "all 0.2s ease";
    img.style.left = gameState.originalPos.left;
    img.style.top = gameState.originalPos.top;
    setTimeout(() => { img.style.transition = ""; }, 200);
}

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
        imgElement.remove(); 
        renderCenterPile(side, card); 
    }
}
