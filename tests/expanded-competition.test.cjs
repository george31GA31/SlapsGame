const test=require('node:test'),assert=require('node:assert/strict');
const {reduce,fixtures,seededBracket}=require('../functions/competition.cjs');
test('every supported knockout size: top seeds receive byes and n-1 played matches produce one champion',()=>{
 for(let n=2;n<=64;n++){
  let room=reduce(null,'p0','P0',{type:'create',mode:'tournament'},100);
  for(let i=1;i<n;i++)room=reduce(room,'p'+i,'P'+i,{type:'join',elo:2000-i},100);
  for(let i=0;i<n;i++)room=reduce(room,'p'+i,'P'+i,{type:'ready',ready:true,elo:2000-i},100);
  room=reduce(room,'p0','P0',{type:'start'},100);
  const byeCount=2**Math.ceil(Math.log2(n))-n;
  assert.equal(room.matches.filter(m=>m.reason==='bye').length,byeCount);
  assert.deepEqual(room.matches.filter(m=>m.reason==='bye').map(m=>room.players[m.winner].seed).sort((a,b)=>a-b),Array.from({length:byeCount},(_,i)=>i+1));
  let played=0;
  while(room.status!=='complete'){
   const m=room.matches.find(m=>m.status==='scheduled');assert.ok(m,'No dead ends');
   room=reduce(room,m.players[1],'P',{type:'forfeit',matchId:m.id},100);played++;
  }
  assert.equal(played,n-1);assert.ok(room.champion);
 }
});
test('league pairs meet exactly twice in opposite slots, with one fixture per matchday',()=>{
 for(let n=2;n<=20;n++){
  const ids=Array.from({length:n},(_,i)=>'p'+i),ms=fixtures(ids);
  assert.equal(ms.length,n*(n-1));assert.equal(new Set(ms.map(m=>m.id)).size,ms.length);
  for(const a of ids)for(const b of ids)if(a!==b)assert.equal(ms.filter(m=>m.players[0]===a&&m.players[1]===b).length,1);
  for(const day of new Set(ms.map(m=>m.round))){const players=ms.filter(m=>m.round===day).flatMap(m=>m.players);assert.equal(new Set(players).size,players.length);}
 }
});
test('first two seeds occupy opposite halves at all bracket sizes',()=>{
 for(const n of [4,8,16,32,64]){const ms=seededBracket(Array.from({length:n},(_,i)=>'p'+i)).filter(m=>m.round===1);assert.ok(ms[0].players.includes('p0'));assert.ok(ms[n/4].players.includes('p1'));}
});
test('existing active competitions keep their fixtures unchanged on heartbeat',()=>{
 const room={version:1,mode:'league',status:'active',host:'a',createdAt:1,players:{a:{id:'a',name:'A',lastSeen:1,joinedAt:1},b:{id:'b',name:'B',lastSeen:1,joinedAt:1}},matches:[{id:'legacy',players:['a','b'],status:'scheduled',round:1}]};
 assert.deepEqual(reduce(room,'a','A',{type:'heartbeat'},10).matches,room.matches);
});
