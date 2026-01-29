/* =========================================
   FRIEND TOURNAMENT LOGIC
   - Maps players to bracket slots
   - Handles Auto-Advancement (Byes)
   - Syncs results between Host and Guests
   ========================================= */

const state = {
    players: [],
    myName: '',
    myId: '',
    hostId: '',
    isHost: false,
    peer: null,
    conn: null,
    connections: []
};

// --- 1. BOOTSTRAP ---
window.onload = function() {
    // Load Data from Lobby
    const pData = localStorage.getItem('isf_bracket_players');
    state.myName = localStorage.getItem('isf_my_name');
    state.isHost = (localStorage.getItem('isf_is_host') === 'true');
    
    // Find Host ID for reconnection
    if (pData) {
        state.players = JSON.parse(pData);
        const hostObj = state.players.find(p => p.isHost);
        if (hostObj) state.hostId = hostObj.id;
    } else {
        // Fallback for testing without lobby
        alert("No tournament data found. Redirecting to setup.");
        window.location.href = 'tournament-setup.html';
        return;
    }

    // Initialize Network to keep bracket synced
    initBracketNetwork();

    // Render the Bracket
    renderBracket();
};

// --- 2. NETWORKING (SYNC) ---
function initBracketNetwork() {
    // Host re-opens their ID if possible, Guest connects to Host
    // Note: Since PeerJS IDs might not persist if tab closed, we rely on game signaling largely.
    // This is a "Best Effort" sync for the bracket page itself.
    
    state.peer = new Peer(state.isHost ? state.hostId : undefined);

    state.peer.on('open', (id) => {
        console.log("Bracket Link Active:", id);
        if (!state.isHost && state.hostId) {
            const conn = state.peer.connect(state.hostId);
            state.conn = conn;
            conn.on('data', handleNetworkMsg);
        }
    });

    if (state.isHost) {
        state.peer.on('connection', (conn) => {
            state.connections.push(conn);
            conn.on('data', (msg) => {
                // Relay messages (like "Player X Won") to everyone else
                handleNetworkMsg(msg);
                broadcastMsg(msg);
            });
        });
    }
}

function broadcastMsg(msg) {
    state.connections.forEach(c => c.send(msg));
}

function handleNetworkMsg(msg) {
    if (msg.type === 'UPDATE_BRACKET') {
        updateBox(msg.boxId, msg.name);
    }
}

// --- 3. BRACKET RENDERING ---
function renderBracket() {
    // Clear board
    document.querySelectorAll('.match-box').forEach(b => {
        b.innerText = "";
        b.classList.remove('occupied', 'my-match', 'opponent-match');
    });

    // --- PLACEMENT STRATEGY ---
    // We fill the Round of 16 slots (L16-1 to L16-8, R16-1 to R16-8).
    // If we have fewer players, we space them out so they don't play immediately if possible.
    
    // Simple Fill: Just put them in order. 
    // "Auto-Advance" logic will handle moving them forward if they have no opponent.
    
    const leftSlots = ['L16-1','L16-2','L16-3','L16-4','L16-5','L16-6','L16-7','L16-8'];
    const rightSlots = ['R16-1','R16-2','R16-3','R16-4','R16-5','R16-6','R16-7','R16-8'];
    const allSlots = [...leftSlots, ...rightSlots];

    // Place players
    state.players.forEach((p, i) => {
        if (allSlots[i]) {
            updateBox(allSlots[i], p.name);
        }
    });

    // Run Logic to see where I stand
    checkGameState();
}

function updateBox(id, name) {
    const box = document.getElementById(id);
    if (box) {
        box.innerText = name;
        box.classList.add('occupied');
    }
}

// --- 4. GAME STATE ENGINE (The Brain) ---
function checkGameState() {
    // 1. Find My Box (Deepest one)
    const myBoxes = Array.from(document.querySelectorAll('.match-box.occupied'))
        .filter(b => b.innerText === state.myName);
    
    // Sort by "Round Depth" logic if needed, but usually the last one found is correct 
    // provided we clear old ones? No, usually we keep history. 
    // We need the box that is "Waiting for a result".
    
    // Simplest approach: Find the box that DOES NOT have a winner connection yet?
    // Actually, let's just grab the one in the latest round.
    
    let myCurrentBox = null;
    // Priority: FINAL > SF > QF > 16
    const rounds = ['FINAL', 'SF', 'QF', '16'];
    for (let r of rounds) {
        const found = myBoxes.find(b => b.id.includes(r));
        if (found) { myCurrentBox = found; break; }
    }

    if (!myCurrentBox) return setStatus("ELIMINATED", false);

    // 2. Identify Opponent Slot
    const { oppId, nextId } = getBracketLogic(myCurrentBox.id);
    const oppBox = document.getElementById(oppId);
    
    // Highlight Me
    myCurrentBox.classList.add('my-match');

    // 3. LOGIC: Do I have an opponent?
    if (oppBox && oppBox.classList.contains('occupied')) {
        // Yes -> Match Ready
        oppBox.classList.add('opponent-match');
        const oppName = oppBox.innerText;
        setStatus(`PLAY VS ${oppName}`, true, () => launchGame(myCurrentBox.id, oppBox.id, oppName));
    } else {
        // No -> Do I have a Bye? 
        // If the opponent box represents a "Real" slot (like L16-2) and it's empty, 
        // implies nobody was seeded there. AUTO-ADVANCE.
        
        // However, if we are in QF/SF, an empty box means "Waiting for winner of previous round".
        // We only Auto-Advance in Round 16 (the starting round).
        
        if (myCurrentBox.id.includes('16')) {
            // Check if we already advanced (prevent loop)
            const nextBox = document.getElementById(nextId);
            if (nextBox && !nextBox.classList.contains('occupied')) {
                console.log("No opponent in R16. Auto-advancing...");
                advancePlayer(state.myName, myCurrentBox.id);
                return; // Re-run check after advancing
            }
        }
        
        setStatus("WAITING FOR OPPONENT...", false);
    }
}

function getBracketLogic(currentId) {
    // Parsing ID: L16-1
    const parts = currentId.split('-'); // [L16, 1]
    const round = parts[0];
    const num = parseInt(parts[1]);

    // Opponent Logic: 1vs2, 3vs4... (If odd, opp is +1. If even, opp is -1)
    const oppNum = (num % 2 !== 0) ? num + 1 : num - 1;
    const oppId = `${round}-${oppNum}`;

    // Next Round Logic
    // L16 -> LQF.  (1,2 -> 1), (3,4 -> 2)
    let nextRound = "";
    if (round.includes('16')) nextRound = round.replace('16', 'QF');
    else if (round.includes('QF')) nextRound = round.replace('QF', 'SF');
    else if (round.includes('SF')) {
        // Special: LSF -> FINAL-L
        const side = round.charAt(0);
        return { oppId, nextId: `FINAL-${side}` };
    }
    else if (round.includes('FINAL')) {
        // Final Winner? Usually ends here.
        return { oppId, nextId: 'CHAMPION' };
    }

    const nextNum = Math.ceil(num / 2);
    const nextId = `${nextRound}-${nextNum}`;

    return { oppId, nextId };
}

// --- 5. GAME LAUNCHER ---
function launchGame(myBoxId, oppBoxId, oppName) {
    // Generate Match Code (Low ID first to ensure both gen same code)
    // e.g. MATCH-L16-1
    const baseId = (myBoxId < oppBoxId) ? myBoxId : oppBoxId;
    const matchCode = `MATCH-${baseId}`;

    // Determine Host (Alphabetical Name Check)
    const role = (state.myName < oppName) ? 'host' : 'guest';

    // Save & Go
    localStorage.setItem('isf_role', role);
    localStorage.setItem('isf_code', matchCode);
    localStorage.setItem('isf_tourney_opponent', oppName);

    // Open Overlay
    const overlay = document.getElementById('game-overlay');
    const frame = document.getElementById('game-frame');
    overlay.style.display = 'block';
    frame.src = 'friend-match.html';
}

function setStatus(text, ready, action) {
    const btn = document.getElementById('play-btn');
    btn.innerText = text;
    btn.disabled = !ready;
    if (ready) {
        btn.classList.add('ready');
        btn.onclick = action;
        btn.style.background = ""; // Default gradient
    } else {
        btn.classList.remove('ready');
        btn.onclick = null;
        btn.style.background = "#333";
    }
}

// --- 6. RESULT LISTENER ---
window.addEventListener('message', (event) => {
    if (event.data.type === 'GAME_OVER') {
        const result = event.data.result; 
        
        // Close Game
        document.getElementById('game-overlay').style.display = 'none';
        document.getElementById('game-frame').src = '';

        if (result === 'win') {
            // Find my current box again to calculate next
            const myBoxes = Array.from(document.querySelectorAll('.match-box.occupied'))
                .filter(b => b.innerText === state.myName);
            // Get the "deepest" one logic manually or re-run state check
            // Simpler: Just run advance logic on the 'my-match' box
            const currentBox = document.querySelector('.my-match');
            if(currentBox) advancePlayer(state.myName, currentBox.id);
        } else {
            setStatus("ELIMINATED", false);
            document.querySelectorAll('.my-match').forEach(e => e.classList.remove('my-match'));
        }
    }
});

function advancePlayer(name, currentId) {
    const logic = getBracketLogic(currentId);
    if (!logic.nextId) return; // Champion?

    if (logic.nextId === 'CHAMPION') {
        alert(`${name} IS THE CHAMPION!`);
        return;
    }

    // Visual Update
    updateBox(logic.nextId, name);

    // Network Update (Tell everyone)
    const msg = { type: 'UPDATE_BRACKET', boxId: logic.nextId, name: name };
    if (state.isHost) broadcastMsg(msg);
    else if (state.conn) state.conn.send(msg);

    // Re-check state (Maybe I play again immediately?)
    setTimeout(checkGameState, 500); 
}
