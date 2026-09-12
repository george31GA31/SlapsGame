// Run locally: node scripts/migrate-public-players.cjs users-export.json > public-players.json
// Import output at /publicPlayers in Firebase Console, never at the database root.
const fs=require('node:fs');
const {fromPrivate}=require('../public-player.js');
function project(input){
 const users=input.users||input;
 if(!users||typeof users!=='object'||Array.isArray(users))throw Error('Expected a users export');
 const result={};
 for(const [uid,p] of Object.entries(users)){
  if(!p||typeof p!=='object'||typeof p.username!=='string'||p.isGuest||p.isAnonymous)continue;
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw Error('Unsupported account ID');
  result[uid]=fromPrivate(p);
 }
 return result;
}
module.exports={project};
if(require.main===module){
 try{if(!process.argv[2])throw Error('Supply the path to your local users JSON export');process.stdout.write(JSON.stringify(project(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2)+'\n');}
 catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}
