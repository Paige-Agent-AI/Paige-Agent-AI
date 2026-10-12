import { describe, it, expect } from "vitest";
import { C0B_CLIENT_WRITE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/domains/c0b_client_writes.ts";
import { projectCapabilities } from "../../supabase/functions/_shared/paige-capability-status/projection.ts";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
const pins = [
 ["author_event_kind", "public.upsert_tenant_event_kind", "member"],
 ["crm_add_note", "edge.paige-ai-chat", "workspace-admin"],
 ["crm_file_document", "edge.paige-ai-chat", "workspace-admin"],
 ["update_client_data", "edge.paige-write-back", "member"],
 ["pipeline_configure", "public.configure_tenant_pipeline_as_paige", "workspace-admin"],
] as const;
describe("incumbent client-write declarations retain their existing authority", () => {
 for (const [tool, executor, seat] of pins) it(tool, () => {
  const c = C0B_CLIENT_WRITE_CAPABILITIES.find(x => x.action.chatTool === tool);
  expect(c).toBeDefined();
  expect(c?.action).toMatchObject({ executor, seatAuthority:seat, classification:"mutate", riskPolicyKey:classifyAction(tool), approvalAuthority:"chat-canonical" });
  expect(c).toMatchObject({selfDescribe:true,readiness:"none",chatBinding:"LIVE",mindBinding:"UNAVAILABLE",maturity:"PARTIAL",sharedPrimitiveChange:"NONE"});
  expect(c?.action.idempotency).toContain("No blind retry");
 });
});for (const admin of [false,true]) for (const lane of ["confirm","auto","off"] as const) it(`frozen discovery parity ${admin}/${lane}`,()=>{
 const tools=pins.map(([name])=>({name,description:`Use ${name}.`}));
 const common={tools,isMutating:()=>true,lanes:new Map(pins.map(([tool])=>[tool,lane])),workspaceAdminTools:new Set(pins.filter(x=>x[2]==="workspace-admin").map(x=>x[0])),isWorkspaceAdmin:admin,readiness:new Map()};
 const legacy=Object.fromEntries(pins.map(([tool,,seat])=>[tool,{domain:tool==="pipeline_configure"?"sales":"crm_clients",effect:"mutate" as const,selfDescribe:true,readiness:"none" as const,workspaceAdmin:seat==="workspace-admin"}]));
 const before=projectCapabilities({...common,spine:[],legacy});
 const after=projectCapabilities({...common,spine:C0B_CLIENT_WRITE_CAPABILITIES,legacy:{}});
 const facts=(rows:typeof before)=>rows.map(({key:_key,source:_source,...r})=>r);
 expect(facts(after)).toEqual(facts(before));
});