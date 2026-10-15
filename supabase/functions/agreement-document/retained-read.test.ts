import assert from 'node:assert/strict';
import {sha256Hex} from '../_shared/agreements/token.ts';

Deno.test('exact-token document delivery proves tenant, deadline and actual retained bytes',async()=>{
  const serve=Deno.serve,envGet=Deno.env.get,fetch=globalThis.fetch;
  let handler!:(request:Request)=>Promise<Response>;
  const tenant='10000000-0000-4000-8000-000000000001',agreementId='20000000-0000-4000-8000-000000000001';
  const bytes=new TextEncoder().encode('%PDF-1.7\nSynthetic retained read fixture'),digest=await sha256Hex(bytes);
  const base={id:agreementId,tenant_id:tenant,title:'Synthetic agreement',status:'sent',expires_at:'2099-10-15T00:00:00Z',content_storage_key:'synthetic/presented.pdf',content_sha256:digest,sealed_storage_key:'synthetic/sealed.pdf',sealed_sha256:digest};
  let agreement:Record<string,unknown>=base,reads=0,stored=bytes;
  const selected=(row:Record<string,unknown>,url:URL)=>Object.fromEntries((url.searchParams.get('select')??'').split(',').map(key=>[key,row[key]]));
  const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  try{
    Deno.serve=((callback:typeof handler)=>{handler=callback;return {} as never;}) as unknown as typeof Deno.serve;
    Deno.env.get=(name:string)=>name==='SUPABASE_URL'?'https://synthetic.invalid':name==='SUPABASE_SERVICE_ROLE_KEY'?'synthetic-not-a-credential':undefined;
    globalThis.fetch=async(input,init)=>{
      const request=new Request(input,init),url=new URL(request.url);assert.equal(url.origin,'https://synthetic.invalid');
      if(url.pathname==='/rest/v1/rpc/check_public_rate_limit'){assert.equal(request.method,'POST');return json(true);}
      assert.equal(request.method,'GET','document reader cannot write a signature/event');
      if(url.pathname==='/rest/v1/paige_agreement_signers')return json(selected({agreement_id:agreementId,tenant_id:tenant,token_expires_at:'2099-10-15T00:00:00Z',token_revoked_at:null},url));
      if(url.pathname==='/rest/v1/paige_agreements')return json(selected(agreement,url));
      if(url.pathname.startsWith('/storage/v1/object/')){reads++;return new Response(stored,{headers:{'Content-Type':'application/pdf'}});}
      throw new Error('Unexpected synthetic document transport: '+url.pathname);
    };
    await import('./index.ts');assert.equal(typeof handler,'function');
    const invoke=()=>handler(new Request('https://synthetic.invalid/agreement-document?token='+'a'.repeat(64)));
    let reply=await invoke();assert.equal(reply.status,200);assert.deepEqual(new Uint8Array(await reply.arrayBuffer()),bytes);assert.equal(reads,1);
    for(const row of [{...base,tenant_id:'10000000-0000-4000-8000-000000000002'},{...base,expires_at:'2000-01-01T00:00:00Z'}]){
      agreement=row;reads=0;reply=await invoke();assert.equal(reply.status,404);assert.equal(reads,0);
    }
    agreement={...base,status:'completed',expires_at:'2000-01-01T00:00:00Z'};reads=0;
    reply=await invoke();assert.equal(reply.status,200);assert.equal(reads,1);assert.deepEqual(new Uint8Array(await reply.arrayBuffer()),bytes);
    for(const row of [{...base,content_sha256:'b'.repeat(64)},{...base,status:'completed',sealed_sha256:null}]){
      agreement=row;reply=await invoke();assert.equal(reply.status,503);const response=await reply.json();assert.equal(response.ok,false);assert(!JSON.stringify(response).includes('synthetic/'));
    }
    agreement=base;stored=new TextEncoder().encode('%PDF-1.7\nchanged retained bytes');reply=await invoke();assert.equal(reply.status,503);
  }finally{Deno.serve=serve;Deno.env.get=envGet;globalThis.fetch=fetch;}
});
