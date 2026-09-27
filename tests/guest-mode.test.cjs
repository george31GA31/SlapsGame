const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function fixture(guest = false) {
    const saved = new Map(guest ? [['isf_is_guest', 'true']] : []);
    const elements = new Map();
    const element = () => ({ style: {}, classList: { add(){}, remove(){}, contains(){return true} },
        querySelector(){return element()}, appendChild(){}, append(){}, setAttribute(){},
        innerHTML:'', innerText:'', textContent:'' });
    let writes = 0;
    let profile = { elo: 1000, wins: 3, losses: 2, stats_slaps_won: 10, stats_slaps_lost: 6,
        stats_rounds_won: 8, stats_rounds_lost: 5, stats_total_time_sec: 100 };
    const auth = {currentUser: {uid:'member', isAnonymous:false}, async signOut(){auth.currentUser = null}};
    const db = {ref(){return {set:async()=>{},once: async()=>({exists:()=>true,val:()=>({elo:1000,wins:2,losses:2})}),
        transaction(update,complete){ const next = update({...profile}); if(next){profile = next;writes++} complete?.(null,!!next,{val:()=>profile}); }}}};
    const ctx = { console: {log(){}, warn(){}, error(){}}, localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)},
        document:{getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelector:()=>element(),querySelectorAll:()=>[],createElement:element,body:element(),addEventListener(){}},
        auth, db, firebase:{auth:()=>auth,database:()=>db}, location:{href:''}, addEventListener(){},
        setTimeout(){},clearTimeout(){},setInterval(){return 1},clearInterval(){}, crypto:require('node:crypto').webcrypto, Date, Map, Set, Math, alert(){} };
    ctx.window = ctx;
    vm.createContext(ctx);
    for(const file of ['session.js','elo-engine.js','slaps-engine.js','network-guard.js','multiplayer-game.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
    vm.runInContext('localMatchUid = guestAtMatchStart ? null : "member"; gameState.roundStarted=true; gameState.isHost=true;',ctx);
    return {ctx,run: code=>vm.runInContext(code,ctx),writes:()=>writes,profile:()=>profile};
}
for(const [label,localGuest,opponentGuest] of [['guest vs member',true,false],['member vs guest',false,true],['guest vs guest',true,true]]) {
    test(`${label}: results, concessions, disconnects and rematches never write statistics`,async()=>{
        const f=fixture(localGuest);
        f.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:opponentGuest?null:'opponent',isGuest:opponentGuest,protocol:4});
        await Promise.resolve();
        const before={...f.profile()};
        for(const won of [true,false]) { let completed=false;f.ctx.reportMatchResultInternal(won,()=>completed=true,'proof');assert.ok(completed); }
        f.ctx.applyMatchOver({winner:'player'});
        f.ctx.handleNet({type:'CONCESSION_TOKEN',token:'proof'});
        f.run('gameState.matchEnded=false;gameState.matchLive=true');
        f.ctx.handleNet({type:'OPPONENT_LEFT'});
        f.ctx.respondConcession(false);
        f.ctx.handleNet({type:'CONCESSION_RESULT',accepted:false});
        f.run('gameState.isHost=false');
        f.ctx.acceptRematch();
        f.ctx.handleNet({type:'REMATCH_YES'});
        f.ctx.reportMatchResultInternal(false,null,'proof');
        assert.equal(f.writes(),0);
        assert.deepEqual(f.profile(),before);
        assert.equal(f.run('isRanked'),false);
    });
}
test('browser-hosted matches never change ELO or official statistics',async()=>{
    const f=fixture();f.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:'opponent',isGuest:false,protocol:4});
    await Promise.resolve();
    f.run('gameState.p1Slaps=2;gameState.p1Rounds=1;gameState.matchStartTime=Date.now()-10000');
    f.ctx.reportMatchResultInternal(true,null,'proof');
    f.ctx.reportMatchResultInternal(true,null,'proof');
    assert.equal(f.writes(),0);assert.equal(f.profile().elo,1000);assert.equal(f.profile().wins,3);
    assert.equal(f.profile().stats_slaps_won,10);assert.equal(f.profile().stats_rounds_won,8);assert.equal(f.profile().stats_total_time_sec,100);
});
test('missing identity and legacy handshakes are unranked',()=>{
    const f=fixture();f.ctx.handleNet({type:'HANDSHAKE',name:'Unknown',uid:'opponent'});
    f.ctx.reportMatchResultInternal(false,null,'proof');assert.equal(f.writes(),0);
});
test('only the current peer protocol starts a match',()=>{
    const current=fixture();current.run('gameState.isHost=false');
    current.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:'opponent',isGuest:false,protocol:4});
    assert.equal(current.run('gameState.protocolCompatible'),true);
    assert.equal(current.run('gameState.handshakeDone'),true);
    const legacy=fixture();legacy.run('gameState.isHost=false');
    legacy.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:'opponent',isGuest:false,protocol:3});
    assert.equal(legacy.run('gameState.protocolCompatible'),false);
    assert.equal(legacy.run('gameState.handshakeDone'),false);
});
test('account switch during a match cannot write to the replacement account',async()=>{
    const f=fixture();f.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:'opponent',isGuest:false,protocol:4});await Promise.resolve();
    f.ctx.auth.currentUser={uid:'different'};f.ctx.reportMatchResultInternal(false,null,'proof');assert.equal(f.writes(),0);
});
test('starting guest mode signs out and provides a distinct guest identity',async()=>{
    const f=fixture();await f.ctx.ISFSession.startGuest();assert.equal(f.ctx.auth.currentUser,null);
    assert.equal(f.ctx.ISFSession.isGuest(),true);assert.match(f.ctx.localStorage.getItem('isf_username'),/^Guest-/);
});
test('all HTML inline and external JavaScript parses',()=>{
    for(const file of fs.readdirSync(root)) {
        if(file.endsWith('.js')) new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
        if(file.endsWith('.html')) {
            const html=fs.readFileSync(path.join(root,file),'utf8');
            const scripts=[...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
            // Combined parse catches duplicate const declarations across script tags.
            new vm.Script(scripts.join('\n'),{filename:file});
            assert.ok(html.includes('href="theme.css"') || html.includes('href="hub.css"'));
            if(!['rules.html','shop.html'].includes(file)) assert.ok(html.includes('src="session.js"'));
        }
    }
});
test('authentication restoration completes before multiplayer identity is sent',async()=>{
    const f=fixture();f.ctx.auth.currentUser=null;
    let resolveAuth;f.ctx.isfAuthReady=new Promise(resolve=>resolveAuth=resolve);
    f.run('localMatchUid = null; initMultiplayer = function () {};');
    const boot=f.ctx.onload();
    assert.equal(f.ctx.matchIdentity().uid,null);
    f.ctx.auth.currentUser={uid:'restored-member',isAnonymous:false};resolveAuth(f.ctx.auth.currentUser);
    await boot;assert.equal(f.ctx.matchIdentity().uid,'restored-member');assert.equal(f.ctx.matchIdentity().isGuest,false);
});
test('online host rejects attempts to play a face-down card',()=>{
    const f=fixture(true);
    f.run(`gameState.gameActive=true;gameState.aiHand=[{id:'hidden',isFaceUp:false,value:5}];gameState.centerPileLeft=[{id:'top',value:6}];applyMoveAuthoritative=function(){throw Error('Hidden card must not be played')};`);
    f.ctx.adjudicateMove({card:{id:'hidden'},targetId:'top',dropSide:'left',reqId:'test'},'ai');
    assert.equal(f.run('gameState.aiHand.length'),1);
    assert.equal(f.run('gameState.centerPileLeft.length'),1);
});
test('simultaneous plays onto the same centre card accept only the first legal request',()=>{
 const f=fixture(true);
 f.run(`gameState.gameActive=true;gameState.playerHand=[{id:'p',isFaceUp:true,value:5}];gameState.aiHand=[{id:'a',isFaceUp:true,value:5}];gameState.centerPileLeft=[{id:'top',value:6}];var accepted=[];applyMoveAuthoritative=function(who,c,side){accepted.push(who);gameState.centerPileLeft.push(c);};`);
 f.ctx.adjudicateMove({card:{id:'p'},targetId:'top',dropSide:'left',reqId:'p1'},'player');
 f.ctx.adjudicateMove({card:{id:'a'},targetId:'top',dropSide:'left',reqId:'a1'},'ai');
 assert.equal(f.run('accepted.length'),1);assert.equal(f.run('accepted[0]'),'player');
});
test('guest move followed immediately by uncover flip is accepted in host order',()=>{
 const f=fixture(true);
 f.run(`
 gameState.isHost=true;gameState.matchLive=true;gameState.gameActive=true;
 gameState.playerDeck=[{id:'pd'}];gameState.aiDeck=[{id:'ad'}];
 gameState.centerPileLeft=[{id:'top',rank:'6',value:6}];gameState.centerPileRight=[{id:'right',rank:'9',value:9}];
 gameState.aiHand=[
   {id:'next',suit:'hearts',rank:'4',value:4,isFaceUp:false,laneIndex:0,owner:'ai'},
   {id:'played',suit:'clubs',rank:'5',value:5,isFaceUp:true,laneIndex:0,owner:'ai'},
   {id:'f1',suit:'clubs',rank:'8',value:8,isFaceUp:true,laneIndex:1,owner:'ai'},
   {id:'f2',suit:'diamonds',rank:'9',value:9,isFaceUp:true,laneIndex:2,owner:'ai'},
   {id:'f3',suit:'spades',rank:'10',value:10,isFaceUp:true,laneIndex:3,owner:'ai'}
 ];
 `);
 f.ctx.adjudicateMove({card:{id:'played'},targetId:'top',dropSide:'left',reqId:'move-1'},'ai');
 assert.equal(f.run("gameState.aiHand.some(c=>c.id==='played')"),false);
 f.ctx.adjudicateFlip({cardId:'next'},'ai');
 assert.equal(f.run("gameState.aiHand.find(c=>c.id==='next').isFaceUp"),true);
});

test('guest sends an immediate uncover flip to the host even before its local move mirror arrives',()=>{
 const f=fixture(true);
 f.run(`
  gameState.isHost=false;gameState.matchLive=true;gameState.gameActive=true;
  var outgoing=[];sendNet=function(message){outgoing.push(message)};
  const next={id:'next',isFaceUp:false,laneIndex:0};
  const played={id:'played',isFaceUp:true,laneIndex:0,pendingMove:'move-1'};
  gameState.playerHand=[next,played,{id:'f1',isFaceUp:true,laneIndex:1},{id:'f2',isFaceUp:true,laneIndex:2},{id:'f3',isFaceUp:true,laneIndex:3}];
  tryFlipCard(null,next);
 `);
 assert.equal(f.run('outgoing.length'),1);
 assert.equal(f.run('outgoing[0].type'),'FLIP_REQ');
 assert.equal(f.run('outgoing[0].flip.cardId'),'next');
 assert.ok(f.run('outgoing[0].flip.reqId'));
 assert.ok(f.run("gameState.playerHand.find(c=>c.id==='next').flipPending"));
});

test('guest snapshots do not contain the opponent’s hidden cards',()=>{
 const f=fixture(true);
 f.run(`
  gameState.isHost=true;
  gameState.playerDeck=[{id:'opp-deck',suit:'clubs',rank:'ace',value:14}];
  gameState.aiDeck=[{id:'my-deck',suit:'hearts',rank:'2',value:2}];
  gameState.playerHand=[
   {id:'opp-hidden',suit:'clubs',rank:'king',value:13,isFaceUp:false,laneIndex:0},
   {id:'opp-open',suit:'spades',rank:'queen',value:12,isFaceUp:true,laneIndex:1}
  ];
  gameState.aiHand=[{id:'my-hidden',suit:'diamonds',rank:'jack',value:11,isFaceUp:false,laneIndex:0}];
  var snapshot=buildGuestState();
 `);
 assert.equal(f.run('snapshot.aiDeck[0].rank'),undefined);
 assert.equal(f.run('snapshot.aiHand.find(c=>c.id==="opp-hidden").rank'),undefined);
 assert.equal(f.run('snapshot.aiHand.find(c=>c.id==="opp-open").rank'),'queen');
 assert.equal(f.run('snapshot.playerHand[0].rank'),'jack');
});

test('a revision gap requests an authoritative snapshot instead of applying stale state',()=>{
 const f=fixture(true);
 f.run(`
  gameState.isHost=false;gameState.lastAppliedRevision=2;
  var outgoing=[];sendNet=function(message){outgoing.push(message)};
  handleNet({type:'MOVE_APPLY',revision:4,apply:{}});
 `);
 assert.equal(f.run('outgoing.length'),1);
 assert.equal(f.run('outgoing[0].type'),'SYNC_REQ');
 assert.equal(f.run('outgoing[0].reason'),'revision_gap');
 assert.equal(f.run('gameState.lastAppliedRevision'),2);
});

test('legacy friend-tournament matches route to the maintained protocol',()=>{
 const legacy=fs.readFileSync(path.join(root,'friend-tournament-game.html'),'utf8');
 const launcher=fs.readFileSync(path.join(root,'friend-match.html'),'utf8');
 assert.match(legacy,/location\.replace\('multiplayer-game\.html\?'/);
 assert.match(launcher,/multiplayer-game\.html\?legacyTournament=1/);
 assert.match(fs.readFileSync(path.join(root,'tournament-game.html'),'utf8'),/src="slaps-engine\.js"/);
});

test('online move path no longer calls the undefined legacy sudden-death function',()=>{
 const source=fs.readFileSync(path.join(root,'multiplayer-game.js'),'utf8');
 assert.equal(source.includes('triggerSuddenDeathSplit('),false);
});

test('slap holdings count physical cards for the loser independently of slap wins',()=>{
 const f=fixture(true);f.ctx.document.dispatchEvent=()=>{};f.ctx.Event=class{constructor(type){this.type=type;}};
 f.run("gameState.playerDeck=[{}];gameState.aiDeck=[{}];gameState.centerPileLeft=[{},{}];gameState.centerPileRight=[{},{},{}];gameState.gameActive=true;");
 f.ctx.resolveSlap('player');assert.equal(f.run('gameState.aiSlapCards'),5);assert.equal(f.run('gameState.p1Slaps'),1);assert.equal(f.run('gameState.playerSlapCards||0'),0);
 f.run('gameState.isHost=false');f.ctx.applySlapUpdate({winner:'player',playerSlapCards:0,aiSlapCards:5,pTotal:26,aTotal:31,p1Slaps:1,aiSlaps:0});assert.equal(f.run('gameState.playerSlapCards'),5);assert.equal(f.run('gameState.aiSlapCards'),0);
});
