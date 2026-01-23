/* =========================================
   SLAPS ENGINE v10.0 - ROUNDS, WINNING & BORROWING
   ========================================= */

const gameState = {
    playerDeck: [],
    aiDeck: [],
    playerHand: [],
    aiHand: [],
    centerPileLeft: [],
    centerPileRight: [],
    
    // SCORE TRACKING (Total cards owned for next round)
    playerTotal: 26,
    aiTotal: 26,

    gameActive: false,
    playerReady: false,
    aiReady: false,
    aiLoopRunning: false,
    
    draggedCard: null,
    globalZ: 100,
    difficulty: 1, 
    aiProcessing: false,
    aiInChain: false
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png'; 
const AI_LANES = [5, 29, 53, 77]; 

class Card {
    constructor(suit, rank, value) {
        this.suit = suit;
        this.rank = rank;
        this.value = value; 
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false;
        this.owner = null;
        this.element = null; 
        this.laneIndex = 0; 
    }
}

window.onload = function() {
    const storedDiff = localStorage.getItem('slapsDifficulty');
    if (storedDiff) gameState.difficulty = parseInt(storedDiff);
    
    // Start fresh match
    startRound();
};

// --- ROUND MANAGEMENT ---
function startRound() {
    // 1. Create fresh deck if it's the very first round, 
    //    OR recreate full deck to redistribute based on totals
    let fullDeck = createDeck();
    shuffle(fullDeck);

    // 2. Distribute based on Totals (Winner keeps draw deck, Loser takes rest logic is calculated at end)
    // Here we just deal the cards they currently OWN.
    
    // Check Match Win
    if (gameState.playerTotal <= 0) { showEndGame("YOU WIN THE MATCH!", true); return; }
    if (gameState.aiTotal <= 0) { showEndGame("AI WINS THE MATCH!", false); return; }

    gameState.playerDeck = fullDeck.slice(0, gameState.playerTotal);
    gameState.aiDeck = fullDeck.slice(gameState.playerTotal, 52);

    // 3. Deal Foundation (4-3-2-1)
    dealFoundation(gameState.playerDeck, 'player');
    dealFoundation(gameState.aiDeck, 'ai');
    
    // 4. Reset States
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    
    // Hide borrowed status
    document.getElementById('borrowed-player').classList.add('hidden');
    document.getElementById('borrowed-ai').classList.add('hidden');
    document.getElementById('game-message').classList.add('hidden');

    gameState.gameActive = false;
    updateScoreboard();
}

function endRound(winner) {
    gameState.gameActive = false;
    
    // LOGIC: 
    // Winner Total = Their Remaining Draw Deck
    // Loser Total = 52 - Winner Total
    
    let winnerRemaining = 0;
    
    if (winner === 'player') {
        winnerRemaining = gameState.playerDeck.length;
        gameState.playerTotal = winnerRemaining;
        gameState.aiTotal = 52 - winnerRemaining;
        
        showRoundMessage("ROUND WON!", `You kept ${winnerRemaining} cards. AI takes the rest.`);
    } else {
        winnerRemaining = gameState.aiDeck.length;
        gameState.aiTotal = winnerRemaining;
        gameState.playerTotal = 52 - winnerRemaining;
        
        showRoundMessage("ROUND LOST!", `AI kept ${winnerRemaining} cards. You take the rest.`);
    }
}

// Global function for the button
window.nextRound = function() {
    startRound();
};

function showRoundMessage(title, sub) {
    const modal = document.getElementById('game-message');
    modal.querySelector('h1').innerText = title;
    modal.querySelector('p').innerText = sub;
    modal.classList.remove('hidden');
}

function showEndGame(title, isWin) {
    const modal = document.getElementById('game-message');
    modal.querySelector('h1').innerText = title;
    modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';
    modal.querySelector('p').innerText = "Return to Menu to play again.";
    
    const btn = document.getElementById('msg-btn');
    btn.innerText = "MAIN MENU";
    btn.onclick = () => window.location.href = 'index.html';
    
    modal.classList.remove('hidden');
}

// --- STANDARD GAME FUNCTIONS ---
function createDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach((rank, index) => {
            deck.push(new Card(suit, rank, index + 2)); 
        });
    });
    return deck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function updateScoreboard() {
    // Current Cards = Hand + Deck
    const pCount = gameState.playerHand.length + gameState.playerDeck.length;
    const aCount = gameState.aiHand.length + gameState.aiDeck.length;
    
    document.getElementById('score-player').innerText = pCount;
    document.getElementById('score-ai').innerText = aCount;
}

function dealFoundation(deck, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 

    if (owner === 'player') gameState.playerHand = [];
    else gameState.aiHand = [];

    // Safety: If deck is too small for full setup, just lay what we have
    const pileSizes = [4, 3, 2, 1]; 
    let currentLeftPercent = 5; 

    pileSizes.forEach((size, laneIdx) => {
        if (deck.length === 0) return;
        
        // Take up to 'size' cards, but don't error if deck empty
        let actualSize = Math.min(size, deck.length);
        let pileCards = deck.splice(0, actualSize);
        
        pileCards.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card'; 
            card.owner = owner; 
            card.laneIndex = laneIdx; 

            // Top card is face up
            const isTopCard = (index === actualSize - 1);
            if (isTopCard) setCardFaceUp(img, card, owner);
            else setCardFaceDown(img, card, owner);

            img.style.left = `${currentLeftPercent}%`;
            
            let stackOffset = index * 5; 
            if (owner === 'ai') img.style.top = `${10 + stackOffset}px`;
            else img.style.top = `${60 - stackOffset}px`;
            img.style.zIndex = index + 10; 

            card.element = img;
            container.appendChild(img);
            
            if (owner === 'player') gameState.playerHand.push(card);
            else gameState.aiHand.push(card);
        });

        currentLeftPercent += 24; 
    });
}

function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc;
    img.classList.remove('card-face-down');
    card.isFaceUp = true;
    if (owner === 'player') {
        img.classList.add('player-card');
        img.onclick = null; 
        makeDraggable(img, card); 
    } else img.classList.add('opponent-card');
}

function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    card.isFaceUp = false;
    if (owner === 'player') img.onclick = () => tryFlipCard(img, card);
}

function tryFlipCard(img, card) {
    const liveCards = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (liveCards < 4) setCardFaceUp(img, card, 'player');
}

// --- REVEAL & BORROWING ---
function handlePlayerDeckClick() {
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;
        gameState.playerReady = true;
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        setTimeout(() => {
            gameState.aiReady = true;
            document.getElementById('ai-draw-deck').classList.add('deck-ready');
            startCountdown();
        }, 800);
        return;
    }
    if (gameState.gameActive && !gameState.playerReady) {
        gameState.playerReady = true; 
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        checkDrawCondition();
    }
}

function checkDrawCondition() {
    if (gameState.playerReady && gameState.aiReady) {
        setTimeout(() => startCountdown(), 500);
    }
}

function startCountdown() {
    const overlay = document.getElementById('countdown-overlay');
    overlay.classList.remove('hidden');
    let count = 3;
    overlay.innerText = count;

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.innerText = count;
            overlay.style.animation = 'none';
            overlay.offsetHeight; 
            overlay.style.animation = 'popIn 0.5s ease';
        } else {
            clearInterval(timer);
            overlay.classList.add('hidden');
            performReveal();
        }
    }, 800);
}

function performReveal() {
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');

    // --- BORROWING LOGIC ---
    let playerBorrowed = false;
    let aiBorrowed = false;

    // Check Player Shortage
    if (gameState.playerDeck.length === 0) {
        // Take half AI deck
        const stealAmount = Math.floor(gameState.aiDeck.length / 2);
        const stolen = gameState.aiDeck.splice(0, stealAmount);
        gameState.playerDeck = gameState.playerDeck.concat(stolen);
        document.getElementById('borrowed-player').classList.remove('hidden');
        playerBorrowed = true;
    }

    // Check AI Shortage
    if (gameState.aiDeck.length === 0) {
        const stealAmount = Math.floor(gameState.playerDeck.length / 2);
        const stolen = gameState.playerDeck.splice(0, stealAmount);
        gameState.aiDeck = gameState.aiDeck.concat(stolen);
        document.getElementById('borrowed-ai').classList.remove('hidden');
        aiBorrowed = true;
    }

    // --- EXECUTE REVEAL (Opponent pays 2 if borrowed) ---
    // Right Pile (Player Side)
    if (playerBorrowed) {
        // Player borrowed, so AI pays for this card
        if (gameState.aiDeck.length > 0) {
            let card = gameState.aiDeck.pop();
            gameState.centerPileRight.push(card);
            renderCenterPile('right', card);
        }
    } else {
        // Normal
        if (gameState.playerDeck.length > 0) {
            let card = gameState.playerDeck.pop();
            gameState.centerPileRight.push(card);
            renderCenterPile('right', card);
        }
    }

    // Left Pile (AI Side)
    if (aiBorrowed) {
        // AI borrowed, so Player pays for this card
        if (gameState.playerDeck.length > 0) {
            let card = gameState.playerDeck.pop();
            gameState.centerPileLeft.push(card);
            renderCenterPile('left', card);
        }
    } else {
        // Normal
        if (gameState.aiDeck.length > 0) {
            let card = gameState.aiDeck.pop();
            gameState.centerPileLeft.push(card);
            renderCenterPile('left', card);
        }
    }

    updateScoreboard();
    gameState.gameActive = true;
    gameState.playerReady = false;
    gameState.aiReady = false;
    
    if (!gameState.aiLoopRunning) startAILoop();
}

function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.className = 'game-card'; 
    img.style.left = '50%';
    img.style.top = '50%';
    const rot = Math.random() * 20 - 10;
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    container.appendChild(img);
}

// --- AI BRAIN ---
function startAILoop() {
    gameState.aiLoopRunning = true;
    setInterval(() => {
        if (!gameState.gameActive || gameState.aiProcessing) return;
        attemptAIMove();
    }, 500);
}

function attemptAIMove() {
    const diff = gameState.difficulty;
    const minTime = 3500 + (diff - 1) * -344; 
    const maxTime = 5500 + (diff - 1) * -444; 
    let reactionDelay = Math.random() * (maxTime - minTime) + minTime;

    if (gameState.aiInChain) reactionDelay *= 0.5;

    const activeCards = gameState.aiHand.filter(c => c.isFaceUp);

    // 1. PLAY CARD
    let bestMove = null;
    for (let card of activeCards) {
        if (checkPileLogic(card, gameState.centerPileLeft)) { bestMove = { c: card, t: 'left' }; break; }
        if (checkPileLogic(card, gameState.centerPileRight)) { bestMove = { c: card, t: 'right' }; break; }
    }

    if (bestMove) {
        gameState.aiProcessing = true; 
        setTimeout(() => {
            animateAIMove(bestMove.c, bestMove.t, () => {
                const laneIdx = bestMove.c.laneIndex; 
                let success = playCardToCenter(bestMove.c, bestMove.c.element);
                if (success) {
                    gameState.aiInChain = true; 
                    const laneCards = gameState.aiHand.filter(c => c.laneIndex === laneIdx);
                    if (laneCards.length > 0) {
                        const newTop = laneCards[laneCards.length - 1];
                        if (!newTop.isFaceUp) setCardFaceUp(newTop.element, newTop, 'ai');
                    }
                } else {
                    animateSnapBack(bestMove.c);
                    gameState.aiInChain = false;
                }
                gameState.aiProcessing = false; 
            });
        }, reactionDelay);
        return; 
    }

    gameState.aiInChain = false; 

    // 3. DRAW (Shortage Logic)
    // Draw if (No moves AND 4 cards up) OR (No moves AND No hidden cards left)
    const hiddenCardsLeft = gameState.aiHand.filter(c => !c.isFaceUp).length;
    
    // NOTE: If deck is empty, AI still needs to signal readiness to trigger the Borrow logic in performReveal
    if (!bestMove) {
        if (activeCards.length === 4 || hiddenCardsLeft === 0) {
            if (!gameState.aiReady) {
                gameState.aiProcessing = true;
                setTimeout(() => {
                    gameState.aiReady = true;
                    document.getElementById('ai-draw-deck').classList.add('deck-ready');
                    gameState.aiProcessing = false;
                    checkDrawCondition();
                }, 1000 + reactionDelay);
            }
        }
    }
}

// --- PHYSICS & ANIMATION ---
function animateAIMove(card, targetSide, callback) {
    const el = card.element;
    const targetId = targetSide === 'left' ? 'center-pile-left' : 'center-pile-right';
    const targetEl = document.getElementById(targetId);
    const startRect = el.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    
    card.originalLeft = el.style.left;
    card.originalTop = el.style.top;

    const startLeft = startRect.left || 100;
    const startTop = startRect.top || 50;

    el.style.position = 'fixed';
    el.style.left = startLeft + 'px';
    el.style.top = startTop + 'px';
    el.style.zIndex = 2000;
    el.style.transition = 'all 0.6s ease-in-out'; 

    requestAnimationFrame(() => {
        const destX = targetRect.left + (targetRect.width / 2) - (startRect.width / 2);
        const destY = targetRect.top + (targetRect.height / 2) - (startRect.height / 2);
        el.style.left = destX + 'px';
        el.style.top = destY + 'px';
        el.style.transform = 'rotate(0deg)'; 
    });

    setTimeout(() => { callback(); }, 600); 
}

function animateSnapBack(card) {
    const el = card.element;
    el.style.transition = 'none';
    el.style.position = 'absolute';
    el.style.left = card.originalLeft;
    el.style.top = card.originalTop;
    el.style.zIndex = 10;
    el.style.border = '2px solid red';
    setTimeout(() => { el.style.border = 'none'; }, 500);
}

function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault();
        gameState.globalZ++;
        img.style.zIndex = gameState.globalZ;
        img.style.transition = 'none'; 
        cardData.originalLeft = img.style.left;
        cardData.originalTop = img.style.top;
        let shiftX = e.clientX - img.getBoundingClientRect().left;
        let shiftY = e.clientY - img.getBoundingClientRect().top;
        const box = document.getElementById('player-foundation-area');
        
        function moveAt(pageX, pageY) {
            const boxRect = box.getBoundingClientRect();
            let newLeft = pageX - shiftX - boxRect.left;
            let newTop = pageY - shiftY - boxRect.top;
            if (newTop < 0) { 
                if (!gameState.gameActive || !checkLegalPlay(cardData)) newTop = 0; 
            }
            img.style.left = newLeft + 'px';
            img.style.top = newTop + 'px';
        }
        moveAt(e.pageX, e.pageY);
        function onMouseMove(event) { moveAt(event.pageX, event.pageY); }
        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            img.style.transition = 'all 0.1s ease-out'; 
            if (gameState.gameActive && parseInt(img.style.top) < -10) {
                let success = playCardToCenter(cardData, img);
                if (!success) {
                    img.style.left = cardData.originalLeft;
                    img.style.top = cardData.originalTop;
                }
            }
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

// --- RULES & WIN LOGIC ---
function checkLegalPlay(card) {
    if (!gameState.gameActive) return false;
    return checkPileLogic(card, gameState.centerPileLeft) || 
           checkPileLogic(card, gameState.centerPileRight);
}

function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false;
    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);
    if (diff === 1) return true;
    if (diff === 12) return true;
    return false;
}

function playCardToCenter(card, imgElement) {
    let target = null;
    let side = '';
    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    if (isLeftLegal) { target = gameState.centerPileLeft; side = 'left'; }
    else if (isRightLegal) { target = gameState.centerPileRight; side = 'right'; }

    if (target) {
        target.push(card);
        if (card.owner === 'player') {
            gameState.playerHand = gameState.playerHand.filter(c => c !== card);
            gameState.playerReady = false;
            document.getElementById('player-draw-deck').classList.remove('deck-ready');
            
            // CHECK WIN CONDITION
            if (gameState.playerHand.length === 0) {
                endRound('player');
            }
        } else {
            gameState.aiHand = gameState.aiHand.filter(c => c !== card);
            gameState.aiReady = false;
            document.getElementById('ai-draw-deck').classList.remove('deck-ready');
            
            // CHECK WIN CONDITION
            if (gameState.aiHand.length === 0) {
                endRound('ai');
            }
        }

        imgElement.remove(); 
        renderCenterPile(side, card); 
        updateScoreboard();
        return true; 
    }
    return false; 
}
