import { defineCapability, objectInputSchema, ownerGrantablePermission } from '../../capability-kit/mod.ts';
import { COLLECTION_ACTIONS } from '../../sales-collections/contract.ts';
import type { SpineCapability } from '../contracts.ts';

// Domain declarations reuse the platform's decision gate and Rail. These are not
// a second approval registry, scheduler, collection engine or delivery proof.
const scope = { source:'server', tenantResolver:'current_user_tenant_id', actorResolver:'authenticated_user', revalidateAt:['before_availability','before_execution','before_receipt'] } as const;
const availability = { resolver:'paige-capability-status', states:['live','needs_approval','not_for_tier','unavailable'] } as const;
const receipt = { rail:true, recorder:'record_capability_run', redaction:'tenant_safe', visibility:'owner_internal' } as const;
const str = {type:'string'} as const;
const minor = {type:'integer',minimum:0,maximum:2147483647} as const;
const nullableText = {anyOf:[str,{type:'null'}]} as const;
const nullableInt = {anyOf:[minor,{type:'null'}]} as const;
const dateRow = {type:'object',additionalProperties:false,properties:{due_date:str,amount_cents:minor,label:nullableText},required:['due_date','amount_cents','label']} as const;
const termsSchema = {type:'object',additionalProperties:false,properties:{schema_version:{type:'integer',minimum:1,maximum:1},kind:{type:'string',enum:['full','installment','recurring','deposit','milestone','custom']},currency:str,total_cents:minor,anchor_date:str,cadence:{type:'string',enum:['monthly','quarterly','annual','custom']},count:nullableInt,end_date:nullableText,dates:{type:'array',items:dateRow,maxItems:240},deposit_cents:nullableInt,late_fee:{type:'object',additionalProperties:false,properties:{fixed_cents:minor,rate_bps:minor,grace_days:minor,agreement_basis:nullableText}},interest:{type:'object',additionalProperties:false,properties:{annual_bps:minor,agreement_basis:nullableText}}},required:['schema_version','kind','currency','total_cents','anchor_date','cadence']} as const;
const importRow = {type:'object',additionalProperties:false,properties:{entity:{type:'string',enum:['invoice','receipt']},entity_id:str,client_id:str,invoice_id:nullableText,invoice_number:str,currency:str,amount_cents:minor,due_date:nullableText,memo:nullableText,invoice_entity_id:nullableText,payment_id:nullableText,method:str,received_at:str,reference:nullableText},required:['entity','entity_id','currency','amount_cents']} as const;
function declaration(action:keyof typeof COLLECTION_ACTIONS) {
  const command = action==='collection.create_commercial_terms' ? objectInputSchema({properties:{action:{type:'string',enum:[action]},client_id:{type:'string',format:'uuid'},offer_id:{type:'string',format:'uuid'},term_kind:{type:'string',enum:['one_time','installment']},agreed_amount_minor:{type:'integer',minimum:1,maximum:2147483647},agreed_currency:{type:'string',pattern:'^[a-z]{3}$'},billing_interval:{anyOf:[{type:'string',enum:['month']},{type:'null'}]},interval_count:nullableInt,installments_total:nullableInt,payment_schedule:{type:'string',enum:['on_signing','on_start','in_advance','in_arrears','on_milestone','custom']},starts_on:str,ends_on:nullableText,title:nullableText,notes:nullableText},required:['action','client_id','offer_id','term_kind','agreed_amount_minor','agreed_currency','billing_interval','interval_count','installments_total','payment_schedule','starts_on','ends_on','title','notes']}) : objectInputSchema({properties:{action:{type:'string',enum:[action]},agreement_id:{type:'string',format:'uuid'},invoice_id:{type:'string',format:'uuid'},payment_id:{type:'string',format:'uuid'},expected_version:{type:'integer',minimum:0},amount_cents:minor,currency:str,method:{type:'string',enum:['zelle','cash','wire','check','bank_transfer','other']},received_at:str,reference:nullableText,notes:nullableText,reason:{type:'string',minLength:1,maxLength:500},terms:termsSchema,source_account:{type:'string',maxLength:200},rows:{type:'array',items:importRow,minItems:1,maxItems:200},batch_id:{type:'string',format:'uuid'},expected_digest:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:action === 'collection.save_terms' ? ['action','agreement_id','expected_version','terms'] : action === 'collection.stage_import' ? ['action','source_account','rows'] : action === 'collection.record_receipt' ? ['action','invoice_id','expected_version','amount_cents','currency','method','received_at'] : action === 'collection.reverse_receipt' ? ['action','invoice_id','expected_version','payment_id','reason'] : ['action','batch_id','expected_digest']});
  return objectInputSchema({description:'The actual server-bound approval envelope; callers supply only the parsed command and operation, never authority.',properties:{command,operation_id:{type:'string',format:'uuid'},expected_tenant_id:{type:'string',format:'uuid'},approval_subject:{type:'string',maxLength:200},approval_cycle_nonce:{type:'string',format:'uuid'}},required:['command','operation_id','expected_tenant_id','approval_subject']});
}
export const SALES_COMMERCIAL_CREATE_CAPABILITY = defineCapability({
 identity:{id:'sales_create_commercial_terms',version:1,domain:'sales_collections',owner:'sales',humanSurface:'/solo/:account/sales/terms',description:'Create one canonical fixed draft commercial obligation. No invoice, signing agreement, mandate or payment is created.'},
 input:declaration('collection.create_commercial_terms'),effect:'mutation',
 governance:{actionRiskKey:'sales_create_commercial_terms',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_create_commercial_terms.execute')},
 tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.execute_sales_collection_command',connectionResolver:null},
 idempotency:{mode:'required',key:'Server actor, tenant, operation and exact parsed command.',readback:'public.read_sales_collection_command_result',replay:'return_recorded_result'},receipt,outcome:{projector:'capability-record'},
});
export const SALES_COLLECTION_SAVE_TERMS_CAPABILITY = defineCapability({
    identity:{ id:'sales_save_collection_terms',version:1,domain:'sales_collections',owner:'sales',humanSurface:'/solo/:account/sales/payments?view=collections',description:'Governed agreement terms or reviewed historical collection import; no provider execution or payment verification.' },
    input:declaration('collection.save_terms'),
    effect:'mutation',governance:{actionRiskKey:'sales_save_collection_terms',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_save_collection_terms.execute')},
    tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.execute_sales_collection_command',connectionResolver:null},
    idempotency:{mode:'required',key:'Server actor, tenant, operation and exact parsed command; imported external identity additionally deduplicates within tenant/source.',readback:'public.read_sales_collection_command_result',replay:'return_recorded_result'},
    receipt,outcome:{projector:'capability-record'},
  });
export const SALES_COLLECTION_STAGE_IMPORT_CAPABILITY = defineCapability({
    identity:{ id:'sales_stage_collection_import',version:1,domain:'sales_collections',owner:'sales',humanSurface:'/solo/:account/sales/payments?view=collections',description:'Governed agreement terms or reviewed historical collection import; no provider execution or payment verification.' },
    input:declaration('collection.stage_import'),
    effect:'mutation',governance:{actionRiskKey:'sales_stage_collection_import',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_stage_collection_import.execute')},
    tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.execute_sales_collection_command',connectionResolver:null},
    idempotency:{mode:'required',key:'Server actor, tenant, operation and exact parsed command; imported external identity additionally deduplicates within tenant/source.',readback:'public.read_sales_collection_command_result',replay:'return_recorded_result'},
    receipt,outcome:{projector:'capability-record'},
  });
export const SALES_COLLECTION_COMMIT_IMPORT_CAPABILITY = defineCapability({
    identity:{ id:'sales_commit_collection_import',version:1,domain:'sales_collections',owner:'sales',humanSurface:'/solo/:account/sales/payments?view=collections',description:'Governed agreement terms or reviewed historical collection import; no provider execution or payment verification.' },
    input:declaration('collection.commit_import'),
    effect:'mutation',governance:{actionRiskKey:'sales_commit_collection_import',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_commit_collection_import.execute')},
    tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.execute_sales_collection_command',connectionResolver:null},
    idempotency:{mode:'required',key:'Server actor, tenant, operation and exact parsed command; imported external identity additionally deduplicates within tenant/source.',readback:'public.read_sales_collection_command_result',replay:'return_recorded_result'},
    receipt,outcome:{projector:'capability-record'},
  });
export const SALES_COLLECTION_RECORD_RECEIPT_CAPABILITY = defineCapability({
    identity:{ id:'sales_record_manual_payment',version:1,domain:'sales_collections',owner:'sales',humanSurface:'/solo/:account/sales/payments?view=collections',description:'Governed agreement terms or reviewed historical collection import; no provider execution or payment verification.' },
    input:declaration('collection.record_receipt'),
    effect:'mutation',governance:{actionRiskKey:'sales_record_manual_payment',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_record_manual_payment.execute')},
    tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.execute_sales_collection_command',connectionResolver:null},
    idempotency:{mode:'required',key:'Server actor, tenant, operation and exact parsed command; imported external identity additionally deduplicates within tenant/source.',readback:'public.read_sales_collection_command_result',replay:'return_recorded_result'},
    receipt,outcome:{projector:'capability-record'},
  });
export const SALES_COLLECTION_REVERSE_RECEIPT_CAPABILITY = defineCapability({
    identity:{ id:'sales_reverse_manual_payment',version:1,domain:'sales_collections',owner:'sales',humanSurface:'/solo/:account/sales/payments?view=collections',description:'Governed agreement terms or reviewed historical collection import; no provider execution or payment verification.' },
    input:declaration('collection.reverse_receipt'),
    effect:'mutation',governance:{actionRiskKey:'sales_reverse_manual_payment',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_reverse_manual_payment.execute')},
    tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.execute_sales_collection_command',connectionResolver:null},
    idempotency:{mode:'required',key:'Server actor, tenant, operation and exact parsed command; imported external identity additionally deduplicates within tenant/source.',readback:'public.read_sales_collection_command_result',replay:'return_recorded_result'},
    receipt,outcome:{projector:'capability-record'},
  });
export const SALES_COLLECTION_KIT_BY_ACTION = {
  sales_create_commercial_terms:SALES_COMMERCIAL_CREATE_CAPABILITY,
  sales_save_collection_terms:SALES_COLLECTION_SAVE_TERMS_CAPABILITY,
  sales_stage_collection_import:SALES_COLLECTION_STAGE_IMPORT_CAPABILITY,
  sales_commit_collection_import:SALES_COLLECTION_COMMIT_IMPORT_CAPABILITY,
  sales_record_manual_payment:SALES_COLLECTION_RECORD_RECEIPT_CAPABILITY,
  sales_reverse_manual_payment:SALES_COLLECTION_REVERSE_RECEIPT_CAPABILITY,
} as const;
export const SALES_COLLECTION_READ_CAPABILITY = defineCapability({
 identity:{id:'sales_collections.read',version:1,domain:'sales_collections',owner:'sales',humanSurface:'/solo/:account/sales/payments?view=collections',description:'Read a bounded scoped collection register or agreements, with no mutation or provider claim.'},
 input:objectInputSchema({properties:{entity:{type:'string',enum:['invoice','receipt','agreement']},limit:{type:'integer',minimum:1,maximum:50},before_id:{anyOf:[{type:'string',format:'uuid'},{type:'null'}]},cursor:{anyOf:[{type:'object',properties:{snapshot_id:{type:'string',format:'uuid'},after_position:{type:'integer',minimum:0},entity:{type:'string',enum:['invoice','receipt']}},required:['snapshot_id','after_position','entity'],additionalProperties:false},{type:'null'}]}},required:['entity']}),
 effect:'read',governance:{actionRiskKey:null,risk:'read_only',approval:'none',requiredPermission:ownerGrantablePermission('sales_collections.read')},
 tenantScope:scope,availability,providerBinding:{kind:'internal',operation:'public.read_sales_collections',connectionResolver:null},
 idempotency:{mode:'not_applicable'},
 receipt,outcome:{projector:'capability-record'},
});
// Receipt/reversal Chat ownership remains sales_invoice; its existing tools dispatch imported records through the bounded Collections Kit seam. Do not declare a second Chat owner.
export const SALES_COLLECTION_CAPABILITIES:readonly SpineCapability[] = [{key:'sales_collections.read',domain:'sales_collections',owner:'sales',humanSurface:'/solo/:account/sales/payments?view=collections',readiness:'none',action:{classification:'read',executor:'public.read_sales_collections',chatTool:'read_sales_collections',riskPolicyKey:'read_only',approvalAuthority:'none',idempotency:'Bounded authenticated canonical read; tenant and owner/admin scope revalidated.'},outcome:{kinds:['available','refused','failed'],projector:'public.read_sales_collections',railVisibility:'Safe bounded canonical business projection; manual facts are not provider verification.'},chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL'},...Object.entries(COLLECTION_ACTIONS).filter(([action])=>action!=='collection.record_receipt'&&action!=='collection.reverse_receipt').map(([action,key]):SpineCapability=>({
 key:`sales_collections.${action.slice('collection.'.length)}`,domain:'sales_collections',owner:'sales',humanSurface:'/solo/:account/sales/payments?view=collections',readiness:'none',
 action:{classification:'mutate',executor:'public.execute_sales_collection_command',chatTool:key,riskPolicyKey:'high',approvalAuthority:'chat-canonical',idempotency:'Exact actor, tenant, operation and parsed command with canonical readback; imported identity additionally deduplicates tenant/source.'},
 outcome:{kinds:['saved','staged','committed','refused','outcome_unknown'],projector:'public.read_sales_collection_command_result',railVisibility:`Canonical ${action} readback; no charge, send or provider verification.`},
 chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL',
}))];
