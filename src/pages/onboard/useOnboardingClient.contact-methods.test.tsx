// The onboarding client is read with its contact methods: `email` and `phone` are its PRIMARY
// addresses (so Step 1 shows the phone already on file). Claiming a contact by the sign-in email
// matches any of a contact's emails; a failed lookup claims nothing and says why.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let linkedRow: unknown = null;
let methodsLookup: { data: unknown; error: { message: string } | null } = { data: [], error: null };

function chain(table: string) {
  const self: Record<string, unknown> = {};
  const result = () => (table === "client_contact_methods" ? methodsLookup : { data: linkedRow, error: null });
  for (const op of ["select", "eq", "limit", "in", "update"]) self[op] = () => self;
  self.maybeSingle = () => Promise.resolve(result());
  self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return self;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => chain(table),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1", email: "jordan@reyesbuild.co" } } }) },
  },
}));

const { useOnboardingClient } = await import("./useOnboardingClient");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let state: ReturnType<typeof useOnboardingClient> | null = null;
function Probe() { state = useOnboardingClient(); return null; }

let host: HTMLDivElement;
let root: Root;
async function mount() {
  await act(async () => { root.render(<Probe />); });
  await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
}

beforeEach(() => {
  state = null;
  linkedRow = null;
  methodsLookup = { data: [], error: null };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the onboarding client's addresses", () => {
  it("carries the PRIMARY email and phone from the contact's methods", async () => {
    linkedRow = {
      id: "c1", tenant_id: "t1", first_name: "Jordan", last_name: "Reyes", entity_name: null, linked_user_id: "u1",
      onboarding_stage: null, lifecycle_stage: null,
      client_contact_methods: [
        { id: "p2", kind: "phone", value: "+1 512 555 0190", label: null, is_primary: false, position: 1 },
        { id: "p1", kind: "phone", value: "+1 512 555 0148", label: null, is_primary: true, position: 0 },
        { id: "e1", kind: "email", value: "jordan@reyesbuild.co", label: null, is_primary: true, position: 0 },
      ],
    };
    await mount();
    expect(state?.client).toMatchObject({ email: "jordan@reyesbuild.co", phone: "+1 512 555 0148" });
    expect(state?.client).not.toHaveProperty("client_contact_methods");
  });

  it("a failed lookup by sign-in email claims nothing, and is logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    methodsLookup = { data: null, error: { message: "permission denied" } };
    await mount();
    expect(state?.error).toBe("no_client_record");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[onboarding]"), expect.anything());
    warn.mockRestore();
  });
});
