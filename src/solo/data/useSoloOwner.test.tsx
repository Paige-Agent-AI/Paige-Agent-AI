import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSoloOwner, type SoloOwnerData } from "./useSoloOwner";

const mocks = vi.hoisted(() => ({
  profile: { full_name: "Dana Whitfield", avatar_url: null, website_url: "brightpath.example" } as Record<string, unknown>,
  methods: [] as unknown[],
  selects: [] as Array<{ table: string; columns: string }>,
  update: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1", email: "dana@signin.example", user_metadata: {} } } }) },
    from: (table: string) => ({
      select: (columns: string) => {
        mocks.selects.push({ table, columns });
        return table === "profiles"
          ? { eq: () => ({ maybeSingle: async () => ({ data: mocks.profile, error: null }) }) }
          : { eq: async () => ({ data: mocks.methods, error: null }) };
      },
      update: (patch: unknown) => { mocks.update(table, patch); return { eq: async () => ({ error: null }) }; },
    }),
    rpc: vi.fn(),
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let latest: SoloOwnerData;
function Probe() { latest = useSoloOwner(); return null; }
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

beforeEach(() => {
  mocks.methods = []; mocks.selects = []; mocks.update.mockReset();
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); });

describe("Setup › Owner reads email and phone from the owner's contact methods", () => {
  it("shows the primary email and phone, and never reads the retired profile columns", async () => {
    mocks.methods = [
      { id: "e2", kind: "email", value: "dana.personal@example.com", label: "Personal", is_primary: false, position: 1 },
      { id: "e1", kind: "email", value: "dana@brightpath.example", label: "Work", is_primary: true, position: 0 },
      { id: "p1", kind: "phone", value: "(404) 555-0188", label: "Mobile", is_primary: true, position: 0 },
    ];
    await act(async () => { root.render(<Probe />); });
    await flush();
    expect(latest.owner.email).toBe("dana@brightpath.example");
    expect(latest.owner.phone).toBe("(404) 555-0188");
    expect(latest.contact.methods.map((m) => m.id)).toEqual(["e1", "e2", "p1"]);
    const profileRead = mocks.selects.find((s) => s.table === "profiles")!;
    expect(profileRead.columns).not.toMatch(/work_email|phone/);
    expect(mocks.selects.some((s) => s.table === "user_contact_methods")).toBe(true);
  });

  it("falls back to the sign-in address when no email is recorded, and to nothing for a phone", async () => {
    await act(async () => { root.render(<Probe />); });
    await flush();
    expect(latest.owner.email).toBe("dana@signin.example");
    expect(latest.owner.phone).toBeNull();
  });

  it("saves only the name and website to the profile row", async () => {
    await act(async () => { root.render(<Probe />); });
    await flush();
    await act(async () => { await latest.saveOwner({ full_name: "Dana W.", website_url: "" }); });
    expect(mocks.update).toHaveBeenCalledWith("profiles", { full_name: "Dana W.", website_url: null });
  });
});
