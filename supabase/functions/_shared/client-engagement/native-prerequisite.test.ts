// Compatibility of the unmounted native prerequisite with the incumbent consumers.
// These are source contract tests, never authenticated customer acceptance.
import { it } from "node:test";
import assert from "node:assert/strict";
import { effectiveAgentTools, PINNED_READ_TOOL, EXECUTABLE_AGENT_TOOLS } from "../team-hub/agent-turn.ts";
import { searchTeamHub, type TeamHubCaller } from "../team-hub/chat.ts";

it("stored commercial read names alone do not enter the incumbent executable set", () => {
  const stored = [PINNED_READ_TOOL, "agreement_list", "agreement_status", "read_client_engagement_status"];
  assert.deepEqual(effectiveAgentTools(stored, "agent_dm"), [PINNED_READ_TOOL]);
  // Causal control: an explicit server runnable-set change is detectable by this oracle.
  assert.notDeepEqual(effectiveAgentTools(stored, "agent_dm",
    new Set([...EXECUTABLE_AGENT_TOOLS, "read_client_engagement_status"])), [PINNED_READ_TOOL]);
});

it("the native additive false search tag preserves the incumbent legacy-row projection", async () => {
  const scope = { tenantId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222" };
  const row = { message_id: "33333333-3333-4333-8333-333333333333",
    conversation_id: "44444444-4444-4444-8444-444444444444", conversation_kind: "channel",
    conversation_label: "delivery", author_name: "Test Teammate", created_at: "2026-10-24T11:00:00Z",
    thread_root_id: null, snippet: "Review the original project notes." };
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const caller = (result: unknown): TeamHubCaller => ({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: { ok: true, results: [result] }, error: null };
  } });
  const original = await searchTeamHub(scope, caller(row), { query: "project" });
  const additive = await searchTeamHub(scope, caller({ ...row, source_backed_read: false }), { query: "project" });
  assert.equal(original.envelope.status, "available");
  assert.equal(original.carriesContent, true);
  assert.deepEqual(additive, original);
  assert.deepEqual(calls, [0, 1].map(() => ({ name: "team_hub_search",
    args: { p_expected_tenant: scope.tenantId, p_query: "project", p_limit: 10 } })));
  const changed = await searchTeamHub(scope, caller({ ...row, snippet: "Changed original facts." }), { query: "project" });
  assert.notDeepEqual(changed, original, "the equivalence check detects changed source text");
});
