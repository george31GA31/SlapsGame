document.addEventListener('DOMContentLoaded', () => {
    console.log("Slaps Engine Loaded.");

    /* ===========================
       1. GLOBAL GAME STATE
       =========================== */
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

    let gameState = {
        player: {
            drawDeck: [],
            foundations: [[], [], [], []] 
        },
        opponent: {
            drawDeck: [],
            foundations: [[], [], [], []]
        },
        centerPiles: [[], []], 
        gameActive: false
    };

    // Grab the button carefully
    const playBotBtn = document.getElementById('play-bot-btn');
    
    // Check if button exists to prevent crashes
    if (!playBotBtn) {
        console.error("CRITICAL ERROR: Could not find element with id 'play-bot-btn'. Check your HTML!");
        return; // Stop the script
    }

    /* ===========================
       2. CARD CLASSES & HELPERS
       =========================== */

    class Card {
        constructor(suit, value) {
            this.suit = suit;
            this.value = value;
            this.color = (suit === "♥" || suit === "♦") ? "red" : "black";
        }

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
        let deck = [];
        SUITS.forEach(suit => {
            VALUES.forEach(value => {
                deck.push(new Card(suit, value));
            });
        });
        return deck;
    }

    function shuffleDeck(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    /* ===========================
       3. THE SETUP LOGIC
       =========================== */

    function dealCards(deck, playerObj) {
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
        console.log("Game Start Triggered!");

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
        
        // Update button text
        playBotBtn.innerHTML = `
            <div class="card-icon"><i class="fa-solid fa-rotate"></i></div>
            <div class="card-text">
                <h3>Reset Game</h3>
                <p>Click to redeal</p>
            </div>
        `;
    }

    /* ===========================
       4. RENDERING
       =========================== */

    function renderGame() {
        // == Render Player Foundations ==
        gameState.player.foundations.forEach((pile, index) => {
            let htmlId = `player-found-${4 - index}`;
            let slot = document.getElementById(htmlId);
            
            if(slot) {
                slot.innerHTML = "";
                if (pile.length > 0) {
                    let topCard = pile[pile.length - 1]; 
                    let cardDiv = document.createElement('div');
                    cardDiv.className = 'playing-card'; // Note: Changed to className for safety
                    cardDiv.innerHTML = topCard.getHTML();
                    slot.appendChild(cardDiv);
                    
                    // Add Badge
                    let badge = document.createElement('div');
                    badge.className = 'stack-count';
                    badge.innerText = pile.length;
                    slot.appendChild(badge);
                }
            } else {
                console.error(`Missing HTML Element: ${htmlId}`);
            }
        });

        // == Render Opponent Foundations ==
        gameState.opponent.foundations.forEach((pile, index) => {
            let htmlId = `opp-found-${4 - index}`;
            let slot = document.getElementById(htmlId);
            
            if(slot) {
                slot.innerHTML = "";
                if (pile.length > 0) {
                    let topCard = pile[pile.length - 1];
                    let cardDiv = document.createElement('div');
                    cardDiv.className = 'playing-card';
                    cardDiv.innerHTML = topCard.getHTML();
                    slot.appendChild(cardDiv);

                    let badge = document.createElement('div');
                    badge.className = 'stack-count';
                    badge.innerText = pile.length;
                    slot.appendChild(badge);
                }
            }
        });
        
        // Render Draw Decks (Just to show they exist)
        const playerDeckSlot = document.getElementById('player-draw-deck');
        if(playerDeckSlot) {
            // If deck is empty, remove the card back
            if(gameState.player.drawDeck.length === 0) {
                playerDeckSlot.innerHTML = '<span class="label">Empty</span>';
            }
        }
    }

    // Attach Listener
    playBotBtn.addEventListener('click', startGame);
    console.log("Button Listener Attached.");
});
