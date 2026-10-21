/** Teach CURA consumes the existing Knowledge and K1 audience RPCs through the
 * ordinary caller. No content copy, authority inference, automatic write retry
 * or new receipt. The native publisher and proposal hash remain authoritative.
 */
import {ResourceError, type ResourceRpc} from './customer-resources';
import {readKnowledgeExtractionForDocument,type ExtractionClient} from './knowledge-extraction-service';
import type {KnowledgeDocument} from './knowledge-service';

export interface CuraKnowledgeScope {actor: string; tenant: string}
export const CURA_KNOWLEDGE_KINDS = ['information','offer','promotion','faq','campaign_explainer','policy'] as const;
export type CuraKnowledgeKind = typeof CURA_KNOWLEDGE_KINDS[number];
export type CuraSourceState = 'draft'|'empty'|'not_entitled'|'needs_publication'|'prepared';
export type CuraShareState = 'not_shared'|'withdrawn'|'not_entitled'|'source_changed'|'scheduled'|'expired'|'shared';
export interface CuraBusinessShare {
 share_id: string; share_revision: number; document_revision: number; generation_id: string;
 source_fingerprint: string; customer_kind: CuraKnowledgeKind; valid_from: string|null; valid_until: string|null;
 state: Exclude<CuraShareState,'not_shared'>; granted_at: string; revoked_at: string|null; receipt_id: string;
}
export interface CuraKnowledgeSource {
 document_id: string; document_revision: number; title: string; source_state: CuraSourceState;
 pending_review: boolean; source_fingerprint: string; generation_id: string|null;
 share: CuraBusinessShare|null; share_state: CuraShareState; updated_at: string;
}
export interface CuraShareTerms {kind: CuraKnowledgeKind; validFrom: string|null; validUntil: string|null}
export type CuraCorrectionTarget=Pick<KnowledgeDocument,'id'|'tenant_id'|'revision'|'title'|'content'|'summary'|'category'|'tags'>;
export interface CuraShareProposal {
 tenant_id: string; audience: 'business'; document_id: string; available: boolean;
 customer_kind: CuraKnowledgeKind|null; valid_from: string|null; valid_until: string|null;
 expected_share_revision: number; proposal_hash: string; source_fingerprint: string|null;
 document_revision: number|null; generation_id: string|null; source: string|null; title: string|null;
 preview: string|null; preview_truncated: boolean; already_shared: boolean;
}
const object=(v: unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).length===keys.length&&keys.every(k=>k in v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const same=(v:unknown,id:string)=>uuid(v)&&v.toLowerCase()===id.toLowerCase();
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown,min=0):v is number=>Number.isSafeInteger(v)&&Number(v)>=min;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&Array.from(v).length<=max;
const date=(v:unknown):v is string=>typeof v==='string'&&v.length<=40&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v));
const nullableDate=(v:unknown)=>v===null||date(v);
const kind=(v:unknown):v is CuraKnowledgeKind=>typeof v==='string'&&(CURA_KNOWLEDGE_KINDS as readonly string[]).includes(v);
function bad():never{throw new ResourceError('CURA_KNOWLEDGE_RESPONSE_INVALID');}
function scope(v:CuraKnowledgeScope){if(!uuid(v.actor)||!uuid(v.tenant))throw new ResourceError('CURA_KNOWLEDGE_SCOPE_REQUIRED');}
function envelope(v:Record<string,unknown>,s:CuraKnowledgeScope){if(!same(v.tenant_id,s.tenant)||v.audience!=='business')bad();}
// Preserve native microseconds when comparing different ISO offset spellings.
function instant(value:string):bigint{
 const m=/^(.*?)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/.exec(value)!;
 return BigInt(Date.parse(m[1]+m[3]))*1000n+BigInt((m[2]??'').padEnd(6,'0'));
}
const sameDate=(a:string|null,b:string|null)=>a===null||b===null?a===b:instant(a)===instant(b);
async function call(client:ResourceRpc,name:string,args:Record<string,unknown>){
 const result=await client.rpc(name,args);
 if(result.error)throw new ResourceError(result.error.code??'CURA_KNOWLEDGE_REQUEST_FAILED');
 if(!object(result.data))bad();return result.data;
}
function share(v:unknown):v is CuraBusinessShare{
 return object(v)&&exact(v,['share_id','share_revision','document_revision','generation_id','source_fingerprint','customer_kind','valid_from','valid_until','state','granted_at','revoked_at','receipt_id'])
  &&uuid(v.share_id)&&integer(v.share_revision,1)&&integer(v.document_revision,1)&&uuid(v.generation_id)&&hash(v.source_fingerprint)
  &&kind(v.customer_kind)&&nullableDate(v.valid_from)&&nullableDate(v.valid_until)
  &&typeof v.state==='string'&&['withdrawn','not_entitled','source_changed','scheduled','expired','shared'].includes(v.state)
  &&date(v.granted_at)&&nullableDate(v.revoked_at)&&uuid(v.receipt_id)
  &&(v.revoked_at!==null)===(v.state==='withdrawn');
}
function source(v:unknown):v is CuraKnowledgeSource{
 if(!object(v)||!exact(v,['document_id','document_revision','title','source_state','pending_review','source_fingerprint','generation_id','share','share_state','updated_at'])
  ||!uuid(v.document_id)||!integer(v.document_revision,1)||!text(v.title,300)||typeof v.pending_review!=='boolean'
  ||!hash(v.source_fingerprint)||!(v.generation_id===null||uuid(v.generation_id))||!date(v.updated_at)
  ||typeof v.source_state!=='string'||!['draft','empty','not_entitled','needs_publication','prepared'].includes(v.source_state))return false;
 if(v.source_state==='prepared'&&!uuid(v.generation_id))return false;
 if(v.share===null)return v.share_state==='not_shared';
 if(!share(v.share)||v.share_state!==v.share.state)return false;
 if(['shared','scheduled','expired'].includes(v.share_state as string))return v.source_state==='prepared'
  &&same(v.share.generation_id,v.generation_id as string)&&v.share.document_revision===v.document_revision&&v.share.source_fingerprint===v.source_fingerprint;
 return true;
}
export async function readCuraKnowledge(client:ResourceRpc,s:CuraKnowledgeScope,options:{documentId?:string;query?:string;offset?:number}={}){
 scope(s);const offset=options.offset??0,query=options.query??'';
 if(!integer(offset)||offset>100000||!text(query,200)||(options.documentId!==undefined&&!uuid(options.documentId)))bad();
 const v=await call(client,'read_client_portal_business_knowledge',{p_tenant_id:s.tenant,p_document_id:options.documentId??null,p_query:query,p_limit:20,p_offset:offset});
 envelope(v,s);
 if(!exact(v,['tenant_id','audience','as_of','documents','next_offset','has_more'])||!date(v.as_of)
  ||!Array.isArray(v.documents)||v.documents.length>20||!v.documents.every(source)
  ||v.next_offset!==offset+v.documents.length||typeof v.has_more!=='boolean'||(v.has_more&&v.documents.length!==20)
  ||new Set(v.documents.map(d=>d.document_id)).size!==v.documents.length
  ||(options.documentId!==undefined&&(v.documents.length>1||v.documents.some(d=>!same(d.document_id,options.documentId!)))))bad();
 return {documents:v.documents as CuraKnowledgeSource[],nextOffset:v.next_offset as number,hasMore:v.has_more,asOf:v.as_of as string};
}
/** Drafts are intentionally absent from read_tenant_knowledge. Restore the exact
 * original reading plus its staged metadata; never submit another extraction. */
export async function readCuraKnowledgeDraft(client:ResourceRpc&ExtractionClient,s:CuraKnowledgeScope,row:CuraKnowledgeSource,isCurrent:()=>boolean):Promise<CuraCorrectionTarget>{
 scope(s);if(!source(row)||row.source_state!=='draft'||!isCurrent())bad();
 const review=await readKnowledgeExtractionForDocument(client,{tenantId:s.tenant,isCurrent},row.document_id,row.document_revision);
 if(!isCurrent()||review.record_state!=='draft'||!uuid(review.extraction_work_id))bad();
 const v=await call(client,'read_tenant_knowledge_pending',{p_expected_tenant:s.tenant,p_doc_id:row.document_id});
 if(!isCurrent()||v.contract_version!==1||!same(v.tenant_id,s.tenant)||!same(v.document_id,row.document_id)
  ||v.revision!==row.document_revision||v.record_state!=='draft'||!text(v.title,300)
  ||v.extraction_work_id!==review.extraction_work_id||v.review_available!==(review.pending_review!==null)
  ||!object(v.work)||v.work.work_id!==review.extraction_work_id||v.work.work_kind!=='knowledge_extract'||v.work.capability_key!=='knowledge.extract')bad();
 const pending=v.pending_review,original=review.pending_review;
 if(original===null?pending!==null:!object(pending)||pending.schema_version!==original.schema_version
  ||pending.extracted_content!==original.extracted_content||pending.reviewed_content!==original.reviewed_content
  ||pending.extraction_version!==original.extraction_version||pending.coverage!==original.coverage)bad();
 const metadata=v.pending_review_metadata;
 if(metadata!==null&&(!object(metadata)||!exact(metadata,['title','summary','category','tags'])||!text(metadata.title,300)||!metadata.title.trim()
  ||!(metadata.summary===null||text(metadata.summary,2000))||!(metadata.category===null||text(metadata.category,100))
  ||!Array.isArray(metadata.tags)||metadata.tags.length>20||!metadata.tags.every(tag=>text(tag,60))))bad();
 const staged=metadata as {title:string;summary:string|null;category:string|null;tags:string[]}|null;
 // Before the first saved review, draft metadata has not been proposed. These
 // empty form values are the incumbent first-review defaults, not a publication.
 return {id:row.document_id,tenant_id:s.tenant,revision:row.document_revision,title:staged?.title??v.title,
  content:review.pending_review?.reviewed_content??review.pending_review?.extracted_content??'',
  summary:staged?.summary??null,category:staged?.category??null,tags:staged?.tags??[]};
}
function proposal(v:Record<string,unknown>,s:CuraKnowledgeScope,id:string,available:boolean):asserts v is Record<string,unknown>&CuraShareProposal{
 envelope(v,s);
 if(!exact(v,['tenant_id','audience','document_id','available','customer_kind','valid_from','valid_until','expected_share_revision','proposal_hash','source_fingerprint','document_revision','generation_id','source','title','preview','preview_truncated','already_shared'])
  ||!same(v.document_id,id)||v.available!==available||!integer(v.expected_share_revision)||!hash(v.proposal_hash)
  ||!(v.source_fingerprint===null||hash(v.source_fingerprint))||!(v.document_revision===null||integer(v.document_revision,1))
  ||!(v.generation_id===null||uuid(v.generation_id))||!(v.source===null||text(v.source,100))
  ||!(v.customer_kind===null||kind(v.customer_kind))||!nullableDate(v.valid_from)||!nullableDate(v.valid_until)
  ||!(v.title===null||text(v.title,300))||!(v.preview===null||text(v.preview,1600))
  ||typeof v.preview_truncated!=='boolean'||typeof v.already_shared!=='boolean'
  ||!hash(v.source_fingerprint)||!integer(v.document_revision,1)||!uuid(v.generation_id)||!kind(v.customer_kind)
  ||(available&&(!text(v.source,100)||!text(v.title,300)||!text(v.preview,1600)))
  ||(!available&&(v.expected_share_revision<1||v.title!==null||v.preview!==null||v.source!==null||v.preview_truncated)))bad();
}
export async function prepareCuraKnowledgeShare(client:ResourceRpc,s:CuraKnowledgeScope,id:string,available:boolean,terms:CuraShareTerms):Promise<Readonly<CuraShareProposal>>{
 scope(s);if(!uuid(id)||typeof available!=='boolean'||!kind(terms.kind)||!nullableDate(terms.validFrom)||!nullableDate(terms.validUntil)
  ||(available&&terms.validFrom!==null&&terms.validUntil!==null&&instant(terms.validUntil)<=instant(terms.validFrom)))bad();
 const v=await call(client,'prepare_client_portal_business_knowledge_share',{p_tenant_id:s.tenant,p_document_id:id,p_available:available,
  p_customer_kind:terms.kind,p_valid_from:terms.validFrom,p_valid_until:terms.validUntil});
 proposal(v,s,id,available);
 if(available&&(v.customer_kind!==terms.kind||!sameDate(v.valid_from,terms.validFrom)||!sameDate(v.valid_until,terms.validUntil)))bad();
 return Object.freeze(v);
}
/** One deliberate attempt, then read original state/receipt on uncertain response. */
export async function commitCuraKnowledgeShare(client:ResourceRpc,s:CuraKnowledgeScope,p:Readonly<CuraShareProposal>,operationId:string){
 scope(s);proposal(p as unknown as Record<string,unknown>,s,p.document_id,p.available);
 if(!uuid(operationId))bad();
 const v=await call(client,'set_client_portal_business_knowledge_share',{p_tenant_id:s.tenant,p_document_id:p.document_id,p_available:p.available,
  p_customer_kind:p.customer_kind,p_valid_from:p.valid_from,p_valid_until:p.valid_until,p_expected_share_revision:p.expected_share_revision,
  p_proposal_hash:p.proposal_hash,p_operation_id:operationId});
 envelope(v,s);
 if(!exact(v,['tenant_id','audience','document_id','share_id','receipt_id','replayed','changed','original_revision','current_revision','customer_kind','valid_from','valid_until'])
  ||!same(v.document_id,p.document_id)||!same(v.receipt_id,operationId)||!uuid(v.share_id)||typeof v.replayed!=='boolean'||v.changed!==!v.replayed
  ||v.original_revision!==p.expected_share_revision+1||v.current_revision!==v.original_revision
  ||v.customer_kind!==p.customer_kind||!nullableDate(v.valid_from)||!nullableDate(v.valid_until)
  ||!sameDate(v.valid_from as string|null,p.valid_from)||!sameDate(v.valid_until as string|null,p.valid_until))bad();
 return {shareId:v.share_id,receiptId:v.receipt_id,replayed:v.replayed,revision:v.current_revision};
}
/** Proves this exact operation's original grant, not generic source availability. */
export function curaShareMatches(source:CuraKnowledgeSource,p:Readonly<CuraShareProposal>,operationId:string){
 const s=source.share;
 return source.document_id===p.document_id&&!!s&&s.receipt_id===operationId&&s.share_revision===p.expected_share_revision+1
  &&s.document_revision===p.document_revision&&s.generation_id===p.generation_id&&s.source_fingerprint===p.source_fingerprint
  &&s.customer_kind===p.customer_kind&&sameDate(s.valid_from,p.valid_from)&&sameDate(s.valid_until,p.valid_until)
  &&(p.available?s.revoked_at===null:s.revoked_at!==null);
}
