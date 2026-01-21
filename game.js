document.addEventListener('DOMContentLoaded', () => {
    
    // CONFIG
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;
    let botSpeedBase = 6500 - (difficulty * 600); 
    const getBotDelay = () => Math.max(500, botSpeedBase + (Math.random() * 500));
    let globalZ = 100;

    let gameState = {
        player: { deck: [], cards: [], borrowing: false },
        bot: { deck: [], cards: [], borrowing: false },
        centerLeft: null, centerRight: null,
        centerStack: [], 
        gameOver: false,
        playerPass: false, botPass: false,
        isCountDown: false
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
        btnAction: document.getElementById('btn-action')
    };

    class Card {
        constructor(suit, value, owner) {
            this.suit = suit; this.value = value;
            this.rank = VALUES.indexOf(value) + 1;
            this.color = (suit === "♥" || suit === "♦") ? "red" : "black";
            this.id = Math.random().toString(36).substr(2, 9);
            this.owner = owner; this.isFaceUp = false;
            this.x = 0; this.y = 0; this.col = -1;
        }
        getHTML() {
            const faceClass = this.isFaceUp ? '' : 'face-down';
            return `<div class="playing-card ${faceClass}" id="${this.id}" style="color: ${this.color === 'red' ? '#d9534f' : '#292b2c'}; left:${this.x}px; top:${this.y}px;">
                <div class="card-top">${this.value}</div><div class="card-mid">${this.suit}</div><div class="card-bot">${this.value}</div>
            </div>`;
        }
    }

    function flyCard(cardEl, targetEl, callback) {
        if(!cardEl || !targetEl) { callback(); return; }
        const startRect = cardEl.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const clone = cardEl.cloneNode(true);
        if(clone.classList.contains('face-down')) clone.classList.remove('face-down');
        clone.classList.add('flying-card');
        clone.style.left = startRect.left + 'px'; clone.style.top = startRect.top + 'px';
        clone.style.width = '90px'; clone.style.height = '126px'; clone.style.zIndex = 99999;
        cardEl.style.visibility = 'hidden'; 
        document.body.appendChild(clone);
        void clone.offsetWidth;
        clone.style.left = targetRect.left + 'px'; clone.style.top = targetRect.top + 'px';
        setTimeout(() => { clone.remove(); callback(); }, 600);
    }

    function init() {
        let deck = createDeck();
        startGameWithDecks(deck.slice(0, 26), deck.slice(26, 52));
    }

    function startGameWithDecks(pDeck, bDeck) {
        // RESET STATE
        gameState.player.cards = []; gameState.bot.cards = [];
        gameState.centerStack = []; gameState.centerLeft = null; gameState.centerRight = null;
        gameState.gameOver = false; gameState.playerPass = false; gameState.botPass = false;
        gameState.player.borrowing = false; gameState.bot.borrowing = false;
        
        // RESET VISUALS
        els.overlay.classList.add('hidden');
        resetStalemateVisuals();
        els.pBorrow.classList.remove('borrow-active');
        els.bBorrow.classList.remove('borrow-active');
        document.querySelectorAll('.slot').forEach(s => s.innerHTML = '');

        // BORROWING CHECK (Start of Round)
        if(pDeck.length < 10) {
            let loan = Math.floor(bDeck.length / 2);
            pDeck.push(...bDeck.splice(0, loan));
            gameState.player.borrowing = true;
            els.pBorrow.classList.add('borrow-active');
        }
        if(bDeck.length < 10) {
            let loan = Math.floor(pDeck.length / 2);
            bDeck.push(...pDeck.splice(0, loan));
            gameState.bot.borrowing = true;
            els.bBorrow.classList.add('borrow-active');
        }

        // DEAL FOUNDATIONS
        spawnFoundation(pDeck.splice(0, 10), 'player');
        spawnFoundation(bDeck.splice(0, 10), 'bot');
        
        gameState.player.deck = pDeck;
        gameState.bot.deck = bDeck;

        renderAll();
        runBotCycle();
        setInterval(updateStats, 200);
        setInterval(checkBotStalemate, 800);
        
        // MID-ROUND SHORTAGE CHECKER
        setInterval(() => {
            if(gameState.gameOver) return;
            if(gameState.player.deck.length === 0 && !gameState.player.borrowing && gameState.bot.deck.length > 1) {
                let loan = Math.floor(gameState.bot.deck.length / 2);
                gameState.player.deck.push(...gameState.bot.deck.splice(0, loan));
                gameState.player.borrowing = true;
                els.pBorrow.classList.add('borrow-active');
            }
            if(gameState.bot.deck.length === 0 && !gameState.bot.borrowing && gameState.player.deck.length > 1) {
                let loan = Math.floor(gameState.player.deck.length / 2);
                gameState.bot.deck.push(...gameState.player.deck.splice(0, loan));
                gameState.bot.borrowing = true;
                els.bBorrow.classList.add('borrow-active');
            }
        }, 1000);
    }

    function createDeck() { return SUITS.flatMap(s => VALUES.map(v => new Card(s, v))).sort(() => Math.random() - 0.5); }

    function spawnFoundation(cards, owner) {
        let xOffsets = [50, 250, 450, 650], pileSizes = [4, 3, 2, 1], cardIdx = 0;
        for(let col=0; col<4; col++) {
            for(let row=0; row<pileSizes[col]; row++) {
                if(cardIdx >= cards.length) break;
                let c = cards[cardIdx++];
                c.owner = owner; c.col = col; c.x = xOffsets[col]; c.y = 20 + (row * 30);
                if(row === pileSizes[col]-1) c.isFaceUp = true;
                if(owner === 'player') gameState.player.cards.push(c); else gameState.bot.cards.push(c);
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
        resetStalemate(); 
        renderAll(); checkWin();
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

    function checkBotStalemate() {
        if(gameState.isCountDown || gameState.gameOver) return;
        let bMoves = false;
        gameState.bot.cards.filter(c => c.isFaceUp).forEach(c => { if(isValid(c, gameState.centerLeft) || isValid(c, gameState.centerRight)) bMoves = true; });
        if(gameState.bot.cards.filter(c => c.isFaceUp).length < 4 && gameState.bot.cards.some(c => !c.isFaceUp)) bMoves = true;
        const isStart = !gameState.centerLeft && !gameState.centerRight;

        if(!bMoves || isStart) {
            if(!gameState.botPass) {
                gameState.botPass = true; els.bDeck.classList.add('waiting'); els.bDeckText.innerText = "WAIT";
                if(gameState.playerPass) startCountdown();
            }
        } else {
            if(gameState.botPass && !isStart) { gameState.botPass = false; els.bDeck.classList.remove('waiting'); els.bDeckText.innerText = ""; }
        }
    }

    function startCountdown() {
        gameState.isCountDown = true;
        let count = 3;
        els.pDeck.classList.remove('waiting'); els.bDeck.classList.remove('waiting');
        els.pDeck.classList.add('counting'); els.bDeck.classList.add('counting');
        const timer = setInterval(() => {
            els.pDeckText.innerText = count; els.bDeckText.innerText = count;
            count--;
            if(count < 0) { clearInterval(timer); executeReveal(); }
        }, 800);
    }

    function executeReveal() {
        if(gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
        if(gameState.centerRight) gameState.centerStack.push(gameState.centerRight);

        if(gameState.player.borrowing) {
            if(gameState.bot.deck.length > 1) {
                gameState.centerLeft = gameState.bot.deck.pop();
                gameState.centerRight = gameState.bot.deck.pop();
            }
        } else if(gameState.bot.borrowing) {
            if(gameState.player.deck.length > 1) {
                gameState.centerLeft = gameState.player.deck.pop();
                gameState.centerRight = gameState.player.deck.pop();
            }
        } else {
            if(gameState.player.deck.length > 0) gameState.centerRight = gameState.player.deck.pop();
            if(gameState.bot.deck.length > 0) gameState.centerLeft = gameState.bot.deck.pop();
        }
        resetStalemateVisuals(); renderAll();
    }

    function resetStalemate() { gameState.playerPass = false; resetStalemateVisuals(); }
    function resetStalemateVisuals() {
        els.pDeck.classList.remove('waiting', 'counting'); els.bDeck.classList.remove('waiting', 'counting');
        els.pDeckText.innerText = "Start"; els.bDeckText.innerText = "";
        gameState.isCountDown = false; gameState.playerPass = false; gameState.botPass = false;
    }

    function runBotCycle() {
        if(gameState.gameOver) return;
        setTimeout(() => {
            let move = null;
            if(!gameState.botPass && !gameState.isCountDown) {
                for(let c of gameState.bot.cards.filter(c => c.isFaceUp)) {
                    if(isValid(c, gameState.centerLeft)) { move = {card:c, side:'left'}; break; }
                    if(isValid(c, gameState.centerRight)) { move = {card:c, side:'right'}; break; }
                }
            }

            if(move) {
                const botEls = Array.from(els.bBoundary.children);
                const idx = gameState.bot.cards.indexOf(move.card);
                const cardEl = botEls[idx];
                const targetEl = move.side === 'left' ? els.cLeft : els.cRight;

                flyCard(cardEl, targetEl, () => {
                    let currentCenter = move.side === 'left' ? gameState.centerLeft : gameState.centerRight;
                    if (!isValid(move.card, currentCenter)) { renderZone('bot'); return; }

                    gameState.bot.cards = gameState.bot.cards.filter(c => c.id !== move.card.id);
                    if(move.side === 'left' && gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
                    if(move.side === 'right' && gameState.centerRight) gameState.centerStack.push(gameState.centerRight);

                    if(move.side === 'left') gameState.centerLeft = move.card; else gameState.centerRight = move.card;
                    resetStalemate(); 
                    
                    let colCards = gameState.bot.cards.filter(c => c.col === move.card.col);
                    if(colCards.length > 0) {
                        let newTop = colCards[colCards.length - 1]; 
                        if(!newTop.isFaceUp && gameState.bot.cards.filter(c => c.isFaceUp).length < 4) newTop.isFaceUp = true;
                    }
                    renderAll(); checkWin();
                });
            } else {
                if(gameState.bot.cards.filter(c => c.isFaceUp).length < 4 && !gameState.botPass) {
                    const hidden = gameState.bot.cards.find(c => !c.isFaceUp);
                    if(hidden) { hidden.isFaceUp = true; resetStalemate(); renderZone('bot'); }
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
        // ROUND WIN = Foundation Empty
        if(gameState.player.cards.length === 0) endRound('player');
        if(gameState.bot.cards.length === 0) endRound('bot');
    }

    function endRound(winner) {
        if(gameState.gameOver) return;
        gameState.gameOver = true;
        
        let winnerDeck = winner === 'player' ? gameState.player.deck : gameState.bot.deck;

        // MATCH VICTORY CHECK: Foundation Cleared AND No Cards in Draw Deck
        if(winnerDeck.length === 0) {
            endMatch(winner === 'player' ? "YOU CLEARED ALL CARDS! MATCH WIN!" : "BOT CLEARED ALL CARDS! MATCH LOST!");
            return;
        }

        // ROUND VICTORY: Winner keeps only their Draw Deck
        let centerCards = [...gameState.centerStack];
        if(gameState.centerLeft) centerCards.push(gameState.centerLeft);
        if(gameState.centerRight) centerCards.push(gameState.centerRight);
        
        let loserFound = winner === 'player' ? gameState.bot.cards : gameState.player.cards;
        let loserDraw = winner === 'player' ? gameState.bot.deck : gameState.player.deck;

        let pDeckNext, bDeckNext;

        if(winner === 'player') {
            pDeckNext = [...gameState.player.deck]; 
            bDeckNext = [...loserFound, ...loserDraw, ...centerCards]; 
            els.overlayTitle.innerText = "ROUND WON!";
            els.overlayDesc.innerText = `You keep ${pDeckNext.length} cards. Bot takes the rest.`;
        } else {
            bDeckNext = [...gameState.bot.deck];
            pDeckNext = [...loserFound, ...loserDraw, ...centerCards];
            els.overlayTitle.innerText = "ROUND LOST";
            els.overlayDesc.innerText = `Bot keeps ${bDeckNext.length} cards. You take the pile.`;
        }

        els.overlay.classList.remove('hidden');
        els.btnAction.innerText = "NEXT ROUND";
        els.btnAction.onclick = () => {
            startGameWithDecks(pDeckNext, bDeckNext);
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
