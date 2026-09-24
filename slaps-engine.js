/* Slaps canonical rules helpers.
   Pure, DOM-free functions shared by bot and online modes.
   UI/network layers may present or transport state, but must not redefine these rules. */
(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SlapsEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    const SUITS = Object.freeze(['hearts', 'diamonds', 'clubs', 'spades']);
    const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace']);
    const MAX_FACE_UP = 4;
    const STANDARD_DECK_SIZE = 52;

    function rankValue(rank) {
        const index = RANKS.indexOf(rank);
        return index === -1 ? null : index + 2;
    }

    function createDeck() {
        const deck = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                deck.push({
                    id: `${suit}:${rank}`,
                    suit,
                    rank,
                    value: rankValue(rank),
                    isFaceUp: false,
                    owner: null,
                    laneIndex: 0
                });
            }
        }
        return deck;
    }

    function shuffleInPlace(array, random = Math.random) {
        if (!Array.isArray(array)) throw new TypeError('array must be an array');
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    function isAdjacentValue(a, b) {
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
        const diff = Math.abs(a - b);
        return diff === 1 || diff === 12;
    }

    function canPlayOnPile(card, targetPile) {
        if (!card || !Array.isArray(targetPile) || targetPile.length === 0) return false;
        const target = targetPile[targetPile.length - 1];
        return !!target && isAdjacentValue(card.value, target.value);
    }

    function isSlapAvailable(leftPile, rightPile) {
        if (!Array.isArray(leftPile) || !Array.isArray(rightPile) || leftPile.length === 0 || rightPile.length === 0) return false;
        const left = leftPile[leftPile.length - 1];
        const right = rightPile[rightPile.length - 1];
        return !!left && !!right && left.rank === right.rank;
    }

    function countFaceUp(hand, options = {}) {
        if (!Array.isArray(hand)) return 0;
        const ignorePending = options.ignorePending === true;
        return hand.reduce((count, card) => {
            if (!card) return count;
            if (ignorePending && card.pendingMove) return count;
            return count + ((card.isFaceUp || card.flipping) ? 1 : 0);
        }, 0);
    }

    function isTopOfLane(hand, card) {
        if (!Array.isArray(hand) || !card || !Number.isInteger(card.laneIndex)) return false;
        const cardIndex = hand.indexOf(card);
        if (cardIndex === -1) return false;
        let topIndex = -1;
        for (let i = 0; i < hand.length; i++) {
            if (hand[i] && hand[i].laneIndex === card.laneIndex) topIndex = i;
        }
        return topIndex === cardIndex;
    }

    function canFlipCard(hand, card, options = {}) {
        const maxFaceUp = Number.isInteger(options.maxFaceUp) ? options.maxFaceUp : MAX_FACE_UP;
        const requireTopOfLane = options.requireTopOfLane !== false;
        const ignorePending = options.ignorePending === true;

        if (!Array.isArray(hand) || !card || !hand.includes(card)) return { ok: false, reason: 'not_in_hand' };
        if (card.isFaceUp || card.flipping) return { ok: false, reason: 'already_face_up' };
        if (card.pendingMove) return { ok: false, reason: 'pending_move' };
        if (requireTopOfLane && !isTopOfLane(hand, card)) return { ok: false, reason: 'covered' };
        if (countFaceUp(hand, { ignorePending }) >= maxFaceUp) return { ok: false, reason: 'face_up_limit' };
        return { ok: true, reason: null };
    }

    function laneSizes(cardCount) {
        const count = Math.max(0, Math.min(10, Number(cardCount) || 0));
        if (count === 10) return [4, 3, 2, 1];
        const sizes = [0, 0, 0, 0];
        for (let i = 0; i < count; i++) sizes[i % 4]++;
        return sizes;
    }

    function splitPot(cards) {
        const pot = Array.isArray(cards) ? cards.slice() : [];
        const oddCard = pot.length % 2 ? pot.pop() : null;
        const half = pot.length / 2;
        return {
            oddCard,
            playerShare: pot.slice(0, half),
            opponentShare: pot.slice(half),
            evenCount: pot.length
        };
    }

    function validateCardSet(zones, expectedCount = STANDARD_DECK_SIZE) {
        const cards = [];
        for (const zone of Object.values(zones || {})) {
            if (Array.isArray(zone)) cards.push(...zone);
        }
        const ids = cards.map(card => card && (card.id || (card.suit && card.rank ? `${card.suit}:${card.rank}` : null)));
        const missingIdentity = ids.some(id => !id);
        const unique = new Set(ids.filter(Boolean));
        return {
            ok: !missingIdentity && cards.length === expectedCount && unique.size === cards.length,
            count: cards.length,
            uniqueCount: unique.size,
            expectedCount,
            missingIdentity
        };
    }

    return Object.freeze({
        SUITS,
        RANKS,
        MAX_FACE_UP,
        STANDARD_DECK_SIZE,
        rankValue,
        createDeck,
        shuffleInPlace,
        isAdjacentValue,
        canPlayOnPile,
        isSlapAvailable,
        countFaceUp,
        isTopOfLane,
        canFlipCard,
        laneSizes,
        splitPot,
        validateCardSet
    });
});
