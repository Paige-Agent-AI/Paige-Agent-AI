// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * useSoloGamePlan — the derivation contract (owner corrections #1/#2, 2026-09-05).
 *
 * Composes only released, tenant-safe reads. These drive the real hook against mocked sub-hooks
 * and prove the HONESTY rules: coverage is a real numerator/denominator (never a fabricated
 * score); an empty *recorded* feed reads "No recorded work yet" (not "nothing happened"); a
 * blocking system-check finding produces a blocked best move; a fresh workspace is `empty`.
 */

// Loose test doubles for the composed sub-hooks — the hook consumes the REAL module types (vi.mock
// swaps the implementation, not the type), so a `Record<string, unknown>` double is enough and
// keeps the file free of `any` (the CI changed-src eslint gate lints test files too).
type Loose = Record<string, unknown>;
const m = vi.hoisted(() => ({
  cc: {} as Loose, setup: {} as Loose, catalog: {} as Loose, knowledge: {} as Loose,
  pending: {} as Loose, checks: {} as Loose, activity: {} as Loose, tenant: {} as Loose,
  campaigns: {} as Loose,
}));

vi.mock("./useCommandCenter", () => ({ useCommandCenter: () => m.cc }));
vi.mock("./useSoloSetupBrief", () => ({ useSoloSetupBrief: () => m.setup }));
vi.mock("../useCatalogOffers", () => ({ useCatalogOffers: () => m.catalog }));
vi.mock("./useSoloKnowledge", () => ({ useSoloKnowledge: () => m.knowledge }));
vi.mock("./useSoloPendingActions", () => ({ useSoloPendingActions: () => m.pending }));
vi.mock("@/hooks/useSystemsCheck", () => ({ useSystemsCheck: () => m.checks }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => m.tenant }));
vi.mock("../useSoloCampaignBriefs", () => ({ useSoloCampaignBriefs: () => m.campaigns }));
vi.mock("./useSoloActivityFeed", () => ({
  useSoloActivityFeed: () => m.activity,
  elapsedLabel: () => "1m ago",
  departmentLabel: () => "Client Success",
}));

import { useSoloGamePlan, type SoloGamePlanView } from "./useSoloGamePlan";

let container: HTMLDivElement;
let root: Root;
let view: SoloGamePlanView;

function Probe() {
  view = useSoloGamePlan("42", "42");
  return null;
}
function render() {
  act(() => { root.render(React.createElement(Probe)); });
}

/** Baseline: everything loaded, nothing set up (a fresh workspace). */
function resetEmpty() {
  m.cc = { loading: false, isError: false, empty: true, greeting: { name: "Jordan" }, attention: {}, counts: { approvals: 0 }, refresh: vi.fn() };
  m.setup = { loading: false, error: null, brief: {}, managedSendingEmail: null, refresh: vi.fn() };
  m.catalog = { phase: "ready", offers: [], retry: vi.fn() };
  m.knowledge = { loading: false, error: null, documentsIndexed: 0, empty: true, refresh: vi.fn() };
  m.pending = { items: [], loading: false, error: null, refresh: vi.fn() };
  m.checks = { run: null, findings: [], loading: false, isError: false, scanPending: false, refresh: vi.fn() };
  m.activity = { items: [], loading: false, status: "loading", error: null, refresh: vi.fn() };
  m.campaigns = { phase: "ready", briefs: [], archivedCount: 0, canManage: true, retry: vi.fn() };
  // Default: the signed-in user OWNS the active workspace — a NON-staff viewer with an active tenant
  // is, by RLS scoping, in their own workspace (the normal Solo case). `activeTenant.name` is the
  // business name, distinct from any personal greeting name.
  m.tenant = { isPlatformStaff: false, activeTenantId: "42", activeTenant: { name: "Clearpath Advisory" } };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  resetEmpty();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("useSoloGamePlan derivation", () => {
  it("coverage is a real numerator/denominator over five foundations", () => {
    render();
    expect(view.coverage.total).toBe(5);
    expect(view.coverage.grounded).toBe(0);
    expect(view.foundation.length).toBe(5);
  });

  it("detects a genuinely empty (fresh) workspace", () => {
    render();
    expect(view.empty).toBe(true);
  });

  it("a fully-set-up workspace grounds all five foundations and is not empty", () => {
    m.setup.brief = { publicName: "Clearpath Advisory", legalName: "Clearpath LLC", industry: "Consulting", website: "clearpath.example", provenance: { website: { source: "owner_confirmed" } } };
    m.setup.managedSendingEmail = "hello@clearpath.example";
    m.catalog.offers = [{ availability: "active" }, { availability: "active" }];
    m.knowledge = { ...m.knowledge, documentsIndexed: 6, empty: false };
    render();
    expect(view.coverage.grounded).toBe(5);
    expect(view.empty).toBe(false);
    expect(view.bestMove).toBeTruthy();
  });

  it("an empty recorded feed reads 'No recorded work yet' (never 'nothing happened')", () => {
    m.activity = { ...m.activity, status: "ready", items: [] };
    render();
    expect(view.motion.status).toBe("ready");
    expect(view.motion.freshness).toBe("No recorded work yet");
  });

  it("renders real recorded activity when the feed has rows", () => {
    m.activity = {
      status: "ready", loading: false, error: null, refresh: vi.fn(),
      items: [{ id: "e1", title: "Sent a follow-up", summary: null, byPaige: true, actorAgent: null, departmentSlug: "client_experience", occurredAt: "2026-09-03T10:00:00Z" }],
    };
    render();
    expect(view.motion.items.length).toBe(1);
    expect(view.motion.items[0].department).toBe("Client Success");
    expect(view.motion.items[0].when).toBe("1m ago");
  });

  it("a blocking system-check finding produces a blocked best move + a 'move blocked' chip", () => {
    m.checks.findings = [{
      id: "f1", check_id: "some_check", status: "fail", severity_at_finding: "blocking",
      paige_interpretation: "Your sending identity isn't verified.", check_name: "Sending identity",
    }];
    render();
    expect(view.bestMove?.proof).toBe("blocked");
    expect(view.bestMove?.blockedReason).toContain("sending identity isn't verified");
    expect(view.attention.some((a) => a.label === "1 move blocked")).toBe(true);
  });

  /** All five foundations grounded, so no setup-gap candidate competes with the fallback. */
  function groundAllFive() {
    m.setup.brief = { publicName: "Clearpath Advisory", legalName: "Clearpath LLC", industry: "Consulting", website: "clearpath.example", provenance: { website: { source: "owner_confirmed" } } };
    m.setup.managedSendingEmail = "hello@clearpath.example";
    m.catalog.offers = [{ availability: "active" }, { availability: "active" }];
    m.knowledge = { ...m.knowledge, documentsIndexed: 6, empty: false };
  }

  it("a FAILED systems-check read never reads as all-clear — it says 'couldn't check' honestly (§13)", () => {
    // Everything grounded, nothing else waiting, but the checks RPC errored. The old bug coerced
    // checks.findings to [] and fired the all-clear fallback ("Nothing is blocked or waiting").
    groundAllFive();
    m.checks = { ...m.checks, findings: [], isError: true };
    render();
    expect(view.bestMove?.id).toBe("degraded:signals");
    expect(view.bestMove?.destination).toBe("systems-check");
    expect(view.bestMove?.evidence).not.toContain("Nothing is blocked");
    expect(view.attention.some((a) => a.label === "Couldn't check your systems")).toBe(true);
    expect(view.narrative).toContain("couldn't fully check");
  });

  it("demotes blocking/high system-check fails into Plan dependencies, and marks the read READY", () => {
    m.checks.findings = [
      { id: "b1", status: "fail", severity_at_finding: "blocking", paige_interpretation: "Sending identity not verified — verify it." },
      { id: "h1", status: "fail", severity_at_finding: "high", paige_interpretation: "No payment processor declared yet — tell Paige which one." },
      { id: "m1", status: "fail", severity_at_finding: "medium", paige_interpretation: "Add a second knowledge source." },
      { id: "p1", status: "pass", severity_at_finding: "blocking", paige_interpretation: "All good." },
    ];
    render();
    // Only blocking + high FAILS become dependencies (never a pass, never medium/low).
    expect(view.dependencies.map((d) => d.id)).toEqual(["dep:b1", "dep:h1"]);
    expect(view.dependencies[0].blocking).toBe(true);
    expect(view.dependencies[0].title).toBe("Sending identity not verified");
    expect(view.dependenciesStatus).toBe("ready");
  });

  it("a FAILED systems-check read marks dependencies 'unavailable' — never a false all-clear (§13)", () => {
    // findings coerces to [] on an errored read; the card must NOT show that as "All clear".
    m.checks = { ...m.checks, findings: [], isError: true };
    render();
    expect(view.dependencies.length).toBe(0);
    expect(view.dependenciesStatus).toBe("unavailable");
  });

  it("a FAILED drafts (pending) read never reads as all-clear (§13)", () => {
    groundAllFive();
    m.pending = { ...m.pending, items: [], error: new Error("pending read failed") };
    render();
    expect(view.bestMove?.id).toBe("degraded:signals");
    expect(view.bestMove?.destination).toBe("paige");
    expect(view.attention.some((a) => a.label === "Couldn't load your drafts")).toBe(true);
  });

  it("a knowledge READ OUTAGE is not counted as owner work 'to finish' (§13)", () => {
    m.knowledge = { ...m.knowledge, error: new Error("knowledge read failed"), empty: false };
    render();
    const know = view.foundation.find((f) => f.key === "knowledge");
    expect(know?.degraded).toBe(true);
    expect(view.coverage.degraded).toBeGreaterThanOrEqual(1);
    // The caption owns the honesty: the failed read reads "couldn't load", never "to finish".
    expect(view.coverage.caption).toContain("couldn't load");
  });

  it("a workspace with a plan direction set is NOT first-run empty — the strategy must not be hidden (Codex P1)", () => {
    // cc.empty + no offers/knowledge/pending, but the owner HAS set an annual direction.
    m.setup.brief = { annualDirection: "Become the default ops advisor in the Northeast." };
    render();
    expect(view.empty).toBe(false);
    expect(view.planBrief.hasPlan).toBe(true);
  });

  it("a workspace with campaign briefs is NOT first-run empty (Codex P1)", () => {
    m.campaigns = { ...m.campaigns, phase: "ready", briefs: [{ id: "c1", objective: "Launch" }] };
    render();
    expect(view.empty).toBe(false);
  });

  it("decisionsStatus is 'unavailable' on a failed drafts read — never a silent 'All caught up' (Codex P2)", () => {
    m.pending = { ...m.pending, items: [], error: new Error("drafts read failed") };
    render();
    expect(view.decisionsStatus).toBe("unavailable");
  });

  it("proposalPlanOnly reflects whether the proposal patch stays within the plan fields (Codex P1)", () => {
    m.setup = { ...m.setup, pendingProposal: { id: "p1", reason: "r", patch: { currentPriority: "x", goals90Day: "y" } } };
    render();
    expect(view.planBrief.proposalPlanOnly).toBe(true);
    m.setup = { ...m.setup, pendingProposal: { id: "p2", reason: "r", patch: { currentPriority: "x", legalName: "Acme LLC" } } };
    render();
    expect(view.planBrief.proposalPlanOnly).toBe(false);
  });

  it("applyProposal REFUSES a proposal that reaches beyond the plan fields (Codex P1)", async () => {
    const save = vi.fn();
    m.setup = { ...m.setup, save, pendingProposal: { id: "p2", reason: "r", patch: { currentPriority: "x", website: "evil.example" } } };
    render();
    const res = await view.planBrief.applyProposal();
    expect(res.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("the plan confirmation date derives from the plan fields' provenance, not the whole-record updatedAt (Codex P2)", () => {
    m.setup.brief = {
      annualDirection: "Grow.",
      updatedAt: "2026-09-06T12:00:00Z", // advanced by an unrelated Setup save
      provenance: { annualDirection: { source: "owner_confirmed", confirmedAt: "2026-01-15T00:00:00Z" } },
    };
    render();
    expect(view.planBrief.updatedAt).toBe("2026-01-15T00:00:00Z");
    expect(view.planBrief.updatedAt).not.toBe("2026-09-06T12:00:00Z");
  });

  it("surfaces work Paige drafted as an owner-approval move", () => {
    m.pending.items = [{ id: "p1", title: "Draft email", summary: null, draftContent: null, rationale: "Client went quiet.", department: "Client Success", createdAt: "" }];
    render();
    const move = [view.bestMove, ...view.priorities].find((x) => x?.id === "pending:drafts");
    expect(move).toBeTruthy();
    expect(move?.owner).toBe("paige");
    expect(move?.destination).toBe("paige");
  });

  // ── owner corrections 2026-09-05 (authenticated live-data verification) ───────────────────

  it("greets the signed-in person by name ONLY when they own the active workspace (§57 identity)", () => {
    // Owner case (default fixture): a NON-staff viewer with an active workspace is in their own HQ.
    m.cc.greeting = { name: "Riley" };
    render();
    expect(view.greeting.name).toBe("Riley");
  });

  it("does NOT paste the viewer's name over a workspace they do not own — greets neutrally (§57)", () => {
    // A super-admin / operator viewing a tenant via act-as: platform staff, so NOT their own HQ.
    m.cc.greeting = { name: "Riley" };
    m.tenant = { isPlatformStaff: true, activeTenantId: "t2", activeTenant: { name: "Northwind Advisory" } };
    render();
    expect(view.greeting.name).toBe("there");
    expect(view.greeting.name).not.toBe("Riley");
  });

  it("greets neutrally when the only name available is the business-name fallback — even for the owner (§57/§13)", () => {
    // useCommandCenter's greeting.name resolves to `authName || activeTenant.name || "there"`, so an
    // OWNER with no auth display name (unset on prod for sub-accounts + some solo tenants) gets the
    // WORKSPACE name here. It must never be voiced as a person ("Good evening, Northwind") — a name
    // equal to the workspace name is treated as "no personal name" and the greeting stays neutral.
    m.cc.greeting = { name: "Northwind Advisory" };
    m.tenant = { isPlatformStaff: false, activeTenantId: "t2", activeTenant: { name: "Northwind Advisory" } };
    render();
    expect(view.greeting.name).toBe("there");
    expect(view.greeting.name).not.toBe("Northwind");
  });

  it("a failing check's TITLE describes the real state, never an unachieved goal (payment, §13)", () => {
    // The payment-processor check overstated as 'You can take payment' on a BLOCKED move; the honest
    // title is the STATE clause of paige_interpretation.
    m.checks.findings = [{
      id: "pp", check_id: "payment_processor_connected", status: "fail", severity_at_finding: "blocking",
      paige_interpretation: "No payment processor declared yet — tell Paige which processor the business uses (Stripe, PayPal, Square, a bank merchant account, QuickBooks Payments, or manual).",
    }];
    render();
    const move = [view.bestMove, ...view.priorities].find((x) => x?.id === "check:pp");
    expect(move?.title).toBe("No payment processor declared yet");
    expect(move?.title).not.toContain("You can take payment");
    // The full declare-oriented copy is preserved as the reason (§38: declare, not "can't take payment").
    expect(move?.blockedReason).toContain("tell Paige which processor");
    expect(move?.blockedReason).not.toContain("can't take payment");
  });

  it("every summary chip carries a real destination so it can be opened (§36 drill-down)", () => {
    m.cc = { ...m.cc, counts: { approvals: 2 }, attention: { at_risk_clients: 3, follow_ups_due: 1 } };
    render();
    const byLabel = (needle: string) => view.attention.find((a) => a.label.includes(needle));
    expect(byLabel("drafts waiting")?.destination).toBe("paige");
    expect(byLabel("contacts at risk")?.destination).toBe("clients");
    expect(byLabel("follow-up")?.destination).toBe("clients");
    // Every chip has SOME real destination — none is a dead label.
    expect(view.attention.every((a) => typeof a.destination === "string" && a.destination.length > 0)).toBe(true);
  });
});
