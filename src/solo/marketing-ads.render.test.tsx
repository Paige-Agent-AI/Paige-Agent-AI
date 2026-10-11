// @vitest-environment jsdom
// The Ads desk (INT-342 S1c; its own department since 2026-10-10): the paid-acquisition desk before any ad platform can be read. Saved ad
// copy and briefs are real; every provider figure is named as not available. Network reads are stubbed at
// the Supabase client and the briefs adapter; everything else is the real view.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; error: unknown };
type Rpc = (args: Record<string, unknown>) => Answer | Promise<Answer>;
const db: { tables: Record<string, Answer | Promise<Answer>>; calls: { table: string; filters: [string, unknown][] }[]; rpc: Record<string, Rpc>; rpcCalls: [string, Record<string, unknown>][] } = { tables: {}, calls: [], rpc: {}, rpcCalls: [] };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call = { table, filters: [] as [string, unknown][] };
    db.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit"]) chain[method] = () => chain;
    chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain; };
    chain.neq = (column: string, value: unknown) => { call.filters.push([`not ${column}`, value]); return chain; };
    chain.in = (column: string, value: unknown) => { call.filters.push([`in ${column}`, value]); return chain; };
    chain.gte = (column: string, value: unknown) => { call.filters.push([`from ${column}`, value]); return chain; };
    // The library's pictures and videos are the same table read with a kind filter: answered on their own.
    const answer = () => (table === "marketing_content" && call.filters.some(([column]) => column === "in kind") ? db.tables.media : db.tables[table]) ?? { data: [], error: null };
    chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject);
    return chain;
  };
  const rpc = (name: string, args: Record<string, unknown>) => { db.rpcCalls.push([name, args]); return Promise.resolve(db.rpc[name] ? db.rpc[name](args) : { data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } }); };
  return { supabase: { from, rpc } };
});
const briefs = { phase: "ready", canManage: true, briefs: [] as Array<Record<string, unknown>> };
vi.mock("./useSoloCampaignBriefs", () => ({ useSoloCampaignBriefs: () => briefs }));
// The Sales pipelines, as the canonical workspace read returns them (scope "pipeline" only: Ads never
// mounts Marketing's whole read).
const sales = { phase: "ready", retry: vi.fn(), artifacts: [] as unknown[], pipelineWorkspace: { canManage: true, canArchiveFolders: false, folders: [], automationRules: [], pipelines: [] as unknown[], stages: [] as unknown[], deals: [] as unknown[] } };
const salesScopes: unknown[] = [];
vi.mock("./useSoloCampaigns", () => ({ useSoloCampaigns: (options?: { scope?: string }) => { salesScopes.push(options?.scope); return sales; } }));
const upload = vi.fn();
vi.mock("@/components/admin/studio/studio", () => ({ uploadToLibrary: (...args: unknown[]) => upload(...args) }));

import { MarketingAds, parseAdCopy, type AdsView } from "./marketing-ads";
import { resetAdsIntakeCapability } from "./ads-intake-capability";
import fs from "node:fs";
import path from "node:path";

// A deployed get_pipeline_lead_funnel refuses a pipeline it can't find, a null id included: that is
// how the page learns the ads-intake functions are there (ads-intake-capability.ts).
const FORBIDDEN = (): Answer => ({ data: null, error: { code: "42501", message: "PIPELINE_FORBIDDEN" } });

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); }); };
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const handlers = { onView: vi.fn(), onOpenIntegrations: vi.fn(), onOpenAudience: vi.fn(), onOpenAnalytics: vi.fn(), onOpenCampaigns: vi.fn(), onOpenFormRouting: vi.fn() };
const render = async (view: AdsView = "overview", tenantId = "t-1") => { act(() => root.render(<MarketingAds tenantId={tenantId} view={view} {...handlers}/>)); await flush(); };
const AD = { id: "a1", title: "Spring planning session", status: "draft", updated_at: "2026-10-01T10:00:00Z", body: "**Headline:** Plan your quarter in 30 minutes\n**Primary text:** Book a strategy session and leave with a plan.\n**CTA:** Book a session" };

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  db.tables = {}; db.calls = []; db.rpc = { get_pipeline_lead_funnel: FORBIDDEN }; db.rpcCalls = [];
  resetAdsIntakeCapability();
  sales.artifacts = [];
  briefs.phase = "ready"; briefs.canManage = true; briefs.briefs = [];
  sales.phase = "ready"; sales.pipelineWorkspace.pipelines = []; sales.pipelineWorkspace.stages = []; sales.pipelineWorkspace.deals = [];
  salesScopes.length = 0; upload.mockReset();
  Object.values(handlers).forEach((fn) => fn.mockClear());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("parseAdCopy", () => {
  it("reads PAIGE's labelled parts and keeps unlabelled words as primary text", () => {
    expect(parseAdCopy(AD.body)).toEqual({ headline: "Plan your quarter in 30 minutes", primary: "Book a strategy session and leave with a plan.", cta: "Book a session" });
    expect(parseAdCopy("Just one paragraph of copy.")).toEqual({ headline: null, primary: "Just one paragraph of copy.", cta: null });
    expect(parseAdCopy("Headline - Fast\nBody: line one\nline two\nCall to action: Start")).toEqual({ headline: "Fast", primary: "line one line two", cta: "Start" });
    expect(parseAdCopy(null)).toEqual({ headline: null, primary: "", cta: null });
  });

  it("reads the formats the chat model actually varies between", () => {
    const want = { headline: "Plan your quarter", primary: "Book a session.", cta: "Book now" };
    for (const body of [
      "## Headline\nPlan your quarter\n## Primary text\nBook a session.\n## Call to action\nBook now",
      "- **Headline:** Plan your quarter\n- **Primary text:** Book a session.\n- **CTA:** Book now",
      "*Headline:* Plan your quarter\n__Primary text:__ Book a session.\nCall-to-action: Book now",
      "Headline — Plan your quarter\nPrimary text — Book a session.\nCTA — Book now",
    ]) expect(parseAdCopy(body)).toEqual(want);
    // Words after a one-line call to action go back to the body, never into the button.
    expect(parseAdCopy("Headline: Fast\nCTA: Book now\nHashtags: #coaching")).toEqual({ headline: "Fast", primary: "Hashtags: #coaching", cta: "Book now" });
    // A sentence that happens to start with "Text" keeps every word.
    expect(parseAdCopy("Text - me now and we'll talk.").primary).toBe("Text - me now and we'll talk.");
  });
});

describe("The Ads desk", () => {
  it("opens on Overview: nothing estimated, a ghost spend card, the brief's budget quoted as a plan, and the drafts ready", async () => {
    db.tables.marketing_content = { data: [AD], error: null };
    briefs.briefs = [{ id: "b1", name: "Spring advisory intake", budgetTarget: "About $2,000 for April", lifecycleStatus: "active" }, { id: "b2", name: "Old", budgetTarget: "$9", lifecycleStatus: "archived" }];
    await render();
    expect(host.querySelector(".mov-sum")?.textContent).toBe("Paige can’t read an ad account yet, so nothing here is estimated. 1 ad copy draft ready.");
    // A tenant can connect Meta in Integrations, so the desk never claims nothing is connected.
    expect(text()).not.toMatch(/No ad account (is )?connected/);
    // The newest drafts are named, with the headline PAIGE wrote.
    expect([...host.querySelectorAll(".mad-newest li")].map((li) => li.textContent)).toEqual(["Spring planning sessionPlan your quarter in 30 minutes · saved Oct 1Draft"]);
    expect(db.calls.find((c) => c.table === "marketing_content")?.filters).toEqual([["tenant_id", "t-1"], ["channel", "ad_copy"], ["not status", "archived"]]);
    expect([...host.querySelectorAll(".mad-nums dd")].map((dd) => dd.textContent)).toEqual(["—", "—", "—"]);
    // The owner's words, verbatim, never as spend; an archived brief's budget is not a plan.
    expect([...host.querySelectorAll(".mad-plan li")].map((li) => li.textContent)).toEqual(["Written in Spring advisory intake (running): “About $2,000 for April”A plan, never spend"]);
    expect(text()).toContain("Return on ad spend isn’t shown");
    act(() => button("Open Creative")!.click());
    expect(handlers.onView).toHaveBeenCalledWith("creative");
    act(() => button("Open Integrations")!.click());
    expect(handlers.onOpenIntegrations).toHaveBeenCalled();
    // No figure is invented anywhere on the desk.
    expect(text().replace("About $2,000 for April", "")).not.toMatch(/\$\s?\d|\d+%|\bROAS\b/i);
  });

  it("says plainly when no brief writes a budget, or when briefs could not load", async () => {
    await render();
    expect(host.querySelector(".mad-plan")?.textContent).toBe("No budget is written in any brief. If one is, it shows here as written, never as spend.");
    act(() => root.unmount()); root = createRoot(host);
    briefs.phase = "error";
    await render();
    expect(host.querySelector(".mad-plan")?.textContent).toContain("couldn’t load");
  });

  it("previews each saved ad as it would read in a feed, with a draft-first revise", async () => {
    db.tables.marketing_content = { data: [AD, { ...AD, id: "a2", title: "Plain", body: "Only body copy." }], error: null };
    const asks: string[] = [];
    const listen = (event: Event) => asks.push((event as CustomEvent).detail?.prompt);
    window.addEventListener("paige:open", listen);
    await render("creative");
    const cards = [...host.querySelectorAll(".mad-card")];
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector(".mad-prev-t")?.textContent).toBe("Book a strategy session and leave with a plan.");
    expect(cards[0].querySelector(".mad-prev-f")?.textContent).toBe("Plan your quarter in 30 minutesBook a session");
    // Nothing is invented: a missing headline or call to action is named as missing, not filled in.
    expect(cards[1].querySelector(".mad-prev-f")?.textContent).toBe("No headline writtenNo call to action");
    expect(cards[1].querySelector(".mad-cta.is-missing")).not.toBeNull();
    // The copy itself is readable by assistive tech; only the avatar and image slot are hidden.
    expect(cards[0].querySelector(".mad-prev")?.getAttribute("aria-hidden")).toBeNull();
    act(() => (cards[0].querySelector(".mad-meta-a button") as HTMLButtonElement).click());
    window.removeEventListener("paige:open", listen);
    expect(asks[0]).toMatch(/Spring planning session/);
    expect(asks[0]).toMatch(/do not run or publish anything/);
  });

  it("tells a member the saved copy is for owners and admins, without reading it", async () => {
    briefs.canManage = false;
    await render();
    expect(host.querySelector(".mov-sum")?.textContent).toContain("Saved ad copy is visible to owners and admins.");
    expect(db.calls.some((c) => c.table === "marketing_content")).toBe(false);
    // Asking PAIGE stays open to everyone (§58): it now sits in the Ads department strip
    // (AdsWorkspace.route.test.tsx), so the desk itself carries no view switcher or ask.
    expect(host.querySelector('[aria-label="Ads views"]')).toBeNull();
    act(() => root.unmount()); root = createRoot(host);
    await render("creative");
    expect(text()).toContain("visible to its owners and admins");
  });

  it("shows a failed read with a retry, and an empty library with the ask", async () => {
    db.tables.marketing_content = { data: null, error: { message: "boom" } };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await render("creative");
    expect(text()).toContain("Your saved ad copy could not load");
    db.tables.marketing_content = { data: [], error: null };
    act(() => button("Try again")!.click());
    await flush();
    expect(text()).toContain("No ad copy yet.");
    expect(button("Ask PAIGE for ad copy")).toBeDefined();
    quiet.mockRestore();
  });

  it("a failed read on Overview says so and offers a retry, and loading shows a skeleton", async () => {
    let release: (value: Answer) => void = () => {};
    db.tables.marketing_content = new Promise<Answer>((resolve) => { release = resolve; });
    await render();
    expect(host.querySelector(".mad-skel")).not.toBeNull();
    release({ data: null, error: { message: "boom" } });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await flush();
    expect(host.querySelector(".mov-sum")?.textContent).toContain("Your saved ad copy could not load.");
    db.tables.marketing_content = { data: [AD], error: null };
    act(() => button("Try again")!.click());
    await flush();
    expect(host.querySelector(".mov-sum")?.textContent).toContain("1 ad copy draft ready.");
    quiet.mockRestore();
  });

  it("names every provider figure's source, and sends the one partly-available figure to Analytics", async () => {
    await render("performance");
    const rows = [...host.querySelectorAll(".mad-list li")].map((li) => li.textContent);
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row?.includes("Not read yet"))).toHaveLength(4);
    expect(rows[5]).toContain("Not available");
    act(() => button("Open Analytics")!.click());
    expect(handlers.onOpenAnalytics).toHaveBeenCalled();
  });

  it("Campaigns and Audiences say what will appear, and route to where the real work lives", async () => {
    await render("campaigns");
    expect(text()).toContain("No ad campaigns to show.");
    act(() => button("Open your campaign briefs")!.click());
    expect(handlers.onOpenCampaigns).toHaveBeenCalled();
    act(() => root.unmount()); root = createRoot(host);
    await render("audiences");
    act(() => button("Open Audience")!.click());
    expect(handlers.onOpenAudience).toHaveBeenCalled();
  });

  it("drops a stale answer when the workspace changes mid-read", async () => {
    let release: (value: Answer) => void = () => {};
    db.tables.marketing_content = new Promise<Answer>((resolve) => { release = resolve; });
    act(() => root.render(<MarketingAds tenantId="t-1" view="creative" {...handlers}/>));
    db.tables.marketing_content = { data: [{ ...AD, title: "Second workspace ad" }], error: null };
    await render("creative", "t-2");
    release({ data: [{ ...AD, title: "First workspace ad" }], error: null });
    await flush();
    expect(text()).toContain("Second workspace ad");
    expect(text()).not.toContain("First workspace ad");
  });
});

/* ───────── the showroom, the funnel, featuring, uploading (owner rulings 2026-10-11) ───────── */

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const PIPELINES = [
  { id: "p2", name: "Retainers", isDefault: false, lifecycleStatus: "active", dealCount: 1 },
  { id: "p1", name: "Discovery calls", isDefault: true, lifecycleStatus: "active", dealCount: 4 },
  { id: "p3", name: "Old", isDefault: false, lifecycleStatus: "archived", dealCount: 0 },
];
const stg = (id: string, pipelineId: string, orderIndex: number, label: string, stageType = "open") => ({ id, pipelineId, label, description: "", orderIndex, archivedAt: null, movePolicy: "direct", stageType, version: 1 });
const STAGES = [stg("s1", "p1", 1, "New lead"), stg("s2", "p1", 2, "Call booked"), stg("s4", "p1", 3, "Won", "won"), stg("s5", "p1", 4, "Lost", "lost"), stg("r1", "p2", 1, "Talking")];
const DEALS = [{ id: "d1", pipelineId: "p1", stageId: "s1" }, { id: "d2", pipelineId: "p1", stageId: "s1" }, { id: "d3", pipelineId: "p1", stageId: "s4" }, { id: "d4", pipelineId: "p1", stageId: "s5" }, { id: "d9", pipelineId: "p2", stageId: "r1" }];
const pic = (id: string, title: string, days: number, meta: Record<string, unknown> = {}, kind = "image") => ({ id, kind, title, image_url: `https://cdn.example/${id}.png`, updated_at: day(days), meta });
const MEDIA = [pic("m-new", "Newest pic", 0), pic("m-old", "Old pic", 20), pic("m-perf", "Performing pic", 10), pic("m-fav", "Featured pic", 30, { ads_featured: true, ads_featured_at: day(2) })];
const SERVER_FUNNEL = {
  pipeline: { id: "p1", name: "Discovery calls", is_default: true },
  stages: [{ id: "s1", name: "New lead", order_index: 1, stage_type: "open", deals: 12 }, { id: "s2", name: "Call booked", order_index: 2, stage_type: "open", deals: 5 }, { id: "s4", name: "Won", order_index: 3, stage_type: "won", deals: 3 }, { id: "s5", name: "Lost", order_index: 4, stage_type: "lost", deals: 2 }],
  stages_window: "current",
  leads: { total: 9, tagged: 7, untagged: 2, unfiled: 0 },
  campaigns: [{ campaign: "CB-SPRING", leads: 6, open: 3, won: 2, lost: 1, by_stage: { s1: 3, s4: 2, s5: 1 } }],
  // Contract v2: one row per ad, with the library picture the server matched (any letter case).
  ads: [{ ad: "m-old", campaign: "CB-SPRING", content_id: "m-old", kind: "image", image_url: "https://cdn.example/m-old.png", leads: 1, open: 1, won: 0, lost: 0 }, { ad: "M-PERF", campaign: "CB-SPRING", content_id: "m-perf", kind: "image", image_url: "https://cdn.example/m-perf.png", leads: 5, open: 2, won: 2, lost: 1 }],
  since: null,
};
const withSales = () => { sales.pipelineWorkspace.pipelines = PIPELINES; sales.pipelineWorkspace.stages = STAGES; sales.pipelineWorkspace.deals = DEALS; };
const settle = async () => { await flush(); await flush(); await flush(); };
const frames = () => Object.fromEntries([...host.querySelectorAll(".asr-frame")].map((f) => [f.className.match(/asr-(feed|story|search|display)/)?.[1], { label: f.getAttribute("aria-label"), chip: f.querySelector(".asr-sample")?.textContent }]));

describe("Ads › Overview showroom: the business's own pictures", () => {
  it("fills the placements featured first, then by won deals and leads on the default pipeline, then newest; samples only fill empty slots", async () => {
    withSales();
    db.tables.media = { data: MEDIA, error: null };
    db.rpc.get_pipeline_lead_funnel = () => ({ data: SERVER_FUNNEL, error: null });
    await render();
    await settle();
    expect(frames()).toEqual({
      feed: { label: "Feed post with your picture “Featured pic”", chip: "Featured" },
      story: { label: "Story with your picture “Performing pic”", chip: "2 won · 5 leads" },
      search: { label: "Search ad, sample", chip: "Sample" },
      display: { label: "Display banner with your picture “Old pic”", chip: "1 lead" },
    });
    // It says what ranks them, naming the pipeline the counts come from.
    expect(host.querySelector(".asr-intro p")?.textContent).toBe("Your own pictures stand in the placements: the ones you feature first, then the ones whose tracking tag brought the most won deals and leads on Discovery calls in the last 90 days, then your newest.");
    // The default pipeline is read first, even though Sales lists it second; Ads reads only the pipelines.
    expect(db.rpcCalls[0][0]).toBe("get_pipeline_lead_funnel");
    expect(db.rpcCalls[0][1].p_pipeline_id).toBe("p1");
    expect(String(db.rpcCalls[0][1].p_since)).toMatch(/T00:00:00\.000Z$/);
    expect(salesScopes.every((scope) => scope === "pipeline")).toBe(true);
    expect(db.calls.find((c) => c.filters.some(([column]) => column === "in kind"))?.filters).toEqual([["tenant_id", "t-1"], ["in kind", ["image", "video"]], ["not status", "archived"]]);
  });

  it("with fewer pictures than placements, the newest fills one and samples hold the rest", async () => {
    db.tables.media = { data: [pic("m-only", "Only pic", 3)], error: null };
    await render();
    await settle();
    expect(frames()).toMatchObject({ feed: { chip: "Newest" }, story: { chip: "Sample" }, display: { chip: "Sample" } });
    expect(host.querySelector(".asr-intro p")?.textContent).toContain("Samples fill what is left.");
  });

  it("a member sees samples only, and no upload or feature controls", async () => {
    briefs.canManage = false;
    withSales();
    await render();
    await settle();
    expect(Object.values(frames()).map((f) => f.chip)).toEqual(["Sample", "Sample", "Sample", "Sample"]);
    expect(host.querySelector(".asr-intro p")?.textContent).toContain("visible to its owners and admins");
    expect(button("Add a picture or video")).toBeUndefined();
    expect(host.querySelector("[data-ads-upload]")).toBeNull();
    expect(db.calls.some((c) => c.table === "marketing_content")).toBe(false);
    act(() => root.unmount()); root = createRoot(host);
    await render("creative");
    expect(text()).not.toContain("Feature in showroom");
    expect(text()).not.toContain("Copy tagged link");
  });
});

describe("Ads › Overview: the pipeline lead funnel", () => {
  it("draws deals by stage and the campaign and ad tables from the server count, naming the ad by its picture", async () => {
    withSales();
    db.tables.media = { data: MEDIA, error: null };
    db.rpc.get_pipeline_lead_funnel = () => ({ data: SERVER_FUNNEL, error: null });
    await render();
    await settle();
    const panel = host.querySelector(".plf")!;
    expect(panel.getAttribute("data-funnel-source")).toBe("server");
    expect([...panel.querySelectorAll(".plf-stage")].map((li) => li.textContent)).toEqual(["New lead12", "Call booked5", "WonWon3", "LostLost2"]);
    expect(panel.querySelector(".plf-sum")?.textContent).toBe("22 deals on this pipeline now. 9 leads in the last 90 days reached it, and 7 carried a campaign or ad tag.");
    const rows = (caption: string) => [...[...panel.querySelectorAll(".plf-table")].find((t) => t.querySelector("h3")?.textContent === caption)!.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows("By campaign")).toEqual([["CB-SPRING3 in New lead · 2 in Won · 1 in Lost", "6", "3", "2", "1"]]);
    expect(rows("By ad")).toEqual([["Performing picCampaign CB-SPRING", "5", "2", "2", "1"], ["Old picCampaign CB-SPRING", "1", "1", "0", "0"]]);
    expect(panel.querySelector(".plf-note")).toBeNull();
  });

  it("falls back to the records it can read when the server count isn't there yet, and says so", async () => {
    withSales();
    delete db.rpc.get_pipeline_lead_funnel; // not deployed: PGRST202
    db.tables.media = { data: MEDIA, error: null };
    db.tables.growth_form_submissions = { data: [
      { created_at: day(1), deal_id: "d1", utm_json: { utm_campaign: "CB-SPRING", utm_content: "m-new" } },
      { created_at: day(2), deal_id: "d3", utm_json: { utm_campaign: "CB-SPRING", utm_content: "m-new" } },
      { created_at: day(3), deal_id: "d4", utm_json: { utm_content: "m-old" } },
      { created_at: day(4), deal_id: "d9", utm_json: { utm_content: "m-old" } }, // on another pipeline
      { created_at: day(5), deal_id: null, utm_json: {} },
    ], error: null };
    await render();
    await settle();
    const panel = host.querySelector(".plf")!;
    expect(panel.getAttribute("data-funnel-source")).toBe("records");
    expect([...panel.querySelectorAll(".plf-stage-n")].map((b) => b.textContent)).toEqual(["2", "0", "1", "1"]);
    expect(panel.querySelector(".plf-note")?.textContent).toBe("The server count isn’t available yet, so these figures are counted from the leads read here. Deals by stage count every deal in the pipeline.");
    // The records the fallback read are the window's submissions.
    expect(db.calls.find((c) => c.table === "growth_form_submissions")?.filters.map(([column]) => column)).toEqual(["tenant_id", "from created_at"]);
    // The showroom ranks by those same counts: the picture with the won deal follows the featured one.
    expect(frames().story).toMatchObject({ label: "Story with your picture “Newest pic”", chip: "1 won · 2 leads" });
    // Once the server says the function isn't there, switching pipeline doesn't ask again.
    const asked = db.rpcCalls.length;
    act(() => (host.querySelector(".plf-picker-btn") as HTMLButtonElement).click());
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.startsWith("Retainers")) as HTMLElement;
    act(() => option.click());
    await settle();
    expect(db.rpcCalls.length).toBe(asked);
    expect(host.querySelector(".plf-head p")?.textContent).toContain("Retainers");
  });

  it("lists pipelines default first and reads the one chosen; the period changes the window", async () => {
    withSales();
    db.rpc.get_pipeline_lead_funnel = (args) => ({ data: { ...SERVER_FUNNEL, pipeline: { id: args.p_pipeline_id, name: args.p_pipeline_id === "p2" ? "Retainers" : "Discovery calls", is_default: args.p_pipeline_id === "p1" } }, error: null });
    await render();
    await settle();
    act(() => (host.querySelector(".plf-picker-btn") as HTMLButtonElement).click());
    expect([...document.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(["Discovery callsDefault4 deals", "Retainers1 deal"]);
    act(() => ([...document.querySelectorAll('[role="option"]')][1] as HTMLElement).click());
    await settle();
    expect(db.rpcCalls.at(-1)![1].p_pipeline_id).toBe("p2");
    act(() => [...host.querySelectorAll(".plf-acts button")].find((b) => b.textContent === "All time")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    expect(db.rpcCalls.at(-1)![1]).toEqual({ p_pipeline_id: "p2", p_since: null });
  });

  it("with no pipeline yet, says where leads will land instead of drawing an empty chart", async () => {
    await render();
    await settle();
    expect(host.querySelector(".plf-empty h3")?.textContent).toBe("No Sales pipeline yet");
    // The only read is the one-shot question whether the ads-intake functions are deployed: they are,
    // so the page may say a form's lead starts in the pipeline's first stage.
    expect(db.rpcCalls).toEqual([["get_pipeline_lead_funnel", { p_pipeline_id: null, p_since: null }]]);
    expect(host.querySelector(".plf-empty p")?.textContent).toBe("Once Sales has a pipeline, your forms’ leads start in its first stage, and every lead and where it stands shows here.");
  });

  it("with the ads-intake functions not deployed, never claims a lead lands in the default pipeline", async () => {
    delete db.rpc.get_pipeline_lead_funnel; // answers PGRST202
    await render();
    await settle();
    expect(host.querySelector(".plf-empty p")?.textContent).toBe("Once Sales has a pipeline and your forms send leads to it, every lead and where it stands shows here.");
    expect(text()).not.toMatch(/start in its first stage|default pipeline/);
  });

  it("a member gets a short note that campaign results are for owners and admins: no zeros, and nothing read", async () => {
    briefs.canManage = false;
    withSales();
    await render();
    await settle();
    const panel = host.querySelector(".plf")!;
    expect(panel.getAttribute("data-funnel-source")).toBe("restricted");
    expect(panel.querySelector(".plf-empty h3")?.textContent).toBe("Campaign results are for owners and admins");
    expect(panel.querySelectorAll(".plf-stage, table, .plf-picker-btn").length).toBe(0);
    expect(panel.textContent).not.toMatch(/\b0 (deals|leads)\b/);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.calls.some((c) => c.table === "growth_form_submissions")).toBe(false);
    // The showroom still stands, in samples.
    expect(Object.values(frames()).map((f) => f.chip)).toEqual(["Sample", "Sample", "Sample", "Sample"]);
  });

  it("says the stages are deals now, and names the leads that reached no pipeline with a way to their routing", async () => {
    withSales();
    db.rpc.get_pipeline_lead_funnel = () => ({ data: { ...SERVER_FUNNEL, leads: { ...SERVER_FUNNEL.leads, unfiled: 3 } }, error: null });
    await render();
    await settle();
    const panel = host.querySelector(".plf")!;
    expect(panel.querySelector(".plf-sub")?.textContent).toBe("Deals in each stage now");
    expect(panel.querySelector(".plf-stages")?.getAttribute("aria-label")).toBe("Deals in each stage of Discovery calls now");
    expect(panel.querySelector(".plf-unfiled span")?.textContent).toBe("3 leads in the last 90 days didn’t reach a pipeline, counting any still being filed.");
    act(() => ([...panel.querySelectorAll(".plf-unfiled button")].find((b) => b.textContent === "See where your forms send leads") as HTMLButtonElement).click());
    expect(handlers.onOpenFormRouting).toHaveBeenCalled();
    expect(panel.querySelector(".plf-def")?.textContent).toContain("Stages show every deal on the pipeline now.");
  });

  it("while another window loads, keeps the figures and the showroom's ranking, marked as updating", async () => {
    withSales();
    db.tables.media = { data: MEDIA, error: null };
    db.rpc.get_pipeline_lead_funnel = () => ({ data: SERVER_FUNNEL, error: null });
    await render();
    await settle();
    const before = frames();
    let release: (value: Answer) => void = () => {};
    db.rpc.get_pipeline_lead_funnel = () => new Promise<Answer>((resolve) => { release = resolve; });
    act(() => [...host.querySelectorAll(".plf-acts button")].find((b) => b.textContent === "All time")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await settle();
    const panel = host.querySelector(".plf")!;
    expect(panel.classList.contains("is-stale")).toBe(true);
    expect(panel.querySelector(".plf-updating")?.textContent).toBe("Updating…");
    expect([...panel.querySelectorAll(".plf-stage-n")].map((b) => b.textContent)).toEqual(["12", "5", "3", "2"]);
    expect(frames()).toEqual(before);
    expect(host.querySelector(".asr-intro p")?.textContent).toContain("(updating…)");
    // The new answer ranks a different picture first among the performing ones.
    release({ data: { ...SERVER_FUNNEL, ads: [{ ad: "m-new", campaign: null, content_id: "m-new", kind: "image", image_url: null, leads: 8, open: 4, won: 4, lost: 0 }] }, error: null });
    await settle();
    expect(panel.classList.contains("is-stale")).toBe(false);
    expect(panel.querySelector(".plf-updating")).toBeNull();
    expect(frames().story).toMatchObject({ label: "Story with your picture “Newest pic”", chip: "4 won · 8 leads" });
  });

  it("from a capped records read, every showroom figure is a floor, as the tables are", async () => {
    withSales();
    delete db.rpc.get_pipeline_lead_funnel;
    db.tables.media = { data: MEDIA, error: null };
    db.tables.growth_form_submissions = { data: Array.from({ length: 200 }, (_, i) => ({ created_at: day(1), deal_id: i === 0 ? "d3" : "d1", utm_json: { utm_content: "m-perf" } })), error: null };
    await render();
    await settle();
    expect(frames().story).toMatchObject({ label: "Story with your picture “Performing pic”", chip: "1+ won · 200+ leads" });
    expect(host.querySelector(".plf-note")?.textContent).toContain("each lead count is a floor");
  });

  it("draws one row per ad, keyed by the ad, when it ran under two campaigns", async () => {
    withSales();
    db.tables.media = { data: MEDIA, error: null };
    const spy = vi.spyOn(console, "error");
    db.rpc.get_pipeline_lead_funnel = () => ({ data: { ...SERVER_FUNNEL, ads: [{ ad: "M-PERF", campaign: "CB-SPRING", content_id: "m-perf", kind: "image", image_url: null, leads: 5, open: 2, won: 2, lost: 1 }, { ad: "m-perf", campaign: "CB-FALL", content_id: "m-perf", kind: "image", image_url: null, leads: 2, open: 1, won: 1, lost: 0 }] }, error: null });
    await render();
    await settle();
    const rows = [...host.querySelectorAll(".plf-table.is-ad tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent));
    expect(rows).toEqual([["Performing picCampaign CB-SPRING", "7", "3", "3", "1"]]);
    expect(spy.mock.calls.some((call) => /same key/.test(String(call[0])))).toBe(false);
    spy.mockRestore();
  });
});

describe("Ads › Creative: feature in showroom and the tracking tag", () => {
  it("features a picture at once and keeps it when the server agrees", async () => {
    db.tables.media = { data: MEDIA, error: null };
    let answer: (value: Answer) => void = () => {};
    db.rpc.set_ad_creative_featured = () => new Promise<Answer>((resolve) => { answer = resolve; });
    await render("creative");
    await settle();
    expect(host.querySelector("#mad-media-h + p")?.textContent).toContain("1 of 6 featured in the showroom.");
    const card = host.querySelector('[data-media-id="m-new"]')!;
    const toggle = [...card.querySelectorAll("button")].find((b) => b.textContent === "Feature in showroom")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(db.rpcCalls.at(-1)).toEqual(["set_ad_creative_featured", { p_content_id: "m-new", p_featured: true }]);
    answer({ data: { id: "m-new", featured: true }, error: null });
    await settle();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain("“Newest pic” is featured in the showroom.");
    expect(host.querySelector("#mad-media-h + p")?.textContent).toContain("2 of 6 featured");
  });

  it("takes the feature back off when the save fails, naming the limit, an archived picture, or the missing seam", async () => {
    db.tables.media = { data: MEDIA, error: null };
    db.rpc.set_ad_creative_featured = () => ({ data: null, error: { code: "22023", message: "AD_FEATURED_LIMIT" } });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await render("creative");
    await settle();
    const toggle = () => [...host.querySelector('[data-media-id="m-old"]')!.querySelectorAll("button")].find((b) => b.hasAttribute("aria-pressed"));
    act(() => toggle()!.click());
    await settle();
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");
    expect(text()).toContain("You can feature up to 6 pictures and videos.");
    db.rpc.set_ad_creative_featured = () => ({ data: null, error: { code: "22023", message: "AD_CREATIVE_ARCHIVED" } });
    act(() => toggle()!.click());
    await settle();
    expect(text()).toContain("That picture is archived, so it can’t stand in the showroom. Nothing was changed.");
    // Unfeaturing a featured one that fails puts it back as featured.
    db.rpc.set_ad_creative_featured = () => ({ data: null, error: { code: "XX000", message: "boom" } });
    const fav = () => [...host.querySelector('[data-media-id="m-fav"]')!.querySelectorAll("button")].find((b) => b.hasAttribute("aria-pressed"));
    act(() => fav()!.click());
    await settle();
    expect(fav()!.getAttribute("aria-pressed")).toBe("true");
    // The server says the function isn't there: the change is taken back, and the control is withdrawn
    // rather than left to fail again.
    delete db.rpc.set_ad_creative_featured;
    act(() => toggle()!.click());
    await settle();
    expect(text()).toContain("Featuring isn’t available yet. Nothing was changed.");
    expect(toggle()).toBeUndefined();
    expect(text()).not.toContain("Feature in showroom");
    quiet.mockRestore();
  });

  it("asks once whether featuring is deployed: when it isn't, nothing that can never succeed is offered", async () => {
    db.tables.media = { data: MEDIA, error: null };
    delete db.rpc.get_pipeline_lead_funnel; // the ads-intake functions answer PGRST202
    await render("creative");
    await settle();
    expect(db.rpcCalls).toEqual([["get_pipeline_lead_funnel", { p_pipeline_id: null, p_since: null }]]);
    expect(host.querySelectorAll("[aria-pressed]").length).toBe(0);
    expect(text()).not.toMatch(/Feature in showroom|featured in the showroom/);
    expect(host.querySelector(".mad-mflag")).toBeNull();
    // Tagging still works: it needs nothing new on the server.
    expect(host.querySelectorAll(".mad-mcard .btn-p").length).toBe(MEDIA.length);
    // And with them deployed, featuring is offered.
    act(() => root.unmount()); root = createRoot(host);
    resetAdsIntakeCapability();
    db.rpc.get_pipeline_lead_funnel = FORBIDDEN;
    await render("creative");
    await settle();
    expect([...host.querySelectorAll(".mad-mcard button[aria-pressed]")]).toHaveLength(MEDIA.length);
  });

  it("at six featured, the rest can't be featured until one comes out", async () => {
    db.tables.media = { data: [...Array.from({ length: 6 }, (_, i) => pic(`f${i}`, `Fav ${i}`, i, { ads_featured: true, ads_featured_at: day(i) })), pic("m-x", "Extra", 1)], error: null };
    await render("creative");
    await settle();
    expect(host.querySelector("#mad-media-h + p")?.textContent).toContain("6 of 6 featured");
    const extra = [...host.querySelector('[data-media-id="m-x"]')!.querySelectorAll("button")].find((b) => b.hasAttribute("aria-pressed"))!;
    expect(extra.disabled).toBe(true);
    expect(extra.title).toContain("up to 6");
  });

  it("copies the tag only, as the secondary choice, and says how a lead gets credited", async () => {
    db.tables.media = { data: MEDIA, error: null };
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await render("creative");
    await settle();
    // The live region is in the page before anything is copied, so the first outcome is announced.
    const live = host.querySelectorAll(".mad-media > .mad-notice[role=status]");
    expect(live).toHaveLength(2);
    expect([...live].every((node) => node.textContent === "")).toBe(true);
    act(() => [...host.querySelector('[data-media-id="m-perf"]')!.querySelectorAll("button")].find((b) => b.textContent === "Copy tag only")!.click());
    await settle();
    expect(writeText).toHaveBeenCalledWith("utm_content=m-perf");
    expect(text()).toContain("Copied utm_content=m-perf. Add it to the link this ad points at; leads that arrive on it are credited to “Performing pic”.");
    expect(host.querySelectorAll(".mad-media > .mad-notice[role=status]")[1]).toBe(live[1]);
  });

  it("copies a full tagged link to one of the business's live pages or forms, with an optional campaign tag", async () => {
    db.tables.media = { data: MEDIA, error: null };
    sales.artifacts = [
      { id: "pg1", type: "page", name: "Spring workshop", publicHref: "/p/harbor/spring?ref=home#book" },
      { id: "fm1", type: "form", name: "Discovery call form", publicHref: "/form/fm1" },
      { id: "pg2", type: "page", name: "No address yet", publicHref: "" },
    ];
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await render("creative");
    await settle();
    const card = host.querySelector('[data-media-id="m-perf"]')!;
    const open = [...card.querySelectorAll("button")].find((b) => b.textContent === "Copy tagged link")!;
    expect(open.className).toContain("btn-p");
    act(() => open.click());
    await settle();
    expect(open.getAttribute("aria-expanded")).toBe("true");
    const panel = host.querySelector(".mad-linker")!;
    expect(open.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.querySelector("h3")?.textContent).toBe("Tagged link for “Performing pic”");
    // Only live work with an address is offered; the first is chosen, and focus is on it.
    const radios = [...panel.querySelectorAll("[role=radio]")] as HTMLButtonElement[];
    expect(radios.map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([["PageSpring workshop", "true"], ["FormDiscovery call form", "false"]]);
    expect(document.activeElement).toBe(radios[0]);
    const origin = window.location.origin;
    expect(panel.querySelector("[data-tagged-link]")?.textContent).toBe(`${origin}/p/harbor/spring?ref=home&utm_content=m-perf#book`);
    // Arrow keys move the choice, as a radio group does.
    act(() => radios[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    const input = panel.querySelector("input") as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Spring Promo"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(panel.querySelector("[data-tagged-link]")?.textContent).toBe(`${origin}/form/fm1?utm_content=m-perf&utm_campaign=Spring+Promo`);
    act(() => [...panel.querySelectorAll("button")].find((b) => b.textContent === "Copy link")!.click());
    await settle();
    expect(writeText).toHaveBeenCalledWith(`${origin}/form/fm1?utm_content=m-perf&utm_campaign=Spring+Promo`);
    expect(text()).toContain("Copied the link to Discovery call form tagged for “Performing pic”.");
    expect(host.querySelector(".mad-linker")).toBeNull();
    expect(document.activeElement).toBe(open);
    // The list of live work is the Marketing read, asked for only while choosing.
    expect(salesScopes).toContain(undefined);
  });

  it("with nothing live, says so and points to the tag only; Escape closes", async () => {
    db.tables.media = { data: MEDIA, error: null };
    await render("creative");
    await settle();
    act(() => [...host.querySelector('[data-media-id="m-new"]')!.querySelectorAll("button")].find((b) => b.textContent === "Copy tagged link")!.click());
    await settle();
    const panel = host.querySelector(".mad-linker")!;
    expect(panel.textContent).toContain("No page, funnel or form is live yet");
    act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector(".mad-linker")).toBeNull();
  });

  it("never hides the live regions with display:none", () => {
    const css = fs.readFileSync(path.join(import.meta.dirname, "marketing-ads.css"), "utf8");
    expect(css).not.toMatch(/\.mad-notice:empty\s*\{[^}]*display\s*:\s*none/);
  });
});

describe("Ads: Add a picture or video", () => {
  const choose = (file: File) => {
    const input = host.querySelector("[data-ads-upload]") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  };

  it("files the picture into the library through the one upload seam and shows it in the showroom", async () => {
    db.tables.media = { data: [], error: null };
    upload.mockImplementation(async () => { db.tables.media = { data: [pic("m-up", "Spring banner", 0)], error: null }; return { id: "lib-1", kind: "image", artifactId: "m-up", title: "Spring banner" }; });
    await render();
    await settle();
    expect(frames().feed.chip).toBe("Sample");
    const file = new File(["x"], "Spring banner.png", { type: "image/png" });
    choose(file);
    await settle();
    expect(upload).toHaveBeenCalledWith("t-1", file);
    expect(frames().feed).toEqual({ label: "Feed post with your picture “Spring banner”", chip: "Just added" });
    expect(host.querySelector(".asr-intro .mad-notice")?.textContent).toBe("“Spring banner” is in your library. Nothing was published. It stands in the first placement while you’re here; feature it to keep it there.Feature it");
  });

  it("puts a fresh upload in the first placement even when featured and performing pictures fill the stage", async () => {
    withSales();
    db.tables.media = { data: MEDIA, error: null };
    db.rpc.get_pipeline_lead_funnel = () => ({ data: SERVER_FUNNEL, error: null });
    upload.mockImplementation(async () => { db.tables.media = { data: [...MEDIA, pic("m-up", "Summer reel", 0)], error: null }; return { id: "lib-2", kind: "image", artifactId: "m-up", title: "Summer reel" }; });
    await render();
    await settle();
    choose(new File(["x"], "Summer reel.png", { type: "image/png" }));
    await settle();
    expect(Object.values(frames()).map((f) => f.chip)).toEqual(["Featured", "Just added", "Sample", "2 won · 5 leads"]);
  });

  it("says why an upload failed, and that nothing was saved", async () => {
    upload.mockRejectedValue({ code: "SAVE_FAILED", message: "That file is too large — the limit is 10MB for images." });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await render();
    await settle();
    choose(new File(["x"], "huge.png", { type: "image/png" }));
    await settle();
    expect(host.querySelector(".asr-intro .mad-notice")?.textContent).toBe("That file is too large — the limit is 10MB for images. Nothing was saved.");
    expect(button("Add a picture or video")?.disabled).toBe(false);
    quiet.mockRestore();
  });
});
