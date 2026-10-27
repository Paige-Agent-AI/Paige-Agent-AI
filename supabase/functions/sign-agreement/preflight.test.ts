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
  let nativeMode:'refuse'|'record'|'lost_ack'='refuse',recorded=false,recoveryError:string|null=null,notices=0,completionAttempts=0;
  let receiptOverride:Record<string,unknown>={};
  let preparedSourceReads=0,preparedSourceFailure=false;
  let fieldReadReply:unknown=null;
  let fieldReadErrorCode:string|null=null;
  let readFailure:'signer'|'agreement'|'order'|null=null;
  const nativeInputs:Record<string,unknown>[]=[];
  const receipt=(replayed:boolean)=>({state:'recorded',replayed,signing_id:agreementId,signer_id:signerId,
    signed_at:'2026-10-23T12:00:00.000Z',consented_event_id:'40000000-0000-4000-8000-000000000001',
    signed_event_id:'40000000-0000-4000-8000-000000000002',audit_complete:true,outstanding_count:1,
    agreement_status:'partially_signed',...receiptOverride});
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  try{
    Deno.serve=((callback:typeof handler)=>{handler=callback;return {} as never;}) as unknown as typeof Deno.serve;
    Deno.env.get=(name:string)=>name==='SUPABASE_URL'?'https://synthetic.invalid':name==='SUPABASE_SERVICE_ROLE_KEY'||name==='SENDGRID_MAIL_SEND_API_KEY'?'synthetic-not-a-credential':undefined;
    globalThis.fetch=async(input,init)=>{
      const request=new Request(input,init),url=new URL(request.url);
      assert.equal(url.origin,'https://synthetic.invalid');
      if(url.pathname==='/rest/v1/rpc/check_public_rate_limit')return json(true);
      if(url.pathname==='/rest/v1/rpc/_read_agreement_signing_fields'){
        assert.deepEqual(await request.json(),{_token_hash:await sha256Hex('a'.repeat(64))});
        if(fieldReadErrorCode)return json({message:'Synthetic current source refusal',code:fieldReadErrorCode},403);
        return json(fieldReadReply??{kind:'legacy',tenant_id:tenant,agreement_id:agreementId,signer_id:signerId});
      }
      if(url.pathname==='/rest/v1/rpc/_read_prepared_agreement_seal'){
        preparedSourceReads++;assert.deepEqual(await request.json(),{_agreement:agreementId});
        return preparedSourceFailure?json({message:'Synthetic source unavailable',code:'SYNTHETIC_READ'},503)
          :json({state:'unavailable',agreement_id:agreementId,tenant_id:tenant});
      }
      if(url.pathname==='/rest/v1/rpc/_record_agreement_signature'){
        const args=await request.json();nativeInputs.push(args);
        assert.equal(args._token_hash,await sha256Hex('a'.repeat(64)));
        assert(!Object.keys(args).some(key=>['tenant','signer','agreement_id'].some(part=>key.includes(part))));
        if(args._consent_read===false&&args._consent_esign===false){
          assert.equal(args._typed_name,null);assert.equal(args._signature_image_png,null);
          assert.equal(args._consent_sha256,null,'verification cannot manufacture a new consent');
          if(recoveryError)return json({message:'Synthetic credential refusal',code:recoveryError},403);
          return recorded||signerOverride.status==='signed'?json(receipt(true)):json({message:'Synthetic missing existing record',code:'23514'},400);
        }
        terminalWrites++;
        assert.equal(args._agreement_version,1,'actual original version is selected and bound');
        assert.equal(args._content_sha256,agreement.content_sha256);assert.equal(args._content_storage_key,agreement.content_storage_key);
        assert.equal(args._typed_name,'Synthetic Signer');assert.equal(args._consent_read,true);assert.equal(args._consent_esign,true);
        assert.match(args._consent_sha256,/^[a-f0-9]{64}$/);
        if(nativeMode==='refuse')return json({message:'Synthetic transaction intentionally refused',code:'23514'},400);
        recorded=true;
        return nativeMode==='lost_ack'?json({message:'Synthetic acknowledgement lost',code:'SYNTHETIC_TRANSPORT'},504):json(receipt(false));
      }
      if(url.pathname==='/rest/v1/paige_agreement_signers'){
        if((request.method==='HEAD'&&readFailure==='order')||(request.method==='GET'&&readFailure==='signer'))return json({message:'Synthetic original record unavailable',code:'SYNTHETIC_READ'},503);
        if(request.method==='PATCH'){
          throw new Error('Legacy separate signature PATCH must not remain an execution path');
        }
        if(request.method==='HEAD')return new Response(null,{headers:{'Content-Range':`0-0/${earlier}`}});
        const signer:Record<string,unknown>={id:signerId,agreement_id:agreementId,tenant_id:tenant,status:'pending',signing_order:1,full_name:'Synthetic Signer',email:'signer@example.invalid',token_hash:await sha256Hex('a'.repeat(64)),token_expires_at:'2099-10-15T00:00:00Z',token_revoked_at:null,...signerOverride};
        return json(Object.fromEntries((url.searchParams.get('select')??'').split(',').map(key=>[key,signer[key]])));
      }
      if(url.pathname==='/rest/v1/paige_agreements'){
        if(readFailure==='agreement')return json({message:'Synthetic original record unavailable',code:'SYNTHETIC_READ'},503);
        assert.equal(request.method,'GET','progress belongs to the same native signature transaction');
        if(url.searchParams.get('select')?.startsWith('id,tenant_id,contact_id,version,title,status,body_source'))completionAttempts++;
        if(url.searchParams.get('select')==='status,sealed_storage_key,sealed_sha256'){
          assert.equal(url.searchParams.get('id'),'eq.'+agreementId);assert.equal(url.searchParams.get('tenant_id'),'eq.'+tenant);
        }
        return json(Object.fromEntries((url.searchParams.get('select')??'').split(',').map(key=>[key,agreement[key]])));
      }
      if(url.pathname==='/rest/v1/tenant_members')return json(null);
      if(url.pathname==='/rest/v1/tenants')return json({name:'Synthetic business',brand:{support_email:'support@example.invalid'}});
      if(url.pathname==='/functions/v1/send-transactional-email'){notices++;return json({success:true});}
      if(url.pathname.startsWith('/storage/v1/object/')){storageReads++;if(storageThrows)throw new Error('Synthetic transport interruption');return storage.clone();}
      throw new Error('Unexpected synthetic transport: '+request.method+' '+url.pathname);
    };
    await import('./index.ts');
    assert.equal(typeof handler,'function');
    const pdfDigest=await sha256Hex(bytes),textDigest=await sha256Hex(body);
    const base={id:agreementId,tenant_id:tenant,version:1,title:'Synthetic agreement',body_source:'paige',body_markdown:body,status:'sent',expires_at:'2099-10-15T00:00:00Z',content_storage_key:'synthetic/presented.pdf',content_sha256:pdfDigest};
    const invoke=(patch:Record<string,unknown>={})=>handler(new Request('https://synthetic.invalid/sign-agreement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'a'.repeat(64),typed_name:'Synthetic Signer',consent_read:true,consent_esign:true,...patch})}));

    await t.step('recipient field review is an ordinary token-derived read and cannot create a signature',async()=>{



    agreement=base;storage=new Response(new Uint8Array(bytes).buffer);terminalWrites=0;notices=0;nativeInputs.length=0;
      const reply=await invoke({action:'fields',typed_name:undefined,consent_read:undefined,consent_esign:undefined}),result=await reply.json();
      assert.equal(reply.status,200);assert.equal(result.kind,'legacy');
      assert.equal(terminalWrites,0);assert.equal(notices,0);assert.equal(nativeInputs.length,0);
    });
    await t.step('recipient field read refuses request-authored source or signer identity',async()=>{
      agreement=base;terminalWrites=0;notices=0;
      const reply=await invoke({action:'fields',typed_name:undefined,consent_read:undefined,consent_esign:undefined,tenant_id:'foreign',signer_id:signerId});
      assert.equal(reply.status,400);assert.equal((await reply.json()).code,'SIGNING_FIELD_REQUEST_INVALID');assert.equal(terminalWrites,0);assert.equal(notices,0);
    });

    const fieldDocument=(await import('../_shared/agreements/document-preparation.ts')).inspectAgreementPreparationPdf;
    const fieldReply={kind:'prepared',tenant_id:tenant,agreement_id:agreementId,signer_id:signerId,
      source_version:1,content_storage_key:base.content_storage_key,
      preparation_id:'50000000-0000-4000-8000-000000000001',preparation_sha256:'b'.repeat(64),
      document:await fieldDocument(bytes,pdfDigest),
      fields:[{id:'60000000-0000-4000-8000-000000000001',kind:'signature',page:1,x:10,y:10,width:180,height:35,required:true,label:'Your signature'}]};
    await t.step('recipient receives only their native assigned display fields without internal source identity or an act',async()=>{
      agreement=base;fieldReadReply=fieldReply;terminalWrites=0;notices=0;storageReads=0;nativeInputs.length=0;
      const reply=await invoke({action:'fields',typed_name:undefined,consent_read:undefined,consent_esign:undefined}),result=await reply.json();
      assert.equal(reply.status,200);assert.equal(result.kind,'prepared');assert.deepEqual(result.fields,fieldReply.fields);
      assert.equal(result.document.sha256,pdfDigest);assert.equal(result.preparation_id,fieldReply.preparation_id);
      for(const key of ['tenant_id','agreement_id','signer_id','source_version','content_storage_key'])assert(!Object.hasOwn(result,key));
      assert.equal(terminalWrites,0);assert.equal(notices,0);assert.equal(storageReads,0);assert.equal(nativeInputs.length,0);
    });
    for(const patch of [
      {tenant_id:'foreign'},{agreement_id:'foreign'},{signer_id:'foreign'},{source_version:2},
      {content_storage_key:'foreign.pdf'},{document:{...fieldReply.document,sha256:'c'.repeat(64)}},
      {private_other_recipients:['must not escape']},{fields:[{...fieldReply.fields[0],signer_id:signerId}]},
      {fields:[fieldReply.fields[0],fieldReply.fields[0]]},{fields:[]},
    ])await t.step('unverified recipient field source cannot become a legacy or signed result: '+JSON.stringify(patch),async()=>{
      agreement=base;fieldReadReply={...fieldReply,...patch};terminalWrites=0;notices=0;nativeInputs.length=0;
      const reply=await invoke({action:'fields',typed_name:undefined,consent_read:undefined,consent_esign:undefined});
      assert.equal(reply.status,503);assert.equal((await reply.json()).code,'SIGNING_FIELDS_UNAVAILABLE');
      assert.equal(terminalWrites,0);assert.equal(notices,0);assert.equal(nativeInputs.length,0);
    });
    const preparedFields={...fieldReply,fields:[...fieldReply.fields,
      {id:'60000000-0000-4000-8000-000000000002',kind:'text',page:1,x:10,y:70,width:100,height:20,required:true,label:'Requested text'},
      {id:'60000000-0000-4000-8000-000000000003',kind:'initials',page:1,x:10,y:110,width:70,height:20,required:true,label:'Initials'},
      {id:'60000000-0000-4000-8000-000000000004',kind:'checkbox',page:1,x:10,y:150,width:24,height:24,required:true,label:'Explicit answer'},
      {id:'60000000-0000-4000-8000-000000000005',kind:'signed_date',page:1,x:10,y:190,width:220,height:24,required:true,label:'Signed date'},
    ]};
    const proposedFields={preparation_id:preparedFields.preparation_id,preparation_sha256:preparedFields.preparation_sha256,
      field_values:[{field_id:preparedFields.fields[0].id,value:true},
        {field_id:preparedFields.fields[1].id,value:'Customer wording'},
        {field_id:preparedFields.fields[2].id,value:'SS'},
        {field_id:preparedFields.fields[3].id,value:false}]};
    const preparedState=()=>{
      agreement=base;storage=new Response(new Uint8Array(bytes).buffer);fieldReadReply=preparedFields;fieldReadErrorCode=null;
      nativeMode='refuse';recorded=false;recoveryError=null;receiptOverride={};signerOverride={};earlier=0;
      terminalWrites=0;notices=0;nativeInputs.length=0;
    };
    await t.step('actual prepared act passes exact token-derived field answers to the one original native writer',async()=>{
      preparedState();const reply=await invoke(proposedFields);
      assert.equal(reply.status,409,'the synthetic native refusal still stops the act');assert.equal(terminalWrites,1);
      assert.deepEqual(nativeInputs[0]._prepared_fields,{preparation_id:proposedFields.preparation_id,
        preparation_sha256:proposedFields.preparation_sha256,values:proposedFields.field_values});
      assert.equal(Object.hasOwn(nativeInputs[0]._prepared_fields as object,'signed_at'),false,'only the native clock can establish signing time');
    });
    for(const final of [false,true])await t.step('prepared signature activity cannot enter the legacy notification sender: '+final,async()=>{
      preparedState();nativeMode='record';preparedSourceFailure=false;
      if(final)receiptOverride={outstanding_count:0,agreement_status:'partially_signed'};
      const reply=await invoke(proposedFields),result=await reply.json();
      assert.equal(reply.status,200);assert.equal(result.ok,true);assert.equal(result.completed,false);
      assert.equal(result.audit_complete,true);assert.equal(result.signed_event_id,receipt(false).signed_event_id);
      assert.equal(terminalWrites,1);assert.equal(nativeInputs.length,1);
      assert.equal(notices,0,'prepared activity requires the original governed Communications path, never a legacy fallback');
    });
    for(const patch of [
      {preparation_id:'50000000-0000-4000-8000-000000000099'},
      {preparation_sha256:'c'.repeat(64)},
      {field_values:null},{field_values:[]},
      {field_values:[...proposedFields.field_values,proposedFields.field_values[0]]},
      {field_values:[...proposedFields.field_values,{field_id:'60000000-0000-4000-8000-000000000099',value:'foreign'}]},
      {field_values:proposedFields.field_values.map((x,i)=>i===0?{...x,value:false}:x)},
      {field_values:proposedFields.field_values.map((x,i)=>i===3?{...x,value:'false'}:x)},
      {field_values:[...proposedFields.field_values,{field_id:preparedFields.fields[4].id,value:'client-invented-date'}]},
    ])await t.step('invalid or foreign assigned answers cannot reach the irreversible native act: '+JSON.stringify(patch),async()=>{
      preparedState();const reply=await invoke({...proposedFields,...patch});
      assert.equal(reply.status,400);assert.equal((await reply.json()).code,'SIGNING_FIELD_INPUT_INVALID');
      assert.equal(terminalWrites,0);assert.equal(nativeInputs.length,0);assert.equal(notices,0);
    });
    for(const value of ['W'.repeat(10000),'\u6f22\u5b57'])await t.step('field text must be fully renderable in its exact reviewed box before signature recording: '+value.length,async()=>{
      preparedState();const field_values=proposedFields.field_values.map((x,i)=>i===1?{...x,value}:x);
      const reply=await invoke({...proposedFields,field_values});
      assert.equal(reply.status,400);assert.equal((await reply.json()).code,'SIGNING_FIELD_UNRENDERABLE');
      assert.equal(terminalWrites,0);assert.equal(nativeInputs.length,0);assert.equal(notices,0);
    });
    await t.step('a prepared source read failure cannot fall back to a legacy signing act',async()=>{
      preparedState();fieldReadReply={...preparedFields,tenant_id:'foreign'};
      const reply=await invoke(proposedFields);assert.equal(reply.status,503);
      assert.equal((await reply.json()).code,'SIGNING_FIELDS_UNAVAILABLE');assert.equal(terminalWrites,0);assert.equal(notices,0);
    });
    await t.step('a prepared lost acknowledgement performs one original act then one empty read-only reconciliation',async()=>{
      preparedState();nativeMode='lost_ack';const reply=await invoke(proposedFields);
      assert.equal(reply.status,200);assert.equal((await reply.json()).replayed,true);
      assert.equal(terminalWrites,1);assert.equal(nativeInputs.length,2);assert.equal(notices,0);
      assert.deepEqual(nativeInputs[0]._prepared_fields,{preparation_id:proposedFields.preparation_id,
        preparation_sha256:proposedFields.preparation_sha256,values:proposedFields.field_values});
      assert.equal(Object.hasOwn(nativeInputs[1],'_prepared_fields'),false,'recovery cannot resubmit field answers');
      assert.equal(nativeInputs[1]._consent_read,false);assert.equal(nativeInputs[1]._consent_esign,false);
    });
    await t.step('legacy documents refuse client-authored prepared answers without acquiring a new signing act',async()=>{
      preparedState();fieldReadReply=null;const reply=await invoke(proposedFields);
      assert.equal(reply.status,400);assert.equal((await reply.json()).code,'SIGNING_FIELD_INPUT_INVALID');assert.equal(terminalWrites,0);
    });
    for(const variant of [{exists:true,recovery:null,status:200},{exists:false,recovery:'42501',status:404}]){
      await t.step('a signature racing the field read is reconciled only through original current credential authority: '+variant.exists,async()=>{
        preparedState();fieldReadErrorCode='42501';recorded=variant.exists;recoveryError=variant.recovery;
        storageReads=0;const reply=await invoke(proposedFields);assert.equal(reply.status,variant.status);
        if(variant.exists)assert.equal((await reply.json()).replayed,true);
        assert.equal(terminalWrites,0);assert.equal(notices,0);assert.equal(storageReads,0);
        assert.equal(nativeInputs.length,1);assert.equal(nativeInputs[0]._consent_read,false);
        assert.equal(Object.hasOwn(nativeInputs[0],'_prepared_fields'),false);
      });
    }
    preparedState();fieldReadReply=null;

    agreement=base;storage=new Response(new Uint8Array(bytes).buffer);terminalWrites=0;
    assert.equal((await invoke()).status,409,'an eligible token with verified presented bytes reaches the synthetic write boundary');
    assert.equal(terminalWrites,1);
    for(const failure of ['signer','agreement','order'] as const)await t.step('an unavailable '+failure+' lookup is not an invalid-link or successful-action claim',async()=>{
      readFailure=failure;terminalWrites=0;storageReads=0;nativeInputs.length=0;
      const reply=await invoke();assert.equal(reply.status,503);assert.equal((await reply.json()).state,'verification_pending');
      assert.equal(terminalWrites,0);assert.equal(storageReads,0);assert.equal(nativeInputs.length,0);
    });
    readFailure=null;
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
    nativeMode='lost_ack';
    for(const variant of [
      {name:'same current credential can reconcile an existing signature',error:null,status:200,ok:true},
      {name:'retired credential cannot adopt another signature',error:'42501',status:404,ok:false},
      {name:'an unavailable recovery remains uncertain',error:'SYNTHETIC_UNAVAILABLE',status:503,ok:false},
    ])await t.step(variant.name,async()=>{
      agreement=base;storage=new Response(new Uint8Array(bytes).buffer);recoveryError=variant.error;terminalWrites=0;notices=0;nativeInputs.length=0;recorded=false;
      const reply=await invoke();assert.equal(reply.status,variant.status);assert.equal((await reply.json()).ok,variant.ok);
      assert.equal(terminalWrites,1);assert.equal(nativeInputs.length,2,'one act, then one read-only reconciliation');assert.equal(notices,0,'lost acknowledgement must not resend activity');
    });
    nativeMode='refuse';recoveryError=null;recorded=false;signerOverride={};earlier=0;
    const validPng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    // Invalid DEFLATE block type, not just a zlib header the existing decoder ignores.
    const corrupt=Uint8Array.from(atob(validPng),c=>c.charCodeAt(0));corrupt[43]=255;
    for(const variant of [
      {name:'an overlength accepted name is refused rather than truncated',patch:{typed_name:'A'.repeat(201)}},
      {name:'a non-string name is not converted into somebody else\'s mark',patch:{typed_name:['Synthetic Signer']}},
      {name:'a non-boolean check flag cannot become a new signing act',patch:{check_only:'true'}},
      {name:'corrupt compressed PNG is refused before irreversible recording',patch:{signature_image_base64:btoa(String.fromCharCode(...corrupt))}},
    ])await t.step(variant.name,async()=>{
      agreement=base;storage=new Response(new Uint8Array(bytes).buffer);terminalWrites=0;
      assert.equal((await invoke(variant.patch)).status,400);assert.equal(terminalWrites,0);
    });
    await t.step('a genuine drawn PNG still reaches the original write boundary',async()=>{
      agreement=base;storage=new Response(new Uint8Array(bytes).buffer);terminalWrites=0;
      assert.equal((await invoke({signature_image_base64:validPng})).status,409);assert.equal(terminalWrites,1);
    });
    await t.step('one acknowledged original signature carries real native receipt references',async()=>{
      nativeMode='record';terminalWrites=0;notices=0;nativeInputs.length=0;
      const reply=await invoke(),result=await reply.json();assert.equal(reply.status,200);assert.equal(result.ok,true);assert.equal(result.completed,false);
      assert.equal(result.signed_at,receipt(false).signed_at);assert.equal(result.audit_complete,true);assert.equal(result.signed_event_id,receipt(false).signed_event_id);
      assert.equal(terminalWrites,1);assert.equal(notices,1);
    });
    await t.step('an already signed holder can verify without a fresh mark, consent or notice',async()=>{
      signerOverride={status:'signed'};terminalWrites=0;storageReads=0;notices=0;nativeInputs.length=0;
      const result=await(await invoke({typed_name:null,consent_read:false,consent_esign:false})).json();
      assert.equal(result.ok,true);assert.equal(result.replayed,true);assert.equal(terminalWrites,0);assert.equal(storageReads,0);assert.equal(notices,0);
    });
    await t.step('explicit check-only cannot create a signature even with action fields supplied',async()=>{
      signerOverride={};recorded=false;terminalWrites=0;storageReads=0;nativeInputs.length=0;
      const reply=await invoke({check_only:true});assert.equal(reply.status,503);assert.equal((await reply.json()).state,'verification_pending');
      assert.equal(terminalWrites,0);assert.equal(storageReads,0);assert.equal(nativeInputs.length,1);
    });
    for(const patch of [{signing_id:'foreign'},{signer_id:'foreign'},{signed_at:null},{outstanding_count:null},{audit_complete:'true'},
      {audit_complete:false,consented_event_id:null,signed_event_id:null},{signed_event_id:receipt(false).consented_event_id},
      {agreement_status:'completed',outstanding_count:1},{replayed:'true'}])await t.step('malformed native receipt never claims a signature: '+JSON.stringify(patch),async()=>{
      receiptOverride=patch;signerOverride={};terminalWrites=0;notices=0;
      const reply=await invoke();assert.equal(reply.status,503);assert.equal((await reply.json()).ok,false);assert.equal(notices,0);
    });
    await t.step('an explicit check never invokes completion even when all signatures exist',async()=>{
      receiptOverride={outstanding_count:0,agreement_status:'sent'};signerOverride={status:'signed'};
      agreement=base;storageReads=0;terminalWrites=0;completionAttempts=0;notices=0;
      const result=await(await invoke({check_only:true})).json();
      assert.equal(result.ok,true);assert.equal(result.completed,false);assert.equal(terminalWrites,0);assert.equal(storageReads,0);assert.equal(completionAttempts,0);assert.equal(notices,0);
    });
    for(const failedRead of [false,true])await t.step('actual final-signature handler preserves recorded signature when prepared completion evidence is unavailable: '+failedRead,async()=>{
      receiptOverride={outstanding_count:0,agreement_status:'sent'};signerOverride={};recorded=false;
      agreement=base;storage=new Response(new Uint8Array(bytes).buffer);preparedSourceFailure=failedRead;
      preparedSourceReads=0;terminalWrites=0;completionAttempts=0;notices=0;storageReads=0;
      const reply=await invoke(),result=await reply.json();
      assert.equal(reply.status,200);assert.equal(result.ok,true);assert.equal(result.completed,false);assert.equal(result.audit_complete,true);
      assert.equal(result.signed_event_id,receipt(false).signed_event_id);assert.equal(result.signed_pdf_path,null);
      assert.equal(terminalWrites,1);assert.equal(preparedSourceReads,1);assert.equal(completionAttempts,1);
      assert.equal(storageReads,1,'only the original before-signing document check; no fallback seal/upload');
      assert.equal(notices,1,'only original owner signature activity, no completion notification');
    });
    preparedSourceFailure=false;
    for(const validCopy of [true,false])await t.step('existing completed copy requires actual readback, with no completion effect: '+validCopy,async()=>{
      receiptOverride={outstanding_count:0,agreement_status:'completed'};signerOverride={status:'signed'};
      agreement={...base,status:'completed',sealed_storage_key:'synthetic/sealed.pdf',sealed_sha256:pdfDigest};
      storage=validCopy?new Response(new Uint8Array(bytes).buffer):json({message:'Synthetic copy unavailable'},404);
      storageReads=0;terminalWrites=0;completionAttempts=0;notices=0;
      const result=await(await invoke({check_only:true})).json();assert.equal(result.ok,true);assert.equal(result.completed,validCopy);
      assert.equal(storageReads,1);assert.equal(terminalWrites,0);assert.equal(completionAttempts,0);assert.equal(notices,0);
      assert.equal(result.signed_pdf_path,null);assert(!JSON.stringify(result).includes('synthetic/sealed.pdf'));
    });
    agreement=base;
    receiptOverride={audit_complete:false,consented_event_id:null,signed_event_id:null};signerOverride={status:'signed'};
    await t.step('historical missing audit stays visibly incomplete without manufacturing events',async()=>{
      terminalWrites=0;notices=0;const result=await(await invoke({check_only:true})).json();
      assert.equal(result.ok,true);assert.equal(result.audit_complete,false);assert.equal(result.completed,false);assert.equal(terminalWrites,0);assert.equal(notices,0);
    });
  }finally{Deno.serve=serve;Deno.env.get=envGet;globalThis.fetch=fetch;}
});
