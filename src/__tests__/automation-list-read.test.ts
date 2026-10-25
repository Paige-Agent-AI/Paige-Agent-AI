// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readBoundedAutomationList, type AutomationListCaller } from "../../supabase/functions/_shared/paige-orchestration/automation-list-read";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), tenant = id(2);
const row = (n: number) => ({ id: id(n + 10), tenant_id: tenant, name: `Process ${n}`, category: "general",
  trigger_key: "contact.created", state: "live", granted_lane: "confirm", created_at: "2026-10-25T12:00:00Z" });
const posture = () => ({ found: true, effective: "confirm", state: "live", granted: "confirm", capped_by: null, would_run: true, dark: [] });
type Reply = { data: unknown; error: unknown };
type Inspection = Awaited<ReturnType<typeof readBoundedAutomationList>>;
function available(value: Inspection): asserts value is Extract<Inspection, { success: true }> {
  expect(value.success).toBe(true);
  if (!value.success) throw Error("Expected an authorized process inspection");
}
function fixture(count = 1) {
  const identity = { actorId: actor, tenantId: tenant, scopeEpoch: 1 };
  let current: typeof identity | null = { ...identity }, user = actor, workspace: string = tenant;
  let rows: unknown = Array.from({ length: count }, (_, n) => row(n));
  let lookup: (key: string) => Promise<Reply> = async () => ({ data: posture(), error: null });
  let revalidate = async () => true;
  let step = (_name: string) => {};
  const calls: { name: string; args: unknown; operations: unknown[]; signal?: AbortSignal }[] = [];
  let active = 0, maximum = 0;
  const query = (name: string, args: unknown) => {
    const entry = { name, args, operations: [] as unknown[], signal: undefined as AbortSignal | undefined };
    const q = {
      select(v: string) { entry.operations.push(["select", v]); return q; },
      eq(k: string, v: string) { entry.operations.push(["eq", k, v]); return q; },
      order(k: string, v: unknown) { entry.operations.push(["order", k, v]); return q; },
      limit(v: number) { entry.operations.push(["limit", v]); return q; },
      abortSignal(v: AbortSignal) { entry.signal = v; return q; },
      then(resolve: (v: Reply) => unknown, reject: (e: unknown) => unknown) {
        calls.push(entry); step(name);
        return Promise.resolve().then(async () => {
          if (name === "current_user_tenant_id") return { data: workspace, error: null };
          if (name === "paige_automations") return { data: rows, error: null };
          expect(name).toBe("resolve_automation_autonomy");
          active++; maximum = Math.max(maximum, active);
          try { const result = await lookup((args as { _automation_id: string })._automation_id); step("posture_done"); return result; }
          finally { active--; }
        }).then(resolve, reject);
      },
    };
    return q;
  };
  const caller = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: user } }, error: null })) },
    from: (name: string) => query(name, null), rpc: (name: string, args?: unknown) => query(name, args) };
  return { identity, caller, calls, maximum: () => maximum,
    current: () => current, setCurrent: (v: typeof current) => { current = v; },
    setUser: (v: string) => { user = v; }, setWorkspace: (v: string) => { workspace = v; },
    setRows: (v: unknown) => { rows = v; }, setLookup: (v: typeof lookup) => { lookup = v; },
    setRevalidate: (v: typeof revalidate) => { revalidate = v; }, onStep: (v: typeof step) => { step = v; },
    run: (signal?: AbortSignal) => readBoundedAutomationList(identity, { caller: caller as unknown as AutomationListCaller,
      currentIdentity: () => current, revalidateScope: () => revalidate(), signal }),
  };
}
afterEach(() => vi.useRealTimers());

describe("existing process inspection has one bounded caller-JWT read", () => {
  it("uses the actual Chat handler, original read admission and model egress with no business effect", () => {
    const keys = ["SystemRoot", "SYSTEMROOT", "WINDIR", "PATH", "Path", "PATHEXT", "COMSPEC", "TEMP", "TMP"];
    const env = Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key] as string]));
    const output = execFileSync(process.execPath, ["--import", "./scripts/knowledge-scope/register.mjs", "scripts/proof/owner-task-history-chat.mjs", "--automation-list"],
      { cwd: process.cwd(), env, encoding: "utf8", windowsHide: true, timeout: 120000, stdio: ["ignore", "pipe", "pipe"] });
    expect(output).toContain("RESULT 7 PASS / 0 FAIL");
    expect(output).toContain("PASS actual Chat workspace withdrawal suppresses process titles after resolver read");
  }, 130000);
  it("keeps current native readiness separate from a stored live state or completed work", async () => {
    const f = fixture(), r = await f.run(); available(r);
    expect(r).toMatchObject({ success: true, read_only: true, provider_readiness: "not_checked", execution_history: "not_read",
      coverage: { returned: 1, limit: 50, has_more: false },
      automations: [{ id: row(0).id, state: "live", readiness: "resolved", what_actually_happens: "confirm", would_it_run: true }] });
    expect(r.note).toContain("not an execution receipt");
    expect(f.calls.find(x => x.name === "paige_automations")?.operations).toEqual([
      ["select", "id,tenant_id,name,category,trigger_key,granted_lane,state,created_at"], ["eq", "tenant_id", tenant],
      ["order", "created_at", { ascending: false }], ["order", "id", { ascending: false }], ["limit", 51],
    ]);
    expect(f.calls.filter(x => x.name === "current_user_tenant_id")).toHaveLength(2);
    expect(f.calls.every(x => x.signal?.aborted)).toBe(true);
  });
  it("retains a resolver failure as unavailable readiness with null reasons, never an empty clear result", async () => {
    const f = fixture(); f.setLookup(async () => ({ data: null, error: { message: "PRIVATE_RESOLVER_ERROR" } }));
    const r = await f.run(); expect(r).toMatchObject({ success: true, readiness: "partial",
      automations: [{ readiness: "unavailable", would_it_run: null, cannot_fire_because: null, what_actually_happens: null }] });
    expect(JSON.stringify(r)).not.toContain("PRIVATE_RESOLVER_ERROR");
  });
  it.each([null, { found: false }, { ...posture(), effective: "invented" }, { ...posture(), state: "paused" },
    { ...posture(), granted: "auto" }, { ...posture(), capped_by: "private" }, { ...posture(), would_run: "yes" },
    { ...posture(), dark: [{ kind: "trigger", reason: null }] }])("does not infer readiness from an incomplete or changed resolver result %j", async data => {
    const f = fixture(); f.setLookup(async () => ({ data, error: null }));
    expect(await f.run()).toMatchObject({ success: true, readiness: "partial", automations: [{ readiness: "unavailable", would_it_run: null }] });
  });
  it("starts at most four original resolver reads and labels the 51-row source window honestly", async () => {
    vi.useFakeTimers(); const f = fixture(51);
    f.setLookup(async () => { await new Promise(resolve => setTimeout(resolve, 10)); return { data: posture(), error: null }; });
    const result = f.run(); await vi.advanceTimersByTimeAsync(200);
    const r = await result; available(r); expect(f.maximum()).toBe(4);
    expect(f.calls.filter(x => x.name === "resolve_automation_autonomy")).toHaveLength(50);
    expect(r).toMatchObject({ success: true, coverage: { returned: 50, has_more: true } });
    expect(r.automations?.map(x => x.id)).toEqual(Array.from({ length: 50 }, (_, n) => row(n).id));
  });
  it("bounds the model projection and exposes partial coverage without passing raw resolver payloads", async () => {
    const f = fixture(50); f.setRows(Array.from({ length: 50 }, (_, n) => ({ ...row(n), name: "X".repeat(5000) })));
    f.setLookup(async () => ({ data: { ...posture(), raw_provider: "PRIVATE_PROVIDER", dark: Array.from({ length: 4 }, () => ({
      kind: "trigger", key: "contact.created", reason: "R".repeat(1000), raw_error: "PRIVATE_ERROR",
    })) }, error: null }));
    const r = await f.run(); available(r); expect(r.coverage.has_more).toBe(true);
    expect(JSON.stringify(r).length).toBeLessThan(25_000); expect(JSON.stringify(r)).not.toMatch(/PRIVATE_PROVIDER|PRIVATE_ERROR/);
    expect(r.automations?.[0]).toMatchObject({ name: "X".repeat(120), name_truncated: true });
    expect(r.automations?.[0].cannot_fire_because).toEqual(Array.from({ length: 4 }, () => ({
      kind: "trigger", key: "contact.created", reason: "R".repeat(200), reason_truncated: true,
    })));
  });
  it("distinguishes an empty authorized source from an unavailable source", async () => {
    const f = fixture(0); expect(await f.run()).toMatchObject({ success: true, automations: [], coverage: { has_more: false } });
    f.setRows(null); expect(await f.run()).toMatchObject({ success: false, status: "unavailable" });
  });
  it("enforces the projection budget in actual UTF-8 bytes for multilingual records", async () => {
    const f = fixture(50); f.setRows(Array.from({ length: 50 }, (_, n) => ({ ...row(n), name: "😀".repeat(3000) })));
    f.setLookup(async () => ({ data: { ...posture(), dark: Array.from({ length: 4 }, () => ({ kind: "trigger", reason: "💬".repeat(1000) })) }, error: null }));
    const r = await f.run(); available(r); expect(r.coverage.has_more).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(r)).byteLength).toBeLessThan(25_000);
  });
  it("requires the original live epoch and context before any caller read", async () => {
    const f = fixture(); f.setCurrent(null);
    expect(await f.run()).toMatchObject({ success: false, status: "refused" }); expect(f.calls).toEqual([]);
    f.setCurrent({ ...f.identity }); f.identity.scopeEpoch = Number.NaN;
    expect(await f.run()).toMatchObject({ success: false, status: "refused" }); expect(f.calls).toEqual([]);
  });
  it.each(["foreign-row", "duplicate", "oversized"])("refuses malformed source coverage before resolver lookup: %s", async mode => {
    const f = fixture(); f.setRows(mode === "foreign-row" ? [{ ...row(0), tenant_id: id(99) }]
      : mode === "duplicate" ? [row(0), row(0)] : Array.from({ length: 52 }, (_, n) => row(n)));
    expect(await f.run()).toMatchObject({ success: false, status: "unavailable" });
    expect(f.calls.some(x => x.name === "resolve_automation_autonomy")).toBe(false);
  });
  it.each(["actor", "tenant", "outer"])("refuses stale original authority before process reads: %s", async mode => {
    const f = fixture(); if (mode === "actor") f.setUser(id(99)); else if (mode === "tenant") f.setWorkspace(id(99));
    else f.setRevalidate(async () => false);
    expect(await f.run()).toMatchObject({ success: false, status: "refused" });
    expect(f.calls.some(x => x.name === "paige_automations")).toBe(false);
  });
  it.each(["paige_automations", "posture_done"])("withholds private output after scope retirement at %s", async stage => {
    const f = fixture(); f.onStep(name => { if (name === stage) f.setCurrent({ ...f.identity, scopeEpoch: 2 }); });
    const r = await f.run(); expect(r).toMatchObject({ success: false, status: "refused" });
    expect(JSON.stringify(r)).not.toContain("Process 0");
  });
  it("times out the entire read at eight seconds and never starts a lookup from late scope approval", async () => {
    vi.useFakeTimers(); const f = fixture(); let release!: (v: boolean) => void;
    f.setRevalidate(() => new Promise(resolve => { release = resolve; }));
    const result = f.run(); await vi.advanceTimersByTimeAsync(8_000);
    expect(await result).toMatchObject({ success: false, status: "unavailable" });
    release(true); await vi.advanceTimersByTimeAsync(0); expect(f.calls).toEqual([]);
  });
  it("cancels all original outstanding reads on interruption and ignores late replies", async () => {
    vi.useFakeTimers(); const f = fixture(12), abort = new AbortController(); let release!: (v: Reply) => void;
    const held = new Promise<Reply>(resolve => { release = resolve; }); f.setLookup(() => held);
    const result = f.run(abort.signal); await vi.advanceTimersByTimeAsync(0); expect(f.maximum()).toBe(4);
    abort.abort(); expect(await result).toMatchObject({ success: false, status: "unavailable" });
    const count = f.calls.length; release({ data: posture(), error: null }); await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toHaveLength(count); expect(f.calls.every(x => x.signal?.aborted)).toBe(true);
  });
  it("aborts sibling queries after a transport exception without exposing it or continuing the list", async () => {
    const f = fixture(12); f.setLookup(async () => { throw Error("PRIVATE_TRANSPORT"); });
    const r = await f.run(); expect(r).toMatchObject({ success: false, status: "unavailable" });
    expect(JSON.stringify(r)).not.toContain("PRIVATE_TRANSPORT"); expect(f.maximum()).toBeLessThanOrEqual(4);
    expect(f.calls.filter(x => x.name === "resolve_automation_autonomy").length).toBeLessThanOrEqual(4);
    expect(f.calls.every(x => x.signal?.aborted)).toBe(true);
  });
});
