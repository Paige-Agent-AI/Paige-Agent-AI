import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { CampaignLeads } from "./campaign-leads";
import { ATTRIBUTION_LABEL, readCampaignLeads, statusLabel, statusTone } from "./useCampaignLeads";

const TENANT = "11111111-1111-4111-8111-111111111111";
const lead = (submission_id: string, extra: Record<string, unknown> = {}) => ({
  submission_id, received_at: "2026-10-12T09:00:00Z", attribution: "form_link", processing_state: "done", form_id: "f1", form_name: "Discovery call",
  contact_id: "c1", contact_name: "Renée Okafor", has_contact: true, deal_id: "d1", deal_title: "Renée — discovery", deal_status: "open",
  pipeline_name: "Client pipeline", stage_label: "New enquiry", stage_type: "open", ...extra,
});
const payload = (extra: Record<string, unknown> = {}) => ({
  brief_id: "b1", can_manage: true,
  counts: { leads: 2, with_contact: 2, with_opportunity: 2, open: 1, won: 1, lost: 0, waiting: 0, failed: 0 },
  ambiguous_on_campaign_forms: 0, capture_forms: [{ form_id: "f1", name: "Discovery call", status: "active" }],
  leads: [lead("s1"), lead("s2", { deal_status: "won", stage_label: "Signed", attribution: "form_and_tag" })], truncated: false, ...extra,
});

describe("readCampaignLeads", () => {
  it("takes the server's counts and drops any lead it can't name a credit for", () => {
    const read = readCampaignLeads(payload({ leads: [lead("s1"), lead("s2", { attribution: "ambiguous" }), lead("s3", { attribution: "guessed" }), { attribution: "form_link" }] }));
    expect(read.counts).toEqual({ leads: 2, opportunities: 2, won: 1, lost: 0, waiting: 0, failed: 0 });
    expect(read.leads.map((row) => row.id)).toEqual(["s1"]);
  });

  it("reads where each lead stands from Sales first, then from processing", () => {
    const [open, won, lost, waiting, failed, none] = readCampaignLeads(payload({ leads: [
      lead("a"), lead("b", { deal_status: "won" }), lead("c", { deal_status: "lost" }),
      lead("d", { deal_status: null, processing_state: "claimed" }), lead("e", { deal_status: null, processing_state: "error" }),
      lead("f", { deal_status: null, processing_state: "done" }),
    ] })).leads.map((row) => row.status);
    expect([open, won, lost, waiting, failed, none]).toEqual(["open", "won", "lost", "waiting", "failed", "no_opportunity"]);
  });

  it("never spends gold on a status (§11)", () => {
    for (const status of ["open", "won", "lost", "waiting", "failed", "no_opportunity"] as const) expect(statusTone(status)).not.toMatch(/gold/);
    expect(statusLabel({ status: "open", stageLabel: null })).toBe("Open");
    expect(ATTRIBUTION_LABEL.campaign_tag).toBe("Tagged link");
  });

  it("treats a malformed answer as empty, never as leads that aren't there", () => {
    const read = readCampaignLeads({ counts: { leads: -3 }, leads: "nope" });
    expect(read.counts.leads).toBe(0);
    expect(read.leads).toEqual([]);
    expect(read.canManage).toBe(false);
  });
});

describe("CampaignLeads", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; rpc.mockReset(); });
  const render = async (answer: { data: unknown; error: unknown }) => {
    rpc.mockResolvedValue(answer);
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<CampaignLeads tenantId={TENANT} briefId="b1" shortRef="CB-SPRING"/>); });
    return host;
  };

  it("asks the server for this campaign's leads in this workspace", async () => {
    await render({ data: payload(), error: null });
    expect(rpc).toHaveBeenCalledWith("get_campaign_brief_leads", { _tenant_id: TENANT, _brief_id: "b1" });
  });

  it("shows the server's tally, the pipeline once, and each lead's stage", async () => {
    const node = await render({ data: payload(), error: null });
    const text = node.textContent ?? "";
    expect(text).toContain("2 leads");
    expect(text).toContain("1 won");
    expect(text).toContain("in Client pipeline");
    expect(text).toContain("Renée Okafor");
    expect(text).toContain("New enquiry");
    expect(text).toContain("Campaign form, tagged link · Discovery call");
    expect(text).not.toContain("Client pipeline · New enquiry");
  });

  it("names the pipeline on each row when leads sit in more than one", async () => {
    const node = await render({ data: payload({ leads: [lead("s1"), lead("s2", { pipeline_name: "Partners", stage_label: "Intro" })] }), error: null });
    expect(node.textContent).toContain("Client pipeline · New enquiry");
    expect(node.textContent).toContain("Partners · Intro");
    expect(node.textContent).not.toContain("in Client pipeline");
  });

  it("shows a member that a lead arrived, never who", async () => {
    const node = await render({ data: payload({ can_manage: false, leads: [lead("s1", { contact_name: null, contact_id: null })] }), error: null });
    // The row's own name slot (the footer also begins "A lead is credited…", so the page text proves nothing).
    expect(node.querySelector(".cl-row .cl-n")?.textContent).toBe("A lead");
    expect(node.querySelector(".cl-row .cl-n.cc-hidden")).not.toBeNull();
    expect(node.textContent).toContain("Owners and admins see who each lead is.");
    expect(node.textContent).not.toContain("Renée");
  });

  it("tells an owner a lead is still being saved rather than calling it hidden", async () => {
    const node = await render({ data: payload({ leads: [lead("s1", { contact_name: null, deal_status: null, processing_state: "pending" })] }), error: null });
    expect(node.querySelector(".cl-row .cl-n")?.textContent).toBe("Being saved as a contact");
    expect(node.textContent).toContain("Being filed");
    expect(node.querySelector(".cc-hidden")).toBeNull();
  });

  it("says how leads reach an empty campaign, by its forms or its tag", async () => {
    const withForm = await render({ data: payload({ counts: { leads: 0 }, leads: [] }), error: null });
    expect(withForm.textContent).toContain("Anyone who fills in Discovery call, or arrives on a link tagged CB-SPRING, shows up here.");
    act(() => root?.unmount()); host?.remove();
    const noForm = await render({ data: payload({ counts: { leads: 0 }, leads: [], capture_forms: [] }), error: null });
    expect(noForm.textContent).toContain("No leads yet, and no form is attached.");
  });

  it("discloses leads that fit two campaigns instead of undercounting quietly", async () => {
    const node = await render({ data: payload({ ambiguous_on_campaign_forms: 2 }), error: null });
    expect(node.textContent).toContain("2 leads on this campaign's forms also fit another campaign");
  });

  it("says a failed read changed nothing and offers to try again", async () => {
    const node = await render({ data: null, error: { message: "boom" } });
    expect(node.textContent).toContain("This campaign's leads couldn't load. Nothing was changed.");
    rpc.mockResolvedValueOnce({ data: payload(), error: null });
    await act(async () => { (node.querySelector("button") as HTMLButtonElement).click(); });
    expect(node.textContent).toContain("Renée Okafor");
  });
});
