// @vitest-environment node
import {describe,it,expect} from 'vitest';
import type {SpineCapability} from '../../supabase/functions/_shared/paige-spine/contracts';
import {C0B_EXISTING_WRITE_CAPABILITIES} from '../../supabase/functions/_shared/paige-spine/domains/c0b_existing_writes';
import {classifyAction} from '../../supabase/functions/_shared/action-risk';
import {projectCapabilities} from '../../supabase/functions/_shared/paige-capability-status/projection';
import {requiresWorkspaceAdmin} from '../../supabase/functions/_shared/workspace-authority';
const prior=[
 ['action_file','action_bus','public.file_action','ordinary',true,true],
 ['action_advance','action_bus','public.advance_action','ordinary',false,true],
 ['plan_remove_item','planning','public.plan_remove_item','high',false,false],
 ['member_grant_role','team','public.grant_tenant_member_role','high',true,true],
 ['member_revoke_role','team','public.revoke_tenant_member_role','high',true,true],
 ['team_set_permission','team','public.set_solo_team_member_permission','high',true,true],
 ['team_set_work_profile','team','public.set_solo_team_member_work_profile','ordinary',true,true],
] as const;
const legacy=Object.fromEntries(prior.map(([tool,domain,,,_riskVisible,workspaceAdmin])=>[tool,{domain,effect:'mutate' as const,selfDescribe:_riskVisible,readiness:'none' as const,workspaceAdmin}]));
const capabilities:readonly SpineCapability[]=C0B_EXISTING_WRITE_CAPABILITIES;
describe('C0b existing caller-RPC write convergence',()=>{
 it('declares only the seven traced RPC writers, excluding invitation Edge wrappers',()=>{expect(capabilities.map(c=>c.action?.chatTool).sort()).toEqual(prior.map(([tool])=>tool).sort());});
 it.each(prior)('preserves %s actual executor, risk and Chat authority', (tool,domain,executor,risk,selfDescribe,workspaceAdmin)=>{const cap=capabilities.find(c=>c.action?.chatTool===tool);expect(cap).toMatchObject({domain,selfDescribe,readiness:'none',chatBinding:'LIVE',mindBinding:'UNAVAILABLE',maturity:'PARTIAL',sharedPrimitiveChange:'NONE',action:{executor,classification:'mutate',riskPolicyKey:risk,approvalAuthority:'chat-canonical',seatAuthority:workspaceAdmin?'workspace-admin':'member'}});expect(classifyAction(tool)).toBe(risk);expect(requiresWorkspaceAdmin(tool,new Set())).toBe(workspaceAdmin);});
 it.each([false,true])('preserves frozen legacy discovery under admin=%s',admin=>{for(const lane of ['confirm','auto','off'] as const){const common={tools:prior.map(([name])=>({name,description:`Use ${name}.`})),isMutating:()=>true,lanes:new Map(prior.map(([tool])=>[tool,lane])),workspaceAdminTools:new Set(prior.filter(r=>r[5]).map(r=>r[0])),isWorkspaceAdmin:admin,readiness:new Map()};const before=projectCapabilities({...common,spine:[],legacy});const after=projectCapabilities({...common,spine:capabilities,legacy:{}});const facts=(rows:typeof before)=>rows.map(({key:_key,source:_source,...r})=>r);expect(facts(after)).toEqual(facts(before));}});
 it('does not claim exactly-once or blind retry safety',()=>{expect(capabilities.every(c=>c.action!.idempotency.length>60)).toBe(true);expect(capabilities.find(c=>c.action?.chatTool==='action_file')?.action?.idempotency).toMatch(/new action|duplicate/);expect(capabilities.find(c=>c.action?.chatTool==='action_advance')?.action?.idempotency).toMatch(/terminal|noop/i);expect(capabilities.find(c=>c.action?.chatTool==='plan_remove_item')?.action?.idempotency).toMatch(/timestamp|audit/);});
});
