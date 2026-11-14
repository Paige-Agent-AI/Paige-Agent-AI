import { deepStrictEqual as assertEquals } from "node:assert";
import { saveAutomationDraft } from "./automation-draft-save.ts";

const id = (n: number) => `a5500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = () => ({ name: "Test onboarding preparation", trigger_key: "manual.run_now", steps: [{ tool_key: "crm_create_task" }] });
const options = () => ({ actorId: id(1), tenantId: id(2), requestId: id(3), draft: draft(),
  current: () => true, signal: new AbortController().signal, remainingMs: 2000 });
const state = () => ({ phase: "saved", tenant_id: id(2), actor_id: id(1), request_id: id(3), automation_id: id(3),
  receipt_id: id(4), steps: 1, state: "draft", granted_lane: "confirm", execution_started: false, updated_at: "2026-11-13T17:00:00Z" });

Deno.test("atomic draft: normal save returns original process and Rail without a second call", async () => {
  const calls: string[] = [];
  const result = await saveAutomationDraft({ rpc: async (name, args) => {
    calls.push(name); assertEquals(args._expected_tenant_id, id(2)); assertEquals(args._request_id, id(3));
    assertEquals(args._draft, draft()); return { data: state(), error: null };
  } }, options());
  assertEquals(result, { status: "saved", automationId: id(3), receiptId: id(4), requestId: id(3), steps: 1, recovered: false });
  assertEquals(calls, ["save_automation_draft"]);
});

for (const failure of ["throw", "gateway", "empty", "invalid"] as const) Deno.test(`atomic draft: ${failure} recovers only the original identity`, async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const result = await saveAutomationDraft({ rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === "save_automation_draft") {
      if (failure === "throw") throw new TypeError("Lost acknowledgment after commit");
      return failure === "gateway" ? { data: null, error: { code: "08006" } }
        : { data: failure === "empty" ? null : { ...state(), actor_id: id(99) }, error: null };
    }
    assertEquals(args, { _request_id: id(3), _expected_tenant_id: id(2), _expected_draft: draft() });
    return { data: state(), error: null };
  } }, options());
  assertEquals(result.status, "saved");
  if (result.status === "saved") assertEquals(result.recovered, true);
  assertEquals(calls.map(c => c.name), ["save_automation_draft", "read_automation_draft"]);
});

for (const phase of ["absent", "changed", "saved_unreceipted"] as const) Deno.test(`atomic draft: ${phase} never repeats the save or claims success`, async () => {
  const calls: string[] = [];
  const result = await saveAutomationDraft({ rpc: async name => {
    calls.push(name);
    if (name === "save_automation_draft") throw new TypeError("Unknown response");
    return { data: { ...state(), phase }, error: null };
  } }, options());
  assertEquals(result.status, phase === "absent" ? "unknown" : "observed");
  assertEquals(calls, ["save_automation_draft", "read_automation_draft"]);
});

Deno.test("atomic draft: known SQL rollback is refused without retry", async () => {
  const calls: string[] = [];
  const result = await saveAutomationDraft({ rpc: async name => {
    calls.push(name); return { data: null, error: { code: "23505" } };
  } }, options());
  assertEquals(result, { status: "refused", reason: "name_conflict" });
  assertEquals(calls, ["save_automation_draft"]);
});

for (const bad of ["actor_id", "tenant_id", "request_id", "automation_id", "receipt_id", "state", "granted_lane", "execution_started", "steps"])
  Deno.test(`atomic draft: rejects misleading ${bad} in both write and read`, async () => {
    const invalid = { ...state(), [bad]: bad.endsWith("_id") ? (bad === "receipt_id" ? null : id(99)) : "invalid" };
    const result = await saveAutomationDraft({ rpc: async () => ({ data: invalid, error: null }) }, options());
    assertEquals(result.status, "unknown");
  });

Deno.test("atomic draft: revoked scope after save suppresses result and recovery", async () => {
  let active = true; const calls: string[] = [];
  const result = await saveAutomationDraft({ rpc: async name => {
    calls.push(name); active = false; return { data: state(), error: null };
  } }, { ...options(), current: () => active });
  assertEquals(result.status, "unknown"); assertEquals(calls, ["save_automation_draft"]);
});

Deno.test("atomic draft: cancellation before dispatch makes no request", async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const result = await saveAutomationDraft({ rpc: async () => { calls++; return { data: state(), error: null }; } },
    { ...options(), signal: controller.signal });
  assertEquals(result.status, "unavailable"); assertEquals(calls, 0);
});

Deno.test("atomic draft: elapsed limit cannot start another save or read", async () => {
  let calls = 0;
  const result = await saveAutomationDraft({ rpc: () => { calls++; return new Promise(() => {}); } }, { ...options(), remainingMs: 5 });
  assertEquals(result.status, "unknown"); assertEquals(calls, 1);
});
