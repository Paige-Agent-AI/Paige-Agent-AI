import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { StrategicPlay } from "./data/useBusinessGamePlanMissions";

const harness = vi.hoisted(() => ({
  openPaige: vi.fn(),
  save: vi.fn(async () => ({ ok: true })),
  refresh: vi.fn(),
  mission: {
    items: [] as StrategicPlay[],
    status: "ready" as "loading" | "ready" | "forbidden" | "error",
    errorCode: null,
    refresh: vi.fn(),
    getDetail: vi.fn(),
    mutate: vi.fn(),
  },
}));

vi.mock("./data/useSoloGamePlan", () => ({
  useSoloGamePlan: () => ({
    loading: false,
    error: false,
    empty: false,
    refresh: harness.refresh,
    greeting: { salutation: "Good morning", name: "Jordan", dateLabel: "Sep 7" },
    horizons: [{ id: "annual", label: "Annual", sub: "This year" }, { id: "quarter", label: "This quarter", sub: "90 days" }],
    planBrief: {
      fields: {
        annualDirection: "Build a durable advisory business.",
        currentPriority: "Convert three warm referrals.",
        goals90Day: "Six retained clients.",
        successDefinition: "Twenty thousand monthly retained.",
        constraints: "No more than eight active clients.",
        operatingPreferences: "Draft, then ask.",
        doNotAssume: "Do not infer revenue.",
      },
      hasPlan: true, canEdit: true, updatedAt: "2026-09-07T00:00:00Z",
      provenance: {}, pendingProposal: null, proposalPlanOnly: true,
      save: harness.save, applyProposal: vi.fn(), dismissProposal: vi.fn(),
    },
    decisions: [], decisionsStatus: "ready",
  }),
}));
vi.mock("./data/useBusinessGamePlanMissions", async () => {
  const actual = await vi.importActual<typeof import("./data/useBusinessGamePlanMissions")>("./data/useBusinessGamePlanMissions");
  return { ...actual, useBusinessGamePlanMissions: () => harness.mission };
});

// The approvals strip in the rail (#1129) reads tenant context and opens a live approvals
// subscription. Its contract is proven in GamePlanApprovals.test.tsx; here it is a marker, and
// the first test asserts the marker is still mounted in the rail, so the stub cannot hide the
// strip being dropped.
vi.mock("./GamePlanApprovals", () => ({
  GamePlanApprovals: () => <div data-testid="game-plan-approvals" />,
}));

import { SoloGamePlanWorkspace } from "./SoloGamePlanWorkspace";
import { getPaigeBusinessPlanScope, clearPaigeSurfaceScope } from "./paigeClientScope";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  harness.openPaige.mockClear(); harness.save.mockClear(); harness.refresh.mockClear();
  harness.mission.refresh.mockReset(); harness.mission.getDetail.mockReset(); harness.mission.mutate.mockReset();
  harness.mission.items = []; harness.mission.status = "ready";
  clearPaigeSurfaceScope();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function render() {
  act(() => { root.render(<MemoryRouter initialEntries={["/solo/42/command-center/business-game-plan"]}><Routes><Route path="/solo/:account/*" element={<SoloGamePlanWorkspace workspaceId="11111111-1111-4111-8111-111111111111" accountContext={{ accountName: "Clearpath", accountType: "standalone", parentTenantId: null }} openPaige={harness.openPaige} />} /></Routes></MemoryRouter>); });
}
function click(label: string) {
  const buttons = [...host.querySelectorAll("button")];
  const button = (buttons.find((node) => node.textContent?.trim() === label)
    ?? buttons.find((node) => node.textContent?.includes(label))) as HTMLButtonElement | undefined;
  expect(button, label).toBeTruthy(); act(() => button!.click());
}

describe("Business Game Plan owner-complete vertical", () => {
  it("preserves Set your plan and replaces generic system/activity material with Plan in Motion", () => {
    render();
    expect(host.querySelector('.sd-rail [data-testid="game-plan-approvals"]')).toBeTruthy();
    expect(host.textContent).toContain("Set your plan");
    expect(host.textContent).toContain("Current-quarter focus");
    expect(host.textContent).toContain("Success criteria");
    expect(host.textContent).toContain("How Paige should operate");
    expect(host.textContent).toContain("What Paige must not assume");
    expect(host.textContent).toContain("Plan in Motion");
    expect(host.textContent).toContain("No strategic plays yet");
    expect(host.textContent).not.toContain("Plan dependencies");
    expect(host.textContent).not.toContain("Work in motion");
    expect(host.textContent).not.toContain("n8n");
    expect(host.textContent).not.toContain("Zapier");
  });

  it("opens the plan editor and persists all owner-direction fields", async () => {
    render(); click("Edit plan");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("What Paige must not assume");
    const fields = host.querySelectorAll("textarea");
    act(() => { const target = fields[6] as HTMLTextAreaElement; target.value = "Do not infer demand."; target.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { click("Save plan"); await Promise.resolve(); });
    expect(harness.save).toHaveBeenCalled();
  });

  it("opens the one Paige workspace with tenant-stamped Business Game Plan context", () => {
    render(); click("Plan with Paige");
    expect(harness.openPaige).toHaveBeenCalledTimes(1);
    expect(getPaigeBusinessPlanScope("11111111-1111-4111-8111-111111111111")).toMatchObject({
      surface: "business_game_plan", businessMissionId: null, label: "Business Game Plan",
    });
    expect(getPaigeBusinessPlanScope("22222222-2222-4222-8222-222222222222")).toBeNull();
  });

  it("shows only truthful card fields and a blocker only for a blocked play", () => {
    harness.mission.items = [{
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Protect renewal quality", state: "blocked",
      stageLabel: "Blocked", horizonLabel: "Dec 31, 2026", nextOwner: "Owner",
      desired_outcome: "Renew the right clients.", next_action: "Confirm capacity.", blocker: "Capacity decision needed.",
      revision: 2, created_at: "", updated_at: "", deadline_on: "2026-12-31", success_definition: "Renewals signed",
      brief_version: 2, closure_outcome: null, outcome_summary: null, state_reason: "Capacity decision needed.",
    }];
    render();
    expect(host.textContent).toContain("Protect renewal quality");
    expect(host.textContent).toContain("Desired outcome");
    expect(host.textContent).toContain("Next meaningful step");
    expect(host.textContent).toContain("Next owner");
    expect(host.textContent).toContain("Capacity decision needed.");
    expect(host.textContent).not.toContain("%");
  });

  it("fails closed when Mission reads are forbidden", () => {
    harness.mission.status = "forbidden";
    render();
    expect(host.textContent).toContain("Owner access required");
    expect(host.textContent).not.toContain("All clear");
  });

  const missionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const summary = (state: StrategicPlay["state"] = "active"): StrategicPlay => ({
    id: missionId, title: "Protect renewal quality", state, state_reason: state === "blocked" ? "Capacity decision needed." : null,
    stageLabel: state === "proposed" ? "Awaiting owner approval" : state === "active" ? "Active" : state === "blocked" ? "Blocked" : state === "paused" ? "Paused" : state === "completed" ? "Complete" : "Archived",
    horizonLabel: "Dec 31, 2026", nextOwner: "Owner", desired_outcome: "Renew the right clients.",
    next_action: "Confirm capacity.", blocker: state === "blocked" ? "Capacity decision needed." : null,
    revision: 4, created_at: "", updated_at: "", deadline_on: "2026-12-31",
    success_definition: "Renewals signed", brief_version: 2,
    closure_outcome: state === "completed" ? "partly_achieved" : null,
    outcome_summary: state === "completed" ? "Two renewals signed." : null,
    request_source: state === "proposed" ? "paige_chat" : "owner_ui",
  });
  const detail = (state: StrategicPlay["state"] = "active") => ({
    mission: {
      ...summary(state), outcome_unknowns: state === "completed" ? "Third renewal pending." : null,
      request_source: state === "proposed" ? "paige_chat" as const : "owner_ui" as const,
      request_thread_id: null,
    },
    brief: {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", version: 2, desired_outcome: "Renew the right clients.",
      deadline_on: "2026-12-31", baseline: "Three renewals due.", strategy: "Lead with outcomes.",
      constraints: ["Protect capacity"], success_definition: "Renewals signed", owner_authority: "Draft, then ask.",
      assumptions: [], missing_information: [], revision_reason: "Owner refined scope.", created_at: "",
    },
  });
  const openDetail = async (state: StrategicPlay["state"]) => {
    harness.mission.items = [summary(state)];
    harness.mission.getDetail.mockResolvedValue(detail(state));
    harness.mission.mutate.mockResolvedValue({ ok: true, verified: true, railRecorded: true, missionId });
    render();
    await act(async () => { click("Protect renewal quality"); await Promise.resolve(); });
  };
  const setField = (label: string, value: string) => {
    const field = [...host.querySelectorAll("label")].find((node) => node.textContent?.includes(label))?.querySelector("input,textarea,select") as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    expect(field, label).toBeTruthy();
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    act(() => { setter?.call(field, value); field!.dispatchEvent(new Event("input", { bubbles: true })); field!.dispatchEvent(new Event("change", { bubbles: true })); });
  };

  it("reviews and revises a canonical Strategic Play", async () => {
    await openDetail("active");
    expect(host.textContent).toContain("canonical Business Game Plan record");
    click("Revise");
    setField("Why this changed", "Owner changed the sequence.");
    await act(async () => { click("Save revision"); await Promise.resolve(); });
    expect(harness.mission.mutate).toHaveBeenCalledWith("mission_revise", expect.objectContaining({
      mission_id: missionId, expected_revision: 4, revision_reason: "Owner changed the sequence.",
    }));
  });

  it("approves a Paige-proposed draft through an explicit owner action", async () => {
    await openDetail("proposed");
    expect(host.textContent).toContain("Awaiting owner approval");
    await act(async () => { click("Approve"); await Promise.resolve(); });
    expect(harness.mission.mutate).toHaveBeenLastCalledWith("mission_transition", expect.objectContaining({ to_state: "active" }));
  });

  it("declines a Paige proposal with a preserved reason", async () => {
    await openDetail("proposed");
    click("Decline");
    setField("Reason", "Not aligned to this quarter.");
    await act(async () => { click("Confirm"); await Promise.resolve(); });
    expect(harness.mission.mutate).toHaveBeenLastCalledWith("mission_transition", expect.objectContaining({
      to_state: "stopped", reason: "Not aligned to this quarter.", closure_outcome: "stopped",
    }));
  });

  it.each([
    ["Pause", "paused", "Capacity review.", "pause"],
    ["Blocked", "blocked", "Capacity decision needed.", "block"],
    ["Complete", "completed", "Two renewals signed.", "complete"],
  ] as const)("runs the %s action only after the owner supplies its truthful reason", async (button, state, reason, _case) => {
    await openDetail("active");
    click(button);
    setField(button === "Blocked" ? "What is blocking" : button === "Complete" ? "Truthful outcome" : "Reason", reason);
    await act(async () => { click("Confirm"); await Promise.resolve(); });
    expect(harness.mission.mutate).toHaveBeenLastCalledWith("mission_transition", expect.objectContaining({ to_state: state, reason }));
  });

  it("resumes a paused play", async () => {
    await openDetail("paused");
    await act(async () => { click("Resume"); await Promise.resolve(); });
    expect(harness.mission.mutate).toHaveBeenLastCalledWith("mission_transition", expect.objectContaining({ to_state: "active" }));
  });

  it("archives a completed play without erasing its verified outcome", async () => {
    await openDetail("completed");
    click("Archive");
    await act(async () => { click("Confirm"); await Promise.resolve(); });
    expect(harness.mission.mutate).toHaveBeenLastCalledWith("mission_transition", expect.objectContaining({
      to_state: "stopped", closure_outcome: "partly_achieved", outcome_summary: "Two renewals signed.", outcome_unknowns: "Third renewal pending.",
    }));
  });

  it("contains the drawer, closes on Escape, and restores the opener focus", async () => {
    await openDetail("active");
    expect(document.body.style.overflow).toBe("hidden");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement?.textContent).toContain("Protect renewal quality");
  });
});
