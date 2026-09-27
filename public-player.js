/* One allowlist is shared by the browser and the offline migration tool. */
(function(root){
 const api={
  fromPrivate(profile={}) {
   const count=(v,fallback=0)=>Number.isFinite(v)&&v>=0?Math.min(Math.floor(v),1000000000):fallback;
   const username=String(profile.username||'PLAYER').trim().slice(0,30);
   const flag=String(profile.flag||'');
  return {username:username.length>=3?username:'PLAYER',country:String(profile.country||'').slice(0,4),
    flag:/^assets\/flags\/[\w .()-]+\.png$/.test(flag)?flag:'assets/flags/United Nations.png',
    elo:count(profile.elo,1000),wins:count(profile.wins),losses:count(profile.losses),
    stats_slaps_won:count(profile.stats_slaps_won),stats_slaps_lost:count(profile.stats_slaps_lost),
    stats_rounds_won:count(profile.stats_rounds_won),stats_rounds_lost:count(profile.stats_rounds_lost),stats_total_time_sec:count(profile.stats_total_time_sec)};
  },
  async sync(uid,profile){
   if(!root.db||!uid||!profile||root.auth?.currentUser?.uid!==uid||root.auth.currentUser.isAnonymous)return;
   const ref=root.db.ref('publicPlayers/'+uid),card=api.fromPrivate(profile);
   const identity={username:card.username,country:card.country,flag:card.flag};
   const existing=await ref.once('value');
   if(existing.exists()){
    // Browsers may edit identity fields only.  Ranking and statistic totals are
    // written by trusted server code, never copied from client-held profiles.
    await ref.update(identity);
   }else{
    await ref.set({...identity,elo:1000,wins:0,losses:0,stats_slaps_won:0,stats_slaps_lost:0,stats_rounds_won:0,stats_rounds_lost:0,stats_total_time_sec:0});
   }
  }
 };
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 root.ISFPublicPlayer=api;
 if(!root.auth||!root.db)return;
 let detach=null,version=0;
 root.auth.onAuthStateChanged(user=>{
  const generation=++version;if(detach)detach();detach=null;
  if(!user||user.isAnonymous)return;
  const ref=root.db.ref('users/'+user.uid);let previous='';
  const callback=snapshot=>{
   if(generation!==version||!snapshot.exists())return;
   const data=snapshot.val(),card=JSON.stringify(api.fromPrivate(data));
   if(data.isGuest||data.isAnonymous||card===previous)return;
   previous=card;
   api.sync(user.uid,data).catch(()=>{previous='';root.dispatchEvent?.(new Event('public-player-sync-error'));});
  };
  ref.on('value',callback,()=>root.dispatchEvent?.(new Event('public-player-sync-error')));
  detach=()=>ref.off('value',callback);
 });
})(typeof window!=='undefined'?window:globalThis);
