const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function visuals(reduce=false){const ctx={document:{addEventListener(){}},matchMedia:()=>({matches:reduce})};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('gameplay.js','utf8'),ctx);return ctx;}
test('shared card dimensions fit the hand at portrait, landscape, tablet and desktop sizes',()=>{
 const ctx=visuals();for(const [w,h] of [[304,135],[374,216],[752,270],[1008,195],[1350,195],[1904,290],[552,65],[828,88]]){
 const s=ctx.GameVisuals.cardSize(w,h);assert.ok(s.width*5.5<=w+.01);assert.ok(s.height+12+s.step*3<=h+.01);assert.ok(s.width<=130);assert.equal(s.height,s.width*1.45);
 }
});
test('flip is presentation-only, lasts 120ms, can be cancelled, and respects reduced motion',()=>{
 const ctx=visuals();let duration=0,cancels=0;const img={animate(frames,options){duration=options.duration;return{cancel(){cancels++}}}};
 ctx.GameVisuals.flip(img);assert.equal(duration,120);ctx.GameVisuals.stopFlip(img);assert.equal(cancels,1);
 const reduced=visuals(true);reduced.GameVisuals.flip({animate(){throw Error('Reduced motion must not animate')}});
});
for(const file of ['game.js','tournament-game.js','multiplayer-game.js','tournament-online.js'])test(file+': revealing a card does not delay its playable state',()=>{
 const ctx=visuals(),src=fs.readFileSync(file,'utf8');let wired=false;
 ctx.makeDraggable=()=>wired=true;ctx.GameVisuals.flip=()=>{};
 vm.runInContext(src.slice(src.indexOf('function setCardFaceUp('),src.indexOf('function setCardFaceDown(')),ctx);
 const img={setAttribute(){},classList:{remove(){},add(){}},onclick:()=>{}},card={imgSrc:'face.png',rank:'2',suit:'hearts',isFaceUp:false};
 ctx.setCardFaceUp(img,card,'player');assert.equal(card.isFaceUp,true);assert.equal(img.src,'face.png');assert.equal(wired,true);assert.equal(img.onclick,null);
});
for(const file of ['game.js','tournament-game.js'])test(file+': moving bot card freezes its dimensions and retains result timing',()=>{
 const ctx=visuals(),src=fs.readFileSync(file,'utf8');let done=0,timer,delay;
 ctx.document.getElementById=()=>({getBoundingClientRect:()=>({left:400,top:200,width:80,height:116})});
 ctx.requestAnimationFrame=cb=>cb();ctx.setTimeout=(cb,ms)=>{timer=cb;delay=ms;};
 vm.runInContext(src.slice(src.indexOf('function animateAIMove('),src.indexOf('function animateAIMoveToLane(')),ctx);
 const el={style:{left:'5%',top:'4px'},getBoundingClientRect:()=>({left:20,top:50,width:80,height:116})};
 const card={element:el};ctx.animateAIMove(card,'left',()=>done++);
 assert.equal(el.style.width,'80px');assert.equal(el.style.height,'116px');assert.equal(el.style.position,'fixed');assert.equal(done,0);assert.equal(delay,400);timer();assert.equal(done,1);
 ctx.animateSnapBack(card);assert.equal(el.style.width,'');assert.equal(el.style.height,'');assert.equal(el.style.position,'absolute');
});
