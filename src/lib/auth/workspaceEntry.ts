import { resolveTierKey, type TierClassification, type TierKey } from "@/lib/tier/tierFeatures";

/**
 * Workspace entry and containment — the ONE home for "may this caller be on this
 * route, and where do they belong instead?" (§18).
 *
 * OWNER RULING 2026-09-02. Account choice happens at ENTRY, never inside a
 * workspace. A person authenticates as themselves first; the platform then
 * determines their server-authorized top-level contexts. A non-platform person
 * chooses when more than one directly authorized workspace exists. Platform
 * staff ALWAYS pause at `/choose-account` so they deliberately choose Platform
 * or one of their own direct memberships. Once they enter a Solo workspace that
 * shell is LOCKED to that single authorized context. Returning to another
 * authorized context means explicitly LEAVING and re-entering through the
 * chooser — never an in-shell picker, and never an automatic fallback.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN INLINE CHECK IN EACH ENTRY. `/business/*`
 * shipped with no tier gate at all (`BusinessEntry` checked only
 * `accountContextLoading`), while its docblock asserted that "`AgencyApp`'s own
 * top-level ownership guard keeps the `:account` segment honest against the
 * caller's real tenant." That guard resolves the CALLER'S OWN account number, so
 * for a Solo caller it rewrote the URL to `/business/{their own Solo number}` and
 * left them in the sub-account shell — a wrong-mode shell they could not leave,
 * because every exit control in it is gated on owning an agency. The protection
 * the comment described was never implemented. Putting the rule in one tested
 * module is what stops the next entry point from making the same claim.
 *
 * THE ADDRESS IS NEVER THE AUTHORITY (§9/§65). Everything here reads the
 * SERVER-RESOLVED tenant classification. A URL segment, a browser-storage value,
 * a cached query and a client-side mode flag are all untrusted inputs; they can
 * say where someone wants to be, never where they may be.
 */

/**
 * Statuses that are NOT enterable. Everything else is a workspace a person can
 * be in, and must therefore be offered.
 *
 * THIS IS THE FILTER THAT SEALED THE RECOVERY PATH SHUT. The chooser, the exit
 * control and the `/admin` door each asked "how many workspaces does this person
 * have?" by counting tenants whose status is exactly `active` — so a person whose
 * other workspaces are on `trial` counted as having only one, the chooser decided
 * there was nothing to choose, and redirected them back to `/admin` and into the
 * very context they were trying to leave. Measured on production: 8 `active`,
 * 4 `trial`, 1 `canceled`. A trial workspace is live; excluding it was never
 * intended, and the owner hit it while locked out of his own Solo workspace.
 *
 * Stated as a DENY list on purpose. An allow list of "known good" statuses fails
 * in the direction that traps people — every status added later would be silently
 * un-enterable, and the symptom is a person who cannot reach their own workspace.
 * Locking someone out of a status should require naming it here.
 */
// `suspended` sits here because two sibling modules already treat it as terminal —
// `tenantLifecycle.isDestructiveStatus` pairs it with `canceled`, and the operator
// switcher buckets both as "archived". Offering a workspace the rest of the platform
// calls archived would hand someone a door that is shut from the other side.
//
// CORRECTION (§13): an earlier version of this comment said zero tenants carry
// `suspended` today, "so this aligns the rule rather than changing an outcome". The
// first half is a measurement and still holds; the second half was wrong. It changes
// an outcome the moment an operator suspends a tenant, and it changed one for the
// worse: a person parked ON a suspended workspace stopped counting as someone with
// somewhere to go, so their exit vanished. That is why the "can I get out?" surfaces
// count through `reachableWorkspaceCount` instead of this list — see its comment.
//
// It stays a DENY list on purpose: an allow list of known-good statuses fails in the
// direction that traps people, and any status added to the enum later would be
// silently unreachable instead of silently offered. `trial` and `past_due` are both
// live states someone must be able to work in — excluding `trial` is what locked the
// owner out of his own account.
const NON_ENTERABLE_TENANT_STATUS = new Set([
  "canceled",
  "cancelled",
  "suspended",
  "deleted",
  "archived",
]);

/** Can a person actually work in a tenant with this status? */
export function isEnterableTenantStatus(status: string | null | undefined): boolean {
  // Normalise BEFORE the emptiness check: a whitespace-only status is absent, not
  // a status the deny list happens not to name. Checking `!status` first let "  "
  // through as enterable, which is the deny list failing open on malformed data.
  const normalised = (status ?? "").trim().toLowerCase();
  if (!normalised) return false;
  return !NON_ENTERABLE_TENANT_STATUS.has(normalised);
}

/**
 * The workspaces a person may actually be offered — the ONE population every
 * surface that asks "how many workspaces?" must count (§18).
 *
 * The chooser, the exit control and the shell door had three separate copies of
 * this question and could disagree, which is a silently dead recovery button at
 * one surface and a redirect loop at another. One home, one answer.
 */
export function enterableWorkspaces<T extends { status?: string | null }>(tenants: readonly T[] | null | undefined): T[] {
  return (tenants ?? []).filter((t) => isEnterableTenantStatus(t.status));
}

/** The authorized entry chooser. A person LEAVES a workspace to reach it. */
export const WORKSPACE_CHOOSER_PATH = "/choose-account";

/** The route families that mount a tenant-facing shell, by URL root segment. */
export type WorkspaceRouteRoot = "solo" | "business" | "agency";

/**
 * Which tiers a route root is allowed to mount.
 *
 * `enterprise` shares the agency shell by design (§60 — Enterprise is the Agency
 * baseline plus per-tenant customization), so it is authorized on `/agency`.
 * Nothing else is: a tier absent from its row is redirected home, never rendered.
 *
 * ONLY `/business/*` RUNS THIS GATE TODAY, and the agency row is stated rather
 * than enforced. An earlier revision of this change gated the `/agency/*` numeric
 * leg too and BROKE a shipped capability (§58): an agency operator acting inside
 * a sub-account carries the CHILD's classification while their authority comes
 * from the parent, so the gate ejected them out of the acting-child path that
 * `/agency/{parent}/sub/{child}/…` exists to serve. CI caught it — see
 * `TenantRouteOwnerAccountContext.integration.test.tsx`. The agency-tier hole the
 * gate was reaching for (a Solo caller who TYPES `/agency/{n}` mounts the agency
 * shell and is never sent home) is real, out of this brief's scope, and tracked
 * separately rather than fixed here by a guess about agency behaviour.
 */
const ROUTE_TIERS: Record<WorkspaceRouteRoot, readonly TierKey[]> = {
  solo: ["solo"],
  business: ["sub_account"],
  agency: ["agency", "enterprise"],
};

/**
 * Does the caller's server-derived tier match the operating mode this route
 * mounts? Platform staff are deliberately NOT special-cased here: an operator
 * acting as a tenant carries that tenant's classification, and an operator with
 * no active tenant has no business being on a tenant route.
 */
export function routeAllowsTier(root: WorkspaceRouteRoot, tier: TierKey): boolean {
  return ROUTE_TIERS[root].includes(tier);
}

export type WorkspaceEntryDecision =
  | { kind: "allow" }
  /** Send them to their own authorized root for the tier they actually hold. */
  | { kind: "redirect"; to: string }
  /**
   * We know the route is wrong for them but not where they belong — no account
   * number, or a tier with no single home. Fail CLOSED to the chooser rather
   * than guessing a tenant, which is the convenience fallback the ruling bans.
   */
  | { kind: "chooser" };

/**
 * The authorized root for a tier, when the caller's own account number is known.
 * Returns null when there is no single correct home to send them to.
 */
export function authorizedRootForTier(tier: TierKey, accountNumber: number | string | null | undefined): string | null {
  if (accountNumber == null || String(accountNumber).trim() === "") return null;
  const n = String(accountNumber);
  switch (tier) {
    case "solo":
      return `/solo/${n}/command-center`;
    case "sub_account":
      return `/business/${n}/command-center`;
    case "agency":
    case "enterprise":
      return `/agency/${n}/command-center`;
    default:
      // `god` and anything unrecognised have no tenant-facing home.
      return null;
  }
}

/**
 * The gate every tenant-facing route entry runs before it mounts a shell.
 *
 * Deliberately takes the resolved classification rather than reading context
 * itself, so it is a pure function the tests can drive across every tier without
 * a provider — and so a caller cannot accidentally pass a URL-derived value.
 */
export function decideWorkspaceEntry(input: {
  root: WorkspaceRouteRoot;
  classification: TierClassification;
  /** The caller's OWN account number, server-resolved. Never the URL segment. */
  accountNumber: number | string | null | undefined;
}): WorkspaceEntryDecision {
  const tier = resolveTierKey(input.classification);
  if (routeAllowsTier(input.root, tier)) return { kind: "allow" };
  const home = authorizedRootForTier(tier, input.accountNumber);
  return home ? { kind: "redirect", to: home } : { kind: "chooser" };
}

/**
 * How many workspaces can this person actually GET TO from where they are?
 *
 * This is the count every "should we offer a way out?" surface asks, and it is
 * deliberately NOT the same list the chooser OFFERS. The workspace someone is
 * currently in counts regardless of its status, because they are demonstrably in
 * it — and if it has been suspended underneath them, that is precisely when they
 * most need the exit.
 *
 * WHY THIS EXISTS (§58). Adding `suspended` to the deny list was correct for the
 * offer list — the rest of the platform calls those workspaces archived, and
 * sending someone INTO one is a door shut from the other side. But both counting
 * surfaces used that same list, so a person parked ON a suspended workspace with
 * exactly one other enterable one counted as a single-workspace person: the exit
 * control rendered nothing and the door never asked. The control this PR deletes
 * had no status filter at all, so its dropdown still rendered — meaning the
 * narrower rule removed the only in-app way out of a suspended workspace.
 *
 * The decision-log line claiming that change "aligns the rule rather than changing
 * an outcome" was true of today's data and false of the rule: an operator can
 * suspend a tenant in one click.
 */
export function reachableWorkspaceCount(
  tenants: readonly { id: string; status?: string | null }[] | null | undefined,
  activeTenantId: string | null | undefined,
): number {
  const list = tenants ?? [];
  const enterable = new Set(enterableWorkspaces(list).map((t) => t.id));
  if (activeTenantId && list.some((t) => t.id === activeTenantId)) enterable.add(activeTenantId);
  return enterable.size;
}

/**
 * The canonical workspace root a given tenant should be entered at, or null
 * when its server-resolved classification or address is not safe to route.
 *
 * ONE home (§18) for "this is the context — where does the person land?", shared
 * by the chooser and by the shell host.
 *
 * It never falls back through the retired privileged route. Unknown or
 * incomplete classification returns null so the caller can remain on the
 * chooser with an honest error. The literal `standalone` check prevents
 * `resolveTierKey`'s safe default from routing incomplete data as a Solo tenant.
 */
export function workspaceRootForTenant(tenant: {
  account_type?: string | null;
  parent_tenant_id?: string | null;
  account_number?: number | string | null;
  features?: Record<string, unknown> | null;
} | null | undefined): string | null {
  if (!tenant) return null;
  const tier = resolveTierKey({
    account_type: tenant.account_type ?? null,
    parent_tenant_id: tenant.parent_tenant_id ?? null,
    isPlatformStaff: false,
  });
  // Unknown account types fail safe to Solo, so require the literal top-level
  // standalone classification before emitting a Solo address.
  // tier-feature-exempt: tenant route classification validates canonical shell ownership; it is not a feature gate.
  if (tier === "solo" && (tenant.account_type !== "standalone" || tenant.parent_tenant_id != null)) return null;
  return authorizedRootForTier(tier, tenant.account_number ?? null);
}

/**
 * The session key recording which workspace this browsing session has already
 * entered through the chooser.
 *
 * WHY THIS IS NOT "BROWSER STORAGE AS PROOF OF ACCESS", which the ruling bans.
 * It carries no claim about what may be read. Scope is, and remains, entirely
 * server-enforced: `profiles.active_tenant_id` behind its membership trigger,
 * and `current_user_tenant_id()` re-applying the same predicate on every read.
 * A person who forged this value would change nothing except whether they are
 * asked a question they have already answered.
 *
 * IT IS KEYED ON THE TENANT ID, DELIBERATELY. A bare "already asked" boolean
 * would go stale the moment the active context changed underneath it — which is
 * the exact failure this whole repair exists to fix. Storing WHICH workspace was
 * entered means a context the person did not choose re-arms the question by
 * itself.
 *
 * It replaces a `?picked=1` URL marker, which survived exactly one navigation:
 * any in-app link pushes a history entry with no query string, so the next click
 * anywhere re-armed the gate and ejected the person to the chooser.
 */
export const WORKSPACE_ENTERED_KEY = "paige.workspace.entered";

/**
 * A one-time notice for the workspace a person just arrived in. The page that switched cannot show
 * it (a full load ends that page), so the destination's account control drains it once on mount.
 * The operator act-as uses it to say, on arrival, that the session is recorded.
 */
export const ACCOUNT_SWITCH_NOTICE_KEY = "paige.accountSwitch.notice";

/**
 * This browser session opened an operator act-as that has not been exited. Written and cleared only
 * by the tenant provider, on a successful audited enter or exit. It grants nothing: it decides
 * whether a destination that could not load its account context still offers the operator the
 * audited exit, because at that moment the provider cannot tell an operator from a member.
 */
export const OPERATOR_ACT_AS_KEY = "paige.operator.actingAs";

export function recordOperatorActAs(tenantId: string | null): void {
  try {
    if (tenantId) sessionStorage.setItem(OPERATOR_ACT_AS_KEY, tenantId);
    else sessionStorage.removeItem(OPERATOR_ACT_AS_KEY);
  } catch {
    // Unavailable storage only means a stranded destination offers "Try again" alone.
  }
}

export function operatorActAsRecorded(): boolean {
  try {
    return Boolean(sessionStorage.getItem(OPERATOR_ACT_AS_KEY));
  } catch {
    return false;
  }
}

/**
 * A SECOND-CHANCE settlement marker on the URL, for the one case the session
 * record cannot cover: storage that throws.
 *
 * The record above is the durable signal and does the real work. It is also
 * best-effort — private mode and blocked storage make every write a no-op — and
 * where that happens a tenant whose shell canary is off has nowhere durable to
 * land: the chooser sends it to `/admin`, the door sees no record, and the two
 * bounce, one hop per click, forever.
 *
 * IT IS HONOURED ONLY WHEN `workspaceRecordUsable()` IS FALSE, and that condition
 * is what makes it safe rather than a hole. Two earlier revisions got this wrong
 * in opposite directions. Making it the ONLY mechanism failed because a URL
 * marker survives one navigation, so the first in-app link re-armed the gate.
 * Then CONSUMING it — stripping it from the URL during render to stop it being
 * bookmarked as a permanent answer — was worse: a render that mutates the value
 * that same render reads is not a pure render, so React re-invoking the mount
 * pass (StrictMode in development, an interrupted render in principle) read a URL
 * the discarded pass had already stripped, concluded nothing had settled, and
 * rebuilt the exact infinite redirect the marker exists to prevent.
 *
 * Gating on storage instead closes the bookmark hole without touching the URL at
 * all: on any browser that can hold the record, a bookmarked `?picked=1` is
 * simply ignored, because the record is the signal there. It is honoured only
 * where no record can exist — and a bookmark is the least of anyone's problems in
 * a browser that cannot write one.
 */
export const WORKSPACE_CHOOSER_SETTLED_PARAM = "picked";

/**
 * Can this browser actually hold the session record?
 *
 * The URL marker below exists ONLY to cover the case where it cannot, so this is
 * what decides whether that marker is honoured at all. A pure read: it probes,
 * cleans up after itself, and mutates nothing a later render depends on.
 */
export function workspaceRecordUsable(): boolean {
  try {
    const probe = `${WORKSPACE_ENTERED_KEY}.probe`;
    sessionStorage.setItem(probe, "1");
    // READ IT BACK. The question this answers is not "can I write?" but "will a
    // read return what I wrote?" — because that is the only property the record
    // depends on. A store that accepts writes and returns null on read would have
    // reported itself usable, which switches off the URL fallback while the record
    // it vouched for never matches: the infinite redirect, rebuilt.
    const readBack = sessionStorage.getItem(probe);
    sessionStorage.removeItem(probe);
    return readBack === "1";
  } catch {
    return false;
  }
}

/** Record that this session entered `tenantId` by choosing it. Best-effort. */
export function rememberWorkspaceEntered(tenantId: string | null | undefined): void {
  if (!tenantId) return;
  try {
    sessionStorage.setItem(WORKSPACE_ENTERED_KEY, tenantId);
  } catch {
    // Private mode or blocked storage. It fails in the safe direction — the person
    // is asked again rather than let through — but stating only that understates
    // it (round eight, finding 2, driven). For a multi-workspace person whose
    // workspace has no deep-linkable root, the chooser's destination is `/admin`
    // itself, and the `?…settled=1` marker covers only that one hop; every later
    // return to `/admin` re-asks, for the whole session. It is not a redirect
    // storm — each cycle needs a human click, and the correct workspace is still
    // entered — but `/admin` never settles for that person until storage works.
    // Accepted rather than papered over: the alternatives are a durable marker in
    // a store that is by definition unavailable, or a URL token that would have to
    // survive bookmarking, which is a bypass, not a fix.
  }
}

/** Clear the tenant-entry settlement when the person explicitly chooses Platform. */
export function forgetWorkspaceEntered(): void {
  try {
    sessionStorage.removeItem(WORKSPACE_ENTERED_KEY);
  } catch {
    // Best-effort only. The marker grants no access; an unavailable store simply
    // means a later tenant entry asks the person to choose again.
  }
}

/** Has this session already chosen the workspace it is currently in? */
export function hasEnteredWorkspace(activeTenantId: string | null | undefined): boolean {
  if (!activeTenantId) return false;
  try {
    return sessionStorage.getItem(WORKSPACE_ENTERED_KEY) === activeTenantId;
  } catch {
    return false;
  }
}

/**
 * Client-side state that belongs to the workspace a person is LEAVING, and must
 * not follow them into the one they just chose.
 *
 * Entering a workspace is a full-page load, so React state, context and the query
 * cache are already gone; what survives a load is browser storage. Each key below
 * carries prior-account IDENTITY or NAVIGATION rather than a personal preference,
 * which is the line drawn here: a rail someone collapsed or a theme they picked is
 * theirs and follows them, but a contact they were impersonating, a business they
 * had selected, a client-view latch and a stashed return path all name the OLD
 * account and would render — or navigate — under the new one's heading.
 *
 * `paige.oauth.return` is the sharpest of them: it is a route back into the
 * previous workspace, and leaving it in place is precisely the "old deep link that
 * reopens the wrong account" this repair exists to end.
 *
 * Deliberately NOT cleared: tenant-keyed values (they are already scoped, e.g.
 * `paige:workspaceRail:collapsed:{tenantId}`), pure cosmetics (theme, density, rail
 * collapse, command-center view), and anything belonging to the operator seam.
 * Over-clearing would silently reset preferences a person set on purpose.
 *
 * `paige.activeBusinessId` was in this list and was REMOVED after checking its
 * owning module: `BusinessContext` selects businesses by `owner_user_id`, not by
 * tenant, so it names the PERSON rather than the account they were in. Clearing
 * it would have been over-clearing justified by a comment that did not match the
 * code — the same class of mistake as prose asserting a protection.
 */
const WORKSPACE_SCOPED_STORAGE = {
  session: [
    "paige_impersonating_contact",
    "paige_stay_in_client_view",
    "paige.oauth.return",
  ],
} as const;

/** Drop the leaving workspace's identity/navigation state. Best-effort. */
export function clearWorkspaceScopedState(): void {
  try {
    for (const key of WORKSPACE_SCOPED_STORAGE.session) sessionStorage.removeItem(key);
  } catch {
    // Storage unavailable; nothing was stored either, so nothing can leak.
  }
}
