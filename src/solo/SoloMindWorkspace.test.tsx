import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ knowledge: vi.fn(), command: vi.fn(), n8n: vi.fn() }));
vi.mock("./data/useN8nSpineReadiness", () => ({ useN8nSpineReadiness: () => harness.n8n() }));
vi.mock("./data/useSoloKnowledge", () => ({ useSoloKnowledge: (id?: string | null) => harness.knowledge(id) }));
vi.mock("./data/useCommandCenter", () => ({ useCommandCenter: () => harness.command() }));

import { SoloMindWorkspace } from "./SoloMindWorkspace";
import { mindOrbitPreferenceKey, mindMotionPreferenceKey, mindDismissedPreferenceKey, type MindOrbitPreferenceScope } from "./mindOrbitPreference";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const refreshKnowledge = vi.fn();
const refreshCommand = vi.fn();
const refreshN8n = vi.fn();
const openPaige = vi.fn();

const knowledge = {
  loading: false, error: null, documentsIndexed: 2, empty: false, refresh: refreshKnowledge, recentlyLearned: [],
  docs: [
    { id: "doc-1", title: "Reseller agreement", summary: "Clause 7", domain: "Legal", tags: ["margin"], source: "Drive", chunkCount: 4, createdAt: "2026-08-27T12:00:00Z", when: "1d ago", color: "#8A72F5" },
    { id: "doc-2", title: "Brand voice", summary: null, domain: "Brand", tags: [], source: null, chunkCount: 1, createdAt: "2026-08-26T12:00:00Z", when: "2d ago", color: "#8A72F5" },
  ],
};
const command = {
  accountEpoch: "tenant-a", approvals: [{ id: "approval-1", dept: "Finance", title: "Approve reminder", preview: "Review only", type: "Email draft", urgency: "today", aging: "2h" }],
  metrics: [], attention: {}, departments: [], greeting: { name: "Toni", dateLabel: "Today", summary: "1 draft waiting." }, counts: { approvals: 1 },
  loading: false, isError: false, departmentsConfigured: true, empty: false, approve: vi.fn(), decline: vi.fn(), refresh: refreshCommand,
};
const n8nNull = { data: null, loading: false, error: false, refresh: refreshN8n };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  harness.knowledge.mockReturnValue(knowledge);
  harness.command.mockReturnValue(command);
  harness.n8n.mockReturnValue(n8nNull);
  host = document.createElement("div");
  host.setAttribute("data-pg", "dark");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function render(preferenceScope?: MindOrbitPreferenceScope) {
  act(() => root.render(<SoloMindWorkspace accountContext={{ accountName: "First Sterling Capital", accountType: "standalone" }} openPaige={openPaige} preferenceScope={preferenceScope} />));
}
function buttons() { return [...host.querySelectorAll("button")] as HTMLButtonElement[]; }
function button(name: string) { return buttons().find((b) => b.textContent?.includes(name)); }
function records() { return [...host.querySelectorAll("[data-mind-record]")] as HTMLButtonElement[]; }

describe("Solo Mind workspace — orb port", () => {
  it('opens only the exact canonical source named by the Knowledge deep link', () => {
    harness.knowledge.mockReturnValue({ ...knowledge, requestedDocumentState: 'available' });
    act(() => root.render(<SoloMindWorkspace requestedKnowledgeId="doc-2" />));
    expect(harness.knowledge).toHaveBeenCalledWith('doc-2');
    expect(host.querySelector('.mind-drawer')?.textContent).toContain('Brand voice');
  });
  it('reports a resolved missing Knowledge deep link without choosing another record', () => {
    harness.knowledge.mockReturnValue({ ...knowledge, requestedDocumentState: 'missing' });
    act(() => root.render(<SoloMindWorkspace requestedKnowledgeId="missing" />));
    expect(host.textContent).toContain('not found in the active workspace');
    expect(host.querySelector('.mind-drawer')).toBeNull();
  });
  for (const state of ['missing', 'error']) it(`exact-source ${state} takes precedence over a stale list row`, () => {
    harness.knowledge.mockReturnValue({ ...knowledge, requestedDocumentState: state, requestedDocumentError: state === 'error' ? 'Read failed' : null });
    act(() => root.render(<SoloMindWorkspace requestedKnowledgeId="doc-2" />));
    expect(host.querySelector('.mind-drawer')).toBeNull();
    expect(host.textContent).toContain(state === 'missing' ? 'not found in the active workspace' : 'could not be read');
  });
  it('closes an earlier source drawer when the requested source changes to a missing one', () => {
    harness.knowledge.mockReturnValue({ ...knowledge, requestedDocumentState: 'available' });
    act(() => root.render(<SoloMindWorkspace requestedKnowledgeId="doc-2" />));
    expect(host.querySelector('.mind-drawer')).not.toBeNull();
    harness.knowledge.mockReturnValue({ ...knowledge, requestedDocumentState: 'missing' });
    act(() => root.render(<SoloMindWorkspace requestedKnowledgeId="missing" />));
    expect(host.querySelector('.mind-drawer')).toBeNull();
  });
  it("keeps exactly one accessible Mind heading", () => {
    render();
    const h1 = [...host.querySelectorAll("h1")].filter((h) => h.id === "mind-title");
    expect(h1).toHaveLength(1);
    expect(h1[0].textContent).toBe("Mind");
  });

  it("renders only grounded records with explicit truth boundaries — no fabricated figures or reasoning", () => {
    render();
    const titles = records().map((b) => b.querySelector("strong")?.textContent);
    // 2 knowledge docs + 1 decision (n8n null → no connected-source records)
    expect(records()).toHaveLength(3);
    expect(titles).toEqual(expect.arrayContaining(["Reseller agreement", "Brand voice", "Approve reminder"]));
    const text = host.textContent ?? "";
    expect(text).not.toMatch(/\$\d/); // no invented money figures
    expect(text.toLowerCase()).not.toContain("chain-of-thought");
    expect(text).toContain("PARTIAL"); // saved Knowledge does not imply owner-confirmed Memory
    expect(text).toContain("without hidden reasoning");
  });

  it("headline counts GROUNDED records only and labels the total 'held', never 'grounded' (ruling #2)", () => {
    render();
    // mock: 2 saved knowledge docs (partial) + 1 approval (partial), n8n null → 0 grounded of 3 held
    const count = host.querySelector(".mind-mind-count");
    expect(count).toBeTruthy();
    const txt = count?.textContent ?? "";
    expect(txt).toContain("0"); // grounded subset
    expect(txt.toLowerCase()).toContain("grounded");
    expect(txt).toContain("3"); // total held
    expect(txt.toLowerCase()).toContain("held");
    // the TOTAL is never presented as "grounded" — the All-domains chip says "held", not "GROUNDED"
    const allChip = button("All domains");
    expect(allChip?.textContent).toContain("3 held");
    expect((allChip?.textContent ?? "").toUpperCase()).not.toContain("GROUNDED");
  });

  it("degrades to the record list when WebGL is unavailable (jsdom) — never blank", () => {
    render();
    expect(host.textContent).toContain("Showing your records as a list");
    // the 3D canvas is not left mounted once the engine reports unavailable
    expect(host.querySelector('canvas[role="img"]')).toBeNull();
    // records remain reachable
    expect(records().length).toBeGreaterThan(0);
  });

  it("§58: never surfaces a Systems Check finding as a Mind record", () => {
    render();
    const text = host.textContent ?? "";
    expect(text).not.toContain("Systems Check finding");
    expect(records().some((b) => (b.getAttribute("key") ?? b.textContent ?? "").includes("finding:"))).toBe(false);
  });

  it("filters records by the six approved domains", () => {
    render();
    expect(button("Knowledge resources")).toBeTruthy();
    expect(button("Operating decisions")).toBeTruthy();
    act(() => button("Knowledge resources")!.click());
    expect(records()).toHaveLength(2);
    act(() => button("Operating decisions")!.click());
    expect(records()).toHaveLength(1);
    act(() => button("All domains")!.click());
    expect(records()).toHaveLength(3);
  });

  it("opens the evidence drawer with provenance and restores focus on Escape", () => {
    render();
    const first = records()[0];
    act(() => first.click());
    const drawer = host.querySelector('[role="dialog"]');
    expect(drawer).toBeTruthy();
    expect(drawer?.textContent).toContain("Source and provenance");
    expect(drawer?.textContent).toContain("Honesty boundary");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("persists the presentation-orbit pause per user + tenant", () => {
    const scope = { userId: "user-x", tenantId: "tenant-y" };
    render(scope);
    const pause = button("Pause orbit");
    expect(pause).toBeTruthy();
    act(() => pause!.click());
    expect(window.localStorage.getItem(mindOrbitPreferenceKey(scope))).toBe("true");
    // a fresh mount for the same scope reads the paused preference
    act(() => root.unmount());
    root = createRoot(host);
    render(scope);
    expect(button("Resume orbit")).toBeTruthy();
  });

  it("reduced-motion is an explicit, announced toggle", () => {
    render();
    const rm = button("Reduced motion")!;
    expect(rm.getAttribute("aria-pressed")).toBe("false");
    act(() => rm.click());
    expect(button("Reduced motion")!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[aria-live="polite"]')?.textContent?.toLowerCase()).toContain("reduced motion on");
  });

  it("the motion choice is an explicit override that persists per user + tenant", () => {
    const scope = { userId: "user-m", tenantId: "tenant-m" };
    render(scope);
    // Turning reduced-motion ON writes an explicit "reduced" choice (overriding the OS default).
    act(() => button("Reduced motion")!.click());
    expect(window.localStorage.getItem(mindMotionPreferenceKey(scope))).toBe("reduced");
    expect(button("Reduced motion")!.getAttribute("aria-pressed")).toBe("true");
    // A fresh mount for the same scope reads the stored choice back — the orb stays still.
    act(() => root.unmount());
    root = createRoot(host);
    render(scope);
    expect(button("Reduced motion")!.getAttribute("aria-pressed")).toBe("true");
    // "Resume orbit" is a one-click start: it lifts the reduced block AND enables the orbit.
    expect(button("Resume orbit")).toBeTruthy();
    act(() => button("Resume orbit")!.click());
    expect(window.localStorage.getItem(mindMotionPreferenceKey(scope))).toBe("full");
    expect(button("Pause orbit")).toBeTruthy();
    expect(button("Reduced motion")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("clears a record card non-destructively; the choice persists and is restorable", () => {
    const scope = { userId: "user-d", tenantId: "tenant-d" };
    render(scope);
    expect(records()).toHaveLength(3);
    // Clearing a card hides it from the list and persists the choice — the record is NOT deleted.
    act(() => host.querySelector<HTMLButtonElement>(".mind-record-dismiss")!.click());
    expect(records()).toHaveLength(2);
    expect(window.localStorage.getItem(mindDismissedPreferenceKey(scope))).toBeTruthy();
    // Persists across a fresh mount for the same scope.
    act(() => root.unmount());
    root = createRoot(host);
    render(scope);
    expect(records()).toHaveLength(2);
    // Restore brings every cleared card back and clears storage (§70 — a way back).
    act(() => button("Restore")!.click());
    expect(records()).toHaveLength(3);
    expect(window.localStorage.getItem(mindDismissedPreferenceKey(scope))).toBeNull();
  });

  it("keeps keyboard focus on the list after clearing a card — never drops to <body>", async () => {
    render();
    const firstX = host.querySelector<HTMLButtonElement>(".mind-record-dismiss")!;
    firstX.focus();
    expect(document.activeElement).toBe(firstX); // jsdom honors .focus() here
    await act(async () => { firstX.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 40)); }); // let the focus-recovery rAF fire
    expect(document.activeElement).not.toBe(document.body);
    const focused = document.activeElement as HTMLElement;
    expect(
      focused.classList.contains("mind-record-dismiss") ||
        focused.classList.contains("mind-records-restore") ||
        focused.classList.contains("mind-records"),
    ).toBe(true);
  });

  it("refresh re-reads the live sources and never calls it a scan", () => {
    render();
    act(() => button("Refresh records")!.click());
    expect(refreshKnowledge).toHaveBeenCalled();
    expect(refreshCommand).toHaveBeenCalled();
    expect(refreshN8n).toHaveBeenCalled();
    expect(host.textContent?.toLowerCase()).not.toContain("rescan");
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain("not a scan");
  });

  it("Open PAIGE uses the one existing workspace", () => {
    render();
    act(() => button("Open PAIGE")!.click());
    expect(openPaige).toHaveBeenCalled();
  });

  it("shows honest loading, empty, and partial states", () => {
    harness.knowledge.mockReturnValue({ ...knowledge, loading: true });
    render();
    expect(host.textContent).toContain("Resolving this account's Mind");

    act(() => root.unmount()); root = createRoot(host);
    harness.knowledge.mockReturnValue({ ...knowledge, loading: false, docs: [] });
    harness.command.mockReturnValue({ ...command, approvals: [] });
    render();
    expect(records()).toHaveLength(0);
    expect(host.textContent).toContain("No records are loaded here yet");

    act(() => root.unmount()); root = createRoot(host);
    harness.knowledge.mockReturnValue({ ...knowledge, error: new Error("read failed") });
    harness.command.mockReturnValue(command);
    render();
    expect(host.textContent).toContain("partial coverage");
  });
});
