import{expect,it}from'vitest';
import{getSpineCapability}from'../../supabase/functions/_shared/paige-spine/registry';
import*as domain from'../../supabase/functions/_shared/paige-spine/domains/client_portal';
import{classifyAction,clampLaneByRisk,mutatingTools}from'../../supabase/functions/_shared/action-risk';
const key='client.portal_request_share',tool='client_portal_request_share';
it('uses the sole client registry and the existing native publisher',()=>{
 expect(getSpineCapability(key)).toMatchObject({key,domain:'client',owner:'clients',action:{chatTool:tool,executor:'public.share_client_portal_request',classification:'mutate',approvalAuthority:'chat-canonical',riskPolicyKey:'high'}});
});
it('is explicitly classified as a governed mutation rather than relying on the verb heuristic',()=>{expect(classifyAction(tool)).toBe('high');expect(mutatingTools().has(tool)).toBe(true);});
it.each([['auto','confirm'],['confirm','confirm'],['off','off']]as const)('keeps the existing risk clamp for %s', (requested,expected)=>{expect(clampLaneByRisk(requested,tool)).toBe(expected);});
it('takes only source identities, never model-authored recipients, approval, wording or tenant',()=>{
 const exported=domain as unknown as{PORTAL_REQUEST_SHARE_CAPABILITY?:{input:{properties:Record<string,unknown>;required:readonly string[];additionalProperties:boolean}};PORTAL_REQUEST_SHARE_TOOLS?:Array<{function:{parameters:{properties:Record<string,unknown>}}}>};
 const declaration=exported.PORTAL_REQUEST_SHARE_CAPABILITY;expect(declaration).toBeDefined();if(!declaration)throw Error('Missing domain declaration');
 expect(Object.keys(declaration.input.properties).sort()).toEqual(['contact_id','work_id']);expect([...declaration.input.required].sort()).toEqual(['contact_id','work_id']);expect(declaration.input.additionalProperties).toBe(false);expect(Object.isFrozen(declaration.input)).toBe(true);
 const schema=exported.PORTAL_REQUEST_SHARE_TOOLS?.[0].function.parameters;expect(schema).toBeDefined();expect(schema).not.toBe(declaration.input);
});
it('retains partial maturity without claiming a completed Portal or model binding',()=>{expect(getSpineCapability(key)).toMatchObject({maturity:'PARTIAL',mindBinding:'UNAVAILABLE',sharedPrimitiveChange:'NONE'});});
