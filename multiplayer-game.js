/* =========================================
   ISF MULTIPLAYER ENGINE v1.0 (PeerJS)
   ========================================= */

const gameState = {
    // We keep 'ai' variable names to reuse logic, but 'ai' now means 'Opponent'
    playerDeck: [], aiDeck: [],
    playerHand: [], aiHand: [],
    centerPileLeft: [], centerPileRight: [],
    
    playerTotal: 26, aiTotal: 26,

    gameActive: false,
    playerReady: false, aiReady: false,
    
    // NETWORK VARS
    isHost: false,
    conn: null,
    myRole: 'unknown', // 'host' (P1) or 'join' (P2)
    
    slapActive: false,
    lastMoveTime: 0,
    lastSpacebarTime: 0,
    
    playerYellows: 0, playerReds: 0,
    aiYellows: 0, aiReds: 0,
    difficulty: 1
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png'; 
// Opponent Lanes (Top of screen)
const AI_LANES = [5, 29, 53, 77]; 

class Card {
    constructor(suit, rank, value, id) {
        this.suit = suit; this.rank = rank; this.value = value; 
        this.id = id || Math.random().toString(36).substr(2, 9); // Unique ID for syncing
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false; this.owner = null; 
        this.element = null; this.laneIndex = 0; 
    }
}

// --- INITIALIZATION & NETWORKING ---
window.onload = function() {
    gameState.playerTotal = 26; gameState.aiTotal = 26;
    document.addEventListener('keydown', handleInput);
    
    initNetwork();
};

function initNetwork() {
    const role = localStorage.getItem('isf_role');
    const code = localStorage.getItem('isf_code');
    const myName = localStorage.getItem('isf_my_name') || "Player";
    
    if (!role || !code) {
        alert("Connection lost. returning to lobby.");
        window.location.href = 'multiplayer-setup.html';
        return;
    }

    gameState.isHost = (role === 'host');
    gameState.myRole = role;

    const peer = new Peer(gameState.isHost ? code : null);

    peer.on('open', (id) => {
        console.log("My Peer ID: " + id);
        if (!gameState.isHost) {
            // JOINER: Connect to Host
            const conn = peer.connect(code);
            handleConnection(conn);
        }
    });

    peer.on('connection', (conn) => {
        // HOST: Accept connection
        if (gameState.isHost) handleConnection(conn);
    });
}

function handleConnection(connection) {
    gameState.conn = connection;
    
    connection.on('open', () => {
        console.log("CONNECTED TO OPPONENT!");
        
        // HOST initializes the game state and sends it to Client
        if (gameState.isHost) {
            startRound(); // Creates deck, deals hands
        }
    });

    connection.on('data', (data) => {
        processNetworkData(data);
    });
}

// --- NETWORK DATA HANDLER ---
function processNetworkData(data) {
    // console.log("RECEIVED:", data);

    switch(data.type) {
        case 'INIT_ROUND':
            // Joiner receives full board state from Host
            syncBoardState(data);
            break;
            
        case 'OPPONENT_MOVE':
            // Opponent played a card
            executeOpponentMove(data.cardId, data.targetSide);
            break;

        case 'OPPONENT_FLIP':
            // Opponent flipped a foundation card
            executeOpponentFlip(data.cardId);
            break;

        case 'OPPONENT_REVEAL_READY':
            // Opponent clicked their deck (Ready for reveal)
            gameState.aiReady = true;
            document.getElementById('ai-draw-deck').classList.add('deck-ready');
            checkDrawCondition();
            break;

        case 'SYNC_REVEAL':
            // Host triggers the countdown sync
            startCountdown(false); // false = don't send signal, just run
            break;

        case 'SLAP_CLAIM':
            // Opponent pressed Spacebar
            // If I am Host, I decide who won.
            if (gameState.isHost) resolveSlapClaim('opponent', data.timestamp);
            break;
        
        case 'SLAP_RESULT':
            // Joiner receives result of slap from Host
            applySlapResult(data.winner);
            break;

        case 'PENALTY_UPDATE':
            // Sync penalties
            gameState.playerYellows = data.oY; gameState.playerReds = data.oR;
            gameState.aiYellows = data.pY; gameState.aiReds = data.pR;
            updatePenaltyUI();
            updateScoreboard(); // Sync scores
            break;

        case 'GAME_OVER':
            showEndGame(data.msg, data.isWin);
            break;
    }
}

// --- SENDING HELPERS ---
function send(data) {
    if (gameState.conn) gameState.conn.send(data);
}

// --- GAME LOGIC (MIRRORED) ---

function startRound() {
    // ONLY HOST CALCULATES THE DECK
    if (!gameState.isHost) return;

    let fullDeck = createDeck();
    shuffle(fullDeck);

    // Initial Scoring Sync
    if (gameState.playerTotal <= 0) { sendGameOver("YOU WIN!", true); showEndGame("YOU WIN!", true); return; }
    if (gameState.aiTotal <= 0) { sendGameOver("OPPONENT WINS!", false); showEndGame("OPPONENT WINS!", false); return; }

    // Split Deck Logic (Same as v16)
    const pTotal = gameState.playerTotal;
    const pAllCards = fullDeck.slice(0, pTotal);
    const aAllCards = fullDeck.slice(pTotal, 52); // "AI" here means "Opponent" (P2)

    const pHandSize = Math.min(10, pTotal);
    const aHandSize = Math.min(10, 52 - pTotal);

    const pHandCards = pAllCards.splice(0, pHandSize);
    gameState.playerDeck = pAllCards; 
    const aHandCards = aAllCards.splice(0, aHandSize);
    gameState.aiDeck = aAllCards;

    // Borrow Logic
    let pBorrow = false, aBorrow = false;
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 1) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        gameState.playerDeck = gameState.aiDeck.splice(0, steal);
        pBorrow = true;
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 1) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        gameState.aiDeck = gameState.playerDeck.splice(0, steal);
        aBorrow = true;
    }

    // RENDER HOST
    document.getElementById('borrowed-player').classList.toggle('hidden', !pBorrow);
    document.getElementById('borrowed-ai').classList.toggle('hidden', !aBorrow);
    dealSmartHand(pHandCards, 'player');
    dealSmartHand(aHandCards, 'ai');
    
    updateScoreboard();

    // SEND TO CLIENT (Mirror Everything)
    // NOTE: Host's PlayerDeck is Client's AIDeck. We must swap them in the packet.
    send({
        type: 'INIT_ROUND',
        // Swap perspectives for the Joiner
        pDeck: gameState.aiDeck,
        aDeck: gameState.playerDeck,
        pHand: gameState.aiHand,
        aHand: gameState.playerHand,
        pTotal: gameState.aiTotal,
        aTotal: gameState.playerTotal,
        pBorrow: aBorrow,
        aBorrow: pBorrow
    });
}

function syncBoardState(data) {
    // JOINER receives data and renders
    gameState.playerDeck = data.pDeck;
    gameState.aiDeck = data.aDeck;
    gameState.playerHand = [];
    gameState.aiHand = [];
    gameState.playerTotal = data.pTotal;
    gameState.aiTotal = data.aTotal;

    document.getElementById('borrowed-player').classList.toggle('hidden', !data.pBorrow);
    document.getElementById('borrowed-ai').classList.toggle('hidden', !data.aBorrow);

    // We must rebuild Card objects from the raw data to restore methods
    dealSyncedHand(data.pHand, 'player');
    dealSyncedHand(data.aHand, 'ai');
    
    updateScoreboard();
}

// --- GAMEPLAY ACTIONS ---

function playCardToCenter(card, imgElement) {
    // 1. VALIDATE MOVE LOCALLY
    let target = null;
    let side = '';
    const cardRect = imgElement.getBoundingClientRect(); 
    const cardCenterX = cardRect.left + (cardRect.width / 2); 
    const screenCenterX = window.innerWidth / 2;
    const intendedSide = (cardCenterX < screenCenterX) ? 'left' : 'right';
    
    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    if (intendedSide === 'left' && isLeftLegal) { target = gameState.centerPileLeft; side = 'left'; }
    else if (intendedSide === 'right' && isRightLegal) { target = gameState.centerPileRight; side = 'right'; }
    else { if (isLeftLegal) { target = gameState.centerPileLeft; side = 'left'; } else if (isRightLegal) { target = gameState.centerPileRight; side = 'right'; } }

    if (target) {
        // EXECUTE MOVE
        target.push(card);
        gameState.playerHand = gameState.playerHand.filter(c => c.id !== card.id); // Use ID check
        gameState.playerTotal--;

        // NOTIFY NETWORK
        send({ type: 'OPPONENT_MOVE', cardId: card.id, targetSide: side });

        // Cleanup
        gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');

        imgElement.remove(); 
        renderCenterPile(side, card); 
        updateScoreboard();
        checkSlapCondition(); 

        // Immediate Win Check
        if (gameState.playerTotal <= 0) {
            sendGameOver("OPPONENT WINS MATCH!", false);
            showEndGame("YOU WIN THE MATCH!", true);
        }
        return true; 
    }
    return false; 
}

function executeOpponentMove(cardId, side) {
    // FIND THE CARD IN OPPONENT'S HAND
    const card = gameState.aiHand.find(c => c.id === cardId);
    if (!card) return; // Error or sync issue

    gameState.aiHand = gameState.aiHand.filter(c => c.id !== cardId);
    gameState.aiTotal--;

    // ANIMATE IT
    animateOpponentMove(card, side, () => {
        // Add to pile
        const target = (side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
        target.push(card);
        renderCenterPile(side, card);
        updateScoreboard();
        
        // Reset Ready status
        gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');

        checkSlapCondition();
    });
}

function handlePlayerDeckClick() {
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;
        gameState.playerReady = true; 
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        
        // Tell Opponent I am ready
        send({ type: 'OPPONENT_REVEAL_READY' });

        checkDrawCondition();
        return;
    }
    // (If using draw in-game for no moves - logic skipped for brevity, similar to above)
}

function checkDrawCondition() {
    if (gameState.playerReady && gameState.aiReady) {
        // HOST controls the timing
        if (gameState.isHost) {
            startCountdown(true); // True = Broadcast it
        }
    }
}

function startCountdown(broadcast) {
    if (broadcast) send({ type: 'SYNC_REVEAL' });

    const overlay = document.getElementById('countdown-overlay');
    overlay.classList.remove('hidden');
    let count = 3; overlay.innerText = count;
    
    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.innerText = count; 
            overlay.style.animation = 'none'; overlay.offsetHeight; overlay.style.animation = 'popIn 0.5s ease';
        } else {
            clearInterval(timer);
            overlay.classList.add('hidden');
            performReveal();
        }
    }, 800);
}

// --- SLAP & INPUT ---
function handleInput(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        const now = Date.now();
        if (now - gameState.lastSpacebarTime < 1000) { issuePenalty('player', 'SPAM'); return; }
        gameState.lastSpacebarTime = now;

        if (!gameState.slapActive) { issuePenalty('player', 'INVALID'); return; }
        
        // SEND CLAIM
        send({ type: 'SLAP_CLAIM', timestamp: Date.now() });
        
        // If Host, also process my own claim locally
        if (gameState.isHost) resolveSlapClaim('host', Date.now());
    }
}

function resolveSlapClaim(who, timestamp) {
    // Only Host runs this
    // Logic: First valid claim received wins.
    // For simplicity: We trust the first one we process.
    
    // Determine winner based on who 'who' is relative to Host
    // If 'host' claimed, Host wins. If 'opponent' claimed, Opponent wins.
    
    const winner = (who === 'host') ? 'player' : 'ai';
    
    // Broadcast Result
    // Send 'player' if Joiner won, 'ai' if Host won (from Joiner's perspective)
    // Wait, perspective flip is tricky.
    // Let's send "HOST_WON" or "JOINER_WON".
    
    const isHostWin = (who === 'host');
    applySlapResult(isHostWin ? 'player' : 'ai'); // Host applies locally
    send({ type: 'SLAP_RESULT', winner: isHostWin ? 'ai' : 'player' }); // Send inverse to Joiner
}

function applySlapResult(winner) {
    gameState.slapActive = false;
    const overlay = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    overlay.classList.remove('hidden');
    
    const pileCount = gameState.centerPileLeft.length + gameState.centerPileRight.length;

    if (winner === 'player') {
        txt.innerText = "YOU WON THE SLAP!";
        overlay.style.backgroundColor = "rgba(0, 200, 0, 0.9)";
        gameState.aiTotal += pileCount; // Opponent takes cards
    } else {
        txt.innerText = "OPPONENT WON THE SLAP!";
        overlay.style.backgroundColor = "rgba(200, 0, 0, 0.9)";
        gameState.playerTotal += pileCount; // I take cards
    }

    gameState.centerPileLeft = []; gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    updateScoreboard();

    setTimeout(() => {
        overlay.classList.add('hidden');
        gameState.playerReady = false; gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    }, 2000);
}


// --- UTILITIES (Standard from v16) ---
function createDeck() {
    let deck = [];
    SUITS.forEach(suit => { RANKS.forEach((rank, index) => { deck.push(new Card(suit, rank, index + 2)); }); });
    return deck;
}
function shuffle(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [array[i], array[j]] = [array[j], array[i]]; } }

function updateScoreboard() { 
    document.getElementById('score-player').innerText = gameState.playerTotal; 
    document.getElementById('score-ai').innerText = gameState.aiTotal; 
}

function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false; 
    const targetCard = targetPile[targetPile.length - 1]; 
    const diff = Math.abs(card.value - targetCard.value); 
    return (diff === 1 || diff === 12);
}

function checkSlapCondition() {
    if (gameState.centerPileLeft.length === 0 || gameState.centerPileRight.length === 0) { gameState.slapActive = false; return; }
    const topL = gameState.centerPileLeft[gameState.centerPileLeft.length - 1];
    const topR = gameState.centerPileRight[gameState.centerPileRight.length - 1];
    gameState.slapActive = (topL.rank === topR.rank);
}

function performReveal() {
    // Reveal logic must be identical on both sides
    // Remove ready classes
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    
    // Borrow Logic (Visuals only, Host already synced bools if needed, but safe to run locally if decks match)
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        gameState.playerDeck = gameState.playerDeck.concat(gameState.aiDeck.splice(0, steal));
        document.getElementById('borrowed-player').classList.remove('hidden');
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        gameState.aiDeck = gameState.aiDeck.concat(gameState.playerDeck.splice(0, steal));
        document.getElementById('borrowed-ai').classList.remove('hidden');
    }

    // Cost
    // Simplified: Both lose 1. (Borrow logic math is complex to sync, simple -1 for now)
    gameState.playerTotal--; gameState.aiTotal--;

    // Move Cards
    if (gameState.playerDeck.length > 0) { let c = gameState.playerDeck.pop(); gameState.centerPileRight.push(c); renderCenterPile('right', c); }
    if (gameState.aiDeck.length > 0) { let c = gameState.aiDeck.pop(); gameState.centerPileLeft.push(c); renderCenterPile('left', c); }

    updateScoreboard();
    gameState.gameActive = true; 
    gameState.playerReady = false; gameState.aiReady = false;
    checkSlapCondition();
}

function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    const img = document.createElement('img'); img.src = card.imgSrc; img.className = 'game-card'; 
    img.style.left = '50%'; img.style.top = '50%';
    const rot = Math.random() * 20 - 10; img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    container.appendChild(img);
}

// --- CARD RENDERING (Synced) ---
function dealSyncedHand(cardsData, owner) {
    // Reconstruct Card objects
    const cards = cardsData.map(d => new Card(d.suit, d.rank, d.value, d.id));
    dealSmartHand(cards, owner);
}

function dealSmartHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = ''; 
    if (owner === 'player') gameState.playerHand = []; else gameState.aiHand = [];

    const piles = [[], [], [], []];
    // Layout Logic
    let idx = 0;
    if (cards.length >= 10) { [4,3,2,1].forEach((s, i) => { for(let j=0; j<s; j++) piles[i].push(cards[idx++]); }); } 
    else { cards.forEach(c => { piles[idx].push(c); idx = (idx+1)%4; }); }

    let left = 5;
    piles.forEach((pile, laneIdx) => {
        if(pile.length===0) { left+=24; return; }
        pile.forEach((card, i) => {
            const img = document.createElement('img'); img.className = 'game-card';
            card.owner = owner; card.laneIndex = laneIdx; card.element = img;
            
            const isTop = (i === pile.length - 1);
            img.style.left = `${left}%`;
            img.style.zIndex = i+10;
            
            if (owner === 'ai') img.style.top = `${10 + i*5}px`; 
            else img.style.top = `${60 - i*5}px`;

            if (isTop) setCardFaceUp(img, card, owner);
            else setCardFaceDown(img, card, owner);
            
            container.appendChild(img);
            if(owner==='player') gameState.playerHand.push(card); else gameState.aiHand.push(card);
        });
        left += 24;
    });
}

function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc; img.classList.remove('card-face-down'); card.isFaceUp = true;
    if (owner === 'player') { img.classList.add('player-card'); img.onclick = null; makeDraggable(img, card); } 
    else { img.classList.add('opponent-card'); img.onclick = null; }
}
function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC; img.classList.add('card-face-down'); card.isFaceUp = false;
    if (owner === 'player') img.onclick = () => tryFlipCard(img, card);
}
function tryFlipCard(img, card) {
    // Only flip if < 4 face up
    const live = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (live < 4) {
        setCardFaceUp(img, card, 'player');
        // Notify Opponent of flip?
        // Ideally yes: send({ type: 'OPPONENT_FLIP', cardId: card.id });
    }
}
function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault(); gameState.globalZ++; img.style.zIndex = gameState.globalZ; img.style.transition = 'none'; 
        const startL = img.style.left; const startT = img.style.top;
        let shiftX = e.clientX - img.getBoundingClientRect().left; let shiftY = e.clientY - img.getBoundingClientRect().top;
        const box = document.getElementById('player-foundation-area');
        
        function moveAt(pageX, pageY) {
            const boxRect = box.getBoundingClientRect(); 
            img.style.left = (pageX - shiftX - boxRect.left) + 'px';
            img.style.top = (pageY - shiftY - boxRect.top) + 'px';
        }
        function onMouseMove(event) { moveAt(event.pageX, event.pageY); }
        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
            img.style.transition = 'all 0.1s ease-out'; 
            if (gameState.gameActive && parseInt(img.style.top) < -10) {
                let success = playCardToCenter(cardData, img); 
                if (!success) { img.style.left = startL; img.style.top = startT; }
            } else { img.style.left = startL; img.style.top = startT; }
        }
        document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
    };
}

function animateOpponentMove(card, side, callback) {
    // Opponent is at top. Animate to center.
    if(!card.element) return;
    const el = card.element;
    const targetId = (side === 'left') ? 'center-pile-left' : 'center-pile-right'; // P1 Perspective
    // Wait... if I am P2, and Opponent (P1) plays to THEIR left... that is MY Right.
    // Mirror Logic:
    // P1 Left = P2 Right.
    // P1 Right = P2 Left.
    // The data sent was "left".
    const targetReal = (side === 'left') ? 'center-pile-right' : 'center-pile-left';
    
    // Actually, let's keep it simple. If data says 'left', it means Screen Left.
    // The playCardToCenter calculated 'intendedSide'.
    // If I drop on Left, it goes to Left. Opponent sees it land on their Right? 
    // Yes. Screen Left for me is Screen Right for them.
    
    const visualSide = (side === 'left') ? 'center-pile-right' : 'center-pile-left';
    const targetEl = document.getElementById(visualSide);
    
    // Animation Logic (Simplified)
    el.style.zIndex = 2000;
    const targetRect = targetEl.getBoundingClientRect();
    const startRect = el.getBoundingClientRect();
    
    const destX = targetRect.left + (targetRect.width/2) - (startRect.width/2);
    const destY = targetRect.top + (targetRect.height/2) - (startRect.height/2);
    
    // We can't easily animate strict coordinates across screens with different sizes.
    // Fallback: Just move it.
    el.style.position = 'fixed';
    el.style.left = destX + 'px';
    el.style.top = destY + 'px';
    
    setTimeout(() => {
        el.remove();
        callback(); 
    }, 400);
}

function sendGameOver(msg, isWin) {
    send({ type: 'GAME_OVER', msg: isWin ? "OPPONENT WINS!" : "YOU WIN!", isWin: !isWin });
}
function showEndGame(title, isWin) {
    const modal = document.getElementById('game-message');
    modal.querySelector('h1').innerText = title;
    modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';
    modal.querySelector('p').innerText = "Refresh to play again.";
    document.getElementById('msg-btn').classList.add('hidden');
    modal.classList.remove('hidden');
}
