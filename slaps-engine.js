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
    const FOUNDATION_WIDTH = 6.4;
    const FOUNDATION_HEIGHT = 2.15;
    const DEFAULT_FOUNDATION_BOUNDS = Object.freeze({ width: FOUNDATION_WIDTH, height: FOUNDATION_HEIGHT });
    const GEOMETRY_TOLERANCE = 1e-7;
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
                    owner: null
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

    function countFaceUp(hand) {
        if (!Array.isArray(hand)) return 0;
        return hand.reduce((count, card) => count + Number(Boolean(card?.isFaceUp || card?.flipping)), 0);
    }

    function isValidFoundationBounds(bounds) {
        return bounds != null && Number.isFinite(bounds.width) && Number.isFinite(bounds.height) &&
            bounds.width >= 4 && bounds.height >= 1.25;
    }

    function getFoundationBounds(state, seat) {
        return state.foundationBounds?.[seat] || DEFAULT_FOUNDATION_BOUNDS;
    }

    function isWithinFoundation(position, bounds) {
        return position != null && Number.isFinite(position.x) && Number.isFinite(position.y) &&
            position.x >= 0 && position.y >= 0 && position.x <= bounds.width - 1 && position.y <= bounds.height - 1;
    }

    function isValidFoundationPosition(position, bounds) {
        return position != null && Number.isFinite(position.x) && Number.isFinite(position.y) &&
            position.x >= 0 && position.y >= 0 && Number.isSafeInteger(position.z) && position.z > 0 &&
            (bounds === undefined || isValidFoundationBounds(bounds) && isWithinFoundation(position, bounds));
    }

    function initialFoundationPosition(lane, depth, z, bounds) {
        const stackOffset = 0.075;
        const width = bounds.width - 1;
        const margin = Math.min(0.24, (width - 3) / 2);
        return {
            x: margin + lane * (width - 2 * margin) / 3,
            y: (bounds.height - 1 - stackOffset * 3) / 2 + depth * stackOffset,
            z
        };
    }

    function foundationGeometry(hand) {
        if (!Array.isArray(hand)) return [];
        const depths = new Map();
        const geometry = [];
        for (const card of hand) {
            if (!card) continue;
            let position = card.foundation;
            if (!isValidFoundationPosition(position)) {
                // Compatibility for a pre-geometry hand. New deals always have actual positions.
                const lane = Number.isInteger(card.laneIndex) ? card.laneIndex : 0;
                const depth = depths.get(lane) || 0;
                depths.set(lane, depth + 1);
                position = { x: 0.2 + lane * 1.25, y: 0.4 + depth * 0.075, z: geometry.length + 1 };
            }
            geometry.push({ card, position });
        }
        return geometry;
    }

    function getFoundationPosition(hand, card) {
        if (!Array.isArray(hand) || !hand.includes(card)) return null;
        if (isValidFoundationPosition(card?.foundation)) return card.foundation;
        return foundationGeometry(hand).find(entry => entry.card === card)?.position || null;
    }

    function overlaps(a, b) {
        return Math.abs(a.x - b.x) < 1 - GEOMETRY_TOLERANCE && Math.abs(a.y - b.y) < 1 - GEOMETRY_TOLERANCE;
    }

    function getCoveringPositions(geometry, position) {
        return geometry.filter(entry => entry.position.z > position.z && overlaps(entry.position, position));
    }

    function isExposedIn(geometry, position) {
        return !geometry.some(entry => entry.position.z > position.z && overlaps(entry.position, position));
    }

    function hasUncoveredArea(position, coverings) {
        // Test the union of the overlap rectangles. Two upper cards can completely hide one lower card.
        const right = position.x + 1;
        const bottom = position.y + 1;
        const rectangles = coverings.map(({ position: cover }) => ({
            left: Math.max(position.x, cover.x), right: Math.min(right, cover.x + 1),
            top: Math.max(position.y, cover.y), bottom: Math.min(bottom, cover.y + 1)
        }));
        const edges = [position.x, right, ...rectangles.flatMap(rect => [rect.left, rect.right])].sort((a, b) => a - b);
        for (let index = 1; index < edges.length; index++) {
            if (edges[index] - edges[index - 1] <= GEOMETRY_TOLERANCE) continue;
            const x = (edges[index] + edges[index - 1]) / 2;
            const intervals = rectangles.filter(rect => rect.left < x && x < rect.right).sort((a, b) => a.top - b.top);
            let filledThrough = position.y;
            for (const rect of intervals) {
                if (rect.top > filledThrough + GEOMETRY_TOLERANCE) break;
                filledThrough = Math.max(filledThrough, rect.bottom);
            }
            if (filledThrough < bottom - GEOMETRY_TOLERANCE) return true;
        }
        return false;
    }

    function getFoundationExposure(hand, card) {
        const geometry = foundationGeometry(hand);
        const entry = geometry.find(candidate => candidate.card === card);
        if (!entry) return { accessible: false, exposed: false };
        const coverings = getCoveringPositions(geometry, entry.position);
        return { exposed: coverings.length === 0, accessible: hasUncoveredArea(entry.position, coverings) };
    }

    function isFoundationAccessible(hand, card) {
        return getFoundationExposure(hand, card).accessible;
    }

    function isFoundationExposed(hand, card) {
        const geometry = foundationGeometry(hand);
        const entry = geometry.find(candidate => candidate.card === card);
        return Boolean(entry) && isExposedIn(geometry, entry.position);
    }

    function getExposedCards(hand) {
        const geometry = foundationGeometry(hand);
        return geometry.filter(({ position }) => isExposedIn(geometry, position)).map(({ card }) => card);
    }

    function canFlipCard(hand, card) {
        if (!Array.isArray(hand) || !card || !hand.includes(card)) return { ok: false, reason: 'not_in_hand' };
        if (card.isFaceUp || card.flipping) return { ok: false, reason: 'already_face_up' };
        if (card.pendingMove) return { ok: false, reason: 'pending_move' };
        if (!isFoundationExposed(hand, card)) return { ok: false, reason: 'covered' };
        if (countFaceUp(hand) >= MAX_FACE_UP) return { ok: false, reason: 'face_up_limit' };
        return { ok: true, reason: null };
    }

    function laneSizes(cardCount) {
        const count = Math.max(0, Math.min(10, Number(cardCount) || 0));
        if (count === 10) return [4, 3, 2, 1];
        const sizes = [0, 0, 0, 0];
        for (let i = 0; i < count; i++) sizes[i % 4]++;
        return sizes;
    }

    function moveFoundation(state, seat, card, position) {
        if (state.phase !== 'active' && state.phase !== 'awaiting_reveal') return rejected('inactive');
        if (!SEATS.includes(seat)) return rejected('invalid_player');
        const hand = state[seat + 'Hand'];
        if (!hand.includes(card)) return rejected('not_in_hand');
        if (!isWithinFoundation(position, getFoundationBounds(state, seat))) return rejected('outside_foundation');
        const geometry = foundationGeometry(hand);
        const current = geometry.find(entry => entry.card === card)?.position;
        if (!current || !hasUncoveredArea(current, getCoveringPositions(geometry, current))) return rejected('covered');
        const top = Math.max(...geometry.map(entry => entry.position.z));
        card.foundation = { x: position.x, y: position.y, z: top + 1 };
        return { ok: true, position: card.foundation };
    }

    function chooseParkingPosition(geometry, moving, protectedPosition, bounds, previousLiveCoverings = Infinity) {
        const clamped = (value, limit) => Math.max(0, Math.min(limit - 1, value));
        const xCandidates = new Set([0, bounds.width - 1]);
        const yCandidates = new Set([0, bounds.height - 1]);
        for (const { position } of geometry) {
            for (const offset of [-1, 0, 1]) {
                xCandidates.add(clamped(position.x + offset, bounds.width));
                yCandidates.add(clamped(position.y + offset, bounds.height));
            }
        }
        let best = null;
        let bestCost = Infinity;
        for (const x of xCandidates) {
            for (const y of yCandidates) {
                const position = { x, y };
                if (protectedPosition && overlaps(position, protectedPosition)) continue;
                let liveCollisions = 0;
                let hiddenCollisions = 0;
                for (const entry of geometry) {
                    if (entry === moving || !overlaps(position, entry.position)) continue;
                    if (entry.card.isFaceUp) liveCollisions++;
                    else hiddenCollisions++;
                }
                if (liveCollisions >= previousLiveCoverings) continue;
                const travelCost = Math.hypot(x - moving.position.x, y - moving.position.y) / (bounds.width + bounds.height);
                const cost = liveCollisions * 10 + hiddenCollisions + travelCost;
                if (cost < bestCost) {
                    best = position;
                    bestCost = cost;
                }
            }
        }
        return best;
    }

    function liveCoveringsInvolving(geometry, moving) {
        let count = 0;
        for (const entry of geometry) {
            if (entry === moving || !overlaps(entry.position, moving.position)) continue;
            const lowerCard = entry.position.z < moving.position.z ? entry.card : moving.card;
            if (lowerCard.isFaceUp) count++;
        }
        return count;
    }

    function planFoundationPreparation(hand, bounds = DEFAULT_FOUNDATION_BOUNDS) {
        const geometry = foundationGeometry(hand);
        const needsLiveCards = countFaceUp(hand) < MAX_FACE_UP;
        const targets = [];
        for (const entry of geometry) {
            const { card, position } = entry;
            if (card.pendingMove || card.flipping || (!card.isFaceUp && !needsLiveCards)) continue;
            const coverings = getCoveringPositions(geometry, position);
            if (!coverings.length) {
                if (!card.isFaceUp) return { type: 'flip', card };
                continue;
            }
            targets.push({ ...entry, coverings });
        }
        targets.sort((a, b) => Number(a.card.isFaceUp) - Number(b.card.isFaceUp) || a.coverings.length - b.coverings.length);
        for (const target of targets) {
            // The uppermost blocker is visible where it intersects the target.
            const blocker = target.coverings.reduce((top, next) => next.position.z > top.position.z ? next : top);
            if (!blocker.card.pendingMove && !blocker.card.flipping) {
                const previousLiveCoverings = target.card.isFaceUp ? liveCoveringsInvolving(geometry, blocker) : Infinity;
                const position = chooseParkingPosition(geometry, blocker, target.position, bounds, previousLiveCoverings);
                if (position) return { type: 'move', card: blocker.card, position };
            }
            if (target.card.isFaceUp && hasUncoveredArea(target.position, target.coverings)) {
                const moving = geometry.find(entry => entry.card === target.card);
                const position = chooseParkingPosition(geometry, moving, null, bounds, liveCoveringsInvolving(geometry, moving));
                if (position) return { type: 'move', card: moving.card, position };
            }
        }
        return null;
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
        state.foundationBounds = { player: DEFAULT_FOUNDATION_BOUNDS, ai: DEFAULT_FOUNDATION_BOUNDS };
        state.revealRevision = 0;
        state.phase = 'round_over';
        state.roundStarted = false;
        state.matchWinner = null;
        refreshCounts(state);
        return state;
    }

    function startRound(state, random = Math.random, bounds = {}) {
        if (state.phase !== 'round_over') return rejected('round_unavailable');
        const configurations = SEATS.map(seat => bounds[seat] ?? getFoundationBounds(state, seat));
        if (configurations.some(configuration => !isValidFoundationBounds(configuration))) return rejected('invalid_foundation_bounds');
        state.foundationBounds = Object.fromEntries(SEATS.map((seat, index) => [seat, { ...configurations[index] }]));
        for (const seat of SEATS) {
            const cards = shuffleInPlace(state[seat + 'RoundCards'].splice(0), random);
            for (const card of cards) card.element = null;
            const hand = state[seat + 'Hand'];
            const seatBounds = getFoundationBounds(state, seat);
            let next = 0;
            for (const [lane, size] of laneSizes(cards.length).entries()) {
                for (let index = 0; index < size; index++) {
                    const card = cards[next++];
                    card.foundation = initialFoundationPosition(lane, index, next, seatBounds);
                    card.isFaceUp = index === size - 1;
                    hand.push(card);
                }
            }
            state[seat + 'Deck'].push(...cards.slice(next));
        }
        splitShortDrawDeck(state);
        state.phase = 'awaiting_reveal';
        state.roundStarted = false;
        state.revealRevision++;
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

    function canTakeOutside(state, seat, card) {
        if (state.phase !== 'active' || !SEATS.includes(seat) || !card?.isFaceUp || card.flipping) return false;
        if (!isFoundationExposed(state[seat + 'Hand'], card)) return false;
        return SIDES.some(side => canPlayOnPile(card, state[CENTRE_KEYS[side]]));
    }

    function canRestart(state) {
        return state.phase === 'active' && SEATS.every(seat => {
            const hand = state[seat + 'Hand'];
            return !availableMoves(state, seat).length &&
                !planFoundationPreparation(hand, getFoundationBounds(state, seat));
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

    function revealDraw(state, { random = Math.random, force = false, expectedReveal } = {}) {
        if (state.phase !== 'awaiting_reveal' && state.phase !== 'active') return rejected('inactive');
        if (expectedReveal !== undefined && expectedReveal !== state.revealRevision) return rejected('stale_reveal');
        if (state.phase === 'active' && !force && !canRestart(state)) return rejected('moves_available');

        state.revealRevision++;
        splitShortDrawDeck(state);
        let recycled = false;
        const cards = { player: null, ai: null };
        if (!state.playerDeck.length && !state.aiDeck.length) {
            const centre = state.centerPileLeft.concat(state.centerPileRight);
            const canPrepare = SEATS.some(seat => planFoundationPreparation(state[seat + 'Hand'], getFoundationBounds(state, seat)));
            const liveCards = SEATS.flatMap(seat => state[seat + 'Hand'].filter(card => card.isFaceUp));
            const canAdvance = centre.some(card => liveCards.some(live => isAdjacentValue(card.value, live.value)));
            const canSlap = new Set(centre.map(card => card.rank)).size < centre.length;
            if (!centre.length || (!canAdvance && !canSlap && !canPrepare)) {
                // When no restart can change play, preserve the slap and end the unusable round unscored.
                collectRound(state, null, random);
                return { ok: true, cards, redealt: true, recycled: false, matchWinner: state.matchWinner,
                    slapAvailable: false, revealRevision: state.revealRevision };
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
        return { ok: true, cards, recycled, slapAvailable: state.slapActive, revealRevision: state.revealRevision };
    }

    function playFoundation(state, seat, card, side, random = Math.random) {
        if (state.phase !== 'active') return rejected('inactive');
        if (!SEATS.includes(seat)) return rejected('invalid_player');
        if (!SIDES.includes(side)) return rejected('invalid_pile');
        const hand = state[seat + 'Hand'];
        const pile = state[CENTRE_KEYS[side]];
        if (!hand.includes(card)) return rejected('not_in_hand');
        if (!isFoundationExposed(hand, card)) return rejected('covered');
        if (!card.isFaceUp || card.flipping) return rejected('face_down');
        if (!canPlayOnPile(card, pile)) return rejected('not_playable');

        hand.splice(hand.indexOf(card), 1);
        delete card.foundation;
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
        state.revealRevision++;
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
                delete card.foundation;
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
        FOUNDATION_WIDTH,
        FOUNDATION_HEIGHT,
        rankValue,
        createDeck,
        shuffleInPlace,
        isAdjacentValue,
        canPlayOnPile,
        isSlapAvailable,
        countFaceUp,
        getFoundationBounds,
        isValidFoundationBounds,
        isValidFoundationPosition,
        getFoundationPosition,
        getFoundationExposure,
        isFoundationAccessible,
        isFoundationExposed,
        canFlipCard,
        laneSizes,
        splitPot,
        validateCardSet,
        initializeMatch,
        startRound,
        getExposedCards,
        availableMoves,
        canTakeOutside,
        moveFoundation,
        planFoundationPreparation,
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
