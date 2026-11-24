const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function fixture(guest = false) {
    const saved = new Map(guest ? [['isf_is_guest', 'true']] : []);
    const elements = new Map();
    const element = () => ({ style: {}, dataset:{}, classList: { add(){}, remove(){}, toggle(){}, contains(){return true} },
        querySelector(){return element()}, appendChild(){}, append(){}, setAttribute(){}, remove(){},
        innerHTML:'', innerText:'', textContent:'' });
    let writes = 0;
    let profile = { elo: 1000, wins: 3, losses: 2, stats_slaps_won: 10, stats_slaps_lost: 6,
        stats_rounds_won: 8, stats_rounds_lost: 5, stats_total_time_sec: 100 };
    const auth = {currentUser: {uid:'member', isAnonymous:false}, async signOut(){auth.currentUser = null}};
    const db = {ref(){return {set:async()=>{},once: async()=>({exists:()=>true,val:()=>({elo:1000,wins:2,losses:2})}),
        transaction(update,complete){ const next = update({...profile}); if(next){profile = next;writes++} complete?.(null,!!next,{val:()=>profile}); }}}};
    const ctx = { console: {log(){}, warn(){}, error(){}}, localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)},
        document:{getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)},querySelector:()=>element(),querySelectorAll:()=>[],createElement:element,body:element(),addEventListener(){},dispatchEvent(){}},
        auth, db, firebase:{auth:()=>auth,database:()=>db}, location:{href:''}, addEventListener(){},
        setTimeout(){},clearTimeout(){},setInterval(){return 1},clearInterval(){}, crypto:require('node:crypto').webcrypto, Date, Map, Set, Math:Object.create(Math), alert(){}, Event,
        GameVisuals:{flip(){},stopFlip(){}},CardLayout:{attach(){}},SlapsDrag:{attach(){}} };
    ctx.window = ctx;
    vm.createContext(ctx);
    for(const file of ['session.js','elo-engine.js','slaps-engine.js','network-guard.js','multiplayer-game.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
    vm.runInContext('localMatchUid = guestAtMatchStart ? null : "member"; gameState.initialRoundScheduled=true; gameState.isHost=true;',ctx);
    return {ctx,run: code=>vm.runInContext(code,ctx),writes:()=>writes,profile:()=>profile};
}
for(const [label,localGuest,opponentGuest] of [['guest vs member',true,false],['member vs guest',false,true],['guest vs guest',true,true]]) {
    test(`${label}: results, concessions, disconnects and rematches never write statistics`,async()=>{
        const f=fixture(localGuest);
        f.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:opponentGuest?null:'opponent',isGuest:opponentGuest,protocol:5});
        await Promise.resolve();
        const before={...f.profile()};
        for(const won of [true,false]) { let completed=false;f.ctx.reportMatchResultInternal(won,()=>completed=true,'proof');assert.ok(completed); }
        f.ctx.applyMatchOver({winner:'player'});
        f.ctx.handleNet({type:'CONCESSION_TOKEN',token:'proof'});
        f.run('gameState.matchEnded=false;gameState.matchLive=true;SlapsEngine.initializeMatch(gameState);');
        f.ctx.handleNet({type:'CONCESSION_REQ'});
        f.run('gameState.matchEnded=false');
        f.ctx.handleNet({type:'OPPONENT_LEFT'});
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
    const f=fixture();f.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:'opponent',isGuest:false,protocol:5});
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
    current.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:'opponent',isGuest:false,protocol:5});
    assert.equal(current.run('gameState.protocolCompatible'),true);
    assert.equal(current.run('gameState.handshakeDone'),true);
    const legacy=fixture();legacy.run('gameState.isHost=false');
    legacy.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:'opponent',isGuest:false,protocol:4});
    assert.equal(legacy.run('gameState.protocolCompatible'),false);
    assert.equal(legacy.run('gameState.handshakeDone'),false);
});
test('account switch during a match cannot write to the replacement account',async()=>{
    const f=fixture();f.ctx.handleNet({type:'HANDSHAKE',name:'Opponent',uid:'opponent',isGuest:false,protocol:5});await Promise.resolve();
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
 f.run(`
  gameState.phase='active';gameState.gameActive=true;
  const card=(id,suit,value,laneIndex)=>({id,suit,rank:String(value),value,isFaceUp:true,laneIndex,owner:'player'});
  gameState.playerHand=[card('p','hearts',5,0),card('other','hearts',8,1)];
  gameState.aiHand=[card('a','clubs',5,0)];
  gameState.centerPileLeft=[card('top','hearts',6,0)];
  var outgoing=[];sendNet=message=>outgoing.push(message);
 `);
 f.ctx.adjudicateMove({card:{id:'p'},targetId:'top',dropSide:'left',reqId:'p1'},'player');
 f.ctx.adjudicateMove({card:{id:'a'},targetId:'top',dropSide:'left',reqId:'a1'},'ai');
 assert.equal(f.run('gameState.centerPileLeft.at(-1).id'),'p');
 assert.equal(f.run('gameState.aiHand[0].id'),'a');
 assert.equal(f.run("outgoing.find(msg=>msg.type==='MOVE_REJECT').reject.reason"),'race_lost');
});
test('guest move followed immediately by uncover flip is accepted in host order',()=>{
 const f=fixture(true);
 f.run(`
 gameState.isHost=true;gameState.matchLive=true;gameState.gameActive=true;gameState.phase='active';
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

test('guest snapshots do not contain faces from either hidden hand or Draw Deck',()=>{
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
 assert.equal(f.run('snapshot.playerDeck[0].rank'),undefined);
 assert.equal(f.run('snapshot.aiHand.find(c=>c.id==="opp-hidden").rank'),undefined);
 assert.equal(f.run('snapshot.aiHand.find(c=>c.id==="opp-open").rank'),'queen');
 assert.equal(f.run('snapshot.playerHand[0].rank'),undefined);
});

test('a guest keeps the host lane layout, so each visible top matches the host rule state',async()=>{
 const f=fixture(true);f.run('gameState.isHost=false;');
 const card=(id,lane,isFaceUp)=>({id,suit:'hearts',rank:'2',value:2,isFaceUp,laneIndex:lane});
 const state={playerTotal:26,aiTotal:26,playerDeck:[],aiDeck:[],playerHand:[
  card('lane-3-top',3,true),card('lane-2-bottom',2,false),card('lane-2-top',2,true),
  card('lane-1-bottom',1,false),card('lane-1-middle',1,false),card('lane-1-top',1,true),
  card('lane-0-bottom',0,false),card('lane-0-middle',0,false),card('lane-0-next',0,false),card('lane-0-top',0,true)
 ],aiHand:[],centerPileLeft:[],centerPileRight:[],gameActive:false,matchLive:true,playerReady:false,aiReady:false,drawLock:false};
 await f.ctx.startRoundJoinerFromState(state);
 const lanes=JSON.parse(f.run('JSON.stringify(Object.fromEntries(gameState.playerHand.map(c=>[c.id,c.laneIndex])))'));
 assert.equal(lanes['lane-0-next'],0);assert.equal(lanes['lane-0-top'],0);
 assert.equal(lanes['lane-1-top'],1);assert.equal(lanes['lane-2-top'],2);assert.equal(lanes['lane-3-top'],3);
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
 const host=fixture(true),guest=fixture(true);
 host.run(`
  SlapsEngine.initializeMatch(gameState); SlapsEngine.startRound(gameState);
  gameState.phase='active';gameState.gameActive=true;
  const matchRanks=rank=>card=>card.rank===rank;
  const allDraw=[...gameState.playerDeck,...gameState.aiDeck];
  const rank=gameState.playerDeck.find(card=>allDraw.filter(matchRanks(card.rank)).length>1).rank;
  const moveTop=(deck, match)=>deck.splice(deck.findIndex(match),1)[0];
  const leftTop=moveTop(gameState.playerDeck,matchRanks(rank));
  const rightSource=gameState.aiDeck.some(matchRanks(rank))?gameState.aiDeck:gameState.playerDeck;
  const rightTop=moveTop(rightSource,matchRanks(rank));
  gameState.centerPileLeft=[gameState.playerDeck.pop(), leftTop];
  gameState.centerPileRight=[gameState.aiDeck.pop(),gameState.aiDeck.pop(),rightTop];
  var outgoing=[];sendNet=message=>outgoing.push(message);
 `);
 guest.run('gameState.isHost=false;');
 guest.ctx.startRoundJoinerFromState(host.ctx.buildGuestState());
 host.ctx.resolveSlap('player');
 assert.equal(host.run('gameState.aiHolding.length'),5);
 assert.equal(host.run('gameState.aiSlapCards'),5);
 assert.equal(host.run('gameState.p1Slaps'),1);
 assert.equal(host.run('SlapsEngine.validateCardSet(SlapsEngine.cardZones(gameState)).ok'),true);
 guest.ctx.handleNet(host.run('outgoing[0]'));
 assert.equal(guest.run('gameState.playerSlapCards'),5);
 assert.equal(guest.run('gameState.aiSlapCards'),0);
 assert.equal(guest.run('gameState.playerHolding.length'),5);
 assert.equal(guest.run('SlapsEngine.validateCardSet(SlapsEngine.cardZones(gameState)).ok'),true);
});

function pairedMatch(seed = 1) {
    const host = fixture(true);
    const guest = fixture(true);
    const packets = [];
    let randomState = seed;
    host.ctx.Math.random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState / 2 ** 32;
    };
    host.ctx.SlapsFeedback = guest.ctx.SlapsFeedback = {show(){}, flipReason: reason => reason};
    host.ctx.sendNet = packet => packets.push([guest, JSON.parse(JSON.stringify(packet))]);
    guest.ctx.sendNet = packet => packets.push([host, JSON.parse(JSON.stringify(packet))]);
    guest.run('gameState.isHost=false;gameState.protocolCompatible=true;');
    const flush = () => {
        while (packets.length) {
            const [target, message] = packets.shift();
            target.ctx.handleNet(message);
        }
    };
    const tally = (player, field) => player.run(`gameState.${field}`);
    const cardsAreUnique = player => player.run('SlapsEngine.validateCardSet(SlapsEngine.cardZones(gameState)).ok');
    return {host, guest, packets, flush, tally, cardsAreUnique};
}

test('two peers reveal together and mirror a legal release and exposed replacement', () => {
    const {host, guest, packets, flush, tally, cardsAreUnique} = pairedMatch(1);
    host.ctx.startRoundHostAuthoritative();
    flush();
    assert.ok(cardsAreUnique(host) && cardsAreUnique(guest));
    const laneSizes = guest.run('gameState.playerHand.reduce((sizes,card)=>(sizes[card.laneIndex]++,sizes),[0,0,0,0])');
    assert.deepEqual(Array.from(laneSizes), [4, 3, 2, 1]);

    host.ctx.handlePlayerDeckClick();
    flush();
    assert.equal(tally(host, 'countdownRunning'), false);
    guest.ctx.handlePlayerDeckClick();
    flush();
    assert.equal(tally(host, 'countdownRunning'), true);
    assert.equal(tally(host, 'centerPileLeft.length'), 0);
    assert.equal(tally(guest, 'centerPileRight.length'), 0);

    host.ctx.performRevealHostOnly();
    flush();
    assert.equal(tally(host, 'centerPileLeft.at(-1).networkId'), tally(guest, 'centerPileRight.at(-1).id'));
    assert.equal(tally(host, 'centerPileRight.at(-1).networkId'), tally(guest, 'centerPileLeft.at(-1).id'));
    assert.equal(tally(guest, 'countdownRunning'), false);
    assert.equal(tally(guest, 'playerDeck.every(card=>card.rank===undefined)'), true);
    assert.ok(cardsAreUnique(host) && cardsAreUnique(guest));

    guest.ctx.handlePlayerDeckClick();
    assert.equal(packets.length, 0, 'a legal Foundation play prevents restart');
    guest.run(`
      const move=SlapsEngine.availableMoves(gameState,'player')[0];
      const playedId=move.card.id;
      const lane=move.card.laneIndex;
      requestMoveToHost(move.card, move.side);
      requestMoveToHost(move.card, move.side);
    `);
    assert.equal(packets.length, 1, 'repeated release cannot resend a pending card');
    flush();
    assert.equal(guest.run('gameState.playerHand.some(card=>card.id===playedId)'), false);
    assert.equal(guest.run('gameState.playerHand.filter(card=>card.isFaceUp).length'), 3);
    assert.equal(guest.run('gameState.playerHand.find(card=>card.laneIndex===0&&card.isFaceUp)!==undefined'), true);
    guest.run(`
      const replacement=SlapsEngine.getExposedCards(gameState.playerHand).find(card=>card.laneIndex===lane);
      const stillCovered=gameState.playerHand.find(card=>card.laneIndex===lane&&card!==replacement);
      tryFlipCard(stillCovered.element,stillCovered);
    `);
    flush();
    assert.equal(guest.run('stillCovered.isFaceUp'), false);
    assert.equal(guest.run('replacement.element.dataset.covered'), 'false');
    guest.run('tryFlipCard(replacement.element,replacement);');
    flush();
    assert.equal(guest.run('replacement.isFaceUp'), true);
    assert.equal(guest.run('gameState.playerHand.filter(card=>card.isFaceUp).length'), 4);
    assert.equal(tally(host, 'aiHand.filter(card=>card.isFaceUp).length'), 4);
    assert.ok(cardsAreUnique(host) && cardsAreUnique(guest));
});

test('a match-winning final peer release closes the slap window and preserves both card sets', () => {
    const {host, guest, packets, flush, tally, cardsAreUnique} = pairedMatch();
    host.run(`
      SlapsEngine.initializeMatch(gameState);
      const cards=[...gameState.playerRoundCards.splice(0),...gameState.aiRoundCards.splice(0)];
      const take=(rank,suit)=>cards.splice(cards.findIndex(card=>card.rank===rank&&card.suit===suit),1)[0];
      const final=take('7','hearts'); final.owner='player';final.isFaceUp=true;
      const left=take('7','clubs'); const right=take('6','hearts');
      const other=take('8','diamonds');other.owner='ai';other.isFaceUp=true;
      gameState.playerHand=[final];gameState.aiHand=[other];
      gameState.centerPileLeft=cards.concat(left);gameState.centerPileRight=[right];
      gameState.phase='active';gameState.gameActive=true;gameState.matchLive=true;gameState.roundStarted=true;
      assignNetworkIds([...gameState.aiHand,...gameState.playerHand,...gameState.centerPileLeft,...gameState.centerPileRight]);
      sendAuthoritative('ROUND_START',{state:buildGuestState()});
    `);
    flush();
    host.run('requestMoveToHost(final,"right");');
    assert.deepEqual(packets.map(([, packet]) => packet.type), ['MOVE_APPLY', 'MATCH_OVER']);
    assert.equal(packets[0][1].apply.finishedRound, true);
    flush();
    assert.equal(tally(host, 'p1Rounds'), 1);
    assert.equal(tally(guest, 'aiRounds'), 1);
    assert.equal(tally(host, 'matchEnded'), true);
    assert.equal(tally(guest, 'matchEnded'), true);
    assert.equal(tally(host, 'slapActive'), false);
    assert.equal(tally(guest, 'slapActive'), false);
    guest.ctx.handleInput({code:'Space', preventDefault(){}});
    assert.equal(packets.length, 0);
    assert.ok(cardsAreUnique(host) && cardsAreUnique(guest));
});

test('24 seeded peer matches carry legal moves, releases, slaps and restarts through both controllers', t => {
    const totals = {matches: 0, actions: 0, rounds: 0, slaps: 0};
    for (let seed = 1; seed <= 24; seed++) {
        const {host, guest, flush, tally, cardsAreUnique} = pairedMatch(seed);
        const peers = [host, guest];
        let action = 0;
        host.ctx.startRoundHostAuthoritative();
        flush();
        for (; action < 5000 && !tally(host, 'matchEnded'); action++) {
            const phase = tally(host, 'phase');
            const actor = peers[(action + seed) % peers.length];
            if (phase === 'round_over') {
                host.ctx.startRoundHostAuthoritative();
            } else if (tally(host, 'slapActive') && (action + seed) % 3 !== 0) {
                actor.ctx.handleInput({code: 'Space', preventDefault(){}});
            } else if (phase === 'awaiting_reveal' || host.run('SlapsEngine.canRestart(gameState)')) {
                for (const peer of peers) {
                    peer.ctx.handlePlayerDeckClick();
                    flush();
                }
                assert.equal(tally(host, 'countdownRunning'), true, `seed ${seed}, action ${action}`);
                host.ctx.performRevealHostOnly();
            } else {
                const order = [actor, peers.find(peer => peer !== actor)];
                const acted = order.some(peer => peer.run(`
                    (() => {
                        const hand = gameState.playerHand;
                        const flip = SlapsEngine.getExposedCards(hand).find(card => SlapsEngine.canFlipCard(hand, card).ok);
                        const play = SlapsEngine.availableMoves(gameState, 'player')[0];
                        if (play) requestMoveToHost(play.card, play.side);
                        else if (flip) tryFlipCard(flip.element, flip);
                        return Boolean(play || flip);
                    })()
                `));
                assert.equal(acted, true, `seed ${seed}, action ${action}`);
            }
            flush();
            assert.ok(cardsAreUnique(host) && cardsAreUnique(guest), `seed ${seed}, action ${action}`);
            assert.equal(tally(host, 'phase'), tally(guest, 'phase'), `seed ${seed}, action ${action}`);
        }
        assert.ok(action < 5000, `seed ${seed} stalled`);
        assert.equal(tally(guest, 'matchEnded'), true, `seed ${seed}`);
        totals.matches++;
        totals.actions += action;
        totals.rounds += tally(host, 'p1Rounds + gameState.aiRounds');
        totals.slaps += tally(host, 'p1Slaps + gameState.aiSlaps');
    }
    t.diagnostic(JSON.stringify(totals));
});
