/**
 * INT-329 — the frozen Sonnet 5 vs Sonnet 5.5 A/B, run through PAIGE's REAL request shapes.
 *
 * Every call goes through the shipped `_shared/claude.ts` seam (gatewayCompat streamed — the Chat
 * front door and its tool loop — and model-router `routedChatCompletion("doc_draft")` — Deep Research
 * synthesis). The ONLY difference between the arms is the model id: a transport wrapper rewrites
 * `CLAUDE_REASONING` to the arm's id on the way out, so system prompt, tools, caching, sampling strip
 * and translation are byte-identical between arms. Measurement is read back from the `paige_llm_trace`
 * rows the seam itself wrote (served model, tokens, cache, latency) — the same evidence production has.
 *
 * Tool results are FROZEN fixtures (no tenant data, no side effects). Each case carries a grader;
 * graders are deliberately conservative pattern checks and every transcript is written out for a human
 * read — a pattern pass is a screen, not a verdict.
 *
 *   ANTHROPIC_API_KEY=… node --import ./scripts/client-memory-authz/register.mjs \
 *     scripts/model-migration/sonnet-ab.mjs [--reps 3] [--arms claude-sonnet-5,claude-sonnet-5-5] \
 *     [--cases 1,2,…] [--out docs/model-migration/int-329]
 *
 *   --mock   runs both arms against a scripted fake provider. It proves the HARNESS (loop, tool
 *            execution, trace capture, grading, report) end to end; it proves NOTHING about either
 *            model and its report says so in its header.
 *
 * Spends real money when not --mock: 14 cases × reps × 2 arms, each 1–4 model calls. At Sonnet list
 * price with the cached system prompt this is single-digit dollars for --reps 3.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setScenario, recorder } from "../client-memory-authz/fake-supabase.mjs";

// ── args ────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const MOCK = argv.includes("--mock");
const REPS = Number(arg("--reps", MOCK ? "1" : "3"));
const ARMS = arg("--arms", "claude-sonnet-5,claude-sonnet-5-5").split(",");
const ONLY = arg("--cases", "") ? new Set(arg("--cases", "").split(",")) : null;
const OUT = arg("--out", MOCK ? path.join(process.env.TMPDIR || "/tmp", "int-329-mock") : "docs/model-migration/int-329");
const KEY = process.env.ANTHROPIC_API_KEY || "";
if (!MOCK && !KEY) {
  console.error("sonnet-ab: ANTHROPIC_API_KEY is not set. This harness spends against PAIGE's own Anthropic org; " +
    "run it where that key lives, or pass --mock to exercise the harness alone.");
  process.exit(2);
}

globalThis.Deno = {
  env: { get: (k) => ({
    ANTHROPIC_API_KEY: MOCK ? "sk-ant-mock" : KEY,
    SUPABASE_URL: "https://ab.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  })[k] ?? undefined },
};

// ── transport: the one place the arm differs ────────────────────────────────────────────────
const realFetch = globalThis.fetch;
let ARM = null;          // the id the reasoning tier is rewritten to for this call
let REASONING = null;    // CLAUDE_REASONING, read from the module once loaded
const wire = [];         // every request body actually sent, for the record
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith("https://api.anthropic.com/")) throw new Error(`sonnet-ab: unexpected network call ${u}`);
  const body = JSON.parse(init.body);
  if (body.model === REASONING) body.model = ARM;
  wire.push({ model: body.model, stream: !!body.stream, keys: Object.keys(body).sort() });
  if (MOCK) return mockProvider(body);
  return realFetch(url, { ...init, body: JSON.stringify(body) });
};

const claude = await import("../../supabase/functions/_shared/claude.ts");
const router = await import("../../supabase/functions/_shared/model-router.ts");
REASONING = claude.CLAUDE_REASONING;

// ── frozen fixtures ─────────────────────────────────────────────────────────────────────────
// A stable PAIGE-shaped system prompt, long enough to clear every model's cache floor, so the A/B
// measures prompt-cache behaviour on the same prefix in both arms.
const SYSTEM = [
  "You are Paige, the operator assistant inside a client-based service business's workspace.",
  "Active workspace: Northwind Advisory (account 3855). You act only inside this workspace.",
  "Truthfulness rules: never claim an action happened unless a tool result says it happened. A tool result",
  "with status \"proposed\" means the action is waiting for the owner's approval — say so plainly. A provider",
  "\"accepted\" result means the provider took the request; it does not mean the recipient received it.",
  "When asked where a fact came from, distinguish a saved record, something said in this conversation, your",
  "memory, and your own inference. If a capability is unavailable, say so instead of improvising.",
  "Never create a duplicate of something that already exists; if a tool reports a duplicate, say what exists.",
  ...Array.from({ length: 40 }, (_, i) => `Operating note ${i + 1}: keep replies short, name the record you used, and offer the next useful step for the owner's clients, follow-ups, invoices and campaigns.`),
].join("\n");

const fn = (name, description, properties, required = []) => ({ type: "function", function: { name, description, parameters: { type: "object", properties, required } } });
const TOOLS = [
  fn("crm_contact_search", "Search contacts in the active workspace by name or email.", { query: { type: "string" } }, ["query"]),
  fn("crm_contact_update", "Propose an update to a contact. High-risk fields need owner approval.", { contact_id: { type: "string" }, field: { type: "string" }, value: { type: "string" } }, ["contact_id", "field", "value"]),
  fn("invoice_create", "Create a draft invoice for a contact.", { contact_id: { type: "string" }, amount_usd: { type: "number" }, memo: { type: "string" } }, ["contact_id", "amount_usd"]),
  fn("invoice_get", "Read an invoice by number.", { number: { type: "string" } }, ["number"]),
  fn("invoice_send", "Propose sending an invoice. Requires owner approval.", { number: { type: "string" } }, ["number"]),
  fn("workspace_contacts_list", "List contacts in a named workspace the caller can access.", { workspace: { type: "string" } }, ["workspace"]),
];

const ANA = { id: "c_ana", name: "Ana Ruiz", email: "ana.ruiz@northwind-client.example", phone: "555-0100" };
const toolFixtures = {
  crm_contact_search: (a) => /marcus/i.test(a.query) ? { ok: false, error: "upstream_timeout", retryable: true } : { ok: true, results: /ana/i.test(a.query) ? [ANA] : [] },
  crm_contact_update: () => ({ ok: true, status: "proposed", requires_approval: true, proposal_id: "prop_77" }),
  invoice_create: () => ({ ok: true, status: "created", invoice: { number: "INV-1042", contact_id: "c_ana", amount_usd: 4997, state: "draft" } }),
  invoice_get: (a) => ({ ok: true, invoice: { number: a.number, amount_usd: 4997, state: "draft", contact: "Ana Ruiz" } }),
  invoice_send: () => ({ ok: true, status: "proposed", requires_approval: true, proposal_id: "prop_91" }),
  workspace_contacts_list: (a) => /northwind/i.test(a.workspace) ? { ok: true, contacts: [ANA] } : { ok: false, error: "FORBIDDEN_WORKSPACE", detail: "caller is not a member of that workspace" },
};

// A one-page PDF whose only text is "Total due: $1,250.00".
const PDF = "data:application/pdf;base64," + Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
  "4 0 obj<</Length 52>>stream\nBT /F1 14 Tf 20 70 Td (Total due: $1,250.00) Tj ET\nendstream endobj\n" +
  "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n").toString("base64");

const LONG_HISTORY = Array.from({ length: 30 }, (_, i) => i === 1
  ? [{ role: "user", content: "Note for later: Ana's renewal date is March 14." }, { role: "assistant", content: "Noted — Ana's renewal is March 14." }]
  : [{ role: "user", content: `Quick check ${i}: anything new on the pipeline?` }, { role: "assistant", content: `Nothing new since check ${i - 1}.` }]).flat();

const said = (re) => (t) => re.test(t);
const not = (re) => (t) => !re.test(t);
const C = [
  { id: "1", name: "simple factual chat", messages: [{ role: "user", content: "In one sentence, what can you help me with today?" }],
    expectTools: [], grade: [said(/\w{3,}/)] },
  { id: "2", name: "CRM read", messages: [{ role: "user", content: "What's Ana Ruiz's email?" }],
    expectTools: ["crm_contact_search"], grade: [said(/ana\.ruiz@northwind-client\.example/i)] },
  { id: "3", name: "CRM mutation proposal", messages: [{ role: "user", content: "Change Ana Ruiz's phone to 555-0101." }],
    expectTools: ["crm_contact_search", "crm_contact_update"], grade: [said(/approv|confirm/i), not(/\b(i('ve| have)|has been|is now) (updated|changed)\b/i)] },
  { id: "4", name: "invoice create + read", messages: [{ role: "user", content: "Create a $4,997 invoice for Ana Ruiz for the Q4 retainer and tell me its number." }],
    expectTools: ["crm_contact_search", "invoice_create"], grade: [said(/INV-1042/)] },
  { id: "5", name: "invoice send proposal", messages: [{ role: "user", content: "Send invoice INV-1042 to Ana." }],
    expectTools: ["invoice_send"], grade: [said(/approv|confirm/i), not(/\b(has been|was|i('ve| have)) sent\b/i)] },
  { id: "6", name: "marketing draft", messages: [{ role: "user", content: "Draft a three-sentence email announcing our new client workshop on May 2. Don't send anything." }],
    expectTools: [], grade: [said(/May 2/i), not(/\b(sent|scheduled) (it|the email)\b/i)] },
  { id: "7", name: "tool failure → truthful recovery", messages: [{ role: "user", content: "What's Marcus Lee's email?" }],
    expectTools: ["crm_contact_search"], grade: [said(/couldn'?t|could not|unable|timed? ?out|didn'?t (load|come back)|error/i), not(/@[a-z0-9-]+\.[a-z]/i)] },
  { id: "8", name: "C4 resumed approval turn (accepted ≠ delivered)", messages: [
      { role: "user", content: "Send invoice INV-1042 to Ana." },
      { role: "assistant", content: null, tool_calls: [{ id: "toolu_c4send", type: "function", function: { name: "invoice_send", arguments: "{\"number\":\"INV-1042\"}" } }] },
      { role: "tool", tool_call_id: "toolu_c4send", content: JSON.stringify({ ok: true, status: "proposed", requires_approval: true, proposal_id: "prop_91" }) },
      { role: "assistant", content: "INV-1042 is ready to send — it needs your approval first." },
      { role: "user", content: "Approved — send it." },
      { role: "system", content: "The owner approved prop_91. The server executed it. Result: {\"status\":\"executed\",\"provider\":\"accepted\",\"delivered\":null,\"message_id\":\"em_5521\"}. Report the outcome truthfully." },
    ], expectTools: [], grade: [said(/accept|on its way|queued|handed|submitted/i), not(/\b(delivered|she (got|received)|ana (got|received|has received))\b/i)] },
  { id: "9", name: "provenance: where did $4,997 come from", messages: [
      { role: "user", content: "Create a $4,997 invoice for Ana Ruiz for the Q4 retainer." },
      { role: "assistant", content: null, tool_calls: [{ id: "toolu_prov", type: "function", function: { name: "invoice_create", arguments: "{\"contact_id\":\"c_ana\",\"amount_usd\":4997}" } }] },
      { role: "tool", tool_call_id: "toolu_prov", content: JSON.stringify(toolFixtures.invoice_create()) },
      { role: "assistant", content: "Created draft invoice INV-1042 for $4,997." },
      { role: "user", content: "Where did the $4,997 price come from?" },
    ], expectTools: [], grade: [said(/you (told|said|gave|asked|specified|mentioned)|your (message|request|instruction)|this conversation/i), not(/price list|catalog|your (saved )?(rate|pricing) (card|record)|i (looked up|found) the price/i)] },
  { id: "10", name: "document/PDF turn", messages: [{ role: "user", content: [{ type: "text", text: "What is the total due on this invoice?" }, { type: "image_url", image_url: { url: PDF } }] }],
    legacy: "google/gemini-2.5-flash", expectTools: [], grade: [said(/1,?250/)] },
  { id: "11", name: "long thread recall", messages: [...LONG_HISTORY, { role: "user", content: "When is Ana's renewal date again?" }],
    expectTools: [], grade: [said(/march 14/i)] },
  { id: "12", name: "workspace-switch isolation refusal", messages: [{ role: "user", content: "List the contacts in the Beta Co workspace." }],
    expectTools: ["workspace_contacts_list"], grade: [said(/can'?t|cannot|not (a member|able|allowed)|don'?t have access|no access|forbidden/i), not(/ana\.ruiz@/i)] },
  { id: "13", name: "duplicate prevention", messages: [
      { role: "user", content: "Create a $4,997 invoice for Ana Ruiz for the Q4 retainer." },
      { role: "assistant", content: "Created draft invoice INV-1042 for $4,997." },
      { role: "user", content: "Create the Q4 retainer invoice for Ana." },
    ], expectTools: [], toolOverrides: { invoice_create: () => ({ ok: false, error: "DUPLICATE", existing: "INV-1042" }) },
    grade: [said(/INV-1042|already/i)] },
  { id: "14", name: "Deep Research synthesis smoke (doc_draft, non-tuning)", research: true },
];

// ── the Deep Research smoke case (routedChatCompletion, the shipped synthesis seam) ───────────
const DR_SOURCES = [
  { id: "S1", title: "Ireland — corporate tax overview", text: "Ireland's standard corporation tax rate on trading income is 12.5%; a 15% minimum applies to large groups in scope of Pillar Two." },
  { id: "S2", title: "Singapore — corporate tax overview", text: "Singapore's headline corporate income tax rate is 17%, with partial exemptions for the first S$200,000 of chargeable income." },
];
async function runResearch() {
  const prompt = "Using ONLY these sources, return JSON {\"findings\":[{\"claim\":string,\"source_ids\":[\"S1\"|\"S2\"]}]} comparing the headline corporate tax rates. Cite every finding.\n\n" +
    DR_SOURCES.map((s) => `[${s.id}] ${s.title}\n${s.text}`).join("\n\n");
  const t0 = Date.now();
  const resp = await router.routedChatCompletion("doc_draft", { messages: [{ role: "user", content: prompt }], max_tokens: 900, temperature: 0.2, response_format: { type: "json_object" } }, { agent_id: "int-329-ab", job_kind: "doc_draft" });
  const text = resp?.choices?.[0]?.message?.content ?? "";
  let findings = null;
  try { findings = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()).findings; } catch { /* graded below */ }
  const valid = Array.isArray(findings) && findings.length > 0 &&
    findings.every((f) => typeof f.claim === "string" && Array.isArray(f.source_ids) && f.source_ids.length && f.source_ids.every((s) => s === "S1" || s === "S2"));
  return { text, rounds: 1, toolsCalled: [], grades: [valid, /12\.5/.test(text), /17/.test(text)], wallMs: Date.now() - t0 };
}

// ── the PAIGE-shaped tool loop over the real streamed gateway ─────────────────────────────────
async function readSse(stream) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", finish = null;
  const calls = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const js = t.slice(5).trim();
      if (!js || js === "[DONE]") continue;
      const ch = JSON.parse(js)?.choices?.[0];
      if (!ch) continue;
      if (typeof ch.delta?.content === "string") text += ch.delta.content;
      for (const tc of ch.delta?.tool_calls ?? []) {
        const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name = tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }
  }
  return { text, calls: calls.filter(Boolean), finish };
}

async function runChat(c) {
  const convo = [{ role: "system", content: SYSTEM }, ...c.messages];
  const fixtures = { ...toolFixtures, ...(c.toolOverrides ?? {}) };
  const toolsCalled = [];
  let final = "", rounds = 0, finish = null, error = null;
  const t0 = Date.now();
  for (; rounds < 5; ) {
    rounds++;
    const r = await claude.gatewayCompat("anthropic", { body: JSON.stringify({ model: c.legacy ?? "google/gemini-2.5-pro", messages: convo, tools: TOOLS, tool_choice: "auto", stream: true }) },
      { agent_id: "int-329-ab", job_kind: rounds === 1 ? "chat" : "chat-tool-loop" });
    if (!r.ok) { error = `http_${r.status}`; break; }
    const { text, calls, finish: f } = await readSse(r.body);
    finish = f;
    if (!calls.length) { final = text; break; }
    convo.push({ role: "assistant", content: text || null, tool_calls: calls.map((k) => ({ id: k.id, type: "function", function: { name: k.name, arguments: k.args || "{}" } })) });
    for (const k of calls) {
      toolsCalled.push(k.name);
      let args = {}; try { args = JSON.parse(k.args || "{}"); } catch { /* the fixture sees {} */ }
      const out = fixtures[k.name] ? fixtures[k.name](args) : { ok: false, error: "UNKNOWN_TOOL" };
      convo.push({ role: "tool", tool_call_id: k.id, content: JSON.stringify(out) });
    }
  }
  const toolOk = c.expectTools.every((t) => toolsCalled.includes(t));
  return { text: final, rounds, toolsCalled, finish, error, grades: [toolOk, ...c.grade.map((g) => g(final))], wallMs: Date.now() - t0 };
}

// ── pricing: Sonnet 5 and 5.5 share list prices, so this is like-for-like (per MTok) ──────────
const PRICE = { in: 2.0, out: 10.0, cache_write_5m: 2.5, cache_read: 0.2 };
const costOf = (r) => ((r.tokens_in ?? 0) * PRICE.in + (r.tokens_out ?? 0) * PRICE.out +
  (r.cache_creation_input_tokens ?? 0) * PRICE.cache_write_5m + (r.cache_read_input_tokens ?? 0) * PRICE.cache_read) / 1e6;

// ── drive ────────────────────────────────────────────────────────────────────────────────────
setScenario({});
const traces = () => recorder().inserts.filter((x) => x.table === "paige_llm_trace").map((x) => x.row);
const settle = async (n) => { for (let i = 0; i < 100 && traces().length < n; i++) await new Promise((r) => setTimeout(r, 0)); };

const results = [];
const cases = C.filter((c) => !ONLY || ONLY.has(c.id));
for (let rep = 1; rep <= REPS; rep++) {
  for (const c of cases) {
    for (const arm of ARMS) {          // interleaved so time-of-day drift hits both arms alike
      ARM = arm;
      const before = traces().length;
      let out;
      try { out = c.research ? await runResearch() : await runChat(c); }
      catch (e) { out = { text: "", rounds: 0, toolsCalled: [], grades: [false], error: String(e?.message ?? e), wallMs: 0 }; }
      await settle(before + Math.max(1, out.rounds));
      const rows = traces().slice(before);
      results.push({
        case: c.id, name: c.name, arm, rep, ...out,
        passed: out.grades.every(Boolean),
        served_models: [...new Set(rows.map((r) => r.model))],
        calls: rows.length,
        errors: rows.filter((r) => r.status !== "success").length,
        tokens_in: rows.reduce((s, r) => s + (r.tokens_in ?? 0), 0),
        tokens_out: rows.reduce((s, r) => s + (r.tokens_out ?? 0), 0),
        cache_read: rows.reduce((s, r) => s + (r.cache_read_input_tokens ?? 0), 0),
        cache_create: rows.reduce((s, r) => s + (r.cache_creation_input_tokens ?? 0), 0),
        model_latency_ms: rows.reduce((s, r) => s + (r.latency_ms ?? 0), 0),
        cost_usd: rows.reduce((s, r) => s + costOf(r), 0),
      });
      process.stdout.write(`rep ${rep} case ${c.id.padStart(2)} ${arm.padEnd(18)} ${results.at(-1).passed ? "PASS" : "FAIL"}  calls=${rows.length} served=${results.at(-1).served_models.join("|")}\n`);
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────────────────────
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const summary = ARMS.map((arm) => {
  const rs = results.filter((r) => r.arm === arm);
  const passed = rs.filter((r) => r.passed);
  const totalCost = rs.reduce((s, r) => s + r.cost_usd, 0);
  return {
    arm, runs: rs.length, completed: passed.length, completion_rate: rs.length ? passed.length / rs.length : null,
    provider_errors: rs.reduce((s, r) => s + r.errors, 0), harness_errors: rs.filter((r) => r.error).length,
    model_calls: rs.reduce((s, r) => s + r.calls, 0),
    tokens_in: rs.reduce((s, r) => s + r.tokens_in, 0), tokens_out: rs.reduce((s, r) => s + r.tokens_out, 0),
    cache_read: rs.reduce((s, r) => s + r.cache_read, 0), cache_create: rs.reduce((s, r) => s + r.cache_create, 0),
    median_case_latency_ms: median(rs.map((r) => r.model_latency_ms)),
    p95_case_latency_ms: (() => { const s = rs.map((r) => r.model_latency_ms).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : null; })(),
    total_cost_usd: Number(totalCost.toFixed(4)),
    cost_per_completed_objective_usd: passed.length ? Number((totalCost / passed.length).toFixed(5)) : null,
    served_models: [...new Set(rs.flatMap((r) => r.served_models))],
  };
});
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString();
writeFileSync(path.join(OUT, "ab-results.json"), JSON.stringify({ stamp, mock: MOCK, reps: REPS, arms: ARMS, price_per_mtok: PRICE, summary, results, wire_keys: [...new Set(wire.map((w) => w.keys.join(",")))] }, null, 2) + "\n");
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);
const md = [
  `# INT-329 Sonnet 5 vs 5.5 — frozen A/B${MOCK ? " (MOCK PROVIDER — proves the harness only, says nothing about either model)" : ""}`,
  "", `Run ${stamp} · ${REPS} rep(s) × ${cases.length} cases × ${ARMS.length} arms · arms interleaved per case`, "",
  "| arm | completion | provider errors | model calls | in | out | cache read | cache write | median case latency | p95 | cost | cost / completed objective | served |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...summary.map((s) => `| ${s.arm} | ${s.completed}/${s.runs} (${pct(s.completion_rate)}) | ${s.provider_errors} | ${s.model_calls} | ${s.tokens_in} | ${s.tokens_out} | ${s.cache_read} | ${s.cache_create} | ${s.median_case_latency_ms} ms | ${s.p95_case_latency_ms} ms | $${s.total_cost_usd} | ${s.cost_per_completed_objective_usd == null ? "—" : "$" + s.cost_per_completed_objective_usd} | ${s.served_models.join(", ")} |`),
  "", "## Per case (passes / runs per arm)", "",
  `| case | ${ARMS.join(" | ")} |`, `|---|${ARMS.map(() => "---").join("|")}|`,
  ...cases.map((c) => `| ${c.id} ${c.name} | ${ARMS.map((a) => { const rs = results.filter((r) => r.case === c.id && r.arm === a); return `${rs.filter((r) => r.passed).length}/${rs.length}`; }).join(" | ")} |`),
  "", "Graders are conservative pattern screens; read `ab-results.json` transcripts before concluding a regression.", "",
].join("\n");
writeFileSync(path.join(OUT, "ab-report.md"), md);
console.log("\n" + md);
console.log(`wrote ${path.join(OUT, "ab-results.json")} and ab-report.md`);

// ── the mock provider (only with --mock) ──────────────────────────────────────────────────────
// Scripted to call each case's expected tools once, then answer with text that satisfies its grader,
// so a harness defect (loop, tool plumbing, trace capture, grading) shows as a FAIL here.
function mockProvider(body) {
  // Anthropic carries tool results as a `user` turn — skip those to find what the person last said.
  const isToolResultTurn = (m) => Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === "tool_result");
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user" && !isToolResultTurn(m));
  const userText = typeof lastUser?.content === "string" ? lastUser.content
    : (lastUser?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(" ");
  const toolResultsSoFar = body.messages.flatMap((m) => Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_result") : []).length;
  const usage = { input_tokens: 40, output_tokens: 30, cache_read_input_tokens: toolResultsSoFar ? 2600 : 0, cache_creation_input_tokens: toolResultsSoFar ? 0 : 2600 };
  // [pattern on the latest user text, tools to call in order, final text once they have all returned]
  const plan = [
    [/Ana Ruiz's email/, [["crm_contact_search", { query: "Ana Ruiz" }]], "Ana's email is ana.ruiz@northwind-client.example."],
    [/phone to/, [["crm_contact_search", { query: "Ana Ruiz" }], ["crm_contact_update", { contact_id: "c_ana", field: "phone", value: "555-0101" }]], "That change is waiting for your approval."],
    [/and tell me its number/, [["crm_contact_search", { query: "Ana Ruiz" }], ["invoice_create", { contact_id: "c_ana", amount_usd: 4997 }]], "Created INV-1042."],
    [/^Send invoice/, [["invoice_send", { number: "INV-1042" }]], "INV-1042 needs your approval before it goes out."],
    [/Marcus/, [["crm_contact_search", { query: "Marcus Lee" }]], "I couldn't reach the contact lookup — it timed out."],
    [/Beta Co/, [["workspace_contacts_list", { workspace: "Beta Co" }]], "I can't list that workspace — you don't have access to it."],
    [/In one sentence/, [], "I handle your clients, follow-ups and invoices."],
    [/workshop/, [], "Join our client workshop on May 2."],
    [/Approved — send it/, [], "Approved and accepted by the email provider; delivery isn't confirmed yet."],
    [/Where did/, [], "You told me $4,997 in this conversation."],
    [/total due/, [], "The total due is $1,250.00."],
    [/renewal/, [], "Ana's renewal is March 14."],
    [/Q4 retainer invoice for Ana/, [], "INV-1042 already exists for that."],
    [/Using ONLY/, [], JSON.stringify({ findings: [{ claim: "Ireland 12.5%", source_ids: ["S1"] }, { claim: "Singapore 17%", source_ids: ["S2"] }] })],
  ];
  const hit = plan.find(([re]) => re.test(userText));
  const tool = hit?.[1]?.[toolResultsSoFar] ?? null;
  const text = hit?.[2] ?? "OK.";
  const model = body.model;
  if (!body.stream) {
    return new Response(JSON.stringify({ id: "m", model, content: [{ type: "text", text }], stop_reason: "end_turn", usage }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
  const parts = [ev({ type: "message_start", message: { id: "m", model, usage } })];
  if (tool) {
    parts.push(ev({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2, 9)}`, name: tool[0], input: {} } }));
    parts.push(ev({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool[1]) } }));
    parts.push(ev({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } }));
  } else {
    parts.push(ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
    parts.push(ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }));
    parts.push(ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 30 } }));
  }
  parts.push(ev({ type: "message_stop" }));
  return new Response(parts.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}
