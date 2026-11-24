/* One physical pointer may move a Foundation card. Only the rules layer can play it. */
(function (root) {
    'use strict';

    let active = null;
    const attached = new WeakSet();

    function contains(rect, x, y) {
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function overlap(a, b) {
        return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    }

    function dropSide({ x, y, card, foundation, left, right }) {
        if (contains(foundation, x, y)) return null;
        if (contains(left, x, y)) return 'left';
        if (contains(right, x, y)) return 'right';

        const leftArea = overlap(card, left);
        const rightArea = overlap(card, right);
        const minimumContact = (card.right - card.left) * (card.bottom - card.top) / 4;
        if (leftArea === rightArea || Math.max(leftArea, rightArea) < minimumContact) return null;
        return leftArea > rightArea ? 'left' : 'right';
    }

    function attach(img, { canLift, play, onDrag }) {
        if (attached.has(img)) return;
        attached.add(img);
        img.tabIndex = 0;
        img.setAttribute('aria-description', 'Drag onto a centre pile, or press the corresponding left or right arrow key.');

        img.addEventListener('keydown', event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            if (!event.repeat && !active && canLift()) play(event.key === 'ArrowLeft' ? 'left' : 'right');
        });

        img.addEventListener('pointerdown', event => {
            if (!event.isPrimary || event.button !== 0 || active || !canLift()) return;
            const doc = img.ownerDocument;
            const view = doc.defaultView;
            const foundation = img.parentElement;
            const left = doc.getElementById('center-pile-left');
            const right = doc.getElementById('center-pile-right');
            if (!foundation || !left || !right) return;

            event.preventDefault();
            root.GameVisuals?.stopFlip(img);
            const bounds = img.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const id = event.pointerId;
            const listeners = new AbortController();
            const { signal } = listeners;
            const oldVisibility = img.style.visibility;
            let preview = null;
            active = img;

            function report(phase, pointer) {
                onDrag?.({ phase, clientX: pointer.clientX, clientY: pointer.clientY });
            }

            function move(pointer) {
                if (pointer.pointerId !== id) return;
                const dx = pointer.clientX - startX;
                const dy = pointer.clientY - startY;
                if (!preview) {
                    if (Math.hypot(dx, dy) < 5 || !img.isConnected || !canLift()) return;
                    preview = img.cloneNode(false);
                    preview.removeAttribute('id');
                    preview.removeAttribute('tabindex');
                    preview.removeAttribute('data-card-id');
                    preview.setAttribute('aria-hidden', 'true');
                    preview.classList.remove('is-held');
                    preview.classList.add('foundation-drag-preview');
                    Object.assign(preview.style, {
                        position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`,
                        width: `${bounds.width}px`, height: `${bounds.height}px`
                    });
                    doc.body.append(preview);
                    img.style.visibility = 'hidden';
                    report('start', event);
                }
                preview.style.translate = `${dx}px ${dy}px`;
                report('move', pointer);
            }

            function finish(pointer, shouldPlay) {
                if (pointer.pointerId != null && pointer.pointerId !== id) return;
                const hasMoved = Boolean(preview);
                listeners.abort();
                active = null;
                if (img.hasPointerCapture(id)) img.releasePointerCapture(id);
                if (!hasMoved) return;

                const dx = pointer.clientX - startX;
                const dy = pointer.clientY - startY;
                preview.remove();
                img.style.visibility = oldVisibility;
                report('end', pointer);
                if (!shouldPlay || !img.isConnected) return;

                const side = dropSide({
                    x: pointer.clientX, y: pointer.clientY,
                    card: { left: bounds.left + dx, right: bounds.right + dx,
                        top: bounds.top + dy, bottom: bounds.bottom + dy },
                    foundation: foundation.getBoundingClientRect(),
                    left: left.getBoundingClientRect(), right: right.getBoundingClientRect()
                });
                if (side) play(side);
            }

            // Listen above the card so a render update cannot strand the pointer lock.
            view.addEventListener('pointermove', move, { signal });
            view.addEventListener('pointerup', pointer => finish(pointer, true), { signal });
            view.addEventListener('pointercancel', pointer => finish(pointer, false), { signal });
            view.addEventListener('blur', () => finish(event, false), { signal });
            img.addEventListener('lostpointercapture', pointer => finish(pointer, false), { signal });
            img.setPointerCapture(id);
        });
    }

    const api = Object.freeze({ attach, dropSide });
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SlapsDrag = api;
})(globalThis);
