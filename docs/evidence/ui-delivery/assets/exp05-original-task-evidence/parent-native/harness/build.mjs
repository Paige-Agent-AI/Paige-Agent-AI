import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
const pin='d0a27ccd726566c093bda2beafd7610e49a70d54';
const out=path.resolve('work/original-task-evidence-native/hydrated');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>execFileSync('git',['show',pin+':'+p]);
const inputs={};
for(const [source,target] of [['src/solo/owner-task-automations.tsx','parent.tsx'],['src/solo/owner-task-process-history.tsx','owner-task-process-history.tsx']]){
  const bytes=read(source); await fs.writeFile(path.join(out,target),bytes); inputs[source]=sha(bytes);
}
const bundle=await build({entryPoints:[path.join(out,'fixture.tsx')],bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('src')},metafile:true,plugins:[{name:'existing-native-fixture-ports',setup(b){b.onResolve({filter:/^\.\/data\/useOwnerTaskAutomations$/},()=>({path:path.join(out,'ports.tsx')}));}}]});
for(const p of Object.keys(bundle.metafile.inputs).filter(x=>x.startsWith('src/'))){
  const actual=await fs.readFile(p),original=read(p);
  if(actual.toString().replaceAll('\r\n','\n')!==original.toString().replaceAll('\r\n','\n'))throw Error('Unpinned source dependency: '+p);
  inputs[p]=sha(original);
}
const font=await fs.readFile('public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2');
const css=read('src/index.css')+'\n'+read('src/solo/settings-integrations.css')+`\n@font-face{font-family:'Schibsted Grotesk';font-weight:100 900;src:url(data:font/woff2;base64,${font.toString('base64')})}body{margin:0;font-family:'Schibsted Grotesk',sans-serif;background:var(--pg-canvas);color:var(--pg-ink)}.paige-solo{min-height:100vh;background:var(--pg-canvas);color:var(--pg-ink)}.fixture-controls{padding:12px;background:var(--pg-raised)}.fixture-controls p{font-size:13px;margin:0 0 8px}.fixture-controls button{min-height:44px;margin:3px;padding:8px;color:var(--pg-ink);background:var(--pg-surface);border:1px solid var(--pg-line)}main{max-width:900px;margin:0 auto;padding:16px}`;
await fs.writeFile(path.join(out,'bundle.js'),bundle.outputFiles[0].contents);
await fs.writeFile(path.join(out,'style.css'),css);
await fs.writeFile(path.join(out,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self';font-src data:;connect-src 'none';form-action 'none';base-uri 'none'"><title>Original Task parent — neutral native QA</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
inputs['src/index.css']=sha(read('src/index.css'));inputs['src/solo/settings-integrations.css']=sha(read('src/solo/settings-integrations.css'));
const manifest={pin,inputs,componentTransform:'NONE: both original parent and history component byte-exact from Git',portBoundary:'Synthetic hook read/history state in memory only; no actual hook authority, authentication, network, provider, persistence or business effects',cssSHA256:sha(css),bundleSHA256:sha(bundle.outputFiles[0].contents)};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
