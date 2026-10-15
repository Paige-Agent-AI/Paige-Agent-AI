import {UUID} from '../sales-collections/primitives.ts';
import {commercialPreparationCommand,parseCommercialPreparationCommand,type CommercialPreparationCommand} from '../sales-commercial/preparation-command.ts';
import {readCommercialPresentationSource} from './commercial-presentation-read.ts';
import {canonicalPresentationJson,prepareCommercialPresentation,renderCommercialPresentation,type CommercialPresentationPayload} from './commercial-presentation.ts';
import {verifyRetainedAgreementPdf} from './retained-document.ts';

type Caller=Parameters<typeof readCommercialPresentationSource>[2];
type Store={from(bucket:string):{
 upload(path:string,bytes:Uint8Array,options:{contentType:string;upsert:false}):PromiseLike<{error:unknown}>;
 download(path:string):PromiseLike<{data:{size:number;arrayBuffer():Promise<ArrayBuffer>}|null;error:unknown}>;
}};
export type PreparedAgreementArtifact={
 payload:CommercialPresentationPayload;payload_digest:string;presented_body_markdown:string;
 presented_body_sha256:string;content_storage_key:string;document_sha256:string;
};
export class AgreementPreparationUnavailable extends Error{
 constructor(public readonly code:'SOURCE_UNAVAILABLE'|'SOURCE_CHANGED'|'RENDER_UNAVAILABLE'|'WORKSPACE_CHANGED'|'STORAGE_UNVERIFIED'){
  super('AGREEMENT_PREPARATION_'+code);
 }
}
/** Internal artifact adapter AFTER the real high/confirm gate. Exact caller-JWT
 * source -> incumbent renderer -> immutable private upload -> actual readback.
 * Canonical SQL must still atomically recheck/freeze/record the receipt. This
 * helper does not claim a prepared business record or request any signature. */
export async function prepareRetainedAgreementArtifact(
 tenant:string,operation:string,command:CommercialPreparationCommand,caller:Caller,storage:Store,
 stillCurrent:()=>Promise<boolean>,renderer?:Parameters<typeof renderCommercialPresentation>[2],
):Promise<PreparedAgreementArtifact>{
 if(!UUID.test(tenant)||!UUID.test(operation))throw new AgreementPreparationUnavailable('SOURCE_UNAVAILABLE');
 const captured=parseCommercialPreparationCommand(command);
 if(!await stillCurrent())throw new AgreementPreparationUnavailable('WORKSPACE_CHANGED');
 const source=await readCommercialPresentationSource(tenant,{invoice_id:captured.invoice_id,agreement_id:captured.agreement_id},caller);
 if(source.state!=='source')throw new AgreementPreparationUnavailable('SOURCE_UNAVAILABLE');
 const proposed=await prepareCommercialPresentation(source.input);
 if(proposed.payload.source.tenant_id!==tenant||canonicalPresentationJson(commercialPreparationCommand(proposed))!==canonicalPresentationJson(captured))throw new AgreementPreparationUnavailable('SOURCE_CHANGED');
 if(!await stillCurrent())throw new AgreementPreparationUnavailable('WORKSPACE_CHANGED');
 let rendered:Awaited<ReturnType<typeof renderCommercialPresentation>>;
 try{rendered=await renderCommercialPresentation(source.input,proposed,renderer);}
 catch{throw new AgreementPreparationUnavailable('RENDER_UNAVAILABLE');}
 if(!await verifyRetainedAgreementPdf(rendered.document_bytes,rendered.document_sha256))throw new AgreementPreparationUnavailable('RENDER_UNAVAILABLE');
 if(!await stillCurrent())throw new AgreementPreparationUnavailable('WORKSPACE_CHANGED');
 const path=`${tenant}/${captured.agreement_id}/presented-commercial-${operation}-${captured.payload_digest}.pdf`;
 const bucket=storage.from('paige-agreements');
 // A prior interrupted upload of THIS operation may already exist. Never upsert,
 // choose a replacement path or adopt different bytes; read the exact owned key.
 try{await bucket.upload(path,rendered.document_bytes,{contentType:'application/pdf',upsert:false});}catch{/* Readback decides whether the original exact artifact is available. */}
 let retained:Awaited<ReturnType<typeof bucket.download>>;
 try{retained=await bucket.download(path);}catch{throw new AgreementPreparationUnavailable('STORAGE_UNVERIFIED');}
 if(retained.error||!retained.data||retained.data.size!==rendered.document_bytes.byteLength)throw new AgreementPreparationUnavailable('STORAGE_UNVERIFIED');
 let bytes:Uint8Array;
 try{bytes=new Uint8Array(await retained.data.arrayBuffer());}catch{throw new AgreementPreparationUnavailable('STORAGE_UNVERIFIED');}
 if(!await verifyRetainedAgreementPdf(bytes,rendered.document_sha256))throw new AgreementPreparationUnavailable('STORAGE_UNVERIFIED');
 if(!await stillCurrent())throw new AgreementPreparationUnavailable('WORKSPACE_CHANGED');
 return {payload:rendered.payload,payload_digest:rendered.payload_digest,presented_body_markdown:rendered.presented_body_markdown,
  presented_body_sha256:rendered.presented_body_sha256,content_storage_key:path,document_sha256:rendered.document_sha256};
}
