import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useParams, useNavigationType } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrowthHub } from "./growth2";
import { SalesWorkspace } from "./SalesWorkspace";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  // Owner briefs the Marketing Overview and Analytics read. Empty unless a test sets them.
  readCalls: 0,
  canManage: true,
  // Analytics' email row (marketing-analytics-email). Days asked for, and the answer to give.
  emailDays: [] as number[],
  email: { phase: "ready", stats: { sent: 0, tracked: 0, opened: 0, clicked: 0 } } as Record<string, unknown>,
  emailRetry: vi.fn(),
  // Analytics' server figures (marketing-analytics-metrics). A member's or a failed read is "denied" or
  // "error" and the page keeps its record counts; a test sets "ready" with the server's answer.
  server: { phase: "denied", current: null, previous: null } as Record<string, unknown>,
  serverReads: [] as Array<[string | null, string, number]>,
  briefsPhase: "ready",
  briefs: [] as Array<Record<string, unknown>>,
  state: {
    tenantId: "tenant-1",
    phase: "ready",
    campaigns: [{ id: "campaign-1", name: "Grounded campaign", status: "active", activeCount: 2, completedCount: 4, lastActivityAt: "2026-08-28T12:00:00Z" }],
    artifacts: [{ id: "page-1", type: "page", name: "Published page", slug: "published-page", status: "published", updatedAt: "2026-08-28T12:00:00Z", publicHref: "/p/example/published-page", recentSubmissions: 0, routingConfigured: false, routingTargets: [], recentDispatches: { succeeded: 0, failed: 0, other: 0 } }],
    submissions: [],
    pipelineWorkspace: {
      canManage: true,
      canArchiveFolders: true,
      folders: [{ id: "folder-1", name: "Campaign pipelines", lifecycleStatus: "active", version: 1, pipelineCount: 1 }, { id: "folder-empty", name: "Future ideas", lifecycleStatus: "active", version: 1, pipelineCount: 0 }],
      pipelines: [{ id: "pipeline-1", shortRef: "PPL-4K8MX", folderId: "folder-1", folderName: "Campaign pipelines", name: "Client onboarding", description: "", isDefault: true, lifecycleStatus: "active", version: 1, createdAt: "2026-08-20T12:00:00Z", updatedAt: "2026-08-28T12:00:00Z", createdThrough: "owner", createdByName: "Toni", requestedByName: null, stageCount: 1, dealCount: 1 }],
      stages: [{ id: "stage-1", pipelineId: "pipeline-1", label: "New", description: "Awaiting review", orderIndex: 1, archivedAt: null, version: 1 }],
      deals: [{ id: "deal-1", title: "Onboarding work", pipelineId: "pipeline-1", stageId: "stage-1", clientName: "Example client", owner: "Assigned owner", status: "open", source: "Source recorded", nextAction: "Review intake", updatedAt: "2026-08-28T12:00:00Z", version: 1, history: [] }],
    },
    pipelineAction: vi.fn(async () => ({ ok: true, message: "Saved" })),
    retry: vi.fn(),
  } as Record<string, unknown>,
}));

type PipelineWorkspaceFixture = {
  canManage: boolean;
  stages: Array<{
    id: string;
    pipelineId: string;
    label: string;
    description: string;
    orderIndex: number;
    archivedAt: string | null;
    movePolicy?: "direct" | "approval";
    version: number;
  }>;
};

vi.mock("./useSoloCampaigns", () => ({ useSoloCampaigns: () => { harness.readCalls++; return harness.state; } }));

// Overview is now the Campaign Command Desk, which reads owner briefs through its own tenant-scoped
// adapter (`useSoloCampaignBriefs`). This file proves the shell (tab order, error/unavailable
// identity), which the campaigns loop-source read (`harness.state`) drives via the desk's composite
// phase — so the briefs read is stubbed ready/empty here. The write seam + brief flows have their
// own proof in `campaign-briefs.contract.test.tsx`.
vi.mock("./useSoloCampaignBriefs", () => ({
  useSoloCampaignBriefs: () => ({
    tenantId: harness.state.tenantId, phase: harness.briefsPhase, briefs: harness.briefs, archivedCount: 0, canManage: harness.canManage,
    retry: () => {}, saveBrief: async () => ({ ok: true, message: "" }),
    transitionBrief: async () => ({ ok: true, message: "" }), archiveBrief: async () => ({ ok: true, message: "" }),
  }),
}));

// Analytics' email row reads read_email_marketing_dashboard through its own adapter; its RPC contract is
// proven with the Email tab (marketing-email.render.test.tsx). Here it answers what a test sets.
vi.mock("./marketing-analytics-email", () => ({
  useEmailStats: (_tenantId: string, days: number) => { harness.emailDays.push(days); return { ...harness.email, retry: harness.emailRetry }; },
}));

// The headline figures' server read goes through the shared INT-340 seam; its contract is proven by
// supabase/tests/marketing_metric_producer.sql and marketing-analytics-metrics.test.ts. Here it answers
// what a test sets; the overlay (withServerFigures) is the real one.
vi.mock("./marketing-analytics-metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./marketing-analytics-metrics")>()),
  useMarketingServerFigures: (tenantId: string | null, range: string, periodStart: number) => { harness.serverReads.push([tenantId, range, periodStart]); return { ...harness.server, retry: () => {} }; },
}));

// Content reads its library through Supabase; its own proof is marketing-content.render.test.tsx. Here it
// shows only what the hub hands it, so the address wiring (?kind=, ?piece=) can be driven.
vi.mock("./marketing-content", () => ({
  MarketingContent: ({ kind, onKind, piece, onPiece, published }: { kind: string; onKind: (k: string) => void; piece: string | null; onPiece: (id: string | null) => void; published: { pages: number; forms: number } }) =>
    <div data-content-stub data-kind={kind} data-piece={piece ?? ""} data-published={`${published.pages}/${published.forms}`}>
      <button onClick={() => onKind("document")}>Stub documents</button><button onClick={() => onKind("all")}>Stub all</button>
      <button onClick={() => onPiece("mc-9")}>Stub open</button><button onClick={() => onPiece(null)}>Stub close</button>
    </div>,
}));

// Slice 2A — Catalog now opens on Offers, which reads through its own tenant-scoped adapter
// (`useCatalogOffers`). This file proves the VIBE-OWNED half of the tab, so the offer read is
// stubbed empty here and the two published-output tests below address that half explicitly by
// `?type=`, which is also the retired-address contract those five legacy slugs depend on.
// The Offers half has its own proof in `catalog-offers.contract.test.tsx`.
vi.mock("./useCatalogOffers", () => ({
  useCatalogOffers: () => ({ tenantId: "tenant-1", phase: "ready", offers: [], canManage: true, retry: () => {} }),
}));

// A form's Details drawer mounts the intake panel, which reads through its own adapter. This file
// proves the drawer wiring; the panel's reads, writes and states are proven in form-intake.test.tsx.
vi.mock("./useFormIntake", () => ({
  FORM_INTAKE_PAGE_SIZE: 20,
  useFormIntake: (_tenantId: string, formId: string) => ({
    phase: "ready", canEdit: true, loadMoreFailed: false,
    settings: { autoCreateDeal: false, pipelineId: null, stageId: null, notifyEmail: null },
    fields: [{ key: "email", label: "Work email", type: "email" }],
    submissions: formId === "form-1" ? [{ id: "sub-1", createdAt: "2026-09-29T12:00:00Z", state: "done", contactId: "contact-9", dealId: "deal-1", alertSentAt: null, alertSkippedReason: null, answers: { email: "visitor@example.com" } }, { id: "sub-2", createdAt: "2026-09-29T13:00:00Z", state: "done", contactId: null, dealId: "deal-arrived-later", alertSentAt: null, alertSkippedReason: null, answers: { email: "late@example.com" } }] : [],
    hasMore: false, loadingMore: false, retry: () => {}, loadMore: () => {}, save: async () => ({ ok: true, message: "Saved" }),
  }),
}));

let host: HTMLDivElement;
let root: Root;
const card = (name: string) => [...host.querySelectorAll("button.mov-cp")].find((item) => item.textContent?.includes(name)) as HTMLButtonElement | undefined;
const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;

function renderAt(path: string, { salesInShell = false }: { salesInShell?: boolean } = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  salesInShellForTest = salesInShell;
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/solo/:account/*" element={<CanonicalSalesOwner/>}/></Routes></MemoryRouter>));
}

function rerenderAt(path: string) {
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/solo/:account/*" element={<CanonicalSalesOwner/>}/></Routes></MemoryRouter>));
}

let salesInShellForTest = false;
function CanonicalSalesOwner() {
  const params=useParams();
  return <>{(params["*"] === "growth" || params["*"].startsWith("growth/")) ? <GrowthHub salesInShell={salesInShellForTest}/> : (params["*"].startsWith("sales/pipeline") || params["*"].startsWith("sales/opportunities")) ? <SalesWorkspace/> : null}<LocationProbe/></>;
}

function LocationProbe() {
  const location = useLocation();
  const navigationType=useNavigationType();
  return <output data-location data-navigation-type={navigationType}>{location.pathname}{location.search}{location.hash}</output>;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  harness.briefs = [];
  harness.briefsPhase = "ready";
  harness.canManage = true;
  harness.emailDays = [];
  harness.email = { phase: "ready", stats: { sent: 0, tracked: 0, opened: 0, clicked: 0 } };
  harness.emailRetry.mockClear();
  harness.server = { phase: "denied", current: null, previous: null };
  harness.serverReads = [];
  harness.state.tenantId = "tenant-1";
  if (harness.state.pipelineWorkspace) {
    (harness.state.pipelineWorkspace as { canManage: boolean; canArchiveFolders: boolean }).canManage = true;
    (harness.state.pipelineWorkspace as { canManage: boolean; canArchiveFolders: boolean }).canArchiveFolders = true;
  }
});

describe("Solo Campaigns rendered flows", () => {
  it.each(["?resume=terms", "?view=invoices&resume=terms"])("preserves mounted Clients editor return intent %s", (search) => {
    const before=harness.readCalls;
    renderAt(`/solo/42/growth/sales${search}`);
    expect(harness.readCalls).toBe(before);
    expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/sales/agreements?resume=terms");
    expect(host.querySelector("[data-location]")?.getAttribute("data-navigation-type")).toBe("REPLACE");
  });
  it("replaces legacy commercial addresses before Marketing readers mount", () => {
    const before=harness.readCalls;
    renderAt("/solo/42/growth/sales?view=revenue&theme=dark#record");
    expect(harness.readCalls).toBe(before);
    const destination=host.querySelector("[data-location]");
    expect(destination?.textContent).toBe("/solo/42/sales/payments?view=revenue&theme=dark#record");
    expect(destination?.getAttribute("data-navigation-type")).toBe("REPLACE");
  });
  it("renders a board-first Pipeline and opens contextual deal detail without financial claims", () => {
    renderAt("/solo/42/growth/pipeline");
    expect(host.textContent).toContain("Client onboarding");
    expect(host.textContent).toContain("Onboarding work");
    expect(host.textContent).toContain("Review intake");
    expect(host.querySelector(".pipeline-surface")?.textContent).not.toMatch(/revenue|ROI|payment/i);
    const card = host.querySelector(".pipeline-card-open") as HTMLButtonElement;
    act(() => card.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("No portal activity source connected");
    expect(host.querySelector('[role="dialog"] button[disabled]')?.textContent).toContain("Send customer invite");
  });

  it("opens the full blank Pipeline configuration workspace from New pipeline without presets", () => {
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="New pipeline") as HTMLButtonElement).click());
    expect(host.querySelector(".pipeline-config-workspace")?.textContent).toContain("Pipeline configuration");
    expect(host.textContent).toContain("Create blank pipeline");
    expect(host.textContent).toContain("Start with zero stages");
    expect(host.textContent).toContain("Add custom stage");
    expect(host.textContent).toContain("Ask PAIGE");
    expect(host.textContent).not.toMatch(/starter|preset/i);
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent?.includes("Back to board")) as HTMLButtonElement).click());
    expect(host.querySelector(".pipeline-config-workspace")).toBeNull();
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Manage pipeline") as HTMLButtonElement).click());
    expect(host.textContent).toContain("Add a stage");
    expect(host.textContent).toContain("Archive");
    expect(host.textContent).not.toContain("Delete stage");
    expect([...host.querySelectorAll("button")].find(button => button.textContent === "Delete pipeline")?.disabled).toBe(true); // no server owner-delete capability in this fixture
  });

  it("filters and organizes exact pipelines without changing the board", async () => {
    const action = harness.state.pipelineAction as ReturnType<typeof vi.fn>;
    action.mockClear();
    renderAt("/solo/42/growth/pipeline");
    expect([...host.querySelectorAll(".pipeline-folder-filter option")].map((option)=>option.textContent)).toEqual(["All pipelines", "Campaign pipelines", "Future ideas", "Unfiled"]);
    const filter = host.querySelector(".pipeline-folder-filter") as HTMLSelectElement;
    act(()=>{filter.value="folder-empty";filter.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(host.textContent).toContain("No pipelines in this folder");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Folders") as HTMLButtonElement).click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Folder organizer");
    expect(host.textContent).toContain("PPL-4K8MX");
    const move = host.querySelector(".pipeline-folder-pipeline select") as HTMLSelectElement;
    act(()=>{move.value="";move.dispatchEvent(new Event("change",{bubbles:true}));});
    await act(async()=> ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Move") as HTMLButtonElement).click());
    expect(action).toHaveBeenCalledWith(expect.objectContaining({type:"move-pipeline-to-folder",pipelineId:"pipeline-1",pipelineRef:"PPL-4K8MX",folderId:null}));
  });

  it("requires the exact folder name and preserves each pipeline lifecycle status in Unfiled", async () => {
    const action = harness.state.pipelineAction as ReturnType<typeof vi.fn>;
    action.mockClear();
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Folders") as HTMLButtonElement).click());
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Archive folder") as HTMLButtonElement).click());
    expect(host.querySelector(".pipeline-folder-archive")?.textContent).toContain("move to Unfiled and keep the current lifecycle status");
    const input = host.querySelector(".pipeline-folder-archive input") as HTMLInputElement;
    const archive = [...host.querySelectorAll("button")].find((button)=>button.textContent==="Archive exact folder") as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(input,"Campaign pipelines");input.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(archive.disabled).toBe(false);
    await act(async()=>archive.click());
    expect(action).toHaveBeenCalledWith(expect.objectContaining({type:"archive-folder",folderId:"folder-1",confirmedName:"Campaign pipelines",expectedVersion:1}));
  });

  it("returns keyboard focus to the exact Folders opener after Escape", () => {
    renderAt("/solo/42/growth/pipeline");
    const opener = [...host.querySelectorAll("button")].find((button)=>button.textContent==="Folders") as HTMLButtonElement;
    opener.focus();
    act(() => opener.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("reserves Unfiled and exposes owner-only folder archive truthfully", () => {
    const workspace = harness.state.pipelineWorkspace as { canManage: boolean; canArchiveFolders: boolean };
    workspace.canArchiveFolders = false;
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Folders") as HTMLButtonElement).click());
    expect(host.textContent).toContain("Only the workspace owner can archive a folder");
    expect([...host.querySelectorAll("button")].some((button)=>button.textContent==="Archive folder")).toBe(false);
    const input = host.querySelector(".pipeline-folder-create input") as HTMLInputElement;
    act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(input,"Unfiled");input.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(host.textContent).toContain("Unfiled is the built-in view");
    expect(([...host.querySelectorAll("button")].find((button)=>button.textContent==="Create folder") as HTMLButtonElement).disabled).toBe(true);
  });

  it("moves an archived active folder filter to Unfiled and shows its pipelines", () => {
    const workspace = harness.state.pipelineWorkspace as { folders: Array<{ id: string; lifecycleStatus: string }>; pipelines: Array<{ id: string; folderId: string | null }> };
    renderAt("/solo/42/growth/pipeline");
    const filter = host.querySelector(".pipeline-folder-filter") as HTMLSelectElement;
    act(()=>{filter.value="folder-1";filter.dispatchEvent(new Event("change",{bubbles:true}));});
    workspace.folders = workspace.folders.map((folder)=>folder.id==="folder-1"?{...folder,lifecycleStatus:"archived"}:folder);
    workspace.pipelines = workspace.pipelines.map((pipeline)=>pipeline.id==="pipeline-1"?{...pipeline,folderId:null}:pipeline);
    rerenderAt("/solo/42/growth/pipeline");
    expect((host.querySelector(".pipeline-folder-filter") as HTMLSelectElement).value).toBe("unfiled");
    expect(host.textContent).toContain("Client onboarding");
  });

  it("keeps folder writes unavailable to read-only members", () => {
    const workspace = harness.state.pipelineWorkspace as unknown as PipelineWorkspaceFixture & { canManage: boolean };
    workspace.canManage = false;
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Folders") as HTMLButtonElement).click());
    expect(host.textContent).toContain("Read-only access");
    expect(([...host.querySelectorAll("button")].find((button)=>button.textContent==="Create folder") as HTMLButtonElement).disabled).toBe(true);
    expect(([...host.querySelectorAll("button")].find((button)=>button.textContent==="Direct PAIGE") as HTMLButtonElement).disabled).toBe(true);
    expect((host.querySelector(".pipeline-folder-pipeline select") as HTMLSelectElement).disabled).toBe(true);
    workspace.canManage = true;
  });

  it("distinguishes zero-deal duplicate names and archives only the typed exact reference", async () => {
    const action = harness.state.pipelineAction as ReturnType<typeof vi.fn>;
    const workspace = harness.state.pipelineWorkspace as { pipelines: Array<Record<string, unknown>> };
    workspace.pipelines.push({ id: "pipeline-duplicate", shortRef: "PPL-7Q2NZ", name: "Client onboarding", description: "Second distinct record", isDefault: false, lifecycleStatus: "active", version: 2, createdAt: "2026-08-25T12:00:00Z", updatedAt: "2026-08-26T12:00:00Z", createdThrough: "paige", createdByName: "Toni", requestedByName: "Toni", stageCount: 0, dealCount: 0 });
    action.mockClear();
    renderAt("/solo/42/growth/pipeline");
    const picker = host.querySelector(".pipeline-actions select") as HTMLSelectElement;
    expect([...picker.options].map((option)=>option.textContent)).toEqual(["Client onboarding · PPL-4K8MX", "Client onboarding · PPL-7Q2NZ"]);
    act(()=>{picker.value="pipeline-duplicate";picker.dispatchEvent(new Event("change",{bubbles:true}));});
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Manage pipeline") as HTMLButtonElement).click());
    expect(host.querySelector(".pipeline-compact-meta")?.textContent).toContain("PPL-7Q2NZ");
    expect(host.querySelector(".pipeline-compact-meta")?.textContent).toContain("paige");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Archive pipeline") as HTMLButtonElement).click());
    const confirm = host.querySelector(".pipeline-archive-confirm input") as HTMLInputElement;
    const archive = [...host.querySelectorAll("button")].find((button)=>button.textContent==="Archive exact reference") as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(confirm,"PPL-WRONG");confirm.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(archive.disabled).toBe(true);
    act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(confirm,"PPL-7Q2NZ");confirm.dispatchEvent(new Event("input",{bubbles:true}));});
    expect(archive.disabled).toBe(false);
    await act(async()=>archive.click());
    expect(action).toHaveBeenCalledWith(expect.objectContaining({type:"archive-pipeline",pipelineId:"pipeline-duplicate",pipelineRef:"PPL-7Q2NZ",confirmedReference:"PPL-7Q2NZ",expectedVersion:2}));
    workspace.pipelines.pop();
  });

  it("creates a pipeline with only the custom stages authored in the creation workspace", async () => {
    const action = harness.state.pipelineAction as ReturnType<typeof vi.fn>;
    const workspace = harness.state.pipelineWorkspace as {
      pipelines: Array<Record<string, unknown>>;
      stages: Array<Record<string, unknown>>;
    };
    const pipelineCount = workspace.pipelines.length;
    const stageCount = workspace.stages.length;
    action.mockClear();
    action.mockImplementationOnce(async () => {
      workspace.pipelines.push({ id: "pipeline-2", name: "Retention workflow", description: "", isDefault: false, lifecycleStatus: "draft", version: 1 });
      workspace.stages.push({ id: "stage-2", pipelineId: "pipeline-2", label: "Welcome", description: "", orderIndex: 1, archivedAt: null, movePolicy: "direct", version: 1 });
      return { ok: true, message: "Custom pipeline created", data: { pipeline_id: "pipeline-2" } };
    });
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="New pipeline") as HTMLButtonElement).click());
    const name = host.querySelector('.pipeline-create-fields input') as HTMLInputElement;
    const stageName = host.querySelector('.pipeline-create-stage input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Retention workflow");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(stageName, "Welcome");
      stageName.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Add custom stage") as HTMLButtonElement).click());
    expect((host.querySelector(".pipeline-draft-stage-list input") as HTMLInputElement).value).toBe("Welcome");
    await act(async () => {
      ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Create pipeline with 1 stage") as HTMLButtonElement).click();
    });
    expect(action).toHaveBeenCalledWith(expect.objectContaining({
      type: "create-pipeline",
      name: "Retention workflow",
      stages: [{ label: "Welcome", description: "", movePolicy: "direct", stageType: "open" }],
    }));
    expect((host.querySelector(".pipeline-actions select") as HTMLSelectElement).value).toBe("pipeline-2");
    expect(host.querySelector(".pipeline-lane h3")?.textContent).toBe("Welcome");
    workspace.pipelines.splice(pipelineCount);
    workspace.stages.splice(stageCount);
  });

  it("creates a genuinely blank pipeline when the owner adds no stages", async () => {
    const action = harness.state.pipelineAction as ReturnType<typeof vi.fn>;
    action.mockClear();
    action.mockResolvedValueOnce({ ok: true, message: "Blank pipeline created", data: {} });
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="New pipeline") as HTMLButtonElement).click());
    const name = host.querySelector('.pipeline-create-fields input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Owner-built workflow");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Create blank pipeline") as HTMLButtonElement).click();
    });
    expect(action).toHaveBeenCalledWith(expect.objectContaining({
      type: "create-pipeline",
      name: "Owner-built workflow",
      stages: [],
    }));
    expect(host.querySelector(".pipeline-config-workspace")).toBeNull();
  });

  it("prevents overlapping stage creation requests", async () => {
    let finish: (value: { ok: boolean; message: string }) => void = () => undefined;
    const pending = new Promise<{ ok: boolean; message: string }>((resolve) => { finish = resolve; });
    const action = harness.state.pipelineAction as ReturnType<typeof vi.fn>;
    action.mockClear();
    action.mockImplementationOnce(() => pending);
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Manage pipeline") as HTMLButtonElement).click());
    const name = host.querySelector(".pipeline-new-stage input") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Review");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Add stage") as HTMLButtonElement).click());
    const pendingButton = [...host.querySelectorAll("button")].find((button)=>button.textContent==="Saving…") as HTMLButtonElement;
    expect(pendingButton.disabled).toBe(true);
    act(() => pendingButton.click());
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, message: "Stage added" }));
  });

  it("keeps the creation workspace open and surfaces a failed save", async () => {
    (harness.state.pipelineAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, message: "Pipeline could not be created" });
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="New pipeline") as HTMLButtonElement).click());
    const name = host.querySelector('.pipeline-create-fields input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Campaign follow-up");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Create blank pipeline") as HTMLButtonElement).click();
    });
    expect(host.querySelector('.pipeline-config-workspace')).not.toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Pipeline could not be created");
  });

  it("prevents overlapping creation requests while a save is pending", async () => {
    let finish: (value: { ok: boolean; message: string }) => void = () => undefined;
    const pending = new Promise<{ ok: boolean; message: string }>((resolve) => { finish = resolve; });
    const action = harness.state.pipelineAction as ReturnType<typeof vi.fn>;
    action.mockClear();
    action.mockImplementationOnce(() => pending);
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="New pipeline") as HTMLButtonElement).click());
    const name = host.querySelector('.pipeline-create-fields input') as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Campaign follow-up");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Create blank pipeline") as HTMLButtonElement).click());
    const pendingButton = [...host.querySelectorAll("button")].find((button)=>button.textContent==="Creating…") as HTMLButtonElement;
    expect(pendingButton.disabled).toBe(true);
    act(() => pendingButton.click());
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, message: "Try again" }));
  });

  it("closes and clears pipeline creation when the tenant changes", () => {
    renderAt("/solo/42/growth/pipeline");
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="New pipeline") as HTMLButtonElement).click());
    expect(host.querySelector('.pipeline-config-workspace')).not.toBeNull();
    harness.state.tenantId = "tenant-2";
    act(() => root.render(<MemoryRouter initialEntries={["/solo/42/growth/pipeline"]}><Routes><Route path="/solo/:account/*" element={<CanonicalSalesOwner/>}/></Routes></MemoryRouter>));
    expect(host.querySelector('.pipeline-config-workspace')).toBeNull();
  });

  it("returns from configuration on Escape and restores the opener", () => {
    renderAt("/solo/42/growth/pipeline");
    const opener = [...host.querySelectorAll("button")].find((button)=>button.textContent==="New pipeline") as HTMLButtonElement;
    opener.focus();
    act(() => opener.click());
    const workspace = host.querySelector('.pipeline-config-workspace') as HTMLElement;
    const name = workspace.querySelector("input") as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('.pipeline-config-workspace')).toBeNull();
    expect(document.activeElement?.textContent).toBe("New pipeline");
  });

  it("moves a deal through the governed command on pointer drop", async () => {
    const workspace = harness.state.pipelineWorkspace as unknown as PipelineWorkspaceFixture;
    workspace.stages = [
      { id: "stage-1", pipelineId: "pipeline-1", label: "New", description: "", orderIndex: 1, archivedAt: null, movePolicy: "direct", version: 1 },
      { id: "stage-2", pipelineId: "pipeline-1", label: "Review", description: "", orderIndex: 2, archivedAt: null, movePolicy: "direct", version: 1 },
    ];
    const action = harness.state.pipelineAction as ReturnType<typeof vi.fn>;
    action.mockClear();
    renderAt("/solo/42/growth/pipeline");
    const card = host.querySelector(".pipeline-card") as HTMLElement;
    const lanes = host.querySelectorAll(".pipeline-lane");
    const transfer = { value: "", setData(_type: string, value: string) { this.value = value; }, getData() { return this.value; }, effectAllowed: "" };
    const start = new Event("dragstart", { bubbles: true });
    Object.defineProperty(start, "dataTransfer", { value: transfer });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: transfer });
    await act(async () => { card.dispatchEvent(start); lanes[1].dispatchEvent(drop); });
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ type: "move-deal", dealId: "deal-1", targetStageId: "stage-2", expectedVersion: 1 }));
    workspace.stages = workspace.stages.slice(0, 1);
  });

  it("supports keyboard pickup, stage choice, and drop", async () => {
    const workspace = harness.state.pipelineWorkspace as unknown as PipelineWorkspaceFixture;
    workspace.stages = [
      { id: "stage-1", pipelineId: "pipeline-1", label: "New", description: "", orderIndex: 1, archivedAt: null, movePolicy: "direct", version: 1 },
      { id: "stage-2", pipelineId: "pipeline-1", label: "Review", description: "", orderIndex: 2, archivedAt: null, movePolicy: "direct", version: 1 },
    ];
    const action = harness.state.pipelineAction as ReturnType<typeof vi.fn>;
    action.mockClear();
    renderAt("/solo/42/growth/pipeline");
    const card = host.querySelector(".pipeline-card") as HTMLElement;
    act(() => card.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    act(() => card.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await act(async () => card.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ type: "move-deal", targetStageId: "stage-2" }));
    workspace.stages = workspace.stages.slice(0, 1);
  });

  it("keeps read-only members inspect-only", () => {
    const workspace = harness.state.pipelineWorkspace as unknown as PipelineWorkspaceFixture;
    workspace.canManage = false;
    renderAt("/solo/42/growth/pipeline");
    expect((host.querySelector(".pipeline-card") as HTMLElement).draggable).toBe(false);
    expect([...host.querySelectorAll("button")].some((button)=>button.textContent==="Move")).toBe(false);
    expect(([...host.querySelectorAll("button")].find((button)=>button.textContent==="New deal") as HTMLButtonElement).disabled).toBe(true);
    act(() => ([...host.querySelectorAll("button")].find((button)=>button.textContent==="Manage pipeline") as HTMLButtonElement).click());
    expect(host.textContent).toContain("Read-only access");
    workspace.canManage = true;
  });

  const discoveryForm = { id: "form-1", type: "form", name: "Discovery call request", slug: "call", status: "active", updatedAt: "2026-08-28T12:00:00Z", publicHref: "/form/form-1", recentSubmissions: 1, routingConfigured: false, routingTargets: [], recentDispatches: { succeeded: 0, failed: 0, other: 0 } };

  it("renders populated grounded rows and closes details with Escape", () => {
    // An old `?type=` Catalog address lands on Overview's capture points, filtered (INT-342).
    renderAt("/solo/42/growth/catalog?type=page");
    expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/growth/overview?moved=catalog&capture=page");
    const details = card("Published page")!;
    // Its accessible name is what it shows, so the count and route are heard too.
    expect(details.hasAttribute("aria-label")).toBe(false);
    expect(details.textContent).toContain("Page · Live");
    details.focus();
    act(() => details.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Through the form on this page.");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(details);
  });

  it("a published form's panel shows where submissions go and what visitors typed, with working links", () => {
    const artifacts = harness.state.artifacts;
    harness.state.artifacts = [discoveryForm];
    try {
      // A copied Lead capture address still reaches the form's work: it lands on Overview, filtered.
      renderAt("/solo/42/growth/lead-capture?type=form");
      expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/growth/overview?moved=lead-capture&capture=form");
      expect(host.textContent).toContain("Lead capture moved here.");
      act(() => card("Discovery call request")!.click());
      // The panel lives in the address, so a reload or a shared link reopens it.
      expect(host.querySelector("[data-location]")?.textContent).toContain("form=form-1");
      const dialog = host.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain("When someone submits");
      expect(dialog.textContent).toContain("visitor@example.com");
      expect(dialog.textContent).toContain("Not routed: no pipeline, no alert");
      expect(dialog.textContent).toContain("Edit in Vibe Studio");
      act(() => ([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Open contact") as HTMLButtonElement).click());
      expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/clients/people?person=contact-9");
    } finally {
      harness.state.artifacts = artifacts;
    }
  });

  it("an old Lead capture link that named a form opens that form's panel, and a missing one says so", () => {
    const artifacts = harness.state.artifacts;
    harness.state.artifacts = [discoveryForm];
    try {
      renderAt("/solo/42/growth/lead-capture?form=form-1");
      expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/growth/overview?moved=lead-capture&form=form-1");
      expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Discovery call request");
      act(() => ([...host.querySelectorAll('[role="dialog"] button')][0] as HTMLButtonElement).click());
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(host.querySelector("[data-location]")?.textContent).not.toContain("form=");
      act(() => root.unmount()); host.remove();
      renderAt("/solo/42/growth/overview?form=form-gone");
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(host.textContent).toContain("That form isn’t live or in draft in this workspace.");
    } finally {
      harness.state.artifacts = artifacts;
    }
  });

  it("a submission's Open deal lands on that deal in Pipeline", () => {
    const artifacts = harness.state.artifacts;
    harness.state.artifacts = [discoveryForm];
    try {
      renderAt("/solo/42/growth/overview?form=form-1");
      const retry = harness.state.retry as ReturnType<typeof vi.fn>;
      retry.mockClear();
      act(() => ([...host.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === "Open deal") as HTMLButtonElement).click());
      expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/sales/opportunities?deal=deal-1&view=board&pipeline=pipeline-1");
      expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Onboarding work");
      // deal-1 is already in the workspace read, so nothing is re-read.
      expect(retry).not.toHaveBeenCalled();
    } finally {
      harness.state.artifacts = artifacts;
    }
  });

  it("a deal created after the workspace was read is re-read before Pipeline opens it", () => {
    const artifacts = harness.state.artifacts;
    harness.state.artifacts = [{ ...discoveryForm, recentSubmissions: 2 }];
    const retry = harness.state.retry as ReturnType<typeof vi.fn>;
    retry.mockClear();
    try {
      renderAt("/solo/42/growth/overview?form=form-1");
      const openDeals = [...host.querySelectorAll('[role="dialog"] button')].filter((button) => button.textContent === "Open deal") as HTMLButtonElement[];
      act(() => openDeals[1].click());
      expect(retry).toHaveBeenCalledTimes(1);
      expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/sales/opportunities?deal=deal-arrived-later&view=board&pipeline=pipeline-1");
      expect(host.querySelector(".pipeline-surface")?.textContent).toContain("Deal record unavailable in this workspace. Nothing was changed.");
    } finally {
      harness.state.artifacts = artifacts;
    }
  });

  it("offers a same-account return from Catalog to unfinished commercial terms", () => {
    renderAt("/solo/42/growth/catalog?origin=sales&resume=terms&returnTo=https://wrong.test");
    expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/sales/offers?origin=sales&resume=terms");
  });
  it("removes detached detail and its inert background after a workspace switch", () => {
    renderAt("/solo/42/growth/overview?capture=page");
    act(() => card("Published page")!.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    harness.state.tenantId = "tenant-2";
    rerenderAt("/solo/42/growth/overview?capture=page");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector(".campaigns-nav")?.hasAttribute("inert")).toBe(false);
  });
  it("keeps focus inside the modal drawer in both tab directions", () => {
    renderAt("/solo/42/growth/overview?capture=page");
    act(() => card("Published page")!.click());
    const close = host.querySelector('[role="dialog"] button') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);
    const last = [...host.querySelectorAll('[role="dialog"] a, [role="dialog"] button')].at(-1) as HTMLElement;
    last.focus();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(close);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(last);
    expect(host.querySelector(".campaigns-nav")?.hasAttribute("inert")).toBe(true);
  });

  it("renders the exact tab order and moves route plus focus with arrow keys", () => {
    renderAt("/solo/42/growth/overview");
    const tabs = [...host.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    // Lead capture retired into Overview (INT-342, owner-approved 2026-10-10). Content stays until
    // Vibe Studio lists every saved piece (owner ruling, same day).
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Campaigns", "Audience", "Content", "Social", "Email", "Ads", "Analytics"]);
    expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Marketing views");
    const dividers = [...host.querySelectorAll(".campaigns-tab-divider")];
    expect(dividers).toHaveLength(0);

    tabs[0].focus();
    act(() => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect((host.querySelector("[data-location]") as HTMLOutputElement).value).toBe("/solo/42/growth/campaigns");
    expect(document.activeElement?.textContent).toBe("Campaigns");
  });

  it("lets a brand-new tenant actually open the brief builder from the empty first-run state (§70 first use)", () => {
    // Regression lock for the §39 re-review's §70 finding: the empty-state FirstRun branch used to
    // render neither `deskRef` nor the drawer portals, so clicking the primary first-use action did
    // nothing. With 0 briefs the desk shows FirstRun; the builder must still OPEN through the real
    // `.solo-campaigns` shell GrowthHub provides (the portal host).
    renderAt("/solo/42/growth/campaigns");
    expect(host.textContent).toContain("Start your first growth initiative");
    const create = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Create campaign brief")) as HTMLButtonElement;
    expect(create).toBeDefined();
    act(() => create.click());
    // The builder actually renders — the empty-state action is NOT inert.
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("New campaign brief");
    expect(dialog?.querySelector("input")).not.toBeNull(); // the name field is reachable
  });

  it("renders error/retry and unavailable identity without treating either as empty", () => {
    harness.state = { phase: "error", campaigns: [], artifacts: [], submissions: [], retry: vi.fn() };
    renderAt("/solo/42/growth/campaigns");
    expect(host.textContent).toContain("Campaigns could not load");
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Retry"))!;
    act(() => retry.click());
    expect(harness.state.retry).toHaveBeenCalledOnce();
    act(() => root.unmount());
    host.remove();
    harness.state = { phase: "unavailable", campaigns: [], artifacts: [], submissions: [], retry: vi.fn() };
    renderAt("/solo/42/growth/campaigns");
    expect(host.textContent).toContain("Campaigns needs a resolved workspace");
    expect(host.textContent).not.toContain("No running campaign records");
    // The department Overview fails the same way: a failed or unresolved read is never shown as empty.
    for (const [phase, words] of [["error", "Marketing could not load"], ["unavailable", "Marketing needs a resolved workspace"]]) {
      act(() => root.unmount());
      host.remove();
      harness.state = { phase, campaigns: [], artifacts: [], submissions: [], retry: vi.fn() };
      renderAt("/solo/42/growth/overview");
      expect(host.textContent).toContain(words);
      expect(host.textContent).not.toContain("Nothing is being marketed yet");
    }
  });

  it("lands all five legacy addresses on Overview with where the work lives now, and hands off to Vibe", () => {
    harness.state = { phase: "ready", campaigns: [], artifacts: [], submissions: [], retry: vi.fn() };
    const listener = vi.fn();
    window.addEventListener("paige-studio", listener);
    for (const [slug, words, filter] of [
      ["brand-kit", "Your brand kit is in Vibe Studio.", null],
      ["pages", "Pages are on Overview, under Capture points.", "page"],
      ["funnels", "Funnels are on Overview, under Capture points.", "funnel"],
      ["forms", "Forms are on Overview, under Capture points.", "form"],
      ["builders", "Builders live in Vibe Studio.", null],
    ] as const) {
      renderAt(`/solo/42/growth/${slug}`);
      expect(host.querySelector("[data-location]")?.textContent).toBe(`/solo/42/growth/overview?moved=${slug}${filter ? `&capture=${filter}` : ""}`);
      expect(host.querySelector(".mov-moved")?.textContent).toContain(words);
      if (slug !== "builders") { act(() => root.unmount()); host.remove(); }
    }
    const launch = host.querySelector(".mov-moved [data-solo-vibe-studio-launcher]") as HTMLButtonElement;
    act(() => launch.click());
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail.returnFocus).toBe(launch);
    window.removeEventListener("paige-studio", listener);
    act(() => button("Dismiss")!.click());
    expect(host.querySelector(".mov-moved")).toBeNull();
    expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/growth/overview");
  });
});

// ── Marketing department (owner ruling 2026-10-03; docs/product/solo-marketing-ia-proposal.md) ──
describe("Solo Marketing department views", () => {
  const now = Date.now();
  const daysAgo = (days: number) => new Date(now - days * 86400000).toISOString();
  const emptyWorkspace = { canManage: true, canArchiveFolders: true, folders: [], pipelines: [], stages: [], deals: [], automationRules: [] };
  const form = { id: "form-1", type: "form", name: "Discovery call request", slug: "call", status: "active", updatedAt: daysAgo(1), publicHref: "/form/form-1", recentSubmissions: 3, routingConfigured: false, routingState: "No route", routingTargets: [], recentDispatches: { succeeded: 0, failed: 0, other: 0 }, dispatchStatuses: {} };
  const submission = (id: string, days: number, extra: Record<string, unknown> = {}) => ({ id, formId: "form-1", source: "paige_form", state: "done", createdAt: daysAgo(days), contactId: null, dealId: null, trackingSource: null, trackingCampaign: null, ...extra });
  function useWorkspace(overrides: Record<string, unknown> = {}) {
    harness.state = {
      tenantId: "tenant-1", phase: "ready", campaigns: [], artifacts: [form],
      drafts: [{ id: "page-9", type: "page", name: "Retainer upgrade page", updatedAt: daysAgo(2) }],
      submissions: [
        submission("s1", 1, { trackingSource: "newsletter", trackingCampaign: "CB-SPRING", dealId: "deal-1" }),
        submission("s2", 3, { trackingSource: "newsletter" }),
        submission("s3", 5, { trackingSource: "linkedin", contactId: "contact-4" }),
        submission("s4", 40, { trackingSource: "linkedin" }), // outside the 30-day window
      ],
      pipelineWorkspace: emptyWorkspace, pipelineAction: vi.fn(), retry: vi.fn(),
      ...overrides,
    };
  }
  const brief = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, shortRef: null, name, objective: null, audience: null, channels: [], timing: null, lifecycleStatus: "draft", blocker: null, offerId: null, offerName: null, pipelineId: null, pipelineName: null, pipelineDealCount: 0, version: 1, ...extra });
  const location = () => host.querySelector("[data-location]")?.textContent;

  const chain = () => [...host.querySelectorAll(".mov-node")].map((node) => node.textContent);
  const sources = () => [...host.querySelectorAll(".mov-srcrow")].map((row) => row.textContent);
  const attention = () => [...host.querySelectorAll(".mov-att li")].map((row) => row.textContent);

  it("Overview counts only real records, inside 30 days, lights the broken link and names what is unavailable", () => {
    useWorkspace();
    harness.briefs = [
      brief("b1", "Spring advisory intake", { lifecycleStatus: "active", timing: "Weeks 1–4 of April" }),
      brief("b2", "Podcast series", { lifecycleStatus: "blocked", blocker: "No capture form chosen" }),
      brief("b3", "Retainer upgrade", { lifecycleStatus: "approved" }),
      // An active brief with a blocker is blocked, not running.
      brief("b4", "Referral push", { lifecycleStatus: "active", blocker: "Waiting on the offer" }),
    ];
    renderAt("/solo/42/growth");
    // The tab already says Marketing: no banner, no title, no greeting (owner, 2026-10-10).
    expect(host.querySelector(".mov h1, .mov-top h2")).toBeNull();
    expect(host.textContent).not.toMatch(/Good (morning|afternoon|evening)/);
    // Three of the four submissions are inside 30 days; the fourth (40 days ago) is not counted.
    expect(host.querySelector(".mov-sum")?.textContent).toBe("3 leads in the last 30 days, and 1 became an opportunity in Sales.");
    expect(chain()).toEqual([
      "1Live capture points1 form",
      "3Leads receivedLast 30 days",
      "0 of 1Forms that route leadsThe chain breaks hereRoute it",
      "1Opportunities33% of leads, now in SalesOpen Sales",
    ]);
    expect(host.querySelector(".mov-node.is-broken")).not.toBeNull();
    expect(host.querySelector(".mov-rate")?.textContent).toBe("33%");
    // Sources are the tracking tags, merged.
    expect(sources()).toEqual(["newsletter2", "linkedin1"]);
    expect(attention()).toEqual([
      "Discovery call requestA lead from this form goes nowhere: no pipeline, no alertRoute it",
      "Podcast seriesNo capture form chosenOpen",
      "Referral pushWaiting on the offerOpen",
      "Retainer upgrade pageDraft page: collects nothing until it’s publishedFinish in Vibe",
    ]);
    const text = host.textContent ?? "";
    expect(text).not.toMatch(/ready_for_review|processing_state|\bdone\b/);
    expect(text).not.toMatch(/\$\d|reach of|followers|ROAS|visits/i);
    // The chain's Route it opens the one form panel on the unrouted form.
    act(() => button("Route it")!.click());
    expect(location()).toBe("/solo/42/growth?form=form-1");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Discovery call request");
  });

  it("a full submissions read is counted as a floor, everywhere it is used", () => {
    useWorkspace({ submissions: Array.from({ length: 200 }, (_, index) => submission(`s${index}`, 1)) });
    renderAt("/solo/42/growth/overview");
    expect(host.querySelector(".mov-sum")?.textContent).toBe("200 leads or more in the last 30 days, and 0+ became opportunities in Sales.");
    expect(chain()[1]).toBe("200+Leads receivedLast 30 days");
    expect(sources()).toEqual(["No tracking tag200+"]);
    expect(host.textContent).toContain("Counted from the latest 200 submissions, so lead counts are a floor.");
  });

  it("the lead-flow chart states its scale and busiest day, and reads zero as zero", () => {
    useWorkspace({ submissions: [submission("s1", 1), submission("s2", 1), submission("s3", 12)] });
    renderAt("/solo/42/growth/overview");
    const svg = host.querySelector(".mov-chart svg")!;
    expect(svg.getAttribute("aria-label")).toMatch(/^Leads per day over the last 30 days\. Busiest day: .+, 2 leads\.$/);
    expect(host.querySelector(".mov-peak-t")?.textContent).toBe("2");
    // Keyboard reaches each day; the reading is announced.
    // Keys start from today: one step back is yesterday's two leads, two steps is a zero day.
    act(() => svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(host.querySelector(".mov-tip")?.textContent).toMatch(/· 2 leads$/);
    act(() => svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(host.querySelector(".mov-tip")?.textContent).toMatch(/· 0 leads$/);
    expect(host.querySelectorAll(".mov-chart + table tbody tr, table.campaigns-sr-only tbody tr").length).toBe(30);
    act(() => root.unmount()); host.remove();
    useWorkspace({ submissions: [] });
    renderAt("/solo/42/growth/overview");
    expect(host.querySelector(".mov-zero")?.textContent).toBe("Zero every day. The line moves with your first lead.");
    expect(host.querySelector(".mov-sum")?.textContent).toBe("1 capture point live, no leads in the last 30 days, and 1 of 1 form doesn’t route its leads.");
  });

  it("Overview's New campaign brief opens the builder on the Campaigns desk", () => {
    useWorkspace();
    harness.briefs = [brief("b1", "Spring advisory intake", { lifecycleStatus: "active" })];
    renderAt("/solo/42/growth/overview");
    // The one gold act on Overview.
    expect([...host.querySelectorAll(".mov .btn-g")].map((item) => item.textContent)).toEqual(["New campaign brief"]);
    act(() => button("New campaign brief")!.click());
    expect(location()).toBe("/solo/42/growth/campaigns");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("New campaign brief");
  });

  it("Needs you puts a brief waiting for a decision in reach, and Open Sales keeps Pipeline one click away", () => {
    useWorkspace();
    harness.briefs = [brief("b1", "Q2 retainer upgrade", { lifecycleStatus: "ready_for_review" })];
    renderAt("/solo/42/growth/overview");
    // The chain's broken link leads; the brief waiting for a decision follows it.
    expect(attention()[0]).toMatch(/^Discovery call request/);
    expect(attention()[1]).toBe("Q2 retainer upgradeA campaign brief is waiting for your decisionReview");
    // Without Sales in the menu the link goes through Marketing's address, which the Sales cutover
    // (#1676) redirects to Sales' Pipeline for every Solo account.
    act(() => button("Open Sales")!.click());
    expect(location()).toBe("/solo/42/sales/opportunities?view=board");
  });

  it("an account whose menu shows Sales is sent to Sales' Pipeline", () => {
    useWorkspace();
    renderAt("/solo/42/growth/overview", { salesInShell: true });
    act(() => button("Open Sales")!.click());
    expect(location()).toBe("/solo/42/sales/opportunities?view=board");
  });

  it("a brand-new workspace sees three steps to a first lead, not a wall of zeros", () => {
    useWorkspace({ artifacts: [], drafts: [], submissions: [] });
    renderAt("/solo/42/growth/overview");
    expect(host.querySelector(".mov-sum")?.textContent).toBe("Nothing is being marketed yet.");
    expect(host.querySelector("#mov-first-h")?.textContent).toBe("Three steps to your first lead");
    expect(host.querySelector(".mov-chain")).toBeNull();
    // One gold act on the surface: the header does not repeat the first-use action.
    expect(host.querySelectorAll(".btn-g")).toHaveLength(1);
    expect(button("Open Vibe Studio")?.hasAttribute("data-solo-vibe-studio-launcher")).toBe(true);
  });

  it("a view-only member sees the work but no button that would fail", () => {
    useWorkspace();
    harness.canManage = false;
    try {
      renderAt("/solo/42/growth/overview");
      expect(host.querySelector(".btn-g")).toBeNull();
      expect(button("Route it")).toBeUndefined();
      expect(button("Finish in Vibe Studio")).toBeUndefined();
      // Reading stays open to them: the form panel still opens, without the edit hand-off.
      act(() => card("Discovery call request")!.click());
      expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Discovery call request");
      expect(button("Edit in Vibe Studio")).toBeUndefined();
    } finally {
      harness.canManage = true;
    }
  });

  it("Capture points list live and unpublished work, and Recent leads show each tracking tag", () => {
    useWorkspace();
    renderAt("/solo/42/growth/overview");
    const capture = host.querySelector("#mov-capture")!.textContent ?? "";
    expect(capture).toContain("Discovery call request");
    expect(capture).toContain("3 recent submissions");
    expect(capture).toContain("Not routed");
    expect(capture).toContain("Retainer upgrade page");
    expect(capture).toContain("Collects nothing until published");
    expect(host.textContent).toContain("source: newsletter · campaign: CB-SPRING");
    // The draft's only action is Vibe Studio; Overview never edits creative itself.
    const finish = button("Finish in Vibe Studio")!;
    expect(finish.hasAttribute("data-solo-vibe-studio-launcher")).toBe(true);
    act(() => button("Open deal")!.click());
    expect(location()).toBe("/solo/42/sales/opportunities?deal=deal-1&view=board");
  });

  it("the capture filter hides what does not match, and lives in the address", () => {
    useWorkspace();
    renderAt("/solo/42/growth/lead-capture?type=page");
    expect(location()).toBe("/solo/42/growth/overview?moved=lead-capture&capture=page");
    const capture = () => host.querySelector("#mov-capture")!.textContent ?? "";
    expect(capture()).toContain("Retainer upgrade page");
    expect(capture()).not.toContain("3 recent submissions");
    act(() => button("All")!.click());
    expect(location()).toBe("/solo/42/growth/overview?moved=lead-capture");
    expect(capture()).toContain("3 recent submissions");
    act(() => button("Funnels")!.click());
    expect(capture()).toContain("No funnels yet.");
  });

  const funnel = () => [...host.querySelectorAll(".mva-step")].map((step) => step.querySelector(".mva-n")?.textContent);
  const analyticsSummary = () => host.querySelector(".mva .mov-sum")?.textContent;
  const sourceKeys = () => [...host.querySelector("[aria-labelledby='mva-cov-h']")!.querySelectorAll(".mo-keys li")].map((li) => li.textContent);

  it("Analytics traces leads from received to opportunity, from real records inside the range", () => {
    useWorkspace();
    harness.briefs = [brief("b1", "Spring advisory intake", { shortRef: "CB-SPRING" })];
    renderAt("/solo/42/growth/analytics");
    expect(analyticsSummary()).toBe("3 leads in the last 30 days. 3 can be traced to a source, and 1 became an opportunity.");
    // Received, with a source tag, matched to a brief by its reference, handed to Sales.
    expect(funnel()).toEqual(["3", "3", "1", "1"]);
    expect([...host.querySelectorAll(".mva-step .mva-bar")].map((bar) => bar.getAttribute("aria-label"))).toEqual([
      "Leads received: 3", "With a source tag: 100% of leads received", "Matched to a campaign: 33% of leads received", "Became opportunities: 33% of leads received",
    ]);
    expect(sourceKeys()).toEqual(["newsletter267%", "linkedin133%"]);
    // Headline figures, compared with the 30 days before because the read covers them (s4, 40 days ago).
    expect([...host.querySelectorAll(".mva-kpi")].map((kpi) => [kpi.querySelector(".mva-kpi-v")?.textContent, kpi.querySelector(".mva-kpi-d")?.textContent])).toEqual([
      ["3", "+2 vs the previous 30 days"], ["100%", "Same as the previous 30 days"], ["1", "+1 vs the previous 30 days"], ["1", "+1 vs the previous 30 days"], ["33%", "+33 pts vs the previous 30 days"],
    ]);
    expect(host.querySelectorAll(".mva-kpi .mva-spark")).toHaveLength(5);
    // What became of each lead, from its own record.
    expect([...host.querySelector("[aria-labelledby='mva-out-h']")!.querySelectorAll(".mo-keys li")].map((li) => li.textContent)).toEqual(["Became an opportunity133%", "Added to Clients, no deal yet133%", "Saved, nothing more yet133%"]);
    // When leads arrive: seven weekday rows of 24 hours, three lit.
    expect(host.querySelectorAll(".mva-heat i")).toHaveLength(168);
    expect(host.querySelectorAll(".mva-heat i.is-on").length).toBeGreaterThan(0);
    expect([...host.querySelectorAll(".mva-tags li")].map((row) => row.textContent)).toEqual(["CB-SPRINGBrief: Spring advisory intake1"]);
    expect(host.querySelector("[aria-labelledby='mva-cov-h'] .mov-head p")?.textContent).toContain("3 of 3 carry a source tag");
    expect([...host.querySelectorAll(".mva-cap-row")].map((row) => row.textContent)).toEqual(["Discovery call requestNot routed3"]);
    // Channels with no source say so; nothing claims spend, reach or visits.
    const channels = host.querySelector(".mva-ch")!.textContent!;
    // Ads is its own department (coordinator 2026-10-11): Analytics shows no ad-account row and no route
    // into it, while leads from paid links are still counted by their source tag in the Source mix.
    expect([...host.querySelectorAll(".mva-ch li .mva-row-t")].map((row) => row.firstChild?.textContent)).toEqual(["Email", "Social", "Your pages"]);
    expect(channels).not.toMatch(/Ad accounts|spend/i);
    expect(button("Open Ads")).toBeUndefined();
    expect(host.querySelector("[aria-labelledby='mva-ch-h'] .mov-foot")?.textContent).toBe("Leads from links with a source tag, paid ones included, are counted in Source mix.");
    expect(channels).not.toContain("connected");
    expect(channels).toContain("Reach and engagement aren’t read from any provider");
    expect(channels).toContain("Visits aren’t recorded on public pages");
    expect(harness.emailDays.at(-1)).toBe(30);
  });

  it("Analytics' range lives in the address and moves every figure, the email row included", () => {
    useWorkspace();
    renderAt("/solo/42/growth/analytics");
    act(() => button("Quarter")!.click());
    expect(location()).toBe("/solo/42/growth/analytics?range=quarter");
    expect(funnel()[0]).toBe("4");
    expect(analyticsSummary()).toContain("4 leads in the last 90 days");
    expect(harness.emailDays.at(-1)).toBe(90);
    expect(button("Quarter")!.getAttribute("aria-pressed")).toBe("true");
    act(() => button("Month")!.click());
    // The default range keeps a clean address.
    expect(location()).toBe("/solo/42/growth/analytics");
    act(() => root.unmount()); host.remove();
    renderAt("/solo/42/growth/analytics?range=week");
    expect(analyticsSummary()).toContain("in the last 7 days");
    expect(harness.emailDays.at(-1)).toBe(7);
    act(() => root.unmount()); host.remove();
    // An unknown range falls back to the month rather than showing nothing.
    renderAt("/solo/42/growth/analytics?range=year");
    expect(analyticsSummary()).toContain("in the last 30 days");
  });

  it("Content's filter and open preview live in the address, and an unknown kind falls back to everything", () => {
    useWorkspace();
    renderAt("/solo/42/growth/content");
    const stub = () => host.querySelector("[data-content-stub]")!;
    expect(stub().getAttribute("data-kind")).toBe("all");
    act(() => button("Stub documents")!.click());
    expect(location()).toBe("/solo/42/growth/content?kind=document");
    expect(stub().getAttribute("data-kind")).toBe("document");
    act(() => button("Stub open")!.click());
    expect(location()).toBe("/solo/42/growth/content?kind=document&piece=mc-9");
    expect(stub().getAttribute("data-piece")).toBe("mc-9");
    act(() => button("Stub close")!.click());
    act(() => button("Stub all")!.click());
    // Everything keeps a clean address.
    expect(location()).toBe("/solo/42/growth/content");
    act(() => root.unmount()); host.remove();
    renderAt("/solo/42/growth/content?kind=spreadsheets&piece=mc-3");
    expect(stub().getAttribute("data-kind")).toBe("all");
    expect(stub().getAttribute("data-piece")).toBe("mc-3");
  });

  it("a capture point opens that form's panel on Overview, and Sales performance opens Sales › Performance", () => {
    useWorkspace();
    renderAt("/solo/42/growth/analytics");
    act(() => (host.querySelector(".mva-cap-row") as HTMLButtonElement).click());
    expect(location()).toBe("/solo/42/growth/overview?form=form-1");
    expect(host.querySelector(".campaigns-drawer")?.textContent).toContain("Discovery call request");
    act(() => root.unmount()); host.remove();
    renderAt("/solo/42/growth/analytics", { salesInShell: true });
    act(() => button("Open Sales performance")!.click());
    expect(location()).toBe("/solo/42/sales/performance");
    act(() => root.unmount()); host.remove();
    // Without Sales in the shell, the link goes where the rest of Marketing sends Sales.
    renderAt("/solo/42/growth/analytics");
    act(() => button("Open Sales performance")!.click());
    expect(location()).not.toContain("/sales/performance");
  });

  it("Analytics' email row reports sends, and says plainly when it is not the viewer's to see or failed", () => {
    useWorkspace();
    harness.email = { phase: "ready", stats: { sent: 12, tracked: 10, opened: 5, clicked: 2 } };
    renderAt("/solo/42/growth/analytics");
    const emailRow = () => host.querySelector(".mva-ch li")!.textContent;
    expect(emailRow()).toContain("12 sent · 5 opened (50% of 10 tracked) · 2 clicked");
    act(() => root.unmount()); host.remove();
    harness.email = { phase: "denied", stats: null };
    renderAt("/solo/42/growth/analytics");
    expect(emailRow()).toContain("Email figures are for owners and admins");
    expect(emailRow()).not.toContain("couldn’t load");
    act(() => root.unmount()); host.remove();
    harness.email = { phase: "error", stats: null };
    renderAt("/solo/42/growth/analytics");
    expect(emailRow()).toContain("Email figures couldn’t load");
    act(() => (host.querySelector(".mva-ch li button") as HTMLButtonElement).click());
    expect(harness.emailRetry).toHaveBeenCalledTimes(1);
    // A failed email read never takes the rest of the page with it.
    expect(funnel()).toHaveLength(4);
  });

  it("Analytics names a form's route in Overview's words, so one form never reads two ways", () => {
    useWorkspace({ artifacts: [
      { ...form, id: "f-auto", name: "Automations only", routingConfigured: true, routingTargets: ["notify_team"] },
      { ...form, id: "f-alert", name: "Alert only", intakeAlert: true },
      { ...form, id: "f-pipe", name: "Own route", intakePipelineId: "pipeline-1" },
      // The processor ignores a form's own route while any automation is enabled, so this one reaches no pipeline.
      { ...form, id: "f-both", name: "Own route and a notice", intakePipelineId: "pipeline-1", routingConfigured: true, routingTargets: ["notify_team"] },
    ] });
    renderAt("/solo/42/growth/analytics");
    const routes = Object.fromEntries([...host.querySelectorAll(".mva-cap-row")].map((row) => [row.querySelector(".mva-row-t")!.firstChild!.textContent, row.querySelector("small")!.textContent]));
    expect(routes).toEqual({ "Automations only": "No pipeline", "Alert only": "Email alert only, no pipeline", "Own route": "Routed to a pipeline", "Own route and a notice": "No pipeline", "Forms no longer live": "Leads in this range from a form since unpublished" });
  });

  it("Analytics' headline figures, funnel and source mix are the server's exact counts for an owner; the record-drawn parts stay floors", () => {
    // A full read of 200 submissions, all inside the range: the record counts are floors.
    const many = Array.from({ length: 200 }, (_, index) => submission(`s${index}`, 1, { trackingSource: "newsletter" }));
    const fig = (leads: number) => ({ leads, tagged: leads - 100, campaignTagged: 60, matched: 50, opportunities: 40, ambiguous: 0, missingDeals: 0,
      sources: [{ key: "src:newsletter", label: "newsletter", count: leads - 100 }], untagged: 100, otherSources: 0,
      campaignTags: [{ key: "brief:b-1", briefId: "b-1", label: "Spring intake", count: 50 }, { key: "tag:cb-old", briefId: null, label: "CB-OLD", count: 10 }] });
    harness.server = { phase: "ready", current: fig(612), previous: fig(500) };
    harness.briefs = [{ id: "b-1", shortRef: "CB-SPRING", name: "Spring intake" }];
    useWorkspace({ submissions: many });
    renderAt("/solo/42/growth/analytics");
    expect(harness.serverReads.at(-1)?.slice(0, 2)).toEqual(["tenant-1", "month"]);
    const tiles = [...host.querySelectorAll(".mva-kpi")].map((tile) => [tile.querySelector(".mva-kpi-v")?.textContent, tile.querySelector(".mva-kpi-d")?.textContent]);
    expect(tiles).toEqual([
      ["612", "+112 vs the previous 30 days"], ["84%", "+4 pts vs the previous 30 days"], ["50", "Same as the previous 30 days"], ["40", "Same as the previous 30 days"], ["7%", "−1 pts vs the previous 30 days"],
    ]);
    expect(host.querySelector(".mov-sum")?.textContent).toBe("612 leads in the last 30 days. 512 can be traced to a source, and 40 became opportunities.");
    expect([...host.querySelectorAll(".mva-step .mva-n")].map((n) => n.textContent)).toEqual(["612", "512", "50", "40"]);
    expect([...host.querySelectorAll(".mva-tags li")].map((row) => row.textContent)).toEqual(["CB-SPRINGBrief: Spring intake50", "CB-OLDNo brief uses this reference10"]);
    // The outcome ring still counts the records it draws, and says they are a floor.
    const outcomeKeys = [...host.querySelectorAll("[aria-labelledby='mva-out-h'] .mo-keys b")].map((b) => b.textContent);
    expect(outcomeKeys.length).toBeGreaterThan(0);
    expect(outcomeKeys.every((count) => count?.endsWith("+"))).toBe(true);
    expect(host.querySelector(".mva-cap")?.textContent).toContain("The headline figures, the funnel and the source mix count every lead in this range.");
  });

  it("when the server refuses (a member) the page keeps its own counts, floors and all", () => {
    harness.server = { phase: "denied", current: null, previous: null };
    useWorkspace({ submissions: Array.from({ length: 200 }, (_, index) => submission(`s${index}`, 1)) });
    renderAt("/solo/42/growth/analytics");
    expect(host.querySelector(".mva-kpi .mva-kpi-v")?.textContent).toBe("200+");
    expect(host.querySelector(".mva-cap")?.textContent).toContain("Counted from the latest 200 submissions");
  });

  it("a share with nothing to take a share of shows a dash, and a withheld comparison says why", () => {
    // No leads now, and nothing in the 30 days before: no share, and no "+N pts" against a rate that never existed.
    useWorkspace({ submissions: [submission("old", 80, { trackingSource: "newsletter" })] });
    renderAt("/solo/42/growth/analytics");
    const tile = (key: number) => host.querySelectorAll(".mva-kpi")[key];
    expect(tile(1).querySelector(".mva-kpi-v")?.textContent).toBe("—");
    expect(tile(1).querySelector(".mva-kpi-d")?.textContent).toBe("No leads in the previous 30 days");
    expect(tile(4).querySelector(".mva-kpi-v")?.textContent).toBe("—");
    act(() => root.unmount()); host.remove();
    // A full read whose oldest row sits in the period before: that period exists but isn't fully read.
    const many = [...Array.from({ length: 199 }, (_, index) => submission(`n${index}`, 1)), submission("edge", 45)];
    useWorkspace({ submissions: many });
    renderAt("/solo/42/growth/analytics");
    expect(host.querySelector(".mva-kpi-d")?.textContent).toBe("The read doesn’t reach the previous 30 days");
  });

  it("a failed briefs read leaves Analytics up and says campaign matching can't be done", () => {
    useWorkspace();
    harness.briefsPhase = "error";
    renderAt("/solo/42/growth/analytics");
    expect(host.textContent).not.toContain("Marketing could not load");
    expect(host.querySelector(".mva .mov-briefs-off")?.textContent).toContain("can’t be matched to a campaign");
    expect(funnel()).toEqual(["3", "3", "—", "1"]);
    expect(host.querySelector(".mva-tags")?.textContent).toContain("Briefs couldn’t load");
  });

  it("Analytics with no leads draws zeros and says what is ready, without inventing anything", () => {
    useWorkspace({ submissions: [] });
    renderAt("/solo/42/growth/analytics");
    expect(analyticsSummary()).toBe("No leads in the last 30 days, so there’s nothing to trace yet. Your live form is ready to record the source on its link.");
    expect(funnel()).toEqual(["0", "0", "0", "0"]);
    expect(host.querySelector("[aria-labelledby='mva-cov-h'] .mva-quiet")?.textContent).toBe("Nothing to measure yet.");
    expect(host.querySelector("[aria-labelledby='mva-heat-h'] p")?.textContent).toContain("No leads in this range yet");
    expect(host.querySelectorAll(".mva-bar em")).toHaveLength(0);
    act(() => root.unmount()); host.remove();
    useWorkspace({ submissions: [], artifacts: [] });
    renderAt("/solo/42/growth/analytics");
    expect(analyticsSummary()).toBe("No leads in the last 30 days, and no form is live to collect them.");
    expect(host.textContent).toContain("No form is live.");
  });

  it("a full submissions read inside the range makes every Analytics count a floor, and retired forms still count", () => {
    const many = Array.from({ length: 200 }, (_, index) => submission(`m${index}`, 1, { formId: index < 5 ? "form-gone" : "form-1", trackingSource: index % 2 ? "newsletter" : null }));
    useWorkspace({ submissions: many });
    renderAt("/solo/42/growth/analytics");
    expect(analyticsSummary()).toContain("200 leads or more");
    expect(funnel()).toEqual(["200+", "100+", "0+", "0+"]);
    expect(host.querySelector(".mva-cap")?.textContent).toContain("each count is a floor");
    expect(sourceKeys()).toEqual(["newsletter100+50%", "No tracking tag100+50%"]);
    // A full read can't vouch for the period before, so nothing is compared.
    expect(host.querySelector(".mva-kpi-d")?.textContent).toBe("No comparison: the read is full");
    expect(host.querySelector("[aria-labelledby='mva-cov-h'] .mov-head p")?.textContent).toContain("100+ of 200+ carry a source tag");
    expect([...host.querySelectorAll(".mva-cap-row")].map((row) => row.textContent)).toEqual(["Discovery call requestNot routed195+", "Forms no longer liveLeads in this range from a form since unpublished5+"]);
  });

  it("a failed briefs read hides only the brief items; capture points, the chain and leads stay", () => {
    useWorkspace();
    harness.briefsPhase = "error";
    // As useSoloCampaignBriefs does on a failed read: no briefs and no authority.
    harness.canManage = false;
    renderAt("/solo/42/growth/overview");
    expect(host.textContent).not.toContain("Marketing could not load");
    expect(host.querySelector(".mov-briefs-off")?.textContent).toContain("Campaign briefs couldn’t load");
    expect(host.querySelector("#mov-capture")).not.toBeNull();
    expect(chain()).toHaveLength(4);
    expect(host.textContent).toContain("source: newsletter · campaign: CB-SPRING");
    // A failed briefs read is not "view only": the workspace's own authority still lets the owner act.
    expect(host.querySelector(".mov-ro")).toBeNull();
    expect(button("Route it")).toBeDefined();
    act(() => root.unmount()); host.remove();
    // And when nothing says who may edit, Overview does not claim either way.
    useWorkspace({ pipelineWorkspace: { ...emptyWorkspace, canManage: undefined } });
    renderAt("/solo/42/growth/overview");
    expect(host.querySelector(".mov-ro")).toBeNull();
  });

  it("only a pipeline route closes the chain: other automations still leave the link broken", () => {
    useWorkspace({ artifacts: [{ ...form, routingConfigured: true, routingState: "Active", routingTargets: ["notify_team"] }] });
    renderAt("/solo/42/growth/overview");
    expect(attention()[0]).toBe("Discovery call requestIts automations run, but leads never reach a pipelineRoute it");
    expect(host.querySelector("#mov-capture")?.textContent).toContain("No pipeline");
    expect(chain()[2]).toMatch(/^0 of 1/);
    act(() => root.unmount()); host.remove();
    useWorkspace({ artifacts: [{ ...form, routingConfigured: true, routingState: "Active", routingTargets: ["pipeline_attach"] }] });
    renderAt("/solo/42/growth/overview");
    expect(chain()[2]).toMatch(/^1 of 1Forms that route leadsEvery live form routes its leads/);
    expect(host.querySelector("#mov-capture")?.textContent).toContain("Sent to a pipeline by an automation");
  });

  it("a form whose own route is skipped because an automation is on says so, and the panel says what to change", () => {
    // The processor follows a form's enabled automations and ignores its own route, so this form reaches no pipeline.
    useWorkspace({ artifacts: [{ ...form, intakePipelineId: "pipeline-1", routingConfigured: true, routingState: "Active", routingTargets: ["notify_team"] }] });
    renderAt("/solo/42/growth/overview");
    expect(attention()[0]).toBe("Discovery call requestIts own pipeline route is skipped while an automation is on; add a pipeline step to its automations in Vibe StudioRoute it");
    act(() => button("Route it")!.click());
    const dialog = host.querySelector('[role="dialog"]')?.textContent;
    expect(dialog).toContain("No pipeline: the route below is skipped while an automation is on. Add a pipeline step to its automations in Vibe Studio");
    expect(dialog).toContain("While the form has an automation turned on, leads follow the automations instead.");
  });

  it("a form that only emails its leads is not called silent, and is still not routed", () => {
    useWorkspace({ artifacts: [{ ...form, intakeAlert: true }] });
    renderAt("/solo/42/growth/overview");
    expect(attention()[0]).toBe("Discovery call requestLeads are emailed to you but never reach a pipelineRoute it");
    expect(host.querySelector("#mov-capture")?.textContent).toContain("Email alert only, no pipeline");
    act(() => button("Route it")!.click());
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("No pipeline: each lead is only emailed");
  });

  it("saving a route re-reads Marketing, and the open panel keeps focus while it re-renders", async () => {
    useWorkspace();
    const retry = harness.state.retry as ReturnType<typeof vi.fn>;
    retry.mockClear();
    renderAt("/solo/42/growth/overview?form=form-1");
    (host.querySelector("#intake-email") as HTMLInputElement).focus();
    // A realtime refresh hands the workspace a new data object; the panel must not steal focus.
    harness.state = { ...harness.state };
    rerenderAt("/solo/42/growth/overview?form=form-1");
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement?.id).toBe("intake-email");
    expect(retry).not.toHaveBeenCalled();
    // Make the draft dirty (the alert address), then save: the mocked save resolves ok and
    // Marketing re-reads, so the chain and Needs you change in place.
    const email = host.querySelector("#intake-email") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(email, "owner@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...host.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === "Save changes") as HTMLButtonElement;
    await act(async () => { save.click(); });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("an unknown moved key shows no notice", () => {
    useWorkspace();
    renderAt("/solo/42/growth/overview?moved=constructor");
    expect(host.querySelector(".mov-moved")).toBeNull();
  });

  it("previously shipped addresses land on their new home", () => {
    useWorkspace();
    for (const [from, to] of [
      ["/solo/42/growth/performance", "/solo/42/growth/analytics"],
      ["/solo/42/growth/active", "/solo/42/growth/campaigns"],
      ["/solo/42/growth/catalog?type=form", "/solo/42/growth/overview?moved=catalog&capture=form"],
      ["/solo/42/growth/catalog", "/solo/42/sales/offers"],
      ["/solo/42/growth/lead-capture", "/solo/42/growth/overview?moved=lead-capture"],
      ["/solo/42/growth/lead-capture?type=form&form=form-1", "/solo/42/growth/overview?moved=lead-capture&capture=form&form=form-1"],
    ]) {
      renderAt(from);
      expect(location(), from).toBe(to);
      act(() => root.unmount());
      host.remove();
    }
  });

  it("the desk's Open Vibe Studio reaches the Studio handoff with a real launcher to return to", () => {
    useWorkspace({ artifacts: [], drafts: [], submissions: [] });
    const listener = vi.fn();
    window.addEventListener("paige-studio", listener);
    try {
      renderAt("/solo/42/growth/campaigns");
      act(() => button("Open Vibe Studio")!.click());
      expect(listener).toHaveBeenCalledOnce();
      const target = (listener.mock.calls[0][0] as CustomEvent).detail.returnFocus as HTMLElement;
      // SoloApp ignores the event unless it names an enabled launcher button.
      expect(target).toBeInstanceOf(HTMLButtonElement);
      expect(target.hasAttribute("data-solo-vibe-studio-launcher")).toBe(true);
    } finally {
      window.removeEventListener("paige-studio", listener);
    }
  });
});
