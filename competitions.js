(() => {
 const $=id=>document.getElementById(id);let room=null,roomId=null,uid=null,watch=null,activeMatch=null,busy=false;
 const endpoint=action=>CasualCompetitions.action(action);
 const saved=new URLSearchParams(location.search);$('mode').value=document.body.dataset.competition||'tournament';
 $('title').textContent=CompetitionView.title;
 const status=text=>$('status').textContent=text;
 async function act(action){
  if(!uid){status('Sign in to join a competition.');return null;}
  try{const {data}=await endpoint({...action,roomId});roomId=data.roomId;room=data.room;
   if(room.mode!==$('mode').value){location.replace((room.mode==='league'?'league.html':'tournament.html')+'?room='+encodeURIComponent(roomId));return null;}
   sessionStorage.setItem('slaps-'+room.mode,roomId);subscribe();render();status('Connected · '+roomId);return data;
  }catch(error){status(/permission/i.test(error.code||error.message||'')?'Rooms are unavailable until the updated free-plan Firebase rules are published.':error.message||'Connection interrupted. Please retry.');return null;}
 }
 function subscribe(){
  if(watch?.id===roomId)return;
  if(watch)watch.ref.off('value',watch.callback);
  const ref=db.ref('casualCompetitions/'+roomId),callback=s=>{if(s.exists()){room=s.val();render();}};
  ref.on('value',callback,()=>status('Live updates unavailable. Reconnecting…'));watch={ref,callback,id:roomId};
 }
 auth.onAuthStateChanged(async user=>{
  uid=user&&!user.isAnonymous?user.uid:null;
  if(!uid){if(watch)watch.ref.off();watch=null;room=null;roomId=null;activeMatch=null;$('match-layer').hidden=true;$('match-frame').src='about:blank';$('room').hidden=true;$('entry').hidden=false;status('Sign in to join a competition.');return;}
  status('Ready to join.');const previous=saved.get('room')||sessionStorage.getItem('slaps-'+$('mode').value);
  if(previous){roomId=previous;await act({type:'join'});}
 });
 $('create').onclick=()=>{roomId=null;act({type:'create',mode:$('mode').value});};
 $('join').onclick=()=>{roomId=$('code').value.trim().toUpperCase();act({type:'join'});};
 $('fixture-filter').onchange=()=>render();
 $('ready').onclick=()=>act({type:'ready',ready:!room?.players[uid]?.ready});
 $('start').onclick=()=>act({type:'start'});
 $('leave').onclick=async()=>{if(await act({type:'leave'})){sessionStorage.removeItem('slaps-'+$('mode').value);location.href=location.pathname;}};
 setInterval(()=>{if(roomId&&uid&&!busy){busy=true;act({type:'heartbeat'}).finally(()=>busy=false);}},15000);
 function el(tag,text,cls){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;return node;}
 function render(){
  if(!room)return;$('entry').hidden=true;$('room').hidden=false;
  room.players||={};room.matches=Object.values(room.matches||{}).filter(Boolean);
  for(const m of room.matches)m.players=[m.players?.[0]||null,m.players?.[1]||null];
  $('room').classList.toggle('league-room',room.mode==='league');
  $('title').textContent=CompetitionView.title;
  $('room-code').textContent='ROOM '+roomId+' · '+Object.keys(room.players).length+' PLAYERS';
  $('host').textContent='Host · '+(room.players[room.host]?.name||'Reconnecting');
  $('ready').hidden=room.status!=='lobby';$('ready').textContent=room.players[uid]?.ready?'Ready ✓':'Ready';
  $('start').hidden=room.status!=='lobby'||room.host!==uid;
  const entrants=Object.values(room.players);
  $('start').disabled=entrants.length<2||!entrants.every(p=>p.ready);
  $('start').title=$('start').disabled?'At least two players must join and everyone must mark ready.':'Start competition';
  $('players').replaceChildren(...Object.values(room.players).map(p=>el('p',p.name+(p.ready?' ✓':''),'muted')));
  $('champion').replaceChildren();
  const completed=room.matches.filter(m=>m.status==='complete'&&m.reason!=='bye').length,remaining=room.matches.filter(m=>m.status!=='complete').length;
  const next=room.matches.find(m=>m.players.includes(uid)&&['playing','scheduled'].includes(m.status));
  if($('competition-summary'))$('competition-summary').textContent=`${completed} played · ${remaining} remaining`+(next?` · Your next match: ${next.id} vs ${room.players[next.players.find(p=>p!==uid)]?.name||'Awaiting player'}`:'');
  if(room.champion)$('champion').append(el('h2','Champion · '+(room.players[room.champion]?.name||'Player')));
  $('standings').replaceChildren();
  if(room.mode==='league'&&room.status!=='lobby'){
   const section=el('section',null,'panel table-scroll'),table=el('table'),thead=el('thead'),tr=el('tr');
   ['Pos','Player','Played','W','L','Points','Games W–L','Slaps W–L'].forEach(t=>tr.append(el('th',t)));thead.append(tr);table.append(thead);
   const body=el('tbody');for(const p of CompetitionModel.standings(room)){const row=el('tr');[p.position,p.name,p.played,p.wins,p.losses,p.points,`${p.gamesWon}–${p.gamesLost}`,`${p.slapsWon}–${p.slapsLost}`].forEach(v=>row.append(el('td',v)));body.append(row);}table.append(body);section.append(table);$('standings').append(section);
  }
  $('fixtures').replaceChildren();if(!room.matches?.length)return;
  $('fixture-controls').hidden=room.mode!=='league';
  const grid=el('div',null,room.mode==='tournament'?'bracket':'');
  const groups=CompetitionView.groups(room);
  if(room.mode==='tournament'){grid.style.gridTemplateColumns=`repeat(${groups.length},minmax(240px,1fr))`;grid.tabIndex=0;grid.setAttribute('aria-label','Knockout bracket, scroll horizontally for later rounds');}
  for(const round of groups){const col=el('section',null,'bracket-round');col.append(el('h2',CompetitionView.heading(round,groups.length)));const stack=el('div',null,room.mode==='tournament'?'bracket-matches':'cards');
   for(const m of room.matches.filter(m=>m.round===round&&(room.mode==='tournament'||$('fixture-filter').value==='all'||($('fixture-filter').value==='mine'&&m.players.includes(uid))||($('fixture-filter').value==='upcoming'&&m.status!=='complete')||($('fixture-filter').value==='completed'&&m.status==='complete')))){
    const card=el('article',null,'fixture');card.dataset.match=m.id;card.append(el('small',CompetitionView.fixtureLabel(m)));
    if(m.reason==='bye')card.append(el('p','First-round bye · awarded to a highest-Elo seed','bye-label'));
    for(let i=0;i<2;i++){const id=m.players[i],name=room.players[id]?.name||'Player';const player=el('div',null,'match-player'+(id===m.winner?' winner':''));player.append(el('span',id?name.charAt(0):'?','player-initial'),el('span',id?(name+(m.rounds?' · '+m.rounds[i]:'')):(m.reason==='bye'?'Bye — no opponent':'Awaiting winner')));card.append(player);}
    if(m.players.includes(uid)&&['scheduled','playing','disputed'].includes(m.status)){
     const play=el('button',m.status==='disputed'?'Result disputed':'Enter match');play.disabled=m.status==='disputed';play.onclick=()=>launch(m);card.append(play);
     if(m.status==='playing'){const absence=el('button','Claim absent opponent');absence.onclick=()=>act({type:'abandon',matchId:m.id});card.append(absence);}
     const concede=el('button','Concede match');concede.onclick=()=>{if(confirm('Concede this match? Your opponent will advance or receive the league point.'))act({type:'forfeit',matchId:m.id});};card.append(concede);
    }stack.append(card);
    if(room.mode==='tournament')for(const p of m.players.filter(Boolean)){const player=room.players[p];card.append(el('small',`#${player.seed||'?'} ${player.name} · ${player.elo??1000} Elo`));}
   }if(stack.childElementCount){col.append(stack);grid.append(col);}
  }$('fixtures').append(grid);if(room.mode==='tournament')requestAnimationFrame(()=>drawConnections(grid));
 }

 function drawConnections(grid){
  grid.querySelector('svg')?.remove();
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),bounds=grid.getBoundingClientRect();
  svg.classList.add('bracket-lines');svg.setAttribute('width',grid.scrollWidth);svg.setAttribute('height',grid.scrollHeight);svg.setAttribute('aria-hidden','true');
  const connections=room.matches.some(m=>m.nextId)?room.matches.filter(m=>m.nextId).map(m=>[m.id,m.nextId]):[['Q0','S0'],['Q1','S0'],['Q2','S1'],['Q3','S1'],['S0','F0'],['S1','F0']];
  for(const [from,to] of connections){
   const a=grid.querySelector('[data-match="'+from+'"]')?.getBoundingClientRect(),b=grid.querySelector('[data-match="'+to+'"]')?.getBoundingClientRect();if(!a||!b)continue;
   const x1=a.right-bounds.left+grid.scrollLeft,x2=b.left-bounds.left+grid.scrollLeft,y1=a.top+a.height/2-bounds.top,y2=b.top+b.height/2-bounds.top,mid=(x1+x2)/2;
   const path=document.createElementNS(ns,'path');path.setAttribute('d',`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);path.setAttribute('stroke','#c3a868');path.setAttribute('stroke-width','2');path.setAttribute('fill','none');svg.append(path);
  }grid.prepend(svg);
 }
 addEventListener('resize',()=>{const grid=document.querySelector('.bracket');if(grid)drawConnections(grid);});
 async function launch(m){
  if(activeMatch)return;
  if(!await act({type:'enter',matchId:m.id}))return;
  activeMatch=m;
  const side=m.players.indexOf(uid),other=m.players[1-side];
  // Session-specific query parameters prevent simultaneous tabs changing match identity.
  const query=new URLSearchParams({competition:roomId,match:m.id,role:side===0?'host':'guest',code:'SLAPS-'+roomId+'-'+m.id,name:room.players[uid].name,opponent:room.players[other].name});
  $('match-frame').src='multiplayer-game.html?'+query;$('match-layer').hidden=false;
 }
 addEventListener('message',async event=>{
  if(event.origin!==location.origin||event.source!==$('match-frame').contentWindow||!activeMatch)return;
  const data=event.data;if(!data||data.type!=='COMPETITION_RESULT')return;
  const m=activeMatch,side=m.players.indexOf(uid);
  const numbers=[data.roundsWon,data.roundsLost,data.slapsWon,data.slapsLost];
  if(!numbers.every(n=>Number.isInteger(n)&&n>=0&&n<=10000))return;
  const rounds=side===0?numbers.slice(0,2):numbers.slice(0,2).reverse(),slaps=side===0?numbers.slice(2):numbers.slice(2).reverse();
  const result=await act({type:'result',matchId:m.id,winner:m.players[data.won?side:1-side],rounds,slaps});
  if(result){$('match-layer').hidden=true;$('match-frame').src='about:blank';activeMatch=null;}
 });
})();
