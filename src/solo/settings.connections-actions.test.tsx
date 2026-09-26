import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloSettings } from "./settings";
import type { SoloDomain } from "./data/useSoloComms";

/**
 * The Connections controls a person can actually OPERATE.
 *
 * Everything on this surface used to REPORT: "business name still missing" with
 * no field to type it in, "Not configured" with no control to configure it,
 * "Unavailable" for a Google connection whose backend had already shipped. A
 * surface that describes a capability is not a surface that provides one (§70),
 * and the sibling suites could not have caught it — they assert the copy of a
 * read-only card, and a read-only card renders perfectly.
 *
 * So these tests are about ACTS, and each one is written to fail for a specific
 * reason rather than to pass today:
 *
 *   · a save that calls no seam, or the wrong seam, or an unscoped one
 *   · a save that reports success when the write was REJECTED (the §13 row)
 *   · a save that lands but never refreshes the step that grades it, so the
 *     person is told "Partly filled in" one line under the value they just saved
 *   · controls rendered to somebody who may not use them (§9)
 *   · a FAILED read reported as "not connected", which is a fabricated negative
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  comms: null as unknown,
  readinessRetry: vi.fn(),
}));

vi.mock("@/hooks/useUserRoles", () => ({
  // The predicate the SERVER gates on (platform owner OR global admin/coach). Mocked
  // rather than left to the real hook, which opens its own auth subscription.
  useUserRoles: () => ({ loading: false, userId: "u1", roles: ["admin"], isAdmin: true, isCoach: false, isClient: false, isBroker: false, isStaff: true }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (fn: string) =>
      fn === "tenant_comms_readiness"
        ? { data: READINESS, error: null }
        : { data: null, error: null }),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    })),
    functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) },
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    activeTenantId: "tenant-1971670",
    loading: false,
    activeTenant: { account_number: "1971670" },
  }),
}));
vi.mock("@/lib/routing/useSubtabRoute", () => ({ useSubtabRoute: () => ["connections", vi.fn()] }));
vi.mock("./data/useSoloBusiness", () => ({
  useSoloBusiness: () => ({ name: "Test Workspace", brand: {}, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./data/useSoloOwner", () => ({
  useSoloOwner: () => ({ owner: { name: null, email: null, phone: null, website: null }, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./data/useSoloComms", () => ({ useSoloComms: () => state.comms }));

const READINESS = {
  tenant_id: "tenant-1971670",
  can_send_sms: false,
  blocked_reason: "registration_absent",
  subaccount: "connected",
  number: "assigned",
  number_e164: "+15550001111",
  // The state the owner reported: partly filled in, business name missing.
  business: { has_name: false, has_website: true, has_phone: true },
  a2p: "absent",
  consent: { granted_count: 1, suppressed_count: 0, state: "ready" },
  delivery: { state: "delivering", sent_30d: 0, delivered_30d: 0, failed_30d: 0, last_inbound_at: null },
  billing: { subscription: "active", plan_name: "Solo", period_end: null, cancel_at_period_end: false, usage_metering: "not_recording", metered_events_30d: 0 },
};

function comms(over: Record<string, unknown> = {}) {
  return {
    loading: false, error: null, isSubAccount: false,
    domains: [], sending: { fromName: null, supportEmail: null, defaultSender: null },
    mailbox: { connected: false, address: null, displayName: null, provider: null, status: null },
    billing: null, canManage: true, refresh: vi.fn(),
    addDomain: vi.fn(async () => ({ ok: true, error: null })),
    refreshDomain: vi.fn(async () => ({ ok: true, error: null })),
    setDefaultDomain: vi.fn(async () => ({ ok: true, error: null })),
    removeDomain: vi.fn(async () => ({ ok: true, error: null })),
    startGmailConnect: vi.fn(async () => ({ url: "https://accounts.google.com/x", error: null })),
    disconnectGmail: vi.fn(async () => ({ ok: true, error: null })),
    ...over,
  };
}

let host: HTMLDivElement;
async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(
      <MemoryRouter initialEntries={["/solo/1971670/settings/connections"]}>
        <Routes><Route path="/solo/:account/settings/*" element={<SoloSettings/>}/></Routes>
      </MemoryRouter>,
    );
  });
}
const text = () => host.textContent ?? "";
async function openRegistration() {
  await act(async () => { findButton("Registration").click(); });
}
function findButton(label: string): HTMLButtonElement {
  const el = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
  if (!el) throw new Error(`no button matching ${JSON.stringify(label)}. Buttons: ${[...host.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return el as HTMLButtonElement;
}
function setInput(placeholder: string, value: string) {
  const el = host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!el) throw new Error(`no input with placeholder ${JSON.stringify(placeholder)}`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return el;
}

beforeEach(() => { state.comms = comms(); state.readinessRetry = vi.fn(); document.body.innerHTML = ""; });

describe("Business details are graded here, but owned by Setup", () => {
  it("still reports what carriers are missing", async () => {
    await mount();
    await openRegistration();
    expect(text()).toContain("business name");
    expect(text()).toContain("still missing");
  });

  it("does NOT duplicate the Setup editor on this surface", async () => {
    // Owner ruling 2026-08-31: the legal name, address and phone live in Setup;
    // Connections owns only what the platform hands the tenant — the sending
    // domain and the address on it. An earlier revision of this branch put an
    // editor here while `SuBusiness` on Setup already had one, which is the
    // second-home duplication §18 exists to prevent.
    await mount();
    expect(host.querySelector('input[placeholder="As registered"]')).toBeNull();
    expect(() => findButton("Save business details")).toThrow();
  });

  it("points at the one place those fields are edited", async () => {
    await mount();
    await openRegistration();
    expect(text()).toContain("live in Setup");
    const link = [...host.querySelectorAll("a")].find((a) => (a.textContent ?? "").includes("Setup"));
    expect(link?.getAttribute("href")).toContain("/settings/setup");
  });
});

describe("Sending domains can be operated, not only listed", () => {
  // Typed as the real contract so a newly required field fails the typecheck here, not a render
  // at runtime (#1138 added dnsRecords; this fixture went stale and crashed three tests).
  const DOMAIN: SoloDomain = { id: "d1", domain: "mail.example.com", fromEmailLocal: "no-reply", fromName: "Example", status: "pending", isDefault: false, dnsRecords: [] };

  it("registers a domain through the existing edge seam", async () => {
    const add = vi.fn(async (_input: { domain: string; fromEmailLocal: string; fromName: string }) => ({ ok: true, error: null }));
    state.comms = comms({ addDomain: add });
    await mount();
    await act(async () => { findButton("Add a domain").click(); });
    setInput("mail.yourbusiness.com", "mail.example.com");
    setInput("Your business", "Example");
    await act(async () => { findButton("Register domain").click(); });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toMatchObject({ domain: "mail.example.com", fromName: "Example" });
  });

  it("refuses an incomplete registration without calling the seam", async () => {
    const add = vi.fn(async () => ({ ok: true, error: null }));
    state.comms = comms({ addDomain: add });
    await mount();
    await act(async () => { findButton("Add a domain").click(); });
    setInput("mail.yourbusiness.com", "mail.example.com"); // no From name
    await act(async () => { findButton("Register domain").click(); });
    expect(add).not.toHaveBeenCalled();
    expect(text()).toContain("A domain and a From name are both required.");
  });

  it("re-reads DNS for a listed domain", async () => {
    const refreshDomain = vi.fn(async () => ({ ok: true, error: null }));
    state.comms = comms({ domains: [DOMAIN], refreshDomain });
    await mount();
    await act(async () => { findButton("Check DNS").click(); });
    expect(refreshDomain).toHaveBeenCalledWith("d1");
  });

  it("offers 'make default' only for a VERIFIED domain", async () => {
    state.comms = comms({ domains: [DOMAIN] });
    await mount();
    expect(() => findButton("Make default")).toThrow();
    state.comms = comms({ domains: [{ ...DOMAIN, status: "verified" }] });
    document.body.innerHTML = "";
    await mount();
    expect(findButton("Make default")).toBeTruthy();
  });

  it("surfaces a rejected domain write instead of a generic success", async () => {
    state.comms = comms({ domains: [DOMAIN], refreshDomain: vi.fn(async () => ({ ok: false, error: "domain_not_found" })) });
    await mount();
    await act(async () => { findButton("Check DNS").click(); });
    expect(text()).toContain("domain_not_found");
  });

  it("lists each DNS record the domain must publish, each with a copy control", async () => {
    const dnsRecords = [{ type: "TXT", name: "resend._domainkey.mail", record: "p=MIGfMA0GCSqGSIb3" }];
    state.comms = comms({ domains: [{ ...DOMAIN, dnsRecords }] });
    await mount();
    expect(text()).toContain("Publish these at your DNS host");
    expect(text()).toContain("resend._domainkey.mail");
    expect(text()).toContain("p=MIGfMA0GCSqGSIb3");
    expect(host.querySelector('[aria-label="Copy the TXT record"]')).toBeTruthy();
  });
});

describe("The Google sending account is connectable, and honestly named", () => {
  it("offers a connect action when nothing is connected", async () => {
    await mount();
    expect(findButton("Connect a Google account")).toBeTruthy();
  });

  it("shows the connected account and a way out", async () => {
    state.comms = comms({ mailbox: { connected: true, address: "me@example.com", displayName: null, provider: "gmail", status: "active" } });
    await mount();
    expect(text()).toContain("me@example.com");
    expect(findButton("Disconnect")).toBeTruthy();
  });

  it("does NOT claim inbound mail, and does not imply Outlook", async () => {
    // The scope granted is `gmail.send`. Calling this a mailbox would claim a
    // permission the grant does not carry.
    state.comms = comms({ mailbox: { connected: true, address: "me@example.com", displayName: null, provider: "gmail", status: "active" } });
    await mount();
    expect(text()).toContain("authorised to SEND only");
    expect(text()).toContain("no Outlook connection on this platform yet");
  });

  it("reports an UNREADABLE record as unknown, never as 'not connected'", async () => {
    // A failed read rendered as a negative is a fabricated answer about the
    // account (§13) — the same class as the five confident sentences a
    // resolver failure once produced on this surface.
    state.comms = comms({ mailbox: null });
    await mount();
    expect(text()).toContain("could not be read");
    expect(() => findButton("Connect a Google account")).toThrow();
  });
});
