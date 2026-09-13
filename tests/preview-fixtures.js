
window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));
const qaUser={uid:'qa-member',isAnonymous:false,displayName:'Test Player'};
let currentUser=null;
const qaPlayers=Array.from({length:80},(_,i)=>({username:'PLAYER'+i,firstName:'Test',lastName:'Player '+i,elo:1000+i,wins:i,losses:0,flag:'assets/flags/United States of America.png'}));
const qaAuth={get currentUser(){return currentUser},onAuthStateChanged(cb){setTimeout(()=>cb(currentUser),0);return()=>{}},signOut:async()=>{currentUser=null},signInWithEmailAndPassword:async()=>{currentUser=qaUser;return{user:qaUser}}};
const qaSnapshot={exists:()=>true,val:()=>qaPlayers[0],forEach:cb=>qaPlayers.forEach((p,i)=>cb({key:'qa-'+i,val:()=>p}))};
const qaRef={orderByChild(){return this},limitToLast(){return this},on(event,cb){setTimeout(()=>cb(qaSnapshot),0)},once:async()=>qaSnapshot,transaction(){throw Error('Unexpected account write in visual QA')}};
qaRef.off=()=>{};qaRef.set=async()=>{};
window.firebase={initializeApp(){},auth:()=>qaAuth,database:()=>({ref:()=>qaRef})};
window.Peer=class { constructor(id){this.id=id||'qa-peer'} on(name,cb){if(name==='open')setTimeout(()=>cb(this.id),0)} once(){} destroy(){} connect(){return{open:false,on(){},send(){}}} };
if (/friend-tournament\.html$/.test(location.pathname)) {
    localStorage.setItem('isf_bracket_players', JSON.stringify([
        {name:localStorage.getItem('isf_my_name')||'Guest',id:'QA-ROOM',isHost:true},
        {name:'Opponent 1',id:'qa2'}, {name:'Opponent 2',id:'qa3'}, {name:'Opponent 3',id:'qa4'}
    ]));
    localStorage.setItem('isf_is_host','true');
}
if (/(friend-match|friend-tournament-game|multiplayer-game)\.html$/.test(location.pathname)) {
    localStorage.setItem('isf_role','host');
    localStorage.setItem('isf_code','QA-MATCH');
}
// Two-tab transport for exercising the real online engine without public matchmaking.
if(new URLSearchParams(location.search).has('qaPeer')) {
 const params=new URLSearchParams(location.search), role=params.get('qaPeer');
 localStorage.setItem('isf_role',role);localStorage.setItem('isf_code','QA-LAYOUT');
 localStorage.setItem('isf_is_guest','true');localStorage.setItem('isf_my_name','Guest-'+role);
 const channel=new BroadcastChannel('slaps-layout-qa');
 window.Peer=class {
  constructor(id){this.id=id||'qa-join';this.events={};this.conn=null;channel.onmessage=e=>this.receive(e.data);setTimeout(()=>this.events.open?.(this.id),20);}
  on(n,fn){this.events[n]=fn;} once(n,fn){this.on(n,fn);} destroy(){channel.close();}
  connection(){return {open:true,events:{},on(n,fn){this.events[n]=fn;},send(msg){channel.postMessage({kind:'data',msg});},close(){channel.postMessage({kind:'close'});}};}
  connect(){this.conn=this.connection();channel.postMessage({kind:'connect'});return this.conn;}
  receive(m){if(m.kind==='connect'){this.conn=this.connection();this.events.connection?.(this.conn);channel.postMessage({kind:'accept'});setTimeout(()=>this.conn.events.open?.(),20);}else if(m.kind==='accept'){this.conn.events.open?.();}else if(m.kind==='data'){this.conn?.events.data?.(m.msg);}else if(m.kind==='close'){this.conn?.events.close?.();}}
 };
}
if(new URLSearchParams(location.search).has('qaMember')) {
 currentUser=qaUser;qaUser.email='test@example.invalid';qaUser.updateProfile=async()=>{};
 qaUser.verifyBeforeUpdateEmail=async()=>{};qaAuth.sendPasswordResetEmail=async()=>{};
 localStorage.setItem('isf_is_guest','false');
 qaRef.update=async patch=>Object.assign(qaPlayers[0],patch);
 qaPlayers[0].country='GBR';
}

// Observe actual moving cards without altering game state (isolated preview only).
document.addEventListener('DOMContentLoaded',()=>{
 if(!document.body.classList.contains('game-body'))return;
 const sample=()=>{
  for(const card of document.querySelectorAll('.game-card'))if(card.style.position==='fixed'){
   const expected=parseFloat(getComputedStyle(document.body).getPropertyValue('--card-width'));
   document.body.dataset.qaMovingSamples=Number(document.body.dataset.qaMovingSamples||0)+1;
   document.body.dataset.qaMaxMovingRatio=Math.max(Number(document.body.dataset.qaMaxMovingRatio||0),card.offsetWidth/expected);
  }
  requestAnimationFrame(sample);
 };requestAnimationFrame(sample);
});
