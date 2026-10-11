// @vitest-environment jsdom
// The Ads desk (INT-342 S1c; its own department since 2026-10-10): the paid-acquisition desk before any ad platform can be read. Saved ad
// copy and briefs are real; every provider figure is named as not available. Network reads are stubbed at
// the Supabase client and the briefs adapter; everything else is the real view.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; error: unknown };
const db: { tables: Record<string, Answer | Promise<Answer>>; calls: { table: string; filters: [string, unknown][] }[] } = { tables: {}, calls: [] };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call = { table, filters: [] as [string, unknown][] };
    db.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit"]) chain[method] = () => chain;
    chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain; };
    chain.neq = (column: string, value: unknown) => { call.filters.push([`not ${column}`, value]); return chain; };
    const answer = db.tables[table] ?? { data: [], error: null };
    chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(answer).then(resolve, reject);
    return chain;
  };
  return { supabase: { from, rpc: () => Promise.resolve({ data: null, error: null }) } };
});
const briefs = { phase: "ready", canManage: true, briefs: [] as Array<Record<string, unknown>> };
vi.mock("./useSoloCampaignBriefs", () => ({ useSoloCampaignBriefs: () => briefs }));

import { MarketingAds, parseAdCopy, type AdsView } from "./marketing-ads";

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); }); };
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const handlers = { onView: vi.fn(), onOpenIntegrations: vi.fn(), onOpenAudience: vi.fn(), onOpenAnalytics: vi.fn(), onOpenCampaigns: vi.fn() };
const render = async (view: AdsView = "overview", tenantId = "t-1") => { act(() => root.render(<MarketingAds tenantId={tenantId} view={view} {...handlers}/>)); await flush(); };
const AD = { id: "a1", title: "Spring planning session", status: "draft", updated_at: "2026-10-01T10:00:00Z", body: "**Headline:** Plan your quarter in 30 minutes\n**Primary text:** Book a strategy session and leave with a plan.\n**CTA:** Book a session" };

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  db.tables = {}; db.calls = [];
  briefs.phase = "ready"; briefs.canManage = true; briefs.briefs = [];
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
    // Asking PAIGE stays open to everyone, as on the earlier Ads tab (§58).
    expect(button("Ask PAIGE for ad copy")).toBeDefined();
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
