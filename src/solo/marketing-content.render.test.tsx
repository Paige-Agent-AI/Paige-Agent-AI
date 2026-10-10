// @vitest-environment jsdom
// Marketing › Content (INT-342 S1e): the saved library as a gallery of the work itself, and the preview
// each piece opens in. Network reads are stubbed at the Supabase client; the Studio's document renderer is
// stubbed to its title (its own tests cover the drawing); everything else is the real view, mounted inside
// the hub's own frame (.solo-campaigns > .campaigns-scroll) so the drawer's inert handling is real.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; error: unknown };
const db: { tables: Record<string, Answer>; single: Answer; calls: { table: string; filters: [string, unknown][]; single: boolean }[] } = { tables: {}, single: { data: null, error: null }, calls: [] };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call = { table, filters: [] as [string, unknown][], single: false };
    db.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit"]) chain[method] = () => chain;
    chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain; };
    chain.neq = (column: string, value: unknown) => { call.filters.push([`not ${column}`, value]); return chain; };
    chain.not = (column: string, op: string, value: unknown) => { call.filters.push([`not ${column} ${op}`, value]); return chain; };
    chain.maybeSingle = () => { call.single = true; return Promise.resolve(db.single); };
    // The answer is fixed when the query is built, so a test can hold one read while another lands.
    const answer = db.tables[table] ?? { data: [], error: null };
    chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(answer).then(resolve, reject);
    return chain;
  };
  return { supabase: { from, rpc: () => Promise.resolve({ data: null, error: null }) } };
});
const access = { phase: "ready", canManage: true };
vi.mock("./useSoloCampaignBriefs", () => ({ useSoloCampaignBriefs: () => access }));
vi.mock("@/components/admin/studio/DocumentPreview", () => ({ DocumentPreview: ({ document, toolbar }: { document: { title: string; blocks: unknown[] }; toolbar?: boolean }) => <div data-doc-preview data-toolbar={String(toolbar)}>{`${document.title} (${document.blocks.length} blocks)`}</div> }));

import { MarketingContent } from "./marketing-content";

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const summary = () => host.querySelector(".mov-sum")?.textContent ?? "";

const DOC_BODY = JSON.stringify({ docType: "sales_offer", title: "Spring offer", blocks: [
  { type: "cover", eyebrow: "A personal offer", title: "Your spring advisory plan", subhead: "Three months to a clear quarter" },
  { type: "section-header", title: "What you get" }, { type: "prose", markdown: "Weekly sessions." },
  { type: "section-header", title: "Investment" },
] });
const LONG_PROMPT = "A clean minimal hero illustration of a rising arrow over a city skyline at dawn, soft light, wide composition with room for a headline on the left side and the brand colours";
const ROWS = [
  { id: "c1", kind: "image", channel: null, status: "published", title: LONG_PROMPT, body: null, image_url: "https://cdn.example/paige-generated/hero.webp", size: "3:2", brief: null, updated_at: "2026-10-01T10:00:00Z" },
  { id: "c2", kind: "document", channel: null, status: "draft", title: "Spring offer", body: DOC_BODY, image_url: null, size: null, brief: "Offer for a new client", updated_at: "2026-09-30T10:00:00Z" },
  { id: "c3", kind: "text", channel: "social_post", status: "draft", title: "Launch post", body: "## Big news\n**We’re open** for spring.\n- Book a call", image_url: null, size: null, brief: null, updated_at: "2026-09-29T10:00:00Z" },
  { id: "c4", kind: "image", channel: null, status: "draft", title: "Testimonial card", body: null, image_url: "https://cdn.example/paige-generated/card.png", size: "square", brief: null, updated_at: "2026-09-28T10:00:00Z" },
  { id: "c5", kind: "text", channel: "ad_copy", status: "draft", title: "Planning session", body: "**Headline:** Plan your quarter\n**Primary text:** Book a free session.\n**CTA:** Book now", image_url: null, size: null, brief: null, updated_at: "2026-09-27T10:00:00Z" },
  { id: "c6", kind: "text", channel: "email_campaign", status: "draft", title: "Reminder", body: "Subject: Two days to go\n\nSee you Thursday.", image_url: null, size: null, brief: null, updated_at: "2026-09-26T10:00:00Z" },
];

type Props = Partial<React.ComponentProps<typeof MarketingContent>>;
const published = { phase: "ready", pages: 2, funnels: 0, forms: 1, unpublished: 4 };
// The hub's frame: the drawer marks .campaigns-scroll inert, so the view must portal its preview out of it.
const renderContent = async (props: Props = {}) => {
  act(() => root.render(<div className="solo-campaigns"><nav className="campaigns-nav"/><div className="campaigns-scroll"><MarketingContent tenantId="t-1" published={published} onOpenCapture={vi.fn()} onRetryPublished={vi.fn()} studioLauncher={<button>Open Vibe Studio</button>} kind="all" onKind={vi.fn()} piece={null} onPiece={vi.fn()} {...props}/></div></div>));
  await flush();
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  db.tables = {}; db.single = { data: null, error: null }; db.calls = [];
  access.phase = "ready"; access.canManage = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("Marketing › Content", () => {
  it("leads with the gallery and shows each piece as what it is", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    const onOpenCapture = vi.fn();
    await renderContent({ onOpenCapture });
    expect(db.calls.find((c) => c.table === "marketing_content")?.filters).toEqual([["tenant_id", "t-1"], ["not status", "archived"]]);
    expect(summary()).toBe("6 pieces in your library: 2 images, 1 document and 3 pieces of copy. 1 is in your Catalog. Nothing here posts or sends.");
    // The library comes before published work.
    const sections = [...host.querySelectorAll(".mct > section")].map((s) => s.querySelector("h2")?.textContent);
    expect(sections).toEqual(["Your library", "Published from Vibe Studio"]);
    const cards = [...host.querySelectorAll(".mct-card")];
    expect(cards).toHaveLength(6);
    expect(cards[0].querySelector("img")?.getAttribute("src")).toBe(ROWS[0].image_url);
    expect(cards[0].querySelector(".mct-kind")?.textContent).toBe("Image");
    expect(cards[0].querySelector("strong")?.textContent).toMatch(/…$/);
    expect(cards[0].querySelector("small")?.textContent).toMatch(/^In your Catalog · saved/);
    expect(cards[3].querySelector("small")?.textContent).toMatch(/^saved/);
    expect(cards[3].querySelector(".mct-frame")?.classList.contains("mct-whole")).toBe(true);
    expect(cards[1].querySelector(".mct-kind")?.textContent).toBe("Document · Sales offer");
    expect(cards[1].querySelector(".mct-cover")?.textContent).toBe("A personal offerYour spring advisory planThree months to a clear quarter2 sections");
    expect(cards[2].querySelector(".mct-words")?.textContent).toBe("Big newsWe’re open for spring.\nBook a call");
    expect(cards[4].querySelector(".mct-ad")?.textContent).toBe("Plan your quarterBook a free session.Book now");
    expect(cards[5].querySelector(".mct-words b")?.textContent).toBe("Two days to go");
    // The mix ring sits with the filter; published work is one row with its link.
    expect(host.querySelector(".mct-ring")?.getAttribute("aria-label")).toBe("Your library by kind: Images 2, Documents 1, Copy 3");
    expect([...host.querySelectorAll(".mct-pub dd")].map((d) => d.textContent)).toEqual(["2", "0", "1"]);
    expect(host.querySelector(".mct-pub-h p")?.textContent).toBe("4 more built and not published yet, so collecting nothing.");
    act(() => button("Published work")!.click());
    expect(onOpenCapture).toHaveBeenCalled();
    expect(host.querySelector(".btn-gold, .btn-p")).toBeNull();
  });

  it("filters by kind on the server, keeps the copy channels, and clears the filter from its own chip", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    const onKind = vi.fn();
    await renderContent({ onKind });
    expect([...host.querySelectorAll(".campaigns-segmented button")].map((b) => b.textContent)).toEqual(["All6", "Images2", "Documents1", "Copy3"]);
    act(() => button("Documents1")!.click());
    expect(onKind).toHaveBeenCalledWith("document");

    db.calls = [];
    db.tables.marketing_content = { data: [ROWS[1]], error: null };
    await renderContent({ kind: "document", onKind });
    expect(db.calls.filter((c) => c.table === "marketing_content").map((c) => c.filters)).toContainEqual([["tenant_id", "t-1"], ["not status", "archived"], ["kind", "document"]]);
    // Pressing the active chip again goes back to everything.
    act(() => [...host.querySelectorAll(".campaigns-segmented button")].find((b) => b.getAttribute("aria-pressed") === "true")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onKind).toHaveBeenLastCalledWith("all");

    db.calls = [];
    db.tables.marketing_content = { data: ROWS.filter((r) => r.kind === "text"), error: null };
    await renderContent({ kind: "copy" });
    expect(db.calls.filter((c) => c.table === "marketing_content").map((c) => c.filters)).toContainEqual([["tenant_id", "t-1"], ["not status", "archived"], ["not kind in", "(image,video,document)"]]);
    expect(host.querySelector(".mct-channels")?.textContent).toBe("1 ad copy · 1 email · 1 social post");
  });

  it("opens a preview outside the inert scroll region, with every control live", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    const onPiece = vi.fn();
    await renderContent({ onPiece });
    act(() => (host.querySelectorAll(".mct-card")[0] as HTMLButtonElement).click());
    expect(onPiece).toHaveBeenCalledWith("c1");

    await renderContent({ piece: "c1", onPiece });
    const panel = dialog()!;
    expect(host.querySelector(".campaigns-scroll")!.hasAttribute("inert")).toBe(true);
    expect(panel.closest("[inert]")).toBeNull();
    expect(panel.parentElement?.classList.contains("solo-campaigns")).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close details");
    expect(panel.querySelector(".mct-full img")?.getAttribute("src")).toBe(ROWS[0].image_url);
    expect(panel.querySelector(".mct-facts")?.textContent).toMatch(/^Image · Landscape · In your Catalog · saved/);
    expect(panel.querySelector(".mct-asked p")?.textContent).toBe(LONG_PROMPT);
  });

  it("downloads an image, says when a download fails, and hands PAIGE the exact piece to revise", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    const onPiece = vi.fn();
    await renderContent({ piece: "c1", onPiece });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) } as Response);
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:hero"), revokeObjectURL: vi.fn() });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    await act(async () => { button("Download", dialog()!)!.click(); });
    await flush();
    expect(fetchSpy).toHaveBeenCalledWith(ROWS[0].image_url);
    expect(clicked[0]).toMatch(/^a-clean-minimal-hero-illustration.*\.webp$/);
    expect(dialog()!.querySelector(".mct-act-note")?.textContent).toBe("Download started.");

    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy.mockResolvedValue({ ok: false, status: 403, blob: () => Promise.resolve(new Blob(["denied"])) } as Response);
    await act(async () => { button("Download", dialog()!)!.click(); });
    await flush();
    expect(dialog()!.querySelector(".mct-act-note")?.textContent).toBe("The download didn’t start. Use Open full size and save it from there.");

    const asked: string[] = [];
    window.addEventListener("paige:open", ((event: CustomEvent) => asked.push(event.detail.prompt)) as EventListener);
    act(() => button("Revise with PAIGE", dialog()!)!.click());
    expect(onPiece).toHaveBeenLastCalledWith(null);
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(asked.at(-1)).toMatch(/^Revise my saved image “A clean minimal hero.*” \(library piece c1\)\./);
    expect(asked.at(-1)).toContain("Save the new version as a draft; do not post, send or publish anything.");
  });

  it("never uses a stored address that isn't https or this site", async () => {
    db.tables.marketing_content = { data: [{ ...ROWS[0], id: "x1", image_url: "javascript:alert(1)" }], error: null };
    await renderContent({ piece: "x1" });
    expect(host.querySelector(".mct-card img")).toBeNull();
    expect(host.querySelector(".mct-missing")?.textContent).toBe("No file saved with this image");
    expect(dialog()!.querySelector("a")).toBeNull();
    expect(button("Download", dialog()!)).toBeUndefined();
  });

  it("prints a document from the actions row, lays out ad copy as an ad, and copies plain words", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    await renderContent({ piece: "c2" });
    await flush();
    expect(dialog()!.querySelector("[data-doc-preview]")?.textContent).toBe("Spring offer (4 blocks)");
    expect(dialog()!.querySelector("[data-doc-preview]")?.getAttribute("data-toolbar")).toBe("false");
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    act(() => button("Print / Save as PDF", dialog()!)!.click());
    expect(print).toHaveBeenCalled();
    expect(document.documentElement.classList.contains("paige-doc-printing")).toBe(true);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.documentElement.classList.contains("paige-doc-printing")).toBe(false);

    await renderContent({ piece: "c5" });
    expect(dialog()!.querySelector(".mct-adfull")?.textContent).toBe("Plan your quarterBook a free session.Book now");

    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    await renderContent({ piece: "c3" });
    expect(dialog()!.querySelector(".mct-copy")?.textContent).toBe("Big newsWe’re open for spring.\nBook a call");
    await act(async () => { button("Copy text", dialog()!)!.click(); });
    expect(write).toHaveBeenCalledWith("Big news\nWe’re open for spring.\nBook a call");
    expect(dialog()!.querySelector(".mct-act-note")?.textContent).toBe("Copied.");
  });

  it("plays a video and offers its file", async () => {
    db.tables.marketing_content = { data: [{ ...ROWS[0], id: "v1", kind: "video", title: "Promo", image_url: "https://cdn.example/paige-generated/promo.mp4", size: null }], error: null };
    await renderContent({ piece: "v1" });
    expect(host.querySelector(".mct-card video")?.getAttribute("src")).toBe("https://cdn.example/paige-generated/promo.mp4");
    expect(dialog()!.querySelector(".mct-full video")?.hasAttribute("controls")).toBe(true);
    expect(button("Download", dialog()!)).toBeDefined();
  });

  it("reads a linked piece on its own when the newest read doesn't hold it, and says when it is gone", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    db.single = { data: { ...ROWS[3], id: "old-1", title: "An older card" }, error: null };
    await renderContent({ piece: "old-1" });
    expect(db.calls.find((c) => c.single)?.filters).toEqual([["tenant_id", "t-1"], ["id", "old-1"], ["not status", "archived"]]);
    expect(dialog()!.textContent).toContain("An older card");
    db.single = { data: null, error: null };
    await renderContent({ piece: "gone-1" });
    expect(dialog()!.textContent).toContain("This piece isn’t in your library");
  });

  it("keeps a broken picture or unreadable document honest", async () => {
    db.tables.marketing_content = { data: [{ ...ROWS[0], id: "b1" }, { ...ROWS[1], id: "b2", body: "{not json" }], error: null };
    await renderContent();
    act(() => { host.querySelector(".mct-card img")!.dispatchEvent(new Event("error")); });
    expect([...host.querySelectorAll(".mct-missing")].map((el) => el.textContent)).toEqual(["This image couldn’t load", "This document couldn’t be read"]);
    expect(host.querySelectorAll(".mct-card .mct-kind")[1]?.textContent).toBe("Document");
  });

  it("says each state once: a failed read with one retry, and an empty library with starters", async () => {
    db.tables.marketing_content = { data: null, error: { message: "boom" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderContent();
    expect(summary()).toBe("Your library could not load.");
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent === "Try again")).toHaveLength(1);
    expect(host.querySelector(".mct-ring")).toBeNull();
    db.tables.marketing_content = { data: [], error: null };
    act(() => button("Try again")!.click());
    await flush();
    expect(summary()).toBe("Your library is empty. Everything PAIGE makes for you is kept here.");
    expect([...host.querySelectorAll(".mct-starters button")].map((b) => b.textContent)).toEqual(["A launch image", "A one-page offer", "A welcome email", "Something else"]);
    expect(button("Ask PAIGE for content")).toBeUndefined();
    expect(host.querySelector(".campaigns-segmented")).toBeNull();
  });

  it("never says everything is published when nothing was built", async () => {
    db.tables.marketing_content = { data: [], error: null };
    await renderContent({ published: { phase: "ready", pages: 0, funnels: 0, forms: 0, unpublished: 0 } });
    expect(host.querySelector(".mct-pub-h p")?.textContent).toBe("Nothing built in Vibe Studio yet.");
    await renderContent({ published: { phase: "ready", pages: 1, funnels: 0, forms: 0, unpublished: 0 } });
    expect(host.querySelector(".mct-pub-h p")?.textContent).toBe("Everything you built is published.");
  });

  it("never shows a zero for published work it has not read", async () => {
    db.tables.marketing_content = { data: [], error: null };
    await renderContent({ published: { phase: "loading", pages: 0, funnels: 0, forms: 0, unpublished: 0 } });
    expect([...host.querySelectorAll(".mct-pub dd")].map((d) => d.textContent)).toEqual(["…", "…", "…"]);
    const onRetryPublished = vi.fn();
    await renderContent({ published: { phase: "error", pages: 0, funnels: 0, forms: 0, unpublished: 0 }, onRetryPublished });
    expect([...host.querySelectorAll(".mct-pub dd")].map((d) => d.textContent)).toEqual(["—", "—", "—"]);
    act(() => button("Try again", host.querySelector(".mct-pubrow")!)!.click());
    expect(onRetryPublished).toHaveBeenCalled();
  });

  it("marks a full library read as the newest pieces, never a total", async () => {
    db.tables.marketing_content = { data: Array.from({ length: 60 }, (_, n) => ({ ...ROWS[3], id: `c${n}`, title: `Piece ${n}`, status: n < 2 ? "published" : "draft" })), error: null };
    await renderContent();
    expect(summary()).toBe("60+ pieces in your library: images, the newest 60 shown. 2 of the newest 60 are in your Catalog. Nothing here posts or sends.");
    expect([...host.querySelectorAll(".campaigns-segmented button")].map((b) => b.textContent)).toEqual(["All", "Images"]);
    expect(host.textContent).toContain("The newest 60 are shown.");
  });

  it("tells a member once that the library is for owners and admins, and never reads it", async () => {
    access.canManage = false;
    await renderContent({ piece: "c1" });
    expect(db.calls.some((c) => c.table === "marketing_content")).toBe(false);
    expect(summary()).toBe("Your workspace's saved library is visible to its owners and admins.");
    expect(host.textContent!.match(/visible to its owners and admins/g)).toHaveLength(1);
    expect(host.querySelector(".mct-lib")).toBeNull();
    expect(button("Ask PAIGE for content")).toBeUndefined();
    expect(dialog()).toBeNull();
    expect([...host.querySelectorAll(".mct-pub dd")].map((d) => d.textContent)).toEqual(["2", "0", "1"]);
  });

  it("drops an answer for a workspace the page has left", async () => {
    let release: (value: Answer) => void = () => {};
    db.tables.marketing_content = new Promise<Answer>((resolve) => { release = resolve; }) as unknown as Answer;
    await renderContent({ tenantId: "t-1" });
    db.tables.marketing_content = { data: [ROWS[3]], error: null };
    await renderContent({ tenantId: "t-2" });
    await act(async () => { release({ data: ROWS, error: null }); });
    await flush();
    expect(host.querySelectorAll(".mct-card")).toHaveLength(1);
  });
});
