/* Foundation geometry is authoritative in SlapsEngine. This module projects it and handles pointer input. */
(function (root) {
    'use strict';

    const CARD_RATIO = 1.45;
    const DRAG_THRESHOLD = 5;
    const attached = new WeakSet();
    const mats = new WeakMap();
    let active = null;

    function defaultBounds() {
        return { width: root.SlapsEngine?.FOUNDATION_WIDTH ?? 6.4, height: root.SlapsEngine?.FOUNDATION_HEIGHT ?? 2.15 };
    }

    function measure(foundation) {
        const width = foundation?.clientWidth;
        const height = foundation?.clientHeight;
        if (!(width > 0 && height > 0)) return defaultBounds();
        const cardWidth = Math.min(width / 6.4, height / (1.5 * CARD_RATIO), 130);
        return { width: Math.min(24, width / cardWidth), height: Math.min(6, height / (cardWidth * CARD_RATIO)) };
    }

    function project(foundation, bounds) {
        const box = foundation.getBoundingClientRect();
        const width = foundation.clientWidth || box.width;
        const height = foundation.clientHeight || box.height;
        const cardWidth = Math.min(width / bounds.width, height / (bounds.height * CARD_RATIO));
        const cardHeight = cardWidth * CARD_RATIO;
        const matWidth = cardWidth * bounds.width;
        const matHeight = cardHeight * bounds.height;
        const x = (width - matWidth) / 2;
        const y = (height - matHeight) / 2;
        const left = box.left + (foundation.clientLeft || 0) + x;
        const top = box.top + (foundation.clientTop || 0) + y;
        return { x, y, matWidth, matHeight, cardWidth, cardHeight, left, top, right: left + matWidth, bottom: top + matHeight };
    }

    function render(foundation, hand, positionFor, options = {}) {
        if (!foundation) return;
        let mat = mats.get(foundation);
        if (!mat) {
            mat = {};
            mats.set(foundation, mat);
            if (root.ResizeObserver) {
                const observer = new root.ResizeObserver(() => {
                    if (active?.foundation === foundation) cancel();
                    paintMat(foundation, mat);
                });
                observer.observe(foundation);
            }
        }
        Object.assign(mat, { hand, positionFor, bounds: options.bounds ?? defaultBounds(), mirrored: options.mirrored === true });
        paintMat(foundation, mat, options.animateCard);
    }

    function paintMat(foundation, mat, animateCard) {
        const surface = project(foundation, mat.bounds);
        if (!(surface.cardWidth > 0)) return;
        if (foundation.dataset) foundation.dataset.spatialFoundation = 'true';
        for (const [name, value] of Object.entries({
            left: surface.x, top: surface.y, width: surface.matWidth, height: surface.matHeight
        })) foundation.style?.setProperty?.(`--foundation-mat-${name}`, `${value}px`);

        const positioned = mat.hand.map(card => ({ card, position: mat.positionFor(card) }))
            .filter(({ card, position }) => card.element && position)
            .sort((a, b) => a.position.z - b.position.z);
        positioned.forEach(({ card, position }, index) => {
            const el = card.element;
            if (el.style.position === 'fixed') return;
            const x = mat.mirrored ? mat.bounds.width - 1 - position.x : position.x;
            const y = mat.mirrored ? mat.bounds.height - 1 - position.y : position.y;
            const left = surface.x + x * surface.cardWidth;
            const top = surface.y + y * surface.cardHeight;
            const dx = parseFloat(el.style.left) - left;
            const dy = parseFloat(el.style.top) - top;
            Object.assign(el.style, {
                left: `${left}px`, top: `${top}px`, zIndex: String(index + 10),
                width: `${surface.cardWidth}px`, height: `${surface.cardHeight}px`
            });
            if ((animateCard === card || animateCard === card.id) && animateCard != null && Number.isFinite(dx + dy) &&
                (dx || dy) && el.animate && !root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], { duration: 105, easing: 'ease-out' });
            }
        });
    }

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

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function cancel() {
        active?.finish(false);
    }

    function recheck() {
        active?.update();
    }

    function attach(img, { canMove, canLeave, move, reveal, play, onDrag }) {
        if (attached.has(img)) return;
        attached.add(img);
        img.setAttribute('aria-description', 'Drag to arrange. Press Enter to reveal, or Left or Right Arrow to play.');

        img.addEventListener('keydown', event => {
            if (!['Enter', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            if (event.repeat || active) return;
            if (event.key === 'Enter') {
                if (canMove()) reveal?.();
            } else if (canLeave()) play(event.key === 'ArrowLeft' ? 'left' : 'right');
        });

        img.addEventListener('pointerdown', event => {
            if (!event.isPrimary || event.button !== 0 || active || !canMove()) return;
            const doc = img.ownerDocument;
            const view = doc.defaultView;
            const foundation = img.parentElement;
            const left = doc.getElementById('center-pile-left');
            const right = doc.getElementById('center-pile-right');
            if (!foundation || !left || !right) return;

            const mat = mats.get(foundation);
            const bounds = mat?.bounds ?? defaultBounds();
            const surface = project(foundation, bounds);
            if (!(surface.cardWidth > 0)) return;
            event.preventDefault();
            root.GameVisuals?.stopFlip(img);

            const source = img.getBoundingClientRect();
            const shiftX = event.clientX - source.left;
            const shiftY = event.clientY - source.top;
            const id = event.pointerId;
            const listeners = new AbortController();
            const { signal } = listeners;
            const oldVisibility = img.style.visibility;
            let pointer = event;
            let preview = null;

            function report(phase, x = pointer.clientX, y = pointer.clientY) {
                onDrag?.({ phase, clientX: x, clientY: y });
            }

            function placement() {
                const rawX = pointer.clientX - shiftX;
                const rawY = pointer.clientY - shiftY;
                const x = clamp(rawX, surface.left, surface.right - surface.cardWidth);
                const y = clamp(rawY, surface.top, surface.bottom - surface.cardHeight);
                return { x, y, rawX, rawY };
            }

            function update() {
                if (!preview) return;
                const { x, y, rawX, rawY } = placement();
                const outsideAllowed = canLeave();
                const left = outsideAllowed ? rawX : x;
                const top = outsideAllowed ? rawY : y;
                preview.style.translate = `${left - source.left}px ${top - source.top}px`;
                report('move', left + shiftX, top + shiftY);
            }

            function follow(next) {
                if (next.pointerId !== id) return;
                pointer = next;
                if (!preview) {
                    if (Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < DRAG_THRESHOLD ||
                        !img.isConnected || !canMove()) return;
                    preview = img.cloneNode(false);
                    for (const name of ['id', 'tabindex', 'data-card-id', 'data-covered', 'data-accessible']) preview.removeAttribute(name);
                    preview.setAttribute('aria-hidden', 'true');
                    preview.classList.remove('is-held');
                    preview.classList.add('foundation-drag-preview');
                    Object.assign(preview.style, {
                        position: 'fixed', left: `${source.left}px`, top: `${source.top}px`,
                        width: `${surface.cardWidth}px`, height: `${surface.cardHeight}px`
                    });
                    doc.body.append(preview);
                    img.style.visibility = 'hidden';
                    report('start', event.clientX, event.clientY);
                }
                update();
            }

            function finish(commit) {
                listeners.abort();
                active = null;
                if (img.hasPointerCapture(id)) img.releasePointerCapture(id);
                if (!preview) {
                    if (commit && img.isConnected && contains(source, pointer.clientX, pointer.clientY) && canMove()) reveal?.();
                    return;
                }

                preview.remove();
                img.style.visibility = oldVisibility;
                report('end');
                if (!commit || !img.isConnected || !canMove()) return;

                const { x, y, rawX, rawY } = placement();
                if (contains(surface, pointer.clientX, pointer.clientY)) {
                    const localX = clamp((x - surface.left) / surface.cardWidth, 0, bounds.width - 1);
                    const localY = clamp((y - surface.top) / surface.cardHeight, 0, bounds.height - 1);
                    move?.({ x: localX, y: localY });
                    return;
                }
                if (!canLeave()) return;
                const side = dropSide({
                    x: pointer.clientX, y: pointer.clientY, foundation: surface,
                    card: { left: rawX, right: rawX + surface.cardWidth, top: rawY, bottom: rawY + surface.cardHeight },
                    left: left.getBoundingClientRect(), right: right.getBoundingClientRect()
                });
                if (side) play(side);
            }

            active = { foundation, finish, update };
            view.addEventListener('pointermove', follow, { signal });
            view.addEventListener('pointerup', next => {
                if (next.pointerId !== id) return;
                follow(next);
                finish(true);
            }, { signal });
            view.addEventListener('pointercancel', next => { if (next.pointerId === id) finish(false); }, { signal });
            view.addEventListener('blur', cancel, { signal });
            view.addEventListener('keydown', key => { if (key.key === 'Escape') cancel(); }, { signal });
            img.addEventListener('lostpointercapture', next => { if (next.pointerId === id) finish(false); }, { signal });
            img.setPointerCapture(id);
        });
    }

    const api = Object.freeze({ attach, cancel, dropSide, measure, recheck, render });
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SlapsDrag = api;
})(globalThis);
