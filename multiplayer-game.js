/* =========================================
   MULTIPLAYER-GAME.JS (PeerJS Version)
   Real-time Player vs Player SLAPS
   ========================================= */

const gameState = {
    playerDeck: [], opponentDeck: [],
    playerHand: [], opponentHand: [],
    centerPileLeft: [], centerPileRight: [],
    globalZ: 1000,
    playerTotal: 26, opponentTotal: 26,

    gameActive: false,
    playerReady: false, opponentReady: false,
    drawLock: false,
    countdownRunning: false,
    
    slapActive: false,
    lastSpacebarTime: 0,
    
    playerYellows: 0, playerReds: 0,
    opponentYellows: 0, opponentReds: 0,

    p1Rounds: 0, opponentRounds: 0,
    p1Slaps: 0, opponentSlaps: 0,
    
    // PeerJS specific
    peer: null,
    conn: null,
    myName: "You",
    opponentName: "Opponent",
    isHost: false,
    connected: false,
    
    // Card loading optimization
    imageCache: new Map(),
    cardsLoaded: false,
    
    // Drag tracking for opponent
    opponentDragging: null
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png';

class Card {
    constructor(suit, rank, value) {
        this.suit = suit;
        this.rank = rank;
        this.value = value;
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false;
        this.owner = null;
        this.element = null;
        this.laneIndex = 0;
    }
}

// ========================================
// INITIALIZATION & CONNECTION
// ========================================

window.onload = function() {
    // Get info from localStorage (set by matchmaking)
    const role = localStorage.getItem('isf_role');
    const code = localStorage.getItem('isf_code');
    const myName = localStorage.getItem('isf_my_name') || 'You';
    
    if (!role || !code) {
        showError("No game session found. Returning to setup...");
        setTimeout(() => window.location.href = 'matchmaking.html', 2000);
        return;
    }
    
    gameState.isHost = (role === 'host');
    gameState.myName = myName;
    
    console.log(`Initializing as ${role} with code ${code}`);
    
    // Preload card images
    preloadCardImages();
    
    document.addEventListener('keydown', handleInput);
    
    const pDeck = document.getElementById('player-draw-deck');
    if(pDeck) pDeck.onclick = handlePlayerDeckClick;

    updateScoreboardWidget();
    
    // Establish PeerJS connection
    connectToPeer(role, code);
};

function preloadCardImages() {
    let loadedCount = 0;
    const totalImages = SUITS.length * RANKS.length + 1;
    
    const backImg = new Image();
    backImg.onload = () => {
        gameState.imageCache.set(CARD_BACK_SRC, backImg);
        loadedCount++;
        if (loadedCount >= totalImages) {
            gameState.cardsLoaded = true;
            console.log("All card images preloaded");
        }
    };
    backImg.src = CARD_BACK_SRC;
    
    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            const src = `assets/cards/${rank}_of_${suit}.png`;
            const img = new Image();
            img.onload = () => {
                gameState.imageCache.set(src, img);
                loadedCount++;
                if (loadedCount >= totalImages) {
                    gameState.cardsLoaded = true;
                    console.log("All card images preloaded");
                }
            };
            img.onerror = () => {
                console.warn(`Failed to load: ${src}`);
                loadedCount++;
            };
            img.src = src;
        });
    });
}

function connectToPeer(role, code) {
    if (role === 'host') {
        // Re-create peer with same ID
        gameState.peer = new Peer(code);
        
        gameState.peer.on('open', (id) => {
            console.log('Host peer opened:', id);
            showMessage("Waiting for opponent to reconnect...");
        });
        
        gameState.peer.on('connection', (connection) => {
            gameState.conn = connection;
            setupConnection();
            showMessage("Opponent connected! Starting game...");
            
            // Wait for cards to load, then start
            waitForCardsAndStart();
        });
        
        gameState.peer.on('error', (err) => {
            console.error('Peer error:', err);
            showError("Connection error: " + err.type);
        });
        
    } else {
        // Joiner
        gameState.peer = new Peer();
        
        gameState.peer.on('open', (id) => {
            console.log('Joiner peer opened:', id);
            showMessage("Connecting to host...");
            
            // Connect to host
            gameState.conn = gameState.peer.connect(code);
            
            gameState.conn.on('open', () => {
                console.log('Connected to host');
                setupConnection();
                showMessage("Connected! Waiting for game start...");
                
                // Send ready signal
                sendToPeer({ type: 'joiner_ready' });
            });
            
            gameState.conn.on('error', (err) => {
                console.error('Connection error:', err);
                showError("Could not connect to host");
            });
        });
    }
}

function waitForCardsAndStart() {
    const checkInterval = setInterval(() => {
        if (gameState.cardsLoaded) {
            clearInterval(checkInterval);
            setTimeout(() => startRound(), 1000);
        }
    }, 100);
    
    // Timeout after 10 seconds
    setTimeout(() => {
        clearInterval(checkInterval);
        if (!gameState.cardsLoaded) {
            console.warn("Card loading timeout, starting anyway");
            startRound();
        }
    }, 10000);
}

function setupConnection() {
    gameState.connected = true;
    
    gameState.conn.on('data', (data) => {
        handlePeerMessage(data);
    });
    
    gameState.conn.on('close', () => {
        console.log('Connection closed');
        handleOpponentDisconnect();
    });
}

function sendToPeer(data) {
    if (gameState.conn && gameState.conn.open) {
        gameState.conn.send(data);
    }
}

function handlePeerMessage(data) {
    console.log('Received:', data.type);
    
    switch(data.type) {
        case 'joiner_ready':
            if (gameState.isHost) {
                waitForCardsAndStart();
            }
            break;
            
        case 'initial_deal':
            receiveInitialDeal(data);
            break;
            
        case 'opponent_ready':
            gameState.opponentReady = true;
            document.getElementById('ai-draw-deck').classList.add('deck-ready');
            checkDrawCondition();
            break;
            
        case 'reveal_card':
            handleOpponentReveal(data);
            break;
            
        case 'card_played':
            handleOpponentCardPlay(data);
            break;
            
        case 'card_dragging':
            handleOpponentDragging(data);
            break;
            
        case 'slap':
            handleOpponentSlap(data);
            break;
            
        case 'penalty':
            handleOpponentPenalty(data);
            break;
            
        case 'quit':
            handleOpponentQuit();
            break;
    }
}

// ========================================
// INPUT HANDLING
// ========================================

function handleInput(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        if (!gameState.gameActive || !gameState.connected) return;

        const now = Date.now();
        if (now - gameState.lastSpacebarTime < 400) return;
        gameState.lastSpacebarTime = now;

        if (!gameState.slapActive) {
            issuePenalty('player', 'BAD SLAP');
            return;
        }
        
        sendToPeer({
            type: 'slap',
            timestamp: now
        });
        
        // Resolve immediately (first to press wins in P2P)
        resolveSlap('player');
    }
}

// ========================================
// PENALTY SYSTEM
// ========================================

function issuePenalty(target, reason) {
    let yellows;
    if (target === 'player') {
        gameState.playerYellows++;
        yellows = gameState.playerYellows;
    } else {
        gameState.opponentYellows++;
        yellows = gameState.opponentYellows;
    }

    if (yellows >= 2) {
        if (target === 'player') {
            gameState.playerYellows = 0;
            gameState.playerReds++;
        } else {
            gameState.opponentYellows = 0;
            gameState.opponentReds++;
        }
        executeRedCardPenalty(target);
    }
    
    updatePenaltyUI();
    
    if (target === 'player') {
        sendToPeer({
            type: 'penalty',
            yellows: gameState.playerYellows,
            reds: gameState.playerReds
        });
    }
}

function handleOpponentPenalty(data) {
    gameState.opponentYellows = data.yellows;
    gameState.opponentReds = data.reds;
    updatePenaltyUI();
}

function executeRedCardPenalty(offender) {
    const victim = (offender === 'player') ? 'opponent' : 'player';
    let penaltyAmount = 3;
    
    let victimHand = (victim === 'player') ? gameState.playerHand : gameState.opponentHand;
    let victimDeck = (victim === 'player') ? gameState.playerDeck : gameState.opponentDeck;
    
    for (let i = 0; i < penaltyAmount; i++) {
        if (victimDeck.length > 0) {
            victimDeck.pop();
        } else if (victimHand.length > 0) {
            let cardToRemove = victimHand.pop();
            if (cardToRemove && cardToRemove.element) cardToRemove.element.remove();
        }
    }

    if (offender === 'player') {
        gameState.playerTotal += 3;
        gameState.opponentTotal = Math.max(0, gameState.opponentTotal - 3);
    } else {
        gameState.opponentTotal += 3;
        gameState.playerTotal = Math.max(0, gameState.playerTotal - 3);
    }

    if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
    if (gameState.opponentTotal <= 0) showEndGame("OPPONENT WINS THE MATCH!", false);

    updateScoreboard();
}

function updatePenaltyUI() {
    renderBadges('player', gameState.playerYellows, gameState.playerReds);
    renderBadges('ai', gameState.opponentYellows, gameState.opponentReds);
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

// ========================================
// SLAP MECHANICS
// ========================================

function checkSlapCondition() {
    if (gameState.centerPileLeft.length === 0 || gameState.centerPileRight.length === 0) {
        gameState.slapActive = false;
        return;
    }
    const topL = gameState.centerPileLeft[gameState.centerPileLeft.length - 1];
    const topR = gameState.centerPileRight[gameState.centerPileRight.length - 1];
    if (topL.rank === topR.rank) {
        gameState.slapActive = true;
    } else {
        gameState.slapActive = false;
    }
}

function handleOpponentSlap(data) {
    if (!gameState.slapActive) return;
    resolveSlap('opponent');
}

function resolveSlap(winner) {
    gameState.slapActive = false;
    gameState.gameActive = false;
    
    const overlay = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    if (!overlay || !txt) return;
    overlay.classList.remove('hidden');
    
    const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

    if (winner === 'player') {
        txt.innerText = "YOU WON THE SLAP!";
        overlay.style.backgroundColor = "rgba(0, 200, 0, 0.9)";
        gameState.opponentTotal += pilesTotal;
        gameState.p1Slaps++;
    } else {
        txt.innerText = "OPPONENT WON THE SLAP!";
        overlay.style.backgroundColor = "rgba(200, 0, 0, 0.9)";
        gameState.playerTotal += pilesTotal;
        gameState.opponentSlaps++;
    }

    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    
    updateScoreboard();
    updateScoreboardWidget();

    setTimeout(() => {
        overlay.classList.add('hidden');
        gameState.playerReady = false;
        gameState.opponentReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');
        
        if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
        if (gameState.opponentTotal <= 0) showEndGame("OPPONENT WINS THE MATCH!", false);
    }, 2000);
}

// ========================================
// GAME ENGINE
// ========================================

function startRound() {
    if (!gameState.connected) {
        showError("Waiting for opponent connection...");
        return;
    }
    
    console.log("Starting round...");
    
    if (gameState.playerTotal <= 0) {
        showEndGame("YOU WIN THE MATCH!", true);
        return;
    }
    if (gameState.opponentTotal <= 0) {
        showEndGame("OPPONENT WINS THE MATCH!", false);
        return;
    }

    // Only host creates and deals
    if (gameState.isHost) {
        let fullDeck = createDeck();
        shuffle(fullDeck);
        
        const pTotal = gameState.playerTotal;
        const pAllCards = fullDeck.slice(0, pTotal);
        const oAllCards = fullDeck.slice(pTotal, 52);

        const pHandSize = Math.min(10, pTotal);
        const oHandSize = Math.min(10, 52 - pTotal);

        const pHandCards = pAllCards.splice(0, pHandSize);
        gameState.playerDeck = pAllCards;
        
        const oHandCards = oAllCards.splice(0, oHandSize);
        gameState.opponentDeck = oAllCards;

        // Check shortage
        const borrowedPlayer = document.getElementById('borrowed-player');
        const borrowedAi = document.getElementById('borrowed-ai');
        if (borrowedPlayer) borrowedPlayer.classList.add('hidden');
        if (borrowedAi) borrowedAi.classList.add('hidden');

        if (gameState.playerDeck.length === 0 && gameState.opponentDeck.length > 1) {
            const steal = Math.floor(gameState.opponentDeck.length / 2);
            gameState.playerDeck = gameState.opponentDeck.splice(0, steal);
            if (borrowedPlayer) borrowedPlayer.classList.remove('hidden');
        }

        if (gameState.opponentDeck.length === 0 && gameState.playerDeck.length > 1) {
            const steal = Math.floor(gameState.playerDeck.length / 2);
            gameState.opponentDeck = gameState.playerDeck.splice(0, steal);
            if (borrowedAi) borrowedAi.classList.remove('hidden');
        }

        // Deal my hand
        dealSmartHand(pHandCards, 'player');
        
        // Send opponent their hand (mirrored)
        sendToPeer({
            type: 'initial_deal',
            hand: oHandCards.map(c => ({
                suit: c.suit,
                rank: c.rank,
                value: c.value,
                laneIndex: 3 - (pHandCards.indexOf(c) % 4) // Simple lane assignment
            })),
            deckCount: gameState.opponentDeck.length
        });
        
    } else {
        // Joiner waits for deal
        showMessage("Waiting for host to deal cards...");
    }
    
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    const leftPile = document.getElementById('center-pile-left');
    const rightPile = document.getElementById('center-pile-right');
    if (leftPile) leftPile.innerHTML = '';
    if (rightPile) rightPile.innerHTML = '';
    
    const gameMsg = document.getElementById('game-message');
    if (gameMsg) gameMsg.classList.add('hidden');
    
    gameState.slapActive = false;

    checkDeckVisibility();
    gameState.gameActive = false;
    updateScoreboard();
}

function receiveInitialDeal(data) {
    console.log("Received initial deal");
    
    const oppHand = data.hand.map(c => {
        const card = new Card(c.suit, c.rank, c.value);
        card.laneIndex = c.laneIndex;
        return card;
    });
    
    dealSmartHand(oppHand, 'player');
    gameState.playerDeck = new Array(data.deckCount).fill(null);
    
    // Create placeholder opponent hand (face down)
    createPlaceholderOpponentHand();
    
    checkDeckVisibility();
    updateScoreboard();
}

function createPlaceholderOpponentHand() {
    const oppArea = document.getElementById('ai-foundation-area');
    if (!oppArea) return;
    oppArea.innerHTML = '';
    
    // Create 4 stacks of face-down cards
    for (let lane = 0; lane < 4; lane++) {
        const stackSize = [4, 3, 2, 1][lane];
        for (let i = 0; i < stackSize; i++) {
            const img = document.createElement('img');
            img.src = CARD_BACK_SRC;
            img.className = 'game-card card-face-down opponent-card';
            img.style.left = `${5 + lane * 24}%`;
            img.style.top = `${10 + i * 5}px`;
            img.style.zIndex = i + 10;
            oppArea.appendChild(img);
        }
    }
}

function dealSmartHand(cards, owner) {
    const containerName = owner === 'player' ? 'player-foundation-area' : 'ai-foundation-area';
    const container = document.getElementById(containerName);
    if (!container) {
        console.error(`Container not found: ${containerName}`);
        return;
    }
    container.innerHTML = '';
    
    if (owner === 'player') gameState.playerHand = [];
    else gameState.opponentHand = [];

    const piles = [[], [], [], []];
    
    if (cards.length >= 10) {
        let cardIdx = 0;
        [4, 3, 2, 1].forEach((size, i) => {
            for (let j = 0; j < size; j++) {
                if (cards[cardIdx]) {
                    cards[cardIdx].laneIndex = i;
                    piles[i].push(cards[cardIdx++]);
                }
            }
        });
    } else {
        let pileIdx = 0;
        cards.forEach(card => {
            card.laneIndex = pileIdx;
            piles[pileIdx].push(card);
            pileIdx = (pileIdx + 1) % 4;
        });
    }

    let currentLeftPercent = 5;
    piles.forEach((pile, laneIdx) => {
        if (pile.length === 0) {
            currentLeftPercent += 24;
            return;
        }
        pile.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card';
            card.owner = owner;
            
            const isTopCard = (index === pile.length - 1);
            if (isTopCard) setCardFaceUp(img, card, owner);
            else setCardFaceDown(img, card, owner);
            
            img.style.left = `${currentLeftPercent}%`;
            let stackOffset = index * 5;
            if (owner === 'opponent') img.style.top = `${10 + stackOffset}px`;
            else img.style.top = `${60 - stackOffset}px`;
            img.style.zIndex = index + 10;
            
            card.element = img;
            container.appendChild(img);
            
            if (owner === 'player') gameState.playerHand.push(card);
            else gameState.opponentHand.push(card);
        });
        currentLeftPercent += 24;
    });
    
    console.log(`Dealt ${owner} hand:`, cards.length, 'cards');
}

function createDeck() {
    let deck = [];
    SUITS.forEach(suit => {
        RANKS.forEach((rank, index) => {
            deck.push(new Card(suit, rank, index + 2));
        });
    });
    return deck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function updateScoreboard() {
    const playerScore = document.getElementById('score-player');
    const oppScore = document.getElementById('score-ai');
    if (playerScore) playerScore.innerText = gameState.playerTotal;
    if (oppScore) oppScore.innerText = gameState.opponentTotal;
}

function checkDeckVisibility() {
    const playerDeck = document.getElementById('player-draw-deck');
    const oppDeck = document.getElementById('ai-draw-deck');
    if (playerDeck) playerDeck.classList.remove('hidden');
    if (oppDeck) oppDeck.classList.remove('hidden');
}

function endRound(winner) {
    gameState.gameActive = false;
    if (winner === 'player') {
        gameState.opponentTotal = 52 - gameState.playerTotal;
        gameState.p1Rounds++;
        showRoundMessage("ROUND WON!", `You start next round with ${gameState.playerTotal} cards.`);
    } else {
        gameState.playerTotal = 52 - gameState.opponentTotal;
        gameState.opponentRounds++;
        showRoundMessage("ROUND LOST!", `Opponent starts next round with ${gameState.opponentTotal} cards.`);
    }
    updateScoreboardWidget();
}

// ========================================
// CARD INTERACTIONS
// ========================================

function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc;
    img.classList.remove('card-face-down');
    card.isFaceUp = true;
    
    if (owner === 'player') {
        img.classList.add('player-card');
        img.onclick = null;
        makeDraggable(img, card);
    } else {
        img.classList.add('opponent-card');
    }
}

function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    card.isFaceUp = false;
    
    if (owner === 'player') {
        img.onclick = () => tryFlipCard(img, card);
    }
}

function tryFlipCard(img, card) {
    const liveCards = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (liveCards < 4) {
        setCardFaceUp(img, card, 'player');
    }
}

// ========================================
// DRAW PHASE
// ========================================

function handlePlayerDeckClick() {
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;
        gameState.playerReady = true;
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        
        sendToPeer({ type: 'opponent_ready' });
        return;
    }
    
    if (gameState.gameActive && !gameState.playerReady) {
        gameState.playerReady = true;
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        
        sendToPeer({ type: 'opponent_ready' });
        checkDrawCondition();
    }
}

function checkDrawCondition() {
    if (gameState.drawLock || gameState.countdownRunning) return;

    if (gameState.playerReady && gameState.opponentReady) {
        gameState.drawLock = true;
        setTimeout(() => startCountdown(), 50);
    }
}

function startCountdown() {
    if (gameState.countdownRunning) return;

    gameState.countdownRunning = true;
    gameState.gameActive = false;

    const overlay = document.getElementById('countdown-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    let count = 3;
    overlay.innerText = count;

    const timer = setInterval(() => {
        count--;

        if (count > 0) {
            overlay.innerText = count;
            overlay.style.animation = 'none';
            overlay.offsetHeight;
            overlay.style.animation = 'popIn 0.5s ease';
        } else {
            clearInterval(timer);
            overlay.classList.add('hidden');

            gameState.countdownRunning = false;
            performReveal();
        }
    }, 800);
}

function performReveal() {
    if (!gameState.drawLock) return;

    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    
    const playerBorrowing = document.getElementById('borrowed-player') && 
                           !document.getElementById('borrowed-player').classList.contains('hidden');
    const oppBorrowing = document.getElementById('borrowed-ai') && 
                        !document.getElementById('borrowed-ai').classList.contains('hidden');

    if (playerBorrowing) {
        gameState.opponentTotal--;
    } else {
        gameState.playerTotal--;
    }

    if (oppBorrowing) {
        gameState.playerTotal--;
    } else {
        gameState.opponentTotal--;
    }

    let pCard = null;
    if (gameState.playerDeck.length > 0) {
        pCard = gameState.playerDeck.pop();
        gameState.centerPileRight.push(pCard);
        renderCenterPile('right', pCard);
        
        sendToPeer({
            type: 'reveal_card',
            card: { suit: pCard.suit, rank: pCard.rank, value: pCard.value },
            side: 'left'
        });
    }
    
    checkDeckVisibility();
    updateScoreboard();
    
    gameState.gameActive = true;
    gameState.playerReady = false;
    gameState.opponentReady = false;
    
    checkSlapCondition();
    gameState.drawLock = false;
}

function handleOpponentReveal(data) {
    const card = new Card(data.card.suit, data.card.rank, data.card.value);
    gameState.centerPileLeft.push(card);
    renderCenterPile('left', card);
    checkSlapCondition();
}

function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);
    if (!container) return;
    
    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.className = 'game-card';
    img.style.left = '50%';
    img.style.top = '50%';
    const rot = Math.random() * 20 - 10;
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    container.appendChild(img);
}

// ========================================
// DRAG & DROP
// ========================================

function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault();
        gameState.globalZ++;
        img.style.zIndex = gameState.globalZ;
        img.style.transition = 'none';
        
        cardData.originalLeft = img.style.left;
        cardData.originalTop = img.style.top;
        
        let shiftX = e.clientX - img.getBoundingClientRect().left;
        let shiftY = e.clientY - img.getBoundingClientRect().top;
        
        const box = document.getElementById('player-foundation-area');
        if (!box) return;
        
        function moveAt(pageX, pageY) {
            const boxRect = box.getBoundingClientRect();
            let newLeft = pageX - shiftX - boxRect.left;
            let newTop = pageY - shiftY - boxRect.top;
            
            if (newTop < 0) {
                if (!gameState.gameActive || !checkLegalPlay(cardData)) newTop = 0;
            }
            
            img.style.left = newLeft + 'px';
            img.style.top = newTop + 'px';
            
            sendToPeer({
                type: 'card_dragging',
                laneIndex: 3 - cardData.laneIndex,
                left: newLeft,
                top: -newTop,
                dragging: true
            });
        }
        
        moveAt(e.pageX, e.pageY);
        
        function onMouseMove(event) {
            moveAt(event.pageX, event.pageY);
        }
        
        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            
            img.style.transition = 'all 0.1s ease-out';
            
            sendToPeer({
                type: 'card_dragging',
                laneIndex: 3 - cardData.laneIndex,
                dragging: false
            });
            
            if (gameState.gameActive && parseInt(img.style.top) < -10) {
                const dropSide = getDropSide(img, event);
                let success = playCardToCenter(cardData, img, dropSide);
                if (!success) {
                    img.style.left = cardData.originalLeft;
                    img.style.top = cardData.originalTop;
                }
            }
        }
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

function handleOpponentDragging(data) {
    if (!data.dragging) {
        if (gameState.opponentDragging) {
            gameState.opponentDragging.remove();
            gameState.opponentDragging = null;
        }
        return;
    }
    
    const oppArea = document.getElementById('ai-foundation-area');
    if (!oppArea) return;
    
    if (!gameState.opponentDragging) {
        gameState.opponentDragging = document.createElement('div');
        gameState.opponentDragging.className = 'opponent-drag-indicator';
        gameState.opponentDragging.style.position = 'absolute';
        gameState.opponentDragging.style.width = '60px';
        gameState.opponentDragging.style.height = '84px';
        gameState.opponentDragging.style.border = '2px dashed rgba(255, 100, 100, 0.7)';
        gameState.opponentDragging.style.borderRadius = '5px';
        gameState.opponentDragging.style.pointerEvents = 'none';
        gameState.opponentDragging.style.zIndex = '9999';
        oppArea.appendChild(gameState.opponentDragging);
    }
    
    const lanePercent = 5 + (data.laneIndex * 24);
    gameState.opponentDragging.style.left = `${lanePercent}%`;
    gameState.opponentDragging.style.top = `${10 + Math.abs(data.top)}px`;
}

function getDropSide(imgElement, mouseEvent) {
    const leftPileEl = document.getElementById('center-pile-left');
    const rightPileEl = document.getElementById('center-pile-right');
    if (!leftPileEl || !rightPileEl) return null;

    const x = mouseEvent.clientX;
    const y = mouseEvent.clientY;
    const pad = 25;

    const l = leftPileEl.getBoundingClientRect();
    const r = rightPileEl.getBoundingClientRect();

    const inLeft =
        x >= (l.left - pad) && x <= (l.right + pad) &&
        y >= (l.top - pad) && y <= (l.bottom + pad);

    const inRight =
        x >= (r.left - pad) && x <= (r.right + pad) &&
        y >= (r.top - pad) && y <= (r.bottom + pad);

    if (inLeft) return 'left';
    if (inRight) return 'right';
    return null;
}

function checkLegalPlay(card) {
    if (!gameState.gameActive) return false;
    return checkPileLogic(card, gameState.centerPileLeft) || 
           checkPileLogic(card, gameState.centerPileRight);
}

function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false;
    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);
    return (diff === 1 || diff === 12);
}

function playCardToCenter(card, imgElement, dropSide) {
    if (!gameState.gameActive) return false;
    if (dropSide !== 'left' && dropSide !== 'right') return false;

    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    let target = null;
    let side = '';

    if (dropSide === 'left' && isLeftLegal) {
        target = gameState.centerPileLeft;
        side = 'left';
    }
    if (dropSide === 'right' && isRightLegal) {
        target = gameState.centerPileRight;
        side = 'right';
    }

    if (!target) return false;

    sendToPeer({
        type: 'card_played',
        card: { suit: card.suit, rank: card.rank, value: card.value },
        side: side,
        laneIndex: card.laneIndex,
        timestamp: Date.now()
    });

    executeCardPlay(card, imgElement, target, side);
    return true;
}

function handleOpponentCardPlay(data) {
    const card = new Card(data.card.suit, data.card.rank, data.card.value);
    const oppSide = data.side === 'left' ? 'right' : 'left';
    
    const targetPile = oppSide === 'left' ? gameState.centerPileLeft : gameState.centerPileRight;
    targetPile.push(card);
    
    renderCenterPile(oppSide, card);
    
    // Remove visual card from opponent area
    const oppArea = document.getElementById('ai-foundation-area');
    if (oppArea && oppArea.children.length > 0) {
        const lastCard = oppArea.children[oppArea.children.length - 1];
        if (lastCard) lastCard.remove();
    }
    
    checkSlapCondition();
}

function executeCardPlay(card, imgElement, target, side) {
    gameState.playerReady = false;
    gameState.opponentReady = false;
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');

    target.push(card);
    
    if (card.owner === 'player') {
        gameState.playerHand = gameState.playerHand.filter(c => c !== card);
        gameState.playerTotal--;
        
        if (gameState.playerTotal <= 0) {
            showEndGame("YOU WIN THE MATCH!", true);
            return true;
        }
        if (gameState.playerHand.length === 0) endRound('player');
    }

    checkDeckVisibility();
    imgElement.remove();
    renderCenterPile(side, card);
    updateScoreboard();
    checkSlapCondition();
    return true;
}

// ========================================
// UI MESSAGES
// ========================================

function showMessage(text) {
    console.log(text);
    // Optional: Add visual message display
}

function showError(text) {
    console.error(text);
    alert(text);
}

function showRoundMessage(title, sub) {
    const modal = document.getElementById('game-message');
    if (!modal) return;
    modal.querySelector('h1').innerText = title;
    modal.querySelector('p').innerText = sub;
    const btn = document.getElementById('msg-btn');
    if (btn) {
        btn.innerText = "CONTINUE";
        btn.onclick = function() {
            modal.classList.add('hidden');
            startRound();
        };
    }
    modal.classList.remove('hidden');
}

function showEndGame(title, isWin) {
    const modal = document.getElementById('game-message');
    if (!modal) return;
    
    modal.querySelector('h1').innerText = title;
    modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';
    
    const contentArea = modal.querySelector('p');
    contentArea.innerHTML = `
        <div style="display:flex; gap:10px; justify-content:center; margin-top:20px;">
            <button class="btn-action-small" onclick="quitGame()" style="background:#ff4444; width:auto;">
                QUIT TO MENU
            </button>
        </div>
    `;
    
    const oldBtn = document.getElementById('msg-btn');
    if (oldBtn) oldBtn.classList.add('hidden');
    
    modal.classList.remove('hidden');
}

function updateScoreboardWidget() {
    const p1Name = document.getElementById('sb-p1-name');
    const p2Name = document.getElementById('sb-p2-name');
    if (p1Name) p1Name.innerText = gameState.myName;
    if (p2Name) p2Name.innerText = gameState.opponentName;

    const p1R = document.getElementById('sb-p1-rounds');
    const p2R = document.getElementById('sb-p2-rounds');
    const p1S = document.getElementById('sb-p1-slaps');
    const p2S = document.getElementById('sb-p2-slaps');

    if (p1R) p1R.innerText = gameState.p1Rounds;
    if (p2R) p2R.innerText = gameState.opponentRounds;
    if (p1S) p1S.innerText = gameState.p1Slaps;
    if (p2S) p2S.innerText = gameState.opponentSlaps;
}

// ========================================
// DISCONNECT HANDLING
// ========================================

function handleOpponentDisconnect() {
    gameState.connected = false;
    gameState.gameActive = false;
    showError("Opponent disconnected!");
    
    setTimeout(() => {
        showEndGame("OPPONENT DISCONNECTED - YOU WIN!", true);
    }, 1000);
}

function handleOpponentQuit() {
    gameState.connected = false;
    gameState.gameActive = false;
    showError("Opponent quit the game!");
    
    setTimeout(() => {
        showEndGame("OPPONENT QUIT - YOU WIN!", true);
    }, 1000);
}

function quitGame() {
    sendToPeer({ type: 'quit' });
    
    if (gameState.conn) gameState.conn.close();
    if (gameState.peer) gameState.peer.destroy();
    
    window.location.href = 'matchmaking.html';
}

window.addEventListener('beforeunload', (e) => {
    if (gameState.connected && gameState.gameActive) {
        sendToPeer({ type: 'quit' });
    }
});
