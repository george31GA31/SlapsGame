/* =========================================
   SLAPS ENGINE v2.1 - Face Down/Up Logic
   ========================================= */

const gameState = {
    playerFoundation: [], 
    aiFoundation: [],
    centerPileLeft: [],
    centerPileRight: [],
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
        this.isFaceUp = false; // New property to track state
        this.element = null; 
    }
}

// --- SETUP ---
window.onload = function() {
    initGame();
};

function initGame() {
    let fullDeck = createDeck();
    shuffle(fullDeck);

    let playerDeck = fullDeck.slice(0, 26);
    let aiDeck = fullDeck.slice(26, 52);

    dealFoundation(playerDeck, 'player');
    dealFoundation(aiDeck, 'ai');

    document.getElementById('player-count').innerText = playerDeck.length;
    document.getElementById('ai-count').innerText = aiDeck.length;
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

// --- NEW DEALING LOGIC (4-3-2-1 with Face Down Rules) ---
function dealFoundation(deck, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; // Clear any existing cards

    // The ISF Pile Structure: 4, 3, 2, 1 cards
    const pileSizes = [4, 3, 2, 1];
    
    // Spacing: Start at 10% width and space them out by 20%
    let currentLeftPercent = 10; 

    pileSizes.forEach(size => {
        // Extract the cards for this specific pile
        let pileCards = deck.splice(0, size);
        
        pileCards.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card';
            
            // LOGIC: Is this the TOP card of the pile?
            // The last card in the array (index === size - 1) is the TOP card.
            const isTopCard = (index === size - 1);

            if (isTopCard) {
                // FACE UP
                img.src = card.imgSrc;
                card.isFaceUp = true;
                
                // Only Player's Face-Up cards are interactive
                if (owner === 'player') {
                    img.classList.add('player-card');
                    makeDraggable(img, card); 
                } else {
                    img.classList.add('opponent-card');
                }
            } else {
                // FACE DOWN
                img.src = CARD_BACK_SRC;
                card.isFaceUp = false;
                // No drag listeners added here, so it's locked in place
            }

            // POSITIONING
            // We use percentages for Left to keep it responsive/spread out
            img.style.left = `${currentLeftPercent}%`;
            
            // Stack effect: Face down cards are higher up (visually "underneath")
            // owner === 'player' ? stack upwards : stack downwards (for AI)
            let stackOffset = index * 15; 
            if (owner === 'ai') {
                 img.style.top = `${20 + stackOffset}px`;
            } else {
                 // For player, we want piles to look like they are stacking towards the user
                 // Or flat. Let's stack them slightly "up" so the top card covers the bottom
                 img.style.top = `${50 + stackOffset}px`;
            }
            
            // Z-Index ensures the Top card is visually on top of the pile
            img.style.zIndex = index;

            card.element = img;
            container.appendChild(img);
        });

        // Increase spacing for the next pile
        currentLeftPercent += 22; // Wider gap between piles
    });
}

// --- DRAG AND DROP (Click - Hold - Release) ---
function makeDraggable(img, cardData) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    img.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevents default browser "ghost image" drag
        isDragging = true;
        
        // Record where we clicked relative to the card
        startX = e.clientX;
        startY = e.clientY;
        
        // Record current card position
        initialLeft = img.offsetLeft;
        initialTop = img.offsetTop;
        
        // Save for Snap Back
        gameState.originalPos = { left: img.style.left, top: img.style.top };
        
        // Visual feedback
        img.style.cursor = 'grabbing';
        img.style.zIndex = 1000; // Bring to absolute front while dragging
        img.style.transform = 'scale(1.1)';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        img.style.left = `${initialLeft + dx}px`;
        img.style.top = `${initialTop + dy}px`;
    });

    window.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        img.style.cursor = 'grab';
        img.style.transform = 'scale(1)'; // Reset size
        img.style.zIndex = 10; // Reset Z-index (but keep above face-down cards)

        // BOUNDARY CHECK:
        // Did we drag it high enough to hit the center zone? (Negative top relative to box)
        // OR did we drop it back inside the box?
        
        if (img.offsetTop < -50) { 
            // Attempt Play Logic
            if (checkLegalPlay(cardData)) {
                // Valid Play Code Here
            } else {
                snapBack(img);
            }
        } 
        // If we just dropped it inside the box, it stays there (Free Roam)
    });
}

function snapBack(img) {
    img.style.transition = "all 0.2s ease";
    img.style.left = gameState.originalPos.left;
    img.style.top = gameState.originalPos.top;
    
    setTimeout(() => {
        img.style.transition = "transform 0.1s"; // Remove position transition so drag feels instant next time
    }, 200);
}

function checkLegalPlay(card) {
    // Logic placeholder - currently rejects everything to test snap-back
    return false; 
}
