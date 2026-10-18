import React, { act } from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// E09 Slice 3 — "Shared with {client}" on the Solo client record. The list is the same governed read the
// standing section uses (the real exp04 SQL fixture), each item carrying the share state and row version
// the 20271110030000 reader adds. Synthetic ids and names only (CLAUDE.md §63).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const source = JSON.parse(readFileSync("src/__tests__/fixtures/exp04-client-status-source.json", "utf8"));
const TENANT = source.tenant_id as string, CLIENT = source.contact_id as string;
const ACTOR = "e0930000-0000-4000-8000-000000000001";
const [DRAFT, REVIEW, KICKOFF] = source.work.items.map((i: { id: string }) => i.id) as string[];
const V1 = "2026-10-14T12:00:00.123456+00:00", V2 = "2026-10-14T12:05:00.654321+00:00";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn(), creator: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => mock.rpc(...a), auth: { getSession: () => mock.session() } } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({ activeTenantId: TENANT, activeUserId: ACTOR, accountContextLoading: false }) }));
vi.mock("@/hooks/usePlanList", () => ({ usePlanList: () => ({ plans: [], forbidden: false, error: null, loading: false }) }));
vi.mock("@/solo/operations/useOperationsPeople", () => ({ useOperationsPeople: () => ({ members: [], loading: false, error: null }) }));
vi.mock("@/solo/operations/OperationsWorkCreator", () => ({
  OperationsWorkCreator: (props: { contact?: { id: string; name: string } }) => { mock.creator(props); return <div data-creator-for={props.contact?.id} />; },
}));
import { ClientSharedWork } from "./ClientSharedWork";

type Item = { id: string; status?: string; shared?: boolean; updated_at?: string; due_at?: string | null };
/** The reader's answer, with each item's share state and version patched in. */
function status(items: Item[] = [{ id: DRAFT, shared: false, updated_at: V1 }, { id: REVIEW, shared: true, updated_at: V1 }, { id: KICKOFF, shared: false, updated_at: V1 }]) {
  const s = structuredClone(source);
  s.receipt_id = undefined;
  s.work.items = s.work.items.flatMap((row: Item) => {
    const patch = items.find(i => i.id === row.id);
    return patch ? [{ ...row, ...patch }] : [];
  });
  return { data: s, error: null };
}

let reads: Array<{ data: unknown; error: unknown }> = [];
let shareReply: { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }> = { data: null, error: null };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  mock.rpc.mockReset(); mock.creator.mockReset();
  mock.session.mockResolvedValue({ data: { session: { user: { id: ACTOR } } }, error: null });
  reads = [];
  mock.rpc.mockImplementation((name: string) => {
    if (name === "read_client_engagement_status") return Promise.resolve(reads.length > 1 ? reads.shift()! : reads[0] ?? status());
    if (name === "plan_item_set_client_share") return Promise.resolve(shareReply);
    return Promise.resolve({ data: null, error: { code: "PGRST202" } });
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function render(portalConnected = true) {
  await act(async () => root.render(<ClientSharedWork contactId={CLIENT} clientName="Jordan Rivera" portalConnected={portalConnected} />));
  await flush();
}
const row = (title: string) => [...host.querySelectorAll<HTMLElement>(".trc-shared-row")].find(r => r.querySelector("strong")?.textContent === title);
const toggle = (title: string) => row(title)?.querySelector<HTMLButtonElement>('button[role="switch"]') ?? null;
const filterButton = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".trc-shared-filter button")].find(b => b.textContent?.startsWith(label)) ?? null;
const sees = (title: string) => row(title)?.querySelector(".trc-shared-quiet-line")?.textContent ?? null;
const readCalls = () => mock.rpc.mock.calls.filter(([name]) => name === "read_client_engagement_status").length;
const shareCalls = () => mock.rpc.mock.calls.filter(([name]) => name === "plan_item_set_client_share");
async function flip(title: string) { await act(async () => toggle(title)!.click()); await flush(); }

describe("ClientSharedWork", () => {
  it("lists this client's work from the one governed read, names the boundary, and shows what is shared", async () => {
    reads = [status()]; await render();
    expect(mock.rpc).toHaveBeenCalledWith("read_client_engagement_status", { _expected_tenant_id: TENANT, _contact_id: CLIENT });
    expect(host.querySelector("#trc-shared-title")?.textContent).toBe("Shared with Jordan Rivera");
    expect(host.textContent).toContain("Jordan Rivera sees only what you share here: title, status and due date. Notes, priority and who it’s assigned to stay private.");
    expect(filterButton("Shared")?.textContent).toBe("Shared 1");
    expect(filterButton("Private")?.textContent).toBe("Private 2");
    expect(toggle("Strategy review")?.getAttribute("aria-checked")).toBe("true");
    expect(toggle("Draft discovery report")?.getAttribute("aria-checked")).toBe("false");
    expect(row("Strategy review")?.textContent).toContain("Milestone · Ready · Due Oct 26, 2026");
  });

  it("sends the row's version with the signed-in actor and the record's workspace — never anything else", async () => {
    reads = [status(), status([{ id: DRAFT, shared: true, updated_at: V2 }, { id: REVIEW, shared: true, updated_at: V1 }, { id: KICKOFF, shared: false, updated_at: V1 }])];
    shareReply = { data: { ok: true, replayed: false, item_id: DRAFT, shared: true, shared_at: V2, updated_at: V2, portal_connected: true }, error: null };
    await render(); await flip("Draft discovery report");
    expect(shareCalls()).toEqual([["plan_item_set_client_share", { p_expected_actor_id: ACTOR, p_expected_tenant_id: TENANT,
      p_item_id: DRAFT, p_shared: true, p_expected_updated_at: V1 }]]);
  });

  it("reports success only after a fresh read shows the item shared", async () => {
    reads = [status(), status([{ id: DRAFT, shared: true, updated_at: V2 }, { id: REVIEW, shared: true, updated_at: V1 }, { id: KICKOFF, shared: false, updated_at: V1 }])];
    shareReply = { data: { ok: true, replayed: false, item_id: DRAFT, shared: true, shared_at: V2, updated_at: V2, portal_connected: true }, error: null };
    await render(); await flip("Draft discovery report");
    expect(readCalls()).toBe(2);
    expect(row("Draft discovery report")?.textContent).toContain("Shared. Jordan Rivera can see this in their portal.");
    expect(toggle("Draft discovery report")?.getAttribute("aria-checked")).toBe("true");
    expect(filterButton("Shared")?.textContent).toBe("Shared 2");
  });

  it("an acknowledgement the fresh read does not bear out is not success", async () => {
    reads = [status(), status()]; // the re-read still says private
    shareReply = { data: { ok: true, replayed: false, item_id: DRAFT, shared: true, shared_at: V2, updated_at: V2, portal_connected: true }, error: null };
    await render(); await flip("Draft discovery report");
    expect(readCalls()).toBe(2);
    expect(row("Draft discovery report")?.textContent).not.toContain("can see this in their portal");
    expect(row("Draft discovery report")?.textContent).toContain("The change couldn’t be confirmed.");
    expect(toggle("Draft discovery report")?.getAttribute("aria-checked")).toBe("false");
  });

  it("on ITEM_CHANGED it reads the list again and asks the owner to check before sharing", async () => {
    reads = [status(), status([{ id: DRAFT, status: "blocked", shared: false, updated_at: V2 }, { id: REVIEW, shared: true, updated_at: V1 }, { id: KICKOFF, shared: false, updated_at: V1 }])];
    shareReply = { data: { ok: false, error: "ITEM_CHANGED", updated_at: V2 }, error: null };
    await render(); await flip("Draft discovery report");
    expect(readCalls()).toBe(2);
    expect(row("Draft discovery report")?.textContent).toContain("This item changed. Check it and share again.");
    expect(row("Draft discovery report")?.textContent).toContain("Blocked");
    expect(toggle("Draft discovery report")?.getAttribute("aria-checked")).toBe("false");
  });

  it.each([
    ["CLIENT_SHARE_UNAVAILABLE", "Sharing work with clients isn’t available for this account."],
    ["ITEM_NOT_FOUND", "This item is no longer in your work."],
    ["ITEM_NOT_CLIENT_LINKED", "This item is no longer linked to Jordan Rivera."],
    ["ITEM_NOT_SHAREABLE", "Cancelled work can’t be shared."],
    ["CONTACT_NOT_FOUND", "Jordan Rivera’s record isn’t active, so nothing can be shared with them."],
    ["SOMETHING_NEW", "That change wasn’t made. Check the list and try again."],
  ])("maps %s to plain words, never the code", async (code, words) => {
    reads = [status()]; shareReply = { data: { ok: false, error: code }, error: null };
    await render(); await flip("Draft discovery report");
    expect(row("Draft discovery report")?.textContent).toContain(words);
    expect(host.textContent).not.toContain(code);
  });

  it("shows the row as pending while the change is in flight, and does not let it be sent twice", async () => {
    let finish!: (v: { data: unknown; error: unknown }) => void;
    reads = [status()]; shareReply = new Promise(resolve => { finish = resolve; });
    await render(); await flip("Draft discovery report");
    expect(row("Draft discovery report")?.textContent).toContain("Sharing…");
    expect(toggle("Draft discovery report")?.disabled).toBe(true);
    expect(row("Draft discovery report")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => toggle("Draft discovery report")!.click());
    expect(shareCalls()).toHaveLength(1);
    await act(async () => finish({ data: { ok: false, error: "ITEM_CHANGED" }, error: null })); await flush();
    expect(toggle("Draft discovery report")?.disabled).toBe(false);
  });

  it("offers no switch on cancelled work, or on an item the reader did not version", async () => {
    reads = [status([{ id: DRAFT, status: "cancelled", shared: false, updated_at: V1 }, { id: REVIEW }, { id: KICKOFF, shared: false, updated_at: V1 }])];
    await render();
    expect(toggle("Draft discovery report")).toBeNull();
    expect(row("Draft discovery report")?.textContent).toContain("Cancelled · hidden from Jordan");
    expect(toggle("Strategy review")).toBeNull();
    expect(toggle("Kickoff workshop")).not.toBeNull();
    expect(host.querySelectorAll('input[type="checkbox"], select').length).toBe(0);
  });

  it("cancelled work has no switch even if it still reads shared, is not counted, and says it is hidden", async () => {
    // Cancelling unshares (backend decision), so this is only ever a stale read; it must never look live.
    reads = [status([{ id: DRAFT, status: "cancelled", shared: true, updated_at: V1 }, { id: REVIEW, shared: true, updated_at: V1 }, { id: KICKOFF, shared: false, updated_at: V1 }])];
    await render();
    expect(toggle("Draft discovery report")).toBeNull();
    expect(row("Draft discovery report")?.textContent).toContain("Cancelled · hidden from Jordan");
    expect(sees("Draft discovery report")).toBeNull();
    expect(row("Draft discovery report")?.hasAttribute("data-shared")).toBe(false);
    expect(filterButton("Shared")?.textContent).toBe("Shared 1");
    expect(filterButton("Private")?.textContent).toBe("Private 1");
  });

  it("on every shared row, says in the client's words what they see — state, their date, past due", async () => {
    reads = [status([{ id: DRAFT, status: "blocked", shared: true, updated_at: V1 }, { id: REVIEW, shared: true, updated_at: V1 }, { id: KICKOFF, shared: true, updated_at: V1 }])];
    await render();
    // open → Not started; due 2026-10-27T00:10Z reads Mon, Oct 26 in the business zone (America/New_York).
    expect(sees("Strategy review")).toBe("Jordan sees: Not started · Due Mon, Oct 26");
    // blocked → In progress (D3); due before the read, so past due.
    expect(sees("Draft discovery report")).toBe("Jordan sees: In progress · Past due · Sat, Oct 10");
    // done → Done, with the finished date the client's page shows.
    expect(sees("Kickoff workshop")).toBe("Jordan sees: Done · Finished Sun, Sep 13");
    // The owner's own words stay on the facts line.
    expect(row("Strategy review")?.textContent).toContain("Milestone · Ready · Due Oct 26, 2026");
  });

  it("private rows carry no client line", async () => {
    reads = [status()]; await render();
    expect(sees("Draft discovery report")).toBeNull();
    expect(sees("Kickoff workshop")).toBeNull();
    expect(sees("Strategy review")).toBe("Jordan sees: Not started · Due Mon, Oct 26");
  });

  it("maps states exactly as the customer read does (drift guard against the migration's CASE)", async () => {
    const sql = readFileSync("supabase/migrations/20271110030000_e09_customer_portal_progress.sql", "utf8");
    expect(sql).toContain("'state', CASE r.status WHEN 'done' THEN 'done' WHEN 'open' THEN 'not_started' ELSE 'in_progress' END");
    // Every owner status the customer can see, rendered: open, in_progress, blocked, done.
    const said: string[] = [];
    for (const st of ["open", "in_progress", "blocked", "done"]) {
      act(() => root.unmount()); root = createRoot(host);
      reads = [status([{ id: REVIEW, status: st, shared: true, updated_at: V1 }])]; await render();
      said.push(sees("Strategy review")!.split(" · ")[0]);
    }
    expect(said).toEqual(["Jordan sees: Not started", "Jordan sees: In progress", "Jordan sees: In progress", "Jordan sees: Done"]);
  });

  it("the Shared · Private filter narrows the list and a second press shows all", async () => {
    reads = [status()]; await render();
    expect(host.querySelectorAll(".trc-shared-row")).toHaveLength(3);
    await act(async () => filterButton("Shared")!.click());
    expect(filterButton("Shared")?.getAttribute("aria-pressed")).toBe("true");
    expect([...host.querySelectorAll(".trc-shared-row strong")].map(n => n.textContent)).toEqual(["Strategy review"]);
    await act(async () => filterButton("Private")!.click());
    expect([...host.querySelectorAll(".trc-shared-row strong")].map(n => n.textContent)).toEqual(["Draft discovery report", "Kickoff workshop"]);
    await act(async () => filterButton("Private")!.click());
    expect(host.querySelectorAll(".trc-shared-row")).toHaveLength(3);
    expect(filterButton("Private")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("refreshes from a borderless Refresh control, not a Check again chip", async () => {
    reads = [status()]; await render();
    const refresh = host.querySelector<HTMLButtonElement>(".trc-shared-refresh");
    expect(refresh?.textContent).toBe("Refresh");
    expect(host.textContent).not.toContain("Check again");
    await act(async () => refresh!.click()); await flush();
    expect(readCalls()).toBe(2);
    const css = readFileSync("src/components/tenant-relationships/client-shared-work.css", "utf8");
    expect(css).toMatch(/\.trc-shared-filter-btn, \.trc-shared-refresh \{[^}]*border: 0;[^}]*min-height: 44px|\.trc-shared-filter-btn, \.trc-shared-refresh \{[^}]*min-height: 44px[^}]*border: 0;/);
  });

  it("when the client hasn't joined, success says they'll see it once they join — not that they can now", async () => {
    reads = [status(), status([{ id: DRAFT, shared: true, updated_at: V2 }, { id: REVIEW, shared: true, updated_at: V1 }, { id: KICKOFF, shared: false, updated_at: V1 }])];
    shareReply = { data: { ok: true, replayed: false, item_id: DRAFT, shared: true, shared_at: V2, updated_at: V2, portal_connected: false }, error: null };
    await render(false); await flip("Draft discovery report");
    expect(row("Draft discovery report")?.textContent).toContain("Shared. Jordan will see this once they join your portal.");
    expect(row("Draft discovery report")?.textContent).not.toContain("can see this in their portal");
  });

  it("says when the client hasn't joined the portal, from the record or from the share's answer", async () => {
    reads = [status()]; await render(false);
    expect(host.querySelector(".trc-shared-connect")?.textContent).toBe("Jordan Rivera hasn’t joined your portal yet; shared items appear when they do.");
    act(() => root.unmount()); root = createRoot(host);
    reads = [status(), status([{ id: DRAFT, shared: true, updated_at: V2 }, { id: REVIEW, shared: true, updated_at: V1 }, { id: KICKOFF, shared: false, updated_at: V1 }])];
    shareReply = { data: { ok: true, replayed: false, item_id: DRAFT, shared: true, shared_at: V2, updated_at: V2, portal_connected: false }, error: null };
    await render(true);
    expect(host.querySelector(".trc-shared-connect")).toBeNull();
    await flip("Draft discovery report");
    expect(host.querySelector(".trc-shared-connect")).not.toBeNull();
  });

  it("does not write when the signed-in session is not the record's actor", async () => {
    mock.session.mockResolvedValue({ data: { session: { user: { id: "e0930000-0000-4000-8000-000000000099" } } }, error: null });
    reads = [status()]; await render(); await flip("Draft discovery report");
    expect(shareCalls()).toHaveLength(0);
    expect(row("Draft discovery report")?.textContent).toContain("Your account changed.");
  });

  it("shows skeleton rows while reading, never a list or switches", async () => {
    mock.rpc.mockImplementation(() => new Promise(() => {}));
    await render();
    expect(host.querySelectorAll(".trc-shared-skeleton")).toHaveLength(3);
    expect(host.querySelector('button[role="switch"]')).toBeNull();
    expect(host.textContent).toContain("Checking what Jordan Rivera can see…");
  });

  it("a refusal is a state with no switches; a failed read is an alert that retries", async () => {
    reads = [{ data: null, error: { code: "42501" } }]; await render();
    expect(host.textContent).toContain("Only the business owner or an admin can choose what Jordan Rivera sees in their portal.");
    expect(host.querySelector('button[role="switch"]')).toBeNull();
    act(() => root.unmount()); root = createRoot(host);
    reads = [{ data: null, error: { code: "57014" } }, status()]; await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("We couldn’t check what Jordan Rivera can see.");
    const retry = [...host.querySelectorAll("button")].find(b => b.textContent === "Try again")!;
    await act(async () => retry.click()); await flush();
    expect(toggle("Draft discovery report")).not.toBeNull();
  });

  it("with no linked work, teaches adding work for this client and shows no switches", async () => {
    reads = [status([])]; await render();
    expect(host.textContent).toContain("No work is linked to Jordan Rivera yet.");
    expect(host.querySelector('button[role="switch"]')).toBeNull();
    const add = [...host.querySelectorAll("button")].find(b => b.textContent === "Add work for Jordan Rivera")!;
    await act(async () => add.click()); await flush();
    expect(mock.creator).toHaveBeenCalled();
    expect(mock.creator.mock.calls.at(-1)![0]).toMatchObject({ contact: { id: CLIENT, name: "Jordan Rivera", firstName: "Jordan" }, actorId: ACTOR, tenantId: TENANT });
  });

  it("spends no gold and no hard-coded colour, and uses the house switch", () => {
    const tsx = readFileSync("src/components/tenant-relationships/ClientSharedWork.tsx", "utf8");
    expect(tsx).not.toMatch(/variant="gold"|--pg-gold|gold-dark|type="checkbox"|<select/);
    expect(tsx).toContain('from "@/components/ui/switch"');
    const css = readFileSync("src/components/tenant-relationships/client-shared-work.css", "utf8");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|--pg-gold|gold-dark/i);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});
