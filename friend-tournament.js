/* =========================================
   FRIEND TOURNAMENT LOGIC (LOBBY & BRACKET)
   ========================================= */

const state = {
    myName: "Player",
    myId: null,
    hostId: null,
    isHost: false,
    players: [], // { name, id }
    peer: null,
    conns: [], // Host keeps connections here
    hostConn: null, // Guest keeps host connection here
    tournamentStarted: false
};

// --- DOM ELEMENTS ---
const screens = {
    menu: document.getElementById('lobby-menu'),
    join: document.getElementById('lobby-join'),
    waiting: document.getElementById('lobby-waiting'),
    overlay: document.getElementById('lobby-overlay'),
    bracket: document.getElementById('bracket-container'),
    controls: document.getElementById('game-controls')
};

// --- SETUP FUNCTIONS ---

function getNickname() {
    const input = document.getElementById('my-nickname').value.trim();
    if (!input) { alert("Please enter a nickname!"); return null; }
    state.myName = input;
    localStorage.setItem('isf_my_name', input);
    return input;
}

function setupHost() {
    if (!getNickname()) return;
    
    // Generate Random 4-Digit Code
    const code = Math.floor(1000 + Math.random() * 9000);
    const fullId = `ISF-${code}`;
    
    state.isHost = true;
    state.myId = fullId;
    state.hostId = fullId; // Host is their own host

    // Init Peer
    state.peer = new Peer(fullId);
    
    state.peer.on('open', (id) => {
        console.log("Hosting on ID:", id);
        // Add self to list
        state.players.push({ name: state.myName, id: id, isHost: true });
        updateLobbyUI();
        showScreen('waiting');
        document.getElementById('host-code-display').innerText = fullId;
    });

    state.peer.on('connection', (conn) => {
        conn.on('data', (data) => handleDataHost(data, conn));
    });

    state.peer.on('error', (err) => {
        alert("Error creating room. Code might be taken. Try again.");
        console.error(err);
    });
}

function showJoinUI() {
    if (!getNickname()) return;
    showScreen('join');
}

function joinLobby() {
    const codeInput = document.getElementById('join-code').value.trim().toUpperCase();
    if (!codeInput.startsWith('ISF-') && codeInput.length !== 8) {
        alert("Invalid format. Use ISF-XXXX");
        return;
    }

    state.isHost = false;
    state.hostId = codeInput;
    state.peer = new Peer(); // Random ID for guest

    state.peer.on('open', (id) => {
        state.myId = id;
        console.log("My ID:", id);
        const conn = state.peer.connect(state.hostId);
        state.hostConn = conn;

        conn.on('open', () => {
            console.log("Connected to Host");
            // Send Join Request
            conn.send({ type: 'JOIN', name: state.myName, id: state.myId });
        });

        conn.on('data', (data) => handleDataGuest(data));
        
        conn.on('close', () => {
            alert("Host disconnected.");
            location.reload();
        });
    });

    state.peer.on('error', (err) => {
        alert("Could not find lobby. Check the code.");
        console.error(err);
    });
}

function resetLobbyUI() {
    showScreen('menu');
}

// --- NETWORKING LOGIC ---

function handleDataHost(data, conn) {
    if (data.type === 'JOIN') {
        // Add new player
        const newPlayer = { name: data.name, id: data.id, conn: conn };
        state.players.push(newPlayer);
        state.conns.push(conn);
        
        console.log(`${data.name} joined.`);
        broadcastLobbyUpdate();
    }
}

function handleDataGuest(data) {
    if (data.type === 'LOBBY_UPDATE') {
        state.players = data.players;
        updateLobbyUI();
        showScreen('waiting');
        document.getElementById('host-code-display').innerText = state.hostId;
        document.getElementById('btn-start-tourney').style.display = 'none'; // Guests can't start
        document.getElementById('lobby-status').innerText = "WAITING FOR HOST TO START...";
    }
    if (data.type === 'START_TOURNAMENT') {
        startVisualTournament(data.bracketData);
    }
}

function broadcastLobbyUpdate() {
    // Send safe list (no connection objects) to everyone
    const safeList = state.players.map(p => ({ name: p.name, id: p.id, isHost: p.isHost }));
    
    // Update Host UI
    updateLobbyUI();

    // Send to Guests
    state.conns.forEach(conn => {
        conn.send({ type: 'LOBBY_UPDATE', players: safeList });
    });
}

// --- UI UPDATES ---

function updateLobbyUI() {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    state.players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.innerHTML = `<span><i class="fa-solid fa-user"></i> ${p.name}</span>`;
        list.appendChild(div);
    });

    // Update Start Button Logic (Host Only)
    if (state.isHost) {
        const btn = document.getElementById('btn-start-tourney');
        const count = state.players.length;
        if (count >= 4) {
            btn.disabled = false;
            btn.innerText = `START TOURNAMENT (${count} PLAYERS)`;
            document.getElementById('lobby-status').innerText = "READY TO START";
            document.getElementById('lobby-status').style.color = "#00ff00";
        } else {
            btn.disabled = true;
            btn.innerText = `WAITING FOR PLAYERS (${count}/4 MIN)`;
            document.getElementById('lobby-status').innerText = "WAITING FOR PLAYERS...";
            document.getElementById('lobby-status').style.color = "#888";
        }
    }
}

function showScreen(name) {
    Object.values(screens).forEach(el => {
        if(el && el.id !== 'bracket-container' && el.id !== 'lobby-overlay' && el.id !== 'game-controls') 
            el.classList.add('hidden');
    });
    if (screens[name]) screens[name].classList.remove('hidden');
}

// --- BRACKET START LOGIC ---

// --- BRACKET START LOGIC ---

function startTournament() {
    if (!state.isHost) return;
    
    // Shuffle players for randomness
    const shuffled = [...state.players].sort(() => 0.5 - Math.random());
    
    // Broadcast the ordered list
    const bracketData = shuffled.map(p => ({ name: p.name, id: p.id }));

    state.conns.forEach(conn => {
        conn.send({ type: 'START_TOURNAMENT', bracketData: bracketData });
    });

    startVisualTournament(bracketData);
}

// --- BRACKET STATE TRACKING ---
let myCurrentMatchId = null; // If I am playing, this stores the match ID (e.g., 'L16-1')
let iAmReadyToPlay = false;

function startVisualTournament(playerList) {
    // 1. Setup UI
    screens.overlay.classList.add('hidden');
    screens.bracket.classList.add('active'); 
    screens.controls.classList.remove('hidden');

    // 2. Clear Bracket
    document.querySelectorAll('.player-name').forEach(el => el.innerText = "");
    document.querySelectorAll('.match-box').forEach(el => el.classList.remove('occupied'));

    // 3. Logic to Distribute Players (Same as before)
    // ... (Keep your existing distribution logic here) ...
    // ... (Keep your slotsToFill logic here) ...

    // 4. Render to DOM & CHECK FOR MY MATCH
    myCurrentMatchId = null;
    iAmReadyToPlay = false;
    
    // We need to group players by Match ID (e.g., L16-1 vs L16-2 is WRONG logic).
    // Correct Logic: L16-1 and L16-2 fight to go to LQF-1? No.
    // In a visual bracket, typically adjacent vertical slots fight each other.
    // L16-1 vs L16-2 -> Winner goes to LQF-1.
    
    // SIMPLIFIED MATCH DETECTION:
    // If "I" am in L16-1, my opponent is in L16-2.
    // We scan the 'slotsToFill' to find where 'I' am.
    
    const mySlot = slotsToFill.find(s => s.name === state.myName);
    
    if (mySlot) {
        // Find my opponent
        // Logic: If index is even (0, 2, 4), opponent is index+1. If odd, opponent is index-1.
        const myIndex = slotsToFill.indexOf(mySlot);
        const isEven = (myIndex % 2 === 0);
        const opponentIndex = isEven ? myIndex + 1 : myIndex - 1;
        const opponentSlot = slotsToFill[opponentIndex];

        if (opponentSlot) {
            // MATCH FOUND!
            iAmReadyToPlay = true;
            myCurrentMatchId = `MATCH-${Math.min(myIndex, opponentIndex)}`; // Unique ID based on lower index
            
            // Highlight My Box
            document.getElementById(mySlot.id).style.border = "2px solid #00ff00"; 
            
            // Enable Button
            const btn = document.querySelector('#game-controls button');
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.style.background = "linear-gradient(90deg, #00ff00, #008800)";
            btn.innerText = `PLAY MATCH VS ${opponentSlot.name.toUpperCase()}`;
            
            // Store Match Data for Handover
            localStorage.setItem('isf_tourney_opponent', opponentSlot.name);
            localStorage.setItem('isf_tourney_match_id', myCurrentMatchId);
            
            // IMPORTANT: We need to know who "Hosts" the sub-match. 
            // Convention: The player with the alphabetically first ID (or name) hosts.
            // Let's use name for simplicity in this friend mode.
            const amISubHost = (state.myName < opponentSlot.name);
            localStorage.setItem('isf_role', amISubHost ? 'host' : 'guest');
            localStorage.setItem('isf_code', myCurrentMatchId); // Sub-room ID
        } else {
            // I have a Bye (No opponent yet)
            const btn = document.querySelector('#game-controls button');
            btn.disabled = true;
            btn.style.opacity = "0.5";
            btn.style.background = "#333";
            btn.innerText = "WAITING FOR OPPONENT...";
        }
    }
    
    // Draw names
    slotsToFill.forEach(item => {
        const box = document.getElementById(item.id);
        if (box) {
            box.classList.add('occupied');
            box.querySelector('.player-name').innerText = item.name;
        }
    });
}

function goToNextMatch() {
    if (!iAmReadyToPlay) return;
    
    // Save State so we can return later (Optional: Store tournament ID)
    // Disconnect from Main Lobby (PeerJS limit)
    if (state.peer) state.peer.destroy();
    
    // Redirect to Game
    window.location.href = 'multiplayer-game.html';
}
// --- HELPER: DISTRIBUTE PLAYERS WITH BYES ---
function distributeSide(players, side, capacity) {
    const k = players.length;
    const byes = capacity - k; // How many "free passes" available
    let mapped = [];
    let pIndex = 0;

    // We iterate through the "Matches" of the base round.
    // If Capacity is 8 (R16), there are 4 Matches (QF1..QF4).
    // If Capacity is 4 (QF), there are 2 Matches (SF1..SF2).
    const matchesCount = capacity / 2;

    for (let i = 1; i <= matchesCount; i++) {
        // Logic: Fill from Top to Bottom.
        // If we still have Byes left, this match slot becomes a Bye.
        // A Bye means 1 player skips the outer round and goes to the inner round.
        
        if (pIndex < byes) {
            // --- GIVE BYE (Place in Inner Round) ---
            let nextRoundId;
            if (capacity === 8) nextRoundId = `${side}QF-${i}`; // Skip R16 -> Go QF
            else nextRoundId = `${side}SF-${i}`;               // Skip QF -> Go SF

            // Take 1 player
            if (players[pIndex]) mapped.push({ id: nextRoundId, name: players[pIndex].name });
            pIndex++;
        } else {
            // --- REAL MATCH (Place in Current Round) ---
            let prefix = (capacity === 8) ? `${side}16` : `${side}QF`;
            let s1 = `${prefix}-${(i*2)-1}`; // e.g., L16-1
            let s2 = `${prefix}-${(i*2)}`;   // e.g., L16-2

            // Take 2 players
            if (players[pIndex]) mapped.push({ id: s1, name: players[pIndex].name });
            pIndex++;
            if (players[pIndex]) mapped.push({ id: s2, name: players[pIndex].name });
            pIndex++;
        }
    }
    return mapped;
}
function startVisualTournament(playerList) {
    // 1. Hide Overlay
    screens.overlay.classList.add('hidden');
    screens.bracket.classList.add('active'); // Remove blur
    screens.controls.classList.remove('hidden');

    // 2. Populate Names
    // Logic: If <= 8 players, fill QF. If > 8, fill R16.
    // For this MVP, let's just fill R16 Left side first, then Right side.
    
    // Clear all boxes first
    document.querySelectorAll('.player-name').forEach(el => el.innerText = "");
    document.querySelectorAll('.match-box').forEach(el => el.classList.remove('occupied'));

    const slots = [
        'L16-1', 'L16-2', 'L16-3', 'L16-4', 'L16-5', 'L16-6', 'L16-7', 'L16-8',
        'R16-1', 'R16-2', 'R16-3', 'R16-4', 'R16-5', 'R16-6', 'R16-7', 'R16-8'
    ];

    playerList.forEach((p, index) => {
        if (index < slots.length) {
            const box = document.getElementById(slots[index]);
            if (box) {
                box.classList.add('occupied');
                box.querySelector('.player-name').innerText = p.name;
            }
        }
    });
}

function goToNextMatch() {
    alert("Matchmaking logic coming next!");
}
