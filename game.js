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
        if (!gameState.gameActive) return;

        const now = Date.now();
        if (now - gameState.lastSpacebarTime < 400) { return; }
        gameState.lastSpacebarTime = now;

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
    const minTime = 3000 - ((diff - 1) * 280); 
    const maxTime = 5000 - ((diff - 1) * 450);
    const reaction = Math.random() * (maxTime - minTime) + minTime;
    
    setTimeout(() => {
        if (gameState.slapActive && gameState.gameActive) resolveSlap('ai');
    }, reaction);
}

function resolveSlap(winner) {
    gameState.slapActive = false;
    gameState.gameActive = false; 
    
    const overlay = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    overlay.classList.remove('hidden');
    
    const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

    if (winner === 'player') {
        txt.innerText = "PLAYER SLAPS WON!";
        overlay.style.backgroundColor = "rgba(0, 200, 0, 0.9)"; 
        gameState.aiTotal += pilesTotal;
        gameState.p1Slaps++; 
    } else {
        txt.innerText = "AI SLAPS WON!";
        overlay.style.backgroundColor = "rgba(200, 0, 0, 0.9)"; 
        gameState.playerTotal += pilesTotal;
        gameState.aiSlaps++; 
    }

    gameState.centerPileLeft = []; gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    
    updateScoreboard();
    updateScoreboardWidget();

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
function startRound() {
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

    // RESET BORROW TAGS ON NEW ROUND
    document.getElementById('borrowed-player').classList.add('hidden');
    document.getElementById('borrowed-ai').classList.add('hidden');

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
        } else {
            clearInterval(timer);
            overlay.classList.add('hidden');

            gameState.countdownRunning = false;
            performReveal();
        }
    }, 800);
}

// --- FIXED REVEAL & SCORING LOGIC ---
function performReveal() {
    if (!gameState.drawLock) return;

    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    
    // 1. Check for Shortage & Borrow (Move Cards)
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
    
    // 2. SCORING FIX: The "Ownership" Rule
    // If Player is borrowing, they are using AI's cards -> AI loses the point
    const playerBorrowing = !document.getElementById('borrowed-player').classList.contains('hidden');
    const aiBorrowing = !document.getElementById('borrowed-ai').classList.contains('hidden');

    if (playerBorrowing) {
        gameState.aiTotal--; // AI pays for Player's card
    } else {
        gameState.playerTotal--; // Player pays for own card
    }

    if (aiBorrowing) {
        gameState.playerTotal--; // Player pays for AI's card
    } else {
        gameState.aiTotal--; // AI pays for own card
    }

    // 3. Render Cards
    if (gameState.playerDeck.length > 0) { let pCard = gameState.playerDeck.pop(); gameState.centerPileRight.push(pCard); renderCenterPile('right', pCard); }
    if (gameState.aiDeck.length > 0) { let aCard = gameState.aiDeck.pop(); gameState.centerPileLeft.push(aCard); renderCenterPile('left', aCard); }
    
    checkDeckVisibility(); 
    updateScoreboard();
    
    gameState.gameActive = true; 
    gameState.playerReady = false; 
    gameState.aiReady = false;
    
        checkSlapCondition();
    if (!gameState.aiLoopRunning) startAILoop();

    gameState.drawLock = false;
}

function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    const img = document.createElement('img'); img.src = card.imgSrc; img.className = 'game-card'; 
    img.style.left = '50%'; img.style.top = '50%';
    const rot = Math.random() * 20 - 10; img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    container.appendChild(img);
}

function startAILoop() { gameState.aiLoopRunning = true; setInterval(() => { if (!gameState.gameActive || gameState.aiProcessing) return; attemptAIMove(); }, 250); }
// --- ADVANCED AI BEHAVIOUR ---

function attemptAIMove() {
    const diff = gameState.difficulty;
    const minTime = 5000 + (diff - 1) * -500; 
    const maxTime = 7000 + (diff - 1) * -600; 
    let reactionDelay = Math.random() * (maxTime - minTime) + minTime;
    
    // AI acts faster if it's in the middle of a combo
    if (gameState.aiInChain) reactionDelay *= 0.5;

    const activeCards = gameState.aiHand.filter(c => c.isFaceUp);
    
    // 1. EVALUATE ALL POSSIBLE MOVES
    let possibleMoves = [];

    // Check every face-up card against both piles
    for (let card of activeCards) {
        if (checkPileLogic(card, gameState.centerPileLeft)) {
            possibleMoves.push(scoreMove(card, 'left'));
        }
        if (checkPileLogic(card, gameState.centerPileRight)) {
            possibleMoves.push(scoreMove(card, 'right'));
        }
    }

    // 2. SORT BY SCORE (Descending)
    possibleMoves.sort((a, b) => b.score - a.score);

    // 3. EXECUTE BEST MOVE
    if (possibleMoves.length > 0) {
        const bestMove = possibleMoves[0];

        // If the best move has a negative score (Defensive Hold), 
        // we might choose to do NOTHING to force a stalemate.
        if (bestMove.score < -500) {
            // However, we still check if we have hidden cards to reveal (Blocker logic below)
            // If no hidden cards, we truly stall.
        } else {
            gameState.aiProcessing = true;
            setTimeout(() => {
                if (!gameState.gameActive) { gameState.aiProcessing = false; return; }
                
                // Re-verify legality (game state might have changed during delay)
                let targetPile = (bestMove.target === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
                if (!checkPileLogic(bestMove.card, targetPile)) { gameState.aiProcessing = false; return; }

                animateAIMove(bestMove.card, bestMove.target, () => {
                    const laneIdx = bestMove.card.laneIndex;
                    let success = playCardToCenter(bestMove.card, bestMove.card.element, bestMove.target);
                    
                    if (success) {
                        gameState.aiInChain = true;
                        // Flip next card in lane
                        const laneCards = gameState.aiHand.filter(c => c.laneIndex === laneIdx);
                        if (laneCards.length > 0) {
                            const newTop = laneCards[laneCards.length - 1];
                            if (!newTop.isFaceUp) setCardFaceUp(newTop.element, newTop, 'ai');
                        }
                    } else {
                        animateSnapBack(bestMove.card);
                        gameState.aiInChain = false;
                    }
                    gameState.aiProcessing = false;
                });
            }, reactionDelay);
            return; // Exit, we found a move
        }
    }

    // 4. FALLBACK: HANDLE HIDDEN CARDS / BLOCKERS (If no face-up moves)
    // (This logic remains effectively the same as your original, just reorganized)
    gameState.aiInChain = false;
    
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

    // 5. DRAW DECK LOGIC (If totally stuck)
    if (possibleMoves.length === 0) {
        const hiddenCardsLeft = gameState.aiHand.filter(c => !c.isFaceUp).length;
        if (activeCards.length === 4 || hiddenCardsLeft === 0) {
            if (!gameState.aiReady) {
                gameState.aiProcessing = true;
                setTimeout(() => {
                    // Check one last time before committing ready
                    const freshActive = gameState.aiHand.filter(c => c.isFaceUp);
                    const canMoveNow = freshActive.some(c => checkPileLogic(c, gameState.centerPileLeft) || checkPileLogic(c, gameState.centerPileRight));
                    
                    if (canMoveNow) { gameState.aiProcessing = false; return; }
                    
                    gameState.aiReady = true;
                    document.getElementById('ai-draw-deck').classList.add('deck-ready');
                    gameState.aiProcessing = false;
                    checkDrawCondition();
                }, 1000 + reactionDelay);
            }
        }
    }
}

// --- INTELLIGENT SCORING SYSTEM ---
function scoreMove(card, targetSide) {
    let score = 0;
    
    // Simulate the Chain: How many cards can AI play in a row starting with this one?
    // And what is the FINAL card of that chain?
    const chainResult = calculateChain(card, targetSide);
    const cardsInChain = chainResult.count;
    const finalCardValue = chainResult.finalValue;
    const finalCardRank = chainResult.finalRank;

    // --- 1. COMBO PRIORITY ---
    // Base score is getting rid of cards. More cards = better.
    score += (cardsInChain * 100);

    // --- 2. SLAP SETUP PRIORITY ---
    // Does the move (or the chain) result in the two piles matching?
    const otherPile = (targetSide === 'left') ? gameState.centerPileRight : gameState.centerPileLeft;
    if (otherPile.length > 0) {
        const otherTop = otherPile[otherPile.length - 1];
        if (otherTop.rank === finalCardRank) {
            score += 2000; // MASSIVE bonus for setting up a slap
        }
    }

    // --- 3. WIN CONDITION OVERRIDE ---
    // If playing this chain empties hand, ignore all defense.
    if (gameState.aiHand.length - cardsInChain <= 0) {
        score += 10000; 
        return { card, target: targetSide, score }; 
    }

    // --- 4. DEFENSIVE / STALEMATE LOGIC ---
    // "Do not play cards which will allow me to win a round"
    
    // Only care if AI has > 3 cards. If AI is desperate (<3), it plays aggressively.
    if (gameState.aiHand.length > 3) {
        
        // Check Player's visible cards
        const playerVisible = gameState.playerHand.filter(c => c.isFaceUp);
        
        // Condition A: Player has 2 or fewer cards left (High Danger)
        if (gameState.playerHand.length <= 2) {
            // Does my move allow ANY player card to be played?
            // My move puts 'finalCardValue' on top. 
            // Player needs 'finalCardValue +/- 1'.
            const helpsPlayer = playerVisible.some(pc => {
                const diff = Math.abs(pc.value - finalCardValue);
                return (diff === 1 || diff === 12);
            });

            if (helpsPlayer) {
                score -= 5000; // Do not do this.
            }
        }
        
        // Condition B: Player has 4 or fewer cards (Chain Danger)
        // "If I have 2 cards that link eg a 6 and a 7"
        else if (gameState.playerHand.length <= 4) {
            // Check if player has a "Link" (two cards separated by 1)
            // e.g. Player has 6 and 7. They want a 5 or 8.
            // If I play a 5, they play 6 then 7. That is bad.
            
            // 1. Find links in player hand
            // Sort visible values
            let pValues = playerVisible.map(c => c.value).sort((a,b) => a-b);
            
            for(let val of pValues) {
                // If I play 'finalCardValue', does it bridge to 'val'?
                const diff = Math.abs(val - finalCardValue);
                if (diff === 1 || diff === 12) {
                    // This allows player to play 'val'.
                    // Does 'val' have a subsequent link in player's hand?
                    // e.g. I play 5. Player plays 6. Does Player have 7?
                    const nextValHigh = (val === 13) ? 1 : val + 1;
                    const nextValLow  = (val === 1) ? 13 : val - 1;
                    
                    const hasChain = pValues.includes(nextValHigh) || pValues.includes(nextValLow);
                    
                    if (hasChain) {
                        score -= 2000; // Strong penalty for enabling a player chain
                    }
                }
            }
        }
    }

    return { card, target: targetSide, score };
}

// Helper to look ahead in AI's own hand
function calculateChain(startCard, targetSide) {
    let count = 1;
    let currentVal = startCard.value;
    let currentRank = startCard.rank;
    
    // Get other face-up AI cards (excluding the one we are playing)
    // We sort them so we can find potential chains
    let available = gameState.aiHand.filter(c => c.isFaceUp && c !== startCard);
    
    let keepChaining = true;
    while(keepChaining) {
        // Look for card +/- 1 from currentVal
        let nextCardIndex = available.findIndex(c => {
            const diff = Math.abs(c.value - currentVal);
            return (diff === 1 || diff === 12);
        });
        
        if (nextCardIndex !== -1) {
            // Found a card to continue chain
            count++;
            let nextCard = available[nextCardIndex];
            currentVal = nextCard.value;
            currentRank = nextCard.rank;
            // Remove from available so we don't count it twice
            available.splice(nextCardIndex, 1); 
        } else {
            keepChaining = false;
        }
    }
    
    return { count, finalValue: currentVal, finalRank: currentRank };
}

function isTopOffPile(card) { 
    let cardsInLane = gameState.aiHand.filter(c => c.laneIndex === card.laneIndex); 
    return cardsInLane[cardsInLane.length - 1] === card; 
}
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
    if (card.owner === 'player') {
        gameState.playerHand = gameState.playerHand.filter(c => c !== card); 
        gameState.playerTotal--; 
        if (gameState.playerTotal <= 0) { showEndGame("YOU WIN THE MATCH!", true); return true; }
        if (gameState.playerHand.length === 0) endRound('player');
    } else {
        gameState.aiHand = gameState.aiHand.filter(c => c !== card); 
        gameState.aiTotal--; 
        if (gameState.aiTotal <= 0) { showEndGame("AI WINS THE MATCH!", false); return true; }
        if (gameState.aiHand.length === 0) endRound('ai');
    }

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
