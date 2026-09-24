/* Bounds and role checks reduce accidental/malicious peer input. They do not
   authenticate the host or turn peer-written results into verified rankings. */
(function(root){
 const hostOnly=new Set(['ROUND_START','SYNC','HOST_COUNTDOWN','REVEAL_PRELOAD','REVEAL_SHOW','MOVE_APPLY','MOVE_REJECT','FLIP_APPLY','FLIP_REJECT','SLAP_UPDATE','PENALTY_UPDATE','ROUND_OVER','MATCH_OVER','BORROWED_START','CYCLE_RESET']);
 const known=new Set([...hostOnly,'HANDSHAKE','CARD_LAYOUT','READY','DRAG','MOVE_REQ','FLIP_REQ','OPPONENT_REJECT','SLAP_REQ','CONCESSION_TOKEN','CONCESSION_REQ','CONCESSION_RESULT','OPPONENT_LEFT','REMATCH_REQ','REMATCH_YES','REMATCH_NO']);
 const str=(s,n=160)=>typeof s==='string'&&s.length>0&&s.length<=n;
 function bounded(v,depth=0){
  if(depth>8)return false;
  if(v===null||typeof v==='boolean')return true;
  if(typeof v==='number')return Number.isFinite(v)&&Math.abs(v)<1e15;
  if(typeof v==='string')return v.length<=500;
  if(Array.isArray(v))return v.length<=104&&v.every(x=>bounded(x,depth+1));
  if(typeof v!=='object'||Object.keys(v).length>40)return false;
  return Object.entries(v).every(([k,x])=>!['__proto__','constructor','prototype'].includes(k)&&bounded(x,depth+1));
 }
 function valid(msg,isHost){
  if(!msg||!known.has(msg.type)||!bounded(msg))return false;
  if(isHost&&hostOnly.has(msg.type))return false;
  if(!isHost&&['MOVE_REQ','FLIP_REQ','SLAP_REQ'].includes(msg.type))return false;
  if(msg.type==='HANDSHAKE')return str(msg.name,80)&&(!msg.uid||str(msg.uid,128));
  if(msg.type==='MOVE_REQ')return !!msg.move&&str(msg.move.reqId)&&str(msg.move.card?.id)&&['left','right'].includes(msg.move.dropSide);
  if(msg.type==='FLIP_REQ')return !!msg.flip&&str(msg.flip.cardId);
  if(msg.type==='DRAG')return !!msg.drag&&str(msg.drag.id)&&['start','move','end'].includes(msg.drag.phase)&&Number.isFinite(msg.drag.nx)&&Number.isFinite(msg.drag.ny)&&Math.abs(msg.drag.nx)<=3&&Math.abs(msg.drag.ny)<=3;
  if(msg.type==='CARD_LAYOUT')return str(msg.id)&&Number.isFinite(msg.x)&&Number.isFinite(msg.y);
  const fields={ROUND_START:'state',SYNC:'state',REVEAL_PRELOAD:'result',MOVE_APPLY:'apply',MOVE_REJECT:'reject',FLIP_APPLY:'flip',FLIP_REJECT:'flip',OPPONENT_REJECT:'card'};
  if(fields[msg.type])return !!msg[fields[msg.type]]&&typeof msg[fields[msg.type]]==='object';
  return true;
 }
 function limiter(limit=150){let start=0,count=0;return now=>{if(now-start>=1000){start=now;count=0}return ++count<=limit;};}
 const api={valid,limiter};if(typeof module!=='undefined')module.exports=api;else root.NetworkGuard=api;
})(globalThis);
