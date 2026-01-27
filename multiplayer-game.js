/* =========================================
   MULTIPLAYER-GAME.JS
   Human vs Human (PeerJS) using Single-Player Engine Behaviour
   - No AI
   - Host authoritative adjudication (first move sticks)
   - Mirrored opponent lanes and mirrored drag
   - Fast, safe image preloading (no missing cards)
   ========================================= */

/* -----------------------------
   CONFIG: storage keys + url params
   Your matchmaking/setup pages must set:
   - my peer id (optional, PeerJS can generate)
   - opponent peer id
   - isHost flag (true for host)
   This file tries multiple keys/params so you do not need to rename everything.
-------------------------------- */

function getParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
}

function pickFirst(...vals) {
    for (const v of vals) {
        if (v !== null && v !== undefined && String(v).trim() !== "") return v;
    }
    return null;
}

function getBool(val) {
    if (val === true || val === false) return val;
    if (val === null || val === undefined) return false;
    const s = String(val).toLowerCase().trim();
    return (s === "1" || s === "true" || s === "yes" || s === "host");
}

/* -----------------------------
   GAME STATE (keeps your naming)
   ai* = opponent*
-------------------------------- */
const gameState = {
    // Deck/hand state
    playerDeck: [],
    aiDeck: [],

    playerHand: [],
    aiHand: [],

    centerPileLeft: [],
    centerPileRight: [],

    globalZ: 1000,

    playerTotal: 26,
    aiTotal: 26,

    gameActive: false,
    matchEnded: false,

    playerReady: false,
    aiReady: false,

    drawLock: false,
    countdownRunning: false,

    slapActive: false,
    lastSpacebarTime: 0,

    playerYellows: 0,
    playerReds: 0,
    aiYellows: 0,
    aiReds: 0,

    p1Rounds: 0,
    aiRounds: 0,
    p1Slaps: 0,
    aiSlaps: 0,

    // Networking
    isHost: false,
    peer: null,
    conn: null,
    myPeerId: null,
    opponentPeerId: null,
    myName: "You",
    opponentName: "Opponent",

    // Host adjudication
    hostReady: { player: false, ai: false },
    slapWindowOpen: false,
    lastSlapOpenedAt: 0,

    // For drag mirroring
    dragging: {
        active: false,
        cardId: null,
        originalParent: null,
        originalLeft: null,
        originalTop: null,
        originalPos: null
    },

    // Image cache
    imgReady: false,
    imgCache: new Map() // key -> true
};

const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "jack", "queen", "king", "ace"];
const CARD_BACK_SRC = "assets/cards/back_of_card.png";

// Your stack lanes for opponent (top area) were [5, 29, 53, 77].
// Mirrored means reverse the lane placement.
const PLAYER_LANES = [5, 29, 53, 77];
const OPP_LANES_MIRRORED = [77, 53, 29, 5];

/* -----------------------------
   CARD MODEL
-------------------------------- */
class Card {
    constructor(suit, rank, value) {
        this.suit = suit;
        this.rank = rank;
        this.value = value;
        this.id = `${rank}_of_${suit}`; // unique in deck
        this.imgSrc = `assets/cards/${rank}_of_${suit}.png`;
        this.isFaceUp = false;
        this.owner = null; // 'player' or 'ai'
        this.element = null;
        this.laneIndex = 0;
        this.originalLeft = null;
        this.originalTop = null;
    }
}

/* -----------------------------
   INIT
-------------------------------- */
window.onload = async function () {
    document.addEventListener("keydown", handleInput);

    // Hook player deck click (same id)
    const pDeck = document.getElementById("player-draw-deck");
    if (pDeck) pDeck.onclick = handlePlayerDeckClick;

    // Remove any restart/rematch buttons if they exist in your UI
    // (We also ensure end modal does not add one.)
    const restartBtn = document.getElementById("restart-btn");
    if (restartBtn) restartBtn.remove();

    // Quit button must notify opponent
    // Your HTML already has quitMatch() in onclick, so we expose it globally.
    window.quitMatch = quitMatch;

    // Names and connection info
    loadMatchInfo();

    // Preload images first to avoid slow rendering or missing cards
    await preloadAllCardImagesSafely();

    updateScoreboardWidget();

    // Connect networking
    initNetworking();
};

/* -----------------------------
   MATCH INFO (matchmaking/setup integration)
-------------------------------- */
function loadMatchInfo() {
    const ls = window.localStorage;

    // Your matchmaking keys
    const role = ls.getItem("isf_role");     // "host" | "guest"
    const code = ls.getItem("isf_code");     // lobby id used as peer id for host
    const myName = ls.getItem("isf_my_name");
    const oppName = ls.getItem("isf_opponent_name");

    gameState.isHost = (role === "host");
    gameState.opponentPeerId = code;        // in your system this is the lobby peer id
    gameState.myPeerId = gameState.isHost ? code : null;

    if (myName) gameState.myName = myName;
    if (oppName) gameState.opponentName = oppName;
}

/* -----------------------------
   IMAGE PRELOAD (fast but safe)
   Preloads every face + back and waits for decode.
-------------------------------- */
async function preloadAllCardImagesSafely() {
    const paths = [];
    paths.push(CARD_BACK_SRC);
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            paths.push(`assets/cards/${rank}_of_${suit}.png`);
        }
    }

    const loadOne = (src) =>
        new Promise((resolve) => {
            if (gameState.imgCache.get(src)) return resolve(true);

            const img = new Image();
            img.src = src;

            const done = () => {
                gameState.imgCache.set(src, true);
                resolve(true);
            };

            img.onload = async () => {
                // decode() improves first paint but can throw on some browsers
                try {
                    if (img.decode) await img.decode();
                } catch (e) {
                    // ignore
                }
                done();
            };

            img.onerror = () => {
                // Do not block the game if a single image fails
                // (but cache false so we can still attempt later if needed)
                gameState.imgCache.set(src, false);
                resolve(false);
            };
        });

    // Load in parallel, but do not explode memory
    const CONCURRENCY = 12;
    let idx = 0;

    async function worker() {
        while (idx < paths.length) {
            const mine = idx++;
            await loadOne(paths[mine]);
        }
    }

    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);

    gameState.imgReady = true;
}

/* -----------------------------
   NETWORKING (PeerJS)
-------------------------------- */
function initNetworking() {
    if (typeof Peer === "undefined") {
        showFatal("PeerJS is not loaded. Check your <script src> in multiplayer-game.html");
        return;
    }

    const peerOpts = {};
    // If matchmaking created your peer id, use it. Else allow PeerJS to generate.
    gameState.peer = gameState.myPeerId ? new Peer(gameState.myPeerId, peerOpts) : new Peer(peerOpts);

    gameState.peer.on("open", (id) => {
        gameState.myPeerId = id;

        // If we are host, we might receive the opponent connection
        // If we are client, we initiate the connection to opponentPeerId
        if (gameState.isHost) {
            waitForIncomingConnection();
        } else {
            connectToHostOrOpponent();
        }
    });

    gameState.peer.on("connection", (conn) => {
        // Host receives incoming, client might also if both tried, so accept first stable
        if (gameState.conn && gameState.conn.open) return;
        attachConnection(conn);
        if (gameState.isHost) startHostHandshake();
    });

    gameState.peer.on("error", (err) => {
        showFatal("PeerJS error: " + (err?.message || err));
    });
}

function waitForIncomingConnection() {
    // Host just waits. matchmaking.html should have told opponent our peer id.
    // Optionally show it somewhere if you have UI for it.
}

function connectToHostOrOpponent() {
    const target = gameState.opponentPeerId;
    if (!target) {
        showFatal("No opponent peer id found. matchmaking/setup must pass it via localStorage or URL.");
        return;
    }

    const conn = gameState.peer.connect(target, { reliable: true });
    attachConnection(conn);
}

function attachConnection(conn) {
    gameState.conn = conn;

    conn.on("open", () => {
    sendNet({ type: "HANDSHAKE", name: gameState.myName });
    sendNet({ t: "HELLO", name: gameState.myName, isHost: gameState.isHost });

    if (!gameState.isHost) {
        sendNet({ t: "REQUEST_STATE" });
    }
});


    conn.on("data", (msg) => {
        handleNet(msg);
    });

    conn.on("close", () => {
        if (!gameState.matchEnded) {
            showOpponentQuit("Connection closed. The other player has left the match.");
        }
    });

    conn.on("error", (err) => {
        if (!gameState.matchEnded) showOpponentQuit("Connection error: " + (err?.message || err));
    });
}

function startHostHandshake() {
    // Host will wait for REQUEST_STATE then send initial state
}

function sendNet(obj) {
    try {
        if (gameState.conn && gameState.conn.open) gameState.conn.send(obj);
    } catch (e) {
        // ignore
    }
}

/* -----------------------------
   NETWORK MESSAGE HANDLING
-------------------------------- */
function handleNet(msg) {
    if (!msg || typeof msg !== "object") return;

    // NORMALISE: allow both message styles
    // matchmaking sends { type: "HANDSHAKE" }
    if (!msg.t && msg.type) msg.t = msg.type;

    switch (msg.t) {
        case "HANDSHAKE":
            if (msg.name) {
                gameState.opponentName = msg.name;
                localStorage.setItem("isf_opponent_name", msg.name);
                updateScoreboardWidget();
            }
            break;

        case "REQUEST_STATE":
            if (gameState.isHost) {
                hostStartMatch();
            }
            break;

        case "STATE_INIT":
            applyFullState(msg.state);
            break;

        case "STATE_PATCH":
            applyPatch(msg.patch);
            break;

        case "READY":
            if (gameState.isHost) hostHandleReady(msg.who);
            break;

        case "COUNTDOWN":
            startCountdownVisual();
            break;

        case "REVEAL_RESULT":
            applyPatch(msg.patch);
            break;

        case "MOVE_ATTEMPT":
            if (gameState.isHost) hostHandleMoveAttempt(msg);
            break;

        case "MOVE_RESULT":
            handleMoveResult(msg);
            break;

        case "DRAG":
            handleOpponentDrag(msg);
            break;

        case "SLAP":
            if (gameState.isHost) hostHandleSlap(msg);
            break;

        case "PENALTY":
            applyPatch(msg.patch);
            break;

        case "QUIT":
            showOpponentQuit("The other player has quit the match.");
            break;
    }
    break;


        default:
            break;
    }
}

/* -----------------------------
   HOST: START MATCH + ROUND
-------------------------------- */
function hostStartMatch() {
    // Only start once
    if (gameState._hostStarted) return;
    gameState._hostStarted = true;

    gameState.playerTotal = 26;
    gameState.aiTotal = 26;
    gameState.playerYellows = 0;
    gameState.playerReds = 0;
    gameState.aiYellows = 0;
    gameState.aiReds = 0;
    gameState.p1Rounds = 0;
    gameState.aiRounds = 0;
    gameState.p1Slaps = 0;
    gameState.aiSlaps = 0;

    hostStartRoundAndBroadcast(true);
}

function hostStartRoundAndBroadcast(isFirst) {
    const fullDeck = createDeck();
    shuffle(fullDeck);

    // Deal based on totals like single player
    const pTotal = gameState.playerTotal;
    const pAllCards = fullDeck.slice(0, pTotal);
    const aAllCards = fullDeck.slice(pTotal, 52);

    const pHandSize = Math.min(10, pTotal);
    const aHandSize = Math.min(10, 52 - pTotal);

    const pHandCards = pAllCards.splice(0, pHandSize);
    const aHandCards = aAllCards.splice(0, aHandSize);

    // Host keeps authoritative state
    gameState.playerDeck = pAllCards;
    gameState.aiDeck = aAllCards;

    // Borrow tags reset
    const borrowedP = false;
    const borrowedA = false;

    // Apply shortage at start like your code
    let borrowedPlayer = borrowedP;
    let borrowedAi = borrowedA;

    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 1) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        gameState.playerDeck = gameState.aiDeck.splice(0, steal);
        borrowedPlayer = true;
    }
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 1) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        gameState.aiDeck = gameState.playerDeck.splice(0, steal);
        borrowedAi = true;
    }

    // Build lane structure exactly like dealSmartHand
    const playerHandPacked = packHandToLanes(pHandCards, "player");
    const oppHandPacked = packHandToLanes(aHandCards, "ai");

    // State init payload
    const state = {
        playerTotal: gameState.playerTotal,
        aiTotal: gameState.aiTotal,

        playerDeck: packCards(gameState.playerDeck, "player"),
        aiDeck: packCards(gameState.aiDeck, "ai"),

        playerHand: playerHandPacked,
        aiHand: oppHandPacked,

        centerPileLeft: [],
        centerPileRight: [],

        gameActive: false,
        matchEnded: false,

        playerReady: false,
        aiReady: false,

        drawLock: false,
        countdownRunning: false,

        slapActive: false,

        playerYellows: gameState.playerYellows,
        playerReds: gameState.playerReds,
        aiYellows: gameState.aiYellows,
        aiReds: gameState.aiReds,

        p1Rounds: gameState.p1Rounds,
        aiRounds: gameState.aiRounds,
        p1Slaps: gameState.p1Slaps,
        aiSlaps: gameState.aiSlaps,

        borrowedPlayer,
        borrowedAi
    };

    // Apply locally and broadcast
    applyFullState(state);
    sendNet({ t: "STATE_INIT", state });
}

function packHandToLanes(cards, owner) {
    // returns [{id,suit,rank,value,laneIndex,isFaceUp}, ...]
    const piles = [[], [], [], []];

    if (cards.length >= 10) {
        let idx = 0;
        [4, 3, 2, 1].forEach((size, laneIdx) => {
            for (let j = 0; j < size; j++) piles[laneIdx].push(cards[idx++]);
        });
    } else {
        let laneIdx = 0;
        cards.forEach((c) => {
            piles[laneIdx].push(c);
            laneIdx = (laneIdx + 1) % 4;
        });
    }

    const packed = [];
    piles.forEach((pile, laneIdx) => {
        pile.forEach((card, i) => {
            card.owner = owner;
            card.laneIndex = laneIdx;
            const isTop = i === pile.length - 1;
            packed.push({
                id: card.id,
                suit: card.suit,
                rank: card.rank,
                value: card.value,
                laneIndex: laneIdx,
                isFaceUp: isTop // top card face up, like your dealSmartHand
            });
        });
    });

    // Preserve ordering per lane (important for reveal logic)
    // This array is already grouped by lane order, but not strictly required.
    return packed;
}

function packCards(cards, owner) {
    return cards.map((c) => ({
        id: c.id,
        suit: c.suit,
        rank: c.rank,
        value: c.value,
        owner
    }));
}

/* -----------------------------
   APPLY FULL STATE (both sides)
-------------------------------- */
function applyFullState(state) {
    // Convert packed objects to Card instances
    gameState.playerTotal = state.playerTotal;
    gameState.aiTotal = state.aiTotal;

    gameState.playerDeck = (state.playerDeck || []).map(unpackCard);
    gameState.aiDeck = (state.aiDeck || []).map(unpackCard);

    gameState.playerHand = (state.playerHand || []).map(unpackCardWithLaneFace("player"));
    gameState.aiHand = (state.aiHand || []).map(unpackCardWithLaneFace("ai"));

    gameState.centerPileLeft = (state.centerPileLeft || []).map(unpackCard);
    gameState.centerPileRight = (state.centerPileRight || []).map(unpackCard);

    gameState.gameActive = !!state.gameActive;
    gameState.matchEnded = !!state.matchEnded;

    gameState.playerReady = !!state.playerReady;
    gameState.aiReady = !!state.aiReady;

    gameState.drawLock = !!state.drawLock;
    gameState.countdownRunning = !!state.countdownRunning;

    gameState.slapActive = !!state.slapActive;

    gameState.playerYellows = state.playerYellows || 0;
    gameState.playerReds = state.playerReds || 0;
    gameState.aiYellows = state.aiYellows || 0;
    gameState.aiReds = state.aiReds || 0;

    gameState.p1Rounds = state.p1Rounds || 0;
    gameState.aiRounds = state.aiRounds || 0;
    gameState.p1Slaps = state.p1Slaps || 0;
    gameState.aiSlaps = state.aiSlaps || 0;

    // Borrow tags UI
    const bp = document.getElementById("borrowed-player");
    const ba = document.getElementById("borrowed-ai");
    if (bp) bp.classList.toggle("hidden", !state.borrowedPlayer);
    if (ba) ba.classList.toggle("hidden", !state.borrowedAi);

    // Render everything
    renderBothHands();
    renderCenterPiles();
    updatePenaltyUI();
    updateScoreboard();
    updateScoreboardWidget();

    // Ready deck glow
    const pDeck = document.getElementById("player-draw-deck");
    const aDeck = document.getElementById("ai-draw-deck");
    if (pDeck) pDeck.classList.toggle("deck-ready", gameState.playerReady);
    if (aDeck) aDeck.classList.toggle("deck-ready", gameState.aiReady);

    checkDeckVisibility();

    // Hide any modal message
    const msg = document.getElementById("game-message");
    if (msg) msg.classList.add("hidden");
}

function applyPatch(patch) {
    // Patch can include any subset of fields.
    // This keeps UI consistent without full reset.
    if (!patch) return;

    if (typeof patch.playerTotal === "number") gameState.playerTotal = patch.playerTotal;
    if (typeof patch.aiTotal === "number") gameState.aiTotal = patch.aiTotal;

    if (patch.playerDeck) gameState.playerDeck = patch.playerDeck.map(unpackCard);
    if (patch.aiDeck) gameState.aiDeck = patch.aiDeck.map(unpackCard);

    if (patch.playerHand) gameState.playerHand = patch.playerHand.map(unpackCardWithLaneFace("player"));
    if (patch.aiHand) gameState.aiHand = patch.aiHand.map(unpackCardWithLaneFace("ai"));

    if (patch.centerPileLeft) gameState.centerPileLeft = patch.centerPileLeft.map(unpackCard);
    if (patch.centerPileRight) gameState.centerPileRight = patch.centerPileRight.map(unpackCard);

    if (typeof patch.gameActive === "boolean") gameState.gameActive = patch.gameActive;
    if (typeof patch.matchEnded === "boolean") gameState.matchEnded = patch.matchEnded;

    if (typeof patch.playerReady === "boolean") gameState.playerReady = patch.playerReady;
    if (typeof patch.aiReady === "boolean") gameState.aiReady = patch.aiReady;

    if (typeof patch.drawLock === "boolean") gameState.drawLock = patch.drawLock;
    if (typeof patch.countdownRunning === "boolean") gameState.countdownRunning = patch.countdownRunning;

    if (typeof patch.slapActive === "boolean") gameState.slapActive = patch.slapActive;

    if (typeof patch.playerYellows === "number") gameState.playerYellows = patch.playerYellows;
    if (typeof patch.playerReds === "number") gameState.playerReds = patch.playerReds;
    if (typeof patch.aiYellows === "number") gameState.aiYellows = patch.aiYellows;
    if (typeof patch.aiReds === "number") gameState.aiReds = patch.aiReds;

    if (typeof patch.p1Rounds === "number") gameState.p1Rounds = patch.p1Rounds;
    if (typeof patch.aiRounds === "number") gameState.aiRounds = patch.aiRounds;
    if (typeof patch.p1Slaps === "number") gameState.p1Slaps = patch.p1Slaps;
    if (typeof patch.aiSlaps === "number") gameState.aiSlaps = patch.aiSlaps;

    // Borrow tags UI
    if ("borrowedPlayer" in patch) {
        const bp = document.getElementById("borrowed-player");
        if (bp) bp.classList.toggle("hidden", !patch.borrowedPlayer);
    }
    if ("borrowedAi" in patch) {
        const ba = document.getElementById("borrowed-ai");
        if (ba) ba.classList.toggle("hidden", !patch.borrowedAi);
    }

    renderBothHands();
    renderCenterPiles();
    updatePenaltyUI();
    updateScoreboard();
    updateScoreboardWidget();

    const pDeck = document.getElementById("player-draw-deck");
    const aDeck = document.getElementById("ai-draw-deck");
    if (pDeck) pDeck.classList.toggle("deck-ready", gameState.playerReady);
    if (aDeck) aDeck.classList.toggle("deck-ready", gameState.aiReady);
}

/* -----------------------------
   UNPACK HELPERS
-------------------------------- */
function unpackCard(obj) {
    const c = new Card(obj.suit, obj.rank, obj.value);
    c.owner = obj.owner || null;
    c.isFaceUp = !!obj.isFaceUp;
    c.laneIndex = typeof obj.laneIndex === "number" ? obj.laneIndex : 0;
    return c;
}

function unpackCardWithLaneFace(owner) {
    return function (obj) {
        const c = unpackCard(obj);
        c.owner = owner;
        c.laneIndex = obj.laneIndex;
        c.isFaceUp = !!obj.isFaceUp;
        return c;
    };
}

/* -----------------------------
   RENDERING
-------------------------------- */
function renderBothHands() {
    // PLAYER
    const pArea = document.getElementById("player-foundation-area");
    if (pArea) {
        pArea.innerHTML = "";
        const frag = document.createDocumentFragment();
        renderHandInto(frag, gameState.playerHand, "player", false);
        pArea.appendChild(frag);
    }

    // OPPONENT (ai) but mirrored lanes
    const aArea = document.getElementById("ai-foundation-area");
    if (aArea) {
        aArea.innerHTML = "";
        const frag = document.createDocumentFragment();
        renderHandInto(frag, gameState.aiHand, "ai", true);
        aArea.appendChild(frag);
    }
}

function renderHandInto(fragment, hand, owner, mirrorLanes) {
    // Group by lane
    const lanes = [[], [], [], []];
    hand.forEach((c) => lanes[c.laneIndex].push(c));

    // Ensure stable ordering in each lane (bottom to top)
    lanes.forEach((arr) => {
        // keep as-is (host packed in order)
    });

    // Determine lane positions
    const lanePositions = owner === "player" ? PLAYER_LANES : (mirrorLanes ? OPP_LANES_MIRRORED : PLAYER_LANES);

    lanes.forEach((laneCards, laneIdx) => {
        if (!laneCards.length) return;

        laneCards.forEach((card, index) => {
            const img = document.createElement("img");
            img.className = "game-card";
            img.decoding = "async";
            img.loading = "eager";

            card.owner = owner;
            card.element = img;

            const isTopCard = index === laneCards.length - 1;

            // For player: top face-up cards are draggable, others face-down with flip click
            if (owner === "player") {
                if (card.isFaceUp) {
                    setCardFaceUp(img, card, "player");
                } else {
                    setCardFaceDown(img, card, "player");
                }
            } else {
                // Opponent: show face-up state. Down cards remain back.
                if (card.isFaceUp) {
                    img.src = card.imgSrc;
                    img.classList.add("opponent-card");
                    img.classList.remove("card-face-down");
                } else {
                    img.src = CARD_BACK_SRC;
                    img.classList.add("card-face-down");
                    img.classList.add("opponent-card");
                }
            }

            img.style.left = `${lanePositions[laneIdx]}%`;

            // Stack offsets (keep your style)
            const stackOffset = index * 5;
            if (owner === "ai") {
                // opponent at top area in your UI
                img.style.top = `${10 + stackOffset}px`;
            } else {
                img.style.top = `${60 - stackOffset}px`;
            }

            img.style.zIndex = index + 10;
            fragment.appendChild(img);
        });
    });
}

function renderCenterPiles() {
    const left = document.getElementById("center-pile-left");
    const right = document.getElementById("center-pile-right");
    if (left) left.innerHTML = "";
    if (right) right.innerHTML = "";

    if (left) {
        gameState.centerPileLeft.forEach((card) => {
            renderCenterPile("left", card);
        });
    }
    if (right) {
        gameState.centerPileRight.forEach((card) => {
            renderCenterPile("right", card);
        });
    }
}

function renderCenterPile(side, card) {
    const id = side === "left" ? "center-pile-left" : "center-pile-right";
    const container = document.getElementById(id);
    if (!container) return;

    const img = document.createElement("img");
    img.src = card.imgSrc;
    img.className = "game-card";
    img.decoding = "async";
    img.loading = "eager";

    img.style.left = "50%";
    img.style.top = "50%";
    const rot = Math.random() * 20 - 10;
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    container.appendChild(img);
}

/* -----------------------------
   BASIC DECK HELPERS
-------------------------------- */
function createDeck() {
    const deck = [];
    SUITS.forEach((suit) => {
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

/* -----------------------------
   INPUT / SLAP (host authoritative)
-------------------------------- */
function handleInput(e) {
    if (e.code !== "Space") return;
    e.preventDefault();
    if (gameState.matchEnded) return;

    const now = Date.now();
    if (now - gameState.lastSpacebarTime < 250) return;
    gameState.lastSpacebarTime = now;

    if (gameState.isHost) {
        // Host adjudicates immediately
        hostHandleSlap({ t: "SLAP", at: now, who: "player" });
        // Host must sync after adjudication
        sendNet({ t: "STATE_PATCH", patch: buildPatchForSync() });
    } else {
        sendNet({ t: "SLAP", at: now, who: "player" });
    }
}


function hostHandleSlap(msg) {
    // Host decides if slap is valid
    if (gameState.matchEnded) return;

    const isActive = gameState.slapActive;

    if (!isActive) {
        // Bad slap penalty on slap when not active
        issuePenalty("player", "BAD SLAP");
        broadcastPenaltyPatch();
        return;
    }

    // If active, first slap message wins.
    // Close slap immediately after first valid slap.
    gameState.slapActive = false;
    gameState.gameActive = false;

    resolveSlap("player"); // player = sender in this message set
    // Broadcast updated state patch
    const patch = buildPatchForSync();
    sendNet({ t: "STATE_PATCH", patch });
}

function checkSlapCondition() {
    if (gameState.centerPileLeft.length === 0 || gameState.centerPileRight.length === 0) {
        gameState.slapActive = false;
        return;
    }
    const topL = gameState.centerPileLeft[gameState.centerPileLeft.length - 1];
    const topR = gameState.centerPileRight[gameState.centerPileRight.length - 1];
    gameState.slapActive = (topL.rank === topR.rank);
}

/* -----------------------------
   PENALTIES (same visuals, host sync)
-------------------------------- */
function issuePenalty(target, reason) {
    let yellows;
    if (target === "player") {
        gameState.playerYellows++;
        yellows = gameState.playerYellows;
    } else {
        gameState.aiYellows++;
        yellows = gameState.aiYellows;
    }

    if (yellows >= 2) {
        if (target === "player") {
            gameState.playerYellows = 0;
            gameState.playerReds++;
        } else {
            gameState.aiYellows = 0;
            gameState.aiReds++;
        }
        executeRedCardPenalty(target);
    }
    updatePenaltyUI();
}

function executeRedCardPenalty(offender) {
    const victim = offender === "player" ? "ai" : "player";
    const penaltyAmount = 3;

    const victimHand = victim === "player" ? gameState.playerHand : gameState.aiHand;
    const victimDeck = victim === "player" ? gameState.playerDeck : gameState.aiDeck;

    for (let i = 0; i < penaltyAmount; i++) {
        if (victimDeck.length > 0) {
            victimDeck.pop();
        } else if (victimHand.length > 0) {
            const cardToRemove = victimHand.pop();
            if (cardToRemove && cardToRemove.element) cardToRemove.element.remove();
        }
    }

    if (offender === "player") {
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
    renderBadges("player", gameState.playerYellows, gameState.playerReds);
    renderBadges("ai", gameState.aiYellows, gameState.aiReds);
}

function renderBadges(who, y, r) {
    const container = document.getElementById(`${who}-penalties`);
    if (!container) return;
    container.innerHTML = "";

    if (r > 0) {
        const div = document.createElement("div");
        div.className = "card-icon icon-red";
        if (r > 1) div.innerText = r;
        container.appendChild(div);
    }
    if (y > 0) {
        const div = document.createElement("div");
        div.className = "card-icon icon-yellow";
        container.appendChild(div);
    }
}

function broadcastPenaltyPatch() {
    const patch = buildPatchForSync();
    sendNet({ t: "PENALTY", patch });
}

/* -----------------------------
   SLAP RESOLUTION (keeps your visuals)
-------------------------------- */
function resolveSlap(winner) {
    gameState.slapActive = false;
    gameState.gameActive = false;

    const overlay = document.getElementById("slap-overlay");
    const txt = document.getElementById("slap-text");
    if (!overlay || !txt) return;

    overlay.classList.remove("hidden");

    const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

    if (winner === "player") {
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

    const left = document.getElementById("center-pile-left");
    const right = document.getElementById("center-pile-right");
    if (left) left.innerHTML = "";
    if (right) right.innerHTML = "";

    updateScoreboard();
    updateScoreboardWidget();

    setTimeout(() => {
        overlay.classList.add("hidden");
        gameState.playerReady = false;
        gameState.aiReady = false;

        const pDeck = document.getElementById("player-draw-deck");
        const aDeck = document.getElementById("ai-draw-deck");
        if (pDeck) pDeck.classList.remove("deck-ready");
        if (aDeck) aDeck.classList.remove("deck-ready");

        if (gameState.playerTotal <= 0) showEndGame("YOU WIN THE MATCH!", true);
        if (gameState.aiTotal <= 0) showEndGame("OPPONENT WINS THE MATCH!", false);
    }, 2000);
}

/* -----------------------------
   SCOREBOARD
-------------------------------- */
function updateScoreboard() {
    const sp = document.getElementById("score-player");
    const sa = document.getElementById("score-ai");
    if (sp) sp.innerText = gameState.playerTotal;
    if (sa) sa.innerText = gameState.aiTotal;
}

function updateScoreboardWidget() {
    const p1Name = document.getElementById("sb-p1-name");
    const p2Name = document.getElementById("sb-p2-name");
    if (p1Name) p1Name.innerText = gameState.myName || "You";
    if (p2Name) p2Name.innerText = gameState.opponentName || "Opponent";

    const p1R = document.getElementById("sb-p1-rounds");
    const p2R = document.getElementById("sb-p2-rounds");
    const p1S = document.getElementById("sb-p1-slaps");
    const p2S = document.getElementById("sb-p2-slaps");

    if (p1R) p1R.innerText = gameState.p1Rounds;
    if (p2R) p2R.innerText = gameState.aiRounds;
    if (p1S) p1S.innerText = gameState.p1Slaps;
    if (p2S) p2S.innerText = gameState.aiSlaps;
}

function checkDeckVisibility() {
    const p = document.getElementById("player-draw-deck");
    const a = document.getElementById("ai-draw-deck");
    if (p) p.classList.remove("hidden");
    if (a) a.classList.remove("hidden");
}

/* -----------------------------
   READY / COUNTDOWN / REVEAL (host authoritative)
-------------------------------- */
function handlePlayerDeckClick() {
    if (gameState.matchEnded) return;
    if (gameState.playerReady) return;

    gameState.playerReady = true;

    const pDeck = document.getElementById("player-draw-deck");
    if (pDeck) pDeck.classList.add("deck-ready");

    if (gameState.isHost) {
        // Host does not send READY to itself. Host broadcasts state.
        sendNet({ t: "STATE_PATCH", patch: buildPatchForSync() });

        // If opponent already ready, host triggers countdown
        if (gameState.aiReady && !gameState.countdownRunning && !gameState.drawLock) {
            gameState.drawLock = true;
            sendNet({ t: "COUNTDOWN" });
            startCountdownVisual(true);
        }
    } else {
        // Guest notifies host
        sendNet({ t: "READY", who: "player" });
    }
}


function hostHandleReady(who) {
    // READY arriving over the connection is always the remote player
    gameState.aiReady = true;

    // Sync ready glow
    sendNet({ t: "STATE_PATCH", patch: buildPatchForSync() });

    if (gameState.playerReady && gameState.aiReady && !gameState.countdownRunning && !gameState.drawLock) {
        gameState.drawLock = true;
        sendNet({ t: "COUNTDOWN" });
        startCountdownVisual(true);
    }
}

function startCountdownVisual(isHostWillReveal = false) {
    if (gameState.countdownRunning) return;
    gameState.countdownRunning = true;
    gameState.gameActive = false;

    const overlay = document.getElementById("countdown-overlay");
    if (!overlay) return;

    overlay.classList.remove("hidden");
    let count = 3;
    overlay.innerText = count;

    const timer = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.innerText = count;
            overlay.style.animation = "none";
            overlay.offsetHeight;
            overlay.style.animation = "popIn 0.5s ease";
        } else {
            clearInterval(timer);
            overlay.classList.add("hidden");
            gameState.countdownRunning = false;

            // Only host performs reveal and broadcasts authoritative result
            if (gameState.isHost && isHostWillReveal) {
                hostPerformRevealAndBroadcast();
            }
        }
    }, 800);
}

function hostPerformRevealAndBroadcast() {
    // Clear ready glow
    gameState.playerReady = false;
    gameState.aiReady = false;

    const pDeckEl = document.getElementById("player-draw-deck");
    const aDeckEl = document.getElementById("ai-draw-deck");
    if (pDeckEl) pDeckEl.classList.remove("deck-ready");
    if (aDeckEl) aDeckEl.classList.remove("deck-ready");

    // Borrow logic like your code
    let borrowedPlayer = !(document.getElementById("borrowed-player")?.classList.contains("hidden"));
    let borrowedAi = !(document.getElementById("borrowed-ai")?.classList.contains("hidden"));

    // 1) If player deck empty, borrow from opponent deck
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const stealAmount = Math.floor(gameState.aiDeck.length / 2);
        if (stealAmount > 0) {
            const stolen = gameState.aiDeck.splice(0, stealAmount);
            gameState.playerDeck = gameState.playerDeck.concat(stolen);
            borrowedPlayer = true;
        }
    }

    // 2) If opponent deck empty, borrow from player deck
    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const stealAmount = Math.floor(gameState.playerDeck.length / 2);
        if (stealAmount > 0) {
            const stolen = gameState.playerDeck.splice(0, stealAmount);
            gameState.aiDeck = gameState.aiDeck.concat(stolen);
            borrowedAi = true;
        }
    }

    // Ownership scoring rule (same as your code)
    if (borrowedPlayer) gameState.aiTotal--;
    else gameState.playerTotal--;

    if (borrowedAi) gameState.playerTotal--;
    else gameState.aiTotal--;

    // Render reveal cards
    if (gameState.playerDeck.length > 0) {
        const pCard = gameState.playerDeck.pop();
        gameState.centerPileRight.push(pCard);
    }
    if (gameState.aiDeck.length > 0) {
        const aCard = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(aCard);
    }

    checkSlapCondition();

    gameState.gameActive = true;
    gameState.drawLock = false;

    // Broadcast patch
    const patch = buildPatchForSync();
    patch.borrowedPlayer = borrowedPlayer;
    patch.borrowedAi = borrowedAi;

    // Update local UI then broadcast
    applyPatch(patch);
    sendNet({ t: "REVEAL_RESULT", patch });
}

/* -----------------------------
   MOVE LOGIC (same legality rules)
-------------------------------- */
function checkPileLogic(card, targetPile) {
    if (targetPile.length === 0) return false;
    const targetCard = targetPile[targetPile.length - 1];
    const diff = Math.abs(card.value - targetCard.value);
    return diff === 1 || diff === 12;
}

function checkLegalPlay(card) {
    if (!gameState.gameActive) return false;
    return checkPileLogic(card, gameState.centerPileLeft) || checkPileLogic(card, gameState.centerPileRight);
}

function getDropSide(mouseEvent) {
    const leftPileEl = document.getElementById("center-pile-left");
    const rightPileEl = document.getElementById("center-pile-right");
    if (!leftPileEl || !rightPileEl) return null;

    const x = mouseEvent.clientX;
    const y = mouseEvent.clientY;
    const pad = 25;

    const l = leftPileEl.getBoundingClientRect();
    const r = rightPileEl.getBoundingClientRect();

    const inLeft = x >= l.left - pad && x <= l.right + pad && y >= l.top - pad && y <= l.bottom + pad;
    const inRight = x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;

    if (inLeft) return "left";
    if (inRight) return "right";
    return null;
}

/* -----------------------------
   DRAGGING (fixes "slides under top card")
   We temporarily move dragged card to body with position: fixed
   so it always stays on top and never snaps under.
-------------------------------- */
function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault();
        if (gameState.matchEnded) return;

        gameState.globalZ++;
        img.style.zIndex = gameState.globalZ;
        img.style.transition = "none";

        const startRect = img.getBoundingClientRect();
        const shiftX = e.clientX - startRect.left;
        const shiftY = e.clientY - startRect.top;

        // Save original placement
        cardData.originalLeft = img.style.left;
        cardData.originalTop = img.style.top;

        const originalParent = img.parentElement;
        const originalPosition = img.style.position;

        // Lift to body to avoid stacking context issues
        img.style.position = "fixed";
        img.style.left = startRect.left + "px";
        img.style.top = startRect.top + "px";
        img.style.zIndex = 99999;
        document.body.appendChild(img);

        // Announce drag start to opponent viewer
        sendDragNet("start", cardData, img);

        function moveAt(clientX, clientY) {
            // Foundation boundary behaviour:
            // - You can always move freely inside your foundation
            // - You cannot move upward into play (negative direction) unless legal AND gameActive
            // Here "upward into play" means moving above the foundation box top boundary.
            const box = document.getElementById("player-foundation-area");
            const boxRect = box.getBoundingClientRect();

            let newLeft = clientX - shiftX;
            let newTop = clientY - shiftY;

            // Constrain to "not above box top" unless legal play
            const minTop = boxRect.top;
            if (newTop < minTop) {
                if (!gameState.gameActive || !checkLegalPlay(cardData)) {
                    newTop = minTop;
                }
            }

            img.style.left = newLeft + "px";
            img.style.top = newTop + "px";

            sendDragNet("move", cardData, img);
        }

        moveAt(e.clientX, e.clientY);

        function onMouseMove(ev) {
            moveAt(ev.clientX, ev.clientY);
        }

        function snapBack() {
            // Restore back into foundation area with absolute positioning
            if (originalParent) originalParent.appendChild(img);
            img.style.position = "absolute";
            img.style.left = cardData.originalLeft;
            img.style.top = cardData.originalTop;
            img.style.zIndex = 10;
            img.style.transition = "all 0.1s ease-out";
        }

        function onMouseUp(ev) {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);

            // Decide if attempt play
            const dropSide = getDropSide(ev);

            // Convert fixed position back to foundation coordinates if not played
            // (We snapBack for failure or non-play)
            if (gameState.gameActive) {
                // Only attempt if dropped near a pile (side)
                if (dropSide === "left" || dropSide === "right") {
                    attemptPlayCardToCenter(cardData, img, dropSide, snapBack);
                    sendDragNet("end", cardData, img, dropSide);
                    return;
                }
            }

            // Not a play, just reposition inside foundation
            // Put it back into foundation in the new position
            const box = document.getElementById("player-foundation-area");
            const boxRect = box.getBoundingClientRect();
            const leftPx = parseFloat(img.style.left) - boxRect.left;
            const topPx = parseFloat(img.style.top) - boxRect.top;

            if (box) box.appendChild(img);
            img.style.position = "absolute";
            img.style.left = leftPx + "px";
            img.style.top = topPx + "px";
            img.style.transition = "all 0.1s ease-out";
            img.style.zIndex = gameState.globalZ;

            sendDragNet("end", cardData, img, null);
        }

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };
}

function sendDragNet(stage, cardData, img, dropSide = null) {
    // Send normalized position relative to player foundation box
    const box = document.getElementById("player-foundation-area");
    if (!box) return;
    const br = box.getBoundingClientRect();
    const ir = img.getBoundingClientRect();

    const cx = (ir.left + ir.width / 2 - br.left) / br.width;
    const cy = (ir.top + ir.height / 2 - br.top) / br.height;

    sendNet({
        t: "DRAG",
        stage,
        cardId: cardData.id,
        faceUp: cardData.isFaceUp,
        imgSrc: cardData.imgSrc,
        laneIndex: cardData.laneIndex,
        cx,
        cy,
        dropSide
    });
}

/* -----------------------------
   PLAYER: attempt play (send to host)
-------------------------------- */
function attemptPlayCardToCenter(card, imgElement, dropSide, snapBackFn) {
    // Local quick legality check (for responsiveness), but host decides
    if (!gameState.gameActive) {
        snapBackFn();
        return;
    }

    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    if (dropSide === "left" && !isLeftLegal) {
        snapBackFn();
        return;
    }
    if (dropSide === "right" && !isRightLegal) {
        snapBackFn();
        return;
    }

    // Freeze interaction while waiting for host response
    // Freeze interaction while waiting for adjudication
    imgElement.style.pointerEvents = "none";

    if (gameState.isHost) {
        // Host adjudicates immediately for its own moves
        const result = hostHandleLocalMove(card.id, dropSide);

        if (!result) {
            imgElement.style.pointerEvents = "";
            snapBackFn();
        }
        return;
    }

    // Guest: ask host
    sendNet({
        t: "MOVE_ATTEMPT",
        cardId: card.id,
        dropSide,
        at: Date.now()
    });

    imgElement.dataset.pendingPlay = "1";
    imgElement.dataset.pendingCardId = card.id;
}

/* -----------------------------
   HOST: handle play attempts (first wins)
-------------------------------- */
function hostHandleMoveAttempt(msg) {
    if (gameState.matchEnded) return;
    if (!gameState.gameActive) {
        // Reject if not active
        sendNet({ t: "MOVE_RESULT", ok: false, cardId: msg.cardId, reason: "not_active" });
        return;
    }

    const cardId = msg.cardId;
    const side = msg.dropSide;

    // Find in opponent hand (remote player is "ai" from host POV)
    const idx = gameState.aiHand.findIndex((c) => c.id === cardId);
    if (idx === -1) {
        sendNet({ t: "MOVE_RESULT", ok: false, cardId, reason: "missing" });
        return;
    }

    const card = gameState.aiHand[idx];

    // Must be face-up to play, same as your player
    if (!card.isFaceUp) {
        sendNet({ t: "MOVE_RESULT", ok: false, cardId, reason: "face_down" });
        return;
    }

    // Determine legal target
    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    let target = null;
    let targetSide = null;

    if (side === "left" && isLeftLegal) {
        target = gameState.centerPileLeft;
        targetSide = "left";
    }
    if (side === "right" && isRightLegal) {
        target = gameState.centerPileRight;
        targetSide = "right";
    }

    if (!target) {
        sendNet({ t: "MOVE_RESULT", ok: false, cardId, reason: "illegal" });
        return;
    }

    // Accept: update authoritative state
    target.push(card);

    // Remove from opponent hand and decrement opponent total
    gameState.aiHand.splice(idx, 1);
    gameState.aiTotal--;

    // Reveal next top of lane if needed (same as your chain logic)
    revealNextTopInLane("ai", card.laneIndex);

    // Clear ready states like your playCardToCenter
    gameState.playerReady = false;
    gameState.aiReady = false;

    // Check for round end
    if (gameState.aiTotal <= 0) {
        endMatchHost("OPPONENT WINS THE MATCH!", false);
        return;
    }

    if (gameState.aiHand.length === 0) {
        // Opponent cleared hand -> opponent won round
        hostEndRound("ai");
        return;
    }

    checkSlapCondition();

    // Broadcast updated state to both
    const patch = buildPatchForSync();
    sendNet({ t: "MOVE_RESULT", ok: true, cardId, playedTo: targetSide, patch });
    // Apply locally too
    applyPatch(patch);
}

function hostHandleLocalMove(cardId, side) {
    if (gameState.matchEnded) return false;
    if (!gameState.gameActive) return false;

    const idx = gameState.playerHand.findIndex(c => c.id === cardId);
    if (idx === -1) return false;

    const card = gameState.playerHand[idx];
    if (!card.isFaceUp) return false;

    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    let target = null;
    let targetSide = null;

    if (side === "left" && isLeftLegal) { target = gameState.centerPileLeft; targetSide = "left"; }
    if (side === "right" && isRightLegal) { target = gameState.centerPileRight; targetSide = "right"; }
    if (!target) return false;

    // Apply
    target.push(card);
    gameState.playerHand.splice(idx, 1);
    gameState.playerTotal--;

    revealNextTopInLane("player", card.laneIndex);

    gameState.playerReady = false;
    gameState.aiReady = false;

    if (gameState.playerTotal <= 0) {
        endMatchHost("YOU WIN THE MATCH!", true);
        return true;
    }

    if (gameState.playerHand.length === 0) {
        hostEndRound("player");
        return true;
    }

    checkSlapCondition();

    const patch = buildPatchForSync();
    applyPatch(patch);
    sendNet({ t: "MOVE_RESULT", ok: true, cardId, playedTo: targetSide, patch });

    return true;
}

function revealNextTopInLane(owner, laneIdx) {
    const hand = owner === "player" ? gameState.playerHand : gameState.aiHand;
    const laneCards = hand.filter((c) => c.laneIndex === laneIdx);
    if (!laneCards.length) return;

    // last in that lane becomes face up
    const newTop = laneCards[laneCards.length - 1];
    if (!newTop.isFaceUp) newTop.isFaceUp = true;
}

/* -----------------------------
   CLIENT: handle move results
-------------------------------- */
function handleMoveResult(msg) {
    const { ok, cardId } = msg;

    if (!ok) {
        // Find the pending element and snap back if needed
        const pendingEl = findPlayerCardElement(cardId);
        if (pendingEl) {
            pendingEl.style.pointerEvents = "";
            // Snap back using stored originals (we stored in card data)
            const card = gameState.playerHand.find((c) => c.id === cardId);
            if (card) {
                // Reattach to foundation area if not already
                const box = document.getElementById("player-foundation-area");
                if (box && pendingEl.parentElement !== box) box.appendChild(pendingEl);

                pendingEl.style.position = "absolute";
                pendingEl.style.left = card.originalLeft;
                pendingEl.style.top = card.originalTop;
                pendingEl.style.zIndex = 10;
                pendingEl.style.transition = "all 0.1s ease-out";
            }
        }
        return;
    }

    // ok === true, apply authoritative patch
    if (msg.patch) applyPatch(msg.patch);
}

function findPlayerCardElement(cardId) {
    const card = gameState.playerHand.find((c) => c.id === cardId);
    return card?.element || null;
}

/* -----------------------------
   HOST: end round (same meaning as single player)
-------------------------------- */
function hostEndRound(winner) {
    // Winner is 'player' or 'ai'
    gameState.gameActive = false;

    if (winner === "player") {
        gameState.aiTotal = 52 - gameState.playerTotal;
        gameState.p1Rounds++;
        showRoundMessage("ROUND WON!", `You start next round with ${gameState.playerTotal} cards.`);
    } else {
        gameState.playerTotal = 52 - gameState.aiTotal;
        gameState.aiRounds++;
        showRoundMessage("ROUND LOST!", `Opponent starts next round with ${gameState.aiTotal} cards.`);
    }

    updateScoreboardWidget();

    // Next round must be started by host after continue
    const patch = buildPatchForSync();
    sendNet({ t: "STATE_PATCH", patch });
}

function showRoundMessage(title, sub) {
    const modal = document.getElementById("game-message");
    if (!modal) return;

    const h = modal.querySelector("h1");
    const p = modal.querySelector("p");
    if (h) h.innerText = title;
    if (p) p.innerText = sub;

    const btn = document.getElementById("msg-btn");
    if (btn) {
        btn.innerText = "CONTINUE";
        btn.classList.remove("hidden");
        btn.onclick = function () {
            // Only host starts the next round and broadcasts the new state
            if (gameState.isHost) {
                hostStartRoundAndBroadcast(false);
            }
        };
    }

    modal.classList.remove("hidden");
}

/* -----------------------------
   END GAME (no restart button)
-------------------------------- */
function showEndGame(title, isWin) {
    gameState.matchEnded = true;
    gameState.gameActive = false;

    const modal = document.getElementById("game-message");
    if (!modal) return;

    const h = modal.querySelector("h1");
    if (h) {
        h.innerText = title;
        h.style.color = isWin ? "#66ff66" : "#ff7575";
    }

    const contentArea = modal.querySelector("p");
    if (contentArea) {
        contentArea.innerHTML = `
            <div style="display:flex; gap:10px; justify-content:center; margin-top:20px;">
                <button class="btn-action-small" onclick="window.location.href='index.html'" style="background:#ff4444; width:auto;">
                    MAIN MENU
                </button>
            </div>
        `;
    }

    const btn = document.getElementById("msg-btn");
    if (btn) btn.classList.add("hidden");

    modal.classList.remove("hidden");
}

function endMatchHost(title, isWinForHost) {
    // Host decides match end and broadcasts patch
    showEndGame(title, isWinForHost);

    const patch = buildPatchForSync();
    patch.matchEnded = true;
    patch.gameActive = false;

    sendNet({ t: "STATE_PATCH", patch });
}

function showFatal(msg) {
    // You can replace with your modal if you prefer.
    alert(msg);
}

function showOpponentQuit(msg) {
    gameState.matchEnded = true;
    gameState.gameActive = false;

    const modal = document.getElementById("game-message");
    if (modal) {
        const h = modal.querySelector("h1");
        const p = modal.querySelector("p");
        if (h) h.innerText = "MATCH ENDED";
        if (p) p.innerText = msg;

        const btn = document.getElementById("msg-btn");
        if (btn) btn.classList.add("hidden");

        modal.classList.remove("hidden");
    } else {
        alert(msg);
    }
}

/* -----------------------------
   FACE UP/DOWN (keeps your behaviour)
-------------------------------- */
function setCardFaceUp(img, card, owner) {
    img.src = card.imgSrc;
    img.classList.remove("card-face-down");
    card.isFaceUp = true;

    if (owner === "player") {
        img.classList.add("player-card");
        img.onclick = null;
        makeDraggable(img, card);
    } else {
        img.classList.add("opponent-card");
    }
}

function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC;
    img.classList.add("card-face-down");
    card.isFaceUp = false;

    if (owner === "player") {
        img.onclick = () => tryFlipCard(img, card);
    }
}

function tryFlipCard(img, card) {
    const liveCards = gameState.playerHand.filter((c) => c.isFaceUp).length;
    if (liveCards < 4) {
        card.isFaceUp = true;
        setCardFaceUp(img, card, "player");

        // Update opponent view of your card face-up status
        // (so they see the real card, not a back)
        const patch = { playerHand: packPlayerHandForPatch() };
        sendNet({ t: "STATE_PATCH", patch });
    }
}

function packPlayerHandForPatch() {
    return gameState.playerHand.map((c) => ({
        id: c.id,
        suit: c.suit,
        rank: c.rank,
        value: c.value,
        laneIndex: c.laneIndex,
        isFaceUp: c.isFaceUp,
        owner: "player"
    }));
}

/* -----------------------------
   OPPONENT DRAG MIRROR (real card, mirrored flip)
   right+up for them becomes left+down for you:
   (cx,cy) => (1-cx, 1-cy)
-------------------------------- */
function handleOpponentDrag(msg) {
    // We render opponent as gameState.aiHand; this message describes the opponent's local drag.
    const cardId = msg.cardId;
    const card = gameState.aiHand.find((c) => c.id === cardId);

    // If we do not have it yet (state not synced), ignore.
    if (!card || !card.element) return;

    // Ensure the correct face/back is shown (fixes your "hologram back" problem)
    if (msg.faceUp) {
        card.isFaceUp = true;
        card.element.src = msg.imgSrc || card.imgSrc;
        card.element.classList.remove("card-face-down");
    } else {
        card.isFaceUp = false;
        card.element.src = CARD_BACK_SRC;
        card.element.classList.add("card-face-down");
    }

    const box = document.getElementById("ai-foundation-area");
    if (!box) return;
    const br = box.getBoundingClientRect();

    // Mirror both axes
    const mx = 1 - msg.cx;
    const my = 1 - msg.cy;

    const x = br.left + mx * br.width;
    const y = br.top + my * br.height;

    if (msg.stage === "start") {
        card.element.style.transition = "none";
        card.element.style.zIndex = 99998;
    }

    // Position as fixed so it moves smoothly above everything
    card.element.style.position = "fixed";
    const ir = card.element.getBoundingClientRect();
    card.element.style.left = (x - ir.width / 2) + "px";
    card.element.style.top = (y - ir.height / 2) + "px";

    if (msg.stage === "end") {
        // Convert fixed position into absolute position within ai-foundation-area
        const boxRect = br;
        const ir2 = card.element.getBoundingClientRect();

        const leftPx = (x - ir2.width / 2) - boxRect.left;
        const topPx = (y - ir2.height / 2) - boxRect.top;

        box.appendChild(card.element);
        card.element.style.position = "absolute";
        card.element.style.left = leftPx + "px";
        card.element.style.top = topPx + "px";
        card.element.style.zIndex = 9998;
        card.element.style.transition = "all 0.08s ease-out";
    }
}

/* -----------------------------
   BUILD PATCH (host -> both)
-------------------------------- */
function buildPatchForSync() {
    return {
        playerTotal: gameState.playerTotal,
        aiTotal: gameState.aiTotal,

        playerDeck: packCards(gameState.playerDeck, "player"),
        aiDeck: packCards(gameState.aiDeck, "ai"),

        playerHand: gameState.playerHand.map((c) => ({
            id: c.id, suit: c.suit, rank: c.rank, value: c.value,
            laneIndex: c.laneIndex, isFaceUp: c.isFaceUp, owner: "player"
        })),
        aiHand: gameState.aiHand.map((c) => ({
            id: c.id, suit: c.suit, rank: c.rank, value: c.value,
            laneIndex: c.laneIndex, isFaceUp: c.isFaceUp, owner: "ai"
        })),

        centerPileLeft: packCards(gameState.centerPileLeft, "center"),
        centerPileRight: packCards(gameState.centerPileRight, "center"),

        gameActive: gameState.gameActive,
        matchEnded: gameState.matchEnded,

        playerReady: gameState.playerReady,
        aiReady: gameState.aiReady,

        drawLock: gameState.drawLock,
        countdownRunning: gameState.countdownRunning,

        slapActive: gameState.slapActive,

        playerYellows: gameState.playerYellows,
        playerReds: gameState.playerReds,
        aiYellows: gameState.aiYellows,
        aiReds: gameState.aiReds,

        p1Rounds: gameState.p1Rounds,
        aiRounds: gameState.aiRounds,
        p1Slaps: gameState.p1Slaps,
        aiSlaps: gameState.aiSlaps
    };
}

/* -----------------------------
   QUIT MATCH (notify opponent)
-------------------------------- */
function quitMatch() {
    try {
        sendNet({ t: "QUIT" });
    } catch (e) {
        // ignore
    }
    window.location.href = "index.html";
}
