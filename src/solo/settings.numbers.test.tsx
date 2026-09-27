import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloSettings } from "./settings";

/**
 * Buying a phone number is the first thing on this surface that SPENDS MONEY.
 *
 * So these tests are weighted toward the ways that goes wrong quietly: a search that
 * reaches nothing, a setup gap reported as an empty shelf, a purchase that says it
 * worked when the provider refused, and a Buy button offered to someone the server will
 * reject anyway. The panel this replaced was inert by design and said so, which meant
 * none of these failure modes could exist — and none of them were covered.
 *
 * The filters are covered too, because the owner asked for toll-free, region and
 * starts-with and it matters that each one actually reaches the request rather than
 * merely appearing in the form.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  owned: [] as unknown[],
  isAdmin: true as boolean | null,
  tenantId: "tenant-1971670" as string | null,
  rpcCalls: [] as Array<{ fn: string; args?: Record<string, unknown> }>,
  rpcError: null as { message: string; hint?: string } | null,
}));

vi.mock("@/hooks/useUserRoles", () => ({
  // The predicate the SERVER gates on (platform owner OR global admin/coach). Tied to the
  // same switch as the tenant-admin answer, so "someone the server would refuse" is
  // refused by BOTH halves — otherwise the authority row passes for want of one of them.
  useUserRoles: () => ({
    loading: false, userId: "u1", roles: state.isAdmin ? ["admin"] : [],
    isAdmin: state.isAdmin === true, isClient: false, isBroker: false,
    isStaff: state.isAdmin === true,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) =>
      // `current_user_tenant_id` is the resolver the WRITES use, so the reads now use it
      // too — a double that cannot answer it makes the surface look unidentifiable.
      fn === "tenant_phone_number_set_primary" || fn === "tenant_phone_number_rename"
        // The ARGUMENTS are recorded, not just the name. Recording only the name let a
        // `setPrimary` that passed the wrong id, or a `rename` that sent `friendly_name`
        // instead of the `_friendly_name` the RPC actually declares, satisfy every assertion
        // in this file — the double answers unconditionally, so nothing would notice.
        ? (state.rpcCalls.push({ fn, args }), state.rpcError ? { data: null, error: state.rpcError } : { data: {}, error: null })
        : fn === "current_user_tenant_id"
        ? { data: state.tenantId, error: state.tenantId ? null : { message: "no tenant" } }
        : fn === "is_current_user_tenant_admin"
          ? { data: state.isAdmin, error: null }
          : fn === "tenant_comms_readiness"
            ? { data: READINESS, error: null }
            : { data: null, error: null }),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: state.owned, error: null }),
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    })),
    functions: { invoke: (...args: unknown[]) => state.invoke(...args) },
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    activeTenantId: "tenant-1971670", loading: false, activeTenant: { account_number: "1971670" },
  }),
}));
vi.mock("@/lib/routing/useSubtabRoute", () => ({ useSubtabRoute: () => ["connections", vi.fn()] }));
vi.mock("./data/useSoloBusiness", () => ({
  useSoloBusiness: () => ({ name: "Test Workspace", brand: {}, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./data/useSoloOwner", () => ({
  useSoloOwner: () => ({ owner: { name: null, email: null, phone: null, website: null }, loading: false, error: null, refresh: vi.fn() }),
}));

const READINESS = {
  tenant_id: "tenant-1971670", can_send_sms: false, blocked_reason: "no_sms_number",
  subaccount: "connected", number: "absent", number_e164: null,
  business: { has_name: true, has_website: true, has_phone: true },
  a2p: "absent",
  consent: { granted_count: 0, suppressed_count: 0, state: "none_recorded" },
  delivery: { state: "none", sent_30d: 0, delivered_30d: 0, failed_30d: 0, last_inbound_at: null },
  billing: { subscription: "active", plan_name: "Solo", period_end: null, cancel_at_period_end: false, usage_metering: "not_recording", metered_events_30d: 0 },
};

const RESULT = {
  numbers: [{
    phone_number: "+14045550123", locality: "Atlanta", region: "GA",
    capabilities: { SMS: true, MMS: true, voice: true },
    retail_price: { monthly_cents: 120, onetime_cents: null, currency: "usd" },
  }],
  needs_config: false,
  price_configured: true,
};

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
  const tab = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Registration") as HTMLButtonElement | undefined;
  expect(tab, "Registration tab should render").toBeTruthy();
  await act(async () => { tab!.click(); });
}
function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label)) as HTMLButtonElement | undefined;
}
function buttonContaining(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label)) as HTMLButtonElement | undefined;
}
function field(placeholder: string): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!el) throw new Error(`no input ${JSON.stringify(placeholder)}`);
  return el;
}
function type(placeholder: string, value: string) {
  const el = field(placeholder);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function selectKind(value: string) {
  const el = [...host.querySelectorAll("select")].find((s) => s.value === "local" || s.value === "tollfree")!;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
async function search() {
  await act(async () => { button("Search numbers")?.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
/** The body of the last comms-search-numbers call. */
function lastSearchBody() {
  const call = [...state.invoke.mock.calls].reverse().find((c) => c[0] === "comms-search-numbers");
  return (call?.[1] as { body?: Record<string, unknown> } | undefined)?.body ?? {};
}

beforeEach(() => {
  state.invoke = vi.fn(async () => ({ data: RESULT, error: null }));
  state.owned = [];
  state.isAdmin = true;
  state.tenantId = "tenant-1971670";
  state.rpcCalls = [];
  state.rpcError = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Finding a number actually searches", () => {
  it("reaches the real seam instead of reporting that it cannot", async () => {
    await mount();
    await openRegistration();
    await search();
    expect(state.invoke.mock.calls.some((c) => c[0] === "comms-search-numbers")).toBe(true);
    // The old panel's copy must be gone, not merely outvoted by new copy.
    expect(text()).not.toContain("Number search is not connected yet");
  });

  it("renders a result with its price and what it can do", async () => {
    await mount();
    await openRegistration();
    await search();
    expect(text()).toContain("+14045550123");
    expect(text()).toContain("Atlanta, GA");
    expect(text()).toContain("$1.20/mo");
    expect(text()).toContain("text");
  });

  it("shows the real monthly price, reading the key the server actually sends", async () => {
    // The server's response key is `monthly_cents`; `retail_monthly_cents` is the DB
    // column behind it. Reading the column name made every price null while the server
    // reported the type as priced — so the row said "—" with no explanation and the
    // purchase confirm called a known amount "an unlisted monthly price".
    await mount();
    await openRegistration();
    await search();
    expect(text()).toContain("$1.20/mo");
    expect(text()).not.toContain("pricing pending");
  });

  it("says WHY a price is missing when the operator has not priced this type", async () => {
    state.invoke = vi.fn(async () => ({
      data: { numbers: [{ ...RESULT.numbers[0], retail_price: null }], needs_config: false, price_configured: false },
      error: null,
    }));
    await mount();
    await openRegistration();
    await search();
    expect(text()).toContain("no price on file yet");
  });

  it("passes the state, city and starts-with filters through", async () => {
    await mount();
    await openRegistration();
    type("404", "404");
    type("GA", "GA");
    type("Atlanta", "Atlanta");
    type("555", "555");
    await search();
    expect(lastSearchBody()).toMatchObject({
      number_type: "local", area_code: "404", in_region: "GA", in_locality: "Atlanta", starts_with: "555",
    });
  });

  it("searches toll-free WITHOUT an area code, because the prefix is the area code", async () => {
    await mount();
    await openRegistration();
    type("404", "404");
    selectKind("tollfree");
    await search();
    const body = lastSearchBody();
    expect(body.number_type).toBe("tollfree");
    expect(body.area_code, "sending both would contradict itself").toBeUndefined();
  });

  it("reports a setup gap as a setup gap, never as an empty shelf", async () => {
    // The §13 row. A workspace with no messaging account CANNOT buy; saying "no
    // numbers matched" would blame the search for something it did not do.
    state.invoke = vi.fn(async () => ({ data: { needs_config: true, message: "Messaging isn't set up yet.", numbers: [] }, error: null }));
    await mount();
    await openRegistration();
    await search();
    expect(text()).toContain("can't buy a number yet");
    expect(text()).toContain("Messaging isn't set up yet.");
    expect(text()).not.toContain("No numbers matched");
  });

  it("distinguishes a genuinely empty result from a setup gap", async () => {
    state.invoke = vi.fn(async () => ({ data: { numbers: [], needs_config: false, price_configured: true }, error: null }));
    await mount();
    await openRegistration();
    await search();
    expect(text()).toContain("No numbers matched");
    expect(text()).not.toContain("can't buy a number yet");
  });
});

describe("Buying a number spends money, and says so honestly", () => {
  it("asks before it charges, and does not buy when refused", async () => {
    await mount();
    await openRegistration();
    await search();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => { button("Buy")?.click(); });
    expect(confirm).toHaveBeenCalled();
    expect(confirm.mock.calls[0][0]).toContain("$1.20");
    expect(state.invoke.mock.calls.some((c) => c[0] === "comms-purchase-number")).toBe(false);
  });

  it("buys through the existing seam once confirmed", async () => {
    await mount();
    await openRegistration();
    await search();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    state.invoke = vi.fn(async () => ({ data: { purchased: true, phone_number: "+14045550123", twilio_sid: "PN4045550123" }, error: null }));
    await act(async () => { button("Buy")?.click(); });
    const call = state.invoke.mock.calls.find((c) => c[0] === "comms-purchase-number");
    expect(call).toBeTruthy();
    // toEqual, not toMatchObject. The amount the confirm just named has to REACH the
    // server: `comms-purchase-number` guards its price re-verification on
    // `if (agreedMonthlyCents !== null)`, so a body without it skips the check entirely
    // and a price that moved between the search and the click is simply charged. The
    // looser assertion this replaces passed either way, which is why the gap survived.
    expect((call?.[1] as { body?: Record<string, unknown> })?.body).toEqual({
      phone_number: "+14045550123",
      agreed_monthly_cents: 120,
    });
  });

  it("NEVER reports a refused purchase as a success", async () => {
    // Telling someone they own a number they do not is the worst outcome on this
    // surface: they stop looking, and nothing was bought.
    await mount();
    await openRegistration();
    await search();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    state.invoke = vi.fn(async () => ({ data: { error: "number_unavailable" }, error: null }));
    await act(async () => { button("Buy")?.click(); });
    expect(text()).not.toContain("is yours");
    expect(host.querySelector('.ss-outcome[data-tone="bad"]')).toBeTruthy();
  });

  it("treats needs_config on a purchase as a failure, not a purchase", async () => {
    await mount();
    await openRegistration();
    await search();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    state.invoke = vi.fn(async () => ({ data: { needs_config: true, error: "twilio_subaccount_not_provisioned" }, error: null }));
    await act(async () => { button("Buy")?.click(); });
    expect(text()).not.toContain("is yours");
  });
});

describe("A number you own is a number you can change", () => {
  const TWO = [
    { id: "n1", phone_number: "+14045550101", is_primary: false, status: "active", friendly_name: null },
    { id: "n2", phone_number: "+14045550102", is_primary: false, status: "active", friendly_name: null },
  ];

  it("says WHICH number the business sends from, and warns when nothing decides it", async () => {
    // `is_primary` is what voice-twiml and send-message use to pick the caller ID, and nothing
    // in the platform ever wrote it — so two numbers meant the one a client sees was decided by
    // row order. Silence here is what let that sit unnoticed.
    state.owned = TWO;
    await mount();
    expect(text()).toContain("Pick the number this business sends from");
    expect(text()).toContain("isn’t decided");
  });

  it("does not warn when one number already holds it", async () => {
    state.owned = [{ ...TWO[0], is_primary: true }, TWO[1]];
    await mount();
    expect(text()).not.toContain("Pick the number this business sends from");
    expect(text()).toContain("Sends from this");
  });

  it("changes which number the business sends from", async () => {
    state.owned = TWO;
    await mount();
    await act(async () => { buttonContaining("Send from this")?.click(); });
    const call = state.rpcCalls.find((c) => c.fn === "tenant_phone_number_set_primary");
    expect(call, "the set-primary RPC should have been called").toBeTruthy();
    // The id the server is told to make primary must be the row whose button was pressed.
    expect(call?.args?._id).toBe("n1");
    expect(text()).toContain("is now the number you send from");
  });

  it("NEVER reports a refused change as saved", async () => {
    state.owned = TWO;
    await mount();
    state.rpcError = { message: "NUMBER_NOT_ACTIVE", hint: "NUMBER_NOT_ACTIVE" };
    await act(async () => { buttonContaining("Send from this")?.click(); });
    expect(text()).not.toContain("is now the number you send from");
    expect(host.querySelector('.ss-outcome[data-tone="bad"]')).toBeTruthy();
    // The server named the reason; it must not arrive as "try again in a moment".
    expect(text()).toContain("isn’t active");
  });

  it("renames a number, and can clear the name again", async () => {
    state.owned = [{ ...TWO[0], friendly_name: "Intake line" }];
    await mount();
    await act(async () => { buttonContaining("Rename")?.click(); });
    type("Intake line", "");
    await act(async () => { buttonContaining("Save label")?.click(); });
    const call = state.rpcCalls.find((c) => c.fn === "tenant_phone_number_rename");
    expect(call, "the rename RPC should have been called").toBeTruthy();
    expect(call?.args?._id).toBe("n1");
    // The parameter name matters: the RPC declares `_friendly_name`, and "" is what CLEARS it.
    expect(call?.args).toHaveProperty("_friendly_name", "");
    expect(text()).toContain("Label cleared.");
  });

  it("offers no rename or send-from control to someone the server would refuse", async () => {
    state.owned = TWO;
    state.isAdmin = false;
    await mount();
    expect(buttonContaining("Send from this")).toBeUndefined();
    expect(buttonContaining("Rename")).toBeUndefined();
  });
});

describe("Authority", () => {
  it("shows no search or buy control to someone the server would refuse", async () => {
    // `comms-search-numbers` returns 403 unless the caller is a platform owner or holds
    // the global admin/coach role, so rendering the control to anyone else would be
    // rendering a button that always fails (§70). The surface mirrors that exact
    // predicate — an earlier comment here claimed it was tenant-admin, which would have
    // hidden the capability from a coach the server permits.
    state.isAdmin = false;
    await mount();
    await openRegistration();
    expect(button("Search numbers")).toBeUndefined();
    expect(text()).toContain("Only a workspace admin can change the numbers on this business");
  });
});
