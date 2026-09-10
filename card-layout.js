/* Layout-only gestures never invoke play/flip logic or transmit card faces. */
window.CardLayout = (() => {
    let layer = 100;
    function lift(card) { card.layoutZ = typeof gameState !== "undefined" ? ++gameState.globalZ : ++layer; }
    const clamp = n => Math.max(0, Math.min(1, n));
    function place(card, x, y, z = card.layoutZ || 20) {
        card.layout = {x: clamp(x), y: clamp(y)};
        const el = card.element;
        if (!el) return;
        const box = el.parentElement;
        if (!box) return;
        el.style.left = `${card.layout.x * Math.max(0, box.clientWidth - el.offsetWidth)}px`;
        el.style.top = `${card.layout.y * Math.max(0, box.clientHeight - el.offsetHeight)}px`;
        el.style.zIndex = String(z);
    }
    function receive(message, hand) {
        if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return false;
        const card = hand.find(c => c.id === message.id);
        if (!card || card.isFaceUp || !card.element) return false;
        lift(card);
        place(card, 1 - clamp(message.x), 1 - clamp(message.y));
        return true;
    }
    function attach(el, card, send) {
        let moved = false;
        el.tabIndex = 0;
        el.setAttribute('aria-label', 'Face-down card. Drag or use arrow keys to reposition; tap or Enter to flip when permitted.');
        el.style.touchAction = 'none';
        el.addEventListener('click', e => {
            if (moved) {e.preventDefault(); e.stopImmediatePropagation(); moved = false;}
        }, true);
        const publish = () => {if(send && card.id) send({id:card.id, ...card.layout});};
        el.addEventListener('pointerdown', e => {
            if (card.isFaceUp || card.flipping || e.button !== 0) return;
            e.stopPropagation();
            moved = false;
            const start = {x:e.clientX, y:e.clientY};
            const bounds = el.getBoundingClientRect();
            const shift = {x:e.clientX-bounds.left, y:e.clientY-bounds.top};
            el.setPointerCapture(e.pointerId);
            const move = ev => {
                if (card.isFaceUp || card.flipping) return;
                if (!moved && Math.hypot(ev.clientX-start.x, ev.clientY-start.y) < 6) return;
                if (!moved) lift(card);
                moved = true;
                const box = el.parentElement, rect = box.getBoundingClientRect();
                place(card, (ev.clientX-rect.left-shift.x)/Math.max(1,box.clientWidth-el.offsetWidth),
                    (ev.clientY-rect.top-shift.y)/Math.max(1,box.clientHeight-el.offsetHeight));
                publish();
            };
            const end = () => {
                el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);
                if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);
                if(moved)publish();
            };
            el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
        });
        el.addEventListener('keydown', e => {
            if(card.isFaceUp || card.flipping)return;
            if(e.key==='Enter') {e.preventDefault();moved=false;el.click();return;}
            if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
            e.preventDefault();
            const box=el.parentElement;
            const current=card.layout || {x:el.offsetLeft/Math.max(1,box.clientWidth-el.offsetWidth),y:el.offsetTop/Math.max(1,box.clientHeight-el.offsetHeight)};
            lift(card);
            place(card,current.x+(e.key==='ArrowRight'?.05:e.key==='ArrowLeft'?-.05:0),current.y+(e.key==='ArrowDown'?.05:e.key==='ArrowUp'?-.05:0));publish();
        });
        // Preserve normalised positions when rotating a phone or resizing a window.
        const observer = new ResizeObserver(() => {if(card.layout && !card.isFaceUp)place(card,card.layout.x,card.layout.y);if(!el.isConnected)observer.disconnect();});
        observer.observe(el);
        observer.observe(document.getElementById('player-foundation-area'));
    }
    window.addEventListener('resize', () => {
        // Opponent cards have no gesture handlers; still retain their mirrored positions.
        if(typeof gameState!=='undefined') for(const c of gameState.aiHand || [])if(c.layout && !c.isFaceUp)place(c,c.layout.x,c.layout.y);
    });
    return {attach, receive, place};
})();
