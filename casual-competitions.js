/* Spark transport: casual, member-managed rooms; never writes ranked totals. */
(function(){
 let offset=0;
 db.ref('.info/serverTimeOffset').on('value',s=>{offset=Number(s.val())||0;});
 window.CasualCompetitions={
  async action(action){
   const user=auth.currentUser;
   if(!user||user.isAnonymous)throw Error('Sign in to join a competition.');
   if(['create','join','ready'].includes(action.type)){
    const profile=(await db.ref('publicPlayers/'+user.uid).once('value')).val();
    action={...action,elo:Number.isFinite(profile?.elo)?profile.elo:1000};
   }
   const roomId=action.roomId||(action.type==='create'?Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>b.toString(16).padStart(2,'0')).join('').toUpperCase():'');
   if(!/^[A-F0-9]{12}$/.test(roomId))throw Error('Enter a valid 12-character room code.');
   const ref=db.ref('casualCompetitions/'+roomId);
   // Keep the listener attached: once() releases the cached room before transaction().
   let listener;
   try{await new Promise((resolve,reject)=>{listener=()=>resolve();ref.on('value',listener,reject);});}
   catch(e){if(listener)ref.off('value',listener);throw e;}
   const now=Date.now()+offset,name=(user.displayName||localStorage.getItem('isf_username')||'Player').slice(0,80);
   let rejection=null;
   let result;
   try{result=await ref.transaction(current=>{
    rejection=null;
    try{return CompetitionModel.reduce(current,user.uid,name,action,now);}
    catch(e){rejection=e;return;}
   },undefined,false);}finally{ref.off('value',listener);}
   if(!result.committed)throw rejection||Error('Room changed. Please try again.');
   return {data:{roomId,room:result.snapshot.val()}};
  }
 };
})();
