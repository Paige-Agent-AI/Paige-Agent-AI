import {SALES_INVOICE_READ_CAPABILITY,SALES_INVOICE_PUBLISH_CAPABILITY,SALES_INVOICE_RECORD_PAYMENT_CAPABILITY,SALES_INVOICE_REVERSE_PAYMENT_CAPABILITY,SALES_INVOICE_VOID_CAPABILITY,SALES_INVOICE_EMAIL_CAPABILITY,SALES_INVOICE_SETTINGS_CAPABILITY,SALES_INVOICE_PREFERENCES_READ_CAPABILITY} from './paige-spine/domains/sales_invoice.ts';
import { parseSalesInvoiceCommand, SALES_INVOICE_ACTIONS, UUID } from './sales-invoice-command/contract.ts';
import { parseCollectionCommand, COLLECTION_ACTIONS } from './sales-collections/contract.ts';
import { CRM_APPROVAL_CANDIDATE_LIMIT, resolveCrmApprovedFingerprint } from './crm-command/approval-resolution.ts';

const ACTIONS = {
  sales_update_invoice_settings:'invoice.settings_update', sales_publish_invoice: 'invoice.publish', sales_record_manual_payment: 'invoice.record_manual_payment',
  sales_reverse_manual_payment: 'invoice.reverse_manual_payment', sales_void_invoice: 'invoice.void',
  billing_send_invoice: 'invoice.email_send',
} as const;
// Tool schemas are projections of the same cold-start-validated domain declarations. The action
// discriminator stays server-authored by ACTIONS; actor, tenant, approval and link material cannot
// be model arguments. This projection adds no executor and does not change confirmation policy.
function chatInput(capability: {input: {properties: Readonly<Record<string, unknown>>;required:readonly string[]}}) {
  const properties=Object.fromEntries(Object.entries(capability.input.properties).filter(([key])=>key!=='action').map(([key,value])=>{
    // Preserve existing Chat's nullable-string JSON shape; Kit accepts the equivalent anyOf form.
    if(key==='reference'||key==='notes')return [key,{type:['string','null'],maxLength:key==='reference'?200:2000}];
    if(key==='received_at')return [key,{type:'string',description:'Actual received UTC date-time ending in Z'}];
    return [key,value];
  }));
  return {type:'object',properties,required:capability.input.required.filter(key=>key!=='action'),additionalProperties:false};
}
function invoiceSendInput(){const input=chatInput(SALES_INVOICE_EMAIL_CAPABILITY);return {...input,properties:{...input.properties,channel:{type:'string',enum:['email','sms'],description:'Defaults to email. SMS requires business A2P and this recipient consent; the server resolves its connection.'}}};}
function receiptInput(capability:Parameters<typeof chatInput>[0]):ReturnType<typeof chatInput>{const input=chatInput(capability);return {...input,properties:{...input.properties,record_kind:{type:'string',enum:['managed','imported'],description:'Use imported only for a recorded historical obligation read from Collections.'},...('currency' in input.properties?{currency:{type:'string',pattern:'^[a-z]{3}$',description:'Exact currency from the canonical obligation; managed invoices support USD.'}}:{})}};}
// No invoice link tool: its human-only endpoint returns a bearer token.
export const SALES_INVOICE_TOOLS = [
 {type:'function',function:{name:'read_sales_invoice_preferences',description:'Read current tenant invoice preferences and version. This does not change issued invoices.',parameters:SALES_INVOICE_PREFERENCES_READ_CAPABILITY.input}},
 {type:'function',function:{name:'sales_update_invoice_settings',description:'With canonical approval, update future invoice numbering and document preferences at the current settings version. Issued invoices remain unchanged.',parameters:chatInput(SALES_INVOICE_SETTINGS_CAPABILITY)}},
 {type:'function',function:{name:'read_sales_invoice',description:'Read this workspace invoice and manual receipt history. Manual settlement is a record, not a processor charge.',parameters:SALES_INVOICE_READ_CAPABILITY.input}},
 {type:'function',function:{name:'sales_publish_invoice',description:'Issue an existing saved invoice with approval. This creates an obligation snapshot; it does not charge, send, or create a payment link. Read the invoice first for its current version.',parameters:chatInput(SALES_INVOICE_PUBLISH_CAPABILITY)}},
 {type:'function',function:{name:'sales_record_manual_payment',description:'With approval, record money the owner says was received off platform against a managed or imported obligation. Read its currency, kind, balance and version first. Never claim a processor verified or charged it.',parameters:receiptInput(SALES_INVOICE_RECORD_PAYMENT_CAPABILITY)}},
 {type:'function',function:{name:'sales_reverse_manual_payment',description:'With approval, append a reversal of an existing manual receipt on a managed or imported obligation. This does not refund or transfer money.',parameters:receiptInput(SALES_INVOICE_REVERSE_PAYMENT_CAPABILITY)}},
 {type:'function',function:{name:'sales_void_invoice',description:'With approval, void the existing invoice. This does not refund or transfer money.',parameters:chatInput(SALES_INVOICE_VOID_CAPABILITY)}},
 {type:'function',function:{name:'billing_send_invoice',description:'With approval, attempt issued invoice delivery by email or SMS. Email requires an eligible connector from server truth; SMS resolves tenant connection and checks A2P and recipient consent. Never invent sender eligibility. iMessage is unavailable. Provider acceptance is not delivery or payment. Unknown outcomes require reconciliation, never a fresh-operation retry.',parameters:invoiceSendInput()}},
] as const;
export const SALES_INVOICE_TOOL_NAMES = new Set(SALES_INVOICE_TOOLS.map(t => t.function.name));

type Turn = { thread_id: string | null; user_turn_ordinal: number; user_turn: unknown };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Assistant/tool transcript growth cannot mint a second operation for the same user command. */
export async function salesInvoiceOperationId(tenant: string, actor: string, command: unknown, turn: Turn): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical({ namespace: 'sales_invoice_chat_v1', tenant, actor, command, turn }))))).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export type SalesInvoiceApprovalQuery = {
  eq(key: string, value: unknown): SalesInvoiceApprovalQuery; in(key: string, values: string[]): SalesInvoiceApprovalQuery;
  is(key: string, value: null): SalesInvoiceApprovalQuery; not(key: string, operator: string, value: null): SalesInvoiceApprovalQuery;
  gt(key: string, value: string): SalesInvoiceApprovalQuery; limit(value: number): PromiseLike<{ data: { fingerprint?: unknown; args?: unknown }[] | null; error: unknown }>;
};
type Reply = { data: unknown; error: unknown };
type Dependencies = {
  admin: { from(name: string): { select(value: string): SalesInvoiceApprovalQuery } };
  caller: { rpc(name: string, args: Record<string, unknown>): PromiseLike<Reply>; functions: { invoke(name: string, options: { body: Record<string, unknown> }): Promise<Reply> } };
};
type Context = { tenantId: string | null; userId: string; toolName: string; args: Record<string, unknown>; approved: Set<string>; sameToolCalls: number; turn: Turn };
type Refusal = 'ambiguous' | 'unclaimable' | 'lookup_failed';
type Result = { content: Record<string, unknown>; refusal?: Refusal; tokens?: string[] };
function refusal(reason: Refusal): Result {
  const message = reason === 'ambiguous' ? 'More than one invoice approval could apply.' : reason === 'lookup_failed' ? 'The invoice approval could not be checked.' : 'The invoice approval cannot be used in this scope.';
  return { refusal: reason, content: { success: false, error: message, note: 'Nothing was executed by this call. Ask for a fresh invoice request; do not retry automatically.' } };
}
/** Closed summary projection: documents/free text and link credentials never enter model results. */
export function salesInvoiceSafeResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const keys = ['ok','outcome','code','replayed','provider_receipt_available','delivery_confirmed','operation_id','capability','id','invoice_id','invoice_number','status','amount_total_cents','currency','version','issued_snapshot_version','issued_at','manual_recorded_cents','remaining_cents','settlement','payment_id','reversal_id','receipt_id'];
  const out: Record<string, unknown> = {};
  for (const key of keys) if (source[key] === null || ['string','number','boolean'].includes(typeof source[key])) out[key] = source[key];
  if (source.invoice) out.invoice = salesInvoiceSafeResult(source.invoice);
  if (source.row) out.invoice = salesInvoiceSafeResult(source.row);
  if (source.operation && typeof source.operation === 'object' && !Array.isArray(source.operation)) {
    const operation = source.operation as Record<string, unknown>;
    if (typeof operation.id === 'string' && UUID.test(operation.id)) out.operation_id = operation.id;
    const outcomes: Record<string, string> = { 'invoice.publish': 'published', 'invoice.record_manual_payment': 'manual_payment_recorded', 'invoice.reverse_manual_payment': 'manual_payment_reversed', 'collection.record_receipt':'manual_payment_recorded','collection.reverse_receipt':'manual_payment_reversed', 'invoice.void': 'voided' };
    if (source.ok === true && typeof operation.action === 'string' && outcomes[operation.action]) out.outcome = outcomes[operation.action];
  }
  if (Array.isArray(source.payments)) {
    out.payment_record_count = typeof source.payments_count === 'number' && Number.isSafeInteger(source.payments_count) && source.payments_count >= source.payments.length ? source.payments_count : source.payments.length;
    out.payment_records_truncated = source.payments_has_more === true || source.payments.length > 50;
    out.payments = source.payments.slice(-50).map(p => {
    if (!p || typeof p !== 'object') return {};
    const record = p as Record<string, unknown>;
    return Object.fromEntries(['id','kind','amount_cents','currency','method','received_at','reverses_payment_id','created_at'].filter(k => record[k] === null || ['string','number','boolean'].includes(typeof record[k])).map(k => [k, record[k]]));
    });
  }
  return out;
}

/** Selection only. The action endpoint is the sole atomic approval consumer and execution gate. */
export async function dispatchSalesInvoiceChat(ctx: Context, deps: Dependencies): Promise<Result> {
  if (!ctx.tenantId || !UUID.test(ctx.tenantId)) return { content: { success: false, error: 'Invoice workspace unavailable.' } };
  if (!ctx.args || typeof ctx.args !== 'object' || Array.isArray(ctx.args) || Object.prototype.hasOwnProperty.call(ctx.args, 'action')) return { content: { success: false, error: 'Invalid invoice request.' } };
  if(ctx.toolName==='read_sales_invoice_preferences'){
    if(Object.keys(ctx.args).length)return {content:{success:false,error:'Invalid invoice preferences request.'}};
    try{const reply=await deps.caller.rpc('read_sales_invoice_preferences',{_expected_tenant_id:ctx.tenantId});const p=reply.data as Record<string,unknown>|null;
      if(reply.error||!p||p.tenant_id!==ctx.tenantId||!Number.isSafeInteger(p.version)||typeof p.can_manage!=='boolean'||!p.settings||typeof p.settings!=='object'||Array.isArray(p.settings))throw Error();
      const settings=p.settings as Record<string,unknown>;const safe=Object.fromEntries(['prefix','next_number','padding','template','accent','footer','payment_instructions'].filter(k=>typeof settings[k]==='string'||typeof settings[k]==='number').map(k=>[k,settings[k]]));
      return {content:{success:true,version:p.version,can_manage:p.can_manage,settings:{...safe,logo_available:typeof settings.logo_data_uri==='string'},note:'Preferences affect future issuance. Existing issued documents remain frozen.'}};
    }catch{return {content:{success:false,error:'Invoice preferences unavailable in this workspace.'}};}
  }
  if (ctx.toolName === 'read_sales_invoice') {
    if (Object.keys(ctx.args).some(k => k !== 'invoice_id') || typeof ctx.args.invoice_id !== 'string' || !UUID.test(ctx.args.invoice_id)) return { content: { success: false, error: 'Invalid invoice request.' } };
    try {
      const reply = await deps.caller.rpc('read_sales_invoice', { _expected_tenant_id: ctx.tenantId, _invoice_id: ctx.args.invoice_id.toLowerCase() });
      return { content: reply.error ? { success: false, error: 'Invoice unavailable in this workspace.' } : { success: true, invoice: salesInvoiceSafeResult(reply.data) } };
    } catch { return { content: { success: false, error: 'Invoice read unavailable.' } }; }
  }
  if(ctx.toolName==='billing_send_invoice'&&ctx.args.channel!==undefined&&(typeof ctx.args.channel!=='string'||!['email','sms'].includes(ctx.args.channel)))return {content:{success:false,error:'Invoice delivery channel unavailable.'}};
  if(ctx.args.record_kind!==undefined&&(!['sales_record_manual_payment','sales_reverse_manual_payment'].includes(ctx.toolName)||typeof ctx.args.record_kind!=='string'||!['managed','imported'].includes(ctx.args.record_kind)))return {content:{success:false,error:'Invoice record kind unavailable.'}};
  const action = ctx.args.record_kind==='imported' ? ctx.toolName==='sales_record_manual_payment'?'collection.record_receipt':'collection.reverse_receipt' : ctx.toolName==='billing_send_invoice'&&ctx.args.channel==='sms' ? 'invoice.sms_send' : ACTIONS[ctx.toolName as keyof typeof ACTIONS];
  if (!action) return { content: { success: false, error: 'Invoice action unavailable.' } };
  let command: ReturnType<typeof parseSalesInvoiceCommand>|ReturnType<typeof parseCollectionCommand>;
  let body: Record<string, unknown>;
  const tokens: string[] = [];
  let approvedArgs: Record<string, unknown> | undefined;
  let fingerprint: string | undefined;
  if (ctx.approved.size) {
    try {
      const reply = await deps.admin.from('paige_pending_confirmations').select('fingerprint,args')
        .eq('tenant_id', ctx.tenantId).eq('user_id', ctx.userId).eq('tool_name', ctx.toolName)
        .in('fingerprint', [...ctx.approved].map(token => token.split(':')[0]))
        .is('thread_id', null).is('scoped_client_id', null).is('consumed_at', null)
        .not('server_issued_at', 'is', null).not('issued_in_request', 'is', null)
        .gt('expires_at', new Date().toISOString()).limit(CRM_APPROVAL_CANDIDATE_LIMIT + 1);
      if (reply.error) return refusal('lookup_failed');
      const rows = reply.data ?? [];
      for (const row of rows) for (const token of ctx.approved) if (token.split(':')[0] === row.fingerprint) tokens.push(token);
      const subject = action==='invoice.settings_update'?`${action}:${ctx.tenantId}`:typeof ctx.args.invoice_id === 'string' ? `${action}:${ctx.args.invoice_id.toLowerCase()}` : '';
      const selected = resolveCrmApprovedFingerprint(rows, subject, ctx.sameToolCalls);
      if (selected.kind === 'ambiguous') return { ...refusal('ambiguous'), tokens };
      if (selected.kind === 'claim') {
        if (!ctx.approved.has(selected.fingerprint)) return { ...refusal('unclaimable'), tokens };
        const stored = rows.find(row => row.fingerprint === selected.fingerprint)?.args;
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...refusal('unclaimable'), tokens };
        approvedArgs = stored as Record<string, unknown>; fingerprint = selected.fingerprint;
      }
    } catch { return refusal('lookup_failed'); }
  }
  try {
    const sendArgs={...ctx.args};delete sendArgs.channel;delete sendArgs.record_kind;
    const rawCommand=approvedArgs ? approvedArgs.command : {...sendArgs,action};
    const storedAction=rawCommand&&typeof rawCommand==='object'&&!Array.isArray(rawCommand)?(rawCommand as Record<string,unknown>).action:null;
    command=typeof storedAction==='string'&&storedAction.startsWith('collection.')?parseCollectionCommand(rawCommand):parseSalesInvoiceCommand(rawCommand);
    const policy=command.action.startsWith('collection.')?COLLECTION_ACTIONS[command.action as keyof typeof COLLECTION_ACTIONS]:SALES_INVOICE_ACTIONS[command.action as keyof typeof SALES_INVOICE_ACTIONS];
    if (policy !== ctx.toolName) return { ...refusal('unclaimable'), tokens };
    if (approvedArgs) {
      if (approvedArgs.expected_tenant_id !== ctx.tenantId || typeof approvedArgs.operation_id !== 'string' || !UUID.test(approvedArgs.operation_id)) return { ...refusal('unclaimable'), tokens };
      body = { expected_tenant_id: ctx.tenantId, operation_id: approvedArgs.operation_id, command, approved_fingerprint: fingerprint };
    } else body = { expected_tenant_id: ctx.tenantId, operation_id: await salesInvoiceOperationId(ctx.tenantId, ctx.userId, command, ctx.turn), command };
  } catch { return approvedArgs ? { ...refusal('unclaimable'), tokens } : { content: { success: false, error: 'Invalid invoice command. Read its current version and use the required fields.' }, tokens }; }
  try {
    const reply = await deps.caller.functions.invoke(command.action.startsWith('collection.')?'sales-collection-command':'sales-invoice-command', { body });
    let data = reply.data;
    if (reply.error) {
      const error = reply.error as { context?: { json?: () => Promise<unknown> } };
      if (!error.context?.json) throw new Error('unanswered');
      data = await error.context.json();
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('unanswered');
    const result = data as Record<string, unknown>;
    if (result.outcome === 'approval_required' && typeof result.fingerprint === 'string' && /^[0-9a-f]{16}$/.test(result.fingerprint)) return { tokens, content: { success: false, needs_confirm: true, requires_operator_approval: true, confirm_fingerprint: result.fingerprint, confirm_summary: typeof result.summary === 'string' ? result.summary : 'Approve this invoice action', note: 'Show the Needs your OK card. Nothing changed yet. Do not call this tool again until the person approves.' } };
    const safe = salesInvoiceSafeResult(result);
    if(command.action==='invoice.settings_update'){for(const k of Object.keys(safe))delete safe[k];const p=result.preferences as Record<string,unknown>|null;if(p&&p.tenant_id===ctx.tenantId&&Number.isSafeInteger(p.version)){safe.version=p.version;safe.outcome='settings_saved';}else if(result.ok===true)return {tokens,content:{success:false,outcome:'outcome_unknown',note:'Preferences readback was not verified. Recover the existing operation.'}};}
    if (action === 'invoice.email_send' || action === 'invoice.sms_send') {
      for (const key of Object.keys(safe)) if (!['ok', 'outcome', 'provider_receipt_available', 'delivery_confirmed', 'replayed'].includes(key)) delete safe[key];
    }
    const completed = result.ok === true && (!['invoice.email_send','invoice.sms_send'].includes(action) || result.outcome === 'provider_accepted');
    return { tokens, content: { ...safe, success: completed, ...(completed ? result.replayed === true ? { note: 'This is the saved result of an earlier operation. Read the invoice again before reporting its current balance or status.' } : {} : { note: 'This call did not establish a completed action. Report the returned outcome; do not retry automatically.' }) } };
  } catch { return { tokens, content: { success: false, outcome: 'outcome_unknown', ...(['invoice.email_send','invoice.sms_send'].includes(action) ? {} : { operation_id: body.operation_id }), note: 'The invoice request has no verified response. Check the invoice before another action; do not claim success or retry automatically.' } }; }
}
