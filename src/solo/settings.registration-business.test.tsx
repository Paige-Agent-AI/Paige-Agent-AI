import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SoloSettings } from "./settings";
import { EMPTY_SOLO_SETUP_BRIEF } from "./settings-setup-contract";
import { EMPTY_PAIGE_PROFILE } from "./settings-business-context-contract";

/**
 * Registration as a SECOND EDITOR of the ONE canonical business record.
 *
 * The defect this file exists to close (§70): Registration tells an owner exactly which
 * carrier-required facts are missing — "tax or registration number, regions of operation,
 * authorized representative" — and then offers no way to supply any of them. The only path
 * is a link that leaves the surface. Reading the code proves the LINK is wired; it never
 * proved a person can FINISH the registration.
 *
 * The rule these tests encode is that a second EDITOR is not a second WRITER (§18/§57).
 * Registration edits the same record Setup edits, through the same canonical seam
 * (`save_solo_business_context`), with the same server-derived tenant, the same revision
 * check and the same Owner-only legal gate. It never writes `tenant_legal_profile` directly
 * and never introduces a parallel save.
 *
 * The most dangerous failure mode here is not a missed field. `save_solo_business_context`
 * REPLACES the submitted knowledge/voice/profile collections and REFUSES an Owner save that
 * omits them ("Complete business context is required for an Owner save"). So a Registration
 * save that fires before the business context has loaded, or that submits empty lists, would
 * destroy the owner's Setup knowledge bucket and Paige brief from a screen that never
 * mentions them. Three tests below exist solely to make that impossible.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  invoke: vi.fn(),
  tenantId: "tenant-1971670" as string | null,
  isAdmin: true as boolean | null,
  legal: { legal_business_name: "Test Workspace LLC", website_url: "https://example.com" } as Record<string, unknown> | null,
  registration: null as Record<string, unknown> | null,
  provider: {} as Record<string, unknown>,
  save: vi.fn(),
  refresh: vi.fn(),
  ctx: {} as Record<string, unknown>,
}));

const READINESS = {
  tenant_id: "tenant-1971670", can_send_sms: false, blocked_reason: "registration_absent",
  subaccount: "connected", number: "assigned", number_e164: "+14045550123",
  business: { has_name: true, has_website: true, has_phone: true },
  a2p: "absent",
  consent: { granted_count: 0, suppressed_count: 0, state: "none_recorded" },
  delivery: { state: "none", sent_30d: 0, delivered_30d: 0, failed_30d: 0, last_inbound_at: null },
  billing: { subscription: "active", plan_name: "Solo", period_end: null, cancel_at_period_end: false, usage_metering: "not_recording", metered_events_30d: 0 },
};

vi.mock("@/hooks/useUserRoles", () => ({
  useUserRoles: () => ({
    loading: false, userId: "u1", roles: state.isAdmin ? ["admin"] : [],
    isAdmin: state.isAdmin === true, isClient: false, isBroker: false,
    isStaff: state.isAdmin === true,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (fn: string) => {
      if (fn === "current_user_tenant_id") return { data: state.tenantId, error: state.tenantId ? null : { message: "no tenant" } };
      if (fn === "is_current_user_tenant_admin") return { data: state.isAdmin, error: null };
      if (fn === "tenant_comms_readiness") return { data: READINESS, error: null };
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      const source = table === "tenant_legal_profile" ? state.legal
        : table === "tenant_a2p_registrations" ? state.registration : null;
      // PostgREST returns the SELECTED columns and nothing else. A double that hands back
      // the whole row is more generous than the real client, and that generosity is exactly
      // what hides a predicate reading a column its own query never asked for.
      const project = (columns: string) => {
        if (!source) return null;
        const keep = columns.split(",").map((c) => c.trim()).filter(Boolean);
        if (keep.includes("*")) return source;
        return Object.fromEntries(Object.entries(source).filter(([k]) => keep.includes(k)));
      };
      return {
        select: (columns = "*") => {
          selects.push({ table, columns: columns.split(",").map((c) => c.trim()).filter((c) => c && c !== "*") });
          const row = { data: project(columns), error: null };
          const leaf = { maybeSingle: async () => row, order: async () => ({ data: [], error: null }), limit: () => leaf, eq: () => leaf };
          return leaf;
        },
      };
    }),
    functions: { invoke: (...args: unknown[]) => state.invoke(...args) },
  },
}));
vi.mock("@/hooks/useTenantContext", () => ({
  useTenantContext: () => ({ activeTenantId: state.tenantId, loading: false, activeTenant: { account_number: "1971670" } }),
}));
vi.mock("@/lib/routing/useSubtabRoute", () => ({ useSubtabRoute: () => ["connections", vi.fn()] }));
vi.mock("./data/useSoloBusiness", () => ({
  useSoloBusiness: () => ({ name: "Test Workspace", brand: {}, loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("./data/useSoloOwner", () => ({
  useSoloOwner: () => ({ owner: { name: null, email: null, phone: null, website: null }, loading: false, error: null, refresh: vi.fn() }),
}));
// The canonical Setup record, mounted by Registration. Registration must reuse THIS adapter;
// a second adapter would be a second writer, which is the thing being prevented.
vi.mock("./data/useSoloBusinessContext", () => ({
  useSoloBusinessContext: () => state.ctx,
}));

/** Setup-owned content Registration must never be able to destroy. */
/** Carrier-linked, yet both per-leg statuses still read 'pending' — the exact shape the
 *  three unselected columns were the only guard against. */
const LOCKABLE = {
  status: "pending", brand_status: "pending", campaign_status: "pending",
  brand_sid: null, campaign_sid: null, messaging_service_sid: null,
  submitted_at: null, approved_at: null,
  use_case: "Client follow-ups", campaign_description: "We text our own clients.",
  sample_messages: ["Hi Dana — confirming Tuesday at 3."],
  optin_flow: "Clients agree when they book.", optin_message: "You're subscribed.",
  optout_message: "Reply STOP to opt out.", help_message: "Reply HELP for help.",
};

const KNOWLEDGE = [{ id: "src-1", kind: "link", label: "Our onboarding doc", detail: "", url: "https://example.com/doc", note: "", reviewStatus: "reviewed", provenance: { source: "owner_confirmed", confidence: "confirmed" } }];
const EXAMPLES = [{ id: "ex-1", channel: "email", kind: "sounds_like", text: "Straight to the point.", note: "", provenance: { source: "owner_confirmed", confidence: "confirmed" } }];

function context(over: Record<string, unknown> = {}) {
  return {
    loading: false, error: null, saving: false,
    accessScope: "owner_full", canEdit: true, canEditLegal: true,
    activeTenantId: state.tenantId, resolvedTenantId: state.tenantId,
    brief: { ...EMPTY_SOLO_SETUP_BRIEF, legalName: "Test Workspace LLC", website: "https://example.com", industry: "Business Consulting", entityType: "Corporation" },
    businessOwners: [], primaryBusinessEmail: "owner@example.com",
    primaryBusinessEmailProvenance: { source: "owner_confirmed", confidence: "confirmed" },
    knowledgeSources: KNOWLEDGE, paigeProfile: EMPTY_PAIGE_PROFILE, voiceExamples: EXAMPLES,
    managedEmail: null, pendingProposal: null,
    representatives: [{ id: "u1", name: "Antonio D", email: "owner@example.com", status: "Active" }],
    representativesLoading: false, representativesError: null,
    save: state.save, checkManagedEmail: vi.fn(), registerManagedEmail: vi.fn(),
    searchNaics: vi.fn(), dismissProposal: vi.fn(), refresh: state.refresh,
    ...over,
  };
}

const selects: Array<{ table: string; columns: string[] }> = [];

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
  await act(async () => { button("Registration")?.click(); });
}
const text = () => host.textContent ?? "";
function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement | undefined;
}
function buttonContaining(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label)) as HTMLButtonElement | undefined;
}
function field(name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return host.querySelector(`[name="reg-${name}"]`);
}
async function type(name: string, value: string) {
  const el = field(name);
  if (!el) throw new Error(`no editable control for ${name}`);
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function openEditor() {
  await act(async () => { buttonContaining("Complete these here")?.click(); });
}
const saved = () => state.save.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  state.invoke = vi.fn(async (name: string) => ({ data: name === "comms-a2p-register" ? state.provider : { draft: null }, error: null }));
  state.tenantId = "tenant-1971670";
  state.isAdmin = true;
  state.legal = { legal_business_name: "Test Workspace LLC", website_url: "https://example.com" };
  state.registration = null;
  selects.length = 0;
  state.save = vi.fn(async () => ({ ok: true, kind: "saved" }));
  state.refresh = vi.fn();
  state.ctx = context();
  state.provider = {
    registration: null,
    eligible_number: { id: "number-a", phone_number: "+14045550123", label: "MMA", is_primary: true },
    profile: { legal_business_name: "Test Workspace LLC", website_url: "https://example.com", registration_number_saved: false, registered_address_complete: false, business_identity_saved: true, business_industry_saved: true, regions_saved: false, authorized_representative_complete: false },
    missing_profile_fields: ["tax or registration number", "regions of operation", "authorized representative"],
  };
  document.body.innerHTML = "";
});

describe("Completing the business record from Registration", () => {
  it("offers a way to supply the missing facts HERE, not only a link away", async () => {
    // The whole defect in one assertion: Registration names what is missing and, before
    // this change, offered nothing but a link. Naming a blocker is not resolving one.
    await mount();
    expect(text()).toContain("tax or registration number");
    expect(buttonContaining("Complete these here"), "the missing facts must be completable on this surface").toBeTruthy();
  });

  it("keeps the Setup link as well, because that path already shipped", async () => {
    // §58: the existing route to Setup is a shipped, owner-approved path. Adding an
    // editor here does not silently remove it.
    await mount();
    await openEditor();
    expect([...host.querySelectorAll("a")].some((a) => (a.getAttribute("href") ?? "").includes("/settings/setup"))).toBe(true);
  });

  it("prefills every field from the canonical record rather than asking twice", async () => {
    await mount();
    await openEditor();
    expect((field("legalName") as HTMLInputElement).value).toBe("Test Workspace LLC");
    expect((field("website") as HTMLInputElement).value).toBe("https://example.com");
    expect((field("industry") as HTMLInputElement).value).toBe("Business Consulting");
  });

  it("saves through the canonical Setup seam, not a second writer", async () => {
    await mount();
    await openEditor();
    await type("regionsOfOperation", "USA_AND_CANADA");
    await type("registeredStreet", "3314 N Kenwood Ave");
    await act(async () => { buttonContaining("Save business record")?.click(); });

    expect(state.save).toHaveBeenCalledTimes(1);
    const body = saved();
    const brief = body?.brief as Record<string, string>;
    expect(brief.regionsOfOperation).toBe("USA_AND_CANADA");
    expect(brief.registeredStreet).toBe("3314 N Kenwood Ave");
    // Untouched canonical values are carried, not blanked.
    expect(brief.legalName).toBe("Test Workspace LLC");
    // No direct provider/table write from this surface.
    expect(state.invoke.mock.calls.some((c) => c[0] === "comms-a2p-submit")).toBe(false);
  });

  it("NEVER submits an empty knowledge bucket, Paige brief or voice example set", async () => {
    // `save_solo_business_context` REPLACES these collections for an Owner save. A
    // Registration screen that submitted empty lists would delete the owner's Setup
    // knowledge and brand voice without ever naming them on screen.
    await mount();
    await openEditor();
    await type("regionsOfOperation", "USA_AND_CANADA");
    await act(async () => { buttonContaining("Save business record")?.click(); });

    const body = saved();
    expect(body?.knowledgeSources).toEqual(KNOWLEDGE);
    expect(body?.voiceExamples).toEqual(EXAMPLES);
    expect(body?.paigeProfile).toEqual(EMPTY_PAIGE_PROFILE);
    expect(body?.primaryBusinessEmail).toBe("owner@example.com");
  });

  it("refuses to save while the canonical record has not loaded", async () => {
    // The same replacement rule, from the other side: saving against a record we have
    // not read yet is how an empty list gets submitted in the first place.
    state.ctx = context({ loading: true });
    await mount();
    await openEditor();
    const save = buttonContaining("Save business record");
    if (save) expect(save.disabled).toBe(true);
    expect(state.save).not.toHaveBeenCalled();
  });

  it("refuses to save when the canonical record could not be read", async () => {
    state.ctx = context({ error: "Couldn't load this business's context." });
    await mount();
    await openEditor();
    await act(async () => { buttonContaining("Save business record")?.click(); });
    expect(state.save).not.toHaveBeenCalled();
    expect(text()).toContain("could not be read");
  });

  it("re-reads the registration after a save so the stages stop lying", async () => {
    // The stage ladder and the missing list both come from `comms-a2p-register`. A save
    // that does not refresh them leaves "Waiting" on a step the owner just completed.
    await mount();
    await openEditor();
    await type("regionsOfOperation", "USA_AND_CANADA");
    state.invoke.mockClear();
    await act(async () => { buttonContaining("Save business record")?.click(); });
    await act(async () => {});
    expect(state.invoke.mock.calls.some((c) => c[0] === "comms-a2p-register")).toBe(true);
  });

  it("reports a stale-revision conflict as a reload, never as a silent success", async () => {
    state.save = vi.fn(async () => ({ ok: false, kind: "conflict", error: "This business context changed in another session. Load the stored version before saving again." }));
    state.ctx = context();
    await mount();
    await openEditor();
    await type("regionsOfOperation", "USA_AND_CANADA");
    await act(async () => { buttonContaining("Save business record")?.click(); });
    expect(text()).toContain("changed in another session");
  });

  it("tells an Admin the legal record is the Owner's, instead of eating the typing", async () => {
    // Setup's server split: an Admin may edit the operating brief but not the legal
    // identity. Authority is the RECORD's answer, so it resolves once the record is read
    // rather than being guessed from a role the button never saw. What must never happen
    // is a box an Admin can type into that the server then refuses — the same lie the
    // read-only legal name upstream exists to prevent.
    state.ctx = context({ accessScope: "admin_operational", canEditLegal: false });
    await mount();
    await openEditor();
    expect(text()).toContain("workspace Owner");
    expect(field("legalName"), "no typeable box may exist for a write the server refuses").toBeNull();
    expect(buttonContaining("Save business record")).toBeFalsy();
  });

  it("keeps the tax or registration number write-only and masked", async () => {
    state.ctx = context({ brief: { ...context().brief, businessRegistrationNumberLast4: "4821" } });
    await mount();
    await openEditor();
    const secret = field("businessRegistrationNumber") as HTMLInputElement | null;
    expect(secret?.type, "a tax identifier must never render as readable text").toBe("password");
    expect(secret?.value, "the stored number is never sent back to the browser").toBe("");
    expect(text()).toContain("4821");
  });

  it("does not send the masked last four back as if it were the number", async () => {
    state.ctx = context({ brief: { ...context().brief, businessRegistrationNumberLast4: "4821" } });
    await mount();
    await openEditor();
    await type("regionsOfOperation", "USA_AND_CANADA");
    await act(async () => { buttonContaining("Save business record")?.click(); });
    const brief = saved()?.brief as Record<string, string>;
    expect(brief.businessRegistrationNumber).toBe("");
  });

  it("names the authorized representative from real Team people, never free text", async () => {
    // The carrier record requires a named human. Setup binds that to an active Team
    // member so the name and email are derived server-side rather than typed.
    await mount();
    await openEditor();
    const picker = field("authorizedRepresentativeUserId") as HTMLSelectElement | null;
    expect(picker?.tagName).toBe("SELECT");
    expect([...(picker?.options ?? [])].some((o) => o.value === "u1")).toBe(true);
  });

  it("confirms the person it lets you name, because the save refuses anyone unconfirmed", async () => {
    // `save_solo_setup_identity` raises "authorized representative must also be a confirmed
    // business representative" unless the chosen id is in `representativeUserIds`. The picker
    // offers the whole active Team, so without this the control would offer people the save
    // rejects — a box that accepts a choice the server then refuses.
    await mount();
    await openEditor();
    await type("authorizedRepresentativeUserId", "u1");
    await act(async () => { buttonContaining("Save business record")?.click(); });
    const brief = saved()?.brief as Record<string, unknown>;
    expect(brief.authorizedRepresentativeUserId).toBe("u1");
    expect(brief.representativeUserIds).toContain("u1");
  });

  it("does not duplicate a representative who is already confirmed", async () => {
    state.ctx = context({ brief: { ...context().brief, representativeUserIds: ["u1"] } });
    await mount();
    await openEditor();
    await type("authorizedRepresentativeUserId", "u1");
    await act(async () => { buttonContaining("Save business record")?.click(); });
    const brief = saved()?.brief as Record<string, unknown>;
    expect(brief.representativeUserIds).toEqual(["u1"]);
  });

  it("re-reads the stored record after a conflict, so a retry is not the same failure", async () => {
    // The adapter deliberately does not adopt the server's answer on a refusal, so the
    // revision this editor holds stays stale — every retry would fail identically until
    // something re-reads. The typing stays on screen; only the stored baseline moves.
    state.save = vi.fn(async () => ({ ok: false, kind: "conflict", error: "This business context changed in another session. Load the stored version before saving again." }));
    state.ctx = context();
    await mount();
    await openEditor();
    await type("registeredCity", "Indianapolis");
    state.refresh.mockClear();
    await act(async () => { buttonContaining("Save business record")?.click(); });
    expect(state.refresh).toHaveBeenCalled();
    expect((field("registeredCity") as HTMLInputElement).value).toBe("Indianapolis");
  });

  it("does not tell an Owner whose read failed that the record is someone else's", async () => {
    // `canEditLegal` is false whenever the read errored, because the adapter derives it from
    // a scope it never received. Testing authority before readability would therefore answer
    // a question we cannot answer — the same confident-claim-out-of-ignorance the two unknown
    // states upstream in this panel exist to prevent.
    state.ctx = context({ error: "Couldn't load this business's context.", canEdit: false, canEditLegal: false, accessScope: "read_only" });
    await mount();
    await openEditor();
    expect(text()).toContain("could not be read");
    expect(text(), "authority must not be asserted from a failed read").not.toContain("Only the workspace Owner");
  });

  it("closes the editor without saving when the owner cancels", async () => {
    await mount();
    await openEditor();
    await type("registeredCity", "Indianapolis");
    await act(async () => { button("Cancel")?.click(); });
    expect(state.save).not.toHaveBeenCalled();
    expect(field("registeredCity")).toBeNull();
  });

  it("does not wipe the carrier regions when the owner edits something else", async () => {
    // `save_solo_setup_identity` treats a blank `regionsOfOperation` as an instruction:
    // 20261046000000 L648-652 sets `business_regions_of_operation` to '{}' when the key
    // arrives empty. A partial submit from this screen would therefore delete the regions
    // and re-block the filing the edit was meant to unblock. The full canonical brief is
    // submitted every time, so an untouched field carries its stored value.
    state.ctx = context({ brief: { ...context().brief, regionsOfOperation: "USA_AND_CANADA" } });
    await mount();
    await openEditor();
    await type("registeredCity", "Indianapolis");
    await act(async () => { buttonContaining("Save business record")?.click(); });
    const brief = saved()?.brief as Record<string, string>;
    expect(brief.regionsOfOperation).toBe("USA_AND_CANADA");
    expect(brief.registeredCity).toBe("Indianapolis");
  });

  it("submits the WHOLE canonical brief, because an omitted key is written as NULL", async () => {
    // The upsert assigns all 23 legal columns from `excluded.*`, and each excluded value is
    // `nullif(btrim(_brief ->> 'X'),'')` — so a key this screen failed to send is not
    // "unchanged", it is erased. Spreading the loaded brief is what makes a focused editor
    // safe against a whole-row upsert.
    await mount();
    await openEditor();
    await type("registeredCity", "Indianapolis");
    await act(async () => { buttonContaining("Save business record")?.click(); });
    const brief = saved()?.brief as Record<string, string>;
    for (const key of Object.keys(EMPTY_SOLO_SETUP_BRIEF)) {
      expect(key in brief, `omitting ${key} would NULL it on the canonical row`).toBe(true);
    }
  });

  it("does not offer a PAID draft over a carrier-linked registration", async () => {
    // `hasLeftPreparation` mirrors the server's eight immutability conditions, but three read
    // provider SIDs the browser is NOT granted — 20261201000600 revoked select on this table
    // and re-granted a column list excluding them, so asking for one returns permission denied
    // and blanks the surface. Those three conditions are completed from the provider's own
    // server-computed booleans instead. Without that, a carrier-linked row whose per-leg
    // statuses still read 'pending' was offered the editor and a PAID model call.
    state.registration = LOCKABLE;
    state.provider = { ...state.provider, registration: { submission_phase: "brand_submitted", brand_status: "pending", campaign_status: "pending", status: "pending", has_brand: true, has_campaign: false, has_messaging_service: false, number_association_status: "not_started", number_registration_status: "not_started" } };
    await mount();
    expect(text()).toContain("locked");
    expect(buttonContaining("Draft again with Paige"), "a paid call must not be offered over a locked row").toBeFalsy();
  });

  it("never asks the browser for a column the grant refuses", async () => {
    // The regression this replaced: selecting brand_sid to satisfy the predicate above would
    // have returned `permission denied for column`, which this hook reports as "unreadable" —
    // blanking Registration for every workspace. A test double that returns whatever it is
    // asked for cannot catch that, so the column list is asserted directly.
    const GRANTED = new Set(["id","tenant_id","brand_status","campaign_status","use_case","campaign_description",
      "sample_messages","optin_flow","status","submitted_at","approved_at","created_at","updated_at","optin_message",
      "optout_message","help_message","registration_mode","number_association_status","number_registration_status",
      "provider_failure_code","provider_failure_reason","privacy_policy_url","terms_and_conditions_url",
      "message_categories","opt_in_types","has_embedded_links","has_embedded_phone","direct_lending","age_gated",
      "submission_phase","provider_synced_at","canceled_at"]);
    await mount();
    const asked = selects.filter((c) => c.table === "tenant_a2p_registrations").flatMap((c) => c.columns);
    expect(asked.length).toBeGreaterThan(0);
    for (const column of asked) {
      expect(GRANTED.has(column), `${column} is not in the authenticated grant list (20261201000600)`).toBe(true);
    }
  });

  it("does not offer the editor to a workspace we could not resolve", async () => {
    state.tenantId = null;
    state.ctx = context({ activeTenantId: null, resolvedTenantId: null, canEdit: false, canEditLegal: false });
    await mount();
    expect(buttonContaining("Complete these here")).toBeFalsy();
  });
});
