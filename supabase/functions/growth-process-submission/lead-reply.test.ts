// growth-process-submission — the lead-reply step, driven against an in-memory service client.
// Nothing here reaches a network or a database. The readiness read is the REAL
// resolveCommsEmailParties over in-memory rows, except where a test injects a failure.
//
// Run: node --import ./scripts/client-memory-authz/register.mjs --test \
//        supabase/functions/growth-process-submission/lead-reply.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

import {
  appendLeadReply, fileLeadReply, isSoloBusiness, isTransientDbError, leadReplyKeyPoints, leadReplyPayload,
  LEAD_REPLIES_PER_BUSINESS_PER_DAY, LEAD_REPLIES_PER_BUSINESS_PER_HOUR, LEAD_REPLY_ACTION_KIND, LEAD_REPLY_INTENT,
  type PlanStep,
} from "./lead-reply.ts";

const T = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000009";
const S = "50000000-0000-4000-8000-000000000001", F = "60000000-0000-4000-8000-000000000001";
const C = "30000000-0000-4000-8000-000000000001", K = "70000000-0000-4000-8000-000000000001";
const NOW = new Date("2027-10-30T12:00:00.000Z");
type Row = Record<string, unknown>;
type Err = { code?: string; message?: string } | null;

// ── In-memory service client: just the query shapes lead-reply.ts and the readiness resolver use. ──
function db(tables: Record<string, Row[]>, opts: { fail?: Record<string, Err>; rpc?: (fn: string, args: Row) => { data: unknown; error: Err } } = {}) {
  const reads: { table: string; filters: unknown[][] }[] = [];
  const updates: { table: string; values: Row; filters: unknown[][] }[] = [];
  const rpcs: { fn: string; args: Row }[] = [];
  const matches = (r: Row, f: unknown[]) => {
    const [op, k, v] = f as [string, string, unknown];
    const val = k.includes("->>") ? (r[k.split("->>")[0]] as Row | undefined)?.[k.split("->>")[1]] : r[k];
    if (op === "eq") return val === v;
    if (op === "gte") return String(val) >= String(v);
    if (op === "not_is_null") return val !== null && val !== undefined;
    return false;
  };
  const admin = {
    rpc: (fn: string, args: Row) => {
      rpcs.push({ fn, args });
      return Promise.resolve(opts.rpc ? opts.rpc(fn, args) : { data: null, error: { message: "no rpc" } });
    },
    from: (table: string) => ({
      select: (_cols: string, sel?: { count?: string; head?: boolean }) => {
        const filters: unknown[][] = []; reads.push({ table, filters });
        const err = opts.fail?.[`select:${table}`] ?? null;
        const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => matches(r, f)));
        const q = {
          eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return q; },
          gte: (k: string, v: unknown) => { filters.push(["gte", k, v]); return q; },
          limit: () => q,
          maybeSingle: () => Promise.resolve(err ? { data: null, error: err } : { data: rows()[0] ?? null, error: null }),
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve(err ? { data: null, count: null, error: err }
              : sel?.head ? { data: null, count: rows().length, error: null } : { data: rows(), error: null }).then(res, rej),
        };
        return q;
      },
      update: (values: Row) => {
        const filters: unknown[][] = []; updates.push({ table, values, filters });
        const err = opts.fail?.[`update:${table}`] ?? null;
        const q = {
          eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return q; },
          not: (k: string) => { filters.push(["not_is_null", k]); return q; },
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
            if (!err) for (const r of tables[table] ?? []) if (filters.every((f) => matches(r, f))) Object.assign(r, values);
            return Promise.resolve({ data: null, error: err }).then(res, rej);
          },
        };
        return q;
      },
    }),
  };
  return { admin, reads, updates, rpcs };
}

const contact = (email: string | null, tenant = T): Row => ({
  id: C, tenant_id: tenant, first_name: "Rae", last_name: "Lead", entity_name: null,
  client_contact_methods: email ? [{ kind: "email", value: email, label: null, is_primary: true, position: 0 }] : [],
});
const sender = (over: Row = {}): Row => ({
  id: K, tenant_id: T, channel_type: "email", provider: "resend", from_address: "hello@business.test", active: true, status: "active", ...over,
});
const submission = (): Row => ({ id: S, tenant_id: T, lead_reply_skipped_reason: null });
const ready = (extra: Record<string, Row[]> = {}) => ({
  clients: [contact("rae@visitor.test")], channel_connectors: [sender()], growth_form_submissions: [submission()],
  paige_actions: [] as Row[], ...extra,
});
const filedOk = () => ({ data: { ok: true, action_id: "80000000-0000-4000-8000-000000000001", status: "filed" }, error: null });
const input = (over: Partial<Parameters<typeof fileLeadReply>[1]> = {}) => ({
  tenantId: T, submissionId: S, formId: F, formName: "Website enquiry", contactId: C,
  answers: [{ label: "What do you need?", value: "A strategy session" }, { label: "Budget", value: "$2,000" }],
  visitorName: "Rae Lead", now: NOW, ...over,
});
const skippedReason = (_h: ReturnType<typeof db>, tables: Record<string, Row[]>) =>
  (tables.growth_form_submissions[0] as Row).lead_reply_skipped_reason;

// ── The plan decision ──────────────────────────────────────────────────────────────────────────
const contactStep: PlanStep = { automationId: null, slug: "contact_upsert", executor: "contact_upsert", lane: null, config: {}, targetConfig: {} };
const solo = { id: T, parent_tenant_id: null, account_type: "standalone" };

test("Solo is a top-level standalone business — never a sub-account, an agency or an unread row", () => {
  assert.equal(isSoloBusiness(solo), true);
  assert.equal(isSoloBusiness({ ...solo, parent_tenant_id: OTHER }), false); // a sub-account, even if mislabelled standalone
  assert.equal(isSoloBusiness({ ...solo, account_type: "sub_account", parent_tenant_id: OTHER }), false);
  assert.equal(isSoloBusiness({ ...solo, account_type: "agency" }), false);
  assert.equal(isSoloBusiness({ ...solo, account_type: "enterprise" }), false);
  assert.equal(isSoloBusiness(null), false);
});

test("appendLeadReply adds ONE unledgered step, last, for a Solo business", () => {
  const plan: PlanStep[] = [contactStep];
  appendLeadReply(plan, { id: F }, solo);
  appendLeadReply(plan, { id: F }, solo); // planned once, however often it is asked
  assert.deepEqual(plan.map((p) => p.executor), ["contact_upsert", "lead_reply_draft"]);
  assert.equal(plan[1].automationId, null); // never a growth_form_automations row (§58: keeps the legacy column fallback)
  assert.equal(plan[1].lane, null);
});

test("appendLeadReply plans nothing for a sub-account, an agency or an unreadable business", () => {
  for (const t of [{ ...solo, parent_tenant_id: OTHER, account_type: "sub_account" }, { ...solo, account_type: "agency" }, null]) {
    const plan: PlanStep[] = [contactStep];
    appendLeadReply(plan, { id: F }, t);
    assert.deepEqual(plan.map((p) => p.executor), ["contact_upsert"]);
  }
});

test("appendLeadReply defers to a form's own enabled paige_action automation — never a second draft", () => {
  const plan: PlanStep[] = [contactStep, { automationId: "a", slug: "paige_follow_up", executor: "paige_action", lane: null, config: {}, targetConfig: { action_kind: "owner.lead_followup" } }];
  appendLeadReply(plan, { id: F }, solo);
  assert.deepEqual(plan.map((p) => p.executor), ["contact_upsert", "paige_action"]);
});

// ── The payload contract ───────────────────────────────────────────────────────────────────────
test("the payload carries the submission, the form and a composer-ready brief — and no recipient address", () => {
  const p = leadReplyPayload({ submissionId: S, formId: F, keyPoints: ["Budget: $2,000"], recipientName: "Rae Lead" });
  assert.deepEqual(p, {
    submission_id: S, form_id: F, source: "growth_form",
    draft_input: { intent: LEAD_REPLY_INTENT, key_points: ["Budget: $2,000"], tone: "warm", length: "short", recipient_name: "Rae Lead" },
  });
  assert.equal(JSON.stringify(p).includes("@"), false);
  assert.equal("recipient_name" in (leadReplyPayload({ submissionId: S, formId: F, keyPoints: [], recipientName: null }).draft_input as Row), false);
});

test("key points are the labelled answers, bounded in count and length", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ label: `Q${i}`, value: "x".repeat(900) }));
  const points = leadReplyKeyPoints(many);
  assert.equal(points.length, 20);
  assert.ok(points.every((p) => p.length <= 500));
  assert.equal(leadReplyKeyPoints([{ label: "Budget", value: "$2,000" }])[0], "Budget: $2,000");
});

// ── The run decision ───────────────────────────────────────────────────────────────────────────
test("files ONE owner.lead_followup for the claimed tenant and the intake's contact, at the kind's default lane", async () => {
  const tables = ready();
  const h = db(tables, { rpc: filedOk });
  const out = await fileLeadReply(h.admin, input());
  assert.deepEqual(out, { status: "done", result: { action_id: "80000000-0000-4000-8000-000000000001", action_kind: LEAD_REPLY_ACTION_KIND, status: "filed" } });
  assert.equal(h.rpcs.length, 1);
  const { fn, args } = h.rpcs[0];
  assert.equal(fn, "file_action");
  assert.equal(args.p_action_kind, "owner.lead_followup");
  assert.equal(args.p_tenant_id, T);
  assert.equal(args.p_contact_id, C);
  assert.equal(args.p_autonomy_lane, null); // never 'auto': the kind's default (confirm) applies
  assert.deepEqual(args.p_payload, {
    submission_id: S, form_id: F, source: "growth_form",
    draft_input: { intent: LEAD_REPLY_INTENT, key_points: ["What do you need?: A strategy session", "Budget: $2,000"], tone: "warm", length: "short", recipient_name: "Rae Lead" },
  });
  // Every read is scoped to the claimed tenant.
  for (const r of h.reads.filter((r) => r.table !== "clients")) assert.ok(r.filters.some((f) => f[1] === "tenant_id" && f[2] === T), r.table);
});

test("already drafted for this submission → done, nothing filed", async () => {
  const tables = ready({ paige_actions: [{ id: "existing", tenant_id: T, action_kind: LEAD_REPLY_ACTION_KIND, status: "pending_approval", payload: { submission_id: S }, created_at: NOW.toISOString() }] });
  const h = db(tables, { rpc: filedOk });
  const out = await fileLeadReply(h.admin, input());
  assert.deepEqual(out, { status: "done", result: { note: "lead_reply_already_drafted", action_id: "existing", status: "pending_approval" } });
  assert.equal(h.rpcs.length, 0);
});

test("another business's action for the same submission id does not count as drafted", async () => {
  const tables = ready({ paige_actions: [{ id: "foreign", tenant_id: OTHER, action_kind: LEAD_REPLY_ACTION_KIND, payload: { submission_id: S }, created_at: NOW.toISOString() }] });
  const h = db(tables, { rpc: filedOk });
  assert.equal((await fileLeadReply(h.admin, input())).result.action_id, "80000000-0000-4000-8000-000000000001");
});

test("a lost race (duplicate key 23505) is success, never an error", async () => {
  const tables = ready();
  const h = db(tables, { rpc: () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }) });
  assert.deepEqual(await fileLeadReply(h.admin, input()), { status: "done", result: { note: "lead_reply_already_drafted" } });
});

for (const [name, over, tablesOver, reason] of [
  ["no contact from the intake", { contactId: null }, {}, "no_contact"],
  ["the contact has no email", {}, { clients: [contact(null)] }, "no_contact_email"],
  ["the contact is not this business's", {}, { clients: [contact("rae@visitor.test", OTHER)] }, "contact_not_in_workspace"],
  ["no active email sender", {}, { channel_connectors: [] }, "no_email_sender"],
  ["the only sender is inactive", {}, { channel_connectors: [sender({ active: false })] }, "no_email_sender"],
  ["the only sender belongs to another business", {}, { channel_connectors: [sender({ tenant_id: OTHER })] }, "no_email_sender"],
] as const) {
  test(`no draft when ${name} — reason recorded on the submission, nothing filed`, async () => {
    const tables = ready(tablesOver as Record<string, Row[]>);
    const h = db(tables, { rpc: filedOk });
    const out = await fileLeadReply(h.admin, input(over as Partial<Parameters<typeof fileLeadReply>[1]>));
    assert.deepEqual(out, { status: "done", result: { note: "lead_reply_not_drafted", reason } });
    assert.equal(h.rpcs.length, 0);
    assert.equal(skippedReason(h, tables), reason);
    const mark = h.updates.find((u) => u.table === "growth_form_submissions");
    assert.deepEqual(mark?.filters, [["eq", "id", S], ["eq", "tenant_id", T]]);
  });
}

test("several active senders can still send: a draft is filed", async () => {
  const tables = ready({ channel_connectors: [sender(), sender({ id: "70000000-0000-4000-8000-000000000002", from_address: "team@business.test" })] });
  const h = db(tables, { rpc: filedOk });
  assert.equal((await fileLeadReply(h.admin, input())).status, "done");
  assert.equal(h.rpcs.length, 1);
});

test("an unreadable readiness answer drafts nothing and says so", async () => {
  const tables = ready();
  const h = db(tables, { rpc: filedOk });
  const out = await fileLeadReply(h.admin, input(), { resolveParties: () => Promise.reject(new Error("sender_read_failed")) });
  assert.deepEqual(out, { status: "done", result: { note: "lead_reply_not_drafted", reason: "email_readiness_unreadable" } });
  assert.equal(h.rpcs.length, 0);
});

const recent = (n: number, minutesAgo: number): Row[] => Array.from({ length: n }, (_, i) => ({
  id: `r${minutesAgo}-${i}`, tenant_id: T, action_kind: LEAD_REPLY_ACTION_KIND, payload: { submission_id: `other-${minutesAgo}-${i}` },
  created_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
}));

test("the hourly cap stops drafting at exactly the cap; the lead itself is untouched", async () => {
  const under = ready({ paige_actions: recent(LEAD_REPLIES_PER_BUSINESS_PER_HOUR - 1, 10) });
  const h1 = db(under, { rpc: filedOk });
  assert.equal((await fileLeadReply(h1.admin, input())).result.action_id, "80000000-0000-4000-8000-000000000001");

  const at = ready({ paige_actions: recent(LEAD_REPLIES_PER_BUSINESS_PER_HOUR, 10) });
  const h2 = db(at, { rpc: filedOk });
  const out = await fileLeadReply(h2.admin, input());
  assert.deepEqual(out, { status: "done", result: { note: "lead_reply_not_drafted", reason: "business_hourly_cap", business_last_hour: 20, business_last_day: 20 } });
  assert.equal(h2.rpcs.length, 0);
  assert.equal(skippedReason(h2, at), "business_hourly_cap");
});

test("the daily cap counts the last 24 hours only, and only this business's drafts", async () => {
  const at = ready({ paige_actions: [...recent(LEAD_REPLIES_PER_BUSINESS_PER_DAY, 120), ...recent(50, 60 * 30)] });
  const h = db(at, { rpc: filedOk });
  assert.equal((await fileLeadReply(h.admin, input())).result.reason, "business_daily_cap");

  const foreign = ready({ paige_actions: recent(LEAD_REPLIES_PER_BUSINESS_PER_DAY, 120).map((r) => ({ ...r, tenant_id: OTHER })) });
  const h2 = db(foreign, { rpc: filedOk });
  assert.equal((await fileLeadReply(h2.admin, input())).status, "done");
  assert.equal(h2.rpcs.length, 1);
});

test("a failure that never reached a database answer is retried; a refusal is recorded, not retried", async () => {
  const transient = db(ready(), { rpc: () => ({ data: null, error: { code: "", message: "TypeError: fetch failed" } }) });
  const out = await fileLeadReply(transient.admin, input());
  assert.equal(out.status, "error");
  assert.match(out.error ?? "", /^lead_reply_file_failed/);

  const tables = ready();
  const refused = db(tables, { rpc: () => ({ data: null, error: { code: "22023", message: "ACTION_KIND_UNAVAILABLE: owner.lead_followup not available for tenant" } }) });
  assert.deepEqual(await fileLeadReply(refused.admin, input()),
    { status: "done", result: { note: "lead_reply_not_drafted", reason: "file_refused:ACTION_KIND_UNAVAILABLE" } });

  const capUnreadable = db(ready(), { rpc: filedOk, fail: { "select:paige_actions": { code: "42P01", message: "relation missing" } } });
  assert.equal((await fileLeadReply(capUnreadable.admin, input())).result.reason, "lead_reply_unavailable");

  const capFlaky = db(ready(), { rpc: filedOk, fail: { "select:paige_actions": { code: "PGRST003", message: "pool timeout" } } });
  assert.equal((await fileLeadReply(capFlaky.admin, input())).status, "error");
  assert.equal(capFlaky.rpcs.length, 0);
});

test("transient classification matches the processor's default-pipeline rule", () => {
  for (const code of ["", "40001", "40P01", "PGRST000", "PGRST003", "08006", "53300", "57014"]) assert.equal(isTransientDbError({ code }), true, code);
  for (const code of ["23505", "22023", "42501", "PGRST202", "42P01"]) assert.equal(isTransientDbError({ code }), false, code);
  assert.equal(isTransientDbError(null), false);
});

test("a later successful draft clears an earlier attempt's skip reason", async () => {
  const tables = ready({ growth_form_submissions: [{ ...submission(), lead_reply_skipped_reason: "no_contact" }] });
  const h = db(tables, { rpc: filedOk });
  assert.equal((await fileLeadReply(h.admin, input())).status, "done");
  assert.equal(skippedReason(h, tables), null);
});

// ── The processor wiring (the actual index.ts) ─────────────────────────────────────────────────
const processor = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("the step is planned after the intake steps, from the claimed tenant's business row — never the request body", () => {
  assert.match(processor, /applyIntakeSettings\(plan, form\);\s*appendDefaultIntake\(plan, form, \(rows\?\.length \?\? 0\) > 0\);/);
  const planning = processor.slice(processor.indexOf("appendDefaultIntake(plan, form, (rows"), processor.indexOf("// Existing dispatch ledger"));
  assert.match(planning, /\.from\("tenants"\)[\s\S]*\.eq\("id", tenantId\)[\s\S]*appendLeadReply\(plan, form, businessErr \? null : business\);/);
  assert.equal(planning.includes("body."), false);
  // tenantId is the claimed row's, never the body's.
  assert.match(processor, /const tenantId: string = claim\.tenant_id;/);
  // No automation row is written for it (that would drop the legacy auto_create_contact step).
  assert.equal(/growth_form_automations"\)\s*\.(insert|upsert)/.test(processor), false);
});

test("the executor arm hands the intake's contact and the filtered labelled answers to fileLeadReply", async () => {
  const body = processor.slice(processor.indexOf("async function runExecutor("), processor.indexOf("// -- A form's alert address"));
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls: unknown[][] = [];
  const runExecutor = new Function("s", "extractIdentity", "labelledAnswers", "fileLeadReply", `${js};return runExecutor;`)(
    (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null),
    () => ({ firstName: "Rae", lastName: "Lead", email: "rae@visitor.test" }),
    (_payload: unknown, schema: unknown) => [{ label: "from", value: String(schema) }],
    (...args: unknown[]) => { calls.push(args); return Promise.resolve({ status: "done", result: { action_id: "a" } }); },
  ) as (p: unknown, ctx: unknown) => Promise<{ status: string; result: Row }>;
  const admin = { marker: true };
  const out = await runExecutor(
    { automationId: null, slug: "lead_reply", executor: "lead_reply_draft", lane: null, config: {}, targetConfig: {} },
    { admin, tenantId: T, submissionId: S, claimAttempt: 1, form: { id: F, name: " Website enquiry ", schema_json: "SCHEMA" }, payload: {}, submission: {}, contactId: C, setContactId: () => {} },
  );
  assert.deepEqual(out, { status: "done", result: { action_id: "a" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], admin);
  assert.deepEqual(calls[0][1], {
    tenantId: T, submissionId: S, formId: F, formName: "Website enquiry", contactId: C,
    answers: [{ label: "from", value: "SCHEMA" }], visitorName: "Rae Lead",
  });
});

test("labelledAnswers (the helper the step reuses) still drops identity numbers before anything leaves", () => {
  assert.match(processor, /const SENSITIVE_FIELD_TYPES = new Set\(\["ssn4"\]\);/);
  assert.match(processor, /if \(SENSITIVE_FIELD_TYPES\.has\(f\.type\)\) continue;/);
});
