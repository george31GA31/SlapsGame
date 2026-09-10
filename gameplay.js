/* Gameplay presentation only: no timers or game-state transitions depend on animation. */
window.GameVisuals = {
    animations: new WeakMap(),
    stopFlip(img) { this.animations.get(img)?.cancel(); this.animations.delete(img); },
    flip(img) {
        if (!img.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        this.stopFlip(img);
        const animation=img.animate([{scale:'0.08 1'}, {scale:'1 1'}], {duration:120, easing:'ease-out'});
        this.animations.set(img,animation);
    },
    cardSize(width, height) {
        const step = Math.min(5, Math.max(2, height / 45));
        const w = Math.max(1, Math.min(130, width / 5.5, (height - 12 - step * 3) / 1.45));
        return {width:w, height:w * 1.45, step};
    }
};
document.addEventListener('DOMContentLoaded', () => {
    const body=document.body, board=document.querySelector('.game-board');
    if(!board)return;
    const header=document.createElement('header');header.className='match-header';
    for(const selector of ['.ui-widget-left','.scoreboard-widget','.ui-widget-right']) {
        const el=document.querySelector(selector);if(el)header.append(el);
    }
    const footer=document.createElement('footer');footer.className='match-footer';
    const controls=document.querySelector('.bottom-left-actions');if(controls)footer.append(controls);
    body.prepend(header);body.append(footer);
    const arrangeChrome=()=>{
        const timer=document.querySelector('.timer-display');if(timer && timer.parentElement!==footer)footer.append(timer);
    };
    new MutationObserver(arrangeChrome).observe(body,{childList:true});arrangeChrome();
    const resize=()=>{
        const area=document.getElementById('player-foundation-area');
        const middle=document.querySelector('.center-zone');
        const size=GameVisuals.cardSize(area.clientWidth,Math.min(area.clientHeight,middle.clientHeight));
        body.style.setProperty('--card-width',size.width+'px');
        body.style.setProperty('--card-height',size.height+'px');
        body.style.setProperty('--stack-step',size.step+'px');
        // Rebound previously repositioned cards after rotation/window resizing.
        if(typeof gameState!=='undefined')for(const card of [...gameState.playerHand,...gameState.aiHand]) {
            if(!card.element || card.element.style.position==='fixed')continue;
            if(card.layout && !card.isFaceUp)CardLayout.place(card,card.layout.x,card.layout.y);
            else if(card.element.style.top.endsWith('px')) {
                card.element.style.left=Math.max(0,Math.min(card.element.offsetLeft,area.clientWidth-size.width))+'px';
                card.element.style.top=Math.max(0,Math.min(card.element.offsetTop,area.clientHeight-size.height))+'px';
            }
        }
    };
    new ResizeObserver(resize).observe(board);resize();
});
