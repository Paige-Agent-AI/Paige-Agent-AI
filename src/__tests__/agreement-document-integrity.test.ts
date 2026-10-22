// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import {it,expect} from 'vitest';
import {sha256Hex,tokenState} from '../../supabase/functions/_shared/agreements/token';
import {isPortalDoorRequest,resolvePortalDocument} from '../../supabase/functions/_shared/agreements/portal-door';
import {verifyRetainedAgreementPdf} from '../../supabase/functions/_shared/agreements/retained-document';

// Reuse the existing actual-Edge-source execution pattern from Collections.
// Auth/query/Storage transports are synthetic. These are not real JWT/provider,
// PDF-layout, signer, business-account or customer-acceptance proofs.
const source=readFileSync('supabase/functions/agreement-document/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
const compiled=transpileModule(source,{compilerOptions:{module:ModuleKind.None,target:ScriptTarget.ES2022}}).outputText;
// Keep this Deno module in its own compiler/runtime boundary, as the endpoint
// above. Importing it into the app's non-strict TypeScript graph changes its
// discriminated-union checking. Execute the original export, not a copied regex;
// the original strict Deno suite and Edge type check remain separate requirements.
const guardSource=readFileSync('supabase/functions/_shared/agreements/signing-guard.ts','utf8').replace(/^import .*;\r?\n/gm,'');
const guardExports:{TOKEN_SHAPE?:RegExp}={};
new Function('exports','tokenState',transpileModule(guardSource,{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText)(guardExports,tokenState);
const TOKEN_SHAPE=guardExports.TOKEN_SHAPE;
if(!(TOKEN_SHAPE instanceof RegExp))throw Error('Original signing token shape export was not loaded');
const tenant='11111111-1111-4111-8111-111111111111';
const agreement='22222222-2222-4222-8222-222222222222';
const person='33333333-3333-4333-8333-333333333333';
const foreign='44444444-4444-4444-8444-444444444444';
const token='a'.repeat(64);
const bytes=new TextEncoder().encode('%PDF-1.7\nControlled original bytes; not a real signed document.');
const digest=createHash('sha256').update(bytes).digest('hex');
type Door='owner'|'token'|'portal';
type Options={corrupted?:boolean;body?:Uint8Array;storedDigest?:unknown;role?:boolean;tenant?:string;status?:string;revoked?:boolean;expired?:boolean;storageError?:boolean;bodyThrows?:boolean;portalScopeError?:boolean;portalActorChanged?:boolean};
function setup(door:Door,options:Options={}){
  let handler!:(request:Request)=>Promise<Response>,authReads=0;
  const calls:{table:string;columns:string;filters:[string,unknown][]}[]=[],downloads:string[]=[];
  const sealedKey=`${tenant}/${agreement}/sealed-fixture.pdf`,contentKey=`${tenant}/${agreement}/presented-fixture.pdf`;
  const actual=(options.body??bytes).slice();if(options.corrupted)actual[actual.length-1]^=1;
  const stored='storedDigest' in options?options.storedDigest:digest;
  const records:Record<string,Record<string,unknown>[]>= {
    paige_agreement_signers:[{agreement_id:agreement,token_hash:createHash('sha256').update(token).digest('hex'),token_expires_at:options.expired?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z',token_revoked_at:options.revoked?'2026-01-01T00:00:00Z':null}],
    paige_agreements:[{id:agreement,tenant_id:tenant,title:'Synthetic retained document',status:options.status??'completed',content_storage_key:contentKey,content_sha256:stored,sealed_storage_key:sealedKey,sealed_sha256:stored}],
  };
  const service={from:(table:string)=>{
    const call={table,columns:'',filters:[] as [string,unknown][]};calls.push(call);
    const query={select:(columns:string)=>{call.columns=columns;return query;},eq:(key:string,value:unknown)=>{call.filters.push([key,value]);return query;},maybeSingle:async()=>{
      const rows=(records[table]??[]).filter(row=>call.filters.every(([key,value])=>row[key]===value));
      if(rows.length>1)return {data:null,error:{code:'AMBIGUOUS'}};
      return {data:rows.length?Object.fromEntries(call.columns.split(',').map(key=>[key,rows[0][key]])):null,error:null};
    }};return query;
  },storage:{from:(bucket:string)=>{expect(bucket).toBe('paige-agreements');return {download:async(path:string)=>{
    downloads.push(path);
    if(options.storageError)return {data:null,error:{message:'Synthetic private provider detail'}};
    const data=options.bodyThrows?{size:actual.length,arrayBuffer:async()=>{throw Error('Synthetic private body detail');}}:new Blob([actual]);
    return {data,error:null};
  }}}}};
  const caller={auth:{getUser:async()=>({data:{user:{id:options.portalActorChanged&&++authReads>1?foreign:person}},error:null})},rpc:async(name:string,args?:Record<string,unknown>)=>{
    if(name==='current_user_tenant_id')return {data:options.tenant??tenant,error:null};
    if(name==='is_tenant_admin')return {data:options.role??true,error:null};
    if(name==='client_portal_agreement_document_scope')return {data:options.portalScopeError?null:{agreement_id:args?.p_agreement_id,tenant_id:tenant,title:'Synthetic retained document'},error:null};
    throw Error('Unexpected original scope RPC');
  }};
  const scope={createClient:(_url:string,key:string)=>key==='SUPABASE_ANON_KEY'?caller:service,overRateLimit:async()=>false,trustedClientIp:()=> '127.0.0.1',sha256Hex,TOKEN_SHAPE,isPortalDoorRequest,resolvePortalDocument,verifyRetainedAgreementPdf,
    Deno:{env:{get:(key:string)=>key},serve:(fn:typeof handler)=>{handler=fn;}},console:{error:()=>undefined}};
  new Function(...Object.keys(scope),compiled)(...Object.values(scope));
  const params=new URLSearchParams(door==='token'?{token}:{agreementId:agreement,...(door==='portal'?{portal:'1',tenantId:tenant}:{})});
  return {calls,downloads,records,request:(extra:Record<string,string>={})=>{
    const query=new URLSearchParams(params);for(const [key,value] of Object.entries(extra))query.set(key,value);
    return handler(new Request(`https://unit-test.invalid/agreement-document?${query}`,{headers:door==='token'?{}:{Authorization:'Bearer synthetic-unit-session'}}));
  }};
}

for(const door of ['owner','token','portal'] as const){
  for(const storedDigest of [null,undefined,'invalid','A'.repeat(64)]){
    it(`${door} with an unverified stored checksum cannot return a document`,async()=>{
      const response=await setup(door,{storedDigest}).request();expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ok:false,error:'This document is temporarily unavailable. Please try again shortly.'});
    });
  }
  it(`${door} body-read interruption remains recoverable without leaking private details`,async()=>{
    const response=await setup(door,{bodyThrows:true}).request();expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('Synthetic private');
  });
  it(`${door} storage failure keeps the existing unavailable response`,async()=>{
    const response=await setup(door,{storageError:true}).request();expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('Synthetic private');
  });
  it(`${door} uses its authorized record digest rather than a foreign record with the same key`,async()=>{
    const test=setup(door);test.records.paige_agreements[0].sealed_sha256='b'.repeat(64);
    test.records.paige_agreements.push({...test.records.paige_agreements[0],id:foreign,tenant_id:foreign,sealed_sha256:digest});
    expect((await test.request()).status).toBe(503);
  });
  it(`${door} does not return non-PDF content even with a matching checksum`,async()=>{
    const body=new TextEncoder().encode('Not a PDF');
    expect((await setup(door,{body,storedDigest:createHash('sha256').update(body).digest('hex')}).request()).status).toBe(503);
  });
}
for(const status of ['sent','viewed','partially_signed']){
  it(`the original ${status} token opens the verified presented copy, not the sealed digest`,async()=>{
    const test=setup('token',{status});test.records.paige_agreements[0].sealed_sha256='b'.repeat(64);
    const response=await test.request();expect(response.status).toBe(200);
    expect(test.downloads[0]).toContain('/presented-fixture.pdf');expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
}
for(const door of ['owner','token','portal'] as const){
  it(`completed ${door} opens only the original sealed digest`,async()=>{
    const test=setup(door);test.records.paige_agreements[0].content_sha256='b'.repeat(64);
    expect((await test.request()).status).toBe(200);expect(test.downloads[0]).toContain('/sealed-fixture.pdf');
  });
}
for(const [name,door,options] of [
  ['non-admin','owner',{role:false}],['foreign workspace','owner',{tenant:foreign}],
  ['revoked token','token',{revoked:true}],['expired token','token',{expired:true}],
  ['unconfirmed portal relationship','portal',{portalScopeError:true}],['changed portal actor','portal',{portalActorChanged:true}],
] as const){
  it(`${name} preserves the original uniform refusal before Storage`,async()=>{
    const test=setup(door,options),response=await test.request();expect(response.status).toBe(404);
    expect(test.downloads).toHaveLength(0);expect(await response.json()).toEqual({ok:false,error:'This link is not valid. Ask the sender for a new copy.'});
  });
}
it('a retrieval token cannot be redirected by an agreementId parameter',async()=>{
  const test=setup('token'),response=await test.request({agreementId:foreign});expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);expect(test.downloads[0]).toContain(agreement);
});
it('malformed or unknown tokens retain the same refusal and never read Storage',async()=>{
  for(const value of ['malformed','b'.repeat(64)]){
    const test=setup('token'),response=await test.request({token:value});expect(response.status).toBe(404);expect(test.downloads).toHaveLength(0);
  }
});
it('Portal remains first, rejects foreign business narrowing and preserves authorized attachment headers',async()=>{
  const refused=setup('portal');expect((await refused.request({tenantId:foreign})).status).toBe(404);expect(refused.downloads).toHaveLength(0);
  const test=setup('portal'),response=await test.request({download:'1'});expect(response.status).toBe(200);
  expect(response.headers.get('Content-Disposition')).toContain('attachment;');
  const checksum=test.calls.find(call=>call.columns==='sealed_sha256');expect(checksum?.filters).toEqual([
    ['id',agreement],['sealed_storage_key',`${tenant}/${agreement}/sealed-fixture.pdf`],['status','completed'],
  ]);
});
for(const door of ['owner','token','portal'] as const){
  it(`positive ${door} preserves the original authorized retained bytes and private headers`,async()=>{
    const test=setup(door),response=await test.request();
    expect(response.status).toBe(200);expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(test.downloads).toHaveLength(1);expect(response.headers.get('Cache-Control')).toBe('no-store, private');
    expect(response.headers.get('Content-Type')).toBe('application/pdf');expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
  it(`corrupted ${door} bytes cannot be returned as the retained record`,async()=>{
    const test=setup(door,{corrupted:true}),response=await test.request();
    expect(response.status).toBe(503);const body=await response.json();
    expect(body.ok).toBe(false);expect(JSON.stringify(body)).not.toMatch(/fixture\.pdf|11111111|sha256|Synthetic private/);
  });
}
