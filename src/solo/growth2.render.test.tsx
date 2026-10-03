import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrowthHub } from "./growth2";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  // Owner briefs the Marketing Overview and Analytics read. Empty unless a test sets them.
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

vi.mock("./useSoloCampaigns", () => ({ useSoloCampaigns: () => harness.state }));

// Overview is now the Campaign Command Desk, which reads owner briefs through its own tenant-scoped
// adapter (`useSoloCampaignBriefs`). This file proves the shell (tab order, error/unavailable
// identity), which the campaigns loop-source read (`harness.state`) drives via the desk's composite
// phase — so the briefs read is stubbed ready/empty here. The write seam + brief flows have their
// own proof in `campaign-briefs.contract.test.tsx`.
vi.mock("./useSoloCampaignBriefs", () => ({
  useSoloCampaignBriefs: () => ({
    tenantId: harness.state.tenantId, phase: "ready", briefs: harness.briefs, archivedCount: 0, canManage: true,
    retry: () => {}, saveBrief: async () => ({ ok: true, message: "" }),
    transitionBrief: async () => ({ ok: true, message: "" }), archiveBrief: async () => ({ ok: true, message: "" }),
  }),
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

function renderAt(path: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/solo/:account/growth/sales" element={<LocationProbe/>}/><Route path="/solo/:account/*" element={<><GrowthHub/><LocationProbe/></>}/></Routes></MemoryRouter>));
}

function rerenderAt(path: string) {
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/solo/:account/growth/sales" element={<LocationProbe/>}/><Route path="/solo/:account/*" element={<><GrowthHub/><LocationProbe/></>}/></Routes></MemoryRouter>));
}

function LocationProbe() {
  const location = useLocation();
  return <output data-location>{location.pathname}{location.search}</output>;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  harness.briefs = [];
  harness.state.tenantId = "tenant-1";
  if (harness.state.pipelineWorkspace) {
    (harness.state.pipelineWorkspace as { canManage: boolean; canArchiveFolders: boolean }).canManage = true;
    (harness.state.pipelineWorkspace as { canManage: boolean; canArchiveFolders: boolean }).canArchiveFolders = true;
  }
});

describe("Solo Campaigns rendered flows", () => {
  it("renders a board-first Pipeline and opens contextual deal detail without financial claims", () => {
    renderAt("/solo/42/growth/pipeline");
    expect(host.textContent).toContain("Client onboarding");
    expect(host.textContent).toContain("Onboarding work");
    expect(host.textContent).toContain("Review intake");
    expect(host.textContent).not.toMatch(/revenue|ROI|payment/i);
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
    act(() => root.render(<MemoryRouter initialEntries={["/solo/42/growth/pipeline"]}><Routes><Route path="/solo/:account/growth/sales" element={<LocationProbe/>}/><Route path="/solo/:account/*" element={<><GrowthHub/><LocationProbe/></>}/></Routes></MemoryRouter>));
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

  it("renders populated grounded rows and closes details with Escape", () => {
    // `?type=` addresses the Vibe-owned half directly (Slice 2A: Offers is the default section).
    renderAt("/solo/42/growth/catalog?type=page");
    expect(host.textContent).toContain("Published page");
    const details = [...host.querySelectorAll("button")].find((button) => button.textContent === "Details")!;
    details.focus();
    act(() => details.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(details);
  });

  it("a published form's Details shows where submissions go and what visitors typed, with working links", () => {
    const artifacts = harness.state.artifacts;
    harness.state.artifacts = [{ id: "form-1", type: "form", name: "Discovery call request", slug: "call", status: "active", updatedAt: "2026-08-28T12:00:00Z", publicHref: "/form/form-1", recentSubmissions: 1, routingConfigured: false, routingTargets: [], recentDispatches: { succeeded: 0, failed: 0, other: 0 } }];
    try {
      renderAt("/solo/42/growth/lead-capture?type=form");
      act(() => ([...host.querySelectorAll("button")].find((button) => button.textContent === "Routing and submissions") as HTMLButtonElement).click());
      const dialog = host.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain("When someone submits");
      expect(dialog.textContent).toContain("visitor@example.com");
      expect(dialog.textContent).toContain("Routing contract");
      act(() => ([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Open contact") as HTMLButtonElement).click());
      expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/clients/people?person=contact-9");
    } finally {
      harness.state.artifacts = artifacts;
    }
  });

  it("a submission's Open deal lands on that deal in Pipeline", () => {
    const artifacts = harness.state.artifacts;
    harness.state.artifacts = [{ id: "form-1", type: "form", name: "Discovery call request", slug: "call", status: "active", updatedAt: "2026-08-28T12:00:00Z", publicHref: "/form/form-1", recentSubmissions: 1, routingConfigured: false, routingTargets: [], recentDispatches: { succeeded: 0, failed: 0, other: 0 } }];
    try {
      renderAt("/solo/42/growth/lead-capture?type=form");
      act(() => ([...host.querySelectorAll("button")].find((button) => button.textContent === "Routing and submissions") as HTMLButtonElement).click());
      const retry = harness.state.retry as ReturnType<typeof vi.fn>;
      retry.mockClear();
      act(() => ([...host.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === "Open deal") as HTMLButtonElement).click());
      expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/growth/pipeline?deal=deal-1");
      // deal-1 is already in the workspace read, so nothing is re-read.
      expect(retry).not.toHaveBeenCalled();
    } finally {
      harness.state.artifacts = artifacts;
    }
  });

  it("a deal created after the workspace was read is re-read before Pipeline opens it", () => {
    const artifacts = harness.state.artifacts;
    harness.state.artifacts = [{ id: "form-1", type: "form", name: "Discovery call request", slug: "call", status: "active", updatedAt: "2026-08-28T12:00:00Z", publicHref: "/form/form-1", recentSubmissions: 2, routingConfigured: false, routingTargets: [], recentDispatches: { succeeded: 0, failed: 0, other: 0 } }];
    const retry = harness.state.retry as ReturnType<typeof vi.fn>;
    retry.mockClear();
    try {
      renderAt("/solo/42/growth/lead-capture?type=form");
      act(() => ([...host.querySelectorAll("button")].find((button) => button.textContent === "Routing and submissions") as HTMLButtonElement).click());
      const openDeals = [...host.querySelectorAll('[role="dialog"] button')].filter((button) => button.textContent === "Open deal") as HTMLButtonElement[];
      act(() => openDeals[1].click());
      expect(retry).toHaveBeenCalledTimes(1);
      expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/growth/pipeline?deal=deal-arrived-later");
    } finally {
      harness.state.artifacts = artifacts;
    }
  });

  it("offers a same-account return from Catalog to unfinished commercial terms", () => {
    renderAt("/solo/42/growth/catalog?origin=sales&resume=terms&returnTo=https://wrong.test");
    const back = [...host.querySelectorAll("button")].find((button) => button.textContent === "Return to commercial terms");
    expect(back).toBeDefined();
    act(() => back!.click());
    expect(host.querySelector("[data-location]")?.textContent).toBe("/solo/42/growth/sales?resume=terms");
  });
  it("removes detached detail and its inert background after a workspace switch", () => {
    renderAt("/solo/42/growth/catalog?type=page");
    const details = [...host.querySelectorAll("button")].find((button) => button.textContent === "Details")!;
    act(() => details.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    harness.state.tenantId = "tenant-2";
    rerenderAt("/solo/42/growth/catalog?type=page");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector(".campaigns-nav")?.hasAttribute("inert")).toBe(false);
  });
  it("keeps focus inside the modal drawer in both tab directions", () => {
    renderAt("/solo/42/growth/catalog?type=page");
    const details = [...host.querySelectorAll("button")].find((button) => button.textContent === "Details")!;
    act(() => details.click());
    const close = host.querySelector('[role="dialog"] button') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(close);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(close);
    expect(host.querySelector(".campaigns-nav")?.hasAttribute("inert")).toBe(true);
  });

  it("renders the exact tab order and moves route plus focus with arrow keys", () => {
    renderAt("/solo/42/growth/overview");
    const tabs = [...host.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Campaigns", "Lead capture", "Social", "Analytics", "Offers", "Sales", "Pipeline"]);
    expect(host.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Marketing views");
    // One divider, placed before the Sales lane's three tabs.
    const dividers = [...host.querySelectorAll(".campaigns-tab-divider")];
    expect(dividers).toHaveLength(1);
    expect(dividers[0].nextElementSibling?.textContent).toBe("Offers");
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

  it("owns all five legacy landings and dispatches the supported generic Vibe handoff", () => {
    harness.state = { phase: "ready", campaigns: [], artifacts: [], submissions: [], retry: vi.fn() };
    const listener = vi.fn();
    window.addEventListener("paige-studio", listener);
    for (const [slug, label] of [["brand-kit","Brand Kit"],["pages","Pages"],["funnels","Funnels"],["forms","Forms"],["builders","Builders"]]) {
      renderAt(`/solo/42/growth/${slug}`);
      expect(host.textContent).toContain("This address moved");
      expect(host.textContent).toContain(`${label} is no longer a Marketing subtab`);
      if (slug !== "builders") { act(() => root.unmount()); host.remove(); }
    }
    const launch = host.querySelector(".campaigns-compat [data-solo-vibe-studio-launcher]") as HTMLButtonElement;
    act(() => launch.click());
    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail.returnFocus).toBe(launch);
    window.removeEventListener("paige-studio", listener);
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
  const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const location = () => host.querySelector("[data-location]")?.textContent;

  it("Overview counts only real records, inside the stated window, and names what is unavailable", () => {
    useWorkspace();
    harness.briefs = [
      brief("b1", "Spring advisory intake", { lifecycleStatus: "active", timing: "Weeks 1–4 of April" }),
      brief("b2", "Podcast series", { lifecycleStatus: "blocked", blocker: "No capture form chosen" }),
      // Approved is not running, and an active brief with a blocker is blocked, not running.
      brief("b3", "Retainer upgrade", { lifecycleStatus: "approved" }),
      brief("b4", "Referral push", { lifecycleStatus: "active", blocker: "Waiting on the offer" }),
    ];
    renderAt("/solo/42/growth");
    const tiles = [...host.querySelectorAll(".mk-stat")].map((tile) => tile.textContent);
    expect(tiles[0]).toContain("Campaigns4");
    expect(tiles[0]).toContain("1 running · 2 blocked");
    // Brief status reads in the desk's words, never the raw enum.
    expect(host.textContent).toContain("Approved");
    expect(host.textContent).not.toContain("ready_for_review");
    expect(tiles[1]).toContain("Published work1");
    expect(tiles[1]).toContain("1 not published yet");
    // Three of the four submissions are inside 30 days; all three carry a tracking tag.
    expect(tiles[2]).toContain("Leads · last 30 days3");
    expect(tiles[2]).toContain("3 arrived with a tracking tag");
    expect(tiles[3]).toContain("Became opportunities1");
    const text = host.textContent ?? "";
    expect(text).toContain("No capture form chosen");
    expect(text).toContain("Submissions are saved, but nothing is set to follow up on them.");
    expect(text).toContain("It collects nothing until it is published.");
    expect(text).toContain("Weeks 1–4 of April");
    expect(text).toContain("Marketing email isn’t available yet.");
    expect(text).toContain("No ad account can be connected yet");
    expect(text).not.toMatch(/\$\d|reach of|followers|ROAS/i);
  });

  it("a full submissions window is counted as a floor, never as an exact total", () => {
    useWorkspace({ submissions: Array.from({ length: 200 }, (_, index) => submission(`s${index}`, 1)) });
    renderAt("/solo/42/growth/overview");
    expect([...host.querySelectorAll(".mk-stat")][2].textContent).toContain("200+");
  });

  it("Overview's Create campaign brief opens the builder on the Campaigns desk, then clears the request", () => {
    useWorkspace();
    harness.briefs = [brief("b1", "Spring advisory intake", { lifecycleStatus: "active" })];
    renderAt("/solo/42/growth/overview");
    act(() => button("Create campaign brief")!.click());
    expect(location()).toBe("/solo/42/growth/campaigns");
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("New campaign brief");
  });

  it("a brand-new workspace sees one guided start, not a wall of zeros", () => {
    useWorkspace({ artifacts: [], drafts: [], submissions: [] });
    renderAt("/solo/42/growth/overview");
    expect(host.textContent).toContain("Nothing is being marketed yet");
    expect(host.querySelectorAll(".mk-stat")).toHaveLength(0);
    // One gold act on the surface: the header does not repeat the first-use action.
    expect(host.querySelectorAll(".btn-g")).toHaveLength(1);
    act(() => button("Offers")!.click());
    expect(location()).toBe("/solo/42/growth/catalog");
  });

  it("Lead capture lists published and unpublished work, and each submission's tracking tag", () => {
    useWorkspace();
    renderAt("/solo/42/growth/lead-capture");
    const text = host.textContent ?? "";
    expect(text).toContain("Discovery call request");
    expect(text).toContain("3 recent submissions · not routed");
    expect(text).toContain("Retainer upgrade page");
    expect(text).toContain("collects nothing until it is published");
    expect(text).toContain("source: newsletter · campaign: CB-SPRING");
    // The draft's only action is Vibe Studio; Lead capture never edits creative itself.
    const finish = button("Finish in Vibe Studio")!;
    expect(finish.hasAttribute("data-solo-vibe-studio-launcher")).toBe(true);
    act(() => button("Open deal")!.click());
    expect(location()).toBe("/solo/42/growth/pipeline?deal=deal-1");
  });

  it("Lead capture's type filter hides what does not match", () => {
    useWorkspace();
    renderAt("/solo/42/growth/lead-capture?type=page");
    expect(host.textContent).toContain("Retainer upgrade page");
    expect(host.textContent).not.toContain("3 recent submissions");
  });

  it("Analytics groups leads by tracking tag and states its coverage", () => {
    useWorkspace();
    harness.briefs = [brief("b1", "Spring advisory intake", { shortRef: "CB-SPRING" })];
    renderAt("/solo/42/growth/analytics");
    const tiles = [...host.querySelectorAll(".mk-stat")].map((tile) => tile.textContent);
    expect(tiles[1]).toContain("3 of 3");
    expect(tiles[3]).toContain("Tagged with a campaign1 of 3");
    const bars = [...host.querySelectorAll(".mk-bars li")].map((row) => row.textContent);
    expect(bars).toContain("newsletter2");
    expect(bars).toContain("linkedin1");
    // The campaign tag matches the brief that uses it as its reference.
    expect(bars.some((row) => row?.includes("CB-SPRING") && row.includes("Brief: Spring advisory intake"))).toBe(true);
    expect(host.textContent).toContain("Form and page conversion");
  });

  it("previously shipped addresses land on their new home", () => {
    useWorkspace();
    for (const [from, to] of [
      ["/solo/42/growth/performance", "/solo/42/growth/analytics"],
      ["/solo/42/growth/active", "/solo/42/growth/campaigns"],
      ["/solo/42/growth/catalog?type=form", "/solo/42/growth/lead-capture?type=form"],
      ["/solo/42/growth/catalog", "/solo/42/growth/catalog"],
    ]) {
      renderAt(from);
      expect(location(), from).toBe(to);
      act(() => root.unmount());
      host.remove();
    }
    renderAt("/solo/42/growth/pages");
    act(() => button("Go to Lead capture")!.click());
    expect(location()).toBe("/solo/42/growth/lead-capture");
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
