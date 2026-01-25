/* =========================================
   ISF MULTIPLAYER ENGINE v7.1 (Move Adjudication + Drag Mirror Fix)
   ========================================= */

const gameState = {
    // 'ai' var names = OPPONENT
    playerDeck: [], aiDeck: [],
    playerHand: [], aiHand: [],
    centerPileLeft: [], centerPileRight: [],
    globalZ: 1000,

    // Host adjudication for simultaneous moves
    pendingMoves: {},
    moveCounter: 0,

    playerTotal: 26, aiTotal: 26,

    gameActive: false,
    matchEnded: false,
    playerReady: false, aiReady: false,

    isHost: false,
    conn: null,

    opponentName: "OPPONENT",
    myName: "ME",

    slapActive: false,
    lastMoveTime: 0,
    lastSpacebarTime: 0,

    playerYellows: 0, playerReds: 0,
    aiYellows: 0, aiReds: 0,
    difficulty: 1,

    // SCOREBOARD STATE
    p1Rounds: 0, aiRounds: 0,
    p1Slaps: 0, aiSlaps: 0
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png';

class Card {
    constructor(suit, rank, value, id) {
        this.suit = suit;
        this.rank = rank;
        this.value = value;
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

window.onload = function () {
    gameState.playerTotal = 26;
    gameState.aiTotal = 26;
    gameState.myName = localStorage.getItem('isf_my_name') || "Player";

    document.addEventListener('keydown', handleInput);
    initNetwork();

    // Initialize Scoreboard UI
    updateScoreboardWidget();

    // PANIC LOOP
    // If I am a Guest, connected, but have NO cards, keep asking
    setInterval(() => {
        if (!gameState.isHost && gameState.playerHand.length === 0 && gameState.conn && gameState.conn.open) {
            console.warn("PANIC: Hand is empty! Asking again...");
            send({ type: 'REQUEST_DEAL', name: gameState.myName });
        }
    }, 2000);
};

function initNetwork() {
    const role = localStorage.getItem('isf_role');
    const code = localStorage.getItem('isf_code');

    if (!role || !code) {
        alert("Connection lost. Returning to lobby.");
        window.location.href = 'multiplayer-setup.html';
        return;
    }

    gameState.isHost = (role === 'host');
    const peer = new Peer(gameState.isHost ? code : null);

    peer.on('open', (id) => {
        console.log("My Peer ID: " + id);
        if (!gameState.isHost) {
            const conn = peer.connect(code);
            handleConnection(conn);
        }
    });

    peer.on('connection', (conn) => {
        if (gameState.isHost) handleConnection(conn);
    });
}

function handleConnection(connection) {
    gameState.conn = connection;

    connection.on('open', () => {
        console.log("CONNECTED!");

        // 1. Send Name immediately
        send({ type: 'NAME_REPLY', name: gameState.myName });

        // 2. If I am the Guest, ask for the deal now
        if (!gameState.isHost) {
            console.log("GUEST: Asking for deck...");
            send({ type: 'REQUEST_DEAL', name: gameState.myName });
        }
    });

    connection.on('data', (data) => processNetworkData(data));
}

function processNetworkData(data) {
    switch (data.type) {
        case 'CONCEDED':
            if (!gameState.matchEnded) {
                showEndGame("YOU WIN!", true, `${gameState.opponentName} conceded.`);
            }
            break;

        case 'OPPONENT_LEFT':
            handleOpponentLeft();
            break;

        case 'REMATCH_REQUEST':
            document.getElementById('rematch-modal').classList.remove('hidden');
            break;

        case 'REMATCH_ACCEPTED':
            performSoftReset();
            break;

        case 'REMATCH_DECLINED': {
            const statusText = document.getElementById('rematch-status-text');
            if (statusText) {
                statusText.innerText = "Opponent is busy.";
                statusText.style.color = "#ff4444";
            }
            break;
        }

        case 'REQUEST_DEAL':
            if (gameState.isHost) {
                console.log("HOST: Guest is ready. Dealing now...");
                gameState.opponentName = data.name || "Opponent";
                updateNamesUI();
                updateScoreboardWidget();
                startRound();
            }
            break;

        case 'INIT_ROUND':
            gameState.opponentName = data.hostName;
            updateNamesUI();
            updateScoreboardWidget();
            syncBoardState(data);

            if (!gameState.isHost) {
                send({ type: 'NAME_REPLY', name: gameState.myName });
            }
            break;

        case 'NAME_REPLY':
            gameState.opponentName = data.name;
            updateNamesUI();
            updateScoreboardWidget();
            break;

        // Legacy support (you can keep this; it does not break anything)
        case 'OPPONENT_MOVE': {
            const mirroredSide = (data.targetSide === 'left') ? 'right' : 'left';
            executeOpponentMove(data.cardId, mirroredSide);
            break;
        }

        case 'OPPONENT_FLIP':
            executeOpponentFlip(data.cardId);
            break;

        case 'OPPONENT_DRAG':
            executeOpponentDrag(data.cardId, data.left, data.top);
            break;

        case 'OPPONENT_REVEAL_READY':
            gameState.aiReady = true;
            document.getElementById('ai-draw-deck').classList.add('deck-ready');
            checkDrawCondition();
            break;

        // New adjudicated move flow
        case 'MOVE_ATTEMPT':
            if (gameState.isHost) handleMoveAttemptFromOpponent(data);
            break;

        case 'MOVE_ACCEPTED':
            handleMoveAccepted(data);
            break;

        case 'MOVE_REJECTED':
            handleMoveRejected(data);
            break;

        case 'SYNC_REVEAL':
            startCountdown(false);
            break;

        case 'SLAP_CLAIM':
            if (gameState.isHost) resolveSlapClaim('opponent', data.timestamp);
            break;

        case 'SLAP_RESULT':
            applySlapResult(data.winner);
            break;

        case 'ROUND_OVER':
            handleRoundOver(data.winner, data.nextPTotal, data.nextATotal);
            break;

        case 'GAME_OVER':
            showEndGame(data.msg, data.isWin);
            break;
    }
}

function send(data) {
    if (gameState.conn) gameState.conn.send(data);
}

// --- UI UPDATES ---
function updateNamesUI() {
    const labels = document.querySelectorAll('.stat-label');
    if (labels[0]) labels[0].innerText = gameState.opponentName;
}

function updateScoreboardWidget() {
    const p1Name = document.getElementById('sb-p1-name');
    const p2Name = document.getElementById('sb-p2-name');
    if (p1Name) p1Name.innerText = gameState.myName || "You";
    if (p2Name) p2Name.innerText = gameState.opponentName || "AI";

    const p1R = document.getElementById('sb-p1-rounds');
    const p2R = document.getElementById('sb-p2-rounds');
    const p1S = document.getElementById('sb-p1-slaps');
    const p2S = document.getElementById('sb-p2-slaps');

    if (p1R) p1R.innerText = gameState.p1Rounds;
    if (p2R) p2R.innerText = gameState.aiRounds;
    if (p1S) p1S.innerText = gameState.p1Slaps;
    if (p2S) p2S.innerText = gameState.aiSlaps;
}

// --- HOST LOGIC ---
function startRound() {
    if (!gameState.isHost) return;

    let fullDeck = createDeck();
    shuffle(fullDeck);

    if (gameState.playerTotal <= 0) { sendGameOver("YOU WIN!", true); showEndGame("YOU WIN!", true); return; }
    if (gameState.aiTotal <= 0) { sendGameOver(gameState.opponentName + " WINS!", false); showEndGame(gameState.opponentName + " WINS!", false); return; }

    const pTotal = gameState.playerTotal;
    const pAllCards = fullDeck.slice(0, pTotal);
    const aAllCards = fullDeck.slice(pTotal, 52);

    const pHandSize = Math.min(10, pTotal);
    const aHandSize = Math.min(10, 52 - pTotal);

    const pHandCards = pAllCards.splice(0, pHandSize);
    gameState.playerDeck = pAllCards;

    const aHandCards = aAllCards.splice(0, aHandSize);
    gameState.aiDeck = aAllCards;

    // Reset Tags at Start of Round
    let pBorrow = false, aBorrow = false;
    document.getElementById('borrowed-player').classList.add('hidden');
    document.getElementById('borrowed-ai').classList.add('hidden');

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

    document.getElementById('borrowed-player').classList.toggle('hidden', !pBorrow);
    document.getElementById('borrowed-ai').classList.toggle('hidden', !aBorrow);

    dealSmartHand(pHandCards, 'player');
    dealSmartHand(aHandCards, 'ai');
    updateScoreboard();

    const cleanDeck = (deck) => deck.map(c => ({ suit: c.suit, rank: c.rank, value: c.value, id: c.id }));
    const cleanHand = (hand) => hand.map(c => ({ suit: c.suit, rank: c.rank, value: c.value, id: c.id }));

    send({
        type: 'INIT_ROUND',
        hostName: gameState.myName,
        // Mirror data so each client sees themselves as "player"
        pDeck: cleanDeck(gameState.aiDeck),
        aDeck: cleanDeck(gameState.playerDeck),
        pHand: cleanHand(gameState.aiHand),
        aHand: cleanHand(gameState.playerHand),
        pTotal: gameState.aiTotal,
        aTotal: gameState.playerTotal,
        pBorrow: aBorrow,
        aBorrow: pBorrow
    });
}

// --- GUEST LOGIC ---
function syncBoardState(data) {
    gameState.playerDeck = data.pDeck.map(d => new Card(d.suit, d.rank, d.value, d.id));
    gameState.aiDeck = data.aDeck.map(d => new Card(d.suit, d.rank, d.value, d.id));

    gameState.playerTotal = data.pTotal;
    gameState.aiTotal = data.aTotal;

    document.getElementById('borrowed-player').classList.toggle('hidden', !data.pBorrow);
    document.getElementById('borrowed-ai').classList.toggle('hidden', !data.aBorrow);

    dealSyncedHand(data.pHand, 'player');
    dealSyncedHand(data.aHand, 'ai');
    updateScoreboard();
}

function dealSyncedHand(cardsData, owner) {
    const cards = cardsData.map(d => new Card(d.suit, d.rank, d.value, d.id));
    dealSmartHand(cards, owner);
}

function dealSmartHand(cards, owner) {
    const container = document.getElementById(`${owner}-foundation-area`);
    container.innerHTML = '';
    if (owner === 'player') gameState.playerHand = [];
    else gameState.aiHand = [];

    const piles = [[], [], [], []];
    let idx = 0;

    if (cards.length >= 10) {
        [4, 3, 2, 1].forEach((s, i) => {
            for (let j = 0; j < s; j++) piles[i].push(cards[idx++]);
        });
    } else {
        cards.forEach(c => {
            piles[idx].push(c);
            idx = (idx + 1) % 4;
        });
    }

    let left = 5;

    piles.forEach((pile, laneIdx) => {
        if (pile.length === 0) { left += 24; return; }

        pile.forEach((card, i) => {
            const img = document.createElement('img');
            img.className = 'game-card';
            img.src = card.imgSrc;

            card.owner = owner;
            card.laneIndex = laneIdx;
            card.element = img;

            const isTop = (i === pile.length - 1);

            img.style.left = `${left}%`;
            img.style.zIndex = i + 10;

            if (owner === 'ai') img.style.top = `${10 + i * 5}px`;
            else img.style.top = `${60 - i * 5}px`;

            if (isTop) setCardFaceUp(img, card, owner);
            else setCardFaceDown(img, card, owner);

            container.appendChild(img);

            if (owner === 'player') gameState.playerHand.push(card);
            else gameState.aiHand.push(card);
        });

        left += 24;
    });
}

function getDropSide(mouseEvent) {
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

function makeDraggable(img, cardData) {
    img.onmousedown = (e) => {
        e.preventDefault();

        gameState.globalZ = (gameState.globalZ || 200) + 1;
        img.style.zIndex = gameState.globalZ;
        img.style.transition = 'none';

        // Store snap-back
        cardData.originalLeft = img.style.left;
        cardData.originalTop = img.style.top;

        let shiftX = e.clientX - img.getBoundingClientRect().left;
        let shiftY = e.clientY - img.getBoundingClientRect().top;

        const box = document.getElementById('player-foundation-area');

        function moveAt(pageX, pageY) {
            const boxRect = box.getBoundingClientRect();
            let newLeft = pageX - shiftX - boxRect.left;
            let newTop = pageY - shiftY - boxRect.top;

            const cardW = img.offsetWidth;
            const cardH = img.offsetHeight;

            if (newLeft < 0) newLeft = 0;
            if (newLeft > boxRect.width - cardW) newLeft = boxRect.width - cardW;

            if (newTop > boxRect.height - cardH) newTop = boxRect.height - cardH;

            // THE PHYSICAL WALL
            // If pulling up, check if legal
            if (newTop < 0) {
                if (!gameState.gameActive || !checkLegalPlay(cardData)) {
                    newTop = 0;
                }
            }

            img.style.left = newLeft + 'px';
            img.style.top = newTop + 'px';
        }

        moveAt(e.pageX, e.pageY);

        function onMouseMove(event) { moveAt(event.pageX, event.pageY); }

        function onMouseUp(event) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            img.style.transition = 'all 0.1s ease-out';

            if (gameState.gameActive && parseInt(img.style.top, 10) < -20) {
                const dropSide = getDropSide(event);
                const success = playCardToCenter(cardData, img, dropSide);
                if (!success) {
                    img.style.left = cardData.originalLeft;
                    img.style.top = cardData.originalTop;
                }
            } else {
                // Send drag position (percent of my box)
                const boxRect = box.getBoundingClientRect();
                const currentLeftPx = parseFloat(img.style.left);
                const currentTopPx = parseFloat(img.style.top);
                const leftPct = (currentLeftPx / boxRect.width) * 100;
                const topPct = (currentTopPx / boxRect.height) * 100;

                send({ type: 'OPPONENT_DRAG', cardId: cardData.id, left: leftPct, top: topPct });
            }
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
}

/*
  Drag mirror fix:
  Opponent sends topPct measured inside THEIR player-foundation-area.
  You render it inside YOUR ai-foundation-area, which is flipped vertically.
*/
function executeOpponentDrag(cardId, leftPct, topPct) {
    const card = gameState.aiHand.find(c => c.id === cardId);
    if (!card || !card.element) return;

    const box = document.getElementById('ai-foundation-area');
    if (!box) return;

    const boxRect = box.getBoundingClientRect();
    const cardH = card.element.offsetHeight;

    // Convert topPct into a mirrored topPct so moving "towards centre" stays "towards centre"
    const mirroredTop = 100 - topPct - ((cardH / boxRect.height) * 100);

    card.element.style.left = leftPct + '%';
    card.element.style.top = mirroredTop + '%';
    card.element.style.zIndex = 200;
}

// --- CARD PLAYING (Host adjudication) ---
function playCardToCenter(card, imgElement, dropSide) {
    if (!gameState.gameActive) return false;

    const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
    const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

    if (dropSide !== 'left' && dropSide !== 'right') return false;

    // Must be legal on the pile you dropped on
    if (dropSide === 'left' && !isLeftLegal) return false;
    if (dropSide === 'right' && !isRightLegal) return false;

    // Ask host to adjudicate (host decides which arrives first)
    return requestMoveToHost(card, imgElement, dropSide);
}

function requestMoveToHost(card, imgElement, side) {
    const moveId = `${gameState.myName}-${Date.now()}-${++gameState.moveCounter}`;

    gameState.pendingMoves[moveId] = {
        cardId: card.id,
        img: imgElement,
        originalLeft: card.originalLeft || imgElement.style.left,
        originalTop: card.originalTop || imgElement.style.top,
        side: side
    };

    // Host adjudicates immediately
    if (gameState.isHost) {
        handleMoveAttemptAsHost(moveId, card.id, side, 'player');
        return true;
    }

    // Guest asks host
    send({
        type: 'MOVE_ATTEMPT',
        moveId: moveId,
        cardId: card.id,
        targetSide: side
    });

    return true;
}

function handleMoveAttemptFromOpponent(data) {
    // Host receives guest attempt. Guest side is in guest view.
    // Host view is mirrored, so flip side.
    const mirroredSide = (data.targetSide === 'left') ? 'right' : 'left';
    handleMoveAttemptAsHost(data.moveId, data.cardId, mirroredSide, 'opponent');
}

function handleMoveAttemptAsHost(moveId, cardId, side, who) {
    const hand = (who === 'player') ? gameState.playerHand : gameState.aiHand;
    const card = hand.find(c => c.id === cardId);

    // If card not found, reject
    if (!card) {
        if (who === 'player') handleMoveRejected({ moveId: moveId });
        else send({ type: 'MOVE_REJECTED', moveId: moveId });
        return;
    }

    const pile = (side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;

    // Re-check legality at time of host processing
    if (!checkPileLogic(card, pile)) {
        if (who === 'player') handleMoveRejected({ moveId: moveId });
        else send({ type: 'MOVE_REJECTED', moveId: moveId });
        return;
    }

    // ACCEPT: host commits canonical state first
    pile.push(card);

    if (who === 'player') {
        gameState.playerHand = gameState.playerHand.filter(c => c.id !== cardId);
        gameState.playerTotal--;
    } else {
        gameState.aiHand = gameState.aiHand.filter(c => c.id !== cardId);
        gameState.aiTotal--;
    }

    // Send acceptance to the other client using the recipient view side
    const sideForGuest = (side === 'left') ? 'right' : 'left';

    if (who === 'player') {
        // Host player made the move, notify guest
        send({ type: 'MOVE_ACCEPTED', moveId: moveId, cardId: cardId, side: sideForGuest });
        // Apply locally for host too
        handleMoveAccepted({ moveId: moveId, cardId: cardId, side: side });
    } else {
        // Guest made the move, notify guest
        send({ type: 'MOVE_ACCEPTED', moveId: moveId, cardId: cardId, side: sideForGuest });
        // Render opponent move on host side
        executeOpponentMove(cardId, side);
    }

    updateScoreboard();
    checkSlapCondition();
}

function handleMoveAccepted(data) {
    const pending = gameState.pendingMoves[data.moveId];

    // If this is my pending move, commit it now
    if (pending) {
        const card = gameState.playerHand.find(c => c.id === pending.cardId);
        if (!card) {
            delete gameState.pendingMoves[data.moveId];
            return;
        }

        // Remove from my hand, reduce my total
        gameState.playerHand = gameState.playerHand.filter(c => c.id !== card.id);
        gameState.playerTotal--;

        // Clear ready highlights
        gameState.playerReady = false;
        gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');

        // Remove dragged card DOM and render to centre
        if (pending.img) pending.img.remove();
        renderCenterPile(pending.side, card);

        delete gameState.pendingMoves[data.moveId];

        updateScoreboard();
        checkSlapCondition();

        // Match win check
        if (gameState.playerTotal <= 0) {
            sendGameOver(gameState.myName + " WINS!", false);
            showEndGame("YOU WIN THE MATCH!", true);
            return;
        }

        // Round win check
        if (gameState.playerHand.length === 0) {
            const nextPTotal = gameState.playerTotal;
            const nextATotal = 52 - gameState.playerTotal;

            send({
                type: 'ROUND_OVER',
                winner: 'opponent',
                nextPTotal: nextATotal,
                nextATotal: nextPTotal
            });

            handleRoundOver('player', nextPTotal, nextATotal);
        }

        return;
    }

    // Otherwise it is opponent move accepted, animate it
    executeOpponentMove(data.cardId, data.side);
}

function handleMoveRejected(data) {
    const pending = gameState.pendingMoves[data.moveId];
    if (!pending) return;

    // Snap back
    if (pending.img) {
        pending.img.style.left = pending.originalLeft;
        pending.img.style.top = pending.originalTop;
    }

    delete gameState.pendingMoves[data.moveId];
}

function executeOpponentMove(cardId, side) {
    const card = gameState.aiHand.find(c => c.id === cardId);
    if (!card) return;

    gameState.aiHand = gameState.aiHand.filter(c => c.id !== cardId);
    gameState.aiTotal--;

    animateOpponentMove(card, side, () => {
        // Safety check: if a slap happened while flying (piles cleared), discard
        if (gameState.centerPileLeft.length === 0 && gameState.centerPileRight.length === 0) {
            return;
        }

        const target = (side === 'left') ? gameState.centerPileLeft : gameState.centerPileRight;
        target.push(card);

        renderCenterPile(side, card);
        updateScoreboard();

        gameState.playerReady = false;
        gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');

        checkSlapCondition();
    });
}

function animateOpponentMove(card, side, callback) {
    if (!card.element) return;

    const el = card.element;
    const visualSide = (side === 'left') ? 'center-pile-left' : 'center-pile-right';
    const targetEl = document.getElementById(visualSide);

    el.style.zIndex = 2000;

    const targetRect = targetEl.getBoundingClientRect();
    const startRect = el.getBoundingClientRect();

    const destX = targetRect.left + (targetRect.width / 2) - (startRect.width / 2);
    const destY = targetRect.top + (targetRect.height / 2) - (startRect.height / 2);

    el.style.position = 'fixed';
    el.style.left = destX + 'px';
    el.style.top = destY + 'px';

    setTimeout(() => {
        el.remove();
        callback();
    }, 400);
}

// --- FLIPPING & UTILITIES ---
function tryFlipCard(img, card) {
    const live = gameState.playerHand.filter(c => c.isFaceUp).length;
    if (live < 4) {
        setCardFaceUp(img, card, 'player');
        send({ type: 'OPPONENT_FLIP', cardId: card.id });
    }
}

function executeOpponentFlip(cardId) {
    const card = gameState.aiHand.find(c => c.id === cardId);
    if (!card) return;

    card.isFaceUp = true;

    if (card.element) {
        card.element.src = card.imgSrc;
        card.element.classList.remove('card-face-down');
        card.element.classList.add('opponent-card');
    }
}

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
        img.onclick = null;
    }
}

function setCardFaceDown(img, card, owner) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    card.isFaceUp = false;

    if (owner === 'player') img.onclick = () => tryFlipCard(img, card);
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
    const sp = document.getElementById('score-player');
    const sa = document.getElementById('score-ai');
    if (sp) sp.innerText = gameState.playerTotal;
    if (sa) sa.innerText = gameState.aiTotal;
}

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

function checkSlapCondition() {
    if (gameState.centerPileLeft.length === 0 || gameState.centerPileRight.length === 0) {
        gameState.slapActive = false;
        return;
    }
    const topL = gameState.centerPileLeft[gameState.centerPileLeft.length - 1];
    const topR = gameState.centerPileRight[gameState.centerPileRight.length - 1];
    gameState.slapActive = (topL.rank === topR.rank);
}

function renderCenterPile(side, card) {
    const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
    const container = document.getElementById(id);

    const img = document.createElement('img');
    img.src = card.imgSrc;
    img.className = 'game-card';

    img.style.opacity = '0';
    img.style.transition = 'opacity 0.1s ease-out';

    img.style.left = '50%';
    img.style.top = '50%';

    const rot = Math.random() * 20 - 10;
    img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;

    container.appendChild(img);

    requestAnimationFrame(() => {
        setTimeout(() => { img.style.opacity = '1'; }, 50);
    });
}

function handlePlayerDeckClick() {
    if (!gameState.gameActive) {
        if (gameState.playerReady) return;
        gameState.playerReady = true;
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        send({ type: 'OPPONENT_REVEAL_READY' });
        checkDrawCondition();
        return;
    }

    if (gameState.gameActive && !gameState.playerReady) {
        gameState.playerReady = true;
        document.getElementById('player-draw-deck').classList.add('deck-ready');
        send({ type: 'OPPONENT_REVEAL_READY' });
        checkDrawCondition();
    }
}

function checkDrawCondition() {
    if (gameState.playerReady && gameState.aiReady) {
        if (gameState.isHost) startCountdown(true);
    }
}

function startCountdown(broadcast) {
    if (broadcast) send({ type: 'SYNC_REVEAL' });

    gameState.gameActive = false;

    const overlay = document.getElementById('countdown-overlay');
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
            performReveal();
        }
    }, 800);
}

function performReveal() {
    document.getElementById('player-draw-deck').classList.remove('deck-ready');
    document.getElementById('ai-draw-deck').classList.remove('deck-ready');

    // Borrow Logic (Do not clear tags here)
    if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
        const steal = Math.floor(gameState.aiDeck.length / 2);
        if (steal > 0) {
            gameState.playerDeck = gameState.playerDeck.concat(gameState.aiDeck.splice(0, steal));
            document.getElementById('borrowed-player').classList.remove('hidden');
        }
    }

    if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
        const steal = Math.floor(gameState.playerDeck.length / 2);
        if (steal > 0) {
            gameState.aiDeck = gameState.aiDeck.concat(gameState.playerDeck.splice(0, steal));
            document.getElementById('borrowed-ai').classList.remove('hidden');
        }
    }

    // Scoring Logic
    const pBorrowing = !document.getElementById('borrowed-player').classList.contains('hidden');
    const aBorrowing = !document.getElementById('borrowed-ai').classList.contains('hidden');

    if (pBorrowing) {
        gameState.aiTotal -= 2;
    } else if (aBorrowing) {
        gameState.playerTotal -= 2;
    } else {
        gameState.playerTotal--;
        gameState.aiTotal--;
    }

    // Play Cards and Render
    if (gameState.playerDeck.length > 0) {
        let c = gameState.playerDeck.pop();
        gameState.centerPileRight.push(c);
        renderCenterPile('right', c);
    }

    if (gameState.aiDeck.length > 0) {
        let c = gameState.aiDeck.pop();
        gameState.centerPileLeft.push(c);
        renderCenterPile('left', c);
    }

    updateScoreboard();
    gameState.gameActive = true;
    gameState.playerReady = false;
    gameState.aiReady = false;

    checkSlapCondition();
}

function handleInput(e) {
    if (e.code === 'Space') {
        e.preventDefault();

        const now = Date.now();
        if (now - gameState.lastSpacebarTime < 400) return;

        gameState.lastSpacebarTime = now;

        if (!gameState.slapActive) {
            issuePenalty('player', 'INVALID');
            return;
        }

        send({ type: 'SLAP_CLAIM', timestamp: Date.now() });

        if (gameState.isHost) resolveSlapClaim('host', Date.now());
    }
}

function resolveSlapClaim(who, timestamp) {
    const isHostWin = (who === 'host');
    applySlapResult(isHostWin ? 'player' : 'ai');
    send({ type: 'SLAP_RESULT', winner: isHostWin ? 'ai' : 'player' });
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
        gameState.aiTotal += pileCount;
        gameState.p1Slaps++;
    } else {
        txt.innerText = gameState.opponentName + " WON THE SLAP!";
        overlay.style.backgroundColor = "rgba(200, 0, 0, 0.9)";
        gameState.playerTotal += pileCount;
        gameState.aiSlaps++;
    }

    // RESET ARRAYS
    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];

    // FORCE DOM CLEAR
    const leftPile = document.getElementById('center-pile-left');
    const rightPile = document.getElementById('center-pile-right');
    while (leftPile.firstChild) leftPile.removeChild(leftPile.firstChild);
    while (rightPile.firstChild) rightPile.removeChild(rightPile.firstChild);

    updateScoreboard();
    updateScoreboardWidget();

    setTimeout(() => {
        overlay.classList.add('hidden');
        gameState.playerReady = false;
        gameState.aiReady = false;
        document.getElementById('player-draw-deck').classList.remove('deck-ready');
        document.getElementById('ai-draw-deck').classList.remove('deck-ready');
    }, 2000);
}

function issuePenalty(target, reason) {
    if (target === 'player') {
        gameState.playerTotal += 3;
        gameState.aiTotal = Math.max(0, gameState.aiTotal - 3);
    }
    updateScoreboard();
}

function handleRoundOver(winner, myNextTotal, oppNextTotal) {
    gameState.gameActive = false;

    gameState.playerTotal = myNextTotal;
    gameState.aiTotal = oppNextTotal;

    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];

    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';

    const modal = document.getElementById('game-message');
    const btn = document.getElementById('msg-btn');

    if (winner === 'player') {
        modal.querySelector('h1').innerText = "ROUND WON!";
        modal.querySelector('p').innerText = `You start next round with ${myNextTotal} cards.`;
        gameState.p1Rounds++;
    } else {
        modal.querySelector('h1').innerText = "ROUND LOST!";
        modal.querySelector('p').innerText = `${gameState.opponentName} starts next round with ${oppNextTotal} cards.`;
        gameState.aiRounds++;
    }

    updateScoreboardWidget();

    btn.innerText = "CONTINUE";
    btn.classList.remove('hidden');
    btn.onclick = function () {
        modal.classList.add('hidden');
        if (gameState.isHost) startRound();
    };

    modal.classList.remove('hidden');
}

function sendGameOver(msg, isWin) {
    gameState.matchEnded = true;
    send({ type: 'GAME_OVER', msg: msg, isWin: isWin });
}

function showEndGame(title, isWin, subMsg) {
    gameState.matchEnded = true;

    const modal = document.getElementById('game-message');
    modal.querySelector('h1').innerText = title;
    modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';
    modal.querySelector('p').innerText = subMsg || "Game Over";

    const roundBtn = document.getElementById('msg-btn');
    if (roundBtn) roundBtn.classList.add('hidden');

    let actionContainer = document.getElementById('end-game-buttons');
    if (!actionContainer) {
        actionContainer = document.createElement('div');
        actionContainer.id = 'end-game-buttons';
        actionContainer.style.cssText = "display:flex; gap:10px; justify-content:center; margin-top:20px;";
        modal.appendChild(actionContainer);
    }

    actionContainer.innerHTML = `
        <button class="btn-action-small" onclick="sendRematchRequest()" style="background:#444; width:auto;">
            <i class="fa-solid fa-rotate-right"></i> REMATCH
        </button>
        <button class="btn-action-small" onclick="quitMatch()" style="background:#ff4444; width:auto;">
            Quit to Home Page
        </button>
    `;

    modal.classList.remove('hidden');
}

// --- QUIT, REMATCH, RESET ---
function quitMatch() {
    if (gameState.matchEnded) {
        send({ type: 'OPPONENT_LEFT' });
    } else {
        send({ type: 'CONCEDED' });
    }
    window.location.href = 'index.html';
}

function handleOpponentLeft() {
    const btnContainer = document.getElementById('end-game-buttons');
    if (btnContainer) {
        btnContainer.innerHTML = `
            <p style="color:#ffcc00; font-weight:bold; margin-bottom:10px;">Opponent has left.</p>
            <button class="btn-action-small" onclick="window.location.href='index.html'" style="background:#ff4444; width:auto;">
                Quit to Home Page
            </button>
        `;
    }
}

function sendRematchRequest() {
    const btnContainer = document.getElementById('end-game-buttons');
    if (btnContainer) {
        btnContainer.innerHTML = '<p id="rematch-status-text" style="color:#fff; font-style:italic;">Waiting for opponent...</p>';
    }
    send({ type: 'REMATCH_REQUEST' });
}

function acceptRematch() {
    document.getElementById('rematch-modal').classList.add('hidden');
    send({ type: 'REMATCH_ACCEPTED' });
    performSoftReset();
}

function declineRematch() {
    document.getElementById('rematch-modal').classList.add('hidden');
    send({ type: 'REMATCH_DECLINED' });
}

function performSoftReset() {
    gameState.matchEnded = false;

    gameState.playerTotal = 26;
    gameState.aiTotal = 26;

    gameState.playerHand = [];
    gameState.aiHand = [];

    gameState.centerPileLeft = [];
    gameState.centerPileRight = [];

    gameState.slapActive = false;

    gameState.playerYellows = 0;
    gameState.playerReds = 0;
    gameState.aiYellows = 0;
    gameState.aiReds = 0;

    gameState.pendingMoves = {};
    gameState.moveCounter = 0;

    document.getElementById('game-message').classList.add('hidden');
    document.getElementById('center-pile-left').innerHTML = '';
    document.getElementById('center-pile-right').innerHTML = '';
    document.getElementById('player-foundation-area').innerHTML = '';
    document.getElementById('ai-foundation-area').innerHTML = '';
    document.getElementById('borrowed-player').classList.add('hidden');
    document.getElementById('borrowed-ai').classList.add('hidden');

    updateScoreboardWidget();
    updatePenaltyUI();

    if (gameState.isHost) startRound();
    else console.log("Waiting for Host to deal new round...");
}

function updatePenaltyUI() {
    const pBox = document.getElementById('player-penalties');
    const aBox = document.getElementById('ai-penalties');
    if (pBox) pBox.innerHTML = '';
    if (aBox) aBox.innerHTML = '';
}
