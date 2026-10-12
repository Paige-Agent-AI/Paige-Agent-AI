import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { BroughtIn, broughtInNote } from "./campaign-composition";
import { readCampaignLeads, useCampaignLeads } from "./useCampaignLeads";

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

  it("treats a malformed answer as empty, never as leads that aren't there", () => {
    const read = readCampaignLeads({ counts: { leads: -3 }, leads: "nope" });
    expect(read.counts.leads).toBe(0);
    expect(read.leads).toEqual([]);
    expect(read.canManage).toBe(false);
  });
});

describe("broughtInNote", () => {
  const forms = (live: boolean) => [{ id: "f1", name: "Discovery call", live }];
  const note = (leads: number, uncredited: number, live: boolean | null, archived = false) =>
    broughtInNote({ counts: { leads, opportunities: 0, won: 0, lost: 0, waiting: 0, failed: 0 }, uncredited, captureForms: live === null ? [] : forms(live) }, archived);

  it("says a campaign with no leads yet how they arrive, and discloses the ones that fit another campaign", () => {
    expect(note(0, 2, true)).toBe("No leads yet. A lead is credited when someone fills in this campaign’s form or arrives by its tagged link. 2 leads on this campaign’s forms also fit another campaign, so they aren’t counted here.");
  });

  it("does not promise a form credits leads when no attached form is live", () => {
    expect(note(0, 0, false)).toMatch(/^No leads yet\. Attach a live form/);
    expect(note(0, 0, null)).toMatch(/^No leads yet\. Attach a live form/);
  });

  it("tells an archived campaign its forms no longer credit it, as the server does", () => {
    expect(note(3, 0, true, true)).toBe("This campaign is archived, so its forms no longer credit leads to it; a lead arriving by its tagged link still is.");
  });
});

function Lane({ onRoute }: { onRoute?: (route: string) => void }) {
  const leads = useCampaignLeads(TENANT, "b1");
  return <div className="cc"><BroughtIn id="cc-out-b1" leads={leads} onRoute={onRoute}/></div>;
}

describe("Brought in", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; rpc.mockReset(); });
  const render = async (answer: { data: unknown; error: unknown }, onRoute: (route: string) => void = vi.fn()) => {
    rpc.mockResolvedValue(answer);
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<Lane onRoute={onRoute}/>); });
    return host;
  };
  const values = (node: HTMLElement) => [...node.querySelectorAll(".cc-outv")].map((row) => row.textContent);

  it("asks the server for this campaign's leads in this workspace", async () => {
    await render({ data: payload(), error: null });
    expect(rpc).toHaveBeenCalledWith("get_campaign_brief_leads", { _tenant_id: TENANT, _brief_id: "b1" });
  });

  it("shows the server's counts, not a count of the rows it happened to list", async () => {
    const node = await render({ data: payload({ counts: { leads: 240, with_opportunity: 31 }, truncated: true }), error: null });
    expect(values(node)).toEqual(["240leads credited to this campaign", "31opportunities · open Sales", "—No figure:Revenue lives in Sales"]);
  });

  it("speaks in the singular for one lead and one opportunity", async () => {
    const node = await render({ data: payload({ counts: { leads: 1, with_opportunity: 1 } }), error: null });
    expect(values(node).slice(0, 2)).toEqual(["1lead credited to this campaign", "1opportunity · open Sales"]);
  });

  it("routes opportunities to Sales, which owns them", async () => {
    const onRoute = vi.fn();
    const node = await render({ data: payload(), error: null }, onRoute);
    await act(async () => { (node.querySelector(".cc-lnk") as HTMLButtonElement).click(); });
    expect(onRoute).toHaveBeenCalledWith("sales");
  });

  it("never values a deal or claims revenue", async () => {
    const node = await render({ data: payload({ counts: { leads: 2, with_opportunity: 2, won: 1 } }), error: null });
    expect(node.textContent).not.toMatch(/\$|revenue of|earned|won/i);
  });

  it("says how leads reach an empty campaign, with a form attached or without one", async () => {
    const withForm = await render({ data: payload({ counts: { leads: 0 }, leads: [] }), error: null });
    expect(withForm.textContent).toContain("No leads yet. A lead is credited when someone fills in this campaign’s form or arrives by its tagged link.");
    expect(withForm.querySelector(".cc-lnk")).toBeNull(); // nothing in Sales to see yet
    act(() => root?.unmount()); host?.remove();
    const noForm = await render({ data: payload({ counts: { leads: 0 }, leads: [], capture_forms: [] }), error: null });
    expect(noForm.textContent).toContain("No leads yet. Attach a live form people sign up on");
  });

  it("discloses leads that fit two campaigns instead of undercounting quietly", async () => {
    const node = await render({ data: payload({ ambiguous_on_campaign_forms: 2 }), error: null });
    expect(node.textContent).toContain("2 leads on this campaign’s forms also fit another campaign, so they aren’t counted here.");
  });

  it("never lets a slower, older read replace a newer one", async () => {
    let failFirst: (reason: unknown) => void = () => {};
    rpc.mockReturnValueOnce(new Promise((_resolve, reject) => { failFirst = reject; }));
    rpc.mockResolvedValueOnce({ data: payload(), error: null });
    host = document.createElement("div"); document.body.appendChild(host);
    root = createRoot(host);
    let retry: () => void = () => {};
    function Probe() { const leads = useCampaignLeads(TENANT, "b1"); retry = leads.retry; return <div className="cc"><BroughtIn id="x" leads={leads}/></div>; }
    await act(async () => { root!.render(<Probe/>); });
    await act(async () => { retry(); });
    expect(values(host)[0]).toBe("2leads credited to this campaign");
    await act(async () => { failFirst(new Error("late")); });
    expect(values(host)[0]).toBe("2leads credited to this campaign");
    expect(host.querySelector("[role=alert]")).toBeNull();
  });

  it("moves focus to the lane's heading when Try again is pressed, not to the page", async () => {
    const node = await render({ data: null, error: { message: "boom" } });
    rpc.mockResolvedValueOnce({ data: payload(), error: null });
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0; });
    await act(async () => { (node.querySelector("button") as HTMLButtonElement).click(); });
    raf.mockRestore();
    expect(document.activeElement?.textContent).toBe("Brought in");
  });

  it("offers to try again when the read fails, and never shows a zero it didn't read", async () => {
    const node = await render({ data: null, error: { message: "boom" } });
    expect(node.textContent).toContain("The leads this campaign brought in couldn’t load.");
    expect(node.querySelector(".cc-outv")).toBeNull();
    rpc.mockResolvedValueOnce({ data: payload(), error: null });
    await act(async () => { (node.querySelector("button") as HTMLButtonElement).click(); });
    expect(values(node)[0]).toBe("2leads credited to this campaign");
  });
});
