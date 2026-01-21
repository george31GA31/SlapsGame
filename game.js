document.addEventListener('DOMContentLoaded', () => {
    
    // === CONFIGURATION ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;

    // AI TUNING
    // Higher difficulty = Lower delay
    const getAiDelay = () => {
        let base = 3000 - (difficulty * 250); // Lvl 5 = 1750ms
        return Math.max(600, base + Math.random() * 500);
    };

    let globalZ = 100;
    let botBusy = false; 
    let isPlayerDragging = false; 
    let lastActionTime = 0;

    let gameState = {
        player: { deck: [], cards: [], sidePot: [], borrowing: false },
        bot: { deck: [], cards: [], sidePot: [], borrowing: false },
        centerLeft: null, centerRight: null,
        centerStack: [], 
        gameOver: false,
        playerPass: false, botPass: false,
        isCountDown: false,
        slapActive: false,
        scores: { pRounds: 0, bRounds: 0, pSlaps: 0, bSlaps: 0 }
    };

    const els = {
        pBoundary: document.getElementById('player-boundary'),
        bBoundary: document.getElementById('bot-boundary'),
        cLeft: document.getElementById('center-left'),
        cRight: document.getElementById('center-right'),
        pCount: document.getElementById('player-count'),
        bCount: document.getElementById('bot-count'),
        overlay: document.getElementById('game-overlay'),
        pDeck: document.getElementById('player-draw-deck'),
        bDeck: document.getElementById('bot-draw-deck'),
        pDeckText: document.getElementById('player-deck-text'),
        bDeckText: document.getElementById('bot-deck-text'),
        pBorrow: document.getElementById('player-borrow-label'),
        bBorrow: document.getElementById('bot-borrow-label'),
        overlayTitle: document.getElementById('overlay-title'),
        overlayDesc: document.getElementById('overlay-desc'),
        btnAction: document.getElementById('btn-action'),
        slapAlert: document.getElementById('slap-alert'),
        sPRounds: document.getElementById('p-rounds'),
        sBRounds: document.getElementById('b-rounds'),
        sPSlaps: document.getElementById('p-slaps'),
        sBSlaps: document.getElementById('b-slaps')
    };

    // Global Listeners
    document.addEventListener('mousedown', () => isPlayerDragging = true);
    document.addEventListener('mouseup', () => isPlayerDragging = false);
    
    // Slap Listener
    window.addEventListener('keydown', (e) => {
        if(e.code === 'Space' && !gameState.gameOver && !gameState.isCountDown) {
            e.preventDefault(); 
            performSlap('player');
        }
    });

    class Card {
        constructor(suit, value, owner) {
            this.suit = suit; this.value = value;
            this.rank = VALUES.indexOf(value) + 1; // 1-13
            this.color = (suit === "♥" || suit === "♦") ? "red" : "black";
            this.id = Math.random().toString(36).substr(2, 9);
            this.owner = owner; 
            this.isFaceUp = false;
            this.x = 0; this.y = 0; this.col = -1;
        }
        getHTML() {
            const faceClass = this.isFaceUp ? '' : 'face-down';
            return `<div class="playing-card ${faceClass}" id="${this.id}" style="color: ${this.color === 'red' ? '#d9534f' : '#292b2c'}; left:${this.x}px; top:${this.y}px;">
                <div class="card-top">${this.value}</div><div class="card-mid">${this.suit}</div><div class="card-bot">${this.value}</div>
            </div>`;
        }
    }

    function flyCard(card, targetEl, callback) {
        if(!card || !targetEl) { callback(); return; }
        
        let startLeft = 0, startTop = 0;
        let cardEl = document.getElementById(card.id);

        if (cardEl) {
            const rect = cardEl.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            cardEl.style.visibility = 'hidden'; 
        } else {
            // Fallback if visual is missing: Start from deck center
            const boundary = card.owner === 'player' ? els.pDeck : els.bDeck;
            const bRect = boundary.getBoundingClientRect();
            startLeft = bRect.left; startTop = bRect.top;
        }

        const targetRect = targetEl.getBoundingClientRect();
        
        const clone = document.createElement('div');
        clone.className = `playing-card flying-card`;
        clone.style.width = '110px'; clone.style.height = '154px';
        clone.style.left = startLeft + 'px'; clone.style.top = startTop + 'px';
        clone.style.color = card.color === 'red' ? '#d9534f' : '#292b2c';
        clone.innerHTML = `<div class="card-top">${card.value}</div><div class="card-mid">${card.suit}</div><div class="card-bot">${card.value}</div>`;
        clone.style.zIndex = 99999;
        
        document.body.appendChild(clone);
        void clone.offsetWidth; // Force Reflow

        // Animation
        let dist = Math.hypot(targetRect.left - startLeft, targetRect.top - startTop);
        let duration = Math.max(300, dist * 0.6); // Fast but smooth

        clone.style.transition = `all ${duration}ms ease-out`;
        clone.style.left = targetRect.left + 'px'; 
        clone.style.top = targetRect.top + 'px';

        setTimeout(() => { 
            clone.remove(); 
            callback(); 
        }, duration); 
    }

    function init() {
        startRoundWithCounts(26, 26);
    }

    function startRoundWithCounts(pCount, bCount) {
        // Init Cards
        let fullCards = SUITS.flatMap(s => VALUES.map(v => new Card(s, v, ""))).sort(() => Math.random() - 0.5);
        fullCards.forEach((c, i) => { c.owner = (i < pCount) ? 'player' : 'bot'; });

        let pDeck = fullCards.slice(0, pCount);
        let bDeck = fullCards.slice(pCount);

        gameState.player.cards = []; gameState.bot.cards = [];
        gameState.centerStack = []; gameState.centerLeft = null; gameState.centerRight = null;
        gameState.player.sidePot = []; gameState.bot.sidePot = [];
        gameState.gameOver = false; gameState.playerPass = false; gameState.botPass = false;
        gameState.slapActive = false; gameState.isCountDown = false; botBusy = false;

        els.overlay.classList.add('hidden');
        resetStalemateVisuals();

        // Foundation Logic
        let pPattern = getPattern(pDeck.length);
        let bPattern = getPattern(bDeck.length);
        
        const pFoundCards = pDeck.splice(0, pPattern.reduce((a,b)=>a+b, 0));
        const bFoundCards = bDeck.splice(0, bPattern.reduce((a,b)=>a+b, 0));

        spawnFoundation(pFoundCards, 'player', pPattern);
        spawnFoundation(bFoundCards, 'bot', bPattern);
        
        gameState.player.deck = pDeck;
        gameState.bot.deck = bDeck;

        renderAll();
        
        // DELAY START
        lastActionTime = Date.now() + 2000; 

        if (!window.masterLoopSet) {
            setInterval(botMasterLoop, 200); 
            setInterval(updateStats, 200); 
            setInterval(checkSlapOpportunity, 100); 
            setInterval(checkStalemateConditions, 800);
            window.masterLoopSet = true;
        }
    }

    function getPattern(count) {
        if(count >= 10) return [4,3,2,1];
        const patterns = { 9:[3,3,2,1], 8:[3,2,2,1], 7:[3,2,1,1], 6:[2,2,1,1], 5:[2,1,1,1], 4:[1,1,1,1], 3:[1,1,1], 2:[1,1], 1:[1] };
        return patterns[count] || [count];
    }

    function spawnFoundation(cards, owner, pattern) {
        let cardIdx = 0;
        let xOffsets = [50, 250, 450, 650];
        pattern.forEach((pileSize, colIndex) => {
            for(let i=0; i<pileSize; i++) {
                if(cardIdx < cards.length) {
                    let c = cards[cardIdx++];
                    c.owner = owner; c.col = colIndex;
                    c.x = xOffsets[colIndex]; c.y = 20 + (i * 30);
                    c.isFaceUp = (i === pileSize - 1); 
                    if(owner === 'player') gameState.player.cards.push(c); else gameState.bot.cards.push(c);
                }
            }
        });
    }

    function renderAll() {
        renderZone('player'); renderZone('bot');
        renderCenter(els.cLeft, gameState.centerLeft); 
        renderCenter(els.cRight, gameState.centerRight);
    }

    function renderZone(who) {
        // Prevent refresh while dragging to avoid "glitch drop"
        if(who === 'player' && isPlayerDragging) return;

        const container = who === 'player' ? els.pBoundary : els.bBoundary;
        const cards = who === 'player' ? gameState.player.cards : gameState.bot.cards;
        container.innerHTML = ''; 
        
        cards.forEach(c => {
            const el = document.createElement('div');
            const faceClass = c.isFaceUp ? '' : 'face-down';
            el.className = `playing-card ${faceClass}`;
            el.id = c.id;
            el.style.color = c.color === 'red' ? '#d9534f' : '#292b2c';
            el.style.left = `${c.x}px`; el.style.top = `${c.y}px`;
            el.innerHTML = `<div class="card-top">${c.value}</div><div class="card-mid">${c.suit}</div><div class="card-bot">${c.value}</div>`;
            el.style.zIndex = globalZ++; 
            container.appendChild(el);
            if(who === 'player') setupInteraction(el, c);
        });
    }

    function renderCenter(el, card) {
        el.innerHTML = '';
        if(card) {
            card.isFaceUp = true; 
            const centerEl = document.createElement('div');
            centerEl.className = 'playing-card';
            centerEl.style.color = card.color === 'red' ? '#d9534f' : '#292b2c';
            centerEl.innerHTML = `<div class="card-top">${card.value}</div><div class="card-mid">${card.suit}</div><div class="card-bot">${card.value}</div>`;
            centerEl.style.position = 'relative'; centerEl.style.left = '0'; centerEl.style.top = '0';
            el.appendChild(centerEl);
        }
    }

    function setupInteraction(el, card) {
        el.addEventListener('mousedown', (e) => { 
            if(e.button !== 0) return; 
            el.style.zIndex = ++globalZ; 
            startDrag(e, el, card); 
        });
    }

    function startDrag(e, el, card) {
        e.preventDefault();
        isPlayerDragging = true;
        let startX = e.clientX, startY = e.clientY;
        let dragged = false;

        function move(e) {
            if(Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) dragged = true;
            if(dragged) {
                let dx = e.clientX - startX;
                let dy = e.clientY - startY;
                // FREE MOVEMENT: No constraints, allows physics to feel natural
                el.style.transform = `translate(${dx}px, ${dy}px)`;
            }
        }

        function drop(e) {
            document.removeEventListener('mousemove', move); 
            document.removeEventListener('mouseup', drop);
            isPlayerDragging = false;
            el.style.transform = 'none'; // Reset visual transform

            if(dragged && card.isFaceUp) {
                // Check Drop Zones
                if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) { 
                    playCard(card, 'left'); 
                    return; 
                }
                if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) { 
                    playCard(card, 'right'); 
                    return; 
                }
            }
            
            // If invalid, Re-render handles snap back automatically
            renderZone('player'); 
        }
        document.addEventListener('mousemove', move); 
        document.addEventListener('mouseup', drop);
    }

    function isOver(e, target) {
        const r = target.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }

    function isValid(card, center) {
        // Can't play on empty center (must use deck)
        if(!center) return false; 
        let diff = Math.abs(card.rank - center.rank);
        return (diff === 1 || diff === 12); // 12 covers A vs K
    }

    function playCard(card, side) {
        // Logic Update
        gameState.player.cards = gameState.player.cards.filter(c => c.id !== card.id);
        
        if(side === 'left') {
            if(gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
            gameState.centerLeft = card;
        } else {
            if(gameState.centerRight) gameState.centerStack.push(gameState.centerRight);
            gameState.centerRight = card;
        }
        
        updateStats(); 
        resetStalemate(); 
        renderAll(); 
        checkWin();
    }

    function botMasterLoop() {
        if(gameState.gameOver || gameState.isCountDown || gameState.slapActive || botBusy) return;
        let now = Date.now();
        if(now - lastActionTime < getAiDelay()) return;

        // 1. Bot Play Logic
        let move = null;
        for(let c of gameState.bot.cards.filter(c => c.isFaceUp)) {
            if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
            if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
        }

        if(move) {
            botBusy = true; lastActionTime = now;
            let targetPile = (move.side === 'left' ? gameState.centerLeft : gameState.centerRight);
            let otherPile = (move.side === 'left' ? gameState.centerRight : gameState.centerLeft);
            
            // Reflex Boost if playing a Slap (e.g. laying a 9 on a 9)
            // Wait, standard slaps is playing ON TOP.
            // If I play a 9 on a 9, that's a slap.
            let reactionMod = 1.0;
            if (targetPile && targetPile.rank === move.card.rank) reactionMod = 0.1;

            setTimeout(() => {
                flyCard(move.card, (move.side==='left'?els.cLeft:els.cRight), () => {
                    // Re-validate in case player moved first
                    let current = move.side === 'left' ? gameState.centerLeft : gameState.centerRight;
                    if(!isValid(move.card, current)) { 
                        botBusy = false; renderZone('bot'); return; 
                    }

                    gameState.bot.cards = gameState.bot.cards.filter(c => c.id !== move.card.id);
                    if(move.side === 'left') {
                        if(gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
                        gameState.centerLeft = move.card;
                    } else {
                        if(gameState.centerRight) gameState.centerStack.push(gameState.centerRight);
                        gameState.centerRight = move.card;
                    }
                    
                    updateStats(); resetStalemate(); renderAll(); checkWin(); botBusy = false;
                });
            }, 50 * reactionMod);
            return;
        }

        // 2. Bot Flip Logic
        if(gameState.bot.cards.filter(c => c.isFaceUp).length < 4) {
            const hidden = gameState.bot.cards.find(c => !c.isFaceUp);
            if(hidden) {
                botBusy = true;
                setTimeout(() => { 
                    hidden.isFaceUp = true; 
                    resetStalemate(); renderZone('bot'); 
                    botBusy = false; lastActionTime = now; 
                }, 300);
            }
        }
    }

    function checkSlapOpportunity() {
        if(gameState.gameOver || gameState.isCountDown || gameState.slapActive) return;
        if(!gameState.centerLeft || !gameState.centerRight) return;
        
        // MATCHING RANKS = SLAP
        if(gameState.centerLeft.rank === gameState.centerRight.rank) {
            if(!gameState.slapActive) {
                let reactionBase = 2000 - (difficulty * 180);
                setTimeout(() => performSlap('bot'), Math.max(100, reactionBase + Math.random()*200));
            }
        }
    }

    function performSlap(who) {
        if(gameState.slapActive) return;
        if(!gameState.centerLeft || !gameState.centerRight) return;
        if(gameState.centerLeft.rank !== gameState.centerRight.rank) return;

        gameState.slapActive = true;
        let loser = (who === 'player') ? 'bot' : 'player';
        
        els.slapAlert.innerText = (who === 'player' ? "PLAYER 1 SLAPS WON!" : "AI SLAPS WON!");
        els.slapAlert.style.display = 'block';
        setTimeout(() => { els.slapAlert.style.display = 'none'; }, 1500);

        if(who === 'player') gameState.scores.pSlaps++; else gameState.scores.bSlaps++;
        updateScoreboard();

        let wonCards = [...gameState.centerStack, gameState.centerLeft, gameState.centerRight];
        wonCards.forEach(c => c.owner = loser);
        
        // Add to sidepot
        if(loser === 'player') gameState.player.sidePot.push(...wonCards);
        else gameState.bot.sidePot.push(...wonCards);

        gameState.centerLeft = null; gameState.centerRight = null; gameState.centerStack = [];
        
        renderAll(); updateStats();
        setTimeout(() => { gameState.slapActive = false; resetStalemate(); }, 1000);
    }

    // Force Start on Empty Board
    els.pDeck.addEventListener('click', () => {
        if(gameState.isCountDown || gameState.gameOver) return;
        const isStart = !gameState.centerLeft && !gameState.centerRight;
        if(!gameState.playerPass) {
            gameState.playerPass = true;
            els.pDeck.classList.add('waiting');
            els.pDeckText.innerText = "WAIT";
            if(gameState.botPass || isStart) startCountdown();
        } 
    });

    function checkStalemateConditions() {
        if(gameState.isCountDown || gameState.gameOver || gameState.slapActive || botBusy) return;
        let bMoves = gameState.bot.cards.some(c => c.isFaceUp && (isValid(c, gameState.centerLeft) || isValid(c, gameState.centerRight)));
        let bFlips = gameState.bot.cards.filter(c => c.isFaceUp).length < 4 && gameState.bot.cards.some(c => !c.isFaceUp);
        
        if(!bMoves && !bFlips) { 
            if(!gameState.botPass) { 
                gameState.botPass = true; 
                if(gameState.playerPass) startCountdown(); 
            } 
        } else { 
            gameState.botPass = false; 
        }
    }

    function startCountdown() {
        gameState.isCountDown = true;
        let count = 3;
        els.pDeck.classList.remove('waiting'); els.pDeck.classList.add('counting'); els.bDeck.classList.add('counting');
        const timer = setInterval(() => {
            els.pDeckText.innerText = count; els.bDeckText.innerText = count;
            if(count-- <= 0) { clearInterval(timer); executeReveal(); }
        }, 800);
    }

    function executeReveal() {
        if(gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
        if(gameState.centerRight) gameState.centerStack.push(gameState.centerRight);
        if(isPlayerDragging) { isPlayerDragging = false; renderZone('player'); }

        let pPop = gameState.player.deck.pop();
        let bPop = gameState.bot.deck.pop();

        // Borrow Logic
        if(!pPop && gameState.bot.deck.length > 0) pPop = gameState.bot.deck.pop();
        if(!bPop && gameState.player.deck.length > 0) bPop = gameState.player.deck.pop();

        if(pPop) gameState.centerRight = pPop; 
        if(bPop) gameState.centerLeft = bPop;
        
        resetStalemateVisuals(); renderAll(); updateStats();
    }

    function resetStalemateVisuals() {
        els.pDeck.classList.remove('waiting', 'counting'); els.bDeck.classList.remove('counting');
        els.pDeckText.innerText = "Start"; els.bDeckText.innerText = "";
        gameState.isCountDown = false; gameState.playerPass = false; gameState.botPass = false;
    }

    function updateStats() {
        // Robust Count
        const everyCard = [
            ...gameState.player.deck, ...gameState.player.cards, ...gameState.player.sidePot, 
            ...gameState.bot.deck, ...gameState.bot.cards, ...gameState.bot.sidePot, 
            ...gameState.centerStack, gameState.centerLeft, gameState.centerRight
        ].filter(c => c !== null);

        let pTotal = everyCard.filter(c => c.owner === 'player').length;
        let bTotal = everyCard.filter(c => c.owner === 'bot').length;

        els.pCount.innerText = pTotal;
        els.bCount.innerText = bTotal;

        els.pBorrow.classList.toggle('borrow-active', gameState.player.deck.length === 0 && pTotal <= 10);
        els.bBorrow.classList.toggle('borrow-active', gameState.bot.deck.length === 0 && bTotal <= 10);
    }
    
    function updateScoreboard() {
        els.sPRounds.innerText = gameState.scores.pRounds; els.sBRounds.innerText = gameState.scores.bRounds;
        els.sPSlaps.innerText = gameState.scores.pSlaps; els.sBSlaps.innerText = gameState.scores.bSlaps;
    }

    function checkWin() { if(gameState.player.cards.length === 0) endRound('player'); if(gameState.bot.cards.length === 0) endRound('bot'); }

    function endRound(winner) {
        if(gameState.gameOver) return; gameState.gameOver = true;
        updateStats();
        let pT = parseInt(els.pCount.innerText), bT = parseInt(els.bCount.innerText);
        if (pT <= 0 || bT <= 0) { endMatch(pT <= 0 ? "YOU WIN THE MATCH!" : "BOT WINS THE MATCH!"); return; }

        if(winner === 'player') gameState.scores.pRounds++; else gameState.scores.bRounds++;
        updateScoreboard();

        let pNext = (winner === 'player') ? pT : 52 - bT;
        els.overlayTitle.innerText = (winner === 'player') ? "ROUND WON!" : "ROUND LOST";
        els.overlay.classList.remove('hidden');
        els.btnAction.onclick = () => startRoundWithCounts(pNext, 52 - pNext);
    }

    function endMatch(msg) {
        els.overlayTitle.innerText = msg; els.overlayDesc.innerText = "GAME OVER";
        els.btnAction.innerText = "PLAY AGAIN"; els.btnAction.onclick = () => location.reload();
        els.overlay.classList.remove('hidden');
    }

    init();
});
