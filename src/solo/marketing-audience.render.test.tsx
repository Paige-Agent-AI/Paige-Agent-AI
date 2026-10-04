// @vitest-environment jsdom
// Marketing › Audience: the redesigned tab reads the workspace's own contacts and says only what they show.
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A table answers with a fixed result, or with `rows` served a page at a time by range(from, to).
type Answer = { data: unknown; error: unknown } | { rows: unknown[] };
type Call = { table: string; filters: [string, unknown][]; orders: [string, boolean][]; ranges: [number, number][] };
const db: { tables: Record<string, Answer>; calls: Call[] } = { tables: {}, calls: [] };

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call: Call = { table, filters: [], orders: [], ranges: [] };
    db.calls.push(call);
    const answer = db.tables[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = (column: string, options: { ascending: boolean }) => { call.orders.push([column, options.ascending]); return chain; };
    chain.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return chain; };
    chain.is = (column: string, value: unknown) => { call.filters.push([`is ${column}`, value]); return chain; };
    chain.in = (column: string, value: unknown) => { call.filters.push([`in ${column}`, value]); return chain; };
    chain.range = (from: number, to: number) => {
      call.ranges.push([from, to]);
      return Promise.resolve("rows" in answer ? { data: answer.rows.slice(from, to + 1), error: null } : answer);
    };
    return chain;
  };
  return { supabase: { from } };
});
vi.mock("./useSoloCampaignBriefs", () => ({ useSoloCampaignBriefs: () => ({ phase: "ready", canManage: true }) }));

import { MarketingAudience } from "./marketing-audience";

let host: HTMLDivElement;
let root: Root;
const flush = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const render = async (node: React.ReactNode) => { act(() => root.render(node)); await flush(); };
const text = () => host.textContent ?? "";
const stat = (label: string) => [...host.querySelectorAll(".mo-stat")].find((el) => el.querySelector("h3")?.textContent?.startsWith(label))?.querySelector(".mo-stat-value")?.textContent;
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const row = (id: string, extra: Record<string, unknown>) => ({ id, lifecycle_stage: "new_lead", source: "manual", tags: [], created_at: ago(100), last_contacted_at: null, do_not_contact: false, dnd_active: false, disqualified: false, ...extra });

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  db.tables = {}; db.calls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe("Marketing › Audience", () => {
  it("shows the workspace's own figures, read for this workspace only, merged contacts excluded", async () => {
    db.tables.clients = { data: [
      row("a", { created_at: ago(3), source: "paige_form", tags: ["webinar"], last_contacted_at: ago(1) }),
      row("b", { created_at: ago(12), lifecycle_stage: "qualified", tags: ["webinar", "vip"] }),
      row("c", { lifecycle_stage: "client_funded", source: "conversations", do_not_contact: true }),
      row("d", { lifecycle_stage: "client_active" }),
    ], error: null };
    db.tables.client_contact_methods = { data: [{ client_id: "a" }, { client_id: "b" }, { client_id: "c" }], error: null };
    const onOpenClients = vi.fn();
    await render(<MarketingAudience tenantId="t-1" onOpenClients={onOpenClients}/>);
    const clients = db.calls.find((c) => c.table === "clients");
    expect(clients?.filters).toEqual([["tenant_id", "t-1"], ["is merged_into_contact_id", null]]);
    expect(db.calls.find((c) => c.table === "client_contact_methods")?.filters).toEqual([["tenant_id", "t-1"], ["in kind", ["email", "phone"]]]);
    expect(stat("Total contacts")).toBe("4");
    expect(stat("New, last 30 days")).toBe("2");
    expect(stat("Qualified")).toBe("1");
    expect(stat("Tagged")).toBe("2");
    expect(stat("Reachable")).toBe("2"); // a and b have an address on record; c has one but opted out
    expect(stat("Contacted, last 30 days")).toBe("1");
    expect(text()).toContain("Audience composition");
    expect(text()).toContain("Your forms");
    expect(text()).toContain("webinar");
    // A stage named for one vertical's outcome reads neutrally (§2); no finance wording.
    expect(text()).not.toMatch(/fund|credit|loan/i);
    // No header and no Planned marker (owner, 2026-10-04).
    expect(text()).not.toMatch(/Planned/);
    expect(text()).toContain("What PAIGE sees");
    expect(text()).toContain("Saved audiences and segments");
    act(() => ([...host.querySelectorAll(".mp-actions button")].find((b) => b.textContent === "Open Clients") as HTMLButtonElement).click());
    expect(onOpenClients).toHaveBeenCalled();
  });

  it("switching the period recounts, and Ask PAIGE prefills a draft-first question", async () => {
    db.tables.clients = { data: [row("a", { created_at: ago(3) }), row("b", { created_at: ago(20) }), row("c", { created_at: ago(60) })], error: null };
    await render(<MarketingAudience tenantId="t-1" onOpenClients={() => {}}/>);
    expect(stat("New, last 30 days")).toBe("2");
    act(() => ([...host.querySelectorAll(".campaigns-segmented button")].find((b) => b.textContent === "Last 7 days") as HTMLButtonElement).click());
    expect(stat("New, last 7 days")).toBe("1");
    const asks: string[] = [];
    const listen = (event: Event) => asks.push((event as CustomEvent).detail?.prompt);
    window.addEventListener("paige:open", listen);
    act(() => ([...host.querySelectorAll(".ma-next button")][0] as HTMLButtonElement).click());
    window.removeEventListener("paige:open", listen);
    expect(asks[0]).toMatch(/do not send anything/);
  });

  it("pages newest first in a stable order, and a read past the limit is a marked floor", async () => {
    // 5,200 contacts: five pages are read, the oldest 200 are not, and every count says so.
    db.tables.clients = { rows: Array.from({ length: 5200 }, (_, i) => row(`c${i}`, { created_at: ago(i < 3 ? 2 : 200) })) };
    await render(<MarketingAudience tenantId="t-1" onOpenClients={() => {}}/>);
    const reads = db.calls.filter((c) => c.table === "clients");
    expect(reads.map((c) => c.ranges[0])).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999]]);
    // created_at alone is not unique (one import shares it): id makes the page order total.
    expect(reads[0].orders).toEqual([["created_at", false], ["id", false]]);
    expect(db.calls.find((c) => c.table === "client_contact_methods")?.orders).toEqual([["id", true]]);
    expect(stat("Total contacts")).toBe("5,000+");
    expect(stat("New, last 30 days")).toBe("3+");
    expect(text()).toContain("Counted from your newest 5,000");
    expect(text()).toContain("Your newest 5,000 contacts, by the day each was added");
    expect(text()).not.toMatch(/vs previous|vs \d+ days ago/); // no comparison from a partial read
  });

  it("starts from an honest empty state, and a failed read can be retried", async () => {
    await render(<MarketingAudience tenantId="t-1" onOpenClients={() => {}}/>);
    expect(text()).toContain("No contacts yet");
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.tables.clients = { data: null, error: { message: "boom" } };
    await render(<MarketingAudience tenantId="t-2" onOpenClients={() => {}}/>);
    expect(text()).toContain("Your contacts could not load");
    db.tables.clients = { data: [row("z", { lifecycle_stage: "won" })], error: null };
    act(() => ([...host.querySelectorAll("button")].find((b) => b.textContent === "Try again") as HTMLButtonElement).click());
    await flush();
    expect(stat("Total contacts")).toBe("1");
  });
});
