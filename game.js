/* =========================================
   SLAPS ENGINE v5.0 - HYBRID PHYSICS
   ========================================= */

const gameState = {
    playerDeck: [],
    aiDeck: [],
    centerPileLeft: [],
    centerPileRight: [],
    gameActive: false,
    playerReady: false,
    aiReady: false,
    // Physics State
    draggedCard: null,
    globalZ: 100 // Ensures dragged card is always on top
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

    // Deal exact 4-3-2-1 piles
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

    const pileSizes = [4, 3, 2, 1]; 
    let currentLeftPercent = 5; 

    pileSizes.forEach(size => {
        let pileCards = deck.splice(0, size);
        
        pileCards.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card'; // CSS size is 12vh
            
            // LOGIC: Top card is Face Up
            const isTopCard = (index === size - 1);

            if (isTopCard) {
                setCardFaceUp(img, card, owner);
            } else {
                setCardFaceDown(img, card, owner);
            }

            // POSITIONING
            img.style.left = `${currentLeftPercent}%`;
            
            let stackOffset = index * 5; 
            if (owner === 'ai') {
                 img.style.top = `${10 + stackOffset}px`;
            } else {
                 img.style.top = `${60 - stackOffset}px`;
            }
            
            img.style.zIndex = index + 10; 

            card.element = img;
            container.appendChild(img);
        });

        currentLeftPercent += 24; // Spacing
    });
}

function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc;
    img.classList.remove('card-face-down');
    card.isFaceUp = true;
    
    if (owner === 'player') {
        img.classList.add('player-card');
        img.onclick = null; 
        makeDraggable(img, card); // Enable Physics
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
    img.className = 'game-card'; // Uses the fixed CSS size
    
    img.style.left = '50%';
    img.style.top = '50%';
    const rot = Math.random() * 20 - 10;
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    
    container.appendChild(img);
}

// --- NEW PHYSICS ENGINE (FROM YOUR OLD CODE) ---
function makeDraggable(img, cardData) {
    
    img.onmousedown = (e) => {
        // 1. Checks: Must be active game, must be player card
        if (!gameState.gameActive) return; 
        
        // Prevent default browser drag (Ghost Image)
        e.preventDefault();

        // 2. Bring to front
        gameState.globalZ++;
        img.style.zIndex = gameState.globalZ;
        img.style.transition = 'none'; // Disable smoothing for instant response

        // 3. OFFSET MATH (This is the "Old Code" magic)
        // We calculate exactly where you grabbed the card relative to its corner
        let shiftX = e.clientX - img.getBoundingClientRect().left;
        let shiftY = e.clientY - img.getBoundingClientRect().top;

        // Store original position for Snap Back
        let originalLeft = img.style.left;
        let originalTop = img.style.top;

        function moveAt(pageX, pageY) {
            // Calculate new position based on the offset
            // We need to convert page coordinates to relative coordinates for the box
            const box = document.getElementById('player-foundation-area');
            const boxRect = box.getBoundingClientRect();

            let newLeft = pageX - shiftX - boxRect.left;
            let newTop = pageY - shiftY - boxRect.top;

            // --- THE WALL (Boundary Logic) ---
            // 0 is the top edge of the box. 
            // If trying to go OUT (negative), check if legal.
            if (newTop < 0) { 
                if (!checkLegalPlay(cardData)) {
                    newTop = 0; // Hit the Wall
                }
            }

            img.style.left = newLeft + 'px';
            img.style.top = newTop + 'px';
        }

        // Initial move to prevent jump
        moveAt(e.pageX, e.pageY);

        function onMouseMove(event) {
            moveAt(event.pageX, event.pageY);
        }

        function onMouseUp(event) {
            // Clean up listeners
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            img.style.transition = 'all 0.2s ease-out'; // Re-enable smoothing

            // DROP LOGIC
            // If we crossed the line (buffer -10) AND it's legal
            if (parseInt(img.style.top) < -10 && checkLegalPlay(cardData)) {
                playCardToCenter(cardData, img);
            } else {
                // If illegal or inside box, we essentially leave it (Free Roam)
                // BUT if it's stuck against the wall (0), we just leave it there.
                // The "Snap Back" in your old code reset it to the foundation slot.
                // In this version, we usually want "Free Roam" inside the box.
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

// --- RULE LOGIC ---
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
