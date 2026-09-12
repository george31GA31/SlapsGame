const test=require('node:test'),assert=require('node:assert/strict');
const {reduce,fixtures,standings}=require('../functions/competition.cjs');
function lobby(mode='tournament',count=8){let r=reduce(null,'p0','Player 0',{type:'create',mode},100);for(let i=1;i<count;i++)r=reduce(r,'p'+i,'Player '+i,{type:'join'},100+i);for(let i=0;i<count;i++)r=reduce(r,'p'+i,'Player '+i,{type:'ready',ready:true},100+i);return r;}
function finish(r,id){const m=r.matches.find(x=>x.id===id);for(const uid of m.players)r=reduce(r,uid,uid,{type:'enter',matchId:id},1000);for(const uid of m.players)r=reduce(r,uid,uid,{type:'result',matchId:id,winner:m.players[0],rounds:[3,1],slaps:[4,2]},2000);return r;}
test('20-player round robin has 190 unique fixtures and 19 per player',()=>{const ids=Array.from({length:20},(_,i)=>'p'+i),ms=fixtures(ids);assert.equal(ms.length,190);assert.equal(new Set(ms.map(m=>m.players.slice().sort().join(':'))).size,190);for(const id of ids)assert.equal(ms.filter(m=>m.players.includes(id)).length,19);for(let d=1;d<=19;d++)assert.equal(new Set(ms.filter(m=>m.round===d).flatMap(m=>m.players)).size,20);});
test('odd-sized leagues have no self matches, no duplicates and fair byes',()=>{for(const n of [3,5,19]){const ms=fixtures(Array.from({length:n},(_,i)=>'p'+i));assert.equal(ms.length,n*(n-1)/2);assert.ok(ms.every(m=>m.players[0]!==m.players[1]));}});
test('eight-player knockout completes seven matches and names one champion',()=>{let r=reduce(lobby(),'p0','P',{type:'start'},1000);for(const id of ['Q0','Q1','Q2','Q3','S0','S1','F0'])r=finish(r,id);assert.equal(r.champion,'p0');assert.equal(r.status,'complete');assert.equal(r.matches.filter(m=>m.status==='complete').length,7);});
test('host transfers after timeout and an old host cannot start',()=>{let r=lobby();r=reduce(r,'p1','P',{type:'heartbeat'},50000);assert.equal(r.host,'p1');assert.throws(()=>reduce(r,'p0','P',{type:'start'},50001),/Only/);});
test('nonparticipants cannot report, start or heartbeat',()=>{const r=lobby();for(const type of ['result','start','heartbeat'])assert.throws(()=>reduce(r,'intruder','P',{type},1000),/participant/);});
test('ninth tournament and 21st league entrants are rejected',()=>{assert.throws(()=>reduce(lobby(),'extra','P',{type:'join'},1000),/full/);assert.throws(()=>reduce(lobby('league',20),'extra','P',{type:'join'},1000),/full/);});
test('conflicting player reports stop advancement',()=>{let r=reduce(lobby(),'p0','P',{type:'start'},1000);for(const uid of ['p0','p1'])r=reduce(r,uid,uid,{type:'enter',matchId:'Q0'},1001);r=reduce(r,'p0','P',{type:'result',matchId:'Q0',winner:'p0',rounds:[2,0],slaps:[0,0]},1002);assert.notEqual(r.matches[0].status,'complete');r=reduce(r,'p1','P',{type:'result',matchId:'Q0',winner:'p1',rounds:[0,2],slaps:[0,0]},1003);assert.equal(r.matches[0].status,'disputed');assert.deepEqual(r.matches.find(m=>m.id==='S0').players,[null,null]);});
test('absence needs a waiting player and an opponent offline for two minutes',()=>{let r=reduce(lobby(),'p0','P',{type:'start'},1000);assert.throws(()=>reduce(r,'p0','P',{type:'abandon',matchId:'Q0'},130000),/Wait/);r=reduce(r,'p0','P',{type:'enter',matchId:'Q0'},2000);assert.throws(()=>reduce(r,'p0','P',{type:'abandon',matchId:'Q0'},3000),/Wait/);r=reduce(r,'p0','P',{type:'abandon',matchId:'Q0'},130000);assert.deepEqual(r.matches[0].rounds,[2,0]);});
test('league gives one point per win and totals rounds and slaps accurately',()=>{let r=reduce(lobby('league',2),'p0','P',{type:'start'},1000);r=finish(r,r.matches[0].id);const rows=standings(r);assert.equal(rows[0].points,1);assert.equal(rows[1].points,0);assert.equal(rows[0].gamesWon,3);assert.equal(rows[0].slapsLost,2);});
test('retrying an agreed result is idempotent',()=>{let r=reduce(lobby(),'p0','P',{type:'start'},1000);r=finish(r,'Q0');const version=r.version;const next=reduce(r,'p0','P',{type:'result',matchId:'Q0',winner:'p0',rounds:[3,1],slaps:[4,2]},4000);assert.equal(next.version,version);assert.equal(next.matches.find(m=>m.id==='S0').players.filter(Boolean).length,1);});
test('leaving a lobby frees the slot and immediately transfers hosting',()=>{const r=reduce(lobby(),'p0','P',{type:'leave'},1000);assert.equal(Object.keys(r.players).length,7);assert.equal(r.host,'p1');});
test('Firebase empty values and sparse bracket slots survive reconnect and final retries',()=>{
 let room=reduce(null,'p0','Player 0',{type:'create',mode:'tournament'},1000);
 delete room.matches;
 for(let i=1;i<8;i++)room=reduce(room,'p'+i,'Player '+i,{type:'join'},1000+i);
 for(let i=0;i<8;i++)room=reduce(room,'p'+i,'Player '+i,{type:'ready',ready:true},1020+i);
 room=reduce(room,'p0','Player 0',{type:'start'},1050);
 const firebaseRoundtrip=value=>{
  if(Array.isArray(value))return Object.fromEntries(value.map((v,i)=>[i,firebaseRoundtrip(v)]).filter(([,v])=>v!=null));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,firebaseRoundtrip(v)]).filter(([,v])=>v!=null));
  return value;
 };
 room=firebaseRoundtrip(room);
 let last;
 for(const id of ['Q0','Q1','Q2','Q3','S0','S1','F0']){
  room=reduce(room,'p0','Player 0',{type:'heartbeat'},1060);
  const m=room.matches.find(m=>m.id===id),[a,b]=m.players;
  for(const uid of [a,b])room=reduce(room,uid,uid,{type:'enter',matchId:id},1100);
  last={type:'result',matchId:id,winner:a,rounds:[2,0],slaps:[3,1]};
  for(const uid of [a,b])room=reduce(room,uid,uid,last,1200);
  room=firebaseRoundtrip(room);
 }
 room=reduce(room,room.champion,room.champion,last,1300);
 assert.equal(room.status,'complete');assert.equal(room.matches.filter(m=>m.status==='complete').length,7);
});
