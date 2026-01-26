/* =========================================
   ISF MULTIPLAYER ENGINE v9.0 (Robust Sync + Smooth Physics)
   ========================================= */

const gameState = {
    playerDeck: [], aiDeck: [],
    playerHand: [], aiHand: [],
    centerPileLeft: [], centerPileRight: [],
    
    globalZ: 1000,
    playerTotal: 26, aiTotal: 26,
    
    gameActive: false,
    matchEnded: false,
    
    playerReady: false, aiReady: false,
    drawLock: false, // Prevents double clicking decks
    
    isHost: false,
    conn: null,
    opponentName: "OPPONENT",
    myName: "ME",
    
    pendingMoves: {},
    moveCounter: 0,

    slapActive: false,
    lastSpacebarTime: 0,

    p1Rounds: 0, aiRounds: 0,
    p1Slaps: 0, aiSlaps: 0
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png';

class Card {
    constructor(suit, rank, value, id) {
        this.suit = suit; this.rank = rank; this.value = value;
        this.id = id || Math.random().toString(36).substr(2, 9);
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false; this.owner = null;
        this.element = null; this.laneIndex = 0;
        this.originalLeft = null; this.originalTop = null;
    }
}

// --- INITIALIZATION ---
window.onload = function() {
    gameState.myName = localStorage.getItem('isf_my_name') || "Player";
    document.addEventListener('keydown', handleInput);
    initNetwork();
    updateScoreboardWidget();

    // PANIC LOOP: If Guest has no cards, keep asking until we get them
    setInterval(() => {
        if (!gameState.isHost && gameState.playerHand.length === 0 && gameState.conn && gameState.conn.open) {
            console.log("Hand empty! Requesting deal...");
            send({ type: 'REQUEST_DEAL', name: gameState.myName });
        }
    }, 2000);
};

// --- ROBUST NETWORK SETUP ---
function initNetwork() {
    const role = localStorage.getItem('isf_role');
    const code = localStorage.getItem('isf_code');

    if (!role || !code) {
        alert("No connection info found.");
        window.location.href = 'multiplayer-setup.html';
        return;
    }

    gameState.isHost = (role === 'host');
    const peer = new Peer(gameState.isHost ? code : null);

    peer.on('open', (id) => {
        console.log("My Peer ID: " + id);
        if (!gameState.isHost) {
            connectToHost(peer, code);
        }
    });

    peer.on('connection', (conn) => {
        if (gameState.isHost) handleConnection(conn);
    });

    peer.on('error', (err) => {
        console.error("Peer Error:", err.type);
        // RETRY LOGIC: If Guest can't find Host, try again in 1s
        if (!gameState.isHost && err.type === 'peer-unavailable') {
            console.log("Host not ready. Retrying in 1s...");
            setTimeout(() => connectToHost(peer, code), 1000);
        }
    });
}

function connectToHost(peer, code) {
    const conn = peer.connect(code);
    handleConnection(conn);
}

function handleConnection(connection) {
    gameState.conn = connection;

    connection.on('open', () => {
        console.log("CONNECTED!");
        send({ type: 'NAME_REPLY', name: gameState.myName });
        // Request cards immediately
        if (!gameState.isHost) send({ type: 'REQUEST_DEAL', name: gameState.myName });
    });

    connection.on('data', (data) => processNetworkData(data));
}

function send(data) {
    if (gameState.conn && gameState.conn.open) gameState.conn.send(data);
}

// --- NETWORK DATA HANDLER ---
function processNetworkData(data) {
    switch (data.type) {
        case 'NAME_REPLY':
            gameState.opponentName = data.name;
            updateNamesUI();
            updateScoreboardWidget();
            break;
            
        case 'REQUEST_DEAL':
            if (gameState.isHost) {
                gameState.opponentName = data.name || "Opponent";
                updateNamesUI();
                // Only deal if we haven't already (or if they crashed and need a re-sync)
                if(gameState.playerHand.length === 0 || data.force) startRound(); 
                else {
                    // If we already have a game, just sync them to current state
                    // (For now, just restart round to be safe)
                    startRound();
                }
            }
            break;

        case 'INIT_ROUND':
            gameState.opponentName = data.hostName;
            updateNamesUI();
            syncBoardState(data);
            break;

        case 'OPPONENT_DRAG':
            executeOpponentDrag(data.cardId, data.left, data.top);
            break;
            
        case 'OPPONENT_FLIP':
            executeOpponentFlip(data.cardId);
            break;

        case 'OPPONENT_REVEAL_READY':
            gameState.aiReady = true;
            document.getElementById('ai-draw-deck').classList.add('deck-ready');
            checkDrawCondition();
            break;

        case 'SYNC_REVEAL':
            startCountdown(false);
            break;

        case 'MOVE_ATTEMPT':
            if (gameState.isHost) handleMoveAttemptFromOpponent(data);
            break;

        case 'MOVE_ACCEPTED':
            handleMoveAccepted(data);
            break;

        case 'MOVE_REJECTED':
            handleMoveRejected(data);
            break;

        case 'SLAP_CLAIM':
            if (gameState.isHost) resolveSlapClaim('opponent', data.timestamp);
            break;

        case 'SLAP_RESULT':
            applySlapResult(data.winner);
            break;

        case 'ROUND_OVER':
            handleRoundOver(data.winner, data.nextPTotal, data.nextATotal);
            break;

        case 'GAME_OVER':
            showEndGame(data.msg, data.isWin);
            break;
            
        case 'OPPONENT_LEFT':
            alert("Opponent disconnected.");
            window.location.href = 'index.html';
            break;
    }
}

// --- HOST LOGIC ---
function startRound() {
    if (!gameState.isHost) return;

    let fullDeck = createDeck();
    shuffle(fullDeck);
    
    if (gameState.playerTotal <= 0) { sendGameOver("YOU WIN!", true); showEndGame("YOU WIN!", true); return; }
    if (gameState.aiTotal <= 0) { sendGameOver(gameState.opponentName + " WINS!", false); showEndGame(gameState.opponentName + " WINS!", false); return; }

    const pTotal = gameState.playerTotal;
    const pAllCards = fullDeck.slice(0, pTotal);
    const aAllCards = fullDeck.slice(pTotal, 52);

    const pHandCards = pAllCards.splice(0, Math.min(10, pTotal));
    gameState.playerDeck = pAllCards;
    
    const aHandCards = aAllCards.splice(0, Math.min(10, 52 - pTotal));
    gameState.aiDeck = aAllCards;

    dealSmartHand(pHandCards, 'player');
    dealSmartHand(aHandCards, 'ai');
    updateScoreboard();

    const cleanDeck = (deck) => deck.map(c => ({ suit: c.suit, rank: c.rank, value: c.value, id: c.id }));
    const cleanHand = (hand) => hand.map(c => ({ suit: c.suit, rank: c.rank, value: c.value, id: c.id }));

    send({
        type: 'INIT_ROUND',
        hostName: gameState.myName,
        pDeck: cleanDeck(gameState.aiDeck),
        aDeck: cleanDeck(gameState.playerDeck),
        pHand: cleanHand(gameState.aiHand),
        aHand: cleanHand(gameState.playerHand),
        pTotal: gameState.aiTotal,
        aTotal: gameState.playerTotal
    });
}

// --- GUEST LOGIC ---
function syncBoardState(data) {
    gameState.playerDeck = data.pDeck.map(d => new Card(d.suit, d.rank, d.value, d.id));
    gameState.aiDeck = data.aDeck.map(d => new Card(d.suit, d.rank, d.value, d.id));
    
    gameState.playerTotal = data.pTotal;
    gameState.aiTotal = data.aTotal;

    dealSyncedHand(data.pHand, 'player');
    dealSyncedHand(data.aHand, 'ai');
    updateScoreboard();
}

function dealSyncedHand(cardsData, owner) {
    const cards = cardsData.map(d => new Card(d.suit, d.rank, d.value, d.id));
    dealSmartHand(cards, owner);
}

// --- RENDER LOGIC ---
function dealSmartHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 
    if (owner === 'player') gameState.playerHand = []; else gameState.aiHand = [];

    const piles = [[], [], [], []];
    let idx = 0;
    
    if (cards.length >= 10) {
        [4, 3, 2, 1].forEach((size, i) => {
            for (let j=0; j<size; j++) piles[i].push(cards[idx++]);
        });
    } else {
        cards.forEach(card => { piles[idx].push(card); idx = (idx + 1) % 4; });
    }

    let currentLeftPercent = 5; 
    piles.forEach((pile, laneIdx) => {
        if (pile.length === 0) { currentLeftPercent += 24; return; }
        
        pile.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card'; 
            img.src = card.imgSrc;
            
            card.owner = owner; 
            card.laneIndex = laneIdx; 
            card.element = img;
            
            const isTopCard = (index === pile.length - 1);
            
            img.style.left = `${currentLeftPercent}%`;
            let stackOffset = index * 5; 
            
            if (owner === 'ai') { img.style.top = `${10 + stackOffset}px`; } 
            else { img.style.top = `${60 - stackOffset}px`; }
            
            img.style.zIndex = index + 10; 

            if (isTopCard) setCardFaceUp(img, card, owner); 
            else setCardFaceDown(img, card, owner);

            container.appendChild(img);

            if (owner === 'player') gameState.playerHand.push(card); 
            else gameState.aiHand.push(card);
        });
        currentLeftPercent += 24;
    });
}

// --- SMOOTH DRAGGING (Fixed Lag) ---
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
            
            // REMOVED THE WALL CHECK HERE
            // You can now drag freely anywhere. We only check legality on drop.
            
            img.style.left = newLeft + 'px';
            img.style.top = newTop + 'px';
        }
        
        moveAt(e.pageX, e.pageY);
        
        function onMouseMove(event) { 
            moveAt(event.pageX, event.pageY);
            // Send drag updates
            if(gameState.gameActive) {
                const boxRect = box.getBoundingClientRect();
                const currentLeftPx = parseFloat(img.style.left);
                const currentTopPx = parseFloat(img.style.top);
                const leftPct = (currentLeftPx / boxRect.width) * 100;
                const topPct = (currentTopPx / boxRect.height) * 100;
                send({ type: 'OPPONENT_DRAG', cardId: cardData.id, left: leftPct, top: topPct });
            }
        }
        
        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            img.style.transition = 'all 0.1s ease-out';
            
            // Only try to play if dragged UP out of the area
            if (gameState.gameActive && parseInt(img.style.top) < -10) {
                const dropSide = getDropSide(event);
                playCardToCenter(cardData, img, dropSide);
            } else {
                // Return to hand if dropped inside
                img.style.left = cardData.originalLeft;
                img.style.top = cardData.originalTop;
            }
        }
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

function executeOpponentDrag(cardId, leftPct, topPct) {
    const card = gameState.aiHand.find(c => c.id === cardId);
    if (!card || !card.element) return;

    const box = document.getElementById('ai-foundation-area');
    if (!box) return;

    const cardH = card.element.offsetHeight;
    const mirroredTop = 100 - topPct - ((cardH / boxRect.height) * 100);
    
    card.element.style.left = leftPct + '%'; 
    card.element.style.top = mirroredTop + '%';
    card.element.style.zIndex = 200;
}

function executeOpponentFlip(cardId) {
    const card = gameState.aiHand.find(c => c.id === cardId);
    if(card) {
        card.isFaceUp = true;
        card.element.src = card.imgSrc;
        card.element.classList.remove('card-face-down');
        card.element.classList.add('opponent-card');
    }
}

// --- MOVES ---
function playCardToCenter(card, imgElement, dropSide) {
    if (!gameState.gameActive) return false;

    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    if (dropSide !== 'left' && dropSide !== 'right') { snapBack(imgElement, card); return false; }
    if (dropSide === 'left' && !isLeftLegal) { snapBack(imgElement, card); return false; }
    if (dropSide === 'right' && !isRightLegal) { snapBack(imgElement, card); return false; }

    // ATOMIC MOVE: Vanish immediately
    if(imgElement) imgElement.remove();

    const moveId = `${gameState.myName}-${Date.now()}`;
    gameState.pendingMoves[moveId] = { cardId: card.id, side: dropSide, originalImg: imgElement };

    if (gameState.isHost) {
        handleMoveAttemptAsHost(moveId, card.id, dropSide, 'player');
    } else {
        send({ type: 'MOVE_ATTEMPT', moveId: moveId, cardId: card.id, targetSide: dropSide });
    }
    return true;
}

function snapBack(img, card) {
    img.style.left = card.originalLeft;
    img.style.top = card.originalTop;
}

function handleMoveAttemptFromOpponent(data) {
    const mirroredSide = (data.targetSide === 'left') ? 'right' : 'left';
    handleMoveAttemptAsHost(data.moveId, data.cardId, mirroredSide, 'opponent');
}

function handleMoveAttemptAsHost(moveId, cardId, side, who) {
    const hand = (who === 'player') ? gameState.playerHand : gameState.aiHand;
    const card = hand.find(c => c.id === cardId);
    
    if (!card) { rejectMove(moveId, who); return; }
    
    const pile = (side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
    if (!checkPileLogic(card, pile)) { rejectMove(moveId, who); return; }

    pile.push(card);
    if (who === 'player') {
        gameState.playerHand = gameState.playerHand.filter(c => c.id !== cardId);
        gameState.playerTotal--;
    } else {
        gameState.aiHand = gameState.aiHand.filter(c => c.id !== cardId);
        gameState.aiTotal--;
    }

    const sideForGuest = (side === 'left') ? 'right' : 'left';
    const cardData = { id: card.id, imgSrc: card.imgSrc, suit: card.suit, rank: card.rank, value: card.value };

    if (who === 'player') {
        send({ type: 'MOVE_ACCEPTED', moveId: moveId, cardId: cardId, side: sideForGuest, cardData: cardData });
        handleMoveAccepted({ moveId: moveId, cardId: cardId, side: side, cardData: cardData }, true);
    } else {
        send({ type: 'MOVE_ACCEPTED', moveId: moveId, cardId: cardId, side: sideForGuest, cardData: cardData });
        renderOpponentMove(cardData, side); 
    }
}

function rejectMove(moveId, who) {
    if (who === 'player') handleMoveRejected({ moveId: moveId });
    else send({ type: 'MOVE_REJECTED', moveId: moveId });
}

function handleMoveAccepted(data, isMe) {
    if(isMe) {
        delete gameState.pendingMoves[data.moveId];
        renderCenterPile(data.side, data.cardData);
    } else {
        renderOpponentMove(data.cardData, data.side);
    }
    updateScoreboard();
    checkSlapCondition();
}

function handleMoveRejected(data) {
    alert("Move rejected (Too slow!)");
    location.reload(); 
}

function renderOpponentMove(cardData, side) {
    const card = gameState.aiHand.find(c => c.id === cardData.id);
    if (card && card.element) card.element.remove();
    gameState.aiHand = gameState.aiHand.filter(c => c.id !== cardData.id);
    gameState.aiTotal--;
    renderCenterPile(side, cardData);
    updateScoreboard();
    checkSlapCondition();
}

// --- UTILS ---
function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.className = 'game-card';
    img.style.left = '50%'; img.style.top = '50%';
    const rot = Math.random() * 20 - 10;
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    container.appendChild(img);
}

function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false;
    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);
    return (diff === 1 || diff === 12);
}

function getDropSide(mouseEvent) {
    const leftPileEl = document.getElementById('center-pile-left');
    const rightPileEl = document.getElementById('center-pile-right');
    const x = mouseEvent.clientX; const y = mouseEvent.clientY;
    const l = leftPileEl.getBoundingClientRect();
    const r = rightPileEl.getBoundingClientRect();
    
    if (x >= l.left && x <= l.right && y >= l.top && y <= l.bottom) return 'left';
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return 'right';
    return null;
}

function updateScoreboardWidget() {
    document.getElementById('score-player').innerText = gameState.playerTotal;
    document.getElementById('score-ai').innerText = gameState.aiTotal;
}

function updateNamesUI() {
    const labels = document.querySelectorAll('.stat-label');
    if (labels[0]) labels[0].innerText = gameState.opponentName;
    document.getElementById('sb-p2-name').innerText = gameState.opponentName;
}

function createDeck() {
    let deck = [];
    SUITS.forEach(suit => { RANKS.forEach((rank, index) => { deck.push(new Card(suit, rank, index + 2)); }); });
    return deck;
}
function shuffle(array) { 
    for (let i = array.length - 1; i > 0; i--) { 
        const j = Math.floor(Math.random() * (i + 1)); 
        [array[i], array[j]] = [array[j], array[i]]; 
    } 
}

// --- TURBO REVEAL (INSTANT) ---
function performReveal() {
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';

    if (gameState.playerDeck.length > 0) {
        let c = gameState.playerDeck.pop();
        gameState.centerPileRight.push(c);
        renderCenterPile('right', c);
    }
    if (gameState.aiDeck.length > 0) {
        let c = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(c);
        renderCenterPile('left', c);
    }

    // Critical: Reset lock so next round can start
    gameState.drawLock = false; 
    gameState.gameActive = true;
    updateScoreboard();
    
    // Clear ready visuals
    gameState.playerReady = false; 
    gameState.aiReady = false;
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');
}

function handlePlayerDeckClick() {
    if(!gameState.playerReady) {
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
    if(broadcast) send({ type: 'SYNC_REVEAL' });
    
    const overlay = document.getElementById('countdown-overlay');
    overlay.classList.remove('hidden');
    let count = 3;
    overlay.innerText = count;
    
    const t = setInterval(() => {
        count--;
        if(count > 0) overlay.innerText = count;
        else {
            clearInterval(t);
            overlay.classList.add('hidden');
            performReveal();
        }
    }, 800);
}

// --- SLAP LOGIC ---
function handleInput(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        send({ type: 'SLAP_CLAIM', timestamp: Date.now() });
        if (gameState.isHost) resolveSlapClaim('host', Date.now());
    }
}

function checkSlapCondition() {
    if (gameState.centerPileLeft.length === 0 || gameState.centerPileRight.length === 0) {
        gameState.slapActive = false;
        return;
    }
    const topL = gameState.centerPileLeft[gameState.centerPileLeft.length - 1];
    const topR = gameState.centerPileRight[gameState.centerPileRight.length - 1];
    gameState.slapActive = (topL.rank === topR.rank);
}

function resolveSlapClaim(who, timestamp) {
    if (gameState.slapActive) {
        const winner = (who === 'host') ? 'player' : 'ai';
        send({ type: 'SLAP_RESULT', winner: winner });
        applySlapResult(winner);
    }
}

function applySlapResult(winner) {
    gameState.slapActive = false;
    const overlay = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    overlay.classList.remove('hidden');
    
    const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

    if (winner === 'player') {
        txt.innerText = "YOU WON THE SLAP!";
        gameState.aiTotal += pilesTotal;
    } else {
        txt.innerText = gameState.opponentName + " WON!";
        gameState.playerTotal += pilesTotal;
    }

    gameState.centerPileLeft = []; gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';

    setTimeout(() => {
        overlay.classList.add('hidden');
        gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    }, 2000);
}

function showEndGame(msg, isWin) {
    alert(msg);
    window.location.href = 'index.html';
}
function sendGameOver(msg, isWin) {
    send({ type: 'GAME_OVER', msg: msg, isWin: isWin });
}

function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc;
    img.classList.remove('card-face-down');
    if (owner === 'player') {
        img.classList.add('player-card');
        makeDraggable(img, card);
    } else {
        img.classList.add('opponent-card');
    }
}

function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    if (owner === 'player') img.onclick = () => tryFlipCard(img, card);
}

function tryFlipCard(img, card) {
    const live = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (live < 4) {
        setCardFaceUp(img, card, 'player');
        send({ type: 'OPPONENT_FLIP', cardId: card.id });
    }
}
