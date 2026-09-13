const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp}=require('firebase-admin/app');
const {getDatabase}=require('firebase-admin/database');
const {randomBytes}=require('node:crypto');
const {reduce}=require('./competition.cjs');
initializeApp();
exports.competitionAction=onCall({region:'europe-west1',maxInstances:10},async request=>{
 const uid=request.auth?.uid;
 if(!uid||request.auth.token.firebase?.sign_in_provider==='anonymous')throw new HttpsError('unauthenticated','Sign in to join a competition.');
 const action=request.data;
 if(!action||typeof action!=='object'||JSON.stringify(action).length>3000)throw new HttpsError('invalid-argument','Invalid request.');
 const id=action.type==='create'?randomBytes(6).toString('hex').toUpperCase():action.roomId;
 if(typeof id!=='string'||!/^\w{12}$/.test(id))throw new HttpsError('invalid-argument','Enter the 12-character competition code.');
 const db=getDatabase();const now=Date.now();
 // Per-account rate control is shared across function instances.
 const quota=await db.ref('_competitionLimits/'+uid).transaction(old=>{
  if(old&&now-old.at<10000&&old.count>=30)return;
  return !old||now-old.at>=10000?{at:now,count:1}:{at:old.at,count:old.count+1};
 });
 if(!quota.committed)throw new HttpsError('resource-exhausted','Too many requests. Please wait a moment.');
 const profile=(await db.ref('users/'+uid+'/username').get()).val();
 if(['create','join','ready'].includes(action.type))action.elo=(await db.ref('users/'+uid+'/elo').get()).val()??1000;
 let failure=null;
 const result=await db.ref('competitions/'+id).transaction(old=>{
  try{return reduce(old,uid,String(profile||request.auth.token.name||'Player'),action,now);}
  catch(error){failure=error.message;return;}
 });
 if(!result.committed)throw new HttpsError('failed-precondition',failure||'Please retry.');
 const room=result.snapshot.val();
 const historyUpdates={};
 for(const match of room.matches||[]){
  if(match.status!=='complete'||match.reason==='bye')continue;
  match.players.forEach((player,i)=>{
   historyUpdates['matchHistory/'+player+'/'+id+'-'+match.id]={endedAt:match.endedAt||room.createdAt,opponent:room.players[match.players[1-i]].name,won:match.winner===player,roundsWon:match.rounds[i],roundsLost:match.rounds[1-i],slapsWon:match.slaps[i],slapsLost:match.slaps[1-i],source:'competition'};
  });
 }
 // Deterministic keys make repeated calls safe; Admin writes bypass client rules.
 if(Object.keys(historyUpdates).length&&['result','forfeit','abandon'].includes(action.type))await db.ref().update(historyUpdates);
 // Response only includes this room after reducer membership validation.
 return {roomId:id,room};
});
