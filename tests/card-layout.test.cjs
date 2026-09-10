const test=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
function fixture(){
 const events={},box={clientWidth:500,clientHeight:250,getBoundingClientRect:()=>({left:0,top:0})};
 const el={style:{},offsetWidth:60,offsetHeight:90,offsetLeft:0,offsetTop:0,parentElement:box,isConnected:true,
 getBoundingClientRect:()=>({left:0,top:0}),setAttribute(){},setPointerCapture(){},hasPointerCapture(){return false},
 addEventListener(n,f){(events[n]||=[]).push(f)},removeEventListener(n,f){events[n]=events[n].filter(x=>x!==f)},click(){}};
 const ctx={window:{addEventListener(){}},document:{getElementById:()=>box},ResizeObserver:class{observe(){}disconnect(){}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('card-layout.js','utf8'),ctx);
 const fire=(n,e)=>[...(events[n]||[])].forEach(f=>f({button:0,stopPropagation(){},preventDefault(){},stopImmediatePropagation(){},...e}));
 return {api:ctx.window.CardLayout,el,fire};
}
test('drag clamps a hidden card inside its own area, suppresses flip click and sends no face data',()=>{
 const f=fixture(),card={id:'opaque-id',isFaceUp:false,rank:'ACE',element:f.el},sent=[];
 f.api.attach(f.el,card,m=>sent.push(m));
 f.fire('pointerdown',{clientX:5,clientY:5,pointerId:1});f.fire('pointermove',{clientX:1000,clientY:-100});f.fire('pointerup',{});
 assert.equal(f.el.style.left,'440px');assert.equal(f.el.style.top,'0px');assert.equal(card.isFaceUp,false);
 assert.deepEqual(Object.keys(sent[0]).sort(),['id','x','y']);assert.equal(sent[0].x,1);assert.equal(sent[0].y,0);
 let suppressed=false;f.fire('click',{stopImmediatePropagation(){suppressed=true}});assert.equal(suppressed,true);
});
test('opponent receives a mirrored position, rejecting missing, face-up and malformed cards',()=>{
 const f=fixture(),card={id:'opaque-id',isFaceUp:false,element:f.el};
 assert.equal(f.api.receive({id:card.id,x:.25,y:.75},[card]),true);
 assert.equal(f.el.style.left,'330px');assert.equal(f.el.style.top,'40px');assert.equal(card.isFaceUp,false);
 assert.equal(f.api.receive({id:'other',x:.2,y:.2},[card]),false);
 assert.equal(f.api.receive({id:card.id,x:NaN,y:.2},[card]),false);
 card.isFaceUp=true;assert.equal(f.api.receive({id:card.id,x:.2,y:.2},[card]),false);
});
test('tapping does not rearrange or suppress the normal rule-controlled flip',()=>{
 const f=fixture(),card={id:'id',isFaceUp:false,element:f.el};let sent=0,suppressed=false;
 f.api.attach(f.el,card,()=>sent++);f.fire('pointerdown',{clientX:5,clientY:5,pointerId:1});f.fire('pointerup',{});
 f.fire('click',{stopImmediatePropagation(){suppressed=true}});assert.equal(sent,0);assert.equal(suppressed,false);
});
test('face-up cards bypass layout gestures and retain existing play controls',()=>{
 const f=fixture(),card={id:'id',isFaceUp:true,element:f.el};let sent=0;
 f.api.attach(f.el,card,()=>sent++);f.fire('pointerdown',{clientX:5,clientY:5,pointerId:1});f.fire('pointermove',{clientX:100,clientY:100});assert.equal(sent,0);assert.equal(card.layout,undefined);
});
