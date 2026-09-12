/* Retain the live engine and replay only missed ordered events after a brief
   data-channel loss. A page reload is not a state restore: it remains a separate
   limitation until matches are simulated and persisted by a neutral server. */
(() => {
 let sent=0,received=0,remoteSession=null,peerId=null,connection=null,grace=null,retry=null,ready=false;
 const session=crypto.randomUUID(),journal=[];let rtt=0,pingAt=0,lastDragAt=0;
 const originalHandle=handleNet;
 const status=text=>ISFSession.showMatchStatus(text);
 const raw=msg=>{if(connection?.open)connection.send(msg);};
 function lose(){
  if(gameState.matchEnded||grace)return;
  ready=false;gameState.connectionSuspended=true;
  status('Connection interrupted · Reconnecting for up to 20 seconds');
  grace=setTimeout(()=>{
   grace=null;clearInterval(retry);gameState.connectionSuspended=false;
   originalHandle({type:'OPPONENT_LEFT'});
  },20000);
  if(!gameState.isHost)retry=setInterval(()=>{
   if(gameState.peer&&!gameState.peer.destroyed&&!connection?.open)bindConnection(gameState.peer.connect(gameState.roomCode,{reliable:true}));
  },2000);
 }
 sendNet=function(payload){
  if(payload.type==='DRAG'&&payload.drag?.phase==='move'){
   const now=performance.now();if(now-lastDragAt<33)return;lastDragAt=now;
  }
  const packet={kind:'EVENT',session,seq:++sent,payload};journal.push(packet);
  if(journal.length>2048)journal.shift();
  if(ready)raw(packet);
 };
 bindConnection=function(conn){
  if(connection?.open&&connection!==conn){conn.close();return;}
  if(peerId&&peerId!==conn.peer){conn.close();return;}
  peerId=conn.peer;connection=conn;gameState.conn=conn;
  const admit=NetworkGuard.limiter(200);
  let announced=false;
  const announce=()=>{if(!announced){announced=true;raw({kind:'RESUME',session,received});}};
  conn.on('open',announce);
  conn.on('data',packet=>{
   if(connection!==conn||!admit(Date.now())||!packet||typeof packet!=='object')return;
   if(packet.kind==='PING'){raw({kind:'PONG',at:packet.at});return;}
   if(packet.kind==='PONG'){if(packet.at===pingAt)rtt=Math.min(600,Math.max(0,performance.now()-pingAt));return;}
   if(packet.kind==='RESUME'){
    announce();
    if(typeof packet.session!=='string'||packet.session.length>80||!Number.isInteger(packet.received)||packet.received<0||packet.received>sent)return;
    if(remoteSession&&remoteSession!==packet.session){status('Opponent reloaded · Match cannot be safely restored');lose();return;}
    remoteSession=packet.session;
    if(journal.length&&packet.received<journal[0].seq-1){status('Unable to restore all missed events');lose();return;}
    ready=true;clearTimeout(grace);grace=null;clearInterval(retry);gameState.connectionSuspended=false;
    for(const event of journal)if(event.seq>packet.received)raw(event);
    if(!sent)sendNet(matchIdentity());
    status('Connected · '+(gameState.isHost?'Hosting match':'Online match'));
    return;
   }
   if(packet.kind!=='EVENT'||packet.session!==remoteSession||!Number.isInteger(packet.seq)||packet.seq<=received)return;
   if(packet.seq!==received+1){lose();return;}
   received=packet.seq;
   if(NetworkGuard.valid(packet.payload,gameState.isHost)){
    try{originalHandle(packet.payload);}catch{status('Invalid match event rejected');}
   }
  });
  conn.on('close',()=>{if(connection===conn)lose();});
  conn.on('error',()=>{if(connection===conn)lose();});
 };
 setInterval(()=>{if(ready&&connection?.open){pingAt=performance.now();raw({kind:'PING',at:pingAt});gameState.networkRtt=Math.round(rtt);}},2000);
 // Approximate equal transit cost for host and guest input. The host cannot
 // adjudicate its own slap immediately while its opponent's request is in flight.
 const originalSlap=adjudicateSlap;
 let claim=null;
 adjudicateSlap=function(who){
  if(gameState.connectionSuspended)return;
  if(who!=='player'||!gameState.slapActive)return originalSlap(who);
  if(claim)return;
  const left=gameState.centerPileLeft.at(-1),right=gameState.centerPileRight.at(-1);
  claim=setTimeout(()=>{claim=null;
   if(!gameState.connectionSuspended&&gameState.slapActive&&gameState.centerPileLeft.at(-1)===left&&gameState.centerPileRight.at(-1)===right)originalSlap('player');
  },Math.min(300,rtt/2));
 };
})();
