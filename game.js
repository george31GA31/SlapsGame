/* =========================================
   SLAPS ENGINE v12.0 - RULES, SHORTAGES & SCORING
   ========================================= */

const gameState = {
    playerDeck: [],
    aiDeck: [],
    playerHand: [],
    aiHand: [],
    centerPileLeft: [],
    centerPileRight: [],
    
    // SCORE TRACKING (Based on Ownership)
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
        this.owner = null; // 'player' or 'ai' (Tracks TRUE ownership)
        this.element = null; 
        this.laneIndex = 0; 
    }
}

window.onload = function() {
    const storedDiff = localStorage.getItem('slapsDifficulty');
    if (storedDiff) gameState.difficulty = parseInt(storedDiff);
    startRound();
};

// --- ROUND MANAGEMENT ---
function startRound() {
    let fullDeck = createDeck();
    shuffle(fullDeck);

    // WIN CONDITION: Check Match Win before starting round
    // Note: We check 'Total' which persists across rounds
    if (gameState.playerTotal <= 0) { showEndGame("YOU WIN THE MATCH!", true); return; }
    if (gameState.aiTotal <= 0) { showEndGame("AI WINS THE MATCH!", false); return; }

    // SHORTAGE CHECK AT START: 
    // If a player has < 10 cards, they borrow immediately
    let pCards = gameState.playerTotal;
    let aCards = gameState.aiTotal;

    gameState.playerDeck = [];
    gameState.aiDeck = [];
    
    // Distribute decks based on ownership totals
    // If Player has 12 total: 10 go to Hand, 2 go to Deck.
    
    // Calculate Foundations (Max 10)
    const pFoundationSize = Math.min(10, pCards);
    const aFoundationSize = Math.min(10, aCards);

    // Initial Split from Full Deck based on totals
    // (In a real game, you keep your specific cards, but redealing for engine simplicity is fine)
    const pAllCards = fullDeck.slice(0, pCards);
    const aAllCards = fullDeck.slice(pCards, 52); // Rest go to AI

    // Split into Hand/Deck
    // Player
    const pHandCards = pAllCards.splice(0, pFoundationSize);
    gameState.playerDeck = pAllCards; // Leftovers go to deck
    
    // AI
    const aHandCards = aAllCards.splice(0, aFoundationSize);
    gameState.aiDeck = aAllCards; // Leftovers go to deck

    // --- SHORTAGE LOGIC (START OF ROUND) ---
    // If deck is empty (Total <= 10), borrow immediately
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

    // Deal
    dealSpecificHand(pHandCards, 'player');
    dealSpecificHand(aHandCards, 'ai');
    
    // Reset Center
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    
    document.getElementById('game-message').classList.add('hidden');

    checkDeckVisibility(); // Hide decks if empty
    gameState.gameActive = false;
    updateScoreboard();
}

function endRound(winner) {
    gameState.gameActive = false;
    // Recalculate Totals based on what's left
    // Winner keeps their Deck. Loser gets everything else?
    // Actually, rule is: "Winner takes their remaining draw deck. Loser takes everything else."
    
    // For simplicity in this engine: 
    // We count ownership of every card currently in lists.
    let pCount = 0;
    let aCount = 0;

    // Helper to count ownership in a list
    const countOwner = (list, who) => list.filter(c => c.owner === who).length;

    // If I win, I keep MY remaining cards. 
    // BUT the rule says "Winner takes their remaining draw deck".
    // This implies the winner sheds their foundation, and keeps ONLY their draw deck for next round?
    // Let's stick to the prompt: "Winner takes their remaining draw deck and the loser takes everything else."
    
    let nextRoundPTotal = 0;
    let nextRoundATotal = 0;

    if (winner === 'player') {
        // Player Wins
        nextRoundPTotal = gameState.playerDeck.length; // Keep only deck
        nextRoundATotal = 52 - nextRoundPTotal; // AI takes rest
        showRoundMessage("ROUND WON!", `You kept ${nextRoundPTotal} cards.`);
    } else {
        // AI Wins
        nextRoundATotal = gameState.aiDeck.length; // Keep only deck
        nextRoundPTotal = 52 - nextRoundATotal; // Player takes rest
        showRoundMessage("ROUND LOST!", `AI kept ${nextRoundATotal} cards.`);
    }

    gameState.playerTotal = nextRoundPTotal;
    gameState.aiTotal = nextRoundATotal;
}

window.nextRound = function() { startRound(); };

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

// --- NEW SCOREBOARD (OWNERSHIP BASED) ---
function updateScoreboard() {
    // Count ALL cards in game to find ownership
    const allLists = [
        gameState.playerHand, gameState.playerDeck,
        gameState.aiHand, gameState.aiDeck,
        gameState.centerPileLeft, gameState.centerPileRight
    ];
    
    let pCount = 0;
    let aCount = 0;

    // Iterate all active cards in play (Hand + Deck)
    // We do NOT count center pile cards towards the live score usually,
    // but the prompt says "Minus one each card we lay".
    // So Score = Active cards currently in Hand + Deck.
    
    [gameState.playerHand, gameState.playerDeck, gameState.aiHand, gameState.aiDeck].forEach(list => {
        list.forEach(c => {
            if (c.owner === 'player') pCount++;
            else if (c.owner === 'ai') aCount++;
        });
    });

    document.getElementById('score-player').innerText = pCount;
    document.getElementById('score-ai').innerText = aCount;
}

function checkDeckVisibility() {
    // If deck is empty, Hide it.
    if (gameState.playerDeck.length === 0) document.getElementById('player-draw-deck').classList.add('hidden');
    else document.getElementById('player-draw-deck').classList.remove('hidden');

    if (gameState.aiDeck.length === 0) document.getElementById('ai-draw-deck').classList.add('hidden');
    else document.getElementById('ai-draw-deck').classList.remove('hidden');
}

// --- DEALING HANDS ---
function dealSpecificHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 

    if (owner === 'player') gameState.playerHand = [];
    else gameState.aiHand = [];

    // Distribute into 4 piles max
    const pileSizes = [4, 3, 2, 1]; 
    let currentLeftPercent = 5; 
    let cardIdx = 0;

    pileSizes.forEach((size, laneIdx) => {
        if (cardIdx >= cards.length) return; // Out of cards

        let pileCount = 0;
        for (let i=0; i<size; i++) {
            if (cardIdx >= cards.length) break;
            
            let card = cards[cardIdx];
            cardIdx++;
            pileCount++;

            const img = document.createElement('img');
            img.className = 'game-card'; 
            card.owner = owner; // SET OWNERSHIP HERE
            card.laneIndex = laneIdx; 

            // Logic: The last card added to this pile is Face Up
            // But we need to know if this is the last card of the pile...
            // Simplified: If it's the 'size-th' card OR the last available card
            // Wait, we deal bottom-up. 
            // Correct logic: Set all to face down, then flip the last one of the pile.
            
            // Temporary Face Down
            setCardFaceDown(img, card, owner);

            img.style.left = `${currentLeftPercent}%`;
            let stackOffset = pileCount * 5; // adjusted for 0 index later
            if (owner === 'ai') img.style.top = `${10 + (pileCount-1)*5}px`;
            else img.style.top = `${60 - (pileCount-1)*5}px`;
            img.style.zIndex = (pileCount-1) + 10; 

            card.element = img;
            container.appendChild(img);
            
            if (owner === 'player') gameState.playerHand.push(card);
            else gameState.aiHand.push(card);
        }
        
        // Flip the top one of this lane
        if (owner === 'player') {
            const laneCards = gameState.playerHand.filter(c => c.laneIndex === laneIdx);
            if(laneCards.length>0) {
                const top = laneCards[laneCards.length-1];
                setCardFaceUp(top.element, top, owner);
            }
        } else {
            const laneCards = gameState.aiHand.filter(c => c.laneIndex === laneIdx);
            if(laneCards.length>0) {
                const top = laneCards[laneCards.length-1];
                setCardFaceUp(top.element, top, owner);
            }
        }

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
        // Visual feedback even if hidden, but it shouldn't be clicked if hidden.
        // The click listener is on the div.
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        setTimeout(() => {
            gameState.aiReady = true;
            document.getElementById('ai-draw-deck').classList.add('deck-ready');
            startCountdown();
        }, 800);
        return;
    }
    // In-game reveal
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

    // --- BORROWING LOGIC (AT STOPPAGE) ---
    // Rule: "When stoppage occurs and one player has no Draw Deck, opponent's Draw Deck is split"
    
    // Check Player Shortage
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const stealAmount = Math.floor(gameState.aiDeck.length / 2);
        const stolen = gameState.aiDeck.splice(0, stealAmount);
        gameState.playerDeck = gameState.playerDeck.concat(stolen);
        document.getElementById('borrowed-player').classList.remove('hidden');
    }

    // Check AI Shortage
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const stealAmount = Math.floor(gameState.playerDeck.length / 2);
        const stolen = gameState.playerDeck.splice(0, stealAmount);
        gameState.aiDeck = gameState.aiDeck.concat(stolen);
        document.getElementById('borrowed-ai').classList.remove('hidden');
    }

    // Show decks if they have cards now
    checkDeckVisibility();

    // --- EXECUTE REVEAL ---
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

    // Check again after popping
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

// --- AI BRAIN (ADJUSTED SPEED) ---
function startAILoop() {
    gameState.aiLoopRunning = true;
    setInterval(() => {
        if (!gameState.gameActive || gameState.aiProcessing) return;
        attemptAIMove();
    }, 250); 
}

function attemptAIMove() {
    // ADJUSTED MATH: Level 1 is now much slower
    const diff = gameState.difficulty;
    const minTime = 4500 + (diff - 1) * -450; // L1: 4500ms, L10: ~450ms
    const maxTime = 6500 + (diff - 1) * -550; // L1: 6500ms, L10: ~1500ms
    
    let reactionDelay = Math.random() * (maxTime - minTime) + minTime;
    if (gameState.aiInChain) reactionDelay *= 0.5;

    const activeCards = gameState.aiHand.filter(c => c.isFaceUp);

    // 1. PLAY
    let bestMove = null;
    for (let card of activeCards) {
        if (checkPileLogic(card, gameState.centerPileLeft)) { bestMove = { c: card, t: 'left' }; break; }
        if (checkPileLogic(card, gameState.centerPileRight)) { bestMove = { c: card, t: 'right' }; break; }
    }

    if (bestMove) {
        gameState.aiProcessing = true; 
        setTimeout(() => {
            let targetPile = (bestMove.t === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
            if (!checkPileLogic(bestMove.c, targetPile)) {
                gameState.aiProcessing = false; 
                return;
            }

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

    // 2. SORT
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
                    if (top.isFaceUp && !below.isFaceUp) {
                        blockerInfo = { card: top, oldLane: i };
                        break;
                    }
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
    // Condition: No Moves AND (Board Full OR No Hidden Cards)
    if (!bestMove) {
        if (activeCards.length === 4 || hiddenCardsLeft === 0) {
            if (!gameState.aiReady) {
                gameState.aiProcessing = true;
                setTimeout(() => {
                    gameState.aiReady = true;
                    // Note: If deck hidden, this doesn't visually matter, but state updates
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

// --- ANIMATION ---
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

// --- PLAYER PHYSICS ---
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
            
            checkDeckVisibility(); // Hide deck if empty
            if (gameState.playerHand.length === 0) endRound('player');
        } else {
            gameState.aiHand = gameState.aiHand.filter(c => c !== card);
            gameState.aiReady = false;
            document.getElementById('ai-draw-deck').classList.remove('deck-ready');
            
            checkDeckVisibility();
            if (gameState.aiHand.length === 0) endRound('ai');
        }

        imgElement.remove(); 
        renderCenterPile(side, card); 
        updateScoreboard();
        return true; 
    }
    return false; 
}
