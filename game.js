document.addEventListener('DOMContentLoaded', () => {
    
    // === CONFIG & CONSTANTS ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    
    // Difficulty Settings (Reaction Time in ms)
    let difficulty = parseInt(localStorage.getItem('slapsDifficulty')) || 5;
    const getAiSpeed = () => {
        let baseSpeed = 3000 - (difficulty * 250); // Lvl 5 = 1750ms
        return Math.max(600, baseSpeed + Math.random() * 500);
    };

    // Global State
    let gameState = {
        player: { deck: [], foundation: [[],[],[],[]], sidePot: [] }, // 4 Columns (Rule D.2.2)
        bot: { deck: [], foundation: [[],[],[],[]], sidePot: [] },
        centerLeft: null, centerRight: null,
        centerStack: [],
        gameActive: false,
        countdownActive: false,
        slapLocked: false,
        scores: { pRounds: 0, bRounds: 0, pSlaps: 0, bSlaps: 0 }
    };

    let lastBotMove = 0;
    let draggedCard = null; // For physics engine

    // DOM Elements
    const els = {
        pZone: document.getElementById('player-zone'),
        bZone: document.getElementById('bot-zone'),
        cLeft: document.getElementById('center-left'),
        cRight: document.getElementById('center-right'),
        pDeck: document.getElementById('player-deck'),
        bDeck: document.getElementById('bot-deck'),
        pDeckText: document.getElementById('player-deck-text'),
        bDeckText: document.getElementById('bot-deck-text'),
        overlay: document.getElementById('game-overlay'),
        slapAlert: document.getElementById('slap-alert'),
        countP: document.getElementById('count-player'),
        countB: document.getElementById('count-bot')
    };

    // === INITIALIZATION ===
    function initGame() {
        // 1. Create & Deal 52 Cards
        let deck = createDeck();
        // Give 26 to each
        let pHand = deck.slice(0, 26);
        let bHand = deck.slice(26, 52);
        
        // Tag Owners (Critical for Counter)
        pHand.forEach(c => c.owner = 'player');
        bHand.forEach(c => c.owner = 'bot');

        // 2. Build Foundations (4 Piles: 1, 2, 3, 4 cards) [Rule D.2.2]
        buildFoundation(gameState.player, pHand);
        buildFoundation(gameState.bot, bHand);

        gameState.gameActive = false; // Waiting for start
        gameState.slapLocked = false;
        
        renderAll();
        updateStats();
        
        // Reset Visuals
        els.overlay.classList.add('hidden');
        els.pDeckText.innerText = "START";
        els.bDeckText.innerText = "AI";
    }

    function createDeck() {
        return SUITS.flatMap(s => VALUES.map(v => ({
            suit: s, value: v, 
            rank: VALUES.indexOf(v) + 1,
            color: (s === "♥" || s === "♦") ? "red" : "black",
            id: Math.random().toString(36).substr(2, 9),
            isFaceUp: false
        }))).sort(() => Math.random() - 0.5);
    }

    function buildFoundation(playerObj, cards) {
        // Pattern: 4 piles of 4, 3, 2, 1
        let pattern = [4, 3, 2, 1]; 
        let cardIdx = 0;
        
        playerObj.foundation = [[], [], [], []]; // Clear
        playerObj.deck = []; // Clear

        // Fill Foundations
        pattern.forEach((count, colIdx) => {
            for(let i=0; i<count; i++) {
                if(cardIdx < cards.length) {
                    let card = cards[cardIdx++];
                    card.isFaceUp = (i === count - 1); // Only top face up [Rule D.2.3]
                    playerObj.foundation[colIdx].push(card);
                }
            }
        });

        // Remainder goes to Deck [Rule D.4.1]
        while(cardIdx < cards.length) {
            let c = cards[cardIdx++];
            c.isFaceUp = false;
            playerObj.deck.push(c);
        }
    }

    // === RENDER ENGINE (Smart DOM) ===
    function renderAll() {
        renderFoundation('player');
        renderFoundation('bot');
        renderCenter(els.cLeft, gameState.centerLeft);
        renderCenter(els.cRight, gameState.centerRight);
    }

    function renderFoundation(who) {
        let container = who === 'player' ? els.pZone : els.bZone;
        let foundation = who === 'player' ? gameState.player.foundation : gameState.bot.foundation;
        
        // Ensure 4 columns exist
        if(container.children.length === 0) {
            for(let i=0; i<4; i++) {
                let col = document.createElement('div');
                col.className = 'pile-group';
                col.style.width = '110px'; 
                container.appendChild(col);
            }
        }

        // Render Cards in Columns
        Array.from(container.children).forEach((colEl, colIdx) => {
            let pile = foundation[colIdx];
            colEl.innerHTML = ''; // Clear column
            
            pile.forEach((card, i) => {
                let el = createCardEl(card);
                // Stagger vertically
                el.style.top = (i * 25) + 'px'; 
                // Z-Index for stacking
                el.style.zIndex = i;
                
                // Add Drag Logic ONLY for Player's Top Face-Up Cards
                if(who === 'player' && card.isFaceUp && i === pile.length - 1) {
                    enableDrag(el, card, colIdx);
                }
                
                colEl.appendChild(el);
            });
        });
    }

    function renderCenter(slotEl, card) {
        slotEl.innerHTML = '';
        if(card) {
            card.isFaceUp = true;
            let el = createCardEl(card);
            el.style.top = '0'; 
            slotEl.appendChild(el);
        }
    }

    function createCardEl(card) {
        let el = document.createElement('div');
        el.className = `playing-card ${card.isFaceUp ? '' : 'face-down'}`;
        el.id = card.id;
        if(card.isFaceUp) {
            el.style.color = card.color === 'red' ? '#d9534f' : '#292b2c';
            el.innerHTML = `
                <div class="card-top">${card.value}</div>
                <div class="card-mid">${card.suit}</div>
                <div class="card-bot">${card.value}</div>
            `;
        }
        return el;
    }

    // === INTERACTION (Physics) ===
    function enableDrag(el, card, sourceColIdx) {
        el.onmousedown = (e) => {
            if(!gameState.gameActive) return; // Cant play before start
            e.preventDefault();
            
            draggedCard = card;
            let startX = e.clientX; 
            let startY = e.clientY;
            let rect = el.getBoundingClientRect();
            
            // Create specific dragging clone (smooth visual)
            let clone = el.cloneNode(true);
            clone.style.position = 'fixed';
            clone.style.zIndex = 9999;
            clone.style.left = rect.left + 'px';
            clone.style.top = rect.top + 'px';
            clone.style.pointerEvents = 'none'; // Let clicks pass through
            document.body.appendChild(clone);
            
            // Hide original
            el.style.opacity = '0';

            const onMove = (em) => {
                let dx = em.clientX - startX;
                let dy = em.clientY - startY;
                clone.style.left = (rect.left + dx) + 'px';
                clone.style.top = (rect.top + dy) + 'px';
            };

            const onUp = (eu) => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                clone.remove();
                
                // Hit Detection
                if(isOver(eu, els.cLeft) && isValidPlay(card, gameState.centerLeft)) {
                    playCard('player', sourceColIdx, 'left');
                } else if(isOver(eu, els.cRight) && isValidPlay(card, gameState.centerRight)) {
                    playCard('player', sourceColIdx, 'right');
                } else {
                    // Invalid drop -> Reset
                    el.style.opacity = '1';
                }
                draggedCard = null;
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }

    function isOver(e, targetEl) {
        let r = targetEl.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }

    // === GAMEPLAY RULES ===
    function isValidPlay(card, centerCard) {
        if(!centerCard) return false;
        let diff = Math.abs(card.rank - centerCard.rank);
        // Rule D.6.2: +/- 1 or Ace(1) <-> King(13)
        return diff === 1 || diff === 12;
    }

    function playCard(who, colIdx, side) {
        let foundation = who === 'player' ? gameState.player.foundation : gameState.bot.foundation;
        let pile = foundation[colIdx];
        let card = pile.pop(); // Remove from foundation

        // Add to Center
        if(side === 'left') {
            if(gameState.centerLeft) gameState.centerStack.push(gameState.centerLeft);
            gameState.centerLeft = card;
        } else {
            if(gameState.centerRight) gameState.centerStack.push(gameState.centerRight);
            gameState.centerRight = card;
        }

        // Reveal card underneath [Rule D.2.7]
        if(pile.length > 0) {
            // Count total live cards (Rule D.3.1: Max 4 live)
            // Since we just played one, we can definitely flip the new top one
            pile[pile.length-1].isFaceUp = true;
        }

        updateStats();
        renderAll();
        
        // Check for Slaps & Win
        checkSlapCondition();
        checkWinCondition();
    }

    // === BOT LOGIC ===
    setInterval(() => {
        if(!gameState.gameActive || gameState.countdownActive || gameState.gameOver) return;
        
        let now = Date.now();
        if(now - lastBotMove < getAiSpeed()) return;

        // 1. Check for Moves
        let botFound = gameState.bot.foundation;
        let moveMade = false;

        for(let colIdx=0; colIdx<4; colIdx++) {
            let pile = botFound[colIdx];
            if(pile.length === 0) continue;
            
            let card = pile[pile.length-1];
            if(!card.isFaceUp) {
                // Flip if allowed (Rule D.3.1)
                // Simply: if it's the top card and hidden, flip it
                card.isFaceUp = true;
                moveMade = true;
                renderAll();
                break;
            }

            // Try to play
            if(isValidPlay(card, gameState.centerLeft)) {
                playCard('bot', colIdx, 'left');
                moveMade = true;
                break;
            }
            if(isValidPlay(card, gameState.centerRight)) {
                playCard('bot', colIdx, 'right');
                moveMade = true;
                break;
            }
        }

        if(moveMade) lastBotMove = now;
        
        // 2. Check for Slap (Bot reflexes)
        if(isSlapCondition()) {
            let reflex = 1000 + Math.random()*500; // Bot reaction
            setTimeout(() => performSlap('bot'), reflex);
        }

        // 3. Check for Stalemate
        // (Simplified: if bot hasn't moved in a while and player isn't moving, try to signal wait)
        // ... handled by player click ...

    }, 200);

    // === SLAPS (Rule F) ===
    function isSlapCondition() {
        if(!gameState.centerLeft || !gameState.centerRight) return false;
        // Rule F.2.1: Same Rank
        return gameState.centerLeft.rank === gameState.centerRight.rank;
    }

    function checkSlapCondition() {
        if(isSlapCondition() && !gameState.slapLocked) {
            // Wait for input
        }
    }

    function performSlap(who) {
        if(!isSlapCondition() || gameState.slapLocked) return;
        gameState.slapLocked = true;

        // Visuals
        els.slapAlert.innerText = who === 'player' ? "YOU SLAPPED!" : "AI SLAPPED!";
        els.slapAlert.style.display = 'block';
        setTimeout(() => els.slapAlert.style.display = 'none', 1500);

        // Logic [Rule F.7]
        let loser = who === 'player' ? 'bot' : 'player';
        let wonCards = [...gameState.centerStack, gameState.centerLeft, gameState.centerRight];
        
        // Transfer ownership
        wonCards.forEach(c => c.owner = loser); 
        
        // Add to side pot
        if(loser === 'player') gameState.player.sidePot.push(...wonCards);
        else gameState.bot.sidePot.push(...wonCards);

        // Clear center
        gameState.centerLeft = null; 
        gameState.centerRight = null;
        gameState.centerStack = [];

        renderAll();
        updateStats();
        
        // Resume game (Need new reveal)
        setTimeout(() => startCountdown(), 1500);
    }

    // === START / RESTART / BORROW ===
    els.pDeck.addEventListener('click', () => {
        if(gameState.gameOver) return;
        
        // 1. Start of Game
        if(!gameState.gameActive && !gameState.centerLeft) {
            startCountdown();
            return;
        }

        // 2. Stalemate Restart
        if(gameState.gameActive) {
            // Toggle visual state
            els.pDeck.classList.add('waiting');
            els.pDeckText.innerText = "WAITING...";
            
            // Sim bot agreement delay
            setTimeout(() => startCountdown(), 1000);
        }
    });

    function startCountdown() {
        gameState.countdownActive = true;
        gameState.slapLocked = false;
        els.pDeck.classList.remove('waiting');
        
        let count = 3;
        let timer = setInterval(() => {
            els.pDeckText.innerText = count;
            els.bDeckText.innerText = count;
            count--;
            
            if(count < 0) {
                clearInterval(timer);
                els.pDeckText.innerText = "";
                els.bDeckText.innerText = "";
                executeReveal();
                gameState.gameActive = true;
                gameState.countdownActive = false;
            }
        }, 600);
    }

    function executeReveal() {
        // [Rule G] Borrowing Logic
        let pDeck = gameState.player.deck;
        let bDeck = gameState.bot.deck;

        // Handle Shortage: If empty, steal from opponent [Rule G.3.2]
        if(pDeck.length === 0 && bDeck.length > 0) pDeck.push(bDeck.pop());
        if(bDeck.length === 0 && pDeck.length > 0) bDeck.push(pDeck.pop());

        // Play cards
        let pCard = pDeck.pop();
        let bCard = bDeck.pop();

        if(pCard) gameState.centerRight = pCard; // Player plays to Right
        if(bCard) gameState.centerLeft = bCard;  // Bot plays to Left

        renderAll();
        updateStats();
        checkSlapCondition();
    }

    // === SCORING & END ===
    function updateStats() {
        // Count Logic: Foundation + Deck + SidePot
        const count = (pObj) => {
            let fCount = pObj.foundation.flat().length;
            let dCount = pObj.deck.length;
            let sCount = pObj.sidePot.length;
            return fCount + dCount + sCount;
        };

        let pTotal = count(gameState.player);
        let bTotal = count(gameState.bot);

        els.countP.innerText = pTotal;
        els.countB.innerText = bTotal;

        // Borrow Labels [Rule G.3.4]
        els.pBorrow.classList.toggle('borrow-active', gameState.player.deck.length === 0);
        els.bBorrow.classList.toggle('borrow-active', gameState.bot.deck.length === 0);
    }

    function checkWinCondition() {
        // Rule H.2.1: Game ends when Foundation is empty
        let pEmpty = gameState.player.foundation.flat().length === 0;
        let bEmpty = gameState.bot.foundation.flat().length === 0;

        if(pEmpty || bEmpty) {
            endGame(pEmpty ? 'player' : 'bot');
        }
    }

    function endGame(winner) {
        gameState.gameOver = true;
        gameState.gameActive = false;
        
        let msg = winner === 'player' ? "YOU WON THE ROUND!" : "AI WON THE ROUND!";
        els.overlay.querySelector('h1').innerText = msg;
        els.overlay.classList.remove('hidden');

        // Logic for next round (Combine sidepot into deck) would go here
        document.getElementById('btn-next-round').onclick = () => location.reload(); // Simple reload for now
    }

    // BOOT
    initGame();
});
