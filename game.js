document.addEventListener('DOMContentLoaded', () => {
    
    // === CONFIGURATION ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;

    // AI SPEED - Humanized
    // Base Delay: Reaction time
    // Travel Time: Calculated distance
    let botBaseSpeed = 3500 - (difficulty * 300); // 3.5s to 0.5s reaction
    let globalZ = 100;
    
    // LOCKS & FLAGS
    let botBusy = false; 
    let isPlayerDragging = false; // PREVENTS DROP BUG

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
        slapMsg: document.getElementById('slap-message'),
        // Scoreboard
        sPRounds: document.getElementById('p-rounds'),
        sBRounds: document.getElementById('b-rounds'),
        sPSlaps: document.getElementById('p-slaps'),
        sBSlaps: document.getElementById('b-slaps')
    };

    // Global Drag Listeners to fix the "Drop" bug
    document.addEventListener('mousedown', () => isPlayerDragging = true);
    document.addEventListener('mouseup', () => isPlayerDragging = false);

    class Card {
        constructor(suit, value, owner) {
            this.suit = suit; this.value = value;
            this.rank = VALUES.indexOf(value) + 1;
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
        let cardEl = document.getElementById(card.id);
        let startLeft, startTop;

        if (cardEl) {
            const rect = cardEl.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            cardEl.style.visibility = 'hidden'; 
        } else {
            const boundary = card.owner === 'player' ? els.pBoundary : els.bBoundary;
            const bRect = boundary.getBoundingClientRect();
            startLeft = bRect.left + card.x;
            startTop = bRect.top + card.y;
        }

        const targetRect = targetEl.getBoundingClientRect();
        
        const clone = document.createElement('div');
        clone.innerHTML = `<div class="card-top">${card.value}</div><div class="card-mid">${card.suit}</div><div class="card-bot">${card.value}</div>`;
        clone.className = `playing-card flying-card`;
        clone.style.color = card.color === 'red' ? '#d9534f' : '#292b2c';
        clone.style.width = '90px'; clone.style.height = '126px';
        clone.style.left = startLeft + 'px'; 
        clone.style.top = startTop + 'px';
        clone.style.zIndex = 99999;
        
        document.body.appendChild(clone);
        void clone.offsetWidth; 

        // CALCULATE HUMAN TRAVEL SPEED (Pixels per ms)
        let dist = Math.hypot(targetRect.left - startLeft, targetRect.top - startTop);
        let duration = Math.max(300, dist * 0.8); // 0.8ms per pixel

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
        let fullDeck = createDeck();
        let pDeck = fullDeck.slice(0, pCount);
        let bDeck = fullDeck.slice(pCount, 52);

        // Reset
        gameState.player.cards = []; gameState.bot.cards = [];
        gameState.centerStack = []; gameState.centerLeft = null; gameState.centerRight = null;
        gameState.player.sidePot = []; gameState.bot.sidePot = [];
        gameState.gameOver = false; gameState.playerPass = false; gameState.botPass = false;
        gameState.player.borrowing = false; gameState.bot.borrowing = false;
        gameState.slapActive = false; gameState.isCountDown = false; botBusy = false;

        els.overlay.classList.add('hidden');
        resetStalemateVisuals();
        
        // Initial Start Delay so bot doesn't move instantly
        setTimeout(() => { botBusy = false; }, 2000); 
        botBusy = true; // Paused at start

        // Pattern logic
        let pPattern = getPattern(pDeck.length);
        let bPattern = getPattern(bDeck.length);
        let pFoundSize = pPattern.reduce((a,b)=>a+b, 0);
        let bFoundSize = bPattern.reduce((a,b)=>a+b, 0);

        // Deal
        spawnFoundation(pDeck.splice(0, pFoundSize), 'player', pPattern);
        spawnFoundation(bDeck.splice(0, bFoundSize), 'bot', bPattern);
        
        gameState.player.deck = pDeck;
        gameState.bot.deck = bDeck;

        renderAll();
        
        // Single Master Loop
        setInterval(botMasterLoop, 200); 
        setInterval(updateStats, 100); // Frequent update for labels
        setInterval(checkSlapOpportunity, 100); 
        setInterval(checkStalemateConditions, 800); 
    }

    function getPattern(count) {
        if(count >= 10) return [4,3,2,1];
        const patterns = { 9:[3,3,2,1], 8:[3,2,2,1], 7:[3,2,1,1], 6:[2,2,1,1], 5:[2,1,1,1], 4:[1,1,1,1], 3:[1,1,1], 2:[1,1], 1:[1] };
        return patterns[count] || [count];
    }

    function createDeck() { return SUITS.flatMap(s => VALUES.map(v => new Card(s, v))).sort(() => Math.random() - 0.5); }

    function spawnFoundation(cards, owner, pattern) {
        let cardIdx = 0;
        let xOffsets = [50, 250, 450, 650];
        pattern.forEach((pileSize, colIndex) => {
            for(let i=0; i<pileSize; i++) {
                if(cardIdx < cards.length) {
                    let c = cards[cardIdx++];
                    c.owner = owner; c.col = colIndex;
                    c.x = xOffsets[colIndex]; c.y = 20 + (i * 30);
                    c.isFaceUp = (i === pileSize - 1); // Only last card face up
                    if(owner === 'player') gameState.player.cards.push(c); else gameState.bot.cards.push(c);
                }
            }
        });
    }

    function renderAll() {
        renderZone('player'); renderZone('bot');
        renderCenter(els.cLeft, gameState.centerLeft); renderCenter(els.cRight, gameState.centerRight);
    }

    function renderZone(who) {
        // FIX: Don't re-render player zone if dragging
        if(who === 'player' && isPlayerDragging) return;

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

    function setupInteraction(el, card) {
        el.addEventListener('mousedown', (e) => { if(e.button !== 0) return; el.style.zIndex = ++globalZ; startDrag(e, el, card); });
    }

    function startDrag(e, el, card) {
        e.preventDefault();
        isPlayerDragging = true; // LOCK RENDER
        let startX = e.clientX, startY = e.clientY;
        let origX = card.x, origY = card.y;
        let dragged = false;
        const canLeft = isValid(card, gameState.centerLeft);
        const canRight = isValid(card, gameState.centerRight);
        const isUnlocked = (canLeft || canRight) && card.isFaceUp;
        const boxW = 900, boxH = 250, cardW = 90, cardH = 126;

        function move(e) {
            if(Math.abs(e.clientX - startX) > 15 || Math.abs(e.clientY - startY) > 15) dragged = true;
            if(dragged) {
                let dx = e.clientX - startX, dy = e.clientY - startY;
                let newX = origX + dx, newY = origY + dy;
                if (!isUnlocked) { newX = Math.max(0, Math.min(newX, boxW - cardW)); newY = Math.max(0, Math.min(newY, boxH - cardH)); }
                el.style.left = newX + 'px'; el.style.top = newY + 'px';
            }
        }

        function drop(e) {
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', drop);
            isPlayerDragging = false; // UNLOCK RENDER

            if(!dragged && !card.isFaceUp) {
                if(gameState.player.cards.filter(c => c.isFaceUp).length < 4) { card.isFaceUp = true; resetStalemate(); renderZone('player'); }
                return;
            }
            if(dragged && card.isFaceUp) {
                if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) { playCard(card, 'left'); return; }
                if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) { playCard(card, 'right'); return; }
            }
            card.x = parseInt(el.style.left); card.y = parseInt(el.style.top); el.style.zIndex = globalZ; 
            renderZone('player'); // Snap back
        }
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', drop);
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
        if(side === 'left' && gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
        if(side === 'right' && gameState.centerRight) gameState.centerStack.push(gameState.centerRight);
        if(side === 'left') gameState.centerLeft = card; else gameState.centerRight = card;
        
        updateStats(); resetStalemate(); renderAll(); checkWin();
    }

    document.addEventListener('keydown', (e) => {
        if(e.code === 'Space' && !gameState.gameOver && !gameState.isCountDown) {
            e.preventDefault(); performSlap('player');
        }
    });

    // === MASTER BOT LOOP ===
    let lastActionTime = 0;
    
    function botMasterLoop() {
        if(gameState.gameOver || gameState.isCountDown || gameState.slapActive || botBusy) return;

        let now = Date.now();
        // Wait for reaction time (randomized slightly)
        if(now - lastActionTime < (botBaseSpeed + Math.random()*500)) return;

        // 1. PLAY PRIORITY
        let move = null;
        for(let c of gameState.bot.cards.filter(c => c.isFaceUp)) {
            if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
            if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
        }

        if(move) {
            botBusy = true;
            lastActionTime = now;
            
            // Reflex Boost
            let reactionMod = 1.0;
            let other = (move.side === 'left' ? gameState.centerRight : gameState.centerLeft);
            if(other && other.rank === move.card.rank) reactionMod = 0.1;

            setTimeout(() => {
                flyCard(move.card, (move.side==='left'?els.cLeft:els.cRight), () => {
                    let currentCenter = move.side === 'left' ? gameState.centerLeft : gameState.centerRight;
                    if(!isValid(move.card, currentCenter)) { botBusy = false; renderZone('bot'); return; }

                    gameState.bot.cards = gameState.bot.cards.filter(c => c.id !== move.card.id);
                    if(move.side === 'left') gameState.centerStack.push(gameState.centerLeft);
                    if(move.side === 'right') gameState.centerStack.push(gameState.centerRight);
                    if(move.side === 'left') gameState.centerLeft = move.card; else gameState.centerRight = move.card;
                    
                    updateStats();
                    resetStalemate();
                    renderAll(); 
                    checkWin();
                    botBusy = false;
                });
            }, 50 * reactionMod);
            return;
        }

        // 2. FLIP/SORT PRIORITY
        // Group columns
        let columns = [[],[],[],[]];
        gameState.bot.cards.forEach(c => columns[c.col].push(c));

        // A. Flip if needed
        let closedTop = gameState.bot.cards.find(c => {
            let col = columns[c.col];
            return col[col.length-1] === c && !c.isFaceUp;
        });
        
        if(closedTop && gameState.bot.cards.filter(c => c.isFaceUp).length < 4) {
            botBusy = true;
            setTimeout(() => {
                closedTop.isFaceUp = true;
                resetStalemate(); renderZone('bot');
                botBusy = false; lastActionTime = now;
            }, 300);
            return;
        }

        // B. Sort: Move from big stack to empty stack
        let emptyIdx = columns.findIndex(c => c.length === 0);
        if(emptyIdx !== -1) {
            let messyIdx = columns.findIndex(c => c.length > 1 && !c[c.length-1].isFaceUp); // Actually this logic is complex. 
            // Simplified: Find column with face-down cards
            messyIdx = columns.findIndex(c => c.length > 1 && c.some(card => !card.isFaceUp));
            
            if(messyIdx !== -1) {
                let cardToMove = columns[messyIdx][columns[messyIdx].length-1]; // Top card
                if(cardToMove.isFaceUp) {
                    botBusy = true;
                    setTimeout(() => {
                        cardToMove.col = emptyIdx;
                        cardToMove.x = [50, 250, 450, 650][emptyIdx];
                        cardToMove.y = 20;
                        // Card under it becomes new top, but wait to flip
                        renderAll();
                        botBusy = false; lastActionTime = now;
                    }, 400); // Travel time logic approximated
                    return;
                }
            }
        }
    }

    function checkSlapOpportunity() {
        if(gameState.gameOver || gameState.isCountDown || gameState.slapActive) return;
        if(!gameState.centerLeft || !gameState.centerRight) return;
        if(gameState.centerLeft.rank === gameState.centerRight.rank) {
            if(!gameState.slapActive) {
                let reaction = Math.max(400, 2000 - (difficulty * 150));
                setTimeout(() => performSlap('bot'), reaction);
            }
        }
    }

    function performSlap(who) {
        if(gameState.slapActive) return;
        if(!gameState.centerLeft || !gameState.centerRight || gameState.centerLeft.rank !== gameState.centerRight.rank) return;

        gameState.slapActive = true;
        let loser = (who === 'player') ? 'bot' : 'player';
        
        els.slapMsg.innerText = (who === 'player' ? "PLAYER" : "AI") + " SLAPS WON!";
        els.slapMsg.classList.add('visible');
        setTimeout(() => els.slapMsg.classList.remove('visible'), 1500);

        // Score Update
        if(who === 'player') gameState.scores.pSlaps++; else gameState.scores.bSlaps++;
        updateScoreboard();

        let wonCards = [...gameState.centerStack, gameState.centerLeft, gameState.centerRight];
        (loser === 'player' ? gameState.player.sidePot : gameState.bot.sidePot).push(...wonCards);
        gameState.centerLeft = null; gameState.centerRight = null; gameState.centerStack = [];
        
        renderAll(); updateStats();
        setTimeout(() => { gameState.slapActive = false; resetStalemate(); }, 1000);
    }

    els.pDeck.addEventListener('click', () => {
        if(gameState.isCountDown || gameState.gameOver) return;
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
        
        // Can Bot Flip? (Also counts as a move availability)
        let bFlips = gameState.bot.cards.filter(c => c.isFaceUp).length < 4 && gameState.bot.cards.some(c => !c.isFaceUp);

        const isStart = !gameState.centerLeft && !gameState.centerRight;

        if(!bMoves && !bFlips) {
            if(!gameState.botPass) {
                gameState.botPass = true; 
                if(gameState.playerPass) startCountdown();
            }
        } else {
            if(gameState.botPass) gameState.botPass = false;
        }
    }

    function startCountdown() {
        gameState.isCountDown = true;
        let count = 3;
        els.pDeck.classList.remove('waiting'); els.pDeck.classList.add('counting'); els.bDeck.classList.add('counting');
        const timer = setInterval(() => {
            els.pDeckText.innerText = count; els.bDeckText.innerText = count;
            count--;
            if(count < 0) { clearInterval(timer); executeReveal(); }
        }, 800);
    }

    function executeReveal() {
        if(gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
        if(gameState.centerRight) gameState.centerStack.push(gameState.centerRight);

        let pDeckPop = gameState.player.deck.pop();
        let bDeckPop = gameState.bot.deck.pop();

        if(pDeckPop) gameState.centerRight = pDeckPop;
        if(bDeckPop) gameState.centerLeft = bDeckPop;

        // SHORTAGE LOGIC: If deck is empty, take from opponent if they have cards
        if(!pDeckPop && gameState.bot.deck.length > 0) {
             let stole = gameState.bot.deck.pop(); // Take 1
             let stole2 = gameState.bot.deck.pop(); // Take 2 (for center)
             if(stole2) gameState.centerRight = stole2; // Player plays stolen card
        }
        if(!bDeckPop && gameState.player.deck.length > 0) {
             let stole = gameState.player.deck.pop();
             let stole2 = gameState.player.deck.pop();
             if(stole2) gameState.centerLeft = stole2;
        }

        resetStalemateVisuals(); renderAll(); updateStats();
    }

    function resetStalemate() { gameState.playerPass = false; resetStalemateVisuals(); }
    function resetStalemateVisuals() {
        els.pDeck.classList.remove('waiting', 'counting'); els.bDeck.classList.remove('counting');
        els.pDeckText.innerText = "Start"; els.bDeckText.innerText = "";
        gameState.isCountDown = false; gameState.playerPass = false; gameState.botPass = false;
    }

    function updateStats() {
        // STRICT OWNER COUNTING (Fixes Round 3 Math)
        // Count every card object that has owner='player'
        let allLists = [
            ...gameState.player.deck, ...gameState.player.cards, ...gameState.player.sidePot,
            ...gameState.bot.deck, ...gameState.bot.cards, ...gameState.bot.sidePot
        ];
        
        let pTotal = allLists.filter(c => c.owner === 'player').length;
        let bTotal = allLists.filter(c => c.owner === 'bot').length;

        els.pCount.innerText = pTotal;
        els.bCount.innerText = bTotal;

        // Update Borrow Labels based on DECK size only (Visual)
        els.pBorrow.classList.toggle('borrow-active', gameState.player.deck.length === 0);
        els.bBorrow.classList.toggle('borrow-active', gameState.bot.deck.length === 0);
    }
    
    function updateScoreboard() {
        els.sPRounds.innerText = gameState.scores.pRounds;
        els.sBRounds.innerText = gameState.scores.bRounds;
        els.sPSlaps.innerText = gameState.scores.pSlaps;
        els.sBSlaps.innerText = gameState.scores.bSlaps;
    }

    function checkWin() {
        if(gameState.player.cards.length === 0) endRound('player');
        if(gameState.bot.cards.length === 0) endRound('bot');
    }

    function endRound(winner) {
        if(gameState.gameOver) return;
        gameState.gameOver = true;
        
        let pTotal = parseInt(els.pCount.innerText);
        let bTotal = parseInt(els.bCount.innerText);

        if(pTotal <= 0) { endMatch("YOU WIN THE MATCH!"); return; }
        if(bTotal <= 0) { endMatch("BOT WINS THE MATCH!"); return; }

        if(winner === 'player') gameState.scores.pRounds++; else gameState.scores.bRounds++;
        updateScoreboard();

        let winnerDeckSize = (winner === 'player') ? pTotal : bTotal;
        let pNext, bNext;

        if (winner === 'player') {
            pNext = winnerDeckSize; 
            bNext = 52 - pNext;
            els.overlayTitle.innerText = "ROUND WON!";
            els.overlayDesc.innerText = `You keep ${pNext} cards. Bot takes the rest.`;
        } else {
            bNext = winnerDeckSize;
            pNext = 52 - bNext;
            els.overlayTitle.innerText = "ROUND LOST";
            els.overlayDesc.innerText = `Bot keeps ${bNext} cards. You take the pile.`;
        }

        els.overlay.classList.remove('hidden');
        els.btnAction.innerText = "NEXT ROUND";
        els.btnAction.onclick = () => {
            startRoundWithCounts(pNext, bNext);
        };
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
