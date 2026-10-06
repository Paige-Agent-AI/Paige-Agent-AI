import { projectCollectionAgreement } from './sales-collections/agreement-context.ts';
import { SALES_COLLECTION_KIT_BY_ACTION, SALES_COLLECTION_READ_CAPABILITY } from './paige-spine/domains/sales_collections.ts';
import { parseCollectionCommand,COLLECTION_ACTIONS,UUID } from './sales-collections/contract.ts';
import { CRM_APPROVAL_CANDIDATE_LIMIT,resolveCrmApprovedFingerprint } from './crm-command/approval-resolution.ts';
const ACTIONS={sales_create_commercial_terms:'collection.create_commercial_terms',sales_save_collection_terms:'collection.save_terms',sales_stage_collection_import:'collection.stage_import',sales_commit_collection_import:'collection.commit_import'} as const;
function toolSchema(key:keyof typeof ACTIONS){const command=SALES_COLLECTION_KIT_BY_ACTION[key].input.properties.command as {properties:Readonly<Record<string,unknown>>;required:readonly string[]};const keys=key==='sales_create_commercial_terms'?['client_id','offer_id','term_kind','agreed_amount_minor','agreed_currency','billing_interval','interval_count','installments_total','payment_schedule','starts_on','ends_on','title','notes']:key==='sales_save_collection_terms'?['agreement_id','expected_version','terms']:key==='sales_stage_collection_import'?['source_account','rows']:['batch_id','expected_digest'];return {type:'object',properties:Object.fromEntries(Object.entries(command.properties).filter(([k])=>keys.includes(k))),required:command.required.filter(k=>k!=='action'),additionalProperties:false};}
export const SALES_COLLECTIONS_TOOLS=[
 {type:'function',function:{name:'sales_create_commercial_terms',description:'Create one new canonical draft commercial obligation through owner review. Resolve the exact client and offer first; ask for all missing dates, currency and conflicting signed terms. Fixed negotiated total in minor units only, one-time or finite monthly installments. This act does not create an invoice, signed agreement, schedule mandate or payment. Those remain separate governed actions.',parameters:toolSchema('sales_create_commercial_terms')}},
 {type:'function',function:{name:'read_sales_collections',description:'Read a bounded tenant collection register or canonical commercial collection terms, including client/offer identity and deterministic schedule preview. These are not signing agreements or payment mandates. Never infer absent/stale terms or use a per-cycle amount as a total; ask on ambiguous matches or truncated source labels. Signing documents must be resolved separately. Manual receipts never verify processor payment.',parameters:SALES_COLLECTION_READ_CAPABILITY.input}},
 {type:'function',function:{name:'sales_save_collection_terms',description:'With canonical approval, save reviewed agreement collection terms; no charge or automatic schedule execution.',parameters:toolSchema('sales_save_collection_terms')}},
 {type:'function',function:{name:'sales_stage_collection_import',description:'With approval, stage normalized human-provided canonical references for review. Do not invent IDs or historical facts. Staging does not commit or verify payment.',parameters:toolSchema('sales_stage_collection_import')}},
 {type:'function',function:{name:'sales_commit_collection_import',description:'With approval, commit the exact reviewed batch and digest. Imported receipts remain owner-reported.',parameters:toolSchema('sales_commit_collection_import')}},
] as const;
export const SALES_COLLECTIONS_TOOL_NAMES=new Set(SALES_COLLECTIONS_TOOLS.map(t=>t.function.name));
type Turn = { thread_id: string | null; user_turn_ordinal: number; user_turn: unknown };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Assistant/tool transcript growth cannot mint a second operation for the same user command. */
export async function salesCollectionsOperationId(tenant: string, actor: string, command: unknown, turn: Turn): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical({ namespace: 'sales_collections_chat_v1', tenant, actor, command, turn }))))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export type SalesCollectionsApprovalQuery = {
  eq(key: string, value: unknown): SalesCollectionsApprovalQuery; in(key: string, values: string[]): SalesCollectionsApprovalQuery;
  is(key: string, value: null): SalesCollectionsApprovalQuery; not(key: string, operator: string, value: null): SalesCollectionsApprovalQuery;
  gt(key: string, value: string): SalesCollectionsApprovalQuery; limit(value: number): PromiseLike<{ data: { fingerprint?: unknown; args?: unknown }[] | null; error: unknown }>;
};
type Reply = { data: unknown; error: unknown };
type Dependencies = {
  admin: { from(name: string): { select(value: string): SalesCollectionsApprovalQuery } };
  caller: { rpc(name: string, args: Record<string, unknown>): PromiseLike<Reply>; functions: { invoke(name: string, options: { body: Record<string, unknown> }): Promise<Reply> } };
};
/** C4b — `pinned`: the stored proposal the chat's approval resume carried forward (see
 *  sales-invoice-chat.ts). When set, exactly that proposal is redeemed; the door still claims it. */
type Context = { tenantId: string | null; userId: string; toolName: string; args: Record<string, unknown>; approved: Set<string>; sameToolCalls: number; turn: Turn;
  pinned?: { fingerprint: string; args: unknown } };
type Refusal = 'ambiguous' | 'unclaimable' | 'lookup_failed';
type Result = { content: Record<string, unknown>; refusal?: Refusal; tokens?: string[]; spent?: string };
function refusal(reason: Refusal): Result {
  const message = reason === 'ambiguous' ? 'More than one collection approval could apply.' : reason === 'lookup_failed' ? 'The collection approval could not be checked.' : 'The collection approval cannot be used in this scope.';
  return { refusal: reason, content: { success: false, error: message, note: 'Nothing was executed by this call. Ask for a fresh collection request; do not retry automatically.' } };
}
/** Closed summary projection: documents/free text and link credentials never enter model results. */
const object=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function salesCollectionsSafeResult(value:unknown):Record<string,unknown>{
 const v=object(value);if(!v)return{};const out:Record<string,unknown>={};
 for(const k of ['ok','replayed'])if(typeof v[k]==='boolean')out[k]=v[k];
 for(const k of ['version','collection_terms_version','remaining_cents','amount_cents','manual_recorded_cents','written','matched','conflict_count','receipt_count'])if(Number.isSafeInteger(v[k])&&Number(v[k])>=0)out[k==='collection_terms_version'?'version':k]=v[k];
 for(const k of ['state','status','outcome'])if(typeof v[k]==='string'&&['staged','committed','saved','issued','recorded','void','refused','outcome_unknown','draft','active','signed','expired','voided'].includes(v[k] as string))out[k==='state'?'status':k]=v[k];
 if(typeof v.currency==='string'&&/^[a-z]{3}$/.test(v.currency))out.currency=v.currency;
 if(typeof v.content_digest==='string'&&/^[a-f0-9]{64}$/.test(v.content_digest))out.digest=v.content_digest;
 if(v.row)Object.assign(out,salesCollectionsSafeResult(v.row));
 const batch=object(v.batch);if(batch){Object.assign(out,salesCollectionsSafeResult(batch));if(typeof batch.id==='string'&&UUID.test(batch.id))out.batch_id=batch.id;const review=object(batch.review);out.row_count=Array.isArray(batch.rows)?Math.min(batch.rows.length,200):Array.isArray(review?.rows)?Math.min(review.rows.length,200):0;out.conflict_count=Array.isArray(review?.conflicts)?review.conflicts.length:0;}
 return out;
}
async function readCollections(ctx:Context,deps:Dependencies):Promise<Result>{
 if(Object.keys(ctx.args).some(k=>!['entity','limit','cursor','before_id'].includes(k))||!['invoice','receipt','agreement'].includes(String(ctx.args.entity)))return {content:{success:false,error:'Invalid collection register request.'}};
 const limit=ctx.args.limit??(ctx.args.entity==='agreement'?5:25);if(!Number.isInteger(limit)||Number(limit)<1||Number(limit)>50)return {content:{success:false,error:'Collection reads are bounded to 50 records.'}};
 const entity=String(ctx.args.entity),cursor=object(ctx.args.cursor);
 if(ctx.args.cursor!=null&&(!cursor||Object.keys(cursor).some(k=>!['snapshot_id','after_position','entity'].includes(k))||typeof cursor.snapshot_id!=='string'||!UUID.test(cursor.snapshot_id)||!Number.isSafeInteger(cursor.after_position)||Number(cursor.after_position)<0||cursor.entity!==entity))return {content:{success:false,error:'Invalid collection cursor.'}};
 if(ctx.args.before_id!=null&&(entity!=='agreement'||typeof ctx.args.before_id!=='string'||!UUID.test(ctx.args.before_id)))return {content:{success:false,error:'Invalid agreement cursor.'}};
 if(entity==='agreement'&&ctx.args.cursor!=null)return {content:{success:false,error:'Agreement cursor unavailable.'}};
 try {
 const reply=await deps.caller.rpc('read_sales_collections',{_expected_tenant_id:ctx.tenantId,_entity:entity,_limit:limit,_cursor:cursor,_before_id:ctx.args.before_id??null});
 const data=object(reply.data);if(reply.error||!data||!Array.isArray(data.rows)||data.rows.length>Number(limit)||typeof data.has_more!=='boolean'||data.tenant_id!==ctx.tenantId||typeof data.receipt_id!=='string'||!UUID.test(data.receipt_id))throw Error('unverified');
 const rows=data.rows.map(value=>{if(entity==='agreement')return projectCollectionAgreement(value,ctx.tenantId!);const r=object(value);if(!r||typeof r.id!=='string'||!UUID.test(r.id))throw Error('unverified');const safe:Record<string,unknown>={id:r.id,...salesCollectionsSafeResult(r)};if(typeof r.record_kind==='string'&&['managed','imported','provider_or_legacy'].includes(r.record_kind))safe.record_kind=r.record_kind;if(typeof r.collection_terms_version==='number')safe.version=r.collection_terms_version;if(typeof r.agreed_currency==='string'&&/^[a-z]{3}$/.test(r.agreed_currency))safe.currency=r.agreed_currency;if(Number.isSafeInteger(r.agreed_amount_minor))safe.amount_cents=r.agreed_amount_minor;if(typeof r.terms_current==='boolean')safe.terms_current=r.terms_current;for(const k of ['invoice_id','reverses_payment_id'])if(typeof r[k]==='string'&&UUID.test(r[k] as string))safe[k]=r[k];for(const k of ['kind','provenance'])if(typeof r[k]==='string'&&['receipt','reversal','owner_imported_unverified','human_recorded','canonical_record','full','installment','recurring','deposit','milestone','custom'].includes(r[k] as string))safe[k]=r[k];return safe;});
 const next=data.next_cursor;if(next!==null&&next!==undefined){if(entity==='agreement'){if(typeof next!=='string'||!UUID.test(next))throw Error('cursor');}else{const n=object(next);if(!n||typeof n.snapshot_id!=='string'||!UUID.test(n.snapshot_id)||!Number.isSafeInteger(n.after_position)||n.entity!==entity||Object.keys(n).some(k=>!['snapshot_id','after_position','entity'].includes(k)))throw Error('cursor');}}
 return {content:{success:true,entity,receipt_id:data.receipt_id,rows,has_more:data.has_more,next_cursor:next??null,note:'These are bounded canonical business records. Commercial terms are separate from signed documents; absent/stale terms need owner resolution. Schedule preview is deterministic recorded intent, not a payment mandate, accrued fee or settlement. Imported/manual receipts do not verify processor payment.'}};
 }catch{return {content:{success:false,error:'Collection register unavailable in this workspace.'}};}
}
/** Selection only. The action endpoint is the sole atomic approval consumer and execution gate. */
export async function dispatchSalesCollectionsChat(ctx: Context, deps: Dependencies): Promise<Result> {
  if (!ctx.tenantId || !UUID.test(ctx.tenantId)) return { content: { success: false, error: 'Collection workspace unavailable.' } };
  if (!ctx.args || typeof ctx.args !== 'object' || Array.isArray(ctx.args) || Object.prototype.hasOwnProperty.call(ctx.args, 'action')) return { content: { success: false, error: 'Invalid collection request.' } };
  if(ctx.toolName==='read_sales_collections')return readCollections(ctx,deps);
  const action = ACTIONS[ctx.toolName as keyof typeof ACTIONS];
  if (!action) return { content: { success: false, error: 'Collection action unavailable.' } };
  let command: ReturnType<typeof parseCollectionCommand>;
  let body: Record<string, unknown>;
  const tokens: string[] = [];
  let approvedArgs: Record<string, unknown> | undefined;
  let fingerprint: string | undefined;
  if (ctx.pinned || ctx.approved.size) {
    try {
      let rows: { fingerprint?: unknown; args?: unknown }[];
      const approved = ctx.pinned ? new Set([ctx.pinned.fingerprint]) : ctx.approved;
      if (ctx.pinned) rows = [{ fingerprint: ctx.pinned.fingerprint, args: ctx.pinned.args }];
      else {
        const reply = await deps.admin.from('paige_pending_confirmations').select('fingerprint,args')
          .eq('tenant_id', ctx.tenantId).eq('user_id', ctx.userId).eq('tool_name', ctx.toolName)
          .in('fingerprint', [...ctx.approved].map(token => token.split(':')[0]))
          .is('thread_id', null).is('scoped_client_id', null).is('consumed_at', null)
          .not('server_issued_at', 'is', null).not('issued_in_request', 'is', null)
          .gt('expires_at', new Date().toISOString()).limit(CRM_APPROVAL_CANDIDATE_LIMIT + 1);
        if (reply.error) return refusal('lookup_failed');
        rows = reply.data ?? [];
      }
      for (const row of rows) for (const token of approved) if (token.split(':')[0] === row.fingerprint) tokens.push(token);
      const reference=ctx.args.agreement_id??ctx.args.batch_id; const subject=typeof reference==='string'?action+':'+reference.toLowerCase():'';
      const selected = ctx.pinned ? { kind: 'claim' as const, fingerprint: ctx.pinned.fingerprint } : resolveCrmApprovedFingerprint(rows, subject, ctx.sameToolCalls);
      if (selected.kind === 'ambiguous') return { ...refusal('ambiguous'), tokens };
      if (selected.kind === 'claim') {
        if (!approved.has(selected.fingerprint)) return { ...refusal('unclaimable'), tokens };
        const stored = rows.find(row => row.fingerprint === selected.fingerprint)?.args;
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...refusal('unclaimable'), tokens };
        approvedArgs = stored as Record<string, unknown>; fingerprint = selected.fingerprint;
      }
    } catch { return refusal('lookup_failed'); }
  }
  try {
    command=parseCollectionCommand(approvedArgs?approvedArgs.command:{...ctx.args,action});
    const policy=COLLECTION_ACTIONS[command.action];
    if (policy !== ctx.toolName) return { ...refusal('unclaimable'), tokens };
    if (approvedArgs) {
      if (approvedArgs.expected_tenant_id !== ctx.tenantId || typeof approvedArgs.operation_id !== 'string' || !UUID.test(approvedArgs.operation_id)) return { ...refusal('unclaimable'), tokens };
      body = { expected_tenant_id: ctx.tenantId, operation_id: approvedArgs.operation_id, command, approved_fingerprint: fingerprint };
    } else body = { expected_tenant_id: ctx.tenantId, operation_id: await salesCollectionsOperationId(ctx.tenantId, ctx.userId, command, ctx.turn), command };
  } catch { return approvedArgs ? { ...refusal('unclaimable'), tokens } : { content: { success: false, error: 'Invalid collection command. Read its current version and use the required fields.' }, tokens }; }
  // C4b — a pinned call reports the approval it handed to the door (see sales-invoice-chat.ts).
  const spent = ctx.pinned && fingerprint ? fingerprint : undefined;
  try {
    const reply = await deps.caller.functions.invoke('sales-collection-command', { body });
    let data = reply.data;
    if (reply.error) {
      const error = reply.error as { context?: { json?: () => Promise<unknown> } };
      if (!error.context?.json) throw new Error('unanswered');
      data = await error.context.json();
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('unanswered');
    const result = data as Record<string, unknown>;
    if (result.outcome === 'approval_required' && typeof result.fingerprint === 'string' && /^[0-9a-f]{16}$/.test(result.fingerprint)) return { tokens, spent, content: { success: false, needs_confirm: true, requires_operator_approval: true, confirm_fingerprint: result.fingerprint, confirm_summary: typeof result.summary === 'string' ? result.summary : 'Approve this collection action', note: 'Show the Needs your OK card. Nothing changed yet. Do not call this tool again until the person approves.' } };
    if(command.action==='collection.create_commercial_terms' && result.ok===true){
      const row=object(result.row),operation=object(result.operation);
      if(!row||typeof row.id!=='string'||!UUID.test(row.id)||row.tenant_id!==ctx.tenantId
        ||row.client_id!==command.client_id||row.offer_id!==command.offer_id||row.status!=='draft'
        ||row.amount_cents!==command.agreed_amount_minor||row.currency!==command.agreed_currency
        ||operation?.id!==body.operation_id||operation?.action!==command.action||result.outcome!=='commercial_terms_created')throw Error('unverified');
      return {tokens,spent,content:{success:true,outcome:'commercial_terms_created',commercial_terms_id:row.id,client_id:row.client_id,offer_id:row.offer_id,status:'draft',amount_cents:row.amount_cents,currency:row.currency,operation_id:operation.id,replayed:result.replayed===true,note:(result.replayed===true?'Historical saved result; read current commercial terms before reporting current status. ':'')+'Canonical fixed draft commercial obligation only. No invoice, signature, activated schedule or provider payment was created.'}};
    }
    const safe = salesCollectionsSafeResult(result);
    const completed=result.ok===true;
    return { tokens, spent, content: { ...safe, success: completed, ...(completed ? result.replayed === true ? { note: 'This is the saved result of an earlier operation. Read the collection again before reporting its current balance or status.' } : {} : { note: 'This call did not establish a completed action. Report the returned outcome; do not retry automatically.' }) } };
  } catch { return { tokens, spent, content: { success: false, outcome: 'outcome_unknown',  note: 'The collection request has no verified response. Check the collection before another action; do not claim success or retry automatically.' } }; }
}



