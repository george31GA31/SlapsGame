document.addEventListener('DOMContentLoaded', () => {
    
    // === CONFIG ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;

    // AI Speed: Level 1 (~6s) -> Level 10 (~0.5s)
    let botSpeedBase = 6500 - (difficulty * 600); 
    const getBotDelay = () => Math.max(500, botSpeedBase + (Math.random() * 500));

    // Global Z-Index Counter (Ensures last moved card is always on top)
    let globalZ = 100;

    let gameState = {
        player: { deck: [], cards: [] },
        bot: { deck: [], cards: [] }, // AI cards now track 'col' property
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
            this.col = -1; // For AI organization
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

        const clone = cardEl.cloneNode(true);
        if(clone.classList.contains('face-down')) clone.classList.remove('face-down');
        
        clone.classList.add('flying-card');
        clone.style.left = startRect.left + 'px';
        clone.style.top = startRect.top + 'px';
        clone.style.zIndex = 99999; // Always on top of everything
        
        document.body.appendChild(clone);
        void clone.offsetWidth; // Force Reflow

        clone.style.left = targetRect.left + 'px';
        clone.style.top = targetRect.top + 'px';

        setTimeout(() => {
            clone.remove();
            callback();
        }, 600);
    }

    // === SETUP ===
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
        let xOffsets = [50, 250, 450, 650]; 
        let pileSizes = [4, 3, 2, 1];
        let cardIdx = 0;

        for(let col=0; col<4; col++) {
            for(let row=0; row<pileSizes[col]; row++) {
                if(cardIdx >= cards.length) break;
                let c = cards[cardIdx++];
                c.owner = owner;
                c.col = col; // Assign column for AI logic
                c.x = xOffsets[col]; 
                c.y = 20 + (row * 30);
                if(row === pileSizes[col]-1) c.isFaceUp = true;
                
                if(owner === 'player') gameState.player.cards.push(c);
                else gameState.bot.cards.push(c);
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
            
            // Interaction only for player
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

    // === PHYSICS & INTERACTION ===
    function setupInteraction(el, card) {
        el.addEventListener('mousedown', (e) => {
            if(e.button !== 0) return; 
            
            // Z-Index Fix: Always bring touched card to top
            el.style.zIndex = ++globalZ; 
            
            startDrag(e, el, card);
        });
    }

    function startDrag(e, el, card) {
        e.preventDefault();
        let startX = e.clientX, startY = e.clientY;
        let origX = card.x, origY = card.y;
        let dragged = false;

        // 1. DETERMINE IF CARD IS UNLOCKED
        // A card is "Playable" if it matches left OR right center piles.
        // If it is playable, the boundary wall is removed.
        const canLeft = isValid(card, gameState.centerLeft);
        const canRight = isValid(card, gameState.centerRight);
        const isUnlocked = (canLeft || canRight) && card.isFaceUp;

        const boxW = 900, boxH = 250, cardW = 90, cardH = 126;

        function move(e) {
            dragged = true;
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;
            let newX = origX + dx;
            let newY = origY + dy;

            // 2. APPLY WALL LOGIC
            if (!isUnlocked) {
                // If not playable, CLAMP strictly inside box
                newX = Math.max(0, Math.min(newX, boxW - cardW));
                newY = Math.max(0, Math.min(newY, boxH - cardH));
            }

            el.style.left = newX + 'px';
            el.style.top = newY + 'px';
        }

        function drop(e) {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', drop);
            
            // CLICK-TO-FLIP Logic
            if(!dragged && !card.isFaceUp) {
                const liveCount = gameState.player.cards.filter(c => c.isFaceUp).length;
                if(liveCount < 4) {
                    card.isFaceUp = true;
                    renderZone('player');
                }
                return;
            }

            // ATTEMPT PLAY
            if(card.isFaceUp) {
                if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) { playCard(card, 'left'); return; }
                if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) { playCard(card, 'right'); return; }
            }
            
            // SAVE POSITION (Rearranging)
            // Even if face down, we update position so you can organize your hand
            card.x = parseInt(el.style.left);
            card.y = parseInt(el.style.top);
            // Keep Z high so it stays on top of stack
            el.style.zIndex = globalZ; 
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

    // === SMART BOT LOGIC ===
    function runBotCycle() {
        if(gameState.gameOver) return;

        setTimeout(() => {
            // 1. Analyze Bot Columns
            // We group cards by their 'col' property (0,1,2,3)
            let columns = [[], [], [], []];
            gameState.bot.cards.forEach(c => {
                if(c.col >= 0 && c.col < 4) columns[c.col].push(c);
            });
            // Sort by Y (visual order)
            columns.forEach(col => col.sort((a,b) => a.y - b.y));

            // 2. Check for Moves
            let move = null;
            let playableCards = gameState.bot.cards.filter(c => c.isFaceUp);
            
            for(let c of playableCards) {
                if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
                if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
            }

            if(move) {
                // EXECUTE PLAY
                const botEls = Array.from(els.bBoundary.children);
                const idx = gameState.bot.cards.indexOf(move.card);
                const cardEl = botEls[idx];
                const targetEl = move.side === 'left' ? els.cLeft : els.cRight;

                flyCard(cardEl, targetEl, () => {
                    // Update State
                    gameState.bot.cards = gameState.bot.cards.filter(c => c.id !== move.card.id);
                    if(move.side === 'left') gameState.centerLeft = move.card; 
                    else gameState.centerRight = move.card;

                    // LOGIC: FLIP NEXT CARD IN THAT COLUMN
                    // We just removed a card from 'move.card.col'. 
                    // Find the NEW top card of that column.
                    let colCards = gameState.bot.cards.filter(c => c.col === move.card.col);
                    // Sort by Y position (highest Y is bottom of screen/top of stack)
                    colCards.sort((a,b) => a.y - b.y);
                    
                    if(colCards.length > 0) {
                        let newTop = colCards[colCards.length - 1]; // Last one is physically top
                        if(!newTop.isFaceUp) {
                            // Check live limit rule
                            const liveCount = gameState.bot.cards.filter(c => c.isFaceUp).length;
                            if(liveCount < 4) newTop.isFaceUp = true;
                        }
                    }

                    renderAll();
                    checkWin();
                });
            } else {
                // NO MOVES? TRY TO FILL GAPS
                // If a column is empty, move a card from a full column to it
                let emptyCol = columns.findIndex(c => c.length === 0);
                if(emptyCol !== -1) {
                    // Find a column with >1 card AND hidden cards (so moving helps)
                    let sourceCol = columns.findIndex(c => c.length > 1 && c.some(card => !card.isFaceUp));
                    if(sourceCol !== -1) {
                        let cardToMove = columns[sourceCol][columns[sourceCol].length - 1]; // Top card
                        if(cardToMove.isFaceUp) {
                            // Move it in data
                            cardToMove.col = emptyCol;
                            // Reset visual position for new column
                            let xOffsets = [50, 250, 450, 650];
                            cardToMove.x = xOffsets[emptyCol];
                            cardToMove.y = 20; // Top of new pile
                            
                            // Flip the card revealed in the OLD column
                            let oldColCards = columns[sourceCol];
                            // The one below the one we just moved
                            let revealedCard = oldColCards[oldColCards.length - 2]; 
                            if(revealedCard && !revealedCard.isFaceUp) revealedCard.isFaceUp = true;

                            renderAll();
                        }
                    }
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
