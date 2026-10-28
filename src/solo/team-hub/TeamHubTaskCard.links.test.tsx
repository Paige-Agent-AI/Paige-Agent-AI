/**
 * EXP08 A2 slice 1 — the Team Hub task card reopens its work in Operations.
 *
 * A Team Hub task is a Planning item (`plan_items`). Operations addresses a CRM task with `?task=`
 * and a Planning item only as a weekly-check source (`?weeklySource=planning_item&item=`, whose
 * inspector says the work was referenced by the weekly check). Neither is this record's address, so
 * the card links to Operations → Work, where the same record is listed under the reader's own
 * permissions, and never mints `?task=<planning id>` (that would open a different, CRM, record).
 * The address is built from the CURRENT account, through the shared route map, so it grants nothing.
 *
 * jsdom renders of the real card with the tenant context mocked; they prove the address and the
 * states that show it, not that a signed-in person reached the task (that stays UNVERIFIED).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamHubTaskRead } from "./team-hub-contract";

const tenant = vi.hoisted(() => ({
  current: null as null | { id: string; account_type: string | null; parent_tenant_id: string | null; account_number: number | null },
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() }, storage: { from: vi.fn() } } }));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenant: tenant.current, activeTenantId: tenant.current?.id ?? null, activeUserId: "u-me",
    loading: false, accountContextStatus: "ready", refresh: vi.fn() }),
}));

import { TaskCard } from "./TeamHubWorkspace";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "e8000000-0000-4000-8000-0000000a0001";
const AT = "2026-10-28T10:41:00.000Z";
const SOLO = { id: "t-solo", account_type: "standalone", parent_tenant_id: null, account_number: 3855 };
const read = (over: Partial<{ title: string; status: string }> = {}): TeamHubTaskRead => ({
  state: "read", readAt: AT,
  record: { id: ID, title: "Draft the onboarding checklist", status: "open", assigned_to_user_id: "u-me", due_at: null, updated_at: AT, ...over },
});
const people = [{ user_id: "u-me", display_name: "Morgan Reyes", title: null, permission: "owner", team_conversations: true }];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { tenant.current = SOLO; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function renderCard(value: TeamHubTaskRead | undefined, { router = true } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fixture person matches TeamHubPerson's read shape
  const card = <TaskCard id={ID} read={value} people={people as any} meId="u-me" />;
  await act(async () => root.render(router ? <MemoryRouter>{card}</MemoryRouter> : card));
}
const links = () => [...host.querySelectorAll("a")];

describe("Team Hub task card: reopen in Operations", () => {
  it("links a read task to Operations → Work in the current SOLO account, never to a CRM task address", async () => {
    await renderCard(read());
    const [link] = links();
    expect(links()).toHaveLength(1);
    expect(link.textContent).toBe("Open delivery work");
    expect(link.getAttribute("href")).toBe("/solo/3855/operations/work");
    expect(link.getAttribute("href")).not.toContain("task=");
    expect(link.getAttribute("href")).not.toContain(ID);
  });

  it("is a quiet, keyboard-reachable link (ink, not gold) inside the card", async () => {
    await renderCard(read());
    const [link] = links();
    expect(link.closest('[role="group"]')?.getAttribute("aria-label")).toBe(`Task in Operations, record ${ID.slice(0, 8)}`);
    expect(link.classList.contains("th-link")).toBe(true);
    expect(link.className).not.toMatch(/gold|act/);
    expect(link.tabIndex).toBe(0);
    link.focus();
    expect(document.activeElement).toBe(link);
  });

  it("renders a plain link when no router is mounted, at the same address", async () => {
    await renderCard(read(), { router: false });
    expect(links().map((link) => link.getAttribute("href"))).toEqual(["/solo/3855/operations/work"]);
  });

  it("builds the address from the account on screen now, never one stored with the task", async () => {
    tenant.current = { ...SOLO, account_number: 9999 };
    await renderCard(read());
    expect(links().map((link) => link.getAttribute("href"))).toEqual(["/solo/9999/operations/work"]);
  });

  it("still offers Operations when the status read failed, so the person can check there", async () => {
    await renderCard({ state: "failed", readAt: AT });
    expect(links().map((link) => link.getAttribute("href"))).toEqual(["/solo/3855/operations/work"]);
  });

  it("offers no link while reading, or when the person cannot see the task in Operations", async () => {
    for (const value of [undefined, { state: "loading" } as const, { state: "unreadable", readAt: AT } as const]) {
      await renderCard(value);
      expect(links()).toEqual([]);
    }
    expect(host.textContent).toContain("You can't see this task in Operations.");
  });

  it("fails closed outside a SOLO workspace or without a numeric account address", async () => {
    for (const current of [
      { ...SOLO, account_type: "agency" }, { ...SOLO, account_type: "enterprise" },
      { ...SOLO, account_type: "sub_account", parent_tenant_id: "t-parent" }, { ...SOLO, account_number: null }, null,
    ]) {
      tenant.current = current;
      await renderCard(read());
      expect(links()).toEqual([]);
    }
  });
});
