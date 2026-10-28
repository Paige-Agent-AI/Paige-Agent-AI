// node --test supabase/functions/paige-ai-chat/team-hub-a2b-wiring.test.ts
// EXP08 Team Hub agents A2b (plan S2) — how paige-ai-chat wires the Team Hub card seams and the four
// extractions. EVIDENCE CLASS, stated plainly: a STRUCTURAL test over the handler's source, not a run
// of the Deno handler. It pins:
//   - the card-act route: after the verified actor and the ingress rate limit, before the chat schema,
//     handed the asker's session, the service role, the verified actor, the control hint and invokeAs,
//     and NO model seam (no model runs on Approve / Not now);
//   - invokeAs: the asker's own JWT on a door call, handed to BOTH Team Hub routes;
//   - the one choke point (plan D10): every approval/decline token passes through
//     withoutTeamHubCardTokens before either set exists, and nothing below re-reads the raw field to
//     build them;
//   - the four extractions: the chat calls the one shared home, and the inline copies are gone (§18).
// The behaviour of the moved code is proved by the parity tests beside each helper; the binding
// module itself by _shared/team-hub/card-binding.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// node:test's describe/it are not in Deno 2.1's node compat; this keeps one file runnable by both
// `node --test` and `deno test` (flat tests named "suite > case").
let suite = "";
const describe = (name: string, body: () => void) => { const prev = suite; suite = name; body(); suite = prev; };
const it = (name: string, fn: () => unknown) => { test(`${suite} > ${name}`, async () => { await fn(); }); };

const CHAT = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
const at = (needle: string): number => {
  const i = CHAT.indexOf(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  assert.equal(CHAT.indexOf(needle, i + needle.length), -1, `not unique: ${needle}`);
  return i;
};
const absent = (needle: string) => assert.equal(CHAT.indexOf(needle), -1, `still present: ${needle}`);

const INVOKE_AS = "    const teamHubInvokeAs = (name: string, body: Record<string, unknown>) =>\n"
  + "      supabaseClient.functions.invoke(name, { headers: { Authorization: authHeader }, body });\n";
const AGENT_SEAM = "    if (isTeamHubAgentTurnRequest(rawData)) {\n"
  + "      const agentTurn = await runTeamHubAgentTurn({ caller: supabaseClient, service: supabase, userId: user.id,\n"
  + "        complete: fabricCompletion, signal: req.signal, controlHint, invokeAs: teamHubInvokeAs,\n";
const CARD_SEAM = "    if (isTeamHubCardActRequest(rawData)) {\n"
  + "      const cardAct = await runTeamHubCardAct({ caller: supabaseClient, service: supabase, userId: user.id,\n"
  + "        signal: req.signal, controlHint, invokeAs: teamHubInvokeAs }, rawData);\n"
  + "      return new Response(JSON.stringify(cardAct.body),\n"
  + "        { status: cardAct.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });\n"
  + "    }\n";

describe("the Team Hub card-act route in paige-ai-chat", () => {
  it("imports the card modules once, from their one home", () => {
    at("import { isTeamHubCardActRequest, runTeamHubCardAct } from '../_shared/team-hub/card-act.ts';");
    at("import { withoutTeamHubCardTokens, TEAM_HUB_CARD_ALREADY_WAITING } from '../_shared/team-hub/card-binding.ts';");
  });
  it("hands over the asker's session, the service role, the verified actor, the signal, the control hint and invokeAs — and no model seam", () => {
    const seam = at(CARD_SEAM);
    assert.equal(CHAT.slice(seam, seam + CARD_SEAM.length).includes("complete"), false);
    assert.equal(CHAT.slice(seam, seam + CARD_SEAM.length).includes("fabricCompletion"), false);
  });
  it("runs after the verified actor and the ingress rate limit, and before the chat schema or anything else", () => {
    const seam = at(CARD_SEAM);
    assert.ok(at("const { data: { user }, error: authError } = await supabaseClient.auth.getUser();") < seam);
    assert.ok(at("if (authError || !user) {") < seam);
    assert.ok(at("const supabase = createClient(supabaseUrl, supabaseServiceKey);") < seam);
    assert.ok(at("if (rateLimitCheck === false) {") < seam);
    assert.ok(at("      } else rawData = await req.json();") < seam);
    assert.ok(seam < at("      validatedData = messageSchema.parse(rawData);"));
    assert.ok(seam < at('const { data: pc, error: pcErr } = await supabaseClient.rpc("get_paige_persona_context");'));
  });
  it("hands over the request's own control hint, unreassigned since the ingress limit read it", () => {
    const seam = at(CARD_SEAM);
    const hint = at("    const controlHint = req.headers.get(CHAT_CONTROL_HEADER);\n    const ingress = chatIngressPolicy(controlHint);\n");
    assert.ok(hint < seam);
    assert.equal(/controlHint\s*=(?!=)/.test(CHAT.slice(hint + 60, seam)), false);
  });
});

describe("invokeAs, handed to both Team Hub routes", () => {
  it("is a door call carrying the asker's own Authorization header, never the service key", () => {
    const i = at(INVOKE_AS);
    assert.equal(CHAT.slice(i, i + INVOKE_AS.length).includes("supabaseServiceKey"), false);
    assert.ok(at("    const authHeader = req.headers.get('Authorization');") < i);
  });
  it("is defined before both routes and handed to each", () => {
    const i = at(INVOKE_AS);
    assert.ok(i < at(AGENT_SEAM));
    assert.ok(i < at(CARD_SEAM));
    assert.equal(CHAT.split("invokeAs: teamHubInvokeAs").length - 1, 2);
  });
});

describe("the one choke point for Team Hub card tokens (plan D10)", () => {
  const CHOKE = "        const binding = await withoutTeamHubCardTokens(supabase, user.id, [...requestApproved, ...requestDeclined]);\n"
    + "        keptTokens = new Set(binding.kept);\n";
  it("passes every approved and declined token through the binding, with the service role and the verified actor", () => {
    at(CHOKE);
    at("    let requestApproved = validatedData.approvedConfirmations ?? [];\n    let requestDeclined = validatedData.declinedConfirmations ?? [];\n");
  });
  it("drops what the binding did not keep from BOTH sets, and fails closed on a throw (bare tokens dropped)", () => {
    at("      requestApproved = requestApproved.filter((token) => keptTokens.has(token));\n      requestDeclined = requestDeclined.filter((token) => keptTokens.has(token));\n");
    at("        keptTokens = new Set([...requestApproved, ...requestDeclined].filter((token) => token.includes(\":\")));\n");
  });
  it("builds both sets from the filtered lists only, after the choke point, and nowhere else", () => {
    const choke = at(CHOKE);
    const approved = at("    const approvedConfirmations = new Set<string>(requestApproved);\n");
    const declined = at("    const declinedConfirmations = requestDeclined;\n");
    assert.ok(choke < approved && choke < declined);
    absent("new Set<string>(validatedData.approvedConfirmations");
    absent("const declinedConfirmations = validatedData.declinedConfirmations");
    assert.equal(CHAT.split("const approvedConfirmations =").length - 1, 1);
    assert.equal(CHAT.split("const declinedConfirmations =").length - 1, 1);
  });
  it("sits before every consumer of the two sets (the resume, the doors, the generic gate, the outcome report)", () => {
    const approved = at("    const approvedConfirmations = new Set<string>(requestApproved);\n");
    for (const consumer of ["const cancellationsRecorded = await cancelConfirmations(declinedConfirmations);",
      "let doorTokens = [...approvedConfirmations].map(parseDoorToken)",
      "if (approvalOutcomeSent || (approvedConfirmations.size === 0 && teamHubWithheldApprovals.size === 0)) return;"]) {
      assert.ok(approved < at(consumer), consumer);
    }
  });
});

describe("an approval the choke point withheld is still answered for (verifier fixes 1 and 3)", () => {
  it("each withheld approval keeps its reason: a card's token is unclaimable here, a lookup that did not answer is lookup_failed", () => {
    const choke = at("        const binding = await withoutTeamHubCardTokens(supabase, user.id, [...requestApproved, ...requestDeclined]);\n");
    const record = at("      for (const token of requestApproved) if (!keptTokens.has(token)) teamHubWithheldApprovals.set(token, bindingFailed ? \"lookup_failed\" : \"unclaimable\");\n");
    assert.ok(choke < record);
    assert.ok(record < at("      requestApproved = requestApproved.filter((token) => keptTokens.has(token));\n"), "recorded before the list is filtered");
    at("        bindingFailed = binding.failed;\n");
    // A throw is a failed lookup too.
    const thrown = at("        keptTokens = new Set([...requestApproved, ...requestDeclined].filter((token) => token.includes(\":\")));\n        bindingFailed = true;\n");
    assert.ok(choke < thrown && thrown < record);
  });
  it("the report runs when the only approvals were withheld, in the order sent, and classifies each withheld one by its reason before anything else", () => {
    const guard = at("        if (approvalOutcomeSent || (approvedConfirmations.size === 0 && teamHubWithheldApprovals.size === 0)) return;\n");
    const order = at("          const tokens = approvalReportOrder.filter((token) => approvedConfirmations.has(token) || teamHubWithheldApprovals.has(token));\n");
    const first = at("            if (teamHubWithheldApprovals.has(token)) return classifyUnspentApproval(teamHubWithheldApprovals.get(token));\n");
    assert.ok(guard < order && order < first);
    assert.ok(first < at("            if (resumeTokens.has(token)) return resumedApprovalClassified(token);"), "before the resume's own reading");
    at("    const approvalReportOrder = [...new Set(requestApproved)];\n");
    assert.ok(at("    const approvalReportOrder = [...new Set(requestApproved)];\n") < at("        const binding = await withoutTeamHubCardTokens(supabase, user.id, [...requestApproved, ...requestDeclined]);\n"),
      "the order is taken from the request before the choke point filters it");
  });
  it("the publish door branch never shows a chat card for a proposal a Team Hub card already holds (D11, the other direction)", () => {
    const branch = at("        if (GROWTH_PUBLISH_DOOR_TOOL_NAMES.has(tc.function.name)) {");
    const check = at("            const waiting = await withoutTeamHubCardTokens(supabase, user.id, [result.content.confirm_fingerprint]).catch(() => null);\n");
    const refuse = at("              toolResults.push({ tool_call_id: tc.id, role: \"tool\", content: JSON.stringify(TEAM_HUB_CARD_ALREADY_WAITING) });\n");
    assert.ok(branch < check && check < refuse);
    assert.ok(at("          if (!doorPin && result.content.needs_confirm === true && typeof result.content.confirm_fingerprint === \"string\") {\n") < check);
    at("            if (waiting && !waiting.failed && waiting.bound.length) {\n");
    // Before the branch's own outcome handling (the pinned carry-forward and the plain push).
    assert.ok(refuse < CHAT.indexOf("          if (doorPin) {\n", refuse));
  });
});

describe("the four extractions (one home each, §18)", () => {
  it("imports each shared helper once", () => {
    at("import { listCrmTasks } from '../_shared/crm-reads/list-tasks.ts';");
    at("import { listCrmTeam } from '../_shared/crm-reads/list-team.ts';");
    at("import { listGrowthPages } from '../_shared/growth/list-pages.ts';");
    at("import { growthPagePublishToolDef } from '../_shared/growth-publish-command/chat-tools.ts';");
  });
  it("crm_list_tasks: the chat keeps its email lookup and calls the shared list; the inline query is gone", () => {
    at("              result = await listCrmTasks(admin, crmTenantId!, args, { assigneeUserId });\n");
    at("                assigneeUserId = a ? a.id : \"00000000-0000-0000-0000-000000000000\";\n");
    absent('admin.from("tasks").select("id, title, status, due_date, track, user_id, biz_id, deal_id, source_thread_id, updated_at, created_at")');
  });
  it("crm_list_team: calls the shared read on the caller's session; the inline rpc is gone", () => {
    at("              result = await listCrmTeam(supabaseClient, personaCtx?.tenant_id ?? null);\n");
    absent('rpc("list_team_members"');
  });
  it("growth_list: calls the shared read (caller session + service role for the slug); the inline query is gone", () => {
    at("              result = await listGrowthPages(supabaseClient, admin, personaCtx?.tenant_id ?? null);\n");
    absent('.select("id, slug, title, status, published_at, updated_at")');
  });
  it("growth_page_publish: the tool list calls the factory in the literal's old slot; the inline literal is gone", () => {
    const slot = at("          growthPagePublishToolDef(),\n");
    assert.ok(at("    const toolDefs = [\n") < slot);
    assert.ok(at('              name: "growth_page_save",') < slot);
    assert.ok(slot < at('              name: "growth_funnel_generate",'));
    absent('name: "growth_page_publish"');
  });
});
