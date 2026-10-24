import {assert,assertEquals} from 'https://deno.land/std@0.190.0/testing/asserts.ts';
import {sealAndComplete} from './seal.ts';
import {sealAgreementPdf} from './document.ts';
import {preparedSealFixture} from './test-fixtures/prepared-seal.ts';

/** Controlled native-read responses only. No real signing/token/approval is
 * produced by this fixture; the original private writer is still required. */
async function setup(change?:(wire:Record<string,unknown>)=>void,rpcError:unknown=null,failedRead:string|null=null){
 const f=await preparedSealFixture(),source=f.preparedFields.preparation.manifest.source;
 const party=f.parties[0];
 const signer={id:party.signerId,full_name:party.fullName,email:party.email,signer_role:party.role,
  signing_order:party.signingOrder,status:'signed',typed_name:party.typedName,signed_at:party.signedAt,
  esign_consent_at:party.consentAt,esign_consent_slug:party.consentSlug,esign_consent_version:party.consentVersion,
  signing_ip:null,signing_user_agent:null,signature_image_png:null};
 const wire:Record<string,unknown>={state:'prepared',tenant_id:source.tenant_id,agreement_id:source.agreement_id,
  client_id:source.client_id,source_version:source.version,document_sha256:f.presentedSha256,
  content_storage_key:`${source.tenant_id}/${source.agreement_id}/presented.pdf`,
  prepared_fields:structuredClone(f.preparedFields),signers:[signer]};
 change?.(wire);
 const row={id:source.agreement_id,tenant_id:source.tenant_id,contact_id:source.client_id,version:source.version,
  title:f.agreementTitle,status:'partially_signed',body_source:'uploaded_file',body_markdown:null,
  content_storage_key:`${source.tenant_id}/${source.agreement_id}/presented.pdf`,content_sha256:f.presentedSha256,
  sealed_sha256:null,sealed_storage_key:null};
 const uploads:Uint8Array[]=[],calls:string[]=[];let writes=0;
 const db={rpc(name:string,args:Record<string,unknown>){calls.push(name);assertEquals(name,'_read_prepared_agreement_seal');
  assertEquals(args,{_agreement:source.agreement_id});return Promise.resolve({data:wire,error:rpcError});},
  from(table:string){let head=false;const q={select(_columns?:string,options?:{head?:boolean}){head=options?.head===true;return q;},eq(){return q;},neq(){return q;},order(){return q;},
   maybeSingle(){return Promise.resolve({data:table==='tenants'?{name:f.tenantName}:row,error:failedRead==='tenant'&&table==='tenants'?{message:'Controlled tenant read failure'}:null});},
   update(){writes++;throw Error('No completion write after upload failure');},
   then(resolve:(value:unknown)=>unknown){const failure=failedRead===(head?'outstanding':table==='paige_agreement_signers'?'signers':'events');
    return Promise.resolve(resolve({data:table==='paige_agreement_signers'&&failedRead!=='empty_signers'?[signer]:[],count:0,error:failure?{message:'Controlled original source read failure'}:null}));}};return q;},
  storage:{from(bucket:string){assertEquals(bucket,'paige-agreements');return {
   download(path:string){assertEquals(path,row.content_storage_key);return Promise.resolve({data:new Blob([Uint8Array.from(f.presentedBytes).buffer]),error:null});},
   upload(_path:string,bytes:Uint8Array){uploads.push(bytes);return Promise.resolve({error:{message:'Controlled upload failure before effects'}});}};}}};
 return {f,wire,row,db,uploads,calls,writes:()=>writes};
}
async function pageOperators(bytes:Uint8Array){
 const {PDFDocument,PDFArray,PDFRawStream,decodePDFRawStream}=await import('npm:pdf-lib@1.17.1');
 const pdf=await PDFDocument.load(bytes);
 return pdf.getPages().slice(0,4).map(page=>{const contents=page.node.Contents();if(!contents)return '';
  return (contents instanceof PDFArray?contents.asArray():[contents]).map(entry=>{
   const stream=pdf.context.lookup(entry);assert(stream instanceof PDFRawStream);
   return new TextDecoder().decode(decodePDFRawStream(stream).decode());}).join('\n');});
}
const hex=(value:string)=>[...value].map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('').toUpperCase();

Deno.test('incumbent prepared renderer places actual answers on the original four rotated pages',async()=>{
 const s=await setup(),pages=await pageOperators(await sealAgreementPdf(s.f));
 assertEquals(pages.length,4);for(const page of pages)assert(page.includes(hex('Approved scope')));
});
Deno.test('original completion caller consumes the selected native preparation instead of a legacy appended-signature fallback',async()=>{
 const s=await setup();assertEquals(await sealAndComplete(s.db,s.row.id),{ok:false,reason:'storage_failed',detail:'Controlled upload failure before effects'});
 assertEquals(s.calls,['_read_prepared_agreement_seal']);assertEquals(s.uploads.length,1);assertEquals(s.writes(),0);
 const pages=await pageOperators(s.uploads[0]);
 for(const page of pages){assert(page.includes(hex('Approved scope')));assert(page.includes(hex('JA')));assert(page.includes(hex('/s/ Jordan Avery')));}
});
for(const state of ['unavailable','not_ready','unknown'])Deno.test(`native ${state} cannot fall through to a legacy seal`,async()=>{
 const s=await setup(w=>{w.state=state;});assertEquals((await sealAndComplete(s.db,s.row.id)).ok,false);
 assertEquals(s.uploads.length,0);assertEquals(s.writes(),0);
});
Deno.test('a failed private read never authorizes sealing even when it accompanies a plausible prepared result',async()=>{
 const s=await setup(undefined,{message:'Controlled native read failure'});
 assertEquals((await sealAndComplete(s.db,s.row.id)).ok,false);assertEquals(s.uploads.length,0);
});
for(const failedRead of ['outstanding','signers','events','tenant','empty_signers'])Deno.test(`incomplete original ${failedRead} read cannot produce a completed document`,async()=>{
 const s=await setup(undefined,null,failedRead);
 assertEquals((await sealAndComplete(s.db,s.row.id)).ok,false);assertEquals(s.uploads.length,0);assertEquals(s.writes(),0);
});
for(const key of ['tenant_id','agreement_id','client_id','document_sha256','content_storage_key','source_version'])Deno.test(`prepared source mismatch ${key} refuses before upload`,async()=>{
 const s=await setup(w=>{w[key]=key==='source_version'?99:'different';});
 assertEquals((await sealAndComplete(s.db,s.row.id)).ok,false);assertEquals(s.uploads.length,0);
});
for(const which of ['missing_input','foreign_signer','changed_answer','missing_consent','missing_identity','duplicate_input'])Deno.test(`inconsistent original prepared evidence ${which} refuses rather than seals`,async()=>{
 const s=await setup(w=>{const p=w.prepared_fields as Awaited<ReturnType<typeof preparedSealFixture>>['preparedFields'];
  const signers=w.signers as Array<Record<string,unknown>>;
  if(which==='missing_input')p.inputs=[];
  if(which==='foreign_signer')p.inputs[0]={...p.inputs[0],signer_id:'aaaaaaaa-0000-4000-8000-000000000001'};
  if(which==='changed_answer')p.inputs[0]={...p.inputs[0],field_input_sha256:'a'.repeat(64)};
  if(which==='missing_consent')signers[0].esign_consent_at=null;
  if(which==='missing_identity')delete signers[0].id;
  if(which==='duplicate_input')p.inputs.push(structuredClone(p.inputs[0]));});
 assertEquals((await sealAndComplete(s.db,s.row.id)).ok,false);assertEquals(s.uploads.length,0);
});
