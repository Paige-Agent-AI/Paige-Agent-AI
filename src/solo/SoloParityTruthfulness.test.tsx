import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SoloSkill } from "./data/useSoloSkills";
import type { ResearchRunDetail, ResearchRunRow } from "./data/deepResearch";
import { SoloPaigeWorkspace } from "./SoloPaigeWorkspace";
import { ResearchView } from "./paige-research";

const harness = vi.hoisted(() => ({
  tenantId: "test-tenant-a",
  skills: [] as SoloSkill[],
  loading: false,
  error: null as string | null,
  refreshSkills: vi.fn(),
  rows: [] as ResearchRunRow[] | null,
  detail: null as ResearchRunDetail | null,
  listError: null as string | null,
  detailError: null as string | null,
  refreshResearch: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: harness.tenantId, activeTenant: { account_number: "42" } }) }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => true, loading: false }) }));
vi.mock("@/components/dashboard/PaigeAIChat", () => ({ PaigeAIChat: () => <div>Existing Chat</div> }));
vi.mock("@/components/dashboard/paige/PaigeComposerAutonomyChip", () => ({ PaigeComposerAutonomyChip: () => null }));
vi.mock("./weekly/WeeklyResponsibilityEntry", () => ({ WeeklyResponsibilityEntry: () => null }));
vi.mock("./data/useSoloKnowledge", () => ({ useSoloKnowledge: () => ({ loading: false, error: null, empty: true, docs: [], refresh: vi.fn() }) }));
vi.mock("./data/useSoloSkills", () => ({ useSoloSkills: () => ({
  skills: harness.skills, loading: harness.loading, error: harness.error,
  empty: !harness.loading && !harness.error && harness.skills.length === 0, refresh: harness.refreshSkills,
}) }));
vi.mock("./data/deepResearch", () => ({ useDeepResearch: () => ({
  rows: harness.rows, detail: harness.detail, listError: harness.listError,
  detailError: harness.detailError, refresh: harness.refreshResearch,
  open: harness.open, close: harness.close, start: harness.start,
}) }));
vi.mock("@/components/dashboard/EntityDossier", () => ({ EntityDossier: () => <div>Dossier</div> }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const skill = (overrides: Partial<SoloSkill> = {}): SoloSkill => ({
  i: "01", n: "Registered public browse", slug: "test-public-browse", ro: true,
  cat: "research", on: true, runs: 0, ok: 0, d: "Catalogue description", trig: [], ...overrides,
});
const renderCapabilities = () => act(async () => {
  root.render(<MemoryRouter><SoloPaigeWorkspace dockedTab="capabilities" /></MemoryRouter>);
});
const renderResearch = () => act(async () => { root.render(<ResearchView activeTenantId={harness.tenantId} />); });
const rowFor = (name: string) => Array.from(host.querySelectorAll<HTMLElement>(".spw-cap-row")).find(row => row.querySelector("strong")?.textContent === name)!;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(harness, { tenantId: "test-tenant-a", skills: [], loading: false, error: null, rows: [], detail: null, listError: null, detailError: null });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("SOLO catalogue truthfulness", () => {
  it("shows an active read skill as listed with unverified access, without claiming it can run", async () => {
    harness.skills = [skill()];
    await renderCapabilities();
    const row = rowFor("Registered public browse");
    expect(row.textContent).toContain("Listed");
    expect(row.textContent).toContain("Unverified");
    expect(row.textContent).not.toContain("Available");
    expect(row.textContent).not.toContain("Read only");
    expect(row.querySelector(".spw-truth-live")).toBeNull();
    expect(host.textContent).not.toContain("What PAIGE can actually use");
  });

  it("does not turn an action risk classification into permission or an approval promise", async () => {
    harness.skills = [skill({ n: "Registered action", ro: false })];
    await renderCapabilities();
    const row = rowFor("Registered action");
    expect(row.textContent).toContain("Listed");
    expect(row.textContent).toContain("Unverified");
    expect(row.textContent).not.toMatch(/Ask first|Available|Approved/);
  });

  it("keeps inactive catalogue status distinct from runtime readiness", async () => {
    harness.skills = [skill({ on: false })];
    await renderCapabilities();
    expect(rowFor("Registered public browse").textContent).toContain("Inactive");
    expect(rowFor("Registered public browse").textContent).toContain("Unverified");
  });

  it("keeps loading, failed reads and empty catalogue states honest and preserves retry", async () => {
    harness.loading = true;
    await renderCapabilities();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("catalogue");
    expect(host.querySelector(".spw-view-head .spw-truth-live")).toBeNull();
    harness.loading = false;
    harness.error = "Catalogue read refused";
    await renderCapabilities();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Catalogue read refused");
    await act(async () => host.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
    expect(harness.refreshSkills).toHaveBeenCalledOnce();
    harness.error = null;
    await renderCapabilities();
    expect(host.textContent).toContain("No skills are listed");
    expect(host.textContent).not.toContain("No callable capabilities are available");
  });

  it("replaces the account catalogue without carrying an availability or permission claim across scopes", async () => {
    harness.skills = [skill()];
    await renderCapabilities();
    harness.tenantId = "test-tenant-b";
    harness.skills = [skill({ slug: "test-other-skill", n: "Other workspace skill", ro: false })];
    await renderCapabilities();
    expect(host.querySelector("[data-account-epoch]")?.getAttribute("data-account-epoch")).toBe("test-tenant-b");
    expect(host.textContent).not.toContain("Registered public browse");
    expect(rowFor("Other workspace skill").textContent).toContain("Unverified");
    // Known composer/unsupported-substrate rows retain their distinct existing facts.
    expect(rowFor("Voice input").textContent).toContain("Available");
    expect(rowFor("Code or sandbox execution").textContent).toContain("Unavailable");
  });
});

describe("SOLO Research library guidance and existing read paths", () => {
  it("qualifies new Chat research by availability and permission without starting a run", async () => {
    await renderResearch();
    expect(host.textContent).toContain("No saved research yet");
    expect(host.textContent).toContain("Ask PAIGE in Chat");
    expect(host.textContent).toMatch(/available|availability/i);
    expect(host.textContent).toMatch(/permission/i);
    expect(host.textContent).not.toContain("and the saved run appears here");
    expect(host.querySelector("form")).toBeNull();
    expect(harness.start).not.toHaveBeenCalled();
  });

  it("preserves saved-history review, result detail and return without invoking execution", async () => {
    harness.rows = [{ id: "test-run-a", question: "Saved investigation", domain: "general", caller: "chat", stop_reason: "answered", configured: true, is_dossier: false, source_count: 1, created_at: "2026-10-01T12:00:00Z" }];
    await renderResearch();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open research: Saved investigation"]')!.click());
    expect(harness.open).toHaveBeenCalledWith("test-run-a");
    harness.detail = { ...harness.rows[0], evidenceComplete: true, findings: [{ text: "Persisted cited finding", citations: [1], confidence: "high" }], coverage: {}, entity_profile: null, sources: [{ index: 1, url: "https://example.org/source", title: "Saved source", snippet: null, reliability_score: null, tier: null, reliability: null, published_at: null, fetched_at: null, excluded: false }] };
    await renderResearch();
    expect(host.querySelector('[aria-label="Findings"]')?.textContent).toContain("Persisted cited finding");
    expect(host.querySelector('a[href="https://example.org/source"]')?.getAttribute("rel")).toContain("noopener");
    const back = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Back to research history"))!;
    await act(async () => back.click());
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.start).not.toHaveBeenCalled();
  });

  it("preserves library read failures and getter-only retry", async () => {
    harness.rows = null;
    harness.listError = "History read refused";
    harness.detailError = "Run not found";
    await renderResearch();
    expect(host.textContent).toContain("Research history could not be loaded.");
    expect(host.textContent).toContain("That research could not be opened.");
    const retry = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("Retry"))!;
    await act(async () => retry.click());
    expect(harness.refreshResearch).toHaveBeenCalledOnce();
    expect(harness.start).not.toHaveBeenCalled();
  });
});
