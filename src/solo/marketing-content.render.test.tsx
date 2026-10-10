// @vitest-environment jsdom
// Marketing › Content (INT-342 S1e): the saved library as a gallery of the work itself, and the preview
// each piece opens in. Network reads are stubbed at the Supabase client; the Studio's document renderer is
// stubbed to its title (its own tests cover the drawing); everything else is the real view.
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
vi.mock("./marketing-overview-charts", () => ({ Donut: ({ label }: { label: string }) => <div data-donut={label}/> }));
vi.mock("@/components/admin/studio/DocumentPreview", () => ({ DocumentPreview: ({ document }: { document: { title: string; blocks: unknown[] } }) => <div data-doc-preview>{`${document.title} (${document.blocks.length} blocks)`}</div> }));

import { MarketingContent } from "./marketing-content";

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }); };
const render = async (node: React.ReactNode) => { act(() => root.render(node)); await flush(); };
const text = () => document.body.textContent ?? "";
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;

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
];

type Props = Partial<React.ComponentProps<typeof MarketingContent>>;
const published = { phase: "ready", pages: 2, funnels: 0, forms: 1, unpublished: 4 };
const renderContent = (props: Props = {}) => render(<MarketingContent tenantId="t-1" published={published} onOpenCapture={vi.fn()} onRetryPublished={vi.fn()} studioLauncher={<button>Open Vibe Studio</button>} kind="all" onKind={vi.fn()} piece={null} onPiece={vi.fn()} {...props}/>);

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
  it("shows each piece as what it is: an image its picture, a document its cover, copy its words", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    const onOpenCapture = vi.fn();
    await renderContent({ onOpenCapture });
    expect(db.calls.find((c) => c.table === "marketing_content")?.filters).toEqual([["tenant_id", "t-1"], ["not status", "archived"]]);
    expect(host.querySelector(".mov-sum")?.textContent).toBe("4 pieces in your library: 2 images, 1 document and 1 piece of copy. 1 published; the rest are drafts. Nothing here posts or sends.");
    const cards = [...host.querySelectorAll(".mct-card")];
    expect(cards).toHaveLength(4);
    expect(cards[0].querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/paige-generated/hero.webp");
    expect(cards[0].querySelector(".mct-kind")?.textContent).toBe("Image · Landscape");
    // A prompt used as a title is cut at a word for the card, never mid-word.
    expect(cards[0].querySelector("strong")?.textContent).toMatch(/…$/);
    expect(cards[0].querySelector("small")?.textContent).toMatch(/^Published · saved/);
    expect(cards[1].querySelector(".mct-kind")?.textContent).toBe("Document · Sales offer");
    expect(cards[1].querySelector(".mct-cover")?.textContent).toBe("A personal offerYour spring advisory planThree months to a clear quarterSales offer · 2 sections");
    expect(cards[2].querySelector(".mct-kind")?.textContent).toBe("Social post");
    expect(cards[2].querySelector(".mct-words")?.textContent).toBe("Big news\nWe’re open for spring.\nBook a call");
    // The mix ring and its keys; published work from Vibe Studio.
    expect(host.querySelector("[data-donut]")).not.toBeNull();
    expect([...host.querySelectorAll(".mo-keys button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Images: 2, 50%. Show only these", "Documents: 1, 25%. Show only these", "Copy: 1, 25%. Show only these"]);
    expect([...host.querySelectorAll(".mct-pub dd")].map((d) => d.textContent)).toEqual(["2", "0", "1"]);
    expect(text()).toContain("4 built in Vibe Studio and not published yet");
    act(() => button("Published work")!.click());
    expect(onOpenCapture).toHaveBeenCalled();
    // Nothing on the page is a gold act.
    expect(host.querySelector(".btn-gold, .btn-p")).toBeNull();
  });

  it("filters by kind on the server so the cap never hides one, and keeps the filter in the address", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    const onKind = vi.fn();
    await renderContent({ onKind });
    expect([...host.querySelectorAll(".campaigns-segmented button")].map((b) => b.textContent)).toEqual(["All4", "Images2", "Documents1", "Copy1"]);
    act(() => [...host.querySelectorAll(".campaigns-segmented button")][2].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onKind).toHaveBeenCalledWith("document");
    act(() => (host.querySelectorAll(".mo-keys button")[0] as HTMLButtonElement).click());
    expect(onKind).toHaveBeenLastCalledWith("image");

    db.calls = [];
    db.tables.marketing_content = { data: [ROWS[1]], error: null };
    await renderContent({ kind: "document" });
    expect(db.calls.filter((c) => c.table === "marketing_content").map((c) => c.filters)).toContainEqual([["tenant_id", "t-1"], ["not status", "archived"], ["kind", "document"]]);
    expect(host.querySelectorAll(".mct-card")).toHaveLength(1);

    db.calls = [];
    db.tables.marketing_content = { data: [], error: null };
    await renderContent({ kind: "copy" });
    expect(db.calls.filter((c) => c.table === "marketing_content").map((c) => c.filters)).toContainEqual([["tenant_id", "t-1"], ["not status", "archived"], ["not kind in", "(image,video,document)"]]);
  });

  it("opens an image full size with its request, a download, and a draft-first revise", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    const onPiece = vi.fn();
    await renderContent({ onPiece });
    act(() => (host.querySelectorAll(".mct-card")[0] as HTMLButtonElement).click());
    expect(onPiece).toHaveBeenCalledWith("c1");

    const asked: string[] = [];
    window.addEventListener("paige:open", ((event: CustomEvent) => asked.push(event.detail.prompt)) as EventListener);
    await renderContent({ piece: "c1", onPiece });
    const panel = dialog()!;
    expect(panel.querySelector(".mct-full img")?.getAttribute("src")).toBe(ROWS[0].image_url);
    expect(panel.querySelector(".mct-full img")?.getAttribute("alt")).toMatch(/^A clean minimal hero/);
    expect(panel.querySelector(".mct-facts")?.textContent).toMatch(/^Image · Landscape · Published · saved/);
    // The card's title was cut, so the full request is shown.
    expect(panel.querySelector(".mct-asked p")?.textContent).toBe(LONG_PROMPT);
    expect(panel.querySelector('a[href="https://cdn.example/paige-generated/hero.webp"]')?.textContent).toBe("Open full size");

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["x"], { type: "image/webp" })) } as Response);
    const urls = { create: vi.fn(() => "blob:hero"), revoke: vi.fn() };
    Object.assign(URL, { createObjectURL: urls.create, revokeObjectURL: urls.revoke });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    await act(async () => { button("Download", panel)!.click(); });
    await flush();
    expect(fetchSpy).toHaveBeenCalledWith(ROWS[0].image_url);
    expect(clicked[0]).toMatch(/^a-clean-minimal-hero-illustration.*\.webp$/);
    expect(panel.querySelector(".mct-act-note")?.textContent).toBe("Downloaded.");

    act(() => button("Revise with PAIGE", panel)!.click());
    expect(onPiece).toHaveBeenLastCalledWith(null);
    expect(asked.at(-1)).toMatch(/^Revise my saved image “A clean minimal hero/);
    expect(asked.at(-1)).toContain("Save the new version as a draft; do not post, send or publish anything.");
  });

  it("says so when a download fails instead of pretending", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 403, blob: () => Promise.resolve(new Blob(["denied"])) } as Response);
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await renderContent({ piece: "c4" });
    await act(async () => { button("Download", dialog()!)!.click(); });
    await flush();
    expect(dialog()!.querySelector(".mct-act-note")?.textContent).toBe("The download didn’t start. Use Open full size and save it from there.");
  });

  it("draws a document with the Studio's own renderer, and copy as words you can copy", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    await renderContent({ piece: "c2" });
    await flush();
    expect(dialog()!.querySelector("[data-doc-preview]")?.textContent).toBe("Spring offer (4 blocks)");
    expect(dialog()!.querySelector(".mct-facts")?.textContent).toMatch(/^Document · Sales offer · Draft · saved/);
    expect(button("Download", dialog()!)).toBeUndefined();

    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    await renderContent({ piece: "c3" });
    expect(dialog()!.querySelector(".mct-copy")?.textContent).toBe("Big news\nWe’re open for spring.\nBook a call");
    await act(async () => { button("Copy text", dialog()!)!.click(); });
    expect(write).toHaveBeenCalledWith("Big news\nWe’re open for spring.\nBook a call");
    expect(dialog()!.querySelector(".mct-act-note")?.textContent).toBe("Copied.");
  });

  it("reads a linked piece on its own when the newest read doesn't hold it, and says when it is gone", async () => {
    db.tables.marketing_content = { data: ROWS, error: null };
    db.single = { data: { ...ROWS[3], id: "old-1", title: "An older card" }, error: null };
    await renderContent({ piece: "old-1" });
    const single = db.calls.find((c) => c.single);
    expect(single?.filters).toEqual([["tenant_id", "t-1"], ["id", "old-1"], ["not status", "archived"]]);
    expect(dialog()!.textContent).toContain("An older card");

    db.single = { data: null, error: null };
    await renderContent({ piece: "gone-1" });
    expect(dialog()!.textContent).toContain("This piece isn’t in your library");
  });

  it("keeps a broken picture or unreadable document honest", async () => {
    db.tables.marketing_content = { data: [{ ...ROWS[0], id: "b1" }, { ...ROWS[1], id: "b2", body: "{not json" }], error: null };
    await renderContent();
    act(() => { host.querySelector(".mct-card img")!.dispatchEvent(new Event("error")); });
    expect(host.querySelectorAll(".mct-missing")[0]?.textContent).toBe("This image couldn’t load");
    expect(host.querySelectorAll(".mct-missing")[1]?.textContent).toBe("This document couldn’t be read");
    expect(host.querySelectorAll(".mct-card .mct-kind")[1]?.textContent).toBe("Document");
  });

  it("shows loading, a failed read with a retry, and an empty library with an ask", async () => {
    db.tables.marketing_content = { data: null, error: { message: "boom" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderContent();
    expect(host.querySelector(".mov-sum")?.textContent).toBe("Your library could not load.");
    db.tables.marketing_content = { data: [], error: null };
    act(() => button("Try again", host.querySelector(".mct-lib")!)!.click());
    await flush();
    expect(host.querySelector(".mov-sum")?.textContent).toContain("Your library is empty.");
    expect(button("Ask PAIGE for content", host.querySelector(".mct-lib")!)).toBeDefined();
    expect(host.querySelector(".campaigns-segmented")).toBeNull();
  });

  it("never shows a zero for published work it has not read", async () => {
    db.tables.marketing_content = { data: [], error: null };
    await renderContent({ published: { phase: "loading", pages: 0, funnels: 0, forms: 0, unpublished: 0 } });
    expect([...host.querySelectorAll(".mct-pub dd")].map((d) => d.textContent)).toEqual(["…", "…", "…"]);
    const onRetryPublished = vi.fn();
    await renderContent({ published: { phase: "error", pages: 0, funnels: 0, forms: 0, unpublished: 0 }, onRetryPublished });
    expect([...host.querySelectorAll(".mct-pub dd")].map((d) => d.textContent)).toEqual(["—", "—", "—"]);
    act(() => button("Try again", host.querySelector(".mct-two")!)!.click());
    expect(onRetryPublished).toHaveBeenCalled();
  });

  it("marks a full library read as the newest pieces, never a total", async () => {
    db.tables.marketing_content = { data: Array.from({ length: 60 }, (_, n) => ({ ...ROWS[3], id: `c${n}`, title: `Piece ${n}` })), error: null };
    await renderContent();
    expect(host.querySelector(".mov-sum")?.textContent).toContain("60+ pieces in your library: images, the newest 60 shown.");
    expect([...host.querySelectorAll(".campaigns-segmented button")].map((b) => b.textContent)).toEqual(["All", "Images"]);
    expect(text()).toContain("The newest 60 are shown.");
  });

  it("tells a member who cannot read the library so, and never reads it", async () => {
    access.canManage = false;
    await renderContent({ piece: "c1" });
    expect(db.calls.some((c) => c.table === "marketing_content")).toBe(false);
    expect(host.querySelector(".mov-sum")?.textContent).toBe("Your workspace's saved library is visible to its owners and admins.");
    expect(dialog()).toBeNull();
    expect([...host.querySelectorAll(".mct-pub dd")].map((d) => d.textContent)).toEqual(["2", "0", "1"]);
  });

  it("drops an answer for a workspace the page has left", async () => {
    let release: (value: Answer) => void = () => {};
    db.tables.marketing_content = { data: ROWS, error: null };
    // Hold the first workspace's read, switch, then let the stale one land.
    const held = new Promise<Answer>((resolve) => { release = resolve; });
    db.tables.marketing_content = held as unknown as Answer;
    await renderContent({ tenantId: "t-1" });
    db.tables.marketing_content = { data: [ROWS[3]], error: null };
    await renderContent({ tenantId: "t-2" });
    await act(async () => { release({ data: ROWS, error: null }); });
    await flush();
    expect(host.querySelectorAll(".mct-card")).toHaveLength(1);
  });
});
