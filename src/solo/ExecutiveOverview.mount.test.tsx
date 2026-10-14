// @vitest-environment jsdom
// E2-6 — the Executive Overview: mount contract. The seam (useBusinessReview) and the action
// bus (useSoloPendingActions) are stubbed at their module boundaries; every rendered state,
// link and truthful distinction is asserted against real fixture data shaped like the
// composer's snapshot (the shape useBusinessReview declares).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./data/useBusinessReview", () => ({ useBusinessReview: vi.fn() }));
vi.mock("./data/useSoloPendingActions", () => ({ useSoloPendingActions: vi.fn() }));

const reviewMock = vi.mocked(await import("./data/useBusinessReview")).useBusinessReview;
const pendingMock = vi.mocked(await import("./data/useSoloPendingActions")).useSoloPendingActions;

const SNAPSHOT_READY = {
  period: { label: "last 7 days", start: "2026-10-06T04:00:00.000Z", end: "2026-10-13T04:00:00.000Z", timezone: "America/New_York" },
  composed_at: "2026-10-13T14:00:00.000Z",
  requested: ["payments", "sales_pipeline", "operations", "clients", "campaigns"],
  domains: {
    payments: { status: "available", data: { domain: "payments", as_of: "2026-10-13T14:00:00.000Z", coverage: "complete", headline: [
      { key: "payments.cash_recorded_received_usd", label: "Cash recorded as received", value: 125000, unit: "currency_minor", currency: "USD", basis: "in_period", window_note: "counted up to just now; the period ends later" },
    ], risks: [{ kind: "receivables", summary: "USD 300.00 is overdue right now", severity: "act" }], changes: [] } },
    sales_pipeline: { status: "available", data: { domain: "sales_pipeline", as_of: "2026-10-13T14:00:00.000Z", coverage: "complete", headline: [
      { key: "sales.pipeline.open_value_usd", label: "Open pipeline value", value: 420000, unit: "currency_minor", currency: "USD", basis: "right_now" },
    ], risks: [{ kind: "pipeline", summary: "2 open opportunities older than 30 days", severity: "watch" }], changes: [{ summary: "Opportunities created up 2 versus the previous 7 days." }] } },
    operations: { status: "available", data: { domain: "operations", as_of: "2026-10-13T14:00:00.000Z", coverage: "partial", coverage_note: "Two figures could not be read; shown figures are complete.", headline: [
      { key: "operations.unresolved_findings_current", label: "Unresolved findings", value: 4, unit: "count", basis: "right_now" },
    ], risks: [], changes: [] } },
    clients: { status: "available", data: { domain: "clients", as_of: "2026-10-13T14:00:00.000Z", coverage: "complete", headline: [
      { key: "business.active_clients_current", label: "Active clients", value: 0, unit: "count", basis: "right_now" },
    ], risks: [], changes: [] } },
    campaigns: { status: "unavailable", reason: "not_connected" },
  },
  degradation: [],
};

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { act(() => { root?.unmount(); }); host?.remove(); host = null; root = null; });

const mount = async (element: React.ReactElement) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(element); await Promise.resolve(); });
  return host!;
};
const text = (node: HTMLElement) => node.textContent ?? "";
const findLink = (node: HTMLElement, hrefEnd: string) => [...node.querySelectorAll("a")].find((a) => (a.getAttribute("href") ?? "").endsWith(hrefEnd));

describe("ExecutiveOverview — the four movements", () => {
  it("renders the briefing invitation as a working control that opens PAIGE", async () => {
    reviewMock.mockReturnValue({ state: "loading" });
    pendingMock.mockReturnValue({ items: [], loading: true, error: null, refresh: () => {} });
    const { ExecutiveOverview } = await import("./ExecutiveOverview");
    const openPaige = vi.fn();
    const node = await mount(<ExecutiveOverview account="acct-7" accountEpoch="t-1" openPaige={openPaige} />);
    const button = [...node.querySelectorAll("button")].find((b) => text(b).includes("How's my business doing"));
    expect(button).toBeDefined();
    act(() => { button!.click(); });
    expect(openPaige).toHaveBeenCalledTimes(1);
  });

  it("loading is a truthful status, not a skeleton of guessed numbers", async () => {
    reviewMock.mockReturnValue({ state: "loading" });
    pendingMock.mockReturnValue({ items: [], loading: true, error: null, refresh: () => {} });
    const { ExecutiveOverview } = await import("./ExecutiveOverview");
    const node = await mount(<ExecutiveOverview account="acct-7" accountEpoch="t-1" />);
    expect(text(node)).toContain("Reading your business review");
    expect(text(node)).not.toContain("USD");
  });

  it("failed is an honest error, never stale figures", async () => {
    reviewMock.mockReturnValue({ state: "failed", message: "Your business review could not be read right now. Nothing was changed." });
    pendingMock.mockReturnValue({ items: [], loading: false, error: null, refresh: () => {} });
    const { ExecutiveOverview } = await import("./ExecutiveOverview");
    const node = await mount(<ExecutiveOverview account="acct-7" accountEpoch="t-1" />);
    expect(text(node)).toContain("could not be read right now");
    expect(text(node)).not.toContain("USD 1,250");
  });

  it("renders the composer's own figures with window notes, and a REAL ZERO stays distinct from not-available", async () => {
    reviewMock.mockReturnValue({ state: "ready", snapshot: SNAPSHOT_READY as never });
    pendingMock.mockReturnValue({ items: [], loading: false, error: null, refresh: () => {} });
    const { ExecutiveOverview } = await import("./ExecutiveOverview");
    const node = await mount(<ExecutiveOverview account="acct-7" accountEpoch="t-1" />);
    expect(text(node)).toContain("USD 1,250.00");
    expect(text(node)).toContain("counted up to just now; the period ends later");
    expect(text(node)).toContain("Active clients");
    expect(text(node)).toContain("Overdue");
    // a real zero renders as 0 — the unavailable campaign area says not connected, never 0
    expect(text(node)).toContain("Not connected");
    expect(text(node)).not.toMatch(/Campaigns[^]*\b0\b/);
  });

  it("risks render act-first with the needs-attention marker", async () => {
    reviewMock.mockReturnValue({ state: "ready", snapshot: SNAPSHOT_READY as never });
    pendingMock.mockReturnValue({ items: [], loading: false, error: null, refresh: () => {} });
    const { ExecutiveOverview } = await import("./ExecutiveOverview");
    const node = await mount(<ExecutiveOverview account="acct-7" accountEpoch="t-1" />);
    const actIdx = text(node).indexOf("is overdue right now");
    const watchIdx = text(node).indexOf("older than 30 days");
    expect(actIdx).toBeGreaterThan(-1);
    expect(watchIdx).toBeGreaterThan(actIdx);
    expect(text(node)).toContain("needs attention");
  });

  it("navigates from each intelligence section to its departmental destination", async () => {
    reviewMock.mockReturnValue({ state: "ready", snapshot: SNAPSHOT_READY as never });
    pendingMock.mockReturnValue({ items: [], loading: false, error: null, refresh: () => {} });
    const { ExecutiveOverview } = await import("./ExecutiveOverview");
    const node = await mount(<ExecutiveOverview account="acct-7" accountEpoch="t-1" />);
    expect(findLink(node, "/solo/acct-7/finance")).toBeDefined();
    expect(findLink(node, "/solo/acct-7/sales")).toBeDefined();
    expect(findLink(node, "/solo/acct-7/command-center/systems-check")).toBeDefined();
    expect(findLink(node, "/solo/acct-7/clients")).toBeDefined();
    expect(findLink(node, "/solo/acct-7/command-center/business-game-plan")).toBeDefined();
  });

  it("the activity desk reads the real action bus and routes to the ONE approval home (no second inbox)", async () => {
    reviewMock.mockReturnValue({ state: "loading" });
    pendingMock.mockReturnValue({
      items: [
        { id: "a1", title: "Follow-up to the proposal for the Cohen engagement", summary: null, draftContent: null, rationale: null, department: "Sales", updatedAt: "2026-10-13T00:00:00Z" },
        { id: "a2", title: "Renewal nudge for the Halstead retainer", summary: null, draftContent: null, rationale: null, department: "Clients", updatedAt: "2026-10-13T00:00:00Z" },
      ] as never,
      loading: false, error: null, refresh: () => {},
    });
    const { ExecutiveOverview } = await import("./ExecutiveOverview");
    const openPaige = vi.fn();
    const node = await mount(<ExecutiveOverview account="acct-7" accountEpoch="t-1" openPaige={openPaige} />);
    expect(text(node)).toContain("2 waiting on you");
    expect(text(node)).toContain("Follow-up to the proposal");
    const review = [...node.querySelectorAll("button")].find((b) => text(b).includes("Review with Paige"));
    expect(review).toBeDefined();
    act(() => { review!.click(); });
    expect(openPaige).toHaveBeenCalledTimes(1);
    expect(text(node)).toContain("not a second inbox");
  });

  it("an empty action bus renders the honest empty state, not a fabricated queue", async () => {
    reviewMock.mockReturnValue({ state: "loading" });
    pendingMock.mockReturnValue({ items: [], loading: false, error: null, refresh: () => {} });
    const { ExecutiveOverview } = await import("./ExecutiveOverview");
    const node = await mount(<ExecutiveOverview account="acct-7" accountEpoch="t-1" />);
    expect(text(node)).toContain("Nothing is held for your approval");
    expect(text(node)).toContain("currently empty");
  });
});
