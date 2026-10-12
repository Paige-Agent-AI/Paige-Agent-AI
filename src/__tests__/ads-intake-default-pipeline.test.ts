// Every form/external lead lands in a pipeline (owner ruling 2026-10-11) — the edge half.
// Runs the ACTUAL growth-process-submission executor + plan step and the ACTUAL growth-inbound
// handler (transpiled from source, dependencies injected), the same way
// growth-submission-client-replay.test.ts exercises the executor. The database half — routing,
// reuse without moving, skipped, tenant refusals — is proven in supabase/tests/ads_intake_default_pipeline.sql.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { sanitizeUtm } from "../../supabase/functions/_shared/growth-intake";

const transpile = (src: string) => ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const processor = readFileSync("supabase/functions/growth-process-submission/index.ts", "utf8");
const executorSrc = processor.slice(processor.indexOf("async function runExecutor("), processor.indexOf("// -- A form's alert address"));
const appendSrc = processor.slice(processor.indexOf("function appendDefaultIntake("), processor.indexOf("// -- Who a public submission's contact and deal"));

type Outcome = { status: string; error?: string; result: Record<string, unknown> };
const runExecutor = new Function("s", "extractIdentity", "resolveIntakeOperator", "extractCustomFields",
  transpile(executorSrc) + ";return runExecutor;",
)(
  (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null),
  (payload: Record<string, unknown>) => ({ email: payload.email ?? null, phone: payload.phone ?? null }),
  async () => "actor",
  () => ({}),
) as (plan: unknown, ctx: unknown) => Promise<Outcome>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const appendDefaultIntake = new Function(transpile(appendSrc) + ";return appendDefaultIntake;")() as (plan: any[], form: any, hasAutomationRows: boolean) => void;

function ctx(rpc: (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>, over: Record<string, unknown> = {}) {
  const writes: unknown[] = [];
  const admin = { rpc, from: (table: string) => { writes.push(table); throw new Error(`unexpected table access: ${table}`); } };
  return { writes, ctx: { admin, tenantId: "tenant", submissionId: "submission", claimAttempt: 2, form: { schema_json: null },
    payload: {}, submission: {}, contactId: "client", setContactId: () => {}, ...over } };
}
const step = () => ({ automationId: null, slug: "pipeline_attach_default", executor: "pipeline_attach_default",
  lane: null, config: {}, targetConfig: {} });
const notFiled = (reason: string) => ({ status: "done", result: { note: "default_pipeline_not_filed", reason } });

describe("pipeline_attach_default executor", () => {
  it("files through the default-deal admission with the claimed attempt, and nothing else", async () => {
    const calls: unknown[] = [];
    const h = ctx(async (...args) => { calls.push(args); return { data: { deal_id: "deal", stage_id: "stage", default_pipeline: true }, error: null }; });
    const out = await runExecutor(step(), h.ctx);
    expect(out).toEqual({ status: "done", result: { deal_id: "deal", stage_id: "stage", default_pipeline: true } });
    expect(calls).toEqual([["growth_attach_submission_default_deal", { p_submission_id: "submission", p_claim_attempt: 2 }]]);
    expect(h.writes).toEqual([]);
  });
  it.each(["no_default_pipeline", "no_open_stage"])("reports a skipped filing (%s) as done and not filed — never as a deal", async (reason) => {
    const h = ctx(async () => ({ data: { skipped: reason, pipeline_id: "p" }, error: null }));
    expect(await runExecutor(step(), h.ctx)).toEqual(notFiled(reason));
  });
  it.each([
    [{ code: "40001", message: "FORM_DEAL_STALE_CLAIM" }],
    [{ code: "", message: "TypeError: fetch failed" }],
    [{ code: "08006", message: "connection failure" }],
    [{ code: "57014", message: "canceling statement due to statement timeout" }],
    [{ code: "40P01", message: "deadlock detected" }],
    [{ code: "PGRST003", message: "Timed out acquiring connection from connection pool." }],
    [{ code: "PGRST001", message: "Could not connect with the database" }],
  ])("retries a stale claim or a failure that never got a database answer (%#)", async (error) => {
    const h = ctx(async () => ({ data: null, error }));
    const out = await runExecutor(step(), h.ctx);
    expect(out).toEqual({ status: "error", result: {}, error: `submission_default_deal_failed: ${error.message}` });
    expect(h.writes).toEqual([]);
  });
  it.each([
    [{ code: "42501", message: "FORM_DEAL_ROUTE_INVALID" }, "FORM_DEAL_ROUTE_INVALID"],
    [{ code: "42501", message: "FORM_DEAL_OPERATOR_REQUIRED" }, "FORM_DEAL_OPERATOR_REQUIRED"],
    [{ code: "42501", message: "FORM_DEAL_TENANT_INACTIVE" }, "FORM_DEAL_TENANT_INACTIVE"],
    [{ code: "PGRST202", message: "Could not find the function public.growth_attach_submission_default_deal" }, "default_filing_unavailable"],
  ])("never fails the submission on any other refusal (%#): done, not filed, with the reason", async (error, reason) => {
    const h = ctx(async () => ({ data: null, error }));
    expect(await runExecutor(step(), h.ctx)).toEqual(notFiled(reason));
    expect(h.writes).toEqual([]);
  });
  it("an empty answer is done, not filed", async () => {
    expect(await runExecutor(step(), ctx(async () => ({ data: null, error: null })).ctx)).toEqual(notFiled("no_result"));
  });
  it("without a contact: done and not filed, whether or not the visitor left an address — and nothing is called", async () => {
    let called = false;
    const rpc = async () => { called = true; return { data: {}, error: null }; };
    expect(await runExecutor(step(), ctx(rpc, { contactId: null }).ctx)).toEqual(notFiled("no_identity"));
    expect(await runExecutor(step(), ctx(rpc, { contactId: null, payload: { email: "a@b.test" } }).ctx)).toEqual(notFiled("no_contact"));
    expect(called).toBe(false);
  });
});

describe("appendDefaultIntake plan step", () => {
  const contact = { automationId: "c", slug: "contact_upsert", executor: "contact_upsert" };
  it("adds one unledgered default step after the contact step for an unrouted form", () => {
    const plan: Array<Record<string, unknown>> = [contact, { executor: "email_alert" }];
    appendDefaultIntake(plan, { auto_create_deal: false, pipeline_id: null }, true);
    appendDefaultIntake(plan, { auto_create_deal: false, pipeline_id: null }, true);
    expect(plan.map((p) => p.executor)).toEqual(["contact_upsert", "email_alert", "pipeline_attach_default"]);
    expect(plan[2]).toMatchObject({ automationId: null, slug: "pipeline_attach_default", config: {} });
  });
  it("leaves a routed form's one route alone", () => {
    const routedByRow: Array<Record<string, unknown>> = [contact, { executor: "pipeline_attach", automationId: "r" }];
    appendDefaultIntake(routedByRow, { auto_create_deal: false, pipeline_id: null }, true);
    expect(routedByRow.map((p) => p.executor)).toEqual(["contact_upsert", "pipeline_attach"]);
    // No automation rows: the intake columns are the route.
    const routedByColumns: Array<Record<string, unknown>> = [contact];
    appendDefaultIntake(routedByColumns, { auto_create_deal: true, pipeline_id: "p" }, false);
    expect(routedByColumns.map((p) => p.executor)).toEqual(["contact_upsert"]);
  });
  it("stale intake columns under enabled automations route nothing: the form gets the default step", () => {
    const plan: Array<Record<string, unknown>> = [{ executor: "notify_team", automationId: "n" }];
    appendDefaultIntake(plan, { auto_create_deal: true, pipeline_id: "p" }, true);
    expect(plan.map((p) => p.executor)).toEqual(["notify_team", "pipeline_attach_default"]);
  });
  it("is wired after the intake settings in the request path, told whether the form has enabled automation rows", () => {
    expect(processor).toMatch(/applyIntakeSettings\(plan, form\);\s*appendDefaultIntake\(plan, form, \(rows\?\.length \?\? 0\) > 0\);/);
    // rows is the enabled-automation read the plan is built from.
    expect(processor).toMatch(/\.from\("growth_form_automations"\)[\s\S]{0,300}\.eq\("enabled", true\)/);
  });
});

// ── growth-inbound, the actual handler with its dependencies injected. ──
const inboundSource = readFileSync("supabase/functions/growth-inbound/index.ts", "utf8").replace(/^import .*$/gm, "");
type Source = { id: string; tenant_id: string; provider: string; created_by: string; target_form_id: string | null; field_map_json: null };
function inbound(source: Source, rpcResult: { data: unknown; error: unknown } | "throw", existingContact: string | null = null) {
  const rpcCalls: unknown[] = [];
  const inserts: Array<[string, unknown]> = [];
  let handler: ((req: Request) => Promise<Response>) | null = null;
  const Deno = { env: { get: () => "service-role" }, serve: (h: (req: Request) => Promise<Response>) => { handler = h; } };
  const table = (name: string) => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: name === "growth_external_sources" ? source : null, error: null }),
      insert: async (row: unknown) => { inserts.push([name, row]); return { error: null }; },
      update: () => q, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    });
    return q;
  };
  const client = { from: table, rpc: async (...args: unknown[]) => { rpcCalls.push(args); if (rpcResult === "throw") throw new Error("network"); return rpcResult; } };
  new Function("Deno", "createClient", "findClientIdByAddress", "insertClientWithAddresses", "sanitizeUtm", "console", transpile(inboundSource))(
    Deno, () => client, async () => existingContact, async () => ({ data: { id: "new-contact" } }), sanitizeUtm, { error: () => {} },
  );
  const send = async (body: unknown, query = "") => {
    const res = await handler!(new Request(`https://x.test/functions/v1/growth-inbound/tok${query}`, { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, json: await res.json() };
  };
  return { send, rpcCalls, inserts };
}
const src = (target_form_id: string | null): Source => ({ id: "src", tenant_id: "tenant", provider: "webflow", created_by: "owner", target_form_id, field_map_json: null });

describe("growth-inbound default pipeline", () => {
  it("files a contact from a source with no target form into the default pipeline", async () => {
    const h = inbound(src(null), { data: { deal_id: "deal", stage_id: "stage", created: true }, error: null });
    const out = await h.send({ email: "Lead@Example.test" });
    expect(out.status).toBe(200);
    expect(out.json).toEqual({ ok: true, contact_id: "new-contact", deal: { deal_id: "deal", stage_id: "stage", created: true } });
    expect(h.rpcCalls).toEqual([["growth_attach_inbound_default_deal", { p_tenant_id: "tenant", p_contact_id: "new-contact", p_source: "external:webflow" }]]);
  });
  it("leaves a source WITH a target form to the form processor (no direct filing)", async () => {
    const h = inbound(src("form"), { data: {}, error: null });
    const out = await h.send({ email: "lead@example.test" });
    expect(out.json).toEqual({ ok: true, contact_id: "new-contact" });
    expect(h.rpcCalls).toEqual([]);
    expect(h.inserts.map(([t]) => t)).toEqual(["growth_form_submissions"]);
  });
  it("records the lead's campaign and click tags on the submission, sanitized as public intake does", async () => {
    const h = inbound(src("form"), { data: {}, error: null });
    await h.send(
      { email: "lead@example.test", utm_campaign: "  Spring  ", utm_content: 7, fbclid: "fb1", utm: { utm_source: "meta", utm_medium: "paid" }, contact_id: "x" },
      "?utm_source=query-loses&utm_term=kw&gclid=g1&evil=1",
    );
    const [, row] = h.inserts[0] as [string, Record<string, unknown>];
    expect(row.utm_json).toEqual({ utm_source: "meta", utm_medium: "paid", utm_campaign: "Spring", utm_term: "kw", gclid: "g1", fbclid: "fb1" });
  });
  it("a blank body tag never overrides a real one from the link", async () => {
    const h = inbound(src("form"), { data: {}, error: null });
    await h.send({ email: "lead@example.test", utm_source: "", utm: { utm_campaign: "   " } }, "?utm_source=meta&utm_campaign=spring");
    expect((h.inserts[0][1] as Record<string, unknown>).utm_json).toEqual({ utm_source: "meta", utm_campaign: "spring" });
  });
  it("writes an empty tag set when the lead carries none", async () => {
    const h = inbound(src("form"), { data: {}, error: null });
    await h.send({ email: "lead@example.test" });
    expect((h.inserts[0][1] as Record<string, unknown>).utm_json).toEqual({});
  });
  it("does not file without a contact", async () => {
    const h = inbound(src(null), { data: {}, error: null });
    expect((await h.send({ first_name: "No email" })).json).toEqual({ ok: true, contact_id: null });
    expect(h.rpcCalls).toEqual([]);
  });
  it.each([[{ data: null, error: { code: "42501", message: "INBOUND_DEAL_CLIENT_INVALID" } }], [{ data: null, error: null }], [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }]])(
    "a permanent refusal keeps the contact, answers 200 and never claims a deal (%#)", async (result) => {
      const h = inbound(src(null), result, "existing");
      const out = await h.send({ email: "lead@example.test" });
      expect(out.status).toBe(200);
      expect(out.json).toEqual({ ok: true, contact_id: "existing", deal: { filed: false, error: "default_pipeline_deal_failed" } });
      expect(JSON.stringify(out.json)).not.toContain("deal_id");
    });
  it.each([
    ["throw" as const],
    [{ data: null, error: { code: "", message: "TypeError: fetch failed" } }],
    [{ data: null, error: { code: "PGRST003", message: "Timed out acquiring connection from connection pool." } }],
    [{ data: null, error: { code: "40P01", message: "deadlock detected" } }],
  ])("a transient filing failure answers 503 so the sender re-delivers, and claims no deal (%#)", async (result) => {
    const h = inbound(src(null), result, "existing");
    const out = await h.send({ email: "lead@example.test" });
    expect(out.status).toBe(503);
    expect(out.json).toEqual({ ok: false, contact_id: "existing", error: "default_pipeline_deal_retry", retryable: true });
    expect(JSON.stringify(out.json)).not.toContain("deal_id");
  });
});
