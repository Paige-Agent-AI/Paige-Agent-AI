/**
 * Tenant context — the SINGLE source of truth for which tenant the current user
 * is "viewing", shared across the whole app via a real React Context.
 *
 * - Platform owner / staff (Paige Agent AI master admin): sees every tenant;
 *   switching writes `profiles.active_tenant_id` so the `current_user_tenant_id()`
 *   SQL helper scopes all reads/writes to the chosen tenant. With NO tenant
 *   selected they operate at the God/platform tier (`activeTenantId === null`).
 * - Tenant member: sees only their own tenant(s); switching also works when they
 *   belong to multiple.
 *
 * ARCHITECTURE (fixed 2026-07-28): this used to be a plain hook with its own
 * `useState`, so EVERY caller got an ISOLATED copy of the state — a switch in the
 * TenantSwitcher never reached AdminLayout's `godMode`, so the operator/tenant
 * MODE switch silently failed to commit. It is now a genuine provider (one state,
 * every consumer shares it) mounted once at the app root (App.tsx), mirroring the
 * other app contexts under `src/contexts/*`. A switch now propagates to every
 * consumer synchronously AND persists across navigation.
 *
 * No realtime — this changes rarely. Components call `refresh()` after mutations.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { tenantSwitchPersisted } from "@/lib/platform/fleetCommunications";
import { ACCOUNT_SWITCH_NOTICE_KEY, forgetOperatorActAs, recordOperatorActAs } from "@/lib/auth/workspaceEntry";

/**
 * #233 — on a GENUINE new sign-in, reset the active tenant to the user's HOME.
 *
 * A "genuine new sign-in" is discriminated from the routine SIGNED_IN re-emits
 * (tab refocus), TOKEN_REFRESHED events, and plain reloads by whether Supabase's
 * `session.user.last_sign_in_at` has ADVANCED past the value we last handled. We
 * persist that per-user timestamp in localStorage and compare it on every load.
 *
 * The read may THROW (private mode / disabled storage). We must fail TOWARD
 * not-resetting (fold-fix #4): an unreadable prior-state can never be burned, so
 * treating it as "fresh" would re-fire the reset on EVERY load and yank the user
 * mid-session forever. `ok:false` therefore suppresses the reset entirely. An
 * ABSENT key in a READABLE store is different — it CAN be written once — so it
 * counts as fresh, resets a single time, then burns.
 */
const FRESH_SIGNIN_KEY = "paige.auth.lastSignInAt.";

function readHandledSignIn(uid: string): { ok: boolean; value: string | null } {
  try {
    return { ok: true, value: localStorage.getItem(FRESH_SIGNIN_KEY + uid) };
  } catch {
    return { ok: false, value: null };
  }
}
function burnHandledSignIn(uid: string, value: string): void {
  try {
    localStorage.setItem(FRESH_SIGNIN_KEY + uid, value);
  } catch {
    // Unwritable store — the reset already committed to the DB (the durable
    // source of truth); we simply can't cache the freshness marker. Worst case
    // the next load re-evaluates, finds home === current, and no-ops the write.
  }
}

function clearHandledSignIn(uid: string): void {
  try {
    localStorage.removeItem(FRESH_SIGNIN_KEY + uid);
  } catch {
    // Nothing to clear if the store is unavailable.
  }
}

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan_offer: string | null;
  seat_limit: number;
  customer_limit: number;
  owner_user_id: string | null;
  /** Capability flag: 'standalone' | 'agency' | 'enterprise'. Gates sub-accounts. */
  account_type: string;
  parent_tenant_id: string | null;
  /**
   * §65 R0: the permanent unique numeric URL address (`/agency/{account_number}/…`).
   * Assigned at creation by `trg_assign_tenant_account_number` (migration 20260916000000),
   * NOT NULL on prod. Address not a grant (§9) — the route resolver uses it to build the
   * canonical URL; RLS still gates every read. `null` only defends the pre-migration window.
   */
  account_number: number | null;
  /**
   * Per-tenant `tenants.features` JSONB — the §18 one home for config-as-data flags
   * (e.g. `features.playbook`, `features.finance_in_scope`, `features.solo_shell_enabled`).
   * Set by the platform operator (§57 source-of-truth); read here to derive
   * `soloShellEnabled` below. `null` when the row has no features object.
   */
  features: Record<string, unknown> | null;
  /**
   * Operator-internal REVENUE classification (#29): 'paid' | 'promotional' |
   * 'internal_test'. Orthogonal to `account_type` (topology) and `status`
   * (lifecycle). The `tenant_revenue_classification` table is RLS-gated to
   * `is_platform_owner()`, so this is populated for the platform OWNER only — a
   * plain tenant member reads nothing (stays `null`, §9). NOTE: a scoped Platform
   * Admin (`is_platform_admin` but not owner) also renders the operator switcher
   * yet reads 0 class rows, so every tenant collapses into the promotional group
   * for them (never a leak — just an ungrouped fallback). `null` likewise covers
   * the pre-#29-migration window (table absent → graceful null).
   */
  revenue_class: string | null;
}

interface TenantContextState {
  loading: boolean;
  /** True only while the authenticated subject's account identity is unresolved. */
  accountContextLoading: boolean;
  /**
   * Explicit pre-shell identity verdict. `ready` means the server-backed account
   * reads completed; route owners must still require the tenant shape they need.
   */
  accountContextStatus: "resolving" | "signed_out" | "error" | "ready";
  isPlatformOwner: boolean;
  /** Owner OR scoped Platform Admin — sees the God console instead of the agency CRM. */
  isPlatformStaff: boolean;
  tenants: TenantSummary[];
  /** Authenticated subject that owns browser-scoped, per-login UI preferences. */
  activeUserId: string | null;
  activeTenantId: string | null;
  activeTenant: TenantSummary | null;
  /**
   * Runtime per-tenant Solo-shell activation (§57 config-as-data, §51-safe):
   * `true` ONLY when the ACTIVE tenant's OWN `features.solo_shell_enabled === true`.
   * Reads no other tenant's features (no cross-tenant / param path). Defaults to
   * `false` while loading or when the flag is absent → shell OFF (§58 byte-unchanged).
   */
  soloShellEnabled: boolean;
  /**
   * Runtime per-tenant Agency-shell activation (§57 config-as-data, §51-safe):
   * `true` ONLY when the ACTIVE tenant's OWN `features.agency_shell_enabled === true`.
   * Reads no other tenant's features (no cross-tenant / param path). Defaults to
   * `false` while loading or when the flag is absent → shell OFF (§58 byte-unchanged).
   */
  agencyShellEnabled: boolean;
  switchTenant: (tenantId: string | null) => Promise<boolean>;
  /**
   * End an operator act-as through the audited `operator_exit_tenant`, whatever this provider's own
   * read concluded. For a destination whose account read failed: there `isPlatformStaff` is still
   * false, so `switchTenant(null)` would take the member path and record no exit. The server gates
   * the RPC on `is_platform_operator()`; a non-operator is simply refused.
   */
  exitOperatorActAs: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

const TenantContext = createContext<TenantContextState | null>(null);

/**
 * Mount ONCE at the app root, inside QueryClientProvider (App.tsx). Holds the one
 * shared tenant-scope state for the whole tree.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [accountContextLoading, setAccountContextLoading] = useState(true);
  const [accountContextStatus, setAccountContextStatus] = useState<TenantContextState["accountContextStatus"]>("resolving");
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [isPlatformStaff, setIsPlatformStaff] = useState(false);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  // Auth events can start a background revalidation before the foreground mount
  // load finishes. Track accepted reads by start order so an older response can
  // never erase a newer authenticated account context when it resolves last.
  const nextLoadIdRef = useRef(0);
  const acceptedLoadIdRef = useRef(0);
  const subjectEpochRef = useRef(0);
  const sessionUidRef = useRef<string | null>(null);
  const hasAcceptedContextRef = useRef(false);
  // Advanced by every successful operator enter/exit. A load that began before one answers with the
  // scope as it was, so it must not rewrite the act-as record the enter/exit just set.
  const actAsEpochRef = useRef(0);
  // The uid resolved by the last successful load — captured so the SIGNED_OUT
  // handler (whose session is already null) can clear THIS user's freshness
  // marker for the correct per-uid key (fold-fix #5).
  const activeUidRef = useRef<string | null>(null);

  // The provider always mounts inside QueryClientProvider (App.tsx), so this is
  // unconditional and safe. Switching the active tenant changes the scope of
  // EVERY tenant-scoped React Query cache entry, so on a switch we invalidate the
  // whole cache and let scope-dependent data refetch under the new scope (§9).
  const queryClient = useQueryClient();

  // `background` = a revalidation fired by an auth event (not the initial mount).
  // A background load MUST NOT (a) toggle `loading` — that unmounts every consumer
  // gating on it (PlatformStaffOnly, PaigeWorkspace) mid-session, losing dialog/form
  // state and flashing a loader on every routine TOKEN_REFRESHED — nor (b) overwrite
  // an already-valid context with a transient query failure (which would flip an
  // operator out of platform mode or empty a tenant's workspace). So on background it
  // stays silent and commits ONLY on a fully-successful read; the first mount keeps
  // the blocking loader (there's no prior state to preserve) so the gate resolves once.
  const load = useCallback(async (background = false) => {
    const loadId = ++nextLoadIdRef.current;
    const actAsEpochAtStart = actAsEpochRef.current;
    let loadSubjectEpoch = subjectEpochRef.current;
    let acceptedThisLoad = false;
    if (!background) {
      setLoading(true);
      if (!hasAcceptedContextRef.current) {
        setAccountContextLoading(true);
        setAccountContextStatus("resolving");
      }
    }
    try {
      // getSession() reads the session Supabase restores from localStorage. On a
      // COLD hard-load / deep-link this can already be present when getUser() (a
      // network round-trip) would still resolve null — and a null here used to
      // latch {loading:false, isPlatformStaff:false} for the whole session (the
      // operator "Restricted area" bug on /admin/platform/*). Pair with the
      // onAuthStateChange re-run below so a late hydration always re-resolves.
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      if (uid !== sessionUidRef.current) {
        // A result belongs to the authenticated subject that started it. Invalidate
        // every older in-flight read immediately when the subject changes so user A's
        // late tenant list can never paint inside user B's session (§9).
        sessionUidRef.current = uid;
        subjectEpochRef.current += 1;
        loadSubjectEpoch = subjectEpochRef.current;
        hasAcceptedContextRef.current = false;
        activeUidRef.current = uid;
        setActiveUserId(uid);
        setTenants([]);
        setActiveTenantId(null);
        setIsPlatformOwner(false);
        setIsPlatformStaff(false);
        setLoading(true);
        setAccountContextLoading(true);
        setAccountContextStatus("resolving");
      } else {
        loadSubjectEpoch = subjectEpochRef.current;
      }
      if (!uid) {
        // No session is authoritative from local storage (getSession, unlike getUser,
        // doesn't fail transiently on the network) — a real signed-out state. Clear.
        if (loadSubjectEpoch !== subjectEpochRef.current || loadId < acceptedLoadIdRef.current) return;
        acceptedLoadIdRef.current = loadId;
        acceptedThisLoad = true;
        activeUidRef.current = null;
        setActiveUserId(null);
        forgetOperatorActAs();
        hasAcceptedContextRef.current = false;
        setTenants([]);
        setActiveTenantId(null);
        setIsPlatformOwner(false);
        setIsPlatformStaff(false);
        setAccountContextStatus("signed_out");
        return;
      }

      const [owner, staff, profileRes, tenantsRes, classRes] = await Promise.all([
        supabase.rpc("is_platform_owner"),
        supabase.rpc("is_platform_admin"),
        // #233: fold `agency_login_default` into the SAME round-trip (never a
        // serial read) so the fresh-login reset can honor the #191 opt-in below.
        supabase.from("profiles").select("active_tenant_id, agency_login_default").eq("user_id", uid).maybeSingle(),
        // RLS already filters: platform staff see all, members see their own.
        supabase
          .from("tenants")
          .select("id, slug, name, status, plan_offer, seat_limit, customer_limit, owner_user_id, account_type, parent_tenant_id, account_number, features")
          .order("created_at", { ascending: true }),
        // #29: operator-internal revenue classification, for the operator switcher's
        // grouping. RLS (is_platform_owner) returns rows ONLY to platform staff — a
        // tenant member gets an empty set (never their own class, §9). A missing
        // table (pre-migration window) or any error degrades to "no classes" — the
        // switcher then falls back to an ungrouped list, never a crash (§13/§32).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from("tenant_revenue_classification" as any).select("tenant_id, revenue_class"),
      ]);

      // Never degrade a previously accepted account on a transient revalidation
      // failure. With no accepted account, however, a failed required read is an
      // explicit error verdict — it can never be treated as an empty, valid identity.
      // NOTE: classRes is intentionally NOT in this guard — the classification is an
      // enhancement; its absence (pre-migration / non-staff) must never block the shell.
      const requiredReadFailed = Boolean(owner.error || staff.error || profileRes.error || tenantsRes.error);
      if (requiredReadFailed) {
        if (hasAcceptedContextRef.current) return;
        if (loadSubjectEpoch !== subjectEpochRef.current || loadId < acceptedLoadIdRef.current) return;
        acceptedLoadIdRef.current = loadId;
        acceptedThisLoad = true;
        activeUidRef.current = uid;
        setAccountContextStatus("error");
        return;
      }

      // A later-started successful read is authoritative. This is intentionally a
      // last-SUCCESSFUL-read guard, not a last-started-read guard: a transiently
      // failed background refresh must not suppress a valid foreground result.
      if (loadSubjectEpoch !== subjectEpochRef.current || loadId < acceptedLoadIdRef.current) return;
      acceptedLoadIdRef.current = loadId;
      acceptedThisLoad = true;
      activeUidRef.current = uid;
      setActiveUserId(uid);
      const stillAuthoritative = () =>
        loadSubjectEpoch === subjectEpochRef.current && loadId === acceptedLoadIdRef.current;

      setIsPlatformOwner(Boolean(owner.data));
      setIsPlatformStaff(Boolean(staff.data));
      // Merge the operator-only revenue_class onto each tenant (null when unknown).
      const classById = new Map<string, string>();
      if (!classRes.error && Array.isArray(classRes.data)) {
        // `tenant_revenue_classification` is not yet in the generated Supabase types
        // (new #29 table), so the row type resolves to a SelectQueryError union — cast
        // through `unknown` to the real shape (TS2352). Safe: the columns are selected
        // literally above and every access below is guarded.
        for (const row of classRes.data as unknown as Array<{ tenant_id: string; revenue_class: string }>) {
          if (row?.tenant_id && row.revenue_class) classById.set(row.tenant_id, row.revenue_class);
        }
      }
      setTenants(
        // `account_number` (§65 R0, migration 20260916000000) is live on prod but not yet
        // in the generated Supabase types, so `.select(...)` widens to a SelectQueryError
        // union — cast through `unknown` to the real shape (TS2352). Safe: the column is
        // selected literally above and read as `number | null` (guarded everywhere).
        ((tenantsRes.data ?? []) as unknown as Omit<TenantSummary, "revenue_class">[]).map((t) => ({
          ...t,
          revenue_class: classById.get(t.id) ?? null,
        })) as TenantSummary[],
      );
      // Platform staff must NOT be auto-scoped into a tenant just because RLS
      // lets them read all of them — they operate at the God tier by default.
      const baseActiveTenantId =
        profileRes.data?.active_tenant_id ??
        (staff.data ? null : (tenantsRes.data?.[0] as unknown as TenantSummary | undefined)?.id ?? null);
      setActiveTenantId(baseActiveTenantId);
      // The scope this load ends on, for the act-as record below.
      let committedActiveTenantId = baseActiveTenantId;

      // --- #233: on a GENUINE new sign-in, reset the active tenant to the user's
      // HOME so a fresh login lands on home instead of wherever the last session
      // was parked (a stale sub-account, an entered agency child). Freshness is
      // `session.user.last_sign_in_at` advancing past the value we last handled;
      // routine SIGNED_IN re-emits / TOKEN_REFRESHED / reloads carry the SAME
      // timestamp and are left alone. Consulted here inside load() so BOTH the
      // event handler AND the INITIAL_SESSION / mount path get it (fold-fix #3:
      // OAuth / magic-link full-reload emits INITIAL_SESSION, not SIGNED_IN).
      const lastSignInAt = session?.user?.last_sign_in_at ?? null;
      const handled = readHandledSignIn(uid);
      const isFreshLogin =
        handled.ok && lastSignInAt !== null && handled.value !== lastSignInAt;

      // A profileRes read failure means we can't read the #191 opt-in, so we
      // skip the reset (don't reset, don't burn → the next event retries) rather
      // than risk overriding a `last_account` preference we couldn't see.
      if (isFreshLogin && !profileRes.error) {
        if (profileRes.data?.agency_login_default === "last_account") {
          // Explicit user preference wins (§36/§46) — keep the last account, do
          // NOT reset. Mark the login handled so a same-timestamp re-emit (and a
          // mid-session settings change) can't retroactively fire the reset.
          burnHandledSignIn(uid, lastSignInAt);
        } else {
          // Resolve HOME. Staff/God short-circuit BEFORE the RPC → home = null
          // (they operate at the platform tier). Everyone else gets the single
          // deterministic primary tenant (ranked is_owner→owner→admin→coach,
          // tie-break tenant_created_at ASC, tenant_id ASC — no #588
          // nondeterminism, and ONLY the caller's own entitled memberships, §9).
          let home: string | null = null;
          if (!staff.data) {
            const primary = await supabase.rpc("get_user_primary_tenant", { _user_id: uid });
            if (!stillAuthoritative()) return;
            if (primary.error) {
              // Couldn't resolve home — leave scope on the committed base and do
              // NOT burn, so the next auth event retries (fold-fix #1: never lose
              // the reset by burning the marker before it actually completes).
              hasAcceptedContextRef.current = false;
              setAccountContextStatus("error");
              return;
            }
            home = primary.data?.[0]?.tenant_id ?? null;
          }
          if (home === baseActiveTenantId) {
            // Already home — nothing to persist; mark the login handled.
            burnHandledSignIn(uid, lastSignInAt);
          } else {
            if (!stillAuthoritative()) return;
            // Persist so current_user_tenant_id() (RLS) and the client agree (§9).
            const reset = await supabase
              .from("profiles")
              .update({ active_tenant_id: home })
              .eq("user_id", uid);
            if (reset.error) {
              // Guard (fold-fix #2): the DB write FAILED — do NOT flip the client
              // to home (that would split client=home / DB=child scope) and do
              // NOT burn; retry on the next auth event with DB and client aligned.
              hasAcceptedContextRef.current = false;
              setAccountContextStatus("error");
              return;
            }
            if (!stillAuthoritative()) return;
            // Commit + invalidate ONLY after the write succeeds, then burn the
            // marker LAST (fold-fix #1) so the reset is never lost on a bail.
            setActiveTenantId(home);
            committedActiveTenantId = home;
            queryClient.invalidateQueries();
            burnHandledSignIn(uid, lastSignInAt);
          }
        }
      }
      // The act-as record follows the server whenever the server can be read: an operator with an
      // active tenant holds one, anyone else holds none. Scope moves that bypass enter/exit (the
      // fresh-login reset above, another tab, a duplicated tab's copied storage) cannot leave a
      // stale record that would later offer an exit from an act-as that is not open.
      if (actAsEpochAtStart === actAsEpochRef.current) {
        if (staff.data && committedActiveTenantId) recordOperatorActAs(uid, committedActiveTenantId);
        else forgetOperatorActAs();
      }
      hasAcceptedContextRef.current = true;
      setAccountContextStatus("ready");
    } catch {
      // A thrown transport/client failure is not a denial and not an empty account.
      // Preserve a previously accepted subject; otherwise publish an explicit error
      // verdict so route owners fail closed with a retry surface.
      const sameSubject = loadSubjectEpoch === subjectEpochRef.current;
      if (!hasAcceptedContextRef.current && sameSubject && loadId >= acceptedLoadIdRef.current) {
        acceptedLoadIdRef.current = loadId;
        acceptedThisLoad = true;
        setAccountContextStatus("error");
      }
    } finally {
      // A successful background hydration can be the first authoritative tenant
      // result on a cold deep-link, so it owns releasing the initial gate. An older
      // foreground request that became stale must not release that gate while the
      // accepted load is still completing its fresh-sign-in scope reconciliation.
      const sameSubject = loadSubjectEpoch === subjectEpochRef.current;
      if (
        (acceptedThisLoad && sameSubject && loadId === acceptedLoadIdRef.current) ||
        (!acceptedThisLoad && !background && sameSubject && loadId === nextLoadIdRef.current)
      ) {
        setLoading(false);
        setAccountContextLoading(false);
      }
    }
  }, [queryClient]);

  useEffect(() => {
    load();
    // Re-resolve when auth settles. The FIRST load() can run before Supabase
    // rehydrates the session on a hard reload / deep-link; without this listener
    // (this was the ONE auth context missing it) a pre-hydration null latched the
    // staff flags to false forever, stranding an operator on "Restricted area".
    // These events fire routinely (hourly token refresh, tab refocus), so the re-run
    // is a BACKGROUND revalidation — no loading flash, no partial-commit on failure.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        // Clear THIS user's freshness marker so the NEXT sign-in (this user
        // again, or a different user on the same browser) is correctly seen as
        // genuine (fold-fix #5). The session is already null here, so we use the
        // uid captured on the last successful load, not a read-back of the session.
        const priorUid = activeUidRef.current;
        if (priorUid) clearHandledSignIn(priorUid);
        // An act-as belongs to the session that opened it; the next person in this tab has none.
        forgetOperatorActAs();
        activeUidRef.current = null;
        load(true);
        return;
      }
      // INITIAL_SESSION is included so the OAuth / magic-link full-reload path
      // (which does NOT emit SIGNED_IN) still runs load() → the #233 freshness
      // check, instead of restoring the stale parked scope (fold-fix #3).
      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "INITIAL_SESSION"
      ) {
        load(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [load]);

  const exitOperatorActAs = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcError } = await supabase.rpc("operator_exit_tenant" as any);
    if (rpcError) return false;
    actAsEpochRef.current += 1;
    forgetOperatorActAs();
    // An "Acting as … recorded" notice still waiting for a shell that never mounted now announces an
    // act-as that has ended; the next workspace opened must not show it.
    try {
      sessionStorage.removeItem(ACCOUNT_SWITCH_NOTICE_KEY);
    } catch {
      // Storage unavailable: then no notice was stored either.
    }
    setActiveTenantId(null);
    queryClient.invalidateQueries();
    return true;
  }, [queryClient]);

  const switchTenant = useCallback(async (tenantId: string | null) => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return false;

    // ── platform staff go through the AUDITED operator seam ───────────────────
    // An operator switching into a tenant is an act-as: they are about to read and
    // act on another company's data while holding no seat there. The Fleet console
    // already promises the operator, in shipped copy, that "every session is recorded
    // in Governance" — this is what makes that true (§13).
    //
    // It routes through the SAME control the operator already uses (this function,
    // driven by TenantSwitcher) rather than adding a second act-as path beside it.
    // Two paths would be worse than none: the audit trail would look complete while
    // an unaudited route stayed open (§18 — one home per capability).
    //
    // The RPCs are auth.uid()-keyed and gated on is_platform_operator() server-side,
    // so this branch is a convenience, never the authority — a non-operator who
    // reached it would simply be refused (§9/§59).
    if (isPlatformStaff) {
      if (!tenantId) return exitOperatorActAs();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcError } = await supabase.rpc("operator_enter_tenant" as any, { _tenant: tenantId });
      // Same failure contract as the direct write below: a refused or failed switch
      // does NOT move client scope, so client and DB can never disagree (§9).
      if (rpcError) return false;
      actAsEpochRef.current += 1;
      recordOperatorActAs(uid, tenantId);
      setActiveTenantId(tenantId);
      queryClient.invalidateQueries();
      return true;
    }

    // Persist FIRST so a rejected profile write can never leave browser scope and
    // DB-backed current_user_tenant_id() scope pointing at different tenants (§9).
    const { data: persisted, error } = await supabase
      .from("profiles")
      .update({ active_tenant_id: tenantId })
      .eq("user_id", uid)
      .select("user_id")
      .maybeSingle();
    if (!tenantSwitchPersisted(uid, persisted, error)) return false;
    // The one shared provider now commits the verified switch to every consumer.
    setActiveTenantId(tenantId);
    // Scope changed for everything — a broad invalidate is correct here (§9).
    queryClient.invalidateQueries();
    return true;
  }, [queryClient, isPlatformStaff, exitOperatorActAs]);

  const activeTenant = tenants.find((t) => t.id === activeTenantId) ?? null;

  // §57 config-as-data: derive the Solo-shell flag from ONLY the active tenant's own
  // features (§51-safe — no cross-tenant read, no request param). Absent flag → false.
  const soloShellEnabled = activeTenant?.features?.solo_shell_enabled === true;

  // §57 config-as-data: derive the Agency-shell flag from ONLY the active tenant's own
  // features (§51-safe — no cross-tenant read, no request param). Absent flag → false.
  const agencyShellEnabled = activeTenant?.features?.agency_shell_enabled === true;

  const value: TenantContextState = {
    loading,
    accountContextLoading,
    accountContextStatus,
    isPlatformOwner,
    isPlatformStaff,
    tenants,
    activeUserId,
    activeTenantId,
    activeTenant,
    soloShellEnabled,
    agencyShellEnabled,
    switchTenant,
    exitOperatorActAs,
    // Always a foreground refresh — wrapped so an event-handler caller (onClick={refresh})
    // can't pass its event as the `background` arg and silently skip the loader/commit.
    refresh: () => load(),
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

/**
 * Read the shared tenant context. MUST be used under <TenantProvider> (mounted at
 * the app root). Throwing here surfaces a mis-mount immediately instead of the old
 * silent per-component-state bug.
 */
export function useTenantContext(): TenantContextState {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenantContext must be used within a <TenantProvider> (see App.tsx).");
  }
  return ctx;
}
