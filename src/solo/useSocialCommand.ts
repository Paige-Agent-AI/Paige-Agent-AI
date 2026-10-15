/**
 * useSocialCommand — the adapter behind Campaigns › Social.
 *
 * WHY IT IS ITS OWN FILE, and not two more reads inside `useSoloCampaigns`. That adapter is
 * contract-locked at exactly four tenant-scoped reads and asserted read-only
 * (`growth2.contract.test.tsx:74,87`), and the guard is worth leaving sharp rather than editing —
 * the same reasoning `catalog-offers.contract.test.tsx:1-5` and `sales-ops.contract.test.tsx:17-23`
 * record for their own slices. So Social composes that hook's results and adds its own.
 *
 * THE SURFACE AND PAIGE READ THE SAME FUNCTION (§18). Recorded accounts come from
 * `get_social_presence_evidence` — the Spine capability `social.presence` — not from a second query
 * over `tenants.features`. One home means the screen can never show a set of accounts that PAIGE
 * would describe differently in the same session, and a write refreshes both by refreshing one.
 *
 * WHAT THIS CANNOT DO, stated so no caller expects otherwise (§13/§38). It records accounts. It
 * does not connect them: no OAuth, no token, no provider API. Nothing here can return a follower
 * count, reach, a queue, a schedule, or a placement, because nothing in the platform holds one for
 * a tenant — see `social-truth.ts` for where each of those absences is rendered.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { SOCIAL_NETWORKS, type SocialHandle, type SocialNetworkKey } from "./social-truth";

export type SocialPresenceRow = {
  network: string;
  status: "on_record" | "not_recorded" | "unavailable";
  handle: string | null;
  as_of: string | null;
  reason: string | null;
  tenant_id: string | null;
};

export type SocialWriteResult =
  | { ok: true; recordedCount: number }
  | { ok: false; message: string };

export type SocialCommandState = {
  tenantId: string | null;
  phase: "resolving" | "loading" | "ready" | "error" | "unavailable";
  /** Accounts this workspace has recorded, in the platform's network order. */
  handles: SocialHandle[];
  /** True only for an owner or admin — the same predicate the write's own gate uses. */
  canManage: boolean;
  /** When the workspace record last changed. Never a per-account timestamp; none is recorded. */
  recordChangedAt: string | null;
  /**
   * The read came back, but this caller is not permitted to see the workspace's account record.
   * Distinct from "nothing recorded" on purpose — telling a member their business has no accounts
   * when it has six is the failure this flag exists to prevent.
   */
  notPermitted: boolean;
  /** The membership read failed, or the caller could not be resolved — authority is UNKNOWN. */
  authorityUnknown: boolean;
  /** Every returned row was `unavailable` — the record exists or does not, and we were not shown. */
  handlesUnknown: boolean;
  recordHandles: (draft: Record<string, string>) => Promise<SocialWriteResult>;
  retry: () => void;
};

const NETWORK_LABEL = new Map<string, string>(SOCIAL_NETWORKS.map((n) => [n.key, n.label]));
const REFUSED_REASON = "not permitted for this account";

/** The server writes these sentences for a person, so a code we recognise surfaces as written. */
function safeWriteMessage(code?: string): string {
  if (code === "42501") return "Your permission or workspace changed. Reopen this page with owner or admin access.";
  if (code === "22023" || code === "23514" || code === "22P02") return "Check the handles you entered, then try again.";
  return "The save could not be confirmed. Reload the page and check what is on record before trying again.";
}

/**
 * Classify one presence response. PURE, exported, and tested directly.
 *
 * Extracted because the §39 peer-gate proved the previous shape untestable in the way that matters:
 * `useSocialCommand` had no executed test at all — the contract suite greps it as a SOURCE STRING —
 * so `unreadable`, the entire basis of the `handlesUnknown` chain, could be reverted to `refused`
 * and break zero tests. A guard that cannot fail is not a guard. The repo already answers this with
 * `toPendingAction`: put the decision in a pure function and assert on it.
 */
export function classifyPresence(rows: SocialPresenceRow[]): {
  handles: SocialHandle[];
  refused: boolean;
  unreadable: boolean;
} {
  // A response that produced NO rows is not a workspace with no accounts. Both predicates below
  // opened with `rows.length > 0`, which fails in the OPPOSITE direction from `campaignsUnknown`
  // ("unread until proven otherwise") shipped in the same commit: an unparseable or shape-changed
  // response coerces to `[]` at the call site, and both flags then read false, so the page said
  // "No account is on record" about a body nobody could read. An empty response is unknown, not empty.
  const emptyResponse = rows.length === 0;
  // `notPermitted` is the ACCESS case and drives the Channels panel's specific copy, so it stays
  // keyed on that one reason (§58 — that panel's wording is shipped and correct). It is a STRICT
  // SUBSET of `unreadable`, which is why every consumer must branch on the superset first.
  //
  // `every` over a homogeneous set: the function returns one row per network and refuses them
  // together, never per-network. If it ever refuses partially this must become `some` — the
  // predicate is only sound because that guarantee holds.
  const refused = !emptyResponse && rows.every((row) => row.status === "unavailable" && row.reason === REFUSED_REASON);
  // The wider class: the function has THREE refusals ('not permitted for this account', 'workspace
  // record not readable', 'workspace not resolved') and every one returns a SUCCESSFUL response
  // carrying zero on-record rows. Only the first was ever surfaced, so the other two reached the
  // page as "this workspace has no accounts" — an assertion about a record nobody read.
  const unreadable = emptyResponse || rows.every((row) => row.status === "unavailable");
  const handles: SocialHandle[] = rows
    .filter((row) => row.status === "on_record" && typeof row.handle === "string" && row.handle.trim())
    .map((row) => ({
      network: row.network as SocialNetworkKey,
      label: NETWORK_LABEL.get(row.network) ?? row.network,
      handle: (row.handle as string).trim(),
    }));

  return { handles, refused, unreadable };
}

export function useSocialCommand(): SocialCommandState {
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const [refreshKey, setRefreshKey] = useState(0);
  const [state, setState] = useState<
    Pick<SocialCommandState, "tenantId" | "phase" | "handles" | "canManage" | "recordChangedAt" | "notPermitted" | "handlesUnknown" | "authorityUnknown">
  >({
    tenantId: activeTenantId ?? null,
    phase: accountContextLoading ? "resolving" : "loading",
    handles: [],
    canManage: false,
    recordChangedAt: null,
    notPermitted: false,
    handlesUnknown: false,
    authorityUnknown: false,
  });

  // An identity epoch also invalidates a completion after A -> B -> A, so a slow response from the
  // previous workspace can never land as this one's answer.
  const identity = useRef({ tenantId: activeTenantId, resolving: accountContextLoading });
  if (identity.current.tenantId !== activeTenantId || identity.current.resolving !== accountContextLoading) {
    identity.current = { tenantId: activeTenantId, resolving: accountContextLoading };
  }

  useEffect(() => {
    let cancelled = false;
    const opened = identity.current;

    if (accountContextLoading) {
      setState((prev) => ({ ...prev, tenantId: activeTenantId ?? null, phase: "resolving" }));
      return () => { cancelled = true; };
    }
    if (!activeTenantId) {
      setState({ tenantId: null, phase: "unavailable", handles: [], canManage: false, recordChangedAt: null, notPermitted: false, handlesUnknown: false, authorityUnknown: false });
      return () => { cancelled = true; };
    }

    setState((prev) => ({ ...prev, tenantId: activeTenantId, phase: "loading" }));

    void (async () => {
      // Resolved ONCE, before the pair, and kept. Inlining it as `?? ""` sent an empty string to a
      // uuid column on any `getUser()` blip — PostgREST 400, `role.data` null, error discarded, and
      // a real owner rendered as read-only. `callerId` being absent is itself an unknown authority,
      // not an absence of authority, which is why it feeds the flag below rather than a false.
      const callerId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const [presence, role] = await Promise.all([
        // No tenant argument: a JWT caller's workspace is server-resolved and the function ignores
        // one anyway (§9/§588). Passing it would only create the illusion that it is honoured.
        supabase.rpc("get_social_presence_evidence" as never, {} as never),
        callerId
          ? supabase
              .from("tenant_members")
              .select("role")
              .eq("tenant_id", activeTenantId)
              .eq("user_id", callerId)
              // `is_tenant_admin` requires status='active' (migration 20260629175341). Omitting it
              // here made the client predicate WIDER than the server's: revocation sets
              // status='revoked' and deliberately leaves `role` intact, so a revoked admin kept
              // canManage and got a button whose save raises 42501. The two sibling hooks that
              // carry this same gate both filter on status; this one did not.
              .eq("status", "active")
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (cancelled || identity.current !== opened) return;

      if (presence.error) {
        setState({ tenantId: activeTenantId, phase: "error", handles: [], canManage: false, recordChangedAt: null, notPermitted: false, handlesUnknown: false, authorityUnknown: false });
        return;
      }

      const rows = (Array.isArray(presence.data) ? presence.data : []) as SocialPresenceRow[];
      // BIND FIRST. A row naming another workspace is not this workspace's record — the same
      // divergence the Chat adapter guards, arriving here through the same resolver.
      const foreign = rows.some((row) => row.tenant_id && row.tenant_id !== activeTenantId);
      if (foreign) {
        setState({ tenantId: activeTenantId, phase: "error", handles: [], canManage: false, recordChangedAt: null, notPermitted: false, handlesUnknown: false, authorityUnknown: false });
        return;
      }

      const { handles, refused, unreadable } = classifyPresence(rows);
      if (role.error) {
        console.error("[social-command] membership read failed; treating authority as unknown", role.error);
      }
      const memberRole = (role.data as { role?: unknown } | null)?.role;
      setState({
        tenantId: activeTenantId,
        phase: "ready",
        handles,
        // The same predicate the server's own gate uses (`is_tenant_admin`), so the form is offered
        // to exactly the callers the write will accept rather than to everyone who can see it.
        canManage: memberRole === "owner" || memberRole === "admin",
        // A FAILED AUTHORITY READ IS NOT A CALLER WITHOUT AUTHORITY.
        //
        // `useCatalogOffers`, `useSoloSalesOps` and `useSoloCommercialTerms` all carry this flag; this
        // hook was the only one of the four without it (§18), and the gap became load-bearing the
        // moment the record button was made conditional on `canManage`: a blip in the membership
        // read now costs a genuine owner the one action this surface offers, and tells them
        // "Read-only access — an owner or admin records these" about their own workspace.
        authorityUnknown: Boolean(role.error) || !callerId,
        recordChangedAt: rows.find((row) => row.as_of)?.as_of ?? null,
        notPermitted: refused,
        handlesUnknown: unreadable,
      });
    })();

    return () => { cancelled = true; };
  }, [activeTenantId, accountContextLoading, refreshKey]);

  const retry = useCallback(() => setRefreshKey((key) => key + 1), []);

  /**
   * The write, beside the read it has to refresh.
   *
   * `_expected_tenant_id` is refusal-only on the server: it never selects a workspace, it can only
   * abort — which is what makes a form opened against one workspace fail rather than silently save
   * into another the same person also belongs to.
   *
   * THE PAYLOAD IS THE COMPLETE SET, not a patch. A network the caller omits is cleared, because a
   * partial write would make "remove my TikTok" impossible to express, and the Systems Check counts
   * keys — a handle nobody can delete would keep a check passing for an account that is gone.
   */
  const recordHandles = useCallback(async (draft: Record<string, string>): Promise<SocialWriteResult> => {
    if (!activeTenantId) {
      return { ok: false, message: "This workspace could not be resolved, so nothing was saved." };
    }
    const opened = identity.current;
    if (opened.resolving || !opened.tenantId) {
      return { ok: false, message: "Wait for your workspace to finish loading, then try again." };
    }
    try {
      const { data, error } = await supabase.rpc(
        "record_social_handles" as never,
        { _expected_tenant_id: activeTenantId, _handles: draft } as never,
      );
      if (identity.current !== opened) {
        return { ok: false, message: "Your workspace changed. Reopen this page in the intended workspace." };
      }
      if (error) {
        console.error("[social] record_social_handles failed", { code: (error as { code?: string }).code });
        return { ok: false, message: safeWriteMessage((error as { code?: string }).code) };
      }
      if (data === null || data === undefined) {
        return { ok: false, message: "The save could not be confirmed. Reload and check what is on record." };
      }
      setRefreshKey((key) => key + 1);
      // Reports the count the DATABASE read back off the updated row, never the length of what was
      // sent — a value the server normalised or dropped can then never be shown back as stored.
      const recorded = (data as { recorded_count?: unknown }).recorded_count;
      return { ok: true, recordedCount: typeof recorded === "number" ? recorded : 0 };
    } catch {
      return {
        ok: false,
        message: identity.current !== opened
          ? "Your workspace changed. Reopen this page in the intended workspace."
          : "The save could not be confirmed. Reload and check what is on record.",
      };
    }
  }, [activeTenantId]);

  return { ...state, recordHandles, retry };
}
