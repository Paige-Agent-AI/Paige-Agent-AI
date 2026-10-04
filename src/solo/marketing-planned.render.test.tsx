// @vitest-environment jsdom
// Marketing › Audience, Content, Email and Ads: what each Planned tab shows from real records, and what
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
    chain.then = (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(db.tables[table] ?? { data: [], error: null }).then(resolve, reject);
    return chain;
  };
  return { supabase: { from, rpc: () => Promise.resolve(db.rpc) } };
});

import { MarketingAds, MarketingAudience, MarketingContent, MarketingEmail } from "./marketing-planned";

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); }); };
const render = async (node: React.ReactNode) => { act(() => root.render(node)); await flush(); };
const text = () => host.textContent ?? "";

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  db.tables = {}; db.rpc = { data: null, error: null }; db.calls = [];
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
    expect(text()).toContain("New lead2");
    expect(text()).toContain("From a conversation1");
    expect(text()).toContain("spring2");
    // A stage named for one vertical's outcome reads as a neutral outcome (§2).
    expect(text()).toContain("Outcome reached");
    expect(text()).not.toMatch(/fund|credit|loan/i);
    expect(host.querySelector(".mp-head .mk-flag.is-planned")?.textContent).toBe("Planned");
    expect(text()).toContain("Saved audiences and segments");
    act(() => (host.querySelector(".mp-head-actions button") as HTMLButtonElement).click());
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
  it("lists saved drafts by what they are and counts published work from Lead capture's records", async () => {
    db.tables.marketing_content = { data: [
      { id: "c1", kind: "image", channel: null, title: "Spring hero", updated_at: "2026-10-01T10:00:00Z" },
      { id: "c2", kind: "document", channel: null, title: "Intake guide", updated_at: "2026-09-30T10:00:00Z" },
      { id: "c3", kind: "text", channel: "social_post", title: "Launch post", updated_at: "2026-09-29T10:00:00Z" },
    ], error: null };
    const onOpenCapture = vi.fn();
    await render(<MarketingContent tenantId="t-1" published={{ pages: 2, funnels: 0, forms: 1 }} unpublished={4} onOpenCapture={onOpenCapture} studioLauncher={<button>Open Vibe Studio</button>}/>);
    const call = db.calls.find((c) => c.table === "marketing_content");
    expect(call?.filters).toEqual([["tenant_id", "t-1"], ["status", "draft"]]);
    const flags = [...host.querySelectorAll(".mp-list .mk-flag")].map((el) => el.textContent);
    expect(flags.slice(0, 3)).toEqual(["Image", "Document", "Social post"]);
    expect(text()).toContain("2 pages · 0 funnels · 1 forms");
    expect(text()).toContain("Not published yet4");
    act(() => ([...host.querySelectorAll("button")].find((b) => b.textContent === "Published work") as HTMLButtonElement).click());
    expect(onOpenCapture).toHaveBeenCalled();
    expect(text()).toContain("Content calendar");
  });
});

describe("Marketing › Email", () => {
  it("reads the sending identity the way Settings does, and shows only saved email copy", async () => {
    db.rpc = { data: [{ default_email_sender: "hello@studio.example", default_email_domain: "studio.example", default_email_status: "verified" }], error: null };
    db.tables.marketing_content = { data: [
      { id: "e1", kind: "text", channel: "email_campaign", title: "Welcome note", updated_at: "2026-10-01T10:00:00Z" },
      { id: "a1", kind: "text", channel: "ad_copy", title: "Not an email", updated_at: "2026-10-01T10:00:00Z" },
    ], error: null };
    const onOpenConnections = vi.fn();
    await render(<MarketingEmail tenantId="t-1" onOpenConnections={onOpenConnections}/>);
    expect(text()).toContain("hello@studio.example");
    expect(host.querySelector(".mp-facts .mk-flag")?.textContent).toBe("Active");
    expect(host.querySelector(".mp-facts .mk-flag")?.className).toContain("is-live");
    expect(text()).toContain("Welcome note");
    expect(text()).not.toContain("Not an email");
    expect(text()).not.toMatch(/open rate|\d+%/i);
    act(() => (host.querySelector(".mp-head-actions button") as HTMLButtonElement).click());
    expect(onOpenConnections).toHaveBeenCalled();
  });

  it("says plainly when no sending identity is set up", async () => {
    await render(<MarketingEmail tenantId="t-1" onOpenConnections={() => {}}/>);
    expect(text()).toContain("No sending identity is set up yet");
  });
});

describe("Marketing › Ads", () => {
  it("shows saved ad copy and never a spend, click or lead figure", async () => {
    db.tables.marketing_content = { data: [{ id: "a1", kind: "text", channel: "ad_copy", title: "Spring ad", updated_at: "2026-10-01T10:00:00Z" }], error: null };
    await render(<MarketingAds tenantId="t-1"/>);
    expect(text()).toContain("Spring ad");
    expect(text()).toContain("none are estimated");
    expect(text()).not.toMatch(/\$\s?\d|cost per lead\s*\d|\bROAS\b/i);
    expect(host.querySelector(".mp-head-actions")).toBeNull();
  });
});
