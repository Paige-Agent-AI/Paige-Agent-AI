import {SALES_COMMERCIAL_OFFERS_SPINE} from '../../sales-commercial/offers-read.ts';
import {SALES_DRAFT_SPINE} from '../../sales-commercial/draft-capabilities.ts';
import {SALES_COMMERCIAL_PACKAGE_SPINE} from '../../sales-commercial/package-read.ts';
import type { SpineCapability } from '../contracts.ts';
import {defineCapability, objectInputSchema, ownerGrantablePermission} from '../../capability-kit/mod.ts';

// Declarations reflect the bound dispatch, not authenticated delivery. The Sales surface remains
// PROOF_OWED; no processor charge, delivered email, link creation or Mind capability is claimed.
const mutations = [
  ['settings_update','sales_update_invoice_settings'], ['publish', 'sales_publish_invoice'], ['record_manual_payment', 'sales_record_manual_payment'],
  ['reverse_manual_payment', 'sales_reverse_manual_payment'], ['void', 'sales_void_invoice'],
] as const;
export const SALES_INVOICE_CAPABILITIES: readonly SpineCapability[] = [
 ...SALES_DRAFT_SPINE, SALES_COMMERCIAL_OFFERS_SPINE, SALES_COMMERCIAL_PACKAGE_SPINE,
 {key:'sales_invoice.payment_request',readiness:'sales_merchant',domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',
  action:{classification:'external_effect',executor:'public.prepare_sales_invoice_payment_request',chatTool:'sales_create_payment_request',riskPolicyKey:'high',approvalAuthority:'chat-canonical',idempotency:'Exact server-resolved tenant/customer/invoice/version/amount/currency/merchant/environment, immutable operation and one persisted dispatch claim; uncertain response only reconciles.'},
  outcome:{kinds:['prepared','dispatching','provider_accepted','customer_action_required','outcome_unknown','settled','failed','expired','cancelled','refused'],projector:'public.read_sales_invoice_payment_request',railVisibility:'Request/readback/verified settlement and allocation are distinct. Hosted request never claims payment. Authenticated provider acceptance is PROOF_OWED.'},
  chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL'},
  {key:'sales_invoice.preferences_read',readiness:'none',domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',action:{classification:'read',executor:'public.read_sales_invoice_preferences',chatTool:'read_sales_invoice_preferences',riskPolicyKey:'read_only',approvalAuthority:'none',idempotency:'Authenticated current tenant and owner/admin reader.'},outcome:{kinds:['available','refused','failed'],projector:'public.read_sales_invoice_preferences',railVisibility:'Scoped preferences only; never changes issued documents.'},chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL'},
  { key: 'sales_invoice.read', domain: 'sales_invoice', owner: 'sales', humanSurface: '/solo/:account/sales?tab=payments',
    action: { classification: 'read', executor: 'public.read_sales_invoice', chatTool: 'read_sales_invoice', riskPolicyKey: 'read_only', approvalAuthority: 'none', idempotency: 'Read-only; authenticated tenant and owner/admin role are revalidated by the RPC.' },
    outcome: { kinds: ['available', 'refused', 'failed'], projector: 'public.read_sales_invoice', railVisibility: 'Only safe current invoice and manual receipt facts; manual settlement is not processor verification.' },
    chatBinding: 'LIVE', mindBinding: 'UNAVAILABLE', sharedPrimitiveChange: 'NONE', maturity: 'PARTIAL' },
  ...mutations.map(([verb, chatTool]): SpineCapability => ({
    ...(verb === 'settings_update' ? {readiness:'none' as const} : {}),
    key: `sales_invoice.${verb}`, domain: 'sales_invoice', owner: 'sales', humanSurface: '/solo/:account/sales?tab=payments',
    action: { classification: 'mutate', executor: 'public.execute_sales_invoice_command', chatTool, riskPolicyKey: 'high', approvalAuthority: 'chat-canonical', idempotency: 'Canonical tenant + actor + operation UUID and stored command result. Chat derives operation UUID from stable user turn and command; approved calls reuse stored arguments. Only sales-invoice-command atomically consumes the canonical approval.' },
    outcome: { kinds: ['settings_saved', 'published', 'manual_payment_recorded', 'manual_payment_reversed', 'voided', 'refused', 'outcome_unknown'], projector: 'public.read_sales_invoice_command_result', railVisibility: 'Canonical governed command receipt and readback only. Never claims money was charged, refunded, sent, or provider verified.' },
    chatBinding: 'LIVE', mindBinding: 'UNAVAILABLE', sharedPrimitiveChange: 'NONE', maturity: 'PARTIAL',
  })),
  { key: 'sales_invoice.email_send', domain: 'sales_invoice', owner: 'sales', humanSurface: '/solo/:account/sales?tab=payments',
    action: { classification: 'external_effect', executor: 'public.prepare_sales_invoice_delivery', chatTool: 'billing_send_invoice', riskPolicyKey: 'high', approvalAuthority: 'chat-canonical', idempotency: 'Canonical tenant + actor + stored operation UUID through sales-invoice-command and executeSalesInvoiceDelivery. Server connection and issued invoice are revalidated; send-message admission uses public.claim_sales_invoice_delivery, then public.finalize_sales_invoice_delivery. Unknown provider results require reconciliation, never a new-operation retry.' },
    outcome: { kinds: ['provider_accepted', 'refused', 'failed', 'unknown', 'outcome_unknown'], projector: 'public.read_sales_invoice_delivery_result', railVisibility: 'Records verified provider acceptance only, never delivered, read or paid. Provider eligibility and authenticated runtime remain UNVERIFIED.' },
    chatBinding: 'LIVE', mindBinding: 'UNAVAILABLE', sharedPrimitiveChange: 'NONE', maturity: 'PARTIAL' },
];

// Capability Kit declarations are evaluated on this already-imported Spine domain's cold start.
// They validate the declared risk against the canonical policy; they are not another dispatcher,
// permission grant, approval claim or proof of authenticated delivery. The actual execution stays
// in sales-invoice-command/governedExecution and the service-only business RPC, with atomic Rail.
// Link creation is human-only: no Chat tool or bearer-token model result is introduced here.
const INVOICE_SCOPE = {source:'server',tenantResolver:'current_user_tenant_id',actorResolver:'authenticated_user',revalidateAt:['before_availability','before_execution','before_receipt']} as const;
const INVOICE_AVAILABILITY = {resolver:'paige-capability-status',states:['live','needs_approval','not_for_tier','unavailable']} as const;
const INVOICE_RECEIPT = {rail:true,recorder:'record_capability_run',redaction:'tenant_safe',visibility:'owner_internal'} as const;
const INVOICE_INPUT = {invoice_id:{type:'string',format:'uuid'},expected_version:{type:'integer',minimum:1}} as const;

export const SALES_INVOICE_PUBLISH_CAPABILITY = defineCapability({
 identity:{id:'sales_invoice.publish',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Freeze the reviewed saved invoice as an issued obligation. No send or payment is claimed.'},
 input:objectInputSchema({description:'The canonical saved-version command; governance, actor, tenant, approval and generated token are server-only.',properties:{...INVOICE_INPUT,action:{type:'string',enum:['invoice.publish']},template:{type:'string',enum:['classic','modern','service']}},required:['action','invoice_id','expected_version']}),
 effect:'mutation',
 governance:{actionRiskKey:'sales_publish_invoice',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.publish.execute')},
 tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,
 providerBinding:{kind:'internal',operation:'public.execute_sales_invoice_command',connectionResolver:null},
 idempotency:{mode:'required',key:'Server-bound actor + tenant + operation UUID + exact canonical command. Replay lookup precedes eligibility; uncertain results retain that operation, never a new financial write.',readback:'public.read_sales_invoice_command_result',replay:'return_recorded_result'},
 receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
});

export const SALES_INVOICE_RECORD_PAYMENT_CAPABILITY = defineCapability({
 identity:{id:'sales_invoice.record_manual_payment',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Append a human-reported receipt and reduce outstanding balance. Never provider verification.'},
 input:objectInputSchema({description:'The canonical saved-version command; governance, actor, tenant, approval and generated token are server-only.',properties:{...INVOICE_INPUT,action:{type:'string',enum:['invoice.record_manual_payment']},amount_cents:{type:'integer',minimum:1,maximum:2147483647},currency:{type:'string',enum:['usd']},method:{type:'string',enum:['zelle','cash','wire','check','bank_transfer','other']},received_at:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?Z$'},reference:{anyOf:[{type:'string',maxLength:200},{type:'null'}]},notes:{anyOf:[{type:'string',maxLength:2000},{type:'null'}]}},required:['action','invoice_id','expected_version','amount_cents','currency','method','received_at']}),
 effect:'mutation',
 governance:{actionRiskKey:'sales_record_manual_payment',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.record_manual_payment.execute')},
 tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,
 providerBinding:{kind:'internal',operation:'public.execute_sales_invoice_command',connectionResolver:null},
 idempotency:{mode:'required',key:'Server-bound actor + tenant + operation UUID + exact canonical command. Replay lookup precedes eligibility; uncertain results retain that operation, never a new financial write.',readback:'public.read_sales_invoice_command_result',replay:'return_recorded_result'},
 receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
});

export const SALES_INVOICE_REVERSE_PAYMENT_CAPABILITY = defineCapability({
 identity:{id:'sales_invoice.reverse_manual_payment',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Append a correction that reverses one recorded receipt without erasing history.'},
 input:objectInputSchema({description:'The canonical saved-version command; governance, actor, tenant, approval and generated token are server-only.',properties:{...INVOICE_INPUT,action:{type:'string',enum:['invoice.reverse_manual_payment']},payment_id:{type:'string',format:'uuid'},reason:{type:'string',minLength:1,maxLength:500}},required:['action','invoice_id','expected_version','payment_id','reason']}),
 effect:'mutation',
 governance:{actionRiskKey:'sales_reverse_manual_payment',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.reverse_manual_payment.execute')},
 tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,
 providerBinding:{kind:'internal',operation:'public.execute_sales_invoice_command',connectionResolver:null},
 idempotency:{mode:'required',key:'Server-bound actor + tenant + operation UUID + exact canonical command. Replay lookup precedes eligibility; uncertain results retain that operation, never a new financial write.',readback:'public.read_sales_invoice_command_result',replay:'return_recorded_result'},
 receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
});

export const SALES_INVOICE_VOID_CAPABILITY = defineCapability({
 identity:{id:'sales_invoice.void',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Withdraw an issued invoice, retaining receipts and revoking customer document access.'},
 input:objectInputSchema({description:'The canonical saved-version command; governance, actor, tenant, approval and generated token are server-only.',properties:{...INVOICE_INPUT,action:{type:'string',enum:['invoice.void']},reason:{type:'string',minLength:1,maxLength:500}},required:['action','invoice_id','expected_version','reason']}),
 effect:'mutation',
 governance:{actionRiskKey:'sales_void_invoice',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.void.execute')},
 tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,
 providerBinding:{kind:'internal',operation:'public.execute_sales_invoice_command',connectionResolver:null},
 idempotency:{mode:'required',key:'Server-bound actor + tenant + operation UUID + exact canonical command. Replay lookup precedes eligibility; uncertain results retain that operation, never a new financial write.',readback:'public.read_sales_invoice_command_result',replay:'return_recorded_result'},
 receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
});

export const SALES_INVOICE_CREATE_LINK_CAPABILITY = defineCapability({
 identity:{id:'sales_invoice.link_create',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Explicit human-only creation or replacement of an expiring customer document link. No token enters Chat.'},
 input:objectInputSchema({description:'The canonical saved-version command; governance, actor, tenant, approval and generated token are server-only.',properties:{...INVOICE_INPUT,action:{type:'string',enum:['invoice.link_create']},expires_in_days:{type:'integer',minimum:1,maximum:30},grant_scope:{type:'string',enum:['share']}},required:['action','invoice_id','expected_version','expires_in_days']}),
 effect:'external_effect',
 governance:{actionRiskKey:'sales_create_invoice_link',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.link_create.execute')},
 tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,
 providerBinding:{kind:'internal',operation:'public.execute_sales_invoice_command',connectionResolver:null},
 idempotency:{mode:'required',key:'Server-bound actor + tenant + operation UUID + exact canonical command. Replay lookup precedes eligibility; uncertain results retain that operation, never a new financial write.',readback:'public.read_sales_invoice_command_result',replay:'return_recorded_result'},
 receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
});

export const SALES_INVOICE_SETTINGS_CAPABILITY = defineCapability({
 identity:{id:'sales_invoice.settings_update',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Change tenant invoice preferences for future issuance. Issued documents remain frozen.'},
 input:objectInputSchema({properties:{action:{type:'string',enum:['invoice.settings_update']},expected_version:{type:'integer',minimum:0},settings:{type:'object',properties:{prefix:{type:'string',pattern:'^[A-Z0-9-]{0,20}$'},next_number:{type:'integer',minimum:1,maximum:999999998},padding:{type:'integer',minimum:1,maximum:9},template:{type:'string',enum:['classic','modern','service']},accent:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},logo_data_uri:{anyOf:[{type:'string',maxLength:175000},{type:'null'}]},footer:{type:'string',maxLength:1000},payment_instructions:{type:'string',maxLength:2000}},required:['prefix','next_number','padding','template','accent','logo_data_uri','footer','payment_instructions'],additionalProperties:false}},required:['action','expected_version','settings']}),effect:'mutation',
 governance:{actionRiskKey:'sales_update_invoice_settings',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.settings_update.execute')},
 tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,providerBinding:{kind:'internal',operation:'public.execute_sales_invoice_command',connectionResolver:null},
 idempotency:{mode:'required',key:'Actor + tenant + operation UUID + exact settings version and payload; issuance increments the same version.',readback:'public.read_sales_invoice_command_result',replay:'return_recorded_result'},receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
});
export const SALES_INVOICE_PREFERENCES_READ_CAPABILITY = defineCapability({
 identity:{id:'sales_invoice.preferences_read',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Read tenant invoice preferences and management permission.'},
 input:objectInputSchema({properties:{},required:[]}),effect:'read',governance:{actionRiskKey:null,risk:'read_only',approval:'none',requiredPermission:ownerGrantablePermission('sales_invoice.preferences_read.execute')},
 tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,providerBinding:{kind:'internal',operation:'public.read_sales_invoice_preferences',connectionResolver:null},idempotency:{mode:'not_applicable'},receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
});
export const SALES_INVOICE_KIT_CAPABILITIES = [SALES_INVOICE_SETTINGS_CAPABILITY,SALES_INVOICE_PUBLISH_CAPABILITY,SALES_INVOICE_RECORD_PAYMENT_CAPABILITY,SALES_INVOICE_REVERSE_PAYMENT_CAPABILITY,SALES_INVOICE_VOID_CAPABILITY,SALES_INVOICE_CREATE_LINK_CAPABILITY] as const;

// Read and email declarations describe the existing authenticated read and governed delivery door.
export const SALES_INVOICE_READ_CAPABILITY = defineCapability({
 identity:{id:'sales_invoice.read',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Read bounded current invoice and manually recorded receipt facts; never processor verification.'},
 input:objectInputSchema({properties:{invoice_id:{type:'string',format:'uuid'}},required:['invoice_id']}),effect:'read',
 governance:{actionRiskKey:null,risk:'read_only',approval:'none',requiredPermission:ownerGrantablePermission('sales_invoice.read.execute')},
 tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,providerBinding:{kind:'internal',operation:'public.read_sales_invoice',connectionResolver:null},
 idempotency:{mode:'not_applicable'},receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
});
export const SALES_INVOICE_EMAIL_CAPABILITY = defineCapability({
 identity:{id:'sales_invoice.email_send',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Governed attempt through the selected tenant email sender. Acceptance is not delivery or payment.'},
 input:objectInputSchema({properties:{...INVOICE_INPUT,action:{type:'string',enum:['invoice.email_send','invoice.sms_send']},connector_id:{anyOf:[{type:'string',format:'uuid'},{type:'null'}]}},required:['action','invoice_id','expected_version']}),effect:'external_effect',
 governance:{actionRiskKey:'billing_send_invoice',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.email_send.execute')},
 tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,providerBinding:{kind:'internal',operation:'public.prepare_sales_invoice_delivery',connectionResolver:null},
 idempotency:{mode:'required',key:'Server actor + tenant + stored operation UUID + exact issued version and connector. Unknown delivery is reconciled, never automatically resent.',readback:'public.read_sales_invoice_delivery_result',replay:'reconcile_then_return'},
 receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
});

/** Canonical policy-key lookup for the existing Kit decision adapter; no alternate execution. */
export const SALES_INVOICE_KIT_BY_ACTION = {
 sales_create_payment_request:defineCapability({
  identity:{id:'sales_invoice.payment_request',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Prepare an exact tenant-merchant hosted payment request. Request creation never proves payment.'},
  input:objectInputSchema({description:'Caller intent only. Server resolves customer, merchant, currency and current eligible amount before exact review.',properties:{...INVOICE_INPUT,action:{type:'string',enum:['invoice.payment_request']},provider:{type:'string',enum:['stripe','paypal']},purpose:{type:'string',enum:['full','partial','deposit','installment']},amount_minor:{type:'integer',minimum:1,maximum:2147483647}},required:['action','invoice_id','expected_version','provider','purpose']}),
  effect:'external_effect',governance:{actionRiskKey:'sales_create_payment_request',risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.payment_request.execute')},
  tenantScope:INVOICE_SCOPE,availability:INVOICE_AVAILABILITY,
  providerBinding:{kind:'internal',operation:'public.prepare_sales_invoice_payment_request',connectionResolver:null},
  idempotency:{mode:'required',key:'Tenant + actor + immutable operation + exact invoice/customer/merchant/environment/amount/currency. Persisted single dispatch claim. Unknown outcomes reconcile without creating another provider payment.',readback:'public.read_sales_invoice_payment_request',replay:'reconcile_then_return'},
  receipt:INVOICE_RECEIPT,outcome:{projector:'capability-record'},
 }),
 sales_update_invoice_settings:SALES_INVOICE_SETTINGS_CAPABILITY,
 sales_publish_invoice:SALES_INVOICE_PUBLISH_CAPABILITY,
 sales_record_manual_payment:SALES_INVOICE_RECORD_PAYMENT_CAPABILITY,
 sales_reverse_manual_payment:SALES_INVOICE_REVERSE_PAYMENT_CAPABILITY,
 sales_void_invoice:SALES_INVOICE_VOID_CAPABILITY,
 sales_create_invoice_link:SALES_INVOICE_CREATE_LINK_CAPABILITY,
 billing_send_invoice:SALES_INVOICE_EMAIL_CAPABILITY,
} as const;
