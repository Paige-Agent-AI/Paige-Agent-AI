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
    business_time_zone: { state: "configured", zone: "UTC" }, checks: [{ ...structuredClone(saved),
      schedule: { ...saved.schedule, future_control_at: saved.future_control_at ?? null } }] });
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
      return (fn as (...a: unknown[]) => Promise<{ status: string }>)(original, args[0], args[1], caller, () => scope, args[2]);
    } };
}
const changedSchedule = () => ({ weekday: 5, local_time: "14:30", timezone: "Europe/London" });
function configurationFixture() {
  const f = fixture(), original = f.caller.rpc.getMockImplementation()!;
  f.caller.rpc.mockImplementation(async (name, args) => {
    if (name !== "configure_weekly_commitment_check") return original(name, args);
    f.effects.push(args); f.saved.revision = 3; f.saved.schedule_status = "requested";
    f.saved.schedule = { weekday: Number(args?._weekday), local_time: String(args?._local_time), timezone: String(args?._timezone) };
    return f.response.data || f.response.error ? f.response
      : { data: { ok: true, automation_id: id, state: "draft", revision: 3, requires_authorization: true }, error: null };
  });
  return f;
}
function authorizationFixture(ready = false) {
  const f = fixture(), original = f.caller.rpc.getMockImplementation()!;
  f.saved.schedule_status = "requested";
  // This is an observed canonical null, not a missing transport field.
  f.saved.future_control_at = null;
  f.caller.rpc.mockImplementation(async (name, args) => {
    if (name !== "control_weekly_commitment_check") return original(name, args);
    f.effects.push(args); f.saved.schedule_status = "scheduled";
    f.saved.intended_next_run_at = "2026-11-02T09:00:00Z";
    f.saved.execution_availability = ready ? "ready" : "held";
    f.saved.execution_hold_reason = ready ? null : "trigger_dark";
    f.saved.next_run_at = ready ? f.saved.intended_next_run_at : null;
    return f.response.data || f.response.error ? f.response : { data: { ok: true, automation_id: id, revision: 2,
      state: "live", future_runs_only: true, next_run_at: f.saved.intended_next_run_at }, error: null };
  });
  return f;
}
describe("exact native weekly authorization", () => {
  it("missing reviewed cutoff stays unavailable without attempting authorization", async () => {
    const f = authorizationFixture(), review = structuredClone(f.saved);
    delete review.future_control_at;
    expect((await f.control(review, "authorize")).status).toBe("unavailable");
    expect(f.effects).toEqual([]);
  });
  it("a fresh owner read with unknown cutoff cannot replace the reviewed saved null", async () => {
    const f = authorizationFixture(), review = structuredClone(f.saved), original = f.caller.rpc.getMockImplementation()!;
    f.caller.rpc.mockImplementation(async (name, args) => {
      if (name !== "get_weekly_commitment_checks") return original(name, args);
      const data = f.dto();
      Reflect.deleteProperty(data.checks[0].schedule, "future_control_at");
      return { data, error: null };
    });
    expect((await f.control(review, "authorize")).status).toBe("unavailable");
    expect(f.effects).toEqual([]);
  });
  it.each([false, true])("saves exact authorization with real readiness %s", async ready => {
    const f = authorizationFixture(ready), reviewed = structuredClone(f.saved);
    expect((await f.control(reviewed, "authorize")).status).toBe("saved");
    expect(f.effects).toEqual([{ _automation_id: id, _action: "authorize", _expected_revision: 2,
      _expected_control: { state: "requested", future_control_at: null } }]);
    expect(f.saved.execution_availability).toBe(ready ? "ready" : "held"); expect(f.saved.last_verified_run).toBeNull();
    expect(f.caller.rpc.mock.calls.filter(([name]) => name === "get_weekly_commitment_checks")).toHaveLength(2);
  });
  it("a paused responsibility receives fresh authorization, never a catch-up command", async () => {
    const f = authorizationFixture(); f.saved.schedule_status = "paused";
    expect((await f.control(structuredClone(f.saved), "authorize")).status).toBe("saved");
    expect(f.effects).toEqual([{ _automation_id: id, _action: "authorize", _expected_revision: 2,
      _expected_control: { state: "paused", future_control_at: null } }]);
  });
  it("preserves the original microsecond cutoff in the atomic authorization predicate", async () => {
    const f = authorizationFixture(), cutoff = "2026-10-23T15:20:10.123456+00:00";
    f.saved.future_control_at = cutoff;
    expect((await f.control(structuredClone(f.saved), "authorize")).status).toBe("saved");
    expect(f.effects).toEqual([{ _automation_id: id, _action: "authorize", _expected_revision: 2,
      _expected_control: { state: "requested", future_control_at: cutoff } }]);
  });
  it("refuses a changed original control cutoff before any authorization write", async () => {
    const f = authorizationFixture(), review = structuredClone(f.saved);
    review.future_control_at = "2026-10-23T15:20:10Z";
    expect((await f.control(review, "authorize")).status).toBe("stale"); expect(f.effects).toEqual([]);
  });
  it("a native concurrent-control conflict is stale and never retried", async () => {
    const f = authorizationFixture(); f.response.error = { code: "40001" };
    expect((await f.control(structuredClone(f.saved), "authorize")).status).toBe("stale"); expect(f.effects).toHaveLength(1);
  });
  it.each(["automation_id", "revision", "state", "future_runs_only", "next_run_at"])("rejects contradictory %s acknowledgment", async field => {
    const f = authorizationFixture();
    f.response.data = { ok: true, automation_id: id, revision: 2, state: "live", future_runs_only: true,
      next_run_at: "2026-11-02T09:00:00Z", [field]: field === "future_runs_only" ? false : "wrong" };
    expect((await f.control(structuredClone(f.saved), "authorize")).status).toBe("unknown"); expect(f.effects).toHaveLength(1);
  });
  it("contradictory original next-run readback stays unknown without replay", async () => {
    const f = authorizationFixture(true), original = f.caller.rpc.getMockImplementation()!;
    f.caller.rpc.mockImplementation(async (name, args) => { const result = await original(name, args);
      if (name === "control_weekly_commitment_check") f.saved.intended_next_run_at = "2026-11-09T09:00:00Z";
      return result; });
    expect((await f.control(structuredClone(f.saved), "authorize")).status).toBe("unknown"); expect(f.effects).toHaveLength(1);
  });
  it("lost authorization acknowledgment remains inspect-only", async () => {
    const f = authorizationFixture(); f.response.error = { message: "lost acknowledgment" };
    expect((await f.control(structuredClone(f.saved), "authorize")).status).toBe("unknown"); expect(f.effects).toHaveLength(1);
  });
  it("a changed reviewed schedule cannot authorize the current definition", async () => {
    const f = authorizationFixture(), review = structuredClone(f.saved); review.schedule.local_time = "10:00";
    expect((await f.control(review, "authorize")).status).toBe("stale"); expect(f.effects).toEqual([]);
  });
});

describe("native human-owner future controls", () => {
  it.each(["CET", "GMT", "EST", "America/Coyhaique"])("preserves the saved PostgreSQL zone %s when only day/time changes", async timezone => {
    const f = configurationFixture(); f.saved.schedule.timezone = timezone;
    const reviewed = structuredClone(f.saved);
    const proposed = { ...reviewed.schedule, weekday: 5, local_time: "14:30" };
    expect((await f.control(reviewed, "configure", proposed)).status).toBe("saved");
    expect(f.effects).toEqual([{ _automation_id: id, _expected_revision: 2, _weekday: 5, _local_time: "14:30", _timezone: timezone }]);
  });
  it("changes the original schedule only as a disarmed next revision", async () => {
    const f = configurationFixture();
    expect(await f.control(check(), "configure", changedSchedule())).toMatchObject({ status: "saved" });
    expect(f.effects).toEqual([{ _automation_id: id, _expected_revision: 2, _weekday: 5, _local_time: "14:30", _timezone: "Europe/London" }]);
    expect(f.caller.rpc.mock.calls.filter(([name]) => name === "get_weekly_commitment_checks")).toHaveLength(2);
  });
  it.each([{ weekday: 0 }, { local_time: "25:00" }, { timezone: "invalid" }])("refuses invalid configuration %j without a write", async invalid => {
    const f = configurationFixture();
    expect((await f.control(check(), "configure", { ...changedSchedule(), ...invalid })).status).toBe("refused"); expect(f.effects).toEqual([]);
  });
  it("will not reconfigure the same schedule or configure a cancelled responsibility", async () => {
    const f = configurationFixture();
    expect((await f.control(check(), "configure", check().schedule)).status).toBe("unsupported"); expect(f.effects).toEqual([]);
    f.saved.schedule_status = "cancelled";
    expect((await f.control({ ...check(), schedule_status: "cancelled" }, "configure", changedSchedule())).status).toBe("stale"); expect(f.effects).toEqual([]);
  });
  it.each(["revision", "state", "requires_authorization"])("does not accept a changed native %s acknowledgement", async field => {
    const f = configurationFixture(); f.response.data = { ok: true, automation_id: id, state: "draft", revision: 3, requires_authorization: true,
      [field]: field === "revision" ? 2 : field === "state" ? "live" : false };
    expect((await f.control(check(), "configure", changedSchedule())).status).toBe("unknown"); expect(f.effects).toHaveLength(1);
  });
  it.each(["schedule", "revision", "state", "next_run"])("rejects contradictory %s readback without replay", async field => {
    const f = configurationFixture(), original = f.caller.rpc.getMockImplementation()!;
    f.caller.rpc.mockImplementation(async (name, args) => {
      const result = await original(name, args);
      if (name === "configure_weekly_commitment_check") {
        if (field === "schedule") f.saved.schedule.local_time = "15:00";
        if (field === "revision") f.saved.revision = 4;
        if (field === "state") f.saved.schedule_status = "scheduled";
        if (field === "next_run") f.saved.next_run_at = "2026-10-23T13:30:00Z";
      }
      return result;
    });
    expect((await f.control(check(), "configure", changedSchedule())).status).toBe("unknown"); expect(f.effects).toHaveLength(1);
  });
  it("unknown configuration outcome and lost identity cannot publish success or retry", async () => {
    const f = configurationFixture(); f.response.error = { message: "lost response" };
    expect((await f.control(check(), "configure", changedSchedule())).status).toBe("unknown"); expect(f.effects).toHaveLength(1);
    const g = configurationFixture(), original = g.caller.rpc.getMockImplementation()!;
    g.caller.rpc.mockImplementation(async (name, args) => { const result = await original(name, args); if (name === "configure_weekly_commitment_check") g.retire(); return result; });
    expect((await g.control(check(), "configure", changedSchedule())).status).toBe("refused"); expect(g.effects).toHaveLength(1);
  });
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
