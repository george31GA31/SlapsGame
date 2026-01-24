/* =========================================
   SLAPS ENGINE v14.0 - STRICT COUNTING RULES
   ========================================= */

const gameState = {
    playerDeck: [],
    aiDeck: [],
    playerHand: [],
    aiHand: [],
    centerPileLeft: [],
    centerPileRight: [],
    
    // SCORE TRACKING (Simple integer counters)
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
    
    // FORCE START: 26-26
    gameState.playerTotal = 26;
    gameState.aiTotal = 26;
    
    startRound();
};

// --- ROUND LOGIC ---
function startRound() {
    let fullDeck = createDeck();
    shuffle(fullDeck);

    // WIN CONDITION: Immediate check
    if (gameState.playerTotal <= 0) { showEndGame("YOU WIN THE MATCH!", true); return; }
    if (gameState.aiTotal <= 0) { showEndGame("AI WINS THE MATCH!", false); return; }

    const pTotal = gameState.playerTotal;
    const pAllCards = fullDeck.slice(0, pTotal);
    const aAllCards = fullDeck.slice(pTotal, 52);

    const pHandSize = Math.min(10, pTotal);
    const aHandSize = Math.min(10, 52 - pTotal);

    const pHandCards = pAllCards.splice(0, pHandSize);
    gameState.playerDeck = pAllCards; 
    
    const aHandCards = aAllCards.splice(0, aHandSize);
    gameState.aiDeck = aAllCards;

    // BORROW CHECK
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 1) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        gameState.playerDeck = gameState.aiDeck.splice(0, steal);
        document.getElementById('borrowed-player').classList.remove('hidden');
    }
    
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 1) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        gameState.aiDeck = gameState.playerDeck.splice(0, steal);
        document.getElementById('borrowed-ai').classList.remove('hidden');
    }

    dealSmartHand(pHandCards, 'player');
    dealSmartHand(aHandCards, 'ai');
    
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    document.getElementById('game-message').classList.add('hidden');

    checkDeckVisibility();
    gameState.gameActive = false;
    updateScoreboard();
}
function dealSmartHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 

    if (owner === 'player') gameState.playerHand = [];
    else gameState.aiHand = [];

    const piles = [[], [], [], []];
    if (cards.length >= 10) {
        let cardIdx = 0;
        [4, 3, 2, 1].forEach((size, i) => {
            for (let j=0; j<size; j++) piles[i].push(cards[cardIdx++]);
        });
    } else {
        let pileIdx = 0;
        cards.forEach(card => {
            piles[pileIdx].push(card);
            pileIdx = (pileIdx + 1) % 4; 
        });
    }

    let currentLeftPercent = 5; 
    piles.forEach((pile, laneIdx) => {
        if (pile.length === 0) { currentLeftPercent += 24; return; }

        pile.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card'; 
            card.owner = owner; 
            card.laneIndex = laneIdx; 

            const isTopCard = (index === pile.length - 1);
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

// --- CORE FUNCTIONS ---
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

// --- SCOREBOARD: SIMPLE INTEGER DISPLAY ---
function updateScoreboard() {
    // No calculations here. Just display the Life Counter.
    document.getElementById('score-player').innerText = gameState.playerTotal;
    document.getElementById('score-ai').innerText = gameState.aiTotal;
}

function checkDeckVisibility() {
    // We no longer hide the deck. It stays visible.
    // The "BORROWED" text will indicate status.
    document.getElementById('player-draw-deck').classList.remove('hidden');
    document.getElementById('ai-draw-deck').classList.remove('hidden');
}
function endRound(winner) {
    gameState.gameActive = false;
    
    // SCORE CARRY OVER:
    // The winner keeps their CURRENT Score.
    // The loser takes the rest (52 - WinnerScore).
    
    if (winner === 'player') {
        // Player wins round. 
        // gameState.playerTotal IS ALREADY CORRECT (it has been decrementing all game)
        // We just need to calculate AI's new total for next round (remainder).
        gameState.aiTotal = 52 - gameState.playerTotal;
        showRoundMessage("ROUND WON!", `You start next round with ${gameState.playerTotal} cards.`);
    } else {
        // AI wins round.
        gameState.playerTotal = 52 - gameState.aiTotal;
        showRoundMessage("ROUND LOST!", `AI starts next round with ${gameState.aiTotal} cards.`);
    }
}

// --- CARD HELPERS ---
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

// --- REVEAL SEQUENCE ---
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

    // 1. TRIGGER BORROWING (Physical Move)
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const stealAmount = Math.floor(gameState.aiDeck.length / 2);
        const stolen = gameState.aiDeck.splice(0, stealAmount);
        gameState.playerDeck = gameState.playerDeck.concat(stolen);
        document.getElementById('borrowed-player').classList.remove('hidden');
    }

    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const stealAmount = Math.floor(gameState.playerDeck.length / 2);
        const stolen = gameState.playerDeck.splice(0, stealAmount);
        gameState.aiDeck = gameState.aiDeck.concat(stolen);
        document.getElementById('borrowed-ai').classList.remove('hidden');
    }

    // 2. APPLY SCORING RULES (Based on Persistent Status)
    // We check the CLASS, because the deck might have cards now, but they are borrowed.
    const isPlayerBorrowing = !document.getElementById('borrowed-player').classList.contains('hidden');
    const isAiBorrowing = !document.getElementById('borrowed-ai').classList.contains('hidden');

    if (isPlayerBorrowing) {
        // Player is borrowing: AI pays 2, Player pays 0
        gameState.aiTotal -= 2;
    } else if (isAiBorrowing) {
        // AI is borrowing: Player pays 2, AI pays 0
        gameState.playerTotal -= 2;
    } else {
        // Normal: Both pay 1
        gameState.playerTotal--;
        gameState.aiTotal--;
    }

    // 3. EXECUTE REVEAL
    if (gameState.playerDeck.length > 0) {
        let pCard = gameState.playerDeck.pop();
        gameState.centerPileRight.push(pCard);
        renderCenterPile('right', pCard);
    }
    if (gameState.aiDeck.length > 0) {
        let aCard = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(aCard);
        renderCenterPile('left', aCard);
    }

    checkDeckVisibility();
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
    }, 250); 
}

function attemptAIMove() {
    // ADJUSTED SPEED: Level 1 is now significantly slower (5-7 seconds)
    const diff = gameState.difficulty;
    const minTime = 5000 + (diff - 1) * -500; // L1: 5000ms, L10: ~500ms
    const maxTime = 7000 + (diff - 1) * -600; // L1: 7000ms, L10: ~1600ms
    
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
            // Stale Check
            let targetPile = (bestMove.t === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
            if (!checkPileLogic(bestMove.c, targetPile)) { gameState.aiProcessing = false; return; }

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

    // 2. SORT (Blocker Logic)
    if (activeCards.length < 4) {
        let lanes = [[], [], [], []];
        gameState.aiHand.forEach(c => lanes[c.laneIndex].push(c));
        let blockerInfo = null;
        let emptyLaneIndex = -1;
        for (let i = 0; i < 4; i++) { if (lanes[i].length === 0) emptyLaneIndex = i; }

        if (emptyLaneIndex !== -1) {
            for (let i = 0; i < 4; i++) {
                let pile = lanes[i];
                if (pile.length > 1) {
                    let top = pile[pile.length - 1];
                    let below = pile[pile.length - 2];
                    if (top.isFaceUp && !below.isFaceUp) { blockerInfo = { card: top, oldLane: i }; break; }
                }
            }
        }

        if (blockerInfo) {
            gameState.aiProcessing = true;
            setTimeout(() => {
                animateAIMoveToLane(blockerInfo.card, emptyLaneIndex, () => {
                    blockerInfo.card.laneIndex = emptyLaneIndex;
                    let pile = lanes[blockerInfo.oldLane];
                    let revealedCard = pile[pile.length - 2]; 
                    setCardFaceUp(revealedCard.element, revealedCard, 'ai');
                    gameState.aiProcessing = false;
                });
            }, reactionDelay * 0.8);
            return;
        }

        const simpleHidden = gameState.aiHand.find(c => !c.isFaceUp && isTopOffPile(c));
        if (simpleHidden) {
            gameState.aiProcessing = true;
            setTimeout(() => {
                setCardFaceUp(simpleHidden.element, simpleHidden, 'ai');
                gameState.aiProcessing = false;
            }, reactionDelay * 0.5); 
            return;
        }
    }

    // 3. DRAW
    const hiddenCardsLeft = gameState.aiHand.filter(c => !c.isFaceUp).length;
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

function isTopOffPile(card) {
    let cardsInLane = gameState.aiHand.filter(c => c.laneIndex === card.laneIndex);
    return cardsInLane[cardsInLane.length - 1] === card;
}

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
    el.style.transition = 'all 0.4s ease-in-out'; 
    requestAnimationFrame(() => {
        const destX = targetRect.left + (targetRect.width / 2) - (startRect.width / 2);
        const destY = targetRect.top + (targetRect.height / 2) - (startRect.height / 2);
        el.style.left = destX + 'px';
        el.style.top = destY + 'px';
        el.style.transform = 'rotate(0deg)'; 
    });
    setTimeout(() => { callback(); }, 400); 
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

function animateAIMoveToLane(card, laneIdx, callback) {
    const el = card.element;
    const leftPercent = AI_LANES[laneIdx];
    el.style.transition = 'all 0.5s ease';
    el.style.left = `${leftPercent}%`;
    el.style.top = '10px'; 
    el.style.zIndex = 10;  
    setTimeout(() => { callback(); }, 500);
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
            if (newTop < 0) { if (!gameState.gameActive || !checkLegalPlay(cardData)) newTop = 0; }
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
                if (!success) { img.style.left = cardData.originalLeft; img.style.top = cardData.originalTop; }
            }
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

function checkLegalPlay(card) {
    if (!gameState.gameActive) return false;
    return checkPileLogic(card, gameState.centerPileLeft) || checkPileLogic(card, gameState.centerPileRight);
}

function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false;
    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);
    return (diff === 1 || diff === 12);
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
            gameState.playerTotal--; 
            
            // IMMEDIATE MATCH WIN CHECK
            if (gameState.playerTotal <= 0) {
                showEndGame("YOU WIN THE MATCH!", true);
                return true; 
            }
            
            if (gameState.playerHand.length === 0) endRound('player');

        } else {
            gameState.aiHand = gameState.aiHand.filter(c => c !== card);
            gameState.aiTotal--; 
            
            // IMMEDIATE MATCH WIN CHECK
            if (gameState.aiTotal <= 0) {
                showEndGame("AI WINS THE MATCH!", false);
                return true; 
            }
            
            if (gameState.aiHand.length === 0) endRound('ai');
        }

        gameState.playerReady = false;
        gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');

        checkDeckVisibility();
        imgElement.remove(); 
        renderCenterPile(side, card); 
        updateScoreboard();
        return true; 
    }
    return false; 
}
// UI HELPERS
function showRoundMessage(title, sub) {
    const modal = document.getElementById('game-message');
    modal.querySelector('h1').innerText = title;
    modal.querySelector('p').innerText = sub;
    
    // THE FIX: Explicitly wire the button to startRound() every time
    const btn = document.getElementById('msg-btn');
    btn.innerText = "CONTINUE";
    btn.onclick = function() {
        startRound();
    };
    
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
