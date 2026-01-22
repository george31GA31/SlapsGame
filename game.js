document.addEventListener('DOMContentLoaded', () => {
    
    // === CONFIGURATION ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;

    // AI TUNING: "Spirit of SLAPS" (A.1.4) - Reflex-based but fair
    const getAiDelay = () => {
        let base = 3000 - (difficulty * 250); 
        return Math.max(600, base + Math.random() * 500);
    };

    let globalZ = 100;
    let botBusy = false; 
    let lastActionTime = 0;
    let draggedCardId = null; // Track ID instead of boolean for safety

    // GAME STATE
    let gameState = {
        player: { deck: [], cards: [], sidePot: [] },
        bot: { deck: [], cards: [], sidePot: [] },
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

    // --- SOUND & UI HELPERS ---
    window.addEventListener('keydown', (e) => {
        if(e.code === 'Space' && !gameState.gameOver && !gameState.isCountDown) {
            e.preventDefault(); 
            performSlap('player');
        }
    });

    // --- CARD CLASS ---
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
    }

    // --- SMART RENDERING ENGINE ---
    // Instead of deleting everything, we find cards and move them.
    // This creates the "CardGames.io" smooth feel.
    function renderAll() {
        renderZone('player'); 
        renderZone('bot');
        renderCenter(els.cLeft, gameState.centerLeft); 
        renderCenter(els.cRight, gameState.centerRight);
    }

    function renderZone(who) {
        const container = who === 'player' ? els.pBoundary : els.bBoundary;
        const cards = who === 'player' ? gameState.player.cards : gameState.bot.cards;
        
        // 1. Remove cards that are no longer in this zone
        Array.from(container.children).forEach(el => {
            if (!cards.find(c => c.id === el.id)) el.remove();
        });

        // 2. Update or Create cards
        cards.forEach(c => {
            // SKIP update if player is dragging THIS SPECIFIC card
            if (draggedCardId === c.id) return;

            let el = document.getElementById(c.id);
            const faceClass = c.isFaceUp ? '' : 'face-down';

            if (!el) {
                el = document.createElement('div');
                el.id = c.id;
                setupInteraction(el, c); // Add drag listeners
                container.appendChild(el);
            }

            // Update Class/Visuals
            el.className = `playing-card ${faceClass}`;
            el.style.color = c.color === 'red' ? '#d9534f' : '#292b2c';
            el.style.left = `${c.x}px`;
            el.style.top = `${c.y}px`;
            el.style.zIndex = c.isFaceUp ? 10 : 1; 
            
            // Only set HTML if needed (Performance)
            if(el.innerHTML === "") {
                el.innerHTML = `<div class="card-top">${c.value}</div><div class="card-mid">${c.suit}</div><div class="card-bot">${c.value}</div>`;
            }
        });
    }

    function renderCenter(el, card) {
        el.innerHTML = '';
        if(card) {
            // Create a temporary visual card for the center
            const centerEl = document.createElement('div');
            centerEl.className = 'playing-card';
            centerEl.style.color = card.color === 'red' ? '#d9534f' : '#292b2c';
            centerEl.innerHTML = `<div class="card-top">${card.value}</div><div class="card-mid">${card.suit}</div><div class="card-bot">${card.value}</div>`;
            centerEl.style.position = 'relative'; centerEl.style.left = '0'; centerEl.style.top = '0';
            el.appendChild(centerEl);
        }
    }

    // --- ANIMATION ---
    function flyCard(card, targetEl, callback) {
        if(!card || !targetEl) { callback(); return; }
        
        let startRect, cardEl = document.getElementById(card.id);
        
        if (cardEl) {
            startRect = cardEl.getBoundingClientRect();
            // Don't hide original yet, let the clone cover it for smoothness
        } else {
            // Fallback: Start from deck
            const boundary = card.owner === 'player' ? els.pDeck : els.bDeck;
            startRect = boundary.getBoundingClientRect();
        }

        const targetRect = targetEl.getBoundingClientRect();
        
        const clone = document.createElement('div');
        clone.className = `playing-card flying-card`;
        clone.style.width = '110px'; clone.style.height = '154px';
        clone.style.left = startRect.left + 'px'; clone.style.top = startRect.top + 'px';
        clone.style.color = card.color === 'red' ? '#d9534f' : '#292b2c';
        clone.innerHTML = `<div class="card-top">${card.value}</div><div class="card-mid">${card.suit}</div><div class="card-bot">${card.value}</div>`;
        clone.style.zIndex = 9999;
        
        document.body.appendChild(clone);
        void clone.offsetWidth; // Force Reflow

        // Hide original now that clone exists
        if(cardEl) cardEl.style.opacity = '0';

        // Calculate travel time based on distance (Rule of thumb: 1ms per pixel)
        let dist = Math.hypot(targetRect.left - startRect.left, targetRect.top - startRect.top);
        let duration = Math.max(250, dist * 0.7); 

        clone.style.transition = `all ${duration}ms ease-out`;
        clone.style.left = targetRect.left + 'px'; 
        clone.style.top = targetRect.top + 'px';

        setTimeout(() => { 
            clone.remove(); 
            callback(); 
        }, duration); 
    }

    // --- DRAG PHYSICS (Unrestricted) ---
    function setupInteraction(el, card) {
        el.onmousedown = (e) => {
            if(e.button !== 0 || !card.isFaceUp || card.owner !== 'player') return;
            
            e.preventDefault();
            draggedCardId = card.id;
            el.style.zIndex = 1000;
            
            let startX = e.clientX, startY = e.clientY;
            let origLeft = parseFloat(el.style.left);
            let origTop = parseFloat(el.style.top);

            function onMouseMove(e) {
                let dx = e.clientX - startX;
                let dy = e.clientY - startY;
                el.style.left = `${origLeft + dx}px`;
                el.style.top = `${origTop + dy}px`;
            }

            function onMouseUp(e) {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                draggedCardId = null;

                // Check Drop
                if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) {
                    playCard(card, 'left');
                } else if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) {
                    playCard(card, 'right');
                } else {
                    // Snap Back
                    renderZone('player'); 
                }
            }

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };
    }

    // --- GAME LOGIC ---
    function init() {
        startRoundWithCounts(26, 26);
    }

    function startRoundWithCounts(pCount, bCount) {
        // Init Cards with Owners
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

        // Foundation Setup (Rule D.2.2 - 4 piles)
        let pPattern = [4,3,2,1];
        let bPattern = [4,3,2,1];
        
        // Handle low card counts (Rule D.2.4)
        if(pDeck.length < 10) pPattern = [pDeck.length]; 
        if(bDeck.length < 10) bPattern = [bDeck.length];

        const pFoundCards = pDeck.splice(0, pPattern.reduce((a,b)=>a+b, 0));
        const bFoundCards = bDeck.splice(0, bPattern.reduce((a,b)=>a+b, 0));

        spawnFoundation(pFoundCards, 'player', pPattern);
        spawnFoundation(bFoundCards, 'bot', bPattern);
        
        gameState.player.deck = pDeck;
        gameState.bot.deck = bDeck;

        renderAll();
        lastActionTime = Date.now() + 2000; // 2s pause before bot starts

        // Start Loop if not running
        if (!window.masterLoopSet) {
            setInterval(gameLoop, 100); // High frequency check
            window.masterLoopSet = true;
        }
    }

    function spawnFoundation(cards, owner, pattern) {
        let cardIdx = 0;
        let xOffsets = [50, 200, 350, 500]; // Spaced out for big cards
        pattern.forEach((pileSize, colIndex) => {
            for(let i=0; i<pileSize; i++) {
                if(cardIdx < cards.length) {
                    let c = cards[cardIdx++];
                    c.owner = owner; c.col = colIndex;
                    c.x = xOffsets[colIndex]; c.y = 20 + (i * 25);
                    c.isFaceUp = (i === pileSize - 1); // Only top card face up (D.2.3)
                    if(owner === 'player') gameState.player.cards.push(c); else gameState.bot.cards.push(c);
                }
            }
        });
    }

    function gameLoop() {
        if(gameState.gameOver) return;
        
        // Bot Logic
        if(!gameState.isCountDown && !botBusy) {
            let now = Date.now();
            if(now - lastActionTime > getAiDelay()) {
                runBotLogic();
            }
        }

        // Stats & Checks
        updateStats();
        checkSlapOpportunity();
        checkStalemateConditions();
    }

    function runBotLogic() {
        // 1. Play Card (Priority)
        let move = null;
        for(let c of gameState.bot.cards.filter(c => c.isFaceUp)) {
            if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
            if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
        }

        if(move) {
            botBusy = true; lastActionTime = Date.now();
            
            // Reflex Boost if playing a card (simulating speed)
            // If the card matches the OTHER pile, it's a Slap setup. Bot plays instantly.
            let other = (move.side === 'left' ? gameState.centerRight : gameState.centerLeft);
            let reactionMod = (other && other.rank === move.card.rank) ? 0.1 : 1.0;

            setTimeout(() => {
                flyCard(move.card, (move.side==='left'?els.cLeft:els.cRight), () => {
                    playBotCard(move);
                    botBusy = false; 
                });
            }, 50 * reactionMod);
            return;
        }

        // 2. Flip Hidden Card (Rule D.3)
        // If < 4 piles have face up cards, flip the one underneath
        // We need to check columns.
        let columns = [[],[],[],[]];
        gameState.bot.cards.forEach(c => columns[c.col].push(c));
        
        for(let col of columns) {
            if(col.length > 0) {
                let top = col[col.length-1];
                if(!top.isFaceUp && gameState.bot.cards.filter(c => c.isFaceUp).length < 4) {
                    botBusy = true;
                    setTimeout(() => {
                        top.isFaceUp = true;
                        renderAll();
                        botBusy = false; lastActionTime = Date.now();
                    }, 300);
                    return;
                }
            }
        }
    }

    function playBotCard(move) {
        // Double check validity (Player might have moved)
        let current = move.side === 'left' ? gameState.centerLeft : gameState.centerRight;
        if(!isValid(move.card, current)) { 
            renderAll(); return; 
        }

        gameState.bot.cards = gameState.bot.cards.filter(c => c.id !== move.card.id);
        if(move.side === 'left') {
            if(gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
            gameState.centerLeft = move.card;
        } else {
            if(gameState.centerRight) gameState.centerStack.push(gameState.centerRight);
            gameState.centerRight = move.card;
        }
        
        renderAll(); checkWin();
    }

    function playCard(card, side) {
        gameState.player.cards = gameState.player.cards.filter(c => c.id !== card.id);
        
        if(side === 'left') {
            if(gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
            gameState.centerLeft = card;
        } else {
            if(gameState.centerRight) gameState.centerStack.push(gameState.centerRight);
            gameState.centerRight = card;
        }
        
        // Auto-flip underneath (D.2.7)
        let colCards = gameState.player.cards.filter(c => c.col === card.col);
        if(colCards.length > 0) {
            let newTop = colCards[colCards.length-1];
            if(gameState.player.cards.filter(c => c.isFaceUp).length < 4) {
                newTop.isFaceUp = true;
            }
        }

        renderAll(); checkWin();
    }

    function isValid(card, center) {
        if(!center) return false;
        let diff = Math.abs(card.rank - center.rank);
        return (diff === 1 || diff === 12); // Loop A-K (D.6.2)
    }

    function isOver(e, target) {
        const r = target.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }

    // --- SLAP LOGIC (Rule F) ---
    function checkSlapOpportunity() {
        if(gameState.gameOver || gameState.isCountDown || gameState.slapActive) return;
        if(!gameState.centerLeft || !gameState.centerRight) return;
        
        // F.2.1: Matching Ranks trigger slap
        if(gameState.centerLeft.rank === gameState.centerRight.rank) {
            if(!gameState.slapActive) {
                let reactionBase = 2000 - (difficulty * 180);
                setTimeout(() => performSlap('bot'), Math.max(100, reactionBase + Math.random()*200));
            }
        }
    }

    function performSlap(who) {
        // F.9.1 Misslap check
        if(!gameState.centerLeft || !gameState.centerRight || gameState.centerLeft.rank !== gameState.centerRight.rank) {
            if(who === 'player') { /* Optional: Add misslap penalty here (Law I) */ }
            return;
        }

        gameState.slapActive = true;
        let loser = (who === 'player') ? 'bot' : 'player';
        
        // Visuals
        els.slapAlert.innerText = (who === 'player' ? "PLAYER 1 SLAPS WON!" : "AI SLAPS WON!");
        els.slapAlert.style.display = 'block';
        setTimeout(() => { els.slapAlert.style.display = 'none'; }, 1500);

        if(who === 'player') gameState.scores.pSlaps++; else gameState.scores.bSlaps++;
        updateScoreboard();

        // F.7: Loser takes cards
        let wonCards = [...gameState.centerStack, gameState.centerLeft, gameState.centerRight];
        wonCards.forEach(c => c.owner = loser);
        
        if(loser === 'player') gameState.player.sidePot.push(...wonCards);
        else gameState.bot.sidePot.push(...wonCards);

        gameState.centerLeft = null; gameState.centerRight = null; gameState.centerStack = [];
        
        renderAll();
        setTimeout(() => { gameState.slapActive = false; resetStalemate(); }, 1000);
    }

    // --- STALEMATE & REVEAL (Rule G) ---
    els.pDeck.addEventListener('click', () => {
        if(gameState.isCountDown || gameState.gameOver) return;
        // Start Game Force
        if(!gameState.centerLeft && !gameState.centerRight) { startCountdown(); return; }
        
        if(!gameState.playerPass) {
            gameState.playerPass = true;
            els.pDeck.classList.add('waiting');
            els.pDeckText.innerText = "WAIT";
            if(gameState.botPass) startCountdown();
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
        
        // BORROW LOGIC (Rule G.3)
        let pPop = gameState.player.deck.pop();
        let bPop = gameState.bot.deck.pop();

        // If deck empty, take from opponent (G.3.2)
        if(!pPop && gameState.bot.deck.length > 0) pPop = gameState.bot.deck.pop();
        if(!bPop && gameState.player.deck.length > 0) bPop = gameState.player.deck.pop();

        if(pPop) gameState.centerRight = pPop; 
        if(bPop) gameState.centerLeft = bPop;
        
        resetStalemateVisuals(); renderAll(); 
    }

    function resetStalemateVisuals() {
        els.pDeck.classList.remove('waiting', 'counting'); els.bDeck.classList.remove('counting');
        els.pDeckText.innerText = "Start"; els.bDeckText.innerText = "";
        gameState.isCountDown = false; gameState.playerPass = false; gameState.botPass = false;
    }

    // --- MATH & SCORING (Rule H) ---
    function updateStats() {
        // H.4.1: Win match = No cards in Foundation, Deck, or Penalty
        // We count ALL cards currently owned (Deck + Foundation + SidePot)
        // Center cards are "in play" and don't count towards the goal until won/lost.
        
        let pTotal = gameState.player.cards.length + gameState.player.deck.length + gameState.player.sidePot.length;
        let bTotal = gameState.bot.cards.length + gameState.bot.deck.length + gameState.bot.sidePot.length;

        els.pCount.innerText = pTotal;
        els.bCount.innerText = bTotal;

        // Visual Borrow Label
        els.pBorrow.classList.toggle('borrow-active', gameState.player.deck.length === 0 && pTotal <= 10);
        els.bBorrow.classList.toggle('borrow-active', gameState.bot.deck.length === 0 && bTotal <= 10);
    }
    
    function updateScoreboard() {
        els.sPRounds.innerText = gameState.scores.pRounds; els.sBRounds.innerText = gameState.scores.bRounds;
        els.sPSlaps.innerText = gameState.scores.pSlaps; els.sBSlaps.innerText = gameState.scores.bSlaps;
    }

    function checkWin() { 
        if(gameState.player.cards.length === 0) endRound('player'); 
        if(gameState.bot.cards.length === 0) endRound('bot'); 
    }

    function endRound(winner) {
        if(gameState.gameOver) return; gameState.gameOver = true;
        updateStats();
        
        let pT = parseInt(els.pCount.innerText);
        let bT = parseInt(els.bCount.innerText);

        // H.4.1 Win Match Check
        if (pT <= 0) { endMatch("YOU WIN THE MATCH!"); return; }
        if (bT <= 0) { endMatch("BOT WINS THE MATCH!"); return; }

        if(winner === 'player') gameState.scores.pRounds++; else gameState.scores.bRounds++;
        updateScoreboard();

        // Setup next round (Winner keeps their stack)
        let pNext = (winner === 'player') ? pT : 52 - bT;
        
        els.overlayTitle.innerText = (winner === 'player') ? "ROUND WON!" : "ROUND LOST";
        els.overlay.classList.remove('hidden');
        els.btnAction.innerText = "NEXT ROUND";
        els.btnAction.onclick = () => startRoundWithCounts(pNext, 52 - pNext);
    }

    function endMatch(msg) {
        els.overlayTitle.innerText = msg; 
        els.overlayDesc.innerText = "GAME OVER";
        els.btnAction.innerText = "PLAY AGAIN"; 
        els.btnAction.onclick = () => location.reload();
        els.overlay.classList.remove('hidden');
    }

    init();
});
