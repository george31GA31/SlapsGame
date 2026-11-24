const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function visuals(reduce=false){const ctx={document:{addEventListener(){}},matchMedia:()=>({matches:reduce})};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('gameplay.js','utf8'),ctx);return ctx;}
test('shared card dimensions fit the hand at portrait, landscape, tablet and desktop sizes',()=>{
 const ctx=visuals();for(const [w,h] of [[304,135],[374,216],[752,270],[1008,195],[1350,195],[1904,290],[552,65],[828,88]]){
 const s=ctx.GameVisuals.cardSize(w,h);assert.ok(s.width*5.5<=w+.01);assert.ok(s.height+12+s.step*3<=h+.01);assert.ok(s.width<=130);assert.equal(s.height,s.width*1.45);
 }
});
test('3D flip uses two backface-hidden faces for 160ms and cleans up on interruption',()=>{
 const ctx=visuals();let cancels=0,removed=0;const calls=[];
 const animate=(frames,options)=>{calls.push({frames,options});return{cancel(){cancels++},addEventListener(){}}};
 const attributes=new Map([['id','card'],['tabindex','0'],['data-card-id','card-id'],['data-covered','false'],['data-lane','0']]);
 const classes=new Set(['game-card','player-card','opponent-card','is-held']);
 const back={style:{},classList:{remove(...names){names.forEach(name=>classes.delete(name));},add(name){classes.add(name);}},removeAttribute(name){attributes.delete(name);},setAttribute(name,value){attributes.set(name,value);},animate,remove(){removed++}};
 const img={style:{zIndex:'12'},parentElement:{},cloneNode(){return back},after(){},animate};
 ctx.GameVisuals.flip(img,'back.png');assert.equal(calls.length,2);assert.equal(back.src,'back.png');
 assert.deepEqual([...attributes],[['aria-hidden','true']]);
 assert.deepEqual([...classes],['game-card','foundation-flip-preview']);
 assert.equal(back.style.pointerEvents,'none');
 assert.ok(calls.every(c=>c.options.duration===160&&c.frames.every(f=>f.backfaceVisibility==='hidden')));
 assert.match(calls[0].frames[0].transform,/-180deg/);assert.match(calls[1].frames[1].transform,/180deg/);
 ctx.GameVisuals.stopFlip(img);assert.equal(cancels,2);assert.equal(removed,1);
 const reduced=visuals(true);reduced.GameVisuals.flip({animate(){throw Error('Reduced motion must not animate')}},'back.png');
});
// Solo practice and tournament run the same controller and are exercised
// together through their actual script load sequence in solo-gameplay.test.cjs.
for(const file of ['multiplayer-game.js','tournament-online.js'])test(file+': revealing a card does not delay its playable state',()=>{
 const ctx=visuals(),src=fs.readFileSync(file,'utf8');let wired=false;
 ctx.makeDraggable=()=>wired=true;ctx.GameVisuals.flip=()=>{};
 vm.runInContext(src.slice(src.indexOf('function setCardFaceUp('),src.indexOf('function setCardFaceDown(')),ctx);
 const img={setAttribute(){},classList:{remove(){},add(){}},onclick:()=>{}},card={imgSrc:'face.png',rank:'2',suit:'hearts',isFaceUp:false};
 ctx.setCardFaceUp(img,card,'player');assert.equal(card.isFaceUp,true);assert.equal(img.src,'face.png');assert.equal(wired,true);assert.equal(img.onclick,null);
});
for(const file of ['multiplayer-game.js','tournament-online.js'])test(file+': draw reveal animation receives a back face without delaying play',()=>{
 const src=fs.readFileSync(file,'utf8'),name='applyRevealShow';
 const start=src.indexOf('function '+name+'('),end=src.indexOf('\nfunction ',start+10);let flipped=false;
 const img={style:{},classList:{remove(){}}};const ctx={performance:{now:()=>0},document:{querySelectorAll:()=>[img],getElementById:()=>({classList:{remove(){}}})},gameState:{aiLoopRunning:true},GameVisuals:{flip:(image,back)=>{assert.equal(back,'back.png');flipped=true;}},SlapsDrag:{recheck(){}},CARD_BACK_SRC:'back.png',checkSlapCondition(){},startAILoop(){},startVisualTimer(){},setTimeout(){},clearInterval(){}};
 vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);ctx[name]();assert.equal(flipped,true);assert.equal(ctx.gameState.gameActive,true);
});
