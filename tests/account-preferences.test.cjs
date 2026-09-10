const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const tick=()=>new Promise(setImmediate);
function accountFixture(guest=false){
 const els=new Map(), saved=new Map(), updates=[];
 function element(id){if(!els.has(id))els.set(id,{value:'',hidden:true,textContent:'',disabled:false,events:{},append(){},addEventListener(n,fn){this.events[n]=fn},querySelector(){return element(id+'-button')}});return els.get(id);}
 const user={uid:'member',email:'old@example.invalid',isAnonymous:false,async updateProfile(p){user.displayName=p.displayName},async verifyBeforeUpdateEmail(email){user.verification=email}};
 const auth={currentUser:user,onAuthStateChanged(cb){cb(user)},async sendPasswordResetEmail(email){auth.reset=email}};
 const ctx={auth,ISFSession:{isGuest:()=>guest},ISFCountries:[{code:'GBR',flag:'assets/flags/United Kingdom.png',name:'United Kingdom'}],
 document:{getElementById:element,createElement:()=>({})},localStorage:{setItem:(k,v)=>saved.set(k,v)},
 db:{ref(path){return{once:async()=>({exists:()=>true,val:()=>({firstName:'Test',lastName:'Player',username:'TEST',country:'GBR',elo:1234,wins:50})}),update:async patch=>updates.push({path,patch})}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('account.js','utf8'),ctx);
 const fire=id=>element(id).events.submit?.({preventDefault(){},currentTarget:element(id)});
 return {ctx,els,element,updates,saved,fire,user};
}
test('profile editing updates only personal fields for the authenticated account',async()=>{
 const f=accountFixture();await tick();f.element('username').value='updated';f.fire('account-form');await tick();
 assert.equal(f.updates.length,1);assert.equal(f.updates[0].path,'users/member');
 assert.deepEqual(Object.keys(f.updates[0].patch).sort(),['country','firstName','flag','lastName','username']);
 assert.equal(f.saved.get('isf_username'),'UPDATED');assert.equal(f.user.displayName,'UPDATED');
 assert.equal(f.element('account-status').textContent,'Profile saved.');
});
test('guest or changed account cannot save a profile',async()=>{
 for(const guest of [true,false]){const f=accountFixture(guest);await tick();if(!guest)f.ctx.auth.currentUser={uid:'other'};f.fire('account-form');await tick();assert.equal(f.updates.length,0);}
});
test('email changes require verification and password resets use the authenticated email',async()=>{
 const f=accountFixture();await tick();f.element('new-email').value='new@example.invalid';f.fire('email-form');await tick();
 assert.equal(f.user.verification,'new@example.invalid');assert.equal(f.user.email,'old@example.invalid');assert.equal(f.updates.length,0);
 f.element('reset-password').events.click({currentTarget:f.element('reset-password')});await tick();assert.equal(f.ctx.auth.reset,'old@example.invalid');
});
test('theme survives session clearing and restores on the next page',()=>{
 const values={slaps_theme:'light',isf_username:'Member'}, root={dataset:{}};
 const storage={...values,getItem:k=>values[k],setItem:(k,v)=>values[k]=v,removeItem:k=>delete values[k]};
 const ctx={document:{documentElement:root},localStorage:storage,addEventListener(){}};ctx.window=ctx;
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('preferences.js','utf8'),ctx);assert.equal(root.dataset.theme,'light');
 vm.runInContext(fs.readFileSync('session.js','utf8'),ctx);ctx.ISFSession.clear();assert.equal(values.isf_username,undefined);assert.equal(values.slaps_theme,'light');
 ctx.ISFPreferences.setTheme('dark');vm.runInContext(fs.readFileSync('preferences.js','utf8'),ctx);assert.equal(root.dataset.theme,'dark');assert.equal(values.slaps_theme,'dark');
});
