// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Analytics2 } from "./analytics2";
import type { AnalyticsEvidenceBundle } from "./data/useAnalyticsEvidence";

const evidenceHarness = vi.hoisted(() => ({
  value: {
    bundle: undefined as AnalyticsEvidenceBundle | undefined,
    evidenceReference: undefined as string | undefined,
    loading: false,
    isError: false,
    error: null as unknown,
    retry: vi.fn(),
  },
}));

vi.mock("./data/useAnalyticsEvidence", () => ({
  useAnalyticsEvidence: () => evidenceHarness.value,
}));

let host: HTMLDivElement;
let root: Root;
const openPaige = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  evidenceHarness.value = {
    bundle: undefined,
    evidenceReference: undefined,
    loading: false,
    isError: false,
    error: null,
    retry: vi.fn(),
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(accountName = "Verified Solo Account", accountType: string | null = "standalone") {
  act(() => root.render(<div data-pg="dark" data-tenant-shell><MemoryRouter><Analytics2 accountContext={{ accountName, accountType }} accountEpoch="11111111-1111-4111-8111-111111111111" openPaige={openPaige} /></MemoryRouter></div>));
}

function button(name: string) {
  return [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(name)) as HTMLButtonElement | undefined;
}

describe("Solo Analytics operating workspace", () => {
  it("starts with a semantic-only title and six first-class tabs", () => {
    render();
    const heading = host.querySelector("h1");
    expect(heading?.textContent).toBe("Analytics");
    expect(heading?.classList.contains("anr-sr-only")).toBe(true);
    expect(host.querySelector(".anr-visible-page-title")).toBeNull();
    expect(host.querySelector("[data-tenant-account-name]")?.textContent).toBe("Verified Solo Account");
    expect([...host.querySelectorAll('[role="tab"]')].map((item) => item.textContent)).toEqual([
      "Brief",
      "Sales funnel",
      "Revenue & profit",
      "Retention",
      "Acquisition",
      "Decisions",
    ]);
    expect(host.querySelectorAll(".anr-evidence-wheel")).toHaveLength(1);
  });

  it("renders structural funnels, circles, cohorts, and sources without invented values", () => {
    render();
    act(() => button("Sales funnel")?.click());
    // With no issued bundle this surface must invent NOTHING — not a count, and not a stage
    // NAME. It used to render four hardcoded stages ("Qualified lead", "Proposal",
    // "Commitment", "Confirmed outcome") that the tenant never created, and this assertion
    // pinned them in place by counting them. It now asserts the absence instead.
    expect(host.querySelectorAll(".anr-cylinder-stage")).toHaveLength(0);
    expect(host.textContent).toContain("No proved pipeline stages");
    for (const invented of ["Qualified lead", "Proposal", "Commitment", "Confirmed outcome"]) {
      expect(host.textContent).not.toContain(invented);
    }

    act(() => button("Revenue & profit")?.click());
    expect(host.querySelectorAll(".anr-radial-ring")).toHaveLength(3);
    expect(host.textContent).toContain("No total");

    act(() => button("Retention")?.click());
    expect(host.querySelectorAll(".anr-cohort-cell").length).toBeGreaterThan(10);

    act(() => button("Acquisition")?.click());
    expect(host.querySelectorAll(".anr-source-node")).toHaveLength(3);
    expect(host.textContent).toContain("NOT CONNECTED");

    expect(host.textContent).not.toMatch(/\$[\d,.]+/);
    expect(host.textContent).not.toMatch(/\b\d+(?:\.\d+)?%\b/);
    expect(host.textContent).not.toContain("fixture records");
  });

  it("renders only server-issued stage counts and evidence metadata for a proved funnel", () => {
    const bundle: AnalyticsEvidenceBundle = {
      metric: {
        id: "sales_funnel.created_deals_by_current_stage",
        label: "Created deals by current stage",
        definition: "Deal records created in the exact range, grouped by current stage in the unique default pipeline.",
        formula: "COUNT(deals.id) grouped by current tenant-owned stage",
        version: "1.0.0",
      },
      range: { key: "last_30_days", start: "2026-08-01T00:00:00.000Z", end: "2026-08-31T00:00:00.000Z" },
      source_references: [
        { source: "public.deals", boundary: "active tenant and exact half-open range" },
        { source: "public.pipelines", boundary: "unique active-tenant default pipeline" },
        { source: "public.pipeline_stages", boundary: "tenant stages in that pipeline" },
      ],
      contributing_record_count: 3,
      coverage: { state: "partial", candidate_count: 4, contributing_count: 3, excluded_count: 1 },
      exclusions: [{ reason: "outside default pipeline", count: 1 }],
      freshness: { queried_at: "2026-08-30T19:00:00.000Z", source_updated_through: "2026-08-29T10:00:00.000Z" },
      truth_state: "PARTIAL",
      account_epoch_ref: `ae_v1_${"a".repeat(64)}`,
      source_revision_ref: `sr_v1_${"b".repeat(64)}`,
      reference_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      values: {
        kind: "sales_funnel_stages",
        pipeline_label: "Primary pipeline",
        stages: [
          { stage_key: "qualified", label: "Qualified", stage_type: "open", order: 1, count: 2 },
          { stage_key: "won", label: "Won", stage_type: "won", order: 2, count: 1 },
        ],
      },
      caveats: ["Current stage is observed at query time; no conversion is implied."],
    };
    evidenceHarness.value = {
      bundle,
      evidenceReference: `aneb_v1_${"c".repeat(64)}`,
      loading: false,
      isError: false,
      error: null,
      retry: vi.fn(),
    };
    render();
    act(() => button("Sales funnel")?.click());
    expect(host.querySelectorAll(".anr-cylinder-stage--proved")).toHaveLength(2);
    expect(host.textContent).toContain("Qualified");
    expect(host.textContent).toContain("2 deal records");
    expect(host.textContent).toContain("PARTIAL");
    expect(host.textContent).toContain("3 of 4 candidate records contribute");
    expect(host.textContent).toContain("Exact server-issued boundary");
    expect(host.textContent).not.toContain("aneb_v1_");
    expect(host.textContent).not.toMatch(/\$[\d,.]+/);
    expect(host.textContent).not.toMatch(/\b\d+(?:\.\d+)?%\b/);
  });

  it("renders an authoritative zero only when a LIVE bundle includes the source-backed stage", () => {
    const bundle: AnalyticsEvidenceBundle = {
      metric: {
        id: "sales_funnel.created_deals_by_current_stage",
        label: "Created deals by current stage",
        definition: "Deal records created in the exact range, grouped by current stage in the unique default pipeline.",
        formula: "COUNT(deals.id) grouped by current tenant-owned stage",
        version: "1.0.0",
      },
      range: { key: "last_30_days", start: "2026-08-01T00:00:00.000Z", end: "2026-08-31T00:00:00.000Z" },
      source_references: [
        { source: "public.deals", boundary: "active tenant and exact half-open range" },
        { source: "public.pipelines", boundary: "unique active-tenant default pipeline" },
        { source: "public.pipeline_stages", boundary: "tenant stages in that pipeline" },
      ],
      contributing_record_count: 0,
      coverage: { state: "complete", candidate_count: 0, contributing_count: 0, excluded_count: 0 },
      exclusions: [],
      freshness: { queried_at: "2026-08-31T00:00:00.000Z", source_updated_through: null },
      truth_state: "LIVE",
      account_epoch_ref: `ae_v1_${"a".repeat(64)}`,
      source_revision_ref: `sr_v1_${"b".repeat(64)}`,
      reference_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      values: {
        kind: "sales_funnel_stages",
        pipeline_label: "Primary pipeline",
        stages: [{ stage_key: "stage_1", label: "Qualified", stage_type: "open", order: 1, count: 0 }],
      },
      caveats: ["Current stage is observed at query time; no conversion is implied."],
    };
    evidenceHarness.value = {
      bundle,
      evidenceReference: `aneb_v1_${"c".repeat(64)}`,
      loading: false,
      isError: false,
      error: null,
      retry: vi.fn(),
    };
    render();
    act(() => button("Sales funnel")?.click());
    expect(host.textContent).toContain("LIVE");
    expect(host.textContent).toContain("0 deal records");
    expect(host.textContent).toContain("0 of 0 candidate records contribute");
    expect(host.textContent).not.toMatch(/\b\d+(?:\.\d+)?%\b/);
  });

  it("keeps truth, range, source, and freshness attached to the active visual", () => {
    render();
    const strip = host.querySelector(".anr-evidence-strip");
    expect(strip?.textContent).toContain("Truth");
    expect(strip?.textContent).toContain("UNAVAILABLE");
    expect(strip?.textContent).toContain("Range");
    expect(strip?.textContent).toContain("Local preference · unissued");
    expect(strip?.textContent).toContain("Source");
    expect(strip?.textContent).toContain("No source reference");
    expect(strip?.textContent).toContain("Freshness");
    expect(strip?.textContent).toContain("Not queried");
  });

  it("opens the opaque evidence inspector and restores focus on Escape", () => {
    render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Open evidence"]')!;
    act(() => trigger.focus());
    act(() => trigger.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.classList.contains("anr-drawer")).toBe(true);
    expect(dialog?.parentElement?.getAttribute("data-pg")).toBe("dark");
    expect(dialog?.textContent).toContain("Metric identity");
    expect(dialog?.textContent).toContain("Formula / version");
    expect(dialog?.textContent).toContain("Completeness / coverage");
    expect(host.querySelector("[data-tenant-shell]")?.getAttribute("aria-hidden")).toBe("true");
    expect((host.querySelector("[data-tenant-shell]") as HTMLElement).inert).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close evidence");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect((host.querySelector("[data-tenant-shell]") as HTMLElement).inert).toBe(false);
    expect(host.querySelector("[data-tenant-shell]")?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("traps focus in both directions and cleans up after backdrop and Close exits", () => {
    render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Open evidence"]')!;
    act(() => trigger.click());
    let dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const first = dialog.querySelector<HTMLButtonElement>('[aria-label="Close evidence"]')!;
    const last = dialog.querySelector<HTMLButtonElement>("footer .anr-secondary")!;

    act(() => last.focus());
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })));
    expect(document.activeElement).toBe(first);
    act(() => first.focus());
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true })));
    expect(document.activeElement).toBe(last);

    const layer = dialog.parentElement!;
    act(() => layer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect((host.querySelector("[data-tenant-shell]") as HTMLElement).inert).toBe(false);

    act(() => trigger.click());
    dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    act(() => dialog.querySelector<HTMLButtonElement>("footer .anr-secondary")!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(host.querySelector("[data-tenant-shell]")?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("uses the one existing PAIGE launcher and keeps unsupported analysis disabled", () => {
    render();
    act(() => button("Open PAIGE workspace")?.click());
    expect(openPaige).toHaveBeenCalledTimes(1);
    expect(button("Ask PAIGE for a rundown")?.disabled).toBe(true);
    expect(button("Open analysis workspace")?.disabled).toBe(true);
    expect(host.textContent).toContain("No governed recommendation");
  });

  it("fails closed when the active Solo account cannot be verified", () => {
    render("Your workspace", null);
    expect(host.textContent).toContain("Analytics cannot resolve a verified active Solo account.");
    expect(host.querySelectorAll(".anr-chart-stage")).toHaveLength(0);
    expect(button("Open PAIGE workspace")).toBeUndefined();
  });

  it("keeps range controls local and non-authoritative", () => {
    render();
    act(() => button("Current quarter")?.click());
    expect(button("Current quarter")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("Current quarter");
    expect(host.textContent).toContain("Local preference · unissued");
  });
});
