import {act} from "react";
import {createRoot} from "react-dom/client";
import {describe, expect, it, vi} from "vitest";
const ports=vi.hoisted(()=>({invoke:vi.fn(),from:vi.fn(),rpc:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{functions:{invoke:ports.invoke},from:ports.from,rpc:ports.rpc}}));
vi.mock("@tanstack/react-query",()=>({useQuery:()=>({data:[],isFetched:true}),useMutation:()=>({mutate:vi.fn(),mutateAsync:vi.fn()}),useQueryClient:()=>({invalidateQueries:vi.fn()})}));
import {readRecoveredPaigeApproval,usePaigeThreads,type UsePaigeThreads} from "./usePaigeThreads";

globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const scope={threadId:"00000000-0000-4000-8000-000000000003",turnId:"00000000-0000-4000-8000-000000000005",intentId:"00000000-0000-4000-8000-000000000004",tenantId:"00000000-0000-4000-8000-000000000002"};
const card={tool:"crm_create_task",summary:"Create fixture work",fingerprint:"1234567890abcdef",command:{action:"task.create",patch:{title:"Fixture work"}},idempotency_key:"native-key"};
const projection=()=>({v:1,status:"available",thread_id:scope.threadId,turn_id:scope.turnId,intent_id:scope.intentId,tenant_id:scope.tenantId,expires_at:new Date(Date.now()+300000).toISOString(),confirmations:[card]});

describe("server-issued approval projection client boundary",()=>{
  it("accepts the exact current server response",()=>{expect(readRecoveredPaigeApproval(projection(),scope)?.confirmations).toEqual([card]);});
  it.each(["thread_id","turn_id","intent_id","tenant_id"])("rejects a different %s",field=>{expect(readRecoveredPaigeApproval({...projection(),[field]:"foreign"},scope)).toBeNull();});
  it.each([null,{}, {v:1,status:"unavailable"}, {bundle_ref:{paige_confirm:[card]}}])("never promotes history or unavailable JSON %j",raw=>{expect(readRecoveredPaigeApproval(raw,scope)).toBeNull();});
  it.each([
    {v:2}, {expires_at:new Date(0).toISOString()}, {expires_at:"invalid"},
    {confirmations:[card,card]}, {confirmations:[{...card,fingerprint:"bad"}]},
    {confirmations:[{...card,command:null}]}, {confirmations:[{...card,idempotency_key:""}]},
  ])("rejects stale or malformed projections %j",change=>{expect(readRecoveredPaigeApproval({...projection(),...change},scope)).toBeNull();});
  it("uses only the authenticated status read, with no confirmation or writer call",async()=>{
    ports.invoke.mockReset().mockResolvedValue({data:{approval_recovery:projection()},error:null});ports.from.mockClear();ports.rpc.mockClear();
    let api:UsePaigeThreads|null=null;
    const Probe=()=>{api=usePaigeThreads({callerUserId:"00000000-0000-4000-8000-000000000001",tenantId:scope.tenantId});return null;};
    const host=document.createElement("div");const root=createRoot(host);
    try{
      await act(async()=>root.render(<Probe/>));
      const restored=await api!.loadApprovalRecovery(scope.threadId,scope.turnId,scope.intentId);
      expect(restored?.confirmations).toEqual([card]);
      expect(ports.invoke).toHaveBeenCalledExactlyOnceWith("paige-ai-chat",{body:{messages:[{role:"user",content:"Read pending approval status."}],threadId:scope.threadId,requestIntentId:scope.intentId,interactive:{kind:"status",approvalTurnId:scope.turnId}}});
      expect(ports.from).not.toHaveBeenCalled();expect(ports.rpc).not.toHaveBeenCalled();
    }finally{await act(async()=>root.unmount());}
  });
});
