const { test } = require('node:test');
const assert = require('node:assert/strict');
const { attach, dropSide } = require('../foundation-input.js');

const rect = (left, top, width, height) => ({
    left, top, right: left + width, bottom: top + height, width, height
});
const foundation = rect(10, 185, 360, 180);
const left = rect(115, 105, 54, 72);
const right = rect(181, 105, 54, 72);

function event(type, details) {
    return Object.assign(new Event(type, { cancelable: true }), details);
}

function toyCard(doc) {
    const card = new EventTarget();
    const classes = new Set();
    return Object.assign(card, {
        isConnected: true,
        ownerDocument: doc,
        parentElement: { getBoundingClientRect: () => foundation },
        style: { visibility: '' },
        classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
        getBoundingClientRect: () => rect(40, 220, 54, 72),
        setAttribute() {},
        removeAttribute() {},
        cloneNode: () => toyCard(doc),
        setPointerCapture(id) { this.captured = id; },
        hasPointerCapture(id) { return this.captured === id; },
        releasePointerCapture() { this.captured = null; },
        remove() { this.isConnected = false; }
    });
}

function fixture() {
    const previews = [];
    const view = new EventTarget();
    const doc = {
        defaultView: view,
        body: { append: card => previews.push(card) },
        getElementById: id => ({ getBoundingClientRect: () => id.endsWith('left') ? left : right })
    };
    const first = toyCard(doc);
    const second = toyCard(doc);
    const plays = [];
    const phases = [];
    let legal = true;
    const options = { canLift: () => legal, play: side => plays.push(side), onDrag: info => phases.push(info.phase) };
    attach(first, options);
    attach(second, options);
    const down = (card, pointerId, isPrimary = true) => card.dispatchEvent(event('pointerdown', {
        pointerId, isPrimary, button: 0, clientX: 52, clientY: 230, pointerType: 'touch'
    }));
    const update = (type, pointerId, clientX, clientY) => view.dispatchEvent(event(type, {
        pointerId, clientX, clientY, pointerType: 'touch'
    }));
    return { first, second, down, update, plays, phases, previews, allow: value => { legal = value; } };
}

test('drop targets use centre rectangles and can catch a card held by a corner', () => {
    assert.equal(dropSide({ x: 140, y: 125, card: rect(90, 110, 54, 72), foundation, left, right }), 'left');
    assert.equal(dropSide({ x: 177, y: 142, card: rect(175, 132, 54, 72), foundation, left, right }), 'right');
    assert.equal(dropSide({ x: 173, y: 142, card: rect(148, 113, 54, 72), foundation, left, right }), null);
    assert.equal(dropSide({ x: 205, y: 188, card: rect(190, 120, 54, 72), foundation, left, right }), null);
});

test('touch drag may leave Foundation and release on either centre target', () => {
    const f = fixture();
    for (const [id, x] of [[1, 144], [2, 202]]) {
        f.down(f.first, id);
        f.update('pointermove', id, x, 130);
        assert.equal(f.first.style.visibility, 'hidden');
        assert.match(f.previews.at(-1).style.translate, /-100px$/);
        f.update('pointerup', id, x, 130);
        assert.equal(f.first.style.visibility, '');
        assert.equal(f.previews.at(-1).isConnected, false);
    }
    assert.deepEqual(f.plays, ['left', 'right']);
    assert.deepEqual(f.phases, ['start', 'move', 'end', 'start', 'move', 'end']);
});

test('a competing pointer, cancelled gesture and draw-area drop never consume a card', () => {
    const f = fixture();
    f.down(f.first, 1);
    f.down(f.second, 2);
    f.update('pointermove', 1, 135, 130);
    f.update('pointerup', 2, 135, 130);
    assert.equal(f.first.style.visibility, 'hidden');
    f.update('pointercancel', 1, 135, 130);
    assert.equal(f.first.style.visibility, '');
    assert.equal(f.previews.at(-1).isConnected, false);

    f.down(f.second, 3);
    f.update('pointermove', 3, 203, 130);
    f.second.dispatchEvent(event('lostpointercapture', { pointerId: 3, clientX: 203, clientY: 130 }));
    assert.equal(f.second.style.visibility, '');
    f.update('pointerup', 3, 203, 130);

    f.down(f.first, 4);
    f.update('pointermove', 4, 135, 130);
    f.update('pointerup', 4, 75, 248);
    f.down(f.first, 5);
    f.update('pointermove', 5, 202, 130);
    f.update('pointerup', 5, 316, 130);
    assert.deepEqual(f.plays, []);
});

test('unavailable and repeated actions do not take the pointer lock or play', () => {
    const f = fixture();
    f.allow(false);
    f.down(f.first, 1);
    f.update('pointermove', 1, 135, 130);
    f.update('pointerup', 1, 135, 130);
    assert.deepEqual(f.previews, []);

    f.allow(true);
    f.first.dispatchEvent(event('keydown', { key: 'ArrowRight', repeat: true }));
    f.first.dispatchEvent(event('keydown', { key: ' ' }));
    f.first.dispatchEvent(event('keydown', { key: 'ArrowLeft' }));
    assert.deepEqual(f.plays, ['left']);
});
