/** Original Chat host reference adapter. UNMOUNTED. This annotates/reconciles
 * existing native Knowledge work; it cannot upload, publish or approve facts. */
export interface ChatKnowledgeScope {
 actorId: string; tenantId: string; threadId: string | null; isCurrent(): boolean;
}
export interface ChatKnowledgePort {
 getScope(): PromiseLike<{actorId: string; tenantId: string}>;
 rpc(name: string,args: Record<string,unknown>): PromiseLike<{data: unknown; error: unknown}>;
}
export interface ChatKnowledgeSelection {
 publicationWorkId: string; documentId: string; documentRevision: number;
 extractionIntentId: string; sourceSha256: string; turnId: string | null;
 expectedLinkRevision: 0 | 1;
}
export interface ChatKnowledgeReference {
 schemaVersion: 1; actorId: string; tenantId: string; threadId: string; turnId: string | null;
 documentId: string; documentRevision: number; sourceSha256: string; textSha256: string;
 extractionWorkId: string; extractionIntentId: string; publicationWorkId: string;
 publicationIntentId: string; generationId: string;
 publicationOutcome: 'capability_succeeded' | 'capability_completed_unrecorded'; linkRevision: 1 | 2;
}
export type ChatKnowledgeInspection = {status: 'absent_at_read'}
 | {status: 'recorded'; current: false; reason: 'source_unavailable_or_changed' | 'message_unavailable_or_changed'}
 | {status: 'recorded'; current: true; reference: ChatKnowledgeReference};
export interface ChatKnowledgeIntakeSelection {
 extractionWorkId: string; extractionIntentId: string; documentId: string;
 expectedSourceRevision: number | null; sourceSha256: string; turnId: string | null; expectedLinkRevision: 0 | 1;
}
export interface ChatKnowledgeIntakeReference {
 schemaVersion: 1; phase: 'intake'; actorId: string; tenantId: string; threadId: string; turnId: string | null;
 documentId: string; documentRevision: number; sourceRevision: number; sourceSha256: string;
 extractionWorkId: string; extractionIntentId: string; linkRevision: 1 | 2;
}
export type ChatKnowledgeIntakeInspection = Exclude<ChatKnowledgeInspection,{status: 'recorded';current: true}>
 | {status: 'recorded';current: true;reference: ChatKnowledgeIntakeReference;currentDocumentRevision: number;
 extractionStatus: 'claimed'|'succeeded'|'failed'|'blocked'|'cancelled'|'expired'|'outcome_unknown'};
export class ChatKnowledgeError extends Error {
 readonly code: string; readonly mayHaveSaved: boolean;
 constructor(code: string,mayHaveSaved=false) {
  super('The Knowledge conversation link could not be verified.');
  this.code=code; this.mayHaveSaved=mayHaveSaved;
 }
}
const object=(v: unknown): v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v: unknown): v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash=(v: unknown): v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const exact=(v: Record<string,unknown>,keys: string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(v,k));
const fail=(code='RESPONSE_INVALID'): never=>{throw new ChatKnowledgeError(code)};
function capture(input: ChatKnowledgeScope): ChatKnowledgeScope {
 if(!uuid(input.actorId)||!uuid(input.tenantId)||(input.threadId!==null&&!uuid(input.threadId))||typeof input.isCurrent!=='function')return fail('INPUT_INVALID');
 let retired=false;
 return {actorId:input.actorId,tenantId:input.tenantId,threadId:input.threadId,isCurrent:()=>{
  try{if(!retired&&input.isCurrent()===true)return true}catch{/* retire failed host guards */}
  retired=true;return false;
 }};
}
async function current(client: ChatKnowledgePort,scope: ChatKnowledgeScope) {
 if(!scope.isCurrent())return fail('SCOPE_CHANGED');
 let resolved;
 try{resolved=await client.getScope()}catch{return fail('SCOPE_CHANGED')}
 if(!scope.isCurrent()||!object(resolved)||resolved.actorId!==scope.actorId||resolved.tenantId!==scope.tenantId)return fail('SCOPE_CHANGED');
}
const scopeArgs=(s: ChatKnowledgeScope)=>({_expected_tenant:s.tenantId,_expected_actor:s.actorId,_thread_id:s.threadId});
async function rpc(client: ChatKnowledgePort,scope: ChatKnowledgeScope,name: string,args: Record<string,unknown>) {
 await current(client,scope);
 let response;
 try{response=await client.rpc(name,args)}catch{await current(client,scope);return fail('READ_UNAVAILABLE')}
 await current(client,scope);
 if(response.error)return fail('READ_UNAVAILABLE');
 return response.data;
}
function inspection(data: unknown,scope: ChatKnowledgeScope,workId?: string): ChatKnowledgeInspection {
 if(!object(data))return fail();
 if(data.status==='absent_at_read'&&exact(data,['status']))return {status:'absent_at_read'};
 if(data.status!=='recorded')return fail();
 if(data.current===false&&exact(data,['status','current','reason'])
  &&(data.reason==='source_unavailable_or_changed'||data.reason==='message_unavailable_or_changed'))
  return {status:'recorded',current:false,reason:data.reason};
 const r=data.reference;
 if(data.current!==true||!exact(data,['status','current','reference'])||!object(r)
  ||!exact(r,['schemaVersion','actorId','tenantId','threadId','turnId','documentId','documentRevision','sourceSha256','textSha256',
   'extractionWorkId','extractionIntentId','publicationWorkId','publicationIntentId','generationId','publicationOutcome','linkRevision'])
  ||r.schemaVersion!==1||r.actorId!==scope.actorId||r.tenantId!==scope.tenantId||!uuid(r.threadId)||(scope.threadId!==null&&r.threadId!==scope.threadId)
  ||(r.turnId!==null&&!uuid(r.turnId))||!uuid(r.documentId)||!Number.isSafeInteger(r.documentRevision)||Number(r.documentRevision)<1||Number(r.documentRevision)>2147483647
  ||!hash(r.sourceSha256)||!hash(r.textSha256)||!uuid(r.extractionWorkId)||!uuid(r.extractionIntentId)
  ||!uuid(r.publicationWorkId)||!uuid(r.publicationIntentId)||r.generationId!==r.publicationWorkId
  ||(workId!==undefined&&r.publicationWorkId!==workId)||(r.linkRevision!==1&&r.linkRevision!==2)
  ||(r.publicationOutcome!=='capability_succeeded'&&r.publicationOutcome!=='capability_completed_unrecorded'))return fail();
 return JSON.parse(JSON.stringify(data)) as ChatKnowledgeInspection;
}
function selection(input: unknown): ChatKnowledgeSelection {
 if(!object(input)||!exact(input,['publicationWorkId','documentId','documentRevision','extractionIntentId','sourceSha256','turnId','expectedLinkRevision'])
  ||!uuid(input.publicationWorkId)||!uuid(input.documentId)||!Number.isSafeInteger(input.documentRevision)||Number(input.documentRevision)<1||Number(input.documentRevision)>2147483647
  ||!uuid(input.extractionIntentId)||!hash(input.sourceSha256)||(input.turnId!==null&&!uuid(input.turnId))
  ||(input.expectedLinkRevision!==0&&input.expectedLinkRevision!==1))return fail('INPUT_INVALID');
 return {...input} as unknown as ChatKnowledgeSelection;
}
function matches(r: ChatKnowledgeInspection,s: ChatKnowledgeSelection) {
 if(r.status!=='recorded'||!r.current||r.reference.documentId!==s.documentId||r.reference.documentRevision!==s.documentRevision
  ||r.reference.extractionIntentId!==s.extractionIntentId||r.reference.sourceSha256!==s.sourceSha256
  ||r.reference.publicationWorkId!==s.publicationWorkId||r.reference.turnId!==s.turnId)return fail('READBACK_MISMATCH');
 return r;
}
function intakeInspection(data: unknown,scope: ChatKnowledgeScope,workId?: string): ChatKnowledgeIntakeInspection {
 if(!object(data))return fail();
 if(data.status!=='recorded'||data.current!==true){
  const state=inspection(data,scope);
  if(state.status==='recorded'&&state.current===true)return fail();return state;
 }
 const r=data.reference;
 const integer=(v: unknown)=>Number.isInteger(v)&&Number(v)>0&&Number(v)<=2147483647;
 if(!exact(data,['status','current','reference','currentDocumentRevision','extractionStatus'])||!object(r)
  ||!exact(r,['schemaVersion','phase','actorId','tenantId','threadId','turnId','documentId','documentRevision','sourceRevision','sourceSha256','extractionWorkId','extractionIntentId','linkRevision'])
  ||r.schemaVersion!==1||r.phase!=='intake'||r.actorId!==scope.actorId||r.tenantId!==scope.tenantId||!uuid(r.threadId)
  ||(scope.threadId!==null&&r.threadId!==scope.threadId)||(r.turnId!==null&&!uuid(r.turnId))||!uuid(r.documentId)
  ||!integer(r.documentRevision)||!integer(r.sourceRevision)||Number(r.documentRevision)<Number(r.sourceRevision)
  ||!integer(data.currentDocumentRevision)||Number(data.currentDocumentRevision)<Number(r.documentRevision)
  ||!hash(r.sourceSha256)||!uuid(r.extractionWorkId)||!uuid(r.extractionIntentId)||(workId!==undefined&&r.extractionWorkId!==workId)
  ||(r.linkRevision!==1&&r.linkRevision!==2)||typeof data.extractionStatus!=='string'
  ||!['claimed','succeeded','failed','blocked','cancelled','expired','outcome_unknown'].includes(data.extractionStatus))return fail();
 return JSON.parse(JSON.stringify(data)) as ChatKnowledgeIntakeInspection;
}
function intakeSelection(input: unknown): ChatKnowledgeIntakeSelection {
 if(!object(input)||!exact(input,['extractionWorkId','extractionIntentId','documentId','expectedSourceRevision','sourceSha256','turnId','expectedLinkRevision'])
  ||!uuid(input.extractionWorkId)||!uuid(input.extractionIntentId)||!uuid(input.documentId)||!hash(input.sourceSha256)
  ||(input.expectedSourceRevision!==null&&(!Number.isInteger(input.expectedSourceRevision)||Number(input.expectedSourceRevision)<1||Number(input.expectedSourceRevision)>2147483647))
  ||(input.turnId!==null&&!uuid(input.turnId))||(input.expectedLinkRevision!==0&&input.expectedLinkRevision!==1))return fail('INPUT_INVALID');
 return {...input} as unknown as ChatKnowledgeIntakeSelection;
}
function matchesIntake(r: ChatKnowledgeIntakeInspection,s: ChatKnowledgeIntakeSelection) {
 if(r.status!=='recorded'||!r.current||r.reference.extractionWorkId!==s.extractionWorkId||r.reference.extractionIntentId!==s.extractionIntentId
  ||r.reference.documentId!==s.documentId||r.reference.sourceSha256!==s.sourceSha256||r.reference.turnId!==s.turnId
  ||(s.expectedSourceRevision!==null&&r.reference.sourceRevision!==s.expectedSourceRevision))return fail('READBACK_MISMATCH');
 return r;
}
export async function inspectChatKnowledgeLink(client: ChatKnowledgePort,inputScope: ChatKnowledgeScope,publicationWorkId: string) {
 const scope=capture(inputScope);if(!uuid(publicationWorkId))return fail('INPUT_INVALID');
 const d=await rpc(client,scope,'inspect_paige_chat_knowledge_link',{...scopeArgs(scope),_publication_work_id:publicationWorkId});
 if(!scope.isCurrent())return fail('SCOPE_CHANGED');
 return inspection(d,scope,publicationWorkId);
}
export async function inspectChatKnowledgeIntake(client: ChatKnowledgePort,inputScope: ChatKnowledgeScope,extractionWorkId: string) {
 const scope=capture(inputScope);if(!uuid(extractionWorkId))return fail('INPUT_INVALID');
 const d=await rpc(client,scope,'inspect_paige_chat_knowledge_intake',{...scopeArgs(scope),_extraction_work_id:extractionWorkId});
 if(!scope.isCurrent())return fail('SCOPE_CHANGED');return intakeInspection(d,scope,extractionWorkId);
}
export async function listChatKnowledgeLinks(client: ChatKnowledgePort,inputScope: ChatKnowledgeScope,afterWorkId: string|null=null) {
 const scope=capture(inputScope);if(afterWorkId!==null&&!uuid(afterWorkId))return fail('INPUT_INVALID');
 if(scope.threadId===null)return fail('INPUT_INVALID');
 const d=await rpc(client,scope,'list_paige_chat_knowledge_links',{...scopeArgs(scope),_after_work_id:afterWorkId,_limit:20});
 if(!scope.isCurrent())return fail('SCOPE_CHANGED');
 if(!object(d)||!exact(d,['items','nextCursor'])||!Array.isArray(d.items)||d.items.length>20
  ||(d.nextCursor!==null&&(!uuid(d.nextCursor)||d.items.length!==20)))return fail();
 return {items:d.items.map(v=>object(v)&&object(v.reference)&&v.reference.phase==='intake'?intakeInspection(v,scope):inspection(v,scope)),nextCursor:d.nextCursor as string|null};
}
/** Call only for the one original File selected by the explicit host Save action.
 * Hashing is not intake/publication/approval and persists no file/name/content. */
export async function captureChatKnowledgeAttachment(client: ChatKnowledgePort,inputScope: ChatKnowledgeScope,file: File) {
 const scope=capture(inputScope);
 if(!(file instanceof File)||file.size<1||file.size>2097152)return fail('INPUT_INVALID');
 await current(client,scope);
 let bytes;
 try{bytes=await file.arrayBuffer()}catch{await current(client,scope);return fail('SOURCE_BYTES_UNAVAILABLE')}
 await current(client,scope);
 let digest;
 try{digest=await crypto.subtle.digest('SHA-256',bytes)}catch{await current(client,scope);return fail('SOURCE_BYTES_UNAVAILABLE')}
 await current(client,scope);
 return {file,sourceSha256:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')};
}
/** An ephemeral handle fences uncertainty; the native original Work row holds
 * durability. Reopen calls inspect/list, never reconstructs an upload from it. */
function prepareOriginalReference<R extends {status: string;current?: boolean}>(client: ChatKnowledgePort,scope: ChatKnowledgeScope,
 name: string,args: Record<string,unknown>,read: ()=>Promise<R>,parse: (data: unknown)=>R,match: (result: R)=>R,thread: (result: R)=>string|undefined) {
 let busy=false,unknown=false,complete=false;
 async function inspect() {
  if(busy)return fail('BUSY');busy=true;
  try{
   const result=await read();
   if(result.status==='recorded'&&result.current){match(result);complete=true;unknown=false}
   else if(result.status==='absent_at_read')unknown=false;
   return result;
  }finally{busy=false}
 }
 async function save() {
  if(busy)return fail('BUSY');if(unknown)return fail('INSPECTION_REQUIRED');if(complete)return fail('ALREADY_RECORDED');
  busy=true;
  try{
   await current(client,scope);
   // Set BEFORE dispatch, including rejected/malformed responses. Never infer
   // transaction failure from a transport exception or observer callback.
   unknown=true;
   let result;
   try{
    const d=await rpc(client,scope,name,args);
    const saved=match(parse(d));result=match(await read());
    if(thread(saved)!==thread(result))return fail('READBACK_MISMATCH');
   }catch(error){throw new ChatKnowledgeError(error instanceof ChatKnowledgeError&&error.code==='SCOPE_CHANGED'?'SCOPE_CHANGED':'INSPECTION_REQUIRED',true)}
   if(!scope.isCurrent())throw new ChatKnowledgeError('SCOPE_CHANGED',true);
   unknown=false;complete=true;return result;
  }finally{busy=false}
 }
 return {save,inspect};
}
export function prepareChatKnowledgeLink(client: ChatKnowledgePort,inputScope: ChatKnowledgeScope,input: unknown) {
 const scope=capture(inputScope),s=selection(input);
 if(scope.threadId===null&&s.turnId!==null)return fail('INPUT_INVALID');
 return prepareOriginalReference<ChatKnowledgeInspection>(client,scope,'save_paige_chat_knowledge_link',{
  ...scopeArgs(scope),_turn_id:s.turnId,_publication_work_id:s.publicationWorkId,_document_id:s.documentId,
  _document_revision:s.documentRevision,_extraction_intent_id:s.extractionIntentId,_source_sha256:s.sourceSha256,_expected_link_revision:s.expectedLinkRevision},
  ()=>inspectChatKnowledgeLink(client,scope,s.publicationWorkId),d=>inspection(d,scope,s.publicationWorkId),r=>matches(r,s),
  r=>r.status==='recorded'&&r.current?r.reference.threadId:undefined);
}
export function prepareChatKnowledgeIntake(client: ChatKnowledgePort,inputScope: ChatKnowledgeScope,input: unknown) {
 const scope=capture(inputScope),s=intakeSelection(input);
 if(scope.threadId===null&&s.turnId!==null)return fail('INPUT_INVALID');
 const original=prepareOriginalReference<ChatKnowledgeIntakeInspection>(client,scope,'stage_paige_chat_knowledge_intake',{
  ...scopeArgs(scope),_turn_id:s.turnId,_extraction_work_id:s.extractionWorkId,_document_id:s.documentId,
  _expected_source_revision:s.expectedSourceRevision,_extraction_intent_id:s.extractionIntentId,
  _source_sha256:s.sourceSha256,_expected_link_revision:s.expectedLinkRevision},
  ()=>inspectChatKnowledgeIntake(client,scope,s.extractionWorkId),d=>intakeInspection(d,scope,s.extractionWorkId),r=>matchesIntake(r,s),
  r=>r.status==='recorded'&&r.current?r.reference.threadId:undefined);
 return {stage:original.save,inspect:original.inspect};
}
