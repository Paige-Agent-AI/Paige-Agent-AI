import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {prepareAgreementFields,prepareCommercialAgreementFields} from '../../supabase/functions/_shared/agreements/field-preparation.ts';
import {prepareCommercialPresentation,commercialPresentationText} from '../../supabase/functions/_shared/agreements/commercial-presentation.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/preparation-json.ts';

// Only a synthetic transport in the EXISTING local Sales drive. Actual owning
// router/controller/SDK/PDF renderer/validator stay untouched. This Map is NEVER
// imported by production or used as native persistence/role acceptance evidence.
export async function installDocumentPreparationPorts({context,records,fixture,commercial=false}){
 const actor='bbbbbbbb-0000-4000-8000-000000000001',preparations=new Map(),requests=[];
 let selected=null,mode='normal',termsRevision=1;
 const source=()=>{const row=records.get(fixture.source.agreement_id);return {...fixture.source,version:row.agreement.version,updated_at:row.agreement.updated_at,status:row.agreement.status,
   signers:row.signers.map(({signed_at,declined_at,...party})=>party)};};
 records.set(fixture.source.agreement_id,{agreement:{id:fixture.source.agreement_id,contact_id:fixture.source.client_id,offer_id:commercial?fixture.input.source.offer_id:null,commercial_terms_id:commercial?fixture.input.source.terms_id:null,title:commercial?fixture.input.title:'Controlled uploaded service document',body_source:commercial?'paige_draft':'tenant_upload',source_version_id:null,body_markdown:commercial?fixture.input.body_markdown:null,has_source_document:!commercial,status:'draft',version:fixture.source.version,updated_at:fixture.source.updated_at,expires_at:null,can_edit:true,content_sha256:null,sealed_sha256:null},signers:fixture.signers.map(p=>({...p,signed_at:null,declined_at:null})),eventId:randomUUID()});
 const input=()=>({...fixture.input,source:{...fixture.input.source,agreement_version:source().version,agreement_updated_at:source().updated_at,terms_version:termsRevision}});
 const view=async p=>{
   const currentSource=source(),common={title:commercial?fixture.input.title:'Controlled uploaded service document',source:currentSource,can_prepare:!commercial,preparation_hold:commercial?'commercial_review_required':null};
   if(!p)return {state:'none',...common,document_signers:[]};
   const checked=commercial?await prepareCommercialAgreementFields(currentSource,p.manifest.document,p.manifest.fields,input()):await prepareAgreementFields(currentSource,p.manifest.document,p.manifest.fields),matches=checked.preparation_sha256===p.preparation_sha256;
   if(commercial){common.can_prepare=matches;common.preparation_hold=matches?null:'commercial_review_required';}
   return {state:'retained',...common,preparation:{...p,is_selected:p.id===selected,source_matches:matches},can_edit:p.id===selected&&matches,document_signers:matches?currentSource.signers:[],...(commercial?{commercial_readback:{state:matches?'current':'changed',invoice_id:fixture.input.source.invoice_id,payload_digest:p.manifest.commercial.payload_digest}}:{})};
 };
 await context.route('**/__e04_document__*',async route=>{
   const request=route.request(),query=new URL(request.url()).searchParams;
   assert.match(request.headers().authorization??'',/^Bearer /,'Existing SDK must pin the actual captured local session');
   const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
   if(mode==='refused')return json({code:'access_unverified'},403);
   if(request.method()==='GET'){
     assert.equal(query.get('businessId'),fixture.source.tenant_id);assert.equal(query.get('agreementId'),fixture.source.agreement_id);
     if(commercial&&query.get('preparation')==='commercial_sources'){
       requests.push({method:'GET',kind:'commercial_sources',cursor:query.get('beforeId')});
       if(mode==='choices-error')return json({code:'unconfirmed'},503);
       const item={invoice_id:fixture.input.source.invoice_id,invoice_number:'DRAFT-TEST-3500',total_minor:350000,currency:'usd'};
       const empty=mode==='empty'||mode==='paged'&&!query.has('beforeId');
       return json({ok:true,sources:{tenant_id:fixture.source.tenant_id,agreement_id:fixture.source.agreement_id,items:empty?[]:[item],has_more:mode==='paged'&&!query.has('beforeId'),next_cursor:mode==='paged'&&!query.has('beforeId')?'77777777-0000-4000-8000-000000000099':null}});
     }
     if(commercial&&query.get('preparation')==='commercial_review'){
       requests.push({method:'GET',kind:'commercial_review',invoice_id:query.get('invoiceId')});assert.equal(query.get('invoiceId'),fixture.input.source.invoice_id);
       if(mode==='review-refused')return json({code:'access_unverified'},403);
       if(mode==='missing')return json({ok:true,review:{state:'needs_input',tenant_id:fixture.source.tenant_id,agreement_id:fixture.source.agreement_id,invoice_id:fixture.input.source.invoice_id,fields:['commercial_service_start']}});
       const canonical=input(),presentation=await prepareCommercialPresentation(canonical);
       return json({ok:true,review:{state:'ready',tenant_id:fixture.source.tenant_id,agreement_id:fixture.source.agreement_id,invoice_id:fixture.input.source.invoice_id,input:canonical,presentation,payload_digest:presentation.payload_digest,presented_body_markdown:commercialPresentationText(canonical.body_markdown,presentation)}});
     }
     const id=query.get('preparationId')??selected,p=id?preparations.get(id):null;
     if(id&&!p)return json({code:'unconfirmed'},409);
     requests.push({method:'GET',kind:query.get('preparation'),id});
     if(query.get('preparation')==='pdf'){
       assert.ok(p);const bytes=Buffer.from(fixture.bytes,'base64');if(mode==='corrupt')bytes[100]^=1;
       return route.fulfill({status:200,contentType:'application/pdf',body:bytes});
     }
     return json({ok:true,view:await view(p)});
   }
   const command=request.postDataJSON();requests.push({method:'POST',id:command.request_id,intent:JSON.stringify(command)});
   if(commercial&&mode==='source-refused')return json({code:'source_changed'},409);
   assert.equal(command.tenant_id,fixture.source.tenant_id);assert.equal(command.agreement_id,fixture.source.agreement_id);
   assert.deepEqual(command.expected_source,{client_id:source().client_id,version:source().version,updated_at:source().updated_at});
   let p=preparations.get(command.request_id),recovered=Boolean(p);
   if(p)assert.equal(p.intent,undefined,'Synthetic native rows must not expose private command fingerprints');
   else{
     if(command.action==='prepare_document'||command.action==='prepare_commercial_document')assert.equal(command.expected_current_id,selected);
     else{assert.equal(command.action,'retain_fields');assert.equal(command.source_preparation_id,selected);}
     const fields=command.action==='retain_fields'?command.fields:[];
     if(commercial){const presented=await prepareCommercialPresentation(input());if(command.action==='prepare_commercial_document'){assert.equal(command.invoice_id,fixture.input.source.invoice_id);assert.equal(command.commercial_payload_digest,presented.payload_digest);}else assert.equal(command.action,'retain_fields');}
     const prepared=commercial?await prepareCommercialAgreementFields(source(),fixture.document,fields,input()):await prepareAgreementFields(source(),fixture.document,fields);
     if(commercial)assert.equal(canonicalPresentationJson(prepared.manifest.commercial.payload),canonicalPresentationJson((await prepareCommercialPresentation(input())).payload));
     p={id:command.request_id,agreement_id:fixture.source.agreement_id,client_id:fixture.source.client_id,revision_no:preparations.size+1,source_version:source().version,source_updated_at:source().updated_at,actor_user_id:actor,document_sha256:fixture.document.sha256,document_byte_length:fixture.document.byte_length,manifest:prepared.manifest,preparation_sha256:prepared.preparation_sha256,event_id:randomUUID(),created_at:'2026-10-22T14:00:00.123456+00:00',source_scope:'agreement_and_parties',commercial_verification:commercial?'not_checked':'not_applicable'};
     selected=p.id;preparations.set(p.id,p);
   }
   if(mode==='lost')return route.abort('failed');
   const v=await view(p);return json({ok:true,view:v,receipt:{state:recovered?'recovered':'recorded',historical_receipt:true,id:p.id,event_id:p.event_id,revision_no:p.revision_no,document_sha256:p.document_sha256,preparation_sha256:p.preparation_sha256,is_selected:p.id===selected}});
 });
 // More specific existing native history transport; the shared RPC drive keeps
 // every incumbent positive/refusal unchanged.
 await context.route('**/__e04_rpc__/list_agreement_document_preparations',async route=>{
   const args=route.request().postDataJSON();assert.equal(args._expected_tenant_id,fixture.source.tenant_id);assert.equal(args._agreement_id,fixture.source.agreement_id);assert.equal(args._limit,20);
   const rows=[...preparations.values()].filter(p=>args._before_revision===null||p.revision_no<args._before_revision).toReversed(),items=rows.slice(0,20).map(p=>Object.fromEntries(['id','revision_no','source_version','created_at','document_sha256','preparation_sha256','event_id','actor_user_id'].map(key=>[key,p[key]])));
   items.forEach(item=>{item.is_selected=item.id===selected;});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items,has_more:rows.length>20})});
 });
 assert.equal(createHash('sha256').update(Buffer.from(fixture.bytes,'base64')).digest('hex'),fixture.document.sha256);
 return {requests,preparations,selected:()=>selected,setMode:value=>{mode=value;},changeSource:()=>{records.get(fixture.source.agreement_id).agreement.version++;},changeTerms:()=>{termsRevision++;}};
}
