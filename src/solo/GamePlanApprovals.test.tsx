// Render tests for GamePlanApprovals — the dismissible approvals strip embedded in
// the Business Game Plan rail (owner compact-UI ruling, 2026-09-11). House idiom:
// createRoot + act + direct DOM. The ROW is the proven ApprovalRow (mocked); these
// tests own the embedding contract: quiet when empty/loading, dismiss-until-new,
// error+retry, and the returns-when-work-lands behavior.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GamePlanApprovals } from "./GamePlanApprovals";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Row = { id: string; type: string; category: string | null; status: string; summary: string | null; assigned_to_user_id?: string | null; requires_role?: string | null };

const state: { items?: Row[]; loading?: boolean; error?: string | null; refresh?: ReturnType<typeof vi.fn> } = {};

vi.mock("@/hooks/usePendingApprovals", () => ({
  usePendingApprovals: () => ({
    items: state.items ?? [],
    loading: state.loading ?? false,
    error: state.error ?? null,
    refresh: state.refresh ?? vi.fn(),
  }),
}));
const viewer: { userId?: string | null; tenantId?: string | null; role?: string | null } = {};

vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: viewer.tenantId ?? "t-1", activeUserId: viewer.userId ?? "u-1" }),
}));

// The role resolver reads tenant_members through the real client — proxy-chain mock
// (house pattern) whose terminal maybeSingle returns the viewer's role.
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get(_t, k) {
      if (typeof k !== "string" || k === "then") return undefined;
      if (k === "maybeSingle") return async () => ({ data: viewer.role ? { role: viewer.role } : null, error: null });
      return () => chain;
    },
  });
  return { supabase: { from: () => chain } };
});

vi.mock("@/components/paige/ApprovalRow", () => ({
  ApprovalRow: ({ a }: { a: Row }) => <div data-testid="approval-row">{a.summary ?? a.id}</div>,
}));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  viewer.userId = "u-1";
  viewer.tenantId = "t-1";
  viewer.role = null;
  state.items = [];
  state.loading = false;
  state.error = null;
  state.refresh = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const one: Row = { id: "a1", type: "comms_draft", category: "email", status: "pending", summary: "Re-engagement: Lavelle" };
const two: Row = { id: "a2", type: "comms_draft", category: "email", status: "pending", summary: "Re-engagement: Marcus" };

function render_() {
  act(() => root.render(<GamePlanApprovals />));
}
async function settle() {
  await act(async () => {});
}

it("renders the running list with the waiting count when drafts are pending", async () => {
  state.items = [one, two];
  render_();
  await settle();
  expect(host.textContent ?? "").toMatch(/Waiting on you — 2/);
  expect(host.querySelectorAll('[data-testid="approval-row"]').length).toBe(2);
  expect(host.textContent ?? "").toContain("Approve the reviewed action");
  expect(host.textContent ?? "").not.toContain("Approving sends");
});

it("quiet when nothing needs the owner and while loading — no phantom card", async () => {
  render_();
  await settle();
  expect(host.textContent ?? "").toBe("");

  state.loading = true;
  render_();
  await settle();
  expect(host.textContent ?? "").toBe("");
});

it("dismiss hides the log until NEW work lands — and it comes back when it does", async () => {
  state.items = [one];
  render_();
  await settle();
  const hide = host.querySelector('button[aria-label^="Hide the approvals list"]') as HTMLElement;
  expect(hide).toBeTruthy();
  await act(async () => { hide.click(); });
  await settle();
  expect(host.textContent ?? "").toBe(""); // hidden — and no data changed

  state.items = [one, two]; // a new draft lands
  render_();
  await settle();
  expect(host.textContent ?? "").toMatch(/Waiting on you — 2/); // it returns
});

it("dismiss STAYS hidden while the same work just resolves down (no nag on shrink)", async () => {
  state.items = [one, two];
  render_();
  await settle();
  await act(async () => { (host.querySelector('button[aria-label^="Hide the approvals list"]') as HTMLElement).click(); });
  await settle();
  state.items = [one]; // one resolved, no NEW work
  render_();
  await settle();
  expect(host.textContent ?? "").toBe("");
});

it("viewer relevance: another user's assigned item is invisible; the general queue and my role lane show", async () => {
  viewer.role = "coach";
  state.items = [
    { id: "mine", type: "t", category: null, status: "pending", summary: "assigned to me", assigned_to_user_id: "u-1" },
    { id: "theirs", type: "t", category: null, status: "pending", summary: "assigned to someone else", assigned_to_user_id: "u-9" },
    { id: "general", type: "t", category: null, status: "pending", summary: "general queue" },
    { id: "mylane", type: "t", category: null, status: "pending", summary: "coach lane", requires_role: "coach" },
    { id: "otherlane", type: "t", category: null, status: "pending", summary: "sales lane", requires_role: "sales" },
  ];
  render_();
  await settle();
  const text = host.textContent ?? "";
  expect(text).toContain("assigned to me");
  expect(text).toContain("general queue");
  expect(text).toContain("coach lane");
  expect(text).not.toContain("assigned to someone else");
  expect(text).not.toContain("sales lane");
  expect(text).toMatch(/Waiting on you — 3 .*coach desk/);
});

it("a load error offers Retry — never fabricated rows", async () => {
  state.error = "rls";
  render_();
  await settle();
  expect(host.textContent ?? "").toMatch(/Couldn't load your approvals/i);
  const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry") as HTMLElement;
  await act(async () => { retry.click(); });
  expect(state.refresh).toHaveBeenCalled();
});
