/* =========================================
   MULTIPLAYER GAME.JS (Human vs Human)
   - Host Authoritative Logic
   - Guest Visual Mirroring
   - Phase 1 & 2 Stalemate Logic Implemented
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
        if (gameState.matchEnded) return;
        handleNet({ type: 'OPPONENT_LEFT' }); 
    });

    conn.on('error', (err) => {
        console.error("Connection quirk:", err);
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
    } // <--- FIXED MISSING BRACE HERE

    // --- PHASE 1 & 2 MESSAGE HANDLERS ---
    if (msg.type === 'BORROWED_START') {
        gameState.playerDeck = msg.aDeck.map(unpackCard); // Swap
        gameState.aiDeck = msg.pDeck.map(unpackCard);
        gameState.centerPileLeft = [];
        gameState.centerPileRight = [];
        gameState.playerReady = false; 
        gameState.aiReady = false;
        applyBorrowedUI();
        return;
    }

    if (msg.type === 'CYCLE_RESET') {
        gameState.playerTotal = msg.aTotal;
        gameState.aiTotal = msg.pTotal;
        // Don't need to handle odd card here, the round restart follows
        
        const modal = document.getElementById('slap-overlay');
        modal.classList.remove('hidden');
        document.getElementById('slap-text').innerText = "STALEMATE RESET";
        return;
    }
    
    // --- DISCONNECT HANDLER ---
    if (msg.type === 'OPPONENT_LEFT') {
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
        const modal = document.getElementById('game-message');
        if(modal) modal.classList.add('hidden');
        
        gameState.p1Rounds = 0; gameState.aiRounds = 0;
        gameState.p1Slaps = 0; gameState.aiSlaps = 0;
        gameState.playerTotal = 26; 
        gameState.aiTotal = 26;
        gameState.matchEnded = false;
        
        updateScoreboardWidget();

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

        const now = Date.now();
        if (now - gameState.lastSpacebarTime < 400) { return; }
        gameState.lastSpacebarTime = now;

        if (gameState.isHost) {
            adjudicateSlap('player'); 
        } else {
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
    if (!gameState.gameActive) return;

    if (gameState.slapActive) {
        // CALL THE LOGIC FUNCTION
        resolveSlap(who);
    } else {
        // INVALID SLAP (PENALTY)
        issuePenaltyHostAuth(who);
    }
}

// --- MISSING FUNCTION ADDED HERE ---
function resolveSlap(winner) {
    gameState.slapActive = false;
    gameState.gameActive = false;

    // --- PHASE 2, SCENARIO 1 CHECK ---
    // Condition: Slap occurs when Decks are Empty (or near empty) BUT 'Borrowed' hasn't started yet.
    // This effectively catches the "Last 2 cards before simultaneous shortage" scenario.
    
    const isBorrowed = !document.getElementById('borrowed-player').classList.contains('hidden');
    const bothDecksEmpty = (gameState.playerDeck.length === 0 && gameState.aiDeck.length === 0);

    if (!isBorrowed && bothDecksEmpty) {
        console.log("Slap on last cards before Borrowed Phase. Ending Round.");
        
        const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;
        
        if (winner === 'player') {
            // Host Won Slap -> Host starts next round with just Hand.
            // Guest (Loser) takes the pile.
            gameState.playerTotal = gameState.playerHand.length; 
            gameState.aiTotal = gameState.aiHand.length + pilesTotal;
        } else {
            // Guest Won Slap -> Guest starts next round with just Hand.
            // Host (Loser) takes the pile.
            gameState.aiTotal = gameState.aiHand.length;
            gameState.playerTotal = gameState.playerHand.length + pilesTotal;
        }

        // Broadcast End
        const resetMsg = {
            type: 'CYCLE_RESET', // Reuse message for visual reset
            pTotal: gameState.playerTotal,
            aTotal: gameState.aiTotal
        };
        sendNet(resetMsg);

        // Visuals
        const overlay = document.getElementById('slap-overlay');
        overlay.classList.remove('hidden');
        document.getElementById('slap-text').innerText = (winner === 'player') ? "PLAYER SLAPS! ROUND RESET" : "OPPONENT SLAPS! ROUND RESET";
        overlay.style.backgroundColor = (winner === 'player') ? "rgba(0, 200, 0, 0.9)" : "rgba(200, 0, 0, 0.9)";

        setTimeout(() => {
            overlay.classList.add('hidden');
            startRoundHostAuthoritative();
        }, 2000);
        return;
    }

    // --- NORMAL SLAP (Including during Borrowed Phase) ---
    // "If there is a slap after a simultaneous draw deck shortage then normal slap rules apply"
    // "The amount of cards that were in the middle get awarded to the LOSER"
    
    const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

    if (winner === 'player') {
        gameState.aiTotal += pilesTotal; // Give to Loser (Guest)
        gameState.p1Slaps++;
    } else {
        gameState.playerTotal += pilesTotal; // Give to Loser (Host)
        gameState.aiSlaps++;
    }

    // Standard Cleanup
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';

    const update = {
        type: 'SLAP_UPDATE',
        winner: winner,
        pTotal: gameState.playerTotal,
        aTotal: gameState.aiTotal
    };
    sendNet(update);
    applySlapUpdate(update);
}

function issuePenaltyHostAuth(who) {
    let currentY, currentR;

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
        pTotal: gameState.playerTotal, 
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
    if (gameState.opponentDragGhosts) {
        gameState.opponentDragGhosts.forEach(el => el.remove()); 
        gameState.opponentDragGhosts.clear(); 
    }

    gameState.aiHand.forEach(c => { if (c.element) c.element.style.opacity = '1'; });
    gameState.playerHand.forEach(c => { if (c.element) c.element.style.opacity = '1'; });

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
    if (gameState.isHost) {
        gameState.playerTotal = data.pTotal;
        gameState.aiTotal = data.aTotal;
    } else {
        gameState.playerTotal = data.aTotal;
        gameState.aiTotal = data.pTotal;
    }
    updateScoreboard();

    let localTarget = data.target; 
    
    if (!gameState.isHost) {
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

async function startRoundHostAuthoritative(oddCard = null) {
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
    if (oddCard) {
        gameState.centerPileLeft.push(oddCard);
        renderCenterPile('left', oddCard);
    }
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
    
    // Handle odd card sync (it will be in the center piles from state import)
    if (state.centerPileLeft && state.centerPileLeft.length > 0) {
        state.centerPileLeft.forEach(c => renderCenterPile('left', c));
    }
    
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

    let targetId = null;
    if (dropSide === 'left') {
        const p = gameState.centerPileLeft;
        if (p.length > 0) targetId = p[p.length - 1].id;
    } else {
        const p = gameState.centerPileRight;
        if (p.length > 0) targetId = p[p.length - 1].id;
    }

    let targetSideForHost = dropSide;
    if (!gameState.isHost) {
        if (dropSide === 'left') targetSideForHost = 'right';
        else if (dropSide === 'right') targetSideForHost = 'left';
    }

    const req = {
        reqId: `${gameState.myId}:${Date.now()}:${(++gameState.moveSeq)}`,
        dropSide: targetSideForHost, 
        targetId: targetId,
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

    if (idx === -1) {
        if (mover === 'ai') sendNet({ type: 'MOVE_REJECT', reject: { reqId: m.reqId, cardId: m.card.id } });
        return;
    }

    const cardObj = moverHand[idx];
    
    let pile = null;
    if (m.dropSide === 'left') pile = gameState.centerPileLeft;
    else if (m.dropSide === 'right') pile = gameState.centerPileRight;

    const currentTop = (pile && pile.length > 0) ? pile[pile.length - 1] : null;
    const currentTopId = currentTop ? currentTop.id : null;

    let rejectionReason = null;
    if (m.targetId !== currentTopId) rejectionReason = "race_lost";
    else if (!checkPileLogic(cardObj, pile)) rejectionReason = "invalid_math";

    if (rejectionReason) {
        if (mover === 'ai') {
            sendNet({ type: 'MOVE_REJECT', reject: { reqId: m.reqId, cardId: m.card.id } });
            cleanupGhost(m.card);
        } else {
            rejectMoveFromHost({ cardId: cardObj.id });
            sendNet({ type: 'OPPONENT_REJECT', card: m.card });
        }
        return;
    }

    const applyPayload = applyMoveAuthoritative(mover, cardObj, m.dropSide, m.reqId);
    sendNet({ type: 'MOVE_APPLY', apply: applyPayload });
}
function applyMoveAuthoritative(mover, cardObj, side, reqId) {
    // 1. Ghost cleanup
    gameState.opponentDragGhosts.forEach((ghostEl, key) => {
        const parts = key.split(':'); 
        if (parts[0] === cardObj.suit && parts[1] === cardObj.rank && parseInt(parts[2]) === cardObj.value) {
            ghostEl.remove();
            gameState.opponentDragGhosts.delete(key);
        }
    });

    // 2. Update piles
    const targetPile = (side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
    targetPile.push(cardObj);

    // 3. Remove from Hand and Decrement Score
    // IMPORTANT: We ALWAYS decrement score here because 'playerTotal' tracks how close you are to 0 (Winning).
    // Even in Borrowed Phase, playing from HAND gets you closer to winning.
    
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

    // 4. Update UI
    if (cardObj.element) cardObj.element.remove();
    renderCenterPile(side, cardObj);
    updateScoreboard();
    checkSlapCondition();

    // 5. Handle Reveal
    let newTopCardPayload = null;
    const laneCards = hand.filter(c => c.laneIndex === cardObj.laneIndex);
    if (laneCards.length > 0) {
        const newTop = laneCards[laneCards.length - 1];
        if (mover === 'player') newTopCardPayload = packCardWithMeta(newTop);
        if (mover === 'ai' && !newTop.isFaceUp && newTop.element) setCardFaceUp(newTop.element, newTop, 'ai');
    }

    // --- WINNING LOGIC ---
    
    // We check if the HAND is empty.
    const handEmpty = (hand.length === 0);
    const isBorrowed = !document.getElementById('borrowed-player').classList.contains('hidden');

    if (handEmpty) {
        if (isBorrowed) {
            // BORROWED PHASE WIN LOGIC
            // "Scenario 1: lays final foundation pile... win match... if no penalties"
            
            let hasPenalty = false;
            if (mover === 'player') hasPenalty = (gameState.playerReds > 0 || gameState.playerYellows > 0);
            else hasPenalty = (gameState.aiReds > 0 || gameState.aiYellows > 0);

            if (!hasPenalty) {
                // CLEAN WIN
                const payload = { type: 'MATCH_OVER', winner: mover };
                sendNet(payload);
                applyMatchOver(payload);
            } else {
                // PENALTY SURVIVAL (Scenario 2)
                const DEBT = 3; 
                let nextPTotal = (mover === 'player') ? DEBT : (52 - DEBT);
                let nextATotal = (mover === 'ai') ? DEBT : (52 - DEBT);

                const payload = {
                    type: 'ROUND_OVER',
                    winner: mover,
                    pTotal: nextPTotal,
                    aTotal: nextATotal,
                    reason: 'penalty_survival'
                };
                sendNet(payload);
                applyRoundOver(payload);
            }
        } else {
            // STANDARD PHASE WIN LOGIC
            if ((mover === 'player' && gameState.playerTotal <= 0) || (mover === 'ai' && gameState.aiTotal <= 0)) {
                const payload = { type: 'MATCH_OVER', winner: mover };
                sendNet(payload);
                applyMatchOver(payload);
            } else {
                handleRoundOver(mover);
            }
        }
    }

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

    gameState.opponentDragGhosts.forEach((ghostEl, key) => {
        const parts = key.split(':'); 
        if (parts[0] === a.card.suit && parts[1] === a.card.rank && parts[2] == a.card.value) {
            ghostEl.remove();
            gameState.opponentDragGhosts.delete(key);
        }
    });

    gameState.playerTotal = a.aiTotal;
    gameState.aiTotal = a.playerTotal;

    const hand = (localMover === 'player') ? gameState.playerHand : gameState.aiHand;
    
    let idx = hand.findIndex(c => c.id === a.card.id);
    if (idx === -1) {
        idx = hand.findIndex(c => c.suit === a.card.suit && c.rank === a.card.rank);
    }

    let cardObj = null;

    if (idx !== -1) {
        cardObj = hand[idx];
        hand.splice(idx, 1); 
    } else {
        cardObj = unpackCard(a.card);
    }

    if (cardObj.element) {
        cardObj.element.remove();
        cardObj.element = null; 
    }
    
    if (localMover === 'ai') {
        const container = document.getElementById('ai-foundation-area');
        if (container) {
            const querySrc = `assets/cards/${a.card.rank}_of_${a.card.suit}.png`;
            const duplicates = Array.from(container.querySelectorAll('img')).filter(img => img.src.includes(querySrc));
            duplicates.forEach(d => d.remove());
        }
    }

    const pile = (localSide === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
    pile.push(cardObj);
    renderCenterPile(localSide, cardObj);

    updateScoreboard();
    checkSlapCondition();

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

        // --- NEW TRIGGER LOGIC (Phase 1) ---
        // If both players want to draw, but both decks are EMPTY...
        if (gameState.playerDeck.length === 0 && gameState.aiDeck.length === 0) {
            // Check if we are already in Borrowed Mode (Cycle 2 Trigger)
            const isBorrowed = !document.getElementById('borrowed-player').classList.contains('hidden');
            
            if (isBorrowed) {
                // We ran out of borrowed cards too. This is "Cycle 2".
                // Trigger the Loop End Reset (Phase 2, Scenario 2).
                triggerSecondCycleReset();
            } else {
                // This is the first time running out.
                // Trigger "Borrowed" Phase (Phase 1).
                triggerBorrowedSplit();
            }
            return;
        }

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

            if (count === 1 && gameState.isHost) {
                const result = performRevealHostOnly();
                sendNet({ type: 'REVEAL_PRELOAD', result });

                if (result.right) renderCenterPile('right', unpackCard(result.right), true);
                if (result.left) renderCenterPile('left', unpackCard(result.left), true);
                
                updateScoreboard(); 
            }

        } else {
            clearInterval(timer);
            overlay.classList.add('hidden');
            gameState.countdownRunning = false;

            if (gameState.isHost) {
                sendNet({ type: 'REVEAL_SHOW' });
                applyRevealShow(); 
            }
        }
    }, 800);
}

function performRevealHostOnly() {
    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

    const bpEl = document.getElementById('borrowed-player');
    const baEl = document.getElementById('borrowed-ai');

    // 1. Handle "Standard" Shortages (Stealing if one is empty)
    // We only do this if NOT in Simultaneous mode yet
    const isSimultaneous = bpEl && !bpEl.classList.contains('hidden') && baEl && !baEl.classList.contains('hidden');

    if (!isSimultaneous) {
        if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
            const steal = Math.floor(gameState.aiDeck.length / 2);
            if (steal > 0) {
                gameState.playerDeck = gameState.playerDeck.concat(gameState.aiDeck.splice(0, steal));
                if (bpEl) bpEl.classList.remove('hidden');
            }
        }
        if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
            const steal = Math.floor(gameState.playerDeck.length / 2);
            if (steal > 0) {
                gameState.aiDeck = gameState.aiDeck.concat(gameState.playerDeck.splice(0, steal));
                if (baEl) baEl.classList.remove('hidden');
            }
        }
    }

    // 2. Scoring Deduction
    // LOGIC FIX: If Simultaneous (Borrowed Phase), DO NOT decrement scores.
    // Cards in the deck are neutral.
    
    const playerBorrowing = bpEl ? !bpEl.classList.contains('hidden') : false;
    const aiBorrowing = baEl ? !baEl.classList.contains('hidden') : false;
    const nowSimultaneous = (playerBorrowing && aiBorrowing);

    if (!nowSimultaneous) {
        // Normal Play or Single Shortage
        if (playerBorrowing) gameState.aiTotal--; else gameState.playerTotal--;
        if (aiBorrowing) gameState.playerTotal--; else gameState.aiTotal--;
    } 
    // Else: It is Simultaneous Borrowed Phase. We reveal cards but NO ONE loses points.

    // 3. Perform Reveal
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

    // 4. Trigger Check
    let suddenDeathTriggered = false;
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length === 0) {
        if (gameState.centerPileLeft.length > 0 || gameState.centerPileRight.length > 0) {
            // Determine if this is Cycle 1 or Cycle 2
            if (nowSimultaneous) {
                triggerSecondCycleReset();
            } else {
                triggerBorrowedSplit();
                suddenDeathTriggered = true;
            }
        }
    }

    gameState.playerReady = false;
    gameState.aiReady = false;
    gameState.drawLock = false;

    return {
        playerTotal: gameState.playerTotal,
        aiTotal: gameState.aiTotal,
        borrowedPlayer: playerBorrowing || suddenDeathTriggered,
        borrowedAi: aiBorrowing || suddenDeathTriggered,
        right: rightCard,
        left: leftCard,
        suddenDeath: suddenDeathTriggered
    };
}
function applyRevealFromHost(payload) {
    const bpEl = document.getElementById('borrowed-player');
    const baEl = document.getElementById('borrowed-ai');

    if (baEl) {
        payload.borrowedPlayer ? baEl.classList.remove('hidden') : baEl.classList.add('hidden');
    }

    if (bpEl) {
        payload.borrowedAi ? bpEl.classList.remove('hidden') : bpEl.classList.add('hidden');
    }

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

    if (hidden) {
        img.style.opacity = '0';
        img.classList.add('pending-reveal'); 
        img.style.transition = 'opacity 0.1s ease-out'; 
    }

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

    const oppLabel = document.getElementById('opponent-display-name');
    if (oppLabel) {
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
    gameState.matchEnded = true; 

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
    if (winner === 'player') {
        gameState.aiTotal = 52 - gameState.playerTotal;
        gameState.p1Rounds++; 
    } else {
        gameState.playerTotal = 52 - gameState.aiTotal;
        gameState.aiRounds++; 
    }

    if (gameState.playerTotal <= 0 || gameState.aiTotal >= 52) {
        const payload = { type: 'MATCH_OVER', winner: 'player' };
        sendNet(payload);
        applyMatchOver(payload);
    } else if (gameState.aiTotal <= 0 || gameState.playerTotal >= 52) {
        const payload = { type: 'MATCH_OVER', winner: 'ai' };
        sendNet(payload);
        applyMatchOver(payload);
    } else {
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
    
    if (gameState.isHost) {
        gameState.playerTotal = data.pTotal;
        gameState.aiTotal = data.aTotal;
        gameState.p1Rounds = data.p1Rounds;
        gameState.aiRounds = data.aiRounds;
    } else {
        gameState.playerTotal = data.aTotal; 
        gameState.aiTotal = data.pTotal;      
        gameState.p1Rounds = data.aiRounds;  
        gameState.aiRounds = data.p1Rounds;  
    }

    updateScoreboard();
    updateScoreboardWidget(); 

    const iAmHost = gameState.isHost;
    const hostWon = (data.winner === 'player');
    const iWon = (iAmHost && hostWon) || (!iAmHost && !hostWon);

    const oppName = (gameState.opponentName || "OPPONENT").toUpperCase();

    const title = iWon ? "ROUND WON!" : "ROUND LOST!";
    const sub = iWon 
        ? `You start next round with ${gameState.playerTotal} cards.` 
        : `${oppName} starts next round with ${gameState.aiTotal} cards.`;

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
                    startRoundHostAuthoritative(); 
                };
            } else {
                btn.innerText = "WAITING FOR HOST...";
                btn.onclick = null; 
            }
        }
        modal.classList.remove('hidden');
    }
}

function applyMatchOver(data) {
    gameState.gameActive = false;
    gameState.matchEnded = true; 
    
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
    
    gameState.p1Rounds = 0; gameState.aiRounds = 0;
    gameState.p1Slaps = 0; gameState.aiSlaps = 0;
    
    gameState.playerTotal = 26; 
    gameState.aiTotal = 26;
    
    gameState.matchEnded = false;
    
    const modal = document.getElementById('game-message');
    if(modal) modal.classList.add('hidden');
    
    updateScoreboardWidget();

    if (gameState.isHost) {
        startRoundHostAuthoritative();
    }
}
function declineRematch() {
    sendNet({ type: 'REMATCH_NO' });
    window.location.href = 'index.html';
}
function applyRevealPreload(payload) {
    const bpEl = document.getElementById('borrowed-player');
    const baEl = document.getElementById('borrowed-ai');

    if (baEl) payload.borrowedPlayer ? baEl.classList.remove('hidden') : baEl.classList.add('hidden');
    if (bpEl) payload.borrowedAi ? bpEl.classList.remove('hidden') : bpEl.classList.add('hidden');

    gameState.playerTotal = payload.aiTotal;
    gameState.aiTotal = payload.playerTotal;
    updateScoreboard();

    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

    if (payload.right) {
        const c = unpackCard(payload.right);
        gameState.centerPileLeft.push(c);
        renderCenterPile('left', c, true); 
    }
    if (payload.left) {
        const c = unpackCard(payload.left);
        gameState.centerPileRight.push(c);
        renderCenterPile('right', c, true); 
    }
}

function applyRevealShow() {
    const hiddenCards = document.querySelectorAll('.pending-reveal');
    hiddenCards.forEach(img => {
        img.style.opacity = '1';
        img.classList.remove('pending-reveal');
    });

    gameState.gameActive = true;
    gameState.playerReady = false;
    gameState.aiReady = false;
    
    checkSlapCondition();
}
/* ================================
   VISUAL HELPERS FOR REJECTS
   ================================ */

function rejectMoveFromHost(j) {
    let card = null;
    if (j.cardId) {
        card = gameState.playerHand.find(c => c.id === j.cardId);
    }
    if (!card) card = gameState.lastDraggedCard;

    if (card && card.element) {
        card.element.style.transition = 'all 0.3s ease-out';
        card.element.style.left = card.originalLeft;
        card.element.style.top = card.originalTop;
        
        setTimeout(() => {
            card.element.style.zIndex = card.laneIndex + 10;
        }, 300);
    }
}

function cleanupGhost(cardData) {
    gameState.opponentDragGhosts.forEach((ghostEl, key) => {
        const parts = key.split(':'); 
        if (parts[0] === cardData.suit && parts[1] === cardData.rank && parts[2] == cardData.value) {
            ghostEl.style.transition = 'opacity 0.2s';
            ghostEl.style.opacity = '0';
            setTimeout(() => {
                ghostEl.remove();
                gameState.opponentDragGhosts.delete(key);
            }, 200);
        }
    });

    const realCard = gameState.aiHand.find(c => 
        c.suit === cardData.suit && 
        c.rank === cardData.rank
    );

    if (realCard && realCard.element) {
        realCard.element.style.opacity = '1'; 
    }
}
/* =========================================
   PHASE 1 & 2: BORROWED PHASE LOGIC
   ========================================= */

function triggerBorrowedSplit() {
    console.log("Both decks empty. Triggering Borrowed Phase (Cycle 1).");

    const salvage = [...gameState.centerPileLeft, ...gameState.centerPileRight];
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];

    shuffle(salvage);
    const mid = Math.ceil(salvage.length / 2);
    
    gameState.playerDeck = salvage.slice(0, mid);
    gameState.aiDeck = salvage.slice(mid);

    gameState.playerReady = false;
    gameState.aiReady = false;
    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

    const syncData = {
        type: 'BORROWED_START',
        pDeck: gameState.playerDeck.map(packCard),
        aDeck: gameState.aiDeck.map(packCard)
    };
    sendNet(syncData);

    applyBorrowedUI();
}

function triggerSecondCycleReset() {
    console.log("Borrowed decks empty again. Triggering Cycle 2 Reset.");

    const pot = [...gameState.centerPileLeft, ...gameState.centerPileRight];
    
    let oddCard = null;
    if (pot.length % 2 !== 0) {
        oddCard = pot.pop(); 
    }

    const half = pot.length / 2;

    gameState.playerTotal = gameState.playerHand.length + half;
    gameState.aiTotal = gameState.aiHand.length + half;

    const payload = {
        type: 'CYCLE_RESET',
        pTotal: gameState.playerTotal,
        aTotal: gameState.aiTotal,
        oddCard: oddCard ? packCard(oddCard) : null
    };
    sendNet(payload);

    const modal = document.getElementById('slap-overlay');
    modal.classList.remove('hidden');
    document.getElementById('slap-text').innerText = "STALEMATE! DECK SPLIT";
    
    setTimeout(() => {
        modal.classList.add('hidden');
        startRoundHostAuthoritative(oddCard); 
    }, 2000);
}

function applyBorrowedUI() {
    document.getElementById('borrowed-player').classList.remove('hidden');
    document.getElementById('borrowed-ai').classList.remove('hidden');
    
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    
    checkDeckVisibility();
    updateScoreboard();
}
