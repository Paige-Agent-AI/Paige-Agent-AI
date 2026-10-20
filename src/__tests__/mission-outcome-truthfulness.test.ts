import { createRequestKeyKeeper, classifyInvokeFailure } from "@/solo/mission-retry";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { harnessApi } from "./mission-retry-component-harness";

/**
 * PR-B — P0 mission outcome-unknown truthfulness + retry idempotency.
 *
 * PR4 found two coupled defects in consequential Business Game Plan writes:
 * (1) MISSION_WRITE_OUTCOME_UNKNOWN was presented to the owner like an
 * ordinary failure, and (2) a retry minted a fresh request_key — so if the
 * first write actually committed but its response was lost, the owner's retry
 * executed the same business mutation a second time.
 *
 * The backend already owns the correct reconciliation machinery
 * (business_mission_mutation_receipts, unique per tenant+actor+key; same key
 * + same payload replays the stored receipt with replayed:true BEFORE any
 * revision checks; MISSION_IDEMPOTENCY_CONFLICT on payload drift). This
 * contract pins the client-side half: stable identity per logical intent,
 * truthful three-state outcome rendering, and transport-vs-business failure
 * separation.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("request-key lifecycle: one logical intent = one stable key", () => {
  it("an unchanged payload reuses the exact original key (retry = reconcile, not a new write)", () => {
    const keeper = createRequestKeyKeeper();
    const first = keeper.keyFor('{"title":"A"}');
    const retry = keeper.keyFor('{"title":"A"}');
    expect(retry.key).toBe(first.key);
    expect(retry.reused).toBe(true);
    expect(first.reused).toBe(false);
  });

  it("a changed payload is a genuinely new intent and gets a new key", () => {
    const keeper = createRequestKeyKeeper();
    const first = keeper.keyFor('{"title":"A"}');
    const changed = keeper.keyFor('{"title":"B"}');
    expect(changed.key).not.toBe(first.key);
    expect(changed.reused).toBe(false);
  });

  it("a settled (confirmed) operation releases the identity — the next save is new", () => {
    const keeper = createRequestKeyKeeper();
    const first = keeper.keyFor('{"title":"A"}');
    keeper.settle();
    const next = keeper.keyFor('{"title":"A"}');
    expect(next.key).not.toBe(first.key);
  });

  it("keys are UUIDs the backend can store", () => {
    const { key } = createRequestKeyKeeper().keyFor("x");
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("keeper is the ONLY mint site — PlanInMotion no longer calls crypto.randomUUID directly", () => {
    // Before PR-B the component minted a fresh key inside save() and
    // transition() on every call — the double-write hazard. Both flows now
    // route through the keeper, so the component itself must contain no
    // direct mint.
    expect(read("src/solo/PlanInMotion.tsx")).not.toContain("crypto.randomUUID");
    expect(read("src/solo/mission-retry.ts")).toContain("crypto.randomUUID");
  });
});

describe("transport failure is not business failure (outcome classification)", () => {
  it("a fetch/relay failure with no readable edge body is OUTCOME UNKNOWN, never definite failure", () => {
    // A network timeout after submission does not prove the mutation failed.
    const networkFailure = Object.assign(new Error("fetch failed"), {});
    const outcome = classifyInvokeFailure(networkFailure);
    expect(outcome.outcomeUnknown).toBe(true);
    expect(outcome.code).toBe("MISSION_WRITE_OUTCOME_UNKNOWN");
  });

  it("an edge response body with a code is the edge's own classification (definite)", () => {
    const outcome = classifyInvokeFailure(null, { success: false, code: "MISSION_OWNER_REQUIRED" });
    expect(outcome.outcomeUnknown).toBe(false);
    expect(outcome.code).toBe("MISSION_OWNER_REQUIRED");
  });

  it("a non-2xx edge response with an unreadable body stays outcome-unknown (fail-closed)", () => {
    const outcome = classifyInvokeFailure(Object.assign(new Error("RelayError"), {}));
    expect(outcome.outcomeUnknown).toBe(true);
  });
});

describe("the backend replay contract this fix relies on (source pins)", () => {
  const migration = read("supabase/migrations/20260905221203_business_mission_foundation.sql");
  const brain = read("supabase/functions/_shared/business-mission-tenant-brain.ts");

  it("request keys are scoped to tenant + actor", () => {
    expect(migration).toContain("unique (tenant_id,actor_user_id,request_key)");
  });

  it("same key + same payload replays the stored receipt; drifted payload fails closed", () => {
    expect(migration).toContain("MISSION_IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("return r.result||jsonb_build_object('replayed',true)");
  });

  it("replay is checked BEFORE the revision guard, so a lost response after commit still reconciles", () => {
    // The revise/transition replay branch must precede the
    // MISSION_REVISION_CONFLICT check — otherwise a same-key retry after the
    // first write bumped the revision could never recover its receipt.
    for (const fn of ["revise_business_mission_brief", "transition_business_mission"]) {
      const start = migration.indexOf(`create or replace function public.${fn}`);
      const replayAt = migration.indexOf("return r.result||jsonb_build_object('replayed',true)", start);
      const revisionGuardAt = migration.indexOf("if m.revision is distinct from p_expected_revision", start);
      expect(replayAt, fn).toBeGreaterThan(-1);
      expect(revisionGuardAt, fn).toBeGreaterThan(-1);
      expect(replayAt, `${fn}: replay must precede the revision guard`).toBeLessThan(revisionGuardAt);
    }
  });

  it("the tenant brain already separates definite RPC failure from transport ambiguity", () => {
    expect(brain).toContain('code: "MISSION_WRITE_OUTCOME_UNKNOWN"');
    expect(brain).toContain("mutationMayHavePersisted: true");
    expect(brain).toContain("mutationMayHavePersisted: false");
    // The tenant-brain comment records WHY a revision mismatch is not
    // pre-rejected: same-request receipt replay must stay recoverable.
    expect(brain).toContain("unable to recover its verified readback");
  });

  it("the hook surfaces outcome ambiguity instead of flattening it to a code", () => {
    expect(read("src/solo/data/useBusinessGamePlanMissions.ts")).toContain("outcomeUnknown");
    expect(read("src/solo/data/useBusinessGamePlanMissions.ts")).toContain("classifyInvokeFailure");
  });
});

describe("owner-facing truthfulness in PlanInMotion (component)", () => {
  it("withholds the form and writer while the account is unresolved", async () => {
    const harness = harnessApi;
    harness.setAccountReady(false);
    await harness.renderPlan(); await harness.openCreate();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.mutate).not.toHaveBeenCalled(); expect(harness.reconcileBanner()).toBeNull();
  });
  it("outcome-unknown renders the distinct reconcile state, not the generic failure copy", async () => {
    const harness = harnessApi;
    await harness.renderPlan();
    await harness.fillCreateForm();
    harness.mutate.mockResolvedValueOnce({ ok: false, verified: false, railRecorded: false, outcomeUnknown: true, code: "MISSION_WRITE_OUTCOME_UNKNOWN" });
    await harness.save();
    const banner = harness.reconcileBanner();
    expect(banner, "distinct reconcile banner must render").toBeTruthy();
    expect(banner!.textContent).toContain("couldn't confirm");
    expect(banner!.textContent!.toLowerCase()).not.toContain("could not be verified");
    expect(harness.checkAgainButton(), "reconcile action must exist").toBeTruthy();
  });

  it("Check again after outcome-unknown reuses the EXACT original request key", async () => {
    const harness = harnessApi;
    await harness.renderPlan();
    await harness.fillCreateForm();
    harness.mutate.mockResolvedValueOnce({ ok: false, verified: false, railRecorded: false, outcomeUnknown: true });
    await harness.save();
    const firstKey = harness.lastRequestKey();
    expect(firstKey).toBeTruthy();
    await harness.checkAgain();
    const secondKey = harness.lastRequestKey();
    expect(secondKey).toBe(firstKey);
  });

  it("editing the content after outcome-unknown is a new intent and gets a new key", async () => {
    const harness = harnessApi;
    await harness.renderPlan();
    await harness.fillCreateForm();
    harness.mutate.mockResolvedValueOnce({ ok: false, verified: false, railRecorded: false, outcomeUnknown: true });
    await harness.save();
    const firstKey = harness.lastRequestKey();
    await harness.setCreateField("Title", "A different play");
    harness.mutate.mockResolvedValueOnce({ ok: true, verified: true, railRecorded: true, missionId: "m1" });
    await harness.save();
    expect(harness.lastRequestKey()).not.toBe(firstKey);
  });

  it("a definite failure keeps the ordinary error path — no reconcile banner", async () => {
    const harness = harnessApi;
    await harness.renderPlan();
    await harness.fillCreateForm();
    harness.mutate.mockResolvedValueOnce({ ok: false, verified: false, railRecorded: false, outcomeUnknown: false, code: "MISSION_REVISION_CONFLICT" });
    await harness.save();
    expect(harness.reconcileBanner()).toBeNull();
    expect(harness.errorText()).toContain("changed elsewhere");
  });

  it("success settles the operation: a later identical save is a new identity", async () => {
    const harness = harnessApi;
    await harness.renderPlan();
    await harness.fillCreateForm();
    harness.mutate.mockResolvedValueOnce({ ok: true, verified: true, railRecorded: true, missionId: "m1" });
    await harness.save();
    const firstKey = harness.lastRequestKey();
    // Success closes the create drawer; starting the same play again with
    // identical content is a NEW operation and must get a NEW identity.
    await harness.fillCreateForm();
    harness.mutate.mockResolvedValueOnce({ ok: true, verified: true, railRecorded: true, missionId: "m2" });
    await harness.save();
    expect(harness.lastRequestKey()).not.toBe(firstKey);
  });

  it("Approve (view drawer, no pending step) after outcome-unknown reconciles under the original key", async () => {
    // The adversarial-review case: Approve/Resume call transition("active")
    // directly without a pending confirm, so reconcile() must remember the
    // last attempted transition target — otherwise Check again is a dead
    // button exactly where an ambiguous approval needs it.
    const harness = harnessApi;
    await harness.renderPlan();
    harness.seedProposedPlay();
    // Re-render so the seeded items are picked up, then open the play drawer.
    await harness.renderPlan();
    await harness.openFirstPlay();
    harness.mutate.mockResolvedValueOnce({ ok: false, verified: false, railRecorded: false, outcomeUnknown: true });
    await harness.approve();
    const firstKey = harness.lastRequestKey();
    expect(firstKey).toBeTruthy();
    expect(harness.reconcileBanner(), "reconcile banner in the view drawer").toBeTruthy();
    await harness.checkAgain();
    expect(harness.lastRequestKey()).toBe(firstKey);
  });

  it("an account switch mid-flight fails closed and does not offer reconcile", async () => {
    const harness = harnessApi;
    await harness.renderPlan();
    await harness.fillCreateForm();
    harness.mutate.mockResolvedValueOnce({ ok: false, verified: false, railRecorded: false, outcomeUnknown: false, code: "ACTIVE_ACCOUNT_CHANGED" });
    await harness.save();
    expect(harness.reconcileBanner()).toBeNull();
    expect(harness.errorText()).toContain("workspace changed");
  });
});
