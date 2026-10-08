import {defineCapability,objectInputSchema,ownerGrantablePermission} from '../capability-kit/mod.ts';
import type {NestedInputSchema} from '../capability-kit/schema.ts';

// Bound Chat dispatch contracts. LIVE chatBinding means registered code wiring only;
// maturity remains PARTIAL: authenticated runtime, provider readiness and commercial completion are UNVERIFIED.
const nullableId:NestedInputSchema={anyOf:[{type:'string',format:'uuid'},{type:'null'}]};
const nullableText=(maxLength:number):NestedInputSchema=>({anyOf:[{type:'string',maxLength},{type:'null'}]});
const common={
 schema_version:{type:'integer',minimum:2,maximum:3},client_id:{type:'string',format:'uuid'},
 items:{type:'array',minItems:1,maxItems:50,items:{type:'object',additionalProperties:false,
  properties:{price_id:nullableId,item:{type:'string',minLength:1,maxLength:200},description:nullableText(10000),unit_minor:{anyOf:[{type:'integer',minimum:1,maximum:2147483647},{type:'null'}]},quantity:{type:'integer',minimum:1,maximum:1000}},required:['price_id','item','unit_minor','quantity']}},
 kind:{type:'string',enum:['one_time','deposit','recurring']},deposit_basis_points:{anyOf:[{type:'integer',minimum:1,maximum:9999},{type:'null'}]},
 currency:{type:'string',enum:['usd']},cadence:{anyOf:[{type:'string',enum:['monthly']},{type:'null'}]},
 recipient_email:nullableText(254),recipient_phone:nullableText(40),email_source_method_id:nullableId,phone_source_method_id:nullableId,
 billing_address:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,properties:{line1:nullableText(200),line2:nullableText(200),city:nullableText(100),region:nullableText(100),postal_code:nullableText(100),country:nullableText(100)}}]},
 agreement_id:nullableId,processor_intent:nullableText(80),payment_method_intents:{type:'array',maxItems:12,items:{type:'string',pattern:'^[a-z][a-z0-9_]{0,63}$'}},
 delivery_channel_intents:{type:'array',maxItems:2,items:{type:'string',enum:['email','sms']}},due_date:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},memo:nullableText(2000),
} as const satisfies Readonly<Record<string,NestedInputSchema>>;
const treatment:NestedInputSchema={type:'object',additionalProperties:false,properties:{
 state:{type:'string',enum:['unknown','not_applicable','recorded']},source:nullableText(200),policy:nullableText(1000),
 charges:{type:'array',maxItems:10,items:{type:'object',additionalProperties:false,properties:{line_index:{type:'integer',minimum:0,maximum:49},amount_minor:{type:'integer',minimum:1,maximum:2147483647},currency:{type:'string',enum:['usd']}},required:['line_index','amount_minor','currency']}},
 },required:['state','source','policy','charges']};
const draft:NestedInputSchema={type:'object',properties:{...common,deposit_minor:{type:'integer',minimum:1,maximum:2147483647},
 commercial_conditions:{type:'object',additionalProperties:false,properties:{schema_version:{type:'integer',minimum:1,maximum:1},tax:treatment,fees:treatment},required:['schema_version','tax','fees']}},required:Object.keys(common),additionalProperties:false};
export const SALES_DRAFT_CREATE=defineCapability({
  identity:{id:'sales_invoice.draft_create',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Save and read back an unissued canonical invoice draft. No publication, delivery, mandate or payment.'},
  input:objectInputSchema({properties:{action:{type:'string',enum:['invoice.draft_create']},draft,},required:['action','draft']}),
  effect:'mutation',governance:{actionRiskKey:'billing_create_invoice',risk:'ordinary',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.draft_create.execute')},
  tenantScope:{source:'server',tenantResolver:'current_user_tenant_id',actorResolver:'authenticated_user',revalidateAt:['before_availability','before_execution','before_receipt']},
  availability:{resolver:'paige-capability-status',states:['live','needs_approval','not_for_tier','unavailable']},
  providerBinding:{kind:'internal',operation:'public.execute_sales_invoice_draft_command',connectionResolver:null},
  idempotency:{mode:'required',key:'Server-scoped actor, tenant, stable operation and exact draft command; generated create identity is never model input.',readback:'public.read_sales_invoice_command_result',replay:'return_recorded_result'},
  receipt:{rail:true,recorder:'record_capability_run',redaction:'tenant_safe',visibility:'owner_internal'},outcome:{projector:'capability-record'},
 });
export const SALES_DRAFT_REVISE=defineCapability({
  identity:{id:'sales_invoice.draft_revise',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Save and read back an unissued canonical invoice draft. No publication, delivery, mandate or payment.'},
  input:objectInputSchema({properties:{action:{type:'string',enum:['invoice.draft_revise']},draft,invoice_id:{type:'string',format:'uuid'},expected_version:{type:'integer',minimum:1}},required:['action','draft','invoice_id','expected_version']}),
  effect:'mutation',governance:{actionRiskKey:'sales_revise_invoice_draft',risk:'ordinary',approval:'confirm',requiredPermission:ownerGrantablePermission('sales_invoice.draft_revise.execute')},
  tenantScope:{source:'server',tenantResolver:'current_user_tenant_id',actorResolver:'authenticated_user',revalidateAt:['before_availability','before_execution','before_receipt']},
  availability:{resolver:'paige-capability-status',states:['live','needs_approval','not_for_tier','unavailable']},
  providerBinding:{kind:'internal',operation:'public.execute_sales_invoice_draft_command',connectionResolver:null},
  idempotency:{mode:'required',key:'Server-scoped actor, tenant, stable operation and exact draft command; generated create identity is never model input.',readback:'public.read_sales_invoice_command_result',replay:'return_recorded_result'},
  receipt:{rail:true,recorder:'record_capability_run',redaction:'tenant_safe',visibility:'owner_internal'},outcome:{projector:'capability-record'},
 });

export const SALES_DRAFT_SPINE = [SALES_DRAFT_CREATE,SALES_DRAFT_REVISE].map(declaration=>({
 key:declaration.identity.id,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',readiness:'none' as const,
 action:{classification:'mutate' as const,executor:'public.execute_sales_invoice_draft_command',chatTool:declaration.governance.actionRiskKey!,riskPolicyKey:'ordinary' as const,approvalAuthority:'chat-canonical' as const,idempotency:declaration.idempotency.mode==='required'?declaration.idempotency.key:'Not applicable'},
 outcome:{kinds:['draft_created','draft_revised','refused','outcome_unknown'],projector:'public.read_sales_invoice_command_result',railVisibility:'Saved canonical unissued draft and immutable operation receipt only; never issuance, delivery, mandate or settlement.'},
 chatBinding:'LIVE' as const,mindBinding:'UNAVAILABLE' as const,sharedPrimitiveChange:'SCR-2026-10-05' as const,maturity:'PARTIAL' as const,
}));
