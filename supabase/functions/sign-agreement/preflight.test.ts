import assert from 'node:assert/strict';
import {sha256Hex} from '../_shared/agreements/token.ts';
import {renderPresentedPdf} from '../_shared/agreements/document.ts';

// Exercise the deployed handler through its real supabase-js client. Every
// transport is intercepted; the test itself runs with network/env access denied.
// Successful preflight stops at a deliberately refused synthetic signature write.
Deno.test('the signing handler verifies the retained presentation before any terminal write',async t=>{
  const serve=Deno.serve,envGet=Deno.env.get,fetch=globalThis.fetch;
  let handler!:(request:Request)=>Promise<Response>;
  const tenant='10000000-0000-4000-8000-000000000001';
  const agreementId='20000000-0000-4000-8000-000000000001';
  const signerId='30000000-0000-4000-8000-000000000001';
  const body='Synthetic retained agreement text.';
  const bytes=await renderPresentedPdf({title:'Neutral retained document proof',bodyMarkdown:body});
  let agreement:Record<string,unknown>={},storage:Response,terminalWrites=0,storageReads=0,storageThrows=false,earlier=0;
  let signerOverride:Record<string,unknown>={};
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
        if(request.method==='HEAD')return new Response(null,{headers:{'Content-Range':`0-0/${earlier}`}});
        const signer:Record<string,unknown>={id:signerId,agreement_id:agreementId,tenant_id:tenant,status:'pending',signing_order:1,full_name:'Synthetic Signer',email:'signer@example.invalid',token_hash:await sha256Hex('a'.repeat(64)),token_expires_at:'2099-10-15T00:00:00Z',token_revoked_at:null,...signerOverride};
        return json(Object.fromEntries((url.searchParams.get('select')??'').split(',').map(key=>[key,signer[key]])));
      }
      if(url.pathname==='/rest/v1/paige_agreements')return json(agreement);
      if(url.pathname==='/rest/v1/tenants')return json({name:'Synthetic business',brand:{support_email:'support@example.invalid'}});
      if(url.pathname.startsWith('/storage/v1/object/')){storageReads++;if(storageThrows)throw new Error('Synthetic transport interruption');return storage.clone();}
      throw new Error('Unexpected synthetic transport: '+request.method+' '+url.pathname);
    };
    await import('./index.ts');
    assert.equal(typeof handler,'function');
    const pdfDigest=await sha256Hex(bytes),textDigest=await sha256Hex(body);
    const base={id:agreementId,tenant_id:tenant,title:'Synthetic agreement',body_source:'paige',body_markdown:body,status:'sent',expires_at:'2099-10-15T00:00:00Z',content_storage_key:'synthetic/presented.pdf',content_sha256:pdfDigest};
    const invoke=()=>handler(new Request('https://synthetic.invalid/sign-agreement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'a'.repeat(64),typed_name:'Synthetic Signer',consent_read:true,consent_esign:true})}));
    agreement=base;storage=new Response(new Uint8Array(bytes).buffer);terminalWrites=0;
    assert.equal((await invoke()).status,409,'an eligible token with verified presented bytes reaches the synthetic write boundary');
    assert.equal(terminalWrites,1);
    for(const variant of [
      {name:'missing stored PDF',row:base,response:json({message:'Unavailable'},404)},
      {name:'changed stored bytes',row:base,response:new Response(new TextEncoder().encode('%PDF-1.7\nchanged'))},
      {name:'missing frozen digest',row:{...base,content_sha256:null},response:new Response(new Uint8Array(bytes).buffer)},
      {name:'malformed frozen digest',row:{...base,content_sha256:'bad'},response:new Response(new Uint8Array(bytes).buffer)},
      {name:'changed legacy text',row:{...base,content_storage_key:null,content_sha256:textDigest,body_markdown:body+' changed'},response:new Response(new Uint8Array(bytes).buffer)},
      {name:'upload cannot fall back to text',row:{...base,body_source:'tenant_upload',content_storage_key:null,content_sha256:textDigest},response:new Response(new Uint8Array(bytes).buffer)},
      {name:'missing legacy text',row:{...base,body_markdown:null,content_storage_key:null,content_sha256:textDigest},response:new Response(new Uint8Array(bytes).buffer)},
      {name:'non-PDF with matching digest',row:{...base,content_sha256:await sha256Hex('not a PDF')},response:new Response('not a PDF')},
      {name:'storage transport interruption',row:base,response:new Response(new Uint8Array(bytes).buffer),throws:true},
    ]){
      await t.step(variant.name,async()=>{
        agreement=variant.row;storage=variant.response;terminalWrites=0;storageThrows=variant.throws===true;
        const reply=await invoke();assert.equal(reply.status,503,variant.name);
        const result=await reply.json();assert.equal(result.ok,false);assert.equal(terminalWrites,0,variant.name);
        assert(!JSON.stringify(result).includes('synthetic/presented.pdf'),'private Storage key must not enter the response');
      });
    }
    storageThrows=false;
    agreement={...base,tenant_id:'10000000-0000-4000-8000-000000000002'};terminalWrites=0;storageReads=0;
    assert.equal((await invoke()).status,404);assert.equal(terminalWrites,0);assert.equal(storageReads,0);
    for(const variant of [
      {name:'revoked credential',signer:{token_revoked_at:'2026-01-01T00:00:00Z'},row:base,earlier:0},
      {name:'expired credential',signer:{token_expires_at:'2020-01-01T00:00:00Z'},row:base,earlier:0},
      {name:'missing credential expiry',signer:{token_expires_at:null},row:base,earlier:0},
      {name:'already signed',signer:{status:'signed'},row:base,earlier:0},
      {name:'declined',signer:{status:'declined'},row:base,earlier:0},
      {name:'out of order',signer:{},row:base,earlier:1},
      {name:'voided original',signer:{},row:{...base,status:'voided'},earlier:0},
      {name:'expired original',signer:{},row:{...base,expires_at:'2020-01-01T00:00:00Z'},earlier:0},
    ])await t.step(variant.name,async()=>{
      agreement=variant.row;signerOverride=variant.signer;earlier=variant.earlier;terminalWrites=0;storageReads=0;
      assert.equal((await invoke()).status,404);assert.equal(terminalWrites,0);assert.equal(storageReads,0,'ineligible token cannot read private PDF bytes');
    });
    signerOverride={};earlier=0;
    for(const row of [base,{...base,content_storage_key:null,content_sha256:textDigest}]){
      agreement=row;storage=new Response(new Uint8Array(bytes).buffer);terminalWrites=0;storageReads=0;
      assert.equal((await invoke()).status,409);assert.equal(terminalWrites,1);
      assert.equal(storageReads,row.content_storage_key?1:0);
    }
  }finally{Deno.serve=serve;Deno.env.get=envGet;globalThis.fetch=fetch;}
});
