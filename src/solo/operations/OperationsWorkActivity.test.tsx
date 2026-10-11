import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TeamMemberRecord } from "@/solo/team-workspace-contract";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), session: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, auth: { getSession: mock.session } } }));
import { OperationsWorkActivity } from "./OperationsWorkActivity";
let host: HTMLDivElement; let root: Root;
const data = { ok: true, item_id: "test-item-a", tenant_id: "test-tenant-a", actor_id: "test-actor-a",
  events: [{ recorded_at: "2026-10-10T12:00:00Z", action: "plan_update_item", actor_id: "test-actor-a", status: "blocked" }] };
const members = [{ user_id: "test-actor-a", full_name: "Example owner", avatar_url: null, status: "active" }] as TeamMemberRecord[];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.resetAllMocks(); mock.session.mockResolvedValue({ data: { session: { user: { id: "test-actor-a" } } }, error: null });
  mock.rpc.mockResolvedValue({ data, error: null }); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<OperationsWorkActivity actorId="test-actor-a" tenantId="test-tenant-a" itemId="test-item-a" members={members} />)); }
it("shows named recorded activity without inventing changed fields", async () => {
  await render(); expect(host.textContent).toContain("Work updated · Blocked"); expect(host.textContent).toContain("Example owner");
  expect(host.textContent).toContain("Older updates may omit"); expect(host.textContent).not.toContain("Priority changed");
});
it("rejects foreign-scope activity without exposing its events", async () => {
  mock.rpc.mockResolvedValue({ data: { ...data, tenant_id: "test-tenant-b" }, error: null }); await render();
  expect(host.textContent).toContain("Activity couldn’t be read"); expect(host.textContent).not.toContain("Work updated");
});
it("rejects actor changes during readback", async () => {
  mock.session.mockResolvedValueOnce({ data: { session: { user: { id: "test-actor-a" } } }, error: null })
    .mockResolvedValueOnce({ data: { session: { user: { id: "test-actor-b" } } }, error: null });
  await render(); expect(host.textContent).toContain("Activity couldn’t be read");
});
it("treats malformed event payload as unavailable", async () => {
  mock.rpc.mockResolvedValue({ data: { ...data, events: [{ ...data.events[0], action: "private_unrelated_action" }] }, error: null });
  await render(); expect(host.textContent).not.toContain("private_unrelated_action"); expect(host.textContent).toContain("Retry activity");
});
it("shows honest absence and recovers a refused read through the same source", async () => {
  mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } }).mockResolvedValueOnce({ data: { ...data, events: [] }, error: null });
  await render(); await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toContain("No activity is recorded"); expect(mock.rpc).toHaveBeenCalledTimes(2);
});
