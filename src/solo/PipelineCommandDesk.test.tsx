// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { PipelineCommandDesk } from "./PipelineCommandDesk";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const stage = (id, label, stageType = "open", movePolicy = "direct") => ({
  id,
  pipelineId: "p1",
  label,
  description: "",
  orderIndex: id === "s1" ? 1 : 2,
  archivedAt: null,
  movePolicy,
  stageType,
  version: 1,
});
const deal = {
  id: "d1",
  title: "Jordan Lee",
  pipelineId: "p1",
  stageId: "s1",
  clientId: null,
  clientName: "Lumen House",
  owner: "Assigned owner",
  status: "open",
  source: "owner_entered",
  nextAction: "Review brief",
  tags: ["priority"],
  notes: "Keep context",
  createdAt: "2026-09-01T12:00:00Z",
  actualCloseDate: null,
  lostReason: null,
  outcomes: [],
  updatedAt: new Date().toISOString(),
  version: 1,
  history: [],
};
const makeData = () => ({
  tenantId: "t1",
  phase: "ready",
  retry: vi.fn(),
  artifacts: [],
  pipelineAction: vi.fn(async (_action: Record<string, unknown>) => ({
    ok: true,
    message: "Saved",
  })),
  pipelineWorkspace: {
    canManage: true,
    canArchiveFolders: true,
    canDelete: true,
    folders: [],
    pipelines: [
      {
        id: "p1",
        shortRef: "PPL-TEST",
        folderId: null,
        folderName: null,
        name: "Custom client journey",
        description: "",
        isDefault: true,
        lifecycleStatus: "active",
        version: 1,
        createdAt: "2026-09-01T12:00:00Z",
        updatedAt: "2026-09-01T12:00:00Z",
        createdThrough: "owner",
        createdByName: "Owner",
        requestedByName: null,
        stageCount: 3,
        dealCount: 1,
      },
    ],
    stages: [
      stage("s1", "Invited"),
      stage("s2", "Decision"),
      stage("s3", "Celebrated", "won"),
    ],
    deals: [deal],
    automationRules: [],
  },
});

describe("Pipeline Command Desk MVP", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = (data = makeData(), extra: Record<string, unknown> = {}) =>
    act(() =>
      root.render(
        <PipelineCommandDesk
          data={data}
          selectedId="p1"
          setSelectedId={vi.fn()}
          folderFilter="all"
          setFolderFilter={vi.fn()}
          onCreatePipeline={vi.fn()}
          onManage={vi.fn()}
          onFolders={vi.fn()}
          {...extra}
        />,
      ),
    );

  it('reclaims the entire pulse strip while retaining actual work and recorded outcome views',()=>{render();expect(host.querySelector('.pipeline-pulse')).toBeNull();expect(host.textContent).not.toContain('Needs your action');expect(host.textContent).not.toContain('Waiting on contact');expect(host.textContent).not.toContain('Ready for PAIGE');expect(host.textContent).toContain('Active work');expect(host.textContent).toContain('Outcomes');});
  it('applies shared Opportunities filters without cloning records or admitting an excluded deep-linked detail',()=>{const data=makeData();render(data,{dealFilter:()=>false,focusDealId:'d1'});expect(host.querySelector('.pipeline-desk-card')).toBeNull();expect(host.querySelector('[role="dialog"]')).toBeNull();expect(data.pipelineAction).not.toHaveBeenCalled();render(data,{dealFilter:()=>true,focusDealId:'d1'});expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Jordan Lee');render(data,{dealFilter:()=>false,focusDealId:'d1'});expect(host.querySelector('[role="dialog"]')).toBeNull()});
  it("opens the exact deal owned by a result deep link and clears it on close", () => {
    const clear = vi.fn();
    render(makeData(), { focusDealId: "d1", onClearFocus: clear });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Jordan Lee");
    act(() => host.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')?.click());
    expect(clear).toHaveBeenCalledOnce();
  });

  it("refuses a missing or cross-workspace deal deep link without showing another record", () => {
    render(makeData(), { focusDealId: "forged-deal" });
    expect(host.textContent).toContain("Deal record unavailable in this workspace. Nothing was changed.");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it("creates a deal through the tenant-owned deal contract", async () => {
    const data = makeData();
    render(data);
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "New deal")
        ?.click(),
    );
    const inputs = host.querySelectorAll(".pipeline-desk-form input");
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(inputs[0], "Avery Brooks");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Create deal")
        ?.click(),
    );
    expect(data.pipelineAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "create-deal",
        pipelineId: "p1",
        stageId: "s1",
        title: "Avery Brooks",
      }),
    );
  });

  it("turns a closing-stage move into an explicit outcome decision", () => {
    const data = makeData();
    render(data);
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Move")
        ?.click(),
    );
    const select = host.querySelector(
      ".pipeline-desk-dialog select",
    ) as HTMLSelectElement;
    act(() => {
      select.value = "s3";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Continue")
        ?.click(),
    );
    expect(host.textContent).toContain("Record outcome for Jordan Lee");
    expect(data.pipelineAction).not.toHaveBeenCalled();
  });

  it("records not-a-fit separately with a required reason", async () => {
    const data = makeData();
    render(data);
    act(() =>
      host.querySelector<HTMLButtonElement>(".pipeline-card-open")?.click(),
    );
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Not a fit")
        ?.click(),
    );
    const reason = [...host.querySelectorAll(".pipeline-desk-form input")].at(
      -1,
    ) as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(reason, "Outside current service scope");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Record exact outcome")
        ?.click(),
    );
    expect(data.pipelineAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "record-outcome",
        outcomeType: "not_fit",
        reason: "Outside current service scope",
      }),
    );
  });

  it("keeps a zero-pipeline workspace blank without preset stages", () => {
    const data = makeData();
    data.pipelineWorkspace.pipelines = [];
    data.pipelineWorkspace.stages = [];
    data.pipelineWorkspace.deals = [];
    render(data);
    expect(host.textContent).toContain("No pipelines yet");
    expect(host.textContent).toContain(
      "No preset pipeline or sales taxonomy is added",
    );
    expect(host.textContent).not.toContain("Invited");
  });

  it("clears open deal context when the workspace changes", () => {
    const data = makeData();
    render(data);
    act(() =>
      host.querySelector<HTMLButtonElement>(".pipeline-card-open")?.click(),
    );
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => {
      data.tenantId = "t2";
      root.render(
        <PipelineCommandDesk
          data={data}
          selectedId="p1"
          setSelectedId={vi.fn()}
          folderFilter="all"
          setFolderFilter={vi.fn()}
          onCreatePipeline={vi.fn()}
          onManage={vi.fn()}
          onFolders={vi.fn()}
        />,
      );
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
  it("keeps one stable idempotency key across a retry of the same deal draft", async () => {
    const data = makeData();
    data.pipelineAction = vi.fn(async (_action: Record<string, unknown>) => ({
      ok: false,
      message: "Retry safely",
    }));
    render(data);
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "New deal")
        ?.click(),
    );
    const input = host.querySelector(
      ".pipeline-desk-form input",
    ) as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "Retry record");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Create deal")
        ?.click();
    await act(async () => save());
    await act(async () => save());
    const first = data.pipelineAction.mock.calls[0]?.[0]?.idempotencyKey;
    const second = data.pipelineAction.mock.calls[1]?.[0]?.idempotencyKey;
    expect(second).toBe(first);
  });

  it("renders only the top dialog and preserves native Space on inner controls", () => {
    const data = makeData();
    render(data);
    const moveButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Move",
    ) as HTMLButtonElement;
    act(() =>
      moveButton.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true }),
      ),
    );
    expect(host.textContent).not.toContain("picked up");
    act(() =>
      host.querySelector<HTMLButtonElement>(".pipeline-card-open")?.click(),
    );
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Move stage")
        ?.click(),
    );
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      dialog.querySelector("h2")?.id,
    );
  });

  it("requires review of a sourced active automation before moving", async () => {
    const data = makeData();
    data.pipelineWorkspace.automationRules = [
      {
        id: "r1",
        pipelineId: "p1",
        fromStageId: "s1",
        toStageId: "s2",
        composeIntent: "notification",
        sendMode: "auto_send",
        isActive: true,
      },
    ];
    render(data);
    act(() =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Move")
        ?.click(),
    );
    const select = host.querySelector(
      ".pipeline-desk-dialog select",
    ) as HTMLSelectElement;
    act(() => {
      select.focus();
      select.value = "s2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.activeElement).toBe(select);
    const continueButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Continue",
    ) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    expect(host.textContent).toContain("This MVP blocks the change");
    expect(host.querySelector(".pipeline-automation-review input")).toBeNull();
    expect(data.pipelineAction).not.toHaveBeenCalled();
  });
});
