/**
 * useSoloPendingActions — the work Paige has stopped on and is waiting for a person to decide.
 *
 * WHY THIS EXISTS. The Trust Compass ships two modals that describe a decision awaiting the
 * operator. Until now both were literals in the file: an outbound email addressed to
 * `sarah.nnadi@harpervale.com`, with a body, a "why she drafted it" rationale citing behaviour
 * that never happened, and a 91% confidence figure; and a legal escalation stating that a workers'
 * compensation policy "lapsed on August 9", naming a carrier, and recommending a course of action.
 * Approving the first one raised a toast reading "Sent." — a claim that an email had gone to a
 * person who does not exist.
 *
 * That is four of the six things the standing boundary names in two modals: an invented customer
 * record, invented provider state, an invented measurement, and a fabricated successful action.
 *
 * §18 — ONE SEAM. `paige_actions` is the action bus: the row Paige files when work needs doing,
 * carrying its own title, summary, draft, originating department and rationale. `usePaigeDeptStatus`
 * already reads it for the department tiles. This composes the same table rather than inventing a
 * second idea of "what is waiting on you".
 *
 * WHAT "WAITING ON YOU" ACTUALLY IS, read off production rather than assumed. There is no
 * `pending_approval` row in use anywhere; the real shape is `status = 'filed'` with
 * `autonomy_lane = 'confirm'` — filed, and not permitted to run unattended. 117 such rows exist
 * (2026-09-01), against 37 done. A read that filtered on the status name a designer would guess
 * would have returned nothing and rendered an honest-looking empty state over a real backlog.
 *
 * §9 TENANT ISOLATION: the read MUST be scoped to the VIEWED workspace with an explicit
 * `tenant_id = <viewed tenant>` filter — RLS alone is NOT enough here. The live policy
 * `pa_tenant_staff_read` gates SELECT on `tenant_id = current_user_tenant_id() AND a staff role`
 * OR `has_role(auth.uid(),'admin')` — and that second clause is a GLOBAL (tenant-agnostic, §53/§59)
 * operator escape: any holder of the global `admin` role can read EVERY tenant's `paige_actions`.
 * So an unfiltered read on a platform-operator act-as (or any global admin) would surface OTHER
 * tenants' action titles/counts on the viewed tenant's Trust Compass. The caller therefore passes
 * the viewed tenant (the Compass `accountEpoch`) and this hook constrains the query to it; a null
 * workspace runs NO query (never an unscoped read). For a normal tenant admin the filter equals the
 * RLS scope, so it is a no-op there.
 *
 * §13 — WHAT THIS CANNOT PROVIDE, and therefore does not. `paige_actions` has no recipient, no
 * sender, no confidence score, and no list of options. The modals rendered all four. They are not
 * "missing data to be filled in later" — they are claims with no source, so the fields go rather
 * than being defaulted to something plausible.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { departmentLabel } from "./useSoloActivityFeed";

/** How many waiting items a modal needs. It shows one; a few are read so "next" is possible. */
const MAX_ITEMS = 10;

/** One filed action that cannot proceed without a person. */
export interface SoloPendingAction {
  id: string;
  /** What the action is, as Paige filed it. */
  title: string;
  summary: string | null;
  /** The drafted artefact, when the action carries one. */
  draftContent: string | null;
  /** Why it stopped here, when the row records a reason. */
  rationale: string | null;
  /** The desk it came from, named from the seeded §16 slugs. */
  department: string;
  createdAt: string;
}

export interface SoloPendingActionsData {
  items: SoloPendingAction[];
  /** Exact caller-scoped count, independently of the ten-row preview; null means not supplied. */
  total?: number | null;
  loading: boolean;
  /** Distinct from an empty list. A failed read is not "nothing is waiting" (§13). */
  error: string | null;
  refresh: () => void;
}

/** Coerce a selected row; a row with no id or title is dropped rather than half-rendered. */
export function toPendingAction(raw: unknown): SoloPendingAction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string" || !r.title.trim()) return null;
  const text = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v : null;
  // `draft_content` is jsonb-or-text depending on what filed it. Only a string is rendered as a
  // draft body; an object is real data but not prose, and stringifying it would put a JSON blob in
  // front of an operator as though Paige had written it.
  const draft = typeof r.draft_content === "string" && r.draft_content.trim() ? r.draft_content : null;
  return {
    id: r.id,
    title: r.title,
    summary: text(r.summary),
    draftContent: draft,
    rationale: text(r.decision_rationale),
    department: departmentLabel(
      typeof r.from_department === "string" && r.from_department ? r.from_department : null,
    ),
    createdAt: typeof r.created_at === "string" ? r.created_at : new Date().toISOString(),
  };
}

export function useSoloPendingActions(tenantId: string | null): SoloPendingActionsData {
  const [items, setItems] = useState<SoloPendingAction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const mounted = useRef(false);
  const scope = typeof tenantId === "string" && tenantId ? tenantId : null;
  const [settledScope, setSettledScope] = useState(scope);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setSettledScope(scope);
    setItems([]);
    setTotal(null);

    // No resolved workspace → no read at all (§9). Never run an unscoped query that the global-admin
    // operator escape on pa_tenant_staff_read would widen to every tenant.
    if (!scope) {
      setItems([]);
      setTotal(null);
      setError(null);
      setLoading(false);
      return () => { cancelled = true; mounted.current = false; };
    }

    setLoading(true);
    void (async () => {
      try {
        const { data, error: readError, count } = await supabase
          .from("paige_actions")
          .select("id,title,summary,draft_content,decision_rationale,from_department,created_at", { count: "exact" })
          .eq("tenant_id", scope) // §9 — bind to the VIEWED workspace, not the operator's whole book
          .eq("status", "filed")
          .eq("autonomy_lane", "confirm")
          .order("created_at", { ascending: false })
          .limit(MAX_ITEMS);
        if (cancelled || !mounted.current) return;
        if (readError) {
          setItems([]);
          setTotal(null);
          setError(readError.message || "could not load what is waiting on you");
          setLoading(false);
          return;
        }
        setItems((data ?? []).map(toPendingAction).filter((a): a is SoloPendingAction => a !== null));
        setTotal(typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled || !mounted.current) return;
        setError(err instanceof Error ? err.message : "could not load what is waiting on you");
        setLoading(false);
      }
    })();

    return () => { cancelled = true; mounted.current = false; };
  }, [tick, scope]);

  return useMemo(() => settledScope === scope
    ? { items, total, loading, error, refresh }
    : { items: [], total: null, loading: true, error: null, refresh }, [items, total, loading, error, refresh, settledScope, scope]);
}
