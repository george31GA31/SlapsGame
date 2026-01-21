/* ===========================
   1. GLOBAL GAME STATE
   =========================== */
const SUITS = ["♠", "♥", "♣", "♦"];
const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

// Game State Objects
let gameState = {
    player: {
        drawDeck: [],      // The pile of 16 face-down cards
        foundations: [[], [], [], []] // The 4 piles (4, 3, 2, 1)
    },
    opponent: {
        drawDeck: [],
        foundations: [[], [], [], []]
    },
    centerPiles: [[], []], // The two play piles in the middle
    gameActive: false
};

// HTML Elements
const playBotBtn = document.getElementById('play-bot-btn');


/* ===========================
   2. CARD CLASSES & HELPERS
   =========================== */

class Card {
    constructor(suit, value) {
        this.suit = suit;
        this.value = value;
        // Simple color logic: Hearts/Diamonds are red
        this.color = (suit === "♥" || suit === "♦") ? "red" : "black";
    }

    // Returns the HTML string for a face-up card
    getHTML() {
        return `
        <div class="card-face" style="color: ${this.color}">
            <div class="card-value-top">${this.value}</div>
            <div class="card-suit">${this.suit}</div>
            <div class="card-value-bottom">${this.value}</div>
        </div>
        `;
    }
}

function createDeck() {
    return SUITS.flatMap(suit => VALUES.map(value => new Card(suit, value)));
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/* ===========================
   3. THE SETUP LOGIC (The Hard Part)
   =========================== */

function dealCards(deck, playerObj) {
    // 1. We need 10 cards for the Foundation (4+3+2+1)
    // 2. The rest (16) go to the Draw Deck
    
    // Fill Foundation 4 (Index 0, needs 4 cards)
    playerObj.foundations[0] = deck.splice(0, 4);
    
    // Fill Foundation 3 (Index 1, needs 3 cards)
    playerObj.foundations[1] = deck.splice(0, 3);
    
    // Fill Foundation 2 (Index 2, needs 2 cards)
    playerObj.foundations[2] = deck.splice(0, 2);
    
    // Fill Foundation 1 (Index 3, needs 1 card)
    playerObj.foundations[3] = deck.splice(0, 1);
    
    // The rest go to draw deck
    playerObj.drawDeck = deck; 
}

function startGame() {
    console.log("Dealing new game...");
    
    // 1. Create and Shuffle full deck
    let fullDeck = shuffleDeck(createDeck());

    // 2. Split in half (26 each)
    let playerHand = fullDeck.slice(0, 26);
    let opponentHand = fullDeck.slice(26, 52);

    // 3. Deal into specific structures (4-3-2-1)
    dealCards(playerHand, gameState.player);
    dealCards(opponentHand, gameState.opponent);

    // 4. Update the Screen
    renderGame();
    
    gameState.gameActive = true;
    playBotBtn.innerHTML = `<h3><i class="fa-solid fa-rotate"></i> Reset</h3>`;
}

/* ===========================
   4. RENDERING (Drawing to Screen)
   =========================== */

function renderGame() {
    // == Render Player Foundations ==
    // We loop through the 4 foundation piles (0 to 3)
    gameState.player.foundations.forEach((pile, index) => {
        // Get the specific HTML slot for this pile (e.g., 'player-found-4')
        // Note: Our array is 0-3, but our HTML IDs are 4-1. Let's map them.
        // Array index 0 -> Pile of 4. Array index 3 -> Pile of 1.
        let htmlId = `player-found-${4 - index}`;
        let slot = document.getElementById(htmlId);
        
        // Clear previous
        slot.innerHTML = "";
        
        // If pile has cards, show the top one
        if (pile.length > 0) {
            let topCard = pile[pile.length - 1]; // Get last card
            
            // Create a DIV for the card
            let cardDiv = document.createElement('div');
            cardDiv.classList.add('playing-card');
            cardDiv.innerHTML = topCard.getHTML();
            
            // Append to the slot
            slot.appendChild(cardDiv);
            
            // Visual flair: Add a badge showing how many cards are in this stack
            let badge = document.createElement('div');
            badge.className = 'stack-count';
            badge.innerText = pile.length;
            slot.appendChild(badge);
        }
    });

    // == Render Opponent Foundations ==
    gameState.opponent.foundations.forEach((pile, index) => {
        let htmlId = `opp-found-${4 - index}`;
        let slot = document.getElementById(htmlId);
        slot.innerHTML = "";
        
        if (pile.length > 0) {
            let topCard = pile[pile.length - 1];
            let cardDiv = document.createElement('div');
            cardDiv.classList.add('playing-card');
            cardDiv.innerHTML = topCard.getHTML();
            slot.appendChild(cardDiv);
            
            let badge = document.createElement('div');
            badge.className = 'stack-count';
            badge.innerText = pile.length;
            slot.appendChild(badge);
        }
    });
}

// Listen for start
playBotBtn.addEventListener('click', startGame);
