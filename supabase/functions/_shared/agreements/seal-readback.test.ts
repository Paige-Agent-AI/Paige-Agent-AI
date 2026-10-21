import {assertEquals} from 'https://deno.land/std@0.190.0/testing/asserts.ts';
import {sealAndComplete} from './seal.ts';
import {renderPresentedPdf,sealAgreementPdf} from './document.ts';
import {sha256Hex} from './token.ts';

const tenant='ec042000-0000-4000-8000-000000000001';
const agreement='ec042000-0000-4000-8000-000000000002';
const key=`${tenant}/${agreement}/sealed-synthetic.pdf`;
const pdf=await renderPresentedPdf({title:'Synthetic retained agreement',bodyMarkdown:'Recorded service responsibilities.'});
const digest=await sha256Hex(pdf);

function fixture(change:Record<string,unknown>={},storage='ready',readError:unknown=null){
  const row={id:agreement,tenant_id:tenant,title:'Synthetic retained agreement',status:'completed',
    body_source:'paige_draft',body_markdown:'Recorded service responsibilities.',content_storage_key:key,
    content_sha256:digest,sealed_storage_key:key,sealed_sha256:digest,...change};
  const reads:string[]=[],downloads:string[]=[];let columns='';
  const db={from(table:string){
    reads.push(table);assertEquals(table,'paige_agreements');
    const query={select(value:string){columns=value;return query;},eq(field:string,value:string){assertEquals([field,value],['id',agreement]);return query;},
      maybeSingle(){return Promise.resolve({data:Object.fromEntries(columns.split(',').filter(name=>name in row).map(name=>[name,(row as Record<string,unknown>)[name]])),error:readError});}};
    return query;
  },storage:{from(bucket:string){assertEquals(bucket,'paige-agreements');return {download(path:string){
    downloads.push(path);
    if(storage==='throws')throw Error('Synthetic storage unavailable');
    if(storage==='missing')return Promise.resolve({data:null,error:{message:'Synthetic unavailable'}});
    const bytes=storage==='changed'?new TextEncoder().encode('%PDF-changed'):storage==='nonpdf'?new TextEncoder().encode('plain text'):pdf;
    return Promise.resolve({data:new Blob([Uint8Array.from(bytes).buffer]),error:null});
  }};}}};
  return {db,reads,downloads};
}
Deno.test('completed retry returns the actual retained key and verifies its bytes without writes or notices',async()=>{
  const {db,reads,downloads}=fixture();
  assertEquals(await sealAndComplete(db,agreement),{ok:true,sealedSha256:digest,sealedKey:key});
  assertEquals(reads,['paige_agreements']);assertEquals(downloads,[key]);
});
for(const status of ['partially_signed','sent','voided'])Deno.test(`a sealed digest alone never proves completion in ${status}`,async()=>{
  const {db}=fixture({status});assertEquals((await sealAndComplete(db,agreement)).ok,false);
});
for(const value of [null,'','   '])Deno.test(`completed retry refuses missing retained key ${JSON.stringify(value)}`,async()=>{
  const {db,downloads}=fixture({sealed_storage_key:value});
  assertEquals((await sealAndComplete(db,agreement)).ok,false);assertEquals(downloads,[]);
});
for(const storage of ['missing','changed','throws','nonpdf'])Deno.test(`completed retry refuses ${storage} retained evidence without re-sealing`,async()=>{
  const change=storage==='nonpdf'?{sealed_sha256:await sha256Hex(new TextEncoder().encode('plain text'))}:{};
  const {db,reads}=fixture(change,storage);assertEquals((await sealAndComplete(db,agreement)).ok,false);
  assertEquals(reads,['paige_agreements']);
});
Deno.test('completed retry refuses an invalid canonical digest before reading storage',async()=>{
  const {db,downloads}=fixture({sealed_sha256:'invalid'});
  assertEquals((await sealAndComplete(db,agreement)).ok,false);assertEquals(downloads,[]);
});
Deno.test('a failed record read cannot confirm completion even if a data object accompanies it',async()=>{
  const {db,downloads}=fixture({},'ready',{message:'Synthetic read failed'});
  assertEquals((await sealAndComplete(db,agreement)).ok,false);assertEquals(downloads,[]);
});
for(const sealed_sha256 of [null,undefined,''])Deno.test(`completed retry refuses absent canonical digest ${JSON.stringify(sealed_sha256)} without a new seal`,async()=>{
  const {db,reads,downloads}=fixture({sealed_sha256});
  assertEquals((await sealAndComplete(db,agreement)).ok,false);
  assertEquals(reads,['paige_agreements']);assertEquals(downloads,[]);
});

const stamp='2026-10-14T12:00:00.000Z';
const signedParty={full_name:'Synthetic Signer',email:'synthetic@example.invalid',signer_role:'counterparty',signing_order:1,
  status:'signed',typed_name:'Synthetic Signer',signed_at:stamp,esign_consent_at:stamp,esign_consent_slug:'synthetic-esign',esign_consent_version:1};
const winningPdf=await sealAgreementPdf({presentedBytes:pdf,presentedSha256:digest,presentedKind:'file',
  agreementTitle:'Synthetic retained agreement',agreementId:agreement,tenantName:'Synthetic business',sealedAtIso:stamp,
  parties:[{fullName:signedParty.full_name,email:signedParty.email,role:'counterparty',signingOrder:1,status:'signed',typedName:signedParty.typed_name,
    signedAt:stamp,consentAt:stamp,consentSlug:'synthetic-esign',consentVersion:1,signingIp:null,signingUserAgent:null,signatureImagePng:null}],events:[]});
const winningDigest=await sha256Hex(winningPdf);

function losingSealFixture(mode='ready'){
  const presentedKey=`${tenant}/${agreement}/presented-synthetic.pdf`;
  const winnerKey=`${tenant}/${agreement}/winner-synthetic.pdf`;
  const files=new Map<string,Uint8Array>([[presentedKey,pdf],[winnerKey,mode==='corrupt'?pdf:winningPdf]]);
  const row:Record<string,unknown>={id:agreement,tenant_id:tenant,title:'Synthetic retained agreement',status:'partially_signed',
    body_source:'paige_draft',body_markdown:'Recorded service responsibilities.',content_storage_key:presentedKey,content_sha256:digest,sealed_sha256:null,sealed_storage_key:null};
  let agreementReads=0,completionAttempts=0;const removed:string[]=[];
  const db={from(table:string){
    let columns='',writing=false;const query={
      select(value:string){columns=value;return query;},eq(){return query;},neq(){return query;},in(){return query;},order(){return query;},
      update(){assertEquals(table,'paige_agreements');writing=true;completionAttempts++;return query;},
      insert(){throw Error('Losing seal must not file notices or events');},
      maybeSingle(){
        if(table==='tenants')return Promise.resolve({data:{name:'Synthetic business'},error:null});
        assertEquals(table,'paige_agreements');agreementReads++;
        const value=agreementReads===1?row:{status:mode==='noncompleted'?'partially_signed':'completed',sealed_storage_key:winnerKey,sealed_sha256:winningDigest};
        return Promise.resolve({data:Object.fromEntries(columns.split(',').filter(name=>name in value).map(name=>[name,value[name]])),error:mode==='read_error'&&agreementReads>1?{message:'Synthetic winner read failed'}:null});
      },
      then(resolve:(value:Record<string,unknown>)=>unknown){
        assertEquals(['paige_agreements','paige_agreement_signers','paige_agreement_events'].includes(table),true);
        return Promise.resolve(resolve(table==='paige_agreements'&&writing?{data:[],error:null}:table==='paige_agreement_signers'?{data:[signedParty],count:0,error:null}:{data:[],error:null}));
      },
    };return query;
  },storage:{from(bucket:string){assertEquals(bucket,'paige-agreements');return {
    upload(path:string,bytes:Uint8Array){files.set(path,bytes);return Promise.resolve({error:null});},
    download(path:string){const bytes=files.get(path);return Promise.resolve({data:bytes?new Blob([Uint8Array.from(bytes).buffer]):null,error:bytes?null:{message:'Synthetic missing'}});},
    remove(paths:string[]){for(const path of paths){removed.push(path);files.delete(path);}return Promise.resolve({error:null});},
  };}}};
  return {db,winnerKey,files,removed,attempts:()=>completionAttempts};
}
for(const mode of ['ready','corrupt','noncompleted','read_error'])Deno.test(`losing completion race ${mode} reads the canonical winner without a second effect`,async()=>{
  const fixture=losingSealFixture(mode),outcome=await sealAndComplete(fixture.db,agreement);
  assertEquals(outcome.ok,mode==='ready');
  if(mode==='ready')assertEquals(outcome,{ok:true,sealedSha256:winningDigest,sealedKey:fixture.winnerKey});
  assertEquals(fixture.attempts(),1);assertEquals(fixture.removed.length,1);
  assertEquals(fixture.removed.includes(fixture.winnerKey),false);assertEquals(fixture.files.has(fixture.winnerKey),true);
});
