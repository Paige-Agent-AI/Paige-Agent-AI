// @vitest-environment jsdom
// Marketing › Content and Email (Ads: marketing-ads.render.test.tsx): what each tab shows from real records, and what
// it refuses to show. Network reads are stubbed at the Supabase client; everything else is the real view.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; error: unknown };
const db: { tables: Record<string, Answer>; rpc: Answer; calls: { table: string; filters: [string, unknown][] }[] } = { tables: {}, rpc: { data: null, error: null }, calls: [] };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call = { table, filters: [] as [string, unknown][] };
    db.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit"]) chain[method] = () => chain;
    chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain; };
    chain.neq = (column: string, value: unknown) => { call.filters.push([`not ${column}`, value]); return chain; };
    // The answer is fixed when the query is built, so a test can hold one read while another lands.
    const answer = db.tables[table] ?? { data: [], error: null };
    chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(answer).then(resolve, reject);
    return chain;
  };
  return { supabase: { from, rpc: () => Promise.resolve(db.rpc) } };
});
// Who may read the saved library comes from the briefs read's can_manage (the same admin test as its policy).
const access = { phase: "ready", canManage: true };
vi.mock("./useSoloCampaignBriefs", () => ({ useSoloCampaignBriefs: () => access }));

import { MarketingContent } from "./marketing-planned";

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); }); };
const render = async (node: React.ReactNode) => { act(() => root.render(node)); await flush(); };
const text = () => host.textContent ?? "";

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  db.tables = {}; db.rpc = { data: null, error: null }; db.calls = [];
  access.phase = "ready"; access.canManage = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("Marketing › Content", () => {
  const published = { phase: "ready", pages: 2, funnels: 0, forms: 1, unpublished: 4 };
  const renderContent = (over: Partial<typeof published> = {}, onOpenCapture = vi.fn(), onRetryPublished = vi.fn()) =>
    render(<MarketingContent tenantId="t-1" published={{ ...published, ...over }} onOpenCapture={onOpenCapture} onRetryPublished={onRetryPublished} studioLauncher={<button>Open Vibe Studio</button>}/>);

  it("lists the saved library by what each piece is, and counts published work from Lead capture's records", async () => {
    db.tables.marketing_content = { data: [
      { id: "c1", kind: "image", channel: null, status: "published", title: "Spring hero", updated_at: "2026-10-01T10:00:00Z" },
      { id: "c2", kind: "document", channel: null, status: "draft", title: "Intake guide", updated_at: "2026-09-30T10:00:00Z" },
      { id: "c3", kind: "text", channel: "social_post", status: "draft", title: "Launch post", updated_at: "2026-09-29T10:00:00Z" },
    ], error: null };
    const onOpenCapture = vi.fn();
    await renderContent({}, onOpenCapture);
    expect(db.calls.find((c) => c.table === "marketing_content")?.filters).toEqual([["tenant_id", "t-1"], ["not status", "archived"]]);
    const flags = [...host.querySelectorAll(".mp-list .mk-flag")].map((el) => el.textContent);
    expect(flags.slice(0, 3)).toEqual(["Image", "Document", "Social post"]);
    expect(host.querySelector(".mp-list li small")?.textContent).toMatch(/^Published · saved/);
    expect(text()).toContain("2 pages · 0 funnels · 1 form");
    expect(text()).toContain("Not published yet4");
    act(() => ([...host.querySelectorAll("button")].find((b) => b.textContent === "Published work") as HTMLButtonElement).click());
    expect(onOpenCapture).toHaveBeenCalled();
    expect(text()).toContain("Content calendar");
  });

  it("never shows a zero for published work it has not read", async () => {
    await renderContent({ phase: "loading", pages: 0, forms: 0, unpublished: 0 });
    expect(text()).toContain("Published…");
    const onRetryPublished = vi.fn();
    await renderContent({ phase: "error", pages: 0, forms: 0, unpublished: 0 }, vi.fn(), onRetryPublished);
    expect(text()).toContain("Published—");
    expect(text()).toContain("could not load");
    act(() => ([...host.querySelectorAll(".mp-inline-note button")][0] as HTMLButtonElement).click());
    expect(onRetryPublished).toHaveBeenCalled();
  });

  it("marks a full library read as a floor", async () => {
    db.tables.marketing_content = { data: Array.from({ length: 60 }, (_, n) => ({ id: `c${n}`, kind: "image", channel: null, status: "draft", title: `Piece ${n}`, updated_at: "2026-10-01T10:00:00Z" })), error: null };
    await renderContent();
    expect(text()).toContain("In your library60+");
  });

  it("tells a member who cannot read the library so, instead of showing it empty", async () => {
    access.canManage = false;
    await renderContent();
    expect(db.calls.some((c) => c.table === "marketing_content")).toBe(false);
    expect(text()).toContain("visible to its owners and admins");
    expect(text()).not.toContain("Nothing saved yet");
  });
});

