// E09 Slice M — the customer portal menu executor and its Chat declarations.
// Run: deno test --allow-read --allow-import --node-modules-dir=none --deny-net --deny-env --deny-write \
//        --deny-run --deny-ffi --deny-sys supabase/functions/_shared/client-portal-menu.test.ts
// (--allow-read: the drift tests read the frontend registry and presets from the repo tree.)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  configurePortalMenu, readPortalMenu, mergeMenuOverlay, sanitizeStoredOverlay, parseMenuRequest,
  PORTAL_MENU_KEYS, PORTAL_MENU_CONFIGURABLE_KEYS, PORTAL_MENU_FIXED_KEYS, GENERIC_PORTAL_MODULE_KEYS,
  PORTAL_MENU_CORE_KEYS, PORTAL_MENU_OFFERED_CORE_KEYS, STARTER_PORTAL_CATALOGS, LABEL_FORBIDDEN,
  type PortalMenuCaller,
} from "./client-portal-menu.ts";
import {
  PORTAL_MENU_TOOLS, PORTAL_MENU_CONFIGURE_CAPABILITY, PORTAL_MENU_READ_CAPABILITY, PORTAL_MENU_CONFIGURE, PORTAL_MENU_READ,
  PORTAL_MENU_KNOWN_KEYS_TEXT,
} from "./paige-spine/domains/client_portal.ts";
import { classifyAction, mutatingTools } from "./action-risk.ts";

const TENANT = "c0a1e000-0000-4000-8000-00000000000a";
const FORGED = "c0a1e000-0000-4000-8000-0000000000ff";
const CATALOG = { slug: null, authored_usable: false, modules: null };

type Call = { name: string; args: Record<string, unknown> };
/** A caller over one stored overlay. `onWrite` lets a test change what the readback sees. */
function fakeCaller(opts: {
  modules?: unknown; catalog?: unknown; readError?: unknown; writeError?: unknown; writeThrows?: boolean;
  onWrite?: (sent: unknown) => unknown;
} = {}) {
  const calls: Call[] = [];
  let stored: unknown = opts.modules === undefined ? null : opts.modules;
  const caller: PortalMenuCaller = {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === "read_tenant_portal_menu") {
        if (opts.readError) return Promise.resolve({ data: null, error: opts.readError });
        return Promise.resolve({ data: { tenant_id: args.p_expected_tenant_id, modules: stored, catalog: opts.catalog ?? CATALOG }, error: null });
      }
      if (name === "set_tenant_portal_config") {
        if (opts.writeThrows) return Promise.reject(new Error("network"));
        if (opts.writeError) return Promise.resolve({ data: null, error: opts.writeError });
        const sent = (args._patch as { modules: unknown }).modules;
        stored = opts.onWrite ? opts.onWrite(sent) : JSON.parse(JSON.stringify(sent));
        return Promise.resolve({ data: { modules: stored }, error: null });
      }
      return Promise.resolve({ data: null, error: { code: "42883" } });
    },
  };
  return { caller, calls, stored: () => stored };
}

// ── merge ──────────────────────────────────────────────────────────────────────────────────────
Deno.test("merge by key never drops an entry the request does not name", () => {
  const current = [{ key: "home", visible: true, order: 0 }, { key: "resources", visible: false, order: 1 }, { key: "sessions", label: "Calls" }];
  const merged = mergeMenuOverlay(current, [{ key: "progress", visible: false }, { key: "sessions", order: 3 }]);
  assertEquals(merged, [
    { key: "home", visible: true, order: 0 },
    { key: "resources", visible: false, order: 1 },
    { key: "sessions", label: "Calls", order: 3 },
    { key: "progress", visible: false },
  ]);
});

Deno.test("an empty or null label puts back the default name; other fields stay", () => {
  const merged = mergeMenuOverlay([{ key: "sessions", label: "Calls", visible: false }], [{ key: "sessions", label: null }]);
  assertEquals(merged, [{ key: "sessions", visible: false }]);
  const parsed = parseMenuRequest({ entries: [{ key: "sessions", label: "   " }] });
  assert(parsed.ok);
  assertEquals(parsed.entries, [{ key: "sessions", label: null }]);
});

Deno.test("the executor sends the FULL merged array, not just the named entries", async () => {
  const f = fakeCaller({ modules: [{ key: "home", visible: true, order: 0 }, { key: "resources", visible: false, order: 1 }] });
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "sessions", label: "Coaching calls" }] } });
  assert(r.success);
  const write = f.calls.find((c) => c.name === "set_tenant_portal_config")!;
  assertEquals(write.args._patch, { modules: [
    { key: "home", visible: true, order: 0 }, { key: "resources", visible: false, order: 1 }, { key: "sessions", label: "Coaching calls" },
  ] });
  assertEquals(f.calls.map((c) => c.name), ["read_tenant_portal_menu", "set_tenant_portal_config", "read_tenant_portal_menu"]);
});

// ── tenant comes from the server ──────────────────────────────────────────────────────────────
Deno.test("a forged tenant_id argument is ignored; every call names the server tenant", async () => {
  const f = fakeCaller({ modules: [] });
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT,
    args: { tenant_id: FORGED, _tenant_id: FORGED, entries: [{ key: "progress", visible: false }] } });
  assert(r.success);
  for (const c of f.calls) {
    const named = c.name === "set_tenant_portal_config" ? c.args._tenant_id : c.args.p_expected_tenant_id;
    assertEquals(named, TENANT, c.name);
    assert(!JSON.stringify(c.args).includes(FORGED), `${c.name} carried the forged tenant`);
  }
});

Deno.test("no server tenant means no read and no write", async () => {
  for (const t of [null, undefined, "", "not-a-uuid"]) {
    const f = fakeCaller();
    const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: t, args: { entries: [{ key: "progress", visible: false }] } });
    assert(!r.success && r.reason === "no_workspace" && !r.writeAttempted);
    assertEquals(f.calls.length, 0);
  }
});

// ── truth ──────────────────────────────────────────────────────────────────────────────────────
Deno.test("a readback that does not match what was sent is reported as a failure, never success", async () => {
  const f = fakeCaller({ modules: [], onWrite: () => [{ key: "progress", visible: true }] });
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "progress", visible: false }] } });
  assert(!r.success);
  assertEquals(r.reason, "outcome_unknown");
  assert(r.writeAttempted);
});

Deno.test("a database refusal with a SQLSTATE proves nothing was written", async () => {
  for (const [code, reason] of [["42501", "forbidden"], ["22023", "bad_request"], ["P0002", "no_workspace"], ["40001", "refused"]] as const) {
    const f = fakeCaller({ modules: [], writeError: { code } });
    const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "progress", visible: false }] } });
    assert(!r.success);
    assertEquals([r.reason, r.writeAttempted], [reason, false], code);
  }
});

Deno.test("a transport error or a thrown write is outcome_unknown, not 'not applied'", async () => {
  for (const f of [fakeCaller({ modules: [], writeError: { message: "gateway timeout" } }), fakeCaller({ modules: [], writeThrows: true })]) {
    const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "progress", visible: false }] } });
    assert(!r.success);
    assertEquals([r.reason, r.writeAttempted], ["outcome_unknown", true]);
  }
});

Deno.test("re-sending the same change writes nothing and says so", async () => {
  const f = fakeCaller({ modules: [{ key: "progress", visible: false }] });
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "progress", visible: false }] } });
  assert(r.success && r.replayed);
  assertEquals(f.calls.map((c) => c.name), ["read_tenant_portal_menu"]);
});

Deno.test("an unreadable menu is refused before any write", async () => {
  const f = fakeCaller({ readError: { code: "42501" } });
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "progress", visible: false }] } });
  assert(!r.success && r.reason === "forbidden" && !r.writeAttempted);
  assert(!f.calls.some((c) => c.name === "set_tenant_portal_config"));
});

// ── what Paige may and may not change ─────────────────────────────────────────────────────────
Deno.test("Home and Messages are never hidden or renamed; Planning is not a customer entry", async () => {
  for (const [e, reason] of [
    [{ key: "home", visible: false }, "fixed_entry"], [{ key: "messages", label: "Chat" }, "fixed_entry"],
    [{ key: "messages", visible: true }, "fixed_entry"], [{ key: "planning", visible: false }, "unknown_entry"],
  ] as const) {
    const f = fakeCaller({ modules: [] });
    const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [e] } });
    assert(!r.success);
    assertEquals(r.reason, reason, JSON.stringify(e));
    assertEquals(f.calls.length, 0);
  }
});

Deno.test("Payments is registered but refused until its page exists", async () => {
  const f = fakeCaller({ modules: [] });
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "billing", label: "Pay" }] } });
  assert(!r.success && r.reason === "not_available_yet");
});

Deno.test("Agreements is refused for clients until Slice A, even for a business whose catalog lists it", async () => {
  // The funding preset lists agreements; its route is still the platform-terms page.
  for (const e of [{ key: "agreements", visible: true }, { key: "agreements", label: "Contracts" }, { key: "agreements", visible: false }]) {
    const f = fakeCaller({ modules: [], catalog: { slug: "funding", authored_usable: false, modules: null } });
    const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [e] } });
    assert(!r.success && r.reason === "not_available_yet" && !r.writeAttempted, JSON.stringify(e));
    assertEquals(f.calls.length, 0);
  }
  const f = fakeCaller({ modules: [], catalog: { slug: "funding", authored_usable: false, modules: null } });
  const r = await readPortalMenu({ caller: f.caller, expectedTenantId: TENANT });
  assert(r.success);
  const a = r.entries.find((e) => e.key === "agreements")!;
  assertEquals([a.shown, a.hidden_because], [false, "not_available_yet"]);
});

Deno.test("an unknown key, a bad shape or an over-long name is refused before any read", async () => {
  for (const args of [
    { entries: [{ key: "dashboard", visible: false }] }, { entries: [] }, {}, { entries: [{ key: "progress" }] },
    { entries: [{ key: "progress", visible: "no" }] }, { entries: [{ key: "progress", order: 1001 }] },
    { entries: [{ key: "progress", label: "x".repeat(41) }] }, { entries: [{ key: "progress", label: "a\nb" }] },
    { entries: [{ key: "progress", visible: false, icon: "x" }] }, { entries: [{ key: "progress", visible: false }, { key: "progress", visible: true }] },
  ]) {
    const f = fakeCaller({ modules: [] });
    const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args });
    assert(!r.success && !r.writeAttempted, JSON.stringify(args));
    assertEquals(f.calls.length, 0, JSON.stringify(args));
  }
});

Deno.test("a catalog-only entry the authored Playbook does not list is refused as having no effect", async () => {
  const catalog = { slug: null, authored_usable: true, modules: [{ key: "home", label: "Home" }, { key: "sessions", label: "Meetings" }] };
  const f = fakeCaller({ modules: [], catalog });
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "learn", visible: true }] } });
  assert(!r.success && r.reason === "not_offered" && r.key === "learn" && !r.writeAttempted);
});

// ── Resources is core for customers (§58: no customer loses it) ─────────────────────────────────
Deno.test("Resources is offered to every business's customers whatever the catalog lists, and changeable", async () => {
  const catalogs: unknown[] = [
    { slug: null, authored_usable: true, modules: [{ key: "home", label: "Home" }, { key: "sessions", label: "Meetings" }] },
    ...Object.keys(STARTER_PORTAL_CATALOGS).map((slug) => ({ slug, authored_usable: false, modules: null })),
  ];
  for (const catalog of catalogs) {
    const f = fakeCaller({ modules: [], catalog });
    const read = await readPortalMenu({ caller: f.caller, expectedTenantId: TENANT });
    assert(read.success, JSON.stringify(catalog));
    const learnRows = read.entries.filter((e) => e.key === "resources" || e.key === "learn");
    assertEquals(learnRows.map((e) => [e.key, e.shown, e.hidden_because]), [["resources", true, null]], JSON.stringify(catalog));
    const ok = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "resources", visible: false }] } });
    assert(ok.success, JSON.stringify(catalog));
    const after = await readPortalMenu({ caller: f.caller, expectedTenantId: TENANT });
    assert(after.success);
    const row = after.entries.find((e) => e.key === "resources")!;
    assertEquals([row.shown, row.hidden_because], [false, "owner_hid_it"], JSON.stringify(catalog));
  }
});

Deno.test("a catalog that lists only the learn alias: learn speaks for the route, with its name; resources does nothing", async () => {
  const catalog = { slug: null, authored_usable: true, modules: [{ key: "home", label: "Home" }, { key: "learn", label: "Guides" }] };
  const f = fakeCaller({ modules: [], catalog });
  const read = await readPortalMenu({ caller: f.caller, expectedTenantId: TENANT });
  assert(read.success);
  assertEquals(read.entries.filter((e) => e.group === "learn").map((e) => [e.key, e.label, e.shown]), [["learn", "Guides", true]]);
  const no = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "resources", label: "Library" }] } });
  assert(!no.success && no.reason === "not_offered" && no.key === "resources" && !no.writeAttempted);
  const ok = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "learn", label: "Library" }] } });
  assert(ok.success);
});

Deno.test("a shared route is ONE read row: the key the customer sees, hidden when that key is hidden", async () => {
  // Both aliases listed, resources ranked first by the owner and hidden: the customer sees no Resources entry.
  const catalog = { slug: null, authored_usable: true, modules: [{ key: "home", label: "Home" }, { key: "learn", label: "Library" }, { key: "resources", label: "Resources" }] };
  const f = fakeCaller({ modules: [{ key: "resources", visible: false, order: 0 }], catalog });
  const read = await readPortalMenu({ caller: f.caller, expectedTenantId: TENANT });
  assert(read.success);
  assertEquals(read.entries.filter((e) => e.group === "learn").map((e) => [e.key, e.shown, e.hidden_because]), [["resources", false, "owner_hid_it"]]);
  // No owner order: the catalog's first listed alias speaks.
  const g = fakeCaller({ modules: [], catalog });
  const r2 = await readPortalMenu({ caller: g.caller, expectedTenantId: TENANT });
  assert(r2.success);
  assertEquals(r2.entries.filter((e) => e.group === "learn").map((e) => [e.key, e.label, e.shown]), [["learn", "Library", true]]);
});

// ── §2: an opt-in entry exists only for a business whose own catalog lists it ───────────────────
const FUNDING_WORDS = /fund|credit|financ|lend|loan|affiliate/i;
const OPT_IN = PORTAL_MENU_CONFIGURABLE_KEYS.filter((k) => !PORTAL_MENU_CORE_KEYS.includes(k));

Deno.test("no tool description names an opt-in key or any funding/credit word", () => {
  for (const t of PORTAL_MENU_TOOLS) {
    const text = JSON.stringify(t);
    // "business" is also an ordinary word ("this business"), so it is checked as a listed key below.
    for (const k of OPT_IN.filter((k) => k !== "business")) assert(!new RegExp(`\\b${k}\\b`).test(text), `${t.function.name} names opt-in key ${k}`);
    assert(!FUNDING_WORDS.test(text), `${t.function.name} carries funding/credit wording`);
  }
  assert(!FUNDING_WORDS.test(JSON.stringify(PORTAL_MENU_CONFIGURE_CAPABILITY)) && !FUNDING_WORDS.test(JSON.stringify(PORTAL_MENU_READ_CAPABILITY)));
  assertEquals(PORTAL_MENU_KNOWN_KEYS_TEXT, PORTAL_MENU_OFFERED_CORE_KEYS.join(", "));
  for (const k of OPT_IN) assert(!PORTAL_MENU_KNOWN_KEYS_TEXT.split(", ").includes(k), `key list names opt-in ${k}`);
});

Deno.test("the opt-in set is exactly the catalog-only entries outside the core, and includes every funding key", () => {
  for (const k of PORTAL_MENU_CORE_KEYS) assert(PORTAL_MENU_CONFIGURABLE_KEYS.includes(k), `core key ${k} is configurable`);
  for (const k of OPT_IN) assertEquals(PORTAL_MENU_KEYS.find((e) => e.key === k)?.defaultVisibility, "catalog", `${k} must be catalog-only`);
  for (const k of ["funding-journey", "funding_journey", "credit", "funding", "financial-profile", "financial_profile", "business", "affiliate"]) {
    assert(OPT_IN.includes(k), `${k} must be opt-in`);
  }
});

Deno.test("a business that did not choose funding never sees a funding/credit row or name in its read", async () => {
  const catalogs: unknown[] = [
    { slug: null, authored_usable: false, modules: null },
    { slug: "general", authored_usable: false, modules: null },
    { slug: "consultant", authored_usable: false, modules: null },
    { slug: "not-a-real-slug", authored_usable: false, modules: null },
    // A usable authored Playbook wins over the slug; its own list decides.
    { slug: "consultant", authored_usable: true, modules: [{ key: "home", label: "Home" }, { key: "sessions", label: "Calls" }] },
    // An authored Playbook that is not usable falls back to its slug; its own list is not what clients get.
    { slug: null, authored_usable: false, modules: [{ key: "credit", label: "Credit" }] },
  ];
  for (const catalog of catalogs) {
    const f = fakeCaller({ modules: [{ key: "credit", visible: false }], catalog });
    const r = await readPortalMenu({ caller: f.caller, expectedTenantId: TENANT });
    assert(r.success, JSON.stringify(catalog));
    const text = JSON.stringify(r);
    assert(!FUNDING_WORDS.test(text), `read for ${JSON.stringify(catalog)} carries funding wording: ${text}`);
    for (const e of r.entries) assert(e.fixed || PORTAL_MENU_CORE_KEYS.includes(e.key), `${e.key} listed for ${JSON.stringify(catalog)}`);
  }
});

Deno.test("a business that chose funding gets its own funding rows, and only those its catalog lists", async () => {
  const f = fakeCaller({ modules: [], catalog: { slug: "funding", authored_usable: false, modules: null } });
  const r = await readPortalMenu({ caller: f.caller, expectedTenantId: TENANT });
  assert(r.success);
  const keys = r.entries.map((e) => e.key);
  for (const k of ["funding-journey", "credit", "funding", "financial-profile", "business"]) assert(keys.includes(k), k);
  for (const k of ["funding_journey", "financial_profile", "affiliate", "approvals"]) assert(!keys.includes(k), k);
  const credit = r.entries.find((e) => e.key === "credit")!;
  assertEquals([credit.label, credit.shown, credit.hidden_because], ["Credit", true, null]);
  // ...and can change them.
  const ok = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "credit", label: "Credit health" }] } });
  assert(ok.success);
});

Deno.test("an opt-in key for a business whose catalog does not list it is refused before any write", async () => {
  for (const key of OPT_IN) {
    const f = fakeCaller({ modules: [], catalog: { slug: "general", authored_usable: false, modules: null } });
    const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key, visible: true }] } });
    assert(!r.success && r.reason === "not_offered" && !r.writeAttempted, key);
    assert(!FUNDING_WORDS.test(r.message), `refusal names funding: ${r.message}`);
    assert(!f.calls.some((c) => c.name === "set_tenant_portal_config"), key);
  }
});

// ── invisible characters in a name ────────────────────────────────────────────────────────────
const INVISIBLE = ["\u202a", "\u202b", "\u202c", "\u202d", "\u202e", "\u2066", "\u2067", "\u2068", "\u2069",
  "\u200b", "\u200c", "\u200d", "\u200e", "\u200f", "\u2060", "\ufeff", "\u0085"];
Deno.test("a name carrying a bidi override/isolate or a zero-width character is refused before any read", async () => {
  for (const ch of INVISIBLE) {
    const f = fakeCaller({ modules: [] });
    const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT,
      args: { entries: [{ key: "sessions", label: `Cal${ch}ls` }] } });
    assert(!r.success && r.reason === "bad_request" && !r.writeAttempted, `U+${ch.charCodeAt(0).toString(16)}`);
    assertEquals(f.calls.length, 0);
  }
  // Ordinary non-Latin names, accents and emoji stay allowed.
  for (const label of ["Séances", "جلسات", "セッション", "Calls 📞"]) {
    assert(!LABEL_FORBIDDEN.test(label), label);
    const f = fakeCaller({ modules: [] });
    const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "sessions", label }] } });
    assert(r.success, label);
  }
});

Deno.test("a stored name with an invisible character is cleared and reported, not re-sent", async () => {
  const f = fakeCaller({ modules: [{ key: "sessions", label: "Cal\u202els" }] });
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "progress", visible: false }] } });
  assert(r.success);
  assertEquals(r.modules, [{ key: "sessions" }, { key: "progress", visible: false }]);
  assertEquals(r.normalized, ["sessions"]);
});

Deno.test("a stored value the writer would now refuse is cleared, reported, and does not block the change", async () => {
  const f = fakeCaller({ modules: [{ key: "home", visible: false, order: 0 }, { key: "sessions", label: "", extra: 1 }, { key: "Bad Key" }] });
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "progress", visible: false }] } });
  assert(r.success);
  assertEquals(r.modules, [{ key: "home", order: 0 }, { key: "sessions" }, { key: "progress", visible: false }]);
  assertEquals(r.normalized.sort(), ["Bad Key", "home", "sessions"]);
  assertEquals(sanitizeStoredOverlay("not an array"), { entries: [], normalized: [] });
});

// ── the read ──────────────────────────────────────────────────────────────────────────────────
Deno.test("the read projects each customer entry with the owner's name and why it is hidden", async () => {
  const catalog = { slug: null, authored_usable: true, modules: [{ key: "home", label: "Home" }, { key: "sessions", label: "Meetings" }, { key: "resources", label: "Library" }] };
  const f = fakeCaller({ modules: [{ key: "sessions", label: "Calls" }, { key: "progress", visible: false }], catalog });
  const r = await readPortalMenu({ caller: f.caller, expectedTenantId: TENANT });
  assert(r.success);
  const by = Object.fromEntries(r.entries.map((e) => [e.key, e]));
  assertEquals([by.sessions.label, by.sessions.shown], ["Calls", true]);
  assertEquals([by.progress.shown, by.progress.hidden_because], [false, "owner_hid_it"]);
  assertEquals([by.resources.label, by.resources.shown], ["Library", true]);
  assert(!("learn" in by), "the learn alias shares Resources' route: one row, not two");
  assertEquals([by.agreements.shown, by.agreements.hidden_because], [false, "not_available_yet"]);
  assertEquals([by.messages.label, by.messages.fixed, by.messages.shown], ["Messages", true, true]);
  // A core entry whose page does not exist yet is reported as such, never as shown.
  assertEquals([by.billing.label, by.billing.shown, by.billing.hidden_because], ["Payments", false, "not_available_yet"]);
  assert(!("planning" in by), "a staff-only entry is not a customer entry");
  assertEquals(f.calls, [{ name: "read_tenant_portal_menu", args: { p_expected_tenant_id: TENANT } }]);
});

// ── declarations ──────────────────────────────────────────────────────────────────────────────
Deno.test("portal_menu_update is high risk everywhere it is declared", () => {
  assertEquals(classifyAction("portal_menu_update"), "high");
  assertEquals(PORTAL_MENU_CONFIGURE_CAPABILITY.governance.risk, "high");
  assertEquals(PORTAL_MENU_CONFIGURE_CAPABILITY.governance.approval, "confirm");
  assertEquals(PORTAL_MENU_CONFIGURE.action.riskPolicyKey, "high");
  assertEquals(PORTAL_MENU_CONFIGURE.action.seatAuthority, "workspace-admin");
  assertEquals(PORTAL_MENU_READ.action.seatAuthority, "workspace-admin");
  assertEquals(PORTAL_MENU_READ_CAPABILITY.governance.risk, "read_only");
});

Deno.test("the gated writer hands Chat a WRITABLE copy; the read carries its frozen declared schema", () => {
  assertEquals(PORTAL_MENU_TOOLS.map((t) => t.function.name), ["read_tenant_portal_menu", "portal_menu_update"]);
  const [read, update] = PORTAL_MENU_TOOLS;
  // The writer is gated (a RISK row), so the chat adds `confirm` to it: that must not throw (the Slice 3 crash).
  assert(Object.isFrozen(PORTAL_MENU_CONFIGURE_CAPABILITY.input));
  assertEquals(classifyAction(update.function.name), "high");
  const p = update.function.parameters as Record<string, unknown> & { properties: Record<string, unknown> };
  assert(!Object.isFrozen(p) && !Object.isFrozen(p.properties), update.function.name);
  p.properties.confirm = { type: "boolean" };
  delete p.properties.confirm;
  // The read is the declaration's own input (the capability kit admits a read only that way) and is named
  // after its public.read_* executor. It is in no RISK row, so neither confirm loop in paige-ai-chat
  // (both gate on mutatingTools()) ever writes to this frozen object.
  assertEquals(read.function.name, PORTAL_MENU_READ.action.executor.replace(/^public\./, ""));
  assertEquals(read.function.name, PORTAL_MENU_READ.action.chatTool);
  assert(read.function.parameters === PORTAL_MENU_READ_CAPABILITY.input);
  assert(Object.isFrozen(read.function.parameters));
  assertEquals(classifyAction(read.function.name), "unclassified");
  assert(!mutatingTools().has(read.function.name) && mutatingTools().has(update.function.name));
});

Deno.test("the update tool names every live core key, and no key that is not live", () => {
  const update = PORTAL_MENU_TOOLS.find((t) => t.function.name === "portal_menu_update")!;
  const keysText = update.function.description.match(/Keys: ([a-z0-9_, -]+), plus/)?.[1];
  assertEquals(keysText, PORTAL_MENU_OFFERED_CORE_KEYS.join(", "));
  for (const e of PORTAL_MENU_KEYS) {
    if (!e.live || !e.clientsLive) assert(!keysText!.split(", ").includes(e.key), `not-live ${e.key} is offered`);
  }
  for (const k of ["progress", "actions", "sessions", "documents"]) assert(PORTAL_MENU_OFFERED_CORE_KEYS.includes(k), k);
  assert(!PORTAL_MENU_OFFERED_CORE_KEYS.includes("billing"), "billing is not live");
  assert(!PORTAL_MENU_OFFERED_CORE_KEYS.includes("agreements"), "agreements is not live for clients until Slice A");
  for (const k of PORTAL_MENU_FIXED_KEYS) assert(!PORTAL_MENU_CONFIGURABLE_KEYS.includes(k), k);
});

// ── drift against the frontend's one registry ─────────────────────────────────────────────────
const repo = new URL("../../../", import.meta.url);
Deno.test("PORTAL_MENU_KEYS matches src/lib/portal/portalMenu.ts PORTAL_MENU_ENTRIES field by field", async () => {
  const src = await Deno.readTextFile(new URL("src/lib/portal/portalMenu.ts", repo));
  const block = src.slice(src.indexOf("export const PORTAL_MENU_ENTRIES"), src.indexOf("export const PORTAL_MENU_CONFIGURABLE_KEYS"));
  assert(block.length > 0, "PORTAL_MENU_ENTRIES block not found");
  const entries = [...block.matchAll(/^\s*entry\(\{(.*)\}\),\s*$/gm)].map(([, body]) => {
    const str = (f: string) => body.match(new RegExp(`\\b${f}:\\s*"([^"]*)"`))?.[1];
    return {
      key: str("key"), label: str("defaultLabel"), route: str("route"), group: str("group"), floor: str("floor"),
      fixed: /\bfixed:\s*true\b/.test(body), live: !/\blive:\s*false\b/.test(body), clientsLive: !/\bclientsLive:\s*false\b/.test(body),
      defaultVisibility: str("defaultVisibility") ?? "catalog", shownToCustomers: /\bshownToCustomers:\s*true\b/.test(body),
      catalogLabel: !/\bcatalogLabel:\s*false\b/.test(body),
      catalogOrdered: /\bcatalogOrdered:\s*true\b/.test(body),
    };
  });
  assert(entries.length > 0, "no entries parsed");
  assertEquals(PORTAL_MENU_KEYS.map((e) => ({ ...e })), entries.map(({ catalogOrdered: _o, ...e }) => e));
  // The read's route-speaker ranking assumes every route alias is catalog-ordered in the frontend.
  for (const e of entries) {
    if (entries.some((a) => a !== e && a.route === e.route)) assert(e.catalogOrdered, `route alias ${e.key} must be catalogOrdered`);
  }
});

Deno.test("PORTAL_MENU_CONFIGURABLE_KEYS uses the frontend's rule (not fixed, not staff-only)", async () => {
  const src = await Deno.readTextFile(new URL("src/lib/portal/portalMenu.ts", repo));
  assert(/PORTAL_MENU_CONFIGURABLE_KEYS[^=]*=\s*PORTAL_MENU_ENTRIES\s*\.filter\(\(e\)\s*=>\s*!e\.fixed\s*&&\s*e\.floor\s*!==\s*"staff"\)/.test(src),
    "the frontend's configurable-key rule changed; update PORTAL_MENU_CONFIGURABLE_KEYS to match");
});

Deno.test("GENERIC_PORTAL_MODULE_KEYS matches the generic Playbook's portal modules", async () => {
  const src = await Deno.readTextFile(new URL("src/lib/playbook/presets.ts", repo));
  const block = src.slice(src.indexOf("const GENERIC_MODULES = ["), src.indexOf("];", src.indexOf("const GENERIC_MODULES = [")));
  assertEquals([...block.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]), [...GENERIC_PORTAL_MODULE_KEYS]);
});

Deno.test("STARTER_PORTAL_CATALOGS matches every Playbook preset's portal modules, slug by slug", async () => {
  const src = await Deno.readTextFile(new URL("src/lib/playbook/presets.ts", repo));
  const pairs = (text: string) => [...text.matchAll(/\{\s*key:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g)].map((m) => ({ key: m[1], label: m[2] }));
  const genericStart = src.indexOf("const GENERIC_MODULES = [");
  const generic = pairs(src.slice(genericStart, src.indexOf("];", genericStart)));
  const presets: Record<string, { key: string; label: string }[]> = {};
  const starts = [...src.matchAll(/^export const (\w+): Playbook = \{/gm)].map((m) => m.index!);
  assert(starts.length >= 6, "presets not found");
  starts.forEach((start, i) => {
    const body = src.slice(start, starts[i + 1] ?? src.indexOf("export const PLAYBOOK_LIBRARY"));
    const slug = body.match(/\bslug:\s*"([^"]+)"/)?.[1];
    assert(slug, "a preset without a slug");
    const portal = body.slice(body.indexOf("portal:"));
    presets[slug] = /portal:\s*\{\s*modules:\s*GENERIC_MODULES\s*\}/.test(portal)
      ? generic : pairs(portal.slice(0, portal.indexOf("],")));
  });
  assertEquals(Object.keys(presets).sort(), Object.keys(STARTER_PORTAL_CATALOGS).sort());
  for (const [slug, modules] of Object.entries(presets)) {
    assert(modules.length > 0, slug);
    assertEquals(STARTER_PORTAL_CATALOGS[slug].map((m) => ({ ...m })), modules, slug);
  }
  // Every preset is slug-resolvable, so this mirror is exactly what getPlaybookBySlug can return.
  assert(/RESOLVABLE_PLAYBOOKS[^=]*=\s*\[\.\.\.PLAYBOOK_LIBRARY,\s*fundingCoach\]/.test(src), "RESOLVABLE_PLAYBOOKS changed");
});
