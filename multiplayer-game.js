/* =========================================
   MULTIPLAYER GAME.JS
   ========================================= */

// --- 1. ELO VARIABLES ---
let isRanked = true; 
let enemyElo = 1000; 
let enemyGameCount = 0;
let matchResultReported = false;

// --- 2. FETCH ENEMY STATS ---
function fetchEnemyStats(enemyId) {
    console.log("Fetching stats for enemy:", enemyId);
    
    if (!window.db) {
        console.warn("Firebase Database not ready yet. Retrying in 500ms...");
        setTimeout(() => fetchEnemyStats(enemyId), 500);
        return;
    }

    // Go to the database and get their info
    window.db.ref('users/' + enemyId).once('value')
        .then((snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                
                // 1. GET ELO & GAMES
                enemyElo = data.elo || 1000;
                enemyGameCount = (data.wins || 0) + (data.losses || 0);
                
                // 2. GET LAST NAME (Fallback to Username if missing)
                const realLastName = data.lastName ? data.lastName.toUpperCase() : (data.username || "OPPONENT");
                
                console.log(`Enemy Found! Name: ${realLastName}, ELO: ${enemyElo}`);

                // 3. UPDATE GAME STATE IMMEDIATELY
                gameState.opponentName = realLastName;
                
                // 4. REFRESH THE SCOREBOARD TO SHOW NAME + ELO
                updateScoreboardWidget();

            } else {
                console.log("Enemy not found in database. Using default stats.");
            }
        })
        .catch(err => console.error("Error fetching stats:", err));
}

// --- 3. REPORT RESULT TO FIREBASE (WITH ADVANCED STATS) ---
function reportMatchResultInternal(isWin, onComplete, proofToken) {
    if (matchResultReported) { if (onComplete) onComplete(); return; }
    
    // SECURITY CHECK
    if (isWin && !proofToken && !gameState.opponentDisconnected) {
        console.warn("⚠️ SECURITY: Attempted to claim win without proof token.");
        return; 
    }

    matchResultReported = true; 
    console.log("🚀 REPORTING STATS to Database...");

    const user = firebase.auth().currentUser;
    if (!user) { if (onComplete) onComplete(); return; }

    const userRef = firebase.database().ref('users/' + user.uid);

    // CALCULATE MATCH DURATION
    const durationSec = gameState.matchStartTime ? Math.floor((Date.now() - gameState.matchStartTime) / 1000) : 0;

    userRef.transaction((userData) => {
        if (userData) {
            const currentElo = userData.elo || 1000;
            const wins = userData.wins || 0;
            const losses = userData.losses || 0;
            const myGameCount = wins + losses;

            // GET EXISTING EXTENDED STATS
            const exSlapsWon = userData.stats_slaps_won || 0;
            const exSlapsLost = userData.stats_slaps_lost || 0;
            const exRoundsWon = userData.stats_rounds_won || 0;
            const exRoundsLost = userData.stats_rounds_lost || 0;
            const exTotalTime = userData.stats_total_time_sec || 0;

            if (typeof calculateNewElo !== 'function') return userData;

            const newElo = calculateNewElo(currentElo, enemyElo, isWin, myGameCount, enemyGameCount);

            userData.elo = newElo;
            if (isWin) userData.wins = wins + 1;
            else userData.losses = losses + 1;

            // SAVE EXTENDED STATS
            userData.stats_slaps_won = exSlapsWon + gameState.p1Slaps;
            userData.stats_slaps_lost = exSlapsLost + gameState.aiSlaps; 
            userData.stats_rounds_won = exRoundsWon + gameState.p1Rounds;
            userData.stats_rounds_lost = exRoundsLost + gameState.aiRounds;
            userData.stats_total_time_sec = exTotalTime + durationSec;
            
            return userData;
        }
        return userData;
    }, (error, committed, snapshot) => {
        if (onComplete) onComplete();
    });
}

/* =========================================
   GAME LOGIC STARTS HERE ...
*/
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
    lastActionType: 'none',
    matchEnded: false,

    matchLive: false,

    matchStartTime: null,
    timerInterval: null,

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
    opponentDisconnected: false,

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
        // Keep this one, it's a logic error not a connection error
        showRoundMessage("NO MATCH DATA", "Return to matchmaking and create or join a match.");
        return;
    }

    // Initialize Peer
    if (gameState.peer) gameState.peer.destroy();
    gameState.peer = gameState.isHost ? new Peer(hostId) : new Peer();

    gameState.peer.on('open', (id) => {
        gameState.myId = id;
        if (gameState.isHost) {
            gameState.peer.on('connection', (conn) => bindConnection(conn));
        } else {
            connectToHost(hostId); // Extracted function for retrying
        }
    });

    gameState.peer.on('error', (err) => {
        console.error("Peer Error:", err.type);
        // --- NO POPUP HERE ---
        // We just let it fail silently or retry in the connectToHost loop.
    });
}

// Helper function to handle the "Patience"
function connectToHost(hostId) {
    console.log("Attempting connection to:", hostId);
    const conn = gameState.peer.connect(hostId, { reliable: true });
    
    // If it fails immediately (peer-unavailable), retry in 2s
    gameState.peer.once('error', (err) => {
        if (err.type === 'peer-unavailable') {
            console.log("Host not ready yet. Retrying in 2s...");
            setTimeout(() => connectToHost(hostId), 2000);
        }
    });

    bindConnection(conn);
}

function bindConnection(conn) {
    gameState.conn = conn;

    conn.on('open', () => {
        const myUid = (window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : null;
        sendNet({ type: 'HANDSHAKE', name: gameState.myName, uid: myUid });
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

    // --- 1. HANDSHAKE HANDLER ---
    if (msg.type === 'HANDSHAKE') {
        gameState.opponentName = msg.name || 'OPPONENT';
        updateScoreboardWidget();
        if (msg.uid) fetchEnemyStats(msg.uid);

        if (!gameState.handshakeDone) {
            gameState.handshakeDone = true;
            const myUid = (window.auth && window.auth.currentUser) ? window.auth.currentUser.uid : null;
            sendNet({ type: 'HANDSHAKE', name: gameState.myName, uid: myUid });
        }
        if (gameState.isHost && !gameState.roundStarted) {
            gameState.roundStarted = true;
            startRoundHostAuthoritative();
        }
        return; // <--- THIS WAS THE MISSING BRACKET FIX
    }

    // --- SECURITY: HANDLE CONCESSION TOKEN ---
    if (msg.type === 'CONCESSION_TOKEN') {
        console.log("✅ Received Concession Token:", msg.token);
        if (isRanked && !matchResultReported) {
            reportMatchResultInternal(true, null, msg.token);
        }
        return;
    }

    // --- STANDARD GAME HANDLERS ---
    if (msg.type === 'ROUND_START') { if (!gameState.isHost) startRoundJoinerFromState(msg.state); return; }
    if (msg.type === 'READY') { gameState.aiReady = true; document.getElementById('ai-draw-deck')?.classList.add('deck-ready'); checkDrawConditionMultiplayer(); return; }
    if (msg.type === 'HOST_COUNTDOWN') { startCountdownFromHost(); return; }
    if (msg.type === 'REVEAL_PRELOAD') { applyRevealPreload(msg.result); return; }
    if (msg.type === 'REVEAL_SHOW') { applyRevealShow(); return; }
    if (msg.type === 'DRAG') { applyOpponentDrag(msg.drag); return; }
    if (msg.type === 'MOVE_REQ') { if (gameState.isHost) adjudicateMove(msg.move, 'ai'); return; }
    if (msg.type === 'MOVE_APPLY') { applyMoveFromHost(msg.apply); return; }
    if (msg.type === 'MOVE_REJECT') { rejectMoveFromHost(msg.reject); return; }
    if (msg.type === 'OPPONENT_REJECT') { cleanupGhost(msg.card); return; }
    if (msg.type === 'OPPONENT_FLIP') { const card = gameState.aiHand.find(c => c.id === msg.cardId); if (card && card.element) setCardFaceUp(card.element, card, 'ai'); return; }
    if (msg.type === 'SLAP_REQ') { if (gameState.isHost) adjudicateSlap('ai'); return; }
    if (msg.type === 'SLAP_UPDATE') { applySlapUpdate(msg); return; }
    if (msg.type === 'PENALTY_UPDATE') { applyPenaltyUpdate(msg); return; }
    if (msg.type === 'ROUND_OVER') { applyRoundOver(msg); return; }
    if (msg.type === 'MATCH_OVER') { applyMatchOver(msg); return; }
    if (msg.type === 'BORROWED_START') { 
        gameState.playerDeck = msg.aDeck.map(unpackCard); 
        gameState.aiDeck = msg.pDeck.map(unpackCard);
        gameState.centerPileLeft = []; gameState.centerPileRight = [];
        const localLeft = msg.pStart ? unpackCard(msg.pStart) : null;
        const localRight = msg.aStart ? unpackCard(msg.aStart) : null;
        if (localLeft) gameState.centerPileLeft.push(localLeft);
        if (localRight) gameState.centerPileRight.push(localRight);
        gameState.playerReady = false; gameState.aiReady = false;
        applyBorrowedUI(localRight, localLeft); 
        return; 
    }
    if (msg.type === 'CYCLE_RESET') { 
        gameState.playerTotal = msg.aTotal; gameState.aiTotal = msg.pTotal; 
        const modal = document.getElementById('slap-overlay'); 
        modal.classList.remove('hidden'); 
        document.getElementById('slap-text').innerText = "STALEMATE RESET"; 
        return; 
    }
    

    if (msg.type === 'CONCESSION_REQ') {
        if (gameState.matchEnded) return;

        gameState.gameActive = false; 
        const modal = document.getElementById('concession-modal');
        if (modal) modal.classList.remove('hidden');
        return;
    }

    if (msg.type === 'CONCESSION_RESULT') {
        if (msg.accepted) {
            window.location.href = 'index.html'; 
        } else {
            console.log("Opponent declined. Taking Loss...");
            const overlay = document.getElementById('concession-waiting-overlay');
            if(overlay) overlay.innerHTML = "<h1>DECLINED</h1><p>Recording Loss...</p>";

            if (isRanked) {
                reportMatchResultInternal(false, () => {
                    alert("Opponent declined concession. Loss recorded.");
                    window.location.href = 'index.html';
                });
            } else {
                window.location.href = 'index.html';
            }
        }
        return;
    }

    // --- DISCONNECT HANDLER ---
    if (msg.type === 'OPPONENT_LEFT') {
        if (gameState.matchEnded) return;
        gameState.opponentDisconnected = true;

        document.getElementById('concession-waiting-overlay')?.classList.add('hidden');
        document.getElementById('concession-modal')?.classList.add('hidden');
        document.getElementById('rematch-modal')?.classList.add('hidden');

        // --- CRITICAL FIX: CHECK IF MATCH IS LIVE ---
        if (gameState.matchLive && isRanked) {
            // Game was actually playing -> Count it as a Win
            reportMatchResultInternal(true);
            showEndGame(`${(gameState.opponentName || "OPPONENT").toUpperCase()} DISCONNECTED`, true);
        } else {
            // Game hadn't started yet -> VOID IT (No stats)
            console.log("Opponent disconnected before match start. Match Voided.");
            const modal = document.getElementById('game-message');
            if (modal) {
                modal.querySelector('h1').innerText = "CONNECTION LOST";
                modal.querySelector('h1').style.color = "#fff"; // Neutral color
                modal.querySelector('p').innerHTML = `
                    The opponent failed to connect or left before the game started.<br>
                    <strong>No stats have been recorded.</strong>
                    <div style="margin-top:20px;">
                        <button class="btn-action-small" onclick="window.location.href='index.html'" style="background:#444; width:auto;">
                            MAIN MENU
                        </button>
                    </div>
                `;
                modal.classList.remove('hidden');
            }
        }
        return;
    }

    if (msg.type === 'REMATCH_REQ') {
        document.getElementById('rematch-modal').classList.remove('hidden');
        return;
    }
    if (msg.type === 'REMATCH_YES') {
        document.getElementById('game-message').classList.add('hidden');
        gameState.p1Rounds = 0; gameState.aiRounds = 0;
        gameState.p1Slaps = 0; gameState.aiSlaps = 0;
        gameState.playerTotal = 26; gameState.aiTotal = 26;
        gameState.matchEnded = false;
        updateScoreboardWidget();
        if (gameState.isHost) startRoundHostAuthoritative();
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
        if (e.repeat) return; 

        if (!gameState.gameActive) return;

        const now = Date.now();
        // Dynamic Debounce: 50ms for Reveal, 0ms for Move
        const cooldown = (gameState.lastActionType === 'reveal') ? 50 : 0;

        if (now - gameState.lastSpacebarTime < cooldown) { 
            console.log(`Ignored Spacebar: Cooldown active (${cooldown}ms)`); 
            return; 
        }
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
        resolveSlap(who);
    } else {
        issuePenaltyHostAuth(who);
    }
}

function resolveSlap(winner) {
    gameState.slapActive = false;
    gameState.gameActive = false;

    // Phase 2 Check
    const isBorrowed = !document.getElementById('borrowed-player').classList.contains('hidden');
    const bothDecksEmpty = (gameState.playerDeck.length === 0 && gameState.aiDeck.length === 0);

    if (!isBorrowed && bothDecksEmpty) {
        const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;
        
        if (winner === 'player') {
            gameState.playerTotal = gameState.playerHand.length; 
            gameState.aiTotal = gameState.aiHand.length + pilesTotal;
        } else {
            gameState.aiTotal = gameState.aiHand.length;
            gameState.playerTotal = gameState.playerHand.length + pilesTotal;
        }

        const resetMsg = {
            type: 'CYCLE_RESET',
            pTotal: gameState.playerTotal,
            aTotal: gameState.aiTotal
        };
        sendNet(resetMsg);

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

    // Normal Slap
    const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

    gameState.p1Slaps = gameState.p1Slaps || 0;
    gameState.aiSlaps = gameState.aiSlaps || 0;

    if (winner === 'player') {
        gameState.aiTotal += pilesTotal; 
        gameState.p1Slaps++; 
    } else {
        gameState.playerTotal += pilesTotal; 
        gameState.aiSlaps++; 
    }

    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';

    const update = {
        type: 'SLAP_UPDATE',
        winner: winner,
        pTotal: gameState.playerTotal,
        aTotal: gameState.aiTotal,
        p1Slaps: gameState.p1Slaps,
        aiSlaps: gameState.aiSlaps
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
        
        // --- THE LOGIC FLIP ---
        if (who === 'player') { 
            // HOST (PLAYER) GOT THE RED CARD
            gameState.playerYellows = 0; 
            gameState.playerReds++; 
            currentR = gameState.playerReds; 
            currentY = 0; 
            
            // Penalty: Host GAINS 3 cards (Bad), Opponent LOSES 3 (Good)
            gameState.playerTotal += 3;
            gameState.aiTotal = Math.max(0, gameState.aiTotal - 3);
            
        } else { 
            // GUEST (AI) GOT THE RED CARD
            gameState.aiYellows = 0; 
            gameState.aiReds++; 
            currentR = gameState.aiReds; 
            currentY = 0; 
            
            // Penalty: Guest GAINS 3 cards (Bad), Host LOSES 3 (Good)
            gameState.aiTotal += 3;
            gameState.playerTotal = Math.max(0, gameState.playerTotal - 3);
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
// --- VISUAL APPLICATORS ---

function applySlapUpdate(data) {
    gameState.gameActive = false;
    gameState.slapActive = false;

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

    const overlay = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    if (overlay && txt) {
        txt.innerText = winnerText;
        overlay.style.backgroundColor = color;
        overlay.classList.remove('hidden');
    }

    // Smart Visibility (Ghost Logic)
    const ghostKeys = Array.from(gameState.opponentDragGhosts.keys());

    gameState.aiHand.forEach(c => {
        if (c.element) {
            const cardPrefix = `${c.suit}:${c.rank}:${c.value}`;
            const hasGhost = ghostKeys.some(k => k.startsWith(cardPrefix));
            c.element.style.opacity = hasGhost ? '0' : '1';
        }
    });

    gameState.playerHand.forEach(c => { if (c.element) c.element.style.opacity = '1'; });

    // Sync Stats
    const p1S = (typeof data.p1Slaps === 'number') ? data.p1Slaps : 0;
    const aiS = (typeof data.aiSlaps === 'number') ? data.aiSlaps : 0;

    if (gameState.isHost) {
        gameState.playerTotal = data.pTotal;
        gameState.aiTotal = data.aTotal;
        gameState.p1Slaps = p1S;
        gameState.aiSlaps = aiS;
    } else {
        gameState.playerTotal = data.aTotal;
        gameState.aiTotal = data.pTotal;
        gameState.p1Slaps = aiS; 
        gameState.aiSlaps = p1S;
    }
    
    updateScoreboard();
    updateScoreboardWidget(); 

    setTimeout(() => {
        gameState.centerPileLeft = [];
        gameState.centerPileRight = [];
        document.getElementById('center-pile-left').innerHTML = '';
        document.getElementById('center-pile-right').innerHTML = '';

        if (gameState.opponentDragGhosts) {
            gameState.opponentDragGhosts.forEach(el => el.remove()); 
            gameState.opponentDragGhosts.clear(); 
        }

        gameState.aiHand.forEach(c => { if (c.element) c.element.style.opacity = '1'; });

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
    gameState.matchLive = true;
    startVisualTimer();
    
    await preloadCardImages([...gameState.playerHand, ...gameState.aiHand]);

    let fullDeck = createDeck();
    shuffle(fullDeck);

    if (gameState.playerTotal <= 0) { showEndGame("YOU WIN THE MATCH!", true); return; }
    if (gameState.aiTotal <= 0) { showEndGame("OPPONENT WINS THE MATCH!", false); return; }

    const pTotal = gameState.playerTotal;
    const aTotal = gameState.aiTotal;

    const pAllCards = fullDeck.slice(0, pTotal);
    const aAllCards = fullDeck.slice(pTotal, pTotal + aTotal);
    const leftoverCard = (pTotal + aTotal < 52) ? fullDeck[pTotal + aTotal] : null;

    const pHandSize = Math.min(10, pTotal);
    const aHandSize = Math.min(10, aTotal);

    const pHandCards = pAllCards.splice(0, pHandSize);
    gameState.playerDeck = pAllCards;

    const aHandCards = aAllCards.splice(0, aHandSize);
    gameState.aiDeck = aAllCards;

    const bp = document.getElementById('borrowed-player');
    const ba = document.getElementById('borrowed-ai');
    if (bp) bp.classList.add('hidden');
    if (ba) ba.classList.add('hidden');

    // Initial shortage logic
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

    const centerCard = leftoverCard || oddCard;
    if (centerCard) {
        gameState.centerPileLeft.push(centerCard);
        renderCenterPile('left', centerCard);
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
   gameState.matchLive = true;
    startVisualTimer();

    await preloadCardImages([...gameState.playerHand, ...gameState.aiHand]);
    dealSmartHand(gameState.playerHand, 'player');
    dealSmartHand(gameState.aiHand, 'ai');
    resetCenterPiles();
    
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
    gameState.lastActionType = 'move';

    // 1. AGGRESSIVE GHOST CLEANUP (The Fix)
    const cardIdentity = `${cardObj.suit}:${cardObj.rank}:${cardObj.value}`;
    
    Array.from(gameState.opponentDragGhosts.keys()).forEach(key => {
        if (key.startsWith(cardIdentity)) {
            const el = gameState.opponentDragGhosts.get(key);
            if (el) el.remove();
            gameState.opponentDragGhosts.delete(key);
        }
    });

    // 2. Update piles
    const targetPile = (side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
    targetPile.push(cardObj);

    // 3. Remove from Hand and Decrement Score
    if (mover === 'player') {
        gameState.playerHand = gameState.playerHand.filter(c => c !== cardObj);
        gameState.playerTotal--;
    } else {
        gameState.aiHand = gameState.aiHand.filter(c => c !== cardObj);
        gameState.aiTotal--;
    }

    // 4. Update UI
    if (cardObj.element) cardObj.element.remove();
    renderCenterPile(side, cardObj);
    updateScoreboard();
    checkSlapCondition();

    // 5. CHECK FOR SIMULTANEOUS SHORTAGE TRIGGER
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length === 0) {
        if (gameState.centerPileLeft.length > 0 || gameState.centerPileRight.length > 0) {
            triggerSuddenDeathSplit(); 
        }
    }

    // 6. WIN / END ROUND LOGIC
    const currentHand = (mover === 'player') ? gameState.playerHand : gameState.aiHand;
    const handEmpty = (currentHand.length === 0);
    
    const bpHidden = document.getElementById('borrowed-player').classList.contains('hidden');
    const baHidden = document.getElementById('borrowed-ai').classList.contains('hidden');
    const isSimultaneousPhase = (!bpHidden && !baHidden);

    if (handEmpty) {
        if (isSimultaneousPhase) {
            let hasPenalty = false;
            if (mover === 'player') hasPenalty = (gameState.playerReds > 0 || gameState.playerYellows > 0);
            else hasPenalty = (gameState.aiReds > 0 || gameState.aiYellows > 0);

            if (!hasPenalty) {
                const payload = { type: 'MATCH_OVER', winner: mover };
                sendNet(payload);
                applyMatchOver(payload);
            } else {
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
        aiTotal: gameState.aiTotal
    };
}
function applyMoveFromHost(a) {
    gameState.lastActionType = 'move';
    const localMover = (a.mover === 'player') ? 'ai' : 'player';
    const localSide = (a.side === 'left') ? 'right' : 'left';

    // 1. AGGRESSIVE GHOST CLEANUP (The Fix)
    const cardIdentity = `${a.card.suit}:${a.card.rank}:${a.card.value}`;

    Array.from(gameState.opponentDragGhosts.keys()).forEach(key => {
        if (key.startsWith(cardIdentity)) {
            const el = gameState.opponentDragGhosts.get(key);
            if (el) el.remove();
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
}

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

        if (gameState.playerDeck.length === 0 && gameState.aiDeck.length === 0) {
            const isBorrowed = !document.getElementById('borrowed-player').classList.contains('hidden');
            
            if (isBorrowed) {
                triggerSecondCycleReset();
            } else {
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

    const playerBorrowing = bpEl ? !bpEl.classList.contains('hidden') : false;
    const aiBorrowing = baEl ? !baEl.classList.contains('hidden') : false;
    const nowSimultaneous = (playerBorrowing && aiBorrowing);

    if (!nowSimultaneous) {
        if (playerBorrowing) gameState.aiTotal--; else gameState.playerTotal--;
        if (aiBorrowing) gameState.playerTotal--; else gameState.aiTotal--;
    } 

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

    let suddenDeathTriggered = false;
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length === 0) {
        if (gameState.centerPileLeft.length > 0 || gameState.centerPileRight.length > 0) {
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
    if (p1Name) p1Name.innerText = "YOU";

    const p2Name = document.getElementById('sb-p2-name'); 
    const oppLabel = document.getElementById('opponent-display-name'); 

    const displayName = `${gameState.opponentName} (${enemyElo})`;

    if (p2Name) p2Name.innerText = displayName;
    if (oppLabel) oppLabel.innerText = displayName;

    const p1R = document.getElementById('sb-p1-rounds');
    const p2R = document.getElementById('sb-p2-rounds');
    const p1S = document.getElementById('sb-p1-slaps');
    const p2S = document.getElementById('sb-p2-slaps');

    if (p1R) p1R.innerText = gameState.p1Rounds;
    if (p2R) p2R.innerText = gameState.aiRounds;
    if (p1S) p1S.innerText = gameState.p1Slaps;
    if (p2S) p2S.innerText = gameState.aiSlaps;
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
    stopVisualTimer();

    // --- FIX: FORCE CLOSE CONCESSION MODALS ---
    // If a request was pending, hide it now because the match is done.
    document.getElementById('concession-modal')?.classList.add('hidden');
    document.getElementById('concession-waiting-overlay')?.classList.add('hidden');
    // ------------------------------------------

    const iAmHost = gameState.isHost;
    const hostWon = (data.winner === 'player');
    const iWon = (iAmHost && hostWon) || (!iAmHost && !hostWon);

    const title = iWon ? "YOU WON THE MATCH!" : "OPPONENT WINS THE MATCH!";
    showEndGame(title, iWon);

    if (isRanked) {
        if (iWon) {
            console.log("I won! Waiting for opponent's concession token...");
        } else {
            console.log("I lost. Sending concession token to winner...");
            const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
            sendNet({ type: 'CONCESSION_TOKEN', token: token });
            reportMatchResultInternal(false, null, token); 
        }
    }
}
function quitMatch() {
    if (gameState.matchEnded) {
        window.location.href = 'index.html';
        return;
    }

    console.log("Requesting concession (Mid-Game)...");
    
    if (!gameState.conn || !gameState.conn.open) {
        window.location.href = 'index.html';
        return;
    }

    gameState.gameActive = false; 

    const overlay = document.getElementById('concession-waiting-overlay');
    if (overlay) overlay.classList.remove('hidden');

    const btn = document.querySelector('.btn-quit');
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Waiting...';
        btn.disabled = true;
    }

    sendNet({ type: 'CONCESSION_REQ' });
}
function respondConcession(accepted) {
    document.getElementById('concession-modal').classList.add('hidden');
    sendNet({ type: 'CONCESSION_RESULT', accepted: accepted });

    if (accepted) {
        alert("You accepted the concession. Match is void.");
        window.location.href = 'index.html';
    } else {
        console.log("Concession declined. Claiming Victory.");
        if (isRanked) reportMatchResultInternal(true);
        showEndGame("OPPONENT FORFEIT (VICTORY)", true);
    }
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
    
    gameState.lastActionType = 'reveal';
    
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

    let pStart = null;
    let aStart = null;

    if (gameState.playerDeck.length > 0) {
        pStart = gameState.playerDeck.pop();
        gameState.centerPileRight.push(pStart); // Host's Right
    }
    if (gameState.aiDeck.length > 0) {
        aStart = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(aStart); // Host's Left
    }

    gameState.playerReady = false;
    gameState.aiReady = false;
    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

    const syncData = {
        type: 'BORROWED_START',
        pDeck: gameState.playerDeck.map(packCard),
        aDeck: gameState.aiDeck.map(packCard),
        pStart: pStart ? packCard(pStart) : null,
        aStart: aStart ? packCard(aStart) : null
    };
    sendNet(syncData);

    applyBorrowedUI(pStart, aStart);
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
        startRoundHostAuthoritative(); 
    }, 2000);
}
function applyBorrowedUI(pStart = null, aStart = null) {
    document.getElementById('borrowed-player').classList.remove('hidden');
    document.getElementById('borrowed-ai').classList.remove('hidden');
    
    const l = document.getElementById('center-pile-left');
    const r = document.getElementById('center-pile-right');
    if (l) l.innerHTML = '';
    if (r) r.innerHTML = '';
    
    if (pStart) renderCenterPile('right', pStart);
    if (aStart) renderCenterPile('left', aStart);
    
    checkDeckVisibility();
    updateScoreboard();
    
    gameState.gameActive = true; 
}
window.addEventListener('beforeunload', () => {
    if (gameState.conn && gameState.conn.open) {
        gameState.conn.send({ type: 'OPPONENT_LEFT' });
        const start = Date.now();
        while (Date.now() - start < 50) { /* busy wait */ }
    }
});
// --- VISUAL TIMER LOGIC ---
function startVisualTimer() {
    if (gameState.timerInterval) return;

    if (!gameState.matchStartTime) {
        gameState.matchStartTime = Date.now();
    }

    const timerEl = document.getElementById('match-timer');
    
    gameState.timerInterval = setInterval(() => {
        if (!gameState.matchStartTime) return;
        
        const now = Date.now();
        const diff = Math.floor((now - gameState.matchStartTime) / 1000);
        
        const mins = Math.floor(diff / 60).toString().padStart(2, '0');
        const secs = (diff % 60).toString().padStart(2, '0');
        
        if (timerEl) timerEl.innerText = `${mins}:${secs}`;
    }, 1000);
}

function stopVisualTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }
}
