import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloSettings } from "./settings";

/**
 * The three states Connections can actually be in, RENDERED.
 *
 * The existing rendered-copy suite uses `renderToStaticMarkup`, which never runs
 * effects — so every assertion it makes about this surface is made while all five
 * readiness cards still show "Clearing and resolving this account…". Neither the
 * populated state nor the failed-read state was exercised anywhere.
 *
 * That gap is not theoretical: it is exactly how a resolver failure came to
 * render five confident sentences of the form "No X record has been read for this
 * account yet" — statements about the ACCOUNT, made when nothing about the
 * account had been learned — with no error and no retry on the default view.
 * `COMMS_READINESS_FORBIDDEN` is raised for any authenticated caller who is not
 * admin / coach / platform-operator, so a sales_rep or an ungranted team member
 * saw that on every load.
 *
 * These mount for real and let the effects run.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mocked PER RPC NAME, not globally.
 *
 * A single shared mock fed `tenant_comms_readiness`'s error to
 * `resolve_tenant_domain_identity` as well, and the identity card renders
 * `error.message` verbatim — so the suite reported a leak that only the mock
 * created. Keying on the function name keeps each hook's failure its own.
 */
const rpcState = vi.hoisted(() => ({
  readiness: { data: null as unknown, error: null as { message: string } | null },
  identity: { data: null as unknown, error: null as { message: string } | null },
  commsError: null as string | null,
  commsLoading: false,
  mailboxConnected: false,
  tenantId: "tenant-1971670",
  userId: "u1",
  tenantLoading: false,
}));

vi.mock("@/hooks/useUserRoles", () => ({
  // The predicate the SERVER gates on (platform owner OR global admin/coach). Mocked
  // rather than left to the real hook, which opens its own auth subscription.
  useUserRoles: () => ({ loading: false, userId: "u1", roles: ["admin"], isAdmin: true, isClient: false, isBroker: false, isStaff: true }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn((fn: string) => Promise.resolve(
      fn === "tenant_comms_readiness" ? rpcState.readiness
        : fn === "resolve_tenant_domain_identity" ? rpcState.identity
          : { data: null, error: null },
    )),
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({
    activeTenantId: rpcState.tenantId,
    activeUserId: rpcState.userId,
    loading: rpcState.tenantLoading,
    activeTenant: { account_number: rpcState.tenantId === "tenant-1971670" ? "1971670" : "2000000" },
  }),
}));
vi.mock("@/lib/routing/useSubtabRoute", () => ({ useSubtabRoute: () => ["connections", vi.fn()] }));
vi.mock("./data/useSoloBusiness", () => ({
  useSoloBusiness: () => ({ name: "First Sterling Capital", brand: { website: null, business_phone: null, industry: null }, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./data/useSoloOwner", () => ({
  useSoloOwner: () => ({ owner: { name: "Antonio Cook", email: null, phone: null, website: null }, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./data/useSoloComms", () => ({
  useSoloComms: () => ({ business: { name: "", website: "", phone: "" }, mailbox: rpcState.commsLoading ? null : { connected: rpcState.mailboxConnected, address: rpcState.mailboxConnected ? "google@example.com" : null, displayName: null, provider: rpcState.mailboxConnected ? "gmail" : null, status: rpcState.mailboxConnected ? "active" : null }, canManage: true, saveBusiness: vi.fn(async () => ({ ok: true, error: null })), addDomain: vi.fn(async () => ({ ok: true, error: null })), refreshDomain: vi.fn(async () => ({ ok: true, error: null })), setDefaultDomain: vi.fn(async () => ({ ok: true, error: null })), removeDomain: vi.fn(async () => ({ ok: true, error: null })), startGmailConnect: vi.fn(async () => ({ url: null, error: null })), disconnectGmail: vi.fn(async () => ({ ok: true, error: null })), domains: [], billing: null, loading: rpcState.commsLoading, error: rpcState.commsError, refresh: vi.fn() }),
}));

const READY = {
  tenant_id: "tenant-1971670",
  can_send_sms: false,
  blocked_reason: "registration_absent",
  subaccount: "connected",
  number: "assigned",
  number_e164: "+15550001111",
  business: { has_name: true, has_website: true, has_phone: true },
  a2p: "absent",
  consent: { granted_count: 2, suppressed_count: 0, state: "ready" },
  delivery: { state: "delivering", sent_30d: 5, delivered_30d: 4, failed_30d: 1, last_inbound_at: null },
  billing: { subscription: "active", plan_name: "Solo", period_end: null, cancel_at_period_end: false, usage_metering: "not_recording", metered_events_30d: 0 },
};

async function mountConnections() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/solo/1971670/settings/connections"]}>
        <Routes><Route path="/solo/:account/settings/:tab" element={<SoloSettings />} /></Routes>
      </MemoryRouter>,
    );
  });
  return { host, root, cleanup: async () => { await act(async () => root.unmount()); host.remove(); } };
}

async function openArea(host: HTMLDivElement, label: string) {
  const tab = Array.from(host.querySelectorAll('button[role="tab"]'))
    .find((button) => button.textContent === label) as HTMLButtonElement | undefined;
  expect(tab, label + " tab should render").toBeTruthy();
  await act(async () => { tab!.click(); });
}

describe("Connections renders its real states", () => {
  beforeEach(() => { rpcState.readiness = { data: null, error: null }; rpcState.identity = { data: null, error: null }; rpcState.commsError = null; rpcState.commsLoading = false; rpcState.mailboxConnected = false; rpcState.tenantId = "tenant-1971670"; rpcState.userId = "u1"; rpcState.tenantLoading = false; });

  it("says the READ failed — it does not report an empty account", async () => {
    rpcState.readiness = { data: null, error: { message: "COMMS_READINESS_FORBIDDEN" } };
    const { host, cleanup } = await mountConnections();
    const text = host.textContent ?? "";

    expect(text).toContain("We couldn’t read this account’s setup");
    expect(Array.from(host.querySelectorAll("button")).some((b) => b.textContent === "Try again")).toBe(true);

    // The failure must never be dressed up as a fact about the account.
    for (const kind of ["number", "registration", "consent", "delivery", "billing"]) {
      expect(text).not.toContain(`No ${kind} record has been read for this account yet.`);
    }
    // And the raw resolver diagnostic never reaches the tenant.
    expect(text).not.toContain("COMMS_READINESS");
    await cleanup();
  });

  it("reports the account when the read SUCCEEDS (non-vacuity for the case above)", async () => {
    rpcState.readiness = { data: READY, error: null };
    const { host, cleanup } = await mountConnections();
    const communications = host.textContent ?? "";

    // Communications proves the active method while keeping setup and health out.
    expect(communications).toContain("+15550001111");
    expect(communications).not.toContain("4 of 5 delivered");
    expect(communications).not.toContain("Messaging registration");
    expect(communications).not.toContain("We couldn’t read this account’s setup");
    expect(communications).not.toContain("Clearing and resolving this account");

    await openArea(host, "Health");
    expect(host.textContent ?? "").toContain("4 of 5 delivered");
    expect(host.textContent ?? "").toContain("Whether replies are arriving is not reported");

    await openArea(host, "Registration");
    expect(host.textContent ?? "").toContain("Messaging registration");
    expect(host.textContent ?? "").toContain("Consent and opt-outs");
    await cleanup();
  });

  it("shows a step the same number in the card AND in the ladder", async () => {
    rpcState.readiness = { data: READY, error: null };
    const { host, cleanup } = await mountConnections();
    const numbersFor = (name: string) =>
      Array.from(host.querySelectorAll(".ss-step"))
        .filter((el) => el.querySelector(".ss-step-name strong")?.textContent === name)
        .map((el) => el.querySelector(".ss-step-idx")?.textContent);

    // The registration summary card carries the same numbered step.
    await openArea(host, "Registration");
    const inCard = numbersFor("Business details");
    expect(inCard).toEqual(["2"]);

    // Now the LADDER, which lives on the other view. An earlier version of this
    // test never switched, so the ladder was never in the DOM and the whole
    // component could be deleted with the test still green — it asserted a
    // cross-rendering agreement while only ever seeing one rendering.
    await openArea(host, "Health");

    const inLadder = numbersFor("Business details");
    expect(inLadder).toEqual(["2"]);
    // The ladder really is rendered now, not an empty list agreeing by default.
    expect(host.querySelectorAll(".ss-step").length).toBeGreaterThan(4);
    await cleanup();
  });

  it("stops the CARD claiming replies are unrecorded once the resolver reports them", async () => {
    // The step's detail was made conditional and the note beside it was left
    // absolute, so the card would have gone silent in one sentence and still
    // asserted "nothing on this account records them" in the next — the same
    // one-record-two-answers the conditional was added to remove.
    rpcState.readiness = { data: { ...READY, delivery: { ...READY.delivery, inbound_reporting: "available" } }, error: null };
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Health");
    const text = host.textContent ?? "";
    expect(text).not.toContain("Replies and webhook health are");
    expect(text).not.toContain("Whether replies are arriving is not reported");
    // Webhook health genuinely has no record either way, so it must still say so.
    expect(text).toContain("Webhook health is");
    await cleanup();
  });

  it("DOES say replies are unrecorded while the resolver says so (non-vacuity)", async () => {
    rpcState.readiness = { data: READY, error: null };   // inbound_reporting absent = unavailable
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Health");
    expect(host.textContent ?? "").toContain("Replies and webhook health are");
    await cleanup();
  });

  it("does not claim texting is not ready when the read itself failed", async () => {
    // The Health card headlined "Texting is not ready yet" over the failed-read
    // block — a definite claim about the account, one line above a sentence
    // saying nothing is being claimed about it.
    rpcState.readiness = { data: null, error: { message: "COMMS_READINESS_FORBIDDEN" } };
    const { host, cleanup } = await mountConnections();
    const health = Array.from(host.querySelectorAll('button[role="tab"]'))
      .find((b) => b.textContent === "Health") as HTMLButtonElement | undefined;
    await act(async () => { health!.click(); });

    const text = host.textContent ?? "";
    expect(text).toContain("We couldn\u2019t read this account\u2019s setup");
    expect(text).not.toContain("Texting is not ready yet");
    expect(text).not.toContain("Ready to text");
    await cleanup();
  });

  it("DOES say texting is not ready when the read succeeded and it is not (non-vacuity)", async () => {
    rpcState.readiness = { data: READY, error: null };
    const { host, cleanup } = await mountConnections();
    const health = Array.from(host.querySelectorAll('button[role="tab"]'))
      .find((b) => b.textContent === "Health") as HTMLButtonElement | undefined;
    await act(async () => { health!.click(); });
    // READY has `can_send_sms: false`, so the claim is true here and must appear.
    expect(host.textContent ?? "").toContain("Texting is not ready yet");
    await cleanup();
  });

  it("opens a focused setup drawer and returns focus after Escape", async () => {
    rpcState.readiness = { data: READY, error: null };
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    const trigger = host.querySelector<HTMLButtonElement>('[data-channel-option="sending"] .ss-add-option-action')!;
    trigger.focus();
    await act(async () => { trigger.click(); });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    expect(dialog?.textContent).toContain("Set up a sending identity");
    expect(dialog?.querySelector('[aria-label="Close setup"]')).toBeTruthy();
    expect(dialog?.querySelector('button[data-initial-focus]')).toBe(document.activeElement);

    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await cleanup();
  });

  it("clears setup state when the active workspace changes", async () => {
    rpcState.readiness = { data: READY, error: null };
    const { host, root, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    const trigger = host.querySelector<HTMLButtonElement>('[data-channel-option="phone"] .ss-add-option-action')!;
    await act(async () => { trigger.click(); });
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();

    rpcState.tenantId = "tenant-2000000";
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/solo/1971670/settings/connections"]}><Routes><Route path="/solo/:account/settings/:tab" element={<SoloSettings />} /></Routes></MemoryRouter>);
    });
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    await cleanup();
  });

  it("never paints the previous workspace sender or number while the next workspace resolves", async () => {
    rpcState.identity = { data: { default_email_sender: "owner@tenant-a.example", default_email_status: "active" }, error: null };
    rpcState.readiness = { data: { ...READY, tenant_id: "tenant-1971670", can_send_sms: true }, error: null };
    const { host, root, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    expect(host.textContent).toContain("owner@tenant-a.example");
    expect(host.textContent).toContain("+15550001111");

    let resolveIdentity!: (value: unknown) => void;
    let resolveReadiness!: (value: unknown) => void;
    rpcState.identity = new Promise((resolve) => { resolveIdentity = resolve; }) as never;
    rpcState.readiness = new Promise((resolve) => { resolveReadiness = resolve; }) as never;
    rpcState.tenantId = "tenant-2000000";
    await act(async () => {
      root.render(<MemoryRouter initialEntries={["/solo/2000000/settings/connections?segment=available"]}><Routes><Route path="/solo/:account/settings/:tab" element={<SoloSettings />} /></Routes></MemoryRouter>);
    });

    expect(host.textContent).not.toContain("owner@tenant-a.example");
    expect(host.textContent).not.toContain("+15550001111");
    expect(host.textContent).toContain("Checking your channel setup");
    expect(host.textContent).not.toContain("Best next step");

    await act(async () => {
      resolveIdentity({ data: null, error: null });
      resolveReadiness({ data: { ...READY, tenant_id: "tenant-2000000", number: "absent", number_e164: null }, error: null });
    });
    await cleanup();
  });

  it.each([
    ["provisioning", "Activation pending", "Continue setup"],
    ["failed", "Needs attention", "Review issue"],
    ["configured", "Configured, not verified", "Continue setup"],
  ])("does not call a %s sending identity connected or operating", async (status, label, action) => {
    rpcState.identity = { data: { default_email_sender: "sender@example.com", default_email_status: status }, error: null };
    rpcState.readiness = { data: READY, error: null };
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    const option = host.querySelector<HTMLElement>('[data-channel-option="sending"]')!;
    expect(option.textContent).toContain(label);
    expect(option.textContent).toContain(action);
    expect(host.querySelector(".ss-add-current")?.textContent).not.toContain("sender@example.com");
    await cleanup();
  });

  it("lists only canonically operating sender and phone channels", async () => {
    rpcState.identity = { data: { default_email_sender: "sender@example.com", default_email_status: "active" }, error: null };
    rpcState.readiness = { data: { ...READY, can_send_sms: true, a2p: "approved" }, error: null };
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    const operating = host.querySelector(".ss-add-current")?.textContent ?? "";
    expect(operating).toContain("sender@example.com");
    expect(operating).toContain("+15550001111");
    const next = host.querySelector(".ss-add-next")?.textContent ?? "";
    expect(next).toContain("Review calendar and booking");
    expect(next).not.toContain("Connect a calendar");
    await cleanup();
  });

  it("does not list an assigned but unregistered number as operating", async () => {
    rpcState.readiness = { data: READY, error: null };
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    expect(host.querySelector(".ss-add-current")?.textContent).not.toContain("+15550001111");
    expect(host.querySelector('[data-channel-option="phone"]')?.textContent).toContain("Registration required");
    await cleanup();
  });

  it("withholds the best-next claim while sources resolve or after any owning read fails", async () => {
    let resolveIdentity!: (value: unknown) => void;
    rpcState.identity = new Promise((resolve) => { resolveIdentity = resolve; }) as never;
    rpcState.readiness = { data: READY, error: null };
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    expect(host.textContent).toContain("Checking your channel setup");
    expect(host.textContent).not.toContain("Best next step");

    await act(async () => { resolveIdentity({ data: null, error: { message: "IDENTITY_READ_FAILED" } }); });
    expect(host.textContent).toContain("Next step unavailable");
    expect(host.textContent).not.toContain("Best next step");
    expect(host.textContent).not.toContain("IDENTITY_READ_FAILED");
    await cleanup();
  });

  it.each(["identity", "readiness", "communications"])("withholds the best-next claim when the %s read fails", async (source) => {
    rpcState.identity = source === "identity"
      ? { data: null, error: { message: "PRIVATE_IDENTITY_FAILURE" } }
      : { data: null, error: null };
    rpcState.readiness = source === "readiness"
      ? { data: null, error: { message: "PRIVATE_READINESS_FAILURE" } }
      : { data: READY, error: null };
    rpcState.commsError = source === "communications" ? "PRIVATE_COMMS_FAILURE" : null;
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    expect(host.textContent).toContain("Next step unavailable");
    expect(host.textContent).not.toContain("Best next step");
    expect(host.textContent).not.toContain("PRIVATE_");
    await cleanup();
  });

  it.each(["connected mailbox with failed identity read", "active identity with failed communications read"])("marks a mixed sending state for review: %s", async (scenario) => {
    const mailboxWins = scenario.startsWith("connected mailbox");
    rpcState.mailboxConnected = mailboxWins;
    rpcState.identity = mailboxWins
      ? { data: null, error: { message: "PRIVATE_IDENTITY_FAILURE" } }
      : { data: { default_email_sender: "sender@example.com", default_email_status: "active" }, error: null };
    rpcState.commsError = mailboxWins ? null : "PRIVATE_COMMS_FAILURE";
    rpcState.readiness = { data: READY, error: null };
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    const option = host.querySelector('[data-channel-option="sending"]')?.textContent ?? "";
    expect(option).toContain("Connected · failed check");
    expect(option).toContain("Review issue");
    expect(host.textContent).toContain("Next step unavailable");
    await cleanup();
  });

  it("keeps an active sending identity in checking state while communications is still loading", async () => {
    rpcState.identity = { data: { default_email_sender: "sender@example.com", default_email_status: "active" }, error: null };
    rpcState.commsLoading = true;
    rpcState.readiness = { data: READY, error: null };
    const { host, cleanup } = await mountConnections();
    await openArea(host, "Add channel");
    const option = host.querySelector('[data-channel-option="sending"]')?.textContent ?? "";
    expect(option).toContain("Connected · checking status");
    expect(option).not.toContain("failed check");
    expect(host.textContent).toContain("Checking your channel setup");
    await cleanup();
  });
});
