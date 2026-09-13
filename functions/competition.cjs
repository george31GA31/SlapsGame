/* Pure competition reducer. Only the authenticated server may persist this state. */
const MAX_IDLE=45000,ABANDON_MS=120000;
const assert=(v,m)=>{if(!v)throw Error(m);};
const sameReport=(a,b)=>a&&b&&a.winner===b.winner&&['rounds','slaps'].every(key=>[0,1].every(i=>a[key]?.[i]===b[key]?.[i]));
function fixtures(ids){
 const list=[...ids];if(list.length%2)list.push(null);const out=[];
 for(let round=0;round<list.length-1;round++){
  for(let i=0;i<list.length/2;i++)if(list[i]&&list[list.length-1-i])out.push({id:'L'+round+'-'+i,round:round+1,players:[list[i],list[list.length-1-i]],status:'scheduled'});
  list.splice(1,0,list.pop());
 }return out.concat(out.map(m=>({...m,id:m.id+'-return',round:m.round+list.length-1,players:[...m.players].reverse()})));
}
function bracket(ids){
 return seededBracket(ids);
}
function seededBracket(ids){
 assert(Array.isArray(ids)&&ids.length>=2&&ids.length<=64&&new Set(ids).size===ids.length,'A bracket requires 2–64 unique players');
 const size=2**Math.ceil(Math.log2(ids.length)),rounds=Math.log2(size),out=[];
 let seeds=[1,2];for(let n=4;n<=size;n*=2)seeds=seeds.flatMap(s=>[s,n+1-s]);
 for(let r=1;r<=rounds;r++)for(let i=0;i<size/2**r;i++){
  const players=r===1?[ids[seeds[i*2]-1]||null,ids[seeds[i*2+1]-1]||null]:[null,null];
  out.push({id:`R${r}-${i}`,round:r,players,status:r===1?'scheduled':'waiting',...(r<rounds?{nextId:`R${r+1}-${Math.floor(i/2)}`,nextSlot:i%2}:{})});
 }
 for(const m of out.filter(m=>m.round===1&&m.players.includes(null))){
  m.status='complete';m.winner=m.players.find(Boolean);m.reason='bye';m.rounds=[0,0];m.slaps=[0,0];
  const next=out.find(n=>n.id===m.nextId);if(next){next.players[m.nextSlot]=m.winner;if(next.players.every(Boolean))next.status='scheduled';}
 }
 return out;
}
function standings(room){
 const rows=Object.values(room.players).map(p=>({id:p.id,name:p.name,played:0,points:0,wins:0,losses:0,gamesWon:0,gamesLost:0,slapsWon:0,slapsLost:0}));
 const byId=Object.fromEntries(rows.map(p=>[p.id,p]));
 for(const m of room.matches||[]){if(m.status!=='complete')continue;
  m.players.forEach((id,i)=>{const p=byId[id];p.played++;p.wins+=m.winner===id?1:0;p.losses+=m.winner===id?0:1;p.points+=m.winner===id?1:0;p.gamesWon+=m.rounds[i];p.gamesLost+=m.rounds[1-i];p.slapsWon+=m.slaps[i];p.slapsLost+=m.slaps[1-i];});
 }
 // Online league regulation: points, round differential, rounds won,
 // slap differential, slaps won. Exact ties share a sporting rank.
 const metrics=p=>[p.points,p.gamesWon-p.gamesLost,p.gamesWon,p.slapsWon-p.slapsLost,p.slapsWon];
 const compare=(a,b)=>{const x=metrics(a),y=metrics(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return y[i]-x[i];return 0;};
 rows.sort((a,b)=>compare(a,b)||a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
 rows.forEach((p,i)=>p.position=i&&compare(p,rows[i-1])===0?rows[i-1].position:i+1);return rows;
}
function complete(room,m,winner,rounds,slaps,reason){
 assert(m.status!=='complete','Match already completed');
 m.status='complete';m.endedAt=room.actionAt;m.winner=winner;m.rounds=rounds;m.slaps=slaps;m.reason=reason;delete m.reports;
 if(room.mode==='tournament'){
  if(m.id==='F0'||(m.id.startsWith('R')&&!m.nextId)){room.champion=winner;room.status='complete';return;}
  if(m.nextId){const next=room.matches.find(x=>x.id===m.nextId);next.players[m.nextSlot]=winner;if(next.players.every(Boolean))next.status='scheduled';return;}
  const i=Number(m.id.slice(1));const next=room.matches.find(x=>x.id===(m.id[0]==='Q'?'S'+Math.floor(i/2):'F0'));
  const slot=i%2;next.players[slot]=winner;
  if(next.players[0]&&next.players[1])next.status='scheduled';
 }else if(room.matches.every(x=>x.status==='complete'))room.status='complete';
}
function reduce(previous,uid,name,action,now){
 const room=previous?JSON.parse(JSON.stringify(previous)):null;
 // Realtime Database omits empty arrays, empty objects and null bracket slots.
 if(room){
  room.players||={};
  room.matches=Array.isArray(room.matches)?room.matches.filter(Boolean):Object.values(room.matches||{});
  for(const m of room.matches){
   m.players=[m.players?.[0]||null,m.players?.[1]||null];
   for(const key of ['rounds','slaps'])if(m[key])m[key]=[m[key][0]||0,m[key][1]||0];
   for(const report of Object.values(m.reports||{}))for(const key of ['rounds','slaps'])if(report[key])report[key]=[report[key][0]||0,report[key][1]||0];
  }
 }
 assert(typeof uid==='string'&&uid.length>0,'Sign in required');
 if(action.type==='create'){
  assert(!room,'Room already exists');assert(['league','tournament'].includes(action.mode),'Unknown mode');
  return {version:1,mode:action.mode,status:'lobby',host:uid,createdAt:now,playerCount:1,players:{[uid]:{id:uid,name:name.slice(0,80),joinedAt:now,lastSeen:now,ready:false}},matches:[]};
 }
 assert(room,'Competition not found');room.actionAt=now;
 if(action.type==='join'){
  assert(room.players[uid]||room.status==='lobby','Competition already started');
  assert(room.players[uid]||Object.keys(room.players).length<(room.mode==='league'?20:64),'Competition is full');
  room.players[uid]||={id:uid,name:name.slice(0,80),joinedAt:now,lastSeen:now,ready:false};
 }
 assert(room.players[uid],'You are not a participant');
 room.players[uid].lastSeen=now;
 if(room.status==='lobby'&&Number.isFinite(action.elo))room.players[uid].elo=Math.max(0,Math.min(1000000000,Math.floor(action.elo)));
 if(action.type==='leave'){
  if(room.status==='lobby')delete room.players[uid];
  else room.players[uid].lastSeen=now-MAX_IDLE-1;
 }
 const connected=Object.values(room.players).filter(p=>now-p.lastSeen<=MAX_IDLE).sort((a,b)=>a.joinedAt-b.joinedAt||a.id.localeCompare(b.id));
 room.playerCount=Object.keys(room.players).length;
 if(!connected.some(p=>p.id===room.host))room.host=connected[0]?.id||null;
 if(action.type==='ready') {assert(room.status==='lobby','Already started');room.players[uid].ready=!!action.ready;}
 if(action.type==='start'){
  assert(uid===room.host&&room.status==='lobby','Only the lobby host can start');
  const ids=Object.keys(room.players);
  assert(ids.length>=2&&ids.length<=(room.mode==='league'?20:64),'At least two players are required; maximum 20 in a league or 64 in a tournament');
  assert(ids.every(id=>room.players[id].ready&&now-room.players[id].lastSeen<=MAX_IDLE),'Every player must be ready and connected');
  if(room.mode==='tournament')ids.sort((a,b)=>(room.players[b].elo??1000)-(room.players[a].elo??1000)||room.players[a].joinedAt-room.players[b].joinedAt||a.localeCompare(b));
  ids.forEach((id,i)=>room.players[id].seed=i+1);
  room.matches=room.mode==='league'?fixtures(ids):seededBracket(ids);room.status='active';
 }
 if(['enter','result','forfeit','abandon'].includes(action.type)){
  const m=room.matches.find(m=>m.id===action.matchId);assert(m&&m.players.includes(uid),'Not your match');
  if(action.type==='result'&&m.status==='complete'&&m.winner===action.winner&&JSON.stringify(m.rounds)===JSON.stringify(action.rounds)&&JSON.stringify(m.slaps)===JSON.stringify(action.slaps))return room;
  assert(room.status==='active','Competition is not active');
  assert(['scheduled','playing','disputed'].includes(m.status),'Match is not available');
  if(action.type==='enter'){
   assert(m.status!=='disputed','Resolve the disputed result before entering');
   assert(!room.matches.some(x=>x.id!==m.id&&x.status==='playing'&&x.players.includes(uid)),'Finish your current match first');
   m.entered||={};m.entered[uid]||=now;m.startedAt||=now;m.status='playing';
  }else if(action.type==='forfeit'){
   const winner=m.players.find(id=>id!==uid);complete(room,m,winner,m.players.map(id=>id===winner?2:0),[0,0],'concession');
  }else if(action.type==='abandon'){
   const other=m.players.find(id=>id!==uid);
   assert(m.entered?.[uid]&&now-(m.entered[uid])>=ABANDON_MS,'Wait two minutes after entering');
   assert(!m.entered?.[other]||now-room.players[other].lastSeen>=ABANDON_MS,'Opponent is still connected');
   complete(room,m,uid,m.players.map(id=>id===uid?2:0),[0,0],'absence');
  }else{
   assert(m.entered?.[uid],'Enter the match first');assert(m.players.includes(action.winner),'Invalid winner');
   for(const stats of [action.rounds,action.slaps])assert(Array.isArray(stats)&&stats.length===2&&stats.every(n=>Number.isInteger(n)&&n>=0&&n<=10000),'Invalid statistics');
   m.reports||={};const report={winner:action.winner,rounds:action.rounds,slaps:action.slaps};
   assert(!m.reports[uid]||sameReport(m.reports[uid],report),'A submitted result cannot be changed');
   m.reports[uid]=report;
   const [a,b]=m.players.map(id=>m.reports[id]);
   if(a&&b){if(sameReport(a,b))complete(room,m,a.winner,a.rounds,a.slaps,'agreed');else m.status='disputed';}
  }
 }
 assert(['join','heartbeat','leave','ready','start','enter','result','forfeit','abandon'].includes(action.type),'Unknown action');
 room.version++;return room;
}
module.exports={reduce,fixtures,bracket,seededBracket,standings};
