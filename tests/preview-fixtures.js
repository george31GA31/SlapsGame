
window.__qaErrors=[];addEventListener('error',e=>window.__qaErrors.push(e.message));
const qaUser={uid:'qa-member',isAnonymous:false,displayName:'Test Player'};
let currentUser=null;
const qaPlayers=Array.from({length:80},(_,i)=>({username:'PLAYER'+i,firstName:'Test',lastName:'Player '+i,elo:1000+i,wins:i,losses:0,flag:'assets/flags/United States of America.png'}));
const qaAuth={get currentUser(){return currentUser},onAuthStateChanged(cb){setTimeout(()=>cb(currentUser),0);return()=>{}},signOut:async()=>{currentUser=null},signInWithEmailAndPassword:async()=>{currentUser=qaUser;return{user:qaUser}}};
const qaSnapshot={exists:()=>true,val:()=>qaPlayers[0],forEach:cb=>qaPlayers.forEach((p,i)=>cb({key:'qa-'+i,val:()=>p}))};
const qaRef={orderByChild(){return this},limitToLast(){return this},on(event,cb){setTimeout(()=>cb(qaSnapshot),0)},once:async()=>qaSnapshot,transaction(){throw Error('Unexpected account write in visual QA')}};
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
