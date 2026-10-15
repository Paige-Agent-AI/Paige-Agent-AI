// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {PLANNING_WRITE_CAPABILITIES} from '../../supabase/functions/_shared/paige-spine/domains/planning_writes';
import {classifyAction} from '../../supabase/functions/_shared/action-risk';

import {projectCapabilities} from '../../supabase/functions/_shared/paige-capability-status/projection';
import {requiresWorkspaceAdmin} from '../../supabase/functions/_shared/workspace-authority';
const tools=['plan_set_reminder','plan_create','plan_add_milestone','plan_assign_task','plan_update_item'];
// Frozen pre-registration facts remain valid after the shared owner removes legacy rows.
const legacy=Object.fromEntries(tools.map(tool=>[tool,{domain:'planning',effect:'mutate' as const,selfDescribe:tool!=='plan_update_item',readiness:'none' as const,workspaceAdmin:false}]));
describe('C0b existing planning write declarations',()=>{
 it('declares exactly the approved existing tools without removal or read expansion',()=>{expect(PLANNING_WRITE_CAPABILITIES.map(c=>c.action.chatTool).sort()).toEqual([...tools].sort());});
 it.each(tools)('preserves %s ordinary approval and member Chat admission',tool=>{const c=PLANNING_WRITE_CAPABILITIES.find(c=>c.action.chatTool===tool);expect(c).toMatchObject({domain:'planning',readiness:'none',chatBinding:'LIVE',mindBinding:'UNAVAILABLE',maturity:'PARTIAL',sharedPrimitiveChange:'NONE',action:{executor:`public.${tool}`,classification:'mutate',seatAuthority:'member',riskPolicyKey:classifyAction(tool),approvalAuthority:'chat-canonical'}});expect(requiresWorkspaceAdmin(tool,new Set())).toBe(false);});
 it.each([false,true])('preserves legacy discovery/risk/readiness for workspace admin=%s',admin=>{const common={tools:tools.map(name=>({name,description:`Use ${name}.`})),isMutating:()=>true,lanes:new Map(),workspaceAdminTools:new Set<string>(),isWorkspaceAdmin:admin,readiness:new Map()};const prior=projectCapabilities({...common,spine:[],legacy});const next=projectCapabilities({...common,spine:PLANNING_WRITE_CAPABILITIES,legacy:{}});const facts=(rows:typeof prior)=>rows.map(({key:_key,source:_source,...r})=>r);expect(facts(next)).toEqual(facts(prior));expect(next.some(r=>r.tool==='plan_update_item')).toBe(false);});
 it('does not claim create deduplication or retry safety for update rearming',()=>{for(const c of PLANNING_WRITE_CAPABILITIES)expect(c.action.idempotency).toMatch(/not idempotent/i);expect(PLANNING_WRITE_CAPABILITIES.find(c=>c.action.chatTool==='plan_update_item')?.action.idempotency).toMatch(/re-arm|timestamp/);});
});
