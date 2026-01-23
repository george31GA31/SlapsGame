/* =========================================
   SLAPS GAME ENGINE v1.0
   Based on ISF Laws 2025-26
   ========================================= */

// --- GAME STATE ---
const gameState = {
    playerDeck: [],
    playerFoundation: [[], [], [], []], // 4 piles
    aiDeck: [],
    aiFoundation: [[], [], [], []],     // 4 piles
    centerPileLeft: [],
    centerPileRight: [],
    gameActive: false,
    selectedCard: null // Tracks which card the player is dragging/clicking
};

// --- CONFIGURATION ---
// Ensure these match your actual filenames in assets/cards/
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const FILE_EXTENSION = ".png"; // CHANGE THIS if your cards are .jpg

class Card {
    constructor(suit, rank, value) {
        this.suit = suit;
        this.rank = rank;
        this.value = value; // 2-14 (Ace is 14 for comparison logic)
        // Constructs filename: "2_of_clubs.png"
        this.imgSrc = `assets/cards/${rank}_of_${suit}${FILE_EXTENSION}`;
    }
}

/* =========================================
   INITIALIZATION & SETUP
   ========================================= */

function initGame() {
    console.log("Initializing ISF Official Match...");
    
    [cite_start]// 1. Create and Shuffle Deck [cite: 62, 63]
    let fullDeck = createDeck();
    shuffle(fullDeck);

    [cite_start]// 2. Deal 26 Cards each [cite: 63]
    gameState.playerDeck = fullDeck.slice(0, 26);
    gameState.aiDeck = fullDeck.slice(26, 52);

    [cite_start]// 3. Build Foundations (4-3-2-1 Rule) [cite: 65, 430]
    buildFoundation(gameState.playerDeck, gameState.playerFoundation);
    buildFoundation(gameState.aiDeck, gameState.aiFoundation);

    // 4. Render the Board
    renderBoard();
    
    // 5. Start Game Loop (Reveal first cards)
    // For now, we just indicate readiness. Real match starts with simultaneous reveal.
    console.log("Match Ready.");
}

function createDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach((rank, index) => {
            // Value: 2=2, ... 10=10, J=11, Q=12, K=13, A=1 (Logic handled later)
            // We'll use index+2 for simple numeric value (2 is index 0 + 2)
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

// Logic to distribute cards into the 4 foundation piles (4, 3, 2, 1)
function buildFoundation(deck, foundationArray) {
    // Pile 1: 4 cards
    foundationArray[0] = deck.splice(0, 4);
    // Pile 2: 3 cards
    foundationArray[1] = deck.splice(0, 3);
    // Pile 3: 2 cards
    foundationArray[2] = deck.splice(0, 2);
    // Pile 4: 1 card
    foundationArray[3] = deck.splice(0, 1);
    
    // Remaining cards stay in draw deck (handled by splice reference)
}

/* =========================================
   RENDERING (VISUALS)
   ========================================= */

function renderBoard() {
    // Render Player Foundation
    const pContainer = document.getElementById('player-foundation');
    pContainer.innerHTML = ''; // Clear current
    
    gameState.playerFoundation.forEach((pile, index) => {
        const slot = document.createElement('div');
        slot.className = 'fp-slot';
        
        // Only show if pile has cards
        if (pile.length > 0) {
            [cite_start]// The top card is the "Live Card" [cite: 70, 179]
            const topCard = pile[pile.length - 1];
            const img = document.createElement('img');
            img.src = topCard.imgSrc;
            img.className = 'game-card player-card';
            img.dataset.pileIndex = index; // Store which pile this is
            
            // Interaction: Click to Play
            img.onclick = () => handleCardClick(index);
            
            slot.appendChild(img);
        }
        pContainer.appendChild(slot);
    });

    // Render AI Foundation (Top cards visible but Upside Down)
    const aiContainer = document.getElementById('opponent-foundation');
    aiContainer.innerHTML = '';
    
    gameState.aiFoundation.forEach(pile => {
        const slot = document.createElement('div');
        slot.className = 'fp-slot';
        
        if (pile.length > 0) {
            const topCard = pile[pile.length - 1];
            const img = document.createElement('img');
            img.src = topCard.imgSrc; 
            img.className = 'game-card opponent-card';
            slot.appendChild(img);
        }
        aiContainer.appendChild(slot);
    });

    // Update Counts
    document.getElementById('player-deck-count').innerText = gameState.playerDeck.length;
    document.getElementById('ai-deck-count').innerText = gameState.aiDeck.length;
}

/* =========================================
   GAMEPLAY LOGIC
   ========================================= */

// Player clicks a card in their foundation
function handleCardClick(pileIndex) {
    const pile = gameState.playerFoundation[pileIndex];
    if (pile.length === 0) return;

    const card = pile[pile.length - 1]; // Top card
    gameState.selectedCard = { card, pileIndex };
    
    // Visual feedback (optional: highlight selected card)
    console.log(`Selected: ${card.rank} of ${card.suit}`);
    
    // Attempt to play on Left or Right center piles (Simple auto-play for now)
    // Real Drag/Drop will check where the user releases the mouse
    if (attemptPlay(card, 'left')) {
        playCard(pileIndex, 'left');
    } else if (attemptPlay(card, 'right')) {
        playCard(pileIndex, 'right');
    } else {
        console.log("Invalid Move");
        // Shake animation could go here
    }
}

[cite_start]// ISF Rule Check: Rank +/- 1 [cite: 89]
function attemptPlay(card, targetSide) {
    let targetPile = targetSide === 'left' ? gameState.centerPileLeft : gameState.centerPileRight;
    
    // If pile is empty (start of game), we can't play normally (Requires Reveal)
    if (targetPile.length === 0) return false;

    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);

    // Standard +/- 1
    if (diff === 1) return true;
    
    [cite_start]// Sequence Loop: Ace (14) on 2 (2) or Ace on King (13) [cite: 91, 470]
    // Values: 2=2 ... K=13, A=14
    // Ace (14) on 2 (2) -> diff 12. 
    // Ace (14) on King (13) -> diff 1.
    // 2 (2) on Ace (14) -> diff 12.
    if (diff === 12) return true; // Handles Ace <-> 2 wrapping

    return false;
}

function playCard(pileIndex, targetSide) {
    // 1. Move logic
    const pile = gameState.playerFoundation[pileIndex];
    const card = pile.pop(); // Remove from foundation
    
    if (targetSide === 'left') {
        gameState.centerPileLeft.push(card);
        // Render Center Left
        updateCenterPile('left', card);
    } else {
        gameState.centerPileRight.push(card);
        // Render Center Right
        updateCenterPile('right', card);
    }

    [cite_start]// 2. Refresh Board (shows new top card of foundation) [cite: 439]
    renderBoard();
}

function updateCenterPile(side, card) {
    const elementId = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(elementId);
    
    // Clear old card visually
    container.innerHTML = '';
    
    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.className = 'game-card played-card';
    
    // Random slight rotation for realism
    const rotation = Math.random() * 20 - 10; 
    img.style.transform = `rotate(${rotation}deg)`;
    
    container.appendChild(img);
}

// Start the game when page loads
window.onload = initGame;
