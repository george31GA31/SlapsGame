/* =========================================
   FRIEND TOURNAMENT LOGIC
   - Balanced Seeding (Left/Right split)
   - Robust Re-connection (Suffix ID)
   - Syncs results
   ========================================= */

const state = {
    players: [],
    myName: '',
    myId: '',
    hostId: '',     // The "Lobby" ID (e.g., ISF-1234)
    bracketId: '',  // The "Bracket" ID (e.g., ISF-1234-bracket)
    isHost: false,
    peer: null,
    conn: null,
    connections: []
};

// --- 1. BOOTSTRAP ---
window.onload = function() {
    // Load Data
    const pData = localStorage.getItem('isf_bracket_players');
    state.myName = localStorage.getItem('isf_my_name');
    state.isHost = (localStorage.getItem('isf_is_host') === 'true');
    
    if (pData) {
        state.players = JSON.parse(pData);
        // Find the original Host ID (Lobby Code)
        const hostObj = state.players.find(p => p.isHost);
        if (hostObj) state.hostId = hostObj.id;
    } else {
        alert("No tournament data. Redirecting.");
        window.location.href = 'tournament-setup.html';
        return;
    }

    // Determine the ID we are using for this page
    // We append '-bracket' to avoid conflict with the previous page's connection
    state.bracketId = state.hostId + '-bracket';

    // 1. Render Visuals (Seeding)
    renderBracket();

    // 2. Start Network
    initBracketNetwork();
};

// --- 2. NETWORKING ---
function initBracketNetwork() {
    // Host opens "ISF-1234-bracket". Guests connect to "ISF-1234-bracket".
    const myConfig = state.isHost ? state.bracketId : undefined;
    
    state.peer = new Peer(myConfig);

    state.peer.on('open', (id) => {
        console.log("Bracket Network Ready. ID:", id);
        
        if (!state.isHost) {
            // Guest: Connect to the new Host Bracket ID
            connectToHost();
        }
    });

    // HOST: Accept connections
    if (state.isHost) {
        state.peer.on('connection', (conn) => {
            state.connections.push(conn);
            
            conn.on('data', (msg) => {
                // If a guest reports a win, update and relay
                if (msg.type === 'UPDATE_BRACKET') {
                    handleWin(msg.name, msg.boxId);
                    broadcastMsg(msg);
                }
            });
        });
        
        state.peer.on('error', (err) => {
            console.warn("Peer Error:", err);
            // If ID taken, it usually means we refreshed. PeerJS auto-recovers usually.
        });
    }
}

function connectToHost() {
    // Guest connects to "ISF-1234-bracket"
    const conn = state.peer.connect(state.bracketId);
    state.conn = conn;

    conn.on('open', () => console.log("Connected to Host!"));
    
    conn.on('data', (msg) => {
        if (msg.type === 'UPDATE_BRACKET') {
            updateBox(msg.boxId, msg.name);
            checkGameState(); // Re-evaluate my status
        }
    });
    
    // Retry if host isn't ready yet (race condition)
    setTimeout(() => {
        if (!conn.open) connectToHost();
    }, 2000);
}

function broadcastMsg(msg) {
    state.connections.forEach(c => {
        if (c.open) c.send(msg);
    });
}

// --- 3. BRACKET RENDERING (SEEDING FIX) ---
function renderBracket() {
    // Clear
    document.querySelectorAll('.match-box').forEach(b => {
        b.innerText = "";
        b.classList.remove('occupied', 'my-match', 'opponent-match');
    });

    const total = state.players.length;
    const p = state.players;

    // --- BALANCED SEEDING LOGIC ---
    // If 4 Players:
    // P1 -> L16-1, P2 -> L16-2 (Left Bracket)
    // P3 -> R16-1, P4 -> R16-2 (Right Bracket)
    
    if (total <= 4) {
        if(p[0]) updateBox('L16-1', p[0].name);
        if(p[1]) updateBox('L16-2', p[1].name);
        if(p[2]) updateBox('R16-1', p[2].name);
        if(p[3]) updateBox('R16-2', p[3].name);
    } 
    else {
        // 8-16 Players: Distribute Evenly
        // Even indices left, Odd indices right? Or Split half/half?
        // Split Half/Half is cleaner for visual balance.
        
        const midPoint = Math.ceil(total / 2);
        const leftPlayers = p.slice(0, midPoint);
        const rightPlayers = p.slice(midPoint);

        // Fill Left (L16-1 to L16-8)
        leftPlayers.forEach((player, i) => {
            updateBox(`L16-${i+1}`, player.name);
        });

        // Fill Right (R16-1 to R16-8)
        rightPlayers.forEach((player, i) => {
            updateBox(`R16-${i+1}`, player.name);
        });
    }

    checkGameState();
}

function updateBox(id, name) {
    const box = document.getElementById(id);
    if (box) {
        box.innerText = name;
        box.classList.add('occupied');
    }
}

// --- 4. GAME STATE ENGINE ---
function checkGameState() {
    const myName = state.myName;
    
    // 1. Find My Deepest Box
    // We look for the box in the "highest" round (Final > SF > QF > 16)
    const allBoxes = Array.from(document.querySelectorAll('.match-box.occupied'));
    const myBoxes = allBoxes.filter(b => b.innerText === myName);
    
    let myCurrentBox = null;
    const roundPriority = ['FINAL', 'SF', 'QF', '16'];
    
    for (let r of roundPriority) {
        const found = myBoxes.find(b => b.id.includes(r));
        if (found) { myCurrentBox = found; break; }
    }

    if (!myCurrentBox) return setStatus("ELIMINATED", false);

    // 2. Identify Opponent
    const { oppId, nextId } = getBracketLogic(myCurrentBox.id);
    const oppBox = document.getElementById(oppId);
    
    // Reset Highlights
    document.querySelectorAll('.my-match, .opponent-match').forEach(e => 
        e.classList.remove('my-match', 'opponent-match')
    );
    myCurrentBox.classList.add('my-match');

    // 3. Logic
    if (oppBox && oppBox.classList.contains('occupied')) {
        // Match Ready
        oppBox.classList.add('opponent-match');
        const oppName = oppBox.innerText;
        setStatus(`PLAY VS ${oppName}`, true, () => launchGame(myCurrentBox.id, oppBox.id, oppName));
    } else {
        // Waiting... BUT CHECK FOR BYE (Auto-Advance)
        // If I am in Round 16, and my opponent slot is empty (and we have < 16 players),
        // I might need to auto-advance if no one was seeded there.
        
        // Simple Check: If we are in R16, and opponent ID implies a slot that wasn't filled by renderBracket
        // We auto-win.
        if (myCurrentBox.id.includes('16')) {
            // Did we skip this slot in setup?
            // If total players was small, this slot is empty forever.
            // How do we know? We check if the opponent box exists in DOM but has no text.
            if (oppBox && oppBox.innerText === "") {
                console.log("Bye detected. Advancing...");
                advancePlayer(myName, myCurrentBox.id);
                return;
            }
        }
        
        setStatus("WAITING FOR OPPONENT...", false);
    }
}

function getBracketLogic(currentId) {
    const parts = currentId.split('-'); // [L16, 1]
    const round = parts[0];
    const num = parseInt(parts[1]);

    // Opponent: 1vs2, 3vs4
    const oppNum = (num % 2 !== 0) ? num + 1 : num - 1;
    const oppId = `${round}-${oppNum}`;

    // Next Round Map
    let nextRound = "";
    if (round.includes('16')) nextRound = round.replace('16', 'QF');
    else if (round.includes('QF')) nextRound = round.replace('QF', 'SF');
    else if (round.includes('SF')) {
        // Special: LSF -> FINAL-L
        const side = round.charAt(0);
        return { oppId, nextId: `FINAL-${side}` };
    }
    else if (round.includes('FINAL')) {
        return { oppId, nextId: 'CHAMPION' };
    }

    const nextNum = Math.ceil(num / 2);
    const nextId = `${nextRound}-${nextNum}`;

    return { oppId, nextId };
}

// --- 5. LAUNCH & STATUS ---
function setStatus(text, ready, action) {
    const btn = document.getElementById('play-btn');
    btn.innerText = text;
    btn.disabled = !ready;
    if (ready) {
        btn.classList.add('ready');
        btn.onclick = action;
        btn.style.background = ""; 
    } else {
        btn.classList.remove('ready');
        btn.onclick = null;
        btn.style.background = "#333";
    }
}

function launchGame(myBoxId, oppBoxId, oppName) {
    const baseId = (myBoxId < oppBoxId) ? myBoxId : oppBoxId;
    const matchCode = `MATCH-${baseId}`;
    
    // Determine Host (Alphabetical)
    const role = (state.myName < oppName) ? 'host' : 'guest';

    localStorage.setItem('isf_role', role);
    localStorage.setItem('isf_code', matchCode);
    localStorage.setItem('isf_tourney_opponent', oppName);

    document.getElementById('game-overlay').style.display = 'block';
    document.getElementById('game-frame').src = 'friend-match.html';
}

// --- 6. RESULTS & ADVANCEMENT ---
window.addEventListener('message', (event) => {
    if (event.data.type === 'GAME_OVER') {
        document.getElementById('game-overlay').style.display = 'none';
        document.getElementById('game-frame').src = '';

        if (event.data.result === 'win') {
            const myBox = document.querySelector('.my-match');
            if(myBox) advancePlayer(state.myName, myBox.id);
        } else {
            setStatus("ELIMINATED", false);
            document.querySelectorAll('.my-match').forEach(e => e.classList.remove('my-match'));
        }
    }
});

function advancePlayer(name, currentId) {
    const logic = getBracketLogic(currentId);
    
    if (logic.nextId === 'CHAMPION') {
        alert("TOURNAMENT WINNER: " + name);
        return;
    }

    // 1. Update UI
    updateBox(logic.nextId, name);

    // 2. Broadcast to others
    const msg = { type: 'UPDATE_BRACKET', boxId: logic.nextId, name: name };
    if (state.isHost) broadcastMsg(msg);
    else if (state.conn) state.conn.send(msg);

    // 3. Re-Check (Did I just walk into another match?)
    setTimeout(checkGameState, 500);
}
