// @vitest-environment jsdom
// Marketing › Analytics reads the SAME Sales pipelines and stages as Ads and Sales (owner ruling
// 2026-10-11): where the range's leads stand, by campaign tag and ad tag, through the one server read
// get_pipeline_lead_funnel, or from the submissions the hub already holds when that read isn't there.
// Only the network is stubbed (the Supabase client) plus the two reads Analytics' other panels own.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; error: unknown };
const net = vi.hoisted(() => ({ calls: [] as [string, Record<string, unknown>][], answer: null as null | ((args: Record<string, unknown>) => Answer) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => { net.calls.push([name, args]); return Promise.resolve(net.answer ? net.answer(args) : { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } }); } },
}));
vi.mock("./marketing-analytics-email", () => ({ useEmailStats: () => ({ phase: "ready", stats: { sent: 0, tracked: 0, opened: 0, clicked: 0 }, retry: () => {} }) }));
vi.mock("./marketing-analytics-metrics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./marketing-analytics-metrics")>()),
  useMarketingServerFigures: () => ({ phase: "denied", current: null, previous: null, retry: () => {} }),
}));

import { MarketingAnalytics } from "./marketing-analytics";
import { resetAdsIntakeCapability } from "./ads-intake-capability";
import type { CampaignSubmission } from "./useSoloCampaigns";
import { submissionsInPeriod } from "./marketing-overview-model";

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const sub = (id: string, days: number, dealId: string | null, campaign: string | null, content: string | null): CampaignSubmission =>
  ({ id, formId: "f1", source: "paige_form", state: "done", createdAt: day(days), contactId: null, dealId, trackingSource: campaign ? "newsletter" : null, trackingCampaign: campaign, trackingContent: content });
const stg = (id: string, pipelineId: string, orderIndex: number, label: string, stageType: "open" | "won" | "lost" = "open") => ({ id, pipelineId, label, description: "", orderIndex, archivedAt: null, movePolicy: "direct" as const, stageType, version: 1 });
const WORKSPACE = {
  pipelines: [
    { id: "p-b", shortRef: "B", folderId: null, folderName: null, name: "Audits", description: "", isDefault: false, lifecycleStatus: "active" as const, version: 1, createdAt: day(9), updatedAt: day(9), createdThrough: null, createdByName: null, requestedByName: null, stageCount: 1, dealCount: 0 },
    { id: "p-a", shortRef: "A", folderId: null, folderName: null, name: "Client intake", description: "", isDefault: true, lifecycleStatus: "active" as const, version: 1, createdAt: day(9), updatedAt: day(9), createdThrough: null, createdByName: null, requestedByName: null, stageCount: 3, dealCount: 3 },
  ],
  stages: [stg("a1", "p-a", 1, "New"), stg("a2", "p-a", 2, "Signed", "won"), stg("a3", "p-a", 3, "Passed", "lost"), stg("b1", "p-b", 1, "Scoping")],
  deals: [{ id: "d1", pipelineId: "p-a", stageId: "a1" }, { id: "d2", pipelineId: "p-a", stageId: "a2" }, { id: "d3", pipelineId: "p-a", stageId: "a3" }] as never[],
};
const SUBMISSIONS = [sub("s1", 1, "d1", "CB-SPRING", "img-1"), sub("s2", 3, "d2", "CB-SPRING", "img-1"), sub("s3", 4, "d3", null, null), sub("s4", 60, "d1", "CB-OLD", null)];

let host: HTMLDivElement;
let root: Root;
const flush = async () => { for (let round = 0; round < 3; round++) await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const render = async (props: Partial<React.ComponentProps<typeof MarketingAnalytics>> = {}) => {
  act(() => root.render(<MarketingAnalytics tenantId="t-1" submissions={SUBMISSIONS} forms={[]} briefs={[]} briefsKnown range="month" onRange={() => {}} onOpenForm={() => {}} onOpenSales={() => {}} onOpenEmail={() => {}} pipelineWorkspace={WORKSPACE} {...props}/>));
  await flush();
};
const panel = () => host.querySelector(".plf") as HTMLElement;
const rows = (caption: string) => [...[...panel().querySelectorAll(".plf-table")].find((t) => t.querySelector("h3")?.textContent === caption)!.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent));

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  net.calls = []; net.answer = null;
  resetAdsIntakeCapability();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("Marketing › Analytics: where the range's leads stand in Sales", () => {
  it("reads the default pipeline over the range from the one server read, right after the lead-to-opportunity funnel", async () => {
    net.answer = (args) => ({ data: {
      pipeline: { id: args.p_pipeline_id, name: "Client intake", is_default: true },
      stages: [{ id: "a1", name: "New", order_index: 1, stage_type: "open", deals: 7 }, { id: "a2", name: "Signed", order_index: 2, stage_type: "won", deals: 2 }],
      stages_window: "current",
      leads: { total: 5, tagged: 4, untagged: 1, unfiled: 2 },
      campaigns: [{ campaign: "CB-SPRING", leads: 4, open: 2, won: 2, lost: 0, by_stage: { a1: 2, a2: 2 } }],
      ads: [{ ad: "img-1", campaign: "CB-SPRING", content_id: null, kind: null, image_url: null, leads: 3, open: 1, won: 2, lost: 0 }],
      since: args.p_since,
    }, error: null });
    const onOpenRouting = vi.fn();
    await render({ onOpenRouting });
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0][0]).toBe("get_pipeline_lead_funnel");
    expect(net.calls[0][1].p_pipeline_id).toBe("p-a");
    // The same "last 30 days" as the headline lead count on this page.
    expect(net.calls[0][1].p_since).toBe(new Date(submissionsInPeriod([], 30).periodStart).toISOString());
    expect(panel().previousElementSibling?.getAttribute("aria-labelledby")).toBe("mva-funnel-h");
    expect(panel().querySelector("h2")?.textContent).toBe("Where these leads stand in Sales");
    expect(panel().getAttribute("data-funnel-source")).toBe("server");
    expect([...panel().querySelectorAll(".plf-stage-n")].map((b) => b.textContent)).toEqual(["7", "2"]);
    expect(rows("By campaign")).toEqual([["CB-SPRING2 in New · 2 in Signed", "4", "2", "2", "0"]]);
    // Marketing holds no picture library, so an ad tag reads as the tag itself.
    expect(rows("By ad")).toEqual([["img-1Campaign CB-SPRING", "3", "1", "2", "0"]]);
    // The stages are deals now; the leads that reached no pipeline are named, with their routing a click away.
    expect(panel().querySelector(".plf-sub")?.textContent).toBe("Deals in each stage now");
    expect(panel().querySelector(".plf-unfiled span")?.textContent).toBe("2 leads in the last 30 days didn’t reach a pipeline, counting any still being filed.");
    act(() => (panel().querySelector(".plf-unfiled button") as HTMLButtonElement).click());
    expect(onOpenRouting).toHaveBeenCalled();
    // Won counts are read from Sales; value and revenue stay there.
    expect(host.querySelector(".mva-foot span")?.textContent).toBe("Won counts below are read from your Sales pipelines; deal value and revenue stay in Sales.");
  });

  it("draws a picture the server matched by its id, with its thumbnail, even with no library on this page", async () => {
    net.answer = (args) => ({ data: { pipeline: { id: args.p_pipeline_id, name: "Client intake", is_default: true }, stages: [], leads: { total: 1, tagged: 1, untagged: 0, unfiled: 0 }, campaigns: [], ads: [{ ad: "AC000000-0000-0000-0000-000000000002", campaign: null, content_id: "ac000000-0000-0000-0000-000000000002", kind: "image", image_url: "https://cdn.example/c2.png", leads: 1, open: 0, won: 1, lost: 0 }] }, error: null });
    await render();
    expect(rows("By ad")).toEqual([["Library picture …0002", "1", "0", "1", "0"]]);
    expect(panel().querySelector(".plf-thumb img")?.getAttribute("src")).toBe("https://cdn.example/c2.png");
  });

  it("names an ad tag that is a library picture's id as a picture, never as a raw id", async () => {
    net.answer = (args) => ({ data: { pipeline: { id: args.p_pipeline_id, name: "Client intake", is_default: true }, stages: [], leads: { total: 1, tagged: 1, untagged: 0 }, campaigns: [], ads: [{ ad: "7c1d0000-0000-4000-8000-00000000abcd", campaign: null, leads: 1, open: 1, won: 0, lost: 0 }] }, error: null });
    await render();
    expect(rows("By ad")).toEqual([["Library picture …abcd", "1", "1", "0", "0"]]);
  });

  it("when the server read isn't there yet, counts the hub's own submissions (with their ad tag) and says so", async () => {
    await render();
    expect(panel().getAttribute("data-funnel-source")).toBe("records");
    expect([...panel().querySelectorAll(".plf-stage")].map((li) => li.textContent)).toEqual(["New1", "SignedWon1", "PassedLost1"]);
    expect(panel().querySelector(".plf-sum")?.textContent).toBe("3 deals on this pipeline now. 3 leads in the last 30 days reached it, and 2 carried a campaign or ad tag.");
    expect(rows("By campaign")).toEqual([["CB-SPRING1 in New · 1 in Signed", "2", "1", "1", "0"]]);
    expect(rows("By ad")).toEqual([["img-1Campaign CB-SPRING", "2", "1", "1", "0"]]);
    expect(panel().querySelector(".plf-note")?.textContent).toContain("The server count isn’t available yet");
  });

  it("someone the server refuses sees a note that campaign results are for owners and admins, never zeros or a fallback", async () => {
    net.answer = () => ({ data: null, error: { code: "42501", message: "PIPELINE_FORBIDDEN" } });
    await render();
    expect(panel().getAttribute("data-funnel-source")).toBe("restricted");
    expect(panel().querySelector(".plf-empty h3")?.textContent).toBe("Campaign results are for owners and admins");
    expect(panel().querySelectorAll(".plf-stage, table, .plf-picker-btn").length).toBe(0);
    expect(net.calls).toHaveLength(1);
  });

  it("a failed server read shows as failed with Try again, never as counts the browser worked out", async () => {
    let fail = true;
    net.answer = (args) => fail
      ? { data: null, error: { code: "XX000", message: "boom" } }
      : { data: { pipeline: { id: args.p_pipeline_id, name: "Client intake", is_default: true }, stages: [{ id: "a1", name: "New", order_index: 1, stage_type: "open", deals: 4 }], leads: { total: 4, tagged: 0, untagged: 4, unfiled: 0 }, campaigns: [], ads: [] }, error: null };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    expect(panel().querySelector(".plf-empty h3")?.textContent).toBe("These counts couldn’t load");
    expect(panel().querySelectorAll(".plf-stage, table, .plf-note").length).toBe(0);
    expect(panel().getAttribute("data-funnel-source")).not.toBe("records");
    fail = false;
    act(() => (panel().querySelector(".plf-empty button") as HTMLButtonElement).click());
    await flush();
    expect(panel().getAttribute("data-funnel-source")).toBe("server");
    expect([...panel().querySelectorAll(".plf-stage-n")].map((b) => b.textContent)).toEqual(["4"]);
    quiet.mockRestore();
  });

  it("while the server read isn't there yet, a full submissions read makes every lead count a floor", async () => {
    const full = Array.from({ length: 200 }, (_, i) => sub(`f${i}`, 2, "d1", "CB-SPRING", null));
    await render({ submissions: full });
    expect(panel().querySelector(".plf-note")?.textContent).toBe("The server count isn’t available yet, so these figures are counted from the latest 200 leads read here; each lead count is a floor. Deals by stage count every deal in the pipeline.");
    // Last touch: the 200 leads are one deal, counted once.
    expect(rows("By campaign")[0].slice(1)).toEqual(["200+", "1+", "0+", "0+"]);
    expect(panel().querySelector(".plf-sum")?.textContent).toBe("3 deals on this pipeline now. 200+ leads in the last 30 days reached it, and 200+ carried a campaign or ad tag.");
  });

  it("with no Sales pipeline, asks only whether the ads-intake functions are deployed, and words where leads go by the answer", async () => {
    await render({ pipelineWorkspace: { pipelines: [], stages: [], deals: [] } });
    expect(panel().querySelector(".plf-empty h3")?.textContent).toBe("No Sales pipeline yet");
    expect(net.calls).toEqual([["get_pipeline_lead_funnel", { p_pipeline_id: null, p_since: null }]]);
    // Not deployed (PGRST202): no claim that a lead starts in the pipeline.
    expect(panel().querySelector(".plf-empty p")?.textContent).toBe("Once Sales has a pipeline and your forms send leads to it, every lead and where it stands shows here.");
    act(() => root.unmount()); root = createRoot(host);
    resetAdsIntakeCapability();
    net.calls = [];
    net.answer = () => ({ data: null, error: { code: "42501", message: "PIPELINE_FORBIDDEN" } });
    await render({ pipelineWorkspace: { pipelines: [], stages: [], deals: [] } });
    expect(panel().querySelector(".plf-empty p")?.textContent).toBe("Once Sales has a pipeline, your forms’ leads start in its first stage, and every lead and where it stands shows here.");
  });
});
