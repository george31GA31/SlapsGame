/* =========================================
   SLAPS GAME ENGINE v1.1
   Based on ISF Laws 2025-26
   ========================================= */

// --- GAME STATE OBJECT ---
const gameState = {
    playerDeck: [],
    playerFoundation: [[], [], [], []], // 4 piles for the player
    aiDeck: [],
    aiFoundation: [[], [], [], []],     // 4 piles for the AI
    centerPileLeft: [],
    centerPileRight: [],
    gameActive: false,
    selectedCard: null 
};

// --- CONFIGURATION ---
// These MUST match your image filenames exactly (case sensitive!)
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const FILE_EXTENSION = ".png"; 

// --- CARD CLASS ---
class Card {
    constructor(suit, rank, value) {
        this.suit = suit;
        this.rank = rank;
        this.value = value; 
        // Generates path like: "assets/cards/king_of_hearts.png"
        this.imgSrc = `assets/cards/${rank}_of_${suit}${FILE_EXTENSION}`;
    }
}

/* =========================================
   INITIALIZATION & SETUP
   ========================================= */

function initGame() {
    console.log("Initializing ISF Official Match...");
    
    // 1. Create a fresh 52-card deck
    let fullDeck = createDeck();
    
    // 2. Shuffle it randomly
    shuffle(fullDeck);

    // 3. Deal 26 cards to each player
    gameState.playerDeck = fullDeck.slice(0, 26);
    gameState.aiDeck = fullDeck.slice(26, 52);

    // 4. Build the Foundation Piles (4-3-2-1 Rule)
    buildFoundation(gameState.playerDeck, gameState.playerFoundation);
    buildFoundation(gameState.aiDeck, gameState.aiFoundation);

    // 5. Draw the initial board state
    renderBoard();
    
    console.log("Match Ready. Foundations built.");
}

// Generates the deck and assigns numerical values
function createDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach((rank, index) => {
            // LOGIC: 
            // Index 0 ('2') + 2 = Value 2
            // Index 8 ('10') + 2 = Value 10
            // Index 11 ('king') + 2 = Value 13
            // Index 12 ('ace') + 2 = Value 14
            let val = index + 2;
            deck.push(new Card(suit, rank, val));
        });
    });
    return deck;
}

// Standard Fisher-Yates Shuffle
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// Distributes cards into the 4 sub-piles (4, 3, 2, 1 cards)
function buildFoundation(deck, foundationArray) {
    // We splice cards OUT of the deck and into the piles
    foundationArray[0] = deck.splice(0, 4);
    foundationArray[1] = deck.splice(0, 3);
    foundationArray[2] = deck.splice(0, 2);
    foundationArray[3] = deck.splice(0, 1);
}

/* =========================================
   RENDERING (VISUALS)
   ========================================= */

function renderBoard() {
    // 1. Render Player Foundation
    const pContainer = document.getElementById('player-foundation');
    pContainer.innerHTML = ''; // Wipe current HTML
    
    gameState.playerFoundation.forEach((pile, index) => {
        const slot = document.createElement('div');
        slot.className = 'fp-slot'; // Uses the CSS sizing we fixed
        
        // Only draw a card if the pile has one
        if (pile.length > 0) {
            // The last card in the array is the "Top" face-up card
            const topCard = pile[pile.length - 1];
            
            const img = document.createElement('img');
            img.src = topCard.imgSrc;
            img.className = 'game-card player-card';
            
            // Add Click Event
            img.onclick = () => handleCardClick(index);
            
            slot.appendChild(img);
        }
        pContainer.appendChild(slot);
    });

    // 2. Render AI Foundation (Top cards visible but Upside Down)
    const aiContainer = document.getElementById('opponent-foundation');
    aiContainer.innerHTML = '';
    
    gameState.aiFoundation.forEach(pile => {
        const slot = document.createElement('div');
        slot.className = 'fp-slot';
        
        if (pile.length > 0) {
            const topCard = pile[pile.length - 1];
            
            const img = document.createElement('img');
            img.src = topCard.imgSrc; 
            img.className = 'game-card opponent-card'; // Rotated 180deg by CSS
            
            slot.appendChild(img);
        }
        aiContainer.appendChild(slot);
    });

    // 3. Update Deck Counts
    document.getElementById('player-deck-count').innerText = gameState.playerDeck.length;
    document.getElementById('ai-deck-count').innerText = gameState.aiDeck.length;
}

/* =========================================
   GAMEPLAY LOGIC
   ========================================= */

function handleCardClick(pileIndex) {
    const pile = gameState.playerFoundation[pileIndex];
    if (pile.length === 0) return; // Ignore empty piles

    const card = pile[pile.length - 1]; // Get the clicked card object
    
    console.log(`Clicked: ${card.rank} (Val: ${card.value})`); // DEBUG
    
    // Check Left Pile, then Right Pile
    if (attemptPlay(card, 'left')) {
        playCard(pileIndex, 'left');
    } else if (attemptPlay(card, 'right')) {
        playCard(pileIndex, 'right');
    } else {
        console.log("Move Invalid: No matching rank +/- 1");
    }
}

function attemptPlay(card, targetSide) {
    let targetPile = targetSide === 'left' ? gameState.centerPileLeft : gameState.centerPileRight;
    
    // If center pile is empty, you cannot play (Game hasn't started/Reveal needed)
    if (targetPile.length === 0) return false;

    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);

    // Rule 1: Normal +/- 1 (e.g. 7 on 8, or 5 on 4)
    if (diff === 1) return true;
    
    // Rule 2: Ace Loop (Ace is 14, Two is 2. Diff is 12)
    // 14 on 2 is legal. 2 on 14 is legal.
    if (diff === 12) return true; 

    return false;
}

function playCard(pileIndex, targetSide) {
    // 1. Logic Move: Remove from foundation, Add to center
    const pile = gameState.playerFoundation[pileIndex];
    const card = pile.pop();
    
    if (targetSide === 'left') {
        gameState.centerPileLeft.push(card);
        updateCenterPile('left', card);
    } else {
        gameState.centerPileRight.push(card);
        updateCenterPile('right', card);
    }

    // 2. Refresh the board to show the card underneath (if any)
    renderBoard();
}

// Updates just the center pile visual (optimization)
function updateCenterPile(side, card) {
    const elementId = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(elementId);
    
    container.innerHTML = ''; // Remove previous top card visual
    
    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.className = 'game-card played-card';
    
    // Random rotation for realistic "messy pile" look
    const rotation = Math.random() * 20 - 10; 
    img.style.transform = `rotate(${rotation}deg)`;
    
    container.appendChild(img);
}

// Start game on load
window.onload = initGame;
