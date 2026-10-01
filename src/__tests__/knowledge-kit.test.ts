import { expect, it } from "vitest";
import * as knowledge from "../../supabase/functions/_shared/paige-spine/domains/knowledge";
import { isDefinedCapability } from "../../supabase/functions/_shared/capability-kit/mod";
import { PAIGE_SPINE_CAPABILITIES } from "../../supabase/functions/_shared/paige-spine/registry";
import { executeKnowledgeTool } from "../../supabase/functions/_shared/knowledge-tenant-brain";
it("constructs branded read and mutation contracts without changing risk", () => {
 const definitions = knowledge.KNOWLEDGE_KIT_CAPABILITIES;
 expect(definitions).toHaveLength(3);
 expect(definitions.every(isDefinedCapability)).toBe(true);
 expect(definitions.map(c => [c.effect,c.governance.actionRiskKey,c.governance.risk,c.governance.approval])).toEqual([
  ["read",null,"read_only","none"],["mutation","knowledge_update","ordinary","confirm"],["mutation","knowledge_delete","high","confirm"]]);
});
it("preserves the existing first Spine entry", () => { expect(PAIGE_SPINE_CAPABILITIES[0].key).toBe("pipeline.deal_stage_evidence"); });
it("local validation is proven not applied without impersonating the confirmation gate", async () => {
 let calls=0; const caller={rpc:async()=>{calls++;return {data:null,error:null};}};
 for(const args of [{document_id:"bad"},{}]) {
  const result=await executeKnowledgeTool({caller,expectedTenantId:null,tool:"knowledge_delete",args});
  expect(result.not_applied).toBe(true); expect(result).not.toHaveProperty("refused_before_run");
 }
 expect(calls).toBe(0);
});
