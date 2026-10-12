import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { CampaignActions } from "./campaign-actions";
import {
  actionMessageFor, basisLine, canEvaluate, canRecordOutcome, lifecycleTone, readActions, useCampaignActions,
  type CampaignAction, type CampaignActionsState,
} from "./useCampaignActions";

const TENANT = "11111111-1111-4111-8111-111111111111";
const row = (action_id: string, lifecycle: string, extra: Record<string, unknown> = {}) => ({
  brief_id: "b1", action_id, tactic: "Win-back email", family: "email", lifecycle, title: `Step ${action_id}`, summary: null,
  approval: { lane: "confirm" }, owner: { department: "marketing" }, due_at: null, waiting_on_dependency: false,
  expected_result: null, observed_result: null, observed_through: null, evaluation: null, evidence: {}, created_through: "human", ...extra,
});

describe("readActions", () => {
  it("keeps only rows it can name a state and family for", () => {
    const read = readActions({ can_manage: true, actions: [row("a1", "planned"), row("a2", "launched"), { ...row("a3", "planned"), family: "billboard" }, { lifecycle: "planned" }] });
    expect(read.canManage).toBe(true);
    expect(read.actions.map((action) => action.actionId)).toEqual(["a1"]);
  });

  it("never shows a result over a step that is only recorded, even if one is sent", () => {
    const [action] = readActions({ actions: [row("a1", "recorded", { observed_result: { summary: "Planted" }, evidence: { basis: "recorded" } })] }).actions;
    expect(action.observed).toBeNull();
    expect(action.basis).toBe("recorded");
    expect(canRecordOutcome(action)).toBe(false);
    expect(basisLine(action.basis)).toMatch(/no run or approval/);
  });

  it("reads a judgement only on a judged step, and a member's step without its name", () => {
    const [judged, member] = readActions({ actions: [
      row("a1", "evaluated", { observed_result: { summary: "Twelve", value: 12 }, evaluation: { verdict: "met", note: "Above" }, evidence: { basis: "approval" } }),
      row("a2", "outcome_observed", { title: null, evaluation: { verdict: "met" }, observed_result: { summary: "Five" } }),
    ] }).actions;
    expect(judged.verdict).toBe("met");
    expect(judged.observed).toEqual({ summary: "Twelve", metricKey: null, value: 12 });
    expect(member.verdict).toBeNull();
    expect(member.title).toBeNull();
    expect(canEvaluate(member)).toBe(true);
  });

  it("draws states in the desk's palette, never as a success unless one stands", () => {
    const tone = (lifecycle: CampaignAction["lifecycle"], verdict: CampaignAction["verdict"] = null) => lifecycleTone({ lifecycle, verdict });
    expect(tone("recorded")).toBe("st-unavail");
    expect(tone("completed")).toBe("st-ready");
    expect(tone("approval_required")).toBe("st-await");
    expect(tone("evaluated", "not_met")).toBe("st-blocked");
    expect(tone("evaluated", "partly_met")).toBe("st-await");
  });

  it("names every refusal the writer can raise in words a person can act on", () => {
    expect(actionMessageFor("CAMPAIGN_ACTION_NOT_PROVEN")).toMatch(/without a run or an approval/);
    expect(actionMessageFor("CAMPAIGN_ACTION_NOT_FINISHED")).toMatch(/hasn't finished/);
    expect(actionMessageFor("CAMPAIGN_ACTION_BUS_REFUSED")).toMatch(/Nothing was planned/);
    expect(actionMessageFor("CAMPAIGN_BRIEF_FORBIDDEN")).toMatch(/Only owners and admins/);
    expect(actionMessageFor("CAMPAIGN_ACTION_TACTIC_INVALID")).toMatch(/tactic/);
  });
});

describe("useCampaignActions", () => {
  let host: HTMLDivElement; let root: Root; let state: CampaignActionsState;
  function Probe() { state = useCampaignActions(TENANT); return null; }
  afterEach(() => { act(() => root.unmount()); host.remove(); rpc.mockReset(); });
  const mount = async (node: React.ReactNode = <Probe/>) => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root.render(node); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };

  it("plans through the writer and counts it only once the read shows the new step", async () => {
    let actions = [row("a1", "planned")];
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_campaign_brief_actions") return { data: { can_manage: true, actions }, error: null };
      actions = [...actions, row("a2", "planned", { tactic: "Launch event", family: "event", title: "Host the open hour" })];
      return { data: { ok: true, outcome: "planned", action_id: "a2", message: "Planned. Nothing is drafted, sent or published; once prepared, it goes to you for approval." }, error: null };
    });
    await mount();
    expect(rpc.mock.calls[0]).toEqual(["get_campaign_brief_actions", { _tenant_id: TENANT, _brief_id: null }]);
    let result: { ok: boolean; message: string } | undefined;
    await act(async () => { result = await state.plan("b1", { title: " Host the open hour ", tactic: "Launch event", family: "event", dueAt: "2031-03-01", expected: "Ten guests" }); });
    expect(result?.ok).toBe(true);
    const write = rpc.mock.calls.find(([name]) => name === "configure_campaign_brief_actions")!;
    expect(write[1]).toMatchObject({ _tenant_id: TENANT, _actor_kind: "human",
      _command: { type: "plan_action", briefId: "b1", title: "Host the open hour", tactic: "Launch event", family: "event", dueAt: "2031-03-01", expectedResult: { summary: "Ten guests" } } });
    expect(state.actions.map((action) => action.actionId)).toEqual(["a1", "a2"]);
  });

  it("does not claim a result the read does not show", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "get_campaign_brief_actions") return { data: { can_manage: true, actions: [row("a1", "completed", { evidence: { basis: "approval" } })] }, error: null };
      return { data: { ok: true, outcome: "outcome_recorded" }, error: null };
    });
    await mount();
    let result: { ok: boolean; message: string } | undefined;
    await act(async () => { result = await state.recordOutcome("b1", "a1", "Twelve calls", 12); });
    expect(result).toEqual({ ok: false, message: "The change was sent but the campaign doesn't show it yet. Reload to check." });
  });

  it("passes the server's refusal through as a sentence and changes nothing", async () => {
    rpc.mockImplementation(async (name: string) => (name === "get_campaign_brief_actions"
      ? { data: { can_manage: true, actions: [row("a1", "recorded", { evidence: { basis: "recorded" } })] }, error: null }
      : { data: null, error: { message: "CAMPAIGN_ACTION_NOT_PROVEN" } }));
    await mount();
    let result: { ok: boolean; message: string } | undefined;
    await act(async () => { result = await state.recordOutcome("b1", "a1", "Lots", null); });
    expect(result?.ok).toBe(false);
    expect(result?.message).toMatch(/without a run or an approval/);
  });

  it("the dossier offers a result only on a proven finish, and nothing to change to a member", async () => {
    const actions = [
      row("a1", "completed", { evidence: { basis: "approval" } }),
      row("a2", "recorded", { evidence: { basis: "recorded" } }),
      row("a3", "outcome_observed", { observed_result: { summary: "Five" } }),
    ];
    rpc.mockImplementation(async () => ({ data: { can_manage: true, actions }, error: null }));
    function Owner() { return <CampaignActions tenantId={TENANT} briefId="b1" onToast={() => {}} onAsk={() => {}}/>; }
    await mount(<Owner/>);
    // The dossier reads only the campaign it shows.
    expect(rpc.mock.calls[0]).toEqual(["get_campaign_brief_actions", { _tenant_id: TENANT, _brief_id: "b1" }]);
    const stepText = (id: string) => [...host.querySelectorAll(".ca-step")].find((li) => li.textContent?.includes(`Step ${id}`))!;
    expect(stepText("a1").textContent).toContain("Record the result");
    expect(stepText("a2").textContent).not.toContain("Record the result");
    expect(stepText("a2").textContent).toContain("Marked done, nothing shows it ran");
    expect(stepText("a3").textContent).toContain("Judge it");
    act(() => root.unmount()); host.remove();

    rpc.mockImplementation(async () => ({ data: { can_manage: false, actions: actions.map((a) => ({ ...a, title: null })) }, error: null }));
    await mount(<Owner/>);
    expect(host.querySelectorAll(".ca button").length).toBe(0);
    expect(host.textContent).toContain("A step (owners and admins see its name)");
  });
});
