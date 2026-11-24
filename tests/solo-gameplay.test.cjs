const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class TestElement {
    constructor(tag) {
        this.tagName = tag;
        this.style = {};
        this.dataset = {};
        this.children = [];
        this.attributes = new Map();
        const classes = new Set();
        this.classList = {
            add: name => classes.add(name),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }
        };
    }

    get lastElementChild() { return this.children.at(-1); }
    get isConnected() { return !!this.parentElement; }
    append(...children) {
        for (const child of children) {
            this.children.push(child);
            child.parentElement = this;
        }
    }

    replaceChildren(...children) {
        for (const child of this.children) child.parentElement = null;
        this.children = [];
        this.append(...children);
    }

    remove() {
        if (!this.parentElement) return;
        const siblings = this.parentElement.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentElement = null;
    }

    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return name === 'src' ? this.src : this.attributes.get(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    getBoundingClientRect() { return { left: 10, top: 20, width: 80, height: 116 }; }
}

function soloFixture({ tournament = false, random = () => 0.5 } = {}) {
    const elements = new Map();
    const getElement = id => {
        if (!elements.has(id)) elements.set(id, new TestElement('div'));
        return elements.get(id);
    };
    const messages = [];
    const flips = [];
    const storage = new Map([['slapsDifficulty', '10']]);
    const load = [];
    let now = 0;
    let timerId = 0;
    const timers = new Map();
    const schedule = (callback, delay, repeat = false) => {
        const id = ++timerId;
        timers.set(id, { at: now + delay, delay, callback, repeat });
        return id;
    };
    const advance = duration => {
        const deadline = now + duration;
        while (timers.size) {
            const [id, timer] = [...timers].reduce((first, next) => next[1].at < first[1].at ? next : first);
            if (timer.at > deadline) break;
            now = timer.at;
            if (timer.repeat) timer.at += timer.delay;
            else timers.delete(id);
            timer.callback();
        }
        now = deadline;
    };

    const ctx = {
        Math: Object.assign(Object.create(Math), { random }),
        document: {
            getElementById: getElement,
            createElement: tag => new TestElement(tag),
            addEventListener() {},
            dispatchEvent() {}
        },
        Event,
        SlapsDrag: { attach: (element, handlers) => { element.drag = handlers; } },
        SlapsFeedback: { show: text => messages.push(text), flipReason: reason => reason },
        GameVisuals: { stopFlip() {}, flip: (element, from) => flips.push({ element, from }) },
        performance: { now: () => now },
        setTimeout: schedule,
        clearTimeout: id => timers.delete(id),
        setInterval: (callback, delay) => schedule(callback, delay, true),
        clearInterval: id => timers.delete(id),
        requestAnimationFrame: callback => schedule(callback, 16),
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, String(value)) },
        location: { href: '', reload() {} },
        addEventListener: (name, callback) => { if (name === 'load') load.push(callback); }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    const scripts = ['slaps-engine.js', 'game.js', ...(tournament ? ['tournament-game.js'] : []), 'ai-personality.js'];
    for (const file of scripts) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
    }
    const state = vm.runInContext('gameState', ctx);
    return { ctx, state, getElement, messages, flips, storage, advance, load: () => load.forEach(listener => listener()) };
}

function populate(fixture, { player, ai, left, right, playerDraw = [], playerHolding = [], aiDraw = [] }) {
    const { ctx, state } = fixture;
    ctx.SlapsEngine.initializeMatch(state);
    state.difficulty = 10;
    const cards = [...state.playerRoundCards.splice(0), ...state.aiRoundCards.splice(0)];
    const take = (name, owner, faceUp = false, lane = 0) => {
        const [rank, suit] = name.split(' ');
        const index = cards.findIndex(card => card.rank === rank && card.suit === suit);
        assert.notEqual(index, -1, name);
        const [card] = cards.splice(index, 1);
        Object.assign(card, { owner, isFaceUp: faceUp, laneIndex: lane });
        return card;
    };
    for (const [seat, lanes] of [['player', player], ['ai', ai]]) {
        for (const [lane, stack] of lanes.entries()) {
            for (const entry of stack) {
                const [name, status] = entry.split('/');
                state[seat + 'Hand'].push(take(name, seat, status !== 'down', lane));
            }
        }
        ctx.renderFoundation(seat, state[seat + 'Hand']);
    }
    state.centerPileLeft.push(take(left, null, true));
    state.centerPileRight.push(take(right, null, true));
    ctx.renderCenterPile('left', state.centerPileLeft.at(-1));
    ctx.renderCenterPile('right', state.centerPileRight.at(-1));
    state.playerHolding.push(...playerHolding.map(name => take(name, 'player')));
    state.playerDeck.push(...playerDraw.map(([name, owner]) => take(name, owner || 'player')));
    const explicitAiDraw = aiDraw.map(name => take(name, 'ai'));
    state.aiDeck.push(...cards.map(card => Object.assign(card, { owner: 'ai' })), ...explicitAiDraw);

    state.phase = 'active';
    state.roundStarted = true;
    ctx.setGameActive(true);
    ctx.checkSlapCondition();
    assertCardConservation(fixture);
}

function assertCardConservation({ ctx, state }) {
    const result = ctx.SlapsEngine.validateCardSet(ctx.SlapsEngine.cardZones(state));
    assert.equal(result.ok, true, JSON.stringify(result));
}

test('practice and local tournament both load the solo controller and deal four exposed lanes', () => {
    for (const tournament of [false, true]) {
        const fixture = soloFixture({ tournament });
        fixture.load();
        assert.equal(fixture.state.phase, 'awaiting_reveal');
        for (const seat of ['player', 'ai']) {
            const hand = fixture.state[seat + 'Hand'];
            assert.equal(hand.length, 10);
            assert.deepEqual([0, 1, 2, 3].map(lane => hand.filter(card => card.laneIndex === lane).length), [4, 3, 2, 1]);
            assert.equal(hand.filter(card => card.isFaceUp).length, 4);
            assert.equal(fixture.state[seat + 'Deck'].length, 16);
        }
        assertCardConservation(fixture);
    }
});

test('covered strips are inert and an exposed replacement is revealable while the other lanes are untouched', () => {
    const fixture = soloFixture();
    populate(fixture, {
        player: [
            ['2 spades/down', '3 clubs/down', '4 diamonds'], ['10 spades'], ['jack hearts'], ['king hearts']
        ],
        ai: [['ace clubs']],
        left: '5 hearts',
        right: '9 hearts'
    });

    const { state, ctx, flips } = fixture;
    const [bottom, replacement, top, ...untouched] = state.playerHand;
    assert.equal(bottom.element.dataset.covered, 'true');
    assert.equal(replacement.element.dataset.covered, 'true');
    assert.equal(replacement.element.tabIndex, -1);
    assert.equal(replacement.element.getAttribute('aria-hidden'), 'true');
    assert.equal(ctx.tryFlipCard(bottom.element, bottom), false);

    assert.equal(top.element.drag.canLift(), true);
    assert.equal(top.element.drag.play('right'), false);
    assert.equal(top.element.drag.play('left'), true);
    assert.equal(top.element.drag.play('left'), false);
    assert.equal(replacement.isFaceUp, false);
    assert.equal(untouched.every(card => card.isFaceUp), true);
    assert.equal(replacement.element.dataset.covered, 'false');
    assert.equal(replacement.element.tabIndex, 0);
    assert.equal(bottom.element.dataset.covered, 'true');

    fixture.advance(500);
    assert.equal(replacement.element.onclick(), true);
    assert.equal(replacement.isFaceUp, true);
    assert.equal(replacement.element.src, replacement.imgSrc);
    assert.equal(flips.at(-1).from, 'assets/cards/back_of_card.png');
    assert.equal(state.playerHand.filter(card => card.isFaceUp).length, 4);
    assert.equal(replacement.element.drag.play('left'), true);
    assert.equal(bottom.element.onclick(), true);
    assert.equal(bottom.element.drag.play('left'), true);
    assertCardConservation(fixture);
});

test('draw waits for exposed cards first then commits both visible reveals in the same countdown event', () => {
    const fixture = soloFixture();
    populate(fixture, {
        player: [['2 spades/down']],
        ai: [['king clubs']],
        left: '8 hearts',
        right: '10 hearts',
        playerDraw: [['ace hearts']],
        aiDraw: ['king hearts']
    });

    const { state, ctx, advance, messages, flips } = fixture;
    ctx.handlePlayerDeckClick();
    assert.match(messages.at(-1), /Reveal your exposed Foundation cards/);
    assert.equal(state.playerReady, false);

    assert.equal(state.playerHand[0].element.onclick(), true);
    ctx.handlePlayerDeckClick();
    ctx.handlePlayerDeckClick();
    advance(3199);
    assert.equal(state.centerPileLeft.length, 1);
    assert.equal(state.centerPileRight.length, 1);
    assert.equal(state.gameActive, false);
    advance(1);
    assert.equal(state.centerPileLeft.at(-1).rank, 'king');
    assert.equal(state.centerPileRight.at(-1).rank, 'ace');
    assert.equal(state.gameActive, true);
    assert.equal(flips.length, 3);
    assertCardConservation(fixture);
});

test('an opening used by a human closes the AI stale slap and keeps actual penalty cards out of play', () => {
    const fixture = soloFixture();
    populate(fixture, {
        player: [['4 diamonds'], ['king spades']],
        ai: [['ace clubs']],
        left: '5 hearts',
        right: '4 hearts',
        playerDraw: [['9 diamonds']]
    });

    const { state, ctx, advance } = fixture;
    const top = state.playerHand[0];
    assert.equal(top.element.drag.play('left'), true);
    assert.equal(state.slapActive, true);
    ctx.handleInput({ code: 'Space', target: { closest: () => true }, preventDefault: assert.fail });
    assert.equal(state.p1Slaps, 0);
    ctx.handleInput({ code: 'Space', preventDefault() {} });
    assert.equal(state.p1Slaps, 1);
    assert.equal(state.aiHolding.length, 3);
    assert.equal(state.centerPileLeft.length + state.centerPileRight.length, 0);
    advance(2000);
    assert.equal(state.aiSlaps, 0);
    ctx.handlePlayerDeckClick();
    advance(3200);
    assert.equal(state.aiHolding.length, 3);
    assert.equal(state.phase, 'active');
    assertCardConservation(fixture);
});

test('final Foundation play outranks a matching slap and borrowed cards do not block tournament advancement', () => {
    const fixture = soloFixture({ tournament: true });
    populate(fixture, {
        player: [['4 diamonds']],
        ai: [['ace clubs']],
        left: '5 hearts',
        right: '4 hearts',
        playerDraw: [['9 diamonds', 'ai'], ['10 diamonds', 'ai']]
    });

    const { state, ctx, advance, storage, getElement } = fixture;
    const loanIds = state.playerDeck.map(card => card.id);
    assert.equal(state.playerHand[0].element.drag.play('left'), true);
    assert.equal(state.phase, 'match_over');
    assert.equal(state.matchWinner, 'player');
    assert.equal(state.p1Rounds, 1);
    assert.equal(state.slapActive, false);
    ctx.handleInput({ code: 'Space', preventDefault() {} });
    advance(6000);
    assert.equal(state.p1Slaps + state.aiSlaps, 0);
    assert.ok(loanIds.every(id => state.aiRoundCards.some(card => card.id === id)));
    assert.equal(storage.get('isf_tourney_round'), '1');
    assert.equal(getElement('msg-btn').textContent, 'NEXT MATCH');
    assertCardConservation(fixture);
});

test('a borrower with an outstanding slap penalty wins the round and keeps the same card next round', () => {
    const fixture = soloFixture();
    populate(fixture, {
        player: [['4 diamonds']],
        ai: [['ace clubs']],
        left: '5 hearts',
        right: '4 hearts',
        playerDraw: [['9 diamonds', 'ai']],
        playerHolding: ['jack clubs']
    });

    const { state, getElement } = fixture;
    const penaltyCard = state.playerHolding[0];
    const loan = state.playerDeck[0];
    assert.equal(state.playerHand[0].element.drag.play('left'), true);
    assert.equal(state.phase, 'round_over');
    assert.equal(state.p1Rounds, 1);
    assert.equal(state.matchWinner, null);
    assert.equal(state.playerRoundCards[0], penaltyCard);
    assert.ok(state.aiRoundCards.includes(loan));
    assert.equal(getElement('msg-btn').onclick(), true);
    assert.equal(state.playerHand[0], penaltyCard);
    assert.equal(state.phase, 'awaiting_reveal');
    assertCardConservation(fixture);
});

test('bot considers a legal play without reading a concealed rank and does not complete an old move in a new activity', () => {
    const fixture = soloFixture();
    populate(fixture, {
        player: [['7 spades/down']],
        ai: [['8 diamonds'], ['king clubs']],
        left: '9 hearts',
        right: '6 hearts'
    });
    const { state, ctx, advance } = fixture;
    let hiddenReads = 0;
    Object.defineProperty(state.playerHand[0], 'value', {
        get() { hiddenReads++; throw new Error('Bot read a concealed card'); }
    });
    const target = state.aiHand[0];
    ctx.attemptAIMove();
    assert.equal(state.aiProcessing, true);
    advance(1250);
    assert.equal(target.element.style.position, 'fixed');
    assert.equal(target.element.style.width, '80px');
    assert.equal(target.element.style.height, '116px');

    ctx.setGameActive(false);
    ctx.setGameActive(true);
    advance(2000);
    assert.equal(state.aiHand[0], target);
    assert.equal(target.element.style.position, 'absolute');
    assert.equal(target.element.style.width, '');
    assert.equal(target.element.style.height, '');
    assert.equal(hiddenReads, 0);

    ctx.attemptAIMove();
    advance(2000);
    assert.equal(state.centerPileLeft.at(-1), target);
    assert.equal(hiddenReads, 0);
    assertCardConservation(fixture);
});

test('bot turns up an exposed top and never uncovers a card by relocating a blocker', () => {
    const fixture = soloFixture();
    populate(fixture, {
        player: [['7 spades']],
        ai: [['6 diamonds/down', 'king clubs'], ['8 diamonds/down']],
        left: '9 hearts',
        right: '3 hearts'
    });
    const { state, ctx, advance } = fixture;
    const [covered, blocker, exposed] = state.aiHand;

    ctx.attemptAIMove();
    advance(1500);
    assert.equal(exposed.isFaceUp, true);
    assert.equal(covered.isFaceUp, false);
    assert.equal(blocker.laneIndex, 0);
    assert.equal(covered.element.dataset.covered, 'true');
    ctx.attemptAIMove();
    advance(2000);
    assert.equal(state.centerPileLeft.at(-1), exposed);
    assertCardConservation(fixture);
});

test('a concession records a round only after opening and cancels a pending reveal', () => {
    const before = soloFixture();
    before.load();
    before.ctx.handleInput({ code: 'Space', preventDefault: assert.fail });
    before.ctx.handlePlayerDeckClick();
    assert.equal(before.ctx.concedeSoloMatch(), true);
    before.advance(5000);
    assert.equal(before.state.aiRounds, 0);
    assert.equal(before.state.matchWinner, 'ai');
    assert.equal(before.state.centerPileLeft.length, 0);

    const after = soloFixture();
    after.load();
    after.ctx.handlePlayerDeckClick();
    after.advance(3200);
    assert.equal(after.ctx.concedeSoloMatch(), true);
    assert.equal(after.state.aiRounds, 1);
    assert.equal(after.state.matchWinner, 'ai');
    assertCardConservation(after);
});

test('24 seeded solo controller matches complete with the real bot and rendered-card callbacks', t => {
    const totals = { matches: 0, actions: 0, rounds: 0, slaps: 0 };
    for (let seed = 1; seed <= 24; seed++) {
        let generator = seed;
        const random = () => {
            generator = (Math.imul(1664525, generator) + 1013904223) >>> 0;
            return generator / 2 ** 32;
        };
        const fixture = soloFixture({ tournament: seed % 2 === 0, random });
        const { state, ctx, advance, getElement } = fixture;
        fixture.load();

        for (let action = 0; action < 2000 && state.phase !== 'match_over'; action++) {
            totals.actions++;
            if (state.phase === 'round_over') {
                assert.equal(getElement('msg-btn').onclick(), true, 'continue, seed ' + seed);
            } else if (state.phase === 'awaiting_reveal') {
                if (!state.resumeBlocked) ctx.handlePlayerDeckClick();
            } else if (state.gameActive) {
                const moves = ctx.SlapsEngine.availableMoves(state, 'player');
                const exposed = ctx.SlapsEngine.getExposedCards(state.playerHand)
                    .find(card => ctx.SlapsEngine.canFlipCard(state.playerHand, card).ok);
                if (state.slapActive) {
                    if (random() < 0.55) ctx.handleInput({ code: 'Space', preventDefault() {} });
                } else if (moves.length && random() < 0.75) {
                    const move = moves[Math.floor(random() * moves.length)];
                    assert.equal(move.card.element.drag.play(move.side), true, 'play, seed ' + seed);
                } else if (exposed) {
                    assert.equal(exposed.element.onclick(), true, 'flip, seed ' + seed);
                } else if (ctx.SlapsEngine.canRestart(state)) {
                    ctx.handlePlayerDeckClick();
                }
            }
            advance(700);
            assertCardConservation(fixture);
        }

        assert.equal(state.phase, 'match_over', 'completion, seed ' + seed);
        assert.ok(['player', 'ai'].includes(state.matchWinner), 'winner, seed ' + seed);
        totals.matches++;
        totals.rounds += state.p1Rounds + state.aiRounds;
        totals.slaps += state.p1Slaps + state.aiSlaps;
    }
    t.diagnostic(JSON.stringify(totals));
});
