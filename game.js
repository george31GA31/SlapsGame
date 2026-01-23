/* =========================================
   SLAPS ENGINE v2.2 - FIXED DRAG & PILES
   ========================================= */

const gameState = {
    playerFoundation: [], 
    aiFoundation: [],
    draggedCard: null,
    originalPos: { left: 0, top: 0 }
};

// ASSETS CONFIGURATION
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

    let playerDeck = fullDeck.slice(0, 26);
    let aiDeck = fullDeck.slice(26, 52);

    // Deal specifically for Player and AI
    dealFoundation(playerDeck, 'player');
    dealFoundation(aiDeck, 'ai');

    // Update the Draw Deck Counts
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

// --- THE PILE BUILDER (4-3-2-1) ---
function dealFoundation(deck, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; // Clear board

    const pileSizes = [4, 3, 2, 1]; // The Official ISF Structure
    let currentLeftPercent = 10;    // Start 10% from the left

    pileSizes.forEach(size => {
        // Grab the cards for this specific pile
        let pileCards = deck.splice(0, size);
        
        pileCards.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card';
            
            // LOGIC: Is this the Top Card?
            // The last card in this sub-array is the top one.
            const isTopCard = (index === size - 1);

            if (isTopCard) {
                // FACE UP & INTERACTIVE
                img.src = card.imgSrc;
                card.isFaceUp = true;
                
                if (owner === 'player') {
                    img.classList.add('player-card');
                    makeDraggable(img, card); // ENABLE DRAG
                } else {
                    img.classList.add('opponent-card');
                }
            } else {
                // FACE DOWN & LOCKED
                img.src = CARD_BACK_SRC;
                card.isFaceUp = false;
                // We do NOT call makeDraggable here, so it's stuck.
            }

            // POSITIONING
            // Spread them out horizontally
            img.style.left = `${currentLeftPercent}%`;
            
            // Stack them vertically so you can see how many are left
            // Player piles stack UPWARDS slightly (to look like a stack)
            // AI piles stack DOWNWARDS
            let stackOffset = index * 5; 
            if (owner === 'ai') {
                 img.style.top = `${20 + stackOffset}px`;
            } else {
                 img.style.top = `${50 - stackOffset}px`;
            }
            
            // Ensure top card is visually on top
            img.style.zIndex = index;

            card.element = img;
            container.appendChild(img);
        });

        // Add 20% spacing for the next pile
        currentLeftPercent += 20; 
    });
}

// --- DRAG ENGINE (PREVENTS GHOSTING) ---
function makeDraggable(img, cardData) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    img.addEventListener('mousedown', (e) => {
        e.preventDefault(); // <--- THIS KILLS THE GHOST IMAGE
        
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = img.offsetLeft;
        initialTop = img.offsetTop;
        
        // Save position for snap-back
        gameState.originalPos = { left: img.style.left, top: img.style.top };
        
        // Visuals
        img.style.cursor = 'grabbing';
        img.style.zIndex = 1000; // Float above everything
        img.style.transform = 'scale(1.1)'; // Slight pop
    });

    // We listen on 'window' so if you drag fast and mouse leaves the card, it keeps working
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
        img.style.transform = 'scale(1)'; 
        img.style.zIndex = 10; 

        // LOGIC: Did it leave the box?
        // -50 means "50 pixels above the top edge of the player box"
        if (img.offsetTop < -50) { 
            if (checkLegalPlay(cardData)) {
                console.log("Valid Move");
            } else {
                snapBack(img);
            }
        } 
    });
}

function snapBack(img) {
    img.style.transition = "all 0.2s ease";
    img.style.left = gameState.originalPos.left;
    img.style.top = gameState.originalPos.top;
    
    // Reset transition after the snap finishes
    setTimeout(() => {
        img.style.transition = "transform 0.1s"; 
    }, 200);
}

function checkLegalPlay(card) {
    // Currently returns false so you can test the "Snap Back" mechanics
    return false; 
}
