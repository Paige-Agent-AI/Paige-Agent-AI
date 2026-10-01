// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import ApolloIntegrationConfig from "./ApolloIntegrationConfig";
import IntegrationsHub from "./IntegrationsHub";

const backend = vi.hoisted(() => ({ from: vi.fn(), invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: backend.from, rpc: backend.rpc, functions: { invoke: backend.invoke },
} }));
vi.mock("@/components/admin/settings/CalendarConnectorsPanel", () => ({ CalendarConnectorsPanel: () => null }));
let root: Root;
let host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.clearAllMocks(); });

it("shows automatic enrichment as unavailable without reading or writing the retired setting", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  backend.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { apollo_auto_enrich: true } }) }) }) });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><ApolloIntegrationConfig /></MemoryRouter>));
  expect(host.textContent).toContain("Automatic enrichment is unavailable.");
  expect(host.querySelector('[role="switch"]')).toBeNull();
  expect(host.textContent).toContain("New contacts are not automatically sent to Apollo.");
  expect(host.textContent).toContain("Manual lookup");
  expect([...host.querySelectorAll("button")].filter(b => b.textContent === "Enrich")).toHaveLength(2);
  expect(backend.from).not.toHaveBeenCalled();
  expect(backend.invoke).not.toHaveBeenCalled();
});

it("never advertises retired automatic enrichment as enabled even with an old true setting", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const select = vi.fn();
  const response = { data: { apollo_auto_enrich: true }, count: 0, error: null };
  const chain = { select, eq: () => chain, gte: () => chain, maybeSingle: async () => response,
    then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve) };
  select.mockReturnValue(chain);
  backend.from.mockReturnValue(chain);
  backend.rpc.mockResolvedValue({ data: null });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><IntegrationsHub /></MemoryRouter>));
  expect(host.textContent).toContain("Auto-enrich unavailable");
  expect(host.textContent).not.toContain("Auto-enrich on");
  expect(select.mock.calls.every(([fields]) => !String(fields).includes("apollo_auto_enrich"))).toBe(true);
  expect(backend.invoke).not.toHaveBeenCalled();
  await act(async () => (host.querySelector('[aria-label="Open Apollo Enrichment details"]') as HTMLElement).click());
  const sheet = document.querySelector('[role="dialog"]');
  expect(sheet?.textContent).toContain("Automatic enrichment is unavailable.");
  expect(sheet?.textContent).not.toContain("Always on");
});
