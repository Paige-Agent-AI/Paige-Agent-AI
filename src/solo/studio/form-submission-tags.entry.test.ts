// @vitest-environment node
// Actual original contact_upsert executor with captured native ports. This does
// not prove service authentication, PostgreSQL locks, audit or transactions.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { applySubmissionFutureTags } from "../../../supabase/functions/_shared/growth/form-submission-tags";

const revision = process.env.FORM_TAG_ENTRY_SOURCE;
if (revision && !/^[a-f0-9]{40}$/.test(revision)) throw Error("Invalid immutable processor source");
const source = revision ? execFileSync("git", ["show", `${revision}:supabase/functions/growth-process-submission/index.ts`], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
  : readFileSync("supabase/functions/growth-process-submission/index.ts", "utf8");
const ast = ts.createSourceFile("processor.ts", source, ts.ScriptTarget.Latest, true), nodes: ts.Node[] = [];
function visit(node: ts.Node) { nodes.push(node); ts.forEachChild(node, visit); } visit(ast);
const declarations = ["s", "schemaSections", "extractIdentity", "extractCustomFields", "resolveIntakeOperator", "runExecutor"].map(name => {
  const matches = nodes.filter(ts.isFunctionDeclaration).filter(node => node.name?.text === name);
  if (matches.length !== 1) throw Error(`Original executor/helper missing or ambiguous: ${name}`); return matches[0].getText(ast);
}).join("\n");
const TENANT = "11111111-1111-4111-8111-111111111111", FORM = "22222222-2222-4222-8222-222222222222", SUB = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444", ACTOR = "55555555-5555-4555-8555-555555555555", AUTO = "66666666-6666-4666-8666-666666666666";
const AUDIT = "77777777-7777-4777-8777-777777777777", DATE = "2026-11-13T17:05:06.123456+00:00", SAVED = "2026-11-13T17:06:06.654321+00:00";
type Row = Record<string, unknown>;
type Reply = { data: unknown; error: unknown };
const recorded = (overrides: Row = {}) => ({ v: 1, submission_id: SUB, tenant_id: TENANT, form_id: FORM, contact_id: CONTACT, automation_id: AUTO,
  operator_user_id: ACTOR, outcome: "applied", future_tags: ["New tag"], config_digest: "a".repeat(64), source_updated_at: DATE, saved_updated_at: SAVED, audit_id: AUDIT, ...overrides });
type Options = { contact?: "linked" | "resolved" | "new"; tags?: unknown; prior?: unknown; automation?: string | null;
  apply?: Reply; state?: Reply; version?: unknown; pinError?: boolean; operator?: string | null };
function world(options: Options = {}) {
  const calls: Array<{ name: string; args: Row }> = [], tables: Array<{ table: string; columns: string; filters: unknown[][]; values?: unknown }> = [];
  const record = recorded({ automation_id: options.automation === null ? null : AUTO });
  const rpc = async (name: string, args: Row): Promise<Reply> => {
    calls.push({ name, args });
    if (name === "resolve_contact_id") return { data: options.contact === "new" ? null : CONTACT, error: null };
    if (name === "create_contact") return { data: CONTACT, error: null };
    if (name === "client_custom_fields_upsert") return { data: null, error: null };
    if (name === "growth_apply_submission_contact_tags") return options.apply ?? { data: { ok: true, state: "recorded", replayed: false, result: record }, error: null };
    if (name === "growth_submission_contact_tags_state") return options.state ?? { data: { ok: true, state: "recorded", replayed: true, result: record }, error: null };
    throw Error(`Unexpected RPC ${name}`);
  };
  const admin = { rpc, from: (table: string) => {
    const read = { table, columns: "", filters: [] as unknown[][], values: undefined as unknown }; tables.push(read);
    const q = { select: (columns: string) => { read.columns = columns; return q; }, eq: (key: string, value: unknown) => { read.filters.push(["eq", key, value]); return q; },
      is: (key: string, value: unknown) => { read.filters.push(["is", key, value]); return q; }, in: () => q, limit: () => q, order: () => q,
      update: (values: unknown) => { read.values = values; return q; }, maybeSingle: async () => ({ data: table === "clients" ? { id: CONTACT, updated_at: options.version ?? DATE }
        : table === "tenant_members" ? { user_id: options.operator === undefined ? ACTOR : options.operator } : options.pinError ? null : { id: SUB }, error: null }) }; return q;
  } };
  const form = { id: FORM, tenant_id: TENANT, created_by: ACTOR, future_tags: options.tags === undefined ? ["New tag"] : options.tags, schema_json: [] };
  const submission = { id: SUB, tenant_id: TENANT, form_id: FORM, contact_id: CONTACT, contact_tags_result: options.prior ?? null };
  const ctx = { admin, tenantId: TENANT, submissionId: SUB, claimAttempt: 1, form, payload: { email: "lead@example.test" }, submission,
    contactId: !options.contact || options.contact === "linked" ? CONTACT : null, setContactId: (id: string) => { ctx.contactId = id; } };
  const plan = { automationId: options.automation === null ? null : AUTO, slug: "contact_upsert", executor: "contact_upsert", lane: null, config: { future_tags: form.future_tags }, targetConfig: {} };
  const code = ts.transpileModule(declarations + "\nreturn runExecutor;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const run = new Function("applySubmissionFutureTags", code)(applySubmissionFutureTags) as (plan: Row, ctx: Row) => Promise<{ status: string; result: Row; error?: string }>;
  return { run: () => run(plan, ctx), calls, tables, record, ctx };
}
const applies = (w: ReturnType<typeof world>) => w.calls.filter(c => c.name === "growth_apply_submission_contact_tags");

describe("actual original contact_upsert → causal future-tag seam", () => {
  it.each(["linked", "resolved", "new"] as const)("%s contact keeps original resolve/create/pin and applies through only the bounded original native adapter", async contact => {
    const w = world({ contact }), result = await w.run(); expect(result.status).toBe("done"); expect(applies(w)).toHaveLength(1);
    expect(applies(w)[0].args).toEqual({ p_submission_id: SUB, p_claim_attempt: 1, p_automation_id: AUTO, p_contact_id: CONTACT, p_actor_user_id: ACTOR,
      p_expected_updated_at: DATE, p_expected_future_tags: ["New tag"] });
    expect(result.result).toHaveProperty("contact_id", CONTACT); expect(result.result).toHaveProperty("contact_tags.audit_id", AUDIT);
    expect(w.calls.some(c => c.name === "upsert_contact")).toBe(false);
    if (contact === "new") expect(w.calls.find(c => c.name === "create_contact")?.args).toMatchObject({ p_channel: "form", p_tags: [] });
    if (contact !== "linked") expect(w.tables.find(c => c.table === "growth_form_submissions")?.filters).toEqual(expect.arrayContaining([["eq", "tenant_id", TENANT], ["eq", "attempts", 1], ["is", "contact_id", null]]));
  });
  it("legacy NULL automation retains its original submission identity", async () => {
    const w = world({ automation: null }); expect((await w.run()).status).toBe("done"); expect(applies(w)[0].args.p_automation_id).toBeNull();
  });
  it("a failed original contact pin never reaches the tag adapter", async () => {
    const w = world({ contact: "new", pinError: true }); expect((await w.run()).status).toBe("error"); expect(applies(w)).toEqual([]);
  });
  it("empty settings retain the original contact path with no new native operation", async () => {
    const w = world({ tags: [] }); expect((await w.run()).status).toBe("done"); expect(w.calls).toEqual([]);
  });
  it("native stale 40001 is a refusal and never triggers a tag fallback or state blessing", async () => {
    const w = world({ apply: { data: null, error: { code: "40001", message: "CONTACT_VERSION_STALE" } } });
    expect((await w.run()).status).toBe("error"); expect(w.calls.map(c => c.name)).toEqual(["growth_apply_submission_contact_tags"]);
  });
  it("lost apply ACK recovers only the same original native causal result", async () => {
    const w = world({ apply: { data: null, error: { message: "response lost" } } }); const result = await w.run();
    expect(result.status).toBe("done"); expect(w.calls.map(c => c.name)).toEqual(["growth_apply_submission_contact_tags", "growth_submission_contact_tags_state"]);
    expect(w.calls[1].args).toEqual({ p_submission_id: SUB, p_contact_id: CONTACT, p_automation_id: AUTO }); expect(result.result).toHaveProperty("contact_tags.audit_id", AUDIT);
  });
  it("lost apply ACK plus absent/UNKNOWN result never certifies current tag membership or replays", async () => {
    const w = world({ apply: { data: null, error: { message: "response lost" } }, state: { data: { ok: false, code: "unknown" }, error: null } });
    expect((await w.run()).status).toBe("error"); expect(w.calls.map(c => c.name)).toEqual(["growth_apply_submission_contact_tags", "growth_submission_contact_tags_state"]);
    expect(w.tables.filter(c => c.table === "clients").map(c => c.columns)).toEqual(["id,updated_at"]);
  });
  it("an existing causal checkpoint uses read-only state and retains historic tags after configuration changes", async () => {
    const w = world({ prior: recorded(), tags: [] }); const result = await w.run();
    expect(result.status).toBe("done"); expect(w.calls.map(c => c.name)).toEqual(["growth_submission_contact_tags_state"]);
    expect(result.result).toHaveProperty("contact_tags.future_tags", ["New tag"]); expect(w.tables.some(c => c.table === "clients")).toBe(false);
  });
});
