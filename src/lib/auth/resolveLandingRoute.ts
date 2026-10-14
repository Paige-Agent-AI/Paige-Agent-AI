import { supabase } from "@/integrations/supabase/client";
import { workspaceRootForTenant } from "@/lib/auth/workspaceEntry";
import { fetchOperatorStanding, isOperator } from "@/lib/auth/operatorStanding";

// Pre-portal onboarding is now just two gates: welcome + agreement.
// Anything beyond signing_agreement lands the client directly in /workspace,
// where Paige takes over the intake/docs conversation.
const STAGE_TO_PATH: Record<string, string> = {
  invited: "/onboard/welcome",
  signing_agreement: "/onboard/agreement",
};
const PRE_PORTAL_STAGES = new Set(Object.keys(STAGE_TO_PATH));

/**
 * Agency default-landing (#191). For a staff user who would otherwise land on
 * `/admin`, decide whether they should instead open their Agency operator side.
 *
 * Eligibility is SERVER-PROVEN (§13), never `account_type` (which flips to the
 * child's on entry): `agency_switch_context().is_agency_manager` is the authority.
 * An eligible operator's per-owner preference (`profiles.agency_login_default`,
 * default 'agency') decides WHERE:
 *   - 'agency'       → open the agency shell (also the brand-new-owner default).
 *   - 'last_account' → resume their last active account (→ /admin, which reads
 *                      profiles.active_tenant_id).
 * Returns a route only when eligible AND preference is 'agency'; otherwise null
 * so the caller falls through to "/admin". Non-agency users get null (unaffected).
 *
 * §65 R0 — LAND ON THE REAL URL, AT THE SOURCE. This used to return the bare
 * `/agency`, which `AgencyEntry` (non-numeric first segment) routes to the LEGACY
 * `AgencyLayout` board — so an owner whose preference is 'agency' (the default for
 * EVERY newly provisioned owner) never reached the URL-driven shell, while an owner
 * on 'last_account' reached it only incidentally via `/admin`'s Gate-A redirect.
 * We now emit the same address Gate A emits (`Admin.tsx` — `/agency/{n}/command-center`),
 * so both entry points agree. The fix is here, at the SENDER: bare `/agency` is NOT
 * redirected inside `AgencyEntry`, because `AgencyLayout` links to bare `/agency`
 * itself (its Dashboard nav item, its logo link, and its `*` catch-all) — redirecting
 * it would break the legacy board's own navigation and effectively retire it, which
 * is §65's LAST migration step, not this one. The legacy board stays fully intact
 * and reachable at bare `/agency` (§58).
 *
 * §13 HONEST FALLBACK — `agency_account_number` is an ADDITIVE key on
 * `agency_switch_context()`. If it is absent or non-numeric for ANY reason (the
 * migration that adds it hasn't reached prod yet, an older cached client, a genuinely
 * missing value), we return exactly what we returned before — bare `/agency` — rather
 * than constructing `/agency/null/command-center`, which would be strictly worse than
 * the bug this fixes. Never build a URL out of a null.
 */
async function resolveAgencyLanding(userId: string): Promise<string | null> {
  try {
    const [ctxRes, profileRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase.rpc("agency_switch_context" as any),
      supabase.from("profiles").select("agency_login_default").eq("user_id", userId).maybeSingle(),
    ]);
    const ctx =
      (ctxRes.data as {
        is_agency_manager?: boolean;
        /** The rail-resolved agency. Used for the §58 shell-visibility check below. */
        agency_id?: string | null;
        /** §65 R0 address of the caller's OWN agency (additive; may be absent). */
        agency_account_number?: number | string | null;
        /**
         * §39 — the per-tenant canary `/admin` Gate A gates the URL-driven shell on.
         * Additive alongside `agency_account_number`; absent on an older deploy, which
         * the strict `!== true` check below correctly reads as OFF.
         */
        agency_shell_enabled?: boolean | null;
      } | null) ?? null;
    if (ctx?.is_agency_manager !== true) return null;
    const pref = (profileRes.data as { agency_login_default?: string } | null)?.agency_login_default;
    // Default (and first-signup) is 'agency'; 'last_account' resumes /admin.
    if (pref === "last_account") return null;

    // The RPC returns jsonb, so a bigint may arrive as a number OR a string
    // depending on how the server builds it — normalize, then prove it's a real
    // positive integer before it ever reaches a URL. `Number(null)` is 0 and
    // `Number(undefined)`/`Number("abc")` is NaN, so both fail this guard and
    // fall through to the pre-existing bare-/agency return (§13).
    // §39 — HONOR THE SAME CANARY `/admin` Gate A honors. Without this check,
    // returning the numeric URL on `is_agency_manager` alone would hand EVERY
    // eligible manager the new shell regardless of the flag — `AgencyEntry` has no
    // gate of its own, so a numeric segment goes straight to AgencyApp. The flag is
    // Super-Admin-set and NOT set at provisioning, so login and `/admin` would
    // disagree for the next agency provisioned. The server returns the flag because
    // this caller cannot read `tenants.features` itself: the SELECT policy is
    // `is_tenant_member(id) OR is_platform_owner()`, and an agency-team manager with
    // no `tenant_members` row would fail it and silently degrade forever.
    //
    // NOT identical to Gate A, deliberately (§13 — do not claim parity we don't have).
    // The two gates read the flag off DIFFERENT tenants: Gate A reads the ACTIVE
    // tenant (`useTenantContext().activeTenant`, i.e. `profiles.active_tenant_id` —
    // which is the SUB's tenant while an owner is acting-as), and additionally
    // requires `tierKey === 'agency'|'enterprise'`. This resolver reads the OWNER'S
    // OWN AGENCY tenant (`agency_current_id()` inside the RPC), which is the correct
    // subject for a LOGIN landing — at login there is no act-as in play, and the
    // question being asked is "is this operator's agency on the new shell?", not
    // "is whatever tenant they last had active on it?". Same flag, same intent,
    // different (and appropriate) subject.
    if (ctx.agency_shell_enabled !== true) return "/agency";
    // §13 — a missing/garbage account number falls back to the pre-change bare
    // `/agency`, never a constructed `/agency/null/command-center`. Number(null) → 0
    // (fails > 0); Number(undefined)/Number("abc") → NaN (fails isSafeInteger). The
    // Number() coercion also normalizes a jsonb bigint that arrives as a string.
    const acctNum = Number(ctx.agency_account_number);
    if (!(Number.isSafeInteger(acctNum) && acctNum > 0)) return "/agency";

    // §58 — RAIL-ONLY MEMBERS STAY ON THE LEGACY BOARD (Codex P2 on PR #535).
    //
    // `is_agency_manager` is resolved off the AGENCY RAIL — `agency_current_id()` +
    // `agency_team_role()`, which read `agency_team_members`. `AgencyApp` resolves its
    // own identity from an entirely different source: `useTenantContext().tenants`,
    // which is a plain RLS-gated `SELECT` on `tenants` whose policy is
    // `is_tenant_member(id) OR is_platform_owner()` — and `is_tenant_member` reads ONLY
    // `tenant_members` (status='active'); it does NOT consult the rail (verified against
    // prod `pg_get_functiondef`).
    //
    // So a user who is an agency-team member via the rail but has NO `tenant_members`
    // row for that agency is a real manager to the RPC and invisible to the shell. Hand
    // them `/agency/{n}/…` and `ownAgencyTenant` resolves to null — AgencyApp renders
    // with no identity, and its own ownership guard can't save them because it bails on
    // `own == null`. Worse, if they happen to own a DIFFERENT agency, that guard
    // resolves to it and silently bounces them off the agency they were invited to.
    //
    // The agency-team-invitee branch further down already returns bare `/agency` for
    // exactly this reason — but it is UNREACHABLE for these users, because the
    // `admin` branch above calls this resolver first, and `admin` is a
    // GLOBAL role (`user_roles` has no tenant_id, §59), so anyone running their own
    // tenant carries one. This check is what makes that stated protection real.
    //
    // Tested by VISIBILITY, not by re-deriving the predicate: we ask for the agency row
    // through the same RLS-gated read the shell depends on. If it comes back, the shell
    // can resolve them; if not, the legacy board (which admits them explicitly via
    // `agency_my_membership()`) is the honest destination. Re-implementing
    // `is_tenant_member` here would be a proxy that could silently drift from it.
    //
    // §13: on a query ERROR we do NOT demote — an outage must not quietly strand every
    // agency owner on the legacy board. Only a definitive "row not visible" falls back.
    const { data: agencyVisible, error: visErr } = await supabase
      .from("tenants")
      .select("id")
      .eq("id", String(ctx.agency_id))
      .maybeSingle();
    if (!visErr && !agencyVisible) return "/agency";

    return `/agency/${acctNum}/command-center`;
  } catch {
    return null;
  }
}


/**
 * Canonical post-login landing route for a given user, based on their roles
 * and client linkage. Used by Auth.tsx, the landing header "Go to Dashboard"
 * button, and AppShell's `/app` redirect so every entry point agrees.
 *
 * Self-healing: if the signed-in user is linked to a `clients` row but is
 * missing the `client` role (legacy invites that activated before role grant
 * was added), call `ensure_client_role_self_heal()` to backfill the role and
 * onboarding stage so the workspace + onboarding gates accept them.
 *
 * Priority:
 *   1. admin           → /admin
 *   2. broker / broker_team_member → /broker/app
 *   3. linked client (clients.linked_user_id = user.id) → /onboard/<stage> or /workspace
 *   4. tenant owner/member with no synced role yet → /admin
 *   5. fallback (signed in, no role, no client link, no tenant) → /pricing
 *
 * Pay-before-workspace (B-Platform): a workspace/tenant only exists after a paid
 * platform subscription (the checkout webhook provisions the tenant). A signed-in
 * user with no staff role, no client linkage, and no tenant membership therefore has
 * NOT paid yet — a tenant requires a subscription, so no-tenant ⇒ no active sub. Send
 * them to /pricing to choose a plan and subscribe, NOT to a free onboarding gate that
 * would stand up a workspace without payment. Real tenant owners/members are already
 * caught by branch 4 (→ /admin) BEFORE this fallback, so paid users are unaffected.
 */
type LandingTenant = {
  id: string;
  account_type?: string | null;
  parent_tenant_id?: string | null;
  account_number?: string | number | null;
  features?: Record<string, unknown> | null;
};

/**
 * A safe, signed-in recovery door for an unresolved landing decision. Callers
 * must not turn an authority read failure into a guessed workspace or a chooser
 * that cannot rerun the missing role/client reads.
 */
export const LANDING_ROUTE_RETRY = "/auth?mode=login&route=retry";

export async function resolveLandingRoute(userId: string): Promise<string> {
  try {
    const [rolesRes, clientRes, ownedTenantRes, memberTenantRes, agencyTeamRes, standing] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("clients")
        .select("id, onboarding_stage")
        .eq("linked_user_id", userId)
        .maybeSingle(),
      supabase.from("tenants").select("id, account_type, parent_tenant_id, account_number").eq("owner_user_id", userId).limit(1).maybeSingle(),
      supabase.from("tenant_members").select("tenant_id").eq("user_id", userId).limit(1).maybeSingle(),
      // Agency-team invitees don't get a tenant_members row — they live in
      // agency_team_members. Without this signal they fall through to
      // /onboarding and get prompted to create their own workspace.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from("agency_team_members" as any) as any)
        .select("agency_tenant_id")
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle(),
      // The one server answer to operator standing. null = the read failed.
      fetchOperatorStanding(),
    ]);

    // Role authority is required to decide whether Platform must be offered.
    // A failed read is unknown authority, never evidence that the caller is an
    // ordinary tenant user. Return to the retryable signed-in door instead of
    // selecting any context.
    if (rolesRes.error) return LANDING_ROUTE_RETRY;

    // Typed rather than `any` (was pre-existing): CI lints CHANGED files, so touching
    // this file pulled the old `no-explicit-any` into scope. The select is
    // `user_roles.select("role")`, so the row shape is exactly this.
    let roles = (rolesRes.data || []).map((r: { role: string }) => r.role);

    // Platform operators ALWAYS pause at the shared account chooser — never enter
    // Platform automatically and never get diverted to an agency side, even if they
    // also own/admin an agency tenant. The chooser is the only place where Platform
    // or a directly authorized Paige workspace can be selected deliberately.
    //
    // WHO IS AN OPERATOR is the one server answer (`operator_standing()`), read through the
    // one client home — every tier, not a list of role words. Testing a list here once sent a
    // platform_admin, who by design holds no tenant membership, all the way to `/pricing` on
    // their own platform. A failed read is a retry, never "not an operator".
    if (standing === null) return LANDING_ROUTE_RETRY;
    if (isOperator(standing)) {
      return "/choose-account";
    }
    // Tenant/agency operators may prefer to land on their /agency side (#191);
    // a non-agency operator, or one who prefers 'last_account', falls to /admin.
    if (roles.includes("admin")) {
      const agencyRoute = await resolveAgencyLanding(userId);
      return agencyRoute ?? "/choose-account";
    }
    if (roles.includes("broker") || roles.includes("broker_team_member")) {
      return "/broker/app";
    }

    let clientRow = clientRes.data;

    // Self-heal: linked client without the `client` role, or with a missing
    // onboarding stage. Backfills both via SECURITY DEFINER RPC.
    if (clientRow?.id && (!roles.includes("client") || !clientRow.onboarding_stage)) {
      const { data: healed } = await supabase.rpc("ensure_client_role_self_heal");
      const row = Array.isArray(healed) ? healed[0] : healed;
      if (row?.healed) {
        roles = [...roles, "client"];
        clientRow = {
          id: row.client_id ?? clientRow.id,
          onboarding_stage: row.onboarding_stage ?? clientRow.onboarding_stage ?? "invited",
        };
      }
    }

    if (clientRow?.id) {
      const stage = clientRow.onboarding_stage ?? "invited";
      if (PRE_PORTAL_STAGES.has(stage)) {
        return STAGE_TO_PATH[stage];
      }
      return "/app";
    }

    // Owns or belongs to a tenant but the app_role sync hasn't landed yet
    // (defensive — the provision trigger normally grants 'admin'): still a
    // tenant operator, so send them to the tenant admin, not the consumer app.
    const ownedTenant = ownedTenantRes.data as unknown as LandingTenant | null;
    if (ownedTenant?.id) {
      return workspaceRootForTenant(ownedTenant) ?? "/choose-account";
    }
    if (memberTenantRes.data?.tenant_id) {
      return "/choose-account";
    }

    // Agency-team invitee — belongs to an agency via agency_team_members but has
    // no tenant_members row and no client link. Send them to their agency shell
    // (AgencyLayout admits them via agency_my_membership().agency_role).
    //
    // §65 R0 — DELIBERATELY still bare `/agency` (the legacy board), NOT the numeric
    // URL the agency-MANAGER branch above now emits. This user has no
    // `tenant_members` row, so `useTenantContext` resolves an EMPTY tenant list —
    // which is exactly what the URL-driven `AgencyApp` derives its own account number
    // and identity from (`ownAgencyTenant`). Routing them to `/agency/{n}/…` would
    // hand them a shell that cannot resolve who they are, whereas `AgencyLayout`
    // admits them explicitly via `agency_my_membership().agency_role`. Migrating this
    // class is its own slice, gated on the shell reading membership off the same rail
    // (§58: do not move a working entry point onto a surface that can't hold it).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((agencyTeamRes as any)?.data?.agency_tenant_id) {
      return "/agency";
    }

    // Signed in with no role/client/tenant. If they came in to accept a customer
    // invite but didn't finish (created a login, closed the tab), resume them at
    // /join instead of the tenant "create a workspace" screen. The stash is a
    // {token, ts} JSON written by JoinWorkspace ONLY for a valid invite; it
    // expires quickly so a stale/abandoned invite can't hijack a later, unrelated
    // signup on the same browser.
    try {
      const raw = localStorage.getItem("paige_pending_invite");
      if (raw) {
        const parsed = JSON.parse(raw) as { token?: unknown; ts?: unknown };
        const token = typeof parsed?.token === "string" ? parsed.token : null;
        const ts = typeof parsed?.ts === "number" ? parsed.ts : 0;
        const FRESH_MS = 30 * 60 * 1000; // 30 minutes
        if (token && /^[A-Za-z0-9_-]+$/.test(token) && Date.now() - ts < FRESH_MS) {
          return `/join/${token}`;
        }
        localStorage.removeItem("paige_pending_invite"); // stale/garbage → drop it
      }
    } catch {
      try { localStorage.removeItem("paige_pending_invite"); } catch { /* ignore */ }
    }

    // Signed in, but no tenant yet ⇒ no active platform subscription (a tenant is
    // only provisioned after payment). Pay-before-workspace: send them to /pricing to
    // subscribe, not to a free workspace-provisioning gate.
    return "/pricing";
  } catch {
    // A thrown identity/authority failure cannot safely select Platform, a tenant,
    // a client portal, or billing. Return to the signed-in auth door so the full
    // resolver can be retried; the account chooser cannot recover role/client reads.
    return LANDING_ROUTE_RETRY;
  }
}

/** Clear any "preview as client" override so a fresh login honors the role redirect. */
export function clearClientViewOverride() {
  try {
    sessionStorage.removeItem("paige_stay_in_client_view");
  } catch {
    /* ignore */
  }
}
