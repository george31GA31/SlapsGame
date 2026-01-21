document.addEventListener('DOMContentLoaded', () => {
    
    /* ===========================
       1. SETTINGS & AUDIO
       =========================== */
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    
    // Difficulty Settings (Reaction speed in milliseconds)
    // Level 1 = 3000ms (Slow), Level 10 = 600ms (Fast)
    let difficultyLevel = parseInt(localStorage.getItem('slapsDifficulty')) || 5;
    let botSpeed = Math.max(500, 3500 - (difficultyLevel * 300));
    
    // Game State
    let gameState = {
        player: { drawDeck: [], foundations: [[], [], [], []] },
        bot: { drawDeck: [], foundations: [[], [], [], []] },
        centerLeft: null,  // The card object currently on the left pile
        centerRight: null, // The card object currently on the right pile
        isGameOver: false,
        draggedCard: null, // Card currently being dragged
        originPileIndex: -1 // Where the dragged card came from
    };

    // DOM Elements
    const els = {
        playerFoundations: [
            document.getElementById('player-found-4'),
            document.getElementById('player-found-3'),
            document.getElementById('player-found-2'),
            document.getElementById('player-found-1')
        ],
        botFoundations: [
            document.getElementById('bot-foundation').appendChild(createSlot()),
            document.getElementById('bot-foundation').appendChild(createSlot()),
            document.getElementById('bot-foundation').appendChild(createSlot()),
            document.getElementById('bot-foundation').appendChild(createSlot())
        ],
        centerLeft: document.getElementById('center-left'),
        centerRight: document.getElementById('center-right'),
        playerDeckCount: document.getElementById('player-deck-count'),
        botDeckCount: document.getElementById('bot-deck-count'),
        overlay: document.getElementById('game-overlay'),
        overlayTitle: document.getElementById('overlay-title'),
        overlayDesc: document.getElementById('overlay-desc')
    };

    // Helper to create slots dynamically for bot since ID was generic
    function createSlot() {
        let div = document.createElement('div');
        div.className = 'card-slot';
        return div;
    }

    /* ===========================
       2. CARD LOGIC
       =========================== */
    class Card {
        constructor(suit, value) {
            this.suit = suit;
            this.value = value;
            this.rank = VALUES.indexOf(value) + 1; // 1 to 13
            this.color = (suit === "♥" || suit === "♦") ? "red" : "black";
            this.id = Math.random().toString(36).substr(2, 9); // Unique ID for tracking
        }

        getHTML() {
            return `
            <div class="playing-card" data-id="${this.id}" style="color: ${this.color === 'red' ? '#d9534f' : '#292b2c'}">
                <div class="card-top">${this.value}</div>
                <div class="card-mid">${this.suit}</div>
                <div class="card-bot">${this.value}</div>
            </div>`;
        }
    }

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

    /* ===========================
       3. GAME INIT & DEALING
       =========================== */
    function initGame() {
        console.log(`Starting Match. Bot Level: ${difficultyLevel} (Speed: ${botSpeed}ms)`);
        
        // 1. Setup Decks
        let fullDeck = shuffle(createDeck());
        let pHand = fullDeck.slice(0, 26);
        let bHand = fullDeck.slice(26, 52);

        // 2. Distribute 4-3-2-1
        distribute(pHand, gameState.player);
        distribute(bHand, gameState.bot);

        // 3. Initial Center Flip (Takes 1 card from each draw deck to start game)
        if(gameState.player.drawDeck.length > 0) gameState.centerLeft = gameState.player.drawDeck.pop();
        if(gameState.bot.drawDeck.length > 0) gameState.centerRight = gameState.bot.drawDeck.pop();

        renderBoard();
        startBot();
        checkStalemateLoop(); // Starts the "Stuck?" checker
    }

    function distribute(hand, entity) {
        // Fill 4 piles
        entity.foundations[0] = hand.splice(0, 4);
        entity.foundations[1] = hand.splice(0, 3);
        entity.foundations[2] = hand.splice(0, 2);
        entity.foundations[3] = hand.splice(0, 1);
        entity.drawDeck = hand;
    }

    /* ===========================
       4. RENDERING & DRAG LOGIC
       =========================== */
    function renderBoard() {
        // Update Center Piles
        renderCenterPile(els.centerLeft, gameState.centerLeft);
        renderCenterPile(els.centerRight, gameState.centerRight);

        // Update Deck Counts
        els.playerDeckCount.innerText = gameState.player.drawDeck.length;
        els.botDeckCount.innerText = gameState.bot.drawDeck.length;

        // Render Player Piles (Interactive)
        gameState.player.foundations.forEach((pile, index) => {
            const slot = els.playerFoundations[index];
            slot.innerHTML = ''; // Clear

            if (pile.length > 0) {
                let card = pile[pile.length - 1]; // Top card
                slot.innerHTML = card.getHTML();
                
                // Make Draggable
                const cardEl = slot.querySelector('.playing-card');
                setupDragEvents(cardEl, card, index);
                
                // Add badge
                addBadge(slot, pile.length);
            }
        });

        // Render Bot Piles (Static)
        gameState.bot.foundations.forEach((pile, index) => {
            const slot = els.botFoundations[index];
            slot.innerHTML = ''; 
            if (pile.length > 0) {
                let card = pile[pile.length - 1];
                slot.innerHTML = card.getHTML();
                addBadge(slot, pile.length);
            }
        });

        checkWinCondition();
    }

    function renderCenterPile(element, card) {
        element.innerHTML = '';
        if(card) {
            element.innerHTML = card.getHTML();
            // Remove "playing-card" class to stop it looking draggable in center
            let div = element.querySelector('.playing-card');
            div.style.cursor = 'default'; 
            div.style.position = 'relative'; // Fix CSS positioning
        }
    }

    function addBadge(slot, count) {
        let badge = document.createElement('div');
        badge.className = 'card-count-badge';
        badge.innerText = count;
        slot.appendChild(badge);
    }

    // --- DRAG AND DROP HANDLING ---
    function setupDragEvents(element, cardObj, pileIndex) {
        let isDragging = false;
        let startX, startY;

        element.addEventListener('mousedown', (e) => {
            isDragging = true;
            gameState.draggedCard = cardObj;
            gameState.originPileIndex = pileIndex;
            
            // Visuals
            element.style.zIndex = 1000;
            element.style.transform = 'scale(1.1)';
            
            // Mouse offset to grab card in middle
            startX = e.clientX - element.getBoundingClientRect().left;
            startY = e.clientY - element.getBoundingClientRect().top;

            // Attach Global Move/Up listeners
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        function onMouseMove(e) {
            if (!isDragging) return;
            // Move card to mouse position
            element.style.position = 'fixed';
            element.style.left = (e.clientX - startX) + 'px';
            element.style.top = (e.clientY - startY) + 'px';
        }

        function onMouseUp(e) {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Check Drop Zones
            if (isOverElement(e, els.centerLeft) && isValidMove(cardObj, gameState.centerLeft)) {
                playCard('player', pileIndex, 'left');
            } 
            else if (isOverElement(e, els.centerRight) && isValidMove(cardObj, gameState.centerRight)) {
                playCard('player', pileIndex, 'right');
            } 
            else {
                // Invalid Move - Snap Back
                renderBoard(); // Re-render resets position
            }
        }
    }

    function isOverElement(e, targetEl) {
        const rect = targetEl.getBoundingClientRect();
        return (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom);
    }

    /* ===========================
       5. RULES & LOGIC
       =========================== */
    function isValidMove(card, centerCard) {
        if (!centerCard) return false;
        const r1 = card.rank;
        const r2 = centerCard.rank;
        
        // Logic: +/- 1, or Ace(1) on King(13), or King(13) on Ace(1)
        const diff = Math.abs(r1 - r2);
        return (diff === 1 || diff === 12);
    }

    function playCard(who, pileIndex, whichCenter) {
        // 1. Logic Move
        let card;
        if (who === 'player') {
            card = gameState.player.foundations[pileIndex].pop();
        } else {
            card = gameState.bot.foundations[pileIndex].pop();
        }

        // 2. Place on Center
        if (whichCenter === 'left') gameState.centerLeft = card;
        else gameState.centerRight = card;

        // 3. Render
        renderBoard();
    }

    function checkWinCondition() {
        // Player Wins if all foundations empty
        const pEmpty = gameState.player.foundations.every(p => p.length === 0);
        if (pEmpty && !gameState.isGameOver) {
            endGame("VICTORY!", "You cleared your board faster.");
            return;
        }

        const bEmpty = gameState.bot.foundations.every(p => p.length === 0);
        if (bEmpty && !gameState.isGameOver) {
            endGame("DEFEAT", "The bot cleared its board first.");
        }
    }

    function endGame(title, desc) {
        gameState.isGameOver = true;
        els.overlayTitle.innerText = title;
        els.overlayDesc.innerText = desc;
        els.overlay.classList.remove('hidden');
    }

    /* ===========================
       6. BOT INTELLIGENCE
       =========================== */
    function startBot() {
        setInterval(() => {
            if (gameState.isGameOver) return;

            // Check all 4 bot piles
            for (let i = 0; i < 4; i++) {
                let pile = gameState.bot.foundations[i];
                if (pile.length > 0) {
                    let card = pile[pile.length - 1];
                    
                    // Try Left
                    if (isValidMove(card, gameState.centerLeft)) {
                        playCard('bot', i, 'left');
                        return; // Play one card at a time
                    }
                    // Try Right
                    if (isValidMove(card, gameState.centerRight)) {
                        playCard('bot', i, 'right');
                        return;
                    }
                }
            }
        }, botSpeed); // Bot Speed determined by settings
    }

    /* ===========================
       7. STALEMATE HANDLER
       =========================== */
    // If no one moves for 5 seconds, flip new cards
    let lastMoveTime = Date.now();
    
    // Hook into playCard to reset timer
    const originalPlayCard = playCard;
    playCard = function(who, pileIndex, whichCenter) {
        lastMoveTime = Date.now();
        originalPlayCard(who, pileIndex, whichCenter);
    };

    function checkStalemateLoop() {
        setInterval(() => {
            if (gameState.isGameOver) return;
            
            // Logic: Is there ANY valid move for Player or Bot?
            let moveExists = false;
            
            // Check Player moves
            gameState.player.foundations.forEach(p => {
                if(p.length > 0) {
                    let c = p[p.length-1];
                    if(isValidMove(c, gameState.centerLeft) || isValidMove(c, gameState.centerRight)) moveExists = true;
                }
            });

            // Check Bot moves
            gameState.bot.foundations.forEach(p => {
                if(p.length > 0) {
                    let c = p[p.length-1];
                    if(isValidMove(c, gameState.centerLeft) || isValidMove(c, gameState.centerRight)) moveExists = true;
                }
            });

            // If no moves exist, we MUST flip.
            // Also flip if players are just slow (5 seconds inactivity)
            if (!moveExists || (Date.now() - lastMoveTime > 5000)) {
                performStalemateFlip();
                lastMoveTime = Date.now();
            }

        }, 1000);
    }

    function performStalemateFlip() {
        // Visual indicator (optional)
        console.log("Stalemate! Flipping...");
        
        let pCard = null;
        let bCard = null;

        // Pull from Draw Decks
        if (gameState.player.drawDeck.length > 0) pCard = gameState.player.drawDeck.pop();
        if (gameState.bot.drawDeck.length > 0) bCard = gameState.bot.drawDeck.pop();

        // If Draw Decks empty, recycle center piles (Basic logic for now: Shuffle center to draw)
        if (!pCard && !bCard) {
            // Ideally shuffle center back, but for MVP we just declare Draw or Reset
            // For now, let's assume game ends or simple reload if decks run dry
            // A simple shuffle logic could go here.
        }

        if (pCard) gameState.centerLeft = pCard;
        if (bCard) gameState.centerRight = bCard;
        
        renderBoard();
    }

    // Start Everything
    initGame();
});
