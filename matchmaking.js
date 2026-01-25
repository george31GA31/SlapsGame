/* =========================================
   MATCHMAKING ENGINE (Serverless Bucket System)
   ========================================= */

const myName = localStorage.getItem('isf_my_name') || "Player " + Math.floor(Math.random()*1000);
let peer = null;
let conn = null;
let searchTimer = null;
let seconds = 0;

// Bucket Logic: We use 5 "public lobbies". 
// You try to join one. If it fails, you host it.
const LOBBY_ID_BASE = "isf-public-match-v1-"; 
const LOBBY_BUCKETS = 10; // 10 potential rooms to prevent collision
let currentBucketIndex = Math.floor(Math.random() * LOBBY_BUCKETS); 

window.onload = function() {
    startTimer();
    attemptMatchmaking();
};

function startTimer() {
    const timerEl = document.getElementById('timer');
    searchTimer = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        timerEl.innerText = `${mins}:${secs}`;
    }, 1000);
}

function attemptMatchmaking() {
    // 1. Determine which "Lobby ID" we are checking
    const targetLobbyId = LOBBY_ID_BASE + currentBucketIndex;
    console.log(`Checking Lobby: ${targetLobbyId}`);

    // 2. Initialize PeerJS TEMPORARILY to check if ID exists
    // We try to connect as a Guest first.
    peer = new Peer();

    peer.on('open', (myTempId) => {
        // We have our own ID, now try to connect to the Lobby ID
        const connectionAttempt = peer.connect(targetLobbyId, {
            reliable: true
        });

        // A. IF CONNECTION SUCCESSFUL -> WE ARE GUEST
        connectionAttempt.on('open', () => {
            console.log("Opponent Found! I am the GUEST.");
            conn = connectionAttempt;
            handleMatchFound('guest', targetLobbyId, "Opponent"); // We wait for name
        });

        // B. IF CONNECTION FAILS (PeerUnavailable) -> WE BECOME HOST
        peer.on('error', (err) => {
            if (err.type === 'peer-unavailable') {
                console.log(`Lobby ${targetLobbyId} empty. Becoming HOST.`);
                peer.destroy(); // Kill the "Guest" peer
                becomeHost(targetLobbyId); // Start new "Host" peer
            } else {
                console.error("Peer Error:", err);
            }
        });
    });
}

function becomeHost(lobbyId) {
    // Initialize Peer with the specific Lobby ID
    peer = new Peer(lobbyId);

    peer.on('open', (id) => {
        console.log(`Hosting Public Lobby: ${id}`);
    });

    peer.on('connection', (connection) => {
        console.log("Opponent Connected! I am the HOST.");
        conn = connection;
        
        // Wait for connection to fully open then signal success
        conn.on('open', () => {
            handleMatchFound('host', lobbyId, "Challenger");
        });
    });

    peer.on('error', (err) => {
        // If this ID is taken suddenly (race condition), try next bucket
        if(err.type === 'unavailable-id') {
            console.warn("Race condition! Lobby taken. Trying next...");
            currentBucketIndex = (currentBucketIndex + 1) % LOBBY_BUCKETS;
            attemptMatchmaking();
        }
    });
}

function handleMatchFound(role, code, defaultOpponentName) {
    clearInterval(searchTimer);
    
    // UI Updates
    document.body.classList.add('match-found');
    const statusText = document.getElementById('status-text');
    statusText.innerText = "OPPONENT FOUND!";
    
    // Exchange Names
    if (conn) {
        conn.send({ type: 'HANDSHAKE', name: myName });
        conn.on('data', (data) => {
            if (data.type === 'HANDSHAKE') {
                statusText.innerText = `CONNECTED TO ${data.name.toUpperCase()}`;
                
                // Store Data for the Game Engine
                localStorage.setItem('isf_role', role);
                localStorage.setItem('isf_code', code); // Host uses this to reopen peer
                
                // Delay slightly to let user see the green circle
                setTimeout(() => {
                    window.location.href = 'multiplayer-game.html';
                }, 2000);
            }
        });
    }
}
