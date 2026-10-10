import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SoloSettingsAnalytics } from "./settings-analytics";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mock = vi.hoisted(() => ({ state: { reads: {}, loading: false, permissionDenied: true, refresh: vi.fn(), scope: "test-scope" } as Record<string, unknown> }));
vi.mock("./data/useSettingsAnalytics", async original => ({ ...await original<object>(), useSettingsAnalytics: () => mock.state }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
let root: Root;
let host: HTMLDivElement;
function render() {
  if (!host) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  act(() => root.render(<MemoryRouter initialEntries={["/solo/test-tenant/settings/analytics/business-health?range=week"]}><Routes><Route path="/solo/:account/*" element={<SoloSettingsAnalytics/>}/></Routes></MemoryRouter>));
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); host = undefined as unknown as HTMLDivElement; });
describe("Settings Analytics trustworthy states", () => {
  it("shows one explicit permission state without measurement errors, values or evidence", () => {
    mock.state = { reads: {}, loading: false, permissionDenied: true, refresh: vi.fn(), scope: "test-scope" };
    render();
    expect(host.textContent).toContain("Analytics access is not permitted");
    expect(host.textContent).toContain("active owner or admin membership");
    expect(host.textContent).not.toContain("READ FAILED");
    expect(host.querySelectorAll(".sa-reading,.sa-evidence-trigger")).toHaveLength(0);
    expect(host.querySelectorAll(".sa-nav a")).toHaveLength(6);
  });
  it("unmounts an open evidence drawer when its reading is invalidated", async () => {
    const result = { metric_key: "business.active_clients_current", label: "Active clients", truth_state: "LIVE", values: { kind: "count", count: 3 }, unit: "count", range: { start: "2026-10-01T00:00:00Z", end: "2026-10-07T00:00:00Z", semantics: "current_snapshot" }, definition: "Recorded clients", formula: "Count", as_of: "2026-10-07T00:00:00Z", freshness: { source_updated_through: null }, coverage: { candidate_count: 3, contributing_count: 3, excluded_count: 0 }, source_refs: ["public.clients"], metric_version: "1.0.0", caveats: [], evidence_ref: "opaque-test-reference" };
    mock.state = { reads: { "business.active_clients_current": { result, error: false } }, loading: false, permissionDenied: false, refresh: vi.fn(), scope: "test-scope" };
    render();
    await act(async () => (host.querySelector(".sa-evidence-trigger") as HTMLButtonElement).click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("opaque-test-reference");
    mock.state = { ...mock.state, reads: {}, loading: true };
    render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector(".sa-truth--live")).toBeNull();
  });
});
