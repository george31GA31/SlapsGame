document.addEventListener('DOMContentLoaded', () => {
    
    // CONFIG
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;
    let botSpeed = Math.max(800, 3000 - (difficulty * 250));

    // STATE
    let gameState = {
        player: { deck: [], cards: [] }, // cards = array of objects on board
        bot: { deck: [], cards: [] },
        centerLeft: null, centerRight: null,
        gameOver: false
    };

    // DOM
    const els = {
        pBoundary: document.getElementById('player-boundary'),
        bBoundary: document.getElementById('bot-boundary'),
        cLeft: document.getElementById('center-left'),
        cRight: document.getElementById('center-right'),
        pCount: document.getElementById('player-count'),
        bCount: document.getElementById('bot-count'),
        overlay: document.getElementById('game-overlay')
    };

    class Card {
        constructor(suit, value, owner) {
            this.suit = suit; this.value = value;
            this.rank = VALUES.indexOf(value) + 1;
            this.color = (suit === "♥" || suit === "♦") ? "red" : "black";
            this.id = Math.random().toString(36).substr(2, 9);
            this.owner = owner;
            this.isFaceUp = false; // Start face down
            this.x = 0; this.y = 0; // Physics coordinates
        }
        getHTML() {
            const faceClass = this.isFaceUp ? '' : 'face-down';
            return `<div class="playing-card ${faceClass}" id="${this.id}" style="color: ${this.color === 'red' ? '#d9534f' : '#292b2c'}; left:${this.x}px; top:${this.y}px;">
                <div class="card-top">${this.value}</div><div class="card-mid">${this.suit}</div><div class="card-bot">${this.value}</div>
            </div>`;
        }
    }

    function init() {
        let deck = createDeck();
        // Deal
        gameState.player.deck = deck.slice(0, 16);
        gameState.bot.deck = deck.slice(16, 32);
        
        // Foundations (10 cards each)
        let pFound = deck.slice(32, 42);
        let bFound = deck.slice(42, 52);
        
        spawnFoundation(pFound, 'player');
        spawnFoundation(bFound, 'bot');
        
        // Initial Centers
        if(gameState.player.deck.length) gameState.centerLeft = gameState.player.deck.pop();
        if(gameState.bot.deck.length) gameState.centerRight = gameState.bot.deck.pop();

        renderAll();
        startBot();
        setInterval(updateStats, 500);
    }

    function createDeck() {
        let d = SUITS.flatMap(s => VALUES.map(v => new Card(s, v)));
        return d.sort(() => Math.random() - 0.5);
    }

    function spawnFoundation(cards, owner) {
        // Organize nicely at start (4 piles of 4-3-2-1)
        let xOffsets = [50, 250, 450, 650]; // Neat columns
        let pileSizes = [4, 3, 2, 1];
        let cardIdx = 0;

        for(let col=0; col<4; col++) {
            for(let row=0; row<pileSizes[col]; row++) {
                if(cardIdx >= cards.length) break;
                let c = cards[cardIdx++];
                c.owner = owner;
                c.x = xOffsets[col];
                c.y = 20 + (row * 20); // Cascade down
                if(row === pileSizes[col]-1) c.isFaceUp = true; // Top card up
                
                if(owner === 'player') gameState.player.cards.push(c);
                else gameState.bot.cards.push(c);
            }
        }
    }

    // === RENDER ===
    function renderAll() {
        renderZone('player');
        renderZone('bot');
        renderCenter(els.cLeft, gameState.centerLeft);
        renderCenter(els.cRight, gameState.centerRight);
    }

    function renderZone(who) {
        const container = who === 'player' ? els.pBoundary : els.bBoundary;
        const cards = who === 'player' ? gameState.player.cards : gameState.bot.cards;
        container.innerHTML = ''; // Clear

        cards.forEach(c => {
            const div = document.createElement('div');
            div.innerHTML = c.getHTML();
            const el = div.firstElementChild;
            container.appendChild(el);

            if(who === 'player') setupInteraction(el, c);
        });
    }

    function renderCenter(el, card) {
        el.innerHTML = '';
        if(card) {
            card.isFaceUp = true; 
            card.x = 0; card.y = 0; // Reset physics for slot
            el.innerHTML = card.getHTML();
            const div = el.querySelector('.playing-card');
            div.style.position = 'relative'; // Slot mode
            div.style.left = '0'; div.style.top = '0';
        }
    }

    // === INTERACTION (PHYSICS & RULES) ===
    function setupInteraction(el, card) {
        // 1. FLIP LOGIC
        el.addEventListener('mousedown', (e) => {
            if(e.button !== 0) return; // Left click only
            if(!card.isFaceUp) {
                // Rule: "Cannot have more than 4 live cards"
                const liveCount = gameState.player.cards.filter(c => c.isFaceUp).length;
                if(liveCount < 4) {
                    card.isFaceUp = true;
                    renderZone('player');
                }
                return; // Don't drag if just flipping
            }
            startDrag(e, el, card);
        });
    }

    function startDrag(e, el, card) {
        e.preventDefault();
        let startX = e.clientX;
        let startY = e.clientY;
        let origLeft = card.x;
        let origTop = card.y;
        
        // Visual lift
        el.style.zIndex = 1000;
        
        function move(e) {
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;
            el.style.left = (origLeft + dx) + 'px';
            el.style.top = (origTop + dy) + 'px';
        }

        function drop(e) {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', drop);
            
            // Check Center Drop
            if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) {
                playCard(card, 'left');
            } else if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) {
                playCard(card, 'right');
            } else {
                // Check Boundary
                const box = els.pBoundary.getBoundingClientRect();
                const cardRect = el.getBoundingClientRect();
                
                // Logic: Is card inside box?
                const inside = (
                    cardRect.left >= box.left && 
                    cardRect.right <= box.right && 
                    cardRect.top >= box.top && 
                    cardRect.bottom <= box.bottom
                );

                if(inside) {
                    // Update physics to new position
                    card.x = parseInt(el.style.left);
                    card.y = parseInt(el.style.top);
                    el.style.zIndex = 10;
                } else {
                    // "Physically cannot leave boundary" -> Snap Back
                    el.style.left = origLeft + 'px';
                    el.style.top = origTop + 'px';
                    el.style.zIndex = 10;
                }
            }
        }
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', drop);
    }

    function isOver(e, target) {
        const r = target.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }

    function isValid(card, center) {
        if(!center) return false;
        let diff = Math.abs(card.rank - center.rank);
        return (diff === 1 || diff === 12);
    }

    function playCard(card, side) {
        // Remove from player array
        gameState.player.cards = gameState.player.cards.filter(c => c.id !== card.id);
        
        // Set to center
        if(side === 'left') gameState.centerLeft = card;
        else gameState.centerRight = card;
        
        renderAll();
        checkWin();
    }

    // === BOT ===
    function startBot() {
        setInterval(() => {
            if(gameState.gameOver) return;
            
            // Bot needs to flip?
            const live = gameState.bot.cards.filter(c => c.isFaceUp).length;
            if(live < 4) {
                const hidden = gameState.bot.cards.find(c => !c.isFaceUp);
                if(hidden) { hidden.isFaceUp = true; renderZone('bot'); return; }
            }

            // Find Move
            const playable = gameState.bot.cards.filter(c => c.isFaceUp);
            let move = null;
            
            for(let c of playable) {
                if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
                if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
            }

            if(move) {
                // Remove from bot array
                gameState.bot.cards = gameState.bot.cards.filter(c => c.id !== move.card.id);
                if(move.side === 'left') gameState.centerLeft = move.card;
                else gameState.centerRight = move.card;
                renderAll();
                checkWin();
            }

        }, botSpeed);
    }

    function updateStats() {
        let pTotal = gameState.player.deck.length + gameState.player.cards.length;
        let bTotal = gameState.bot.deck.length + gameState.bot.cards.length;
        els.pCount.innerText = pTotal;
        els.bCount.innerText = bTotal;
        
        // Stalemate Check (Simple Flip)
        // If neither can move for X seconds, logic would go here
        // For MVP: Randomly flip deck every 5s if stuck
    }

    function checkWin() {
        if(gameState.player.cards.length === 0 && gameState.player.deck.length === 0) {
            gameState.gameOver = true;
            document.querySelector('#overlay-title').innerText = "YOU WIN!";
            els.overlay.classList.remove('hidden');
        }
        if(gameState.bot.cards.length === 0 && gameState.bot.deck.length === 0) {
            gameState.gameOver = true;
            document.querySelector('#overlay-title').innerText = "BOT WINS!";
            els.overlay.classList.remove('hidden');
        }
    }

    init();
});
