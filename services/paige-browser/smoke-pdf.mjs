// Exercise the Docker COPY file set, not the working source tree. No tenant data or provider calls.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const service=path.dirname(fileURLToPath(import.meta.url));
const stage=fs.mkdtempSync(path.join(service,'.pdf-smoke-'));
const files=fs.readFileSync(path.join(service,'Dockerfile'),'utf8').split('\n').filter(l=>/^COPY /.test(l)).flatMap(l=>l.trim().split(/\s+/).slice(1,-1));
assert(files.includes('pdf.mjs'),'PDF module must ship in the existing browser image');
for(const file of files)fs.copyFileSync(path.join(service,file),path.join(stage,file));
// Resolution ascends to the service's existing dependencies, exactly as the image installs them.
const port=5291,secret='synthetic-pdf-smoke-secret',base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[path.join(stage,'server.js')],{env:{...process.env,PORT:String(port),PAIGE_BROWSER_SHARED_SECRET:secret},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});let output='';server.stdout.on('data',v=>output+=v);server.stderr.on('data',v=>output+=v);
try{let ready=false;for(let n=0;n<150;n++){if(server.exitCode!==null)throw Error(`Packaged server exited: ${output}`);try{ready=(await fetch(`${base}/healthz`)).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert(ready,'Packaged server must start: '+output);
const post=(html,key=secret)=>fetch(`${base}/pdf`,{method:'POST',headers:{'Content-Type':'application/json','X-Browser-Secret':key},body:JSON.stringify({html})});
assert.equal((await post('<!doctype html><html><body>Invoice</body></html>','wrong')).status,401);
assert.equal((await post('<!doctype html><script>for(;;){}</script>')).status,400);
const response=await post('<!doctype html><html><head></head><body><h1>Invoice INV-42</h1><p>Outstanding $700.00</p><img src="http://127.0.0.1:1/private"></body></html>');assert.equal(response.status,200);assert(response.headers.get('content-type').startsWith('application/pdf'));assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
console.log('PASS packaged browser startup, existing health endpoint, PDF authentication/validation and real network-isolated PDF bytes');
execFileSync(process.execPath,[path.join(stage,'pdf-live-proof.mjs')],{env:{...process.env,PORT:String(port),PAIGE_BROWSER_SHARED_SECRET:secret},stdio:'inherit'});
}finally{if(server.exitCode===null&&server.signalCode===null){if(process.platform==='win32')server.kill('SIGKILL');else process.kill(-server.pid,'SIGKILL');}await new Promise(r=>server.exitCode!==null||server.signalCode!==null?r():server.once('exit',r));server.stdout.destroy();server.stderr.destroy();const resolved=path.resolve(stage);assert(resolved.startsWith(path.resolve(service)+path.sep)&&path.basename(resolved).startsWith('.pdf-smoke-'));fs.rmSync(resolved,{recursive:true,force:true});}
