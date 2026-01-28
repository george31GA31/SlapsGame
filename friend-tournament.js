/* =========================================
   FRIEND TOURNAMENT LOGIC
   - Handles Bracket Rendering
   - Handles PeerJS Syncing
   - Handles Game Launching
   ========================================= */

const state = {
    players: [],      // List from Setup
    myName: '',
    myId: '',
    hostId: '',
    isHost: false,
    peer: null,
    conn: null,       // Guest connection to Host
    connections: [],  // Host connections to Guests
    matches: {}       // Tracks who is in which box ID
};

// --- INIT ---
window.onload = function() {
    // 1. Load Data
    const pData = localStorage.getItem('isf_bracket_players');
    state.myName = localStorage.getItem('isf_my_name');
    state.isHost = (localStorage.getItem('isf_is_host') === 'true');
    state.hostId = localStorage.getItem('isf_host_id') || localStorage.getItem('isf_my_id'); // Host ID is their own ID if host

    if (!pData || !state.myName) {
        alert("Missing tournament data. Returning to menu.");
        window.location.href = 'tournament-setup.html';
        return;
    }

    state.players = JSON.parse(pData);

    // 2. Initialize Networking to Keep Bracket Synced
    initNetworking();

    // 3. Draw the Bracket
    renderInitialBracket();
};

// --- NETWORKING (SYNC RESULTS) ---
function initNetworking() {
    state.peer = new Peer(); // We need a new connection just for bracket updates

    state.peer.on('open', (id) => {
        // If I am Host, I just wait for results
        // If I am Guest, I connect to Host
        if (!state.isHost && state.hostId) {
            // NOTE: We need the Host's *Bracket* ID. 
            // Since we don't have a sophisticated signaling server, 
            // we will assume the Host keeps their ID or we passed it.
            // *Simplification:* For this friend mode, we rely on the game reporting.
            // But to update the bracket *live* for spectators, we need this connection.
            
            // To keep it simple and working: We will rely on LOCAL updates for now
            // and assume the players are trustworthy. 
            // Real-time spectating requires a more complex server.
        }
    });
}

// --- BRACKET RENDERER ---
function renderInitialBracket() {
    const total = state.players.length;
    let slots = [];

    // Distribute Players based on count
    // Logic: Fill from "Round of 16" inwards if many players
    // Fill "Semi Final" directly if 4 players.

    if (total <= 4) {
        // 4 Players -> Semi Finals (LSF-1 vs LSF-? No, LSF-1 is one slot)
        // Standard Bracket: 
        // Semi Left (LSF-1) vs (LSF-?) -> Wait, SF is 1 match? 
        // No, typically SF has 2 matches.
        // My HTML has LSF-1 (Left Semi) and RSF-1 (Right Semi).
        // That means LSF-1 is the WINNER of the Left side.
        
        // Let's look at the HTML structure:
        // L16 -> LQF -> LSF -> FINAL <- RSF <- RQF <- R16
        
        // 4 Players: 
        // Match 1: Player A vs B (Fills LQF-1 and LQF-2) -> Winner goes to LSF-1?
        // No, LSF-1 is a single box. 
        // Matches happen *between* boxes? No, boxes usually represent slots.
        
        // Let's use standard logic:
        // A Match needs TWO inputs.
        // If 4 Players:
        // Match 1 (Left): P1 vs P2. They go into LQF-1 and LQF-2.
        // Match 2 (Right): P3 vs P4. They go into RQF-1 and RQF-2.
        // Winners go to LSF-1 and RSF-1? 
        // Then LSF-1 plays RSF-1 in Final? Yes.
        
        assignSlot('LQF-1', state.players[0]);
        assignSlot('LQF-2', state.players[1]);
        assignSlot('RQF-1', state.players[2]);
        assignSlot('RQF-2', state.players[3]);
    } 
    else if (total <= 8) {
        // 8 Players -> Fill Round of 16? Or QF?
        // 8 Players = 4 Matches.
        // Left: P1-P4. Right: P5-P8.
        // Left fills L16-1 to L16-4.
        // Right fills R16-1 to R16-4.
        state.players.forEach((p, i) => {
            if (i < 4) assignSlot(`L16-${i+1}`, p);
            else assignSlot(`R16-${(i-4)+1}`, p);
        });
    }
    
    checkMyNextMatch();
}

function assignSlot(boxId, player) {
    if (!player) return;
    const box = document.getElementById(boxId);
    if (box) {
        box.innerText = player.name;
        box.classList.add('occupied');
        box.dataset.playerId = player.id; // Store ID for logic
        box.dataset.playerName = player.name;
    }
}

// --- MATCHMAKING LOGIC ---
function checkMyNextMatch() {
    const myName = state.myName;
    let myBox = null;
    
    // 1. Find where I am currently
    const allBoxes = document.querySelectorAll('.match-box.occupied');
    allBoxes.forEach(box => {
        if (box.innerText === myName) myBox = box;
    });

    if (!myBox) {
        setButtonState("ELIMINATED", false, "#555");
        return;
    }

    // 2. Find Opponent
    // Naming convention: L16-1 vs L16-2, L16-3 vs L16-4
    const idParts = myBox.id.split('-'); // ["L16", "1"]
    const prefix = idParts[0];
    const num = parseInt(idParts[1]);
    
    // Opponent is: If Odd -> Num+1. If Even -> Num-1.
    const oppNum = (num % 2 !== 0) ? num + 1 : num - 1;
    const oppId = `${prefix}-${oppNum}`;
    const oppBox = document.getElementById(oppId);

    if (oppBox && oppBox.classList.contains('occupied')) {
        // --- MATCH FOUND ---
        const oppName = oppBox.innerText;
        
        // Highlight boxes
        myBox.classList.add('my-match');
        oppBox.classList.add('opponent-match');

        // Setup Button
        const btn = document.getElementById('play-btn');
        btn.innerText = `PLAY VS ${oppName}`;
        btn.onclick = () => launchGame(myBox.id, oppBox.id, oppName, oppBox.dataset.playerId);
        
        setButtonState(`PLAY VS ${oppName}`, true, null); // Blue gradient default
    } else {
        // --- WAITING ---
        setButtonState("WAITING FOR OPPONENT...", false, "#333");
    }
}

function setButtonState(text, enabled, color) {
    const btn = document.getElementById('play-btn');
    btn.innerText = text;
    btn.disabled = !enabled;
    if (enabled) {
        btn.classList.add('ready');
        btn.style.background = ""; // Use CSS gradient
    } else {
        btn.classList.remove('ready');
        btn.style.background = color || "#333";
    }
}

// --- GAME LAUNCHER ---
function launchGame(myBoxId, oppBoxId, oppName, oppId) {
    // 1. Determine Match ID
    // Standardize ID: MATCH-L16-1 (Always use the lower number)
    const parts = myBoxId.split('-');
    const n1 = parseInt(parts[1]);
    const n2 = parseInt(oppBoxId.split('-')[1]);
    const matchNum = Math.min(n1, n2);
    const matchCode = `MATCH-${parts[0]}-${matchNum}`;

    // 2. Determine Role (Host/Guest)
    // Safe ID comparison
    const myId = localStorage.getItem('isf_my_id'); // Set in setup
    const role = (myId < oppId) ? 'host' : 'guest';

    // 3. Save Session Data
    localStorage.setItem('isf_role', role);
    localStorage.setItem('isf_code', matchCode);
    localStorage.setItem('isf_tourney_opponent', oppName);

    // 4. Open Game Iframe
    const overlay = document.getElementById('game-overlay');
    const frame = document.getElementById('game-frame');
    overlay.style.display = 'block';
    
    // We go FIRST to the "Hype" screen, then the game
    frame.src = 'friend-match.html'; 
}

// --- RESULT HANDLING ---
// Listen for "GAME_OVER" message from the iframe
window.addEventListener('message', (event) => {
    if (event.data.type === 'GAME_OVER') {
        const result = event.data.result; // 'win' or 'loss'
        
        // Close Overlay
        document.getElementById('game-overlay').style.display = 'none';
        document.getElementById('game-frame').src = '';

        if (result === 'win') {
            advancePlayer();
        } else {
            setButtonState("ELIMINATED", false, "#555");
            // Clear highlights
            document.querySelectorAll('.my-match').forEach(el => el.classList.remove('my-match'));
        }
    }
});

function advancePlayer() {
    const myName = state.myName;
    // Find current box
    let currentBox = null;
    document.querySelectorAll('.match-box.occupied').forEach(box => {
        if (box.innerText === myName) currentBox = box;
    });

    if (!currentBox) return;

    // Calculate Next Slot
    // Logic: L16-1 -> LQF-1. L16-3 -> LQF-2.
    const idParts = currentBox.id.split('-');
    const round = idParts[0]; // "L16"
    const num = parseInt(idParts[1]);

    let nextRound = "";
    if (round.includes("16")) nextRound = round.replace("16", "QF");
    else if (round.includes("QF")) nextRound = round.replace("QF", "SF");
    else if (round.includes("SF")) nextRound = "FINAL";

    let nextNum = Math.ceil(num / 2);
    
    // Special Case: Final
    let nextId = "";
    if (nextRound === "FINAL") {
        const side = round.charAt(0); // "L" or "R"
        nextId = `FINAL-${side}`;
    } else {
        nextId = `${nextRound}-${nextNum}`;
    }

    // Move visual
    const nextBox = document.getElementById(nextId);
    if (nextBox) {
        nextBox.innerText = myName;
        nextBox.classList.add('occupied');
        nextBox.classList.add('my-match');
        currentBox.classList.remove('my-match'); // Clear old highlight
        
        // Re-run check to see if next opponent is waiting
        checkMyNextMatch();
    }
}
