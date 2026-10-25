// node --test supabase/functions/_shared/team-hub/chat-wiring.test.ts
// EXP08 Team Hub increment 4 — how paige-ai-chat wires the Team Hub tools (contract sections 1, 3, 5).
// EVIDENCE CLASS, stated plainly: this is a STRUCTURAL test over the handler's source, not a run of
// the 21,000-line Deno handler. It pins the orderings and guards the runtime relies on, so removing
// or reordering one fails here; it does not replace the authenticated drive the contract owes (§8).
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
const SUMMARY = between("// === SESSION SUMMARY GENERATION MODE ===", "\n    // === ");

describe("a Team Hub session writes no machine-derived memory (contract section 5)", () => {
  it("the withheld flag starts shut and is the first thing every summary write checks", () => {
    const decl = SUMMARY.indexOf("let summaryTeamHubWithheld = true;");
    const writer = SUMMARY.indexOf("const writeSummaryMemory = async");
    assert.ok(decl >= 0 && writer > decl);
    const body = SUMMARY.slice(writer, SUMMARY.indexOf("};", writer));
    assert.match(body, /^const writeSummaryMemory = async \(label: string, write: \(\) => PromiseLike<unknown>\): Promise<void> => \{\s*if \(summaryTeamHubWithheld\) return;/);
  });
  it("the server-recorded check runs before any model call or write, and returns when tainted", () => {
    const check = SUMMARY.indexOf("summaryTeamHubWithheld = await withinSummary(teamHubSessionTainted(supabase, summaryActorId,");
    const stop = SUMMARY.indexOf("if (summaryTeamHubWithheld) {\n        return new Response(", check);
    const model = SUMMARY.indexOf('completeSummary("session_summary"');
    const firstWrite = SUMMARY.indexOf("await writeSummaryMemory(");
    assert.ok(check >= 0, "taint check present");
    assert.ok(stop > check, "tainted summary returns");
    assert.ok(model > stop && firstWrite > stop, "no model call or memory write before the check");
    assert.match(SUMMARY.slice(check, stop), /\[summaryTenantId, summaryCallerTenantId\], TEAM_HUB_CHAT_TOOL_NAMES, TEAM_HUB_POST_TOOL_NAME\)\)\.catch\(\(\) => true\);/);
    assert.match(SUMMARY.slice(stop, model), /memory_write_status: "not_attempted"/);
  });
  it("every memory write in summary mode goes through the guarded writer", () => {
    const sinks = SUMMARY.split("\n").filter((l) => /record_paige_memory"|from\("client_memory"\)\.insert/.test(l));
    assert.ok(sinks.length >= 6, `expected the summary, milestone and fact sinks, saw ${sinks.length}`);
    for (const line of sinks) assert.match(line, /await writeSummaryMemory\(/, line.trim());
  });
  it("outside summary mode the only machine-written owner memory is the explicit-signal preference and the document report", () => {
    const outside = CHAT.replace(SUMMARY, "");
    const types = [...outside.matchAll(/rpc\("record_paige_memory", \{\s*p_memory_type: "([a-z_]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(types, ["preference", "report_upload"]);
  });
});

describe("reads run on the asker's session with the server's tenant, and the marker comes first", () => {
  const READ = between("} else if (TEAM_HUB_READ_TOOL_NAMES.has(tc.function.name)) {", "} else if (tc.function.name === TEAM_HUB_POST_TOOL_NAME) {");
  it("caller JWT and the persona tenant, never a model value", () => {
    assert.match(READ, /const hubTenant = callerTier === "tenant" && !scopedClientId && !customerPortal \? personaCtx\?\.tenant_id \?\? null : null;/);
    assert.match(READ, /TEAM_HUB_READERS\[tc\.function\.name\]\(\{ tenantId: hubTenant, userId: user\.id \}, supabaseClient, hubArgs\)/);
    assert.ok(!/hubArgs\??\.(tenant|user|actor)/.test(READ));
    assert.ok(!/TEAM_HUB_READERS\[[^\]]+\]\([^)]*\bsupabase\b,/.test(READ), "never the service-role client");
  });
  it("records the receipt before the content is pushed, and withholds content it could not mark", () => {
    const record = READ.indexOf("recorded = await recordCapabilityRun(supabase, {");
    const withhold = READ.indexOf("if (!recorded && read.carriesContent) {");
    const push = READ.indexOf("toolResults.push({ tool_call_id: tc.id, role: \"tool\", content: JSON.stringify(hubEnvelope) });");
    assert.ok(record >= 0 && withhold > record && push > withhold);
    assert.match(READ.slice(withhold, push), /hubEnvelope = \{ status: "unavailable"/);
    assert.match(READ.slice(record, withhold), /capabilityKey: tc\.function\.name/);
  });
});

describe("a reply is posted only from its approved card, never from Live", () => {
  const POST = between("} else if (tc.function.name === TEAM_HUB_POST_TOOL_NAME) {", "} else {\n          toolResults.push({ tool_call_id: tc.id, role: \"tool\", content: JSON.stringify({ success: false, error: `Unknown tool:");
  it("is high risk, so no standing grant can run it unattended", () => {
    assert.equal(classifyAction("team_hub_post_reply"), "high");
    assert.equal(clampLaneByRisk("auto", "team_hub_post_reply"), "confirm");
  });
  it("spends only a claimed operator card's token, and refuses on Live before calling the definer", () => {
    assert.match(POST, /const hubToken = approvalChannel\.get\(tc\.id\) === "operator_card"\s*\? \[\.\.\.approvalSpend\]\.find\(\(\[, callId\]\) => callId === tc\.id\)\?\.\[0\] \?\? null : null;/);
    assert.match(POST, /posted = liveRuntimeScope\s*\? \{ success: false, not_applied: true, reason: "live"/);
    assert.match(POST, /: await postTeamHubReply\(\{ tenantId: hubTenant, userId: user\.id \}, supabaseClient, hubArgs, hubToken\);/);
  });
  it("a Live turn can never carry an approval (the request is refused before any tool runs)", () => {
    const live = between("if (validatedData.liveRuntimeChallenge) {", "liveRuntimeScope = scope;");
    assert.match(live, /validatedData\.approvedConfirmations\?\.length \|\| validatedData\.declinedConfirmations\?\.length/);
    assert.match(live, /\) return refuseLive\(\);/);
  });
});

describe("offer and degraded mode", () => {
  it("offers the tools on the tenant tier of a canonical SOLO account only, never a client seat or the customer portal", () => {
    for (const symbol of ["TEAM_HUB_READ_TOOLS", "TEAM_HUB_POST_TOOLS"]) {
      const lines = CHAT.split("\n").filter((l) => l.includes(`toolDefs.push(...${symbol}`));
      assert.equal(lines.length, 1, symbol);
      assert.match(lines[0], /^\s*if \(callerTier === "tenant" && calendarBookingAccountShape === "solo" && !scopedClientId && !customerPortal\) toolDefs\.push/);
    }
  });
  it("admits the three reads to conversational mode and withholds the reply", () => {
    const line = CHAT.split("\n").find((l) => l.startsWith("const CONVERSATIONAL_ADMITTED_READ_TOOLS"))!;
    for (const tool of ["team_hub_conversations", "team_hub_read_conversation", "team_hub_search"]) assert.ok(line.includes(`"${tool}"`), tool);
    assert.ok(!line.includes("team_hub_post_reply"));
  });
});

describe("Team Hub text is never traced as text (contract section 5; a trace is readable workspace-wide)", () => {
  const READ = between("} else if (TEAM_HUB_READ_TOOL_NAMES.has(tc.function.name)) {", "} else if (tc.function.name === TEAM_HUB_POST_TOOL_NAME) {");
  const POST = between("} else if (tc.function.name === TEAM_HUB_POST_TOOL_NAME) {", "} else {\n          toolResults.push({ tool_call_id: tc.id, role: \"tool\", content: JSON.stringify({ success: false, error: `Unknown tool:");
  it("a read that carries content switches the turn to metadata-only tracing before the content is pushed", () => {
    const set = READ.indexOf('if (read.carriesContent) { traceCtx.content_policy = "metadata_only"; teamHubContentCarried = true; }');
    const read = READ.indexOf("const read = await TEAM_HUB_READERS[");
    const push = READ.indexOf("toolResults.push({ tool_call_id: tc.id, role: \"tool\", content: JSON.stringify(hubEnvelope) });");
    assert.ok(read >= 0 && set > read && push > set);
  });
  it("the approved reply switches it before the definer is called", () => {
    const set = POST.indexOf('traceCtx.content_policy = "metadata_only";');
    assert.ok(set >= 0 && POST.indexOf("await postTeamHubReply(") > set);
  });
  it("a person who has used Team Hub is traced as metadata only from the start of every turn, before any model call", () => {
    const stamp = CHAT.indexOf("    traceCtx.tenant_id = personaCtx.tenant_id;\n");
    const check = CHAT.indexOf("if (!customerPortal && await teamHubSessionTainted(supabase, user.id, [personaCtx.tenant_id], TEAM_HUB_CHAT_TOOL_NAMES, TEAM_HUB_POST_TOOL_NAME).catch(() => true)) {\n      traceCtx.content_policy = \"metadata_only\";", stamp);
    assert.ok(stamp >= 0 && check > stamp && check - stamp < 1200, "the check follows the identity stamp directly");
    for (const site of ['traceFor("thread-summary-fold")', 'traceFor("turn-classify")', 'trace: traceFor("chat")', 'traceFor("chat-tool-loop")']) {
      const at = CHAT.indexOf(site);
      assert.ok(at > check, `${site} comes after the check`);
    }
  });
  it("the read receipt's run id names the person, so two people never share one", () => {
    assert.match(READ, /runId: await stableRunId\(\[tc\.function\.name, hubTenant, user\.id, `\$\{payloadThreadId \?\? ""\}:\$\{tc\.id\}`\]\)/);
    assert.match(POST, /runId: await stableRunId\(\[tc\.function\.name, hubTenant, user\.id, `\$\{payloadThreadId \?\? ""\}:\$\{tc\.id\}`\]\)/);
  });
});

describe("once Team Hub text is in a request, the web and Knowledge tools never reach dispatch", () => {
  it("the flag lives outside the dispatcher, starts false and is only ever set true by a content-carrying read", () => {
    const decl = CHAT.indexOf("      let teamHubContentCarried = false;\n      const executeToolCalls = async (");
    assert.ok(decl >= 0);
    const writes = [...CHAT.matchAll(/teamHubContentCarried = ([a-z]+)/g)].map((m) => m[1]);
    assert.deepEqual(writes, ["false", "true"]);
  });
  it("the one dispatch call site filters them out and answers each with the plain refusal", () => {
    const sites = [...CHAT.matchAll(/await executeToolCalls\(/g)];
    assert.equal(sites.length, 1, "one executeToolCalls call site");
    const at = sites[0].index!;
    const before = CHAT.slice(at - 700, at);
    assert.match(before, /const teamHubWithheld = teamHubContentCarried \? roundCalls\.filter\(\(tc: any\) => TEAM_HUB_EGRESS_WITHHELD_TOOLS\.has\(String\(tc\?\.function\?\.name \?\? ""\)\)\) : \[\];/);
    const call = CHAT.slice(at, CHAT.indexOf("\n", at));
    assert.match(call, /^await executeToolCalls\(roundCalls\.filter\(\(tc: any\) => !teamHubWithheld\.includes\(tc\)\), queuedApprovals, toolStepHooks\);/);
    const after = CHAT.slice(at, at + 600);
    assert.match(after, /for \(const tc of teamHubWithheld\) \{\s*executed\.push\(tc\);\s*toolResults\.push\(\{ tool_call_id: tc\.id, role: "tool", content: JSON\.stringify\(TEAM_HUB_EGRESS_REFUSAL\) \}\);/);
  });
});
