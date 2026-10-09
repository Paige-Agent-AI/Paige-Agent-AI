// @vitest-environment node
import {describe,it,expect} from 'vitest';
import type {SpineCapability} from '../../supabase/functions/_shared/paige-spine/contracts';
import {C0B_INCUMBENT_ADAPTER_CAPABILITIES} from '../../supabase/functions/_shared/paige-spine/domains/c0b_incumbent_adapters';
import {projectCapabilities} from '../../supabase/functions/_shared/paige-capability-status/projection';
import {classifyAction,mutatingTools} from '../../supabase/functions/_shared/action-risk';
import {requiresWorkspaceAdmin} from '../../supabase/functions/_shared/workspace-authority';
const prior=[
 ['calendar_book_meeting','calendar','mutate','high',true,true,'public.create_internal_booking'],
 ['calendar_link_send','calendar','external_effect','high',true,false,'edge.paige-ai-chat'],
 ['propose_business_brief_update','business_profile','mutate','ordinary',true,true,'public.stage_solo_business_brief_proposal'],
 ['update_business_profile','business_profile','mutate','ordinary',false,true,'edge.paige-ai-chat'],
 ['capability_status','platform_meta','read','read_only',false,false,'edge.paige-ai-chat'],
 ['improvement_propose','platform_meta','mutate','ordinary',false,true,'edge.paige-ai-chat'],
 ['improvement_decide','platform_meta','mutate','high',false,true,'edge.paige-ai-chat'],
 ['list_subagents','agents','read','read_only',true,true,'edge.paige-orchestrator'],
 ['delegate_to_subagent','agents','external_effect','high',true,true,'edge.paige-orchestrator'],
 ['forge_subagent','agents','mutate','ordinary',true,true,'edge.subagent-forge'],
] as const;
const caps:readonly SpineCapability[]=C0B_INCUMBENT_ADAPTER_CAPABILITIES;
const legacy=Object.fromEntries(prior.map(([tool,domain,effect,,selfDescribe,workspaceAdmin])=>[tool,{domain,effect,selfDescribe,workspaceAdmin,readiness:'none' as const}]));
describe('C0b incumbent adapter declarations',()=>{
 it('declares exactly ten incumbent tools without upgrading writes to reads',()=>{expect(caps.map(c=>c.action?.chatTool).sort()).toEqual(prior.map(([t])=>t).sort());expect(caps.filter(c=>c.action?.classification==='read')).toHaveLength(2);});
 it.each(prior)('preserves %s actual adapter and authority',(tool,domain,classification,risk,selfDescribe,admin,executor)=>{expect(caps.find(c=>c.action?.chatTool===tool)).toMatchObject({domain,selfDescribe,readiness:'none',chatBinding:'LIVE',mindBinding:'UNAVAILABLE',maturity:'PARTIAL',sharedPrimitiveChange:'NONE',action:{executor,classification,riskPolicyKey:risk,approvalAuthority:classification==='read'?'none':'chat-canonical',seatAuthority:admin?'workspace-admin':'member'}});expect(requiresWorkspaceAdmin(tool,new Set())).toBe(admin);expect(mutatingTools().has(tool)).toBe(classification!=='read');if(classification!=='read')expect(classifyAction(tool)).toBe(risk);});
 it.each([false,true])('preserves frozen prior discovery and availability admin=%s',admin=>{for(const lane of ['auto','confirm','off'] as const){const common={tools:prior.map(([name])=>({name,description:`Use ${name}.`})),isMutating:(t:string)=>mutatingTools().has(t),lanes:new Map(prior.map(([t])=>[t,lane])),workspaceAdminTools:new Set(prior.filter(r=>r[5]).map(r=>r[0])),isWorkspaceAdmin:admin,readiness:new Map()};const before=projectCapabilities({...common,spine:[],legacy});const after=projectCapabilities({...common,spine:caps,legacy:{}});const facts=(r:typeof before)=>r.map(({key:_key,source:_source,...f})=>f);expect(facts(after)).toEqual(facts(before));}});
 it('preserves hidden duplicate/internal paths without claiming new delivery',()=>{for(const tool of ['update_business_profile','capability_status','improvement_propose','improvement_decide'])expect(caps.find(c=>c.action?.chatTool===tool)?.selfDescribe).toBe(false);expect(caps.every(c=>c.action!.idempotency.length>60)).toBe(true);expect(caps.find(c=>c.action?.chatTool==='delegate_to_subagent')?.action?.idempotency).toMatch(/not.*exactly.once|no.*request.key/i);});
});
