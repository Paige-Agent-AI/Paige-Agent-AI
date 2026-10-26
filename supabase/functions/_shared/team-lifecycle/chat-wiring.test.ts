// node --test supabase/functions/_shared/team-lifecycle/chat-wiring.test.ts
// EXP08 team lifecycle — how paige-ai-chat wires PAIGE's team tools.
// EVIDENCE CLASS, stated plainly: a STRUCTURAL test over the handler's source, not a run of the
// 22,000-line Deno handler. It pins the offer, the card gates, the dispatch fences and the receipt, so
// removing or reordering one fails here. It does not replace an authenticated drive.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyAction, clampLaneByRisk } from "../action-risk.ts";

const CHAT = readFileSync(fileURLToPath(new URL("../../paige-ai-chat/index.ts", import.meta.url)), "utf8");
const between = (start: string, end: string): string => {
  const a = CHAT.indexOf(start);
  assert.ok(a >= 0, `missing anchor: ${start}`);
  const b = CHAT.indexOf(end, a + start.length);
  assert.ok(b > a, `missing end anchor: ${end}`);
  return CHAT.slice(a, b);
};
const WRITES = ["team_suspend_member", "team_reinstate_member", "team_remove_member", "team_set_conversations", "team_handover_work"];

describe("the writes are high, so no standing grant runs one alone", () => {
  for (const tool of WRITES) it(tool, () => {
    assert.equal(classifyAction(tool), "high");
    assert.equal(clampLaneByRisk("auto", tool), "confirm");
  });
  it("the reads are not classified writes", () => {
    for (const tool of ["team_list_members", "team_member_holdings"]) assert.equal(classifyAction(tool), "unclassified");
  });
});

describe("offer", () => {
  it("is offered except on a client seat or the customer portal, before the narrowing filters run", () => {
    const offer = CHAT.indexOf("if (!scopedClientId && !customerPortal) toolDefs.push(...TEAM_LIFECYCLE_TOOLS as any);");
    assert.ok(offer >= 0);
    const filter = CHAT.indexOf("CONVERSATIONAL_ADMITTED_READ_TOOLS.has", offer);
    assert.ok(filter > offer, "the conversational filter runs after the offer, so Live never sees them");
  });
  it("is never added to the conversational read set", () => {
    const set = between("const CONVERSATIONAL_ADMITTED_READ_TOOLS", ");");
    assert.ok(!/team_(list_members|member_holdings|suspend|reinstate|remove|set_conversations|handover)/.test(set));
  });
});

describe("cards: nobody is asked to approve a change to an unnamed person", () => {
  const GATE = between("// EXP08 team lifecycle — the same rule for every lifecycle write: no card for an unnamed person.", "// ── AN OMITTED FIELD MEANS");
  it("every person-write needs a named teammate before any card", () => {
    assert.match(GATE, /if \(TEAM_LIFECYCLE_MEMBER_TOOL_NAMES\.has\(tc\.function\.name\)\) \{\s*if \(!\(await describeTeamMember\(gateArgs\?\.member_user_id\)\)\) \{/);
  });
  it("the switch is settled to a boolean once, and written back", () => {
    assert.match(GATE, /const on = conversationsValue\(gateArgs\?\.on\);[\s\S]*gateArgs\.on = on;\s*tc\.function\.arguments = JSON\.stringify\(gateArgs\);/);
  });
  it("a hand-over needs a named ACTIVE receiver and open work this caller can see", () => {
    assert.match(GATE, /receiver\.status !== "active"/);
    assert.match(GATE, /!item \? "I can't see that piece of work in this workspace\."/);
    assert.match(GATE, /!item\.open \?/);
    assert.match(GATE, /readWorkItemForCard\(supabaseClient, personaCtx\?\.tenant_id \?\? null, handover\.itemId\)/);
  });
  it("the card text comes from the module, naming people from the roster read", () => {
    const CARD = between('case "team_suspend_member":\n        case "team_reinstate_member":', 'case "member_grant_role":');
    assert.match(CARD, /readHoldingsForCard\(lifecycleScope, supabaseClient, a\?\.member_user_id\)/);
    assert.match(CARD, /who: \(await describeTeamMember\(a\?\.member_user_id\)\) \?\? "that teammate"/);
    assert.match(CARD, /receiver: \(await describeTeamMember\(a\?\.assigned_to_user_id\)\)/);
  });
});

describe("dispatch: last in the chain, caller JWT, server tenant, card-only, never Live, every outcome recorded", () => {
  const BRANCH = between("} else if (TEAM_LIFECYCLE_READ_TOOL_NAMES.has(tc.function.name) || TEAM_LIFECYCLE_WRITE_TOOL_NAMES.has(tc.function.name)) {",
    "} else {\n          toolResults.push({ tool_call_id: tc.id, role: \"tool\", content: JSON.stringify({ success: false, error: `Unknown tool:");
  it("is the last branch before Unknown tool", () => {
    const at = CHAT.indexOf("} else if (TEAM_LIFECYCLE_READ_TOOL_NAMES.has(tc.function.name)");
    const unknown = CHAT.indexOf("error: `Unknown tool: ${tc.function.name}`", at);
    assert.ok(at > CHAT.indexOf("} else if (tc.function.name === PORTAL_REQUEST_SHARE_TOOL) {") && unknown > at);
    // Dispatch-chain branches open at eight spaces; the lifecycle branch's own inner `else if`s are deeper.
    assert.equal(CHAT.slice(at, unknown).split("\n        } else if (").length, 1, "no dispatch branch between this one and Unknown tool");
  });
  it("the scope is the persona tenant and the session user, never a model value", () => {
    assert.match(BRANCH, /const lifecycleScope = \{ tenantId: !scopedClientId && !customerPortal \? personaCtx\?\.tenant_id \?\? null : null, userId: user\.id \};/);
    assert.ok(!/lifecycleArgs\??\.(tenant|user|actor)/.test(BRANCH));
  });
  it("runs on the caller's client, never the service role", () => {
    assert.match(BRANCH, /TEAM_LIFECYCLE_READERS\[tc\.function\.name\]\(lifecycleScope, supabaseClient, lifecycleArgs\)/);
    assert.match(BRANCH, /runTeamLifecycleWrite\(tc\.function\.name, lifecycleScope, supabaseClient, lifecycleArgs\)/);
    assert.ok(!/(READERS\[[^\]]+\]|runTeamLifecycleWrite)\([^)]*\bsupabase\b,/.test(BRANCH));
  });
  it("checks the workspace first, then refuses Live, then refuses anything without a claimed card", () => {
    const tenant = BRANCH.indexOf("const wrongTenant = await teamSeamTenantMismatch();");
    const live = BRANCH.indexOf("} else if (liveRuntimeScope) {");
    const card = BRANCH.indexOf('} else if (approvalChannel.get(tc.id) !== "operator_card") {');
    const run = BRANCH.indexOf("await runTeamLifecycleWrite(");
    assert.ok(tenant >= 0 && live > tenant && card > live && run > card);
  });
  it("records a receipt for every write outcome and for an available read, keyed on the tool", () => {
    assert.match(BRANCH, /if \(!lifecycleRead \|\| lifecycleResult\?\.status === "available"\) \{\s*await recordCapabilityRun\(supabase, \{ tenantId: lifecycleScope\.tenantId, actorId: user\.id, capabilityKey: tc\.function\.name,/);
    assert.match(BRANCH, /lifecycleResult\?\.outcome_unknown === true \? "capability_outcome_unknown" : "capability_refused"/);
  });
});

describe("the write trail", () => {
  it("names the membership or work row the definer answered about", () => {
    assert.match(CHAT, /team_suspend_member: "tenant_members", team_reinstate_member: "tenant_members", team_remove_member: "tenant_members",\s*team_set_conversations: "tenant_members", team_handover_work: "plan_items",/);
    assert.match(CHAT, /if \(tool && \["team_suspend_member", "team_reinstate_member", "team_remove_member", "team_set_conversations", "team_handover_work"\]\.includes\(tool\)\) return out\?\.success === true && out\?\.record_locator\?\.table === WRITE_TARGET\[tool\]/);
  });
  it("labels every write for the turned-off refusal", () => {
    for (const tool of WRITES) assert.match(CHAT, new RegExp(`\\n      ${tool}: "`));
  });
});
