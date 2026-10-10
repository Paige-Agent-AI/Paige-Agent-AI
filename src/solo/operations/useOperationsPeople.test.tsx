import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tenant: "test-tenant-a", user: "test-user", loading: false,
  calls: [] as Array<{ resolve: (value: unknown) => void; args: unknown }>,
}));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => ({
  activeTenantId: harness.tenant, activeUserId: harness.user, loading: harness.loading,
}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (_name: string, args: unknown) =>
  new Promise((resolve) => harness.calls.push({ resolve, args })),
} }));
import { useOperationsPeople } from "./useOperationsPeople";

function Probe() {
  const value = useOperationsPeople();
  return <output data-error={value.error ?? ""} data-loading={String(value.loading)}>
    {value.members.map((member) => member.full_name).join(",")}
  </output>;
}
function roster(tenant: string, name: string) {
  return { data: { tenant_id: tenant, members: [{ user_id: name, full_name: name,
    avatar_url: `https://images.invalid/${name}.jpg`, status: "active" }],
    invitations: [], total_members: 1 }, error: null };
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  harness.tenant = "test-tenant-a"; harness.user = "test-user";
  harness.loading = false; harness.calls = [];
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("hides prior workspace people during switching and drops late photo/name responses", async () => {
  await act(async () => root.render(<Probe />));
  const a = harness.calls[0];
  harness.tenant = "test-tenant-b";
  await act(async () => root.render(<Probe />));
  await act(async () => a.resolve(roster("test-tenant-a", "Previous person")));
  expect(container.textContent).not.toContain("Previous person");
  await act(async () => harness.calls[1].resolve(roster("test-tenant-b", "Current person")));
  expect(container.textContent).toContain("Current person");
  harness.loading = true;
  await act(async () => root.render(<Probe />));
  expect(container.textContent).not.toContain("Current person");
});

it("rejects a server roster for another workspace and sends no tenant argument", async () => {
  await act(async () => root.render(<Probe />));
  expect(harness.calls[0].args).toEqual({ _search: null, _permission: "all", _limit: 200, _offset: 0 });
  await act(async () => harness.calls[0].resolve(roster("test-tenant-other", "Foreign person")));
  expect(container.textContent).not.toContain("Foreign person");
  expect(container.querySelector("output")?.getAttribute("data-error")).toBeTruthy();
});

it("clears faces on account identity changes within the same workspace", async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => harness.calls[0].resolve(roster("test-tenant-a", "Previous account person")));
  harness.user = "test-user-next";
  await act(async () => root.render(<Probe />));
  expect(container.textContent).not.toContain("Previous account person");
});
