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
    const SEATS = ['player', 'ai'];
    const SIDES = ['left', 'right'];
    const CENTRE_KEYS = { left: 'centerPileLeft', right: 'centerPileRight' };
    const ROUND_ZONES = ['Hand', 'Deck', 'Holding', 'RoundCards'];

    function otherSeat(seat) {
        return seat === 'player' ? 'ai' : 'player';
    }

    function rejected(reason) {
        return { ok: false, reason };
    }

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
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 2 || a > 14 || b < 2 || b > 14) return false;
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
        return !!left && !!right && rankValue(left.rank) !== null && left.rank === right.rank;
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
        return getExposedCards(hand).includes(card);
    }

    function getExposedCards(hand) {
        if (!Array.isArray(hand)) return [];
        const tops = new Map();
        for (const card of hand) {
            if (card && Number.isInteger(card.laneIndex)) tops.set(card.laneIndex, card);
        }
        return [...tops.values()];
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

    function initializeMatch(state, random = Math.random) {
        const deck = shuffleInPlace(createDeck(), random);
        deck.forEach((card, index) => {
            // The shuffled identity does not encode a hidden card's rank or suit.
            card.id = `card-${index + 1}`;
            card.imgSrc = `assets/cards/${card.rank}_of_${card.suit}.png`;
        });
        for (const [index, seat] of SEATS.entries()) {
            for (const zone of ROUND_ZONES) state[seat + zone] = [];
            state[seat + 'RoundCards'] = deck.slice(index * 26, (index + 1) * 26);
            for (const card of state[seat + 'RoundCards']) card.owner = seat;
            state[seat + 'Yellows'] = 0;
            state[seat + 'Reds'] = 0;
        }
        state.centerPileLeft = [];
        state.centerPileRight = [];
        state.misslaps = { player: 0, ai: 0 };
        state.pendingReds = { player: 0, ai: 0 };
        state.p1Rounds = state.aiRounds = state.p1Slaps = state.aiSlaps = 0;
        state.phase = 'round_over';
        state.roundStarted = false;
        state.matchWinner = null;
        refreshCounts(state);
        return state;
    }

    function startRound(state, random = Math.random) {
        if (state.phase !== 'round_over') return rejected('round_unavailable');
        for (const seat of SEATS) {
            const cards = shuffleInPlace(state[seat + 'RoundCards'].splice(0), random);
            for (const card of cards) card.element = null;
            const hand = state[seat + 'Hand'];
            let next = 0;
            for (const [lane, size] of laneSizes(cards.length).entries()) {
                for (let index = 0; index < size; index++) {
                    const card = cards[next++];
                    card.laneIndex = lane;
                    card.isFaceUp = index === size - 1;
                    hand.push(card);
                }
            }
            state[seat + 'Deck'].push(...cards.slice(next));
        }
        splitShortDrawDeck(state);
        state.phase = 'awaiting_reveal';
        state.roundStarted = false;
        refreshCounts(state);
        return { ok: true };
    }

    function refreshCounts(state) {
        const playerDraw = state.playerDeck;
        const opponentDraw = state.aiDeck;
        for (const seat of SEATS) {
            const holding = state[seat + 'Holding'];
            const ownedDraws = playerDraw.filter(card => card.owner === seat).length +
                opponentDraw.filter(card => card.owner === seat).length;
            state[seat + 'Total'] = state[seat + 'Hand'].length + holding.length +
                state[seat + 'RoundCards'].length + ownedDraws;
            state[seat + 'SlapCards'] = holding.length;
        }
        state.borrowedPlayer = playerDraw.some(card => card.owner !== 'player');
        state.borrowedAi = opponentDraw.some(card => card.owner !== 'ai');
        state.slapActive = state.phase === 'active' && isSlapAvailable(state.centerPileLeft, state.centerPileRight);
    }

    function splitShortDrawDeck(state) {
        for (const borrower of SEATS) {
            const empty = state[borrower + 'Deck'];
            const donor = state[otherSeat(borrower) + 'Deck'];
            if (empty.length || donor.length < 2) continue;
            const loanSize = Math.floor(donor.length / 2);
            // Draw piles pop from their top. An odd extra card stays with the donor.
            empty.push(...donor.splice(-loanSize));
            return;
        }
    }

    function availableMoves(state, seat) {
        if (state.phase !== 'active' || !SEATS.includes(seat)) return [];
        const moves = [];
        for (const card of getExposedCards(state[seat + 'Hand'])) {
            if (!card.isFaceUp || card.flipping) continue;
            for (const side of SIDES) {
                if (canPlayOnPile(card, state[CENTRE_KEYS[side]])) moves.push({ card, side });
            }
        }
        return moves;
    }

    function canRestart(state) {
        return state.phase === 'active' && SEATS.every(seat => {
            const hand = state[seat + 'Hand'];
            return !availableMoves(state, seat).length &&
                !getExposedCards(hand).some(card => canFlipCard(hand, card).ok);
        });
    }

    function flipFoundation(state, seat, card) {
        if (state.phase !== 'active') return rejected('inactive');
        if (!SEATS.includes(seat)) return rejected('invalid_player');
        const decision = canFlipCard(state[seat + 'Hand'], card);
        if (decision.ok) card.isFaceUp = true;
        return decision;
    }

    function recycleCentreCards(state, random) {
        const recycled = shuffleInPlace(state.centerPileLeft.splice(0).concat(state.centerPileRight.splice(0)), random);
        const extraSeat = recycled.length % 2 && random() < 0.5 ? 'ai' : 'player';
        const split = extraSeat === 'player' ? Math.ceil(recycled.length / 2) : Math.floor(recycled.length / 2);
        for (const card of recycled) {
            card.owner = null;
            card.isFaceUp = false;
        }
        state.playerDeck.push(...recycled.slice(0, split));
        state.aiDeck.push(...recycled.slice(split));
    }

    function revealDraw(state, { random = Math.random, force = false } = {}) {
        if (state.phase !== 'awaiting_reveal' && state.phase !== 'active') return rejected('inactive');
        if (state.phase === 'active' && !force && !canRestart(state)) return rejected('moves_available');

        splitShortDrawDeck(state);
        let recycled = false;
        const cards = { player: null, ai: null };
        if (!state.playerDeck.length && !state.aiDeck.length) {
            const centre = state.centerPileLeft.concat(state.centerPileRight);
            const exposed = SEATS.flatMap(seat => getExposedCards(state[seat + 'Hand']));
            const canAdvance = centre.some(card => exposed.some(top => isAdjacentValue(card.value, top.value)));
            const canSlap = new Set(centre.map(card => card.rank)).size < centre.length;
            if (!centre.length || (!canAdvance && !canSlap)) {
                // When no restart can change play, preserve the slap and end the unusable round unscored.
                collectRound(state, null, random);
                return { ok: true, cards, redealt: true, recycled: false, matchWinner: state.matchWinner, slapAvailable: false };
            }
            recycleCentreCards(state, random);
            recycled = true;
        }
        for (const [seat, side] of [['player', 'right'], ['ai', 'left']]) {
            const card = state[seat + 'Deck'].pop();
            if (!card) continue;
            card.isFaceUp = true;
            state[CENTRE_KEYS[side]].push(card);
            cards[seat] = card;
        }
        state.phase = 'active';
        state.roundStarted = true;
        refreshCounts(state);
        return { ok: true, cards, recycled, slapAvailable: state.slapActive };
    }

    function playFoundation(state, seat, card, side, random = Math.random) {
        if (state.phase !== 'active') return rejected('inactive');
        if (!SEATS.includes(seat)) return rejected('invalid_player');
        if (!SIDES.includes(side)) return rejected('invalid_pile');
        const hand = state[seat + 'Hand'];
        const pile = state[CENTRE_KEYS[side]];
        if (!hand.includes(card)) return rejected('not_in_hand');
        if (!isTopOfLane(hand, card)) return rejected('covered');
        if (!card.isFaceUp || card.flipping) return rejected('face_down');
        if (!canPlayOnPile(card, pile)) return rejected('not_playable');

        hand.splice(hand.indexOf(card), 1);
        pile.push(card);
        const finishedRound = hand.length === 0;
        if (finishedRound) collectRound(state, seat, random);
        else refreshCounts(state);
        return { ok: true, card, finishedRound, matchWinner: state.matchWinner, slapAvailable: state.slapActive };
    }

    function takeSlap(state, winner) {
        if (state.phase !== 'active') return rejected('inactive');
        if (!SEATS.includes(winner)) return rejected('invalid_player');
        if (!isSlapAvailable(state.centerPileLeft, state.centerPileRight)) return rejected('no_match');
        const loser = otherSeat(winner);
        const cards = state.centerPileLeft.splice(0).concat(state.centerPileRight.splice(0));
        for (const card of cards) {
            card.owner = loser;
            card.isFaceUp = false;
        }
        state[loser + 'Holding'].push(...cards);
        state[winner === 'player' ? 'p1Slaps' : 'aiSlaps']++;
        state.phase = 'awaiting_reveal';
        refreshCounts(state);
        return { ok: true, loser, cardCount: cards.length };
    }

    function recordMisslap(state, seat) {
        if (state.phase !== 'active') return rejected('inactive');
        if (!SEATS.includes(seat)) return rejected('invalid_player');
        if (isSlapAvailable(state.centerPileLeft, state.centerPileRight)) return rejected('slap_available');
        const count = ++state.misslaps[seat];
        if (count === 2) {
            state[seat + 'Yellows']++;
            return { ok: true, severity: 'yellow' };
        }
        if (count === 3) {
            state[seat + 'Reds']++;
            state.pendingReds[seat]++;
            state.misslaps[seat] = 0;
            return { ok: true, severity: 'red' };
        }
        return { ok: true, severity: null };
    }

    function collectRound(state, winner, random) {
        const loser = winner ? otherSeat(winner) : null;
        const owned = { player: [], ai: [] };
        const neutral = [];
        for (const seat of SEATS) {
            owned[seat].push(...state[seat + 'Hand'].splice(0), ...state[seat + 'Holding'].splice(0));
            for (const card of state[seat + 'Deck'].splice(0)) {
                if (card.owner) owned[card.owner].push(card);
                else neutral.push(card);
            }
        }
        for (const card of state.centerPileLeft.splice(0).concat(state.centerPileRight.splice(0))) {
            if (loser) owned[loser].push(card);
            else if (card.owner) owned[card.owner].push(card);
            else neutral.push(card);
        }
        if (loser) owned[loser].push(...neutral);
        else {
            // If the round is unscored, distribute unowned recycle cards evenly.
            const shuffled = shuffleInPlace(neutral, random);
            const first = shuffled.length % 2 && random() < 0.5 ? 1 : 0;
            shuffled.forEach((card, index) => owned[SEATS[(index + first) % 2]].push(card));
        }

        const transfers = {};
        for (const seat of SEATS) {
            const donor = owned[otherSeat(seat)];
            const amount = Math.min(donor.length, state.pendingReds[seat] * 3);
            transfers[seat] = amount ? shuffleInPlace(donor, random).splice(-amount) : [];
            state.pendingReds[seat] = 0;
        }
        for (const seat of SEATS) {
            const cards = owned[seat].concat(transfers[seat]);
            for (const card of cards) {
                card.owner = seat;
                card.isFaceUp = false;
                delete card.pendingMove;
                delete card.flipping;
            }
            state[seat + 'RoundCards'].push(...cards);
        }

        if (winner) state[winner === 'player' ? 'p1Rounds' : 'aiRounds']++;
        state.matchWinner = SEATS.find(seat => state[seat + 'RoundCards'].length === 0) || null;
        state.roundStarted = false;
        state.phase = state.matchWinner ? 'match_over' : 'round_over';
        refreshCounts(state);
    }

    function concedeMatch(state, seat) {
        if (!SEATS.includes(seat)) return rejected('invalid_player');
        if (state.phase === 'match_over') return rejected('inactive');
        const winner = otherSeat(seat);
        if (state.roundStarted) state[winner === 'player' ? 'p1Rounds' : 'aiRounds']++;
        state.matchWinner = winner;
        state.roundStarted = false;
        state.phase = 'match_over';
        refreshCounts(state);
        return { ok: true, winner };
    }

    function cardZones(state) {
        const zones = {};
        for (const seat of SEATS) {
            for (const zone of ROUND_ZONES) zones[seat + zone] = state[seat + zone];
        }
        for (const key of Object.values(CENTRE_KEYS)) zones[key] = state[key];
        return zones;
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
        validateCardSet,
        initializeMatch,
        startRound,
        getExposedCards,
        availableMoves,
        canRestart,
        flipFoundation,
        revealDraw,
        playFoundation,
        takeSlap,
        recordMisslap,
        concedeMatch,
        cardZones
    });
});
