
import {act} from "react";import {createRoot,type Root} from "react-dom/client";import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {ClientPortalFrameProvider} from "@/hooks/useClientPortalFrame";
import {CustomerIdentityProvider,useCustomerIdentity,type CustomerIdentity} from "./customerIdentity";
const native=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:native.rpc,auth:{}}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const actor="e0917800-0000-4000-8000-000000000001",tenant="e0927800-0000-4000-8000-000000000001",contact="e0937800-0000-4000-8000-000000000001";
const frame={actorId:actor,profile:{id:contact,tenant_id:tenant,linked_user_id:actor,first_name:"Test",last_name:"Customer"},brand:{tenant_name:"Test Practice"},config:{}} as never;
let root:Root,host:HTMLDivElement,identity:CustomerIdentity;
function Probe(){identity=useCustomerIdentity();return null;}
beforeEach(()=>{vi.clearAllMocks();host=document.createElement("div");document.body.append(host);root=createRoot(host);});afterEach(()=>{act(()=>root.unmount());host.remove();});
it("uses the same original gate checking and retry without issuing another frame read",async()=>{
 const reload=vi.fn();await act(async()=>root.render(<ClientPortalFrameProvider value={{actorId:actor,value:{frame,checking:true,reload}} as never}><CustomerIdentityProvider state={{frame,phase:"ready"}}><Probe/></CustomerIdentityProvider></ClientPortalFrameProvider>));
 expect(identity.checking).toBe(true);expect(identity.retryAccess).toBe(reload);expect(identity.viewer).toBe("customer");expect(identity.agentName).toBe("Cura");await identity.retryAccess?.();expect(reload).toHaveBeenCalledOnce();expect(native.rpc).not.toHaveBeenCalled();
});
it.each(["actor","business","client"])("a mismatched original gate %s supplies neither a borrowed check nor retry",async mismatch=>{
 const foreign={...frame as object,actorId:mismatch==="actor"?"other-actor":actor,profile:{id:mismatch==="client"?"other-client":contact,tenant_id:mismatch==="business"?"other-business":tenant}} as never;const reload=vi.fn();
 await act(async()=>root.render(<ClientPortalFrameProvider value={{actorId:mismatch==="actor"?"other-actor":actor,value:{frame:foreign,checking:true,reload}} as never}><CustomerIdentityProvider state={{frame,phase:"ready"}}><Probe/></CustomerIdentityProvider></ClientPortalFrameProvider>));
 expect(identity.checking).toBe(false);expect(identity.retryAccess).toBeUndefined();expect(native.rpc).not.toHaveBeenCalled();
});
it("standalone identity retains its ordinary behavior and can accept the host's original retry",async()=>{
 const retry=vi.fn();await act(async()=>root.render(<CustomerIdentityProvider state={{frame,phase:"ready",accessChecking:true,retryAccess:retry}}><Probe/></CustomerIdentityProvider>));expect(identity.checking).toBe(true);await identity.retryAccess?.();expect(retry).toHaveBeenCalledOnce();expect(native.rpc).not.toHaveBeenCalled();
});

it.each([false,true])("a partial standalone presentation never borrows an absent or unbound gate (%s)",async present=>{
 const incomplete={profile:{},brand:{tenant_name:"Test Practice"},config:{}} as never;const reload=vi.fn();
 const view=<CustomerIdentityProvider state={{frame:incomplete,phase:"ready"}}><Probe/></CustomerIdentityProvider>;
 await act(async()=>root.render(present?<ClientPortalFrameProvider value={{actorId:undefined,value:{frame:incomplete,checking:true,reload}} as never}>{view}</ClientPortalFrameProvider>:view));
 expect(identity.retryAccess).toBeUndefined();expect(identity.checking).toBe(false);expect(native.rpc).not.toHaveBeenCalled();
});

it("host presentation cannot suppress the original matching gate hold or replace its retry",async()=>{
 const original=vi.fn(),alternate=vi.fn();await act(async()=>root.render(<ClientPortalFrameProvider value={{actorId:actor,value:{frame,checking:true,reload:original}} as never}><CustomerIdentityProvider state={{frame,phase:"ready",accessChecking:false,retryAccess:alternate}}><Probe/></CustomerIdentityProvider></ClientPortalFrameProvider>));
 expect(identity.checking).toBe(true);await identity.retryAccess?.();expect(original).toHaveBeenCalledOnce();expect(alternate).not.toHaveBeenCalled();expect(native.rpc).not.toHaveBeenCalled();
});
