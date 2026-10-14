/**
 * INT-179 Slice 2b — the ONE dispatch seam (`_shared/paige-orchestration/dispatch-claim.ts`).
 *
 * Every Layer-C act is fired through `dispatchUnderClaim`: claim first, dispatch only on a won claim, and never take
 * over a lost claim for an adapter whose readback cannot prove the effect absent. The static guard at the bottom
 * fails if any orchestration module calls an adapter's dispatch, or the claim RPC, anywhere but this seam — so a
 * future adapter or caller cannot reach a dispatch that skips the claim.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  claimActDispatch,
  dispatchUnderClaim,
  DISPATCH_CLAIM_STALE,
} from "../../supabase/functions/_shared/paige-orchestration/dispatch-claim.ts";
import type { DispatchInput, DispatchResult } from "../../supabase/functions/_shared/paige-orchestration/adapters.ts";

type Call = { fn: string; args: Record<string, unknown> | undefined };
function fakeDb(claim: "won" | "held" | "error" | "throws") {
  const calls: Call[] = [];
  return {
    calls,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (claim === "throws") throw new Error("network");
      if (claim === "error") return { data: null, error: { message: "boom" } };
      if (claim === "held") return { data: { id: null }, error: null }; // PostgREST's all-null composite
      return { data: { id: "11111111-1111-4111-8111-111111111111" }, error: null };
    },
  };
}

const input = {
  tenantId: "t", actionKind: "crm.advance_journey_stage", args: {}, correlationRef: "c", db: {} as DispatchInput["db"],
  subjectTable: "clients", subjectId: "s",
} as DispatchInput;

function adapter(lostClaimRecovery: "readback_proves_absence" | "outcome_unknown", impl?: () => Promise<DispatchResult>) {
  let fired = 0;
  return {
    get fired() { return fired; },
    lostClaimRecovery,
    dispatch: async () => { fired++; return impl ? impl() : ({ outcome: "executed" } as DispatchResult); },
  };
}

describe("dispatchUnderClaim — claim first, dispatch only on a won claim", () => {
  it("a won claim dispatches exactly once and returns the adapter's result", async () => {
    const db = fakeDb("won"); const a = adapter("readback_proves_absence");
    const d = await dispatchUnderClaim(db, "e", "a", a, input);
    expect(d).toEqual({ kind: "dispatched", result: { outcome: "executed" } });
    expect(a.fired).toBe(1);
    expect(db.calls.map((c) => c.fn)).toEqual(["paige_claim_act_dispatch"]);
  });

  it("a claim held elsewhere dispatches nothing", async () => {
    const a = adapter("readback_proves_absence");
    expect(await dispatchUnderClaim(fakeDb("held"), "e", "a", a, input)).toEqual({ kind: "held" });
    expect(a.fired).toBe(0);
  });

  it("a claim that cannot be read or written dispatches nothing (infra → retry later)", async () => {
    for (const mode of ["error", "throws"] as const) {
      const a = adapter("readback_proves_absence");
      expect(await dispatchUnderClaim(fakeDb(mode), "e", "a", a, input)).toEqual({ kind: "claim_error" });
      expect(a.fired).toBe(0);
    }
  });

  it("an adapter that throws is recorded ambiguous, never executed or failed (the call may have gone out)", async () => {
    const a = adapter("readback_proves_absence", async () => { throw new Error("socket closed"); });
    const d = await dispatchUnderClaim(fakeDb("won"), "e", "a", a, input);
    expect(d).toEqual({ kind: "dispatched", result: { outcome: "ambiguous", providerRef: null, detail: { reason: "adapter_threw" }, error: "socket closed" } });
  });

  it("only an adapter whose readback proves absence may take over a lost claim", async () => {
    const proves = fakeDb("won");
    await dispatchUnderClaim(proves, "e", "a", adapter("readback_proves_absence"), input);
    expect(proves.calls[0].args).toMatchObject({ _event_id: "e", _act_id: "a", _stale_after: DISPATCH_CLAIM_STALE, _allow_retake: true });
    const unknown = fakeDb("won");
    await dispatchUnderClaim(unknown, "e", "a", adapter("outcome_unknown"), input);
    expect(unknown.calls[0].args).toMatchObject({ _allow_retake: false });
  });

  it("an adapter with no dispatch is reported not_dispatchable, never 'held' (and nothing is claimed)", async () => {
    const db = fakeDb("won");
    expect(await dispatchUnderClaim(db, "e", "a", { lostClaimRecovery: "outcome_unknown" }, input)).toEqual({ kind: "not_dispatchable" });
    expect(db.calls).toEqual([]);
  });

  it("claimActDispatch keeps the prior default (re-take allowed) for a caller that does not say otherwise", async () => {
    const db = fakeDb("won");
    expect(await claimActDispatch(db, "e", "a")).toEqual({ ok: true, claimed: true });
    expect(db.calls[0].args).toMatchObject({ _allow_retake: true });
    expect(typeof db.calls[0].args?._claim).toBe("string");
  });
});

describe("no edge module dispatches around the seam (static guard)", () => {
  const root = resolve(process.cwd(), "supabase/functions");
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(resolve(d, e.name)) : e.name.endsWith(".ts") ? [resolve(d, e.name)] : []);
  const files = walk(root).map((f) => relative(root, f).split("\\").join("/"));
  const SEAM = "_shared/paige-orchestration/dispatch-claim.ts";
  // Adapter modules DEFINE dispatch and may delegate to their own per-action executor; that is not a call site.
  const ADAPTER_DEFINITIONS = new Set([
    "_shared/paige-orchestration/adapters.ts",
    "_shared/paige-orchestration/native-adapter.ts",
    "_shared/paige-orchestration/n8n-adapter.ts",
  ]);
  const read = (f: string) => readFileSync(resolve(root, f), "utf8");

  it("covers every edge function and the modules that fire acts (the guard would be vacuous if they moved)", () => {
    expect(files).toEqual(expect.arrayContaining([
      SEAM, "_shared/paige-orchestration/engine.ts", "_shared/paige-orchestration/approve-executor.ts",
      "execute-approval/index.ts", "paige-native-event-dispatch/index.ts",
    ]));
    expect(files.length).toBeGreaterThan(100);
  });

  it("only the seam calls an adapter's dispatch", () => {
    const offenders = files
      .filter((f) => f !== SEAM && !ADAPTER_DEFINITIONS.has(f))
      .filter((f) => /\.dispatch\s*\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("only the seam calls the claim RPC", () => {
    const offenders = files.filter((f) => f !== SEAM).filter((f) => read(f).includes("paige_claim_act_dispatch"));
    expect(offenders).toEqual([]);
  });

  it("the guard bites: a module that dispatched directly would be caught", () => {
    expect(/\.dispatch\s*\(/.test("try { dr = await plan.adapter.dispatch(nativeInput); }")).toBe(true);
  });
});

describe("the reconciler's claim-liveness window is DISPATCH_CLAIM_STALE (drift guard)", () => {
  const dir = resolve(process.cwd(), "supabase/migrations");
  const latest = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .filter((f) => /create or replace function public\.paige_reconcile_orchestration_acts\(/i.test(readFileSync(resolve(dir, f), "utf8")))
    .pop()!;
  const body = readFileSync(resolve(dir, latest), "utf8");

  it("the latest reconciler judges a claim live by the same window the callers claim with", () => {
    expect(latest).toBeTruthy();
    const m = body.match(/_claim_at::timestamptz >= now\(\) - interval '([^']+)'/);
    expect(m?.[1]).toBe(DISPATCH_CLAIM_STALE);
  });
});
