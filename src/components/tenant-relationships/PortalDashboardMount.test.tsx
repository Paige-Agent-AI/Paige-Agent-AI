import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TenantRelationshipsClientsWorkspace } from "./TenantRelationshipsClientsWorkspace";
const fixture = vi.hoisted(() => ({ context: { activeTenantId: "test-tenant-a", activeUserId: "test-actor-a", activeTenant: { id: "test-tenant-a", name: "Test Service", account_type: "standalone", parent_tenant_id: null }, accountContextStatus: "ready", accountContextLoading: false }, mounts: 0 }));
vi.mock("@/hooks/useTenantContext", () => ({ useTenantContext: () => fixture.context }));
vi.mock("@/hooks/useTierFeatures", () => ({ useTierFeatures: () => ({ has: () => false }) }));
vi.mock("./useTenantRelationshipsData", () => ({ useTenantRelationshipsData: () => ({ people: [], peopleAvailable: true, peopleLoading: true, peopleError: false }) }));
vi.mock("./OwnerPortalDashboard", () => ({ OwnerPortalDashboard: ({ openClient }: { openClient: (id?: string) => void }) => { useEffect(() => { fixture.mounts += 1; }, []); return <div data-approved-dashboard><button type="button" onClick={() => openClient("test-contact-a")}>Open selected client</button><button type="button" onClick={() => openClient()}>Open client list</button></div>; } }));
let host: HTMLDivElement; let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Subject() { const location = useLocation(); return <><output>{location.pathname}{location.search}</output><TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={() => {}} /></>; }
async function show() { await act(async () => root.render(<MemoryRouter initialEntries={["/solo/1234567/clients/portal"]}><Routes><Route path="/solo/:account/*" element={<Subject />} /></Routes></MemoryRouter>)); }
beforeEach(() => { fixture.context = { activeTenantId: "test-tenant-a", activeUserId: "test-actor-a", activeTenant: { id: "test-tenant-a", name: "Test Service", account_type: "standalone", parent_tenant_id: null }, accountContextStatus: "ready", accountContextLoading: false }; fixture.mounts = 0; host = document.createElement("div"); root = createRoot(host); });
afterEach(() => act(() => root.unmount()));
it("mounts the approved dashboard on the real Solo Portal route without either rejected header", async () => { await show(); expect(host.querySelector("[data-approved-dashboard]")).not.toBeNull(); expect(host.textContent).not.toMatch(/Your client book|One relationship\. Two authorized views\./); expect(host.querySelector(".trc-panel--portal")).not.toBeNull(); });
it("opens a reloadable exact-contact People URL in the same Solo context", async () => { await show(); await act(async () => host.querySelector<HTMLButtonElement>("[data-approved-dashboard] button")!.click()); expect(host.querySelector("output")?.textContent).toBe("/solo/1234567/clients/people?person=test-contact-a"); expect(host.querySelector("[data-approved-dashboard]")).toBeNull(); });
it("retires the mounted dashboard on an authenticated actor change", async () => { await show(); expect(fixture.mounts).toBe(1); fixture.context.activeUserId = "test-actor-b"; await show(); expect(fixture.mounts).toBe(2); });
it("does not mount Portal records under unresolved accepted context", async () => { fixture.context.accountContextStatus = "resolving"; await show(); expect(host.querySelector("[data-approved-dashboard]")).toBeNull(); expect(host.textContent).toContain("Portal records stay closed"); });
