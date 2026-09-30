// The internal client file's Email field is the contact's PRIMARY email. Saving a change sets that
// primary in the RECORD's own workspace (a platform owner may be viewing another workspace's
// contact), building on — and naming — the list the page read.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setContactPrimaryAddresses: vi.fn() }));
vi.mock("@/lib/contacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contacts")>()),
  setContactPrimaryAddresses: mocks.setContactPrimaryAddresses,
}));

const LOADED = [
  { id: "e1", kind: "email", value: "jordan@reyesbuild.co", label: null, is_primary: true, position: 0 },
  { id: "e2", kind: "email", value: "jordan.home@fastmail.com", label: null, is_primary: false, position: 1 },
];
const RECORD = {
  id: "c1", tenant_id: "tenant-b", first_name: "Jordan", last_name: "Reyes", entity_name: null, entity_type: null,
  funding_goal: null, monthly_revenue: null, current_notes: null, status: "active", linked_user_id: null,
  created_at: "2026-01-01T00:00:00Z", client_contact_methods: LOADED,
};

function chain(table: string) {
  const self: Record<string, unknown> = {};
  const result = () => (table === "clients" ? { data: RECORD, error: null } : { data: [], error: null, count: 0 });
  for (const op of ["select", "eq", "order", "limit", "in", "update"]) self[op] = () => self;
  self.maybeSingle = () => Promise.resolve(result());
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return self;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => chain(table) } }));
const stub = () => null;
vi.mock("./ReportUploadTab", () => ({ ReportUploadTab: stub }));
vi.mock("./OutreachCenter", () => ({ OutreachCenter: stub }));
vi.mock("./PMEFundingReadiness", () => ({ PMEFundingReadiness: stub }));
vi.mock("./ClientMemoryTab", () => ({ ClientMemoryTab: stub }));
vi.mock("./FundingApplicationLog", () => ({ FundingApplicationLog: stub }));
vi.mock("./AdminAccountManagement", () => ({ AdminAccountManagement: stub }));
vi.mock("./admin/AdminClientTools", () => ({ AdminFactoryResetDialog: stub, AdminChatHistory: stub, AdminFundingOverride: stub }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { InternalClientFileView } = await import("./InternalClientFileView");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

beforeEach(() => {
  mocks.setContactPrimaryAddresses.mockReset().mockResolvedValue(LOADED);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("internal client file — the Email field", () => {
  it("a changed email is written in the record's own workspace, on the list the page read", async () => {
    await act(async () => { root.render(<InternalClientFileView clientId="c1" onBack={() => {}} />); });
    await settle();
    await act(async () => { button("Edit").click(); });

    const email = host.querySelector('input[type="email"]') as HTMLInputElement;
    expect(email.value).toBe("jordan@reyesbuild.co");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(email, "new@reyesbuild.co");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button("Save").click(); });
    await settle();

    expect(mocks.setContactPrimaryAddresses).toHaveBeenCalledWith("c1", { email: "new@reyesbuild.co" }, { tenantId: "tenant-b", loaded: LOADED });
  });
});
