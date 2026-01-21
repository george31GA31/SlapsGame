document.addEventListener('DOMContentLoaded', () => {
    
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    
    // === CONFIG ===
    let difficultyLevel = parseInt(localStorage.getItem('slapsDifficulty')) || 5;
    // Speed calculation: Level 1 = 3200ms, Level 10 = 500ms
    let botSpeed = Math.max(500, 3500 - (difficultyLevel * 300));
    
    const botNames = ["ROOKIE", "NOVICE", "AMATEUR", "INTERMEDIATE", "SKILLED", "GOOD", "ADVANCED", "PROVEN", "MASTER", "UNBEATABLE"];
    document.getElementById('bot-name-display').innerText = botNames[difficultyLevel - 1];

    let gameState = {
        player: { drawDeck: [], foundations: [[], [], [], []] },
        bot: { drawDeck: [], foundations: [[], [], [], []] },
        centerLeft: null,
        centerRight: null,
        isGameOver: false
    };

    // === DOM ELEMENTS ===
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
        }

        getHTML() {
            return `
            <div class="playing-card" id="${this.id}" style="color: ${this.color === 'red' ? '#d9534f' : '#292b2c'}">
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

    // === INITIALIZATION ===
    function initGame() {
        let fullDeck = shuffle(createDeck());
        let pHand = fullDeck.slice(0, 26);
        let bHand = fullDeck.slice(26, 52);

        distribute(pHand, gameState.player);
        distribute(bHand, gameState.bot);

        // Initial Flip
        if(gameState.player.drawDeck.length > 0) gameState.centerLeft = gameState.player.drawDeck.pop();
        if(gameState.bot.drawDeck.length > 0) gameState.centerRight = gameState.bot.drawDeck.pop();

        renderBoard();
        startBot();
        checkStalemateLoop();
    }

    function distribute(hand, entity) {
        entity.foundations[0] = hand.splice(0, 4);
        entity.foundations[1] = hand.splice(0, 3);
        entity.foundations[2] = hand.splice(0, 2);
        entity.foundations[3] = hand.splice(0, 1);
        entity.drawDeck = hand;
    }

    // === RENDER ===
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
                
                // Add Drag Listener
                const cardEl = slot.querySelector('.playing-card');
                setupDragEvents(cardEl, card, index);

                addBadge(slot, pile.length);
            }
        });

        // Render Bot
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
            let div = element.querySelector('.playing-card');
            div.style.cursor = 'default'; 
            div.style.position = 'relative'; 
        }
    }

    function addBadge(slot, count) {
        let badge = document.createElement('div');
        badge.className = 'card-count-badge';
        badge.innerText = count;
        slot.appendChild(badge);
    }

    // === DRAG & DROP ===
    function setupDragEvents(element, cardObj, pileIndex) {
        let isDragging = false;
        let startX, startY;

        element.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (gameState.isGameOver) return;
            
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

    // === RULES ===
    function isValidMove(card, centerCard) {
        if (!centerCard) return false;
        const diff = Math.abs(card.rank - centerCard.rank);
        return (diff === 1 || diff === 12); // Covers King-Ace loop
    }

    function playCard(who, pileIndex, whichCenter) {
        let card;
        if (who === 'player') card = gameState.player.foundations[pileIndex].pop();
        else card = gameState.bot.foundations[pileIndex].pop();

        if (whichCenter === 'left') gameState.centerLeft = card;
        else gameState.centerRight = card;

        renderBoard();
    }

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

    // === BOT LOGIC ===
    function startBot() {
        setInterval(() => {
            if (gameState.isGameOver) return;
            for (let i = 0; i < 4; i++) {
                let pile = gameState.bot.foundations[i];
                if (pile.length > 0) {
                    let card = pile[pile.length - 1];
                    if (isValidMove(card, gameState.centerLeft)) {
                        playCard('bot', i, 'left');
                        return;
                    }
                    if (isValidMove(card, gameState.centerRight)) {
                        playCard('bot', i, 'right');
                        return;
                    }
                }
            }
        }, botSpeed);
    }

    // === STALEMATE CHECK ===
    let lastMoveState = "";
    function checkStalemateLoop() {
        setInterval(() => {
            if (gameState.isGameOver) return;
            
            let currentTopCards = "";
            if(gameState.centerLeft) currentTopCards += gameState.centerLeft.id;
            if(gameState.centerRight) currentTopCards += gameState.centerRight.id;

            if(currentTopCards === lastMoveState) {
                // Check if any moves exist at all
                let movesPossible = false;
                [...gameState.player.foundations, ...gameState.bot.foundations].forEach(pile => {
                    if(pile.length > 0) {
                        let c = pile[pile.length-1];
                        if(isValidMove(c, gameState.centerLeft) || isValidMove(c, gameState.centerRight)) movesPossible = true;
                    }
                });

                if(!movesPossible) {
                    console.log("Stalemate detected. Flipping.");
                    performStalemateFlip();
                }
            }
            lastMoveState = currentTopCards;
        }, 3000); 
    }

    function performStalemateFlip() {
        if (gameState.player.drawDeck.length > 0) gameState.centerLeft = gameState.player.drawDeck.pop();
        if (gameState.bot.drawDeck.length > 0) gameState.centerRight = gameState.bot.drawDeck.pop();
        
        if (!gameState.player.drawDeck.length && !gameState.bot.drawDeck.length) {
           // If decks run dry, simple reset for this version
           // In full version, you'd shuffle center pile
        }
        renderBoard();
    }

    initGame();
});
