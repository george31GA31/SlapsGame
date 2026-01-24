/* =========================================
   ISF MULTIPLAYER ENGINE v3.0 (Clean Data & Fixed Physics)
   ========================================= */

const gameState = {
    // 'ai' var names = OPPONENT
    playerDeck: [], aiDeck: [],
    playerHand: [], aiHand: [],
    centerPileLeft: [], centerPileRight: [],
    
    playerTotal: 26, aiTotal: 26,

    gameActive: false,
    playerReady: false, aiReady: false,
    
    isHost: false,
    conn: null,
    
    slapActive: false,
    lastMoveTime: 0,
    lastSpacebarTime: 0,
    
    playerYellows: 0, playerReds: 0,
    aiYellows: 0, aiReds: 0,
    difficulty: 1
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png'; 
const AI_LANES = [5, 29, 53, 77]; 

class Card {
    constructor(suit, rank, value, id) {
        this.suit = suit; this.rank = rank; this.value = value; 
        this.id = id || Math.random().toString(36).substr(2, 9); 
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false; this.owner = null; 
        this.element = null; this.laneIndex = 0; 
    }
}

window.onload = function() {
    gameState.playerTotal = 26; gameState.aiTotal = 26;
    document.addEventListener('keydown', handleInput);
    initNetwork();
};

function initNetwork() {
    const role = localStorage.getItem('isf_role');
    const code = localStorage.getItem('isf_code');
    
    if (!role || !code) {
        alert("Connection lost. Returning to lobby.");
        window.location.href = 'multiplayer-setup.html';
        return;
    }

    gameState.isHost = (role === 'host');
    const peer = new Peer(gameState.isHost ? code : null);

    peer.on('open', (id) => {
        console.log("My Peer ID: " + id);
        if (!gameState.isHost) {
            const conn = peer.connect(code);
            handleConnection(conn);
        }
    });

    peer.on('connection', (conn) => {
        if (gameState.isHost) handleConnection(conn);
    });
}

function handleConnection(connection) {
    gameState.conn = connection;
    connection.on('open', () => {
        console.log("CONNECTED TO OPPONENT!");
        if (gameState.isHost) startRound(); 
    });
    connection.on('data', (data) => processNetworkData(data));
}

function processNetworkData(data) {
    switch(data.type) {
        case 'INIT_ROUND':
            syncBoardState(data);
            break;
        case 'OPPONENT_MOVE':
            executeOpponentMove(data.cardId, data.targetSide);
            break;
        case 'OPPONENT_REVEAL_READY':
            gameState.aiReady = true;
            document.getElementById('ai-draw-deck').classList.add('deck-ready');
            checkDrawCondition();
            break;
        case 'SYNC_REVEAL':
            startCountdown(false);
            break;
        case 'SLAP_CLAIM':
            if (gameState.isHost) resolveSlapClaim('opponent', data.timestamp);
            break;
        case 'SLAP_RESULT':
            applySlapResult(data.winner);
            break;
        case 'GAME_OVER':
            showEndGame(data.msg, data.isWin);
            break;
    }
}

function send(data) {
    if (gameState.conn) gameState.conn.send(data);
}

// --- HOST LOGIC ---
function startRound() {
    if (!gameState.isHost) return;

    let fullDeck = createDeck();
    shuffle(fullDeck);
    
    if (gameState.playerTotal <= 0) { sendGameOver("YOU WIN!", true); showEndGame("YOU WIN!", true); return; }
    if (gameState.aiTotal <= 0) { sendGameOver("OPPONENT WINS!", false); showEndGame("OPPONENT WINS!", false); return; }

    const pTotal = gameState.playerTotal;
    const pAllCards = fullDeck.slice(0, pTotal);
    const aAllCards = fullDeck.slice(pTotal, 52);

    const pHandSize = Math.min(10, pTotal);
    const aHandSize = Math.min(10, 52 - pTotal);

    const pHandCards = pAllCards.splice(0, pHandSize);
    gameState.playerDeck = pAllCards; 
    const aHandCards = aAllCards.splice(0, aHandSize);
    gameState.aiDeck = aAllCards;

    let pBorrow = false, aBorrow = false;
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 1) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        gameState.playerDeck = gameState.aiDeck.splice(0, steal);
        pBorrow = true;
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 1) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        gameState.aiDeck = gameState.playerDeck.splice(0, steal);
        aBorrow = true;
    }

    document.getElementById('borrowed-player').classList.toggle('hidden', !pBorrow);
    document.getElementById('borrowed-ai').classList.toggle('hidden', !aBorrow);
    
    dealSmartHand(pHandCards, 'player');
    dealSmartHand(aHandCards, 'ai');
    updateScoreboard();

    // --- FIX 1: SANITIZE DATA BEFORE SENDING ---
    // We cannot send circular structures (DOM elements) over PeerJS.
    // We map the objects to pure data.
    const cleanDeck = (deck) => deck.map(c => ({suit:c.suit, rank:c.rank, value:c.value, id:c.id}));
    const cleanHand = (hand) => hand.map(c => ({suit:c.suit, rank:c.rank, value:c.value, id:c.id}));

    send({
        type: 'INIT_ROUND',
        // Swap perspectives for Guest
        pDeck: cleanDeck(gameState.aiDeck), 
        aDeck: cleanDeck(gameState.playerDeck),
        pHand: cleanHand(gameState.aiHand), 
        aHand: cleanHand(gameState.playerHand),
        pTotal: gameState.aiTotal, 
        aTotal: gameState.playerTotal,
        pBorrow: aBorrow, 
        aBorrow: pBorrow
    });
}

// --- GUEST LOGIC ---
function syncBoardState(data) {
    // Rebuild Decks (Pure Data -> Card Objects)
    gameState.playerDeck = data.pDeck.map(d => new Card(d.suit, d.rank, d.value, d.id));
    gameState.aiDeck = data.aDeck.map(d => new Card(d.suit, d.rank, d.value, d.id));
    
    gameState.playerTotal = data.pTotal;
    gameState.aiTotal = data.aTotal;

    document.getElementById('borrowed-player').classList.toggle('hidden', !data.pBorrow);
    document.getElementById('borrowed-ai').classList.toggle('hidden', !data.aBorrow);

    // Rebuild Hands and Render
    dealSyncedHand(data.pHand, 'player');
    dealSyncedHand(data.aHand, 'ai');
    updateScoreboard();
}

function dealSyncedHand(cardsData, owner) {
    const cards = cardsData.map(d => new Card(d.suit, d.rank, d.value, d.id));
    dealSmartHand(cards, owner);
}

function dealSmartHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 
    if (owner === 'player') gameState.playerHand = []; else gameState.aiHand = [];

    const piles = [[], [], [], []];
    let idx = 0;
    if (cards.length >= 10) { [4,3,2,1].forEach((s, i) => { for(let j=0; j<s; j++) piles[i].push(cards[idx++]); }); } 
    else { cards.forEach(c => { piles[idx].push(c); idx = (idx+1)%4; }); }

    let left = 5;
    piles.forEach((pile, laneIdx) => {
        if(pile.length===0) { left+=24; return; }
        pile.forEach((card, i) => {
            const img = document.createElement('img'); img.className = 'game-card';
            img.src = card.imgSrc;
            
            card.owner = owner; card.laneIndex = laneIdx; card.element = img;
            const isTop = (i === pile.length - 1);
            img.style.left = `${left}%`; img.style.zIndex = i+10;
            if (owner === 'ai') img.style.top = `${10 + i*5}px`; else img.style.top = `${60 - i*5}px`;
            
            if (isTop) setCardFaceUp(img, card, owner); else setCardFaceDown(img, card, owner);
            container.appendChild(img);
            if(owner==='player') gameState.playerHand.push(card); else gameState.aiHand.push(card);
        });
        left += 24;
    });
}

// --- PHYSICS (FIX 2: SCREEN-SPACE DRAGGING) ---
function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault(); 
        
        // 1. Switch to Fixed Positioning for total freedom
        const rect = img.getBoundingClientRect();
        const startLeft = rect.left;
        const startTop = rect.top;
        
        // Offset from mouse to top-left corner of card
        const shiftX = e.clientX - startLeft;
        const shiftY = e.clientY - startTop;

        // Visual Pop
        gameState.globalZ = (gameState.globalZ || 200) + 1;
        img.style.zIndex = gameState.globalZ;
        img.style.position = 'fixed';
        img.style.left = startLeft + 'px';
        img.style.top = startTop + 'px';
        img.style.transition = 'none'; 
        
        function moveAt(pageX, pageY) {
            img.style.left = (pageX - shiftX) + 'px';
            img.style.top = (pageY - shiftY) + 'px';
        }
        
        function onMouseMove(event) { moveAt(event.clientX, event.clientY); }
        
        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove); 
            document.removeEventListener('mouseup', onMouseUp);
            img.style.transition = 'all 0.1s ease-out'; 
            
            // Check Play Zone (Screen Y < 40% typically means center/top area)
            // Or just check if card center is roughly in middle
            const cardRect = img.getBoundingClientRect();
            if (gameState.gameActive && cardRect.top < (window.innerHeight * 0.6)) {
                let success = playCardToCenter(cardData, img); 
                if (!success) { 
                    // Snap Back to container-relative
                    snapBack(img, cardData);
                }
            } else { 
                snapBack(img, cardData);
            }
        }
        document.addEventListener('mousemove', onMouseMove); 
        document.addEventListener('mouseup', onMouseUp);
    };
}

function snapBack(img, cardData) {
    // Revert to Absolute positioning within container
    // This requires calculating where it SHOULD be.
    // Simple way: rely on the original styles set during deal.
    // But those were %.
    
    // Easier way for MVP: Just reload the hand render to ensure perfect reset
    // Or, quick hack:
    const container = document.getElementById('player-foundation-area');
    // We need to put it back into the flow.
    img.style.position = 'absolute';
    // Recalculate original % or px? 
    // We stored laneIndex. We can re-render just this card's pile? 
    // Simplest is to call a partial refresh or just reset visual properties if we stored them.
    // Since we didn't store original % in cardData, let's just re-render the Player Hand.
    
    // Re-rendering hand ensures it snaps back perfectly
    const pile = gameState.playerHand.filter(c => c.laneIndex === cardData.laneIndex);
    // Find visual props
    // This is getting complex. Let's just visually transition to "roughly" the right spot?
    // No, re-rendering is safest to fix z-indexes and positions.
    dealSmartHand(gameState.playerHand, 'player');
}


// --- GAMEPLAY ACTIONS ---
function playCardToCenter(card, imgElement) {
    let target = null; let side = '';
    const cardRect = imgElement.getBoundingClientRect(); 
    const cardCenterX = cardRect.left + (cardRect.width / 2); 
    const screenCenterX = window.innerWidth / 2;
    const intendedSide = (cardCenterX < screenCenterX) ? 'left' : 'right';
    
    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    if (intendedSide === 'left' && isLeftLegal) { target = gameState.centerPileLeft; side = 'left'; }
    else if (intendedSide === 'right' && isRightLegal) { target = gameState.centerPileRight; side = 'right'; }
    else if (isLeftLegal) { target = gameState.centerPileLeft; side = 'left'; }
    else if (isRightLegal) { target = gameState.centerPileRight; side = 'right'; }

    if (target) {
        target.push(card);
        gameState.playerHand = gameState.playerHand.filter(c => c.id !== card.id); 
        gameState.playerTotal--;

        send({ type: 'OPPONENT_MOVE', cardId: card.id, targetSide: side });

        gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');

        imgElement.remove(); renderCenterPile(side, card); updateScoreboard();
        checkSlapCondition(); 

        if (gameState.playerTotal <= 0) {
            sendGameOver("OPPONENT WINS MATCH!", false);
            showEndGame("YOU WIN THE MATCH!", true);
        }
        return true; 
    }
    return false; 
}

function executeOpponentMove(cardId, side) {
    const card = gameState.aiHand.find(c => c.id === cardId);
    if (!card) return; 

    gameState.aiHand = gameState.aiHand.filter(c => c.id !== cardId);
    gameState.aiTotal--;

    animateOpponentMove(card, side, () => {
        const target = (side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
        target.push(card);
        renderCenterPile(side, card);
        updateScoreboard();
        
        gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');
        checkSlapCondition();
    });
}

function handlePlayerDeckClick() {
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;
        gameState.playerReady = true; 
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        send({ type: 'OPPONENT_REVEAL_READY' });
        checkDrawCondition();
        return;
    }
    if (gameState.gameActive && !gameState.playerReady) {
        gameState.playerReady = true; 
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        send({ type: 'OPPONENT_REVEAL_READY' });
        checkDrawCondition();
    }
}

function checkDrawCondition() {
    if (gameState.playerReady && gameState.aiReady) {
        if (gameState.isHost) startCountdown(true);
    }
}

function startCountdown(broadcast) {
    if (broadcast) send({ type: 'SYNC_REVEAL' });
    const overlay = document.getElementById('countdown-overlay');
    overlay.classList.remove('hidden');
    let count = 3; overlay.innerText = count;
    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.innerText = count; 
            overlay.style.animation = 'none'; overlay.offsetHeight; overlay.style.animation = 'popIn 0.5s ease';
        } else {
            clearInterval(timer); overlay.classList.add('hidden'); performReveal();
        }
    }, 800);
}

function performReveal() {
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    
    // Simplified Borrow Logic for MVP Sync
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        gameState.playerDeck = gameState.playerDeck.concat(gameState.aiDeck.splice(0, steal));
        document.getElementById('borrowed-player').classList.remove('hidden');
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        gameState.aiDeck = gameState.aiDeck.concat(gameState.playerDeck.splice(0, steal));
        document.getElementById('borrowed-ai').classList.remove('hidden');
    }

    gameState.playerTotal--; gameState.aiTotal--;

    if (gameState.playerDeck.length > 0) { let c = gameState.playerDeck.pop(); gameState.centerPileRight.push(c); renderCenterPile('right', c); }
    if (gameState.aiDeck.length > 0) { let c = gameState.aiDeck.pop(); gameState.centerPileLeft.push(c); renderCenterPile('left', c); }

    updateScoreboard();
    gameState.gameActive = true; 
    gameState.playerReady = false; gameState.aiReady = false;
    checkSlapCondition();
}

// --- UTILITIES ---
function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc; img.classList.remove('card-face-down'); card.isFaceUp = true;
    if (owner === 'player') { img.classList.add('player-card'); img.onclick = null; makeDraggable(img, card); } 
    else { img.classList.add('opponent-card'); img.onclick = null; }
}
function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC; img.classList.add('card-face-down'); card.isFaceUp = false;
    if (owner === 'player') img.onclick = () => tryFlipCard(img, card);
}
function tryFlipCard(img, card) {
    const live = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (live < 4) setCardFaceUp(img, card, 'player');
}
function createDeck() {
    let deck = [];
    SUITS.forEach(suit => { RANKS.forEach((rank, index) => { deck.push(new Card(suit, rank, index + 2)); }); });
    return deck;
}
function shuffle(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; } }
function updateScoreboard() { document.getElementById('score-player').innerText = gameState.playerTotal; document.getElementById('score-ai').innerText = gameState.aiTotal; }
function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false; 
    const targetCard = targetPile[targetPile.length - 1]; 
    const diff = Math.abs(card.value - targetCard.value); 
    return (diff === 1 || diff === 12);
}
function checkSlapCondition() {
    if (gameState.centerPileLeft.length === 0 || gameState.centerPileRight.length === 0) { gameState.slapActive = false; return; }
    const topL = gameState.centerPileLeft[gameState.centerPileLeft.length - 1];
    const topR = gameState.centerPileRight[gameState.centerPileRight.length - 1];
    gameState.slapActive = (topL.rank === topR.rank);
}
function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    const img = document.createElement('img'); img.src = card.imgSrc; img.className = 'game-card'; 
    img.style.left = '50%'; img.style.top = '50%';
    const rot = Math.random() * 20 - 10; img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    container.appendChild(img);
}
function animateOpponentMove(card, side, callback) {
    if(!card.element) return;
    const el = card.element;
    const visualSide = (side === 'left') ? 'center-pile-right' : 'center-pile-left';
    const targetEl = document.getElementById(visualSide);
    el.style.zIndex = 2000;
    const targetRect = targetEl.getBoundingClientRect();
    const startRect = el.getBoundingClientRect();
    const destX = targetRect.left + (targetRect.width/2) - (startRect.width/2);
    const destY = targetRect.top + (targetRect.height/2) - (startRect.height/2);
    el.style.position = 'fixed'; el.style.left = destX + 'px'; el.style.top = destY + 'px';
    setTimeout(() => { el.remove(); callback(); }, 400);
}
function handleInput(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        const now = Date.now();
        if (now - gameState.lastSpacebarTime < 1000) { issuePenalty('player', 'SPAM'); return; }
        gameState.lastSpacebarTime = now;
        if (!gameState.slapActive) { issuePenalty('player', 'INVALID'); return; }
        send({ type: 'SLAP_CLAIM', timestamp: Date.now() });
        if (gameState.isHost) resolveSlapClaim('host', Date.now());
    }
}
function resolveSlapClaim(who, timestamp) {
    const winner = (who === 'host') ? 'player' : 'ai';
    const isHostWin = (who === 'host');
    applySlapResult(isHostWin ? 'player' : 'ai'); 
    send({ type: 'SLAP_RESULT', winner: isHostWin ? 'ai' : 'player' }); 
}
function applySlapResult(winner) {
    gameState.slapActive = false;
    const overlay = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    overlay.classList.remove('hidden');
    const pileCount = gameState.centerPileLeft.length + gameState.centerPileRight.length;
    if (winner === 'player') {
        txt.innerText = "YOU WON THE SLAP!"; overlay.style.backgroundColor = "rgba(0, 200, 0, 0.9)"; gameState.aiTotal += pileCount; 
    } else {
        txt.innerText = "OPPONENT WON THE SLAP!"; overlay.style.backgroundColor = "rgba(200, 0, 0, 0.9)"; gameState.playerTotal += pileCount; 
    }
    gameState.centerPileLeft = []; gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = ''; document.getElementById('center-pile-right').innerHTML = '';
    updateScoreboard();
    setTimeout(() => {
        overlay.classList.add('hidden'); gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready'); document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    }, 2000);
}
function issuePenalty(target, reason) {
    if (target === 'player') { gameState.playerTotal += 3; gameState.aiTotal = Math.max(0, gameState.aiTotal - 3); }
    updateScoreboard();
}
function sendGameOver(msg, isWin) { send({ type: 'GAME_OVER', msg: isWin ? "OPPONENT WINS!" : "YOU WIN!", isWin: !isWin }); }
function showEndGame(title, isWin) {
    const modal = document.getElementById('game-message');
    modal.querySelector('h1').innerText = title; modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';
    modal.querySelector('p').innerText = "Refresh to play again."; document.getElementById('msg-btn').classList.add('hidden'); modal.classList.remove('hidden');
}
