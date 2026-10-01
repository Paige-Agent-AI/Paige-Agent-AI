import { bindKnowledgeIngestScope } from './knowledge-ingest-scope.ts';

export type ExtractionRpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {message?: string} | null}> };
export type TextSource = {text: string; sha256: string; byte_size: number; mime_type: string};
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 480000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class ExtractionError extends Error { constructor(public code: string) { super(code); } }
function fail(code: string): never { throw new ExtractionError(code); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('input_invalid'); return value as Record<string, unknown>; }
export async function sourceHash(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2,'0')).join('');
}
async function rpc(client: ExtractionRpc, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.rpc(name,args);
  if (result.error) throw new Error(result.error.message ?? 'rpc_failed');
  return result.data;
}
function textValid(text: string): boolean { return text.length>0 && text.length<=MAX_CHARS && !text.includes('\0'); }
export async function downloadKnowledgeText(url: string, headers: Record<string,string>, fetcher: typeof fetch = fetch): Promise<TextSource> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),30000);
  try {
    const response = await fetcher(url,{headers,signal:controller.signal,redirect:'error'});
    if (!response.ok || !response.body) return fail('source_unavailable');
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!mime.startsWith('text/') && mime!=='application/json') return fail('input_invalid');
    const length = response.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length)>MAX_BYTES)) { await response.body.cancel(); return fail('input_invalid'); }
    const reader = response.body.getReader(); const pieces: Uint8Array[]=[]; let size=0;
    try {
      for (;;) { const part=await reader.read(); if (part.done) break; size+=part.value.byteLength; if(size>MAX_BYTES) return fail('input_invalid'); pieces.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if(size===0) return fail('input_invalid');
    const bytes=new Uint8Array(size); let offset=0; for(const part of pieces){ bytes.set(part,offset); offset+=part.length; }
    let text: string;
    try { text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); } catch { return fail('input_invalid'); }
    if(!textValid(text)) return fail('input_invalid');
    return {text,sha256:await sourceHash(bytes),byte_size:size,mime_type:mime};
  } finally { clearTimeout(timer); }
}

// caller is the verified JWT client; the admin RPC independently checks current actor authority.
export async function submitKnowledgeExtraction(input: unknown, caller: Parameters<typeof bindKnowledgeIngestScope>[0], admin: ExtractionRpc, download: (path:string)=>Promise<TextSource>): Promise<unknown> {
  const b=record(input);
  if(Object.keys(b).some(k=>!['intent_id','expected_tenant','doc_id','expected_revision','title','kind','content','path'].includes(k)) || typeof b.intent_id!=='string' || !UUID.test(b.intent_id) || typeof b.expected_tenant!=='string' || !UUID.test(b.expected_tenant) || typeof b.title!=='string' || !b.title.trim() || b.title.trim().length>300) return fail('input_invalid');
  if((b.doc_id===undefined)!==(b.expected_revision===undefined) || (b.doc_id!==undefined && (typeof b.doc_id!=='string' || !UUID.test(b.doc_id) || !Number.isInteger(b.expected_revision) || Number(b.expected_revision)<1))) return fail('input_invalid');
  if(b.kind!=='paste' && b.kind!=='file') return fail('unsupported_source');
  if(b.kind==='paste' && (typeof b.content!=='string' || !textValid(b.content) || new TextEncoder().encode(b.content).length>MAX_BYTES || b.path!==undefined)) return fail('input_invalid');
  if(b.kind==='file' && (typeof b.path!=='string' || b.path.length>1024 || b.path.includes('%') || !/\.(txt|md|markdown|csv|json)$/i.test(b.path) || b.content!==undefined)) return fail('unsupported_source');
  const scope=await bindKnowledgeIngestScope(caller,b.expected_tenant,b.kind==='file'? b.path as string:undefined);
  let source: Record<string,unknown>|null=null;
  if(b.kind==='file') {
    const identity=record(await rpc(admin,'resolve_knowledge_extraction_source',{_actor:scope.userId,_tenant:scope.tenantId,_path:b.path}));
    if(identity.object_name!==b.path || identity.bucket!=='tenant-knowledge' || typeof identity.object_id!=='string' || !UUID.test(identity.object_id)) return fail('source_changed');
    const bytes=await download(b.path as string);
    await scope.assert();
    const after=record(await rpc(admin,'resolve_knowledge_extraction_source',{_actor:scope.userId,_tenant:scope.tenantId,_path:b.path}));
    if(after.object_id!==identity.object_id) return fail('source_changed');
    source={...identity,sha256:bytes.sha256,byte_size:bytes.byte_size,mime_type:bytes.mime_type,bound_at:new Date().toISOString()};
  }
  await scope.assert();
  return rpc(admin,'submit_knowledge_extraction',{_actor:scope.userId,_tenant:scope.tenantId,_intent:b.intent_id,_doc_id:b.doc_id??null,_expected_revision:b.expected_revision??null,_title:b.title.trim(),_input:b.kind==='paste'? b.content:null,_source:source});
}

export async function runKnowledgeExtraction(admin: ExtractionRpc, workId: string, download: (path:string)=>Promise<TextSource>): Promise<Record<string,unknown>> {
  const w=record(await rpc(admin,'start_knowledge_extraction',{_work_id:workId}));
  if(w.status==='blocked') return {ok:false,status:'blocked',work_id:workId};
  if(w.status!=='claimed' || w.work_id!==workId || typeof w.server_key!=='string' || !Number.isInteger(w.attempt) || !Number.isInteger(w.revision)) return fail('input_invalid');
  let completionSent=false;
  try {
    let content: string; let hash: string;
    if(w.source!==null) {
      const source=record(w.source);
      if(typeof source.object_name!=='string' || !/\.(txt|md|markdown|csv|json)$/i.test(source.object_name)) return fail('input_invalid');
      const identity=record(await rpc(admin,'resolve_knowledge_extraction_source',{_actor:w.actor_id,_tenant:w.tenant_id,_path:source.object_name}));
      if(identity.object_id!==source.object_id) return fail('source_changed');
      const bytes=await download(source.object_name);
      if(bytes.sha256!==source.sha256 || bytes.sha256!==w.input_hash || bytes.byte_size!==source.byte_size) return fail('source_changed');
      content=bytes.text;hash=bytes.sha256;
    } else {
      if(typeof w.input!=='string' || !textValid(w.input)) return fail('input_invalid');
      content=w.input;hash=await sourceHash(new TextEncoder().encode(content));
      if(hash!==w.input_hash) return fail('source_changed');
    }
    completionSent=true;
    const result=record(await rpc(admin,'complete_knowledge_extraction',{_work_id:workId,_server_key:w.server_key,_attempt:w.attempt,_revision:w.revision,_content:content,_hash:hash}));
    if(result.verified_readback!==true || result.phase!=='awaiting_review' || result.document_id!==w.document_id || !['capability_succeeded','capability_completed_unrecorded'].includes(String(result.outcome))) throw new Error('completion_readback_missing');
    return {ok:true,status:'succeeded',...result};
  } catch(error) {
    const message=error instanceof Error?error.message:'';
    const deterministic=error instanceof ExtractionError || /KNOWLEDGE_(SCOPE_CHANGED|REVISION_CONFLICT|SOURCE_CHANGED|OUTPUT_INVALID)/.test(message);
    const code=error instanceof ExtractionError?error.code:message.includes('SCOPE_CHANGED')?'authority_changed':message.includes('REVISION_CONFLICT')?'revision_changed':message.includes('SOURCE_CHANGED')?'source_changed':deterministic?'input_invalid':completionSent?'completion_unknown':'source_unavailable';
    const unknown=completionSent && !deterministic;
    // An uncertain acknowledgement is reconciled, never a second extraction dispatch.
    try { await rpc(admin,'settle_knowledge_extraction_failure',{_work_id:workId,_server_key:w.server_key,_attempt:w.attempt,_code:code,_unknown:unknown}); } catch { return {ok:false,status:'outcome_unknown',work_id:workId}; }
    return {ok:false,status:unknown?'outcome_unknown':'failed',error_code:code,work_id:workId};
  }
}
