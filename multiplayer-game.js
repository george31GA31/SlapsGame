/* =========================================
   MULTIPLAYER GAME.JS (Human vs Human)
   ========================================= */

const gameState = {
    // Deck/hand state
    playerDeck: [],
    aiDeck: [],             // REUSED AS OPPONENT DECK (kept id/name to avoid HTML edits)
    playerHand: [],
    aiHand: [],             // REUSED AS OPPONENT HAND

    centerPileLeft: [],
    centerPileRight: [],

    globalZ: 1000,

    playerTotal: 26,
    aiTotal: 26,            // REUSED AS OPPONENT TOTAL

    gameActive: false,
    matchEnded: false,

    playerReady: false,
    aiReady: false,         // REUSED AS OPPONENT READY

    drawLock: false,
    countdownRunning: false,

    slapActive: false,
    lastSpacebarTime: 0,

    playerYellows: 0,
    playerReds: 0,
    aiYellows: 0,           // REUSED AS OPPONENT YELLOWS
    aiReds: 0,              // REUSED AS OPPONENT REDS

    // Multiplayer connection
    isHost: false,
    peer: null,
    conn: null,
    myId: null,
    roomCode: null,

    myName: "ME",
    opponentName: "OPPONENT",

    handshakeDone: false,
    roundStarted: false,

    // For snapping back on reject
    lastDraggedCard: null,
    lastDraggedEl: null,

    // Ghosts for opponent drag previews
    opponentDragGhosts: new Map(),

    // Sequence counter
    moveSeq: 0,

    // Stats (kept)
    p1Rounds: 0,
    aiRounds: 0,            // REUSED AS P2 ROUNDS
    p1Slaps: 0,
    aiSlaps: 0              // REUSED AS P2 SLAPS
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png';

// Foundation lane x positions (same as your original approach)
const PLAYER_LANES = [5, 29, 53, 77];

class Card {
    constructor(suit, rank, value, id) {
        this.suit = suit;
        this.rank = rank;
        this.value = value;
        // Use provided ID or generate new one
        this.id = id || Math.random().toString(36).substr(2, 9);
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false;
        this.owner = null;
        this.element = null;
        this.laneIndex = 0;
        this.originalLeft = null;
        this.originalTop = null;
    }
}
/* ================================
   BOOTSTRAP
   ================================ */

window.onload = function () {
    document.addEventListener('keydown', handleInput);

    const pDeck = document.getElementById('player-draw-deck');
    if (pDeck) pDeck.onclick = handlePlayerDeckClick;

    updateScoreboardWidget();
    initMultiplayer();
};

/* ================================
   MULTIPLAYER INIT (matches your lobby pages)
   ================================ */

function initMultiplayer() {
    const role = (localStorage.getItem('isf_role') || '').toLowerCase();
    const hostId = (localStorage.getItem('isf_code') || '').trim();
    const myName = (localStorage.getItem('isf_my_name') || 'Player').trim();

    gameState.myName = myName;
    gameState.opponentName = 'OPPONENT';

    // Your pages use host / join (friend) and host / guest (public)
    gameState.isHost = (role === 'host');
    gameState.roomCode = hostId;

    if (!hostId) {
        showRoundMessage("NO MATCH DATA", "Return to matchmaking and create or join a match.");
        return;
    }

    // IMPORTANT: this matches your lobby behaviour exactly
    // - host uses new Peer(hostId)
    // - join/guest uses new Peer() and connects to hostId
    gameState.peer = gameState.isHost ? new Peer(hostId) : new Peer();

    gameState.peer.on('open', (id) => {
        gameState.myId = id;

        if (gameState.isHost) {
            gameState.peer.on('connection', (conn) => bindConnection(conn));
        } else {
            const conn = gameState.peer.connect(hostId, { reliable: true });
            bindConnection(conn);
        }
    });

    gameState.peer.on('error', (err) => {
        console.error(err);
        showRoundMessage("CONNECTION ERROR", "Return to matchmaking and try again.");
    });
}

function bindConnection(conn) {
    gameState.conn = conn;

    conn.on('open', () => {
        // Matchmaking.html already uses HANDSHAKE. We keep the same type.
        sendNet({ type: 'HANDSHAKE', name: gameState.myName });
    });

    conn.on('data', (msg) => handleNet(msg));

    conn.on('close', () => {
        showRoundMessage("DISCONNECTED", "The other player left the match.");
    });

    conn.on('error', (err) => {
        console.error(err);
        showRoundMessage("CONNECTION ERROR", "Return to matchmaking and try again.");
    });
}

function sendNet(obj) {
    if (gameState.conn && gameState.conn.open) {
        gameState.conn.send(obj);
    }
}

/* ================================
   NETWORK MESSAGE HANDLER
   ================================ */

function handleNet(msg) {
    if (!msg) return;

    // --- Name exchange (matches matchmaking.html) ---
    if (msg.type === 'HANDSHAKE') {
        gameState.opponentName = msg.name || 'OPPONENT';
        updateScoreboardWidget();

        // Reply once if needed
        if (!gameState.handshakeDone) {
            gameState.handshakeDone = true;
            sendNet({ type: 'HANDSHAKE', name: gameState.myName });
        }

        // Host starts game after handshake so both names are set
        if (gameState.isHost && !gameState.roundStarted) {
            gameState.roundStarted = true;
            startRoundHostAuthoritative();
        }
        return;
    }

    if (msg.type === 'ROUND_START') {
        if (!gameState.isHost) {
            startRoundJoinerFromState(msg.state);
        }
        return;
    }

    if (msg.type === 'READY') {
        // Opponent clicked their deck
        gameState.aiReady = true;
        const oDeck = document.getElementById('ai-draw-deck');
        if (oDeck) oDeck.classList.add('deck-ready');
        checkDrawConditionMultiplayer();
        return;
    }

    if (msg.type === 'HOST_COUNTDOWN') {
        startCountdownFromHost();
        return;
    }

    if (msg.type === 'REVEAL_RESULT') {
        applyRevealFromHost(msg.result);
        return;
    }

    if (msg.type === 'DRAG') {
        applyOpponentDrag(msg.drag);
        return;
    }

    if (msg.type === 'MOVE_REQ') {
        if (gameState.isHost) adjudicateMove(msg.move);
        return;
    }

    if (msg.type === 'MOVE_APPLY') {
        applyMoveFromHost(msg.apply);
        return;
    }

    if (msg.type === 'MOVE_REJECT') {
        rejectMoveFromHost(msg.reject);
        return;
    }

    if (msg.type === 'SYNC') {
        if (!gameState.isHost) startRoundJoinerFromState(msg.state);
        return;
    }
}

/* ================================
   INPUT / SLAP LOGIC (kept)
   ================================ */

function handleInput(e) {
    if (e.code === 'Space') {
        e.preventDefault();
        if (!gameState.gameActive) return;

        const now = Date.now();
        if (now - gameState.lastSpacebarTime < 400) { return; }
        gameState.lastSpacebarTime = now;

        if (!gameState.slapActive) {
            issuePenalty('player', 'BAD SLAP');
            return;
        }

        // Multiplayer: slap resolution should also be host-authoritative if you want perfect fairness.
        // For now, keep your existing local behaviour.
        resolveSlap('player');
    }
}

function issuePenalty(target, reason) {
    let yellows;
    if (target === 'player') { gameState.playerYellows++; yellows = gameState.playerYellows; }
    else { gameState.aiYellows++; yellows = gameState.aiYellows; }

    if (yellows >= 2) {
        if (target === 'player') { gameState.playerYellows = 0; gameState.playerReds++; }
        else { gameState.aiYellows = 0; gameState.aiReds++; }
        executeRedCardPenalty(target);
    }
    updatePenaltyUI();
}

function executeRedCardPenalty(offender) {
    // Kept for structure. In multiplayer, you would also host-authoritatively apply this.
    const victim = (offender === 'player') ? 'ai' : 'player';
    let penaltyAmount = 3;

    let victimHand = (victim === 'player') ? gameState.playerHand : gameState.aiHand;
    let victimDeck = (victim === 'player') ? gameState.playerDeck : gameState.aiDeck;

    for (let i = 0; i < penaltyAmount; i++) {
        if (victimDeck.length > 0) { victimDeck.pop(); }
        else if (victimHand.length > 0) {
            let cardToRemove = victimHand.pop();
            if (cardToRemove && cardToRemove.element) cardToRemove.element.remove();
        }
    }

    if (offender === 'player') {
        gameState.playerTotal += 3;
        gameState.aiTotal = Math.max(0, gameState.aiTotal - 3);
    } else {
        gameState.aiTotal += 3;
        gameState.playerTotal = Math.max(0, gameState.playerTotal - 3);
    }

    if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
    if (gameState.aiTotal <= 0) showEndGame("OPPONENT WINS THE MATCH!", false);

    updateScoreboard();
}

function updatePenaltyUI() {
    renderBadges('player', gameState.playerYellows, gameState.playerReds);
    renderBadges('ai', gameState.aiYellows, gameState.aiReds);
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

function resolveSlap(winner) {
    gameState.slapActive = false;
    gameState.gameActive = false;

    const overlay = document.getElementById('slap-overlay');
    const txt = document.getElementById('slap-text');
    if (!overlay || !txt) return;

    overlay.classList.remove('hidden');

    const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

    if (winner === 'player') {
        txt.innerText = "PLAYER SLAPS WON!";
        overlay.style.backgroundColor = "rgba(0, 200, 0, 0.9)";
        gameState.aiTotal += pilesTotal;
        gameState.p1Slaps++;
    } else {
        txt.innerText = "OPPONENT SLAPS WON!";
        overlay.style.backgroundColor = "rgba(200, 0, 0, 0.9)";
        gameState.playerTotal += pilesTotal;
        gameState.aiSlaps++;
    }

    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];
    const l = document.getElementById('center-pile-left');
    const r = document.getElementById('center-pile-right');
    if (l) l.innerHTML = '';
    if (r) r.innerHTML = '';

    updateScoreboard();
    updateScoreboardWidget();

    setTimeout(() => {
        overlay.classList.add('hidden');
        gameState.playerReady = false;
        gameState.aiReady = false;

        const pDeck = document.getElementById('player-draw-deck');
        const oDeck = document.getElementById('ai-draw-deck');
        if (pDeck) pDeck.classList.remove('deck-ready');
        if (oDeck) oDeck.classList.remove('deck-ready');

        if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
        if (gameState.aiTotal <= 0) showEndGame("OPPONENT WINS THE MATCH!", false);
    }, 2000);
}

/* ================================
   HOST AUTHORITATIVE ROUND START
   ================================ */

async function startRoundHostAuthoritative() {
    gameState.matchEnded = false;

    let fullDeck = createDeck();
    shuffle(fullDeck);

    if (gameState.playerTotal <= 0) { showEndGame("YOU WIN THE MATCH!", true); return; }
    if (gameState.aiTotal <= 0) { showEndGame("OPPONENT WINS THE MATCH!", false); return; }

    const pTotal = gameState.playerTotal;
    const pAllCards = fullDeck.slice(0, pTotal);
    const aAllCards = fullDeck.slice(pTotal, 52);

    const pHandSize = Math.min(10, pTotal);
    const aHandSize = Math.min(10, 52 - pTotal);

    const pHandCards = pAllCards.splice(0, pHandSize);
    gameState.playerDeck = pAllCards;

    const aHandCards = aAllCards.splice(0, aHandSize);
    gameState.aiDeck = aAllCards;

    // Borrow tags reset
    const bp = document.getElementById('borrowed-player');
    const ba = document.getElementById('borrowed-ai');
    if (bp) bp.classList.add('hidden');
    if (ba) ba.classList.add('hidden');

    // Initial shortage borrow
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 1) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        gameState.playerDeck = gameState.aiDeck.splice(0, steal);
        if (bp) bp.classList.remove('hidden');
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 1) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        gameState.aiDeck = gameState.playerDeck.splice(0, steal);
        if (ba) ba.classList.remove('hidden');
    }

    await preloadCardImages([...pHandCards, ...aHandCards]);

    dealSmartHand(pHandCards, 'player');
    dealSmartHand(aHandCards, 'ai');

    resetCenterPiles();
    checkDeckVisibility();

    gameState.gameActive = false;
    gameState.playerReady = false;
    gameState.aiReady = false;

    updateScoreboard();
    updateScoreboardWidget();

    // --- CRITICAL FIX: SWAP DATA FOR GUEST ---
    // We cannot use exportState() because that sends MY hand as YOUR hand.
    // We must manually construct the state so the Guest receives the OPPOSITE data.
    
    const guestState = {
        // Swap Totals
        playerTotal: gameState.aiTotal,
        aiTotal: gameState.playerTotal,

        // Swap Decks
        playerDeck: gameState.aiDeck.map(packCard),
        aiDeck: gameState.playerDeck.map(packCard),

        // Swap Hands (Mirroring)
        playerHand: gameState.aiHand.map(packCardWithMeta),
        aiHand: gameState.playerHand.map(packCardWithMeta),

        // Swap Center Piles 
        // (Host's "Left" is the Guest's pile, so it becomes Guest's "Right")
        centerPileLeft: gameState.centerPileRight.map(packCard),
        centerPileRight: gameState.centerPileLeft.map(packCard),

        // Swap Borrow Flags
        borrowedPlayer: !document.getElementById('borrowed-ai').classList.contains('hidden'),
        borrowedAi: !document.getElementById('borrowed-player').classList.contains('hidden')
    };

    sendNet({ type: 'ROUND_START', state: guestState });
}
async function startRoundJoinerFromState(state) {
    importState(state);

    // Preload what we are about to render
    await preloadCardImages([...gameState.playerHand, ...gameState.aiHand]);

    // Render hands
    dealSmartHand(gameState.playerHand, 'player');
    dealSmartHand(gameState.aiHand, 'ai');

    resetCenterPiles();

    // Apply borrow tags
    const bp = document.getElementById('borrowed-player');
    const ba = document.getElementById('borrowed-ai');
    if (bp) state.borrowedPlayer ? bp.classList.remove('hidden') : bp.classList.add('hidden');
    if (ba) state.borrowedAi ? ba.classList.remove('hidden') : ba.classList.add('hidden');

    checkDeckVisibility();

    gameState.gameActive = false;
    gameState.playerReady = false;
    gameState.aiReady = false;

    updateScoreboard();
    updateScoreboardWidget();
}

function resetCenterPiles() {
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];

    const l = document.getElementById('center-pile-left');
    const r = document.getElementById('center-pile-right');
    if (l) l.innerHTML = '';
    if (r) r.innerHTML = '';

    const modal = document.getElementById('game-message');
    if (modal) modal.classList.add('hidden');

    gameState.slapActive = false;
}

/* ================================
   SERIALISATION
   ================================ */

function packCard(c) {
    return { suit: c.suit, rank: c.rank, value: c.value, id: c.id };
}

function packCardWithMeta(c) {
    return {
        suit: c.suit,
        rank: c.rank,
        value: c.value,
        id: c.id,
        isFaceUp: !!c.isFaceUp,
        owner: c.owner,
        laneIndex: c.laneIndex
    };
}

function unpackCard(obj) {
    // USE THE EXISTING ID (Crucial for sync)
    const c = new Card(obj.suit, obj.rank, obj.value, obj.id);
    c.isFaceUp = !!obj.isFaceUp;
    c.owner = obj.owner ?? null;
    c.laneIndex = obj.laneIndex ?? 0;
    return c;
}
function exportState() {
    const borrowedPlayer = !document.getElementById('borrowed-player')?.classList.contains('hidden');
    const borrowedAi = !document.getElementById('borrowed-ai')?.classList.contains('hidden');

    return {
        playerTotal: gameState.playerTotal,
        aiTotal: gameState.aiTotal,

        playerDeck: gameState.playerDeck.map(packCard),
        aiDeck: gameState.aiDeck.map(packCard),

        playerHand: gameState.playerHand.map(packCardWithMeta),
        aiHand: gameState.aiHand.map(packCardWithMeta),

        centerPileLeft: gameState.centerPileLeft.map(packCard),
        centerPileRight: gameState.centerPileRight.map(packCard),

        borrowedPlayer,
        borrowedAi
    };
}

function importState(s) {
    gameState.playerTotal = s.playerTotal;
    gameState.aiTotal = s.aiTotal;

    gameState.playerDeck = (s.playerDeck || []).map(unpackCard);
    gameState.aiDeck = (s.aiDeck || []).map(unpackCard);

    gameState.playerHand = (s.playerHand || []).map(unpackCard);
    gameState.aiHand = (s.aiHand || []).map(unpackCard);

    gameState.centerPileLeft = (s.centerPileLeft || []).map(unpackCard);
    gameState.centerPileRight = (s.centerPileRight || []).map(unpackCard);
}

/* ================================
   DEAL / RENDER HAND (with mirrored opponent lanes)
   ================================ */

function dealSmartHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    if (!container) return;

    container.innerHTML = '';
    if (owner === 'player') gameState.playerHand = [];
    else gameState.aiHand = [];

    // Build 4 piles
    const piles = [[], [], [], []];
    let idx = 0;
    
    if (cards.length >= 10) {
        [4, 3, 2, 1].forEach((size, i) => {
            for (let j = 0; j < size; j++) piles[i].push(cards[idx++]);
        });
    } else {
        cards.forEach(card => { piles[idx].push(card); idx = (idx + 1) % 4; });
    }

    // MIRROR LOGIC:
    // Host lanes: 3, 2, 1, 0 (Visual Left->Right: D, C, B, A)
    // Guest lanes: 0, 1, 2, 3 (Visual Left->Right: A, B, C, D)
    // This creates a perfect mirror naturally. 
    const laneOrder = (owner === 'ai') ? [3, 2, 1, 0] : [0, 1, 2, 3];

    laneOrder.forEach((laneIdx, displayIdx) => {
        const pile = piles[laneIdx];
        if (!pile || pile.length === 0) return;

        pile.forEach((card, index) => {
            const img = document.createElement('img');
            img.className = 'game-card';

            card.owner = owner;
            card.laneIndex = laneIdx;

            const isTopCard = (index === pile.length - 1);
            if (isTopCard) setCardFaceUp(img, card, owner);
            else setCardFaceDown(img, card, owner);

            img.style.left = `${PLAYER_LANES[displayIdx]}%`;

            const stackOffset = index * 5;
            if (owner === 'ai') img.style.top = `${10 + stackOffset}px`;
            else img.style.top = `${60 - stackOffset}px`;

            img.style.zIndex = index + 10;

            card.element = img;
            container.appendChild(img);

            if (owner === 'player') gameState.playerHand.push(card);
            else gameState.aiHand.push(card);
        });
    });
}}

/* ================================
   CARD FACE / FLIP / DRAG
   ================================ */

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

    // Player can flip facedown cards
    if (owner === 'player') img.onclick = () => tryFlipCard(img, card);
}

function tryFlipCard(img, card) {
    const liveCards = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (liveCards < 4) setCardFaceUp(img, card, 'player');
}

function cardKey(c) {
    // Stable enough for ghosting and matching
    return `${c.suit}:${c.rank}:${c.value}:${c.owner}:${c.laneIndex}`;
}

function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault();

        gameState.globalZ++;
        img.style.zIndex = gameState.globalZ;
        img.style.transition = 'none';

        cardData.originalLeft = img.style.left;
        cardData.originalTop = img.style.top;

        gameState.lastDraggedCard = cardData;
        gameState.lastDraggedEl = img;

        const box = document.getElementById('player-foundation-area');
        if (!box) return;

        const startRect = img.getBoundingClientRect();
        let shiftX = e.clientX - startRect.left;
        let shiftY = e.clientY - startRect.top;

        function moveAt(pageX, pageY, sendDrag) {
            const boxRect = box.getBoundingClientRect();
            let newLeft = pageX - shiftX - boxRect.left;
            let newTop = pageY - shiftY - boxRect.top;

            // Your "physical wall" (only blocks exiting upwards unless legal)
            if (newTop < 0) {
                if (!gameState.gameActive || !checkLegalPlay(cardData)) newTop = 0;
            }

            img.style.left = newLeft + 'px';
            img.style.top = newTop + 'px';

            if (sendDrag) {
                const nx = (boxRect.width > 0) ? (newLeft / boxRect.width) : 0;
                const ny = (boxRect.height > 0) ? (newTop / boxRect.height) : 0;
                sendNet({
                    type: 'DRAG',
                    drag: { id: cardKey(cardData), nx, ny, phase: 'move' }
                });
            }
        }

        // drag start
        {
            const boxRect = box.getBoundingClientRect();
            const startLeft = e.pageX - shiftX - boxRect.left;
            const startTop = e.pageY - shiftY - boxRect.top;
            const nx = (boxRect.width > 0) ? (startLeft / boxRect.width) : 0;
            const ny = (boxRect.height > 0) ? (startTop / boxRect.height) : 0;
            sendNet({ type: 'DRAG', drag: { id: cardKey(cardData), nx, ny, phase: 'start' } });
        }

        moveAt(e.pageX, e.pageY, false);

        function onMouseMove(event) {
            moveAt(event.pageX, event.pageY, true);
        }

        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            img.style.transition = 'all 0.1s ease-out';

            // Attempt play if dragged upward out of foundation
            if (gameState.gameActive && parseInt(img.style.top) < -10) {
                const dropSide = getDropSide(img, event); // 'left' | 'right' | null
                requestMoveToHost(cardData, dropSide);
            } else {
                // drag end position
                const boxRect = box.getBoundingClientRect();
                const left = parseFloat(img.style.left) || 0;
                const top = parseFloat(img.style.top) || 0;
                const nx = (boxRect.width > 0) ? (left / boxRect.width) : 0;
                const ny = (boxRect.height > 0) ? (top / boxRect.height) : 0;
                sendNet({ type: 'DRAG', drag: { id: cardKey(cardData), nx, ny, phase: 'end' } });
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

function applyOpponentDrag(d) {
    const box = document.getElementById('ai-foundation-area');
    if (!box) return;

    const boxRect = box.getBoundingClientRect();

    // Mirror and flip (right+up becomes left+down)
    const mx = 1 - d.nx;
    const my = 1 - d.ny;

    let el = gameState.opponentDragGhosts.get(d.id);

    if (d.phase === 'start') {
        if (!el) {
            el = document.createElement('div');
            el.className = 'opponent-drag-ghost';
            el.style.position = 'absolute';
            el.style.width = '60px';
            el.style.height = '90px';
            el.style.borderRadius = '6px';
            el.style.pointerEvents = 'none';
            el.style.opacity = '0.85';
            el.style.zIndex = 5000;
            el.style.backgroundImage = `url(${CARD_BACK_SRC})`;
            el.style.backgroundSize = 'cover';
            el.style.boxShadow = '0 0 10px rgba(0,0,0,0.6)';
            box.appendChild(el);
            gameState.opponentDragGhosts.set(d.id, el);
        }
    }

    if (!el) return;

    el.style.left = (mx * boxRect.width) + 'px';
    el.style.top = (my * boxRect.height) + 'px';

    if (d.phase === 'end') {
        setTimeout(() => {
            const e = gameState.opponentDragGhosts.get(d.id);
            if (e) {
                e.remove();
                gameState.opponentDragGhosts.delete(d.id);
            }
        }, 120);
    }
}

/* ================================
   DROP SIDE DETECTION (kept)
   ================================ */

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

/* ================================
   LEGAL PLAY (kept)
   ================================ */

function checkLegalPlay(card) {
    if (!gameState.gameActive) return false;
    return checkPileLogic(card, gameState.centerPileLeft) || checkPileLogic(card, gameState.centerPileRight);
}

function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false;
    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);
    return (diff === 1 || diff === 12);
}

/* ================================
   MOVE REQUEST / HOST ADJUDICATION (first sticks, second bounces)
   ================================ */

function requestMoveToHost(cardData, dropSide) {
    // If not dropped on a pile, do not even ask host
    if (dropSide !== 'left' && dropSide !== 'right') {
        // Snap back locally
        if (cardData && cardData.originalLeft != null) {
            const el = cardData.element;
            if (el) { el.style.left = cardData.originalLeft; el.style.top = cardData.originalTop; }
        }
        return;
    }

    const req = {
        reqId: `${gameState.myId}:${Date.now()}:${(++gameState.moveSeq)}`,
        dropSide,
        card: packCardWithMeta(cardData)
    };

    sendNet({ type: 'MOVE_REQ', move: req });
}

function adjudicateMove(m) {
    // Host receives MOVE_REQ from the remote player.
    // In the host's gameState, the remote player is "ai" (opponent).
    const mover = 'ai';

    const moverHand = (mover === 'player') ? gameState.playerHand : gameState.aiHand;

    // Find the actual card object in moverHand
    const idx = moverHand.findIndex(c =>
        c.suit === m.card.suit &&
        c.rank === m.card.rank &&
        c.value === m.card.value &&
        c.isFaceUp === true
    );

    if (idx === -1) {
        sendNet({ type: 'MOVE_REJECT', reject: { reqId: m.reqId } });
        return;
    }

    const cardObj = moverHand[idx];

    const isLeftLegal = checkPileLogic(cardObj, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(cardObj, gameState.centerPileRight);

    let side = null;
    if (m.dropSide === 'left' && isLeftLegal) side = 'left';
    if (m.dropSide === 'right' && isRightLegal) side = 'right';

    // If invalid NOW, reject (this enforces "first sticks, second bounces")
    if (!side) {
        sendNet({ type: 'MOVE_REJECT', reject: { reqId: m.reqId } });
        return;
    }

    // Apply on host state + host UI
    const applyPayload = applyMoveAuthoritative(mover, cardObj, side, m.reqId);

    // Broadcast to joiner
    sendNet({ type: 'MOVE_APPLY', apply: applyPayload });
}

function applyMoveAuthoritative(mover, cardObj, side, reqId) {
    // Update piles
    const targetPile = (side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
    targetPile.push(cardObj);

    // Remove from mover hand
    if (mover === 'player') {
        gameState.playerHand = gameState.playerHand.filter(c => c !== cardObj);
        gameState.playerTotal--;
    } else {
        gameState.aiHand = gameState.aiHand.filter(c => c !== cardObj);
        gameState.aiTotal--;
    }

    // Update UI on host (remove element + render)
    if (cardObj.element) cardObj.element.remove();
    renderCenterPile(side, cardObj);

    updateScoreboard();
    checkSlapCondition();

    // Reveal new top card for mover lane (host knows the real stack)
    revealNewTopAfterPlay(mover, cardObj.laneIndex);

    // End checks
    if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
    if (gameState.aiTotal <= 0) showEndGame("OPPONENT WINS THE MATCH!", false);

    // Payload includes new totals so both clients stay synced
    return {
        reqId,
        mover,
        side,
        card: packCardWithMeta(cardObj),
        playerTotal: gameState.playerTotal,
        aiTotal: gameState.aiTotal
    };
}

function revealNewTopAfterPlay(owner, laneIdx) {
    const hand = (owner === 'player') ? gameState.playerHand : gameState.aiHand;
    const laneCards = hand.filter(c => c.laneIndex === laneIdx);

    if (laneCards.length > 0) {
        const newTop = laneCards[laneCards.length - 1];
        if (!newTop.isFaceUp && newTop.element) {
            setCardFaceUp(newTop.element, newTop, owner);
        }
    }
}

function applyMoveFromHost(a) {
    // Remove any drag ghost for this card id (best effort)
    const ghost = gameState.opponentDragGhosts.get(cardKey(a.card));
    if (ghost) {
        ghost.remove();
        gameState.opponentDragGhosts.delete(cardKey(a.card));
    }

    // Update totals from host
    gameState.playerTotal = a.playerTotal;
    gameState.aiTotal = a.aiTotal;

    // Locate card in the correct local hand list
    const mover = a.mover;
    const hand = (mover === 'player') ? gameState.playerHand : gameState.aiHand;

    const idx = hand.findIndex(c =>
        c.suit === a.card.suit &&
        c.rank === a.card.rank &&
        c.value === a.card.value
    );

    let cardObj = null;

    if (idx !== -1) {
        cardObj = hand[idx];
        hand.splice(idx, 1);
    } else {
        // Fallback: reconstruct if not found
        cardObj = unpackCard(a.card);
    }

    // Remove element if present
    if (cardObj.element) cardObj.element.remove();

    // Push to correct pile and render
    const pile = (a.side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
    pile.push(cardObj);

    renderCenterPile(a.side, cardObj);

    updateScoreboard();
    checkSlapCondition();

    // Reveal new top card locally if mover was player (we can do it)
    // For opponent, the host will also have flipped their top; we mirror using the meta in state only if you sync hands.
    // Best effort: do nothing here.
}

function rejectMoveFromHost(j) {
    // Snap back the last dragged card on this client
    const c = gameState.lastDraggedCard;
    const el = gameState.lastDraggedEl;
    if (!c || !el) return;

    if (c.originalLeft != null) el.style.left = c.originalLeft;
    if (c.originalTop != null) el.style.top = c.originalTop;
}

/* ================================
   DECK READY / COUNTDOWN / REVEAL (host-authoritative)
   ================================ */

function handlePlayerDeckClick() {
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;

        gameState.playerReady = true;
        document.getElementById('player-draw-deck')?.classList.add('deck-ready');

        sendNet({ type: 'READY' });
        checkDrawConditionMultiplayer();
        return;
    }

    if (gameState.gameActive && !gameState.playerReady) {
        gameState.playerReady = true;
        document.getElementById('player-draw-deck')?.classList.add('deck-ready');

        sendNet({ type: 'READY' });
        checkDrawConditionMultiplayer();
    }
}

function checkDrawConditionMultiplayer() {
    if (gameState.drawLock || gameState.countdownRunning) return;

    if (gameState.playerReady && gameState.aiReady) {
        if (!gameState.isHost) return;

        gameState.drawLock = true;
        sendNet({ type: 'HOST_COUNTDOWN' });
        setTimeout(() => startCountdownFromHost(), 50);
    }
}

function startCountdownFromHost() {
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

            // Host computes reveal and broadcasts
            if (gameState.isHost) {
                const result = performRevealHostOnly();
                sendNet({ type: 'REVEAL_RESULT', result });
                // Host also applies immediately for consistency
                applyRevealFromHost(result);
            }
        }
    }, 800);
}

function performRevealHostOnly() {
    // Equivalent to your old performReveal(), but returns a payload instead of rendering on joiner.

    // Clear deck-ready classes on host too (joiner will do via payload application)
    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

    // Borrow flags
    const bpEl = document.getElementById('borrowed-player');
    const baEl = document.getElementById('borrowed-ai');

    // 1) Shortage borrow (same as your original)
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const stealAmount = Math.floor(gameState.aiDeck.length / 2);
        if (stealAmount > 0) {
            const stolen = gameState.aiDeck.splice(0, stealAmount);
            gameState.playerDeck = gameState.playerDeck.concat(stolen);
            if (bpEl) bpEl.classList.remove('hidden');
        }
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const stealAmount = Math.floor(gameState.playerDeck.length / 2);
        if (stealAmount > 0) {
            const stolen = gameState.playerDeck.splice(0, stealAmount);
            gameState.aiDeck = gameState.aiDeck.concat(stolen);
            if (baEl) baEl.classList.remove('hidden');
        }
    }

    // 2) Ownership scoring (your original logic)
    const playerBorrowing = bpEl ? !bpEl.classList.contains('hidden') : false;
    const aiBorrowing = baEl ? !baEl.classList.contains('hidden') : false;

    if (playerBorrowing) gameState.aiTotal--;
    else gameState.playerTotal--;

    if (aiBorrowing) gameState.playerTotal--;
    else gameState.aiTotal--;

    // 3) Draw cards to centre (host mutates state)
    let rightCard = null;
    let leftCard = null;

    if (gameState.playerDeck.length > 0) {
        const pCard = gameState.playerDeck.pop();
        gameState.centerPileRight.push(pCard);
        rightCard = packCard(pCard);
    }

    if (gameState.aiDeck.length > 0) {
        const aCard = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(aCard);
        leftCard = packCard(aCard);
    }

    // Reset readiness
    gameState.playerReady = false;
    gameState.aiReady = false;
    gameState.drawLock = false;

    // Payload to joiner (and for host apply)
    return {
        playerTotal: gameState.playerTotal,
        aiTotal: gameState.aiTotal,
        borrowedPlayer: playerBorrowing,
        borrowedAi: aiBorrowing,
        right: rightCard,
        left: leftCard
    };
}

function applyRevealFromHost(payload) {
    // Apply borrow tags
    const bpEl = document.getElementById('borrowed-player');
    const baEl = document.getElementById('borrowed-ai');
    if (bpEl) payload.borrowedPlayer ? bpEl.classList.remove('hidden') : bpEl.classList.add('hidden');
    if (baEl) payload.borrowedAi ? baEl.classList.remove('hidden') : baEl.classList.add('hidden');

    // Totals
    gameState.playerTotal = payload.playerTotal;
    gameState.aiTotal = payload.aiTotal;

    // Ensure deck-ready classes are cleared
    document.getElementById('player-draw-deck')?.classList.remove('deck-ready');
    document.getElementById('ai-draw-deck')?.classList.remove('deck-ready');

    // Render the centre cards (joiner has no deck state to pop from, so we use payload)
    if (payload.right) {
        const c = unpackCard(payload.right);
        gameState.centerPileRight.push(c);
        renderCenterPile('right', c);
    }
    if (payload.left) {
        const c = unpackCard(payload.left);
        gameState.centerPileLeft.push(c);
        renderCenterPile('left', c);
    }

    updateScoreboard();

    gameState.gameActive = true;
    gameState.playerReady = false;
    gameState.aiReady = false;

    checkSlapCondition();
}

/* ================================
   RENDER CENTER PILE (kept)
   ================================ */

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

/* ================================
   DECK / SCOREBOARD (kept)
   ================================ */

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
    const sp = document.getElementById('score-player');
    const sa = document.getElementById('score-ai');
    if (sp) sp.innerText = gameState.playerTotal;
    if (sa) sa.innerText = gameState.aiTotal;
}

function checkDeckVisibility() {
    document.getElementById('player-draw-deck')?.classList.remove('hidden');
    document.getElementById('ai-draw-deck')?.classList.remove('hidden');
}

function updateScoreboardWidget() {
    const p1Name = document.getElementById('sb-p1-name');
    const p2Name = document.getElementById('sb-p2-name');
    if (p1Name) p1Name.innerText = gameState.myName || "You";
    if (p2Name) p2Name.innerText = gameState.opponentName || "Opponent";

    const p1R = document.getElementById('sb-p1-rounds');
    const p2R = document.getElementById('sb-p2-rounds');
    const p1S = document.getElementById('sb-p1-slaps');
    const p2S = document.getElementById('sb-p2-slaps');

    if (p1R) p1R.innerText = gameState.p1Rounds;
    if (p2R) p2R.innerText = gameState.aiRounds;
    if (p1S) p1S.innerText = gameState.p1Slaps;
    if (p2S) p2S.innerText = gameState.aiSlaps;
}

/* ================================
   END GAME UI (restart removed)
   ================================ */

function showRoundMessage(title, sub) {
    const modal = document.getElementById('game-message');
    if (!modal) return;

    modal.querySelector('h1').innerText = title;
    modal.querySelector('p').innerText = sub;

    const btn = document.getElementById('msg-btn');
    if (btn) {
        btn.innerText = "CONTINUE";
        btn.onclick = function () { /* In multiplayer, host controls rounds. */ };
        btn.classList.remove('hidden');
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
            <button class="btn-action-small" onclick="window.location.href='index.html'" style="background:#ff4444; width:auto;">
                MAIN MENU
            </button>
        </div>
    `;

    const oldBtn = document.getElementById('msg-btn');
    if (oldBtn) oldBtn.classList.add('hidden');

    modal.classList.remove('hidden');
}

/* ================================
   IMAGE PRELOAD (fast but reliable)
   ================================ */

async function preloadCardImages(cards) {
    const urls = new Set();
    urls.add(CARD_BACK_SRC);
    (cards || []).forEach(c => { if (c && c.imgSrc) urls.add(c.imgSrc); });

    const tasks = [];
    urls.forEach((src) => {
        tasks.push(new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = src;
        }));
    });

    // Wait, but do not hang forever
    await Promise.race([
        Promise.all(tasks),
        new Promise(resolve => setTimeout(resolve, 2500))
    ]);
}
