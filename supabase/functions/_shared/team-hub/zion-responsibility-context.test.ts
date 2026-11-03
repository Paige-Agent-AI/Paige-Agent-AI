// Source-guidance regression for the actual O01 QA failure. This is bounded
// prompt proof, not evidence that a real model chose/read the three sources.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAgentSystemPrompt } from "./agent-turn.ts";

const tools = ["crm_list_tasks", "crm_get_task", "crm_list_team", "plan_list", "read_calendar_agenda"];
const input = { agent: "zion" as const, tenantName: "Northstar Studio", askerName: "Sam", privateFollowUp: false,
  personality: null, tools, privateRoute: false };
const dm = { kind: "agent_dm" as const, visibility: "private" as const, label: "ZION" };

describe("ZION responsibility review source guidance", () => {
  it("describes the offered saved Calendar without claiming a connected provider", () => {
    const prompt = buildAgentSystemPrompt({ ...input, where: dm });
    assert.match(prompt, /saved Calendar appointments.*read_calendar_agenda/);
    assert.match(prompt, /not.*provider.*synchron/i);
  });
  it("reserves the existing three reads for the requested responsibility sources before optional drilldowns", () => {
    const prompt = buildAgentSystemPrompt({ ...input, where: dm });
    assert.match(prompt, /three private reads/);
    assert.match(prompt, /crm_list_tasks.*plan_list.*read_calendar_agenda.*before.*crm_list_team.*crm_get_task/);
    assert.match(prompt, /unresolved.*owner|owner.*unknown/i);
  });
  it("keeps original-record navigation outside model knowledge instead of denying rendered links", () => {
    const prompt = buildAgentSystemPrompt({ ...input, where: dm });
    assert.match(prompt, /Do not comment on the presence or absence of record links/);
  });
  it("does not promise Calendar or the private review in a shared channel", () => {
    const prompt = buildAgentSystemPrompt({ ...input, where: { kind: "channel", visibility: "team", label: "general" } });
    assert.doesNotMatch(prompt, /saved Calendar appointments|three private reads/);
  });
  it("does not promise a missing or unoffered source", () => {
    const prompt = buildAgentSystemPrompt({ ...input, where: dm, tools: ["crm_list_tasks", "plan_list"] });
    assert.doesNotMatch(prompt, /saved Calendar appointments|three private reads/);
  });
  it("leaves the same source instruction out of other specialists' personalities", () => {
    const prompt = buildAgentSystemPrompt({ ...input, agent: "nexus", where: dm });
    assert.doesNotMatch(prompt, /three private reads|saved Calendar appointments|ORIGINAL RECORD NAVIGATION/);
    const mentor = buildAgentSystemPrompt({ ...input, agent: "mentor", where: dm, tools: ["plan_list"] });
    assert.doesNotMatch(mentor, /three private reads|ORIGINAL RECORD NAVIGATION/);
  });
  it("binds only the server-provided requester's ID to their known name", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const prompt = buildAgentSystemPrompt({ ...input, where: dm, askerUserId: id });
    assert.ok(prompt.includes(`Sam's verified user id is ${id}`));
    assert.match(prompt, /only where an original returned user_id or assigned_to_user_id exactly matches/);
    assert.match(prompt, /Never infer another person's name from an id/);
  });
  it("keeps the private requester reference out of channels and other specialists", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    for (const options of [{ ...input, where: { kind: "channel" as const, visibility: "team" as const, label: "general" } },
      { ...input, agent: "nexus" as const, where: dm }]) {
      assert.ok(!buildAgentSystemPrompt({ ...options, askerUserId: id }).includes(id));
    }
  });
  it("does not interpolate a malformed requester reference", () => {
    const prompt = buildAgentSystemPrompt({ ...input, where: dm, askerUserId: "not-an-actor-id" });
    assert.doesNotMatch(prompt, /not-an-actor-id|CURRENT REQUESTER REFERENCE/);
  });
});
