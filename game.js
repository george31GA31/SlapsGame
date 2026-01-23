/* =========================================
   SLAPS ENGINE v2.0 - Symmetrical & Free Drag
   ========================================= */

const gameState = {
    playerFoundation: [], // Stores card objects
    aiFoundation: [],
    centerPileLeft: [],
    centerPileRight: [],
    draggedCard: null,    // The card currently being held
    originalPos: { x: 0, y: 0 } // Where the card was before dragging
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];

class Card {
    constructor(suit, rank, value) {
        this.suit = suit;
        this.rank = rank;
        this.value = value; 
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.element = null; // Will hold the HTML <img> tag
    }
}

// --- SETUP ---
window.onload = function() {
    initGame();
};

function initGame() {
    let fullDeck = createDeck();
    shuffle(fullDeck);

    // Split Deck: 26 cards each
    let playerDeck = fullDeck.slice(0, 26);
    let aiDeck = fullDeck.slice(26, 52);

    // Deal Foundations (4-3-2-1)
    dealFoundation(playerDeck, 'player');
    dealFoundation(aiDeck, 'ai');

    // Update Counts (Remainder is Draw Deck)
    document.getElementById('player-count').innerText = playerDeck.length;
    document.getElementById('ai-count').innerText = aiDeck.length;
}

function createDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach((rank, index) => {
            deck.push(new Card(suit, rank, index + 2)); // 2=2, Ace=14
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

[cite_start]// THE 4-3-2-1 DEAL [cite: 430-434]
function dealFoundation(deck, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    
    // We take the top 10 cards for the foundation
    // Pile 1 (4 cards), Pile 2 (3 cards), Pile 3 (2 cards), Pile 4 (1 card)
    const piles = [4, 3, 2, 1];
    let currentX = 50; // Starting X position inside the box

    piles.forEach(count => {
        // Take cards from deck
        let pileCards = deck.splice(0, count);
        
        // Render them slightly stacked
        pileCards.forEach((card, index) => {
            const img = document.createElement('img');
            img.src = card.imgSrc;
            img.className = 'game-card';
            
            // Only Player cards are draggable
            if (owner === 'player') {
                img.classList.add('player-card');
                makeDraggable(img, card); // Enable Drag Logic
            } else {
                img.classList.add('opponent-card');
            }

            // Initial Position (Slightly stacked effect)
            img.style.left = `${currentX + (index * 5)}px`;
            img.style.top = `${30 - (index * 5)}px`; // Stack upwards slightly
            
            // Store reference
            card.element = img;
            container.appendChild(img);
        });

        currentX += 120; // Move to next pile position
    });
}

// --- DRAG AND DROP MECHANICS ---
function makeDraggable(img, cardData) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    img.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        // Get current position (removes 'px' to do math)
        initialLeft = img.offsetLeft;
        initialTop = img.offsetTop;
        
        // Save for "Snap Back" if move is illegal
        gameState.originalPos = { left: img.style.left, top: img.style.top };
        
        img.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();

        // Calculate new position
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        img.style.left = `${initialLeft + dx}px`;
        img.style.top = `${initialTop + dy}px`;
    });

    window.addEventListener('mouseup', (e) => {
        if (!isDragging) return;
        isDragging = false;
        img.style.cursor = 'grab';

        // BOUNDARY CHECK: Did card leave the Foundation Box?
        // We check if the card is dragged ABOVE the box (negative Top value)
        if (img.offsetTop < -50) { 
            // Attempt to play to center
            if (checkLegalPlay(cardData)) {
                console.log("Valid Play!");
                // (Future: Move card to center pile visually)
                // For now, let's just log it works
            } else {
                // ILLEGAL MOVE: Snap back to original spot
                snapBack(img);
            }
        }
        // If inside box, do nothing (It stays where you dropped it = Free Movement)
    });
}

function snapBack(img) {
    // Animate back to original position
    img.style.transition = "all 0.2s ease";
    img.style.left = gameState.originalPos.left;
    img.style.top = gameState.originalPos.top;
    
    // Remove transition after snap so dragging is fast again
    setTimeout(() => {
        img.style.transition = "transform 0.1s";
    }, 200);
}

// LOGIC CHECK (Law D.6)
function checkLegalPlay(card) {
    // Placeholder logic until we setup Center Piles fully
    // For now, lets say ANY play is valid if Center is empty
    // In next step, we will connect this to the Center Pile Arrays
    return false; // Force "Snap Back" for now so you can test the boundary
}
