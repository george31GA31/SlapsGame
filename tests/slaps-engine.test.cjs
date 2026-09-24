const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../slaps-engine.js');

test('canonical deck has 52 unique cards with correct values', () => {
    const deck = Engine.createDeck();
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck.map(c => c.id)).size, 52);
    assert.equal(deck.find(c => c.rank === '2').value, 2);
    assert.equal(deck.find(c => c.rank === 'ace').value, 14);
});

test('pile legality matches Slaps adjacent-card rule including ace-to-two wrap', () => {
    const pile = [{ value: 10 }];
    assert.equal(Engine.canPlayOnPile({ value: 9 }, pile), true);
    assert.equal(Engine.canPlayOnPile({ value: 11 }, pile), true);
    assert.equal(Engine.canPlayOnPile({ value: 12 }, pile), false);
    assert.equal(Engine.canPlayOnPile({ value: 14 }, [{ value: 2 }]), true);
    assert.equal(Engine.canPlayOnPile({ value: 2 }, [{ value: 14 }]), true);
});

test('slap requires matching ranks on both centre piles', () => {
    assert.equal(Engine.isSlapAvailable([{ rank: '7' }], [{ rank: '7' }]), true);
    assert.equal(Engine.isSlapAvailable([{ rank: '7' }], [{ rank: '8' }]), false);
    assert.equal(Engine.isSlapAvailable([], [{ rank: '7' }]), false);
});

test('only the uncovered top card in a lane can be flipped', () => {
    const hand = [
        { id: 'a', laneIndex: 0, isFaceUp: false },
        { id: 'b', laneIndex: 0, isFaceUp: false },
        { id: 'c', laneIndex: 1, isFaceUp: true }
    ];
    assert.equal(Engine.canFlipCard(hand, hand[0]).reason, 'covered');
    assert.equal(Engine.canFlipCard(hand, hand[1]).ok, true);
});

test('four exposed cards is the limit but a card awaiting move confirmation can be excluded', () => {
    const hand = [
        { id: 'a', laneIndex: 0, isFaceUp: true, pendingMove: true },
        { id: 'b', laneIndex: 1, isFaceUp: true },
        { id: 'c', laneIndex: 2, isFaceUp: true },
        { id: 'd', laneIndex: 3, isFaceUp: true },
        { id: 'e', laneIndex: 4, isFaceUp: false }
    ];
    assert.equal(Engine.countFaceUp(hand), 4);
    assert.equal(Engine.countFaceUp(hand, { ignorePending: true }), 3);
    assert.equal(Engine.canFlipCard(hand, hand[4], { requireTopOfLane: false }).reason, 'face_up_limit');
    assert.equal(Engine.canFlipCard(hand, hand[4], { requireTopOfLane: false, ignorePending: true }).ok, true);
});

test('hand lane layout preserves current 4-3-2-1 ten-card shape', () => {
    assert.deepEqual(Engine.laneSizes(10), [4, 3, 2, 1]);
    assert.deepEqual(Engine.laneSizes(9), [3, 2, 2, 2]);
    assert.deepEqual(Engine.laneSizes(4), [1, 1, 1, 1]);
});

test('odd-pot split never loses the odd card', () => {
    const cards = Array.from({ length: 9 }, (_, i) => ({ id: String(i) }));
    const split = Engine.splitPot(cards);
    assert.equal(split.oddCard.id, '8');
    assert.equal(split.playerShare.length, 4);
    assert.equal(split.opponentShare.length, 4);
    assert.equal(split.playerShare.length + split.opponentShare.length + 1, cards.length);
});

test('card conservation validator catches duplicates and missing cards', () => {
    const deck = Engine.createDeck();
    assert.equal(Engine.validateCardSet({ deck }).ok, true);
    const broken = deck.slice(0, 51).concat(deck[0]);
    const result = Engine.validateCardSet({ deck: broken });
    assert.equal(result.ok, false);
    assert.equal(result.uniqueCount, 51);
});

test('5000 randomized splits preserve every card count', () => {
    for (let i = 0; i < 5000; i++) {
        const count = i % 53;
        const cards = Array.from({ length: count }, (_, n) => ({ id: `${i}:${n}` }));
        const split = Engine.splitPot(cards);
        const rebuilt = split.playerShare.length + split.opponentShare.length + (split.oddCard ? 1 : 0);
        assert.equal(rebuilt, cards.length);
        assert.equal(Math.abs(split.playerShare.length - split.opponentShare.length), 0);
    }
});
