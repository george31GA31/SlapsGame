/* Solo match controller, shared by practice and local tournament play. */

const gameState = {
    playerDeck: [], aiDeck: [],
    playerHand: [], aiHand: [],
    centerPileLeft: [], centerPileRight: [],
    playerHolding: [], aiHolding: [],
    playerTotal: 26, aiTotal: 26,
    playerSlapCards: 0, aiSlapCards: 0,
    p1Rounds: 0, aiRounds: 0,
    p1Slaps: 0, aiSlaps: 0,
    playerYellows: 0, playerReds: 0,
    aiYellows: 0, aiReds: 0,
    globalZ: 1000,
    difficulty: 1,
    gameActive: false,
    playerReady: false, aiReady: false,
    drawLock: false,
    resumeBlocked: false,
    aiProcessing: false, aiInChain: false,
    activitySerial: 0,
    slapActive: false
};

const CARD_BACK_SRC = 'assets/cards/back_of_card.png';
const AI_LANES = [5, 29, 53, 77];
const soloEl = id => document.getElementById(id);
let countdownTimer = null;
let slapDisplayTimer = null;

window.addEventListener('load', () => {
    gameState.difficulty = Number(localStorage.getItem('slapsDifficulty')) || 1;
    document.addEventListener('keydown', handleInput);
    soloEl('player-draw-deck').onclick = handlePlayerDeckClick;
    SlapsEngine.initializeMatch(gameState);
    startRound();
    setInterval(() => {
        if (gameState.gameActive && !gameState.aiProcessing) attemptAIMove();
    }, 250);
});

function setGameActive(active) {
    if (gameState.gameActive !== active) {
        gameState.activitySerial++;
        gameState.aiProcessing = false;
        gameState.aiInChain = false;
    }
    gameState.gameActive = active;
    if (!active) gameState.slapActive = false;
}

function setReadiness(player = false, ai = false) {
    gameState.playerReady = player;
    gameState.aiReady = ai;
    soloEl('player-draw-deck').classList.toggle('deck-ready', player);
    soloEl('ai-draw-deck').classList.toggle('deck-ready', ai);
}

function startRound() {
    const result = SlapsEngine.startRound(gameState);
    if (!result.ok) return false;
    setGameActive(false);
    setReadiness();
    gameState.drawLock = false;
    gameState.resumeBlocked = false;

    renderFoundation('player', gameState.playerHand);
    renderFoundation('ai', gameState.aiHand);
    clearCentreDisplay();
    soloEl('game-message').classList.add('hidden');
    refreshMatchDisplay();
    return true;
}

function renderFoundation(seat, hand) {
    const container = soloEl(seat + '-foundation-area');
    container.replaceChildren();
    const depth = [0, 0, 0, 0];
    for (const card of hand) {
        const img = document.createElement('img');
        const index = depth[card.laneIndex]++;
        img.className = 'game-card';
        img.draggable = false;
        img.dataset.cardId = card.id;
        img.dataset.lane = String(card.laneIndex);
        img.style.left = AI_LANES[card.laneIndex] + '%';
        const step = seat === 'ai' ? index : 3 - index;
        img.style.top = 'calc(4px + ' + step + ' * var(--stack-step))';
        img.style.zIndex = String(index + 10);
        card.element = img;
        if (card.isFaceUp) setCardFaceUp(img, card, seat);
        else setCardFaceDown(img, card, seat);
        container.append(img);
    }
    syncFoundationExposure(hand, seat);
}

function syncFoundationExposure(hand, seat) {
    const exposed = new Set(SlapsEngine.getExposedCards(hand));
    for (const card of hand) {
        const img = card.element;
        const covered = !exposed.has(card);
        img.dataset.covered = String(covered);
        if (covered) img.setAttribute('aria-hidden', 'true');
        else img.removeAttribute('aria-hidden');
        img.tabIndex = seat === 'player' && !covered ? 0 : -1;
    }
}

function setCardFaceUp(img, card, seat) {
    const previousFace = img.getAttribute('src');
    img.src = card.imgSrc;
    img.setAttribute('aria-label', card.rank + ' of ' + card.suit);
    img.classList.remove('card-face-down');
    img.classList.add(seat === 'player' ? 'player-card' : 'opponent-card');
    img.onclick = null;
    img.onkeydown = null;
    if (seat === 'player') makeDraggable(img, card);
    if (previousFace === CARD_BACK_SRC) GameVisuals.flip(img, previousFace);
}

function setCardFaceDown(img, card, seat) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    if (seat !== 'player') return;
    img.setAttribute('aria-label', 'Face-down Foundation card. Press Enter to reveal it when exposed.');
    img.onclick = () => tryFlipCard(img, card);
    img.onkeydown = event => {
        if (event.key !== 'Enter' || event.repeat) return;
        event.preventDefault();
        tryFlipCard(img, card);
    };
}

function tryFlipCard(img, card, seat = 'player') {
    if (!gameState.gameActive) return false;
    const decision = SlapsEngine.flipFoundation(gameState, seat, card);
    if (!decision.ok) {
        if (seat === 'player') SlapsFeedback.show(SlapsFeedback.flipReason(decision.reason));
        return false;
    }
    setCardFaceUp(img, card, seat);
    return true;
}

function checkPileLogic(card, targetPile) {
    return SlapsEngine.canPlayOnPile(card, targetPile);
}

function makeDraggable(img, card) {
    SlapsDrag.attach(img, {
        canLift: () => gameState.gameActive && card.isFaceUp &&
            SlapsEngine.isTopOfLane(gameState.playerHand, card) &&
            (checkPileLogic(card, gameState.centerPileLeft) || checkPileLogic(card, gameState.centerPileRight)),
        play: side => playCardToCenter(card, img, side)
    });
}

function playCardToCenter(card, img, side) {
    if (!gameState.gameActive) return false;
    const seat = card.owner;
    const decision = SlapsEngine.playFoundation(gameState, seat, card, side);
    if (!decision.ok) return false;

    setReadiness();
    GameVisuals.stopFlip(img);
    img.remove();
    renderCenterPile(side, card);
    if (decision.finishedRound) {
        endRound(seat, decision.matchWinner);
    } else {
        const hand = seat === 'player' ? gameState.playerHand : gameState.aiHand;
        syncFoundationExposure(hand, seat);
        refreshMatchDisplay();
        checkSlapCondition();
    }
    return true;
}

function handleInput(event) {
    if (!gameState.gameActive || event.code !== 'Space' || event.repeat ||
        event.target?.closest?.('button, input, select, textarea')) return;
    event.preventDefault();
    if (resolveSlap('player')) return;

    const misslap = SlapsEngine.recordMisslap(gameState, 'player');
    if (!misslap.ok) return;
    updatePenalties();
    const feedback = {
        yellow: 'Misslap. Yellow Card for repeated misslaps.',
        red: 'Misslap. Red Card transfer applies at the round break.'
    };
    SlapsFeedback.show(feedback[misslap.severity] || 'Misslap. The centre ranks must match.');
}

function checkSlapCondition() {
    gameState.slapActive = gameState.gameActive &&
        SlapsEngine.isSlapAvailable(gameState.centerPileLeft, gameState.centerPileRight);
    if (gameState.slapActive) triggerAISlap();
}

function resolveSlap(winner) {
    if (!gameState.gameActive) return false;
    const result = SlapsEngine.takeSlap(gameState, winner);
    if (!result.ok) return false;

    setGameActive(false);
    setReadiness();
    clearCentreDisplay();
    refreshMatchDisplay();
    gameState.resumeBlocked = true;

    const playerWon = winner === 'player';
    const overlay = soloEl('slap-overlay');
    soloEl('slap-text').textContent = playerWon ? 'PLAYER SLAP WON!' : 'AI SLAP WON!';
    overlay.style.backgroundColor = playerWon ? 'rgba(0, 200, 0, 0.9)' : 'rgba(200, 0, 0, 0.9)';
    overlay.classList.remove('hidden');
    slapDisplayTimer = setTimeout(() => {
        slapDisplayTimer = null;
        overlay.classList.add('hidden');
        gameState.resumeBlocked = false;
    }, 1600);
    return true;
}

function handlePlayerDeckClick() {
    if (gameState.drawLock || gameState.resumeBlocked || gameState.playerReady) return;
    if (gameState.phase === 'active' && !SlapsEngine.canRestart(gameState)) {
        const message = SlapsEngine.getExposedCards(gameState.playerHand).some(card => !card.isFaceUp)
            ? 'Reveal your exposed Foundation cards before drawing.'
            : 'Draw cards when neither player has a Foundation action.';
        SlapsFeedback.show(message);
        return;
    }
    if (gameState.phase !== 'active' && gameState.phase !== 'awaiting_reveal') return;
    setReadiness(true);
    setTimeout(() => {
        if (!gameState.playerReady || gameState.drawLock) return;
        if (gameState.phase === 'active' && !SlapsEngine.canRestart(gameState)) {
            setReadiness();
            return;
        }
        setReadiness(true, true);
        startCountdown();
    }, 800);
}

function startCountdown() {
    gameState.drawLock = true;
    setGameActive(false);

    const overlay = soloEl('countdown-overlay');
    let count = 3;
    overlay.textContent = String(count);
    overlay.classList.remove('hidden');
    countdownTimer = setInterval(() => {
        count--;
        if (count > 0) {
            overlay.textContent = String(count);
            return;
        }
        clearInterval(countdownTimer);
        countdownTimer = null;
        overlay.classList.add('hidden');
        performRevealShow();
    }, 800);
}

function performRevealShow() {
    const result = SlapsEngine.revealDraw(gameState);
    gameState.drawLock = false;
    setReadiness();

    if (!result.ok) {
        setGameActive(gameState.phase === 'active');
        checkSlapCondition();
        return;
    }

    if (result.redealt) {
        clearCentreDisplay();
        refreshMatchDisplay();
        if (result.matchWinner) endRound(null, result.matchWinner);
        else showRoundMessage('NO REVEAL AVAILABLE', 'The next round starts with the cards each player holds.');
        return;
    }

    if (result.recycled) clearCentreDisplay();
    if (result.cards.ai) renderCenterPile('left', result.cards.ai, true);
    if (result.cards.player) renderCenterPile('right', result.cards.player, true);
    setGameActive(true);
    refreshMatchDisplay();
    checkSlapCondition();
}

function clearCentreDisplay() {
    soloEl('center-pile-left').replaceChildren();
    soloEl('center-pile-right').replaceChildren();
}

function renderCenterPile(side, card, revealed = false) {
    const container = soloEl('center-pile-' + side);
    const previous = container.lastElementChild;
    if (previous) GameVisuals.stopFlip(previous);
    const img = document.createElement('img');
    img.className = 'game-card';
    img.src = card.imgSrc;
    img.alt = card.rank + ' of ' + card.suit;
    img.draggable = false;
    img.style.left = '50%';
    img.style.top = '50%';
    const tilt = Math.random() * 20 - 10;
    img.style.transform = 'translate(-50%, -50%) rotate(' + tilt + 'deg)';
    container.replaceChildren(img);
    if (revealed) GameVisuals.flip(img, CARD_BACK_SRC);
}

function refreshMatchDisplay() {
    soloEl('score-player').textContent = gameState.playerTotal;
    soloEl('score-ai').textContent = gameState.aiTotal;
    soloEl('borrowed-player').classList.toggle('hidden', !gameState.borrowedPlayer);
    soloEl('borrowed-ai').classList.toggle('hidden', !gameState.borrowedAi);
    soloEl('player-draw-deck').classList.toggle('draw-empty', !gameState.playerDeck.length);
    soloEl('ai-draw-deck').classList.toggle('draw-empty', !gameState.aiDeck.length);
    soloEl('sb-p1-name').textContent = window.ISFSession?.isGuest() ? 'You (Guest)' : 'You';
    soloEl('sb-p2-name').textContent = 'AI';
    soloEl('sb-p1-rounds').textContent = gameState.p1Rounds;
    soloEl('sb-p2-rounds').textContent = gameState.aiRounds;
    soloEl('sb-p1-slaps').textContent = gameState.p1Slaps;
    soloEl('sb-p2-slaps').textContent = gameState.aiSlaps;
    updatePenalties();
    document.dispatchEvent(new Event('slap-piles-changed'));
}

function updatePenalties() {
    for (const seat of ['player', 'ai']) {
        const container = soloEl(seat + '-penalties');
        container.replaceChildren();
        for (const [colour, count] of [['red', gameState[seat + 'Reds']], ['yellow', gameState[seat + 'Yellows']]]) {
            if (!count) continue;
            const badge = document.createElement('div');
            badge.className = 'card-icon icon-' + colour;
            if (count > 1) badge.textContent = String(count);
            container.append(badge);
        }
    }
}

function endRound(winner, matchWinner) {
    setGameActive(false);
    setReadiness();
    refreshMatchDisplay();
    if (matchWinner) {
        const isWin = matchWinner === 'player';
        showEndGame(isWin ? 'YOU WIN THE MATCH!' : 'AI WINS THE MATCH!', isWin);
        return;
    }
    const isWin = winner === 'player';
    showRoundMessage(isWin ? 'ROUND WON!' : 'ROUND LOST!',
        isWin ? 'You start next round with ' + gameState.playerTotal + ' cards.'
            : 'AI starts next round with ' + gameState.aiTotal + ' cards.');
}

function concedeSoloMatch() {
    const result = SlapsEngine.concedeMatch(gameState, 'player');
    if (!result.ok) return false;
    clearInterval(countdownTimer);
    clearTimeout(slapDisplayTimer);
    countdownTimer = slapDisplayTimer = null;
    gameState.drawLock = false;
    soloEl('countdown-overlay').classList.add('hidden');
    soloEl('slap-overlay').classList.add('hidden');
    endRound(null, result.winner);
    return true;
}

function showRoundMessage(title, subtitle) {
    soloEl('msg-title').textContent = title;
    soloEl('msg-subtitle').textContent = subtitle;
    const button = soloEl('msg-btn');
    button.classList.remove('hidden');
    button.textContent = 'CONTINUE';
    button.onclick = startRound;
    soloEl('game-message').classList.remove('hidden');
}

function showEndGame(title, isWin) {
    const heading = soloEl('msg-title');
    heading.textContent = title;
    heading.style.color = isWin ? '#66ff66' : '#ff7575';

    const rematch = document.createElement('button');
    rematch.className = 'btn-action-small';
    rematch.textContent = 'REMATCH';
    rematch.onclick = () => location.reload();

    const menu = document.createElement('button');
    menu.className = 'btn-action-small';
    menu.textContent = 'MAIN MENU';
    menu.onclick = () => { location.href = 'index.html'; };

    soloEl('msg-subtitle').replaceChildren(rematch, menu);
    soloEl('msg-btn').classList.add('hidden');
    soloEl('game-message').classList.remove('hidden');
}
