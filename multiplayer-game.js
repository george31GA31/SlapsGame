/* =========================================
   MULTIPLAYER GAME.JS (Human vs Human)
   - Host Authoritative Logic
   - Guest Visual Mirroring
   ========================================= */

const gameState = {
    // Deck/hand state
    playerDeck: [],
    aiDeck: [],             // REUSED AS OPPONENT DECK
    playerHand: [],
    aiHand: [],             // REUSED AS OPPONENT HAND

    centerPileLeft: [],
    centerPileRight: [],

    globalZ: 1000,

    playerTotal: 26,
    aiTotal: 26,            // REUSED AS OPPONENT TOTAL

    gameActive: false,
    matchEnded: false,

    playerReady: false,
    aiReady: false,         // REUSED AS OPPONENT READY

    drawLock: false,
    countdownRunning: false,

    slapActive: false,
    lastSpacebarTime: 0,

    playerYellows: 0,
    playerReds: 0,
    aiYellows: 0,           // REUSED AS OPPONENT YELLOWS
    aiReds: 0,              // REUSED AS OPPONENT REDS

    // Multiplayer connection
    isHost: false,
    peer: null,
    conn: null,
    myId: null,
    roomCode: null,

    myName: "ME",
    opponentName: "OPPONENT",

    handshakeDone: false,
    roundStarted: false,

    // For snapping back on reject
    lastDraggedCard: null,
    lastDraggedEl: null,

    // Ghosts for opponent drag previews
    opponentDragGhosts: new Map(),

    // Sequence counter
    moveSeq: 0,

    // Stats
    p1Rounds: 0,
    aiRounds: 0,
    p1Slaps: 0,
    aiSlaps: 0
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png';

// Foundation lane x positions
const PLAYER_LANES = [5, 29, 53, 77];

class Card {
    constructor(suit, rank, value, id) {
        this.suit = suit;
        this.rank = rank;
        this.value = value;
        this.id = id || Math.random().toString(36).substr(2, 9);
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false;
        this.owner = null;
        this.element = null;
        this.laneIndex = 0;
        this.originalLeft = null;
        this.originalTop = null;
    }
}

/* ================================
   BOOTSTRAP
   ================================ */

window.onload = function () {
    document.addEventListener('keydown', handleInput);

    const pDeck = document.getElementById('player-draw-deck');
    if (pDeck) pDeck.onclick = handlePlayerDeckClick;

    updateScoreboardWidget();
    initMultiplayer();
};

/* ================================
   MULTIPLAYER INIT
   ================================ */

function initMultiplayer() {
    const role = (localStorage.getItem('isf_role') || '').toLowerCase();
    const hostId = (localStorage.getItem('isf_code') || '').trim();
    const myName = (localStorage.getItem('isf_my_name') || 'Player').trim();

    gameState.myName = myName;
    gameState.opponentName = 'OPPONENT';

    gameState.isHost = (role === 'host');
    gameState.roomCode = hostId;

    if (!hostId) {
        showRoundMessage("NO MATCH DATA", "Return to matchmaking and create or join a match.");
        return;
    }

    gameState.peer = gameState.isHost ? new Peer(hostId) : new Peer();

    gameState.peer.on('open', (id) => {
        gameState.myId = id;
        if (gameState.isHost) {
            gameState.peer.on('connection', (conn) => bindConnection(conn));
        } else {
            const conn = gameState.peer.connect(hostId, { reliable: true });
            bindConnection(conn);
        }
    });

    gameState.peer.on('error', (err) => {
        console.error(err);
        showRoundMessage("CONNECTION ERROR", "Return to matchmaking and try again.");
    });
}

function bindConnection(conn) {
    gameState.conn = conn;

    conn.on('open', () => {
        sendNet({ type: 'HANDSHAKE', name: gameState.myName });
    });

    conn.on('data', (msg) => handleNet(msg));

    conn.on('close', () => {
        // If match already ended normally, ignore disconnect
        if (gameState.matchEnded) return;
        handleNet({ type: 'OPPONENT_LEFT' }); 
    });

    conn.on('error', (err) => {
        console.error("Connection quirk:", err);
        // We do nothing here. 'close' will handle actual drops.
    });
}
function sendNet(obj) {
    if (gameState.conn && gameState.conn.open) {
        gameState.conn.send(obj);
    }
}

/* ================================
   NETWORK MESSAGE HANDLER
   ================================ */

function handleNet(msg) {
    if (!msg) return;

    if (msg.type === 'HANDSHAKE') {
        gameState.opponentName = msg.name || 'OPPONENT';
        updateScoreboardWidget();

        if (!gameState.handshakeDone) {
            gameState.handshakeDone = true;
            sendNet({ type: 'HANDSHAKE', name: gameState.myName });
        }

        if (gameState.isHost && !gameState.roundStarted) {
            gameState.roundStarted = true;
            startRoundHostAuthoritative();
        }
        return;
    }

    if (msg.type === 'ROUND_START') {
        if (!gameState.isHost) startRoundJoinerFromState(msg.state);
        return;
    }

    if (msg.type === 'READY') {
        gameState.aiReady = true;
        const oDeck = document.getElementById('ai-draw-deck');
        if (oDeck) oDeck.classList.add('deck-ready');
        checkDrawConditionMultiplayer();
        return;
    }

    if (msg.type === 'HOST_COUNTDOWN') {
        startCountdownFromHost();
        return;
    }

    if (msg.type === 'REVEAL_PRELOAD') {
        applyRevealPreload(msg.result);
        return;
    }

    if (msg.type === 'REVEAL_SHOW') {
        applyRevealShow();
        return;
    }

    if (msg.type === 'DRAG') {
        applyOpponentDrag(msg.drag);
        return;
    }

    if (msg.type === 'MOVE_REQ') {
        if (gameState.isHost) adjudicateMove(msg.move, 'ai');
        return;
    }

    if (msg.type === 'MOVE_APPLY') {
        applyMoveFromHost(msg.apply);
        return;
    }

    if (msg.type === 'MOVE_REJECT') {
        rejectMoveFromHost(msg.reject);
        return;
    }
   
   if (msg.type === 'OPPONENT_REJECT') {
        // The Host tried to play but failed. Delete their ghost.
        cleanupGhost(msg.card);
        return;
    }

    if (msg.type === 'SYNC') {
        if (!gameState.isHost) startRoundJoinerFromState(msg.state);
        return;
    }

    if (msg.type === 'OPPONENT_FLIP') {
        const card = gameState.aiHand.find(c => c.id === msg.cardId);
        if (card && card.element) setCardFaceUp(card.element, card, 'ai');
        return;
    }
    
    // --- SLAP & PENALTY HANDLERS ---
    if (msg.type === 'SLAP_REQ') {
        if (gameState.isHost) adjudicateSlap('ai');
        return;
    }

    if (msg.type === 'SLAP_UPDATE') {
        applySlapUpdate(msg);
        return;
    }

    if (msg.type === 'PENALTY_UPDATE') {
        applyPenaltyUpdate(msg);
        return;
    }
    if (msg.type === 'ROUND_OVER') {
        applyRoundOver(msg);
        return;
    }

    if (msg.type === 'MATCH_OVER') {
        applyMatchOver(msg);
        return;
    }
    
    // --- DISCONNECT HANDLER ---
// --- DISCONNECT HANDLER ---
    if (msg.type === 'OPPONENT_LEFT') {
        // FIX 2: If the match is already over (someone won), ignore the disconnect.
        if (gameState.matchEnded) return;

        const name = (gameState.opponentName || "OPPONENT").toUpperCase();
        const modal = document.getElementById('game-message');
        if (modal) {
            modal.querySelector('h1').innerText = "VICTORY";
            modal.querySelector('h1').style.color = '#66ff66';
            const contentArea = modal.querySelector('p');
            contentArea.innerHTML = `
                YOU WON. ${name} HAS CONCEDED THE MATCH.
                <div style="display:flex; gap:10px; justify-content:center; margin-top:20px;">
                    <button class="btn-action-small" onclick="window.location.href='index.html'" style="background:#ff4444; width:auto;">
                        MAIN MENU
                    </button>
                </div>
            `;
            const oldBtn = document.getElementById('msg-btn');
            if (oldBtn) oldBtn.classList.add('hidden');
            modal.classList.remove('hidden');
        }
        return;
    }

    // --- REMATCH HANDLERS ---
    if (msg.type === 'REMATCH_REQ') {
        const modal = document.getElementById('rematch-modal');
        if (modal) modal.classList.remove('hidden');
        return;
    }

    if (msg.type === 'REMATCH_YES') {
        // FIX 1: FULL RESET
        // Opponent accepted -> We must reset everything to start fresh
        
        const modal = document.getElementById('game-message');
        if(modal) modal.classList.add('hidden');
        
        // Reset Logic
        gameState.p1Rounds = 0; gameState.aiRounds = 0;
        gameState.p1Slaps = 0; gameState.aiSlaps = 0;
        
        // CRITICAL: Reset totals to 26 so startRound doesn't think the game is over
        gameState.playerTotal = 26; 
        gameState.aiTotal = 26;
        
        gameState.matchEnded = false; // Allow disconnects to count again
        
        // Reset Visuals
        updateScoreboardWidget();
        
        // Host triggers the deal
        if (gameState.isHost) {
            startRoundHostAuthoritative();
        }
        return;
    }

    if (msg.type === 'REMATCH_NO') {
        alert("Opponent declined the rematch.");
        window.location.href = 'index.html';
        return;
    }
} 

function handleInput(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        if (!gameState.gameActive) return;

        // Debounce to prevent double-spam
        const now = Date.now();
        if (now - gameState.lastSpacebarTime < 400) { return; }
        gameState.lastSpacebarTime = now;

        if (gameState.isHost) {
            // Host decides immediately (as 'player')
            adjudicateSlap('player'); 
        } else {
            // Guest asks Host to decide
            sendNet({ type: 'SLAP_REQ' }); 
        }
    }
}

function updatePenaltyUI() {
    renderBadges('player', gameState.playerYellows, gameState.playerReds);
    renderBadges('ai', gameState.aiYellows, gameState.aiReds);
}

function renderBadges(who, y, r) {
    const container = document.getElementById(`${who}-penalties`);
    if (!container) return;
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
    } else {
        gameState.slapActive = false;
    }
}

/* ================================
   HOST AUTHORITATIVE SLAP & PENALTY LOGIC
   ================================ */

function adjudicateSlap(who) {
    // Only Host runs this
    if (!gameState.gameActive) return;

    if (gameState.slapActive) {
        // --- VALID SLAP ---
        gameState.gameActive = false; // Stop game immediately

        const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

        // --- FIX: GIVE CARDS TO THE LOSER ---
        // If Host ('player') won the slap -> Guest ('ai') takes the cards.
        // If Guest ('ai') won the slap -> Host ('player') takes the cards.
        
        if (who === 'player') { 
            gameState.aiTotal += pilesTotal; // Host Won, Guest takes cards
        } else { 
            gameState.playerTotal += pilesTotal; // Guest Won, Host takes cards
        }

        // Clear Host Piles logic
        gameState.centerPileLeft = [];
        gameState.centerPileRight = [];
        gameState.slapActive = false;

        // Broadcast Valid Win
        const update = {
            type: 'SLAP_UPDATE',
            winner: who, // 'player' (Host) or 'ai' (Guest) - Use this for the "Who Won" text
            pTotal: gameState.playerTotal,
            aTotal: gameState.aiTotal
        };
        
        sendNet(update);
        applySlapUpdate(update); 

    } else {
        // --- INVALID SLAP (PENALTY) ---
        issuePenaltyHostAuth(who);
    }
}
function issuePenaltyHostAuth(who) {
    let currentY, currentR;

    // Update flags locally on Host
    if (who === 'player') {
        gameState.playerYellows++;
        currentY = gameState.playerYellows;
        currentR = gameState.playerReds;
    } else {
        gameState.aiYellows++;
        currentY = gameState.aiYellows;
        currentR = gameState.aiReds;
    }

    // Check Red Card Logic
    let isRed = false;
    if (currentY >= 2) {
        isRed = true;
        // Reset Yellows, Increment Red
        if (who === 'player') { 
            gameState.playerYellows = 0; 
            gameState.playerReds++; 
            currentR = gameState.playerReds; 
            currentY = 0; 
            
            // Penalty: Host loses 3 cards
            gameState.playerTotal = Math.max(0, gameState.playerTotal - 3);
            gameState.aiTotal += 3;
        } else { 
            gameState.aiYellows = 0; 
            gameState.aiReds++; 
            currentR = gameState.aiReds; 
            currentY = 0; 
            
            // Penalty: Guest loses 3 cards
            gameState.aiTotal = Math.max(0, gameState.aiTotal - 3);
            gameState.playerTotal += 3;
        }
    }

    // Broadcast Penalty to both
    const payload = {
        type: 'PENALTY_UPDATE',
        target: who,
        yellows: currentY,
        reds: currentR,
        isRed: isRed,
        pTotal: gameState.playerTotal, // Sync scores
        aTotal: gameState.aiTotal
    };
    
    sendNet(payload);
    applyPenaltyUpdate(payload);
}

// --- VISUAL APPLICATORS (Run on both Client & Host) ---

function applySlapUpdate(data) {
    gameState.gameActive = false;
    gameState.slapActive = false;

    // 1. Determine Perspective for "Winner" Text
    let winnerText = "";
    let color = "";
    
    const iAmHost = gameState.isHost;
    const hostWon = (data.winner === 'player');
    const iWon = (iAmHost && hostWon) || (!iAmHost && !hostWon);

    if (iWon) {
        winnerText = "YOU WON THE SLAPS!";
        color = "rgba(0, 200, 0, 0.9)";
    } else {
        const name = gameState.opponentName || "OPPONENT";
        winnerText = `${name.toUpperCase()} WON THE SLAPS!`;
        color = "rgba(200, 0, 0, 0.9)";
    }

    // 2. Show Overlay
    const overlay = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    if (overlay && txt) {
        txt.innerText = winnerText;
        overlay.style.backgroundColor = color;
        overlay.classList.remove('hidden');
    }

    // --- FIX: DO NOT CLEAR PILES YET ---
    // We want the cards to "stay where they are" so players see the result.
    // We only clean up the "Ghosts" (moving cards) immediately.
    
    if (gameState.opponentDragGhosts) {
        gameState.opponentDragGhosts.forEach(el => el.remove()); 
        gameState.opponentDragGhosts.clear(); 
    }

    // Restore opacity of any cards that were being dragged so they don't look invisible
    gameState.aiHand.forEach(c => { if (c.element) c.element.style.opacity = '1'; });
    gameState.playerHand.forEach(c => { if (c.element) c.element.style.opacity = '1'; });

    // 3. Update Stats & Scores (Data only, visual piles stay)
    if (gameState.isHost) {
        gameState.playerTotal = data.pTotal;
        gameState.aiTotal = data.aTotal;
    } else {
        gameState.playerTotal = data.aTotal;
        gameState.aiTotal = data.pTotal;
    }
    
    updateScoreboard();
    
    if (iWon) gameState.p1Slaps++; 
    else gameState.aiSlaps++;
    
    updateScoreboardWidget();

    // 4. RESET EVERYTHING AFTER 2 SECONDS
    setTimeout(() => {
        // NOW we clear the visual piles
        gameState.centerPileLeft = [];
        gameState.centerPileRight = [];
        document.getElementById('center-pile-left').innerHTML = '';
        document.getElementById('center-pile-right').innerHTML = '';

        overlay.classList.add('hidden');
        gameState.playerReady = false;
        gameState.aiReady = false;

        document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
        document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

        if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
        if (gameState.aiTotal <= 0) showEndGame("OPPONENT WINS THE MATCH!", false);
    }, 2000);
}
function applyPenaltyUpdate(data) {
    // 1. Sync Scores
    // --- FIX: PERSPECTIVE SWAP ---
    if (gameState.isHost) {
        gameState.playerTotal = data.pTotal;
        gameState.aiTotal = data.aTotal;
    } else {
        // I am Guest: My total is the 'AI' total from the message
        gameState.playerTotal = data.aTotal;
        gameState.aiTotal = data.pTotal;
    }
    // -----------------------------
    updateScoreboard();

    // 2. Determine whose badges to update locally
    let localTarget = data.target; 
    
    if (!gameState.isHost) {
        // Perspective Swap for Guest
        localTarget = (data.target === 'player') ? 'ai' : 'player';
    }

    renderBadges(localTarget, data.yellows, data.reds);

    if (data.isRed) {
        const penaltiesDiv = document.getElementById(`${localTarget}-penalties`);
        if (penaltiesDiv) {
            penaltiesDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
            setTimeout(() => penaltiesDiv.style.backgroundColor = 'transparent', 300);
        }
    }
}

async function startRoundHostAuthoritative() {
    gameState.matchEnded = false;

    let fullDeck = createDeck();
    shuffle(fullDeck);

    if (gameState.playerTotal <= 0) { showEndGame("YOU WIN THE MATCH!", true); return; }
    if (gameState.aiTotal <= 0) { showEndGame("OPPONENT WINS THE MATCH!", false); return; }

    const pTotal = gameState.playerTotal;
    const pAllCards = fullDeck.slice(0, pTotal);
    const aAllCards = fullDeck.slice(pTotal, 52);

    const pHandSize = Math.min(10, pTotal);
    const aHandSize = Math.min(10, 52 - pTotal);

    const pHandCards = pAllCards.splice(0, pHandSize);
    gameState.playerDeck = pAllCards;

    const aHandCards = aAllCards.splice(0, aHandSize);
    gameState.aiDeck = aAllCards;

    // Borrow tags reset
    const bp = document.getElementById('borrowed-player');
    const ba = document.getElementById('borrowed-ai');
    if (bp) bp.classList.add('hidden');
    if (ba) ba.classList.add('hidden');

    // Initial shortage borrow
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 1) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        gameState.playerDeck = gameState.aiDeck.splice(0, steal);
        if (bp) bp.classList.remove('hidden');
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 1) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        gameState.aiDeck = gameState.playerDeck.splice(0, steal);
        if (ba) ba.classList.remove('hidden');
    }

    await preloadCardImages([...pHandCards, ...aHandCards]);

    dealSmartHand(pHandCards, 'player');
    dealSmartHand(aHandCards, 'ai');

    resetCenterPiles();
    checkDeckVisibility();

    gameState.gameActive = false;
    gameState.playerReady = false;
    gameState.aiReady = false;

    updateScoreboard();
    updateScoreboardWidget();

    const pHandOrdered = [...pHandCards];
    const aHandOrdered = [...aHandCards];

    const borrowedAiEl = document.getElementById('borrowed-ai');
    const borrowedPlayerEl = document.getElementById('borrowed-player');

    const guestState = {
        playerTotal: gameState.aiTotal,
        aiTotal: gameState.playerTotal,
        playerDeck: gameState.aiDeck.map(packCard),
        aiDeck: gameState.playerDeck.map(packCard),
        playerHand: aHandOrdered.map(packCard),
        aiHand: pHandOrdered.map(packCard),
        centerPileLeft: gameState.centerPileRight.map(packCard),
        centerPileRight: gameState.centerPileLeft.map(packCard),
        borrowedPlayer: borrowedAiEl ? !borrowedAiEl.classList.contains('hidden') : false,
        borrowedAi: borrowedPlayerEl ? !borrowedPlayerEl.classList.contains('hidden') : false
    };

    sendNet({ type: 'ROUND_START', state: guestState });
}

async function startRoundJoinerFromState(state) {
    importState(state);
    await preloadCardImages([...gameState.playerHand, ...gameState.aiHand]);
    dealSmartHand(gameState.playerHand, 'player');
    dealSmartHand(gameState.aiHand, 'ai');
    resetCenterPiles();
    const bp = document.getElementById('borrowed-player');
    const ba = document.getElementById('borrowed-ai');
    if (bp) state.borrowedPlayer ? bp.classList.remove('hidden') : bp.classList.add('hidden');
    if (ba) state.borrowedAi ? ba.classList.remove('hidden') : ba.classList.add('hidden');
    checkDeckVisibility();
    gameState.gameActive = false;
    gameState.playerReady = false;
    gameState.aiReady = false;
    updateScoreboard();
    updateScoreboardWidget();
}

function resetCenterPiles() {
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];

    // Cleanup ghosts on round reset
    if (gameState.opponentDragGhosts) {
        gameState.opponentDragGhosts.forEach(el => el.remove());
        gameState.opponentDragGhosts.clear();
    }

    const l = document.getElementById('center-pile-left');
    const r = document.getElementById('center-pile-right');
    if (l) l.innerHTML = '';
    if (r) r.innerHTML = '';

    const modal = document.getElementById('game-message');
    if (modal) modal.classList.add('hidden');

    gameState.slapActive = false;
}

function packCard(c) {
    return { suit: c.suit, rank: c.rank, value: c.value, id: c.id };
}

function packCardWithMeta(c) {
    return {
        suit: c.suit, rank: c.rank, value: c.value, id: c.id,
        isFaceUp: !!c.isFaceUp, owner: c.owner, laneIndex: c.laneIndex
    };
}

function unpackCard(obj) {
    const c = new Card(obj.suit, obj.rank, obj.value, obj.id);
    c.isFaceUp = !!obj.isFaceUp;
    c.owner = obj.owner ?? null;
    c.laneIndex = obj.laneIndex ?? 0;
    return c;
}

function importState(s) {
    gameState.playerTotal = s.playerTotal;
    gameState.aiTotal = s.aiTotal;
    gameState.playerDeck = (s.playerDeck || []).map(unpackCard);
    gameState.aiDeck = (s.aiDeck || []).map(unpackCard);
    gameState.playerHand = (s.playerHand || []).map(unpackCard);
    gameState.aiHand = (s.aiHand || []).map(unpackCard);
    gameState.centerPileLeft = (s.centerPileLeft || []).map(unpackCard);
    gameState.centerPileRight = (s.centerPileRight || []).map(unpackCard);
}

/* ================================
   DEAL / RENDER HAND
   ================================ */

function dealSmartHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    if (!container) return;
    container.innerHTML = '';

    if (owner === 'player') gameState.playerHand = [];
    else gameState.aiHand = [];

    const piles = [[], [], [], []];
    if (cards.length >= 10) {
        let cardIdx = 0;
        [4, 3, 2, 1].forEach((size, i) => {
            for (let j = 0; j < size; j++) piles[i].push(cards[cardIdx++]);
        });
    } else {
        let pileIdx = 0;
        cards.forEach(card => {
            piles[pileIdx].push(card);
            pileIdx = (pileIdx + 1) % 4;
        });
    }

    const laneOrder = (owner === 'ai') ? [3, 2, 1, 0] : [0, 1, 2, 3];

    laneOrder.forEach((laneIdx, displayIdx) => {
        const pile = piles[laneIdx];
        if (!pile || pile.length === 0) return;

        pile.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card';
            card.owner = owner;
            card.laneIndex = laneIdx;

            const isTopCard = (index === pile.length - 1);
            if (isTopCard) setCardFaceUp(img, card, owner);
            else setCardFaceDown(img, card, owner);

            img.style.left = `${PLAYER_LANES[displayIdx]}%`;
            const stackOffset = index * 5;
            if (owner === 'ai') img.style.top = `${10 + stackOffset}px`;
            else img.style.top = `${60 - stackOffset}px`;

            img.style.zIndex = index + 10;
            card.element = img;
            container.appendChild(img);

            if (owner === 'player') gameState.playerHand.push(card);
            else gameState.aiHand.push(card);
        });
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
    } else {
        img.classList.add('opponent-card');
    }
}

function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    card.isFaceUp = false;
    if (owner === 'player') img.onclick = () => tryFlipCard(img, card);
}

function tryFlipCard(img, card) {
    const liveCards = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (liveCards < 4) {
        setCardFaceUp(img, card, 'player');
        sendNet({ type: 'OPPONENT_FLIP', cardId: card.id });
    }
}

function cardKey(c) {
    return `${c.suit}:${c.rank}:${c.value}:${c.owner}:${c.laneIndex}`;
}

/* ================================
   DRAG AND DROP LOGIC
   ================================ */

function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault();
        gameState.globalZ++;
        img.style.zIndex = gameState.globalZ;
        img.style.transition = 'none';

        cardData.originalLeft = img.style.left;
        cardData.originalTop = img.style.top;
        gameState.lastDraggedCard = cardData;
        gameState.lastDraggedEl = img;

        const box = document.getElementById('player-foundation-area');
        if (!box) return;

        const startRect = img.getBoundingClientRect();
        let shiftX = e.clientX - startRect.left;
        let shiftY = e.clientY - startRect.top;

        function getCenterNormals(currLeft, currTop, containerW, containerH) {
            const elW = img.offsetWidth;
            const elH = img.offsetHeight;
            const centerX = currLeft + (elW / 2);
            const centerY = currTop + (elH / 2);
            const nx = (containerW > 0) ? (centerX / containerW) : 0;
            const ny = (containerH > 0) ? (centerY / containerH) : 0;
            return { nx, ny };
        }

        function moveAt(pageX, pageY, sendDrag) {
            const boxRect = box.getBoundingClientRect();
            let newLeft = pageX - shiftX - boxRect.left;
            let newTop = pageY - shiftY - boxRect.top;

            if (newTop < 0) {
                if (!gameState.gameActive || !checkLegalPlay(cardData)) newTop = 0;
            }

            img.style.left = newLeft + 'px';
            img.style.top = newTop + 'px';

            if (sendDrag) {
                const { nx, ny } = getCenterNormals(newLeft, newTop, boxRect.width, boxRect.height);
                sendNet({
                    type: 'DRAG',
                    drag: { id: cardKey(cardData), nx, ny, phase: 'move', src: cardData.imgSrc }
                });
            }
        }

        {
            const boxRect = box.getBoundingClientRect();
            const startLeft = e.pageX - shiftX - boxRect.left;
            const startTop = e.pageY - shiftY - boxRect.top;
            const { nx, ny } = getCenterNormals(startLeft, startTop, boxRect.width, boxRect.height);
            sendNet({ 
                type: 'DRAG', 
                drag: { id: cardKey(cardData), nx, ny, phase: 'start', src: cardData.imgSrc } 
            });
        }

        moveAt(e.pageX, e.pageY, false);

        function onMouseMove(event) {
            moveAt(event.pageX, event.pageY, true);
        }

        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            img.style.transition = 'all 0.1s ease-out';

            if (gameState.gameActive && parseInt(img.style.top) < -10) {
                const dropSide = getDropSide(img, event); 
                requestMoveToHost(cardData, dropSide);
            } else {
                const boxRect = box.getBoundingClientRect();
                const currLeft = parseFloat(img.style.left) || 0;
                const currTop = parseFloat(img.style.top) || 0;
                const { nx, ny } = getCenterNormals(currLeft, currTop, boxRect.width, boxRect.height);
                sendNet({ 
                    type: 'DRAG', 
                    drag: { id: cardKey(cardData), nx, ny, phase: 'end', src: cardData.imgSrc } 
                });
            }
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

function applyOpponentDrag(d) {
    const box = document.getElementById('ai-foundation-area');
    if (!box) return;
    const boxRect = box.getBoundingClientRect();

    const centerMx = 1 - d.nx;
    const centerMy = 1 - d.ny;
    const ghostId = d.id; 
    let el = gameState.opponentDragGhosts.get(ghostId);

    let realCard = null;
    if (d.id) {
        const parts = d.id.split(':');
        if (parts.length >= 3) {
            const s = parts[0]; const r = parts[1]; const v = parseInt(parts[2]);
            realCard = gameState.aiHand.find(c => c.suit === s && c.rank === r && c.value === v);
        }
    }

    if (d.phase === 'start') {
        if (realCard && realCard.element) realCard.element.style.opacity = '0';
        if (!el) {
            el = document.createElement('img');
            el.className = 'game-card opponent-card'; 
            el.src = d.src || 'assets/cards/back_of_card.png';
            el.style.position = 'absolute';
            el.style.zIndex = 5000;
            el.style.pointerEvents = 'none';
            el.style.transition = 'none';
            el.style.opacity = '1';
            box.appendChild(el);
            gameState.opponentDragGhosts.set(ghostId, el);
        }
    }

    if (!el) return;

    const ghostWidth = el.offsetWidth || (window.innerHeight * 0.12); 
    const ghostHeight = ghostWidth * 1.45;
    el.style.left = ((centerMx * boxRect.width) - (ghostWidth / 2)) + 'px';
    el.style.top = ((centerMy * boxRect.height) - (ghostHeight / 2)) + 'px';

    if (d.phase === 'end') {
        if (realCard && realCard.element) {
            realCard.element.style.opacity = '0';
        }
    }
}

function getDropSide(imgElement, mouseEvent) {
    const leftPileEl = document.getElementById('center-pile-left');
    const rightPileEl = document.getElementById('center-pile-right');
    if (!leftPileEl || !rightPileEl) return null;

    const x = mouseEvent.clientX;
    const y = mouseEvent.clientY;
    const pad = 25;

    const l = leftPileEl.getBoundingClientRect();
    const r = rightPileEl.getBoundingClientRect();

    const inLeft = x >= (l.left - pad) && x <= (l.right + pad) && y >= (l.top - pad) && y <= (l.bottom + pad);
    const inRight = x >= (r.left - pad) && x <= (r.right + pad) && y >= (r.top - pad) && y <= (r.bottom + pad);

    if (inLeft) return 'left';
    if (inRight) return 'right';
    return null;
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

/* ================================
   MOVE REQUEST / HOST ADJUDICATION
   ================================ */

function requestMoveToHost(cardData, dropSide) {
    if (dropSide !== 'left' && dropSide !== 'right') {
        if (cardData && cardData.originalLeft != null) {
            const el = cardData.element;
            if (el) { el.style.left = cardData.originalLeft; el.style.top = cardData.originalTop; }
        }
        return;
    }

    // --- FIX: CAPTURE TARGET ID (What are we trying to cover?) ---
    let targetId = null;
    if (dropSide === 'left') {
        const p = gameState.centerPileLeft;
        if (p.length > 0) targetId = p[p.length - 1].id;
    } else {
        const p = gameState.centerPileRight;
        if (p.length > 0) targetId = p[p.length - 1].id;
    }
    // -------------------------------------------------------------

    // MIRROR LOGIC: Guest's Left is Host's Right.
    let targetSideForHost = dropSide;
    if (!gameState.isHost) {
        if (dropSide === 'left') targetSideForHost = 'right';
        else if (dropSide === 'right') targetSideForHost = 'left';
    }

    const req = {
        reqId: `${gameState.myId}:${Date.now()}:${(++gameState.moveSeq)}`,
        dropSide: targetSideForHost, 
        targetId: targetId, // Send the ID we are aiming at
        card: packCardWithMeta(cardData)
    };

    if (gameState.isHost) {
        adjudicateMove(req, 'player');
    } else {
        sendNet({ type: 'MOVE_REQ', move: req });
    }
}
function adjudicateMove(m, moverOverride) {
    const mover = moverOverride || 'ai';
    const moverHand = (mover === 'player') ? gameState.playerHand : gameState.aiHand;
    const idx = moverHand.findIndex(c => c.id === m.card.id);

    // 1. Basic Validity Check
    if (idx === -1) {
        if (mover === 'ai') sendNet({ type: 'MOVE_REJECT', reject: { reqId: m.reqId, cardId: m.card.id } });
        return;
    }

    const cardObj = moverHand[idx];
    
    // Determine which pile is being targeted
    let pile = null;
    if (m.dropSide === 'left') pile = gameState.centerPileLeft;
    else if (m.dropSide === 'right') pile = gameState.centerPileRight;

    // 2. Strict Race Condition Check
    const currentTop = (pile && pile.length > 0) ? pile[pile.length - 1] : null;
    const currentTopId = currentTop ? currentTop.id : null;

    let rejectionReason = null;
    if (m.targetId !== currentTopId) rejectionReason = "race_lost";
    else if (!checkPileLogic(cardObj, pile)) rejectionReason = "invalid_math";

    if (rejectionReason) {
        // --- FIX: REJECTION HANDLING ---
        if (mover === 'ai') {
            // 1. Tell Guest to snap back
            sendNet({ type: 'MOVE_REJECT', reject: { reqId: m.reqId, cardId: m.card.id } });
            
            // 2. Host cleans up the Guest's ghost immediately
            cleanupGhost(m.card);
        } else {
            // 1. Host snaps back locally
            rejectMoveFromHost({ cardId: cardObj.id });
            
            // 2. Tell Guest to delete Host's ghost
            sendNet({ type: 'OPPONENT_REJECT', card: m.card });
        }
        return;
    }

    const applyPayload = applyMoveAuthoritative(mover, cardObj, m.dropSide, m.reqId);
    sendNet({ type: 'MOVE_APPLY', apply: applyPayload });
}
function applyMoveAuthoritative(mover, cardObj, side, reqId) {
    // --- FIX: KILL THE ZOMBIE GHOST (FUZZY MATCH) ---
    // Iterate through all active ghosts.
    // If a ghost matches the card being played (by suit/rank/value), destroy it.
    // This fixes the issue where Guest sends ID as 'player' but Host looks for 'ai'.
    gameState.opponentDragGhosts.forEach((ghostEl, key) => {
        const parts = key.split(':'); // "suit:rank:value:owner:lane"
        // Check if suit, rank, and value match the card being played
        if (parts[0] === cardObj.suit && parts[1] === cardObj.rank && parseInt(parts[2]) === cardObj.value) {
            ghostEl.remove();
            gameState.opponentDragGhosts.delete(key);
        }
    });
    // ------------------------------------------------

    // 1. Update piles
    const targetPile = (side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
    targetPile.push(cardObj);

    // 2. Remove from mover hand
    let hand = null;
    if (mover === 'player') {
        hand = gameState.playerHand;
        gameState.playerHand = gameState.playerHand.filter(c => c !== cardObj);
        gameState.playerTotal--;
    } else {
        hand = gameState.aiHand;
        gameState.aiHand = gameState.aiHand.filter(c => c !== cardObj);
        gameState.aiTotal--;
    }

    // 3. Update UI on host (Remove the card from the lane)
    if (cardObj.element) cardObj.element.remove();
    
    // Render the real card in the center
    renderCenterPile(side, cardObj);

    updateScoreboard();
    checkSlapCondition();

    // 4. Handle Reveal (Host Side)
    // ... (keep the top part of the function) ...

    // 4. Handle Reveal (Host Side)
    let newTopCardPayload = null;
    const laneCards = hand.filter(c => c.laneIndex === cardObj.laneIndex);
    
    if (laneCards.length > 0) {
        const newTop = laneCards[laneCards.length - 1];
        if (mover === 'player') {
            newTopCardPayload = packCardWithMeta(newTop);
        }
        if (mover === 'ai' && !newTop.isFaceUp && newTop.element) {
            setCardFaceUp(newTop.element, newTop, 'ai');
        }
    }

    // --- FIX: CHECK FOR ROUND END (EMPTY HAND) ---
    // Instead of ending match at 0 cards, we trigger Round End when hand is empty.
    
    const moverHandRef = (mover === 'player') ? gameState.playerHand : gameState.aiHand;
    
    if (moverHandRef.length === 0) {
        // Hand is empty -> Round Over!
        handleRoundOver(mover);
    } 
    else if (gameState.playerTotal <= 0) {
        // Safety: If total is 0 but hand isn't empty (rare), treat as win
        handleRoundOver('player');
    } else if (gameState.aiTotal <= 0) {
        handleRoundOver('ai');
    }

    // 5. Send Payload
    return {
        reqId,
        mover,
        side,
        card: packCardWithMeta(cardObj),
        playerTotal: gameState.playerTotal,
        aiTotal: gameState.aiTotal,
        newTopCard: newTopCardPayload
    };
}
function applyMoveFromHost(a) {
    const localMover = (a.mover === 'player') ? 'ai' : 'player';
    const localSide = (a.side === 'left') ? 'right' : 'left';

    // 1. Ghost cleanup (Type-Safe)
    gameState.opponentDragGhosts.forEach((ghostEl, key) => {
        const parts = key.split(':'); 
        // Use loose equality (==) for value to handle string/number mismatch
        if (parts[0] === a.card.suit && parts[1] === a.card.rank && parts[2] == a.card.value) {
            ghostEl.remove();
            gameState.opponentDragGhosts.delete(key);
        }
    });

    // Score Sync
    gameState.playerTotal = a.aiTotal;
    gameState.aiTotal = a.playerTotal;

    const hand = (localMover === 'player') ? gameState.playerHand : gameState.aiHand;
    
    // --- FIX: AGGRESSIVE CARD FINDING ---
    // 1. Try finding by Exact ID
    let idx = hand.findIndex(c => c.id === a.card.id);
    
    // 2. If ID not found, find by Suit/Rank (Ignore value type issues)
    if (idx === -1) {
        idx = hand.findIndex(c => c.suit === a.card.suit && c.rank === a.card.rank);
    }

    let cardObj = null;

    if (idx !== -1) {
        cardObj = hand[idx];
        hand.splice(idx, 1); // Remove from memory array
    } else {
        cardObj = unpackCard(a.card);
    }

    // 3. FORCE REMOVE DOM ELEMENT
    if (cardObj.element) {
        cardObj.element.remove();
        cardObj.element = null; 
    }
    
    // 4. SAFETY SWEEP: Check for visual duplicates in the hand and kill them
    // This handles cases where a "Ghost" or stale DOM element was left behind
    if (localMover === 'ai') {
        const container = document.getElementById('ai-foundation-area');
        if (container) {
            // Find any img inside this container with matching suit/rank source
            const querySrc = `assets/cards/${a.card.rank}_of_${a.card.suit}.png`;
            const duplicates = Array.from(container.querySelectorAll('img')).filter(img => img.src.includes(querySrc));
            duplicates.forEach(d => d.remove());
        }
    }
    // --------------------------------

    const pile = (localSide === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
    pile.push(cardObj);
    renderCenterPile(localSide, cardObj);

    updateScoreboard();
    checkSlapCondition();

    // 5. Handle Flip
    if (a.newTopCard && localMover === 'ai') {
        let newCardObj = gameState.aiHand.find(c => c.id === a.newTopCard.id);
        if (!newCardObj) {
            newCardObj = gameState.aiHand.find(c => c.suit === a.newTopCard.suit && c.rank === a.newTopCard.rank);
        }
        if (newCardObj && newCardObj.element) {
            setCardFaceUp(newCardObj.element, newCardObj, 'ai');
        }
    }
}
/* ================================
   DECK READY / COUNTDOWN
   ================================ */

function handlePlayerDeckClick() {
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;
        gameState.playerReady = true;
        document.getElementById('player-draw-deck')?.classList.add('deck-ready');
        sendNet({ type: 'READY' });
        checkDrawConditionMultiplayer();
        return;
    }
    // Re-ready check during game pauses (e.g. after slap)
    if (gameState.gameActive && !gameState.playerReady) {
        gameState.playerReady = true;
        document.getElementById('player-draw-deck')?.classList.add('deck-ready');
        sendNet({ type: 'READY' });
        checkDrawConditionMultiplayer();
    }
}

function checkDrawConditionMultiplayer() {
    if (gameState.drawLock || gameState.countdownRunning) return;
    if (gameState.playerReady && gameState.aiReady) {
        if (!gameState.isHost) return;
        gameState.drawLock = true;
        sendNet({ type: 'HOST_COUNTDOWN' });
        setTimeout(() => startCountdownFromHost(), 50);
    }
}

function startCountdownFromHost() {
    if (gameState.countdownRunning) return;
    gameState.countdownRunning = true;
    gameState.gameActive = false;

    const overlay = document.getElementById('countdown-overlay');
    if (!overlay) return;
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

            // --- NEW: PRE-LOAD AT COUNT 1 ---
            if (count === 1 && gameState.isHost) {
                // 1. Calculate the result early
                const result = performRevealHostOnly();
                
                // 2. Send "Preload" command to Guest
                sendNet({ type: 'REVEAL_PRELOAD', result });

                // 3. Render Locally (Hidden)
                if (result.right) renderCenterPile('right', unpackCard(result.right), true);
                if (result.left) renderCenterPile('left', unpackCard(result.left), true);
                
                // Update UI data (scores/borrowed tags) immediately
                updateScoreboard(); 
            }
            // --------------------------------

        } else {
            clearInterval(timer);
            overlay.classList.add('hidden');
            gameState.countdownRunning = false;

            // --- NEW: SHOW TIME AT COUNT 0 ---
            if (gameState.isHost) {
                sendNet({ type: 'REVEAL_SHOW' });
                applyRevealShow(); // Trigger local show
            }
            // --------------------------------
        }
    }, 800);
}

function performRevealHostOnly() {
    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

    const bpEl = document.getElementById('borrowed-player');
    const baEl = document.getElementById('borrowed-ai');

    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const stealAmount = Math.floor(gameState.aiDeck.length / 2);
        if (stealAmount > 0) {
            const stolen = gameState.aiDeck.splice(0, stealAmount);
            gameState.playerDeck = gameState.playerDeck.concat(stolen);
            if (bpEl) bpEl.classList.remove('hidden');
        }
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const stealAmount = Math.floor(gameState.playerDeck.length / 2);
        if (stealAmount > 0) {
            const stolen = gameState.playerDeck.splice(0, stealAmount);
            gameState.aiDeck = gameState.aiDeck.concat(stolen);
            if (baEl) baEl.classList.remove('hidden');
        }
    }

    const playerBorrowing = bpEl ? !bpEl.classList.contains('hidden') : false;
    const aiBorrowing = baEl ? !baEl.classList.contains('hidden') : false;

    if (playerBorrowing) gameState.aiTotal--; else gameState.playerTotal--;
    if (aiBorrowing) gameState.playerTotal--; else gameState.aiTotal--;

    let rightCard = null;
    let leftCard = null;

    if (gameState.playerDeck.length > 0) {
        const pCard = gameState.playerDeck.pop();
        gameState.centerPileRight.push(pCard);
        rightCard = packCard(pCard);
    }

    if (gameState.aiDeck.length > 0) {
        const aCard = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(aCard);
        leftCard = packCard(aCard);
    }

    gameState.playerReady = false;
    gameState.aiReady = false;
    gameState.drawLock = false;

    return {
        playerTotal: gameState.playerTotal,
        aiTotal: gameState.aiTotal,
        borrowedPlayer: playerBorrowing,
        borrowedAi: aiBorrowing,
        right: rightCard,
        left: leftCard
    };
}

function applyRevealFromHost(payload) {
    const bpEl = document.getElementById('borrowed-player');
    const baEl = document.getElementById('borrowed-ai');

    // --- FIX: SWAP BORROWED TAGS ---
    // payload.borrowedPlayer means "Host is borrowing". 
    // As Guest, Host is my Opponent ('ai'), so we update baEl (Opponent).
    if (baEl) {
        payload.borrowedPlayer ? baEl.classList.remove('hidden') : baEl.classList.add('hidden');
    }

    // payload.borrowedAi means "Guest is borrowing". 
    // As Guest, that is Me ('player'), so we update bpEl (Player).
    if (bpEl) {
        payload.borrowedAi ? bpEl.classList.remove('hidden') : bpEl.classList.add('hidden');
    }
    // -------------------------------

    // --- FIX: SWAP SCORES FOR GUEST ---
    gameState.playerTotal = payload.aiTotal;
    gameState.aiTotal = payload.playerTotal;

    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

    if (payload.right) {
        const c = unpackCard(payload.right);
        gameState.centerPileLeft.push(c);
        renderCenterPile('left', c); 
    }
    if (payload.left) {
        const c = unpackCard(payload.left);
        gameState.centerPileRight.push(c);
        renderCenterPile('right', c);
    }

    updateScoreboard();
    gameState.gameActive = true;
    gameState.playerReady = false;
    gameState.aiReady = false;
    checkSlapCondition();
}

function renderCenterPile(side, card, hidden = false) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    if (!container) return;

    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.className = 'game-card';
    img.style.left = '50%';
    img.style.top = '50%';

    // --- NEW: Handle Pre-loading ---
    if (hidden) {
        img.style.opacity = '0';
        img.classList.add('pending-reveal'); // Tag them so we can find them later
        img.style.transition = 'opacity 0.1s ease-out'; // Fast pop-in
    }
    // -------------------------------

    const rot = Math.random() * 20 - 10;
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    container.appendChild(img);
}
/* ================================
   UTILITIES
   ================================ */

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
    const sp = document.getElementById('score-player');
    const sa = document.getElementById('score-ai');
    if (sp) sp.innerText = gameState.playerTotal;
    if (sa) sa.innerText = gameState.aiTotal;
}

function checkDeckVisibility() {
    document.getElementById('player-draw-deck')?.classList.remove('hidden');
    document.getElementById('ai-draw-deck')?.classList.remove('hidden');
}

function updateScoreboardWidget() {
    const p1Name = document.getElementById('sb-p1-name');
    const p2Name = document.getElementById('sb-p2-name');
    if (p1Name) p1Name.innerText = gameState.myName || "You";
    if (p2Name) p2Name.innerText = gameState.opponentName || "Opponent";

    const p1R = document.getElementById('sb-p1-rounds');
    const p2R = document.getElementById('sb-p2-rounds');
    const p1S = document.getElementById('sb-p1-slaps');
    const p2S = document.getElementById('sb-p2-slaps');

    if (p1R) p1R.innerText = gameState.p1Rounds;
    if (p2R) p2R.innerText = gameState.aiRounds;
    if (p1S) p1S.innerText = gameState.p1Slaps;
    if (p2S) p2S.innerText = gameState.aiSlaps;

    // --- CHECK IF YOU ARE MISSING THIS PART BELOW ---
    const oppLabel = document.getElementById('opponent-display-name');
    if (oppLabel) {
        // This takes the opponent's name and puts it in the top left label
        const name = gameState.opponentName || "OPPONENT";
        oppLabel.innerText = name.toUpperCase();
    }
}
function showRoundMessage(title, sub) {
    const modal = document.getElementById('game-message');
    if (!modal) return;
    modal.querySelector('h1').innerText = title;
    modal.querySelector('p').innerText = sub;
    const btn = document.getElementById('msg-btn');
    if (btn) {
        btn.innerText = "CONTINUE";
        btn.onclick = function () { };
        btn.classList.remove('hidden');
    }
    modal.classList.remove('hidden');
}

function showEndGame(title, isWin) {
    gameState.matchEnded = true; // Prevents disconnect popup

    const modal = document.getElementById('game-message');
    if (!modal) return;
    
    modal.querySelector('h1').innerText = title;
    modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';
    
    const contentArea = modal.querySelector('p');
    contentArea.innerHTML = `
        <div style="display:flex; gap:10px; justify-content:center; margin-top:20px;">
            <button class="btn-action-small" onclick="sendRematchRequest()" style="background:#444; width:auto;">
                <i class="fa-solid fa-rotate-right"></i> REMATCH
            </button>
            <button class="btn-action-small" onclick="quitMatch()" style="background:#ff4444; width:auto;">
                MAIN MENU
            </button>
        </div>
    `;
    
    const oldBtn = document.getElementById('msg-btn');
    if (oldBtn) oldBtn.classList.add('hidden');
    modal.classList.remove('hidden');
}
async function preloadCardImages(cards) {
    const urls = new Set();
    urls.add(CARD_BACK_SRC);
    (cards || []).forEach(c => { if (c && c.imgSrc) urls.add(c.imgSrc); });

    const tasks = [];
    urls.forEach((src) => {
        tasks.push(new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = src;
        }));
    });

    await Promise.race([
        Promise.all(tasks),
        new Promise(resolve => setTimeout(resolve, 2500))
    ]);
}
/* ================================
   ROUND & MATCH END LOGIC
   ================================ */

function handleRoundOver(winner) {
    // Logic transferred from game.js:
    // Winner keeps their current count. Loser takes the rest (52 - winner).
    
    if (winner === 'player') {
        // Host Won
        gameState.aiTotal = 52 - gameState.playerTotal;
        gameState.p1Rounds++; 
    } else {
        // Guest Won
        gameState.playerTotal = 52 - gameState.aiTotal;
        gameState.aiRounds++; 
    }

    // Check for TRUE Match Win (If a player enters next round with 0 or 52)
    if (gameState.playerTotal <= 0 || gameState.aiTotal >= 52) {
        const payload = { type: 'MATCH_OVER', winner: 'player' };
        sendNet(payload);
        applyMatchOver(payload);
    } else if (gameState.aiTotal <= 0 || gameState.playerTotal >= 52) {
        const payload = { type: 'MATCH_OVER', winner: 'ai' };
        sendNet(payload);
        applyMatchOver(payload);
    } else {
        // Just a Round Win -> Continue Game
        const payload = {
            type: 'ROUND_OVER',
            winner: winner,
            pTotal: gameState.playerTotal,
            aTotal: gameState.aiTotal,
            p1Rounds: gameState.p1Rounds, 
            aiRounds: gameState.aiRounds
        };
        sendNet(payload);
        applyRoundOver(payload);
    }
}

function applyRoundOver(data) {
    gameState.gameActive = false;
    
    // 1. Sync Totals & Stats
    if (gameState.isHost) {
        gameState.playerTotal = data.pTotal;
        gameState.aiTotal = data.aTotal;
        gameState.p1Rounds = data.p1Rounds;
        gameState.aiRounds = data.aiRounds;
    } else {
        // Guest Perspective Swap
        gameState.playerTotal = data.aTotal; 
        gameState.aiTotal = data.pTotal;     
        gameState.p1Rounds = data.aiRounds;  
        gameState.aiRounds = data.p1Rounds;  
    }

    updateScoreboard();
    updateScoreboardWidget(); 

    // 2. Determine Message
    const iAmHost = gameState.isHost;
    const hostWon = (data.winner === 'player');
    const iWon = (iAmHost && hostWon) || (!iAmHost && !hostWon);

    // --- FIX: USE OPPONENT NAME IN TEXT ---
    const oppName = (gameState.opponentName || "OPPONENT").toUpperCase();

    const title = iWon ? "ROUND WON!" : "ROUND LOST!";
    const sub = iWon 
        ? `You start next round with ${gameState.playerTotal} cards.` 
        : `${oppName} starts next round with ${gameState.aiTotal} cards.`;
    // --------------------------------------

    // 3. Show Modal
    const modal = document.getElementById('game-message');
    if (modal) {
        modal.querySelector('h1').innerText = title;
        modal.querySelector('h1').style.color = iWon ? '#66ff66' : '#ff7575';
        modal.querySelector('p').innerText = sub;
        
        const btn = document.getElementById('msg-btn');
        if (btn) {
            btn.classList.remove('hidden');
            if (gameState.isHost) {
                btn.innerText = "START NEXT ROUND";
                btn.onclick = () => {
                    modal.classList.add('hidden');
                    startRoundHostAuthoritative(); // Reshuffle and deal
                };
            } else {
                btn.innerText = "WAITING FOR HOST...";
                btn.onclick = null; // Guest waits
            }
        }
        modal.classList.remove('hidden');
    }
}

function applyMatchOver(data) {
    gameState.gameActive = false;
    gameState.matchEnded = true; // FIX: Mark match as done so disconnects are ignored
    
    const iAmHost = gameState.isHost;
    const hostWon = (data.winner === 'player');
    const iWon = (iAmHost && hostWon) || (!iAmHost && !hostWon);

    const title = iWon ? "YOU WON THE MATCH!" : "OPPONENT WINS THE MATCH!";
    
    showEndGame(title, iWon);
}
function quitMatch() {
    console.log("Quitting match...");
    try {
        sendNet({ type: 'OPPONENT_LEFT' });
    } catch (e) {
        console.error("Connection already closed", e);
    }
    setTimeout(() => {
        if (gameState.peer) {
            gameState.peer.destroy();
        }
        window.location.href = 'index.html';
    }, 100); 
}
/* ================================
   REMATCH LOGIC
   ================================ */

function sendRematchRequest() {
    const btn = document.querySelector('.btn-action-small[onclick="sendRematchRequest()"]');
    if(btn) {
        btn.innerText = "WAITING...";
        btn.disabled = true;
    }
    sendNet({ type: 'REMATCH_REQ' });
}

function acceptRematch() {
    document.getElementById('rematch-modal').classList.add('hidden');
    sendNet({ type: 'REMATCH_YES' });
    
    // Reset Local Stats immediately
    gameState.p1Rounds = 0; gameState.aiRounds = 0;
    gameState.p1Slaps = 0; gameState.aiSlaps = 0;
    
    // CRITICAL: Reset totals locally too
    gameState.playerTotal = 26; 
    gameState.aiTotal = 26;
    
    gameState.matchEnded = false;
    
    // Hide the "Game Over" modal if it's open
    const modal = document.getElementById('game-message');
    if(modal) modal.classList.add('hidden');
    
    updateScoreboardWidget();

    // If I am the Host, I need to start the game now that I've accepted
    // If I am the Guest, I wait for the Host to send ROUND_START
    if (gameState.isHost) {
        startRoundHostAuthoritative();
    }
}
function declineRematch() {
    sendNet({ type: 'REMATCH_NO' });
    window.location.href = 'index.html';
}
function applyRevealPreload(payload) {
    // 1. Update UI Tags (Borrowed)
    const bpEl = document.getElementById('borrowed-player');
    const baEl = document.getElementById('borrowed-ai');

    // Swap logic (Guest Perspective)
    if (baEl) payload.borrowedPlayer ? baEl.classList.remove('hidden') : baEl.classList.add('hidden');
    if (bpEl) payload.borrowedAi ? bpEl.classList.remove('hidden') : bpEl.classList.add('hidden');

    // 2. Update Scores (Guest Perspective)
    gameState.playerTotal = payload.aiTotal;
    gameState.aiTotal = payload.playerTotal;
    updateScoreboard();

    // 3. Update Deck Graphics
    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

    // 4. RENDER HIDDEN CARDS
    // These will sit in the DOM waiting for the 'SHOW' signal
    if (payload.right) {
        const c = unpackCard(payload.right);
        gameState.centerPileLeft.push(c);
        renderCenterPile('left', c, true); // true = hidden
    }
    if (payload.left) {
        const c = unpackCard(payload.left);
        gameState.centerPileRight.push(c);
        renderCenterPile('right', c, true); // true = hidden
    }
}

function applyRevealShow() {
    // 1. Reveal the Pre-loaded cards
    const hiddenCards = document.querySelectorAll('.pending-reveal');
    hiddenCards.forEach(img => {
        img.style.opacity = '1';
        img.classList.remove('pending-reveal');
    });

    // 2. Activate Game
    gameState.gameActive = true;
    gameState.playerReady = false;
    gameState.aiReady = false;
    
    // 3. Check Slaps (Now that cards are "Visible")
    checkSlapCondition();
}
/* ================================
   VISUAL HELPERS FOR REJECTS
   ================================ */

function rejectMoveFromHost(j) {
    // 1. Try to find the card specifically by ID
    let card = null;
    if (j.cardId) {
        card = gameState.playerHand.find(c => c.id === j.cardId);
    }
    // Fallback to last dragged if ID missing
    if (!card) card = gameState.lastDraggedCard;

    if (card && card.element) {
        // SNAP BACK ANIMATION
        card.element.style.transition = 'all 0.3s ease-out';
        card.element.style.left = card.originalLeft;
        card.element.style.top = card.originalTop;
        
        // Ensure z-index resets after animation
        setTimeout(() => {
            card.element.style.zIndex = card.laneIndex + 10;
        }, 300);
    }
}

function cleanupGhost(cardData) {
    // 1. Remove the Ghost
    gameState.opponentDragGhosts.forEach((ghostEl, key) => {
        const parts = key.split(':'); 
        // FIX: Use loose equality (==) for value
        if (parts[0] === cardData.suit && parts[1] === cardData.rank && parts[2] == cardData.value) {
            ghostEl.style.transition = 'opacity 0.2s';
            ghostEl.style.opacity = '0';
            setTimeout(() => {
                ghostEl.remove();
                gameState.opponentDragGhosts.delete(key);
            }, 200);
        }
    });

    // 2. RESTORE THE REAL CARD
    const realCard = gameState.aiHand.find(c => 
        c.suit === cardData.suit && 
        c.rank === cardData.rank
    );

    if (realCard && realCard.element) {
        realCard.element.style.opacity = '1'; 
    }
}
