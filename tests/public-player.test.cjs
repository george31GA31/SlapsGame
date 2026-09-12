const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('public player projection excludes private fields and unknown properties',()=>{
 const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public-player.js','utf8'),ctx);
 const result=ctx.window.ISFPublicPlayer.fromPrivate({username:'TEST',email:'private@example.invalid',firstName:'Private',lastName:'Name',history:{},photo:'secret',elo:1200,wins:2});
 for(const key of ['email','firstName','lastName','history','photo'])assert.equal(key in result,false);
 assert.equal(result.username,'TEST');assert.equal(result.elo,1200);assert.equal(result.wins,2);
});
test('free-plan rules separate public cards from owner-only account records',()=>{
 const r=JSON.parse(fs.readFileSync('database.rules.free-plan.json')).rules;
 assert.equal(r['.read'],false);assert.equal(r['.write'],false);
 assert.equal(r.publicPlayers['.read'],true);
 assert.equal(r.users.$uid['.read'],'auth != null && auth.uid === $uid');
 assert.equal(r.publicPlayers.$uid.$other['.validate'],false);
 assert.equal(r.competitions['.write'],false);
});
test('migration restores every registered player without copying account secrets',()=>{
 const {project}=require('../scripts/migrate-public-players.cjs');
 const output=project({users:{george:{username:'George A',email:'secret'},alice:{username:'Alice',firstName:'Private',elo:0},bob:{username:'Bob',wins:4},guest:{username:'Guest',isGuest:true}}});
 assert.deepEqual(Object.keys(output),['george','alice','bob']);
 assert.equal(output.alice.elo,0);assert.equal(output.bob.wins,4);
 assert.equal(JSON.stringify(output).includes('secret'),false);assert.equal(JSON.stringify(output).includes('Private'),false);
});
test('player mirror follows auth and profile changes on any page, with no duplicate writes',async()=>{
 const writes=[],callbacks={},auth={currentUser:{uid:'alice',isAnonymous:false},onAuthStateChanged(cb){this.changed=cb;}};
 const root={auth,db:{ref(path){return {on(n,cb){callbacks[path]=cb;},off(){},set:async data=>writes.push({path,data})};}}};
 const ctx={window:root};vm.createContext(ctx);vm.runInContext(fs.readFileSync('public-player.js','utf8'),ctx);
 auth.changed(auth.currentUser);
 const snapshot={exists:()=>true,val:()=>({username:'Alice',wins:1,email:'secret'})};
 callbacks['users/alice'](snapshot);callbacks['users/alice'](snapshot);await Promise.resolve();
 assert.equal(writes.length,1);assert.equal(writes[0].path,'publicPlayers/alice');
 auth.currentUser={uid:'bob',isAnonymous:false};auth.changed(auth.currentUser);
 callbacks['users/alice']({...snapshot,val:()=>({username:'Alice',wins:2})});
 callbacks['users/bob']({...snapshot,val:()=>({username:'Bob',wins:3})});
 await Promise.resolve();assert.equal(writes.length,2);assert.equal(writes[1].path,'publicPlayers/bob');
});
test('every page has exactly the requested favicon and the root asset exists',()=>{
 for(const file of fs.readdirSync('.').filter(f=>f.endsWith('.html'))){
  const html=fs.readFileSync(file,'utf8'),head=html.split('</head>')[0];
  assert.equal((head.match(/<link rel="icon" href="ISF_favicon.png">/g)||[]).length,1,file);
 }
 assert.ok(fs.statSync('ISF_favicon.png').size>0);
});
