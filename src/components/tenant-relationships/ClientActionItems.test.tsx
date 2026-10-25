import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClientActionItems } from "./ClientActionItems";
import { parseOwnerCustomerActions, type OwnerCustomerActions } from "@/hooks/useClientActionsOwner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const f = vi.hoisted(() => ({
  rpc: vi.fn(), user: vi.fn(), listener: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  context: { activeUserId: "", activeTenantId: "", accountContextLoading: false, accountContextStatus: "ready" },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...args: unknown[]) => f.rpc(...args), auth: {
  getUser: () => f.user(), onAuthStateChange: (listener: typeof f.listener) => { f.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
} } }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => f.context }));
const actor = "e09c9000-0000-4000-8000-000000000001", tenant = "e09c9000-0000-4000-8000-000000000002";
const contact = "e09c9000-0000-4000-8000-000000000003", other = "e09c9000-0000-4000-8000-000000000004";
const scope = { actor, tenant, contact };
const reply = (): OwnerCustomerActions => ({ schema_version: 1, actor_id: actor, tenant_id: tenant, contact_id: contact,
  access_state: "open", joined: true, shared_context_consent: true, more_actions: false,
  actions: [{ id: "e09c9000-0000-4000-8000-000000000005", action_type: "task", title: "Review your welcome guide", body: "Read the shared guide.",
    status: "customer_notified", created_at: "2026-10-24T12:00:00Z", updated_at: "2026-10-24T12:01:00Z", expires_at: "2026-11-23T12:00:00Z", is_expired: false, more_responses: false,
    responses: [{ id: "e09c9000-0000-4000-8000-000000000006", response_type: "question", response_text: "Which section first?", created_at: "2026-10-24T12:01:00Z" }] }],
});
let host: HTMLDivElement, root: Root;
const flush = () => act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); });
const mount = async (id = contact) => { await act(async () => root.render(<ClientActionItems contactId={id} clientName="Jordan Rivera" />)); await flush(); };
const refresh = () => host.querySelector<HTMLButtonElement>('button[aria-label="Refresh customer action items"]')!;
beforeEach(() => {
  Object.assign(f.context, { activeUserId: actor, activeTenantId: tenant, accountContextLoading: false, accountContextStatus: "ready" });
  f.rpc.mockReset().mockResolvedValue({ data: reply(), error: null });
  f.user.mockReset().mockResolvedValue({ data: { user: { id: actor } }, error: null }); f.listener = null;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

it("reads the original action/response for the authenticated actor, current business and selected contact", async () => {
  await mount();
  expect(f.rpc).toHaveBeenCalledExactlyOnceWith("list_pending_customer_actions", { _expected_actor_id: actor, _expected_tenant_id: tenant, _contact_id: contact });
  expect(host.textContent).toContain("Review your welcome guide"); expect(host.textContent).toContain("Which section first?");
  expect(host.textContent).toContain("Customer asked a question"); expect(host.querySelectorAll("time")).toHaveLength(2);
  expect(f.user).toHaveBeenCalledTimes(2);
});
it("distinguishes an authorized empty history from errors", async () => {
  f.rpc.mockResolvedValue({ data: { ...reply(), actions: [] }, error: null }); await mount();
  expect(host.textContent).toContain("No action items have been shared"); expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("shows a denied read without presenting a false empty or private records", async () => {
  f.rpc.mockResolvedValue({ data: null, error: { code: "42501" } }); await mount();
  expect(host.textContent).toContain("access to these action items could not be verified"); expect(host.textContent).not.toContain("No action items");
});
it("recovers an interrupted read with Refresh, without a write or retrying an action", async () => {
  f.rpc.mockResolvedValueOnce({ data: null, error: { code: "503" } }); await mount();
  expect(host.textContent).toContain("could not be loaded");
  await act(async () => refresh().click()); await flush(); expect(host.textContent).toContain("Which section first?");
  expect(f.rpc.mock.calls.map(x => x[0])).toEqual(["list_pending_customer_actions", "list_pending_customer_actions"]);
});
it("keeps consent client-controlled and paused access distinct from saved history", async () => {
  f.rpc.mockResolvedValue({ data: { ...reply(), access_state: "paused", shared_context_consent: false }, error: null }); await mount();
  expect(host.textContent).toContain("Portal access is paused"); expect(host.textContent).toContain("They control this consent in their Portal");
  expect(host.textContent).toContain("Which section first?"); expect(host.querySelector('[role="switch"],input')).toBeNull();
});
it("never labels an accepted action as completed or delivered", async () => {
  const r = reply(); r.actions[0].status = "customer_acted"; r.actions[0].responses[0].response_type = "accepted";
  f.rpc.mockResolvedValue({ data: r, error: null }); await mount();
  expect(host.textContent).toContain("Customer responded"); expect(host.textContent).toContain("Accepted");
  expect(host.textContent).not.toMatch(/completed|delivered|Marked complete/);
});
it("shows native expired status without changing the original record", async () => {
  const r = reply(); r.actions[0].is_expired = true; f.rpc.mockResolvedValue({ data: r, error: null }); await mount();
  expect(host.textContent).toContain("Expired"); expect(f.rpc).toHaveBeenCalledTimes(1);
});
it("preserves text as text and declares a bounded partial history", async () => {
  const r = reply(); r.actions[0].body = '<img src=x onerror="alert(1)">'; r.actions[0].more_responses = true; r.more_actions = true;
  f.rpc.mockResolvedValue({ data: r, error: null }); await mount();
  expect(host.textContent).toContain(r.actions[0].body); expect(host.querySelector("img")).toBeNull();
  expect(host.textContent).toContain("newest 100 responses"); expect(host.textContent).toContain("newest 100 action items");
});
for (const field of ["actor_id", "tenant_id", "contact_id"] as const) it(`refuses a mismatched ${field} even after a successful transport`, async () => {
  f.rpc.mockResolvedValue({ data: { ...reply(), [field]: other }, error: null }); await mount();
  expect(host.textContent).toContain("could not be loaded"); expect(host.textContent).not.toContain("Which section first?");
});
it("removes old-customer data immediately and ignores its late result after selection changes", async () => {
  let resolve!: (value: unknown) => void; f.rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount(); f.rpc.mockResolvedValue({ data: { ...reply(), contact_id: other, actions: [] }, error: null }); await mount(other);
  expect(host.textContent).toContain("No action items");
  await act(async () => resolve({ data: reply(), error: null })); await flush();
  expect(host.textContent).not.toContain("Which section first?");
});
it("clears the last business before a new business read and refuses its stale scope", async () => {
  await mount(); f.context.activeTenantId = other; f.rpc.mockResolvedValue({ data: reply(), error: null }); await mount();
  expect(host.textContent).not.toContain("Which section first?"); expect(host.textContent).toContain("could not be loaded");
});
it("clears a signed-out session and prevents a late original result from repainting", async () => {
  let resolve!: (value: unknown) => void; f.rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; })); await mount();
  await act(async () => f.listener!("SIGNED_OUT", null)); await act(async () => resolve({ data: reply(), error: null })); await flush();
  expect(host.textContent).toContain("could not be verified"); expect(host.textContent).not.toContain("Which section first?");
});
it("rechecks the authenticated actor before publishing a read", async () => {
  f.user.mockResolvedValueOnce({ data: { user: { id: actor } }, error: null }).mockResolvedValue({ data: { user: { id: other } }, error: null });
  await mount(); expect(host.textContent).toContain("could not be verified"); expect(host.textContent).not.toContain("Which section first?");
});
it("does not read through a resolving or failed workspace", async () => {
  f.context.accountContextLoading = true; await mount(); expect(f.rpc).not.toHaveBeenCalled(); expect(host.textContent).toContain("Checking your workspace");
  f.context.accountContextLoading = false; f.context.accountContextStatus = "error"; await mount();
  expect(f.rpc).not.toHaveBeenCalled(); expect(host.textContent).toContain("workspace access could not be verified");
});
it("bounds an interrupted transport and restores an actionable recovery state", async () => {
  vi.useFakeTimers(); f.rpc.mockImplementation(() => new Promise(() => undefined)); await mount();
  await act(async () => vi.advanceTimersByTimeAsync(20_001));
  expect(host.textContent).toContain("could not be loaded"); expect(refresh().disabled).toBe(false);
});
it("rejects expanded fields, duplicate ids, unknown status and malformed dates instead of painting unscoped data", () => {
  expect(() => parseOwnerCustomerActions({ ...reply(), private_history: [] }, scope)).toThrow();
  const dup = reply(); dup.actions.push(dup.actions[0]); expect(() => parseOwnerCustomerActions(dup, scope)).toThrow();
  const response = reply(); response.actions[0].responses.push(response.actions[0].responses[0]); expect(() => parseOwnerCustomerActions(response, scope)).toThrow();
  const invalid = reply(); Object.assign(invalid.actions[0], { status: "delivered" }); expect(() => parseOwnerCustomerActions(invalid, scope)).toThrow();
  const date = reply(); date.actions[0].updated_at = "invalid"; expect(() => parseOwnerCustomerActions(date, scope)).toThrow();
});
