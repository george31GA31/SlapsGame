(() => {
 let unsubscribe = null;
 auth.onAuthStateChanged(user => {
  if(unsubscribe)unsubscribe();
  const rows=document.getElementById('history-rows'),status=document.getElementById('history-status');
  rows.replaceChildren();
  if(!user||user.isAnonymous||ISFSession.isGuest()){status.textContent='Sign in to view your online match history.';return;}
  status.textContent='Loading…';
  const ref=db.ref('matchHistory/'+user.uid).orderByChild('endedAt').limitToLast(100);
  const callback=snapshot=>{
   if(auth.currentUser?.uid!==user.uid)return;
   rows.replaceChildren();
   const matches=Object.values(snapshot.val()||{}).sort((a,b)=>b.endedAt-a.endedAt);
   status.textContent=matches.length?'Your most recent '+matches.length+' matches.':'No online matches saved yet.';
   for(const m of matches){const tr=document.createElement('tr');
    for(const value of [new Date(m.endedAt).toLocaleString(),m.opponent,m.won?'Win':'Loss',`${m.roundsWon} – ${m.roundsLost}`,`${m.slapsWon} – ${m.slapsLost}`]){
     const td=document.createElement('td');td.textContent=String(value);tr.append(td);
    }rows.append(tr);
   }
  };
  ref.on('value',callback,()=>{status.textContent='History could not be loaded. Please retry after checking your connection.';});
  unsubscribe=()=>ref.off('value',callback);
 });
})();
