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

describe('public application asset delivery',()=>{
  it.each(['/assets/missing.js','/assets/missing.css','/assets/chunks/missing.js','/assets/missing.woff2','/assets/missing.wasm','/assets/main-test.js','/assets/worker-test.mjs','/assets/icon-test.svg'])('never substitutes app HTML for %s',pathname=>{expect(matches(pathname)).toBe(false);});
  it.each(['/','/app','/app/messages','/app/documents','/app/settings','/portal/test-business','/solo/test-account/clients/portal','/book/test-service','/sign/test-token','/assets-and-guides'])('keeps the original SPA entrance for %s',pathname=>{expect(matches(pathname)).toBe(true);});
  it('preserves the special auth and legal documents',()=>{expect(config.rewrites.slice(0,3)).toEqual([{source:'/privacy',destination:'/privacy.html'},{source:'/sms-terms',destination:'/sms-terms.html'},{source:'/auth',destination:'/auth.html'}]);});
  it('restores the complete original config by undoing only the fallback source',()=>{expect(createHash('sha256').update(JSON.stringify(inverse)).digest('hex')).toBe(originalIntegrity);});
  it('keeps the existing real-asset and security headers unchanged',()=>{expect(config.headers.find((r:{source:string})=>r.source==='/assets/(.*)').headers).toEqual([{key:'Cache-Control',value:'public, max-age=31536000, immutable'}]);expect(config.headers[0].headers.find((h:{key:string})=>h.key==='X-Content-Type-Options')?.value).toBe('nosniff');expect(config.headers[0].headers.some((h:{key:string})=>h.key==='Content-Security-Policy')).toBe(true);});
  it('does not introduce another serving runtime or access/protection config',()=>{expect(Object.keys(config).sort()).toEqual(['$schema','headers','installCommand','rewrites']);});
});
