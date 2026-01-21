document.addEventListener('DOMContentLoaded', () => {
    
    // === CONFIG & SETUP ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    
    let difficultyLevel = parseInt(localStorage.getItem('slapsDifficulty')) || 5;
    // Speed: High difficulty = Low delay (e.g. 800ms). Low difficulty = High delay (e.g., 2000ms)
    let botReactionTime = Math.max(600, 2500 - (difficultyLevel * 200));

    // Names based on level
    const botNames = ["ROOKIE", "NOVICE", "AMATEUR", "INTERMEDIATE", "SKILLED", "GOOD", "ADVANCED", "PROVEN", "MASTER", "UNBEATABLE"];
    document.getElementById('bot-name-display').innerText = botNames[difficultyLevel - 1];

    // THE GAME STATE
    let gameState = {
        player: { drawDeck: [], foundations: [[], [], [], []] },
        bot: { drawDeck: [], foundations: [[], [], [], []] },
        centerLeft: null,
        centerRight: null,
        isGameOver: false,
        slapLocked: false // "CheckLocks" from flowchart
    };

    // DOM ELEMENTS
    const els = {
        playerFoundations: [
            document.getElementById('player-found-4'),
            document.getElementById('player-found-3'),
            document.getElementById('player-found-2'),
            document.getElementById('player-found-1')
        ],
        botFoundations: [
            document.getElementById('bot-found-4'),
            document.getElementById('bot-found-3'),
            document.getElementById('bot-found-2'),
            document.getElementById('bot-found-1')
        ],
        centerLeft: document.getElementById('center-left'),
        centerRight: document.getElementById('center-right'),
        playerDeckCount: document.getElementById('player-deck-count'),
        botDeckCount: document.getElementById('bot-deck-count'),
        overlay: document.getElementById('game-overlay'),
        overlayTitle: document.getElementById('overlay-title'),
        overlayDesc: document.getElementById('overlay-desc')
    };

    // === CARD CLASS ===
    class Card {
        constructor(suit, value) {
            this.suit = suit;
            this.value = value;
            this.rank = VALUES.indexOf(value) + 1; // 1-13
            this.color = (suit === "♥" || suit === "♦") ? "red" : "black";
            this.id = Math.random().toString(36).substr(2, 9);
            this.isFaceUp = true; // New property for Flowchart logic
        }

        getHTML() {
            // If face down, add the class
            const faceClass = this.isFaceUp ? '' : 'face-down';
            return `
            <div class="playing-card ${faceClass}" id="${this.id}" style="color: ${this.color === 'red' ? '#d9534f' : '#292b2c'}">
                <div class="card-top">${this.value}</div>
                <div class="card-mid">${this.suit}</div>
                <div class="card-bot">${this.value}</div>
            </div>`;
        }
    }

    // === INIT GAME ===
    function initGame() {
        let fullDeck = shuffle(createDeck());
        let pHand = fullDeck.slice(0, 26);
        let bHand = fullDeck.slice(26, 52);

        distribute(pHand, gameState.player);
        distribute(bHand, gameState.bot);

        // Initial Flip from Draw Decks
        if(gameState.player.drawDeck.length > 0) gameState.centerLeft = gameState.player.drawDeck.pop();
        if(gameState.bot.drawDeck.length > 0) gameState.centerRight = gameState.bot.drawDeck.pop();

        renderBoard();
        startBotBrain(); // Starts the AI Loop
        checkStalemateLoop();
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

    function distribute(hand, entity) {
        // Distribute into 4 piles (4, 3, 2, 1)
        // LOGIC: Only the TOP card is Face Up initially.
        let piles = [4, 3, 2, 1];
        for(let i=0; i<4; i++) {
            let count = piles[i];
            let stack = hand.splice(0, count);
            
            // Set face up/down status
            stack.forEach((card, index) => {
                if(index === stack.length - 1) card.isFaceUp = true; // Top card visible
                else card.isFaceUp = false; // Cards underneath hidden
            });
            
            entity.foundations[i] = stack;
        }
        entity.drawDeck = hand;
    }

    // === AI BRAIN (THE FLOWCHART IMPLEMENTATION) ===
    function startBotBrain() {
        setInterval(() => {
            if (gameState.isGameOver || gameState.slapLocked) return;
            
            // 1. Analyze Board & Set Flags
            const aiCardsTotal = countTotalCards(gameState.bot);
            const playerCardsTotal = countTotalCards(gameState.player);
            
            // Flags
            const isDangerZone = aiCardsTotal < 5; // Low on cards?
            const isAggressive = difficultyLevel > 5; 
            const killerInstinct = difficultyLevel > 8;

            // 2. Scan Columns
            let possibleMoves = [];
            let flipMoveIndex = -1;
            let rearrangeMove = null;
            let emptySlotIndex = -1;

            // Find empty slot for rearranging
            gameState.bot.foundations.forEach((pile, i) => {
                if(pile.length === 0) emptySlotIndex = i;
            });

            // Scan Loop
            for (let i = 0; i < 4; i++) {
                let pile = gameState.bot.foundations[i];
                if (pile.length === 0) continue;

                let topCard = pile[pile.length - 1];

                // A) Top Card Face Down? -> Priority FLIP
                if (!topCard.isFaceUp) {
                    flipMoveIndex = i;
                    break; // High priority, stop scanning
                }

                // B) Top Card Face Up? -> Check Math
                let targets = [
                    { name: 'left', card: gameState.centerLeft },
                    { name: 'right', card: gameState.centerRight }
                ];

                targets.forEach(t => {
                    if (isValidMove(topCard, t.card)) {
                        // Risk Check: Does playing this help the Player?
                        // Example: Bot plays 5. Player has 4 or 6 ready.
                        let risk = isRiskyForBot(topCard.rank); 
                        possibleMoves.push({
                            pileIndex: i,
                            target: t.name,
                            isRisky: risk
                        });
                    }
                });

                // C) Check Rearrange (If card underneath is Face Down & Empty Col Exists)
                if (emptySlotIndex !== -1 && pile.length > 1) {
                    let cardUnder = pile[pile.length - 2];
                    if (!cardUnder.isFaceUp) {
                        rearrangeMove = { from: i, to: emptySlotIndex };
                    }
                }
            }

            // 3. Execute Decisions (Hierarchy)
            
            // PRIORITY 1: FLIP
            if (flipMoveIndex !== -1) {
                // Simulate "thinking" time for flip
                setTimeout(() => {
                    let pile = gameState.bot.foundations[flipMoveIndex];
                    if(pile.length > 0) pile[pile.length - 1].isFaceUp = true;
                    renderBoard();
                }, botReactionTime / 2);
                return;
            }

            // PRIORITY 2: PLAY SAFE
            let safeMove = possibleMoves.find(m => !m.isRisky);
            if (safeMove) {
                playCard('bot', safeMove.pileIndex, safeMove.target);
                return;
            }

            // PRIORITY 3: PLAY RISKY (If Aggressive or Killer)
            let riskyMove = possibleMoves.find(m => m.isRisky);
            if (riskyMove && (isAggressive || killerInstinct || isDangerZone)) {
                playCard('bot', riskyMove.pileIndex, riskyMove.target);
                return;
            }

            // PRIORITY 4: REARRANGE (Move card to empty slot to find hidden cards)
            if (rearrangeMove && difficultyLevel > 4) {
                let card = gameState.bot.foundations[rearrangeMove.from].pop();
                gameState.bot.foundations[rearrangeMove.to].push(card);
                renderBoard();
                return;
            }

            // PRIORITY 5: PASS (Do nothing, wait for stalemate flip)

        }, botReactionTime);
    }

    // Helper: Analyze Player's board to see if a move is risky
    function isRiskyForBot(rankToBePlayed) {
        // Look at player's top cards
        for(let i=0; i<4; i++) {
            let pPile = gameState.player.foundations[i];
            if(pPile.length > 0) {
                let pCard = pPile[pPile.length-1];
                if (pCard.isFaceUp) {
                    let diff = Math.abs(pCard.rank - rankToBePlayed);
                    // If player is +/- 1 away from the card Bot is about to play...
                    if (diff === 1 || diff === 12) return true; // It's Risky!
                }
            }
        }
        return false;
    }

    function countTotalCards(entity) {
        let count = entity.drawDeck.length;
        entity.foundations.forEach(f => count += f.length);
        return count;
    }

    // === GAME LOGIC & RENDER ===
    function renderBoard() {
        renderCenterPile(els.centerLeft, gameState.centerLeft);
        renderCenterPile(els.centerRight, gameState.centerRight);

        els.playerDeckCount.innerText = gameState.player.drawDeck.length;
        els.botDeckCount.innerText = gameState.bot.drawDeck.length;

        // Render Player
        gameState.player.foundations.forEach((pile, index) => {
            const slot = els.playerFoundations[index];
            slot.innerHTML = ''; 
            if (pile.length > 0) {
                let card = pile[pile.length - 1];
                slot.innerHTML = card.getHTML();
                
                // Allow drag ONLY if face up
                if (card.isFaceUp) {
                    const cardEl = slot.querySelector('.playing-card');
                    setupDragEvents(cardEl, card, index);
                } else {
                    // Click to flip
                    const cardEl = slot.querySelector('.playing-card');
                    cardEl.onclick = () => {
                        card.isFaceUp = true;
                        renderBoard();
                    };
                }
                addBadge(slot, pile.length);
            }
        });

        // Render Bot
        gameState.bot.foundations.forEach((pile, index) => {
            const slot = els.botFoundations[index];
            slot.innerHTML = '';
            if (pile.length > 0) {
                let card = pile[pile.length - 1];
                slot.innerHTML = card.getHTML(); // HTML handles face-down class
                addBadge(slot, pile.length);
            }
        });

        checkWinCondition();
    }

    function renderCenterPile(element, card) {
        element.innerHTML = '';
        if(card) {
            element.innerHTML = card.getHTML();
            let div = element.querySelector('.playing-card');
            if(div) {
                div.style.cursor = 'default'; 
                div.style.position = 'relative'; 
                div.classList.remove('face-down'); // Center cards always visible
            }
        }
    }

    function addBadge(slot, count) {
        let badge = document.createElement('div');
        badge.className = 'card-count-badge';
        badge.innerText = count;
        slot.appendChild(badge);
    }

    function isValidMove(card, centerCard) {
        if (!centerCard) return false;
        const diff = Math.abs(card.rank - centerCard.rank);
        return (diff === 1 || diff === 12);
    }

    function playCard(who, pileIndex, whichCenter) {
        let card;
        if (who === 'player') card = gameState.player.foundations[pileIndex].pop();
        else card = gameState.bot.foundations[pileIndex].pop();

        if (whichCenter === 'left') gameState.centerLeft = card;
        else gameState.centerRight = card;

        renderBoard();
    }

    // === DRAG & DROP ===
    function setupDragEvents(element, cardObj, pileIndex) {
        let isDragging = false;
        let startX, startY;

        element.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (gameState.isGameOver || !cardObj.isFaceUp) return;
            
            isDragging = true;
            element.style.zIndex = 1000;
            element.style.position = 'fixed'; 
            
            const rect = element.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;

            element.style.left = (e.clientX - startX) + 'px';
            element.style.top = (e.clientY - startY) + 'px';

            function onMouseMove(moveEvent) {
                if (!isDragging) return;
                element.style.left = (moveEvent.clientX - startX) + 'px';
                element.style.top = (moveEvent.clientY - startY) + 'px';
            }

            function onMouseUp(upEvent) {
                isDragging = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);

                // Check Drop
                if (isOverElement(upEvent, els.centerLeft) && isValidMove(cardObj, gameState.centerLeft)) {
                    playCard('player', pileIndex, 'left');
                } 
                else if (isOverElement(upEvent, els.centerRight) && isValidMove(cardObj, gameState.centerRight)) {
                    playCard('player', pileIndex, 'right');
                } 
                else {
                    renderBoard(); // Reset
                }
            }
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    function isOverElement(e, targetEl) {
        const rect = targetEl.getBoundingClientRect();
        return (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom);
    }

    // === WIN/LOSS & STALEMATE ===
    function checkWinCondition() {
        const pEmpty = gameState.player.foundations.every(p => p.length === 0);
        if (pEmpty && !gameState.isGameOver) endGame("VICTORY!", "You cleared your board!");

        const bEmpty = gameState.bot.foundations.every(p => p.length === 0);
        if (bEmpty && !gameState.isGameOver) endGame("DEFEAT", "The bot was faster.");
    }

    function endGame(title, desc) {
        gameState.isGameOver = true;
        els.overlayTitle.innerText = title;
        els.overlayDesc.innerText = desc;
        els.overlay.classList.remove('hidden');
    }

    let lastMoveState = "";
    function checkStalemateLoop() {
        setInterval(() => {
            if (gameState.isGameOver) return;
            
            let currentTopCards = "";
            if(gameState.centerLeft) currentTopCards += gameState.centerLeft.id;
            if(gameState.centerRight) currentTopCards += gameState.centerRight.id;

            if(currentTopCards === lastMoveState) {
                // If board hasn't changed in 3 seconds, flip new cards
                performStalemateFlip();
            }
            lastMoveState = currentTopCards;
        }, 3000); 
    }

    function performStalemateFlip() {
        let pCard = null, bCard = null;
        if (gameState.player.drawDeck.length > 0) pCard = gameState.player.drawDeck.pop();
        if (gameState.bot.drawDeck.length > 0) bCard = gameState.bot.drawDeck.pop();

        if(pCard) gameState.centerLeft = pCard;
        if(bCard) gameState.centerRight = bCard;
        
        renderBoard();
    }

    initGame();
});
