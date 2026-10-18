// E09 Slice M — the customer portal menu executor and its Chat declarations.
// Run: deno test --allow-read --allow-import --node-modules-dir=none --deny-net --deny-env --deny-write \
//        --deny-run --deny-ffi --deny-sys supabase/functions/_shared/client-portal-menu.test.ts
// (--allow-read: the drift tests read the frontend registry and presets from the repo tree.)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  configurePortalMenu, readPortalMenu, mergeMenuOverlay, sanitizeStoredOverlay, parseMenuRequest,
  PORTAL_MENU_KEYS, PORTAL_MENU_CONFIGURABLE_KEYS, PORTAL_MENU_FIXED_KEYS, GENERIC_PORTAL_MODULE_KEYS,
  type PortalMenuCaller,
} from "./client-portal-menu.ts";
import {
  PORTAL_MENU_TOOLS, PORTAL_MENU_CONFIGURE_CAPABILITY, PORTAL_MENU_READ_CAPABILITY, PORTAL_MENU_CONFIGURE, PORTAL_MENU_READ,
} from "./paige-spine/domains/client_portal.ts";
import { classifyAction } from "./action-risk.ts";

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
  const r = await configurePortalMenu({ caller: f.caller, expectedTenantId: TENANT, args: { entries: [{ key: "agreements", visible: true }] } });
  assert(!r.success && r.reason === "not_offered" && r.key === "agreements");
  // A starter slug's catalog is not known here: do not guess, let it through.
  const g = fakeCaller({ modules: [], catalog: { slug: "fitness", authored_usable: false, modules: null } });
  const ok = await configurePortalMenu({ caller: g.caller, expectedTenantId: TENANT, args: { entries: [{ key: "resources", label: "Library" }] } });
  assert(ok.success);
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
  assertEquals([by.agreements.shown, by.agreements.hidden_because], [false, "playbook_does_not_list_it"]);
  assertEquals([by.messages.label, by.messages.fixed, by.messages.shown], ["Messages", true, true]);
  assert(!("billing" in by), "a not-yet-live entry is not listed");
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

Deno.test("each tool hands Chat a WRITABLE copy of its frozen declared schema", () => {
  assert(Object.isFrozen(PORTAL_MENU_CONFIGURE_CAPABILITY.input));
  for (const t of PORTAL_MENU_TOOLS) {
    const p = t.function.parameters as Record<string, unknown> & { properties: Record<string, unknown> };
    assert(!Object.isFrozen(p) && !Object.isFrozen(p.properties), t.function.name);
    // What the chat does to every gated tool: it must not throw.
    p.properties.confirm = { type: "boolean" };
    delete p.properties.confirm;
  }
  assertEquals(PORTAL_MENU_TOOLS.map((t) => t.function.name), ["portal_menu_read", "portal_menu_update"]);
});

Deno.test("the update tool tells Paige every configurable key", () => {
  const update = PORTAL_MENU_TOOLS.find((t) => t.function.name === "portal_menu_update")!;
  for (const k of PORTAL_MENU_CONFIGURABLE_KEYS) assert(update.function.description.includes(k), k);
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
      key: str("key"), label: str("defaultLabel"), group: str("group"), floor: str("floor"),
      fixed: /\bfixed:\s*true\b/.test(body), live: !/\blive:\s*false\b/.test(body),
      defaultVisibility: str("defaultVisibility") ?? "catalog", catalogLabel: !/\bcatalogLabel:\s*false\b/.test(body),
    };
  });
  assert(entries.length > 0, "no entries parsed");
  assertEquals(PORTAL_MENU_KEYS.map((e) => ({ ...e })), entries);
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
