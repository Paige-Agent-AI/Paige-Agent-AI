import {UUID,object} from '../sales-collections/primitives.ts';
import {inspectAgreementPreparationPdf} from './document-preparation.ts';
import {sha256Hex} from './token.ts';
import type {AgreementPdfDocument} from './field-preparation.ts';

/** The ORIGINAL private bucket and Storage SDK, not an agreement/document store.
 * Production policy grants no human write/update/delete in paige-agreements.
 * Only an already authorized original owner-domain handler supplies these ports.
 * No overwrite/delete/signed URL or financial/signing/provider effect. */
export type PreparationStorage={from(bucket:string):{
  info(path:string):PromiseLike<{data:unknown;error:unknown}>;
  upload(path:string,bytes:Uint8Array,options:{contentType:string;upsert:false;cacheControl:string;metadata:Record<string,unknown>}):PromiseLike<{error:unknown}>;
  download(path:string):PromiseLike<{data:{size:number;arrayBuffer():Promise<ArrayBuffer>}|null;error:unknown}>;
}};
export type PreparationArtifactIntent={tenantId:string;agreementId:string;requestId:string;actorUserId:string;sourceSha256:string};
export type PreparationArtifact={bytes:Uint8Array;document:AgreementPdfDocument;storageKey:string};
export class PreparationArtifactUnavailable extends Error{
  constructor(readonly code:'INTENT_INVALID'|'CONTEXT_RETIRED'|'DOCUMENT_UNAVAILABLE'|'STORAGE_UNVERIFIED'){
    super('AGREEMENT_PREPARATION_'+code);
  }
}
const fail=(code:PreparationArtifactUnavailable['code']):never=>{throw new PreparationArtifactUnavailable(code);};
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const size=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=5&&v<=26214400;
type FileInfo={id:string;version:string;byteLength:number;documentSha256:string};
function readInfo(value:unknown,path:string,expected:Record<string,unknown>):FileInfo{
  if(!object(value)||typeof value.id!=='string'||!UUID.test(value.id)||typeof value.version!=='string'||!value.version||value.version.length>128
    ||value.name!==path||value.bucketId!=='paige-agreements'||value.contentType!=='application/pdf'||!size(value.size)||!object(value.metadata))return fail('STORAGE_UNVERIFIED');
  const meta=value.metadata,keys=[...Object.keys(expected),'documentSha256','byteLength'];
  if(Object.keys(meta).length!==keys.length||Object.keys(meta).some(key=>!keys.includes(key))
    ||Object.entries(expected).some(([key,v])=>meta[key]!==v)||!hash(meta.documentSha256)||meta.byteLength!==value.size)return fail('STORAGE_UNVERIFIED');
  return {id:value.id,version:value.version,byteLength:value.size,documentSha256:meta.documentSha256};
}
function checkIntent(intent:PreparationArtifactIntent):PreparationArtifactIntent{
  const keys=['tenantId','agreementId','requestId','actorUserId','sourceSha256'];
  if(!object(intent)||Object.keys(intent).length!==keys.length||Object.keys(intent).some(key=>!keys.includes(key))
    ||![intent.tenantId,intent.agreementId,intent.requestId,intent.actorUserId].every(v=>typeof v==='string'&&UUID.test(v)&&v===v.toLowerCase())
    ||!hash(intent.sourceSha256))return fail('INTENT_INVALID');
  return {...intent};
}
export function preparationArtifactKey(intent:PreparationArtifactIntent):string{
  const checked=checkIntent(intent);
  return `${checked.tenantId}/${checked.agreementId}/draft-preparation-${checked.requestId}.pdf`;
}

/** Internal draft preparation; caller has already established original Auth,
 * business/owner floor and source CAS. Pin intent BEFORE awaiting. A retry first
 * adopts the SAME immutable object; native renderer timestamps must not produce
 * another expected hash. Only a genuine NoSuchKey404 permits a first render. */
export async function retainPreparationArtifact(
  intent:PreparationArtifactIntent,storage:PreparationStorage,renderOriginal:()=>Promise<Uint8Array>,
  stillCurrent:()=>Promise<boolean>,
):Promise<PreparationArtifact>{
  const captured=checkIntent(intent),path=preparationArtifactKey(captured);
  const expected={schemaVersion:1,kind:'draft_document_preparation',...captured};
  const bucket=storage.from('paige-agreements');
  const current=async()=>{try{if(!await stillCurrent())return fail('CONTEXT_RETIRED');}catch{return fail('CONTEXT_RETIRED');}};
  const info=async(allowMissing:boolean):Promise<FileInfo|null>=>{
    let result:Awaited<ReturnType<typeof bucket.info>>;
    try{result=await bucket.info(path);}catch{return fail('STORAGE_UNVERIFIED');}
    if(result.error){
      if(allowMissing&&object(result.error)&&(result.error.statusCode===404||result.error.statusCode==='404')&&result.error.code==='NoSuchKey')return null;
      return fail('STORAGE_UNVERIFIED');
    }
    return readInfo(result.data,path,expected);
  };
  await current();
  let retained=await info(true);
  if(!retained){
    await current();
    let bytes:Uint8Array;
    try{bytes=(await renderOriginal()).slice();}catch{return fail('DOCUMENT_UNAVAILABLE');}
    if(!(bytes instanceof Uint8Array)||!size(bytes.length))return fail('DOCUMENT_UNAVAILABLE');
    const documentSha256=await sha256Hex(bytes);
    try{await inspectAgreementPreparationPdf(bytes,documentSha256);}catch{return fail('DOCUMENT_UNAVAILABLE');}
    await current();
    try{await bucket.upload(path,bytes,{contentType:'application/pdf',upsert:false,cacheControl:'0',metadata:{...expected,documentSha256,byteLength:bytes.length}});}
    catch{/* Neither an error nor a timeout proves that the original upload failed. */}
    retained=await info(false);
  }
  if(!retained)return fail('STORAGE_UNVERIFIED');
  await current();
  let file:Awaited<ReturnType<typeof bucket.download>>;
  try{file=await bucket.download(path);}catch{return fail('STORAGE_UNVERIFIED');}
  if(file.error||!file.data||file.data.size!==retained.byteLength)return fail('STORAGE_UNVERIFIED');
  let bytes:Uint8Array,document:AgreementPdfDocument;
  try{bytes=new Uint8Array(await file.data.arrayBuffer());if(bytes.length!==retained.byteLength)return fail('STORAGE_UNVERIFIED');document=await inspectAgreementPreparationPdf(bytes,retained.documentSha256);}
  catch{return fail('STORAGE_UNVERIFIED');}
  const after=await info(false);
  if(!after||after.id!==retained.id||after.version!==retained.version||after.byteLength!==retained.byteLength||after.documentSha256!==retained.documentSha256)return fail('STORAGE_UNVERIFIED');
  await current();
  return {bytes,document,storageKey:path};
}

/** Read only AFTER the original native owner reader supplied this exact key,
 * checksum and length. Historical versions need no refreshed source/actor
 * substitution: their immutable native document digest is the authority. */
export async function readPreparationArtifact(
  tenantId:string,agreementId:string,path:string,documentSha256:string,byteLength:number,
  storage:PreparationStorage,stillCurrent:()=>Promise<boolean>,
):Promise<PreparationArtifact>{
  if(!UUID.test(tenantId)||!UUID.test(agreementId)||!hash(documentSha256)||!size(byteLength))return fail('INTENT_INVALID');
  const prefix=`${tenantId}/${agreementId}/draft-preparation-`;
  if(!path.startsWith(prefix)||!path.endsWith('.pdf'))return fail('INTENT_INVALID');
  const requestId=path.slice(prefix.length,-4);
  if(!UUID.test(requestId)||requestId!==requestId.toLowerCase())return fail('INTENT_INVALID');
  const current=async()=>{try{if(!await stillCurrent())return fail('CONTEXT_RETIRED');}catch{return fail('CONTEXT_RETIRED');}};
  const bucket=storage.from('paige-agreements');
  const info=async()=>{
    let result:Awaited<ReturnType<typeof bucket.info>>;try{result=await bucket.info(path);}catch{return fail('STORAGE_UNVERIFIED');}
    if(result.error||!object(result.data)||!object(result.data.metadata))return fail('STORAGE_UNVERIFIED');
    const metadata=result.data.metadata;
    const intent=checkIntent({tenantId,agreementId,requestId,actorUserId:metadata.actorUserId as string,sourceSha256:metadata.sourceSha256 as string});
    const value=readInfo(result.data,path,{schemaVersion:1,kind:'draft_document_preparation',...intent});
    if(value.documentSha256!==documentSha256||value.byteLength!==byteLength)return fail('STORAGE_UNVERIFIED');
    return value;
  };
  await current();const before=await info();await current();
  let file:Awaited<ReturnType<typeof bucket.download>>;try{file=await bucket.download(path);}catch{return fail('STORAGE_UNVERIFIED');}
  if(file.error||!file.data||file.data.size!==byteLength)return fail('STORAGE_UNVERIFIED');
  let bytes:Uint8Array,document:AgreementPdfDocument;
  try{bytes=new Uint8Array(await file.data.arrayBuffer());if(bytes.length!==byteLength)return fail('STORAGE_UNVERIFIED');document=await inspectAgreementPreparationPdf(bytes,documentSha256);}catch{return fail('STORAGE_UNVERIFIED');}
  const after=await info();
  if(after.id!==before.id||after.version!==before.version)return fail('STORAGE_UNVERIFIED');
  await current();return {bytes,document,storageKey:path};
}
