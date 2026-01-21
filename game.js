document.addEventListener('DOMContentLoaded', () => {
    
    // === CONFIG ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;

    // AI SPEED: Lvl 1 (~3s) -> Lvl 10 (~0.5s)
    // Note: Since we combined loops, we need a faster "Tick" rate, 
    // but the AI will only act based on a cooldown.
    let reactionTime = Math.max(500, 3500 - (difficulty * 300));
    let lastActionTime = 0;
    let globalZ = 100;
    
    // LOCK
    let botBusy = false; 

    let gameState = {
        player: { deck: [], cards: [], sidePot: [], borrowing: false, borrowedAmount: 0 },
        bot: { deck: [], cards: [], sidePot: [], borrowing: false, borrowedAmount: 0 },
        centerLeft: null, centerRight: null,
        centerStack: [], 
        gameOver: false,
        playerPass: false, botPass: false,
        isCountDown: false,
        slapActive: false
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
        slapMsg: document.getElementById('slap-message')
    };

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
            // Fallback: If DOM is missing, calc from boundary
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

        clone.style.left = targetRect.left + 'px'; 
        clone.style.top = targetRect.top + 'px';

        setTimeout(() => { 
            clone.remove(); 
            callback(); 
        }, 500); // 0.5s animation
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
        gameState.player.borrowedAmount = 0; gameState.bot.borrowedAmount = 0;
        
        gameState.slapActive = false;
        gameState.isCountDown = false;
        botBusy = false;

        els.overlay.classList.add('hidden');
        resetStalemateVisuals();
        els.pBorrow.classList.remove('borrow-active');
        els.bBorrow.classList.remove('borrow-active');
        document.querySelectorAll('.slot').forEach(s => s.innerHTML = '');

        // Pattern logic
        let pPattern = getPattern(pDeck.length);
        let bPattern = getPattern(bDeck.length);
        let pFoundSize = pPattern.reduce((a,b)=>a+b, 0);
        let bFoundSize = bPattern.reduce((a,b)=>a+b, 0);

        // Borrow Check
        if((pDeck.length - pFoundSize) <= 0 && bDeck.length > 10) {
             let loan = Math.floor((bDeck.length - bFoundSize) / 2);
             let borrowed = bDeck.splice(bFoundSize, loan);
             pDeck.push(...borrowed);
             gameState.player.borrowing = true;
             gameState.player.borrowedAmount = loan;
             els.pBorrow.classList.add('borrow-active');
        }
        if((bDeck.length - bFoundSize) <= 0 && pDeck.length > 10) {
             let loan = Math.floor((pDeck.length - pFoundSize) / 2);
             let borrowed = pDeck.splice(pFoundSize, loan);
             bDeck.push(...borrowed);
             gameState.bot.borrowing = true;
             gameState.bot.borrowedAmount = loan;
             els.bBorrow.classList.add('borrow-active');
        }

        spawnFoundation(pDeck.splice(0, pFoundSize), 'player', pPattern);
        spawnFoundation(bDeck.splice(0, bFoundSize), 'bot', bPattern);
        
        gameState.player.deck = pDeck;
        gameState.bot.deck = bDeck;

        renderAll();
        
        // SINGLE MASTER LOOP FOR BOT
        setInterval(botMasterLoop, 250); // Runs 4 times a second, but checks constraints
        
        // Timers for other things
        setInterval(updateStats, 200);
        setInterval(checkSlapOpportunity, 100); 
        setInterval(checkStalemateConditions, 800); // Only checks waiting status
        
        // Mid-Round Shortage Check
        setInterval(checkShortage, 1000);
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
            if(!dragged && !card.isFaceUp) {
                if(gameState.player.cards.filter(c => c.isFaceUp).length < 4) { card.isFaceUp = true; resetStalemate(); renderZone('player'); }
                return;
            }
            if(dragged && card.isFaceUp) {
                if(isOver(e, els.cLeft) && isValid(card, gameState.centerLeft)) { playCard(card, 'left'); return; }
                if(isOver(e, els.cRight) && isValid(card, gameState.centerRight)) { playCard(card, 'right'); return; }
            }
            card.x = parseInt(el.style.left); card.y = parseInt(el.style.top); el.style.zIndex = globalZ; 
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

    // === SINGLE MASTER BOT LOOP (THE BRAIN) ===
    function botMasterLoop() {
        if(gameState.gameOver || gameState.isCountDown || gameState.slapActive || botBusy) return;

        let now = Date.now();
        // Check Speed Constraint (unless it's an emergency like flipping a card)
        if(now - lastActionTime < reactionTime) return;

        // PRIORITY 1: PLAY A CARD (Valid Move)
        let move = null;
        for(let c of gameState.bot.cards.filter(c => c.isFaceUp)) {
            if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
            if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
        }

        if(move) {
            botBusy = true; // LOCK
            lastActionTime = now;
            
            // Reflex Boost Logic (if causing Slap)
            let reactionMod = 1.0;
            let otherCenter = (move.side === 'left' ? gameState.centerRight : gameState.centerLeft);
            if(otherCenter && otherCenter.rank === move.card.rank) reactionMod = 0.1;

            setTimeout(() => {
                flyCard(move.card, (move.side==='left'?els.cLeft:els.cRight), () => {
                    let currentCenter = move.side === 'left' ? gameState.centerLeft : gameState.centerRight;
                    if(!isValid(move.card, currentCenter)) { 
                        // Failed (player moved first)
                        botBusy = false; renderZone('bot'); return; 
                    }

                    gameState.bot.cards = gameState.bot.cards.filter(c => c.id !== move.card.id);
                    if(move.side === 'left') gameState.centerStack.push(gameState.centerLeft);
                    if(move.side === 'right') gameState.centerStack.push(gameState.centerRight);
                    if(move.side === 'left') gameState.centerLeft = move.card; else gameState.centerRight = move.card;
                    
                    updateStats();
                    resetStalemate();
                    renderAll(); 
                    checkWin();
                    botBusy = false; // UNLOCK
                });
            }, 50 * reactionMod); // Small visual delay
            return;
        }

        // PRIORITY 2: FLIP A CARD (If < 4 face up)
        if(gameState.bot.cards.filter(c => c.isFaceUp).length < 4) {
            const hidden = gameState.bot.cards.find(c => !c.isFaceUp);
            if(hidden) {
                botBusy = true; // Brief lock
                lastActionTime = now;
                setTimeout(() => {
                    hidden.isFaceUp = true;
                    resetStalemate();
                    renderZone('bot');
                    botBusy = false;
                }, 300);
                return;
            }
        }

        // PRIORITY 3: SORT/ORGANIZE (Move card to empty slot)
        let columns = [[],[],[],[]];
        gameState.bot.cards.forEach(c => columns[c.col].push(c));
        let emptyIdx = columns.findIndex(c => c.length === 0);
        
        if(emptyIdx !== -1) {
            let messyIdx = columns.findIndex(c => c.length > 1 && c.some(card => !card.isFaceUp));
            if(messyIdx !== -1) {
                let cardToMove = columns[messyIdx].sort((a,b)=>a.y-b.y).pop();
                if(cardToMove.isFaceUp) {
                    botBusy = true;
                    lastActionTime = now;
                    setTimeout(() => {
                        cardToMove.col = emptyIdx;
                        cardToMove.x = [50, 250, 450, 650][emptyIdx];
                        cardToMove.y = 20;
                        let newTop = columns[messyIdx][columns[messyIdx].length-1];
                        if(newTop && !newTop.isFaceUp) newTop.isFaceUp = true;
                        renderAll();
                        botBusy = false;
                    }, 300);
                    return;
                }
            }
        }
        
        // If we got here, Bot did nothing. Bot "Pass" state is handled by checkStalemateConditions
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
        if(!gameState.centerLeft || !gameState.centerRight) return;
        if(gameState.centerLeft.rank !== gameState.centerRight.rank) return;

        gameState.slapActive = true;
        let loser = (who === 'player') ? 'bot' : 'player';
        
        els.slapMsg.innerText = (who === 'player' ? "PLAYER" : "AI") + " SLAPS WON!";
        els.slapMsg.classList.add('visible');
        setTimeout(() => els.slapMsg.classList.remove('visible'), 1500);

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
        
        // 1. Can Bot Move?
        let bMoves = false;
        gameState.bot.cards.filter(c => c.isFaceUp).forEach(c => { 
            if(isValid(c, gameState.centerLeft) || isValid(c, gameState.centerRight)) bMoves = true; 
        });
        
        // 2. Can Bot Flip?
        if(gameState.bot.cards.filter(c => c.isFaceUp).length < 4 && gameState.bot.cards.some(c => !c.isFaceUp)) bMoves = true;

        const isStart = !gameState.centerLeft && !gameState.centerRight;

        if(!bMoves || isStart) {
            if(!gameState.botPass) {
                gameState.botPass = true; 
                // Bot silently ready (Poker Face)
                if(gameState.playerPass) startCountdown();
            }
        } else {
            // If bot suddenly has moves (e.g. player played), un-pass
            if(gameState.botPass && !isStart) gameState.botPass = false;
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

        if(gameState.player.borrowing && pDeckPop) gameState.player.borrowedAmount = Math.max(0, gameState.player.borrowedAmount - 1);
        if(gameState.bot.borrowing && bDeckPop) gameState.bot.borrowedAmount = Math.max(0, gameState.bot.borrowedAmount - 1);

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

    function updateStats() {
        let pTotal = gameState.player.deck.length + gameState.player.cards.length + gameState.player.sidePot.length - gameState.player.borrowedAmount;
        let bTotal = gameState.bot.deck.length + gameState.bot.cards.length + gameState.bot.sidePot.length - gameState.bot.borrowedAmount;
        els.pCount.innerText = Math.max(0, pTotal); 
        els.bCount.innerText = Math.max(0, bTotal);
    }

    function checkWin() {
        if(gameState.player.cards.length === 0) endRound('player');
        if(gameState.bot.cards.length === 0) endRound('bot');
    }

    function checkShortage() {
        if(gameState.gameOver) return;
        if(gameState.player.deck.length === 0 && !gameState.player.borrowing && gameState.bot.deck.length > 1) {
            let loan = Math.floor(gameState.bot.deck.length / 2);
            gameState.player.deck.push(...gameState.bot.deck.splice(0, loan));
            gameState.player.borrowing = true;
            gameState.player.borrowedAmount = loan;
            els.pBorrow.classList.add('borrow-active');
        }
        if(gameState.bot.deck.length === 0 && !gameState.bot.borrowing && gameState.player.deck.length > 1) {
            let loan = Math.floor(gameState.player.deck.length / 2);
            gameState.bot.deck.push(...gameState.player.deck.splice(0, loan));
            gameState.bot.borrowing = true;
            gameState.bot.borrowedAmount = loan;
            els.bBorrow.classList.add('borrow-active');
        }
    }

    function endRound(winner) {
        if(gameState.gameOver) return;
        gameState.gameOver = true;
        
        let pTotal = parseInt(els.pCount.innerText);
        let bTotal = parseInt(els.bCount.innerText);

        if(pTotal <= 0) { endMatch("YOU WIN THE MATCH!"); return; }
        if(bTotal <= 0) { endMatch("BOT WINS THE MATCH!"); return; }

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
