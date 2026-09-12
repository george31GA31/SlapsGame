(()=>{
 const $=id=>document.getElementById(id);let detach=null;
 auth.onAuthStateChanged(user=>{
  if(detach)detach();detach=null;
  const member=user&&!user.isAnonymous;
  $('home-logout').hidden=!member&&!ISFSession.isGuest();
  $('account-link').textContent=member?'My account ↗':'Sign in ↗';
  $('account-link').href=member?'account.html':'login.html';
  $('home-member-status').textContent=member?'Your next win starts here.':'Sign in to save your record.';
  $('disp-username').textContent=member?(user.displayName||'Player'):'Take your seat';
  $('home-initial').textContent=member?(user.displayName||'P')[0]:'?';
  for(const id of ['disp-elo','disp-wins','disp-country'])$(id).textContent='—';
  if(member){
   const ref=db.ref('users/'+user.uid),callback=s=>{
    if(auth.currentUser?.uid!==user.uid)return;
    const p=s.val();if(!p)return;
    $('disp-username').textContent=p.username||'Player';$('home-initial').textContent=(p.username||'P')[0];
    $('disp-elo').textContent=p.elo??1000;$('disp-wins').textContent=p.wins??0;$('disp-country').textContent=p.country||'—';
    localStorage.setItem('isf_username',p.username||'Player');localStorage.setItem('isf_is_guest','false');
   };
   ref.on('value',callback,()=>{$('home-status').textContent='Your player card could not load. Check your connection and retry.';});
   detach=()=>ref.off('value',callback);
  }
 });
 document.querySelectorAll('[data-play]').forEach(link=>link.addEventListener('click',async e=>{
  e.preventDefault();if(link.dataset.busy)return;link.dataset.busy='true';
  try{await window.isfAuthReady;if(!auth.currentUser&&!ISFSession.isGuest())await ISFSession.startGuest();location.href=link.getAttribute('href');}
  catch{$('home-status').textContent='Could not open the table. Please try again.';}finally{delete link.dataset.busy;}
 }));
 $('home-logout').onclick=async()=>{try{await auth.signOut();ISFSession.clear();location.reload();}catch{$('home-status').textContent='Sign-out failed. Please try again.';}};
 addEventListener('public-player-sync-error',()=>{$('home-status').textContent='Your public ranking could not sync. Check your connection, then refresh.';});
 db.ref('publicPlayers').orderByChild('elo').limitToLast(5).on('value',snapshot=>{
  const players=[];snapshot.forEach(s=>{const p=s.val();if(p&&!p.isGuest&&!p.isAnonymous)players.push({id:s.key,...p});});players.reverse();
  $('home-rankings').replaceChildren();$('ranking-status').textContent=players.length?'Ranked by ELO':'No published rankings yet.';
  for(const [i,p] of players.slice(0,5).entries()){
   const row=document.createElement('li'),rank=document.createElement('span'),link=document.createElement('a'),score=document.createElement('strong');
   rank.textContent=String(i+1).padStart(2,'0');link.textContent=p.username||'Player';link.href='stats.html?uid='+encodeURIComponent(p.id);score.textContent=p.elo??1000;
   row.append(rank,link,score);$('home-rankings').append(row);
  }
 },()=>{$('ranking-status').textContent='Rankings unavailable. Please retry shortly.';});
})();
