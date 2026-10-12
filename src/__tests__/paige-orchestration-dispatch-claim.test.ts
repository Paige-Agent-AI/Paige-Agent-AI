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
import { resolve } from "node:path";
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

  it("claimActDispatch keeps the prior default (re-take allowed) for a caller that does not say otherwise", async () => {
    const db = fakeDb("won");
    expect(await claimActDispatch(db, "e", "a")).toEqual({ ok: true, claimed: true });
    expect(db.calls[0].args).toMatchObject({ _allow_retake: true });
    expect(typeof db.calls[0].args?._claim).toBe("string");
  });
});

describe("no Layer-C module dispatches around the seam (static guard)", () => {
  const dir = resolve(process.cwd(), "supabase/functions/_shared/paige-orchestration");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  // Adapter modules DEFINE dispatch and may delegate to their own per-action executor; that is not a call site.
  const ADAPTER_DEFINITIONS = new Set(["adapters.ts", "native-adapter.ts", "n8n-adapter.ts"]);

  it("covers the modules that fire acts (the guard would be vacuous if they moved)", () => {
    expect(files).toEqual(expect.arrayContaining(["engine.ts", "approve-executor.ts", "dispatch-claim.ts"]));
  });

  it("only dispatch-claim.ts calls an adapter's dispatch", () => {
    const offenders = files
      .filter((f) => f !== "dispatch-claim.ts" && !ADAPTER_DEFINITIONS.has(f))
      .filter((f) => /\.dispatch\s*\(/.test(readFileSync(resolve(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("only dispatch-claim.ts calls the claim RPC", () => {
    const offenders = files
      .filter((f) => f !== "dispatch-claim.ts")
      .filter((f) => readFileSync(resolve(dir, f), "utf8").includes("paige_claim_act_dispatch"));
    expect(offenders).toEqual([]);
  });

  it("the guard bites: a module that dispatched directly would be caught", () => {
    expect(/\.dispatch\s*\(/.test("try { dr = await plan.adapter.dispatch(nativeInput); }")).toBe(true);
  });
});
