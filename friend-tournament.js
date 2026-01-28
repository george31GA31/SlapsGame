/* =========================================
   FRIEND TOURNAMENT LOGIC
   - Renders the Bracket
   - Re-establishes Connection (Host/Guest)
   - Syncs Wins to all players
   ========================================= */

const state = {
    players: [],
    myName: '',
    myId: '',     // My Peer ID
    hostId: '',   // The Tournament Host's Peer ID
    isHost: false,
    peer: null,
    conn: null,       // Guest's connection to Host
    connections: [],  // Host's list of connected Guests
};

// --- 1. INITIALIZATION ---
window.onload = function() {
    // Load Data passed from the Setup Page
    const pData = localStorage.getItem('isf_bracket_players');
    state.myName = localStorage.getItem('isf_my_name');
    state.isHost = (localStorage.getItem('isf_is_host') === 'true');
    
    // We need the original Lobby Code to reconnect (e.g. ISF-1234)
    // The Setup page saved the full list. We can find the Host's ID from that list.
    if (!pData || !state.myName) {
        alert("Missing tournament data. Returning to menu.");
        window.location.href = 'tournament-setup.html';
        return;
    }

    state.players = JSON.parse(pData);
    
    // Find the Host ID from the player list
    const hostPlayer = state.players.find(p => p.isHost);
    if (hostPlayer) state.hostId = hostPlayer.id;

    // Draw the Visuals
    renderInitialBracket();

    // Start the Network Mesh (Crucial for Bracket Updates)
    initBracketNetworking();
};

// --- 2. NETWORKING (RE-CONNECT) ---
function initBracketNetworking() {
    // If I am Host, I try to reclaim the SAME ID (ISF-XXXX) so guests can find me.
    // If I am Guest, I get a random ID and connect to ISF-XXXX.
    
    const peerOptions = state.isHost ? state.hostId : undefined;
    state.peer = new Peer(peerOptions);

    state.peer.on('open', (id) => {
        state.myId = id;
        console.log("Bracket Network Active. ID:", id);

        if (!state.isHost) {
            // GUEST: Connect to Host immediately
            connectToHost();
        }
    });

    // HOST LOGIC: Listen for connections & results
    if (state.isHost) {
        state.peer.on('connection', (conn) => {
            state.connections.push(conn);
            
            conn.on('data', (data) => {
                if (data.type === 'MATCH_WIN') {
                    // A guest won their match!
                    handleWin(data.winnerName, data.nextBoxId);
                    // Broadcast this news to everyone else
                    broadcastUpdate(data.winnerName, data.nextBoxId);
                }
            });
        });
        
        state.peer.on('error', (err) => {
            console.log("Host ID might be taken (refresh issue).", err);
        });
    }
}

// GUEST LOGIC: Connect to Host
function connectToHost() {
    if (!state.hostId) return;
    const conn = state.peer.connect(state.hostId);
    state.conn = conn;

    conn.on('open', () => {
        console.log("Connected to Tournament Host.");
    });

    conn.on('data', (data) => {
        if (data.type === 'BRACKET_UPDATE') {
            // Host told us someone advanced!
            handleWin(data.winnerName, data.nextBoxId);
        }
    });
}

// HOST HELPER: Tell everyone about a change
function broadcastUpdate(winnerName, nextBoxId) {
    state.connections.forEach(c => {
        if (c.open) {
            c.send({ type: 'BRACKET_UPDATE', winnerName, nextBoxId });
        }
    });
}

// --- 3. BRACKET RENDERING ---
function renderInitialBracket() {
    const total = state.players.length;
    
    // Clear all boxes first
    document.querySelectorAll('.match-box').forEach(b => {
        b.innerText = "";
        b.classList.remove('occupied', 'my-match', 'opponent-match');
    });

    // Distribute Players (Same logic as before)
    // 4 Players = Semi Finals (LSF-1 vs LSF-1 ?? No, standard mapping)
    // We map players into the outermost available slots.
    
    if (total <= 4) {
        // Map to Quarter Finals (LQF-1, LQF-2, RQF-1, RQF-2)
        // Note: Your HTML has LQF-1/2 and RQF-1/2.
        if(state.players[0]) assignSlot('LQF-1', state.players[0]);
        if(state.players[1]) assignSlot('LQF-2', state.players[1]);
        if(state.players[2]) assignSlot('RQF-1', state.players[2]);
        if(state.players[3]) assignSlot('RQF-2', state.players[3]);
    } 
    else {
        // 8 Players (Round of 16 slots)
        state.players.forEach((p, i) => {
            // Left Side: 0-3 -> L16-1 to L16-4
            if (i < 4) assignSlot(`L16-${i+1}`, p);
            // Right Side: 4-7 -> R16-1 to R16-4
            else assignSlot(`R16-${(i-4)+1}`, p);
        });
    }
    
    checkMyNextMatch();
}

function assignSlot(boxId, player) {
    const box = document.getElementById(boxId);
    if (box) {
        box.innerText = player.name;
        box.classList.add('occupied');
    }
}

// --- 4. MATCH LOGIC (Who do I play?) ---
function checkMyNextMatch() {
    const myName = state.myName;
    let myBox = null;
    
    // 1. Find my current position (The deepest occupied box with my name)
    // We iterate backwards/deepest first to ensure we get the latest round
    const allBoxes = Array.from(document.querySelectorAll('.match-box.occupied'));
    myBox = allBoxes.find(b => b.innerText === myName); // Simplification

    if (!myBox) {
        // Maybe I lost?
        // setButtonState("ELIMINATED", false, "#555");
        // Actually, if I'm not on board, something is wrong or I haven't started.
        return;
    }

    // 2. Calculate Opponent Box ID
    // Logic: If I am L16-1, Opponent is L16-2.
    // If I am L16-2, Opponent is L16-1.
    const idParts = myBox.id.split('-'); // ["L16", "1"]
    const prefix = idParts[0];           // "L16"
    const num = parseInt(idParts[1]);    // 1
    
    // Opponent Logic: (1vs2), (3vs4), etc.
    const oppNum = (num % 2 !== 0) ? num + 1 : num - 1;
    const oppId = `${prefix}-${oppNum}`;
    const oppBox = document.getElementById(oppId);

    // 3. Status Check
    const btn = document.getElementById('play-btn');
    
    // Clear old highlights
    document.querySelectorAll('.my-match, .opponent-match').forEach(el => 
        el.classList.remove('my-match', 'opponent-match')
    );

    if (oppBox && oppBox.classList.contains('occupied')) {
        // --- OPPONENT FOUND ---
        const oppName = oppBox.innerText;
        
        myBox.classList.add('my-match');
        oppBox.classList.add('opponent-match');

        btn.disabled = false;
        btn.classList.add('ready');
        btn.innerText = `PLAY VS ${oppName}`;
        btn.onclick = () => launchGame(myBox.id, oppBox.id, oppName);
        
    } else {
        // --- WAITING ---
        myBox.classList.add('my-match'); // Highlight me so I know where I am
        btn.disabled = true;
        btn.classList.remove('ready');
        btn.innerText = "WAITING FOR OPPONENT...";
        btn.onclick = null;
    }
}

// --- 5. GAME LAUNCHER ---
function launchGame(myBoxId, oppBoxId, oppName) {
    // 1. Generate Consistent Match ID
    // We sort the box IDs so both players generate "MATCH-L16-1-vs-L16-2"
    // Actually, simpler: Use the lower number. "MATCH-L16-1"
    const parts = myBoxId.split('-'); // L16, 1
    const n1 = parseInt(parts[1]);
    const n2 = parseInt(oppBoxId.split('-')[1]);
    const matchNum = Math.min(n1, n2);
    const matchCode = `MATCH-${parts[0]}-${matchNum}`;

    // 2. Determine Host/Guest
    // We can't compare PeerIDs easily here because we might not have the opponent's ID.
    // Fallback: Compare Names Alphabetically.
    // "Alice" < "Bob" -> Alice is Host.
    // This is safe because names are unique in our lobby.
    const role = (state.myName < oppName) ? 'host' : 'guest';

    // 3. Save & Launch
    localStorage.setItem('isf_role', role);
    localStorage.setItem('isf_code', matchCode);
    localStorage.setItem('isf_tourney_opponent', oppName);

    // Show Overlay
    document.getElementById('game-overlay').style.display = 'block';
    document.getElementById('game-frame').src = 'friend-match.html';
}

// --- 6. RESULT HANDLING ---
window.addEventListener('message', (event) => {
    if (event.data.type === 'GAME_OVER') {
        // Close Game
        document.getElementById('game-overlay').style.display = 'none';
        document.getElementById('game-frame').src = '';

        if (event.data.result === 'win') {
            advanceSelf();
        } else {
            const btn = document.getElementById('play-btn');
            btn.innerText = "ELIMINATED";
            btn.disabled = true;
            btn.style.background = "#555";
        }
    }
});

function advanceSelf() {
    // Move my name to the next slot
    const myName = state.myName;
    
    // Find current box
    const allBoxes = Array.from(document.querySelectorAll('.match-box.occupied'));
    const currentBox = allBoxes.find(b => b.innerText === myName);
    
    if(!currentBox) return;

    // Calculate Next ID
    // Logic: L16-1 -> LQF-1.
    const idParts = currentBox.id.split('-'); 
    const round = idParts[0]; // "L16"
    const num = parseInt(idParts[1]); // 1

    let nextRound = "";
    if (round.includes("16")) nextRound = round.replace("16", "QF");
    else if (round.includes("QF")) nextRound = round.replace("QF", "SF");
    else if (round.includes("SF")) nextRound = "FINAL";

    let nextNum = Math.ceil(num / 2);
    let nextId = `${nextRound}-${nextNum}`;
    
    // Handle Final
    if (nextRound === "FINAL") {
        const side = round.charAt(0); // L or R
        nextId = `FINAL-${side}`;
    }

    // UPDATE VISUALS
    handleWin(myName, nextId);

    // BROADCAST UPDATE
    if (state.isHost) {
        // I am host, I tell guests
        broadcastUpdate(myName, nextId);
    } else if (state.conn) {
        // I am guest, I tell Host
        state.conn.send({ type: 'MATCH_WIN', winnerName: myName, nextBoxId: nextId });
    }
}

// --- 7. SHARED UPDATE LOGIC ---
function handleWin(winnerName, nextBoxId) {
    const nextBox = document.getElementById(nextBoxId);
    if (nextBox) {
        nextBox.innerText = winnerName;
        nextBox.classList.add('occupied');
        
        // If this update affects me (either I won, or my new opponent arrived)
        checkMyNextMatch();
    }
}
