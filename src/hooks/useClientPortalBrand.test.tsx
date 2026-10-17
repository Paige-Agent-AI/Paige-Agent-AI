import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useClientPortalBrandState, type ClientPortalBrandState } from "./useClientPortalBrand";

const f = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: f.rpc,
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
  },
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement, state: ClientPortalBrandState;
function Probe() { state = useClientPortalBrandState(); return null; }
const mount = async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => { f.rpc.mockReset(); host = document.createElement("div"); root = createRoot(host); });
afterEach(() => act(() => root.unmount()));

it("resolves a customer of one business to that business's brand", async () => {
  f.rpc.mockResolvedValue({ data: [{ tenant_id: "t1", tenant_name: "Northwind Studio", logo_url: null, primary_color: null }], error: null });
  await mount();
  expect(state).toMatchObject({ loading: false, error: false, multipleBusinesses: false, brand: { tenant_id: "t1" } });
});

it("reads the server's refusal to pick between businesses as a known answer, not a failure", async () => {
  f.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "select an authorized customer relationship" } });
  await mount();
  expect(state).toEqual({ brand: null, loading: false, error: false, multipleBusinesses: true });
});

it("keeps any other refusal a failure: whether this is a customer stays unknown", async () => {
  f.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied for function" } });
  await mount();
  expect(state).toEqual({ brand: null, loading: false, error: true, multipleBusinesses: false });
});

it("resolves a non-customer to no brand", async () => {
  f.rpc.mockResolvedValue({ data: [], error: null });
  await mount();
  expect(state).toEqual({ brand: null, loading: false, error: false, multipleBusinesses: false });
});
