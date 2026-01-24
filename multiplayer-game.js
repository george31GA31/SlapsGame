/* =========================================
   ISF MULTIPLAYER ENGINE v15.0 (Restored Deck Click & Polling)
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
    
    // NETWORK FLAGS
    roundInitialized: false, 
    handshakeInterval: null,
    
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
    
    // --- THE FIX: ADD DECK LISTENERS ---
    document.getElementById('player-draw-deck').onclick = handlePlayerDeckClick;
    // -----------------------------------

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
    const peer = new Peer(gameState.isHost ? code : undefined);

    peer.on('open', (id) => {
        console.log("My Peer ID: " + id);
        if (!gameState.isHost) {
            const conn = peer.connect(code, { reliable: true });
            setupGuestConnection(conn);
        }
    });

    peer.on('connection', (conn) => {
        if (gameState.isHost) setupHostConnection(conn);
    });

    peer.on('error', (err) => {
        console.error("Peer Error:", err);
    });
}

// --- HOST CONNECTION ---
function setupHostConnection(conn) {
    gameState.conn = conn;
    conn.on('open', () => {
        console.log("HOST: Connected. Waiting for Request...");
    });
    conn.on('data', (data) => processNetworkData(data));
}

// --- GUEST CONNECTION (POLLING) ---
function setupGuestConnection(conn) {
    gameState.conn = conn;
    conn.on('open', () => {
        console.log("GUEST: Connected. Starting Handshake Loop...");
        
        // IMMEDIATE: Send Name
        send({ type: 'NAME_UPDATE', name: gameState.myName });

        // LOOP: Ask for cards every 1 second until we get them
        if (gameState.handshakeInterval) clearInterval(gameState.handshakeInterval);
        
        gameState.handshakeInterval = setInterval(() => {
            console.log("GUEST: Requesting Deal...");
            send({ type: 'REQUEST_DEAL', name: gameState.myName });
        }, 1000);
    });
    
    conn.on('data', (data) => processNetworkData(data));
}

function processNetworkData(data) {
    switch(data.type) {
        // --- HANDSHAKE LOGIC ---
        case 'REQUEST_DEAL':
            if (gameState.isHost) {
                console.log("HOST: Received Request. Sending Deck...");
                gameState.opponentName = data.name || "Opponent";
                updateNamesUI();
                startRound(); 
            }
            break;

        case 'INIT_ROUND':
            console.log("GUEST: Deck Received! Stopping Loop.");
            if (gameState.handshakeInterval) {
                clearInterval(gameState.handshakeInterval);
                gameState.handshakeInterval = null;
            }
            if(data.hostName) gameState.opponentName = data.hostName;
            updateNamesUI();
            syncBoardState(data);
            break;

        case 'NAME_UPDATE':
            gameState.opponentName = data.name;
            updateNamesUI();
            break;

        // --- GAMEPLAY ---
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
    if (gameState.conn && gameState.conn.open) {
        gameState.conn.send(data);
    }
}

function updateNamesUI() {
    const labels = document.querySelectorAll('.stat-label');
    if(labels[0]) labels[0].innerText = gameState.opponentName;
}

// --- HOST LOGIC: SAFE DEALING ---
function startRound() {
    if (!gameState.isHost) return;

    // 1. INITIAL SETUP (Only run ONCE per round)
    if (!gameState.roundInitialized) {
        let fullDeck = createDeck();
        shuffle(fullDeck);
        
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

        gameState.roundInitialized = true; 
    }

    // 2. SEND STATE
    const pB = !document.getElementById('borrowed-player').classList.contains('hidden');
    const aB = !document.getElementById('borrowed-ai').classList.contains('hidden');

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
        aTotal: gameState.playerTotal,
        pBorrow: aB, 
        aBorrow: pB
    });
}

function syncBoardState(data) {
    gameState.playerDeck = data.pDeck.map(d => new Card(d.suit, d.rank, d.value, d.id));
    gameState.aiDeck = data.aDeck.map(d => new Card(d.suit, d.rank, d.value, d.id));
    gameState.playerTotal = data.pTotal;
    gameState.aiTotal = data.aTotal;

    document.getElementById('borrowed-player').classList.toggle('hidden', !data.pBorrow);
    document.getElementById('borrowed-ai').classList.toggle('hidden', !data.aBorrow);

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
        else leftPos = 77 - (laneIdx * 24); 

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

// --- DECK INTERACTION (RESTORED) ---
PlayerDeckClick() {
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
// --- RESTORED DECK LOGIC ---
PlayerDeckClick() {
    // 1. PRE-GAME READY
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;
        gameState.playerReady = true; 
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        
        // Notify Opponent
        send({ type: 'OPPONENT_REVEAL_READY' });

        checkDrawCondition();
        return;
    }

    // 2. IN-GAME REVEAL (This was missing!)
    if (gameState.gameActive && !gameState.playerReady) {
        gameState.playerReady = true;
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        
        // Notify Opponent
        send({ type: 'OPPONENT_REVEAL_READY' });
        
        checkDrawCondition();
    }
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

// --- CARD PLAYING & WIN ---
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
        gameState.lastMoveTime = Date.now(); 

        send({ type: 'OPPONENT_MOVE', cardId: card.id, targetSide: side });

        gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');

        imgElement.remove(); renderCenterPile(side, card); updateScoreboard();
        checkSlapCondition(); 

        if (gameState.playerTotal <= 0) {
            sendGameOver(gameState.myName + " WINS!", false);
            showEndGame("YOU WIN THE MATCH!", true);
            return true;
        }

        if (gameState.playerHand.length === 0) {
            const nextPTotal = gameState.playerTotal;
            const nextATotal = 52 - gameState.playerTotal;
            handleRoundOver('player', nextPTotal, nextATotal);
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

RoundOver(winner, myNextTotal, oppNextTotal) {
    gameState.gameActive = false;
    gameState.roundInitialized = false; 

    gameState.playerTotal = myNextTotal;
    gameState.aiTotal = oppNextTotal;

    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';

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
        if (gameState.isHost) startRound(); 
    };
    modal.classList.remove('hidden');
}

// --- STANDARD LOGIC ---
function performReveal() {
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    
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

    const pBorrow = !document.getElementById('borrowed-player').classList.contains('hidden') || gameState.playerTotal <= 10;
    const aBorrow = !document.getElementById('borrowed-ai').classList.contains('hidden') || gameState.aiTotal <= 10;

    if (pBorrow) gameState.aiTotal = Math.max(0, gameState.aiTotal - 2);
    else if (aBorrow) gameState.playerTotal = Math.max(0, gameState.playerTotal - 2);
    else { gameState.playerTotal--; gameState.aiTotal--; }
    
    gameState.lastMoveTime = Date.now(); 

    if (gameState.playerDeck.length > 0) { let c = gameState.playerDeck.pop(); gameState.centerPileRight.push(c); renderCenterPile('right', c); }
    if (gameState.aiDeck.length > 0) { let c = gameState.aiDeck.pop(); gameState.centerPileLeft.push(c); renderCenterPile('left', c); }

    updateScoreboard();
    gameState.gameActive = true; 
    gameState.playerReady = false; gameState.aiReady = false;
    checkSlapCondition();
}

function handleInput(e) {
    // Only react to Spacebar
    if (e.code === 'Space') {
        e.preventDefault();

        // 0. SAFETY CHECK: Ignore inputs if game isn't running
        if (!gameState.gameActive) return;

        const now = Date.now();

        // 1. SPAM CHECK (Reduced to 400ms)
        // Prevents accidental double-taps but allows follow-up attempts quickly
        if (now - gameState.lastSpacebarTime < 400) { 
            console.log("Ignored: Spam Protection");
            // Optional: Issue penalty here if you want strict spam rules, 
            // but for "unable to slap" issues, usually best to just ignore input.
            // If you want the penalty back, uncomment the next line:
            // issuePenalty('player', 'SPAM'); 
            return; 
        }
        gameState.lastSpacebarTime = now;

        // 2. ANTICIPATION RULE (< 65ms reaction)
        // If you slap faster than humanly possible after a move, it's a guess.
        if (now - gameState.lastMoveTime < 65) { 
            console.log("Penalty: Anticipation (Too Fast)");
            issuePenalty('player', 'ANTICIPATION'); 
            return; 
        }

        // 3. BAD SLAP (No Match)
        if (!gameState.slapActive) { 
            console.log("Penalty: Bad Slap (No Match)");
            issuePenalty('player', 'BAD SLAP'); 
            return; 
        }

        // 4. VALID SLAP
        console.log("Slap Valid! Claiming...");
        send({ type: 'SLAP_CLAIM', timestamp: Date.now() });
        if (gameState.isHost) resolveSlapClaim('host', Date.now());
    }
}
function issuePenalty(target, reason) {
    let yellows, reds;
    if (target === 'player') { gameState.playerYellows++; yellows = gameState.playerYellows; reds = gameState.playerReds; } 
    else { gameState.aiYellows++; yellows = gameState.aiYellows; reds = gameState.aiReds; }

    if (yellows >= 2) {
        if (target === 'player') { gameState.playerYellows = 0; gameState.playerReds++; }
        else { gameState.aiYellows = 0; gameState.aiReds++; }
        executeRedCardConsequence(target);
    }
    updatePenaltyUI();
    if(target === 'player') {
        send({ type: 'PENALTY_UPDATE', target: 'opponent', reason: reason, pTotal: gameState.aiTotal, aTotal: gameState.playerTotal, y: gameState.playerYellows, r: gameState.playerReds });
    }
}
function applyPenaltySync(target, reason, pTotal, aTotal, y, r) {
    if (target === 'opponent') { gameState.aiYellows = y; gameState.aiReds = r; gameState.playerTotal = pTotal; gameState.aiTotal = aTotal; }
    updatePenaltyUI();
    updateScoreboard();
}
function executeRedCardConsequence(offender) {
    if (offender === 'player') { gameState.playerTotal = Math.max(0, gameState.playerTotal - 3); gameState.aiTotal += 3; } 
    else { gameState.aiTotal = Math.max(0, gameState.aiTotal - 3); gameState.playerTotal += 3; }
    updateScoreboard();
    if (gameState.playerTotal <= 0) { sendGameOver(gameState.myName + " WINS!", false); showEndGame("YOU WIN!", true); }
    if (gameState.aiTotal <= 0) { sendGameOver("YOU WIN THE MATCH!", true); showEndGame(gameState.opponentName + " WINS!", false); }
}
function updatePenaltyUI() {
    renderBadges('player', gameState.playerYellows, gameState.playerReds);
    renderBadges('ai', gameState.aiYellows, gameState.aiReds);
}
function renderBadges(who, y, r) {
    const container = document.getElementById(`${who}-penalties`);
    container.innerHTML = '';
    if (r > 0) { const div = document.createElement('div'); div.className = 'card-icon icon-red'; if (r > 1) div.innerText = r; container.appendChild(div); }
    if (y > 0) { const div = document.createElement('div'); div.className = 'card-icon icon-yellow'; container.appendChild(div); }
}
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
    el.style.position = 'fixed'; el.style.left = destX + 'px'; el.style.top = destY + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
    setTimeout(() => { el.remove(); callback(); }, 400);
}
function tryFlipCard(img, card) {
    const live = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (live < 4) { setCardFaceUp(img, card, 'player'); send({ type: 'OPPONENT_FLIP', cardId: card.id }); }
}
function executeOpponentFlip(cardId) {
    const card = gameState.aiHand.find(c => c.id === cardId);
    if (!card) return;
    card.isFaceUp = true;
    if (card.element) { card.element.src = card.imgSrc; card.element.classList.remove('card-face-down'); card.element.classList.add('opponent-card'); }
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
function resolveSlapClaim(who, timestamp) {
    const winner = (who === 'host') ? 'player' : 'ai';
    const isHostWin = (who === 'host');
    applySlapResult(isHostWin ? 'player' : 'ai'); 
    send({ type: 'SLAP_RESULT', winner: isHostWin ? 'ai' : 'player' }); 
}
function sendGameOver(msg, isWin) { send({ type: 'GAME_OVER', msg: msg, isWin: isWin }); }
function showEndGame(title, isWin) {
    const modal = document.getElementById('game-message');
    modal.querySelector('h1').innerText = title; modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';
    modal.querySelector('p').innerText = "Refresh to play again."; document.getElementById('msg-btn').classList.add('hidden'); modal.classList.remove('hidden');
    setTimeout(() => {
        const myRole = localStorage.getItem('isf_role');
        const winnerRole = isWin ? myRole : (myRole === 'host' ? 'join' : 'host');
        window.parent.postMessage({ type: 'GAME_COMPLETE', winnerRole: winnerRole }, '*');
    }, 3000);
}
