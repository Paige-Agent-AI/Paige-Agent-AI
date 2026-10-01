// Lane 6b: the screens and hooks that read or wrote a person's `profiles.phone` /
// `profiles.work_email` now read their primary contact methods and write through
// `set_user_contact_methods`, naming the list they read (`p_expected`). The fake profile row still
// carries the OLD column value, so a test fails on code that reads the column; and each screen is
// driven through its real save, so a test also fails when the contact-method write is removed.

import { act } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, type UseQueryResult } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const db = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  methods: [] as Array<Record<string, unknown>>,
  methodsReadError: null as { message: string } | null,
  business: null as Record<string, unknown> | null,
  selects: [] as Array<{ table: string; columns: string }>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>,
  upserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  /** Every write, in the order it happened. */
  writes: [] as string[],
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const listFor = (table: string) => {
    if (table === "user_contact_methods") {
      return db.methodsReadError ? { data: null, error: db.methodsReadError } : { data: db.methods, error: null };
    }
    if (table === "businesses") return { data: db.business ? [db.business] : [], error: null };
    return { data: [], error: null };
  };
  const singleFor = (table: string) => {
    if (table === "profiles") return db.profile;
    if (table === "businesses") return db.business;
    return null;
  };
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    Object.assign(b, {
      eq: self, order: self, limit: self, in: self,
      maybeSingle: async () => ({ data: singleFor(table), error: null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(listFor(table)).then(res, rej),
    });
    return b;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "u1", email: "dana@signin.example", identities: [] } } }) },
      from: (table: string) => ({
        select: (columns: string) => { db.selects.push({ table, columns }); return builder(table); },
        update: (patch: Record<string, unknown>) => {
          db.updates.push({ table, patch });
          db.writes.push(`update:${table}`);
          return { eq: async () => ({ error: null }) };
        },
        upsert: async (payload: Record<string, unknown>) => {
          db.upserts.push({ table, payload });
          db.writes.push(`upsert:${table}`);
          return { error: null };
        },
        insert: async () => { db.writes.push(`insert:${table}`); return { error: null }; },
      }),
      rpc: (...args: unknown[]) => db.rpc(...args),
      channel: () => channel,
      removeChannel: () => undefined,
      functions: { invoke: async () => ({ data: null, error: null }) },
    },
  };
});

const toasts = vi.hoisted(() => ({ ui: vi.fn(), sonnerError: vi.fn(), sonnerSuccess: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toasts.ui }), toast: toasts.ui }));
vi.mock("sonner", () => ({ toast: { success: toasts.sonnerSuccess, error: toasts.sonnerError } }));
vi.mock("@/contexts/DashboardModeContext", () => ({ useDashboardMode: () => ({ mode: "client", setMode: vi.fn(), isAdmin: false }) }));
vi.mock("@/components/settings/AccountSecurityPanel", () => ({ AccountSecurityPanel: () => null }));
vi.mock("@/components/dashboard/DataPrivacyPanel", () => ({ DataPrivacyPanel: () => null }));
vi.mock("@/components/dashboard/NotificationsSettings", () => ({ NotificationsSettings: () => null }));
vi.mock("@/components/admin/settings/CalendarConnectorsPanel", () => ({ CalendarConnectorsPanel: () => null }));
vi.mock("@/components/ui/LiveSyncIndicator", () => ({ LiveSyncIndicator: () => null }));
vi.mock("@/integrations/auth/oauth", () => ({ linkOAuthIdentity: vi.fn() }));
vi.mock("@/components/ui/avatar-uploader", () => ({ AvatarUploader: () => null, isAvatarBucketUrl: () => false, removeAvatarObject: vi.fn() }));
vi.mock("@/lib/playbook", () => ({ usePlaybook: () => ({ persona: { name: "Paige" } }) }));
vi.mock("@/components/onboarding/DemographicQuestionsStep", () => ({
  DemographicQuestionsStep: () => null,
  EMPTY_ANSWERS: {},
  saveDemographicAnswers: vi.fn(async () => undefined),
}));
vi.mock("@/hooks/useTenantFeature", () => ({ useTenantFeature: () => ({ enabled: false, loading: false }) }));
vi.mock("@/lib/functions/adminAccountActions", () => ({ callAdminAccountAction: vi.fn() }));

const audit = vi.hoisted(() => ({ input: null as Record<string, unknown> | null }));
vi.mock("@/lib/separationAudit", () => ({
  runSeparationAudit: (input: Record<string, unknown>) => { audit.input = input; return { score: 100, issues: [] }; },
}));

import { useProfileSnapshot } from "@/hooks/useProfileSnapshot";
import { useSeparationAudit } from "@/hooks/useSeparationAudit";
import { downloadMyUserData } from "@/lib/downloadMyUserData";
import { shouldOfferOnboarding } from "@/lib/onboardingOffer";
import { ProfileSettings } from "@/components/dashboard/ProfileSettings";
import { OnboardingFlow } from "@/components/dashboard/OnboardingFlow";
import { MemberProfileDrawer, type MemberProfile } from "@/components/admin/MemberProfileDrawer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
let host: HTMLDivElement;
let root: Root;

const methodRow = (id: string, kind: string, value: string, is_primary: boolean, position: number, label: string | null) =>
  ({ id, user_id: "u1", kind, value, label, is_primary, position });

// What the person keeps, and — exactly as read — what a save must name as the list it replaces.
const STORED = () => [
  methodRow("e1", "email", "dana@signin.example", true, 0, "Sign-in"),
  methodRow("p2", "phone", "(404) 555-0199", false, 1, "Home"),
  methodRow("p1", "phone", "(404) 555-0188", true, 0, "Mobile"),
];
const STORED_AS_EXPECTED = [
  { kind: "email", value: "dana@signin.example", label: "Sign-in", is_primary: true },
  { kind: "phone", value: "(404) 555-0188", label: "Mobile", is_primary: true },
  { kind: "phone", value: "(404) 555-0199", label: "Home", is_primary: false },
];

beforeEach(() => {
  // The retired columns still hold a stale value: reading them is the defect under test.
  db.profile = { full_name: "Dana Whitfield", phone: "OLD-COLUMN-PHONE", work_email: "old@column.example", address: "12 Elm St", city: "Macon", state: "GA", postal_code: "31201", avatar_url: null, primary_goal: null, goal_amount: null };
  db.methods = STORED();
  db.methodsReadError = null;
  db.business = { id: "b1", legal_name: "Brightpath LLC", business_phone: "(404) 555-0100" };
  db.selects = []; db.updates = []; db.upserts = []; db.writes = []; audit.input = null;
  toasts.ui.mockReset(); toasts.sonnerError.mockReset(); toasts.sonnerSuccess.mockReset();
  db.rpc.mockReset();
  db.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === "get_profile_with_pii_log") return { data: [db.profile], error: null };
    if (name === "set_user_contact_methods") {
      db.writes.push("rpc:set_user_contact_methods");
      const list = args.p_methods as Array<Record<string, unknown>>;
      return { data: list.map((p, i) => ({ id: `s${i}`, user_id: "u1", position: i, ...p })), error: null };
    }
    return { data: null, error: null };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

const profileSelects = () => db.selects.filter((s) => s.table === "profiles").map((s) => s.columns);
const contactWrites = () => db.rpc.mock.calls.filter(([name]) => name === "set_user_contact_methods").map(([, args]) => args as Record<string, unknown>);

describe("useProfileSnapshot (Paige chat's already-known fields)", () => {
  it("knows the person's phone from their primary phone contact method, not the profile column", async () => {
    let snap: ReturnType<typeof useProfileSnapshot>["snapshot"] | null = null;
    function Probe() { snap = useProfileSnapshot("u1").snapshot; return null; }
    act(() => root.render(<Probe />));
    await flush();
    expect(snap!.phone).toBe("(404) 555-0188");
    expect(profileSelects().join(" ")).not.toMatch(/\bphone\b|work_email/);
  });
});

describe("useSeparationAudit (personal vs business separation)", () => {
  it("compares the business against the person's primary phone contact method", async () => {
    let q: UseQueryResult<unknown> | null = null;
    function Probe() { q = useSeparationAudit("u1"); return null; }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>));
    await flush();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(q!.isSuccess).toBe(true);
    expect(audit.input?.personalPhone).toBe("(404) 555-0188");
    expect(profileSelects().join(" ")).not.toMatch(/\bphone\b|work_email/);
  });
});

describe("downloadMyUserData (the person's own data export)", () => {
  const captureExport = async () => {
    let exported: Record<string, unknown> | null = null;
    const RealBlob = globalThis.Blob;
    class CaptureBlob extends RealBlob {
      constructor(parts: BlobPart[], options?: BlobPropertyBag) { super(parts, options); exported = JSON.parse(String(parts[0])); }
    }
    vi.stubGlobal("Blob", CaptureBlob);
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      await downloadMyUserData();
    } finally {
      vi.unstubAllGlobals();
      click.mockRestore();
    }
    return exported! as Record<string, unknown>;
  };

  it("exports every email and phone the person keeps, primary first", async () => {
    const exported = await captureExport();
    expect(exported.contact_methods).toEqual(STORED_AS_EXPECTED);
    expect(exported).not.toHaveProperty("contact_methods_error");
  });

  it("records a failed read as a failure, never as an empty list", async () => {
    db.methodsReadError = { message: "permission denied" };
    const exported = await captureExport();
    expect(exported.contact_methods).toBeNull();
    expect(exported.contact_methods_error).toMatch(/couldn't be read.*permission denied/);
  });
});

const setInput = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const buttonByText = (text: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const click = async (text: string) => {
  const button = buttonByText(text);
  if (!button) throw new Error(`no button "${text}"`);
  act(() => { button.click(); });
  await flush();
};

describe("ProfileSettings › Personal (a person's own phone)", () => {
  const renderSettings = async () => {
    act(() => root.render(<MemoryRouter><ProfileSettings /></MemoryRouter>));
    await flush();
  };
  const editPhone = async (value: string) => {
    await click("Edit");
    const phone = host.querySelector<HTMLInputElement>("#phone")!;
    act(() => setInput(phone, value));
  };
  const lastToast = () => toasts.ui.mock.calls.at(-1)?.[0] as { title?: string; description?: string } | undefined;

  it("shows the primary phone contact method", async () => {
    await renderSettings();
    expect(host.textContent).toContain("(404) 555-0188");
    expect(host.textContent).not.toContain("OLD-COLUMN-PHONE");
  });

  it("saves a changed phone as the primary contact method, naming the list it read, and never writes the profile column", async () => {
    await renderSettings();
    await editPhone("(678) 555-0142");
    await click("Save Personal Information");

    const profileUpdate = db.updates.find((u) => u.table === "profiles");
    expect(profileUpdate).toBeTruthy();
    expect(profileUpdate!.patch).not.toHaveProperty("phone");
    expect(profileUpdate!.patch).not.toHaveProperty("work_email");
    expect(contactWrites()).toEqual([{
      p_user_id: "u1",
      p_methods: [
        { kind: "email", value: "dana@signin.example", label: "Sign-in", is_primary: true },
        { kind: "phone", value: "(678) 555-0142", label: "Mobile", is_primary: true },
        { kind: "phone", value: "(404) 555-0199", label: "Home", is_primary: false },
      ],
      p_expected: STORED_AS_EXPECTED,
    }]);
    // The phone goes first: a refusal there leaves nothing saved.
    expect(db.writes).toEqual(["rpc:set_user_contact_methods", "update:profiles"]);
  });

  it("builds the save on the list it showed, so another session's change is refused rather than overwritten", async () => {
    await renderSettings();
    // Someone else changes the stored list after this page read it.
    db.methods = [methodRow("p9", "phone", "(770) 555-0000", true, 0, "Mobile")];
    await editPhone("(678) 555-0142");
    await click("Save Personal Information");
    expect(contactWrites()[0].p_expected).toEqual(STORED_AS_EXPECTED);
  });

  it("after a save, shows the primary phone the server stored — not what was typed", async () => {
    await renderSettings();
    // Clearing the number: the server promotes the next phone the person keeps.
    await editPhone("");
    await click("Save Personal Information");
    expect(contactWrites()).toHaveLength(1);
    expect(host.querySelector("#phone")).toBeNull();
    expect(host.textContent).toContain("(404) 555-0199");
    await click("Edit");
    expect(host.querySelector<HTMLInputElement>("#phone")!.value).toBe("(404) 555-0199");
  });

  it("when someone else saved first: says so, saves nothing, and shows what is stored now", async () => {
    await renderSettings();
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "set_user_contact_methods") {
        db.methods = [methodRow("p9", "phone", "(770) 555-0000", true, 0, "Mobile")];
        return { data: null, error: { message: "CONTACT_METHODS_STALE: this list changed since it was loaded" } };
      }
      return { data: null, error: null };
    });
    await editPhone("(678) 555-0142");
    await click("Save Personal Information");
    expect(db.updates).toEqual([]);
    expect(lastToast()?.description).toMatch(/Someone else changed these contact details.*Nothing was saved/);
    expect(host.querySelector<HTMLInputElement>("#phone")!.value).toBe("(770) 555-0000");
  });

  it("when the list can't be re-read after a stale refusal, a second Save writes nothing — not the number it no longer shows", async () => {
    await renderSettings();
    db.rpc.mockImplementation(async (name: string) => {
      if (name === "set_user_contact_methods") {
        // Someone else saved first, and the re-read that should show their list then fails.
        db.methodsReadError = { message: "network down" };
        return { data: null, error: { message: "CONTACT_METHODS_STALE: this list changed since it was loaded" } };
      }
      return { data: null, error: null };
    });
    await editPhone("(678) 555-0142");
    await click("Save Personal Information");
    expect(contactWrites()).toHaveLength(1);
    expect(host.textContent).toContain("Your phone number couldn't be loaded");
    expect(host.querySelector<HTMLInputElement>("#phone")!.disabled).toBe(true);

    // The read recovers. The typed number is still held by the page, but no longer shown or editable,
    // so a second Save must not write it.
    db.methodsReadError = null;
    db.rpc.mockClear();
    db.updates = []; db.writes = [];
    await click("Save Personal Information");
    expect(contactWrites()).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(lastToast()?.description).toMatch(/couldn't be loaded, so nothing was saved/);
  });

  it("an invalid number is refused in words, before anything is saved", async () => {
    await renderSettings();
    await editPhone("555");
    await click("Save Personal Information");
    expect(contactWrites()).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(lastToast()?.description).toBe("A phone number needs 7 to 15 digits.");
  });

  it("an unchanged phone writes no contact methods", async () => {
    await renderSettings();
    await click("Edit");
    await click("Save Personal Information");
    expect(db.updates.some((u) => u.table === "profiles")).toBe(true);
    expect(contactWrites()).toEqual([]);
  });

  it("says when the phone could not be loaded, and never offers a blank field to save over it", async () => {
    db.methodsReadError = { message: "permission denied" };
    await renderSettings();
    expect(host.textContent).toContain("Your phone number couldn't be loaded");
    await click("Edit");
    const phone = host.querySelector<HTMLInputElement>("#phone")!;
    expect(phone.disabled).toBe(true);
    expect(phone.getAttribute("aria-describedby")).toBe("phone-load-error");
    await click("Save Personal Information");
    expect(contactWrites()).toEqual([]);
    expect(db.updates.some((u) => u.table === "profiles")).toBe(true);
  });
});

describe("OnboardingFlow (first-run setup)", () => {
  const completeOnboarding = async (phone: string) => {
    const onComplete = vi.fn();
    act(() => root.render(<OnboardingFlow open onComplete={onComplete} />));
    await flush();
    await click("Get Started");
    const goal = Array.from(document.body.querySelectorAll("p")).find((p) => p.textContent === "Repair & Optimize Personal Credit")!;
    act(() => { goal.click(); });
    await click("Next");
    act(() => setInput(document.body.querySelector<HTMLInputElement>("#fullName")!, "Dana Whitfield"));
    act(() => setInput(document.body.querySelector<HTMLInputElement>("#phone")!, phone));
    await click("Next");
    const noBusiness = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes("No business yet"))!;
    act(() => { noBusiness.click(); });
    await click("Next");
    await click("Next");
    await click("Complete Setup");
    return onComplete;
  };

  it("saves a typed phone as the person's primary phone contact method", async () => {
    const onComplete = await completeOnboarding("(678) 555-0142");
    expect(onComplete).toHaveBeenCalled();
    expect(db.updates.find((u) => u.table === "profiles")!.patch).not.toHaveProperty("phone");
    expect(contactWrites()).toEqual([{
      p_user_id: "u1",
      p_methods: [
        { kind: "email", value: "dana@signin.example", label: "Sign-in", is_primary: true },
        { kind: "phone", value: "(678) 555-0142", label: "Mobile", is_primary: true },
        { kind: "phone", value: "(404) 555-0199", label: "Home", is_primary: false },
      ],
      p_expected: STORED_AS_EXPECTED,
    }]);
  });

  it("a blank phone is 'not given': it writes nothing and never removes a phone the person keeps", async () => {
    const onComplete = await completeOnboarding("   ");
    expect(onComplete).toHaveBeenCalled();
    expect(db.updates.some((u) => u.table === "profiles")).toBe(true);
    expect(contactWrites()).toEqual([]);
  });
});

describe("shouldOfferOnboarding (AppShell's first-run offer)", () => {
  it("is not offered to someone who keeps a primary phone, whatever the old column says", async () => {
    db.profile = { ...db.profile, address: null, phone: null };
    expect(await shouldOfferOnboarding("u1")).toBe(false);
  });

  it("is offered when there is no address and no primary phone contact method", async () => {
    db.profile = { ...db.profile, address: null, phone: "OLD-COLUMN-PHONE" };
    db.methods = [methodRow("e1", "email", "dana@signin.example", true, 0, "Sign-in")];
    expect(await shouldOfferOnboarding("u1")).toBe(true);
  });

  it("is not offered when the contact list can't be read — unknown is not 'no phone'", async () => {
    db.profile = { ...db.profile, address: null };
    db.methodsReadError = { message: "permission denied" };
    expect(await shouldOfferOnboarding("u1")).toBe(false);
  });

  it("is what AppShell asks", () => {
    const src = readFileSync(path.resolve(__dirname, "../../..", "src/pages/AppShell.tsx"), "utf8");
    expect(src).toMatch(/shouldOfferOnboarding\(user\.id\)\.then\(\(offer\) => \{\s*if \(offer\) setShowOnboarding\(true\);/);
    expect(src).not.toMatch(/data\.phone/);
  });
});

describe("MemberProfileDrawer (a teammate's phone and work email)", () => {
  const member: MemberProfile = {
    user_id: "u2", email: "morgan@signin.example", full_name: "Morgan Lee", created_at: "2026-01-01T00:00:00Z",
    last_sign_in_at: null, suspended_at: null, suspended_reason: null, roles: ["coach"], tenant_is_owner: false,
  };
  const renderDrawer = async () => {
    act(() => root.render(<MemberProfileDrawer member={member} open onOpenChange={() => undefined} initialEdit />));
    await flush();
  };
  const phoneInput = () => document.body.querySelector<HTMLInputElement>('input[placeholder="+1 555 555 5555"]');

  it("saves a changed phone through their contact methods, naming the list it read, and keeps it out of the profile upsert", async () => {
    await renderDrawer();
    expect(phoneInput()!.value).toBe("(404) 555-0188");
    expect(document.body.querySelector<HTMLInputElement>('input[placeholder="work@company.com"]')!.value).toBe("dana@signin.example");
    act(() => setInput(phoneInput()!, "(678) 555-0142"));
    await click("Save");
    expect(contactWrites()).toEqual([{
      p_user_id: "u2",
      p_methods: [
        { kind: "email", value: "dana@signin.example", label: "Sign-in", is_primary: true },
        { kind: "phone", value: "(678) 555-0142", label: "Mobile", is_primary: true },
        { kind: "phone", value: "(404) 555-0199", label: "Home", is_primary: false },
      ],
      p_expected: STORED_AS_EXPECTED,
    }]);
    const upsert = db.upserts.find((u) => u.table === "profiles")!;
    expect(upsert.payload).not.toHaveProperty("phone");
    expect(upsert.payload).not.toHaveProperty("work_email");
    expect(toasts.sonnerSuccess).toHaveBeenCalledWith("Profile saved");
  });

  it("builds the save on the list the drawer showed, so a change made since it opened is refused rather than overwritten", async () => {
    await renderDrawer();
    // Someone else changes their stored list while the drawer is open.
    db.methods = [methodRow("p9", "phone", "(770) 555-0000", true, 0, "Mobile")];
    act(() => setInput(phoneInput()!, "(678) 555-0142"));
    await click("Save");
    expect(contactWrites()).toHaveLength(1);
    expect(contactWrites()[0].p_expected).toEqual(STORED_AS_EXPECTED);
  });

  it("says when their email and phone could not be loaded, and writes neither", async () => {
    db.methodsReadError = { message: "permission denied" };
    await renderDrawer();
    expect(document.body.textContent).toContain("Their phone and work email couldn't be loaded");
    expect(phoneInput()).toBeNull();
    await click("Save");
    expect(contactWrites()).toEqual([]);
    expect(db.upserts.some((u) => u.table === "profiles")).toBe(true);
  });
});

// The remaining profiles-side reader, held to the same rule at the source: no read of the retired
// profile columns.
describe("no profile-column reads remain in ClientFileView", () => {
  it("src/components/dashboard/ClientFileView.tsx", () => {
    const src = readFileSync(path.resolve(__dirname, "../../..", "src/components/dashboard/ClientFileView.tsx"), "utf8");
    for (const [, cols] of src.matchAll(/from\("profiles"\)\s*\.select\(\s*"([^"]*)"/g)) {
      expect(cols).not.toMatch(/\bphone\b|\bwork_email\b/);
    }
    expect(src).not.toMatch(/\.update\(\{[^}]*\bphone\b[^}]*\}\)/);
  });
});
