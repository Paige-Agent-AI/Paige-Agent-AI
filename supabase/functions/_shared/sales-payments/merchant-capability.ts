import {defineCapability,objectInputSchema,ownerGrantablePermission} from '../capability-kit/mod.ts';
import type {SpineCapability} from '../paige-spine/contracts.ts';
export const MERCHANT_TOOL_ACTIONS={read_sales_merchant_status:'merchant.status',read_sales_merchant_refresh:'merchant.refresh_status',sales_start_merchant_onboarding:'merchant.start_onboarding',sales_create_merchant_login_link:'merchant.login_link'} as const;
const make=(tool:'sales_start_merchant_onboarding'|'sales_create_merchant_login_link',id:string,action:string)=>defineCapability({
 identity:{id,version:1,domain:'sales_merchant',owner:'sales',humanSurface:'/solo/:account/settings/integrations',description:'Governed hosted Stripe Express setup or portal handoff. A hosted link does not prove merchant readiness.'},
 input:objectInputSchema({properties:{action:{type:'string',enum:[action]},provider:{type:'string',enum:['stripe']}},required:['action','provider']}),
 effect:'external_effect',governance:{actionRiskKey:tool,risk:'high',approval:'confirm',requiredPermission:ownerGrantablePermission(`${id}.execute`)},
 tenantScope:{source:'server',tenantResolver:'current_user_tenant_id',actorResolver:'authenticated_user',revalidateAt:['before_availability','before_execution','before_receipt']},
 availability:{resolver:'paige-capability-status',states:['live','needs_approval','needs_setup','unavailable','not_for_tier']},
 providerBinding:{kind:'internal',operation:'edge.tenant-stripe-connect',connectionResolver:null},
 idempotency:{mode:'required',key:'Actor + tenant + command + operation + environment + exact binding and approved server return targets. Existing unknown reservation is GET-only.',readback:'tenant-stripe-connect:status',replay:'reconcile_then_return'},
 receipt:{rail:true,recorder:'record_capability_run',redaction:'tenant_safe',visibility:'owner_internal'},outcome:{projector:'capability-record'},
});
export const MERCHANT_KIT_BY_TOOL={sales_start_merchant_onboarding:make('sales_start_merchant_onboarding','sales_merchant.onboarding_start','merchant.start_onboarding'),sales_create_merchant_login_link:make('sales_create_merchant_login_link','sales_merchant.portal_link','merchant.login_link')} as const;
/** Actual edge executor, explicitly validated by the existing Spine registry. Provider acceptance remains unverified. */
export const MERCHANT_SPINE_CAPABILITIES:readonly SpineCapability[]=Object.entries(MERCHANT_TOOL_ACTIONS).map(([tool,action])=>{
 const effect=tool.startsWith('read_')?'read':'external_effect';
 const name=action==='merchant.start_onboarding'?'onboarding_start':action==='merchant.login_link'?'portal_link':action==='merchant.refresh_status'?'refresh':'status';
 return {key:`sales_merchant.${name}`,domain:'sales_merchant',owner:'sales',readiness:'none',humanSurface:'/solo/:account/settings/integrations',action:{classification:effect,executor:'edge.tenant-stripe-connect',chatTool:tool,riskPolicyKey:effect==='read'?'read_only':'high',approvalAuthority:effect==='read'?'none':'chat-canonical',idempotency:'Scoped canonical merchant binding. Status has no provider call; explicit refresh is GET-only; only the canonical reservation winner may create.'},outcome:{kinds:['available','approval_required','customer_action_required','outcome_unknown','refused','unverified'],projector:'tenant-stripe-connect:status',railVisibility:'Safe merchant facts and existing capability-run receipts only. Hosted URL, credentials and provider errors never enter model/Rail. A link is not ready or connected proof.'},chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL'};
});
