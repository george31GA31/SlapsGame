document.addEventListener('DOMContentLoaded', () => {
    
    // === CONFIG ===
    const SUITS = ["♠", "♥", "♣", "♦"];
    const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    
    let difficultyLevel = parseInt(localStorage.getItem('slapsDifficulty')) || 5;
    let botReactionTime = Math.max(800, 3000 - (difficultyLevel * 250));
    
    const botNames = ["ROOKIE", "NOVICE", "AMATEUR", "INTERMEDIATE", "SKILLED", "GOOD", "ADVANCED", "PROVEN", "MASTER", "UNBEATABLE"];
    document.getElementById('bot-name-display').innerText = botNames[difficultyLevel - 1];

    let gameState = {
        player: { drawDeck: [], foundations: [[], [], [], []] },
        bot: { drawDeck: [], foundations: [[], [], [], []] },
        centerLeft: null,
        centerRight: null,
        isGameOver: false
    };

    const els = {
        playerFoundations: [document.getElementById('player-found-4'), document.getElementById('player-found-3'), document.getElementById('player-found-2'), document.getElementById('player-found-1')],
        botFoundations: [document.getElementById('bot-found-4'), document.getElementById('bot-found-3'), document.getElementById('bot-found-2'), document.getElementById('bot-found-1')],
        centerLeft: document.getElementById('center-left'),
        centerRight: document.getElementById('center-right'),
        playerDeckCount: document.getElementById('player-deck-count'),
        botDeckCount: document.getElementById('bot-deck-count'),
        overlay: document.getElementById('game-overlay'),
        overlayTitle: document.getElementById('overlay-title'),
        overlayDesc: document.getElementById('overlay-desc')
    };

    class Card {
        constructor(suit, value) {
            this.suit = suit;
            this.value = value;
            this.rank = VALUES.indexOf(value) + 1; 
            this.color = (suit === "♥" || suit === "♦") ? "red" : "black";
            this.id = Math.random().toString(36).substr(2, 9);
            this.isFaceUp = true;
        }
        getHTML() {
            const faceClass = this.isFaceUp ? '' : 'face-down';
            return `
            <div class="playing-card ${faceClass}" id="${this.id}" style="color: ${this.color === 'red' ? '#d9534f' : '#292b2c'}">
                <div class="card-top">${this.value}</div>
                <div class="card-mid">${this.suit}</div>
                <div class="card-bot">${this.value}</div>
            </div>`;
        }
    }

    function initGame() {
        let fullDeck = shuffle(createDeck());
        let pHand = fullDeck.slice(0, 26);
        let bHand = fullDeck.slice(26, 52);
        distribute(pHand, gameState.player);
        distribute(bHand, gameState.bot);
        if(gameState.player.drawDeck.length > 0) gameState.centerLeft = gameState.player.drawDeck.pop();
        if(gameState.bot.drawDeck.length > 0) gameState.centerRight = gameState.bot.drawDeck.pop();
        renderBoard();
        startBotBrain(); 
        checkStalemateLoop();
    }
    function createDeck() { return SUITS.flatMap(suit => VALUES.map(value => new Card(suit, value))); }
    function shuffle(deck) { for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; } return deck; }
    function distribute(hand, entity) {
        let piles = [4, 3, 2, 1];
        for(let i=0; i<4; i++) {
            let stack = hand.splice(0, piles[i]);
            stack.forEach((card, index) => { card.isFaceUp = (index === stack.length - 1); });
            entity.foundations[i] = stack;
        }
        entity.drawDeck = hand;
    }

    // === ANIMATION FUNCTION ===
    function flyCard(startEl, targetEl, callback) {
        if(!startEl || !targetEl) { callback(); return; }
        const rectStart = startEl.getBoundingClientRect();
        const rectTarget = targetEl.getBoundingClientRect();

        // Create Clone
        const clone = startEl.cloneNode(true);
        clone.classList.add('flying-card');
        clone.style.left = rectStart.left + 'px';
        clone.style.top = rectStart.top + 'px';
        clone.style.width = rectStart.width + 'px';
        clone.style.height = rectStart.height + 'px';
        document.body.appendChild(clone);

        // Force Reflow
        void clone.offsetWidth;

        // Move
        clone.style.left = rectTarget.left + 'px';
        clone.style.top = rectTarget.top + 'px';

        setTimeout(() => {
            clone.remove();
            callback();
        }, 500); // Matches CSS transition time
    }

    // === BOT LOGIC ===
    function startBotBrain() {
        setInterval(() => {
            if (gameState.isGameOver) return;
            let possibleMoves = [], flipMoveIndex = -1, rearrangeMove = null, emptySlotIndex = -1;
            gameState.bot.foundations.forEach((pile, i) => { if(pile.length === 0) emptySlotIndex = i; });

            for (let i = 0; i < 4; i++) {
                let pile = gameState.bot.foundations[i];
                if (pile.length === 0) continue;
                let topCard = pile[pile.length - 1];
                if (!topCard.isFaceUp) { flipMoveIndex = i; break; }
                let targets = [{ name: 'left', card: gameState.centerLeft }, { name: 'right', card: gameState.centerRight }];
                targets.forEach(t => {
                    if (isValidMove(topCard, t.card)) possibleMoves.push({ pileIndex: i, target: t.name, isRisky: false });
                });
                if (emptySlotIndex !== -1 && pile.length > 1 && !pile[pile.length - 2].isFaceUp) rearrangeMove = { from: i, to: emptySlotIndex };
            }

            // EXECUTE
            if (flipMoveIndex !== -1) {
                setTimeout(() => {
                    gameState.bot.foundations[flipMoveIndex][gameState.bot.foundations[flipMoveIndex].length - 1].isFaceUp = true;
                    renderBoard();
                }, botReactionTime / 2);
                return;
            }

            let move = possibleMoves[0];
            if (move) {
                // Animate Bot Move
                const slot = els.botFoundations[move.pileIndex];
                const cardEl = slot.lastElementChild; // Top card
                const targetEl = move.target === 'left' ? els.centerLeft : els.centerRight;
                
                flyCard(cardEl, targetEl, () => {
                    playCard('bot', move.pileIndex, move.target);
                });
                return;
            }

            if (rearrangeMove && difficultyLevel > 4) {
                let card = gameState.bot.foundations[rearrangeMove.from].pop();
                gameState.bot.foundations[rearrangeMove.to].push(card);
                renderBoard();
            }

        }, botReactionTime);
    }

    // === RENDER ===
    function renderBoard() {
        renderCenterPile(els.centerLeft, gameState.centerLeft);
        renderCenterPile(els.centerRight, gameState.centerRight);
        els.playerDeckCount.innerText = gameState.player.drawDeck.length;
        els.botDeckCount.innerText = gameState.bot.drawDeck.length;

        // Render Player Stacks (Cascading)
        gameState.player.foundations.forEach((pile, index) => {
            const slot = els.playerFoundations[index];
            slot.innerHTML = '';
            pile.forEach((card, cardIndex) => {
                // Create HTML
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = card.getHTML();
                const cardEl = tempDiv.firstElementChild;
                
                // Cascade Position
                cardEl.style.top = (cardIndex * 25) + 'px'; 
                slot.appendChild(cardEl);

                // Interactions (Only allowed on top card if face up)
                if (cardIndex === pile.length - 1) {
                    if (card.isFaceUp) setupDragEvents(cardEl, card, index);
                    else cardEl.onclick = () => { card.isFaceUp = true; renderBoard(); };
                }
            });
            addBadge(slot, pile.length);
        });

        // Render Bot Stacks (Cascading)
        gameState.bot.foundations.forEach((pile, index) => {
            const slot = els.botFoundations[index];
            slot.innerHTML = '';
            pile.forEach((card, cardIndex) => {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = card.getHTML();
                const cardEl = tempDiv.firstElementChild;
                cardEl.style.top = (cardIndex * 25) + 'px';
                slot.appendChild(cardEl);
            });
            addBadge(slot, pile.length);
        });
        checkWinCondition();
    }

    function renderCenterPile(element, card) {
        element.innerHTML = '';
        if(card) {
            element.innerHTML = card.getHTML();
            let div = element.querySelector('.playing-card');
            if(div) { div.style.cursor = 'default'; div.style.position = 'relative'; div.classList.remove('face-down'); }
        }
    }
    function addBadge(slot, count) {
        let badge = document.createElement('div');
        badge.className = 'card-count-badge';
        badge.innerText = count;
        slot.appendChild(badge);
    }
    function isValidMove(card, centerCard) {
        if (!centerCard) return false;
        const diff = Math.abs(card.rank - centerCard.rank);
        return (diff === 1 || diff === 12);
    }
    function playCard(who, pileIndex, whichCenter) {
        let card = (who === 'player') ? gameState.player.foundations[pileIndex].pop() : gameState.bot.foundations[pileIndex].pop();
        if (whichCenter === 'left') gameState.centerLeft = card; else gameState.centerRight = card;
        renderBoard();
    }
    function checkWinCondition() {
        if (gameState.player.foundations.every(p => p.length === 0) && !gameState.isGameOver) endGame("VICTORY!", "You cleared your board!");
        if (gameState.bot.foundations.every(p => p.length === 0) && !gameState.isGameOver) endGame("DEFEAT", "The bot was faster.");
    }
    function endGame(title, desc) {
        gameState.isGameOver = true;
        els.overlayTitle.innerText = title;
        els.overlayDesc.innerText = desc;
        els.overlay.classList.remove('hidden');
    }
    
    // === DRAG & REARRANGE ===
    function setupDragEvents(element, cardObj, pileIndex) {
        let isDragging = false, startX, startY;
        element.addEventListener('mousedown', (e) => {
            e.preventDefault(); if (gameState.isGameOver || !cardObj.isFaceUp) return;
            isDragging = true; element.style.zIndex = 1000; element.style.position = 'fixed';
            const rect = element.getBoundingClientRect(); startX = e.clientX - rect.left; startY = e.clientY - rect.top;
            element.style.left = (e.clientX - startX) + 'px'; element.style.top = (e.clientY - startY) + 'px';
            function onMouseMove(moveEvent) { if (!isDragging) return; element.style.left = (moveEvent.clientX - startX) + 'px'; element.style.top = (moveEvent.clientY - startY) + 'px'; }
            function onMouseUp(upEvent) {
                isDragging = false; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
                
                // Check Moves
                if (isOverElement(upEvent, els.centerLeft) && isValidMove(cardObj, gameState.centerLeft)) playCard('player', pileIndex, 'left');
                else if (isOverElement(upEvent, els.centerRight) && isValidMove(cardObj, gameState.centerRight)) playCard('player', pileIndex, 'right');
                
                // Rearrange Check: Did we drop on an empty player slot?
                else {
                    let targetSlotIndex = els.playerFoundations.findIndex(slot => isOverElement(upEvent, slot));
                    if(targetSlotIndex !== -1 && targetSlotIndex !== pileIndex && gameState.player.foundations[targetSlotIndex].length === 0) {
                        // Move card to empty slot
                        gameState.player.foundations[pileIndex].pop();
                        gameState.player.foundations[targetSlotIndex].push(cardObj);
                        renderBoard();
                    } else {
                        renderBoard(); // Snap back
                    }
                }
            }
            document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
        });
    }
    function isOverElement(e, targetEl) { const rect = targetEl.getBoundingClientRect(); return (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom); }
    
    let lastMoveState = "";
    function checkStalemateLoop() {
        setInterval(() => {
            if (gameState.isGameOver) return;
            let currentTopCards = (gameState.centerLeft ? gameState.centerLeft.id : "") + (gameState.centerRight ? gameState.centerRight.id : "");
            if(currentTopCards === lastMoveState) {
                let movesPossible = false;
                [...gameState.player.foundations, ...gameState.bot.foundations].forEach(pile => {
                    if(pile.length > 0) { let c = pile[pile.length-1]; if((c.isFaceUp) && (isValidMove(c, gameState.centerLeft) || isValidMove(c, gameState.centerRight))) movesPossible = true; }
                });
                if(!movesPossible) { if (gameState.player.drawDeck.length > 0) gameState.centerLeft = gameState.player.drawDeck.pop(); if (gameState.bot.drawDeck.length > 0) gameState.centerRight = gameState.bot.drawDeck.pop(); renderBoard(); }
            }
            lastMoveState = currentTopCards;
        }, 3000);
    }
    initGame();
});
