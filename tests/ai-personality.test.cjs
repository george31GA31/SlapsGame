const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadAI(difficulty = 5) {
    const ctx = {
        gameState: {
            difficulty,
            aiInChain: false,
            playerHand: [{ value: 9 }, { value: 3 }],
            aiHand: [
                { id: 'a', isFaceUp: true, value: 5, laneIndex: 0 },
                { id: 'b', isFaceUp: true, value: 8, laneIndex: 1 },
                { id: 'c', isFaceUp: true, value: 12, laneIndex: 1 }
            ],
            centerPileLeft: [{ value: 4 }],
            centerPileRight: [{ value: 9 }]
        },
        checkPileLogic(card, pile) {
            if (!pile.length) return false;
            const top = pile[pile.length - 1];
            const difference = Math.abs(card.value - top.value);
            return difference === 1 || difference === 12;
        },
        performance: { now: () => 1000 },
        setTimeout() {},
        clearTimeout() {},
        requestAnimationFrame() {},
        Math,
        console
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('ai-personality.js', 'utf8'), ctx, { filename: 'ai-personality.js' });
    return ctx;
}

test('AI personality exposes helpers and overrides the bot decision functions', () => {
    const ctx = loadAI();
    assert.equal(typeof ctx.SlapsAI.humanDelay, 'function');
    assert.equal(typeof ctx.SlapsAI.legalCandidates, 'function');
    assert.equal(typeof ctx.attemptAIMove, 'function');
    assert.equal(typeof ctx.triggerAISlap, 'function');
});

test('AI personality only proposes moves that are legal on the current piles', () => {
    const ctx = loadAI();
    const moves = ctx.SlapsAI.legalCandidates(ctx.gameState.aiHand);
    assert.ok(moves.length > 0);
    for (const move of moves) {
        const pile = move.t === 'left' ? ctx.gameState.centerPileLeft : ctx.gameState.centerPileRight;
        assert.equal(ctx.checkPileLogic(move.c, pile), true);
    }
});

test('AI reaction timing remains bounded and higher difficulty is faster on average', () => {
    const rookie = loadAI(1);
    const legend = loadAI(10);
    const rookieSamples = Array.from({ length: 80 }, () => rookie.SlapsAI.humanDelay('move'));
    const legendSamples = Array.from({ length: 80 }, () => legend.SlapsAI.humanDelay('move'));
    const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;

    assert.ok(rookieSamples.every(value => Number.isFinite(value) && value >= 720));
    assert.ok(legendSamples.every(value => Number.isFinite(value) && value >= 720));
    assert.ok(average(rookieSamples) > average(legendSamples) + 700);

    const slapSamples = Array.from({ length: 80 }, () => legend.SlapsAI.humanDelay('slap'));
    assert.ok(slapSamples.every(value => value >= 230));
});
