import {defineCapability,objectInputSchema,ownerGrantablePermission} from '../capability-kit/mod.ts';
import type {SpineCapability} from '../paige-spine/contracts.ts';

export const SALES_COMMERCIAL_PACKAGE_READ=defineCapability({
 identity:{id:'sales_invoice.commercial_package_read',version:1,domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',description:'Read canonical invoice, signing agreement and recorded commercial terms together. Missing facts remain explicit; no package approval or execution.'},
 input:objectInputSchema({properties:{invoice_id:{type:'string',format:'uuid'}},required:['invoice_id']}),
 effect:'read',governance:{actionRiskKey:null,risk:'read_only',approval:'none',requiredPermission:ownerGrantablePermission('sales_invoice.commercial_package_read.execute')},
 tenantScope:{source:'server',tenantResolver:'current_user_tenant_id',actorResolver:'authenticated_user',revalidateAt:['before_availability','before_execution','before_receipt']},
 availability:{resolver:'paige-capability-status',states:['live','needs_approval','not_for_tier','unavailable']},
 providerBinding:{kind:'internal',operation:'public.read_sales_commercial_package',connectionResolver:null},
 idempotency:{mode:'not_applicable'},receipt:{rail:true,recorder:'record_capability_run',redaction:'tenant_safe',visibility:'owner_internal'},outcome:{projector:'capability-record'},
});
export const SALES_COMMERCIAL_PACKAGE_SPINE:SpineCapability={
 key:'sales_invoice.commercial_package_read',domain:'sales_invoice',owner:'sales',humanSurface:'/solo/:account/sales/payments',readiness:'none',
 action:{classification:'read',executor:'public.read_sales_commercial_package',chatTool:'read_sales_commercial_package',riskPolicyKey:'read_only',approvalAuthority:'none',idempotency:'Authenticated same-tenant source references and current versions; read receipt only.'},
 outcome:{kinds:['needs_input','conflict','refused','failed'],projector:'public.read_sales_commercial_package',railVisibility:'Safe read receipt without documents, signing tokens or financial payload.'},
 chatBinding:'LIVE',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',maturity:'PARTIAL',
};
// Bound dispatch is not authenticated acceptance or authority to execute constituent acts.
export const SALES_COMMERCIAL_PACKAGE_TOOL={type:'function' as const,function:{name:'read_sales_commercial_package',description:'Read an existing canonical invoice package: frozen offer facts, signing agreement state, commercial terms, recorded principal schedule preview, source versions and canonical balance. Schedule rows are recorded due amounts, not proof that an installment was paid or permission for autopay. Resolve the exact invoice first. Missing fields and conflicts are facts to clarify, not permission to invent dates, fees, taxes or signed terms. A read never approves, publishes, sends, creates a subscription or collects payment. Keep signing records distinct from commercial terms; do not display internal IDs as invoice numbers.',parameters:SALES_COMMERCIAL_PACKAGE_READ.input}};

export {readCommercialPackage} from './package-projection.ts';
