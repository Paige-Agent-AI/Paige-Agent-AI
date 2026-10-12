import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {refuseLegacyQuickBooksWrite} from '../../../supabase/functions/_shared/finance/quickbooks-write-isolation.ts';
function handler(slug:string,getUser=vi.fn(async()=>({data:{user:{id:'controlled-user'}},error:null}))){
 const source=readFileSync(`supabase/functions/${slug}/index.ts`,'utf8');
 const code=source.slice(source.indexOf('serve(async')).replace(/^serve\(/,'return (').replace(/\);\s*$/,' );');
 const privateAccess=vi.fn(()=>{throw Error('Forbidden private/provider operation');}),clients:string[]=[];
 const createClient=(_url:string,key:string)=>{clients.push(key);if(key!=='controlled-anon')throw Error('Privileged client');return{auth:{getUser},from:privateAccess,rpc:privateAccess,functions:{invoke:privateAccess}};};
 const run=new Function('createClient','Deno','refuseLegacyQuickBooksWrite','corsHeaders','fetch',ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(createClient,{env:{get:(key:string)=>({SUPABASE_URL:'https://controlled.invalid',SUPABASE_ANON_KEY:'controlled-anon',SUPABASE_SERVICE_ROLE_KEY:'forbidden-service'})[key]}},refuseLegacyQuickBooksWrite,{},privateAccess) as(request:Request)=>Promise<Response>;
 return{run,clients,getUser,privateAccess};
}
const request=(method='POST',authorization:string|undefined='Bearer controlled-user',body='{}')=>new Request('https://controlled.invalid/functions/v1/path?code=PRIVATE_CODE&state=CLIENT_ENCODED_ID&realmId=OTHER_REALM',{method,headers:authorization?{Authorization:authorization}:{},...(method==='POST'?{body}:{})});
describe.each(['quickbooks-oauth-initiate','quickbooks-refresh-token','quickbooks-disconnect'])('actual %s lifecycle isolation',slug=>{
 it.each(['{}','invalid JSON',JSON.stringify({user_id:'other-user',businessId:'other-company',connectionId:'other-connection',environment:'production'})])('refuses authenticated request without source or effects',async body=>{
  const h=handler(slug),r=await h.run(request('POST','Bearer controlled-user',body));expect(r.status).toBe(503);
  expect(await r.json()).toMatchObject({error:'PROVIDER_LIFECYCLE_UNAVAILABLE',provider_effect:false});expect(h.clients).toEqual(['controlled-anon']);expect(h.getUser).toHaveBeenCalledOnce();expect(h.privateAccess).not.toHaveBeenCalled();expect(r.headers.get('Cache-Control')).toBe('no-store');
 });
 it.each(['','Basic user','Bearer user extra'])('refuses invalid authentication before client creation',async authorization=>{
  const h=handler(slug),r=await h.run(request('POST',authorization));expect(r.status).toBe(401);expect(h.clients).toEqual([]);expect(h.privateAccess).not.toHaveBeenCalled();
 });
 it('refuses revoked actor and sanitizes Auth errors',async()=>{
  const auth=vi.fn(async()=>({data:{user:null},error:{message:'PRIVATE_AUTH_ERROR'}}));const h=handler(slug,auth as never),r=await h.run(request());expect(r.status).toBe(401);expect(await r.text()).not.toContain('PRIVATE_AUTH_ERROR');expect(h.privateAccess).not.toHaveBeenCalled();
 });
 it.each(['GET','PUT','DELETE'])('refuses unsupported %s before Auth or effects',async method=>{const h=handler(slug),r=await h.run(request(method));expect(r.status).toBe(405);expect(h.clients).toEqual([]);expect(h.getUser).not.toHaveBeenCalled();});
 it('allows effect-free preflight',async()=>{const h=handler(slug),r=await h.run(request('OPTIONS'));expect(r.status).toBe(204);expect(h.clients).toEqual([]);});
});
describe('actual legacy QuickBooks callback refusal',()=>{
 it('does not inspect client state or exchange code, activate, sync, revoke or leak secrets',async()=>{
  const h=handler('quickbooks-oauth-callback'),r=await h.run(request('GET'));expect(r.status).toBe(503);expect(await r.text()).not.toMatch(/PRIVATE_CODE|CLIENT_ENCODED_ID|OTHER_REALM/);expect(h.clients).toEqual([]);expect(h.privateAccess).not.toHaveBeenCalled();expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
 });
 it.each(['POST','PUT','DELETE'])('refuses %s without authority or provider access',async method=>{const h=handler('quickbooks-oauth-callback'),r=await h.run(request(method));expect(r.status).toBe(405);expect(h.clients).toEqual([]);expect(h.privateAccess).not.toHaveBeenCalled();});
 it('allows effect-free callback preflight',async()=>{const h=handler('quickbooks-oauth-callback'),r=await h.run(request('OPTIONS'));expect(r.status).toBe(204);expect(h.clients).toEqual([]);});
});
