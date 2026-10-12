// @vitest-environment node
import {it,expect} from 'vitest';
import type {SpineCapability} from '../../supabase/functions/_shared/paige-spine/contracts';
import {C0B_FUNDING_STUDIO_CAPABILITIES} from '../../supabase/functions/_shared/paige-spine/domains/c0b_funding_studio_adapters';
import {projectCapabilities} from '../../supabase/functions/_shared/paige-capability-status/projection';
import {mutatingTools,classifyAction} from '../../supabase/functions/_shared/action-risk';
import {requiresWorkspaceAdmin} from '../../supabase/functions/_shared/workspace-authority';
const prior=[
 ['get_current_rates','funding_optin','read',true,false],['search_funding_marketplace','funding_optin','read',false,false],
 ['search_regional_lenders','funding_optin','read',true,false],['search_sba_lenders','funding_optin','read',true,false],
 ['marketplace_browse','integrations_mcp','read',true,false],['draft_marketing_content','marketing','read',true,true],
 ['ask_choices','vibe_studio','read',false,false],['generate_image','vibe_studio','mutate',true,true],
 ['growth_funnel_generate','vibe_studio','read',false,true],['growth_list','vibe_studio','read',true,true],['growth_page_generate','vibe_studio','read',false,true],
] as const;
const caps:readonly SpineCapability[]=C0B_FUNDING_STUDIO_CAPABILITIES;
const legacy=Object.fromEntries(prior.map(([t,domain,effect,selfDescribe,workspaceAdmin])=>[t,{domain,effect,selfDescribe,workspaceAdmin,readiness:'none' as const}]));
it('declares the eleven incumbent paths without inventing a funding provider',()=>expect(caps.map(c=>c.action?.chatTool).sort()).toEqual(prior.map(([t])=>t).sort()));
it.each(prior)('preserves %s effect and admission',(t,domain,classification,selfDescribe,admin)=>{const scaffold=t==='search_funding_marketplace';expect(caps.find(c=>c.action?.chatTool===t)).toMatchObject({domain,selfDescribe,readiness:'none',chatBinding:scaffold?'UNAVAILABLE':'LIVE',maturity:scaffold?'UNAVAILABLE':'PARTIAL',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE',action:{executor:'edge.paige-ai-chat',classification,seatAuthority:admin?'workspace-admin':'member',riskPolicyKey:classification==='mutate'?'ordinary':'read_only',approvalAuthority:classification==='mutate'?'chat-canonical':'none'}});expect(requiresWorkspaceAdmin(t,new Set())).toBe(admin);expect(mutatingTools().has(t)).toBe(classification==='mutate');if(classification==='mutate')expect(classifyAction(t)).toBe('ordinary');});
it.each([false,true])('preserves prior visibility/readiness for admin=%s',admin=>{const common={tools:prior.map(([name])=>({name,description:`Use ${name}.`})),isMutating:(t:string)=>mutatingTools().has(t),lanes:new Map(),workspaceAdminTools:new Set(prior.filter(r=>r[4]).map(r=>r[0])),isWorkspaceAdmin:admin,readiness:new Map()};const before=projectCapabilities({...common,spine:[],legacy});const after=projectCapabilities({...common,spine:caps,legacy:{}});const facts=(r:typeof before)=>r.map(({key:_key,source:_source,...f})=>f);expect(facts(after)).toEqual(facts(before));expect(after.some(r=>r.tool==='search_funding_marketplace')).toBe(false);});
it('records incumbent cache, model, transcript and image effects honestly',()=>{const note=(t:string)=>caps.find(c=>c.action?.chatTool===t)?.action?.idempotency??'';expect(note('get_current_rates')).toMatch(/upsert|cache write/i);for(const t of ['draft_marketing_content','growth_page_generate','growth_funnel_generate']){expect(note(t)).toMatch(/provider|model/i);expect(note(t)).not.toMatch(/no side effects|writes nothing/i);}expect(note('ask_choices')).toMatch(/persist|transcript/i);expect(note('generate_image')).toMatch(/Studio.*request|request.*Studio/i);expect(note('search_funding_marketplace')).toMatch(/coming.soon|scaffold/i);});
