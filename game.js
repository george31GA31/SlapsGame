document.addEventListener('DOMContentLoaded', () => {
    
    // === 1. CONFIGURATION ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;

    // AI SPEED SETTINGS
    // Level 1: ~6.0s delay | Level 10: ~0.5s delay
    // Formula: Max Delay - (Level * Step)
    let botSpeedBase = 6500 - (difficulty * 600); 
    const getBotDelay = () => Math.max(500, botSpeedBase + (Math.random() * 500));

    let gameState = {
        player: { deck: [], cards: [] },
        bot: { deck: [], cards: [] },
        centerLeft: null, centerRight: null,
        gameOver: false
    };

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
            this.isFaceUp = false;
            this.x = 0; this.y = 0;
        }
        getHTML() {
            const faceClass = this.isFaceUp ? '' : 'face-down';
            return `<div class="playing-card ${faceClass}" id="${this.id}" style="color: ${this.color === 'red' ? '#d9534f' : '#292b2c'}; left:${this.x}px; top:${this.y}px;">
                <div class="card-top">${this.value}</div><div class="card-mid">${this.suit}</div><div class="card-bot">${this.value}</div>
            </div>`;
        }
    }

    // === 2. ANIMATION ENGINE ===
    function flyCard(cardEl, targetEl, callback) {
        if(!cardEl || !targetEl) { callback(); return; }
        const startRect = cardEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();

        const clone = cardEl.cloneNode(true);
        // Ensure clone looks face up if the AI is playing it
        if(clone.classList.contains('face-down')) {
            clone.classList.remove('face-down');
        }
        
        clone.classList.add('flying-card');
        clone.style.left = startRect.left + 'px';
        clone.style.top = startRect.top + 'px';
        clone.style.width = '90px'; 
        clone.style.height = '126px';
        
        document.body.appendChild(clone);
        
        // Force Reflow (Important for animation to trigger)
        void clone.offsetWidth;

        clone.style.left = targetRect.left + 'px';
        clone.style.top = targetRect.top + 'px';

        setTimeout(() => {
            clone.remove();
            callback();
        }, 600); // 0.6s duration
    }

    // === 3. SETUP ===
    function init() {
        let deck = createDeck();
        gameState.player.deck = deck.slice(0, 16);
        gameState.bot.deck = deck.slice(16, 32);
        spawnFoundation(deck.slice(32, 42), 'player');
        spawnFoundation(deck.slice(42, 52), 'bot');
        
        if(gameState.player.deck.length) gameState.centerLeft = gameState.player.deck.pop();
        if(gameState.bot.deck.length) gameState.centerRight = gameState.bot.deck.pop();

        renderAll();
        runBotCycle();
        setInterval(updateStats, 500);
    }

    function createDeck() { return SUITS.flatMap(s => VALUES.map(v => new Card(s, v))).sort(() => Math.random() - 0.5); }

    function spawnFoundation(cards, owner) {
        let xOffsets = [50, 250, 450, 650], pileSizes = [4, 3, 2, 1], cardIdx = 0;
        for(let col=0; col<4; col++) {
            for(let row=0; row<pileSizes[col]; row++) {
                if(cardIdx >= cards.length) break;
                let c = cards[cardIdx++];
                c.x = xOffsets[col]; c.y = 20 + (row * 30);
                if(row === pileSizes[col]-1) c.isFaceUp = true;
                (owner === 'player' ? gameState.player.cards : gameState.bot.cards).push(c);
            }
        }
    }

    function renderAll() {
        renderZone('player'); renderZone('bot');
        renderCenter(els.cLeft, gameState.centerLeft); renderCenter(els.cRight, gameState.centerRight);
    }

    function renderZone(who) {
        const container = who === 'player' ? els.pBoundary : els.bBoundary;
        const cards = who === 'player' ? gameState.player.cards : gameState.bot.cards;
        container.innerHTML = ''; 
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
            card.isFaceUp = true; card.x = 0; card.y = 0;
            el.innerHTML = card.getHTML();
            const div = el.querySelector('.playing-card');
            div.style.position = 'relative'; div.style.left = '0'; div.style.top = '0';
        }
    }

    // === 4. PHYSICS & RULES (The "Physical Wall") ===
    function setupInteraction(el, card) {
        el.addEventListener('mousedown', (e) => {
            if(e.button !== 0) return; 
            startDrag(e, el, card);
        });
    }

    function startDrag(e, el, card) {
        e.preventDefault();
        let startX = e.clientX, startY = e.clientY;
        let origX = card.x, origY = card.y;
        let wasDragged = false;
        
        el.style.zIndex = 1000;
        
        // A) PRE-CALCULATE IF PLAYABLE
        // If card matches center left OR right, it is allowed to leave the box.
        const matchesL = isValid(card, gameState.centerLeft);
        const matchesR = isValid(card, gameState.centerRight);
        const isPlayable = (matchesL || matchesR) && card.isFaceUp;

        // B) BOUNDARIES
        const boxW = 900; // Match CSS width
        const boxH = 250; // Match CSS height
        const cardW = 90;
        const cardH = 126;

        function move(e) {
            wasDragged = true;
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;
            let newX = origX + dx;
            let newY = origY + dy;
            
            // --- YOUR LOGIC IMPLEMENTED HERE ---
            if (!isPlayable) {
                // If not playable (wrong math or face down), CLAMP it strictly to the box.
                newX = Math.max(0, Math.min(newX, boxW - cardW));
                newY = Math.max(0, Math.min(newY, boxH - cardH));
            }
            // -----------------------------------

            el.style.left = newX + 'px';
            el.style.top = newY + 'px';
        }

        function drop(e) {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', drop);
            
            // Click-to-Flip Logic (if didn't drag much)
            if(!wasDragged && !card.isFaceUp) {
                const liveCount = gameState.player.cards.filter(c => c.isFaceUp).length;
                if(liveCount < 4) {
                    card.isFaceUp = true;
                    renderZone('player');
                }
                return;
            }

            // Drop Logic
            if(card.isFaceUp) {
                if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) { playCard(card, 'left'); return; }
                if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) { playCard(card, 'right'); return; }
            }
            
            // Save new position (Rearranging)
            card.x = parseInt(el.style.left);
            card.y = parseInt(el.style.top);
            el.style.zIndex = 10;
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
        gameState.player.cards = gameState.player.cards.filter(c => c.id !== card.id);
        if(side === 'left') gameState.centerLeft = card; else gameState.centerRight = card;
        renderAll();
        checkWin();
    }

    // === 5. BOT LOGIC ===
    function runBotCycle() {
        if(gameState.gameOver) return;

        setTimeout(() => {
            // Flip if needed
            const live = gameState.bot.cards.filter(c => c.isFaceUp);
            if(live.length < 4) {
                const hidden = gameState.bot.cards.find(c => !c.isFaceUp);
                if(hidden) { hidden.isFaceUp = true; renderZone('bot'); }
            }

            // Move
            const playable = gameState.bot.cards.filter(c => c.isFaceUp);
            let move = null;
            for(let c of playable) {
                if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
                if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
            }

            if(move) {
                const botEls = Array.from(els.bBoundary.children);
                // Find correct element by matching ID or Index
                // We use index here assuming renderZone order is stable
                const idx = gameState.bot.cards.indexOf(move.card);
                if(idx !== -1) {
                    const cardEl = botEls[idx];
                    const targetEl = move.side === 'left' ? els.cLeft : els.cRight;
                    
                    flyCard(cardEl, targetEl, () => {
                        gameState.bot.cards = gameState.bot.cards.filter(c => c.id !== move.card.id);
                        if(move.side === 'left') gameState.centerLeft = move.card; else gameState.centerRight = move.card;
                        renderAll();
                        checkWin();
                    });
                }
            } else {
                // If bot can't move, just loop again
                runBotCycle();
            }
        }, getBotDelay());
    }

    function updateStats() {
        els.pCount.innerText = gameState.player.deck.length + gameState.player.cards.length;
        els.bCount.innerText = gameState.bot.deck.length + gameState.bot.cards.length;
    }

    function checkWin() {
        if(gameState.player.cards.length === 0 && gameState.player.deck.length === 0) endGame("YOU WIN!");
        if(gameState.bot.cards.length === 0 && gameState.bot.deck.length === 0) endGame("BOT WINS!");
    }

    function endGame(msg) { gameState.gameOver = true; document.querySelector('#overlay-title').innerText = msg; els.overlay.classList.remove('hidden'); }

    init();
});
