// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';

const config=JSON.parse(readFileSync('vercel.json','utf8'));
const fallback=config.rewrites.find((route:{destination:string})=>route.destination==='/index.html');
const matches=(pathname:string)=>new RegExp(`^${fallback.source}$`).test(pathname);
const originalIntegrity='6c1317af6077425bfcbd3c4765dac1c7b837fde585d0c26286d0c29de8f880ff';
const inverse=structuredClone(config);
inverse.rewrites[3].source='/(.*)';
if(!inverse.headers.some((r:{source:string})=>r.source==='/assets/(.*)'))inverse.headers.splice(4,0,{source:'/assets/(.*)',headers:[{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]});
const assetPaths=['/assets/missing.js','/assets/missing.css','/assets/chunks/missing.js','/assets/missing.woff2','/assets/missing.wasm','/assets/main-test.js','/assets/worker-test.mjs','/assets/icon-test.svg'];
const configuredCache=(pathname:string)=>config.headers.filter((r:{source:string})=>new RegExp(`^${r.source}$`).test(pathname)).flatMap((r:{headers:Array<{key:string;value:string}>})=>r.headers).filter((h:{key:string})=>h.key.toLowerCase()==='cache-control').map((h:{value:string})=>h.value);

describe('public application asset delivery',()=>{
  it.each(['/assets/missing.js','/assets/missing.css','/assets/chunks/missing.js','/assets/missing.woff2','/assets/missing.wasm','/assets/main-test.js','/assets/worker-test.mjs','/assets/icon-test.svg'])('never substitutes app HTML for %s',pathname=>{expect(matches(pathname)).toBe(false);});
  it.each(['/','/app','/app/messages','/app/documents','/app/settings','/portal/test-business','/solo/test-account/clients/portal','/book/test-service','/sign/test-token','/assets-and-guides'])('keeps the original SPA entrance for %s',pathname=>{expect(matches(pathname)).toBe(true);});
  it('preserves the special auth and legal documents',()=>{expect(config.rewrites.slice(0,3)).toEqual([{source:'/privacy',destination:'/privacy.html'},{source:'/sms-terms',destination:'/sms-terms.html'},{source:'/auth',destination:'/auth.html'}]);});
  it('restores the complete original config by undoing only the fallback exclusion and blanket cache removal',()=>{expect(createHash('sha256').update(JSON.stringify(inverse)).digest('hex')).toBe(originalIntegrity);});
  it('keeps security and every non-asset cache header unchanged',()=>{expect(config.headers[0].headers.find((h:{key:string})=>h.key==='X-Content-Type-Options')?.value).toBe('nosniff');expect(config.headers[0].headers.some((h:{key:string})=>h.key==='Content-Security-Policy')).toBe(true);expect(configuredCache('/index.html')).toEqual(['no-cache, no-store, must-revalidate']);expect(configuredCache('/sw.js')).toEqual(['no-cache, no-store, must-revalidate']);expect(configuredCache('/embed.js')).toEqual(['public, max-age=300, must-revalidate']);});
  it.each(assetPaths)('never makes a missing response permanently fresh at %s',pathname=>{expect(configuredCache(pathname).some(value=>/immutable|max-age=31536000/.test(value))).toBe(false);});
  it('does not introduce another serving runtime or access/protection config',()=>{expect(Object.keys(config).sort()).toEqual(['$schema','headers','installCommand','rewrites']);});
});
