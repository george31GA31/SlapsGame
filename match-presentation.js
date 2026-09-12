/* Match chrome and competition bridge. Never decides a winner. */
(() => {
 const params=new URLSearchParams(location.search),competition=params.get('competition');
 const portrait = () => {const img=document.createElement('img');img.dataset.ownPhoto='';img.hidden=true;img.alt='Your profile picture';return img;};
 const summary=(isWin)=>{
  const panel=document.createElement('section');panel.className='match-result-summary';
  const vs=document.createElement('div');vs.className='match-versus';
  for(const value of [gameState.myName||'YOU','VS',gameState.opponentName||'BOT']){const name=document.createElement('strong');name.textContent=value;vs.append(name);}
  vs.firstElementChild.prepend(portrait());
  const result=document.createElement('h2');result.textContent=isWin?'Victory':'Match complete';panel.append(result,vs);
  const stats=document.createElement('p');stats.textContent=`Rounds ${gameState.p1Rounds||0} – ${gameState.aiRounds||0} · Slaps ${gameState.p1Slaps||0} – ${gameState.aiSlaps||0}`;panel.append(stats);
  return panel;
 };
 const original=showEndGame;
 showEndGame=function(title,isWin){
  original(title,isWin);
  gameState.gameActive=false;
  const modal=document.getElementById('game-message');if(!modal)return;
  modal.querySelector('.match-result-summary')?.remove();modal.prepend(summary(isWin));
  if(competition&&window.parent!==window){
   const area=modal.querySelector('p:not(.match-result-summary p)')||modal;
   const button=document.createElement('button');button.className='btn-action-small';button.textContent='Return to competition';
   button.onclick=()=>window.parent.postMessage({type:'COMPETITION_RESULT',won:!!isWin,roundsWon:gameState.p1Rounds||0,roundsLost:gameState.aiRounds||0,slapsWon:gameState.p1Slaps||0,slapsLost:gameState.aiSlaps||0},location.origin);
   area.replaceChildren(button);
  }
 };
 addEventListener('load',()=>{
  const header=document.querySelector('.match-header');if(!header)return;
  const context=document.createElement('div');context.className='match-context';
  context.textContent=competition?`COMPETITION · ${params.get('match')} · VS ${params.get('opponent')||'Opponent'}`:'Tap either centre card to slap · Space also works';
  header.append(context);
  const intro=document.createElement('section');intro.className='match-intro';
  const content=document.createElement('div');content.className='match-intro-card';
  const eyebrow=document.createElement('p');eyebrow.textContent=competition?'THE NEXT ROUND':'TAKE YOUR SEAT';eyebrow.className='intro-label';
  const versus=document.createElement('div');versus.className='match-versus';
  const mine=document.createElement('strong'),vs=document.createElement('strong'),opponent=document.createElement('strong');vs.textContent='VS';versus.append(mine,vs,opponent);
  const myName=document.createElement('span');mine.append(portrait(),myName);
  const hint=document.createElement('p');hint.textContent='Clear your Foundation. Watch the centre. Tap either card when ranks match.';
  const ready=document.createElement('button');ready.className='btn-action-small';ready.textContent='Connecting…';ready.disabled=true;
  const back=document.createElement('a');back.href='index.html';back.textContent='Back to menu';
  content.append(eyebrow,versus,hint,ready,back);intro.append(content);document.body.append(intro);
  const refresh=()=>{myName.textContent=gameState.myName||'YOU';opponent.textContent=gameState.opponentName||params.get('opponent')||'BOT';ready.disabled=!gameState.playerHand.length;ready.textContent=ready.disabled?'Connecting…':'Ready to play';};
  refresh();const timer=setInterval(refresh,250);
  ready.onclick=()=>{clearInterval(timer);intro.remove();if(typeof handlePlayerDeckClick==='function')handlePlayerDeckClick();};
 });
})();
