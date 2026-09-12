// Run against the local RTDB emulator only; requires @firebase/rules-unit-testing.
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const fs=require('node:fs'),assert=require('node:assert/strict');
const {reduce,standings}=require('../functions/competition.cjs');
(async()=>{
 const deadline=setTimeout(()=>{console.error('Emulator checks timed out');process.exit(1);},60000);
 const env=await initializeTestEnvironment({projectId:'demo-slaps',database:{host:'127.0.0.1',port:9000,rules:fs.readFileSync('database.rules.free-plan.json','utf8')}});
 try{
  const user=uid=>env.authenticatedContext(uid,{firebase:{sign_in_provider:'password'}}).database();
  const a=user('a'),b=user('b'),outsider=user('outsider'),anon=env.unauthenticatedContext().database();
  await assertSucceeds(a.ref('users/a').set({username:'Alice',email:'private@example.invalid'}));
  await assertFails(b.ref('users/a').once('value'));await assertFails(b.ref('users/a').set({username:'Injected'}));
  await assertFails(anon.ref('users').once('value'));
  const card=require('../public-player.js').fromPrivate({username:'Alice',elo:1200});
  await assertSucceeds(a.ref('publicPlayers/a').set(card));await assertSucceeds(anon.ref('publicPlayers').once('value'));
  await assertFails(b.ref('publicPlayers/a').set(card));await assertFails(a.ref('publicPlayers/a').update({email:'leak'}));
  async function act(db,uid,code,action){
   const ref=db.ref('casualCompetitions/'+code);let error,listener;
   await new Promise((resolve,reject)=>{listener=()=>resolve();ref.on('value',listener,reject);});
   const r=await ref.transaction(current=>{try{return reduce(current,uid,uid,action,Date.now());}catch(e){error=e;return;}},undefined,false);
   ref.off('value',listener);if(!r.committed)throw error||Error('Transaction aborted');return r.snapshot.val();
  }
  const code='ABCDEF123456';
  await act(a,'a',code,{type:'create',mode:'league'});
  await act(b,'b',code,{type:'join'});
  await Promise.all([act(a,'a',code,{type:'ready',ready:true}),act(b,'b',code,{type:'ready',ready:true})]);
  let room=await act(a,'a',code,{type:'start'});assert.equal(room.playerCount,2);
  await assertFails(anon.ref('casualCompetitions/'+code).once('value'));await assertFails(a.ref('casualCompetitions').once('value'));
  await assertFails(outsider.ref('casualCompetitions/'+code).set({...room,version:999}));
  await Promise.all([act(a,'a',code,{type:'enter',matchId:'L0-0'}),act(b,'b',code,{type:'enter',matchId:'L0-0'})]);
  const result={type:'result',matchId:'L0-0',winner:'a',rounds:[2,1],slaps:[4,2]};
  await Promise.all([act(a,'a',code,result),act(b,'b',code,result)]);
  room=await act(a,'a',code,result);assert.equal(room.status,'complete');
  // Eight concurrent joins serialize without losing players.
  const t='111111ABCDEF';await act(a,'a',t,{type:'create',mode:'tournament'});
  await Promise.all(Array.from({length:7},(_,i)=>act(user('p'+i),'p'+i,t,{type:'join'})));
  room=(await a.ref('casualCompetitions/'+t).once('value')).val();assert.equal(Object.keys(room.players).length,8);
  for(const uid of Object.keys(room.players))await act(user(uid),uid,t,{type:'ready',ready:true});
  room=await act(a,'a',t,{type:'start'});
  for(const id of ['Q0','Q1','Q2','Q3','S0','S1','F0']){
   const m=Object.values(room.matches).find(m=>m.id===id),ids=Object.values(m.players);
   for(const uid of ids)await act(user(uid),uid,t,{type:'enter',matchId:id});
   for(const uid of ids)room=await act(user(uid),uid,t,{type:'result',matchId:id,winner:ids[0],rounds:[2,0],slaps:[3,1]});
  }
  assert.equal(room.status,'complete');assert.ok(room.champion);
  const league='222222ABCDEF';await act(a,'a',league,{type:'create',mode:'league'});
  for(let i=1;i<20;i++)await act(user('l'+i),'l'+i,league,{type:'join'});
  room=(await a.ref('casualCompetitions/'+league).once('value')).val();
  const ids=Object.keys(room.players);
  for(const uid of ids)await act(user(uid),uid,league,{type:'ready',ready:true});
  room=await act(a,'a',league,{type:'start'});assert.equal(room.matches.length,190);
  room=await act(a,'a',league,{type:'leave'});assert.notEqual(room.host,'a');assert.equal(Object.keys(room.players).length,20);
  for(const match of room.matches)room=await act(user(match.players[0]),match.players[0],league,{type:'forfeit',matchId:match.id});
  assert.equal(room.status,'complete');assert.equal(standings(room).length,20);
  assert.equal(standings(room).reduce((n,p)=>n+p.points,0),190);
  assert.ok(standings(room).every(p=>p.played===19));
  console.log('Firebase emulator: privacy, concurrent joins/results, full knockout, 190 league results, host transfer and final retry passed.');
 }finally{await env.cleanup();clearTimeout(deadline);}
})().catch(e=>{console.error(e);process.exitCode=1;});
