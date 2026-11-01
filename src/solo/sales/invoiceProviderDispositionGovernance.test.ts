import {expect,it} from 'vitest';
import * as domain from '../../../supabase/functions/_shared/paige-spine/domains/sales_invoice';
import {classifyAction} from '../../../supabase/functions/_shared/action-risk';
import {decideDeclaredCapability} from '../../../supabase/functions/_shared/capability-kit/decision';
const key='sales_record_provider_disposition';
const declaration=()=>((domain.SALES_INVOICE_KIT_BY_ACTION as unknown as Record<string,Parameters<typeof decideDeclaredCapability>[0]>)[key]);
const args={command:{action:'invoice.record_provider_disposition',invoice_id:'e0448000-0000-4000-8000-000000000001'},operation_id:'original-reviewed-operation'};
const input=(approval:Record<string,unknown>={},caller:Record<string,unknown>={})=>({caller:{authenticated:true,userId:'fixture-owner',principal:'person',tenantId:'fixture-workspace',tenantSource:'server',door:'other',access:{allowed:true},...caller},capability:{id:key,effect:'mutate',outcomeChannel:'record_capability_run',availability:'needs_approval'},approval:{autonomyLane:'auto',...approval},requestArgs:{command:{action:'substitution-attempt'}}} as Parameters<typeof decideDeclaredCapability>[1]);
it('declares an internal high-confirm invoice decision on the original executor and receipt path',()=>{
 expect(declaration()).toBeDefined();expect(classifyAction(key)).toBe('high');
 expect(declaration()).toMatchObject({identity:{id:'sales_invoice.record_provider_disposition',domain:'sales_invoice',owner:'sales'},effect:'mutation',governance:{actionRiskKey:key,risk:'high',approval:'confirm'},providerBinding:{kind:'internal',operation:'public.execute_sales_invoice_command',connectionResolver:null},receipt:{rail:true,recorder:'record_capability_run'}});
});
it('does not publish an unfinished mutation through Spine before a genuine exact Chat binding exists',()=>{
 expect(domain.SALES_INVOICE_CAPABILITIES.some(c=>c.key==='sales_invoice.record_provider_disposition')).toBe(false);
 expect(declaration()).toMatchObject({identity:{id:'sales_invoice.record_provider_disposition'},governance:{risk:'high',approval:'confirm'}});
});
it('never turns automatic preference into financial approval',()=>{expect(decideDeclaredCapability(declaration(),input())).toMatchObject({kind:'propose',risk:'high',audit:{laneEffective:'confirm'}});});
it('executes only the original stored canonical arguments',()=>{const result=decideDeclaredCapability(declaration(),input({claimedFor:key,claimedArgs:args}));expect(result.kind).toBe('execute');if(result.kind==='execute')expect(result.args).toBe(args);});
it('cannot borrow payment-request or publication approval',()=>{for(const claimedFor of ['sales_create_payment_request','sales_publish_invoice'])expect(decideDeclaredCapability(declaration(),input({claimedFor,claimedArgs:args}))).toMatchObject({kind:'refuse',code:'approval_claim_capability_mismatch'});});
it('preserves current access and workspace brakes after approval',()=>{
 expect(decideDeclaredCapability(declaration(),input({claimedFor:key,claimedArgs:args},{access:{allowed:false}}))).toMatchObject({kind:'refuse',code:'access_denied'});
 expect(decideDeclaredCapability(declaration(),input({claimedFor:key,claimedArgs:args,autonomyLane:'off'}))).toMatchObject({kind:'refuse',code:'autonomy_off'});
 expect(decideDeclaredCapability(declaration(),input({}, {tenantSource:'request'}))).toMatchObject({kind:'refuse',code:'tenant_not_server_derived'});
});
it('cannot use a service principal as an owner decision',()=>{expect(decideDeclaredCapability(declaration(),input({claimedFor:key,claimedArgs:args},{principal:'service'}))).toMatchObject({kind:'refuse',code:'service_principal_may_not_mutate'});});
