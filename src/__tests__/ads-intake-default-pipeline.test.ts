// Every form/external lead lands in a pipeline (owner ruling 2026-10-11) — the edge half.
// Runs the ACTUAL growth-process-submission executor + plan step and the ACTUAL growth-inbound
// handler (transpiled from source, dependencies injected), the same way
// growth-submission-client-replay.test.ts exercises the executor. The database half — routing,
// reuse without moving, skipped, tenant refusals — is proven in supabase/tests/ads_intake_default_pipeline.sql.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

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
const appendDefaultIntake = new Function(transpile(appendSrc) + ";return appendDefaultIntake;")() as (plan: any[], form: any) => void;

function ctx(rpc: (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>, over: Record<string, unknown> = {}) {
  const writes: unknown[] = [];
  const admin = { rpc, from: (table: string) => { writes.push(table); throw new Error(`unexpected table access: ${table}`); } };
  return { writes, ctx: { admin, tenantId: "tenant", submissionId: "submission", claimAttempt: 2, form: { schema_json: null },
    payload: {}, submission: {}, contactId: "client", setContactId: () => {}, ...over } };
}
const step = (creates_contact = true) => ({ automationId: null, slug: "pipeline_attach_default", executor: "pipeline_attach_default",
  lane: null, config: { creates_contact }, targetConfig: {} });

describe("pipeline_attach_default executor", () => {
  it("files through the default-deal admission with the claimed attempt, and nothing else", async () => {
    const calls: unknown[] = [];
    const h = ctx(async (...args) => { calls.push(args); return { data: { deal_id: "deal", stage_id: "stage", default_pipeline: true }, error: null }; });
    const out = await runExecutor(step(), h.ctx);
    expect(out).toEqual({ status: "done", result: { deal_id: "deal", stage_id: "stage", default_pipeline: true } });
    expect(calls).toEqual([["growth_attach_submission_default_deal", { p_submission_id: "submission", p_claim_attempt: 2 }]]);
    expect(h.writes).toEqual([]);
  });
  it("reports a skipped filing as done, as it is — not as a deal", async () => {
    const h = ctx(async () => ({ data: { skipped: "no_default_pipeline" }, error: null }));
    expect(await runExecutor(step(), h.ctx)).toEqual({ status: "done", result: { skipped: "no_default_pipeline" } });
  });
  it("reports a refusal as an error with the database's reason and makes no direct write", async () => {
    const h = ctx(async () => ({ data: null, error: { message: "FORM_DEAL_STALE_CLAIM" } }));
    const out = await runExecutor(step(), h.ctx);
    expect(out.status).toBe("error");
    expect(out.error).toBe("submission_default_deal_failed: FORM_DEAL_STALE_CLAIM");
    expect(h.writes).toEqual([]);
  });
  it("without a contact: nothing to file when there is no identity, or when the form never makes contacts", async () => {
    let called = false;
    const rpc = async () => { called = true; return { data: {}, error: null }; };
    expect((await runExecutor(step(true), ctx(rpc, { contactId: null }).ctx)).status).toBe("done");
    expect((await runExecutor(step(false), ctx(rpc, { contactId: null, payload: { email: "a@b.test" } }).ctx)).status).toBe("done");
    expect(called).toBe(false);
  });
  it("without a contact where the form should have made one: an error the sweeper retries", async () => {
    const out = await runExecutor(step(true), ctx(async () => ({ data: {}, error: null }), { contactId: null, payload: { email: "a@b.test" } }).ctx);
    expect(out).toEqual({ status: "error", result: {}, error: "no_contact_for_pipeline" });
  });
});

describe("appendDefaultIntake plan step", () => {
  const contact = { automationId: "c", slug: "contact_upsert", executor: "contact_upsert" };
  it("adds one unledgered default step after the contact step for an unrouted form", () => {
    const plan: Array<Record<string, unknown>> = [contact, { executor: "email_alert" }];
    appendDefaultIntake(plan, { auto_create_deal: false, pipeline_id: null });
    appendDefaultIntake(plan, { auto_create_deal: false, pipeline_id: null });
    expect(plan.map((p) => p.executor)).toEqual(["contact_upsert", "email_alert", "pipeline_attach_default"]);
    expect(plan[2]).toMatchObject({ automationId: null, config: { creates_contact: true } });
  });
  it("records that a form without a contact step makes no contacts", () => {
    const plan: Array<Record<string, unknown>> = [];
    appendDefaultIntake(plan, { auto_create_deal: false, pipeline_id: "p" });
    expect(plan).toEqual([expect.objectContaining({ executor: "pipeline_attach_default", config: { creates_contact: false } })]);
  });
  it("leaves a routed form's one route alone", () => {
    const routedByRow: Array<Record<string, unknown>> = [contact, { executor: "pipeline_attach", automationId: "r" }];
    appendDefaultIntake(routedByRow, { auto_create_deal: false, pipeline_id: null });
    expect(routedByRow.map((p) => p.executor)).toEqual(["contact_upsert", "pipeline_attach"]);
    const routedByColumns: Array<Record<string, unknown>> = [contact];
    appendDefaultIntake(routedByColumns, { auto_create_deal: true, pipeline_id: "p" });
    expect(routedByColumns.map((p) => p.executor)).toEqual(["contact_upsert"]);
  });
  it("is wired after the intake settings in the request path", () => {
    expect(processor).toMatch(/applyIntakeSettings\(plan, form\);\s*appendDefaultIntake\(plan, form\);/);
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
  new Function("Deno", "createClient", "findClientIdByAddress", "insertClientWithAddresses", "console", transpile(inboundSource))(
    Deno, () => client, async () => existingContact, async () => ({ data: { id: "new-contact" } }), { error: () => {} },
  );
  const send = async (body: unknown) => {
    const res = await handler!(new Request("https://x.test/functions/v1/growth-inbound/tok", { method: "POST", body: JSON.stringify(body) }));
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
  it("does not file without a contact", async () => {
    const h = inbound(src(null), { data: {}, error: null });
    expect((await h.send({ first_name: "No email" })).json).toEqual({ ok: true, contact_id: null });
    expect(h.rpcCalls).toEqual([]);
  });
  it.each([[{ data: null, error: { code: "42501", message: "INBOUND_DEAL_CLIENT_INVALID" } }], ["throw" as const]])(
    "a filing failure keeps the contact and never claims a deal (%#)", async (result) => {
      const h = inbound(src(null), result, "existing");
      const out = await h.send({ email: "lead@example.test" });
      expect(out.status).toBe(200);
      expect(out.json).toEqual({ ok: true, contact_id: "existing", deal: { filed: false, error: "default_pipeline_deal_failed" } });
      expect(JSON.stringify(out.json)).not.toContain("deal_id");
    });
});
