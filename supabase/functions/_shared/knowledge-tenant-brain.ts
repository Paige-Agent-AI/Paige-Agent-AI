/** Knowledge consumes the canonical caller-JWT RPCs. SQL alone records operation receipts. */
export type KnowledgeTool = "knowledge_read" | "knowledge_update" | "knowledge_delete";
export interface KnowledgeRpcPort { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {message?: string; code?: string} | null}> }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const validRevision = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
const invalid = () => { throw new Error('KNOWLEDGE_ARGUMENTS_INVALID'); };
export function normalizeKnowledgeArgs(tool: KnowledgeTool, raw: unknown): Record<string, unknown> {
  if (!object(raw)) return invalid();
  const allowed = tool === 'knowledge_read' ? ['document_id','limit','offset'] : tool === 'knowledge_update' ? ['document_id','expected_revision','patch','confirm'] : ['document_id','expected_revision','confirm'];
  if (Object.keys(raw).some(k => !allowed.includes(k))) return invalid();
  const out = {...raw};
  if (out.document_id !== undefined && (typeof out.document_id !== 'string' || !uuid.test(out.document_id))) return invalid();
  if (typeof out.document_id === 'string') out.document_id = out.document_id.toLowerCase();
  if (tool === 'knowledge_read') {
    if (out.limit !== undefined && (!Number.isSafeInteger(out.limit) || Number(out.limit) < 1 || Number(out.limit) > 20)) return invalid();
    if (out.offset !== undefined && (!Number.isSafeInteger(out.offset) || Number(out.offset) < 0)) return invalid();
    return out;
  }
  if (!out.document_id || !validRevision(out.expected_revision) || (out.confirm !== undefined && typeof out.confirm !== 'boolean')) return invalid();
  if (tool === 'knowledge_update') {
    if (!object(out.patch) || !Object.keys(out.patch).length || Object.keys(out.patch).some(k => !['title','summary','category','tags'].includes(k))) return invalid();
    const patch = {...out.patch};
    if ('title' in patch) { if (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.trim().length > 300) return invalid(); patch.title = patch.title.trim(); }
    for (const [key, limit] of [['summary',2000],['category',100]] as const) if (key in patch && patch[key] !== null && (typeof patch[key] !== 'string' || (patch[key] as string).length > limit)) return invalid();
    if ('tags' in patch && (!Array.isArray(patch.tags) || patch.tags.length > 20 || patch.tags.some(t => typeof t !== 'string' || t.length > 60))) return invalid();
    out.patch = patch;
  }
  return out;
}
// Only these exact SQL errors prove the single canonical transaction rolled back.
const refusalCodes: Readonly<Record<string,string>> = {
 KNOWLEDGE_UNAUTHENTICATED:'42501',KNOWLEDGE_SCOPE_CHANGED:'42501',KNOWLEDGE_FORBIDDEN:'42501',
 KNOWLEDGE_PAGE_INVALID:'22023',KNOWLEDGE_PATCH_INVALID:'22023',KNOWLEDGE_NOT_FOUND:'P0002',
 KNOWLEDGE_REVISION_CONFLICT:'40001',KNOWLEDGE_CHILD_SCOPE_INVALID:'42501',KNOWLEDGE_DELETE_NOT_VERIFIED:'P0001',
};
const failure = (code: string, uncertain = false) => ({success:false, verified:false, railRecorded:false, code, mutationMayHavePersisted:uncertain, note:uncertain ? 'The operation may have committed. Read the current Knowledge record before proposing another change; do not automatically retry.' : 'No change was verified. Resolve the refusal before proposing another operation.'});
function safeDoc(raw: unknown, tenant: string): Record<string, unknown> {
  if (!object(raw) || raw.tenant_id !== tenant || typeof raw.id !== 'string' || !uuid.test(raw.id) || !validRevision(raw.revision) || typeof raw.title !== 'string' || !Number.isSafeInteger(raw.chunk_count) || Number(raw.chunk_count) < 0) throw new Error('KNOWLEDGE_RESPONSE_INVALID');
  if (!['summary','category','source_url'].every(k => raw[k] === null || typeof raw[k] === 'string') || typeof raw.source !== 'string' || !(raw.tags === null || (Array.isArray(raw.tags) && raw.tags.every(t => typeof t === 'string'))) || (raw.content !== undefined && typeof raw.content !== 'string')) throw new Error('KNOWLEDGE_RESPONSE_INVALID');
  const cut = (v: unknown, n: number) => typeof v === 'string' ? v.slice(0,n) : null;
  return {id:raw.id,revision:raw.revision,title:cut(raw.title,300),summary:cut(raw.summary,2000),category:cut(raw.category,100),tags:Array.isArray(raw.tags) ? raw.tags.slice(0,20).map(t => String(t).slice(0,60)) : [],source:cut(raw.source,100),source_url:cut(raw.source_url,1000),recorded_chunk_count:raw.chunk_count};
}
export async function executeKnowledgeTool(input: {caller: KnowledgeRpcPort; expectedTenantId: string | null; tool: KnowledgeTool; args: unknown}): Promise<Record<string, unknown>> {
  let args: Record<string, unknown>;
  try { args=normalizeKnowledgeArgs(input.tool,input.args); } catch { return {...failure('KNOWLEDGE_ARGUMENTS_INVALID'),refused_before_run:true}; }
  if (!input.expectedTenantId || !uuid.test(input.expectedTenantId)) return {...failure('KNOWLEDGE_SCOPE_REQUIRED'),refused_before_run:true};
  const tenant=input.expectedTenantId;
  const mutation=input.tool !== 'knowledge_read';
  const rpc=input.tool === 'knowledge_read' ? 'read_tenant_knowledge' : input.tool === 'knowledge_update' ? 'update_tenant_knowledge_metadata' : 'delete_tenant_knowledge';
  const params: Record<string, unknown>={p_expected_tenant:tenant,p_doc_id:args.document_id ?? null};
  if (!mutation) Object.assign(params,{p_limit:args.document_id ? 1 : args.limit ?? 20,p_offset:args.document_id ? 0 : args.offset ?? 0});
  else Object.assign(params,{p_expected_revision:args.expected_revision,...(input.tool === 'knowledge_update' ? {p_patch:args.patch} : {})});
  try {
    const {data,error}=await input.caller.rpc(rpc,params);
    if (error) { const code=error.message && Object.hasOwn(refusalCodes,error.message) && typeof error.code === 'string' && refusalCodes[error.message] === error.code ? error.message : undefined; return {...failure(code ?? 'KNOWLEDGE_OUTCOME_UNVERIFIED',mutation && !code),...(code ? {not_applied:true} : {})}; }
    if (!object(data) || data.tenant_id !== tenant) return failure('KNOWLEDGE_RESPONSE_INVALID',mutation);
    if (!mutation) {
      if (!Array.isArray(data.documents) || data.documents.length > Number(params.p_limit)) return failure('KNOWLEDGE_RESPONSE_INVALID');
      const documents: Record<string,unknown>[]=[];
      let truncated=false;
      for (const raw of data.documents) {
        const doc=safeDoc(raw,tenant);
        if (args.document_id && doc.id !== args.document_id) return failure('KNOWLEDGE_RESPONSE_INVALID');
        if (args.document_id && object(raw) && typeof raw.content === 'string') { const contentLimit=Math.min(12000, Math.max(0,14500-JSON.stringify(doc).length)); doc.content=raw.content.slice(0,contentLimit); doc.content_truncated=raw.content.length > contentLimit; }
        if (JSON.stringify([...documents,doc]).length > 15000) { truncated=true; break; }
        documents.push(doc);
      }
      return {success:true,verified:true,canonical_source:'tenant_knowledge_docs',documents,truncated,next_offset:args.document_id ? null : Number(args.offset ?? 0)+documents.length,has_more:truncated || data.documents.length === params.p_limit,note:'Canonical Knowledge records. Recorded chunk count does not prove index completeness or owner-confirmed Memory.'};
    }
    if (!['capability_succeeded','capability_completed_unrecorded'].includes(String(data.outcome)) || typeof data.run_id !== 'string' || !uuid.test(data.run_id)) return failure('KNOWLEDGE_RESPONSE_INVALID',true);
    let verified: Record<string,unknown>;
    if (input.tool === 'knowledge_update') {
      const stored=data.document;
      const doc=safeDoc(stored,tenant);
      if (doc.id !== args.document_id || doc.revision !== Number(args.expected_revision)+1 || !object(stored) || !object(args.patch) || Object.entries(args.patch).some(([k,v])=>JSON.stringify(stored[k]) !== JSON.stringify(v))) return failure('KNOWLEDGE_READBACK_MISMATCH',true);
      verified={document_id:doc.id,revision:doc.revision};
    } else {
      if (data.document_id !== args.document_id || data.deleted_revision !== args.expected_revision || data.document_absent !== true || data.chunks_absent !== true || !object(data.source_cleanup) || data.source_cleanup.status !== 'not_attempted' || data.source_cleanup.reason !== 'canonical_source_binding_unavailable') return failure('KNOWLEDGE_READBACK_MISMATCH',true);
      verified={document_id:data.document_id,deleted_revision:data.deleted_revision,document_absent:true,chunks_absent:true,source_cleanup:{status:'not_attempted',reason:'canonical_source_binding_unavailable'}};
    }
    const recorded=data.outcome === 'capability_succeeded';
    return {success:recorded,verified:true,railRecorded:recorded,mutationMayHavePersisted:true,outcome:data.outcome,run_id:data.run_id,...verified,note:recorded ? 'Canonical operation verified; SQL recorded its receipt. No source-object cleanup or Memory change occurred.' : 'Canonical change verified, but its Rail receipt was not recorded. Do not repeat the operation; evidence repair is required.'};
  } catch { return failure('KNOWLEDGE_OUTCOME_UNVERIFIED',mutation); }
}
