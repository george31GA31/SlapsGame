/* =========================================
   GAME-PVP.JS (Host-authoritative PVP conversion)
   Drop-in approach:
   - Keep your existing HTML ids/classes.
   - Keep player* and ai* arrays (ai = opponent).
   - Remove all AI automation.
   - Host adjudicates all rules and broadcasts results.
   - Clients send intents: READY, PLAY, SLAP.
   ========================================= */

/* ========= 0) NETWORK BOOTSTRAP (WIRE THIS INTO YOUR EXISTING LINK SETUP) =========
   You said you already have a link/connect system.
   Replace the placeholder init below with your existing PeerJS connection logic,
   then call:
     net.isHost = true/false
     net.mySide = 'player' (host) or 'ai' (joiner)
     net.oppSide = opposite
     net.conn = the PeerJS DataConnection
     attachNetHandlers()
   and for host only: startRound(); broadcastSnapshot();
*/

const net = {
  isHost: false,
  mySide: 'player', // host = 'player', joiner = 'ai'
  oppSide: 'ai',
  conn: null,
  slapLock: false
};

function attachNetHandlers() {
  if (!net.conn) return;

  net.conn.on('data', (msg) => {
    if (!msg || !msg.t) return;
    if (net.isHost) handleHostIntent(msg);
    else handleClientEvent(msg);
  });

  // On connect, host sends a full snapshot so joiner renders correctly
  if (net.isHost) {
    sendNet({ t: 'ROLE', mySide: 'ai' }); // tell joiner they are 'ai'
    broadcastSnapshot();
  }
}

function sendNet(msg) {
  if (net.conn && net.conn.open) net.conn.send(msg);
}

function broadcastNet(msg) {
  // If you have more than one connection, broadcast to all here.
  // For 1v1, same as sendNet.
  sendNet(msg);
}

/* ========= 1) GAME STATE (SAME AS YOUR FILE, KEEPING ai* AS OPPONENT) ========= */

const gameState = {
  playerDeck: [], aiDeck: [],
  playerHand: [], aiHand: [],
  centerPileLeft: [], centerPileRight: [],
  globalZ: 1000,
  playerTotal: 26, aiTotal: 26,

  gameActive: false,
  playerReady: false, aiReady: false,
  drawLock: false,
  countdownRunning: false,

  // AI flags remain but unused in PVP
  aiLoopRunning: false, aiProcessing: false, aiInChain: false,

  slapActive: false,
  lastSpacebarTime: 0,

  playerYellows: 0, playerReds: 0,
  aiYellows: 0, aiReds: 0,

  difficulty: 1,

  p1Rounds: 0, aiRounds: 0,
  p1Slaps: 0, aiSlaps: 0
};

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];
const CARD_BACK_SRC = 'assets/cards/back_of_card.png';
const AI_LANES = [5, 29, 53, 77];

class Card {
  constructor(suit, rank, value, id) {
    this.id = id;
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

/* ========= 2) SERIALISATION HELPERS (HOST -> CLIENT) ========= */

function cardToDTO(c) {
  return {
    id: c.id,
    suit: c.suit,
    rank: c.rank,
    value: c.value,
    isFaceUp: !!c.isFaceUp,
    owner: c.owner,
    laneIndex: c.laneIndex
  };
}

function dtoToCard(dto) {
  const c = new Card(dto.suit, dto.rank, dto.value, dto.id);
  c.isFaceUp = !!dto.isFaceUp;
  c.owner = dto.owner;
  c.laneIndex = dto.laneIndex || 0;
  return c;
}

function snapshotState() {
  return {
    playerTotal: gameState.playerTotal,
    aiTotal: gameState.aiTotal,
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
    aiSlaps: gameState.aiSlaps,
    gameActive: gameState.gameActive,

    // full card state
    playerDeck: gameState.playerDeck.map(cardToDTO),
    aiDeck: gameState.aiDeck.map(cardToDTO),
    playerHand: gameState.playerHand.map(cardToDTO),
    aiHand: gameState.aiHand.map(cardToDTO),
    centerPileLeft: gameState.centerPileLeft.map(cardToDTO),
    centerPileRight: gameState.centerPileRight.map(cardToDTO),

    borrowedPlayerVisible: !document.getElementById('borrowed-player').classList.contains('hidden'),
    borrowedAiVisible: !document.getElementById('borrowed-ai').classList.contains('hidden')
  };
}

function applySnapshot(snap) {
  // Reset arrays
  gameState.playerTotal = snap.playerTotal;
  gameState.aiTotal = snap.aiTotal;
  gameState.playerReady = snap.playerReady;
  gameState.aiReady = snap.aiReady;
  gameState.drawLock = snap.drawLock;
  gameState.countdownRunning = snap.countdownRunning;
  gameState.slapActive = snap.slapActive;
  gameState.playerYellows = snap.playerYellows;
  gameState.playerReds = snap.playerReds;
  gameState.aiYellows = snap.aiYellows;
  gameState.aiReds = snap.aiReds;
  gameState.p1Rounds = snap.p1Rounds;
  gameState.aiRounds = snap.aiRounds;
  gameState.p1Slaps = snap.p1Slaps;
  gameState.aiSlaps = snap.aiSlaps;
  gameState.gameActive = snap.gameActive;

  gameState.playerDeck = snap.playerDeck.map(dtoToCard);
  gameState.aiDeck = snap.aiDeck.map(dtoToCard);
  gameState.playerHand = snap.playerHand.map(dtoToCard);
  gameState.aiHand = snap.aiHand.map(dtoToCard);
  gameState.centerPileLeft = snap.centerPileLeft.map(dtoToCard);
  gameState.centerPileRight = snap.centerPileRight.map(dtoToCard);

  // Borrow tags
  const bp = document.getElementById('borrowed-player');
  const ba = document.getElementById('borrowed-ai');
  if (snap.borrowedPlayerVisible) bp.classList.remove('hidden'); else bp.classList.add('hidden');
  if (snap.borrowedAiVisible) ba.classList.remove('hidden'); else ba.classList.add('hidden');

  // Re-render everything from state
  renderAllFromState();
  updateScoreboard();
  updateScoreboardWidget();
  updatePenaltyUI();
}

function broadcastSnapshot() {
  if (!net.isHost) return;
  broadcastNet({ t: 'SNAPSHOT', snap: snapshotState() });
}

/* ========= 3) REMOVE AI AUTOMATION (DO NOT CALL THESE IN PVP) ========= */
// startAILoop / attemptAIMove / animateAIMove / animateAIMoveToLane / triggerAISlap are intentionally unused.

/* ========= 4) INPUTS BECOME INTENTS ========= */

window.onload = function () {
  document.addEventListener('keydown', handleInput);
  const pDeck = document.getElementById('player-draw-deck');
  if (pDeck) pDeck.onclick = handlePlayerDeckClick;

  updateScoreboardWidget();

  // Host should start the round.
  // Joiner should wait for SNAPSHOT.
  if (net.isHost) {
    startRound();
    broadcastSnapshot();
  }
};

function handleInput(e) {
  if (e.code !== 'Space') return;
  e.preventDefault();
  if (!gameState.gameActive) return;

  const now = Date.now();
  if (now - gameState.lastSpacebarTime < 400) return;
  gameState.lastSpacebarTime = now;

  // Send slap attempt to host
  sendNet({ t: 'SLAP_INTENT', side: net.mySide, ts: now });
}

function handlePlayerDeckClick() {
  // Local UI feedback
  if (net.mySide === 'player') {
    if (gameState.playerReady) return;
    gameState.playerReady = true;
    document.getElementById('player-draw-deck').classList.add('deck-ready');
  } else {
    if (gameState.aiReady) return;
    gameState.aiReady = true;
    document.getElementById('ai-draw-deck').classList.add('deck-ready');
  }

  // Tell host we are ready
  sendNet({ t: 'READY_INTENT', side: net.mySide });

  // Host will run countdown/reveal and broadcast snapshot/events.
}

/* ========= 5) HOST INTENT HANDLER (AUTHORITATIVE RULES) ========= */

function handleHostIntent(msg) {
  switch (msg.t) {
    case 'READY_INTENT':
      hostOnReady(msg.side);
      break;
    case 'PLAY_INTENT':
      hostOnPlay(msg.side, msg.cardId, msg.dropSide);
      break;
    case 'SLAP_INTENT':
      hostOnSlap(msg.side, msg.ts);
      break;
  }
}

function hostOnReady(side) {
  if (side === 'player') {
    if (gameState.playerReady) return;
    gameState.playerReady = true;
    document.getElementById('player-draw-deck').classList.add('deck-ready');
  } else {
    if (gameState.aiReady) return;
    gameState.aiReady = true;
    document.getElementById('ai-draw-deck').classList.add('deck-ready');
  }

  // If both ready, host runs countdown then reveal and broadcasts.
  if (!gameState.drawLock && !gameState.countdownRunning && gameState.playerReady && gameState.aiReady) {
    gameState.drawLock = true;
    broadcastSnapshot();
    setTimeout(() => hostStartCountdown(), 50);
  } else {
    broadcastSnapshot();
  }
}

function hostStartCountdown() {
  if (gameState.countdownRunning) return;

  gameState.countdownRunning = true;
  gameState.gameActive = false;
  broadcastNet({ t: 'COUNTDOWN', n: 3 });

  let count = 3;
  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      broadcastNet({ t: 'COUNTDOWN', n: count });
    } else {
      clearInterval(timer);
      gameState.countdownRunning = false;
      hostPerformReveal();
    }
  }, 800);
}

function hostOnPlay(side, cardId, dropSide) {
  if (!gameState.gameActive) {
    broadcastNet({ t: 'PLAY_RES', ok: false, side, cardId, dropSide });
    return;
  }

  const card = findCardInHandById(side, cardId);
  if (!card) {
    broadcastNet({ t: 'PLAY_RES', ok: false, side, cardId, dropSide });
    return;
  }

  const ok = playCardToCenterHost(side, card, dropSide);
  broadcastNet({ t: 'PLAY_RES', ok, side, cardId, dropSide });

  // Always send snapshot after a resolved move to avoid drift
  broadcastSnapshot();
}

function hostOnSlap(side, ts) {
  if (net.slapLock) return;

  if (!gameState.gameActive) return;

  // Slap must be currently active
  if (!gameState.slapActive) {
    // Bad slap penalty
    issuePenalty(side, 'BAD SLAP');
    broadcastSnapshot();
    return;
  }

  net.slapLock = true;
  hostResolveSlap(side);
  broadcastSnapshot();
  setTimeout(() => { net.slapLock = false; }, 500);
}

/* ========= 6) CLIENT EVENT HANDLER (RENDER WHAT HOST SAYS) ========= */

function handleClientEvent(msg) {
  switch (msg.t) {
    case 'ROLE':
      // host tells joiner their side
      net.mySide = msg.mySide;
      net.oppSide = (msg.mySide === 'player') ? 'ai' : 'player';
      break;

    case 'SNAPSHOT':
      applySnapshot(msg.snap);
      break;

    case 'COUNTDOWN':
      clientShowCountdown(msg.n);
      break;

    case 'PLAY_RES':
      // no-op needed if you always snapshot after
      break;
  }
}

function clientShowCountdown(n) {
  const overlay = document.getElementById('countdown-overlay');
  overlay.classList.remove('hidden');
  overlay.innerText = n;

  if (n === 1) {
    setTimeout(() => overlay.classList.add('hidden'), 850);
  }
}

/* ========= 7) ROUND / REVEAL / SLAP (HOST-ONLY IMPLEMENTATIONS) ========= */

function startRound() {
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

  // reset borrow tags
  document.getElementById('borrowed-player').classList.add('hidden');
  document.getElementById('borrowed-ai').classList.add('hidden');

  // start shortage borrow
  if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 1) {
    const steal = Math.floor(gameState.aiDeck.length / 2);
    gameState.playerDeck = gameState.aiDeck.splice(0, steal);
    document.getElementById('borrowed-player').classList.remove('hidden');
  }

  if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 1) {
    const steal = Math.floor(gameState.playerDeck.length / 2);
    gameState.aiDeck = gameState.playerDeck.splice(0, steal);
    document.getElementById('borrowed-ai').classList.remove('hidden');
  }

  dealSmartHand(pHandCards, 'player');
  dealSmartHand(aHandCards, 'ai');

  gameState.centerPileLeft = [];
  gameState.centerPileRight = [];
  document.getElementById('center-pile-left').innerHTML = '';
  document.getElementById('center-pile-right').innerHTML = '';
  document.getElementById('game-message').classList.add('hidden');

  gameState.slapActive = false;
  gameState.gameActive = false;
  gameState.playerReady = false;
  gameState.aiReady = false;
  gameState.drawLock = false;
  gameState.countdownRunning = false;

  checkDeckVisibility();
  updateScoreboard();
}

function hostPerformReveal() {
  if (!gameState.drawLock) return;

  document.getElementById('player-draw-deck').classList.remove('deck-ready');
  document.getElementById('ai-draw-deck').classList.remove('deck-ready');

  // Borrow logic
  if (gameState.playerDeck.length === 0 && gameState.aiDeck.length > 0) {
    const stealAmount = Math.floor(gameState.aiDeck.length / 2);
    if (stealAmount > 0) {
      const stolen = gameState.aiDeck.splice(0, stealAmount);
      gameState.playerDeck = gameState.playerDeck.concat(stolen);
      document.getElementById('borrowed-player').classList.remove('hidden');
    }
  }
  if (gameState.aiDeck.length === 0 && gameState.playerDeck.length > 0) {
    const stealAmount = Math.floor(gameState.playerDeck.length / 2);
    if (stealAmount > 0) {
      const stolen = gameState.playerDeck.splice(0, stealAmount);
      gameState.aiDeck = gameState.aiDeck.concat(stolen);
      document.getElementById('borrowed-ai').classList.remove('hidden');
    }
  }

  // Ownership scoring
  const playerBorrowing = !document.getElementById('borrowed-player').classList.contains('hidden');
  const aiBorrowing = !document.getElementById('borrowed-ai').classList.contains('hidden');

  if (playerBorrowing) gameState.aiTotal--;
  else gameState.playerTotal--;

  if (aiBorrowing) gameState.playerTotal--;
  else gameState.aiTotal--;

  // Render reveal cards to centre piles
  if (gameState.playerDeck.length > 0) {
    let pCard = gameState.playerDeck.pop();
    gameState.centerPileRight.push(pCard);
    renderCenterPile('right', pCard);
  }
  if (gameState.aiDeck.length > 0) {
    let aCard = gameState.aiDeck.pop();
    gameState.centerPileLeft.push(aCard);
    renderCenterPile('left', aCard);
  }

  updateScoreboard();

  gameState.gameActive = true;
  gameState.playerReady = false;
  gameState.aiReady = false;

  gameState.drawLock = false;

  hostCheckSlapCondition();
}

function hostCheckSlapCondition() {
  if (gameState.centerPileLeft.length === 0 || gameState.centerPileRight.length === 0) {
    gameState.slapActive = false;
    return;
  }
  const topL = gameState.centerPileLeft[gameState.centerPileLeft.length - 1];
  const topR = gameState.centerPileRight[gameState.centerPileRight.length - 1];
  gameState.slapActive = (topL.rank === topR.rank);
}

function hostResolveSlap(winnerSide) {
  gameState.slapActive = false;
  gameState.gameActive = false;

  const pilesTotal = gameState.centerPileLeft.length + gameState.centerPileRight.length;

  // Keep your existing scoring direction (as-is)
  if (winnerSide === 'player') {
    gameState.aiTotal += pilesTotal;
    gameState.p1Slaps++;
  } else {
    gameState.playerTotal += pilesTotal;
    gameState.aiSlaps++;
  }

  gameState.centerPileLeft = [];
  gameState.centerPileRight = [];
  document.getElementById('center-pile-left').innerHTML = '';
  document.getElementById('center-pile-right').innerHTML = '';

  updateScoreboard();
  updateScoreboardWidget();

  // reset ready visuals
  gameState.playerReady = false;
  gameState.aiReady = false;
  document.getElementById('player-draw-deck').classList.remove('deck-ready');
  document.getElementById('ai-draw-deck').classList.remove('deck-ready');

  // end checks
  if (gameState.playerTotal <= 0) showEndGame("PLAYER WINS THE MATCH!", true);
  if (gameState.aiTotal <= 0) showEndGame("OPPONENT WINS THE MATCH!", false);
}

/* ========= 8) HOST-ONLY PLAY CARD (STATE MUTATION) ========= */

function playCardToCenterHost(side, card, dropSide) {
  // Must be dropped on a pile
  if (dropSide !== 'left' && dropSide !== 'right') return false;

  const isLeftLegal = checkPileLogic(card, gameState.centerPileLeft);
  const isRightLegal = checkPileLogic(card, gameState.centerPileRight);

  let target = null;
  let renderSide = '';

  if (dropSide === 'left' && isLeftLegal) { target = gameState.centerPileLeft; renderSide = 'left'; }
  if (dropSide === 'right' && isRightLegal) { target = gameState.centerPileRight; renderSide = 'right'; }
  if (!target) return false;

  // Ready reset
  gameState.playerReady = false;
  gameState.aiReady = false;
  document.getElementById('player-draw-deck').classList.remove('deck-ready');
  document.getElementById('ai-draw-deck').classList.remove('deck-ready');

  target.push(card);

  if (side === 'player') {
    gameState.playerHand = gameState.playerHand.filter(c => c.id !== card.id);
    gameState.playerTotal--;
    if (gameState.playerTotal <= 0) { showEndGame("PLAYER WINS THE MATCH!", true); return true; }
    if (gameState.playerHand.length === 0) endRound('player');
  } else {
    gameState.aiHand = gameState.aiHand.filter(c => c.id !== card.id);
    gameState.aiTotal--;
    if (gameState.aiTotal <= 0) { showEndGame("OPPONENT WINS THE MATCH!", false); return true; }
    if (gameState.aiHand.length === 0) endRound('ai');
  }

  // Remove DOM element for that card (host side only)
  if (card.element) card.element.remove();

  renderCenterPile(renderSide, card);
  updateScoreboard();
  hostCheckSlapCondition();
  return true;
}

function findCardInHandById(side, cardId) {
  const hand = (side === 'player') ? gameState.playerHand : gameState.aiHand;
  return hand.find(c => c.id === cardId) || null;
}

/* ========= 9) RENDERING FROM STATE (CLIENT + HOST) ========= */

function renderAllFromState() {
  // Foundations
  renderFoundationFromState('player');
  renderFoundationFromState('ai');

  // Centre piles
  document.getElementById('center-pile-left').innerHTML = '';
  document.getElementById('center-pile-right').innerHTML = '';

  for (const c of gameState.centerPileLeft) renderCenterPile('left', c);
  for (const c of gameState.centerPileRight) renderCenterPile('right', c);

  // Ready visuals
  document.getElementById('player-draw-deck').classList.toggle('deck-ready', !!gameState.playerReady);
  document.getElementById('ai-draw-deck').classList.toggle('deck-ready', !!gameState.aiReady);
}

function renderFoundationFromState(owner) {
  const container = document.getElementById(`${owner}-foundation-area`);
  container.innerHTML = '';

  const hand = (owner === 'player') ? gameState.playerHand : gameState.aiHand;

  // Group by laneIndex
  const lanes = [[], [], [], []];
  hand.forEach(c => lanes[c.laneIndex].push(c));

  // Ensure lane order is stable. (Your deal order already sets this, but snapshot may not)
  lanes.forEach(l => l.sort((a, b) => 0)); // no-op: kept for clarity

  let currentLeftPercent = 5;

  lanes.forEach((pile, laneIdx) => {
    if (pile.length === 0) { currentLeftPercent += 24; return; }

    pile.forEach((card, index) => {
      const img = document.createElement('img');
      img.className = 'game-card';

      card.owner = owner;
      card.laneIndex = laneIdx;
      card.element = img;

      // Visibility rules:
      // - You see your own face-up cards.
      // - Opponent: show backs always (recommended for PVP).
      const isMine = (owner === net.mySide);
      if (isMine && card.isFaceUp) setCardFaceUp(img, card, owner);
      else setCardFaceDown(img, card, owner);

      img.style.left = `${currentLeftPercent}%`;

      const stackOffset = index * 5;
      if (owner === 'ai') img.style.top = `${10 + stackOffset}px`;
      else img.style.top = `${60 - stackOffset}px`;

      img.style.zIndex = index + 10;
      container.appendChild(img);

      // Make draggable only if it is mine AND face up AND player side
      if (isMine && owner === 'player' && card.isFaceUp) {
        makeDraggable(img, card);
      }

      // If I am 'ai' side on this client, I still need to drag from my own foundation area,
      // but your HTML uses player-foundation-area for dragging boundaries.
      // Simplest fix: only allow dragging on the host for now, or duplicate boundary ids.
      // If you want both clients dragging properly, tell me your HTML and I will patch it cleanly.
    });

    currentLeftPercent += 24;
  });
}

/* ========= 10) YOUR EXISTING CORE HELPERS (MOSTLY UNCHANGED) ========= */

function createDeck() {
  let deck = [];
  let id = 0;
  SUITS.forEach(suit => {
    RANKS.forEach((rank, index) => {
      deck.push(new Card(suit, rank, index + 2, `c${id++}`));
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
  document.getElementById('score-player').innerText = gameState.playerTotal;
  document.getElementById('score-ai').innerText = gameState.aiTotal;
}

function checkDeckVisibility() {
  document.getElementById('player-draw-deck').classList.remove('hidden');
  document.getElementById('ai-draw-deck').classList.remove('hidden');
}

function endRound(winner) {
  gameState.gameActive = false;
  if (winner === 'player') {
    gameState.aiTotal = 52 - gameState.playerTotal;
    gameState.p1Rounds++;
    showRoundMessage("ROUND WON!", `You start next round with ${gameState.playerTotal} cards.`);
  } else {
    gameState.playerTotal = 52 - gameState.aiTotal;
    gameState.aiRounds++;
    showRoundMessage("ROUND LOST!", `Opponent starts next round with ${gameState.aiTotal} cards.`);
  }
  updateScoreboardWidget();
}

function checkPileLogic(card, targetPile) {
  if (targetPile.length === 0) return false;
  const targetCard = targetPile[targetPile.length - 1];
  const diff = Math.abs(card.value - targetCard.value);
  return (diff === 1 || diff === 12);
}

function renderCenterPile(side, card) {
  const id = side === 'left' ? 'center-pile-left' : 'center-pile-right';
  const container = document.getElementById(id);
  const img = document.createElement('img');
  img.src = card.imgSrc;
  img.className = 'game-card';
  img.style.left = '50%';
  img.style.top = '50%';
  const rot = Math.random() * 20 - 10;
  img.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
  container.appendChild(img);
}

function setCardFaceUp(img, card, owner) {
  img.src = card.imgSrc;
  img.classList.remove('card-face-down');
  card.isFaceUp = true;
  if (owner === 'player') {
    img.classList.add('player-card');
    img.onclick = null;
  } else {
    img.classList.add('opponent-card');
  }
}

function setCardFaceDown(img, card, owner) {
  img.src = CARD_BACK_SRC;
  img.classList.add('card-face-down');
  card.isFaceUp = false;
  // In PVP, do not allow flipping opponent cards locally.
  // Only host should decide flip rules and snapshot will reflect them.
}

function dealSmartHand(cards, owner) {
  const container = document.getElementById(`${owner}-foundation-area`);
  container.innerHTML = '';
  if (owner === 'player') gameState.playerHand = [];
  else gameState.aiHand = [];

  const piles = [[], [], [], []];
  if (cards.length >= 10) {
    let cardIdx = 0;
    [4, 3, 2, 1].forEach((size, i) => {
      for (let j = 0; j < size; j++) piles[i].push(cards[cardIdx++]);
    });
  } else {
    let pileIdx = 0;
    cards.forEach(card => { piles[pileIdx].push(card); pileIdx = (pileIdx + 1) % 4; });
  }

  let currentLeftPercent = 5;
  piles.forEach((pile, laneIdx) => {
    if (pile.length === 0) { currentLeftPercent += 24; return; }

    pile.forEach((card, index) => {
      const img = document.createElement('img');
      img.className = 'game-card';

      card.owner = owner;
      card.laneIndex = laneIdx;

      const isTopCard = (index === pile.length - 1);

      // Host decides face-up state
      if (isTopCard) card.isFaceUp = true;

      // Visibility: show your own face-up cards, opponent backs
      const isMine = (owner === net.mySide);
      if (isMine && card.isFaceUp) setCardFaceUp(img, card, owner);
      else setCardFaceDown(img, card, owner);

      img.style.left = `${currentLeftPercent}%`;
      let stackOffset = index * 5;
      if (owner === 'ai') img.style.top = `${10 + stackOffset}px`;
      else img.style.top = `${60 - stackOffset}px`;

      img.style.zIndex = index + 10;
      card.element = img;
      container.appendChild(img);

      if (owner === 'player') gameState.playerHand.push(card);
      else gameState.aiHand.push(card);

      // Draggable only if mine + player owner + face up
      if (owner === 'player' && isMine && card.isFaceUp) makeDraggable(img, card);
    });

    currentLeftPercent += 24;
  });
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

  const inLeft = x >= (l.left - pad) && x <= (l.right + pad) && y >= (l.top - pad) && y <= (l.bottom + pad);
  const inRight = x >= (r.left - pad) && x <= (r.right + pad) && y >= (r.top - pad) && y <= (r.bottom + pad);

  if (inLeft) return 'left';
  if (inRight) return 'right';
  return null;
}

/* ========= 11) DRAGGING (CLIENT SENDS INTENT, HOST APPLIES) ========= */

function makeDraggable(img, cardData) {
  img.onmousedown = (e) => {
    e.preventDefault();
    gameState.globalZ++;
    img.style.zIndex = gameState.globalZ;
    img.style.transition = 'none';

    cardData.originalLeft = img.style.left;
    cardData.originalTop = img.style.top;

    const shiftX = e.clientX - img.getBoundingClientRect().left;
    const shiftY = e.clientY - img.getBoundingClientRect().top;

    const box = document.getElementById('player-foundation-area'); // your existing boundary
    function moveAt(pageX, pageY) {
      const boxRect = box.getBoundingClientRect();
      let newLeft = pageX - shiftX - boxRect.left;
      let newTop = pageY - shiftY - boxRect.top;

      // Boundary remains (local feel), but legality is host-validated
      if (newTop < 0) newTop = 0;

      img.style.left = newLeft + 'px';
      img.style.top = newTop + 'px';
    }

    moveAt(e.pageX, e.pageY);

    function onMouseMove(event) { moveAt(event.pageX, event.pageY); }

    function onMouseUp(event) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      img.style.transition = 'all 0.1s ease-out';

      // Only try “play” if dragged upward past threshold (your existing behaviour)
      if (gameState.gameActive && parseInt(img.style.top) < -10) {
        const dropSide = getDropSide(img, event);
        // Send intent; host will validate and broadcast snapshot
        sendNet({ t: 'PLAY_INTENT', side: net.mySide, cardId: cardData.id, dropSide });
      }

      // Always snap back locally; snapshot will re-render on success
      img.style.left = cardData.originalLeft;
      img.style.top = cardData.originalTop;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };
}

/* ========= 12) PENALTIES + UI (UNCHANGED, HOST ONLY CALLS issuePenalty) ========= */

function issuePenalty(targetSide, reason) {
  let yellows;
  if (targetSide === 'player') { gameState.playerYellows++; yellows = gameState.playerYellows; }
  else { gameState.aiYellows++; yellows = gameState.aiYellows; }

  if (yellows >= 2) {
    if (targetSide === 'player') { gameState.playerYellows = 0; gameState.playerReds++; }
    else { gameState.aiYellows = 0; gameState.aiReds++; }
    executeRedCardPenalty(targetSide);
  }
  updatePenaltyUI();
}

function executeRedCardPenalty(offenderSide) {
  const victim = (offenderSide === 'player') ? 'ai' : 'player';
  const penaltyAmount = 3;

  let victimHand = (victim === 'player') ? gameState.playerHand : gameState.aiHand;
  let victimDeck = (victim === 'player') ? gameState.playerDeck : gameState.aiDeck;

  for (let i = 0; i < penaltyAmount; i++) {
    if (victimDeck.length > 0) {
      victimDeck.pop();
    } else if (victimHand.length > 0) {
      const cardToRemove = victimHand.pop();
      if (cardToRemove && cardToRemove.element) cardToRemove.element.remove();
    }
  }

  if (offenderSide === 'player') {
    gameState.playerTotal += 3;
    gameState.aiTotal = Math.max(0, gameState.aiTotal - 3);
  } else {
    gameState.aiTotal += 3;
    gameState.playerTotal = Math.max(0, gameState.playerTotal - 3);
  }

  if (gameState.playerTotal <= 0) showEndGame("PLAYER WINS THE MATCH!", true);
  if (gameState.aiTotal <= 0) showEndGame("OPPONENT WINS THE MATCH!", false);

  updateScoreboard();
}

function updatePenaltyUI() {
  renderBadges('player', gameState.playerYellows, gameState.playerReds);
  renderBadges('ai', gameState.aiYellows, gameState.aiReds);
}

function renderBadges(who, y, r) {
  const container = document.getElementById(`${who}-penalties`);
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

/* ========= 13) MESSAGES / ENDGAME / WIDGET (UNCHANGED) ========= */

function showRoundMessage(title, sub) {
  const modal = document.getElementById('game-message');
  modal.querySelector('h1').innerText = title;
  modal.querySelector('p').innerText = sub;
  const btn = document.getElementById('msg-btn');
  btn.innerText = "CONTINUE";
  btn.onclick = function () {
    if (net.isHost) {
      startRound();
      broadcastSnapshot();
    }
  };
  modal.classList.remove('hidden');
}

function showEndGame(title, isWin) {
  const modal = document.getElementById('game-message');
  modal.querySelector('h1').innerText = title;
  modal.querySelector('h1').style.color = isWin ? '#66ff66' : '#ff7575';

  const contentArea = modal.querySelector('p');
  contentArea.innerHTML = `
    <div style="display:flex; gap:10px; justify-content:center; margin-top:20px;">
      <button class="btn-action-small" onclick="location.reload()" style="background:#444; width:auto;">
        <i class="fa-solid fa-rotate-right"></i> REMATCH
      </button>
      <button class="btn-action-small" onclick="window.location.href='index.html'" style="background:#ff4444; width:auto;">
        MAIN MENU
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
  if (p1Name) p1Name.innerText = "You";
  if (p2Name) p2Name.innerText = "Opponent";

  const p1R = document.getElementById('sb-p1-rounds');
  const p2R = document.getElementById('sb-p2-rounds');
  const p1S = document.getElementById('sb-p1-slaps');
  const p2S = document.getElementById('sb-p2-slaps');

  if (p1R) p1R.innerText = gameState.p1Rounds;
  if (p2R) p2R.innerText = gameState.aiRounds;
  if (p1S) p1S.innerText = gameState.p1Slaps;
  if (p2S) p2S.innerText = gameState.aiSlaps;
}
