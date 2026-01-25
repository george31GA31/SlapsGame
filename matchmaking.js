/* =========================================
   MATCHMAKING ENGINE (With Name Input)
   ========================================= */

let myName = "Player";
let peer = null;
let conn = null;
let searchTimer = null;
let seconds = 0;

// FOR TESTING: Keep this at 1 so you connect instantly.
// For real release, change back to 10 or 20.
const LOBBY_BUCKETS = 1; 
let currentBucketIndex = Math.floor(Math.random() * LOBBY_BUCKETS); 
const LOBBY_ID_BASE = "isf-public-match-v1-"; 

window.onload = function() {
    // 1. Auto-fill the input if we have a saved name
    const savedName = localStorage.getItem('isf_my_name');
    const inputField = document.getElementById('nickname-input');
    if (savedName && inputField) {
        inputField.value = savedName;
    }
};

function startSearch() {
    // 2. Get Name from Input
    const inputField = document.getElementById('nickname-input');
    const enteredName = inputField.value.trim();

    if (!enteredName) {
        alert("Please enter a nickname!");
        return;
    }

    myName = enteredName;
    localStorage.setItem('isf_my_name', myName); // Save for next time

    // 3. Switch Screens
    document.getElementById('name-setup').classList.add('hidden');
    document.getElementById('search-ui').classList.remove('hidden');

    // 4. Start the Logic
    startTimer();
    attemptMatchmaking();
}

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
    const targetLobbyId = LOBBY_ID_BASE + currentBucketIndex;
    console.log(`Checking Lobby: ${targetLobbyId}`);

    peer = new Peer();

    peer.on('open', (myTempId) => {
        const connectionAttempt = peer.connect(targetLobbyId, { reliable: true });

        // A. IF CONNECTION SUCCESSFUL -> WE ARE GUEST
        connectionAttempt.on('open', () => {
            console.log("Opponent Found! I am the GUEST.");
            conn = connectionAttempt;
            handleMatchFound('guest', targetLobbyId, "Opponent");
        });

        // B. IF CONNECTION FAILS -> WE BECOME HOST
        peer.on('error', (err) => {
            if (err.type === 'peer-unavailable') {
                console.log(`Lobby empty. Becoming HOST.`);
                peer.destroy(); 
                becomeHost(targetLobbyId); 
            } else {
                console.error("Peer Error:", err);
            }
        });
    });
}

function becomeHost(lobbyId) {
    peer = new Peer(lobbyId);

    peer.on('open', (id) => {
        console.log(`Hosting Public Lobby: ${id}`);
    });

    peer.on('connection', (connection) => {
        console.log("Opponent Connected! I am the HOST.");
        conn = connection;
        conn.on('open', () => {
            handleMatchFound('host', lobbyId, "Challenger");
        });
    });

    peer.on('error', (err) => {
        if(err.type === 'unavailable-id') {
            console.warn("Race condition! Lobby taken. Trying next...");
            currentBucketIndex = (currentBucketIndex + 1) % LOBBY_BUCKETS;
            attemptMatchmaking();
        }
    });
}

function handleMatchFound(role, code, defaultOpponentName) {
    clearInterval(searchTimer);
    
    document.body.classList.add('match-found');
    const statusText = document.getElementById('status-text');
    statusText.innerText = "OPPONENT FOUND!";
    
    if (conn) {
        conn.send({ type: 'HANDSHAKE', name: myName });
        conn.on('data', (data) => {
            if (data.type === 'HANDSHAKE') {
                statusText.innerText = `CONNECTED TO ${data.name.toUpperCase()}`;
                
                localStorage.setItem('isf_role', role);
                localStorage.setItem('isf_code', code);
                localStorage.setItem('isf_my_name', myName); // Ensure name is passed to game
                
                setTimeout(() => {
                    window.location.href = 'multiplayer-game.html';
                }, 2000);
            }
        });
    }
}
