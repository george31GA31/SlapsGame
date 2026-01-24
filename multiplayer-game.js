/* =========================================
   ISF MULTIPLAYER ENGINE v10.0 (Names Fixed & Round Logic Reinforced)
   ========================================= */

const gameState = {
    playerDeck: [], aiDeck: [],
    playerHand: [], aiHand: [],
    centerPileLeft: [], centerPileRight: [],
    
    playerTotal: 26, aiTotal: 26,

    gameActive: false,
    playerReady: false, aiReady: false,
    
    isHost: false,
    conn: null,
    
    opponentName: "OPPONENT",
    myName: "ME",
    
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
    gameState.myName = localStorage.getItem('isf_my_name') || "Player";
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
        console.log("CONNECTED!");
        
        // FIX 1: IMMEDIATE NAME EXCHANGE
        send({ type: 'NAME_UPDATE', name: gameState.myName });
        
        if (gameState.isHost) startRound(); 
    });
    connection.on('data', (data) => processNetworkData(data));
}

function processNetworkData(data) {
    switch(data.type) {
        case 'NAME_UPDATE':
            gameState.opponentName = data.name;
            updateNamesUI();
            break;

        case 'INIT_ROUND':
            // Host sends name in Init, but NAME_UPDATE handles it too.
            // We prioritize NAME_UPDATE for consistency.
            if(data.hostName) gameState.opponentName = data.hostName;
            updateNamesUI();
            
            syncBoardState(data);
            break;

        case 'OPPONENT_MOVE':
            const mirroredSide = (data.targetSide === 'left') ? 'right' : 'left';
            executeOpponentMove(data.cardId, mirroredSide);
            break;

        case 'OPPONENT_FLIP':
            executeOpponentFlip(data.cardId);
            break;

        case 'OPPONENT_DRAG':
            executeOpponentDrag(data.cardId, data.left, data.top);
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
            
        case 'PENALTY_UPDATE':
            applyPenaltySync(data.target, data.reason, data.pTotal, data.aTotal, data.y, data.r);
            break;

        case 'ROUND_OVER':
            handleRoundOver(data.winner, data.nextPTotal, data.nextATotal);
            break;

        case 'GAME_OVER':
            showEndGame(data.msg, data.isWin);
            break;
    }
}

function send(data) {
    if (gameState.conn) gameState.conn.send(data);
}

function updateNamesUI() {
    const labels = document.querySelectorAll('.stat-label');
    // Left Label is Opponent
    if(labels[0]) labels[0].innerText = gameState.opponentName;
}

// --- HOST LOGIC ---
function startRound() {
    if (!gameState.isHost) return;

    let fullDeck = createDeck();
    shuffle(fullDeck);
    
    // MATCH WIN CHECK
    if (gameState.playerTotal <= 0) { 
        // I won, so I tell opponent "MY NAME wins"
        sendGameOver(gameState.myName + " WINS!", false); 
        showEndGame("YOU WIN!", true); 
        return; 
    }
    if (gameState.aiTotal <= 0) { 
        // Opponent won, so I tell them "YOU WIN"
        sendGameOver("YOU WIN THE MATCH!", true); 
        showEndGame(gameState.opponentName + " WINS!", false); 
        return; 
    }

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

    const cleanDeck = (deck) => deck.map(c => ({suit:c.suit, rank:c.rank, value:c.value, id:c.id}));
    const cleanHand = (hand) => hand.map(c => ({suit:c.suit, rank:c.rank, value:c.value, id:c.id}));

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

function dealSmartHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 
    if (owner === 'player') gameState.playerHand = []; else gameState.aiHand = [];
    const piles = [[], [], [], []];
    let idx = 0;
    if (cards.length >= 10) { [4,3,2,1].forEach((s, i) => { for(let j=0; j<s; j++) piles[i].push(cards[idx++]); }); } 
    else { cards.forEach(c => { piles[idx].push(c); idx = (idx+1)%4; }); }

    piles.forEach((pile, laneIdx) => {
        let leftPos;
        if (owner === 'player') leftPos = 5 + (laneIdx * 24);
        else leftPos = 77 - (laneIdx * 24); // MIRRORED

        if(pile.length === 0) return;

        pile.forEach((card, i) => {
            const img = document.createElement('img'); img.className = 'game-card';
            img.src = card.imgSrc;
            card.owner = owner; card.laneIndex = laneIdx; card.element = img;
            const isTop = (i === pile.length - 1);
            img.style.left = `${leftPos}%`; img.style.zIndex = i + 10;
            if (owner === 'ai') img.style.top = `${10 + i * 5}px`; else img.style.top = `${60 - i * 5}px`;
            if (isTop) setCardFaceUp(img, card, owner); else setCardFaceDown(img, card, owner);
            container.appendChild(img);
            if(owner === 'player') gameState.playerHand.push(card); else gameState.aiHand.push(card);
        });
    });
}

// --- PHYSICS ---
function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault();
        gameState.globalZ = (gameState.globalZ || 200) + 1;
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
                if (!success) { img.style.left = cardData.originalLeft; img.style.top = cardData.originalTop; }
            } else {
                const boxRect = box.getBoundingClientRect();
                const currentLeftPx = parseFloat(img.style.left);
                const currentTopPx = parseFloat(img.style.top);
                const leftPct = (currentLeftPx / boxRect.width) * 100;
                const topPct = (currentTopPx / boxRect.height) * 100;
                send({ type: 'OPPONENT_DRAG', cardId: cardData.id, left: leftPct, top: topPct });
            }
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

function executeOpponentDrag(cardId, leftPct, topPct) {
    const card = gameState.aiHand.find(c => c.id === cardId);
    if (!card || !card.element) return;
    card.element.style.left = 'auto'; card.element.style.top = 'auto';
    card.element.style.right = leftPct + '%'; card.element.style.bottom = topPct + '%';
    card.element.style.zIndex = 200;
}

// --- CARD PLAYING & WIN CONDITIONS ---
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
        // REMOVE FROM HAND ARRAY
        gameState.playerHand = gameState.playerHand.filter(c => c.id !== card.id); 
        gameState.playerTotal--;
        
        gameState.lastMoveTime = Date.now(); 

        send({ type: 'OPPONENT_MOVE', cardId: card.id, targetSide: side });

        gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');

        imgElement.remove(); renderCenterPile(side, card); updateScoreboard();
        checkSlapCondition(); 

        // 1. MATCH WIN CHECK (Score hits 0)
        if (gameState.playerTotal <= 0) {
            // I played my last card. I win.
            // Tell Opponent: "George WINS!"
            sendGameOver(gameState.myName + " WINS!", false);
            showEndGame("YOU WIN THE MATCH!", true);
            return true;
        }

        // 2. ROUND WIN CHECK (Hand Empty, even if score > 0 due to slaps/borrow)
        if (gameState.playerHand.length === 0) {
            const nextPTotal = gameState.playerTotal;
            const nextATotal = 52 - gameState.playerTotal;
            
            // Trigger Locally
            handleRoundOver('player', nextPTotal, nextATotal);
            
            // Notify Opponent
            send({ type: 'ROUND_OVER', winner: 'opponent', nextPTotal: nextATotal, nextATotal: nextPTotal });
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
    gameState.lastMoveTime = Date.now(); 

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

function handleRoundOver(winner, myNextTotal, oppNextTotal) {
    gameState.gameActive = false;
    
    // 1. UPDATE SCORES FOR NEXT ROUND
    gameState.playerTotal = myNextTotal;
    gameState.aiTotal = oppNextTotal;

    // 2. CLEAR CENTER PILE (The Fix)
    // Reset the internal arrays so the game knows they are empty
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    
    // Wipe the visual cards from the screen
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';

    // 3. SHOW ROUND OVER POPUP
    const modal = document.getElementById('game-message');
    const btn = document.getElementById('msg-btn');
    
    if (winner === 'player') {
        modal.querySelector('h1').innerText = "ROUND WON!";
        modal.querySelector('p').innerText = `You start next round with ${myNextTotal} cards.`;
    } else {
        modal.querySelector('h1').innerText = "ROUND LOST!";
        modal.querySelector('p').innerText = `${gameState.opponentName} starts next round with ${oppNextTotal} cards.`;
    }

    btn.innerText = "CONTINUE";
    btn.classList.remove('hidden');
    btn.onclick = function() {
        modal.classList.add('hidden');
        // Both players click continue, but only Host triggers the deal for the new round
        if (gameState.isHost) startRound(); 
    };
    
    modal.classList.remove('hidden');
}
// --- PENALTIES ---
function handleInput(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        const now = Date.now();
        if (now - gameState.lastSpacebarTime < 1000) { issuePenalty('player', 'SPAM'); return; }
        gameState.lastSpacebarTime = now;
        if (!gameState.slapActive) { issuePenalty('player', 'BAD SLAP'); return; }
        if (now - gameState.lastMoveTime < 100) { issuePenalty('player', 'IMPOSSIBLE'); return; }

        send({ type: 'SLAP_CLAIM', timestamp: Date.now() });
        if (gameState.isHost) resolveSlapClaim('host', Date.now());
    }
}

function issuePenalty(target, reason) {
    console.log(`PENALTY (${target}): ${reason}`);
    let yellows, reds;
    if (target === 'player') {
        gameState.playerYellows++;
        yellows = gameState.playerYellows;
        reds = gameState.playerReds;
    } else {
        gameState.aiYellows++;
        yellows = gameState.aiYellows;
        reds = gameState.aiReds;
    }

    if (yellows >= 2) {
        if (target === 'player') { gameState.playerYellows = 0; gameState.playerReds++; }
        else { gameState.aiYellows = 0; gameState.aiReds++; }
        executeRedCardConsequence(target);
    }

    updatePenaltyUI();
    if(target === 'player') {
        send({ 
            type: 'PENALTY_UPDATE', target: 'opponent', reason: reason, 
            pTotal: gameState.aiTotal, aTotal: gameState.playerTotal, 
            y: gameState.playerYellows, r: gameState.playerReds 
        });
    }
}

function applyPenaltySync(target, reason, pTotal, aTotal, y, r) {
    if (target === 'opponent') {
        gameState.aiYellows = y;
        gameState.aiReds = r;
        gameState.playerTotal = pTotal; 
        gameState.aiTotal = aTotal;
    }
    updatePenaltyUI();
    updateScoreboard();
}

function executeRedCardConsequence(offender) {
    if (offender === 'player') {
        gameState.playerTotal = Math.max(0, gameState.playerTotal - 3);
        gameState.aiTotal += 3;
    } else {
        gameState.aiTotal = Math.max(0, gameState.aiTotal - 3);
        gameState.playerTotal += 3;
    }
    updateScoreboard();
    updateScoreboard();
    
    // Check Match Win via Penalty
    if (gameState.playerTotal <= 0) { 
        sendGameOver(gameState.myName + " WINS!", false); 
        showEndGame("YOU WIN!", true); 
    }
    if (gameState.aiTotal <= 0) { 
        sendGameOver("YOU WIN THE MATCH!", true); 
        showEndGame(gameState.opponentName + " WINS!", false); 
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

// --- STANDARD ---
function animateOpponentMove(card, side, callback) {
    if(!card.element) return;
    const el = card.element;
    const visualSide = (side === 'left') ? 'center-pile-left' : 'center-pile-right';
    const targetEl = document.getElementById(visualSide);
    el.style.zIndex = 2000;
    const targetRect = targetEl.getBoundingClientRect();
    const startRect = el.getBoundingClientRect();
    const destX = targetRect.left + (targetRect.width/2) - (startRect.width/2);
    const destY = targetRect.top + (targetRect.height/2) - (startRect.height/2);
    el.style.position = 'fixed'; el.style.left = destX + 'px'; el.style.top = destY + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
    setTimeout(() => { el.remove(); callback(); }, 400);
}
function tryFlipCard(img, card) {
    const live = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (live < 4) {
        setCardFaceUp(img, card, 'player');
        send({ type: 'OPPONENT_FLIP', cardId: card.id });
    }
}
function executeOpponentFlip(cardId) {
    const card = gameState.aiHand.find(c => c.id === cardId);
    if (!card) return;
    card.isFaceUp = true;
    if (card.element) {
        card.element.src = card.imgSrc;
        card.element.classList.remove('card-face-down');
        card.element.classList.add('opponent-card');
    }
}
function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc; img.classList.remove('card-face-down'); card.isFaceUp = true;
    if (owner === 'player') { img.classList.add('player-card'); img.onclick = null; makeDraggable(img, card); } 
    else { img.classList.add('opponent-card'); img.onclick = null; }
}
function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC; img.classList.add('card-face-down'); card.isFaceUp = false;
    if (owner === 'player') img.onclick = () => tryFlipCard(img, card);
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
    document.getElementById('borrowed-player').classList.toggle('hidden', gameState.playerTotal > 10);
    document.getElementById('borrowed-ai').classList.toggle('hidden', gameState.aiTotal > 10);
}
function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false; 
    const targetCard = targetPile[targetPile.length - 1]; 
    const diff = Math.abs(card.value - targetCard.value); 
    return (diff === 1 || diff === 12);
}
function checkLegalPlay(card) {
    if (!gameState.gameActive) return false;
    return checkPileLogic(card, gameState.centerPileLeft) || checkPileLogic(card, gameState.centerPileRight);
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
    
    // 1. PHYSICAL BORROW LOGIC (Essential to prevent running out of cards to draw)
    // If Player has no cards in deck, steal half from Opponent
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        gameState.playerDeck = gameState.playerDeck.concat(gameState.aiDeck.splice(0, steal));
        document.getElementById('borrowed-player').classList.remove('hidden');
    }
    // If Opponent has no cards in deck, steal half from Player
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        gameState.aiDeck = gameState.aiDeck.concat(gameState.playerDeck.splice(0, steal));
        document.getElementById('borrowed-ai').classList.remove('hidden');
    }

    // 2. SCORING LOGIC (The Fix)
    // Check if the "BORROWED" text is visible (or if deck was just refilled)
    // We check the classes or the logic we just ran.
    
    // Note: updateScoreboard() handles the text visibility based on total < 10, 
    // but here we check if we are physically relying on the other person.
    
    // Simplest check: If my total is very low (<=10), I am in "Borrow Mode"
    // OR check the classes directly.
    
    const pBorrow = !document.getElementById('borrowed-player').classList.contains('hidden') || gameState.playerTotal <= 10;
    const aBorrow = !document.getElementById('borrowed-ai').classList.contains('hidden') || gameState.aiTotal <= 10;

    if (pBorrow) {
        // Player is Borrowing: Opponent pays 2, Player pays 0
        gameState.aiTotal = Math.max(0, gameState.aiTotal - 2);
    } else if (aBorrow) {
        // Opponent is Borrowing: Player pays 2, Opponent pays 0
        gameState.playerTotal = Math.max(0, gameState.playerTotal - 2);
    } else {
        // Normal Case: Both pay 1
        gameState.playerTotal--; 
        gameState.aiTotal--;
    }
    
    gameState.lastMoveTime = Date.now(); 

    // 3. REVEAL CARDS
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

    updateScoreboard();
    gameState.gameActive = true; 
    gameState.playerReady = false; 
    gameState.aiReady = false;
    checkSlapCondition();
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
        txt.innerText = gameState.opponentName + " WON THE SLAP!"; overlay.style.backgroundColor = "rgba(200, 0, 0, 0.9)"; gameState.playerTotal += pileCount; 
    }
    gameState.centerPileLeft = []; gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = ''; document.getElementById('center-pile-right').innerHTML = '';
    updateScoreboard();
    setTimeout(() => {
        overlay.classList.add('hidden'); gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready'); document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    }, 2000);
}
function sendGameOver(msg, isWin) { send({ type: 'GAME_OVER', msg: msg, isWin: isWin }); }
function showEndGame(title, isWin) {
    const modal = document.getElementById('game-message');
    modal.querySelector('h1').innerText = title; modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';
    modal.querySelector('p').innerText = "Refresh to play again."; document.getElementById('msg-btn').classList.add('hidden'); modal.classList.remove('hidden');
}
