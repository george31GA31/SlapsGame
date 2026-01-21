document.addEventListener('DOMContentLoaded', () => {
    
    /* === 1. SETUP & CONFIG === */
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    
    // Difficulty Names (Matches Setup Page)
    const BOT_NAMES = ["ROOKIE", "NOVICE", "AMATEUR", "INTERMEDIATE", "SKILLED", "GOOD", "ADVANCED", "PROVEN", "MASTER", "UNBEATABLE"];

    // Get Difficulty from memory (Default to 5 if missing)
    let difficultyLevel = parseInt(localStorage.getItem('slapsDifficulty')) || 5;
    
    // Update Bot Name on screen
    document.getElementById('bot-name-display').innerText = BOT_NAMES[difficultyLevel - 1];

    /* === 2. CARD CLASS === */
    class Card {
        constructor(suit, value) {
            this.suit = suit;
            this.value = value;
            this.color = (suit === "♥" || suit === "♦") ? "#d9534f" : "#292b2c";
        }

        getHTML() {
            return `
            <div class="playing-card" style="color: ${this.color}">
                <div class="card-top">${this.value}</div>
                <div class="card-mid">${this.suit}</div>
                <div class="card-bot">${this.value}</div>
            </div>`;
        }
    }

    /* === 3. GAME STATE === */
    let gameState = {
        player: {
            drawDeck: [],
            // 4 piles: Index 0 is pile of 4, Index 3 is pile of 1
            foundations: [[], [], [], []] 
        },
        opponent: {
            drawDeck: [],
            foundations: [[], [], [], []]
        },
        centerLeft: [],
        centerRight: []
    };

    /* === 4. DEAL LOGIC === */
    function createDeck() {
        return SUITS.flatMap(suit => VALUES.map(value => new Card(suit, value)));
    }

    function shuffle(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    function initGame() {
        let fullDeck = shuffle(createDeck());

        // Split 26 / 26
        let pHand = fullDeck.slice(0, 26);
        let oHand = fullDeck.slice(26, 52);

        // Distribute 4-3-2-1 (Total 10 cards)
        distribute(pHand, gameState.player);
        distribute(oHand, gameState.opponent);

        // Render
        renderBoard();
    }

    function distribute(hand, entity) {
        // Pile 0 needs 4 cards
        entity.foundations[0] = hand.splice(0, 4);
        // Pile 1 needs 3 cards
        entity.foundations[1] = hand.splice(0, 3);
        // Pile 2 needs 2 cards
        entity.foundations[2] = hand.splice(0, 2);
        // Pile 3 needs 1 card
        entity.foundations[3] = hand.splice(0, 1);
        
        // Remaining 16 go to draw deck
        entity.drawDeck = hand;
    }

    /* === 5. RENDER LOGIC === */
    function renderBoard() {
        // Render Player Foundations
        const playerZone = document.getElementById('player-foundation');
        playerZone.innerHTML = ''; // Clear old

        gameState.player.foundations.forEach((pile, index) => {
            let slot = document.createElement('div');
            slot.className = 'card-slot';
            
            // If pile has cards, show top one
            if(pile.length > 0) {
                let card = pile[pile.length - 1]; // Top card
                slot.innerHTML = card.getHTML();
                
                // Add Badge for stack height
                let badge = document.createElement('div');
                badge.className = 'card-count-badge';
                badge.innerText = pile.length; // e.g. "4"
                slot.appendChild(badge);
            }
            playerZone.appendChild(slot);
        });

        // Render Opponent Foundations (Same logic)
        const botZone = document.getElementById('bot-foundation');
        botZone.innerHTML = ''; 

        gameState.opponent.foundations.forEach((pile, index) => {
            let slot = document.createElement('div');
            slot.className = 'card-slot';
            
            if(pile.length > 0) {
                let card = pile[pile.length - 1];
                slot.innerHTML = card.getHTML();
                
                let badge = document.createElement('div');
                badge.className = 'card-count-badge';
                badge.innerText = pile.length;
                slot.appendChild(badge);
            }
            botZone.appendChild(slot);
        });

        // Update Deck Counts
        document.getElementById('player-deck-count').innerText = gameState.player.drawDeck.length;
        document.getElementById('bot-deck-count').innerText = gameState.opponent.drawDeck.length;
    }

    // Start!
    initGame();
});
