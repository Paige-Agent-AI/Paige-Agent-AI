// E09 Slice M — the customer portal menu, from chat.
//
// ONE WRITER. The only place a tenant's menu is stored is `tenants.features.portal_config.modules`,
// and the only writer is public.set_tenant_portal_config (owner/admin of the tenant or an ancestor
// agency, validated shape, migration 20271110060000). This module reads the stored overlay, MERGES
// the entries Paige names into it by key, and sends the FULL array — because that function merges
// shallowly, a `modules` patch replaces the whole array, and sending only the named entries would
// silently drop every entry the owner set before.
//
// THE TENANT NEVER COMES FROM THE MODEL. Only `entries` is read from the arguments. The tenant is the
// server-resolved caller tenant the dispatcher passes in (re-checked against current_user_tenant_id()
// before the call); a `tenant_id` argument is ignored and never reaches the database.
//
// SUCCESS IS A READBACK. After the write, the overlay is re-read on the caller's own session and must
// equal exactly what was sent. A database refusal that carries a SQLSTATE proves nothing was written.
// Anything else after the call was sent is `outcome_unknown`, never retried here.
//
// THE REGISTRY IS THE FRONTEND'S (§18). `PORTAL_MENU_KEYS` below is the model-facing copy of
// `PORTAL_MENU_ENTRIES` in src/lib/portal/portalMenu.ts; client-portal-menu.test.ts fails if the two
// drift. The overlay can never create a link (an unknown key is inert in the menu), so this list exists
// only so Paige is told the truth about what a name does.

export type PortalMenuSlot = "top" | "work" | "paperwork" | "learn";
export type PortalMenuFloor = "everyone" | "customer" | "not_staff" | "brand" | "staff";
export interface PortalMenuKey {
  key: string; label: string; group: PortalMenuSlot; fixed: boolean; live: boolean;
  /** False while the page behind the entry is not yet the client's own (Agreements until Slice A). */
  clientsLive: boolean;
  floor: PortalMenuFloor; defaultVisibility: "shown" | "catalog"; catalogLabel: boolean;
}
const k = (key: string, label: string, group: PortalMenuSlot, floor: PortalMenuFloor,
  o: Partial<Pick<PortalMenuKey, "fixed" | "live" | "clientsLive" | "defaultVisibility" | "catalogLabel">> = {}): PortalMenuKey =>
  Object.freeze({ key, label, group, floor, fixed: false, live: true, clientsLive: true, defaultVisibility: "catalog" as const, catalogLabel: true, ...o });

/**
 * Mirror of src/lib/portal/portalMenu.ts PORTAL_MENU_ENTRIES, in the same order: key, default name,
 * group, who may ever see it, fixed, live, live for clients, whether it shows without the Playbook listing
 * it, and whether the Playbook's own name for it wins. Drift-tested field by field.
 */
export const PORTAL_MENU_KEYS: readonly PortalMenuKey[] = Object.freeze([
  k("home", "Home", "top", "everyone", { fixed: true, defaultVisibility: "shown" }),
  k("messages", "Messages", "top", "customer", { fixed: true, defaultVisibility: "shown", catalogLabel: false }),
  k("progress", "Progress", "work", "customer", { defaultVisibility: "shown" }),
  k("actions", "Action items", "work", "not_staff", { defaultVisibility: "shown" }),
  k("sessions", "Sessions", "work", "customer", { defaultVisibility: "shown" }),
  k("approvals", "Approvals", "work", "everyone"),
  k("funding-journey", "Funding Journey", "work", "everyone"),
  k("funding_journey", "Funding Journey", "work", "everyone"),
  k("credit", "Credit", "work", "everyone"),
  k("funding", "Funding", "work", "everyone"),
  k("financial-profile", "Financial Profile", "work", "everyone"),
  k("financial_profile", "Financial Profile", "work", "everyone"),
  k("business", "Business", "work", "everyone"),
  k("affiliate", "Affiliate", "work", "everyone"),
  k("planning", "Planning", "work", "staff", { fixed: true, defaultVisibility: "shown" }),
  k("documents", "Documents", "paperwork", "brand", { defaultVisibility: "shown" }),
  // The route is still the platform-terms page, so no client gets it until Slice A (clientsLive:false).
  k("agreements", "Agreements", "paperwork", "everyone", { clientsLive: false }),
  k("billing", "Payments", "paperwork", "customer", { live: false, catalogLabel: false }),
  k("resources", "Resources", "learn", "everyone"),
  k("learn", "Resources", "learn", "everyone"),
]);

/** Always in a customer's menu, never renamed or hidden (owner ruling 2026-10-18), plus staff-only Planning. */
export const PORTAL_MENU_FIXED_KEYS: readonly string[] = Object.freeze(PORTAL_MENU_KEYS.filter((e) => e.fixed).map((e) => e.key));
/** Same rule as the frontend's PORTAL_MENU_CONFIGURABLE_KEYS: not fixed and not staff-only. */
export const PORTAL_MENU_CONFIGURABLE_KEYS: readonly string[] = Object.freeze(
  PORTAL_MENU_KEYS.filter((e) => !e.fixed && e.floor !== "staff").map((e) => e.key));

/**
 * The configurable entries every business's customers can have (owner ruling 2026-10-18: Progress, Action
 * items, Sessions, Documents, Agreements, Payments, Resources). These are the only keys Paige is told about
 * up front. Every OTHER configurable key — Approvals, the funding preset's entries, Business, Affiliate — is
 * OPT-IN: it is catalog-only, it exists for a business only when that business's own Playbook catalog lists
 * it, and Paige learns of it only from that business's portal_menu_read (§2: funding/credit wording is a
 * chosen option, never a default every tenant's Paige recites).
 */
export const PORTAL_MENU_CORE_KEYS: readonly string[] = Object.freeze(
  ["progress", "actions", "sessions", "documents", "agreements", "billing", "resources", "learn"]);
const isCore = (key: string) => PORTAL_MENU_CORE_KEYS.includes(key);
/**
 * Whether a client can be shown the entry at all: its page exists (`live`) and is the client's own
 * (`clientsLive`). Everything this module answers is about what a business's CLIENTS see, so an entry that
 * fails either is "not available yet" here — never offered, never changed, reported as such.
 */
const customerLive = (e: PortalMenuKey) => e.live && e.clientsLive;
/** Core keys a customer can actually be shown today (live), in registry order: the tool description's list. */
export const PORTAL_MENU_OFFERED_CORE_KEYS: readonly string[] = Object.freeze(
  PORTAL_MENU_KEYS.filter((e) => customerLive(e) && isCore(e.key) && PORTAL_MENU_CONFIGURABLE_KEYS.includes(e.key)).map((e) => e.key));

const KEY = /^[a-z0-9_-]{1,40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/**
 * Characters a menu name may never carry: C0/C1 controls and DEL, plus the invisible ones that change how
 * the name reads without being seen — zero-width space/non-joiner/joiner, the left-to-right and
 * right-to-left marks, the bidi embedding/override controls U+202A–U+202E, the word joiner, the bidi
 * isolates U+2066–U+2069 and the byte-order mark. Same set as set_tenant_portal_config's label check.
 */
// deno-lint-ignore no-control-regex
export const LABEL_FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;
const MAX_ENTRIES = 40;

export interface OverlayEntry { key: string; visible?: boolean; order?: number; label?: string }

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The stored overlay as the writer will accept it back: only key/visible/order/label with valid types.
 * Never drops a valid entry. A field the current writer would refuse (it was stored before validation
 * existed) is removed rather than re-sent, and reported, so one legacy value cannot block every change.
 */
export function sanitizeStoredOverlay(raw: unknown): { entries: OverlayEntry[]; normalized: string[] } {
  const entries: OverlayEntry[] = [];
  const normalized: string[] = [];
  if (!Array.isArray(raw)) return { entries, normalized };
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isObject(item) || typeof item.key !== "string" || !KEY.test(item.key) || seen.has(item.key)) {
      normalized.push(isObject(item) && typeof item.key === "string" ? item.key : "(unnamed)");
      continue;
    }
    seen.add(item.key);
    const fixed = PORTAL_MENU_FIXED_KEYS.includes(item.key);
    const e: OverlayEntry = { key: item.key };
    if (typeof item.visible === "boolean" && !(fixed && item.visible === false)) e.visible = item.visible;
    else if ("visible" in item) normalized.push(item.key);
    if (typeof item.order === "number" && Number.isFinite(item.order) && item.order >= 0 && item.order <= 1000) e.order = item.order;
    else if ("order" in item) normalized.push(item.key);
    const label = typeof item.label === "string" ? item.label.trim() : null;
    if (label && !fixed && label.length <= 40 && !LABEL_FORBIDDEN.test(label)) e.label = label;
    else if ("label" in item) normalized.push(item.key);
    entries.push(e);
  }
  return { entries, normalized: [...new Set(normalized)] };
}

export type MenuRequestEntry = { key: string; visible?: boolean; order?: number; label?: string | null };
export type MenuParseFailure = { reason: "bad_request" | "fixed_entry" | "unknown_entry" | "not_available_yet"; key?: string };

/** The Playbook catalog keys this tenant's customers' menu draws on (authored, else starter, else general). */
export function catalogKeysOf(catalog: unknown): Set<string> {
  return new Set(projectCatalog(catalog).effectiveModules.map((x) => x.key));
}

/** Parses the model's `entries`. Anything but `entries` (a tenant id, an actor) is ignored. */
export function parseMenuRequest(args: unknown): { ok: true; entries: MenuRequestEntry[] } | ({ ok: false } & MenuParseFailure) {
  if (!isObject(args) || !Array.isArray(args.entries) || args.entries.length < 1 || args.entries.length > MAX_ENTRIES) {
    return { ok: false, reason: "bad_request" };
  }
  const out: MenuRequestEntry[] = [];
  const seen = new Set<string>();
  for (const raw of args.entries) {
    if (!isObject(raw) || typeof raw.key !== "string") return { ok: false, reason: "bad_request" };
    const key = raw.key.trim().toLowerCase();
    if (!KEY.test(key) || seen.has(key)) return { ok: false, reason: "bad_request", key };
    for (const k of Object.keys(raw)) if (!["key", "visible", "order", "label"].includes(k)) return { ok: false, reason: "bad_request", key };
    const known = PORTAL_MENU_KEYS.find((e) => e.key === key);
    if (known?.fixed && known.floor !== "staff") return { ok: false, reason: "fixed_entry", key };
    if (!known || !PORTAL_MENU_CONFIGURABLE_KEYS.includes(key)) return { ok: false, reason: "unknown_entry", key };
    if (!customerLive(known)) return { ok: false, reason: "not_available_yet", key };
    const e: MenuRequestEntry = { key };
    if ("visible" in raw) {
      if (typeof raw.visible !== "boolean") return { ok: false, reason: "bad_request", key };
      e.visible = raw.visible;
    }
    if ("order" in raw) {
      if (typeof raw.order !== "number" || !Number.isFinite(raw.order) || raw.order < 0 || raw.order > 1000) return { ok: false, reason: "bad_request", key };
      e.order = raw.order;
    }
    if ("label" in raw) {
      if (raw.label === null) e.label = null;
      else if (typeof raw.label !== "string") return { ok: false, reason: "bad_request", key };
      else {
        const label = raw.label.trim();
        // An empty name puts back the default one (the tool schema says so); the writer never stores "".
        if (label.length === 0) e.label = null;
        else if (label.length > 40 || LABEL_FORBIDDEN.test(label)) return { ok: false, reason: "bad_request", key };
        else e.label = label;
      }
    }
    if (!("visible" in e) && !("order" in e) && !("label" in e)) return { ok: false, reason: "bad_request", key };
    seen.add(key);
    out.push(e);
  }
  return { ok: true, entries: out };
}

/**
 * Merge by key. Every stored entry the request does not name is kept exactly as stored. A named entry
 * keeps its stored fields except the ones the request sets; `label: null` returns it to its default
 * name. A key not yet stored is appended.
 */
export function mergeMenuOverlay(current: readonly OverlayEntry[], request: readonly MenuRequestEntry[]): OverlayEntry[] {
  const merged: OverlayEntry[] = current.map((e) => ({ ...e }));
  for (const r of request) {
    let target = merged.find((e) => e.key === r.key);
    if (!target) { target = { key: r.key }; merged.push(target); }
    if (r.visible !== undefined) target.visible = r.visible;
    if (r.order !== undefined) target.order = r.order;
    if (r.label === null) delete target.label;
    else if (typeof r.label === "string") target.label = r.label;
  }
  return merged;
}

/** Order-sensitive structural equality over the four overlay fields. */
export function sameOverlay(a: unknown, b: readonly OverlayEntry[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  return a.every((x, i) => {
    if (!isObject(x)) return false;
    const y = b[i];
    const keys = Object.keys(x).sort(), want = Object.keys(y).sort();
    if (keys.join(",") !== want.join(",")) return false;
    return want.every((k) => (x as Record<string, unknown>)[k] === (y as unknown as Record<string, unknown>)[k]);
  });
}

export interface PortalMenuCaller {
  /** The caller's own session: public.read_tenant_portal_menu and public.set_tenant_portal_config. */
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export type PortalMenuFailure =
  | "no_workspace" | "bad_request" | "fixed_entry" | "unknown_entry" | "not_available_yet" | "not_offered"
  | "forbidden" | "unavailable" | "refused" | "outcome_unknown";

export const PORTAL_MENU_MESSAGES: Readonly<Record<PortalMenuFailure, string>> = Object.freeze({
  no_workspace: "There is no business workspace to change the portal menu in.",
  bad_request: "That menu change was not understood. Name each entry by its key and give a visibility, a position from 0 to 1000, or a name of up to 40 characters.",
  fixed_entry: "Home and Messages are always in your clients' menu and keep their names.",
  unknown_entry: "That is not an entry in the customer portal menu.",
  not_available_yet: "That entry is not in the customer portal yet, so it cannot be shown, hidden or renamed.",
  not_offered: "That entry only appears when your Playbook's portal lists it, and yours does not, so changing it would have no effect.",
  forbidden: "Only the business's owner or an admin can change what clients see in their portal menu.",
  unavailable: "The portal menu could not be read just now, so nothing was changed.",
  refused: "The portal menu change was not accepted, and nothing was changed.",
  outcome_unknown: "The menu change was sent but could not be confirmed. Read the menu again before doing anything else.",
});

export type PortalMenuResult =
  | { success: true; tenantId: string; modules: OverlayEntry[]; changed: string[]; normalized: string[]; replayed: boolean }
  | { success: false; reason: PortalMenuFailure; message: string; writeAttempted: boolean; key?: string };

const sqlstate = (e: unknown): string => String(isObject(e) ? e.code ?? "" : "");

type Snapshot = { modules: unknown; catalog: unknown };
type SnapshotRead = { ok: true; snapshot: Snapshot } | { ok: false; reason: "forbidden" | "unavailable" | "no_workspace" };

/** public.read_tenant_portal_menu for exactly this tenant; anything off-shape is "unavailable". */
async function readSnapshot(caller: PortalMenuCaller, tenant: string): Promise<SnapshotRead> {
  let r: { data: unknown; error: unknown };
  try { r = await caller.rpc("read_tenant_portal_menu", { p_expected_tenant_id: tenant }); } catch { return { ok: false, reason: "unavailable" }; }
  if (r.error) return { ok: false, reason: sqlstate(r.error) === "42501" ? "forbidden" : "unavailable" };
  const d = r.data;
  if (!isObject(d) || d.tenant_id !== tenant || !("modules" in d) || !isObject(d.catalog)) return { ok: false, reason: "unavailable" };
  return { ok: true, snapshot: { modules: d.modules, catalog: d.catalog } };
}

/** Changes the caller's own tenant's customer menu, then proves it from a fresh read. */
export async function configurePortalMenu(input: {
  caller: PortalMenuCaller; expectedTenantId: string | null | undefined; args: unknown;
}): Promise<PortalMenuResult> {
  let attempted = false;
  const fail = (reason: PortalMenuFailure, key?: string): PortalMenuResult =>
    ({ success: false, reason, message: PORTAL_MENU_MESSAGES[reason], writeAttempted: attempted, ...(key ? { key } : {}) });
  const tenant = input.expectedTenantId;
  if (typeof tenant !== "string" || !UUID.test(tenant)) return fail("no_workspace");
  const request = parseMenuRequest(input.args);
  if (request.ok === false) return fail(request.reason, request.key);

  const before = await readSnapshot(input.caller, tenant);
  if (before.ok === false) return fail(before.reason);
  // A catalog-only entry the Playbook does not list never renders; saying it was changed would be false.
  // That includes every opt-in entry (the funding preset's keys among them) for a business that did not
  // choose it: refused here, before any write, without naming anything the business does not have.
  const offeredKeys = catalogKeysOf(before.snapshot.catalog);
  for (const e of request.entries) {
    const meta = PORTAL_MENU_KEYS.find((m) => m.key === e.key);
    if (meta?.defaultVisibility === "catalog" && !offeredKeys.has(e.key)) return fail("not_offered", e.key);
  }
  const { entries: current, normalized } = sanitizeStoredOverlay(before.snapshot.modules);
  const merged = mergeMenuOverlay(current, request.entries);
  const changed = request.entries.map((e) => e.key);
  if (normalized.length === 0 && sameOverlay(before.snapshot.modules, merged)) {
    return { success: true, tenantId: tenant, modules: merged, changed, normalized, replayed: true };
  }

  let reply: { data: unknown; error: unknown };
  try {
    attempted = true;
    reply = await input.caller.rpc("set_tenant_portal_config", { _tenant_id: tenant, _patch: { modules: merged } });
  } catch {
    return fail("outcome_unknown");
  }
  if (reply.error) {
    const code = sqlstate(reply.error);
    // Only an answered SQL refusal proves its transaction rolled back. A gateway or network error can
    // arrive after the database committed, so it is reported as unknown, never as "not applied".
    if (!/^[0-9A-Z]{5}$/.test(code)) return fail("outcome_unknown");
    attempted = false;
    if (code === "42501") return fail("forbidden");
    if (code === "22023") return fail("bad_request");
    if (code === "P0002") return fail("no_workspace");
    return fail("refused");
  }
  const after = await readSnapshot(input.caller, tenant);
  if (after.ok === false || !sameOverlay(after.snapshot.modules, merged)) return fail("outcome_unknown");
  return { success: true, tenantId: tenant, modules: merged, changed, normalized, replayed: false };
}

export interface PortalMenuRow {
  key: string; group: PortalMenuSlot; default_label: string; label: string; fixed: boolean;
  /** Shown to a customer of this one business (after the Playbook, the overlay and the fixed rule). */
  shown: boolean;
  /** Why it is not shown, when it is not. */
  hidden_because: "owner_hid_it" | "playbook_does_not_list_it" | "not_available_yet" | null;
  order: number | null;
}

type CatalogModule = { key: string; label: string };
const mods = (...pairs: [string, string][]): readonly CatalogModule[] =>
  Object.freeze(pairs.map(([key, label]) => Object.freeze({ key, label })));
const GENERIC_MODULES = mods(["home", "Home"], ["sessions", "Sessions"], ["progress", "Progress"], ["messages", "Messages"],
  ["resources", "Resources"], ["billing", "Billing"]);

/**
 * Mirror of the starter Playbooks' portal catalogs (src/lib/playbook/presets.ts, every slug in
 * RESOLVABLE_PLAYBOOKS — including the opt-in funding vertical, which a tenant only has by choosing it).
 * Drift-tested slug by slug. getPlaybookBySlug resolves an unknown slug to the general one, and so does
 * starterCatalog below, so the catalog a business's customers get is always known here — no guessing.
 */
export const STARTER_PORTAL_CATALOGS: Readonly<Record<string, readonly CatalogModule[]>> = Object.freeze({
  "general": GENERIC_MODULES,
  "coaching-default": GENERIC_MODULES,
  "fitness": mods(["home", "Home"], ["program", "My Program"], ["check_ins", "Check-ins"], ["progress", "Progress"],
    ["messages", "Messages"], ["billing", "Billing"]),
  "consultant": mods(["home", "Home"], ["engagement", "Engagement"], ["deliverables", "Deliverables"], ["sessions", "Sessions"],
    ["messages", "Messages"], ["billing", "Billing"]),
  "agency": mods(["home", "Home"], ["campaigns", "Campaigns"], ["approvals", "Approvals"], ["assets", "Assets"],
    ["messages", "Messages"], ["billing", "Billing"]),
  "funding": mods(["home", "Home"], ["funding-journey", "Funding Journey"], ["credit", "Credit"], ["funding", "Funding"],
    ["financial-profile", "Financial Profile"], ["business", "Business"], ["agreements", "Agreements"]),
});
const starterCatalog = (slug: string | null): readonly CatalogModule[] =>
  (slug && Object.prototype.hasOwnProperty.call(STARTER_PORTAL_CATALOGS, slug) ? STARTER_PORTAL_CATALOGS[slug] : GENERIC_MODULES);

/** The generic Playbook's portal catalog keys (src/lib/playbook/presets.ts GENERIC_MODULES; drift-tested). */
export const GENERIC_PORTAL_MODULE_KEYS: readonly string[] = Object.freeze(GENERIC_MODULES.map((m) => m.key));

export type PortalCatalogInputs = { slug: string | null; authored_usable: boolean; modules: CatalogModule[] | null };

/**
 * The catalog inputs exactly as public.portal_menu_catalog returns them (to the customer and to the owner),
 * plus the modules the frontend's resolvePortalCatalog resolves them to: the authored list when the authored
 * Playbook is usable (or the generic list when it has none), else the starter slug's list (an unknown or
 * absent slug is the general one).
 */
export function projectCatalog(catalog: unknown): PortalCatalogInputs & { effectiveModules: CatalogModule[] } {
  const c = isObject(catalog) ? catalog : {};
  const authoredUsable = c.authored_usable === true;
  const modules = Array.isArray(c.modules)
    ? c.modules.filter((m): m is CatalogModule => isObject(m) && typeof m.key === "string" && typeof m.label === "string")
      .slice(0, MAX_ENTRIES).map((m) => ({ key: m.key.slice(0, 80), label: m.label.slice(0, 80) }))
    : null;
  const slug = typeof c.slug === "string" ? c.slug.slice(0, 80) : null;
  const effectiveModules = authoredUsable && modules ? modules : (authoredUsable ? GENERIC_MODULES : starterCatalog(slug)).map((m) => ({ ...m }));
  return { slug, authored_usable: authoredUsable, modules, effectiveModules };
}

/**
 * Whether Paige may mention this key to this business at all: a fixed or core entry always; an opt-in
 * entry (Approvals, the funding preset's keys, Business, Affiliate) only when this business's own catalog
 * lists it. Nothing outside this set ever appears in a read row (§2).
 */
const mentionable = (e: PortalMenuKey, listed: ReadonlySet<string>) => e.fixed || isCore(e.key) || listed.has(e.key);

/**
 * What this tenant's customers are offered, entry by entry. Fixed and core entries are always listed (a core
 * entry whose page does not exist yet as `not_available_yet`); an opt-in entry is listed only when this
 * business's catalog lists it. `catalog.modules` is the catalog this business's customers actually get.
 */
export function projectPortalMenu(snapshot: Snapshot): { entries: PortalMenuRow[]; catalog: PortalCatalogInputs } {
  const cat = projectCatalog(snapshot.catalog);
  const overlay = sanitizeStoredOverlay(snapshot.modules).entries;
  const listed = new Set(cat.effectiveModules.map((m) => m.key));
  const entries = PORTAL_MENU_KEYS.filter((e) => e.floor !== "staff" && mentionable(e, listed) && (customerLive(e) || isCore(e.key)))
    .map((e): PortalMenuRow => {
      const o = e.fixed ? undefined : overlay.find((x) => x.key === e.key);
      const fromCatalog = e.catalogLabel ? cat.effectiveModules.find((m) => m.key === e.key)?.label?.trim() || undefined : undefined;
      if (!customerLive(e)) {
        return { key: e.key, group: e.group, default_label: e.label, label: e.label, fixed: e.fixed, shown: false,
          hidden_because: "not_available_yet", order: null };
      }
      const offered = e.defaultVisibility === "shown" || listed.has(e.key);
      const hiddenByOwner = o?.visible === false;
      return {
        key: e.key, group: e.group, default_label: e.label, label: o?.label ?? fromCatalog ?? e.label, fixed: e.fixed,
        shown: hiddenByOwner ? false : offered,
        hidden_because: hiddenByOwner ? "owner_hid_it" : offered ? null : "playbook_does_not_list_it",
        order: o?.order ?? null,
      };
    });
  return { entries, catalog: { slug: cat.slug, authored_usable: cat.authored_usable, modules: cat.effectiveModules } };
}

export type PortalMenuReadResult =
  | { success: true; tenantId: string; entries: PortalMenuRow[]; catalog: PortalCatalogInputs }
  | { success: false; reason: "no_workspace" | "forbidden" | "unavailable"; message: string };

export async function readPortalMenu(input: { caller: PortalMenuCaller; expectedTenantId: string | null | undefined }): Promise<PortalMenuReadResult> {
  const tenant = input.expectedTenantId;
  if (typeof tenant !== "string" || !UUID.test(tenant)) return { success: false, reason: "no_workspace", message: PORTAL_MENU_MESSAGES.no_workspace };
  const read = await readSnapshot(input.caller, tenant);
  if (read.ok === false) return { success: false, reason: read.reason, message: PORTAL_MENU_MESSAGES[read.reason] };
  const p = projectPortalMenu(read.snapshot);
  return { success: true, tenantId: tenant, entries: p.entries, catalog: p.catalog };
}
