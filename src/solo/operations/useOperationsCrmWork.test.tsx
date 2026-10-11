import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOperationsCrmWork } from "./useOperationsCrmWork";
const ports=vi.hoisted(()=>({actor:"actor-a",rpc:vi.fn(),getUser:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:ports.rpc,auth:{getUser:ports.getUser}}}));
let root:Root;let host:HTMLDivElement;let current:ReturnType<typeof useOperationsCrmWork>;
function Probe({actor,tenant}:{actor:string;tenant:string}){current=useOperationsCrmWork(actor,tenant);return <p>{current.tasks.map(row=>row.title).join(";")}</p>}
const payload=(actor:string,tenant:string,title:string)=>({ok:true,actor_id:actor,tenant_id:tenant,has_more:false,tasks:[{id:"native-task",tenant_id:tenant,user_id:actor,title,description:null,status:"pending",due_date:null,created_at:null,updated_at:null,deal_id:null,biz_id:null,recorded_priority:null,estimated_minutes:null}]});
async function render(actor="actor-a",tenant="tenant-a"){
 if(!host){host=document.createElement("div");document.body.appendChild(host);root=createRoot(host)}
 await act(async()=>{root.render(<Probe actor={actor} tenant={tenant}/>)});
}
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();host=undefined as unknown as HTMLDivElement;vi.clearAllMocks();ports.actor="actor-a"});
describe("native CRM work request boundary",()=>{
 function auth(){ports.getUser.mockImplementation(async()=>({data:{user:{id:ports.actor}},error:null}))}
 it("never reads when authenticated identity differs from the requested actor",async()=>{
   auth();ports.actor="other-actor";await render();expect(ports.rpc).not.toHaveBeenCalled();expect(current.forbidden).toBe(true);expect(current.tasks).toEqual([]);
 });
 it("masks old work on scope switch and ignores late original responses",async()=>{
   auth();let resolveA!:(v:unknown)=>void;
   ports.rpc.mockImplementation((_name:string,args:Record<string,unknown>)=>args.p_expected_tenant_id==="tenant-a"?new Promise(resolve=>{resolveA=resolve}):Promise.resolve({data:payload("actor-b","tenant-b","B work"),error:null}));
   await render();expect(ports.rpc).toHaveBeenCalledWith("operations_crm_work_read",{p_expected_actor_id:"actor-a",p_expected_tenant_id:"tenant-a"});
   ports.actor="actor-b";await render("actor-b","tenant-b");expect(host.textContent).toBe("B work");
   await act(async()=>{resolveA({data:payload("actor-a","tenant-a","Private A work"),error:null})});
   expect(host.textContent).toBe("B work");expect(current.tasks[0].tenant_id).toBe("tenant-b");
 });
 it("does not turn a refused refresh into empty-source success",async()=>{
   auth();ports.rpc.mockResolvedValueOnce({data:payload("actor-a","tenant-a","A work"),error:null});await render();expect(current.tasks).toHaveLength(1);
   ports.rpc.mockResolvedValueOnce({data:null,error:{code:"42501",message:"denied"}});
   await act(async()=>{await current.refresh()});expect(current.tasks).toEqual([]);expect(current.forbidden).toBe(true);expect(current.error).toBeTruthy();
 });
});
