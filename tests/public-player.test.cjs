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
