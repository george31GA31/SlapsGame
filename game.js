document.addEventListener('DOMContentLoaded', () => {
    
    // CONFIG
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;

    // AI SPEED: Level 1 (~6s), Level 10 (~1s)
    let botSpeedBase = 6500 - (difficulty * 550); 
    const getBotDelay = () => botSpeedBase + (Math.random() * 500);

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

    // === ANIMATION ENGINE ===
    function flyCard(cardEl, targetEl, callback) {
        if(!cardEl || !targetEl) { callback(); return; }
        const startRect = cardEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();

        // Ensure visible clone
        const clone = cardEl.cloneNode(true);
        // Force face up look on clone if it was face down
        if(clone.classList.contains('face-down')) {
            clone.classList.remove('face-down');
            // Re-inject HTML content if needed (simpler: assume browser handles styles)
        }
        
        clone.classList.add('flying-card');
        clone.style.left = startRect.left + 'px';
        clone.style.top = startRect.top + 'px';
        clone.style.width = '90px'; // Enforce size
        clone.style.height = '126px';
        
        document.body.appendChild(clone);
        
        // Force Reflow
        void clone.offsetWidth;

        clone.style.left = targetRect.left + 'px';
        clone.style.top = targetRect.top + 'px';

        setTimeout(() => {
            clone.remove();
            callback();
        }, 600);
    }

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

    // === INTERACTION ===
    function setupInteraction(el, card) {
        el.addEventListener('mousedown', (e) => {
            if(e.button !== 0) return; 
            
            // Logic: You can drag ANY card (face up or down).
            // But dragging a face-down card effectively just rearranges it 
            // because it will never be "Valid" for the center.
            
            startDrag(e, el, card);
        });
        
        // Handle double click or just click to flip separately if desired, 
        // but here we combine drag/flip.
        el.addEventListener('mouseup', (e) => {
             // Handle flip logic on click release if didn't drag far?
             // For now, let's keep flip strictly on valid drag drop or explicit click logic?
             // Implementing Click-to-Flip specifically:
             if(!card.isFaceUp && gameState.player.cards.filter(c => c.isFaceUp).length < 4) {
                 // Check if mouse didn't move much
                 // Simplified: Just flip it. Drag logic handles the rest.
             }
        });
    }

    function startDrag(e, el, card) {
        e.preventDefault();
        let startX = e.clientX, startY = e.clientY;
        let origX = card.x, origY = card.y;
        let dragged = false;
        
        el.style.zIndex = 1000;
        
        // BOUNDARY LIMITS (900x250 Box)
        const boxW = 900, boxH = 250, cardW = 90, cardH = 126;

        function move(e) {
            dragged = true;
            let dx = e.clientX - startX, dy = e.clientY - startY;
            let newX = origX + dx, newY = origY + dy;
            
            // CHECK TARGET
            const isTargetL = isOver(e, els.cLeft) && isValid(card, gameState.centerLeft);
            const isTargetR = isOver(e, els.cRight) && isValid(card, gameState.centerRight);
            const canLeave = (isTargetL || isTargetR) && card.isFaceUp; // Must be face up to play

            if (!canLeave) {
                // CLAMP: "Physical Wall"
                newX = Math.max(0, Math.min(newX, boxW - cardW));
                newY = Math.max(0, Math.min(newY, boxH - cardH));
            }

            el.style.left = newX + 'px';
            el.style.top = newY + 'px';
        }

        function drop(e) {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', drop);
            
            if(!dragged && !card.isFaceUp) {
                // Was a click to flip
                const liveCount = gameState.player.cards.filter(c => c.isFaceUp).length;
                if(liveCount < 4) {
                    card.isFaceUp = true;
                    renderZone('player');
                }
                return;
            }

            if(card.isFaceUp) {
                if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) { playCard(card, 'left'); return; }
                if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) { playCard(card, 'right'); return; }
            }
            
            // Just rearrange inside box
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

    // === BOT LOOP ===
    function runBotCycle() {
        if(gameState.gameOver) return;

        setTimeout(() => {
            // 1. Flip if needed
            const live = gameState.bot.cards.filter(c => c.isFaceUp);
            if(live.length < 4) {
                const hidden = gameState.bot.cards.find(c => !c.isFaceUp);
                if(hidden) { hidden.isFaceUp = true; renderZone('bot'); }
            }

            // 2. Check moves
            const playable = gameState.bot.cards.filter(c => c.isFaceUp);
            let move = null;
            for(let c of playable) {
                if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
                if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
            }

            if(move) {
                // Find visible element
                const botEls = Array.from(els.bBoundary.children);
                // We need to match the DOM element to the card object
                // Since we rerender often, index logic is safest if arrays stay synced
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
            }
            runBotCycle();
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
