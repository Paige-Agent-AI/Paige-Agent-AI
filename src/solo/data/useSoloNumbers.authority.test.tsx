import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSoloNumbers, type SoloNumbersData } from "./useSoloNumbers";

const state=vi.hoisted(()=>({activeTenantId:"tenant-a" as string|null,throwRole:false,admin:false as unknown,owner:false as unknown,adminError:null as unknown,ownerError:null as unknown,roleHook:vi.fn(),reads:[] as string[]}));
vi.mock("@/hooks/useTenantContext",()=>({useTenantContext:()=>({activeTenantId:state.activeTenantId,loading:false})}));
vi.mock("@/hooks/useUserRoles",()=>({useUserRoles:()=>{state.roleHook();return{isStaff:true};}}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{
  rpc:async(name:string)=>{state.reads.push(name);if(name==="is_current_user_tenant_admin"&&state.throwRole)throw new Error("synthetic unavailable");return name==="current_user_tenant_id"?{data:"tenant-a",error:null}:name==="is_current_user_tenant_admin"?{data:state.admin,error:state.adminError}:{data:state.owner,error:state.ownerError};},
  from:()=>({select:()=>({eq:()=>({order:async()=>({data:[],error:null})})})}),
}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement,latest:SoloNumbersData;
function Projection(){const data=useSoloNumbers();latest=data;return <output>{data.loading?"loading":String(data.canManage)}</output>;}
async function mount(){await act(async()=>{root.render(<Projection/>);for(let i=0;i<12;i++)await Promise.resolve();await new Promise(resolve=>setTimeout(resolve,0));});}
beforeEach(()=>{host=document.createElement("div");document.body.append(host);root=createRoot(host);state.activeTenantId="tenant-a";state.throwRole=false;state.admin=false;state.owner=false;state.adminError=null;state.ownerError=null;state.reads=[];state.roleHook.mockClear();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
describe("original SOLO calling authority projection",()=>{
  it("retires previous management authority when a role refresh throws",async()=>{
    state.admin=true;await mount();expect(host.textContent).toBe("true");state.throwRole=true;
    await act(async()=>{latest.refresh();for(let i=0;i<12;i++)await Promise.resolve();await new Promise(resolve=>setTimeout(resolve,0));});
    expect(host.textContent).toBe("false");
  });
  it("retires previous management authority when there is no active account",async()=>{
    state.admin=true;await mount();expect(host.textContent).toBe("true");state.activeTenantId=null;await mount();expect(host.textContent).toBe("false");
  });
  it.each([
    ["current owner/admin",true,false,null,null,true],
    ["ordinary member despite global staff flag",false,false,null,null,false],
    ["original explicit platform owner",false,true,null,null,true],
    ["malformed tenant role", "true",false,null,null,false],
    ["malformed operator role",false,"true",null,null,false],
    ["tenant role read failed",true,false,{message:"unavailable"},null,false],
    ["operator read failed",true,true,null,{message:"unavailable"},false],
    ["explicit operator does not need tenant-admin result",false,true,{message:"unavailable"},null,true],
  ])("%s",async(_name,admin,owner,adminError,ownerError,allowed)=>{
    state.admin=admin;state.owner=owner;state.adminError=adminError;state.ownerError=ownerError;await mount();
    expect(host.textContent).toBe(String(allowed));expect(state.roleHook).not.toHaveBeenCalled();
    expect(state.reads).toContain("is_current_user_tenant_admin");expect(state.reads).toContain("is_platform_owner");
  });
});
