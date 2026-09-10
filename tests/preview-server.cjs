// Isolated visual-test server: external auth/database/peer services are mocked.
// Static production files remain directly deployable without a build step.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const mock = () => fs.readFileSync(path.join(__dirname,'preview-fixtures.js'),'utf8');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.pdf':'application/pdf'};
http.createServer((req,res)=>{
 const url = new URL(req.url,'http://localhost');
 let file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/login.html' : url.pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 if(url.pathname === '/__mobile') {
  const page = url.searchParams.get('page') || 'login.html';
  const safePage = /^[a-z-]+\.html(?:\?(?:uid=qa-1|qaMember=1|qaPeer=(?:host|join)))?$/.test(page) ? page : 'login.html';
  res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><style>body{background:#252525;margin:24px}iframe{width:390px;height:844px;border:0}</style><iframe src="/' + safePage + '"></iframe>');return;
 }
 try {
  let data=fs.readFileSync(file);
  if(file.endsWith('.html')) data=Buffer.from(data.toString().replace(/<script src="https:\/\/[^\"]*(?:firebase[^\"]*|peerjs[^\"]*)"><\/script>/g,'').replace('<head>','<head><script>'+mock()+'</script>'));
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}).end(data);
 } catch {res.writeHead(404).end('Not found')}
}).listen(Number(option('--port',4173)),option('--host','127.0.0.1'),()=>console.log('Isolated SlapsGame QA preview ready'));
