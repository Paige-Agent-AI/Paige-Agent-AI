// @vitest-environment node
import {it,expect} from 'vitest';
import type {SpineCapability} from '../../supabase/functions/_shared/paige-spine/contracts';
import {TEAM_INVITATION_CAPABILITIES} from '../../supabase/functions/_shared/paige-spine/domains/team_invitations';
import {projectCapabilities} from '../../supabase/functions/_shared/paige-capability-status/projection';
import {classifyAction} from '../../supabase/functions/_shared/action-risk';
import {requiresWorkspaceAdmin} from '../../supabase/functions/_shared/workspace-authority';
const prior=[['team_invite_member','external_effect',true],['team_invite_resend','external_effect',false],['team_invite_revoke','mutate',false]] as const;
const capabilities:readonly SpineCapability[]=TEAM_INVITATION_CAPABILITIES;
const legacy=Object.fromEntries(prior.map(([tool,effect,selfDescribe])=>[tool,{domain:'team',effect,selfDescribe,readiness:'none' as const,workspaceAdmin:true}]));
it('declares exactly the three existing invitation wrapper tools',()=>expect(capabilities.map(c=>c.action?.chatTool).sort()).toEqual(prior.map(([t])=>t).sort()));
it.each(prior)('preserves %s authority and actual Edge executor', (tool,classification,selfDescribe)=>{expect(capabilities.find(c=>c.action?.chatTool===tool)).toMatchObject({domain:'team',selfDescribe,readiness:'none',maturity:'PARTIAL',mindBinding:'UNAVAILABLE',chatBinding:'LIVE',sharedPrimitiveChange:'NONE',action:{executor:'edge.solo-team-invitations',classification,riskPolicyKey:'high',approvalAuthority:'chat-canonical',seatAuthority:'workspace-admin'}});expect(classifyAction(tool)).toBe('high');expect(requiresWorkspaceAdmin(tool,new Set())).toBe(true);});
it.each([false,true])('preserves prior discovery for admin=%s',admin=>{for(const lane of ['auto','confirm','off'] as const){const common={tools:prior.map(([name])=>({name,description:`Use ${name}.`})),isMutating:()=>true,lanes:new Map(prior.map(([tool])=>[tool,lane])),workspaceAdminTools:new Set(prior.map(([tool])=>tool)),isWorkspaceAdmin:admin,readiness:new Map()};const before=projectCapabilities({...common,spine:[],legacy});const after=projectCapabilities({...common,spine:capabilities,legacy:{}});const facts=(r:typeof before)=>r.map(({key:_key,source:_source,...f})=>f);expect(facts(after)).toEqual(facts(before));}});
it('records token rotation, separate email result and repeated revoke limits',()=>{expect(capabilities.find(c=>c.action?.chatTool==='team_invite_member')?.action?.idempotency).toMatch(/token|not idempotent/i);expect(capabilities.find(c=>c.action?.chatTool==='team_invite_resend')?.action?.idempotency).toMatch(/new token|rotate/i);expect(capabilities.every(c=>c.action!.idempotency.length>60)).toBe(true);});
