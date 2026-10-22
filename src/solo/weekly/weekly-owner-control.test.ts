import { describe, expect, it, vi } from "vitest";
import * as weekly from "./weekly-owner-read";
import type { WeeklyBrowserScope } from "./weekly-owner-read";
import type { WeeklyCheck } from "../../../supabase/functions/_shared/paige-orchestration/weekly-commitment-projection";

const actor = "11111111-1111-4111-8111-111111111111", tenant = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const check = (): WeeklyCheck => ({ automation_id: id, name: "Synthetic weekly responsibility", revision: 2,
  schedule_status: "scheduled", schedule: { weekday: 1, local_time: "09:00", timezone: "UTC" },
  execution_availability: "held", execution_hold_reason: "trigger_dark", next_run_at: null,
  intended_next_run_at: null, last_run: null, last_verified_run: null });
function fixture() {
  let scope: WeeklyBrowserScope | null = { actorId: actor, tenantId: tenant, epoch: 1 };
  const original = { ...scope }, saved = check(), effects: unknown[] = [];
  const dto = () => ({ ok: true, scope: "personal_planning_commitments", actor_id: actor, tenant_id: tenant,
    read_at: "2026-10-22T00:00:00Z", limit: 50, has_more: false,
    business_time_zone: { state: "configured", zone: "UTC" }, checks: [structuredClone(saved)] });
  const response: { data: unknown; error: unknown } = { data: null, error: null };
  const caller = { auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: actor } } }, error: null })) },
    rpc: vi.fn(async (name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => {
      if (name === "control_weekly_commitment_check") {
        effects.push(args); saved.schedule_status = args?._action === "pause" ? "paused" : "cancelled";
        return response.data || response.error ? response : { data: { ok: true, automation_id: id, revision: 2,
          state: saved.schedule_status, future_runs_only: true }, error: null };
      }
      return { data: name === "current_user_tenant_id" ? tenant : name === "weekly_commitment_owner" ? true : dto(), error: null };
    }) };
  return { original, saved, dto, effects, response, caller, current: () => scope,
    retire: () => { scope = null; }, control: (...args: unknown[]) => {
      const fn = (weekly as Record<string, unknown>).controlWeeklyOwner;
      expect(typeof fn).toBe("function");
      return (fn as (...a: unknown[]) => Promise<{ status: string }>)(original, ...args, caller, () => scope);
    } };
}
describe("native human-owner future controls", () => {
  it.each(["pause", "cancel"])("%s uses the original exact-revision native writer and authoritative readback", async action => {
    const f = fixture(); expect(await f.control(check(), action)).toMatchObject({ status: "saved" });
    expect(f.effects).toEqual([{ _automation_id: id, _action: action, _expected_revision: 2 }]);
    expect(f.caller.rpc.mock.calls.filter(([name]) => name === "get_weekly_commitment_checks")).toHaveLength(2);
  });
  it.each(["authorize", "resume", "configure", "draft", "execute"])("cannot admit %s through a stop-only consumer", async action => {
    const f = fixture(); expect((await f.control(check(), action)).status).toBe("refused"); expect(f.effects).toEqual([]);
  });
  it.each(["revision", "schedule", "target"])("refuses changed %s before a write", async kind => {
    const f = fixture(), target = check();
    if (kind === "revision") target.revision = 1;
    if (kind === "schedule") target.schedule.local_time = "10:00";
    if (kind === "target") target.automation_id = actor;
    expect((await f.control(target, "pause")).status).toBe("stale"); expect(f.effects).toEqual([]);
  });
  it.each(["40001", "42501", "22023"])("preserves native refusal %s without replay", async code => {
    const f = fixture(); f.response.error = { code };
    expect((await f.control(check(), "pause")).status).toBe(code === "40001" ? "stale" : code === "42501" ? "refused" : "unsupported");
    expect(f.effects).toHaveLength(1);
  });
  it("unknown write response stays unknown with no replay", async () => {
    const f = fixture(); f.response.error = { message: "transport lost" };
    expect((await f.control(check(), "cancel")).status).toBe("unknown"); expect(f.effects).toHaveLength(1);
  });
  it("a mismatched response cannot report saved", async () => {
    const f = fixture(); f.response.data = { ok: true, automation_id: actor, revision: 2, state: "paused", future_runs_only: true };
    expect((await f.control(check(), "pause")).status).toBe("unknown"); expect(f.effects).toHaveLength(1);
  });
  it("retired scope makes no call", async () => {
    const f = fixture(); f.retire(); expect((await f.control(check(), "pause")).status).toBe("refused");
    expect(f.caller.rpc).not.toHaveBeenCalled();
  });
  it("current owner refusal prevents a native control", async () => {
    const f = fixture(); f.caller.rpc.mockResolvedValue({ data: false, error: null });
    expect((await f.control(check(), "pause")).status).toBe("refused"); expect(f.effects).toEqual([]);
  });
  it("scope retirement during dispatch never publishes a successful private result", async () => {
    const f = fixture(), original = f.caller.rpc.getMockImplementation()!;
    f.caller.rpc.mockImplementation(async (name, args) => {
      const result = await original(name, args); if (name === "control_weekly_commitment_check") f.retire(); return result;
    });
    expect((await f.control(check(), "pause")).status).toBe("refused"); expect(f.effects).toHaveLength(1);
  });
  it("failed authoritative readback stays unknown without a second write", async () => {
    const f = fixture(), original = f.caller.rpc.getMockImplementation()!;
    f.caller.rpc.mockImplementation(async (name, args) => name === "get_weekly_commitment_checks" && f.effects.length
      ? { data: null, error: { message: "read unavailable" } } : original(name, args));
    expect((await f.control(check(), "cancel")).status).toBe("unknown"); expect(f.effects).toHaveLength(1);
  });
  it("stopping future checks preserves the observed running attempt", async () => {
    const f = fixture(); f.saved.last_run = { event_id: actor, act_id: id, scheduled_for: "2026-10-22T00:00:00Z", status: "running" };
    const result = await f.control(check(), "pause"); expect(result.status).toBe("saved");
    expect(f.saved.last_run.status).toBe("running"); expect(f.effects).toHaveLength(1);
  });
  it("captures the reviewed definition before an input object can change", async () => {
    const f = fixture(), target = check(), original = f.caller.auth.getSession.getMockImplementation()!;
    f.caller.auth.getSession.mockImplementationOnce(async () => { target.revision = 99; target.schedule.local_time = "20:00"; return original(); });
    expect((await f.control(target, "pause")).status).toBe("saved");
    expect(f.effects).toEqual([{ _automation_id: id, _action: "pause", _expected_revision: 2 }]);
  });
  it("an original deadline blocks late preflight from dispatching", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture(); f.caller.auth.getSession.mockImplementationOnce(() => new Promise(resolve => {
        setTimeout(() => resolve({ data: { session: { user: { id: actor } } }, error: null }), 13000);
      }));
      const result = f.control(check(), "pause"); await vi.advanceTimersByTimeAsync(12001);
      expect((await result).status).toBe("unavailable"); await vi.advanceTimersByTimeAsync(2000); expect(f.effects).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
