// @vitest-environment jsdom
// Marketing › Audience, Content, Email and Ads: what each tab shows from real records, and what
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

import { MarketingAds, MarketingAudience, MarketingContent, MarketingEmail } from "./marketing-planned";

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

describe("Marketing › Audience", () => {
  it("counts the workspace's own contacts by stage, source and tag, read for this tenant only", async () => {
    db.tables.clients = { data: [
      { lifecycle_stage: "new_lead", source: "paige_form", tags: ["spring", "webinar"] },
      { lifecycle_stage: "new_lead", source: "manual", tags: ["spring"] },
      { lifecycle_stage: "client_funded", source: "conversations", tags: null },
    ], error: null };
    const onOpenClients = vi.fn();
    await render(<MarketingAudience tenantId="t-1" onOpenClients={onOpenClients}/>);
    expect(db.calls.find((call) => call.table === "clients")?.filters).toContainEqual(["tenant_id", "t-1"]);
    const stat = (label: string) => [...host.querySelectorAll(".mk-stat")].find((el) => el.querySelector("dt")?.textContent === label)?.querySelector("strong")?.textContent;
    expect(stat("Contacts")).toBe("3");
    expect(stat("From your forms")).toBe("1");
    expect(stat("Tags in use")).toBe("2");
    expect(stat("Stages in use")).toBe("2");
    expect(text()).toContain("New lead2");
    expect(text()).toContain("From a conversation1");
    expect(text()).toContain("spring2");
    // A stage named for one vertical's outcome reads as a neutral outcome (§2).
    expect(text()).toContain("Outcome reached");
    expect(text()).not.toMatch(/fund|credit|loan/i);
    // No header: the tab strip already names the tab, so the view does not repeat it (owner, 2026-10-04).
    expect(host.querySelector("h2")?.textContent).toBe("By stage");
    expect(host.textContent).not.toMatch(/Planned/);
    expect(text()).toContain("Saved audiences and segments");
    act(() => (host.querySelector(".mp-actions button") as HTMLButtonElement).click());
    expect(onOpenClients).toHaveBeenCalledTimes(1);
  });

  it("says a capped read is a floor, not a total", async () => {
    db.tables.clients = { data: Array.from({ length: 1000 }, () => ({ lifecycle_stage: "new_lead", source: "manual", tags: [] })), error: null };
    await render(<MarketingAudience tenantId="t-1" onOpenClients={() => {}}/>);
    expect(text()).toContain("1000+");
    expect(text()).toContain("Counted from the first 1000");
  });

  it("starts from an honest empty state, and a failed read can be retried", async () => {
    await render(<MarketingAudience tenantId="t-1" onOpenClients={() => {}}/>);
    expect(text()).toContain("No contacts yet");
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.tables.clients = { data: null, error: { message: "boom" } };
    await render(<MarketingAudience tenantId="t-2" onOpenClients={() => {}}/>);
    expect(text()).toContain("Your contacts could not load");
    db.tables.clients = { data: [{ lifecycle_stage: "won", source: "manual", tags: [] }], error: null };
    act(() => ([...host.querySelectorAll("button")].find((b) => b.textContent === "Try again") as HTMLButtonElement).click());
    await flush();
    expect(text()).toContain("Won1");
  });
});

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

describe("Marketing › Email", () => {
  it("reads the sending identity the way Settings does, and shows only saved email copy", async () => {
    db.rpc = { data: [{ tenant_id: "t-1", default_email_sender: "hello@studio.example", default_email_domain: "studio.example", default_email_status: "verified" }], error: null };
    db.tables.marketing_content = { data: [
      { id: "e1", kind: "text", channel: "email_campaign", status: "draft", title: "Welcome note", updated_at: "2026-10-01T10:00:00Z" },
    ], error: null };
    const onOpenConnections = vi.fn();
    await render(<MarketingEmail tenantId="t-1" onOpenConnections={onOpenConnections}/>);
    expect(text()).toContain("hello@studio.example");
    expect(host.querySelector(".mp-facts .mk-flag")?.textContent).toBe("Active");
    expect(host.querySelector(".mp-facts .mk-flag")?.className).toContain("is-live");
    expect(text()).toContain("Welcome note");
    expect(db.calls.find((c) => c.table === "marketing_content")?.filters).toContainEqual(["channel", "email_campaign"]);
    expect(text()).not.toMatch(/open rate|\d+%/i);
    act(() => ([...host.querySelectorAll(".mp-actions button")].find((b) => b.textContent === "Sending settings") as HTMLButtonElement).click());
    expect(onOpenConnections).toHaveBeenCalled();
  });

  it("refuses a sending identity resolved for a different workspace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.rpc = { data: [{ tenant_id: "t-other", default_email_sender: "someone@else.example", default_email_status: "verified" }], error: null };
    await render(<MarketingEmail tenantId="t-1" onOpenConnections={() => {}}/>);
    expect(text()).not.toContain("someone@else.example");
    expect(text()).toContain("Your sending identity could not load");
  });

  it("says plainly when no sending identity is set up", async () => {
    await render(<MarketingEmail tenantId="t-1" onOpenConnections={() => {}}/>);
    expect(text()).toContain("No sending identity is set up yet");
  });
});

describe("Marketing › Ads", () => {
  it("shows saved ad copy, offers a draft-first ask, and never a spend, click or lead figure", async () => {
    db.tables.marketing_content = { data: [{ id: "a1", kind: "text", channel: "ad_copy", status: "draft", title: "Spring ad", updated_at: "2026-10-01T10:00:00Z" }], error: null };
    const onOpenIntegrations = vi.fn();
    const asks: string[] = [];
    const listen = (event: Event) => asks.push((event as CustomEvent).detail?.prompt);
    window.addEventListener("paige:open", listen);
    await render(<MarketingAds tenantId="t-1" onOpenIntegrations={onOpenIntegrations}/>);
    expect(db.calls.find((c) => c.table === "marketing_content")?.filters).toContainEqual(["channel", "ad_copy"]);
    expect(text()).toContain("Spring ad");
    expect(text()).toContain("Nothing here is estimated");
    expect(text()).not.toMatch(/\$\s?\d|cost per lead\s*\d|\bROAS\b/i);
    const button = (label: string) => [...host.querySelectorAll(".mp-actions button")].find((b) => b.textContent === label) as HTMLButtonElement;
    act(() => button("Open Integrations").click());
    expect(onOpenIntegrations).toHaveBeenCalled();
    act(() => button("Ask PAIGE to draft ad copy").click());
    window.removeEventListener("paige:open", listen);
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatch(/do not run or publish anything/);
  });

  it("drops a stale answer when the workspace changes mid-read", async () => {
    let release: (value: { data: unknown; error: unknown }) => void = () => {};
    const slow = new Promise<{ data: unknown; error: unknown }>((resolve) => { release = resolve; });
    // The first workspace's read is held; the second resolves at once.
    db.tables = new Proxy({}, { get: (_, table: string) => (table === "marketing_content" && db.calls.filter((c) => c.table === table).length === 1 ? slow : { data: [{ id: "b1", kind: "text", channel: "ad_copy", status: "draft", title: "Second workspace ad", updated_at: "2026-10-01T10:00:00Z" }], error: null }) }) as never;
    act(() => root.render(<MarketingAds tenantId="t-1" onOpenIntegrations={null}/>));
    await render(<MarketingAds tenantId="t-2" onOpenIntegrations={null}/>);
    release({ data: [{ id: "a1", kind: "text", channel: "ad_copy", status: "draft", title: "First workspace ad", updated_at: "2026-10-01T10:00:00Z" }], error: null });
    await flush();
    expect(text()).toContain("Second workspace ad");
    expect(text()).not.toContain("First workspace ad");
    expect(host.querySelector(".mp-actions")?.textContent).not.toContain("Open Integrations");
  });
});
