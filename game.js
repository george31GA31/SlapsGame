document.addEventListener('DOMContentLoaded', () => {
    
    // === CONFIG ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;

    // DIFFICULTY SETTINGS (Explicit)
    const difficultySettings = {
        1: { min: 2000, max: 3000 },
        2: { min: 1500, max: 2500 },
        3: { min: 1000, max: 2000 },
        4: { min: 250,  max: 1500 }
    };

    // Calculate AI Delay
    const getAiDelay = () => {
        if (difficulty <= 4) {
            let s = difficultySettings[difficulty];
            return Math.floor(Math.random() * (s.max - s.min + 1)) + s.min;
        } else {
            // Lvl 5+ Formula
            let minDelay = Math.max(200, 3500 - (difficulty * 350));
            let maxDelay = Math.max(400, 4500 - (difficulty * 400));
            return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        }
    };

    let globalZ = 100;
    
    // LOCKS
    let botBusy = false; 
    let isPlayerDragging = false; 

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

    // Global Drag Listeners
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

        // ANIMATION SPEED
        let dist = Math.hypot(targetRect.left - startLeft, targetRect.top - startTop);
        let duration = Math.max(300, dist * 0.8); 

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
        // Correct Splicing logic to ensure 26 total
        let pDeck = fullDeck.slice(0, pCount);
        let bDeck = fullDeck.slice(pCount, 52);

        gameState.player.cards = []; gameState.bot.cards = [];
        gameState.centerStack = []; gameState.centerLeft = null; gameState.centerRight = null;
        gameState.player.sidePot = []; gameState.bot.sidePot = [];
        gameState.gameOver = false; gameState.playerPass = false; gameState.botPass = false;
        gameState.player.borrowing = false; gameState.bot.borrowing = false;
        gameState.slapActive = false; gameState.isCountDown = false; botBusy = false;

        els.overlay.classList.add('hidden');
        resetStalemateVisuals();
        els.pBorrow.classList.remove('borrow-active');
        els.bBorrow.classList.remove('borrow-active');
        document.querySelectorAll('.slot').forEach(s => s.innerHTML = '');

        // Pattern logic (1-9 cards)
        let pPattern = getPattern(pDeck.length);
        let bPattern = getPattern(bDeck.length);
        let pFoundSize = pPattern.reduce((a,b)=>a+b, 0);
        let bFoundSize = bPattern.reduce((a,b)=>a+b, 0);

        // Deal Foundations (Modifies pDeck/bDeck in place by splice)
        spawnFoundation(pDeck.splice(0, pFoundSize), 'player', pPattern);
        spawnFoundation(bDeck.splice(0, bFoundSize), 'bot', bPattern);
        
        gameState.player.deck = pDeck;
        gameState.bot.deck = bDeck;

        renderAll();
        
        // LOOPS
        setInterval(botMasterLoop, 200); 
        setInterval(updateStats, 200); 
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
                    c.isFaceUp = (i === pileSize - 1); 
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
        // SNAP BACK FIX: Only update DOM if player isn't holding something
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
        isPlayerDragging = true; 
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
            isPlayerDragging = false; 

            if(!dragged && !card.isFaceUp) {
                if(gameState.player.cards.filter(c => c.isFaceUp).length < 4) { card.isFaceUp = true; resetStalemate(); renderZone('player'); }
                return;
            }
            if(dragged && card.isFaceUp) {
                if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) { playCard(card, 'left'); return; }
                if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) { playCard(card, 'right'); return; }
            }
            // Snap back
            card.x = parseInt(el.style.left); card.y = parseInt(el.style.top); el.style.zIndex = globalZ; 
            renderZone('player'); 
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

    let lastActionTime = 0;
    function botMasterLoop() {
        if(gameState.gameOver || gameState.isCountDown || gameState.slapActive || botBusy) return;

        let now = Date.now();
        // Check Speed
        if(now - lastActionTime < getAiDelay()) return;

        // 1. PLAY PRIORITY
        let move = null;
        for(let c of gameState.bot.cards.filter(c => c.isFaceUp)) {
            if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
            if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
        }

        if(move) {
            botBusy = true;
            lastActionTime = now;
            
            // Reflex Boost (Self-Slap Logic)
            let reactionMod = 1.0;
            // Check if THIS move creates a slap
            // e.g. Left center is 8, we play 8 on Right.
            let targetPile = (move.side === 'left' ? gameState.centerLeft : gameState.centerRight); // The card we are covering (irrelevant for slap check)
            let otherPile = (move.side === 'left' ? gameState.centerRight : gameState.centerLeft);
            
            // If otherPile exists and matches rank of played card
            if(otherPile && otherPile.rank === move.card.rank) {
                reactionMod = 0.1; // 90% Faster
            }

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

        // 2. FLIP PRIORITY (Fast)
        if(gameState.bot.cards.filter(c => c.isFaceUp).length < 4) {
            const hidden = gameState.bot.cards.find(c => !c.isFaceUp);
            if(hidden) {
                botBusy = true;
                setTimeout(() => {
                    hidden.isFaceUp = true;
                    resetStalemate(); renderZone('bot');
                    botBusy = false; lastActionTime = now;
                }, 300);
                return;
            }
        }

        // 3. SORT PRIORITY
        // ... (Sorting logic here simplified for space, same as before) ...
    }

    function checkSlapOpportunity() {
        if(gameState.gameOver || gameState.isCountDown || gameState.slapActive) return;
        if(!gameState.centerLeft || !gameState.centerRight) return;
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
        setTimeout(() => els.slapAlert.style.display = 'none', 1500);

        if(who === 'player') gameState.scores.pSlaps++; else gameState.scores.bSlaps++;
        updateScoreboard();

        let wonCards = [...gameState.centerStack, gameState.centerLeft, gameState.centerRight];
        (loser === 'player' ? gameState.player.sidePot : gameState.bot.sidePot).push(...wonCards);
        gameState.centerLeft = null; gameState.centerRight = null; gameState.centerStack = [];
        
        renderAll(); updateStats();
        setTimeout(() => { gameState.slapActive = false; resetStalemate(); }, 1000);
    }

    function checkStalemateConditions() {
        if(gameState.isCountDown || gameState.gameOver || gameState.slapActive || botBusy) return;
        
        let bMoves = gameState.bot.cards.some(c => c.isFaceUp && (isValid(c, gameState.centerLeft) || isValid(c, gameState.centerRight)));
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

        // FORCE DROP if dragging
        if(isPlayerDragging) { isPlayerDragging = false; renderZone('player'); }

        let pDeckPop = gameState.player.deck.pop();
        let bDeckPop = gameState.bot.deck.pop();

        // BORROW LOGIC - If Deck Empty, consume opponent
        if(!pDeckPop && gameState.bot.deck.length > 0) {
             // Player needs card from Bot
             let stolen1 = gameState.bot.deck.pop();
             let stolen2 = gameState.bot.deck.pop(); 
             if(stolen2) pDeckPop = stolen2; // This becomes Player's reveal
        }
        if(!bDeckPop && gameState.player.deck.length > 0) {
             let stolen1 = gameState.player.deck.pop();
             let stolen2 = gameState.player.deck.pop();
             if(stolen2) bDeckPop = stolen2;
        }

        if(pDeckPop) gameState.centerRight = pDeckPop;
        if(bDeckPop) gameState.centerLeft = bDeckPop;

        resetStalemateVisuals(); renderAll(); updateStats();
    }

    function resetStalemate() { gameState.playerPass = false; resetStalemateVisuals(); }
    function resetStalemateVisuals() {
        els.pDeck.classList.remove('waiting', 'counting'); els.bDeck.classList.remove('counting');
        els.pDeckText.innerText = "Start"; els.bDeckText.innerText = "";
        gameState.isCountDown = false; gameState.playerPass = false; gameState.botPass = false;
    }

    function countAllCards(who) {
        // ROBUST COUNTER: Sum of Deck + Foundation + SidePot + Center (if owned)
        // Actually, just count arrays.
        let obj = (who === 'player') ? gameState.player : gameState.bot;
        let count = obj.deck.length + obj.cards.length + obj.sidePot.length;
        // Center cards are technically "in limbo" until won, but for match win check we need total.
        // Simplified: The 52 card sum constraint handles this.
        return count;
    }

    function updateStats() {
        // BORROW LABEL LOGIC
        els.pBorrow.classList.toggle('borrow-active', gameState.player.deck.length <= 10);
        els.bBorrow.classList.toggle('borrow-active', gameState.bot.deck.length <= 10);

        let pTotal = countAllCards('player');
        let bTotal = countAllCards('bot');
        els.pCount.innerText = pTotal; 
        els.bCount.innerText = bTotal;
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
        
        let pHold = countAllCards('player');
        let bHold = countAllCards('bot');

        // TOTAL WIN CHECK (Including limbo/center cards logic roughly)
        // If I cleared my foundation AND my deck is empty AND my sidepot is empty -> WIN
        if (pHold === 0) { endMatch("YOU WIN THE MATCH!"); return; }
        if (bHold === 0) { endMatch("BOT WINS THE MATCH!"); return; }

        if(winner === 'player') gameState.scores.pRounds++; else gameState.scores.bRounds++;
        updateScoreboard();

        let winnerDeckSize = (winner === 'player') ? pHold : bHold;
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
