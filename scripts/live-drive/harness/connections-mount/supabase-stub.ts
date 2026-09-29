/**
 * Data-boundary stub for the Settings › Connections › Calendars harness mount.
 *
 * MOCKS THE PROVIDER, NEVER THE CONTRACT (harness README). The shipped
 * `CalendarsView`, the shipped `useCalendarConnections` and the shipped CSS are
 * all under measurement — only the Supabase transport is replaced, and it answers
 * with the exact shapes the real seams return.
 *
 * THE ROWS ARE VISIBLY SYNTHETIC ON PURPOSE. Names read "Harness …" so a frame
 * can never be mistaken for a tenant's real configuration and no invented person
 * appears in an artifact (§13/§63).
 *
 * WRITES PERSIST HERE, AND THAT IS THE POINT (§70). The previous version routed
 * `.update()` and `.insert()` into a chain that ignored them and re-resolved the
 * same read, so a save "succeeded" and nothing changed. A geometry harness can
 * live with that; a harness meant to prove a HUMAN can finish a job cannot —
 * every drive would have been asserting against a value that was never written.
 * The store below is a real in-memory table set: an update mutates the row and
 * returns the MUTATED row, an insert appends and returns what it appended, and a
 * re-read sees both. That is what makes "create it, change it, save it, and see
 * it hold" provable rather than assumed.
 *
 * It is still a double. It proves the surface drives its own contract correctly.
 * It proves NOTHING about production RLS, Postgres constraints, or a real
 * provider, and must never be reported as having done so.
 *
 * `?data=` selects the state under measurement:
 *   dense (default) · issues · readonly · hostserror · empty · error
 */
export type StubState = "dense" | "issues" | "readonly" | "hostserror" | "empty" | "error";

function state(): StubState {
  const v = new URLSearchParams(window.location.search).get("data");
  return (v as StubState) || "dense";
}

const SECOND_CONTEXT = new URLSearchParams(window.location.search).get("tenant") === "second";
const TENANT = SECOND_CONTEXT ? "harness-tenant-second" : "harness-tenant";
const TENANT_NAME = SECOND_CONTEXT ? "Second harness workspace" : "Harness workspace";
const LEGAL_NAME = SECOND_CONTEXT ? "Second Harness Studio Inc." : "Harness Advisory LLC";
const PUBLIC_NAME = SECOND_CONTEXT ? "Second Harness Studio" : "Harness Advisory";

/** The workspace's people. Visibly synthetic, so a frame can never be mistaken
 *  for a real roster and no invented person appears in an artifact (§13/§63). */
const TEAM = [
  { user_id: "u1", full_name: "Harness Owner" },
  { user_id: "u2", full_name: "Harness Teammate" },
];

const notify = (over: Record<string, unknown> = {}) => ({
  confirm_guest: true,
  confirm_host: true,
  reminders: [
    { channel: "email", offset_min: 1440, to: "guest" },
    { channel: "sms", offset_min: 120, to: "guest", body: "Harness text: {{when}}" },
  ],
  followup_guest: true,
  followup_offset_min: 60,
  lifecycle: [{ event: "cancelled", channel: "email", to: "host", subject: "Harness cancellation" }],
  ...over,
});

function seedCalendars() {
  if (state() === "empty") return [];
  const base = {
    tenant_id: TENANT, description: "Harness description line for the booking page.",
    logo_url: null, accent: null, buffer_before_min: 15, buffer_after_min: 15,
    min_notice_min: 240, booking_horizon_days: 30, capacity: 1, redirect_url: "",
    timezone: "America/New_York",
    availability_json: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" })),
    enabled: true, group_id: null, created_by: null, theme: "light", subtitle: "Harness subtitle",
    show_company_name: true, location_type: "google_meet", location_value: null,
    location_options: [{ type: "google_meet", value: null }],
    intake_questions: [
      { id: "q1", label: "What would you like to cover?", type: "textarea", required: true, options: [] },
    ],
    appointment_types: [],
    date_overrides: [
      { date: "2026-12-24", blocked: false, windows: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "16:30" }] },
      { date: "2026-12-25", blocked: true, windows: [] },
    ],
    notify_config: notify(),
    assignment_strategy: { mode: "balanced" },
  };
  const rows = [
    { ...base, id: "cal-1", slug: "harness-discovery", type: "personal", title: "Harness discovery call", duration_min: 30, color: "#7A67E8" },
    { ...base, id: "cal-2", slug: "harness-onboarding", type: "round_robin", title: "Harness onboarding", duration_min: 45, color: "#2FA37C", assignment_strategy: { mode: "priority" } },
    { ...base, id: "cal-3", slug: "harness-workshop", type: "event", title: "Harness workshop", duration_min: 90, color: "#C98A2A", enabled: false, capacity: 12 },
    { ...base, id: "cal-4", slug: "harness-review", type: "collective", title: "Harness quarterly review", duration_min: 60, color: "#B4564C" },
  ];
  if (state() === "issues") {
    rows[0] = {
      ...rows[0],
      appointment_types: [{ id: "svc-1", name: "", description: "Unnamed on purpose", duration_min: 30, price_cents: null }],
      intake_questions: [{ id: "q1", label: "Which package?", type: "radio", required: true, options: [] }],
    };
  }
  return rows;
}

type Row = Record<string, unknown>;

/**
 * The mutable store. Built ONCE per page load, then edited in place, so a save
 * followed by a re-read observes the save — the whole reason this file exists.
 */
function seed(): Record<string, Row[]> {
  const s = state();
  // Contact methods (Lane A): the Setup harness representative's own phone numbers, so the
  // representative-phone picker renders a real choice. Design fixtures.
  const userContactMethods: Row[] = [
    { id: "rep-p1", user_id: "harness-owner", kind: "phone", value: "+1 (404) 555-0188", label: "Mobile", is_primary: true, position: 0 },
    { id: "rep-p2", user_id: "harness-owner", kind: "phone", value: "+1 404 555 0190", label: "Work", is_primary: false, position: 1 },
    { id: "rep-p3", user_id: "harness-owner", kind: "phone", value: "(404) 555-0123", label: "Home", is_primary: false, position: 2 },
  ];
  return {
    user_contact_methods: userContactMethods,
    calendars: seedCalendars(),
    calendar_hosts: s === "issues" ? [] : [
      { calendar_id: "cal-1", user_id: "u1", priority: 0, availability_json: null, timezone: null },
      { calendar_id: "cal-2", user_id: "u1", priority: 0, availability_json: null, timezone: null },
      { calendar_id: "cal-2", user_id: "u2", priority: 1, availability_json: [{ day: 1, start: "10:00", end: "15:00" }], timezone: "Europe/London" },
      { calendar_id: "cal-3", user_id: "u2", priority: 0, availability_json: null, timezone: null },
      { calendar_id: "cal-4", user_id: "u1", priority: 0, availability_json: null, timezone: null },
    ],
    // `profiles` SELECT is own-row under RLS on the real platform, so a manager
    // reading this table gets THEMSELVES and nobody else. Seeding teammate names
    // here made the harness kinder than production and hid a real defect: every
    // host rendered as "Team member" live. Host names must come from
    // `list_calendar_host_candidates`, which is SECURITY DEFINER for exactly
    // this reason — so the stub returns the viewer's row alone.
    profiles: [
      {
        user_id: "harness-user", full_name: "Harness Viewer",
        work_email: "viewer@harness.example.invalid",
        phone: "+1 555 0111", website_url: "https://viewer.example.invalid",
      },
    ],
    user_roles: [
      { user_id: "u1", role: "admin" },
      { user_id: "u2", role: "member" },
    ],
    coach_client_profiles_safe: [
      { user_id: "u1", full_name: "Harness Owner", avatar_url: null, suspended_at: null, suspended_reason: null },
      { user_id: "u2", full_name: "Harness Teammate", avatar_url: null, suspended_at: null, suspended_reason: null },
    ],
    tenant_members: [
      { tenant_id: TENANT, user_id: "u1", role: "owner", is_owner: true, status: "active" },
      { tenant_id: TENANT, user_id: "u2", role: "member", is_owner: false, status: "active" },
    ],
    staff_calendar_settings: [{
      user_id: "harness-user",
      google_calendar_connected: true, google_email: "harness@example.invalid",
      google_last_sync_at: new Date(Date.now() - 42 * 60_000).toISOString(),
      apple_caldav_connected: false, apple_last_sync_at: null,
      zoom_connected: false, zoom_email: null,
    }],
    tenant_email_identities: [{ tenant_id: TENANT }],
    tenant_phone_numbers: s === "issues" ? [] : [{ id: "num-1", tenant_id: TENANT, is_primary: true }],
    tenant_a2p_registrations: s === "issues" ? [] : [{ tenant_id: TENANT }],
    tenants: [{
      id: TENANT,
      name: TENANT_NAME,
      brand: {
        business_phone: s === "issues" ? "" : "+1 555 0100",
        website: "https://harness.example.invalid",
        industry: "Consulting",
      },
    }],
    // Settings › Billing designations (Foundation C). Seeded EMPTY on purpose: an empty
    // workspace is the first-use state, and it is the one every real workspace is in today.
    platform_billing_contacts: [],
    // Billing joins the plan to the subscription on `plan_slug`/`plan_id` and prices
    // it from `monthly_price_cents`/`annual_price_cents`. Seeding only id+name left
    // the card rendering "Not provided" for Price and Renewal — a partial stub makes
    // a partial surface, and a partial surface is not the geometry the drive claims.
    platform_subscription_plans: [
      {
        id: "plan-1", slug: "harness-pro", name: "Harness plan",
        monthly_price_cents: 9700, annual_price_cents: 97000,
        is_active: true, messaging_included: true,
      },
    ],
  };
}

/**
 * A database survives a page reload; a module-scoped object does not. Seeding at
 * module load modelled "a fresh database every navigation", which made it
 * IMPOSSIBLE for any drive to prove a save persisted — the reload that was meant
 * to re-read the row silently rebuilt it from the seed instead. Session storage
 * is the smallest thing that models the real property: writes outlive a reload,
 * and a fresh browser context (a new drive run) starts clean.
 */
const STORE_KEY = `paige-harness-store:${state()}`;

function load(): Record<string, Row[]> {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, Row[]>;
  } catch { /* storage unavailable — fall through to a fresh seed */ }
  return seed();
}

// SEED FIRST, then overlay what was stored. `load()` returns a store written by an EARLIER page
// load, which may predate a table this file now reads — and the billing handlers would then
// dereference `undefined` and throw synchronously out of `supabase.rpc`, pinning the surface at
// "Clearing and resolving this account…". Spreading the seed underneath is the migration.
const db: Record<string, Row[]> = { ...seed(), ...load() };

function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    // LOUD, never silent (§32). A store that stops persisting turns every
    // persistence assertion below into a false reading of the product.
    console.error(`[stub] persist FAILED — assertions after this are meaningless: ${String(e).slice(0, 120)}`);
  }
}

const ok = (data: unknown) => ({ data, error: null as { message: string } | null });
const fail = (message: string) => ({ data: null, error: { message } });

/** A read that the selected state says must fail, or null when it may proceed. */
function readRefusal(table: string) {
  const s = state();
  if (table === "calendars" && s === "error") return fail("Harness: calendars read refused");
  if (table === "calendar_hosts" && s === "hostserror") return fail("Harness: calendar_hosts read refused");
  return null;
}

type Filter = { col: string; val: unknown; op: "eq" | "neq" | "in" | "is" };

/**
 * A query builder that answers however the caller walks it, and — unlike the
 * geometry-only version this replaces — actually applies what it is told to write.
 *
 * The hook uses `.select().eq().order()`, `.select().eq().eq().limit()`,
 * `.select().eq().maybeSingle()`, `.select().in()`, `.update().eq().select().single()`
 * and `.insert().select().single()`. Resolution is LAZY — nothing is computed until
 * the chain is awaited — because the mutation and its filters arrive in any order
 * along the chain and all of them must be known before the store is touched.
 */
function chain(table: string) {
  const filters: Filter[] = [];
  let pending: { kind: "update" | "insert" | "delete"; payload?: unknown } | null = null;
  let applied = false;
  let cached: { data: unknown; error: { message: string } | null } | null = null;

  const rows = () => (db[table] ??= []);
  const matches = (row: Row) => filters.every((f) => {
    const v = row[f.col];
    if (f.op === "eq" || f.op === "is") return v === f.val;
    if (f.op === "neq") return v !== f.val;
    if (f.op === "in") return Array.isArray(f.val) && (f.val as unknown[]).includes(v);
    return true;
  });

  /**
   * Applied at most once per chain. A caller that awaits the same builder twice
   * (or reads `.single()` after `await`) must not insert its row a second time.
   */
  function settle() {
    if (applied) return cached!;
    applied = true;

    const refused = readRefusal(table);
    if (refused) return (cached = refused);

    if (pending?.kind === "update") {
      const hit = rows().filter(matches);
      for (const r of hit) Object.assign(r, pending.payload as Row);
      persist();
      return (cached = ok(hit));
    }
    if (pending?.kind === "insert") {
      const incoming = (Array.isArray(pending.payload) ? pending.payload : [pending.payload]) as Row[];
      const added = incoming.map((r, i) => ({
        // A real insert returns the row the database made, including the id it
        // assigned. The surface selects that id straight after creating, so an
        // insert that answered without one would break the flow it exists for.
        id: r.id ?? `cal-new-${Date.now()}-${i}`,
        tenant_id: TENANT,
        ...r,
      }));
      rows().push(...added);
      persist();
      return (cached = ok(added));
    }
    if (pending?.kind === "delete") {
      const keep = rows().filter((r) => !matches(r));
      const removed = rows().length - keep.length;
      db[table] = keep;
      persist();
      return (cached = ok(removed ? [{}] : []));
    }
    return (cached = ok(rows().filter(matches)));
  }

  const one = () => {
    const r = settle();
    if (r.error) return r;
    const d = r.data as Row[];
    return ok(Array.isArray(d) ? (d[0] ?? null) : d);
  };

  const self: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(settle()).then(res, rej),
    catch: (rej: (e: unknown) => unknown) => Promise.resolve(settle()).catch(rej),
    maybeSingle: () => Promise.resolve(one()),
    single: () => Promise.resolve(one()),
    update: (payload: unknown) => { pending = { kind: "update", payload }; return self; },
    insert: (payload: unknown) => { pending = { kind: "insert", payload }; return self; },
    delete: () => { pending = { kind: "delete" }; return self; },
    eq: (col: string, val: unknown) => { filters.push({ col, val, op: "eq" }); return self; },
    neq: (col: string, val: unknown) => { filters.push({ col, val, op: "neq" }); return self; },
    is: (col: string, val: unknown) => { filters.push({ col, val, op: "is" }); return self; },
    in: (col: string, val: unknown) => { filters.push({ col, val, op: "in" }); return self; },
  };
  // Links that narrow nothing the store models. They must still return the chain.
  for (const link of ["select", "order", "limit", "range", "match"]) self[link] = () => self;
  return self;
}

/**
 * Harness-only window hook, so a drive can read what the store ACTUALLY holds
 * instead of inferring it from the rendered surface. Diagnosing a save that
 * reports success and does not persist is impossible from the DOM alone.
 */
try {
  (window as unknown as Record<string, unknown>).__harnessStore = db;
} catch { /* not a browser — ignore */ }

export const supabase = {
  from: (table: string) => chain(table),
  rpc: (name: string, args?: Record<string, unknown>) => {
    if (name === "current_user_tenant_id") return Promise.resolve(ok(TENANT));
    if (name === "is_current_user_tenant_admin") return Promise.resolve(ok(state() !== "readonly"));
    if (name === "tenant_roster_excluded_user_ids") return Promise.resolve(ok([]));
    if (name === "get_solo_setup_identity") {
      const stored = db.tenants[0]?.brand as Record<string, unknown> | undefined;
      const businessBrief = stored?.business_brief ?? {
        legalName: LEGAL_NAME, publicName: PUBLIC_NAME, dbaName: "",
        website: "https://harness.example.invalid", address: "123 Harness Way, Atlanta, GA 30303",
        phone: "+14045550123", industry: "PROFESSIONAL_SERVICES", naicsCode: "541611", sicCode: "8742",
        entityType: "Limited Liability Corporation", stateOfFormation: "GA",
        businessRegistrationIdentifier: "EIN", regionsOfOperation: "USA_AND_CANADA",
        registeredStreet: "123 Harness Way", registeredStreetSecondary: "", registeredCity: "Atlanta",
        registeredRegion: "GA", registeredPostalCode: "30303", registeredIsoCountry: "US",
        authorizedRepresentativePhone: "+14045550123", authorizedRepresentativeJobPosition: "CEO",
        representativeUserIds: ["u1"], authorizedRepresentativeUserId: "u1",
        offers: "Harness advisory services", deliveryModel: "Remote and scheduled",
        idealCustomer: "Harness client", customerSegments: "Owner-led businesses", serviceArea: "United States",
        currentPriority: "Verify the carrier identity flow", goals90Day: "Complete registration readiness",
        annualDirection: "Operate with governed communications", successDefinition: "Accurate carrier records",
        constraints: "Never infer legal facts", brandVoice: "Clear and grounded",
        operatingPreferences: "Ask when evidence is missing", doNotAssume: "Provider approval",
        provenance: {}, updatedAt: "2026-09-01T00:00:00.000Z",
      };
      return Promise.resolve(ok({
        tenant_id: TENANT, tenant_name: TENANT_NAME, business_brief: businessBrief,
        pending_proposal: null, primary_business_email: "owner@harness.example.invalid",
        can_edit: state() !== "readonly", business_registration_number_last_4: "6789",
      }));
    }
    if (name === "save_solo_setup_identity") {
      const brief = (args?._brief ?? {}) as Record<string, unknown>;
      const safeBrief = { ...brief };
      delete safeBrief.businessRegistrationNumber;
      const brand = db.tenants[0].brand as Record<string, unknown>;
      brand.business_brief = safeBrief;
      persist();
      return Promise.resolve(ok({ business_brief: safeBrief, businessRegistrationNumberLast4: "6789" }));
    }

    // Who could be added as a host. Real shape: every teammate, each flagged with
    // whether they are already on THIS calendar — the surface filters, not the RPC.
    if (name === "list_calendar_host_candidates") {
      const cal = String(args?._cal ?? "");
      const current = new Set(
        (db.calendar_hosts ?? []).filter((h) => h.calendar_id === cal).map((h) => h.user_id),
      );
      return Promise.resolve(ok(TEAM.map((m) => ({
        user_id: m.user_id, full_name: m.full_name, is_host: current.has(m.user_id),
        priority: current.has(m.user_id) ? 0 : null,
      }))));
    }

    // The atomic roster rewrite. Modelled as the real one behaves: the previous
    // roster is REPLACED, and array position becomes the stored priority — so a
    // drive that reorders and re-reads sees the order it asked for, and a partial
    // write would show up here as a gap rather than passing quietly.
    if (name === "set_calendar_hosts") {
      const cal = String(args?._cal ?? "");
      const incoming = (args?._hosts ?? []) as { user_id: string }[];
      db.calendar_hosts = (db.calendar_hosts ?? []).filter((h) => h.calendar_id !== cal);
      incoming.forEach((h, i) => {
        db.calendar_hosts.push({ calendar_id: cal, user_id: h.user_id, priority: i, availability_json: null, timezone: null });
      });
      persist();
      return Promise.resolve(ok(null));
    }
    // ---- Seams the OTHER Settings destinations read. Added when the mount was
    // widened from Calendars alone to the whole `SoloSettings` route, so every
    // destination renders its real content rather than a spinner — a surface
    // stuck loading is short, and a short surface passes a reachability check
    // vacuously. Shapes follow each caller's own reader in `settings.tsx`.

    // Connections › Communications. The ONE canonical readiness resolver; the
    // surface discards a row whose tenant_id is not the active account, so the
    // stub must carry it.
    if (name === "tenant_comms_readiness") {
      const ready = state() !== "issues";
      // The shape is the exported `CommsReadiness` interface, field for field.
      // A flattened guess rendered fine in TypeScript and threw at runtime on
      // `business.has_name` — the harness must model the record the resolver
      // actually returns, not a convenient summary of it.
      return Promise.resolve(ok({
        tenant_id: TENANT,
        can_send_sms: ready,
        blocked_reason: ready ? null : "number_absent",
        subaccount: ready ? "connected" : "inactive",
        number: ready ? "assigned" : "absent",
        number_e164: ready ? "+15550100" : null,
        business: { has_name: true, has_website: ready, has_phone: ready },
        a2p: ready ? "approved" : "absent",
        consent: {
          granted_count: ready ? 12 : 0,
          suppressed_count: ready ? 1 : 0,
          state: ready ? "ready" : "none_recorded",
        },
        delivery: {
          state: ready ? "delivering" : "no_activity",
          sent_30d: ready ? 48 : 0, delivered_30d: ready ? 46 : 0, failed_30d: ready ? 2 : 0,
          last_inbound_at: ready ? new Date(Date.now() - 3_600_000).toISOString() : null,
          inbound_reporting: ready ? "available" : "unavailable",
        },
        billing: {
          subscription: ready ? "active" : "absent",
          plan_name: ready ? "Harness plan" : null,
          period_end: ready ? new Date(Date.now() + 20 * 86_400_000).toISOString() : null,
          cancel_at_period_end: false,
          usage_metering: ready ? "recording" : "not_recording",
          metered_events_30d: ready ? 310 : 0,
        },
      }));
    }

    // Connections › Communications sending identity. The field names are
    // `ManagedIdentityRecord`'s, from settings-contract.ts — `default_email_sender`,
    // `default_email_domain`, `default_email_kind`, `default_email_status`. An
    // earlier version invented `default_from_email`/`custom_domain`, which the card
    // simply ignores: it reported a VERIFIED identity while rendering "Not provided"
    // for its sender, domain and kind. A stub whose keys the component does not read
    // measures a surface nobody runs.
    if (name === "resolve_tenant_domain_identity") {
      const ready = state() !== "issues";
      return Promise.resolve(ok([{
        tenant_id: TENANT,
        default_email_status: ready ? "verified" : "unverified",
        default_email_sender: ready ? "hello@harness.example.invalid" : null,
        default_email_domain: ready ? "harness.example.invalid" : null,
        default_email_kind: ready ? "managed_subdomain" : null,
      }]));
    }

    if (name === "get_tenant_platform_subscription") {
      if (state() === "issues") return Promise.resolve(ok(null));
      return Promise.resolve(ok({
        plan_id: "plan-1", plan_slug: "harness-pro", status: "active",
        billing_period: "monthly",
        current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
        cancel_at_period_end: false,
      }));
    }

    // ---- Settings › Billing (Foundation C). The stub answers the SHIPPED shapes of the three
    // billing seams so the destination renders its real content under measurement rather than a
    // spinner. `data=issues` swaps the authority read for a failure, so a drive can show the
    // failed-read state is reachable and is NOT rendered as a statement about the account.
    //
    // The mapping is deliberately `absent` in every mode: that is what PRODUCTION currently
    // answers for every workspace, and a harness that fixtured a mapped account would be
    // measuring a surface nobody has.
    if (name === "get_workspace_billing_authority") {
      if (state() === "issues") return Promise.resolve({ data: null, error: { message: "Harness: billing authority unreadable" } });
      return Promise.resolve(ok([{
        tenant_id: TENANT,
        scope: "top_level_solo",
        role: "owner",
        can_manage_billing: state() !== "readonly",
        billing_account_state: "absent",
        can_view_billing: state() !== "readonly",
        receives_billing_notices: db.platform_billing_contacts.some((c) => c.user_id === "u1" && !c.revoked_at),
        billing_contact_state: db.platform_billing_contacts.some((c) => c.designation === "primary_contact" && !c.revoked_at) ? "designated" : "none",
        paid_activation_ready: db.platform_billing_contacts.some((c) => c.designation === "primary_contact" && !c.revoked_at),
      }]));
    }
    // AI usage. The numbers are the REAL production shape: a promotional workspace on the solo
    // allowance with no provider-backed subscription, so the period is the calendar month. bigint
    // columns are STRINGS here because that is how PostgREST delivers them — a stub that returned
    // numbers would let a number-only parser render fine in the harness and blank on the platform.
    // `data=issues` fails the read, so a drive can show the unreadable state is reachable and is
    // NOT rendered as zero usage.
    if (name === "get_workspace_ai_usage") {
      if (state() === "issues") return Promise.resolve({ data: null, error: { message: "Harness: AI usage unreadable" } });
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
      const monthEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
      return Promise.resolve(ok([{
        tenant_id: TENANT,
        scope: "top_level",
        // R22: viewing usage is Owner-only, exactly like viewing the plan. In `readonly` the stub
        // answers the refusal the server would answer, not a total with a disabled button.
        can_view: state() !== "readonly",
        usage_state: state() === "readonly" ? "owner_only" : "ok",
        revenue_class: "promotional",
        reference_plan_slug: "solo",
        included_ai_tokens_month: state() === "readonly" ? null : "5000000",
        ai_credit_token_ratio: state() === "readonly" ? null : 1000,
        period_source: state() === "readonly" ? null : "calendar_month",
        period_start: state() === "readonly" ? null : monthStart.toISOString(),
        period_end: state() === "readonly" ? null : monthEnd.toISOString(),
        tokens_used: state() === "readonly" ? null : "1274300",
        events_counted: state() === "readonly" ? null : 41,
        usage_last_recorded_at: state() === "readonly" ? null : new Date().toISOString(),
      }]));
    }
    if (name === "get_workspace_billing_contacts") {
      return Promise.resolve(ok(db.platform_billing_contacts.filter((c) => !c.revoked_at).map((c) => ({
        id: c.id, user_id: c.user_id, designation: c.designation,
        role: c.user_id === "u1" ? "owner" : "admin",
        display_name: (TEAM.find((m) => m.user_id === c.user_id) ?? { full_name: null }).full_name,
        email_verified: true, still_eligible: true,
        designated_at: c.designated_at, designated_by: "u1",
      }))));
    }
    // The write is modelled as the real one behaves — it INSERTS and the caller RE-READS, so a
    // drive that designates and reloads is exercising persistence, not a local patch.
    if (name === "platform_billing_contact_designate") {
      db.platform_billing_contacts.push({
        id: `pbc-${db.platform_billing_contacts.length + 1}`,
        user_id: String(args?.p_user_id ?? ""),
        designation: String(args?.p_designation ?? "primary_contact"),
        designated_at: new Date().toISOString(),
        revoked_at: null,
      });
      persist();
      return Promise.resolve(ok(null));
    }
    if (name === "platform_billing_contact_revoke") {
      const row = db.platform_billing_contacts.find((c) => c.id === String(args?.p_contact_id ?? ""));
      if (row) row.revoked_at = new Date().toISOString();
      persist();
      return Promise.resolve(ok(null));
    }
    // Settings › Team, and the candidate list Billing reads through it (§18 — one roster read).
    if (name === "get_solo_team_workspace") {
      return Promise.resolve(ok({
        tenant_id: TENANT, tenant_name: TENANT_NAME, viewer_permission: "owner",
        can_manage_profiles: true, can_manage_invitations: true, can_change_permissions: true,
        total_members: TEAM.length,
        members: TEAM.map((m, i) => ({
          membership_id: `mem-${i + 1}`, user_id: m.user_id, full_name: m.full_name,
          email: `${m.user_id}@harness.example.invalid`, avatar_url: null, status: "active",
          permission: i === 0 ? "owner" : "admin", is_owner: i === 0,
          job_title: null, responsibilities: null, last_sign_in_at: null,
        })),
        invitations: [],
      }));
    }

    // Settings › Integrations. Both connectors answer "not connected", which is
    // the honest default and still renders the full catalogue.
    if (name === "get_tenant_n8n_connection") return Promise.resolve(ok(null));
    if (name === "get_tenant_mcp_connection") return Promise.resolve(ok(null));

    return Promise.resolve(ok(null));
  },
  // Realtime, answered as an inert channel. The Solo Command Center subscribes for
  // live approvals; without this the whole screen throws on mount and a drive that
  // only wanted to read its CSS geometry gets an error boundary instead of a screen.
  // It never delivers an event — a harness has no server to deliver one.
  channel: (_name: string) => {
    const ch = {
      on: (..._args: unknown[]) => ch,
      subscribe: (cb?: (status: string) => void) => { cb?.("SUBSCRIBED"); return ch; },
      unsubscribe: () => Promise.resolve("ok" as const),
    };
    return ch;
  },
  removeChannel: (_ch: unknown) => Promise.resolve("ok" as const),
  auth: {
    getUser: () => Promise.resolve({ data: { user: { id: "harness-user" } }, error: null }),
    onAuthStateChange: (_cb: unknown) => ({
      data: { subscription: { unsubscribe: () => undefined } },
    }),
  },
  functions: {
    invoke: (fn: string, opts?: { body?: Record<string, unknown> }) => {
      if (fn === "admin-list-users") {
        return Promise.resolve({
          data: {
            scoped: true,
            users: [
              { id: "u1", email: "owner@harness.example.invalid", created_at: "2026-01-01T00:00:00.000Z", last_sign_in_at: "2026-09-01T00:00:00.000Z" },
              { id: "u2", email: "team@harness.example.invalid", created_at: "2026-02-01T00:00:00.000Z", last_sign_in_at: "2026-09-01T00:00:00.000Z" },
            ],
          },
          error: null,
        });
      }
      // `useSoloComms` awaits this read FIRST and rethrows its error, so a blanket
      // failure short-circuited the hook before it consumed the plan rows, the
      // subscription RPC or the admin RPC. Billing then rendered its error/retry
      // fallback and Communications its degraded sending-identity state, and the
      // reachability drive measured THOSE — a shorter surface than the one it
      // claimed to cover. A stub that fails a read the surface depends on does not
      // measure the surface.
      if (fn === "manage-tenant-domain" && opts?.body?.verb === "list") {
        return Promise.resolve({
          data: {
            domains: state() === "issues" ? [] : [{
              id: "dom-1",
              domain: "harness.example.invalid",
              from_email_local: "hello",
              from_name: TENANT_NAME,
              status: "verified",
              is_default: true,
            }],
          },
          error: null,
        });
      }
      // Everything else still fails honestly: a harness never leaves for a provider,
      // and nothing was started, so nothing may be claimed.
      return Promise.resolve({ data: null, error: { message: "Harness: no provider handshake" } });
    },
  },
};

export default { supabase };
