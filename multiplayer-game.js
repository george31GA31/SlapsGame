/* =========================================
   MULTIPLAYER GAME.JS
   ========================================= */

// --- 1. ELO VARIABLES ---
// Fail closed until both peers have exchanged registered account identities.
const guestAtMatchStart = ISFSession.isGuest();
const MATCH_PROTOCOL = 6;
// A browser-hosted peer match cannot securely referee itself.  Keep these
// matches playable, but never let a player-controlled browser change rated
// totals until the neutral match service is deployed.
const PEER_RANKED_MATCHES_ENABLED = false;
let isRanked = false;
let localMatchUid = null;
let opponentUid = null;
let opponentIsGuest = true;
let unrankedMatch = guestAtMatchStart;
let enemyStatsReady = false;

function matchIdentity() {
    const guest = guestAtMatchStart || ISFSession.isGuest() || !localMatchUid;
    const bounds = measuredFoundationBounds();
    return { type: 'HANDSHAKE', name: gameState.myName,
        uid: guest ? null : localMatchUid, isGuest: guest, protocol: MATCH_PROTOCOL,
        ...(bounds ? { foundationBounds: bounds } : {}) };
}

function canRecordMatch() {
    return false;
}

function updateMatchStatus() {
    if (guestAtMatchStart) {
        ISFSession.showMatchStatus('GUEST MODE · Unranked · Neither player’s ELO, history or statistics will change');
    } else if (gameState.handshakeDone && !isRanked) {
        ISFSession.showMatchStatus('PEER MATCH · Unrated while the neutral referee service is being completed');
    } else if (isRanked) {
        ISFSession.showMatchStatus('RANKED MATCH');
    }
}
let enemyElo = 1000; 
let enemyGameCount = 0;
let matchResultReported = false;
let onlineHistoryId = null;

// --- 2. FETCH ENEMY STATS ---
function fetchEnemyStats(enemyId) {
    if (!isRanked || unrankedMatch || opponentIsGuest) return;
    console.log("Fetching stats for enemy:", enemyId);
    
    if (!window.db) {
        console.warn("Firebase Database not ready yet. Retrying in 500ms...");
        setTimeout(() => fetchEnemyStats(enemyId), 500);
        return;
    }

    // Go to the database and get their info
    window.db.ref('publicPlayers/' + enemyId).once('value')
        .then((snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                enemyStatsReady = true;
                
                // 1. GET ELO & GAMES
                enemyElo = data.elo || 1000;
                enemyGameCount = (data.wins || 0) + (data.losses || 0);
                
                // 2. GET LAST NAME (Fallback to Username if missing)
                const publicName = (data.username || "OPPONENT").toUpperCase();
                
                console.log(`Enemy Found! Name: ${publicName}, ELO: ${enemyElo}`);

                // 3. UPDATE GAME STATE IMMEDIATELY
                gameState.opponentName = publicName;
                
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
    // Every result route (including forfeit, disconnect and rematch) passes here.
    // Return before any database access; also release callers waiting to navigate.
    if (!canRecordMatch()) { if (onComplete) onComplete(); return; }
    if (matchResultReported) { if (onComplete) onComplete(); return; }
    
    // SECURITY CHECK
    if (isWin && !proofToken && !gameState.opponentDisconnected) {
        console.warn("⚠️ SECURITY: Attempted to claim win without proof token.");
        return; 
    }

    matchResultReported = true; 
    onlineHistoryId ||= (globalThis.crypto?.randomUUID?.() || String(Date.now()));
    window.db.ref('matchHistory/' + localMatchUid + '/' + onlineHistoryId).set({
        endedAt: Date.now(), opponent: gameState.opponentName || 'Opponent', won: !!isWin,
        roundsWon: gameState.p1Rounds || 0, roundsLost: gameState.aiRounds || 0,
        slapsWon: gameState.p1Slaps || 0, slapsLost: gameState.aiSlaps || 0,
        source: 'peer-match'
    }).catch(() => ISFSession.showMatchStatus('Match finished · History save failed'));

    console.log("🚀 REPORTING STATS to Database...");

    const user = firebase.auth().currentUser;
    if (!user) { if (onComplete) onComplete(); return; }

    const userRef = firebase.database().ref('users/' + user.uid);

    // CALCULATE MATCH DURATION
    const durationSec = gameState.matchStartTime ? Math.floor((Date.now() - gameState.matchStartTime) / 1000) : 0;

    userRef.transaction((userData) => {
        if (!canRecordMatch()) return;
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
        if (!error && committed && snapshot && typeof snapshot.val === 'function' && window.ISFPublicPlayer) {
            ISFPublicPlayer.sync(user.uid, snapshot.val()).catch(() => ISFSession.showMatchStatus('Match finished · Rankings update failed'));
        }
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
    phase: null,
    playerHolding: [],
    aiHolding: [],
    playerRoundCards: [],
    aiRoundCards: [],
    matchEnded: false,

    matchLive: false,

    matchStartTime: null,
    timerInterval: null,

    playerReady: false,
    aiReady: false,         // REUSED AS OPPONENT READY
    borrowedPlayer: false,
    borrowedAi: false,

    drawLock: false,
    countdownRunning: false,
    countdownTimer: null,

    slapActive: false,

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
    protocolCompatible: false,
    initialRoundScheduled: false,
    opponentDisconnected: false,

    // Ghosts for opponent drag previews
    opponentDragGhosts: new Map(),

    // Sequence counter
    moveSeq: 0,

    // Authoritative host revision and local pending-action recovery.
    matchRevision: 0,
    lastAppliedRevision: 0,
    roundEpoch: 0,
    networkCardSequence: 0,
    lastRoundWinner: null,
    revealRevision: 0,
    peerFoundationBounds: null,
    pendingActions: new Map(),
    syncRequested: false,
    competitionId: null,
    competitionMatchId: null,
    legacyTournament: false,
    embeddedResultSent: false,

    // Stats
    p1Rounds: 0,
    aiRounds: 0,
    p1Slaps: 0,
    aiSlaps: 0
};

const CARD_BACK_SRC = 'assets/cards/back_of_card.png';

class Card {
    constructor(suit, rank, value, id) {
        this.suit = suit;
        this.rank = rank;
        this.value = value;
        this.id = id || Math.random().toString(36).substr(2, 9);
        this.imgSrc = suit && rank ? `assets/cards/${rank}_of_${suit}.png` : CARD_BACK_SRC;
        this.isFaceUp = false;
        this.owner = null;
        this.element = null;
    }
}

/* ================================
   BOOTSTRAP
   ================================ */

window.onload = async function () {
    document.addEventListener('keydown', handleInput);

    // Firebase restores persisted accounts asynchronously.
    if (window.isfAuthReady) await window.isfAuthReady;
    const user = window.auth && window.auth.currentUser;
    localMatchUid = !guestAtMatchStart && !ISFSession.isGuest() && user && !user.isAnonymous ? user.uid : null;
    unrankedMatch = unrankedMatch || !localMatchUid;
    updateScoreboardWidget();
    updateMatchStatus();
    initMultiplayer();
};

/* ================================
   MULTIPLAYER INIT
   ================================ */

function initMultiplayer() {
    const matchParams = new URLSearchParams(location.search);
    const role = (matchParams.get('role') || localStorage.getItem('isf_role') || '').toLowerCase();
    const hostId = (matchParams.get('code') || localStorage.getItem('isf_code') || '').trim();
    const myName = (matchParams.get('name') || localStorage.getItem('isf_my_name') || 'Player').trim().slice(0,80);
    if (matchParams.has('competition')) {
        unrankedMatch = true;
        gameState.competitionId = matchParams.get('competition');
        gameState.competitionMatchId = matchParams.get('match');
    }
    gameState.legacyTournament = matchParams.get('legacyTournament') === '1';

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
    if (gameState.conn && gameState.conn !== conn && gameState.conn.open) { conn.close(); return; }
    if (gameState.boundPeer && gameState.boundPeer !== conn.peer) { conn.close(); return; }
    gameState.boundPeer = conn.peer;
    gameState.conn = conn;

    conn.on('open', () => {
        sendNet(matchIdentity());
    });

    const admit = NetworkGuard.limiter();
    conn.on('data', (msg) => { if (gameState.conn === conn && admit(Date.now())) { try { handleNet(msg); } catch (error) { console.warn('Rejected malformed match event'); } } });

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

function nextActionId(kind) {
    return `${kind}:${gameState.myId || 'player'}:${Date.now().toString(36)}:${++gameState.moveSeq}`;
}

function clearPendingAction(reqId) {
    if (!reqId) return;
    const pending = gameState.pendingActions.get(reqId);
    if (pending?.timer) clearTimeout(pending.timer);
    gameState.pendingActions.delete(reqId);
}

function clearAllPendingActions() {
    for (const pending of gameState.pendingActions.values()) clearTimeout(pending.timer);
    gameState.pendingActions.clear();
}

const PENDING_FIELDS = { move: 'pendingMove', flip: 'flipPending', layout: 'layoutPending' };

function beginPendingAction(kind, card, reqId) {
    const field = PENDING_FIELDS[kind];
    card[field] = reqId;
    const pending = { kind, cardId: card.id, reqId, timer: null };
    pending.timer = setTimeout(() => {
        if (!gameState.pendingActions.has(reqId)) return;
        const liveCard = gameState.playerHand.find(c => c.id === card.id);
        if (liveCard && liveCard[field] === reqId) liveCard[field] = null;
        clearPendingAction(reqId);
        requestAuthoritativeSync(`${kind}_timeout`);
        SlapsFeedback?.show('Match update delayed. Refreshing the board…');
    }, 3500);
    gameState.pendingActions.set(reqId, pending);
}

function settlePendingAction(card, kind, reqId) {
    const field = PENDING_FIELDS[kind];
    const pendingId = reqId || card?.[field];
    if (card && (!reqId || card[field] === reqId)) card[field] = null;
    clearPendingAction(pendingId);
}

function sendAuthoritative(type, fields = {}) {
    const packet = { type, ...fields, revision: ++gameState.matchRevision };
    sendNet(packet);
    return packet;
}

function requestAuthoritativeSync(reason = 'state_mismatch') {
    if (gameState.isHost || gameState.connectionSuspended || gameState.syncRequested) return;
    gameState.syncRequested = true;
    sendNet({ type: 'SYNC_REQ', reason });
    setTimeout(() => { gameState.syncRequested = false; }, 4500);
}

function acceptAuthoritativeRevision(message, allowGap = false) {
    if (gameState.isHost) return true;
    const revision = message?.revision;
    if (!Number.isInteger(revision) || revision < 1) {
        requestAuthoritativeSync('missing_revision');
        return false;
    }
    if (revision <= gameState.lastAppliedRevision) return false;
    if (!allowGap && gameState.lastAppliedRevision && revision !== gameState.lastAppliedRevision + 1) {
        requestAuthoritativeSync('revision_gap');
        return false;
    }
    gameState.lastAppliedRevision = revision;
    return true;
}

function notifyEmbeddedMatchResult(won) {
    if (gameState.embeddedResultSent) return;
    const targetOrigin = location.origin || '*';
    if (gameState.competitionId && window.parent && window.parent !== window) {
        gameState.embeddedResultSent = true;
        window.parent.postMessage({
            type: 'COMPETITION_RESULT',
            won: !!won,
            roundsWon: gameState.p1Rounds || 0,
            roundsLost: gameState.aiRounds || 0,
            slapsWon: gameState.p1Slaps || 0,
            slapsLost: gameState.aiSlaps || 0
        }, targetOrigin);
        return;
    }
    if (gameState.legacyTournament && window.top && window.top !== window) {
        gameState.embeddedResultSent = true;
        window.top.postMessage({ type: 'GAME_OVER', result: won ? 'win' : 'loss' }, targetOrigin);
    }
}

function exitEmbeddedMatch() {
    const targetOrigin = location.origin || '*';
    if ((gameState.competitionId || gameState.legacyTournament) && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'COMPETITION_EXIT' }, targetOrigin);
        return;
    }
    window.location.href = 'index.html';
}

/* ================================
   NETWORK MESSAGE HANDLER
   ================================ */

function handleNet(msg) {
    if (!NetworkGuard.valid(msg, gameState.isHost)) return;

    // --- 1. HANDSHAKE HANDLER ---
    if (msg.type === 'HANDSHAKE') {
        if (msg.protocol !== MATCH_PROTOCOL) {
            gameState.protocolCompatible = false;
            gameState.gameActive = false;
            ISFSession.showMatchStatus('MATCH VERSION MISMATCH · Reload both players');
            showRoundMessage("MATCH VERSION MISMATCH", "Both players need to reload Slaps before starting this match.");
            return;
        }
        gameState.protocolCompatible = true;
        if (SlapsEngine.isValidFoundationBounds(msg.foundationBounds)) gameState.peerFoundationBounds = msg.foundationBounds;
        gameState.opponentName = typeof msg.name === 'string' ? msg.name : 'OPPONENT';
        // Old/unknown clients cannot opt a guest into a ranked match.
        opponentIsGuest = msg.isGuest !== false || !msg.uid || msg.protocol !== MATCH_PROTOCOL;
        opponentUid = typeof msg.uid === 'string' ? msg.uid : null;
        unrankedMatch = unrankedMatch || opponentIsGuest;
        isRanked = PEER_RANKED_MATCHES_ENABLED && !unrankedMatch && !!localMatchUid && !!opponentUid;
        if (isRanked) fetchEnemyStats(opponentUid);
        updateScoreboardWidget();

        if (!gameState.handshakeDone) {
            gameState.handshakeDone = true;
            sendNet(matchIdentity());
        }
        updateMatchStatus();
        if (gameState.isHost && !gameState.initialRoundScheduled) {
            gameState.initialRoundScheduled = true;
            startRoundHostAuthoritative();
        }
        return; // <--- THIS WAS THE MISSING BRACKET FIX
    }

    // --- SECURITY: HANDLE CONCESSION TOKEN ---
    if (msg.type === 'CONCESSION_TOKEN') {

        if (isRanked && !matchResultReported) {
            reportMatchResultInternal(true, null, msg.token);
        }
        return;
    }

    // --- STANDARD GAME HANDLERS ---
    if (msg.type === 'SYNC_REQ') { if (gameState.isHost) sendStateSnapshot(msg.reason); return; }
    if (msg.type === 'SYNC') {
        if (!gameState.isHost && acceptAuthoritativeRevision(msg, true)) applyStateSnapshot(msg.state);
        return;
    }
    if (msg.type === 'ROUND_START') {
        if (!gameState.isHost && gameState.protocolCompatible && acceptAuthoritativeRevision(msg)) startRoundJoinerFromState(msg.state);
        return;
    }
    if (msg.type === 'READY') {
        if (canReadyForReveal() && msg.basis === gameState.revealRevision) {
            gameState.aiReady = true;
            document.getElementById('ai-draw-deck')?.classList.add('deck-ready');
            checkDrawConditionMultiplayer();
        }
        return;
    }
    if (msg.type === 'DRAW_REQ') {
        if (gameState.isHost) adjudicateDrawRequest(msg.basis);
        return;
    }
    if (msg.type === 'HOST_COUNTDOWN') {
        if (msg.basis === gameState.revealRevision && gameState.phase === 'awaiting_reveal') startCountdownFromHost();
        return;
    }
    if (msg.type === 'REVEAL_SHOW') {
        if (acceptAuthoritativeRevision(msg)) applyRevealFromHost(msg.result);
        return;
    }
    if (msg.type === 'DRAG') { applyOpponentDrag(msg.drag); return; }
    if (msg.type === 'LAYOUT_REQ') { if (gameState.isHost) adjudicateLayout(msg.layout, 'ai'); return; }
    if (msg.type === 'LAYOUT_APPLY') { if (acceptAuthoritativeRevision(msg)) applyLayoutFromHost(msg.layout); return; }
    if (msg.type === 'MOVE_REQ') { if (gameState.isHost) adjudicateMove(msg.move, 'ai'); return; }
    if (msg.type === 'MOVE_APPLY') { if (acceptAuthoritativeRevision(msg)) applyMoveFromHost(msg.apply); return; }
    if (msg.type === 'MOVE_REJECT') { if (acceptAuthoritativeRevision(msg)) rejectMoveFromHost(msg.reject); return; }
    if (msg.type === 'FLIP_REQ') { if (gameState.isHost) adjudicateFlip(msg.flip, 'ai'); return; }
    if (msg.type === 'FLIP_APPLY') { if (acceptAuthoritativeRevision(msg)) applyFlipFromHost(msg.flip); return; }
    if (msg.type === 'FLIP_REJECT') { if (acceptAuthoritativeRevision(msg)) rejectFlipFromHost(msg.flip); return; }
    if (msg.type === 'SLAP_REQ') {
        if (gameState.isHost && msg.left === centreTopId('left') && msg.right === centreTopId('right')) {
            adjudicateSlap('ai');
        }
        return;
    }
    if (msg.type === 'SLAP_UPDATE') { if (acceptAuthoritativeRevision(msg)) applySlapUpdate(msg); return; }
    if (msg.type === 'PENALTY_UPDATE') { if (acceptAuthoritativeRevision(msg)) applyPenaltyUpdate(msg); return; }
    if (msg.type === 'ROUND_OVER') { if (acceptAuthoritativeRevision(msg)) applyRoundOver(msg); return; }
    if (msg.type === 'MATCH_OVER') { if (acceptAuthoritativeRevision(msg)) applyMatchOver(msg); return; }

    if (msg.type === 'CONCESSION_REQ') {
        if (gameState.isHost) adjudicateConcession('ai');
        return;
    }

    // --- DISCONNECT HANDLER ---
    if (msg.type === 'OPPONENT_LEFT') {
        if (gameState.matchEnded) return;
        gameState.opponentDisconnected = true;

        document.getElementById('concession-waiting-overlay')?.classList.add('hidden');
        document.getElementById('rematch-modal')?.classList.add('hidden');

        // A dropped peer is not proof of a win.  Never manufacture a result
        // from a timeout: a competition can use its separate absence policy,
        // while a normal peer match stays unrecorded.
        gameState.gameActive = false;
        const modal = document.getElementById('game-message');
        if (modal) {
            modal.querySelector('h1').innerText = "CONNECTION LOST";
            modal.querySelector('h1').style.color = "#fff";
            modal.querySelector('p').innerHTML = gameState.competitionId
                ? `The match result is unresolved. Return to the competition and use its absence process if your opponent does not return.<div style="margin-top:20px;"><button class="btn-action-small" onclick="exitEmbeddedMatch()" style="background:#444; width:auto;">RETURN TO COMPETITION</button></div>`
                : `The match result is unresolved. No ranking, statistics or match history have been changed.<div style="margin-top:20px;"><button class="btn-action-small" onclick="window.location.href='index.html'" style="background:#444; width:auto;">MAIN MENU</button></div>`;
            modal.classList.remove('hidden');
        }
        return;
    }

    if (msg.type === 'REMATCH_REQ') {
        document.getElementById('rematch-modal').classList.remove('hidden');
        return;
    }
   if (msg.type === 'REMATCH_YES') {
        document.getElementById('game-message').classList.add('hidden');
        
        // --- 1. RESET SCORE VARIABLES ---
        gameState.p1Rounds = 0; gameState.aiRounds = 0;
        gameState.p1Slaps = 0; gameState.aiSlaps = 0;
        gameState.playerTotal = 26; gameState.aiTotal = 26;
        
        // --- 2. RESET MATCH FLAGS (CRITICAL) ---
        gameState.matchEnded = false;
        gameState.phase = null;
        gameState.matchLive = false;         // Reset "Safe Start" flag
        gameState.opponentDisconnected = false;
        matchResultReported = false; onlineHistoryId = null; // <--- THE FIX: Allow new ELO report
        gameState.matchStartTime = null;     // Reset Timer start
        stopVisualTimer();                   // Stop old timer
        startVisualTimer();                  // Start new timer logic

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
    if (e.code !== 'Space' || e.repeat || e.defaultPrevented || gameState.connectionSuspended) return;
    e.preventDefault();
    if (!gameState.gameActive) return;
    if (gameState.isHost) adjudicateSlap('player');
    else sendNet({ type: 'SLAP_REQ', left: centreTopId('right'), right: centreTopId('left') });
}

function centreTopId(side) {
    const top = (side === 'left' ? gameState.centerPileLeft : gameState.centerPileRight).at(-1);
    return top ? networkCardId(top) : null;
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
    gameState.slapActive = SlapsEngine.isSlapAvailable(gameState.centerPileLeft, gameState.centerPileRight);
}

/* ================================
   HOST AUTHORITATIVE SLAP & PENALTY LOGIC
   ================================ */

function adjudicateSlap(who) {
    if (!gameState.gameActive || gameState.connectionSuspended) return;
    if (SlapsEngine.isSlapAvailable(gameState.centerPileLeft, gameState.centerPileRight)) resolveSlap(who);
    else issuePenaltyHostAuth(who);
}

function resolveSlap(winner) {
    const result = SlapsEngine.takeSlap(gameState, winner);
    if (!result?.ok) return;
    const update = sendAuthoritative('SLAP_UPDATE', {
        winner,
        playerSlapCards: gameState.playerSlapCards,
        aiSlapCards: gameState.aiSlapCards,
        pTotal: gameState.playerTotal,
        aTotal: gameState.aiTotal,
        p1Slaps: gameState.p1Slaps,
        aiSlaps: gameState.aiSlaps,
        revealRevision: gameState.revealRevision
    });
    applySlapUpdate(update);
}

function issuePenaltyHostAuth(who) {
    const result = SlapsEngine.recordMisslap(gameState, who);
    if (!result.ok) return;
    const prefix = who === 'player' ? 'player' : 'ai';
    const payload = sendAuthoritative('PENALTY_UPDATE', {
        target: who,
        yellows: gameState[`${prefix}Yellows`] || 0,
        reds: gameState[`${prefix}Reds`] || 0,
        severity: result.severity
    });
    applyPenaltyUpdate(payload);
}

function applySlapUpdate(data) {
    const localWinner = gameState.isHost ? data.winner : data.winner === 'player' ? 'ai' : 'player';
    if (!gameState.isHost) {
        const hold = localWinner === 'player' ? gameState.aiHolding : gameState.playerHolding;
        hold.push(...gameState.centerPileLeft, ...gameState.centerPileRight);
    }
    gameState.playerSlapCards = (gameState.isHost ? data.playerSlapCards : data.aiSlapCards) || 0;
    gameState.aiSlapCards = (gameState.isHost ? data.aiSlapCards : data.playerSlapCards) || 0;
    gameState.playerTotal = gameState.isHost ? data.pTotal : data.aTotal;
    gameState.aiTotal = gameState.isHost ? data.aTotal : data.pTotal;
    gameState.p1Slaps = (gameState.isHost ? data.p1Slaps : data.aiSlaps) || 0;
    gameState.aiSlaps = (gameState.isHost ? data.aiSlaps : data.p1Slaps) || 0;
    gameState.revealRevision = data.revealRevision;
    gameState.phase = 'awaiting_reveal';
    gameState.gameActive = false;
    resetReady();
    resetCenterPiles();
    SlapsDrag.recheck?.();
    for (const card of gameState.aiHand) if (card.element) card.element.style.opacity = '1';
    document.dispatchEvent(new Event('slap-piles-changed'));
    updateScoreboard();
    updateScoreboardWidget();

    const overlay = document.getElementById('slap-overlay');
    const text = document.getElementById('slap-text');
    if (!overlay || !text) return;
    const won = localWinner === 'player';
    text.innerText = won ? 'YOU WON THE SLAP!' : `${gameState.opponentName.toUpperCase()} WON THE SLAP!`;
    overlay.style.backgroundColor = won ? 'rgba(0, 200, 0, .9)' : 'rgba(200, 0, 0, .9)';
    overlay.classList.remove('hidden');
    const epoch = gameState.roundEpoch;
    setTimeout(() => {
        if (epoch === gameState.roundEpoch) overlay.classList.add('hidden');
    }, 850);
}

function applyPenaltyUpdate(data) {
    const localTarget = gameState.isHost ? data.target : data.target === 'player' ? 'ai' : 'player';
    gameState[`${localTarget}Yellows`] = data.yellows;
    gameState[`${localTarget}Reds`] = data.reds;
    renderBadges(localTarget, data.yellows, data.reds);
    if (localTarget === 'player') {
        const message = {yellow: 'Misslap. Yellow Card.', red: 'Misslap. Red Card.'}[data.severity];
        SlapsFeedback?.show(message || 'Misslap. The centre ranks differ.');
    }
}

function resetRoundPresentation() {
    ++gameState.roundEpoch;
    SlapsDrag.cancel?.();
    clearInterval(gameState.countdownTimer);
    gameState.countdownTimer = null;
    clearAllPendingActions();
    gameState.syncRequested = false;
    gameState.gameActive = false;
    gameState.countdownRunning = false;
    gameState.drawLock = false;
    gameState.slapActive = false;
    resetReady();
    for (const id of ['countdown-overlay', 'slap-overlay']) document.getElementById(id)?.classList.add('hidden');
}

function measuredFoundationBounds() {
    const bounds = SlapsDrag.measure?.(document.getElementById('player-foundation-area'));
    return SlapsEngine.isValidFoundationBounds(bounds) ? bounds : null;
}

function startRoundHostAuthoritative() {
    if (!gameState.phase) SlapsEngine.initializeMatch(gameState);
    if (gameState.phase !== 'round_over') return;
    resetRoundPresentation();
    const playerBounds = measuredFoundationBounds();
    SlapsEngine.startRound(gameState, undefined, {
        player: playerBounds || SlapsEngine.getFoundationBounds(gameState, 'player'),
        ai: gameState.peerFoundationBounds || SlapsEngine.getFoundationBounds(gameState, 'ai')
    });
    gameState.matchEnded = false;
    gameState.matchLive = true;
    gameState.lastRoundWinner = null;
    const cards = [...gameState.playerHand, ...gameState.aiHand, ...gameState.playerDeck, ...gameState.aiDeck];
    // A revealed card keeps its engine identity through the match. A new
    // round gets fresh peer identifiers so its re-deal is hidden again.
    assignNetworkIds(cards);
    renderImportedState();
    startVisualTimer();
    sendAuthoritative('ROUND_START', { state: buildGuestState() });
}

function startRoundJoinerFromState(state) {
    resetRoundPresentation();
    importState(state);
    gameState.matchEnded = false;
    renderImportedState();
    startVisualTimer();
}

function buildGuestState() {
    return {
        playerTotal: gameState.aiTotal,
        aiTotal: gameState.playerTotal,
        playerDeck: gameState.aiDeck.map(packHiddenCard),
        aiDeck: gameState.playerDeck.map(packHiddenCard),
        playerHand: gameState.aiHand.map(packOpponentCard),
        aiHand: gameState.playerHand.map(packOpponentCard),
        centerPileLeft: gameState.centerPileRight.map(packCard),
        centerPileRight: gameState.centerPileLeft.map(packCard),
        playerHolding: gameState.aiHolding.map(packHiddenCard),
        aiHolding: gameState.playerHolding.map(packHiddenCard),
        playerRoundCards: gameState.aiRoundCards.map(packHiddenCard),
        aiRoundCards: gameState.playerRoundCards.map(packHiddenCard),
        borrowedPlayer: gameState.borrowedAi,
        borrowedAi: gameState.borrowedPlayer,
        phase: gameState.phase,
        revealRevision: gameState.revealRevision,
        foundationBounds: {
            player: SlapsEngine.getFoundationBounds(gameState, 'ai'),
            ai: SlapsEngine.getFoundationBounds(gameState, 'player')
        },
        lastRoundWinner: gameState.lastRoundWinner,
        matchWinner: gameState.matchWinner ?? null,
        gameActive: gameState.gameActive,
        matchLive: gameState.matchLive,
        matchEnded: gameState.matchEnded,
        playerReady: gameState.aiReady,
        aiReady: gameState.playerReady,
        drawLock: gameState.drawLock,
        countdownRunning: gameState.countdownRunning,
        playerYellows: gameState.aiYellows,
        playerReds: gameState.aiReds,
        aiYellows: gameState.playerYellows,
        aiReds: gameState.playerReds,
        p1Rounds: gameState.aiRounds,
        aiRounds: gameState.p1Rounds,
        p1Slaps: gameState.aiSlaps,
        aiSlaps: gameState.p1Slaps
    };
}

function sendStateSnapshot(reason = 'requested') {
    if (!gameState.isHost) return;
    sendAuthoritative('SYNC', { state: buildGuestState(), reason });
}

function applyStateSnapshot(state) {
    if (!state || typeof state !== 'object') return;
    if (state.phase === 'match_over' && state.matchWinner) {
        applyMatchOver({ winner: state.matchWinner, state });
        return;
    }
    if (state.phase === 'round_over' && state.lastRoundWinner) {
        applyRoundOver({ winner: state.lastRoundWinner, state });
        return;
    }
    resetRoundPresentation();
    importState(state);
    renderImportedState();
    SlapsFeedback?.show('Match state refreshed.', 'info');
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

function networkCardId(card) {
    return card.networkId || card.id;
}

function assignNetworkIds(cards) {
    for (const card of cards) card.networkId = `card-${++gameState.networkCardSequence}`;
}

function packCard(c) {
    return { suit: c.suit, rank: c.rank, value: c.value, id: networkCardId(c) };
}

function packCardWithMeta(c) {
    return {
        ...packCard(c),
        ...packFoundationMeta(c)
    };
}

function packHiddenCard(c) {
    return { id: networkCardId(c), isFaceUp: false, owner: c.owner ?? null };
}

function packOpponentCard(c) {
    return c.isFaceUp ? packCardWithMeta(c) : { ...packHiddenCard(c), ...packFoundationMeta(c) };
}

function packFoundationMeta(card) {
    const meta = { isFaceUp: !!card.isFaceUp, owner: card.owner ?? null };
    if (card.foundation) meta.foundation = { ...card.foundation };
    return meta;
}

function hydrateCard(card, source) {
    if (!card || !source) return card;
    for (const key of ['suit', 'rank', 'value']) {
        if (source[key] !== undefined && source[key] !== null) card[key] = source[key];
    }
    if (card.suit && card.rank) card.imgSrc = `assets/cards/${card.rank}_of_${card.suit}.png`;
    return card;
}

function unpackCard(obj) {
    const c = new Card(obj.suit, obj.rank, obj.value, obj.id);
    c.isFaceUp = !!obj.isFaceUp;
    c.owner = obj.owner ?? null;
    if (obj.foundation) c.foundation = { ...obj.foundation };
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
    for (const zone of ['playerHolding', 'aiHolding', 'playerRoundCards', 'aiRoundCards']) gameState[zone] = (s[zone] || []).map(unpackCard);
    gameState.playerSlapCards = gameState.playerHolding.length;
    gameState.aiSlapCards = gameState.aiHolding.length;
    for (const key of ['phase', 'revealRevision', 'foundationBounds', 'gameActive', 'matchLive', 'matchEnded', 'playerReady', 'aiReady', 'drawLock', 'countdownRunning', 'borrowedPlayer', 'borrowedAi', 'playerYellows', 'playerReds', 'aiYellows', 'aiReds', 'p1Rounds', 'aiRounds', 'p1Slaps', 'aiSlaps']) {
        if (Object.prototype.hasOwnProperty.call(s, key)) gameState[key] = s[key];
    }
}

function renderImportedState() {
    const leftPile = [...gameState.centerPileLeft];
    const rightPile = [...gameState.centerPileRight];
    renderFoundation('player', true);
    renderFoundation('ai', true);
    resetCenterPiles();
    gameState.centerPileLeft = leftPile;
    gameState.centerPileRight = rightPile;
    leftPile.forEach(card => renderCenterPile('left', card));
    rightPile.forEach(card => renderCenterPile('right', card));
    const bp = document.getElementById('borrowed-player');
    const ba = document.getElementById('borrowed-ai');
    if (bp) gameState.borrowedPlayer ? bp.classList.remove('hidden') : bp.classList.add('hidden');
    if (ba) gameState.borrowedAi ? ba.classList.remove('hidden') : ba.classList.add('hidden');
    if (gameState.playerReady) document.getElementById('player-draw-deck')?.classList.add('deck-ready');
    if (gameState.aiReady) document.getElementById('ai-draw-deck')?.classList.add('deck-ready');
    updatePenaltyUI();
    checkDeckVisibility();
    document.dispatchEvent(new Event('slap-piles-changed'));
    updateScoreboard();
    updateScoreboardWidget();
    if (gameState.gameActive) checkSlapCondition();
}

/* ================================
   DEAL / RENDER HAND
   ================================ */

function renderFoundation(owner, rebuild = false, animateCard = null) {
    const container = document.getElementById(`${owner}-foundation-area`);
    if (!container) return;
    const hand = foundationHand(owner);
    if (rebuild) {
        container.innerHTML = '';
        for (const card of hand) {
            const img = document.createElement('img');
            img.className = 'game-card';
            img.draggable = false;
            img.dataset.cardId = networkCardId(card);
            card.element = img;
            container.appendChild(img);
            if (card.isFaceUp) setCardFaceUp(img, card, owner);
            else setCardFaceDown(img, card, owner);
        }
    }
    SlapsDrag.render(container, hand, card => SlapsEngine.getFoundationPosition(hand, card), {
        bounds: SlapsEngine.getFoundationBounds(gameState, owner),
        mirrored: owner === 'ai', animateCard
    });
    refreshFoundationAvailability(owner);
}

function foundationHand(owner) {
    return owner === 'player' ? gameState.playerHand : gameState.aiHand;
}

function refreshFoundationAvailability(owner) {
    const hand = foundationHand(owner);
    for (const card of hand) {
        if (!card.element) continue;
        const { accessible, exposed } = SlapsEngine.getFoundationExposure(hand, card);
        card.element.dataset.covered = String(!exposed);
        card.element.dataset.accessible = String(accessible);
        card.element.dataset.exposed = String(exposed);
        card.element.setAttribute('aria-hidden', String(!accessible));
        card.element.tabIndex = owner === 'player' && accessible ? 0 : -1;
    }
}

function setCardFaceUp(img, card, owner) {
    img.setAttribute('aria-label', card.rank + ' of ' + card.suit);
    const previousFace = img.src;
    img.src = card.imgSrc;
    img.classList.remove('card-face-down');
    card.isFaceUp = true;
    card.flipping = false;
    if (owner === 'player') {
        img.classList.add('player-card');
        img.onclick = null;
        makeDraggable(img, card);
    } else img.classList.add('opponent-card');
    GameVisuals.flip(img, previousFace);
}

function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    img.setAttribute('aria-label', 'Face-down Foundation card');
    card.isFaceUp = false;
    if (owner === 'player') makeDraggable(img, card);
}

function tryFlipCard(img, card) {
    if (!gameState.gameActive || gameState.connectionSuspended) return false;
    if (!card || card.isFaceUp || card.flipping || card.flipPending || !gameState.playerHand.includes(card)) return false;

    if (gameState.isHost) {
        return adjudicateFlip({ cardId: networkCardId(card), reqId: nextActionId('flip') }, 'player');
    }

    const reqId = nextActionId('flip');
    beginPendingAction('flip', card, reqId);
    sendNet({ type: 'FLIP_REQ', flip: { cardId: card.id, reqId } });
    return true;
}

function adjudicateFlip(flip, moverOverride) {
    if (!gameState.isHost || gameState.connectionSuspended || !flip || !flip.cardId) return false;
    const mover = moverOverride || 'player';
    const reqId = flip.reqId || nextActionId('flip');
    const hand = mover === 'player' ? gameState.playerHand : gameState.aiHand;
    const card = hand.find(c => networkCardId(c) === flip.cardId);
    const decision = SlapsEngine.flipFoundation(gameState, mover, card);

    if (!decision.ok) {
        const reason = decision.reason || 'not_playable';
        if (mover === 'ai') sendAuthoritative('FLIP_REJECT', { flip: { cardId: flip.cardId, reqId, reason } });
        else SlapsFeedback?.show(SlapsFeedback.flipReason(reason));
        return false;
    }

    if (card.element) setCardFaceUp(card.element, card, mover);
    else card.isFaceUp = true;

    resetReady();
    refreshFoundationAvailability(mover);
    sendAuthoritative('FLIP_APPLY', { flip: { cardId: networkCardId(card), reqId, mover, card: packCardWithMeta(card) } });
    return true;
}

function applyFlipFromHost(flip) {
    if (!flip || !flip.cardId) return;
    const localMover = flip.mover === 'player' ? 'ai' : 'player';
    const hand = localMover === 'player' ? gameState.playerHand : gameState.aiHand;
    const card = hand.find(c => c.id === flip.cardId);
    if (!card) { requestAuthoritativeSync('missing_flip_card'); return; }

    if (localMover === 'player') settlePendingAction(card, 'flip', flip.reqId);
    hydrateCard(card, flip.card);
    if (!card.isFaceUp) {
        if (card.element) setCardFaceUp(card.element, card, localMover);
        else card.isFaceUp = true;
    }
    resetReady();
    refreshFoundationAvailability(localMover);
}

function rejectFlipFromHost(flip) {
    if (!flip || !flip.cardId) return;
    const card = gameState.playerHand.find(c => c.id === flip.cardId);
    if (card) settlePendingAction(card, 'flip', flip.reqId);
    SlapsFeedback?.show(SlapsFeedback.flipReason(flip.reason || 'not_playable'));
}

function canArrangeFoundation() {
    return gameState.matchLive && !gameState.connectionSuspended && !gameState.opponentDisconnected &&
        (gameState.phase === 'active' || gameState.phase === 'awaiting_reveal');
}

function requestLayout(card, { x, y }) {
    if (!canArrangeFoundation() || card.pendingMove || card.flipPending) return false;
    const reqId = nextActionId('layout');
    const layout = { reqId, cardId: networkCardId(card), x, y };
    if (gameState.isHost) return adjudicateLayout(layout, 'player');

    // The guest's own placement is visible immediately. A later flip can then
    // follow this move on the same ordered connection without an extra wait.
    const result = SlapsEngine.moveFoundation(gameState, 'player', card, layout);
    if (!result.ok) return false;
    beginPendingAction('layout', card, reqId);
    renderFoundation('player');
    sendNet({ type: 'LAYOUT_REQ', layout });
    return true;
}

function adjudicateLayout(layout, mover) {
    if (!canArrangeFoundation()) {
        if (mover === 'ai') sendStateSnapshot('foundation_unavailable');
        return false;
    }
    const card = foundationHand(mover).find(entry => networkCardId(entry) === layout.cardId);
    const result = SlapsEngine.moveFoundation(gameState, mover, card, layout);
    if (!result.ok) {
        if (mover === 'ai') sendStateSnapshot('placement_changed');
        return false;
    }
    renderFoundation(mover);
    sendAuthoritative('LAYOUT_APPLY', { layout: {
        reqId: layout.reqId, cardId: layout.cardId, mover, position: result.position
    }});
    return true;
}

function applyLayoutFromHost(layout) {
    const owner = layout.mover === 'player' ? 'ai' : 'player';
    const card = foundationHand(owner).find(entry => networkCardId(entry) === layout.cardId);
    if (!card || !SlapsEngine.isValidFoundationPosition(layout.position, SlapsEngine.getFoundationBounds(gameState, owner))) {
        requestAuthoritativeSync('missing_layout_card');
        return;
    }
    const laterPlacementPending = owner === 'player' && card.layoutPending && card.layoutPending !== layout.reqId;
    if (owner === 'player') settlePendingAction(card, 'layout', layout.reqId);
    if (laterPlacementPending) return;
    card.foundation = { ...layout.position };
    renderFoundation(owner);
}

/* ================================
   DRAG AND DROP LOGIC
   ================================ */

/* ================================
   DRAG AND DROP LOGIC (PC + IPAD SUPPORT)
   ================================ */

function makeDraggable(img, cardData) {
    let previewOrigin;
    SlapsDrag.attach(img, {
        canMove: () => canArrangeFoundation() && !cardData.pendingMove && !cardData.flipPending &&
            SlapsEngine.isFoundationAccessible(gameState.playerHand, cardData),
        canLeave: () => gameState.gameActive && SlapsEngine.canTakeOutside(gameState, 'player', cardData),
        move: position => requestLayout(cardData, position),
        reveal: () => tryFlipCard(img, cardData),
        play: side => requestMoveToHost(cardData, side),
        onDrag: ({ phase, clientX, clientY }) => {
            if (phase === 'start') {
                const foundation = img.parentElement;
                const box = foundation.getBoundingClientRect();
                const card = img.getBoundingClientRect();
                const mat = previewMat(foundation);
                previewOrigin = {
                    x: box.left + (foundation.clientLeft || 0) + mat.left + clientX - (card.left + card.width / 2),
                    y: box.top + (foundation.clientTop || 0) + mat.top + clientY - (card.top + card.height / 2),
                    width: mat.width, height: mat.height
                };
            }
            if (!previewOrigin?.width || !previewOrigin.height) return;
            const normalise = (pos, start, size) => Math.min(3, Math.max(-3, (pos - start) / size));
            sendNet({ type: 'DRAG', drag: {
                id: networkCardId(cardData),
                phase,
                nx: normalise(clientX, previewOrigin.x, previewOrigin.width),
                ny: normalise(clientY, previewOrigin.y, previewOrigin.height)
            }});
            if (phase === 'end') previewOrigin = null;
        }
    });
}

function previewMat(foundation) {
    const value = name => parseFloat(foundation.style.getPropertyValue(`--foundation-mat-${name}`));
    return {
        left: value('left') || 0, top: value('top') || 0,
        width: value('width') || foundation.clientWidth,
        height: value('height') || foundation.clientHeight
    };
}

function applyOpponentDrag(d) {
    if (!d || !Number.isFinite(d.nx) || !Number.isFinite(d.ny)) return;
    const box = document.getElementById('ai-foundation-area');
    if (!box) return;
    const realCard = gameState.aiHand.find(card => networkCardId(card) === d.id);
    let ghost = gameState.opponentDragGhosts.get(d.id);
    if (d.phase === 'end') {
        if (ghost) ghost.remove();
        gameState.opponentDragGhosts.delete(d.id);
        if (realCard?.element) realCard.element.style.opacity = '1';
        return;
    }
    if (!canArrangeFoundation() || !realCard || !SlapsEngine.isFoundationAccessible(gameState.aiHand, realCard)) return;
    if (d.phase === 'start' && !ghost) {
        if (realCard.element) realCard.element.style.opacity = '0';
        ghost = document.createElement('img');
        ghost.className = 'game-card opponent-card';
        ghost.src = realCard.isFaceUp ? realCard.imgSrc : CARD_BACK_SRC;
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.position = 'absolute';
        ghost.style.zIndex = 5000;
        ghost.style.pointerEvents = 'none';
        ghost.style.width = realCard.element?.style.width || '';
        ghost.style.height = realCard.element?.style.height || '';
        box.appendChild(ghost);
        gameState.opponentDragGhosts.set(d.id, ghost);
    }
    if (ghost) {
        const mat = previewMat(box);
        ghost.style.left = `${mat.left + (1 - d.nx) * mat.width - ghost.offsetWidth / 2}px`;
        ghost.style.top = `${mat.top + (1 - d.ny) * mat.height - ghost.offsetHeight / 2}px`;
    }
}

/* ================================
   MOVE REQUEST / HOST ADJUDICATION
   ================================ */

function requestMoveToHost(card, dropSide) {
    if (gameState.connectionSuspended || !gameState.gameActive || !card || card.pendingMove || !['left', 'right'].includes(dropSide)) return false;
    const hostSide = gameState.isHost ? dropSide : dropSide === 'left' ? 'right' : 'left';
    const req = {
        reqId: nextActionId('move'),
        dropSide: hostSide,
        targetId: centreTopId(dropSide),
        card: { id: networkCardId(card) }
    };
    if (gameState.isHost) return adjudicateMove(req, 'player');
    beginPendingAction('move', card, req.reqId);
    sendNet({ type: 'MOVE_REQ', move: req });
    return true;
}

function adjudicateMove(move, mover = 'ai') {
    if (gameState.connectionSuspended || !move?.card || !['left', 'right'].includes(move.dropSide)) return false;
    const hand = mover === 'player' ? gameState.playerHand : gameState.aiHand;
    const card = hand.find(candidate => networkCardId(candidate) === move.card.id);
    const side = move.dropSide;
    let reason;
    if (!card) reason = 'not_in_hand';
    else if (!gameState.gameActive) reason = 'not_playable';
    else {
        const applied = applyMoveAuthoritative(mover, card, side, move.reqId);
        if (applied.result) {
            sendAuthoritative('MOVE_APPLY', { apply: applied.payload });
            if (applied.result.finishedRound) finishRound(mover, applied.result.matchWinner);
            return true;
        }
        reason = applied.reason === 'not_playable' && move.targetId !== centreTopId(side) ? 'race_lost' : applied.reason;
    }
    const reject = { reqId: move.reqId, cardId: move.card.id, reason };
    if (mover === 'ai') sendAuthoritative('MOVE_REJECT', { reject });
    else rejectMoveFromHost(reject);
    return false;
}

function applyMoveAuthoritative(mover, card, side, reqId) {
    const result = SlapsEngine.playFoundation(gameState, mover, card, side);
    if (!result.ok) return { reason: result.reason };
    cleanupGhost(card);
    card.element?.remove();
    card.element = null;
    renderCenterPile(side, card);
    resetReady();
    refreshFoundationAvailability(mover);
    SlapsDrag.recheck?.();
    updateScoreboard();
    gameState.slapActive = !result.finishedRound && result.slapAvailable;
    if (result.finishedRound) gameState.gameActive = false;
    return { result, payload: {
        reqId, mover, side, card: packCardWithMeta(card), finishedRound: result.finishedRound,
        playerTotal: gameState.playerTotal, aiTotal: gameState.aiTotal
    }};
}

function applyMoveFromHost(move) {
    const localMover = move.mover === 'player' ? 'ai' : 'player';
    const side = move.side === 'left' ? 'right' : 'left';
    const hand = localMover === 'player' ? gameState.playerHand : gameState.aiHand;
    const index = hand.findIndex(card => card.id === move.card.id);
    if (index < 0) { requestAuthoritativeSync('missing_played_card'); return; }
    const [card] = hand.splice(index, 1);
    hydrateCard(card, move.card);
    cleanupGhost(card);
    if (localMover === 'player') settlePendingAction(card, 'move', move.reqId);
    card.element?.remove();
    card.element = null;
    const pile = side === 'left' ? gameState.centerPileLeft : gameState.centerPileRight;
    pile.push(card);
    renderCenterPile(side, card);
    gameState.playerTotal = move.aiTotal;
    gameState.aiTotal = move.playerTotal;
    resetReady();
    refreshFoundationAvailability(localMover);
    SlapsDrag.recheck?.();
    updateScoreboard();
    if (move.finishedRound) {
        gameState.gameActive = false;
        gameState.slapActive = false;
    } else checkSlapCondition();
}

function resetReady() {
    gameState.playerReady = false;
    gameState.aiReady = false;
    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');
}

function canInitiateReveal() {
    return gameState.matchLive && !gameState.matchEnded && !gameState.opponentDisconnected &&
        !gameState.connectionSuspended && !gameState.drawLock && !gameState.countdownRunning;
}

function canReadyForReveal() {
    return canInitiateReveal() && gameState.phase === 'awaiting_reveal';
}

function handlePlayerDeckClick() {
    if (!canInitiateReveal()) return;
    const basis = gameState.revealRevision;
    if (gameState.gameActive && gameState.phase === 'active') {
        if (gameState.isHost) adjudicateDrawRequest(basis);
        else sendNet({ type: 'DRAW_REQ', basis });
        return;
    }
    if (gameState.phase !== 'awaiting_reveal' || gameState.playerReady) return;
    gameState.playerReady = true;
    document.getElementById('player-draw-deck')?.classList.add('deck-ready');
    sendNet({ type: 'READY', basis });
    checkDrawConditionMultiplayer();
}

function adjudicateDrawRequest(basis) {
    if (!canInitiateReveal() || !gameState.gameActive || gameState.phase !== 'active') return false;
    return performRevealHostOnly({ force: true, expectedReveal: basis });
}

function checkDrawConditionMultiplayer() {
    if (!gameState.isHost || !canReadyForReveal() || !gameState.playerReady || !gameState.aiReady) return;
    sendNet({ type: 'HOST_COUNTDOWN', basis: gameState.revealRevision });
    startCountdownFromHost();
}

function startCountdownFromHost() {
    if (gameState.countdownRunning) return;
    const epoch = gameState.roundEpoch;
    gameState.countdownRunning = true;
    gameState.drawLock = true;
    gameState.gameActive = false;
    const overlay = document.getElementById('countdown-overlay');
    overlay?.classList.remove('hidden');
    let count = 3;
    if (overlay) overlay.innerText = count;
    gameState.countdownTimer = setInterval(() => {
        if (epoch !== gameState.roundEpoch) return;
        if (--count > 0) { if (overlay) overlay.innerText = count; return; }
        clearInterval(gameState.countdownTimer);
        gameState.countdownTimer = null;
        overlay?.classList.add('hidden');
        if (gameState.isHost) performRevealHostOnly();
    }, 800);
}

function performRevealHostOnly(options = {}) {
    const result = SlapsEngine.revealDraw(gameState, options);
    if (!result.ok && options.force) return false;
    if (!result.ok || result.redealt) {
        gameState.countdownRunning = false;
        gameState.drawLock = false;
        resetReady();
        if (result.matchWinner) finishRound(result.matchWinner, result.matchWinner);
        else if (result.redealt) startRoundHostAuthoritative();
        else {
            gameState.gameActive = gameState.phase === 'active';
            sendStateSnapshot('restart_no_longer_available');
        }
        return result.ok;
    }
    if (result.recycled) {
        assignNetworkIds([...gameState.playerDeck, ...gameState.aiDeck, ...Object.values(result.cards).filter(Boolean)]);
        clearCentreDisplay();
    }
    if (result.cards.player) renderCenterPile('right', result.cards.player, true);
    if (result.cards.ai) renderCenterPile('left', result.cards.ai, true);
    applyRevealShow();
    updateBorrowedDisplay();
    checkDeckVisibility();
    updateScoreboard();
    sendAuthoritative('REVEAL_SHOW', { result: {
        resetCentre: result.recycled === true,
        playerDeck: gameState.aiDeck.map(packHiddenCard),
        aiDeck: gameState.playerDeck.map(packHiddenCard),
        left: result.cards.player ? packCard(result.cards.player) : null,
        right: result.cards.ai ? packCard(result.cards.ai) : null,
        playerTotal: gameState.aiTotal,
        aiTotal: gameState.playerTotal,
        borrowedPlayer: gameState.borrowedAi,
        borrowedAi: gameState.borrowedPlayer,
        revealRevision: gameState.revealRevision
    }});
    return true;
}

function clearCentreDisplay() {
    for (const id of ['center-pile-left', 'center-pile-right']) {
        const pile = document.getElementById(id);
        if (pile) pile.innerHTML = '';
    }
}

function updateBorrowedDisplay() {
    document.getElementById('borrowed-player')?.classList.toggle('hidden', !gameState.borrowedPlayer);
    document.getElementById('borrowed-ai')?.classList.toggle('hidden', !gameState.borrowedAi);
}

function applyRevealFromHost(result) {
    if (result.resetCentre) {
        gameState.centerPileLeft = [];
        gameState.centerPileRight = [];
        clearCentreDisplay();
    }
    gameState.playerDeck = result.playerDeck.map(unpackCard);
    gameState.aiDeck = result.aiDeck.map(unpackCard);
    gameState.playerTotal = result.playerTotal;
    gameState.aiTotal = result.aiTotal;
    gameState.borrowedPlayer = result.borrowedPlayer;
    gameState.borrowedAi = result.borrowedAi;
    gameState.revealRevision = result.revealRevision;
    for (const [side, pile] of [['left', gameState.centerPileLeft], ['right', gameState.centerPileRight]]) {
        if (!result[side]) continue;
        const card = unpackCard(result[side]);
        pile.push(card);
        renderCenterPile(side, card, true);
    }
    updateBorrowedDisplay();
    checkDeckVisibility();
    updateScoreboard();
    applyRevealShow();
}

function renderCenterPile(side, card, hidden = false) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    if (!container) return;

    const img = document.createElement('img');
    const previousFace = img.src;
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

function updateScoreboard() {
    const sp = document.getElementById('score-player');
    const sa = document.getElementById('score-ai');
    if (sp) sp.innerText = gameState.playerTotal;
    if (sa) sa.innerText = gameState.aiTotal;
}

function checkDeckVisibility() {
    for (const seat of ['player', 'ai']) {
        const deck = document.getElementById(`${seat}-draw-deck`);
        if (!deck) continue;
        deck.classList.remove('hidden');
        deck.classList.toggle('draw-empty', gameState[`${seat}Deck`].length === 0);
    }
}

function updateScoreboardWidget() {
    const p1Name = document.getElementById('sb-p1-name');
    if (p1Name) p1Name.innerText = guestAtMatchStart ? "YOU (GUEST)" : "YOU";

    const p2Name = document.getElementById('sb-p2-name'); 
    const oppLabel = document.getElementById('opponent-display-name'); 

    const displayName = opponentIsGuest ? `${gameState.opponentName} (GUEST)` : `${gameState.opponentName} (${enemyElo})`;

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
        ${!isRanked ? "<span>Unranked match — no ELO, match history or statistics saved for either player.</span>" : ""}
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
/* ================================
   ROUND & MATCH END LOGIC
   ================================ */

function finishRound(winner, matchWinner) {
    gameState.lastRoundWinner = winner;
    const fields = {
        winner,
        state: buildGuestState()
    };
    if (matchWinner) applyMatchOver(sendAuthoritative('MATCH_OVER', { ...fields, winner: matchWinner }));
    else applyRoundOver(sendAuthoritative('ROUND_OVER', fields));
}

function applyRoundOver(data) {
    resetRoundPresentation();
    if (!gameState.isHost && data.state) importState(data.state);
    renderImportedState();
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
    resetRoundPresentation();
    if (!gameState.isHost && data.state) importState(data.state);
    if (data.state) renderImportedState();
    gameState.matchEnded = true; 
    stopVisualTimer();

    document.getElementById('concession-waiting-overlay')?.classList.add('hidden');

    const iAmHost = gameState.isHost;
    const hostWon = (data.winner === 'player');
    const iWon = (iAmHost && hostWon) || (!iAmHost && !hostWon);

    const title = iWon ? "YOU WON THE MATCH!" : "OPPONENT WINS THE MATCH!";
    showEndGame(title, iWon);
    notifyEmbeddedMatchResult(iWon);

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
function adjudicateConcession(loser) {
    if (gameState.matchEnded || !gameState.matchLive || !gameState.phase) return;
    const result = SlapsEngine.concedeMatch(gameState, loser);
    if (!result?.ok) return;
    gameState.gameActive = false;
    finishRound(result.winner, result.winner);
}

function quitMatch() {
    if (gameState.matchEnded || !gameState.conn?.open) { exitEmbeddedMatch(); return; }
    if (!gameState.phase || !gameState.matchLive) { exitEmbeddedMatch(); return; }
    if (gameState.isHost) adjudicateConcession('player');
    else {
        gameState.gameActive = false;
        const overlay = document.getElementById('concession-waiting-overlay');
        overlay?.classList.remove('hidden');
        sendNet({ type: 'CONCESSION_REQ' });
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
    
    // --- 1. RESET SCORE VARIABLES ---
    gameState.p1Rounds = 0; gameState.aiRounds = 0;
    gameState.p1Slaps = 0; gameState.aiSlaps = 0;
    gameState.playerTotal = 26; 
    gameState.aiTotal = 26;
    
    // --- 2. RESET MATCH FLAGS (CRITICAL) ---
    gameState.matchEnded = false;
    gameState.phase = null;
    gameState.matchLive = false;         // Reset "Safe Start" flag
    gameState.opponentDisconnected = false;
    matchResultReported = false; onlineHistoryId = null; // <--- THE FIX: Allow new ELO report
    gameState.matchStartTime = null;     // Reset Timer start
    stopVisualTimer();                   // Stop old timer
    
    // Hide Game Over screen
    const modal = document.getElementById('game-message');
    if(modal) modal.classList.add('hidden');
    
    updateScoreboardWidget();

    // If I am Host, I must start the mechanics
    if (gameState.isHost) {
        startRoundHostAuthoritative();
    } else {
        // If I am Joiner, I wait for the Host's ROUND_START message
        // But I should start my visual timer now so it's ready
        startVisualTimer();
    }
}
function declineRematch() {
    sendNet({ type: 'REMATCH_NO' });
    window.location.href = 'index.html';
}
function applyRevealShow() {
    clearInterval(gameState.countdownTimer);
    gameState.countdownTimer = null;
    for (const img of document.querySelectorAll('.pending-reveal')) {
        img.style.opacity = '1';
        img.classList.remove('pending-reveal');
        GameVisuals.flip(img, CARD_BACK_SRC);
    }
    gameState.phase = 'active';
    gameState.gameActive = true;
    gameState.countdownRunning = false;
    gameState.drawLock = false;
    gameState.playerReady = false;
    gameState.aiReady = false;
    for (const id of ['player-draw-deck', 'ai-draw-deck']) document.getElementById(id)?.classList.remove('deck-ready');
    document.getElementById('countdown-overlay')?.classList.add?.('hidden');
    SlapsDrag.recheck?.();
    checkSlapCondition();
}

function rejectMoveFromHost(reject) {
    const card = gameState.playerHand.find(c => networkCardId(c) === reject.cardId);
    settlePendingAction(card, 'move', reject.reqId);
    const message = {
        race_lost: 'That centre pile changed first. Your card has been returned.',
        invalid_math: 'That card does not fit on that pile.',
        not_adjacent: 'That card does not fit on that pile.',
        not_playable: 'That card cannot be played on that pile.',
        not_in_hand: 'That card is no longer available.'
    }[reject.reason] || 'That move was not accepted.';
    SlapsFeedback?.show(message);
}

function cleanupGhost(cardData) {
    const id = networkCardId(cardData);
    gameState.opponentDragGhosts.get(id)?.remove();
    gameState.opponentDragGhosts.delete(id);
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
