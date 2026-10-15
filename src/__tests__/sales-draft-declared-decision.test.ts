import {describe,it,expect} from 'vitest';
import {decideDeclaredCapability,decideDeclaredOrdinaryCapability} from '../../supabase/functions/_shared/capability-kit/decision';
import {SALES_DRAFT_CREATE} from '../../supabase/functions/_shared/sales-commercial/draft-capabilities';
import {SALES_INVOICE_PUBLISH_CAPABILITY} from '../../supabase/functions/_shared/paige-spine/domains/sales_invoice';
import type {DefinedCapability} from '../../supabase/functions/_shared/capability-kit/types';
const input={caller:{authenticated:true,userId:'22222222-2222-4222-8222-222222222222',tenantId:'33333333-3333-4333-8333-333333333333',tenantSource:'server',door:'chat',access:{allowed:true}},capability:{id:'billing_create_invoice',effect:'mutate',outcomeChannel:'record_capability_run',availability:'live'},approval:{autonomyLane:'confirm'},requestArgs:{marker:'request'}} as const;
describe('ordinary declared internal mutation boundary',()=>{
 it('does not grant authority from construction metadata',()=>expect(decideDeclaredOrdinaryCapability(SALES_DRAFT_CREATE,input).kind).toBe('propose'));
 it('honors current AUTO and OFF through the same gate',()=>{expect(decideDeclaredOrdinaryCapability(SALES_DRAFT_CREATE,{...input,approval:{autonomyLane:'auto'}}).kind).toBe('execute');expect(decideDeclaredOrdinaryCapability(SALES_DRAFT_CREATE,{...input,approval:{autonomyLane:'off'}}).kind).toBe('refuse')});
 it('failed claim cannot fall through AUTO',()=>expect(decideDeclaredOrdinaryCapability(SALES_DRAFT_CREATE,{...input,approval:{autonomyLane:'auto',claimedFor:'billing_create_invoice',claimedArgs:null}}).kind).not.toBe('execute'));
 it('uses exact stored approval arguments',()=>{const stored={marker:'stored'};const result=decideDeclaredOrdinaryCapability(SALES_DRAFT_CREATE,{...input,approval:{autonomyLane:'confirm',claimedFor:'billing_create_invoice',claimedArgs:stored}});expect(result.kind).toBe('execute');if(result.kind==='execute')expect(result.args).toEqual(stored)});
 it('rejects unbranded metadata',()=>expect(()=>decideDeclaredOrdinaryCapability({...SALES_DRAFT_CREATE} as DefinedCapability,input)).toThrow('DECLARATION_REQUIRED'));
 it('rejects another key',()=>expect(()=>decideDeclaredOrdinaryCapability(SALES_DRAFT_CREATE,{...input,capability:{...input.capability,id:'sales_publish_invoice'}})).toThrow('DECLARATION_MISMATCH'));
 it('preserves the high-only wrapper',()=>expect(()=>decideDeclaredCapability(SALES_DRAFT_CREATE,input)).toThrow('EFFECT_MISMATCH'));
 it('ordinary wrapper cannot admit high-risk publishing',()=>expect(()=>decideDeclaredOrdinaryCapability(SALES_INVOICE_PUBLISH_CAPABILITY,{...input,capability:{...input.capability,id:'sales_publish_invoice'}})).toThrow('EFFECT_MISMATCH'));
 it.each(['unknown',undefined] as const)('requires resolved availability %s',availability=>expect(()=>decideDeclaredOrdinaryCapability(SALES_DRAFT_CREATE,{...input,capability:{...input.capability,availability}})).toThrow('EVIDENCE_BOUNDARY'));
 it('requires canonical receipt channel',()=>expect(()=>decideDeclaredOrdinaryCapability(SALES_DRAFT_CREATE,{...input,capability:{...input.capability,outcomeChannel:'other'}})).toThrow('EVIDENCE_BOUNDARY'));
 it('rejects read-effect dispatch',()=>expect(()=>decideDeclaredOrdinaryCapability(SALES_DRAFT_CREATE,{...input,capability:{...input.capability,effect:'read'}})).toThrow('EFFECT_MISMATCH'));
});
