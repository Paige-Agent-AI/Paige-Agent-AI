import assert from 'node:assert/strict';
import {sha256Hex} from '../_shared/agreements/token.ts';

// Exercise the deployed handler through its real supabase-js client. Every
// transport is intercepted; the test itself runs with network/env access denied.
// Successful preflight stops at a deliberately refused synthetic signature write.
Deno.test('the signing handler verifies the retained presentation before any terminal write',async()=>{
  const serve=Deno.serve,envGet=Deno.env.get,fetch=globalThis.fetch;
  let handler!:(request:Request)=>Promise<Response>;
  const tenant='10000000-0000-4000-8000-000000000001';
  const agreementId='20000000-0000-4000-8000-000000000001';
  const signerId='30000000-0000-4000-8000-000000000001';
  const body='Synthetic retained agreement text.';
  const bytes=new TextEncoder().encode('%PDF-1.7\nSynthetic retained transport fixture');
  let agreement:Record<string,unknown>={},storage:Response,terminalWrites=0,storageReads=0;
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  try{
    Deno.serve=((callback:typeof handler)=>{handler=callback;return {} as never;}) as unknown as typeof Deno.serve;
    Deno.env.get=(name:string)=>name==='SUPABASE_URL'?'https://synthetic.invalid':name==='SUPABASE_SERVICE_ROLE_KEY'?'synthetic-not-a-credential':undefined;
    globalThis.fetch=async(input,init)=>{
      const request=new Request(input,init),url=new URL(request.url);
      assert.equal(url.origin,'https://synthetic.invalid');
      if(url.pathname==='/rest/v1/rpc/check_public_rate_limit')return json(true);
      if(url.pathname==='/rest/v1/paige_agreement_signers'){
        if(request.method==='PATCH'){
          terminalWrites++;
          return json({message:'Synthetic write intentionally refused',code:'42501'},403);
        }
        if(request.method==='HEAD')return new Response(null,{headers:{'Content-Range':'0-0/0'}});
        const signer:Record<string,unknown>={id:signerId,agreement_id:agreementId,tenant_id:tenant,status:'pending',signing_order:1,full_name:'Synthetic Signer',email:'signer@example.invalid',token_hash:await sha256Hex('a'.repeat(64)),token_expires_at:'2099-10-15T00:00:00Z',token_revoked_at:null};
        return json(Object.fromEntries((url.searchParams.get('select')??'').split(',').map(key=>[key,signer[key]])));
      }
      if(url.pathname==='/rest/v1/paige_agreements')return json(agreement);
      if(url.pathname==='/rest/v1/tenants')return json({name:'Synthetic business',brand:{support_email:'support@example.invalid'}});
      if(url.pathname.startsWith('/storage/v1/object/')){storageReads++;return storage.clone();}
      throw new Error('Unexpected synthetic transport: '+request.method+' '+url.pathname);
    };
    await import('./index.ts');
    assert.equal(typeof handler,'function');
    const pdfDigest=await sha256Hex(bytes),textDigest=await sha256Hex(body);
    const base={id:agreementId,tenant_id:tenant,title:'Synthetic agreement',body_source:'paige',body_markdown:body,status:'sent',expires_at:'2099-10-15T00:00:00Z',content_storage_key:'synthetic/presented.pdf',content_sha256:pdfDigest};
    const invoke=()=>handler(new Request('https://synthetic.invalid/sign-agreement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'a'.repeat(64),typed_name:'Synthetic Signer',consent_read:true,consent_esign:true})}));
    agreement=base;storage=new Response(bytes);terminalWrites=0;
    assert.equal((await invoke()).status,409,'an eligible token with verified presented bytes reaches the synthetic write boundary');
    assert.equal(terminalWrites,1);
    for(const variant of [
      {name:'missing stored PDF',row:base,response:json({message:'Unavailable'},404)},
      {name:'changed stored bytes',row:base,response:new Response(new TextEncoder().encode('%PDF-1.7\nchanged'))},
      {name:'missing frozen digest',row:{...base,content_sha256:null},response:new Response(bytes)},
      {name:'changed legacy text',row:{...base,content_storage_key:null,content_sha256:textDigest,body_markdown:body+' changed'},response:new Response(bytes)},
    ]){
      agreement=variant.row;storage=variant.response;terminalWrites=0;
      const reply=await invoke();assert.equal(reply.status,503,variant.name);
      assert.equal((await reply.json()).ok,false);assert.equal(terminalWrites,0,variant.name);
    }
    agreement={...base,tenant_id:'10000000-0000-4000-8000-000000000002'};terminalWrites=0;
    assert.equal((await invoke()).status,404);assert.equal(terminalWrites,0);
    for(const row of [base,{...base,content_storage_key:null,content_sha256:textDigest}]){
      agreement=row;storage=new Response(bytes);terminalWrites=0;storageReads=0;
      assert.equal((await invoke()).status,409);assert.equal(terminalWrites,1);
      assert.equal(storageReads,row.content_storage_key?1:0);
    }
  }finally{Deno.serve=serve;Deno.env.get=envGet;globalThis.fetch=fetch;}
});
