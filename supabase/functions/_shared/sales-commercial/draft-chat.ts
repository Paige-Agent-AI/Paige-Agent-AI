import {SALES_DRAFT_CREATE,SALES_DRAFT_REVISE} from './draft-capabilities.ts';
import {parseCommercialDraftCommand} from './draft-command.ts';
import {UUID,FINGERPRINT} from '../sales-invoice-command/contract.ts';
import type {Context,Dependencies,Result} from '../sales-invoice-chat.ts';

const declarations=[SALES_DRAFT_CREATE,SALES_DRAFT_REVISE];
export const SALES_DRAFT_TOOLS=declarations.map(declaration=>({type:'function' as const,function:{name:declaration.governance.actionRiskKey!,description:declaration===SALES_DRAFT_CREATE
 ?'Create a NEW unissued canonical invoice draft from explicit commercial intent. Resolve the canonical customer first. Ask instead of guessing currency, due date, taxes/fees or conflicting agreement terms. Explicit custom-priced USD items only; unresolved catalog prices require review. This does not publish, send, activate collections or collect payment. New draft numbers are assigned at publication; do not show internal IDs as invoice numbers.'
 :'Revise an existing unissued canonical invoice draft at its exact current version. Read the invoice first. Explicit custom-priced USD items only. Does not change an issued invoice, terms, send or collect.',
 parameters:{type:'object',properties:Object.fromEntries(Object.entries(declaration.input.properties).filter(([key])=>key!=='action')),required:declaration.input.required.filter(key=>key!=='action'),additionalProperties:false}}}));
export const SALES_DRAFT_TOOL_NAMES=new Set(SALES_DRAFT_TOOLS.map(t=>t.function.name));
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
type Common={operationId:(tenant:string,actor:string,command:unknown,turn:Context['turn'])=>Promise<string>;safeResult:(value:unknown)=>Record<string,unknown>};
/** Selection only: the JWT endpoint atomically claims the stored approval and executes stored
 * arguments through the same shared gate and invoice writer. No model approval flag. */
export async function dispatchCommercialDraftChat(ctx:Context,deps:Dependencies,common:Common):Promise<Result>{
 const action=ctx.toolName==='billing_create_invoice'?'invoice.draft_create':'invoice.draft_revise';
 const tokens:string[]=[];let intent:ReturnType<typeof parseCommercialDraftCommand>;let op:string|undefined;let attempted=false;let fingerprint:string|undefined;
 const refuse=(message:string):Result=>({tokens,content:{success:false,error:message,note:'Nothing was executed by this call. Ask for a fresh draft request; do not retry automatically.'}});
 try{
  if(!ctx.tenantId||!UUID.test(ctx.tenantId))return refuse('Invoice workspace unavailable.');
  intent=parseCommercialDraftCommand({...ctx.args,action});
  if(ctx.approved.size){
   const reply=await deps.admin.from('paige_pending_confirmations').select('fingerprint,args').eq('tenant_id',ctx.tenantId).eq('user_id',ctx.userId).eq('tool_name',ctx.toolName)
    .in('fingerprint',[...ctx.approved].map(token=>token.split(':')[0])).is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null)
    .not('server_issued_at','is',null).not('issued_in_request','is',null).gt('expires_at',new Date().toISOString()).limit(9);
   if(reply.error)return refuse('The draft approval could not be checked.');
   const rows=reply.data??[];for(const row of rows)for(const token of ctx.approved)if(token.split(':')[0]===row.fingerprint)tokens.push(token);
   const candidates=rows.filter(row=>object(row.args)&&object(row.args.command)&&row.args.command.action===action
    &&(action==='invoice.draft_create'||row.args.command.invoice_id===ctx.args.invoice_id));
   if(candidates.length!==1||ctx.sameToolCalls!==1)return refuse('The draft approval is ambiguous or unavailable.');
   const row=candidates[0],stored=row.args;
   if(typeof row.fingerprint!=='string'||!FINGERPRINT.test(row.fingerprint)||!ctx.approved.has(row.fingerprint)||!object(stored)
    ||stored.expected_tenant_id!==ctx.tenantId||typeof stored.operation_id!=='string'||!UUID.test(stored.operation_id)||!object(stored.command))return refuse('The draft approval is not usable in this scope.');
   const command=stored.command;
   intent=parseCommercialDraftCommand(action==='invoice.draft_create'?{action,draft:command.draft}:command);
   op=stored.operation_id;fingerprint=row.fingerprint;
  }else op=await common.operationId(ctx.tenantId,ctx.userId,intent,ctx.turn);
  attempted=true;
  const reply=await deps.caller.functions.invoke('sales-invoice-draft-command',{body:{expected_tenant_id:ctx.tenantId,operation_id:op,intent,...(fingerprint?{approved_fingerprint:fingerprint}:{})}});
  let data=reply.data;if(reply.error){const e=reply.error as {context?:{json?:()=>Promise<unknown>}};if(!e.context?.json)throw Error();data=await e.context.json();}
  if(!object(data))throw Error();
  if(data.outcome==='approval_required'&&typeof data.fingerprint==='string'&&FINGERPRINT.test(data.fingerprint))return {tokens,content:{success:false,needs_confirm:true,requires_operator_approval:true,confirm_fingerprint:data.fingerprint,confirm_summary:data.summary,note:'Show Needs your OK. Nothing changed. Wait for the owner approval.'}};
  const safe=common.safeResult(data);if(object(safe.invoice)&&safe.invoice.status==='draft')delete safe.invoice.invoice_number;
  const completed=data.ok===true&&data.outcome===(action==='invoice.draft_create'?'draft_created':'draft_revised');
  return {tokens,content:{...safe,success:completed,note:completed?data.replayed===true?'Saved historical operation result. Read the invoice for its current state.':'Canonical draft saved and read back. It has not been issued, sent or paid.':data.outcome==='needs_input'?'Ask for the missing or unresolved commercial facts. Nothing was created by this call.':'This call did not establish a completed draft. Report its outcome and recover the operation before retrying.'}};
 }catch{return {tokens,content:{success:false,outcome:attempted?'outcome_unknown':'needs_input',...(attempted&&op?{operation_id:op}:{}),note:attempted?'No completed draft was established by this response. Read/recover the existing operation; never claim issuance, delivery or payment.':'Ask for the missing exact draft facts or a fresh review. No draft command was dispatched.'}};}
}
