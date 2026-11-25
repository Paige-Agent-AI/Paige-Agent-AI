import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { McpSessionsPanel } from './McpSessionsPanel';
const ports=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),update:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:ports}));
vi.mock('sonner',()=>({toast:{success:ports.success,error:ports.error}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const id='11111111-1111-4111-8111-111111111111';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{
 ports.rpc.mockReset();ports.from.mockReset();ports.update.mockReset();ports.success.mockReset();ports.error.mockReset();
 ports.rpc.mockResolvedValue({data:true,error:null});
 ports.from.mockReturnValue({select:()=>({order:()=>({limit:async()=>({data:[{id,client_id:'unit',client_name_cache:'Unit App',scopes:['crm.read'],access_expires_at:new Date().toISOString(),refresh_expires_at:null,created_at:new Date().toISOString(),revoked_at:null,last_used_at:null}],error:null})})}),update:ports.update});
 ports.update.mockReturnValue({eq:()=>({select:()=>({maybeSingle:async()=>({data:{id},error:null})})})});
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();});
async function revoke(){await act(async()=>root.render(<McpSessionsPanel/>));const button=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes('Revoke'));expect(button).toBeDefined();await act(async()=>button!.click());}
describe('original Settings revocation uses the native grant writer',()=>{
 it('reports success only after the native session revoke commits',async()=>{await revoke();expect(ports.rpc).toHaveBeenCalledWith('revoke_paige_mcp_oauth_session',{p_id:id});expect(ports.update).not.toHaveBeenCalled();expect(ports.success).toHaveBeenCalledWith('Session revoked');});
 it.each([{data:false,error:null},{data:null,error:{code:'42501',message:'Permission denied'}},{data:null,error:{code:'57014',message:'Temporarily unavailable'}}])('does not use the old writer on refusal or an actual native failure',async result=>{ports.rpc.mockResolvedValue(result);await revoke();expect(ports.update).not.toHaveBeenCalled();expect(ports.success).not.toHaveBeenCalled();expect(ports.error).toHaveBeenCalled();});
 it('supports the actual pre-migration web deployment only when the RPC is absent',async()=>{ports.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'Could not find the function'}});await revoke();expect(ports.update).toHaveBeenCalled();expect(ports.success).toHaveBeenCalledWith('Session revoked');});
 it('does not claim a missing legacy row was revoked',async()=>{ports.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'Could not find the function'}});ports.update.mockReturnValue({eq:()=>({select:()=>({maybeSingle:async()=>({data:null,error:null})})})});await revoke();expect(ports.success).not.toHaveBeenCalled();expect(ports.error).toHaveBeenCalled();});
});
