/**
 * PR9 — the workspace panels are a lazy load, and the workspace must behave exactly
 * as it did when they were compiled into the entry.
 *
 * The owner-ordered proof: first Chat load intact, then each affected tab
 * (Knowledge, Research, Helpers, Capabilities) opens, is left, and reopens — with
 * its content present every time and Chat intact on every return. The lazy chunk
 * resolves inside the test's real dynamic import (nothing about the panels is
 * mocked), so this exercises the actual Suspense path a browser takes.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SoloPaigeWorkspace } from "./SoloPaigeWorkspace";

// Pre-warm the panel chunks at file scope: under a full parallel run, vitest's
// on-first-import transform can exceed any honest in-test wait budget. The lazy
// MOUNT path (Suspense fallback, first-visit load, reopen) is still fully
// exercised — this only pays the transform cost where the eager world paid it.
const panelsWarm = Promise.all([import("./SoloWorkspacePanels"), import("./paige-research")]);
beforeAll(async () => { await panelsWarm; }, 60_000);

const harness = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: { state: "not_acknowledged" }, error: null as unknown })),
  tenantId: "test-tenant-tabs",
  actorId: "test-actor-tabs",
  from: vi.fn(),
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeUserId: harness.actorId, activeTenantId: harness.tenantId, activeTenant: { account_number: "42" } }) }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => true, tierKey: "solo", loading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: harness.from, rpc: harness.rpc, functions: { invoke: vi.fn() } } }));
vi.mock("@/components/dashboard/PaigeAIChat", () => ({ PaigeAIChat: () => <div data-testid="chat-surface">Existing Chat</div> }));
vi.mock("@/components/dashboard/paige/PaigeComposerAutonomyChip", () => ({ PaigeComposerAutonomyChip: () => null }));
vi.mock("./weekly/WeeklyResponsibilityEntry", () => ({ WeeklyResponsibilityEntry: () => null }));
vi.mock("./data/useSoloKnowledge", () => ({ useSoloKnowledge: () => ({ loading: false, error: null, empty: true, docs: [], refresh: vi.fn() }) }));
vi.mock("./data/useSoloSkills", () => ({ useSoloSkills: () => ({ skills: [], loading: false, error: null, empty: true, refresh: vi.fn() }) }));
vi.mock("./data/deepResearch", () => ({ useDeepResearch: () => ({ rows: [], detail: null, listError: null, detailError: null, refresh: vi.fn(), open: vi.fn(), close: vi.fn(), start: vi.fn() }) }));
vi.mock("@/components/dashboard/EntityDossier", () => ({ EntityDossier: () => <div>Dossier</div> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

const tabButton = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  .find((b) => b.textContent?.trim() === label)!;
const selectTab = async (label: string) => {
  await act(async () => { tabButton(label).click(); });
};
// A lazy panel's chunk resolves in its own microtask/macrotask rhythm; poll honestly
// rather than assume a fixed flush depth (Research is heavier than the panels module).
const waitForPanelContent = async (tabId: string, marker: string) => {
  for (let attempt = 0; attempt < 40 && !panel(tabId).textContent?.includes(marker); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
  expect(panel(tabId).textContent).toContain(marker);
};
const panel = (id: string) => host.querySelector<HTMLElement>(`#spw-panel-${id}`)!;

beforeEach(() => {
  vi.clearAllMocks();
  harness.rpc.mockReset();
  harness.rpc.mockResolvedValue({ data: { state: "not_acknowledged" }, error: null });
  harness.from.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("Solo workspace lazy panels (PR9)", () => {
  it.each([
    ["knowledge", "Knowledge", "Sources PAIGE may use for this business"],
    ["research", "Research", "Evidence library"],
    ["helpers", "Helpers", "Current delegations"],
    ["capabilities", "Capabilities", "Workspace capabilities"],
  ])("opens, leaves, and reopens the %s panel with Chat intact throughout", async (tabId, label, marker) => {
    // Uncontrolled mount (no dockedTab prop): tab state is local, so clicks switch tabs
    // exactly as the docked shell allows when it does not pin a tab.
    await act(async () => {
      root.render(<MemoryRouter><SoloPaigeWorkspace /></MemoryRouter>);
    });
    // First load is the Chat surface, undisturbed by the lazy panels.
    expect(host.querySelector('[data-testid="chat-surface"]')).toBeTruthy();
    expect(panel(tabId).hidden).toBe(true);

    // Open: the panel mounts (its chunk resolving under the real Suspense path).
    await selectTab(label);
    expect(panel(tabId).hidden).toBe(false);
    await waitForPanelContent(tabId, marker);

    // Leave: back to Chat, the panel hides and Chat is exactly where it was.
    await selectTab("Chat");
    expect(panel(tabId).hidden).toBe(true);
    expect(host.querySelector('[data-testid="chat-surface"]')).toBeTruthy();

    // Reopen: the visited chunk is cached by the browser's module map — content returns.
    await selectTab(label);
    expect(panel(tabId).hidden).toBe(false);
    await waitForPanelContent(tabId, marker);
  });

  it("keeps every tab reachable and the chat-first entry free of panel content", async () => {
    await act(async () => {
      root.render(<MemoryRouter><SoloPaigeWorkspace /></MemoryRouter>);
    });
    for (const label of ["Knowledge", "Research", "Helpers", "Capabilities", "Chat"]) {
      expect(tabButton(label)).toBeTruthy();
    }
    // None of the lazy panels' content may exist in the chat-first DOM before a visit.
    expect(host.textContent).not.toContain("Sources PAIGE may use");
    expect(host.textContent).not.toContain("Current delegations");
    expect(host.textContent).not.toContain("Workspace capabilities");
  });
});
