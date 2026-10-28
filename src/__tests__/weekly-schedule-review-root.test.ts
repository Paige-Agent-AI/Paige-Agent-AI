// @vitest-environment node
// Execute the actual original Root branch with recording ports, not Auth/DB proof.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { prepareWeeklyScheduleReviewChatResponse } from "../../supabase/functions/_shared/paige-orchestration/weekly-commitment-control-review";
import { createWeeklyDraftDeadline } from "../../supabase/functions/_shared/paige-orchestration/weekly-draft-deadline";

const source = ts.createSourceFile("root.ts", readFileSync("supabase/functions/paige-ai-chat/index.ts", "utf8"), ts.ScriptTarget.Latest, true);
const blocks: string[] = [];
function find(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(source) === "tc.function.name === WEEKLY_SCHEDULE_REVIEW_TOOL_NAME")
    blocks.push(node.thenStatement.getText(source));
  ts.forEachChild(node, find);
}
find(source);
expect(blocks).toHaveLength(1);
const compiled = ts.transpileModule(blocks[0], { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const calls: string[] = []; let current = true;
  const data = { ok: true, tenant_id: id(2), actor_id: id(1), scope: "personal_planning_commitments", read_at: "2026-10-26T12:00:00Z",
    limit: 50, has_more: false, business_time_zone: { state: "configured", zone: "UTC" }, checks: [{ automation_id: id(3), name: "Original weekly responsibility", revision: 2,
      schedule_status: "paused", schedule: { weekday: 1, local_time: "09:00", timezone: "UTC", future_control_at: null },
      execution_availability: "held", execution_hold_reason: "paused", next_run_at: null, intended_next_run_at: null, last_run: null, last_verified_run: null }] };
  const port = { callerTier: "tenant", personaCtx: { tenant_id: id(2) }, user: { id: id(1) }, taskReadRole: "owner",
    calendarBookingAccountShape: "solo", scopedClientId: null, payloadThreadId: id(4), validatedData: { requestIntentId: id(5) }, customerPortal: false,
    tc: { id: "original-call", function: { name: "read_weekly_schedule_review", arguments: JSON.stringify({ automation_id: id(3), weekday: 3, local_time: "10:00", timezone: "UTC" }) } },
    weeklyDraftRuntime: () => ({ intentId: id(5) }), weeklyDraftCurrent: () => current,
    revalidateTenantKnowledgeScope: async () => current,
    readCalendarAccountShape: async () => ({ status: current ? "available" : "unavailable" }),
    supabaseClient: { rpc: async (name: string) => { calls.push(name); return { data: name === "current_user_tenant_id" ? id(2) : name === "weekly_commitment_owner" ? true : data, error: null }; } },
    req: new Request("https://unit-test.invalid"), WALL_CLOCK_MS: 360000, startedAt: Date.now(), toolResults: [] as { content: string }[],
    supabase: { kind: "receipt-recording-port" }, stableRunId: vi.fn(async () => id(6)),
    recordCapabilityRun: vi.fn(async (_db: unknown, _input: Record<string, unknown>) => ({ ok: true })), console: { error: vi.fn() },
    createWeeklyDraftDeadline, prepareWeeklyScheduleReviewChatResponse };
  return { port, calls, revoke: () => { current = false; }, run: async () => {
    await new Function(...Object.keys(port), `return (async () => { ${compiled} })()`)(...Object.values(port));
    expect(port.toolResults).toHaveLength(1); return JSON.parse(port.toolResults[0].content);
  } };
}
it("executes the original caller-JWT reads and records only a preview inspection", async () => {
  const f = fixture(), result = await f.run();
  expect(result).toMatchObject({ status: "available", review: { revision: 2, proposed_schedule: { weekday: 3 }, authorization: "not_granted_by_review" } });
  expect(result).not.toHaveProperty("binding");
  expect(f.calls).toEqual(["current_user_tenant_id", "weekly_commitment_owner", "get_weekly_commitment_checks", "current_user_tenant_id", "weekly_commitment_owner"]);
  expect(f.port.recordCapabilityRun).toHaveBeenCalledOnce();
  expect(f.port.recordCapabilityRun.mock.calls[0]?.[1]).toMatchObject({ capabilityKey: "read_weekly_schedule_review", detail: { read_only: true, preview_only: true } });
});
it("withholds a stale result if scope is withdrawn while the read receipt is awaited", async () => {
  const f = fixture(); f.port.recordCapabilityRun.mockImplementation(async () => { f.revoke(); return { ok: true }; });
  const result = await f.run(); expect(result.status).toBe("unavailable"); expect(result).not.toHaveProperty("review");
});
it("never reads, records or guesses without the original native request identity", async () => {
  const f = fixture(); f.port.weeklyDraftRuntime = () => null as never;
  expect((await f.run()).status).toBe("unavailable"); expect(f.calls).toEqual([]); expect(f.port.recordCapabilityRun).not.toHaveBeenCalled();
});
it("refuses forged arguments without any native read or write", async () => {
  const f = fixture(); f.port.tc.function.arguments = JSON.stringify({ tenant_id: id(2), automation_id: id(3) });
  expect((await f.run()).status).toBe("needs_input"); expect(f.calls).toEqual([]); expect(f.port.recordCapabilityRun).not.toHaveBeenCalled();
});
