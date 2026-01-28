/* =========================================
   FRIEND TOURNAMENT LOGIC (LOBBY & BRACKET)
   ========================================= */

const state = {
    myName: "Player",
    myId: null,
    hostId: null,
    isHost: false,
    players: [], 
    peer: null,
    conns: [], 
    hostConn: null, 
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
    // Try to load from localStorage first if not in input
    let val = document.getElementById('my-nickname')?.value.trim();
    if(!val) val = localStorage.getItem('isf_my_name');
    
    if (!val) { alert("Please enter a nickname!"); return null; }
    
    state.myName = val;
    localStorage.setItem('isf_my_name', val);
    return val;
}

// CHECK AUTO-ACTIONS FROM SETUP PAGE
window.onload = function() {
    state.myName = localStorage.getItem('isf_my_name') || "Player";
    
    const action = localStorage.getItem('isf_friend_action');
    if(action === 'host') {
        localStorage.removeItem('isf_friend_action'); // Clear flag
        setupHost();
    } else if (action === 'join') {
        const code = localStorage.getItem('isf_friend_code');
        localStorage.removeItem('isf_friend_action');
        if(code) {
            document.getElementById('join-code').value = code;
            joinLobby();
        }
    }
}

function setupHost() {
    if (!getNickname()) return;
    
    const code = Math.floor(1000 + Math.random() * 9000);
    const fullId = `ISF-${code}`;
    
    state.isHost = true;
    state.myId = fullId;
    state.hostId = fullId; 

    state.peer = new Peer(fullId);
    
    state.peer.on('open', (id) => {
        console.log("Hosting on ID:", id);
        state.players.push({ name: state.myName, id: id, isHost: true });
        updateLobbyUI();
        showScreen('waiting');
        document.getElementById('host-code-display').innerText = fullId;
    });

    state.peer.on('connection', (conn) => {
        conn.on('data', (data) => handleDataHost(data, conn));
    });

    state.peer.on('error', (err) => {
        alert("Error creating room. Try again.");
        console.error(err);
    });
}

function showJoinUI() {
    if (!getNickname()) return;
    showScreen('join');
}

function joinLobby() {
    const codeInput = document.getElementById('join-code').value.trim().toUpperCase();
    if (!codeInput) return;

    state.isHost = false;
    state.hostId = codeInput;
    state.peer = new Peer(); 

    state.peer.on('open', (id) => {
        state.myId = id;
        const conn = state.peer.connect(state.hostId);
        state.hostConn = conn;

        conn.on('open', () => {
            conn.send({ type: 'JOIN', name: state.myName, id: state.myId });
        });

        conn.on('data', (data) => handleDataGuest(data));
        
        conn.on('close', () => {
            alert("Host disconnected.");
            location.reload();
        });
    });

    state.peer.on('error', (err) => {
        alert("Could not find lobby. Check code.");
    });
}

function resetLobbyUI() {
    showScreen('menu');
}

// --- NETWORKING LOGIC ---

function handleDataHost(data, conn) {
    if (data.type === 'JOIN') {
        const newPlayer = { name: data.name, id: data.id, conn: conn };
        state.players.push(newPlayer);
        state.conns.push(conn);
        broadcastLobbyUpdate();
       if (data.type === 'MATCH_RESULT') {
        handleMatchResult(data);
    }
    }
}

function handleDataGuest(data) {
    // Updates the player list in the lobby
    if (data.type === 'LOBBY_UPDATE') {
        state.players = data.players;
        updateLobbyUI();
        showScreen('waiting');
        document.getElementById('host-code-display').innerText = state.hostId;
        document.getElementById('btn-start-tourney').style.display = 'none'; 
        document.getElementById('lobby-status').innerText = "WAITING FOR HOST TO START...";
    }

    // Triggers when the host starts the tournament
    if (data.type === 'START_TOURNAMENT') {
        startVisualTournament(data.bracketData);
    }

    // Triggers when the host tells everyone about a winner in another match
    if (data.type === 'LOBBY_UPDATE_BRACKET') {
        handleMatchResult(data);
    }
}
function broadcastLobbyUpdate() {
    const safeList = state.players.map(p => ({ name: p.name, id: p.id, isHost: p.isHost }));
    updateLobbyUI();
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

    if (state.isHost) {
        const btn = document.getElementById('btn-start-tourney');
        const count = state.players.length;
        // CHANGE: Allowed starting with 2 for testing, but ideally 4+
        if (count >= 2) {
            btn.disabled = false;
            btn.innerText = `START TOURNAMENT (${count} PLAYERS)`;
            document.getElementById('lobby-status').innerText = "READY TO START";
            document.getElementById('lobby-status').style.color = "#00ff00";
        } else {
            btn.disabled = true;
            btn.innerText = `WAITING FOR PLAYERS (${count})`;
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

// --- BRACKET START LOGIC (FIXED SORTING) ---

function startTournament() {
    if (!state.isHost) return;
    const shuffled = [...state.players].sort(() => 0.5 - Math.random());
    const bracketData = shuffled.map(p => ({ name: p.name, id: p.id }));

    state.conns.forEach(conn => {
        conn.send({ type: 'START_TOURNAMENT', bracketData: bracketData });
    });

    startVisualTournament(bracketData);
}

// TRACKING
let myCurrentMatchId = null;
let iAmReadyToPlay = false;
let slotsToFill = []; // Global so goToNextMatch can read it

function startVisualTournament(playerList) {
    screens.overlay.classList.add('hidden');
    screens.bracket.classList.add('active'); 
    screens.controls.classList.remove('hidden');

    document.querySelectorAll('.player-name').forEach(el => el.innerText = "");
    document.querySelectorAll('.match-box').forEach(el => el.classList.remove('occupied'));

    const n = playerList.length;
    
    // Split players
    const leftCount = Math.ceil(n / 2);
    const leftPlayers = playerList.slice(0, leftCount);
    const rightPlayers = playerList.slice(leftCount);

    slotsToFill = [];

    // --- SORTING LOGIC ---
    if (n <= 4) {
        // SMALL (Semi Finals Base)
        leftPlayers.forEach((p, i) => slotsToFill.push({ id: `LSF-${i+1}`, name: p.name }));
        rightPlayers.forEach((p, i) => slotsToFill.push({ id: `RSF-${i+1}`, name: p.name }));
    } 
    else if (n <= 8) {
        // MEDIUM (Quarter Finals Base) - 5, 6, 7, 8 Players
        slotsToFill = slotsToFill.concat(distributeSide(leftPlayers, 'L', 4));
        slotsToFill = slotsToFill.concat(distributeSide(rightPlayers, 'R', 4));
    } 
    else {
        // LARGE (Round of 16 Base) - 9+ Players
        slotsToFill = slotsToFill.concat(distributeSide(leftPlayers, 'L', 8));
        slotsToFill = slotsToFill.concat(distributeSide(rightPlayers, 'R', 8));
    }

    // Render
    slotsToFill.forEach(item => {
        const box = document.getElementById(item.id);
        if (box) {
            box.classList.add('occupied');
            box.querySelector('.player-name').innerText = item.name;
        }
    });

    checkMyMatch();
}

function distributeSide(players, side, capacity) {
    const k = players.length;
    const byes = capacity - k; 
    let mapped = [];
    let pIndex = 0;
    const matchesCount = capacity / 2;

    for (let i = 1; i <= matchesCount; i++) {
        if (pIndex < byes) {
            // --- BYE LOGIC ---
            // Player skips outer round, goes to inner round.
            // Example: Skip QF-1/2, Go to SF-1.
            let nextRoundId;
            if (capacity === 8) nextRoundId = `${side}QF-${i}`; 
            else nextRoundId = `${side}SF-${i}`;

            if (players[pIndex]) mapped.push({ id: nextRoundId, name: players[pIndex].name });
            pIndex++;
        } else {
            // --- MATCH LOGIC ---
            // Players fill the current bracket spots.
            // Example: QF-3 and QF-4.
            let prefix = (capacity === 8) ? `${side}16` : `${side}QF`;
            let s1 = `${prefix}-${(i*2)-1}`; 
            let s2 = `${prefix}-${(i*2)}`;   

            if (players[pIndex]) mapped.push({ id: s1, name: players[pIndex].name });
            pIndex++;
            if (players[pIndex]) mapped.push({ id: s2, name: players[pIndex].name });
            pIndex++;
        }
    }
    return mapped;
}

function checkMyMatch() {
    myCurrentMatchId = null;
    iAmReadyToPlay = false;
    
    // Find where I am
    const mySlot = slotsToFill.find(s => s.name === state.myName);
    
    if (mySlot) {
        // Find my opponent
        // Logic: Opponent is the other half of the pair.
        // Pairs are: (Index 0,1), (Index 2,3), etc. within the slotsToFill array? 
        // NO. slotsToFill is unstructured. We need to look at IDs.
        
        // ID Logic: LQF-1 vs LQF-2. LQF-3 vs LQF-4.
        // Parse ID: Ends in number.
        const parts = mySlot.id.split('-'); // ["LQF", "3"]
        const prefix = parts[0];
        const num = parseInt(parts[1]);
        
        // If Num is Odd (1,3), opponent is Num+1.
        // If Num is Even (2,4), opponent is Num-1.
        const isOdd = (num % 2 !== 0);
        const oppNum = isOdd ? num + 1 : num - 1;
        const oppId = `${prefix}-${oppNum}`;
        
        const opponentSlot = slotsToFill.find(s => s.id === oppId);

        const btn = document.querySelector('#game-controls button');

        if (opponentSlot) {
            // --- MATCH READY ---
            iAmReadyToPlay = true;
            myCurrentMatchId = `MATCH-${prefix}-${Math.min(num, oppNum)}`; // Unique Match ID
            
            // Visuals
            document.getElementById(mySlot.id).style.border = "2px solid #00ff00"; 
            document.getElementById(oppId).style.border = "2px solid #ff0000"; 

            btn.disabled = false;
            btn.style.opacity = "1";
            btn.style.background = "linear-gradient(90deg, #00ff00, #008800)";
            btn.innerText = `PLAY VS ${opponentSlot.name.toUpperCase()}`;
            
            // Handover Data
            localStorage.setItem('isf_tourney_opponent', opponentSlot.name);
            localStorage.setItem('isf_tourney_match_id', myCurrentMatchId);
            
            const myData = state.players.find(p => p.name === state.myName); 
const oppData = state.players.find(p => p.name === opponentSlot.name);

// Use ID string comparison (always unique)
const amISubHost = (myData.id < oppData.id);
            localStorage.setItem('isf_role', amISubHost ? 'host' : 'guest');
            localStorage.setItem('isf_code', myCurrentMatchId);

        } else {
            // --- I HAVE A BYE ---
            // If I am in SF or QF but my pair is empty, I wait.
            // But if I was placed via "Bye Logic" (e.g. into SF-1), do I have an opponent?
            // If I am in SF-1, my opponent is SF-2? NO. SF-1 plays SF-2 in the FINAL.
            // But for THIS round, I am waiting for the winner of the previous round.
            
            btn.disabled = true;
            btn.style.opacity = "0.5";
            btn.style.background = "#333";
            btn.innerText = "WAITING FOR OPPONENT...";
            document.getElementById(mySlot.id).style.border = "2px solid #ffff00"; // Yellow for waiting
        }
    }
}

function goToNextMatch() {
    if (!iAmReadyToPlay) return;
    
    // IMPORTANT: Do NOT destroy the peer connection.
    // The lobby must stay alive in the background.
    
    // Show the overlay
    const overlay = document.getElementById('game-overlay');
    const frame = document.getElementById('game-frame');
    
    overlay.classList.remove('hidden');
    
    // Load the match setup into the iframe
    frame.src = 'friend-match.html';
}
// --- LISTEN FOR GAME RESULTS (FROM IFRAME) ---
window.addEventListener('message', (event) => {
    // Filter out messages that aren't ours
    if (!event.data || event.data.type !== 'GAME_OVER') return;

    // 1. Close the Game Overlay
    const overlay = document.getElementById('game-overlay');
    const frame = document.getElementById('game-frame');
    overlay.classList.add('hidden');
    frame.src = ''; // Unload the game to save memory

    // 2. Handle Result
    const result = event.data.result; // 'win' or 'loss'

    if (result === 'loss') {
        // --- ELIMINATED ---
        const btn = document.querySelector('#game-controls button');
        btn.disabled = true;
        btn.style.background = "#555";
        btn.innerText = "ELIMINATED";
        alert("You have been eliminated. Thanks for playing!");
    } 
    else if (result === 'win') {
        // --- VICTORY: ADVANCE TO NEXT ROUND ---
        advanceToNextRound();
    }
});

function advanceToNextRound() {
    // 1. Identify Current Slot
    // Find the box that has the green border (your current match)
    const currentBox = document.querySelector('.match-box[style*="00ff00"]');
    
    if (!currentBox) {
        alert("Error: Could not find your current match slot!");
        return;
    }

    // 2. Calculate Next Slot ID
    // ID Format: LQF-1 (Side | Round | Number) -> e.g. "L16-1" or "LQF-1"
    const currentId = currentBox.id; 
    const parts = currentId.match(/([LR])([A-Z0-9]+)-(\d+)/); 
    // parts[1] = "L", parts[2] = "QF", parts[3] = "1"

    if (!parts) return;

    const side = parts[1];
    const round = parts[2];
    const num = parseInt(parts[3]);

    let nextRound = "";
    let nextNum = Math.ceil(num / 2); // 1&2 -> 1, 3&4 -> 2

    // Determine Hierarchy
    if (round === "16") nextRound = "QF";
    else if (round === "QF") nextRound = "SF";
    else if (round === "SF") nextRound = "FINAL"; 
    
    // Handle Final ID Logic
    let nextId = "";
    if (nextRound === "FINAL") {
        nextId = `FINAL-${side}`; // FINAL-L or FINAL-R
    } else {
        nextId = `${side}${nextRound}-${nextNum}`;
    }

    // 3. Update Visuals
    const nextBox = document.getElementById(nextId);
    if (nextBox) {
        // Move Name
        nextBox.classList.add('occupied');
        nextBox.querySelector('.player-name').innerText = state.myName;
        
        // Clear Old Highlight
        currentBox.style.border = "1px solid #333";
        
        // Highlight New Box (Pending Opponent)
        nextBox.style.border = "2px solid #ffff00"; // Yellow = Waiting
        
        // Update Status Button
        const btn = document.querySelector('#game-controls button');
        btn.disabled = true;
        btn.style.background = "#333";
        btn.innerText = "WAITING FOR NEXT OPPONENT...";
        
        alert("Victory! You have advanced. Waiting for opponent...");

        // 4. Broadcast Win to Lobby (CRITICAL SYNC STEP)
        if (state.conns.length > 0 || state.hostConn) {
            const msg = {
                type: 'MATCH_RESULT',
                winnerName: state.myName,
                prevRoundId: currentId,
                nextRoundId: nextId
            };

            if (state.isHost) {
                // I am Host: Update my state and broadcast to all
                handleMatchResult(msg);
            } else {
                // I am Guest: Tell the Host
                state.hostConn.send(msg);
            }
        }
    }
}

function handleMatchResult(data) {
    // 1. Update the visual bracket for the person receiving this news
    const nextBox = document.getElementById(data.nextRoundId);
    if (nextBox) {
        nextBox.classList.add('occupied');
        nextBox.querySelector('.player-name').innerText = data.winnerName;
    }

    // 2. If Host, tell everyone else!
    if (state.isHost) {
        state.conns.forEach(conn => {
            conn.send({
                type: 'LOBBY_UPDATE_BRACKET', // Relay to other guests
                winnerName: data.winnerName,
                nextRoundId: data.nextRoundId
            });
        });
        
        // Check if *I* am the one waiting for this winner
        // (Re-run match check logic to see if my button should turn Green)
        checkMyMatch(); 
    } else {
        // If I am a guest receiving this update, check if this is MY new opponent
        checkMyMatch();
    }
}
