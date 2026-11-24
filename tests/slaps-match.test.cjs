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
        const depths = new Map();
        for (const [rank, column = 0, isFaceUp = zone.endsWith('Hand'), owner = zone.startsWith('ai') ? 'ai' : 'player'] of entries) {
            const index = remaining.findIndex(card => card.rank === rank);
            assert.notEqual(index, -1, `fixture has no remaining ${rank}`);
            const [card] = remaining.splice(index, 1);
            Object.assign(card, { owner, isFaceUp });
            if (zone.endsWith('Hand')) {
                const depth = depths.get(column) || 0;
                depths.set(column, depth + 1);
                card.foundation = { x: 0.2 + column * 1.25, y: 0.4 + depth * 0.075, z: zones[zone].length + 1 };
            }
            zones[zone].push(card);
        }
    }
    for (const card of remaining) card.owner = filler.startsWith('ai') ? 'ai' : 'player';
    zones[filler].unshift(...remaining);
    state.phase = 'active';
    state.roundStarted = true;
    state.slapActive = Engine.isSlapAvailable(state.centerPileLeft, state.centerPileRight);
    for (const seat of SEATS) {
        const holding = state[seat + 'Holding'].length;
        const draws = state.playerDeck.concat(state.aiDeck).filter(card => card.owner === seat).length;
        state[seat + 'SlapCards'] = holding;
        state[seat + 'Total'] = state[seat + 'Hand'].length + draws + holding;
    }
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
        const bounds = Engine.getFoundationBounds(state, seat);
        assert.ok(hand.every(card => Engine.isValidFoundationPosition(card.foundation, bounds)), context);
        assert.equal(new Set(hand.map(card => card.foundation.z)).size, hand.length, context);
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
        const columns = [...new Set(hand.map(card => card.foundation.x))];
        assert.deepEqual(columns.map(x => hand.filter(card => card.foundation.x === x).length), [4, 3, 2, 1]);
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

test('a natural restart waits for legal plays and exposed flips, then succeeds on a true stalemate', () => {
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

test('clearing an original pile frees capacity to move an unplayable cover and restore four face-up cards', () => {
    const state = fixture({
        playerHand: [['5', 0, false], ['9', 0], ['jack', 1], ['queen', 2], ['7', 3]],
        aiHand: [['10']], centerPileLeft: [['6']], centerPileRight: [['2']]
    });
    const [lower, blocker, jack, queen, seven] = state.playerHand;
    const vacant = seven.foundation;
    const untouched = [jack.foundation, queen.foundation];
    assert.equal(Engine.playFoundation(state, 'player', seven, 'left').ok, true);
    assert.equal(Engine.countFaceUp(state.playerHand), 3);
    assert.equal(Engine.canTakeOutside(state, 'player', blocker), false);
    assert.equal(Engine.flipFoundation(state, 'player', lower).reason, 'covered');
    const position = Engine.moveFoundation(state, 'player', blocker, { x: vacant.x, y: vacant.y, z: 50000 });
    assert.equal(position.ok, true);
    assert.notEqual(position.position.z, 50000);
    assert.deepEqual([position.position.x, position.position.y], [vacant.x, vacant.y]);
    assert.deepEqual([jack.foundation, queen.foundation], untouched);
    assert.equal(Engine.flipFoundation(state, 'player', lower).ok, true);
    assert.equal(Engine.countFaceUp(state.playerHand), 4);
    assert.equal(blocker.owner, 'player');
    assertCards(state);
});

test('geometry distinguishes a movable strip from full exposure and combined occlusion', () => {
    const state = fixture({ playerHand: [['7', 0, false], ['9', 1], ['10', 2]], aiHand: [['ace']] });
    const [lower, left, right] = state.playerHand;
    lower.foundation = { x: 1, y: 0.4, z: 1 };
    left.foundation = { x: 0.5, y: 0.4, z: 2 };
    right.foundation = { x: 1.5, y: 0.4, z: 3 };
    assert.deepEqual(Engine.getFoundationExposure(state.playerHand, lower), { accessible: false, exposed: false });
    assert.equal(Engine.moveFoundation(state, 'player', lower, { x: 2.5, y: 0 }).reason, 'covered');
    assert.equal(Engine.moveFoundation(state, 'ai', right, { x: 3.7, y: 0.4 }).reason, 'not_in_hand');
    assert.equal(Engine.moveFoundation(state, 'player', right, { x: 3.7, y: 0.4 }).ok, true);
    assert.deepEqual(Engine.getFoundationExposure(state.playerHand, lower), { accessible: true, exposed: false });
    assert.equal(Engine.flipFoundation(state, 'player', lower).reason, 'covered');
    assert.equal(Engine.canTakeOutside(state, 'player', lower), false);
    const previous = lower.foundation;
    for (const invalid of [{ x: -0.001, y: 0 }, { x: 2, y: 1.16 }, { x: NaN, y: 0 }, { x: '2', y: 0 }]) {
        assert.equal(Engine.moveFoundation(state, 'player', lower, invalid).reason, 'outside_foundation');
        assert.equal(lower.foundation, previous);
    }
    assert.equal(Engine.moveFoundation(state, 'player', lower, { x: 5.2, y: 0.1 }).ok, true);
    assert.equal(lower.isFaceUp, false);
    assert.deepEqual(Engine.getFoundationExposure(state.playerHand, lower), { accessible: true, exposed: true });
    assert.deepEqual(JSON.parse(JSON.stringify(lower.foundation)), lower.foundation);
});

test('per-seat Foundation boards permit placements that fit the seat and preserve their bounds', () => {
    const random = seeded(42);
    const state = Engine.initializeMatch({}, random);
    const player = { width: 10, height: 1.55 };
    assert.equal(Engine.startRound(state, random, { player: { width: 3, height: 1 } }).reason, 'invalid_foundation_bounds');
    assert.equal(Engine.startRound(state, random, { player }).ok, true);
    const [playerTop] = Engine.getExposedCards(state.playerHand);
    const [opponentTop] = Engine.getExposedCards(state.aiHand);
    const farSide = { x: 8.9, y: 0.5 };
    assert.equal(Engine.moveFoundation(state, 'player', playerTop, farSide).ok, true);
    assert.equal(Engine.moveFoundation(state, 'ai', opponentTop, farSide).reason, 'outside_foundation');
    assert.deepEqual(Engine.getFoundationBounds(state, 'player'), player);
    assertCards(state);
});

test('positioning a face-up card under a new cover does not create capacity for a fifth', () => {
    const state = fixture({ playerHand: [['3'], ['4', 1], ['5', 2], ['6', 3], ['7', 4, false]] });
    const [under, cover, , , fifth] = state.playerHand;
    assert.equal(Engine.moveFoundation(state, 'player', cover, under.foundation).ok, true);
    assert.deepEqual(Engine.getFoundationExposure(state.playerHand, under), { accessible: false, exposed: false });
    assert.equal(Engine.countFaceUp(state.playerHand), 4);
    assert.equal(Engine.flipFoundation(state, 'player', fifth).reason, 'face_up_limit');
    assert.equal(fifth.isFaceUp, false);
});

test('preparation moves a blocker before a natural stalemate and never reads a hidden rank', () => {
    const state = fixture({
        playerHand: [['6', 0, false], ['8', 0], ['ace', 1, false], ['queen', 1]],
        aiHand: [['king']], centerPileLeft: [['2']], centerPileRight: [['4']]
    });
    const [covered] = state.playerHand;
    assert.deepEqual(Engine.availableMoves(state, 'player'), []);
    assert.equal(Engine.canRestart(state), false);
    for (let count = 0; count < 4; count++) {
        const view = state.playerHand.map(card => ({
            id: card.id, isFaceUp: card.isFaceUp, foundation: { ...card.foundation },
            get rank() { throw new Error('Foundation preparation must not read rank'); }
        }));
        const action = Engine.planFoundationPreparation(view, Engine.getFoundationBounds(state, 'player'));
        assert.ok(action);
        const model = state.playerHand.find(card => card.id === action.card.id);
        const result = action.type === 'move' ? Engine.moveFoundation(state, 'player', model, action.position)
            : Engine.flipFoundation(state, 'player', model);
        assert.equal(result.ok, true);
        if (count === 0) {
            assert.equal(action.type, 'move');
            assert.equal(covered.isFaceUp, false);
        }
    }
    assert.equal(Engine.countFaceUp(state.playerHand), 4);
    assert.equal(Engine.planFoundationPreparation(state.playerHand), null);
    assertCards(state);
});

test('preparation fills and settles even after arbitrary overlaps instead of cycling blockers', () => {
    for (let seed = 1; seed <= 400; seed++) {
        const random = seeded(seed);
        const state = Engine.initializeMatch({}, random);
        const bounds = seed % 2 ? { width: 6.4, height: 2.15 } : { width: 10, height: 1.55 };
        Engine.startRound(state, random, { ai: bounds });
        Engine.revealDraw(state, { random });
        const hand = state.aiHand;
        hand.forEach((card, index) => {
            card.foundation = { x: random() * (bounds.width - 1), y: random() * (bounds.height - 1), z: index + 1 };
            card.isFaceUp = index <= seed % 4;
        });
        let attempts = 0;
        for (; attempts < 35; attempts++) {
            const choice = Engine.planFoundationPreparation(hand, bounds);
            if (!choice) break;
            const result = choice.type === 'move' ? Engine.moveFoundation(state, 'ai', choice.card, choice.position)
                : Engine.flipFoundation(state, 'ai', choice.card);
            assert.equal(result.ok, true, `seed ${seed}, attempt ${attempts}, ${result.reason}`);
        }
        assert.equal(Engine.countFaceUp(hand), 4, `seed ${seed}`);
        assert.ok(attempts < 35, `seed ${seed} cycled blockers`);
        assertCards(state, `seed ${seed}`);
    }
});

test('either seat can force one coordinated reveal while both have moves, and a second request on that basis is stale', () => {
    const state = fixture({
        playerHand: [['7']], aiHand: [['5']], playerDeck: [['10']], aiDeck: [['10']],
        centerPileLeft: [['6']], centerPileRight: [['2']]
    });
    const [held] = state.playerHand;
    const original = held.foundation;
    const basis = state.revealRevision;
    const oldLeft = state.centerPileLeft[0];
    const oldRight = state.centerPileRight[0];
    assert.equal(Engine.canTakeOutside(state, 'player', held), true);
    assert.ok(Engine.availableMoves(state, 'ai').length);
    assert.equal(Engine.revealDraw(state, { expectedReveal: basis }).reason, 'moves_available');
    const forced = Engine.revealDraw(state, { force: true, expectedReveal: basis });
    assert.equal(forced.ok, true);
    assert.equal(forced.revealRevision, basis + 1);
    assert.equal(forced.slapAvailable, true);
    assert.deepEqual(state.centerPileLeft, [oldLeft, forced.cards.ai]);
    assert.deepEqual(state.centerPileRight, [oldRight, forced.cards.player]);
    assert.equal(Engine.revealDraw(state, { force: true, expectedReveal: basis }).reason, 'stale_reveal');
    assert.equal(Engine.canTakeOutside(state, 'player', held), false);
    assert.equal(Engine.playFoundation(state, 'player', held, 'left').reason, 'not_playable');
    assert.equal(held.foundation, original);
    const slap = Engine.takeSlap(state, 'ai');
    assert.equal(slap.ok, true);
    assert.equal(held.foundation, original);
    assert.equal(Engine.revealDraw(state, { force: true, expectedReveal: forced.revealRevision }).reason, 'stale_reveal');
    assertCards(state);
});

test('a forced reveal cannot roll back an already completed round', () => {
    const state = fixture({
        playerHand: [['7']], aiHand: [['5']], playerDeck: [['10']], aiDeck: [['10']],
        centerPileLeft: [['6']], centerPileRight: [['2']]
    });
    const basis = state.revealRevision;
    assert.equal(Engine.playFoundation(state, 'player', state.playerHand[0], 'left').finishedRound, true);
    assert.equal(Engine.revealDraw(state, { force: true, expectedReveal: basis }).reason, 'inactive');
    assert.equal(state.p1Rounds, 1);
    assertCards(state);
});

test('forced reveals apply the top-half loan and recycle both empty Draw Decks without repositioning Foundations', () => {
    const shorted = fixture({
        playerHand: [['7']], aiHand: [['ace']], aiDeck: [['3'], ['2'], ['10']],
        centerPileLeft: [['6']], centerPileRight: [['4']]
    }, 'aiHolding');
    const card = shorted.playerHand[0];
    const position = card.foundation;
    const [extra, donorReveal, loan] = shorted.aiDeck;
    assert.equal(Engine.canTakeOutside(shorted, 'player', card), true);
    const split = Engine.revealDraw(shorted, { force: true });
    assert.equal(split.cards.player, loan);
    assert.equal(split.cards.ai, donorReveal);
    assert.deepEqual(shorted.aiDeck, [extra]);
    assert.equal(loan.owner, 'ai');
    assert.equal(card.foundation, position);
    assertCards(shorted);

    const exhausted = fixture({
        playerHand: [['7']], aiHand: [['ace']], centerPileLeft: [['5'], ['6']], centerPileRight: [['2']]
    }, 'aiHolding');
    const centre = exhausted.centerPileLeft.concat(exhausted.centerPileRight);
    const opponentPose = exhausted.aiHand[0].foundation;
    assert.equal(Engine.canRestart(exhausted), false);
    const recycled = Engine.revealDraw(exhausted, { force: true, random: seeded(21) });
    assert.equal(recycled.recycled, true);
    assert.equal(exhausted.aiHand[0].foundation, opponentPose);
    const temporary = exhausted.centerPileLeft.concat(exhausted.centerPileRight, exhausted.playerDeck, exhausted.aiDeck);
    assert.ok(temporary.every(entry => centre.includes(entry) && entry.owner === null));
    assertCards(exhausted);
});

test('2,400 seeded full matches exercise spatial Foundations and strategic restarts without losing cards', t => {
    const total = 2400;
    const summary = { matches: 0, actions: 0, rounds: 0, slaps: 0, loans: 0, recycled: 0, redeals: 0, moves: 0, forced: 0 };
    for (let seed = 1; seed <= total; seed++) {
        const random = seeded(seed);
        const state = Engine.initializeMatch({}, random);
        const bounds = seed % 2 === 0 ? { player: { width: 10, height: 1.55 }, ai: { width: 10, height: 1.55 } } : {};
        const identities = new Map(Object.values(Engine.cardZones(state)).flat().map(card => [card.id, card]));
        let actions = 0;
        while (state.phase !== 'match_over' && actions < 10000) {
            const context = `seed ${seed}, action ${actions}, phase ${state.phase}`;
            let outcome;
            if (state.phase === 'round_over') {
                outcome = Engine.startRound(state, random, bounds);
            } else if (state.phase === 'awaiting_reveal') {
                outcome = Engine.revealDraw(state, { random });
            } else if (state.slapActive && random() < 0.9) {
                outcome = Engine.takeSlap(state, random() < 0.5 ? 'player' : 'ai');
                summary.slaps++;
            } else {
                const decisions = SEATS.flatMap(seat => {
                    const hand = state[seat + 'Hand'];
                    const plays = Engine.availableMoves(state, seat).map(move => ({ ...move, seat, type: 'play' }));
                    const preparation = Engine.planFoundationPreparation(hand, Engine.getFoundationBounds(state, seat));
                    if (preparation) plays.push({ ...preparation, seat });
                    return plays;
                });
                if (decisions.length && random() < (seed % 10) / 300) {
                    const expectedReveal = state.revealRevision;
                    outcome = Engine.revealDraw(state, { random, force: true, expectedReveal });
                    summary.forced++;
                } else if (decisions.length) {
                    const choice = decisions[Math.floor(random() * decisions.length)];
                    if (choice.type === 'play') outcome = Engine.playFoundation(state, choice.seat, choice.card, choice.side, random);
                    else if (choice.type === 'flip') outcome = Engine.flipFoundation(state, choice.seat, choice.card);
                    else {
                        outcome = Engine.moveFoundation(state, choice.seat, choice.card, choice.position);
                        summary.moves++;
                    }
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
    assert.equal(summary.matches, total);
    t.diagnostic(JSON.stringify(summary));
    assert.ok(summary.rounds > total && summary.slaps > total && summary.loans > total && summary.recycled > 0);
    assert.ok(summary.moves > total && summary.forced > total);
});
