/* Shared gameplay presentation. It never decides rules, scores or legal moves. */
window.GameVisuals = {
    animations: new WeakMap(),
    stopFlip(img) {
        this.animations.get(img)?.cancel();
        this.animations.delete(img);
    },
    flip(img, previousFace) {
        if (!img?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        this.stopFlip(img);
        // Two faces share one rotation; rules become playable immediately.
        // A presentation overlay hides the new face only until the edge-on midpoint.
        if (!previousFace || !img.parentElement) return;
        const back = img.cloneNode(false);
        back.removeAttribute('id'); back.removeAttribute('tabindex');
        back.src = previousFace;
        back.setAttribute('aria-hidden', 'true');
        back.style.pointerEvents = 'none';
        back.style.zIndex = String((Number(img.style.zIndex) || 10) + 1);
        img.after(back);
        const base = (typeof getComputedStyle === 'function' ? getComputedStyle(img).transform : '') || '';
        const prefix = base === 'none' ? '' : base;
        const timing = {duration:160, easing:'cubic-bezier(.3,.15,.25,1)'};
        const frontAnimation = img.animate([
            {transform:prefix + ' perspective(700px) rotateY(-180deg)', backfaceVisibility:'hidden'},
            {transform:prefix + ' perspective(700px) rotateY(0deg)', backfaceVisibility:'hidden'}
        ], timing);
        const backAnimation = back.animate([
            {transform:prefix + ' perspective(700px) rotateY(0deg)', backfaceVisibility:'hidden'},
            {transform:prefix + ' perspective(700px) rotateY(180deg)', backfaceVisibility:'hidden'}
        ], timing);
        const cancel = () => {frontAnimation.cancel(); backAnimation.cancel(); back.remove();};
        this.animations.set(img, {cancel});
        frontAnimation.addEventListener('finish', () => {back.remove(); this.animations.delete(img);}, {once:true});
    },
    land(img) {
        if (!img?.animate || img.classList.contains('pending-reveal') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        img.animate([
            {translate:'0 -6px', scale:'.985', opacity:.9},
            {translate:'0 0', scale:'1', opacity:1}
        ], {duration:135, easing:'cubic-bezier(.22,.82,.28,1)'});
    },
    cardSize(width, height) {
        const step = Math.min(5, Math.max(2, height / 45));
        const w = Math.max(1, Math.min(130, width / 6.35, (height - 12 - step * 3) / 1.45));
        return {width:w, height:w * 1.45, step};
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    const board = document.querySelector('.game-board');
    if (!board) return;

    const header = document.createElement('header');
    header.className = 'match-header';
    for (const selector of ['.ui-widget-left','.scoreboard-widget','.ui-widget-right']) {
        const el = document.querySelector(selector);
        if (el) header.append(el);
    }

    const footer = document.createElement('footer');
    footer.className = 'match-footer';
    const controls = document.querySelector('.bottom-left-actions');
    if (controls) footer.append(controls);
    body.prepend(header);
    body.append(footer);

    const opponentArea = document.getElementById('ai-foundation-area');
    const playerArea = document.getElementById('player-foundation-area');
    if (opponentArea) opponentArea.dataset.zoneLabel = 'OPPONENT FOUNDATION';
    if (playerArea) playerArea.dataset.zoneLabel = 'YOUR FOUNDATION';

    const center = document.querySelector('.center-zone');
    const deckWrappers = center ? [...center.querySelectorAll('.deck-wrapper')] : [];
    const makeSlapSlot = who => {
        const slot = document.createElement('div');
        slot.className = `slap-stack-slot slap-stack-${who}`;
        slot.dataset.who = who;
        slot.setAttribute('aria-hidden','true');
        return slot;
    };
    let aiSlapSlot = null;
    let playerSlapSlot = null;
    if (center && deckWrappers.length >= 2 && !center.querySelector('.slap-stack-slot')) {
        aiSlapSlot = makeSlapSlot('ai');
        playerSlapSlot = makeSlapSlot('player');
        deckWrappers[0].after(aiSlapSlot);
        deckWrappers[1].before(playerSlapSlot);
    } else {
        aiSlapSlot = center?.querySelector('.slap-stack-ai') || null;
        playerSlapSlot = center?.querySelector('.slap-stack-player') || null;
    }

    const renderSlapStack = (slot, value) => {
        if (!slot) return;
        const count = Math.max(0, Number.parseInt(value, 10) || 0);
        slot.replaceChildren();
        const visible = Math.min(count, 4);
        for (let i = 0; i < visible; i++) {
            const card = document.createElement('span');
            card.className = 'slap-card-mini';
            card.style.setProperty('--slap-index', String(i));
            slot.append(card);
        }
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'slap-stack-count';
            badge.textContent = String(count);
            slot.append(badge);
        }
    };

    const updateHoldingPiles = () => {
        if (typeof gameState === 'undefined') return;
        renderSlapStack(aiSlapSlot, gameState.aiSlapCards || 0);
        renderSlapStack(playerSlapSlot, gameState.playerSlapCards || 0);
    };
    document.addEventListener('slap-piles-changed', updateHoldingPiles);
    updateHoldingPiles();

    for (const pile of document.querySelectorAll('.center-pile')) {
        pile.tabIndex = 0;
        pile.setAttribute('role', 'button');
        pile.setAttribute('aria-label', 'Attempt slap: tap when the two centre ranks match');
        const slap = event => {
            if (event.type === 'pointerdown' && (!event.isPrimary || event.button !== 0)) return;
            event.preventDefault();
            if (typeof handleInput === 'function') handleInput({code:'Space', repeat:false, preventDefault(){}});
        };
        pile.addEventListener('pointerdown', slap);
        pile.addEventListener('keydown', event => {
            if (event.code === 'Enter') slap(event);
        });
    }

    const arrangeChrome = () => {
        const timer = document.querySelector('.timer-display');
        if (timer && timer.parentElement !== footer) footer.append(timer);
        const status = document.querySelector('.session-status');
        if (status && status.parentElement !== body) body.append(status);
    };
    new MutationObserver(arrangeChrome).observe(body, {childList:true});
    arrangeChrome();

    const clearHeld = () => document.querySelectorAll('.game-card.is-held').forEach(card => card.classList.remove('is-held'));
    body.addEventListener('pointerdown', event => {
        const card = event.target.closest?.('.player-card');
        if (card) {
            clearHeld();
            card.classList.add('is-held');
        }
    }, {passive:true});
    addEventListener('pointerup', clearHeld, {passive:true});
    addEventListener('pointercancel', clearHeld, {passive:true});
    addEventListener('blur', clearHeld);

    const cardObserver = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches('.game-card')) GameVisuals.land(node);
                node.querySelectorAll?.('.game-card').forEach(card => GameVisuals.land(card));
            }
        }
    });
    cardObserver.observe(board, {childList:true, subtree:true});

    const resize = () => {
        const area = document.getElementById('player-foundation-area');
        const middle = document.querySelector('.center-zone');
        if (!area || !middle) return;
        const size = GameVisuals.cardSize(area.clientWidth, Math.min(area.clientHeight, middle.clientHeight));
        body.style.setProperty('--card-width', size.width + 'px');
        body.style.setProperty('--card-height', size.height + 'px');
        body.style.setProperty('--stack-step', size.step + 'px');

        /* Rebound previously repositioned cards after rotation/window resizing. */
        if (typeof gameState !== 'undefined') {
            for (const card of [...gameState.playerHand, ...gameState.aiHand]) {
                if (!card.element || card.element.style.position === 'fixed') continue;
                if (card.layout && !card.isFaceUp && typeof CardLayout !== 'undefined') {
                    CardLayout.place(card, card.layout.x, card.layout.y);
                } else if (card.element.style.top.endsWith('px')) {
                    const parent = card.element.parentElement || area;
                    card.element.style.left = Math.max(0, Math.min(card.element.offsetLeft, parent.clientWidth - size.width)) + 'px';
                    card.element.style.top = Math.max(0, Math.min(card.element.offsetTop, parent.clientHeight - size.height)) + 'px';
                }
            }
        }
    };

    new ResizeObserver(resize).observe(board);
    resize();
});
