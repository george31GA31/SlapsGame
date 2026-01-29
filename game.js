/* =========================================
   GAME.JS
   ========================================= */

const gameState = {
    playerDeck: [], aiDeck: [],
    playerHand: [], aiHand: [],
    centerPileLeft: [], centerPileRight: [],
    globalZ: 1000,
    playerTotal: 26, aiTotal: 26,

    gameActive: false,
    playerReady: false, aiReady: false,
    drawLock: false,
    countdownRunning: false,
    aiLoopRunning: false, aiProcessing: false, aiInChain: false,
    
    slapActive: false,
    lastSpacebarTime: 0,
    
    playerYellows: 0, playerReds: 0,
    aiYellows: 0, aiReds: 0,

    difficulty: 1,

    p1Rounds: 0, aiRounds: 0,
    p1Slaps: 0, aiSlaps: 0
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png'; 
const AI_LANES = [5, 29, 53, 77]; 

class Card {
    constructor(suit, rank, value) {
        this.suit = suit; this.rank = rank; this.value = value; 
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false; this.owner = null; 
        this.element = null; this.laneIndex = 0; 
    }
}

window.onload = function() {
    const storedDiff = localStorage.getItem('slapsDifficulty');
    if (storedDiff) gameState.difficulty = parseInt(storedDiff);
    gameState.playerTotal = 26; gameState.aiTotal = 26;
    
    document.addEventListener('keydown', handleInput);
    
    const pDeck = document.getElementById('player-draw-deck');
    if(pDeck) pDeck.onclick = handlePlayerDeckClick;

    updateScoreboardWidget();
    startRound(); 
};

function handleInput(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        
        // Game must be active (cards visible) to slap
        if (!gameState.gameActive) return;

        // --- ANTICIPATION RULE REMOVED ---
        // Every spacebar press counts immediately.
        
        if (!gameState.slapActive) { 
            issuePenalty('player', 'BAD SLAP'); 
            return; 
        }
        resolveSlap('player');
    }
}

function issuePenalty(target, reason) {
    let yellows;
    if (target === 'player') { gameState.playerYellows++; yellows = gameState.playerYellows; } 
    else { gameState.aiYellows++; yellows = gameState.aiYellows; }

    if (yellows >= 2) {
        if (target === 'player') { gameState.playerYellows = 0; gameState.playerReds++; }
        else { gameState.aiYellows = 0; gameState.aiReds++; }
        executeRedCardPenalty(target);
    }
    updatePenaltyUI();
}

function executeRedCardPenalty(offender) {
    const victim = (offender === 'player') ? 'ai' : 'player';
    let penaltyAmount = 3;
    
    let victimHand = (victim === 'player') ? gameState.playerHand : gameState.aiHand;
    let victimDeck = (victim === 'player') ? gameState.playerDeck : gameState.aiDeck;
    
    for (let i = 0; i < penaltyAmount; i++) {
        if (victimDeck.length > 0) { victimDeck.pop(); } 
        else if (victimHand.length > 0) {
            let cardToRemove = victimHand.pop();
            if (cardToRemove && cardToRemove.element) cardToRemove.element.remove();
        }
    }

    if (offender === 'player') {
        gameState.playerTotal += 3;
        gameState.aiTotal = Math.max(0, gameState.aiTotal - 3);
    } else {
        gameState.aiTotal += 3;
        gameState.playerTotal = Math.max(0, gameState.playerTotal - 3);
    }

    if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
    if (gameState.aiTotal <= 0) showEndGame("AI WINS THE MATCH!", false);

    updateScoreboard();
}

function updatePenaltyUI() {
    renderBadges('player', gameState.playerYellows, gameState.playerReds);
    renderBadges('ai', gameState.aiYellows, gameState.aiReds);
}

function renderBadges(who, y, r) {
    const container = document.getElementById(`${who}-penalties`);
    container.innerHTML = '';
    if (r > 0) {
        const div = document.createElement('div');
        div.className = 'card-icon icon-red';
        if (r > 1) div.innerText = r; 
        container.appendChild(div);
    }
    if (y > 0) {
        const div = document.createElement('div');
        div.className = 'card-icon icon-yellow';
        container.appendChild(div);
    }
}

function checkSlapCondition() {
    if (gameState.centerPileLeft.length === 0 || gameState.centerPileRight.length === 0) {
        gameState.slapActive = false;
        return;
    }
    const topL = gameState.centerPileLeft[gameState.centerPileLeft.length - 1];
    const topR = gameState.centerPileRight[gameState.centerPileRight.length - 1];
    if (topL.rank === topR.rank) {
        gameState.slapActive = true;
        triggerAISlap();
    } else {
        gameState.slapActive = false;
    }
}

function triggerAISlap() {
    const diff = gameState.difficulty;

    const minTime = 1200 - ((diff - 1) * 100); 
    const maxTime = 1800 - ((diff - 1) * 150);
    
    // Ensure we never go below human limit (approx 200ms)
    const safeMin = Math.max(200, minTime);
    const safeMax = Math.max(300, maxTime);

    const reaction = Math.random() * (safeMax - safeMin) + safeMin;
    
    setTimeout(() => {
        if (gameState.slapActive && gameState.gameActive) {
            resolveSlap('ai');
        }
    }, reaction);
}
function resolveSlap(winner) {
    gameState.slapActive = false;
    gameState.gameActive = false; 

    // --- SCENARIO 1 CHECK: Slap during Sudden Death? ---
    const isSuddenDeath = !document.getElementById('borrowed-player').classList.contains('hidden');
    
    // Calculate Pot Size
    const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

    // Award Cards
    if (winner === 'player') {
        gameState.aiTotal += pilesTotal; // Give pot to AI (Wait, standard rule is Winner takes?)
        // Standard Slap Rule: Winner TAKES the pile.
        // If Player Slaps, Player gets the cards added to their count?
        // Your code previously said: gameState.aiTotal += pilesTotal (for Player Win??)
        // CHECKING YOUR PREVIOUS CODE: 
        // "if (winner === 'player') { ... gameState.aiTotal += pilesTotal ... }"
        // This implies the LOSER picks up the cards?
        // Standard Slapjack: Winner keeps pile? Or Winner makes loser pick up?
        // Assuming your previous logic was "Loser picks up":
        
        gameState.aiTotal += pilesTotal; 
        gameState.p1Slaps++; 
    } else {
        gameState.playerTotal += pilesTotal;
        gameState.aiSlaps++; 
    }
    
    // Clear Visuals
    gameState.centerPileLeft = []; gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';

    // --- IF SUDDEN DEATH -> FORCE RESTART ---
    if (isSuddenDeath) {
        console.log("Slap during Sudden Death. Forcing Round Restart.");
        
        // We do NOT award a round point. We just restart with new totals.
        // The totals were updated above (Loser picked up cards).
        
        // Brief delay to see the slap color, then restart
        const overlay = document.getElementById('slap-overlay');
        const txt = document.getElementById('slap-text');
        overlay.classList.remove('hidden');
        txt.innerText = (winner === 'player') ? "PLAYER SLAPS! ROUND RESET" : "AI SLAPS! ROUND RESET";
        overlay.style.backgroundColor = (winner === 'player') ? "rgba(0, 200, 0, 0.9)" : "rgba(200, 0, 0, 0.9)";

        setTimeout(() => {
            overlay.classList.add('hidden');
            startRound(); // Restart immediately with new totals
        }, 1500);
        return; 
    }

    // --- NORMAL GAME CONTINUATION ---
    updateScoreboard();
    updateScoreboardWidget();

    const overlay = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    overlay.classList.remove('hidden');

    if (winner === 'player') {
        txt.innerText = "PLAYER SLAPS WON!";
        overlay.style.backgroundColor = "rgba(0, 200, 0, 0.9)"; 
    } else {
        txt.innerText = "AI SLAPS WON!";
        overlay.style.backgroundColor = "rgba(200, 0, 0, 0.9)"; 
    }

    setTimeout(() => {
        overlay.classList.add('hidden');
        gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');
        
        if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
        if (gameState.aiTotal <= 0) showEndGame("AI WINS THE MATCH!", false);
        
    }, 2000);
}
// --- STANDARD GAME ENGINE ---
unction startRound(oddCard = null) {
    let fullDeck = createDeck();
    shuffle(fullDeck);
    
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

   gameState.centerPileLeft = []; gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
   if (oddCard) {
        // Place in Left or Right? Let's assume Left for simplicity
        gameState.centerPileLeft.push(oddCard);
        renderCenterPile('left', oddCard);
    }
   
    // CHECK SHORTAGE AT START
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
    
    gameState.centerPileLeft = []; gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    document.getElementById('game-message').classList.add('hidden');
    gameState.slapActive = false;

    checkDeckVisibility();
    gameState.gameActive = false;
    updateScoreboard();
}

function dealSmartHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 
    if (owner === 'player') gameState.playerHand = []; else gameState.aiHand = [];

    const piles = [[], [], [], []];
    if (cards.length >= 10) {
        let cardIdx = 0;
        [4, 3, 2, 1].forEach((size, i) => {
            for (let j=0; j<size; j++) piles[i].push(cards[cardIdx++]);
        });
    } else {
        let pileIdx = 0;
        cards.forEach(card => { piles[pileIdx].push(card); pileIdx = (pileIdx + 1) % 4; });
    }

    let currentLeftPercent = 5; 
    piles.forEach((pile, laneIdx) => {
        if (pile.length === 0) { currentLeftPercent += 24; return; }
        pile.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card'; 
            card.owner = owner; card.laneIndex = laneIdx; 
            const isTopCard = (index === pile.length - 1);
            if (isTopCard) setCardFaceUp(img, card, owner); else setCardFaceDown(img, card, owner);
            img.style.left = `${currentLeftPercent}%`;
            let stackOffset = index * 5; 
            if (owner === 'ai') img.style.top = `${10 + stackOffset}px`; else img.style.top = `${60 - stackOffset}px`;
            img.style.zIndex = index + 10; 
            card.element = img; container.appendChild(img);
            if (owner === 'player') gameState.playerHand.push(card); else gameState.aiHand.push(card);
        });
        currentLeftPercent += 24;
    });
}

function createDeck() {
    let deck = [];
    SUITS.forEach(suit => { RANKS.forEach((rank, index) => { deck.push(new Card(suit, rank, index + 2)); }); });
    return deck;
}
function shuffle(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; } }
function updateScoreboard() { 
    document.getElementById('score-player').innerText = gameState.playerTotal; 
    document.getElementById('score-ai').innerText = gameState.aiTotal; 
}
function checkDeckVisibility() {
    document.getElementById('player-draw-deck').classList.remove('hidden');
    document.getElementById('ai-draw-deck').classList.remove('hidden');
}
function endRound(winner) {
    gameState.gameActive = false;
    if (winner === 'player') {
        gameState.aiTotal = 52 - gameState.playerTotal;
        gameState.p1Rounds++; 
        showRoundMessage("ROUND WON!", `You start next round with ${gameState.playerTotal} cards.`);
    } else {
        gameState.playerTotal = 52 - gameState.aiTotal;
        gameState.aiRounds++; 
        showRoundMessage("ROUND LOST!", `AI starts next round with ${gameState.aiTotal} cards.`);
    }
    updateScoreboardWidget();
}
function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc; img.classList.remove('card-face-down'); card.isFaceUp = true;
    if (owner === 'player') { img.classList.add('player-card'); img.onclick = null; makeDraggable(img, card); } else img.classList.add('opponent-card');
}
function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC; img.classList.add('card-face-down'); card.isFaceUp = false;
    if (owner === 'player') img.onclick = () => tryFlipCard(img, card);
}
function tryFlipCard(img, card) {
    const liveCards = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (liveCards < 4) setCardFaceUp(img, card, 'player');
}

function handlePlayerDeckClick() {
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;
        gameState.playerReady = true; document.getElementById('player-draw-deck').classList.add('deck-ready');
        setTimeout(() => { gameState.aiReady = true; document.getElementById('ai-draw-deck').classList.add('deck-ready'); checkDrawCondition(); }, 800);
        return;
    }
    if (gameState.gameActive && !gameState.playerReady) {
        gameState.playerReady = true; document.getElementById('player-draw-deck').classList.add('deck-ready'); checkDrawCondition();
    }
}
function checkDrawCondition() {
    if (gameState.drawLock || gameState.countdownRunning) return;

    if (gameState.playerReady && gameState.aiReady) {
        gameState.drawLock = true;
        setTimeout(() => startCountdown(), 50);
    }
}
function startCountdown() {
    if (gameState.countdownRunning) return;

    gameState.countdownRunning = true;
    gameState.gameActive = false;

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

            // PRELOAD AT 1
            if (count === 1) performRevealPreload();

        } else {
            clearInterval(timer);
            overlay.classList.add('hidden');

            gameState.countdownRunning = false;
            // SHOW AT 0
            performRevealShow();
        }
    }, 800);
}
// --- FIXED REVEAL & SCORING LOGIC ---
function performRevealPreload() {
    if (!gameState.drawLock) return;

    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    
    // 1. Check for Shortage & Borrow
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const stealAmount = Math.floor(gameState.aiDeck.length / 2);
        if (stealAmount > 0) {
            const stolen = gameState.aiDeck.splice(0, stealAmount);
            gameState.playerDeck = gameState.playerDeck.concat(stolen);
            document.getElementById('borrowed-player').classList.remove('hidden');
        }
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const stealAmount = Math.floor(gameState.playerDeck.length / 2);
        if (stealAmount > 0) {
            const stolen = gameState.playerDeck.splice(0, stealAmount);
            gameState.aiDeck = gameState.aiDeck.concat(stolen);
            document.getElementById('borrowed-ai').classList.remove('hidden');
        }
    }
    
    // 2. Scoring Logic
    const playerBorrowing = !document.getElementById('borrowed-player').classList.contains('hidden');
    const aiBorrowing = !document.getElementById('borrowed-ai').classList.contains('hidden');

    if (playerBorrowing) gameState.aiTotal--; else gameState.playerTotal--;
    if (aiBorrowing) gameState.playerTotal--; else gameState.aiTotal--;

    // 3. Render Cards (HIDDEN)
    if (gameState.playerDeck.length > 0) { 
        let pCard = gameState.playerDeck.pop(); 
        gameState.centerPileRight.push(pCard); 
        renderCenterPile('right', pCard, true); // true = hidden
    }
    if (gameState.aiDeck.length > 0) { 
        let aCard = gameState.aiDeck.pop(); 
        gameState.centerPileLeft.push(aCard); 
        renderCenterPile('left', aCard, true); // true = hidden
    }
    
    checkDeckVisibility(); 
    updateScoreboard();
}

function performRevealShow() {
    // 1. Show Hidden Cards
    const hiddenCards = document.querySelectorAll('.pending-reveal');
    hiddenCards.forEach(img => {
        img.style.opacity = '1';
        img.classList.remove('pending-reveal');
    });

    // 2. Activate Game
    gameState.gameActive = true; 
    gameState.playerReady = false; 
    gameState.aiReady = false;
    
    checkSlapCondition();
    if (!gameState.aiLoopRunning) startAILoop();

    gameState.drawLock = false;
}

function renderCenterPile(side, card, hidden = false) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    const img = document.createElement('img'); 
    img.src = card.imgSrc; 
    img.className = 'game-card'; 
    img.style.left = '50%'; 
    img.style.top = '50%';

    if (hidden) {
        img.style.opacity = '0';
        img.classList.add('pending-reveal');
        img.style.transition = 'opacity 0.1s ease-out';
    }

    const rot = Math.random() * 20 - 10; 
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    container.appendChild(img);
}
function startAILoop() { gameState.aiLoopRunning = true; setInterval(() => { if (!gameState.gameActive || gameState.aiProcessing) return; attemptAIMove(); }, 250); }

function attemptAIMove() {
    const diff = gameState.difficulty;
    
    // --- PLAY SPEED (Must be slower than Slap) ---
    // Level 1: ~3.0s
    // Level 10: ~1.0s
    
    const minTime = 3000 - ((diff - 1) * 200); 
    const maxTime = 4000 - ((diff - 1) * 250);
    
    const safeMin = Math.max(800, minTime);
    const safeMax = Math.max(1200, maxTime);

    let reactionDelay = Math.random() * (safeMax - safeMin) + safeMin;
    
    if (gameState.aiInChain) reactionDelay *= 0.5; // Fast combo play
    
    const activeCards = gameState.aiHand.filter(c => c.isFaceUp);
    let bestMove = null;

    // SAFETY VARIABLES
    const playerHasOne = (gameState.playerHand.length === 1);
    const aiHasMoreThanOne = (gameState.aiHand.length > 1);

    for (let card of activeCards) {
        // Check Left
        if (checkPileLogic(card, gameState.centerPileLeft)) {
            let isSafe = true;
            if (playerHasOne && aiHasMoreThanOne) {
                const pLast = gameState.playerHand[0];
                const diff = Math.abs(pLast.value - card.value);
                if (diff === 1 || diff === 12) isSafe = false; // Block unsafe move
            }
            if (isSafe) { bestMove = { c: card, t: 'left' }; break; }
        }

        // Check Right
        if (checkPileLogic(card, gameState.centerPileRight)) {
            let isSafe = true;
            if (playerHasOne && aiHasMoreThanOne) {
                const pLast = gameState.playerHand[0];
                const diff = Math.abs(pLast.value - card.value);
                if (diff === 1 || diff === 12) isSafe = false; // Block unsafe move
            }
            if (isSafe) { bestMove = { c: card, t: 'right' }; break; }
        }
    }

    if (bestMove) {
        gameState.aiProcessing = true;
        setTimeout(() => {
            if (!gameState.gameActive) { gameState.aiProcessing = false; return; }
            let targetPile = (bestMove.t === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
            if (!checkPileLogic(bestMove.c, targetPile)) { gameState.aiProcessing = false; return; }
            
            animateAIMove(bestMove.c, bestMove.t, () => {
                const laneIdx = bestMove.c.laneIndex;
                let success = playCardToCenter(bestMove.c, bestMove.c.element, bestMove.t);
                if (success) {
                    gameState.aiInChain = true;
                    const laneCards = gameState.aiHand.filter(c => c.laneIndex === laneIdx);
                    if (laneCards.length > 0) { const newTop = laneCards[laneCards.length - 1]; if (!newTop.isFaceUp) setCardFaceUp(newTop.element, newTop, 'ai'); }
                } else { animateSnapBack(bestMove.c); gameState.aiInChain = false; }
                gameState.aiProcessing = false;
            });
        }, reactionDelay);
        return;
    }

    // --- FALLBACK (Click Deck if No Safe Moves) ---
    if (!bestMove) {
        const hiddenCardsLeft = gameState.aiHand.filter(c => !c.isFaceUp).length;
        if (activeCards.length === 4 || hiddenCardsLeft === 0) {
            if (!gameState.aiReady) {
                gameState.aiProcessing = true;
                setTimeout(() => {
                    const freshActive = gameState.aiHand.filter(c => c.isFaceUp);
                    
                    // CHECK IF ANY MOVES EXIST (INCL SAFETY CHECK)
                    const canMoveNow = freshActive.some(c => {
                        const validL = checkPileLogic(c, gameState.centerPileLeft);
                        const validR = checkPileLogic(c, gameState.centerPileRight);
                        if (!validL && !validR) return false;

                        // Safety Check logic again
                        if (gameState.playerHand.length === 1 && gameState.aiHand.length > 1) {
                            const pLast = gameState.playerHand[0];
                            const diff = Math.abs(pLast.value - c.value);
                            if (diff === 1 || diff === 12) return false; // Still unsafe
                        }
                        return true;
                    });

                    if (!canMoveNow && !gameState.gameActive) { gameState.aiProcessing = false; return; }
                    
                    if (canMoveNow) { gameState.aiProcessing = false; return; } // Try again next loop

                    // Force Draw
                    gameState.aiReady = true; 
                    document.getElementById('ai-draw-deck').classList.add('deck-ready');
                    gameState.aiProcessing = false; 
                    checkDrawCondition();
                }, 1000 + reactionDelay);
            }
        }
    }

    gameState.aiInChain = false; 
    
    // AI Unblock Logic
    if (activeCards.length < 4) {
        let lanes = [[], [], [], []]; gameState.aiHand.forEach(c => lanes[c.laneIndex].push(c));
        let blockerInfo = null; let emptyLaneIndex = -1;
        for (let i = 0; i < 4; i++) { if (lanes[i].length === 0) emptyLaneIndex = i; }
        if (emptyLaneIndex !== -1) {
            for (let i = 0; i < 4; i++) {
                let pile = lanes[i];
                if (pile.length > 1) {
                    let top = pile[pile.length - 1]; let below = pile[pile.length - 2];
                    if (top.isFaceUp && !below.isFaceUp) { blockerInfo = { card: top, oldLane: i }; break; }
                }
            }
        }
        if (blockerInfo) {
            gameState.aiProcessing = true;
            setTimeout(() => {
                animateAIMoveToLane(blockerInfo.card, emptyLaneIndex, () => {
                    blockerInfo.card.laneIndex = emptyLaneIndex;
                    let pile = lanes[blockerInfo.oldLane]; let revealedCard = pile[pile.length - 2]; 
                    setCardFaceUp(revealedCard.element, revealedCard, 'ai'); gameState.aiProcessing = false;
                });
            }, reactionDelay * 0.8);
            return;
        }
        const simpleHidden = gameState.aiHand.find(c => !c.isFaceUp && isTopOffPile(c));
        if (simpleHidden) {
            gameState.aiProcessing = true; setTimeout(() => { setCardFaceUp(simpleHidden.element, simpleHidden, 'ai'); gameState.aiProcessing = false; }, reactionDelay * 0.5); return;
        }
    }
    
    // Secondary Check for Draw (just in case)
    const hiddenCardsLeft2 = gameState.aiHand.filter(c => !c.isFaceUp).length;
    if (!bestMove) {
        if (activeCards.length === 4 || hiddenCardsLeft2 === 0) {
            if (!gameState.aiReady) {
                gameState.aiProcessing = true;
                setTimeout(() => {
                    gameState.aiReady = true; document.getElementById('ai-draw-deck').classList.add('deck-ready');
                    gameState.aiProcessing = false; checkDrawCondition();
                }, 1000 + reactionDelay);
            }
        }
    }
}
function isTopOffPile(card) { let cardsInLane = gameState.aiHand.filter(c => c.laneIndex === card.laneIndex); return cardsInLane[cardsInLane.length - 1] === card; }
function animateAIMove(card, targetSide, callback) {
    const el = card.element; const targetId = targetSide === 'left' ? 'center-pile-left' : 'center-pile-right'; const targetEl = document.getElementById(targetId);
    const startRect = el.getBoundingClientRect(); const targetRect = targetEl.getBoundingClientRect();
    card.originalLeft = el.style.left; card.originalTop = el.style.top;
    const startLeft = startRect.left || 100; const startTop = startRect.top || 50;
    el.style.position = 'fixed'; el.style.left = startLeft + 'px'; el.style.top = startTop + 'px'; el.style.zIndex = 2000; el.style.transition = 'all 0.4s ease-in-out'; 
    requestAnimationFrame(() => {
        const destX = targetRect.left + (targetRect.width / 2) - (startRect.width / 2); const destY = targetRect.top + (targetRect.height / 2) - (startRect.height / 2);
        el.style.left = destX + 'px'; el.style.top = destY + 'px'; el.style.transform = 'rotate(0deg)'; 
    });
    setTimeout(() => { callback(); }, 400); 
}
function animateSnapBack(card) {
    const el = card.element; el.style.transition = 'none'; el.style.position = 'absolute'; el.style.left = card.originalLeft; el.style.top = card.originalTop; el.style.zIndex = 10; el.style.border = '2px solid red';
    setTimeout(() => { el.style.border = 'none'; }, 500);
}
function animateAIMoveToLane(card, laneIdx, callback) {
    const el = card.element; const leftPercent = AI_LANES[laneIdx];
    el.style.transition = 'all 0.5s ease'; el.style.left = `${leftPercent}%`; el.style.top = '10px'; el.style.zIndex = 10; setTimeout(() => { callback(); }, 500);
}
function getDropSide(imgElement, mouseEvent) {
    const leftPileEl = document.getElementById('center-pile-left');
    const rightPileEl = document.getElementById('center-pile-right');
    if (!leftPileEl || !rightPileEl) return null;

    // Use mouse position (more intuitive than card rect)
    const x = mouseEvent.clientX;
    const y = mouseEvent.clientY;

    const pad = 25; // tolerance so it is not pixel-perfect

    const l = leftPileEl.getBoundingClientRect();
    const r = rightPileEl.getBoundingClientRect();

    const inLeft =
        x >= (l.left - pad) && x <= (l.right + pad) &&
        y >= (l.top - pad) && y <= (l.bottom + pad);

    const inRight =
        x >= (r.left - pad) && x <= (r.right + pad) &&
        y >= (r.top - pad) && y <= (r.bottom + pad);

    if (inLeft) return 'left';
    if (inRight) return 'right';
    return null;
}
function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault(); gameState.globalZ++; img.style.zIndex = gameState.globalZ; img.style.transition = 'none'; 
        cardData.originalLeft = img.style.left; cardData.originalTop = img.style.top;
        let shiftX = e.clientX - img.getBoundingClientRect().left; let shiftY = e.clientY - img.getBoundingClientRect().top;
        const box = document.getElementById('player-foundation-area');
        function moveAt(pageX, pageY) {
            const boxRect = box.getBoundingClientRect(); let newLeft = pageX - shiftX - boxRect.left; let newTop = pageY - shiftY - boxRect.top;
            if (newTop < 0) { if (!gameState.gameActive || !checkLegalPlay(cardData)) newTop = 0; }
            img.style.left = newLeft + 'px'; img.style.top = newTop + 'px';
        }
        moveAt(e.pageX, e.pageY);
        function onMouseMove(event) { moveAt(event.pageX, event.pageY); }
        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
            img.style.transition = 'all 0.1s ease-out'; 
            if (gameState.gameActive && parseInt(img.style.top) < -10) {
    const dropSide = getDropSide(img, event); // 'left' | 'right' | null
    let success = playCardToCenter(cardData, img, dropSide);
    if (!success) { 
        img.style.left = cardData.originalLeft; 
        img.style.top = cardData.originalTop; 
    }
}
        }
        document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
    };
}
function checkLegalPlay(card) { if (!gameState.gameActive) return false; return checkPileLogic(card, gameState.centerPileLeft) || checkPileLogic(card, gameState.centerPileRight); }
function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false; const targetCard = targetPile[targetPile.length - 1]; const diff = Math.abs(card.value - targetCard.value); return (diff === 1 || diff === 12);
}
function playCardToCenter(card, imgElement, dropSide) {
    if (!gameState.gameActive) return false;

    // Must be dropped on a pile
    if (dropSide !== 'left' && dropSide !== 'right') return false;

    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    let target = null;
    let side = '';

    if (dropSide === 'left' && isLeftLegal) { target = gameState.centerPileLeft; side = 'left'; }
    if (dropSide === 'right' && isRightLegal) { target = gameState.centerPileRight; side = 'right'; }

    // No fallback to the other pile. If you dropped on the wrong one, it fails.
    if (!target) return false;

    // --- everything below here stays exactly as you already have it ---
    gameState.playerReady = false; 
    gameState.aiReady = false;
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');

    target.push(card);
// ... inside playCardToCenter ...

    target.push(card);
    
    // --- UPDATE HANDS ---
    if (card.owner === 'player') {
        gameState.playerHand = gameState.playerHand.filter(c => c !== card); 
        gameState.playerTotal--; 
    } else {
        gameState.aiHand = gameState.aiHand.filter(c => c !== card); 
        gameState.aiTotal--; 
    }

    // --- CHECK FOR SUDDEN DEATH TRIGGER (Rule G.7.4) ---
    // If both decks are empty, but the round is still going (hands not empty), split the center.
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length === 0) {
        // Only trigger if there are actually cards to scavenge
        if (gameState.centerPileLeft.length > 0 || gameState.centerPileRight.length > 0) {
            triggerSuddenDeathSplit();
        }
    }

    // --- CHECK FOR WIN / END ROUND ---
    const playerWin = (gameState.playerHand.length === 0 && gameState.playerDeck.length === 0);
    const aiWin = (gameState.aiHand.length === 0 && gameState.aiDeck.length === 0);

    if (playerWin) {
        // Are we in Sudden Death (Both Borrowing)?
        const isSuddenDeath = !document.getElementById('borrowed-player').classList.contains('hidden') 
                           && !document.getElementById('borrowed-ai').classList.contains('hidden');
        
        if (isSuddenDeath) {
            handleSuddenDeathWin('player');
        } else {
            // Normal Round Win logic or Match Win logic
            if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
            else endRound('player');
        }
        return true;
    }

    if (aiWin) {
        const isSuddenDeath = !document.getElementById('borrowed-player').classList.contains('hidden') 
                           && !document.getElementById('borrowed-ai').classList.contains('hidden');

        if (isSuddenDeath) {
            handleSuddenDeathWin('ai');
        } else {
            if (gameState.aiTotal <= 0) showEndGame("AI WINS THE MATCH!", false);
            else endRound('ai');
        }
        return true;
    }

    // Standard UI Updates
    checkDeckVisibility(); 
    imgElement.remove(); 
    renderCenterPile(side, card); 
    updateScoreboard();
    checkSlapCondition(); 
    return true;
}
function showRoundMessage(title, sub) {
    const modal = document.getElementById('game-message'); modal.querySelector('h1').innerText = title; modal.querySelector('p').innerText = sub;
    const btn = document.getElementById('msg-btn'); btn.innerText = "CONTINUE"; btn.onclick = function() { startRound(); };
    modal.classList.remove('hidden');
}
function showEndGame(title, isWin) {
    const modal = document.getElementById('game-message');
    modal.querySelector('h1').innerText = title;
    modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';
    
    const contentArea = modal.querySelector('p');
    contentArea.innerHTML = `
        <div style="display:flex; gap:10px; justify-content:center; margin-top:20px;">
            <button class="btn-action-small" onclick="location.reload()" style="background:#444; width:auto;">
                <i class="fa-solid fa-rotate-right"></i> REMATCH
            </button>
            <button class="btn-action-small" onclick="window.location.href='index.html'" style="background:#ff4444; width:auto;">
                MAIN MENU
            </button>
        </div>
    `;
    
    const oldBtn = document.getElementById('msg-btn');
    if(oldBtn) oldBtn.classList.add('hidden');
    
    modal.classList.remove('hidden');
}
function updateScoreboardWidget() {
    const p1Name = document.getElementById('sb-p1-name');
    const p2Name = document.getElementById('sb-p2-name');
    if(p1Name) p1Name.innerText = "You";
    if(p2Name) p2Name.innerText = "AI";

    const p1R = document.getElementById('sb-p1-rounds');
    const p2R = document.getElementById('sb-p2-rounds');
    const p1S = document.getElementById('sb-p1-slaps');
    const p2S = document.getElementById('sb-p2-slaps');

    if(p1R) p1R.innerText = gameState.p1Rounds;
    if(p2R) p2R.innerText = gameState.aiRounds;
    if(p1S) p1S.innerText = gameState.p1Slaps;
    if(p2S) p2S.innerText = gameState.aiSlaps;
}
/* =========================================
   RULE G.7.4: SIMULTANEOUS SHORTAGE LOGIC
   ========================================= */

function triggerSuddenDeathSplit() {
    // SCENARIO 2 CHECK: Are we ALREADY in Sudden Death?
    // If yes, this is the "Second Loop" (Stalemate).
    const isAlreadySuddenDeath = !document.getElementById('borrowed-player').classList.contains('hidden');

    if (isAlreadySuddenDeath) {
        console.log("Stalemate Detected (Double Shortage). Resetting Round...");
        triggerStalemateReset();
        return;
    }

    // --- NORMAL SUDDEN DEATH START (First Time) ---
    
    // 1. Collect all center cards
    const salvage = [...gameState.centerPileLeft, ...gameState.centerPileRight];
    
    // 2. Clear Center Piles
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    
    // 3. Shuffle & Split
    shuffle(salvage);
    const mid = Math.ceil(salvage.length / 2);
    gameState.playerDeck = salvage.slice(0, mid);
    gameState.aiDeck = salvage.slice(mid);
    
    // 4. Mark as BORROWED
    const bp = document.getElementById('borrowed-player');
    const ba = document.getElementById('borrowed-ai');
    
    bp.classList.remove('hidden');
    ba.classList.remove('hidden');
    
    checkDeckVisibility();
    
    // Flash message
    const modal = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    if (modal && txt) {
        txt.innerText = "SUDDEN DEATH!";
        modal.style.backgroundColor = "rgba(255, 165, 0, 0.9)";
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.add('hidden'), 1500);
    }
}
function triggerStalemateReset() {
    // 1. Collect the Pot (Center Piles)
    const pot = [...gameState.centerPileLeft, ...gameState.centerPileRight];
    
    // 2. Handle Odd Card (Discard to Center for NEXT round)
    let oddCard = null;
    if (pot.length % 2 !== 0) {
        oddCard = pot.pop(); // Remove 1 card to make it even
    }

    // 3. Split Evenly
    const half = pot.length / 2;
    
    // 4. Add to Totals (Foundation + Half Pot)
    // Note: We use the 'Total' variables because startRound() uses them to deal.
    // 'playerTotal' currently tracks hand size because decks are empty/borrowed.
    
    // We must ensure we are counting the PHYSICAL cards in hand + the split pot
    // The gameState.playerTotal should technically already reflect the hand size 
    // because we decrement it when playing, but let's be safe:
    
    const currentPHandSize = gameState.playerHand.length;
    const currentAHandSize = gameState.aiHand.length;
    
    gameState.playerTotal = currentPHandSize + half;
    gameState.aiTotal = currentAHandSize + half;

    // 5. Restart Round Immediately (No Points Awarded)
    // We pass the oddCard so startRound knows to place it
    startRound(oddCard);
}
function handleSuddenDeathWin(winner) {
    // Check for "Scenario 2" Penalties
    // A penalty exists if they have a Red Card pending OR Yellows (Bad Slap history)
    let hasPenalty = false;
    if (winner === 'player') {
        if (gameState.playerReds > 0 || gameState.playerYellows > 0) hasPenalty = true;
    } else {
        if (gameState.aiReds > 0 || gameState.aiYellows > 0) hasPenalty = true;
    }

    if (!hasPenalty) {
        // SCENARIO 1: CLEAN WIN -> MATCH OVER
        if (winner === 'player') showEndGame("YOU WIN THE MATCH!", true);
        else showEndGame("AI WINS THE MATCH!", false);
    } else {
        // SCENARIO 2: PENALTY CARRY-OVER
        // Winner survived, but starts next round with debt (3 cards)
        // Loser starts with the rest (49 cards)
        
        const PENALTY_COST = 3;
        
        if (winner === 'player') {
            gameState.playerTotal = PENALTY_COST;
            gameState.aiTotal = 52 - PENALTY_COST;
            showRoundMessage("SURVIVED!", `You cleared your hand but had penalties. You start with ${PENALTY_COST} cards.`);
        } else {
            gameState.aiTotal = PENALTY_COST;
            gameState.playerTotal = 52 - PENALTY_COST;
            showRoundMessage("OPPONENT SURVIVED", `Opponent cleared hand with penalties. They start with ${PENALTY_COST} cards.`);
        }
        
        // Reset Penalty Flags for next round
        gameState.playerReds = 0; gameState.playerYellows = 0;
        gameState.aiReds = 0; gameState.aiYellows = 0;
        updatePenaltyUI();
        
        // Stats update
        if (winner === 'player') gameState.p1Rounds++; else gameState.aiRounds++;
        updateScoreboardWidget();
    }
}
