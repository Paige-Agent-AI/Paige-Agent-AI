import { describe, expect, it } from 'vitest';
import { decideDeclaredCapability } from '../../supabase/functions/_shared/capability-kit/decision';
import { SALES_INVOICE_PUBLISH_CAPABILITY } from '../../supabase/functions/_shared/paige-spine/domains/sales_invoice';
import type { DefinedCapability } from '../../supabase/functions/_shared/capability-kit/types';
const requestArgs={command:{action:'invoice.publish',invoice_id:'11111111-1111-4111-8111-111111111111',expected_version:1}};
const input={caller:{authenticated:true,userId:'22222222-2222-4222-8222-222222222222',principal:'person',tenantId:'33333333-3333-4333-8333-333333333333',tenantSource:'server',door:'other',access:{allowed:true,reason:'Server checked owner'}},capability:{id:'sales_publish_invoice',effect:'mutate',outcomeChannel:'record_capability_run',availability:'needs_approval'},approval:{autonomyLane:'confirm'},requestArgs} as const;
describe('declared Sales execution boundary',()=>{
 it('rejects an unbranded declaration',()=>expect(()=>decideDeclaredCapability({...SALES_INVOICE_PUBLISH_CAPABILITY} as DefinedCapability,input)).toThrow('DECLARATION_REQUIRED'));
 it('rejects selecting another capability',()=>expect(()=>decideDeclaredCapability(SALES_INVOICE_PUBLISH_CAPABILITY,{...input,capability:{...input.capability,id:'sales_void_invoice'}})).toThrow('DECLARATION_MISMATCH'));
 it('rejects absent evidence boundary',()=>expect(()=>decideDeclaredCapability(SALES_INVOICE_PUBLISH_CAPABILITY,{...input,capability:{...input.capability,availability:'unknown'}})).toThrow('EVIDENCE_BOUNDARY'));
 it('does not gain authority from its declaration',()=>{expect(decideDeclaredCapability(SALES_INVOICE_PUBLISH_CAPABILITY,input).kind).not.toBe('execute');expect(decideDeclaredCapability(SALES_INVOICE_PUBLISH_CAPABILITY,{...input,approval:{autonomyLane:'auto'}}).kind).not.toBe('execute');});
 it('executes the stored canonical claim instead of request arguments',()=>{const stored={...requestArgs,marker:'stored'};const result=decideDeclaredCapability(SALES_INVOICE_PUBLISH_CAPABILITY,{...input,approval:{autonomyLane:'confirm',claimedFor:'sales_publish_invoice',claimedArgs:stored}});expect(result.kind).toBe('execute');if(result.kind==='execute')expect(result.args).toEqual(stored);});
});