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
    drawLock: false,
    aiProcessing: false, aiInChain: false,
    activitySerial: 0,
    roundSerial: 0,
    slapActive: false
};

const CARD_BACK_SRC = 'assets/cards/back_of_card.png';
const soloEl = id => document.getElementById(id);
let slapDisplayTimer = null;

window.addEventListener('load', () => {
    gameState.difficulty = Number(localStorage.getItem('slapsDifficulty')) || 1;
    document.addEventListener('keydown', handleInput);
    soloEl('player-draw-deck').onclick = handlePlayerDeckClick;
    SlapsEngine.initializeMatch(gameState);
    startRound();
    setInterval(() => {
        if (gameState.gameActive && !gameState.aiProcessing) attemptAIMove();
    }, 100);
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

function startRound() {
    const result = SlapsEngine.startRound(gameState, undefined, {
        player: SlapsDrag.measure(soloEl('player-foundation-area')),
        ai: SlapsDrag.measure(soloEl('ai-foundation-area'))
    });
    if (!result.ok) return false;
    setGameActive(false);
    gameState.drawLock = false;
    gameState.roundSerial++;

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
    for (const card of hand) {
        const img = document.createElement('img');
        img.className = 'game-card';
        img.draggable = false;
        img.dataset.cardId = card.id;
        card.element = img;
        if (card.isFaceUp) setCardFaceUp(img, card, seat);
        else setCardFaceDown(img);
        container.append(img);
        if (seat === 'player') makeDraggable(img, card);
    }
    syncFoundationLayout(hand, seat);
}

function syncFoundationLayout(hand, seat, animateCard) {
    for (const card of hand) {
        const img = card.element;
        const { accessible, exposed } = SlapsEngine.getFoundationExposure(hand, card);
        img.dataset.covered = String(!exposed);
        img.dataset.accessible = String(accessible);
        if (!accessible) img.setAttribute('aria-hidden', 'true');
        else img.removeAttribute('aria-hidden');
        img.tabIndex = seat === 'player' && accessible ? 0 : -1;
    }
    SlapsDrag.render(soloEl(seat + '-foundation-area'), hand,
        card => SlapsEngine.getFoundationPosition(hand, card), {
            bounds: SlapsEngine.getFoundationBounds(gameState, seat),
            mirrored: seat === 'ai',
            animateCard
        });
}

function setCardFaceUp(img, card, seat) {
    const previousFace = img.getAttribute('src');
    img.src = card.imgSrc;
    img.setAttribute('aria-label', card.rank + ' of ' + card.suit);
    img.classList.remove('card-face-down');
    img.classList.add(seat === 'player' ? 'player-card' : 'opponent-card');
    if (previousFace === CARD_BACK_SRC) GameVisuals.flip(img, previousFace);
}

function setCardFaceDown(img) {
    img.src = CARD_BACK_SRC;
    img.classList.add('card-face-down');
    img.setAttribute('aria-label', 'Face-down Foundation card. Press Enter to reveal it when exposed.');
}

function tryFlipCard(img, card, seat = 'player') {
    if (!gameState.gameActive) return false;
    const decision = SlapsEngine.flipFoundation(gameState, seat, card);
    if (!decision.ok) {
        if (seat === 'player') SlapsFeedback.show(SlapsFeedback.flipReason(decision.reason));
        return false;
    }
    setCardFaceUp(img, card, seat);
    syncFoundationLayout(gameState[seat + 'Hand'], seat);
    return true;
}

function moveFoundationCard(seat, card, position) {
    const result = SlapsEngine.moveFoundation(gameState, seat, card, position);
    if (!result.ok) return false;
    GameVisuals.stopFlip(card.element);
    syncFoundationLayout(gameState[seat + 'Hand'], seat, seat === 'ai' ? card : undefined);
    return true;
}

function makeDraggable(img, card) {
    SlapsDrag.attach(img, {
        canMove: () => (gameState.gameActive || gameState.phase === 'awaiting_reveal') &&
            SlapsEngine.isFoundationAccessible(gameState.playerHand, card),
        canLeave: () => gameState.gameActive && SlapsEngine.canTakeOutside(gameState, 'player', card),
        move: position => moveFoundationCard('player', card, position),
        reveal: () => !card.isFaceUp && tryFlipCard(img, card),
        play: side => playCardToCenter(card, img, side)
    });
}

function playCardToCenter(card, img, side) {
    if (!gameState.gameActive) return false;
    const seat = card.owner;
    const decision = SlapsEngine.playFoundation(gameState, seat, card, side);
    if (!decision.ok) return false;

    GameVisuals.stopFlip(img);
    img.remove();
    renderCenterPile(side, card);
    if (decision.finishedRound) {
        endRound(seat, decision.matchWinner);
    } else {
        syncFoundationLayout(gameState[seat + 'Hand'], seat);
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
    SlapsDrag.cancel();
    clearCentreDisplay();
    refreshMatchDisplay();

    const playerWon = winner === 'player';
    const overlay = soloEl('slap-overlay');
    soloEl('slap-text').textContent = playerWon ? 'PLAYER SLAP WON!' : 'AI SLAP WON!';
    overlay.style.backgroundColor = playerWon ? 'rgba(0, 200, 0, 0.9)' : 'rgba(200, 0, 0, 0.9)';
    overlay.classList.remove('hidden');
    clearTimeout(slapDisplayTimer);
    slapDisplayTimer = setTimeout(hideSlapDisplay, 700);
    return true;
}

function hideSlapDisplay() {
    clearTimeout(slapDisplayTimer);
    slapDisplayTimer = null;
    soloEl('slap-overlay').classList.add('hidden');
}

function handlePlayerDeckClick() {
    return requestSoloReveal();
}

function requestSoloReveal(expectedReveal = gameState.revealRevision) {
    if (gameState.drawLock) return false;
    const result = SlapsEngine.revealDraw(gameState, { force: true, expectedReveal });
    if (!result.ok) return false;

    setGameActive(false);
    hideSlapDisplay();
    const revealedRevision = gameState.revealRevision;
    gameState.drawLock = revealedRevision;
    // The board changes immediately. Concurrent requests share the same displayed reveal.
    requestAnimationFrame(() => {
        if (gameState.drawLock === revealedRevision) gameState.drawLock = false;
    });
    if (result.redealt) {
        SlapsDrag.cancel();
        clearCentreDisplay();
        refreshMatchDisplay();
        if (result.matchWinner) endRound(null, result.matchWinner);
        else showRoundMessage('NO REVEAL AVAILABLE', 'The next round starts with the cards each player holds.');
        return true;
    }

    if (result.recycled) clearCentreDisplay();
    if (result.cards.ai) renderCenterPile('left', result.cards.ai, true);
    if (result.cards.player) renderCenterPile('right', result.cards.player, true);
    setGameActive(true);
    SlapsDrag.recheck();
    refreshMatchDisplay();
    checkSlapCondition();
    return true;
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
    SlapsDrag.cancel();
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
    gameState.drawLock = false;
    hideSlapDisplay();
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
