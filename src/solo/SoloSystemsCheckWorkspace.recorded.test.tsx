import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordedFindingRead, SystemsCheckFinding } from "@/hooks/useSystemsCheck";

const ports = vi.hoisted(() => ({ systems: vi.fn(), command: vi.fn() }));
vi.mock("@/hooks/useSystemsCheck", () => ({ useSystemsCheck: (...args: unknown[]) => ports.systems(...args) }));
vi.mock("./data/useCommandCenter", () => ({ useCommandCenter: () => ports.command() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: () => { throw Error("NO_BACKEND_IN_SOURCE_TEST"); } } }));
vi.mock("./data/useSoloActivityFeed", async original => ({
  ...await original<typeof import("./data/useSoloActivityFeed")>(),
  useSoloActivityFeed: () => ({ status: "ready", items: [], refresh: () => undefined }),
}));
import { SoloSystemsCheckWorkspace } from "./SoloSystemsCheckWorkspace";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const id = "f2000000-0000-4000-8000-000000000006";
const currentId = "e2000000-0000-4000-8000-000000000006";
const oldAt = "2026-10-10T09:00:00Z", nowAt = "2026-10-20T09:00:00Z";
const finding: SystemsCheckFinding = {
  id, run_id: "original-run", check_id: "payment_processor_connected", status: "fail" as const,
  severity_at_finding: "blocking", evidence: { state: "disconnected" },
  paige_interpretation: "Original interpretation", paige_drafted_fix: null, department_id: "finance",
  resolved_at: null, resolution: null, resolution_action_id: null, created_at: oldAt,
  check_name: "Original payment check", domain: "payments", priority: 1,
};
const ready = (): Extract<RecordedFindingRead, { state: "ready" }> => ({
  state: "ready", finding: { ...finding }, run: { id: "original-run", started_at: oldAt, completed_at: oldAt },
});
let record: RecordedFindingRead, epoch: number, root: Root, host: HTMLDivElement;
const refresh = vi.fn(), refreshCommand = vi.fn(), approve = vi.fn(), decline = vi.fn(), openPaige = vi.fn();
const snapshot = () => ({
  run: { id: "current-run", started_at: nowAt, completed_at: nowAt, check_count: 2, pass_count: 1, fail_count: 1 },
  findings: [{ ...finding, id: currentId, run_id: "current-run", check_name: "Current payment check", paige_interpretation: "Current interpretation", created_at: nowAt }],
  loading: false, isError: false, scanPending: false, scanInProgressSince: null, refresh, recordedFinding: record,
});
function Location() { const location = useLocation(); return <output data-location>{location.search + location.hash}</output>; }
function render(entry = `/solo/1234567/command-center/systems-check?keep=1&finding=${id}#evidence`) {
  act(() => root.render(<MemoryRouter initialEntries={[entry]}><Location /><Routes><Route path="*" element={
    <SoloSystemsCheckWorkspace accountContext={{ accountName: "Example Services", accountType: "standalone" }} openPaige={openPaige} />
  } /></Routes></MemoryRouter>));
}
const button = (text: string) => [...host.querySelectorAll("button")].find(node => node.textContent?.includes(text));
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]');
const source = () => host.querySelector('[aria-labelledby="sc-linked-title"]');
function inspect() {
  const control = button("Inspect original finding")!;
  expect(control).toBeTruthy(); act(() => { control.focus(); control.click(); }); return control;
}
beforeEach(() => {
  vi.clearAllMocks(); record = ready(); epoch = 1; ports.systems.mockImplementation(snapshot);
  ports.command.mockImplementation(() => ({
    accountEpoch: epoch, approvals: [], metrics: [], attention: { at_risk_clients: 0, follow_ups_due: 0 }, departments: [],
    greeting: { name: "Example", dateLabel: "Today", summary: "" }, counts: { approvals: 0 }, loading: false,
    empty: true, isError: false, departmentsConfigured: false, approve, decline, refresh: refreshCommand,
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  expect(approve).not.toHaveBeenCalled(); expect(decline).not.toHaveBeenCalled(); expect(openPaige).not.toHaveBeenCalled();
});

describe("Recorded Systems finding inspection through the original workspace", () => {
  it("requests the exact original reference without replacing current health", () => {
    render(); expect(ports.systems).toHaveBeenCalledWith("tenant", { findingId: id });
    expect(source()?.textContent).toContain("Original interpretation");
    expect(source()?.textContent).toContain("Original recorded check");
    expect(source()?.querySelector("time")?.dateTime).toBe(oldAt); expect(host.textContent).toContain("2 checks");
  });
  it("uses the original read-only drawer, expands and returns focus without action", () => {
    render(); const trigger = inspect(); expect(dialog()?.textContent).toContain("disconnected");
    expect(dialog()?.textContent).toContain("Read-only recorded evidence");
    expect(dialog()?.textContent).not.toContain("Put PAIGE to work");
    act(() => button("Expand")!.click()); expect(dialog()?.getAttribute("aria-label")).toBe("Expanded finding details");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dialog()).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
  it("clears only the finding reference and preserves query, fragment and focus", () => {
    render(); act(() => host.querySelector<HTMLAnchorElement>('[aria-label="Clear source selection"]')!.click());
    expect(host.querySelector("[data-location]")?.textContent).toBe("?keep=1#evidence"); expect(source()).toBeNull();
    expect(document.activeElement?.textContent).toContain("Refresh current data");
  });
  it.each(["loading", "error", "unavailable"] as const)("handles %s without former record content", state => {
    record = { state }; render(); expect(source()?.textContent).not.toContain("Original payment check");
    expect(button("Inspect original finding")).toBeUndefined(); expect(button("Refresh records")).toBeTruthy();
    if (state === "error") expect(source()?.textContent).toContain("could not be read");
    if (state === "loading") expect(source()?.textContent).toContain("Reading the original finding");
  });
  it("refreshes original readers without scanning or submitting work", () => {
    record = { state: "error" }; render(); act(() => button("Refresh records")!.click());
    expect(refresh).toHaveBeenCalledTimes(1); expect(refreshCommand).toHaveBeenCalledTimes(1);
  });
  it("does not claim completion for an unfinished original run", () => {
    record = { ...ready(), run: { id: "original-run", started_at: oldAt, completed_at: null } };
    render(); expect(source()?.textContent).toContain("completion not recorded");
    expect(source()?.querySelector("time")?.dateTime).toBe(oldAt); inspect();
    expect(dialog()?.textContent).toContain("Read-only recorded evidence");
  });
  it("identifies an original finding from the current completed reading", () => {
    record = { state: "ready", finding: { ...finding, id: currentId, run_id: "current-run", created_at: nowAt },
      run: { id: "current-run", started_at: nowAt, completed_at: nowAt } };
    render(`/solo/1234567/command-center/systems-check?finding=${currentId}`);
    expect(source()?.textContent).toContain("From the last completed check"); expect(source()?.querySelector("time")?.dateTime).toBe(nowAt);
  });
  const inconsistentReads: Array<[string, Partial<SystemsCheckFinding>, Partial<Extract<RecordedFindingRead, { state: "ready" }>["run"]>]> = [
    ["unfinished original run", {}, { completed_at: null }],
    ["different completion time", {}, { completed_at: oldAt }],
    ["changed result", { status: "pass" }, {}],
    ["changed resolution time", { resolved_at: nowAt }, {}],
    ["changed decision", { resolution: "deferred" }, {}],
    ["changed action reference", { resolution_action_id: "e2000000-0000-4000-8000-000000000008" }, {}],
  ];
  it.each(inconsistentReads)("keeps %s separate from current preparation even when record IDs match", (_name, findingPatch, runPatch) => {
    record = { state: "ready", finding: { ...finding, id: currentId, run_id: "current-run", created_at: nowAt, ...findingPatch },
      run: { id: "current-run", started_at: nowAt, completed_at: nowAt, ...runPatch } };
    render(`/solo/1234567/command-center/systems-check?finding=${currentId}`);
    expect(source()?.textContent).not.toContain("From the last completed check");
    const trigger = inspect(); expect(dialog()?.textContent).toContain("Read-only recorded evidence");
    expect(dialog()?.textContent).not.toContain("Put PAIGE to work"); expect(host.textContent).toContain("2 checks");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(trigger);
  });
  it("compares the completed instant without depending on timestamp spelling", () => {
    record = { state: "ready", finding: { ...finding, id: currentId, run_id: "current-run", created_at: nowAt },
      run: { id: "current-run", started_at: nowAt, completed_at: nowAt.replace("Z", "+00:00") } };
    render(`/solo/1234567/command-center/systems-check?finding=${currentId}`);
    expect(source()?.textContent).toContain("From the last completed check");
    act(() => button("Inspect linked evidence")!.click()); expect(dialog()?.textContent).toContain("Put PAIGE to work");
  });
  it("retires preparation when only the shared original run metadata changes", () => {
    const original = { ...finding, id: currentId, run_id: "current-run", created_at: nowAt };
    record = { state: "ready", finding: original, run: { id: "current-run", started_at: nowAt, completed_at: nowAt } };
    render(`/solo/1234567/command-center/systems-check?finding=${currentId}`);
    act(() => button("Inspect linked evidence")!.click()); act(() => button("Put PAIGE to work")!.click());
    expect(host.querySelector('[aria-labelledby="ask-first-title"]')).not.toBeNull();
    record = { state: "ready", finding: original, run: { id: "current-run", started_at: nowAt, completed_at: null } };
    render(); expect(host.querySelector('[aria-labelledby="ask-first-title"]')).toBeNull();
    expect(dialog()?.textContent).toContain("Read-only recorded evidence");
    expect(dialog()?.contains(document.activeElement)).toBe(true);
  });
  it.each(["unavailable", "loading", "error"] as const)("withdraws open original content on %s and keeps a focus exit", state => {
    render(); inspect(); record = { state }; render();
    expect(dialog()?.textContent).not.toContain("Original interpretation"); expect(dialog()?.textContent).not.toContain("disconnected");
    expect(document.activeElement?.textContent).toContain("Close finding details");
    act(() => button("Close finding details")!.click()); expect(dialog()).toBeNull();
    expect(document.activeElement?.textContent).toContain("Refresh");
  });
  it("retires the drawer when the account generation changes", () => {
    render(); inspect(); epoch = 2; record = { state: "unavailable" }; render();
    expect(dialog()).toBeNull(); expect(source()?.textContent).not.toContain("Original interpretation");
  });
  it("does not infer an absent decision or Rail receipt from an incomplete returned timestamp", () => {
    record = { state: "ready", finding: { ...finding, resolution: "deferred" }, run: { id: "original-run", started_at: oldAt, completed_at: oldAt } };
    render(); inspect(); expect(dialog()?.textContent).toContain("deferred");
    expect(dialog()?.textContent).toContain("decision time not returned");
    expect(dialog()?.textContent).not.toContain("No decision is recorded");
    expect(dialog()?.textContent).not.toContain("No durable outcome is recorded on the tenant rail");
  });
  it.each(["invalid", `${id}&finding=${id}`])("refuses malformed/ambiguous reference %s", reference => {
    render(`/solo/1234567/command-center/systems-check?finding=${reference}`);
    expect(ports.systems).toHaveBeenCalledWith("tenant", { findingId: null });
    expect(source()?.textContent).toContain("not valid"); expect(button("Inspect original finding")).toBeUndefined();
  });
  it.each(["finding", "run"])("refuses a mismatched original %s", kind => {
    record = kind === "finding" ? { state: "ready", finding: { ...finding, id: currentId }, run: { id: "original-run", started_at: oldAt, completed_at: oldAt } }
      : { state: "ready", finding: { ...finding }, run: { id: "other-run", started_at: oldAt, completed_at: oldAt } };
    render(); expect(source()?.textContent).not.toContain("Original interpretation");
    expect(source()?.textContent).toContain("unavailable"); expect(button("Inspect original finding")).toBeUndefined();
  });
  it("retires an open copy when the original source changes", () => {
    render(); inspect(); record = { state: "ready", finding: { ...finding, paige_interpretation: "Changed original interpretation" },
      run: { id: "original-run", started_at: oldAt, completed_at: oldAt } };
    render(); expect(dialog()?.textContent).not.toContain("Original interpretation"); expect(dialog()?.textContent).toContain("original record changed");
    act(() => button("Close finding details")!.click()); inspect(); expect(dialog()?.textContent).toContain("Changed original interpretation");
  });
  it("leaves ordinary navigation without a source suggestion or exact-ID read", () => {
    record = { state: "not_requested" }; render("/solo/1234567/command-center/systems-check");
    expect(ports.systems).toHaveBeenCalledWith("tenant", { findingId: null }); expect(source()).toBeNull();
  });
  it("keeps original current-list preparation separate from historical inspection", () => {
    render(); inspect(); act(() => button("Back to original source")!.click());
    act(() => button("What was checked")!.click());
    expect(dialog()?.textContent).toContain("Current interpretation");
    expect(dialog()?.textContent).toContain("Put PAIGE to work");
    record = { state: "unavailable" }; render();
    expect(dialog()?.textContent).toContain("Current interpretation");
    expect(dialog()?.textContent).not.toContain("Original interpretation");
  });
  it("retires a current linked-source proposal when that exact read is withdrawn", () => {
    record = { state: "ready", finding: { ...finding, id: currentId, run_id: "current-run", created_at: nowAt },
      run: { id: "current-run", started_at: nowAt, completed_at: nowAt } };
    render(`/solo/1234567/command-center/systems-check?finding=${currentId}`);
    act(() => button("Inspect linked evidence")!.click()); act(() => button("Put PAIGE to work")!.click());
    expect(host.querySelector('[aria-labelledby="ask-first-title"]')).not.toBeNull();
    record = { state: "unavailable" }; render();
    expect(host.querySelector('[aria-labelledby="ask-first-title"]')).toBeNull();
    expect(dialog()?.textContent).not.toContain("Original interpretation");
    expect(dialog()?.textContent).toContain("original record is unavailable");
  });
});
