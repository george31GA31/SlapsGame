document.addEventListener('DOMContentLoaded', () => {
    
    // CONFIG
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;
    
    // Level 1 (~6000ms) to Level 10 (~1000ms)
    // Formula: 6500 - (diff * 550)
    // Lvl 1 = 5950ms. Lvl 10 = 1000ms.
    let botSpeed = Math.max(800, 6500 - (difficulty * 550));
    // Add randomness (+/- 10%)
    const getBotDelay = () => botSpeed + (Math.random() * (botSpeed * 0.2));

    // STATE
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

    // ANIMATION HELPER
    function flyCard(cardEl, targetEl, callback) {
        if(!cardEl || !targetEl) { callback(); return; }
        const startRect = cardEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();

        const clone = cardEl.cloneNode(true);
        clone.classList.add('flying-card');
        clone.style.left = startRect.left + 'px';
        clone.style.top = startRect.top + 'px';
        clone.style.width = startRect.width + 'px';
        clone.style.height = startRect.height + 'px';
        
        document.body.appendChild(clone);
        
        // Force Reflow
        void clone.offsetWidth;

        clone.style.left = targetRect.left + 'px';
        clone.style.top = targetRect.top + 'px';

        setTimeout(() => {
            clone.remove();
            callback();
        }, 500); // Matches CSS transition time
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
        startBot();
        setInterval(updateStats, 500);
    }

    function createDeck() {
        return SUITS.flatMap(s => VALUES.map(v => new Card(s, v))).sort(() => Math.random() - 0.5);
    }

    function spawnFoundation(cards, owner) {
        // Spread cards out more since box is bigger
        let xOffsets = [50, 250, 450, 650]; 
        let pileSizes = [4, 3, 2, 1];
        let cardIdx = 0;

        for(let col=0; col<4; col++) {
            for(let row=0; row<pileSizes[col]; row++) {
                if(cardIdx >= cards.length) break;
                let c = cards[cardIdx++];
                c.owner = owner;
                c.x = xOffsets[col];
                c.y = 20 + (row * 30); // More vertical space
                if(row === pileSizes[col]-1) c.isFaceUp = true;
                
                if(owner === 'player') gameState.player.cards.push(c);
                else gameState.bot.cards.push(c);
            }
        }
    }

    function renderAll() {
        renderZone('player');
        renderZone('bot');
        renderCenter(els.cLeft, gameState.centerLeft);
        renderCenter(els.cRight, gameState.centerRight);
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
            card.isFaceUp = true; 
            card.x = 0; card.y = 0;
            el.innerHTML = card.getHTML();
            const div = el.querySelector('.playing-card');
            div.style.position = 'relative'; 
            div.style.left = '0'; div.style.top = '0';
        }
    }

    function setupInteraction(el, card) {
        el.addEventListener('mousedown', (e) => {
            if(e.button !== 0) return; 
            if(!card.isFaceUp) {
                const liveCount = gameState.player.cards.filter(c => c.isFaceUp).length;
                if(liveCount < 4) {
                    card.isFaceUp = true;
                    renderZone('player');
                }
                return; 
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
        
        el.style.zIndex = 1000;
        
        // BOUNDARY RECT
        const box = els.pBoundary.getBoundingClientRect();
        const cardW = 90; 
        const cardH = 126;

        function move(e) {
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;
            let newLeft = origLeft + dx;
            let newTop = origTop + dy;
            
            // Check if card is currently hovering over a valid target
            // If valid target hover, allow free movement.
            // If NOT over valid target, CLAMP inside box.
            
            const isTargeting = (isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) ||
                                (isOver(e, els.cRight) && isValid(card, gameState.centerRight));

            if (!isTargeting) {
                // CLAMP LOGIC (The "Physical Wall")
                // Convert CSS Left/Top (relative to box) to Screen Coords to check bounds?
                // Actually easier: constrain the CSS Left/Top values 
                // Box width is 900, height 250.
                newLeft = Math.max(0, Math.min(newLeft, 900 - cardW));
                newTop = Math.max(0, Math.min(newTop, 250 - cardH));
            }

            el.style.left = newLeft + 'px';
            el.style.top = newTop + 'px';
        }

        function drop(e) {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', drop);
            
            if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) {
                playCard(card, 'left');
            } else if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) {
                playCard(card, 'right');
            } else {
                // Save new position inside box
                card.x = parseInt(el.style.left);
                card.y = parseInt(el.style.top);
                el.style.zIndex = 10;
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
        gameState.player.cards = gameState.player.cards.filter(c => c.id !== card.id);
        if(side === 'left') gameState.centerLeft = card;
        else gameState.centerRight = card;
        renderAll();
        checkWin();
    }

    function startBot() {
        function botLoop() {
            if(gameState.gameOver) return;

            // Flip Logic
            const live = gameState.bot.cards.filter(c => c.isFaceUp).length;
            if(live < 4) {
                const hidden = gameState.bot.cards.find(c => !c.isFaceUp);
                if(hidden) { hidden.isFaceUp = true; renderZone('bot'); }
            }

            // Move Logic
            const playable = gameState.bot.cards.filter(c => c.isFaceUp);
            let move = null;
            
            for(let c of playable) {
                if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
                if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
            }

            if(move) {
                // Find element to animate
                // We need to find the DOM element corresponding to this card ID
                // Since we redraw every time, we look inside bBoundary
                let allBotEls = Array.from(els.bBoundary.children);
                // The renderZone order matches the array order
                let index = gameState.bot.cards.indexOf(move.card);
                let cardEl = allBotEls[index];
                
                let targetEl = move.side === 'left' ? els.cLeft : els.cRight;

                // Animate
                flyCard(cardEl, targetEl, () => {
                    gameState.bot.cards = gameState.bot.cards.filter(c => c.id !== move.card.id);
                    if(move.side === 'left') gameState.centerLeft = move.card;
                    else gameState.centerRight = move.card;
                    renderAll();
                    checkWin();
                });
            }

            // Next Move Delay
            setTimeout(botLoop, getBotDelay());
        }
        setTimeout(botLoop, getBotDelay());
    }

    function updateStats() {
        let pTotal = gameState.player.deck.length + gameState.player.cards.length;
        let bTotal = gameState.bot.deck.length + gameState.bot.cards.length;
        els.pCount.innerText = pTotal;
        els.bCount.innerText = bTotal;
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
