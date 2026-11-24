const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../slaps-engine.js');

const SEATS = ['player', 'ai'];

function seeded(seed) {
    let value = seed >>> 0;
    return () => {
        value = (Math.imul(1664525, value) + 1013904223) >>> 0;
        return value / 0x100000000;
    };
}

function fixture(layout, filler = 'aiDeck') {
    const state = Engine.initializeMatch({}, seeded(17));
    const zones = Engine.cardZones(state);
    const remaining = Object.values(zones).flat();
    for (const zone of Object.values(zones)) zone.length = 0;
    for (const [zone, entries] of Object.entries(layout)) {
        for (const [rank, laneIndex = 0, isFaceUp = zone.endsWith('Hand'), owner = zone.startsWith('ai') ? 'ai' : 'player'] of entries) {
            const index = remaining.findIndex(card => card.rank === rank);
            assert.notEqual(index, -1, `fixture has no remaining ${rank}`);
            const [card] = remaining.splice(index, 1);
            Object.assign(card, { owner, laneIndex, isFaceUp });
            zones[zone].push(card);
        }
    }
    for (const card of remaining) card.owner = filler.startsWith('ai') ? 'ai' : 'player';
    zones[filler].unshift(...remaining);
    state.phase = 'active';
    state.roundStarted = true;
    state.slapActive = Engine.isSlapAvailable(state.centerPileLeft, state.centerPileRight);
    return state;
}

function assertCards(state, context = '', identities) {
    const zones = Engine.cardZones(state);
    const result = Engine.validateCardSet(zones);
    assert.equal(result.ok, true, `${context} ${JSON.stringify(result)}`);
    const cards = Object.values(zones).flat();
    assert.equal(new Set(cards.map(card => `${card.suit}:${card.rank}`)).size, 52, context);
    if (identities) assert.ok(cards.every(card => identities.get(card.id) === card), context);
    for (const seat of SEATS) {
        const hand = state[seat + 'Hand'];
        const exposed = Engine.getExposedCards(hand);
        assert.ok(Engine.countFaceUp(hand) <= 4, context);
        assert.ok(hand.every(card => card.owner === seat), context);
        assert.ok(hand.every(card => !card.isFaceUp || exposed.includes(card)), context);
        assert.ok(state[seat + 'Holding'].every(card => card.owner === seat && !card.isFaceUp), context);
        assert.ok(state[seat + 'RoundCards'].every(card => card.owner === seat && !card.isFaceUp), context);
        assert.equal(state[seat + 'SlapCards'], state[seat + 'Holding'].length, context);
        const ownedDecks = state.playerDeck.concat(state.aiDeck).filter(card => card.owner === seat);
        assert.equal(state[seat + 'Total'], hand.length + ownedDecks.length + state[seat + 'Holding'].length + state[seat + 'RoundCards'].length, context);
        for (const { card, side } of Engine.availableMoves(state, seat)) {
            assert.ok(card.isFaceUp && exposed.includes(card), context);
            assert.ok(Engine.canPlayOnPile(card, side === 'left' ? state.centerPileLeft : state.centerPileRight), context);
        }
    }
}

test('starts with 26 distinct owned cards per player, 4–3–2–1 Foundations, and two simultaneous reveal cards', () => {
    const random = seeded(1);
    const state = Engine.initializeMatch({}, random);
    const ids = new Set(Object.values(Engine.cardZones(state)).flat().map(card => card.id));
    assertCards(state);
    assert.equal(Engine.startRound(state, random).ok, true);
    assert.equal(Engine.startRound(state, random).reason, 'round_unavailable');
    for (const seat of SEATS) {
        const hand = state[seat + 'Hand'];
        assert.deepEqual([0, 1, 2, 3].map(lane => hand.filter(card => card.laneIndex === lane).length), [4, 3, 2, 1]);
        assert.equal(Engine.countFaceUp(hand), 4);
        assert.equal(state[seat + 'Deck'].length, 16);
    }
    const result = Engine.revealDraw(state, { random });
    assert.equal(result.ok, true);
    assert.equal(state.centerPileLeft[0], result.cards.ai);
    assert.equal(state.centerPileRight[0], result.cards.player);
    assert.equal(state.playerDeck.length, 15);
    assert.equal(state.aiDeck.length, 15);
    assert.deepEqual(new Set(Object.values(Engine.cardZones(state)).flat().map(card => card.id)), ids);
    assertCards(state);
});

test('plays from exposed sub-piles, rejects the wrong Centre, and preserves coverage in untouched lanes', () => {
    const state = fixture({
        playerHand: [['5', 0, false], ['4', 0], ['king', 1], ['6', 2], ['jack', 3]],
        aiHand: [['8']], centerPileLeft: [['5']], centerPileRight: [['ace']]
    });
    const [replacement, first, king, six, jack] = state.playerHand;
    assert.equal(Engine.playFoundation(state, 'player', replacement, 'left').reason, 'covered');
    assert.equal(Engine.flipFoundation(state, 'player', replacement).reason, 'covered');
    assert.equal(Engine.playFoundation(state, 'player', king, 'left').reason, 'not_playable');
    assert.equal(Engine.playFoundation(state, 'player', king, 'right').ok, true);
    assert.equal(Engine.playFoundation(state, 'player', six, 'left').ok, true);
    assert.equal(Engine.playFoundation(state, 'player', first, 'left').reason, 'not_playable');
    assert.equal(Engine.playFoundation(state, 'player', jack, 'right').reason, 'not_playable');
    assert.equal(Engine.playFoundation(state, 'ai', first, 'left').reason, 'not_in_hand');
    // Repositioning never changes the Foundation array, and an untouched lane never covers another lane.
    Object.assign(replacement, { layout: { x: 0.2, y: 0.9 } });
    assert.equal(Engine.getExposedCards(state.playerHand).includes(first), true);
    assert.equal(Engine.countFaceUp(state.playerHand), 2);
    assert.equal(Engine.flipFoundation(state, 'player', replacement).reason, 'covered');
    assertCards(state);
});

test('an exposed replacement can open with zero through three live cards, without touching unrelated lanes', () => {
    for (let prior = 0; prior <= 3; prior++) {
        const otherLanes = [['ace', 1], ['king', 2], ['9', 3]].slice(0, prior);
        const state = fixture({
            playerHand: [['6', 0, false], ['5', 0, false], ['4', 0], ...otherLanes],
            aiHand: [['10']], centerPileLeft: [['3']], centerPileRight: [['8']]
        });
        const [covered, replacement, top] = state.playerHand;
        assert.equal(Engine.playFoundation(state, 'player', top, 'left').ok, true);
        assert.equal(Engine.playFoundation(state, 'player', top, 'left').reason, 'not_in_hand');
        assert.equal(Engine.countFaceUp(state.playerHand), prior);
        assert.equal(Engine.playFoundation(state, 'player', replacement, 'left').reason, 'face_down');
        assert.equal(Engine.flipFoundation(state, 'player', covered).reason, 'covered');
        assert.equal(Engine.flipFoundation(state, 'player', replacement).ok, true);
        assert.equal(Engine.flipFoundation(state, 'player', replacement).reason, 'already_face_up');
        assert.equal(Engine.countFaceUp(state.playerHand), prior + 1);
        assert.equal(Engine.playFoundation(state, 'player', replacement, 'left').ok, true);
        assert.equal(Engine.flipFoundation(state, 'player', covered).ok, true);
        assert.equal(Engine.playFoundation(state, 'player', covered, 'left').ok, true);
        assertCards(state, `prior face-up count ${prior}`);
    }
});

test('same-pile near-simultaneous releases are revalidated against the latest card', () => {
    const state = fixture({
        playerHand: [['5', 0], ['8', 1]], aiHand: [['5', 0], ['king', 1]],
        centerPileLeft: [['6']], centerPileRight: [['3']]
    });
    const [human] = state.playerHand;
    const [remote] = state.aiHand;
    assert.equal(Engine.availableMoves(state, 'player').some(move => move.card === human && move.side === 'left'), true);
    assert.equal(Engine.availableMoves(state, 'ai').some(move => move.card === remote && move.side === 'left'), true);
    assert.equal(Engine.playFoundation(state, 'player', human, 'left').ok, true);
    assert.equal(Engine.playFoundation(state, 'ai', remote, 'left').reason, 'not_playable');
    assert.equal(state.aiHand.includes(remote), true);
    assert.equal(state.centerPileLeft.at(-1), human);
    assertCards(state);
});

test('two valid plays from different sub-piles can target either Centre', () => {
    const state = fixture({
        playerHand: [['5', 0], ['queen', 1], ['6', 2], ['jack', 3]],
        aiHand: [['8']], centerPileLeft: [['4']], centerPileRight: [['king']]
    });
    const [five, queen, six, jack] = state.playerHand;
    for (const [card, side] of [[queen, 'right'], [five, 'left'], [jack, 'right'], [six, 'left']]) {
        assert.equal(Engine.playFoundation(state, 'player', card, side).ok, true);
        assertCards(state);
    }
    assert.equal(state.p1Rounds, 1);
    assert.equal(state.matchWinner, 'player');
});

test('a matching play opens a slap, and the first accepted one takes both entire Centre Piles out of play', () => {
    const state = fixture({
        playerHand: [['7', 0], ['queen', 1]], aiHand: [['king']],
        centerPileLeft: [['5'], ['6']], centerPileRight: [['7']]
    });
    const [seven] = state.playerHand;
    assert.equal(Engine.takeSlap(state, 'ai').reason, 'no_match');
    assert.equal(Engine.playFoundation(state, 'player', seven, 'left').slapAvailable, true);
    assert.deepEqual(Engine.takeSlap(state, 'ai'), { ok: true, loser: 'player', cardCount: 4 });
    assert.equal(Engine.takeSlap(state, 'player').reason, 'inactive');
    assert.equal(state.aiSlaps, 1);
    const holding = state.playerHolding.slice();
    assert.equal(holding.length, 4);
    assert.equal(state.centerPileLeft.length + state.centerPileRight.length, 0);
    assert.equal(Engine.revealDraw(state).ok, true);
    assert.deepEqual(state.playerHolding, holding);
    assertCards(state);
});

test('final Foundation card overrides a matching slap and the round loser receives every Centre card', () => {
    const state = fixture({
        playerHand: [['7']], playerDeck: [['10']], aiHand: [['king']],
        centerPileLeft: [['5'], ['6']], centerPileRight: [['7']]
    });
    const dropped = state.playerHand[0];
    const expectedCentre = state.centerPileLeft.concat(state.centerPileRight, dropped);
    const originalDeck = state.playerDeck[0];
    const result = Engine.playFoundation(state, 'player', dropped, 'left');
    assert.equal(result.finishedRound, true);
    assert.equal(result.matchWinner, null);
    assert.equal(result.slapAvailable, false);
    assert.equal(Engine.takeSlap(state, 'ai').reason, 'inactive');
    assert.equal(state.p1Rounds, 1);
    assert.equal(state.p1Slaps + state.aiSlaps, 0);
    assert.deepEqual(state.playerRoundCards, [originalDeck]);
    assert.ok(expectedCentre.every(card => state.aiRoundCards.includes(card) && card.owner === 'ai'));
    assertCards(state);
    assert.equal(Engine.startRound(state).ok, true);
    assert.equal(state.playerHand[0], originalDeck);
    assertCards(state);
});

test('playing away from matching Centre ranks closes the earlier slap opportunity', () => {
    const state = fixture({
        playerHand: [['7', 0], ['9', 1]], aiHand: [['king']], centerPileLeft: [['6']], centerPileRight: [['6']]
    });
    assert.equal(Engine.playFoundation(state, 'player', state.playerHand[0], 'left').slapAvailable, false);
    assert.equal(Engine.takeSlap(state, 'ai').reason, 'no_match');
    assert.equal(state.p1Slaps + state.aiSlaps, 0);
    assertCards(state);
});

test('Draw Deck restart is blocked by legal plays and exposed flips, and succeeds on a true stalemate', () => {
    const state = fixture({
        playerHand: [['queen', 0, false], ['7', 1]], aiHand: [['jack']],
        playerDeck: [['2']], aiDeck: [['2']], centerPileLeft: [['6']], centerPileRight: [['4']]
    });
    const [replacement, seven] = state.playerHand;
    assert.equal(Engine.revealDraw(state).reason, 'moves_available');
    assert.equal(Engine.playFoundation(state, 'player', seven, 'left').ok, true);
    assert.equal(Engine.revealDraw(state).reason, 'moves_available');
    assert.equal(Engine.flipFoundation(state, 'player', replacement).ok, true);
    assert.equal(Engine.canRestart(state), true);
    const result = Engine.revealDraw(state);
    assert.equal(result.ok, true);
    assert.equal(result.slapAvailable, true);
    assert.equal(result.cards.player.rank, '2');
    assert.equal(result.cards.ai.rank, '2');
    assertCards(state);
});

test('draw shortage loans the top half, keeps the odd card with its owner, and returns unused loans on a match win', () => {
    const state = fixture({
        playerHand: [['7']], aiHand: [['jack']],
        aiDeck: [['4'], ['king'], ['2'], ['6'], ['10'], ['3'], ['5']],
        centerPileLeft: [['2']], centerPileRight: [['3']]
    }, 'aiHolding');
    const initial = state.aiDeck.slice();
    assert.equal(Engine.canRestart(state), true);
    assert.equal(Engine.revealDraw(state).cards.player, initial.at(-1));
    assert.deepEqual(state.playerDeck, initial.slice(4, 6));
    assert.deepEqual(state.aiDeck, initial.slice(0, 3));
    assert.equal(state.borrowedPlayer, true);
    assert.equal(state.playerTotal, 1);
    assertCards(state);
    const result = Engine.playFoundation(state, 'player', state.playerHand[0], 'left');
    assert.equal(result.matchWinner, 'player');
    assert.equal(state.playerRoundCards.length, 0);
    assert.ok(initial.every(card => state.aiRoundCards.includes(card)));
    assertCards(state);
});

test('a lone Draw Deck card reveals alone onto its owner’s side', () => {
    const state = fixture({
        playerHand: [['ace']], aiHand: [['king']], aiDeck: [['6']],
        centerPileLeft: [['2']], centerPileRight: [['3']]
    }, 'aiHolding');
    assert.equal(Engine.revealDraw(state).reason, 'moves_available');
    const result = Engine.revealDraw(state, { force: true });
    assert.equal(result.cards.player, null);
    assert.equal(result.cards.ai.rank, '6');
    assert.equal(state.centerPileLeft.at(-1), result.cards.ai);
    assertCards(state);
});

test('penalty cards survive the borrowed-deck round and enter the next Foundation only at setup', () => {
    const state = fixture({
        playerHand: [['7']], playerDeck: [['8', 0, false, 'ai']], playerHolding: [['2']],
        aiHand: [['king']], centerPileLeft: [['6']], centerPileRight: [['7']]
    });
    const penalty = state.playerHolding[0];
    const borrowed = state.playerDeck[0];
    const result = Engine.playFoundation(state, 'player', state.playerHand[0], 'left');
    assert.equal(result.finishedRound, true);
    assert.equal(result.matchWinner, null);
    assert.equal(state.p1Rounds, 1);
    assert.deepEqual(state.playerRoundCards, [penalty]);
    assert.ok(state.aiRoundCards.includes(borrowed));
    assert.equal(Engine.startRound(state).ok, true);
    assert.deepEqual(state.playerHand, [penalty]);
    assert.equal(state.playerHolding.length, 0);
    assertCards(state);
});

test('both empty Draw Decks recycle the preserved Centre cards into neutral decks and toss for the odd card', () => {
    for (const flip of [0.25, 0.75]) {
        const state = fixture({
            playerHand: [['ace']], aiHand: [['10']],
            centerPileLeft: [['2'], ['6'], ['7']], centerPileRight: [['4'], ['5']]
        }, 'aiHolding');
        const recycledCards = state.centerPileLeft.concat(state.centerPileRight);
        const result = Engine.revealDraw(state, { random: () => flip });
        assert.equal(result.recycled, true);
        assert.equal(state.playerDeck.length, flip < 0.5 ? 1 : 2);
        assert.equal(state.aiDeck.length, flip < 0.5 ? 2 : 1);
        const table = state.playerDeck.concat(state.aiDeck, state.centerPileLeft, state.centerPileRight);
        assert.equal(table.length, 5);
        assert.ok(table.every(card => card.owner === null && recycledCards.includes(card)));
        assert.equal(state.p1Rounds + state.aiRounds, 0);
        assertCards(state);
    }
});

test('slap at an exhausted table preserves its cards and score through an unscored redeal', () => {
    const state = fixture({
        playerHand: [['ace']], aiHand: [['10']], centerPileLeft: [['7']], centerPileRight: [['7']]
    }, 'aiHolding');
    const centres = state.centerPileLeft.concat(state.centerPileRight);
    assert.equal(Engine.takeSlap(state, 'player').ok, true);
    assert.ok(centres.every(card => state.aiHolding.includes(card)));
    const redeal = Engine.revealDraw(state);
    assert.equal(redeal.redealt, true);
    assert.equal(state.phase, 'round_over');
    assert.equal(state.p1Slaps, 1);
    assert.equal(state.p1Rounds + state.aiRounds, 0);
    assert.ok(centres.every(card => state.aiRoundCards.includes(card)));
    assertCards(state);
    assert.equal(Engine.startRound(state).ok, true);
    assertCards(state);
});

test('a sole unusable Centre card cannot trap both players in a permanent restart loop', () => {
    const state = fixture({
        playerHand: [['ace']], aiHand: [['10']], centerPileLeft: [['7']]
    }, 'aiHolding');
    const card = state.centerPileLeft[0];
    assert.equal(Engine.revealDraw(state).redealt, true);
    assert.equal(state.phase, 'round_over');
    assert.ok(state.playerRoundCards.includes(card));
    assertCards(state);
});

test('first misslap carries no sanction, a repeat earns Yellow, and Red transfers actual cards only at the round break', () => {
    const state = fixture({
        playerHand: [['7']], aiHand: [['king']], centerPileLeft: [['6']], centerPileRight: [['9']]
    });
    assert.equal(Engine.recordMisslap(state, 'player').severity, null);
    assert.equal(state.playerYellows, 0);
    assert.equal(Engine.recordMisslap(state, 'player').severity, 'yellow');
    assert.equal(Engine.recordMisslap(state, 'player').severity, 'red');
    assert.equal(state.playerHolding.length, 0);
    assert.equal(state.playerReds, 1);
    const result = Engine.playFoundation(state, 'player', state.playerHand[0], 'left', seeded(42));
    assert.equal(result.finishedRound, true);
    assert.equal(result.matchWinner, null);
    assert.equal(state.playerRoundCards.length, 3);
    assert.equal(state.aiRoundCards.length, 49);
    assert.equal(state.pendingReds.player, 0);
    assertCards(state);
});

test('a Red transferring the opponent’s last cards yields a match result instead of a zero-card round', () => {
    const state = fixture({
        playerHand: [['7']], aiHand: [['king']], centerPileLeft: [['6']]
    }, 'playerHolding');
    for (let miss = 0; miss < 3; miss++) Engine.recordMisslap(state, 'player');
    const result = Engine.playFoundation(state, 'player', state.playerHand[0], 'left', seeded(7));
    assert.equal(state.p1Rounds, 1);
    assert.equal(result.matchWinner, 'ai');
    assert.equal(state.aiRoundCards.length, 0);
    assert.equal(state.playerRoundCards.length, 52);
    assert.equal(Engine.startRound(state).reason, 'round_unavailable');
    assertCards(state);
});

test('concessions award the opponent a round only after an opening reveal', () => {
    for (const duringRound of [false, true]) {
        const random = seeded(35);
        const state = Engine.initializeMatch({}, random);
        Engine.startRound(state, random);
        if (duringRound) Engine.revealDraw(state, { random });
        assert.deepEqual(Engine.concedeMatch(state, 'player'), { ok: true, winner: 'ai' });
        assert.equal(state.aiRounds, duringRound ? 1 : 0);
        assert.equal(state.matchWinner, 'ai');
        assert.equal(Engine.concedeMatch(state, 'ai').reason, 'inactive');
        assertCards(state);
    }
});

test('1,000 seeded full matches conserve cards and always expose an action or restart', t => {
    const summary = { matches: 0, actions: 0, rounds: 0, slaps: 0, loans: 0, recycled: 0, redeals: 0 };
    for (let seed = 1; seed <= 1000; seed++) {
        const random = seeded(seed);
        const state = Engine.initializeMatch({}, random);
        const identities = new Map(Object.values(Engine.cardZones(state)).flat().map(card => [card.id, card]));
        let actions = 0;
        while (state.phase !== 'match_over' && actions < 10000) {
            const context = `seed ${seed}, action ${actions}, phase ${state.phase}`;
            let outcome;
            if (state.phase === 'round_over') {
                outcome = Engine.startRound(state, random);
            } else if (state.phase === 'awaiting_reveal') {
                outcome = Engine.revealDraw(state, { random });
            } else if (state.slapActive && random() < 0.9) {
                outcome = Engine.takeSlap(state, random() < 0.5 ? 'player' : 'ai');
                summary.slaps++;
            } else {
                const decisions = SEATS.flatMap(seat => {
                    const hand = state[seat + 'Hand'];
                    const plays = Engine.availableMoves(state, seat).map(move => ({ ...move, seat, play: true }));
                    const flips = Engine.getExposedCards(hand).filter(card => Engine.canFlipCard(hand, card).ok)
                        .map(card => ({ card, seat, play: false }));
                    return plays.concat(flips);
                });
                if (decisions.length) {
                    const choice = decisions[Math.floor(random() * decisions.length)];
                    outcome = choice.play ? Engine.playFoundation(state, choice.seat, choice.card, choice.side, random)
                        : Engine.flipFoundation(state, choice.seat, choice.card);
                } else {
                    assert.equal(Engine.canRestart(state), true, context);
                    outcome = Engine.revealDraw(state, { random });
                }
            }
            assert.equal(outcome.ok, true, `${context}: ${outcome.reason}`);
            if (outcome.recycled) summary.recycled++;
            if (outcome.redealt) summary.redeals++;
            if (outcome.cards && (state.borrowedPlayer || state.borrowedAi)) summary.loans++;
            if (outcome.finishedRound) summary.rounds++;
            actions++;
            assertCards(state, context, identities);
        }
        assert.equal(state.phase, 'match_over', `seed ${seed} exceeds ${actions} actions`);
        assert.ok(SEATS.includes(state.matchWinner), `seed ${seed} has no match winner`);
        assert.equal(state[state.matchWinner + 'Total'], 0, `seed ${seed} won with owned cards`);
        summary.matches++;
        summary.actions += actions;
    }
    assert.equal(summary.matches, 1000);
    t.diagnostic(JSON.stringify(summary));
    assert.ok(summary.rounds > 1000 && summary.slaps > 1000 && summary.loans > 1000 && summary.recycled > 0);
});
