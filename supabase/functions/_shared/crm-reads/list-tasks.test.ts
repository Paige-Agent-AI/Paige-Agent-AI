// node --test supabase/functions/_shared/crm-reads/list-tasks.test.ts   (also: deno test --allow-read)
// EXP08 A2b (plan S2) — EXTRACTION PARITY for `crm_list_tasks`.
//
// `chatBranchBefore` below is the paige-ai-chat `crm_list_tasks` branch exactly as it stood at
// 6d8e5c56a (index.ts lines 17148-17165, the body of the branch at 17147), transcribed verbatim with only its free variables (admin,
// crmTenantId, args) made parameters. The chat now runs its own email lookup and then
// `listCrmTasks(admin, crmTenantId, args, { assigneeUserId })`; `chatBranchAfter` is that new call
// site, verbatim. Both run against the SAME recording fake and must produce the same wire requests
// (in order) and a byte-identical result, or throw the identical error.
//
// EVIDENCE CLASS: automated unit test of the moved code against an in-memory fake. It proves the
// move changed nothing the database or the model would see; it is not a run of the deployed chat.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listCrmTasks, CRM_TASK_LIST_COLUMNS } from "./list-tasks.ts";
// node:test's describe/it are not in Deno 2.1's node compat; this keeps one file runnable by both
// `node --test` and `deno test` (flat tests named "suite > case").
let suite = "";
const describe = (name: string, body: () => void) => { const prev = suite; suite = name; body(); suite = prev; };
const it = (name: string, fn: () => unknown) => { test(`${suite} > ${name}`, async () => { await fn(); }); };

// ------------------------------------------------------------------ the code as it stood in the chat
// deno-lint-ignore no-explicit-any
async function chatBranchBefore(admin: any, crmTenantId: string, args: any) {
  // deno-lint-ignore no-explicit-any
  let result: any = { success: false };
              const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
              let q = admin.from("tasks").select("id, title, status, due_date, track, user_id, biz_id, deal_id, source_thread_id, updated_at, created_at").eq("tenant_id", crmTenantId);
              if (args.status && args.status !== "all") q = q.eq("status", args.status);
              else if (!args.status) q = q.neq("status", "completed");
              if (args.assignee_email) {
                const { data: us } = await admin.auth.admin.listUsers();
                // deno-lint-ignore no-explicit-any
                const a = us?.users?.find((x: any) => (x.email || "").toLowerCase() === String(args.assignee_email).toLowerCase());
                q = a ? q.eq("user_id", a.id) : q.eq("user_id", "00000000-0000-0000-0000-000000000000");
              }
              const today = new Date().toISOString().slice(0, 10);
              if (args.overdue) q = q.lt("due_date", today);
              if (args.due_within_days) {
                const end = new Date(Date.now() + Number(args.due_within_days) * 86400000).toISOString().slice(0, 10);
                q = q.gte("due_date", today).lte("due_date", end);
              }
              const { data, error } = await q.order("due_date", { ascending: true, nullsFirst: false }).limit(limit);
              if (error) throw error;
              result = { success: true, count: data?.length || 0, tasks: data || [] };
  return result;
}

// ------------------------------------------------------------------ the chat's new call site, verbatim
// deno-lint-ignore no-explicit-any
async function chatBranchAfter(admin: any, crmTenantId: string, args: any) {
  // deno-lint-ignore no-explicit-any
  let result: any = { success: false };
              let assigneeUserId: string | undefined;
              if (args.assignee_email) {
                const { data: us } = await admin.auth.admin.listUsers();
                // deno-lint-ignore no-explicit-any
                const a = us?.users?.find((x: any) => (x.email || "").toLowerCase() === String(args.assignee_email).toLowerCase());
                assigneeUserId = a ? a.id : "00000000-0000-0000-0000-000000000000";
              }
              result = await listCrmTasks(admin, crmTenantId!, args, { assigneeUserId });
  return result;
}

// ------------------------------------------------------------------ one recording fake for both
type Wire = unknown[];
const TENANT = "11111111-1111-4111-8111-111111111111";
const ROWS = [
  { id: "t1", title: "Send the welcome pack", status: "open", due_date: "2026-11-02", track: null, user_id: "u-sam", biz_id: null, deal_id: null, source_thread_id: null, updated_at: "2026-10-27T10:00:00Z", created_at: "2026-10-20T10:00:00Z" },
  { id: "t2", title: "Book the kickoff", status: "in_progress", due_date: null, track: "ops", user_id: "u-priya", biz_id: null, deal_id: "d1", source_thread_id: null, updated_at: "2026-10-26T10:00:00Z", created_at: "2026-10-19T10:00:00Z" },
];
const USERS = [{ id: "u-sam", email: "Sam@Example.test" }, { id: "u-priya", email: "priya@example.test" }];

function fakeAdmin(wire: Wire, answer: { data: unknown; error: unknown }) {
  return {
    from(table: string) {
      const chain: Array<[string, unknown[]]> = [];
      // deno-lint-ignore no-explicit-any
      const builder: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") {
            // deno-lint-ignore no-explicit-any
            return (ok: any, fail: any) => { wire.push({ query: table, chain: structuredClone(chain) }); return Promise.resolve(answer).then(ok, fail); };
          }
          return (...a: unknown[]) => { chain.push([String(prop), a]); return builder; };
        },
      });
      return builder;
    },
    auth: { admin: { listUsers() { wire.push({ listUsers: true }); return Promise.resolve({ data: { users: USERS }, error: null }); } } },
  };
}

// A fixed clock, so `today` and the due window are the same instant for both runs.
const RealDate = Date;
const FIXED = RealDate.UTC(2026, 9, 28, 15, 30, 0);
class FixedDate extends RealDate {
  // deno-lint-ignore no-explicit-any
  constructor(...a: any[]) { if (a.length === 0) super(FIXED); else super(...(a as [number])); }
  static override now() { return FIXED; }
}
async function withClock<T>(fn: () => Promise<T>): Promise<T> {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).Date = FixedDate;
  // deno-lint-ignore no-explicit-any
  try { return await fn(); } finally { (globalThis as any).Date = RealDate; }
}

// deno-lint-ignore no-explicit-any
async function both(args: any, answer: { data: unknown; error: unknown } = { data: ROWS, error: null }) {
  const run = async (fn: typeof chatBranchBefore) => {
    const wire: Wire = [];
    try { return { wire, result: JSON.stringify(await fn(fakeAdmin(wire, answer), TENANT, structuredClone(args))) }; }
    catch (e) { return { wire, threw: e }; }
  };
  return withClock(async () => ({ before: await run(chatBranchBefore), after: await run(chatBranchAfter) }));
}

const CASES: Array<[string, Record<string, unknown>]> = [
  ["no filters (open tasks, default limit)", {}],
  ["status all", { status: "all" }],
  ["one status", { status: "in_progress" }],
  ["assignee by email, case-insensitive match", { assignee_email: "sam@EXAMPLE.test" }],
  ["assignee by email, no match → the zero id", { assignee_email: "nobody@example.test" }],
  ["overdue", { overdue: true }],
  ["due within 7 days", { due_within_days: 7 }],
  ["everything at once, limit clamped high", { status: "open", assignee_email: "priya@example.test", overdue: true, due_within_days: "3", limit: 500 }],
  ["limit clamped low and non-numeric", { limit: -4 }],
  ["limit as text", { limit: "abc" }],
];

describe("crm_list_tasks moved to _shared/crm-reads/list-tasks.ts — byte-identical", () => {
  for (const [label, args] of CASES) {
    it(label, async () => {
      const { before, after } = await both(args);
      assert.deepEqual(after.wire, before.wire, "the same requests, in the same order");
      assert.equal(after.result, before.result, "the same result, byte for byte");
      assert.ok(before.result, "the run produced a result");
    });
  }
  it("an empty answer (data null) reads the same", async () => {
    const { before, after } = await both({}, { data: null, error: null });
    assert.deepEqual(after.wire, before.wire);
    assert.equal(after.result, before.result);
  });
  it("a query error is thrown as the same object, after the same requests", async () => {
    const err = { code: "42501", message: "permission denied for table tasks" };
    const { before, after } = await both({ assignee_email: "sam@example.test" }, { data: null, error: err });
    assert.deepEqual(after.wire, before.wire);
    assert.equal(before.threw, err);
    assert.equal(after.threw, err);
  });
  it("the column list is the chat's, unchanged", () => {
    assert.equal(CRM_TASK_LIST_COLUMNS, "id, title, status, due_date, track, user_id, biz_id, deal_id, source_thread_id, updated_at, created_at");
  });
});

describe("listCrmTasks without the chat's email lookup (the Team Hub caller)", () => {
  it("omitting assigneeUserId adds no person filter and lists no auth users", async () => {
    const wire: Wire = [];
    const out = await withClock(() => listCrmTasks(fakeAdmin(wire, { data: ROWS, error: null }), TENANT, { assignee_email: "sam@example.test" }));
    assert.equal(out.count, 2);
    assert.deepEqual(wire, [{ query: "tasks", chain: [
      ["select", [CRM_TASK_LIST_COLUMNS]], ["eq", ["tenant_id", TENANT]], ["neq", ["status", "completed"]],
      ["order", ["due_date", { ascending: true, nullsFirst: false }]], ["limit", [25]],
    ] }]);
  });
});
