import {aggregateInvoiceItems} from '../../../src/solo/sales/invoiceDraftSnapshot.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import {confirmFingerprint} from '../_shared/confirm-fingerprint.ts';
import {databaseAnswered} from '../_shared/approval-outcome.ts';
import {UUID,FINGERPRINT} from '../_shared/sales-invoice-command/contract.ts';
import {parseCommercialDraftCommand} from '../_shared/sales-commercial/draft-command.ts';
import {validateCatalogPriceFacts,type CatalogPriceFact} from '../_shared/sales-commercial/catalog-facts.ts';
import {commercialDraftWorkOrder} from '../_shared/sales-commercial/draft-work-order.ts';
import {admitCommercialDraft} from '../_shared/sales-commercial/draft-admission.ts';
import {SALES_DRAFT_SPINE} from '../_shared/sales-commercial/draft-capabilities.ts';
import {projectCapabilities,type Lane} from '../_shared/paige-capability-status/projection.ts';

const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Content-Type':'application/json','Cache-Control':'no-store'};
const response=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
const object=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
// Thin authenticated domain door. The canonical store claims approvals, the shared gate decides,
// the canonical invoice writer mutates, and its transaction owns readback + operation + Rail.
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return response(405,{ok:false,code:'METHOD_NOT_ALLOWED'});
 const url=Deno.env.get('SUPABASE_URL')!;
 const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('Authorization')??''}}});
 const {data:{user},error:authError}=await caller.auth.getUser();
 if(authError||!user)return response(401,{ok:false,code:'UNAUTHENTICATED'});
 let body:Record<string,unknown>,intent:ReturnType<typeof parseCommercialDraftCommand>;
 try{
  const raw=await req.text();if(new TextEncoder().encode(raw).length>65000)throw Error();
  const value=JSON.parse(raw);if(!object(value)||Object.keys(value).some(k=>!['expected_tenant_id','operation_id','intent','approved_fingerprint'].includes(k)))throw Error();body=value;
  if(typeof body.expected_tenant_id!=='string'||!UUID.test(body.expected_tenant_id)||typeof body.operation_id!=='string'||!UUID.test(body.operation_id))throw Error();
  if(body.approved_fingerprint!==undefined&&(typeof body.approved_fingerprint!=='string'||!FINGERPRINT.test(body.approved_fingerprint)))throw Error();
  intent=parseCommercialDraftCommand(body.intent);
 }catch{return response(400,{ok:false,code:'COMMERCIAL_DRAFT_INVALID'});}
 const {data:tenant,error:tenantError}=await caller.rpc('current_user_tenant_id');
 if(tenantError||typeof tenant!=='string'||tenant!==body.expected_tenant_id)return response(409,{ok:false,code:'WORKSPACE_CHANGED'});
 const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
 const {data:member,error:memberError}=await admin.from('tenant_members').select('role,status').eq('tenant_id',tenant).eq('user_id',user.id).eq('status','active').maybeSingle();
 if(memberError||!member||!['owner','admin'].includes(member.role??''))return response(403,{ok:false,code:'SALES_DRAFT_FORBIDDEN'});
 const stillCurrent=async()=>{const {data,error}=await caller.rpc('current_user_tenant_id');return !error&&data===tenant;};
 const operationId=body.operation_id as string;
 let command=await commercialDraftWorkOrder(intent,{tenantId:tenant,actorId:user.id,operationId});
 const capability=intent.action==='invoice.draft_create'?'billing_create_invoice':'sales_revise_invoice_draft';
 const rpcArgs={_actor_user_id:user.id,_expected_tenant_id:tenant,_operation_id:operationId,_command:command};
 if(!await stillCurrent())return response(409,{ok:false,code:'WORKSPACE_CHANGED'});
 const lines=intent.draft.items as {price_id:string|null;unit_minor:number|null;quantity:number}[];
 const hasCatalog=lines.some(line=>line.price_id!==null);
 const {data:prior,error:priorError}=await admin.rpc(hasCatalog?'read_sales_invoice_draft_intent_result':'read_sales_invoice_command_result',rpcArgs);
 if(priorError)return response(409,{ok:false,code:'DRAFT_REPLAY_UNAVAILABLE'});
 if(object(prior))return response(200,{...prior,replayed:true,capability});
 let catalogPrices:CatalogPriceFact[]|undefined;
 if(hasCatalog){
  if(!await stillCurrent())return response(409,{ok:false,code:'WORKSPACE_CHANGED'});
  const {data:catalog,error}=await admin.rpc('read_sales_invoice_draft_catalog',{_actor_user_id:user.id,_expected_tenant_id:tenant,_draft:intent.draft,_lock:false});
  try{if(error||!object(catalog)||catalog.tenant_id!==tenant)throw Error();catalogPrices=validateCatalogPriceFacts(intent.draft,catalog.prices);command=await commercialDraftWorkOrder(intent,{tenantId:tenant,actorId:user.id,operationId},catalogPrices);if(new TextEncoder().encode(JSON.stringify(command)).length>65000)throw Error();}
  catch{return response(422,{ok:false,outcome:'needs_input',code:'CATALOG_PRICE_REVIEW_REQUIRED',message:'Select an available supported catalog price and clarify exact commercial terms. Nothing was created.'});}
 }
 let amounts:ReturnType<typeof aggregateInvoiceItems>;
 try{amounts=aggregateInvoiceItems(lines.map(line=>({unit_minor:line.price_id===null?Number(line.unit_minor):catalogPrices!.find(p=>p.price_id===line.price_id!.toLowerCase())!.unit_minor,quantity:line.quantity})),intent.draft.kind==='deposit'&&intent.draft.schema_version===2?Number(intent.draft.deposit_basis_points):undefined,intent.draft.schema_version===3?Number(intent.draft.deposit_minor):undefined);}catch{return response(422,{ok:false,code:'DRAFT_AMOUNTS_INVALID'});}
 const {data:client,error:clientError}=await admin.from('clients').select('first_name,last_name,entity_name,entity_type').eq('tenant_id',tenant).eq('id',intent.draft.client_id).maybeSingle();
 if(clientError||!client)return response(422,{ok:false,outcome:'needs_input',code:'CLIENT_UNAVAILABLE'});
 const person=[client.first_name,client.last_name].filter(v=>typeof v==='string'&&v.trim()).join(' ');
 const clientName=typeof client.entity_name==='string'&&(client.entity_type||!person)?client.entity_name:person||client.entity_name||'the selected customer';
 const money=(minor:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(minor/100);
 const {data:resolved,error:laneError}=await caller.rpc('resolve_tool_autonomy',{_tenant_id:tenant,_tool_key:capability});
 const lane=!laneError&&['auto','confirm','off'].includes(resolved)?resolved:'unresolved';
 const requestNonce=crypto.randomUUID();let claimedArgs:Record<string,unknown>|null|undefined;
 if(body.approved_fingerprint!==undefined){
  claimedArgs=null;
  if(!await stillCurrent())return response(409,{ok:false,code:'WORKSPACE_CHANGED'});
  const {data:claim,error}=await admin.from('paige_pending_confirmations').update({consumed_at:new Date().toISOString()})
   .eq('user_id',user.id).eq('tenant_id',tenant).eq('tool_name',capability).eq('fingerprint',body.approved_fingerprint)
   .is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null).not('server_issued_at','is',null).not('issued_in_request','is',null)
   .neq('issued_in_request',requestNonce).gt('expires_at',new Date().toISOString()).select('args').maybeSingle();
  if(!error&&object(claim?.args))claimedArgs=claim.args;
 }
 const projected=projectCapabilities({tools:[{name:capability,description:'Save an unissued invoice draft.'}],spine:SALES_DRAFT_SPINE,legacy:{},isMutating:()=>true,lanes:new Map([[capability,lane as Lane]]),workspaceAdminTools:new Set([capability]),isWorkspaceAdmin:true,readiness:new Map([['none','ready']])})[0];
 let admission:Awaited<ReturnType<typeof admitCommercialDraft>>;
 try{admission=await admitCommercialDraft({caller:{authenticated:true,userId:user.id,tenantId:tenant,tenantSource:'server',door:'other',access:{allowed:true}},availability:projected?.availability,approval:{autonomyLane:lane,...(claimedArgs!==undefined?{claimedArgs,claimedFor:capability}:{})},operationId,intent,catalogPrices});}
 catch{return response(403,{ok:false,code:'DRAFT_APPROVAL_SCOPE_INVALID'});}
 const decision=admission.decision;
 const {error:auditError}=await admin.from('paige_audit_log').insert({actor_user_id:user.id,actor_role:`sales:${member.role}`,tenant_id:tenant,action:'sales.invoice_draft_governed_decision',target_type:'invoice',target_id:admission.execution?.command.invoice_id??command.invoice_id,payload:{capability,decision:decision.kind,risk:decision.risk,lane_requested:decision.audit.laneRequested,lane_effective:decision.audit.laneEffective,operation_id:operationId}});
 if(auditError)return response(503,{ok:false,code:'SALES_DECISION_RECEIPT_FAILED'});
 if(decision.kind==='refuse')return response(403,{ok:false,outcome:'refused',code:decision.code});
 if(decision.kind==='propose'){
  if(!await stillCurrent())return response(409,{ok:false,code:'WORKSPACE_CHANGED'});
  const {data:pending,error:pendingError}=await admin.from('paige_pending_confirmations').select('args,fingerprint,summary').eq('user_id',user.id).eq('tenant_id',tenant).eq('tool_name',capability)
   .is('thread_id',null).is('scoped_client_id',null).is('consumed_at',null).not('server_issued_at','is',null).not('issued_in_request','is',null).gt('expires_at',new Date().toISOString()).contains('args',{operation_id:operationId}).limit(1).maybeSingle();
  if(pendingError)return response(503,{ok:false,code:'APPROVAL_STORE_UNAVAILABLE'});
  const args={expected_tenant_id:tenant,operation_id:operationId,command,approval_subject:`${command.action}:${command.invoice_id}`,approval_cycle_nonce:crypto.randomUUID()};
  if(pending){if(!object(pending.args)||JSON.stringify(pending.args.command)!==JSON.stringify(command))return response(409,{ok:false,code:'APPROVAL_CYCLE_CHANGED'});return response(200,{ok:false,outcome:'approval_required',fingerprint:pending.fingerprint,summary:pending.summary});}
  const fingerprint=await confirmFingerprint(capability,args);const now=new Date().toISOString();
  const catalogSummary=catalogPrices?lines.filter(line=>line.price_id!==null).map(line=>{const p=catalogPrices!.find(p=>p.price_id===line.price_id!.toLowerCase())!;return `${p.product_name}: ${line.quantity} × ${money(p.unit_minor)} per ${p.billing_interval==='month'?'month':'unit'} = ${money(p.unit_minor*line.quantity)}`;}).join('; '):undefined;
  const summary=`${intent.action==='invoice.draft_create'?'Create':'Revise'} an unissued ${money(amounts.totalMinor)} USD invoice draft for ${clientName}${intent.draft.kind==='deposit'?`, requesting ${money(amounts.dueNowMinor)} as the deposit with ${money(amounts.remainderMinor)} remaining after the deposit`:''}, due ${intent.draft.due_date}. ${intent.draft.agreement_id?'Link the selected canonical agreement without sending or changing it. ':''}${catalogSummary?'Reviewed catalog prices: '+catalogSummary+'. ':''}This saves a draft only; it does not publish, send, activate a plan or collect payment.`;
  const {error}=await admin.from('paige_pending_confirmations').insert({user_id:user.id,tenant_id:tenant,thread_id:null,scoped_client_id:null,tool_name:capability,fingerprint,issued_in_request:requestNonce,server_issued_at:now,args,summary,expires_at:new Date(Date.now()+10*60*1000).toISOString()});
  if(error)return response(503,{ok:false,code:'APPROVAL_STORE_UNAVAILABLE'});
  return response(200,{ok:false,outcome:'approval_required',fingerprint,summary});
 }
 if(!admission.execution)return response(503,{ok:false,code:'DRAFT_EXECUTION_UNAVAILABLE'});
 if(!await stillCurrent())return response(409,{ok:false,code:'WORKSPACE_CHANGED'});
 const {data:result,error}=await admin.rpc('execute_sales_invoice_draft_command',{...rpcArgs,_command:admission.execution.command,_governance:{actor_user_id:user.id,tenant_id:tenant,tool:capability,action:admission.execution.command.action,approval_channel:claimedArgs?'operator_card':'standing_autonomy_setting',approved_fingerprint:claimedArgs?body.approved_fingerprint:null,decision_receipt_recorded:true}});
 if(error?.code==='40001')return response(409,{ok:false,outcome:'needs_input',code:'DRAFT_REVIEW_CHANGED',operation_id:operationId,message:'The invoice or selected catalog facts changed. Read the current draft and selected prices, then request fresh review. Nothing was saved.'});
 if(error)return response(databaseAnswered(error)?422:503,{ok:false,outcome:databaseAnswered(error)?'refused':'outcome_unknown',code:'DRAFT_COMMAND_UNCONFIRMED',operation_id:operationId});
 if(!object(result)||result.ok!==true)return response(503,{ok:false,outcome:'outcome_unknown',code:'DRAFT_READBACK_INVALID',operation_id:operationId});
 return response(200,{...result,capability});
});
