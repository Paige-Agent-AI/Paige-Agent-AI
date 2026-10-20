/**
 * useSoloActivityFeed — what Paige and the team ACTUALLY did, read from the Rail.
 *
 * WHY THIS EXISTS. Two Solo surfaces presented invented activity as live fact. The Trust
 * Compass rendered a panel headed "Working now — the last few minutes, as they happened",
 * carrying a green "Live" pill over eight lines that were typed into the file: named clients
 * who do not exist, a named recipient, timings down to "4s ago". The Team hub did the same
 * under "What the team did". Neither read anything. A placeholder is one thing; a placeholder
 * under a Live pill, naming customers, is an assertion — and the charter's boundary is exact:
 * do not invent activity, revenue, permissions, provider state, customer records, or
 * successful actions.
 *
 * §18 — ONE SEAM, NOT A NEW QUERY FAMILY. `paige_client_events` is the Rail: the row
 * `record_rail_event` writes, server-side and as the DEFINER owner, whenever something
 * actually happens. This reads it through the SAME deployed resolver `useRailEvents` now uses
 * for a tenant-scoped feed — `get_solo_rail_activity` — rather than standing up a second idea
 * of "what Paige did". If the two ever disagree, one of them is lying, and the way to prevent
 * that is for there to be only one.
 *
 * §9 TENANT ISOLATION. This passes NO tenant_id, and cannot: `get_solo_rail_activity(p_limit)`
 * takes no tenant argument at all. It is `SECURITY DEFINER` and re-enforces the caller's scope
 * in-body (§59) — it resolves the workspace from `current_user_tenant_id()`, requires an active
 * `tenant_members` row of THAT SAME workspace at owner/admin/coach, and otherwise raises
 * `42501 RAIL_FORBIDDEN`. So a sub-account sees ITS OWN activity and never the parent's
 * aggregate, and a role held in another workspace no longer satisfies the gate. The optional
 * `workspaceId` below is used ONLY to notice a switch and to discard a stale answer; it is
 * never sent, so it cannot be used to read another workspace's rail.
 *
 * §13 — WHAT IS LIVE AND WHAT IS DERIVED, field by field, because the file this replaces
 * made no such distinction:
 *   • title, summary        → LIVE   the recorded event, verbatim
 *   • occurred_at           → LIVE   (rendered as an elapsed label, which is derivation, not
 *                                     invention — the instant is real)
 *   • actor_type            → LIVE   paige_agent vs owner_staff. This is exactly what the
 *                                     Team hub's "Paige / People" filter means, so the filter
 *                                     stops being decorative.
 *   • department            → LIVE   from the event's own from/to_department, matched against
 *                                     the seeded §16 slugs. Unmatched resolves to null and the
 *                                     surface says so; it is never guessed from the title.
 *   • tier / "waiting on you" → NOT DERIVABLE HERE and therefore not produced. A Rail row is a
 *                                     record that something HAPPENED; it carries no approval
 *                                     state. Synthesising amber/red from it would re-introduce
 *                                     the exact fiction this hook removes, in a subtler form.
 *                                     Approval state lives in `paige_actions`; a feed that
 *                                     wants it needs that seam named, not a guess.
 *
 * AN EMPTY FEED, A REFUSAL AND AN OUTAGE ARE THREE DIFFERENT ANSWERS. They render identically
 * if you let them, and the second and third both told an operator, with confidence, that Paige
 * had done nothing. `status` names which one it is; `error` carries only the detail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** How many recent events a feed carries. Both surfaces render a short list. */
const MAX_ITEMS = 25;

/** Live-refresh cadence, matching `usePaigeDeptStatus` so the two never drift apart. */
const POLL_INTERVAL_MS = 15_000;

/** One recorded event, in the shape the Solo surfaces consume. */
export interface SoloActivityItem {
  id: string;
  /** The event as recorded — never rewritten for presentation. */
  title: string;
  summary: string | null;
  /** True when Paige performed it; false when a person did. LIVE from actor_type. */
  byPaige: boolean;
  /**
   * E4-S3 — true only when the record NAMES a person (`actor_type` 'owner_staff': an owner or staff
   * member's own act, e.g. saving the business time zone). Not the inverse of `byPaige`: an unknown
   * actor is neither, and stays unattributed rather than credited to anyone.
   */
  byPerson: boolean;
  /**
   * WHICH specialist acted, by its tenant-safe name, or null.
   *
   * `byPaige` above answers "was this Paige or a person"; this answers "which of her team". Null is
   * a real answer and does NOT mean PAIGE: no agent acted, the agent has no name a business owner
   * should read, or it belongs to another workspace. The server decides; render the absence rather
   * than substituting a generic label, which would restore the collapse this field exists to end.
   */
  actorAgent: string | null;
  /** The §16 department slug the event names, or null when it names none. */
  departmentSlug: string | null;
  occurredAt: string;
}

/**
 * The four answers a read can give, and they are FOUR, not two.
 *
 * `loading`     — not settled. Say nothing about what exists yet.
 * `ready`       — succeeded. An empty `items` here genuinely means nothing happened.
 * `forbidden`   — the DATABASE REFUSED (`RAIL_FORBIDDEN`, SQLSTATE 42501): this caller is not
 *                 entitled to this workspace's rail. Not an outage, and not "nothing happened".
 * `unavailable` — failed for some other reason. Also not "nothing happened".
 */
export type SoloActivityStatus = "loading" | "ready" | "forbidden" | "unavailable";

export interface SoloActivityFeed {
  items: SoloActivityItem[];
  /** DERIVED from `status`, so the two can never disagree. */
  loading: boolean;
  /** Which of the four answers the read gave. */
  status: SoloActivityStatus;
  /**
   * The failure detail, when there is one. `null` on `loading` and on `ready` — and `ready` may
   * still mean zero items, which is a DIFFERENT statement (§13). A message is never the state;
   * `status` is.
   */
  error: string | null;
  refresh: () => void;
}

/**
 * The §16 department slugs, seeded in `paige_departments` and verified live 2026-09-01.
 * Held here as a constant rather than joined per row: the Rail stores the slug as text, the
 * eleven names are a fixed platform fact rather than tenant data, and a join would add a
 * second query to render a label. `null` for an unknown slug is deliberate — a department we
 * cannot name is reported as unnamed, never bucketed into a plausible one.
 */
export const DEPARTMENT_NAMES: Readonly<Record<string, string>> = {
  owner_ops: "Owner Ops",
  client_experience: "Client Success",
  executive_office: "Executive Office",
  marketing: "Marketing",
  sales: "Sales",
  product_curriculum: "Product & Curriculum",
  technology_automation: "Technology & Automation",
  finance: "Finance",
  people_talent: "People & Talent",
  legal_compliance: "Legal & Compliance",
  operations_pmo: "Operations / PMO",
};

/** The department an event names, preferring where it was ROUTED TO over where it came from. */
export function departmentSlugOf(row: { to_department?: string | null; from_department?: string | null }): string | null {
  const to = typeof row.to_department === "string" ? row.to_department.trim() : "";
  if (to && to in DEPARTMENT_NAMES) return to;
  const from = typeof row.from_department === "string" ? row.from_department.trim() : "";
  if (from && from in DEPARTMENT_NAMES) return from;
  return null;
}

/**
 * A human label for a department slug, or a stated absence.
 *
 * "Unattributed" rather than a blank or a plausible default: a reader can act on "this event
 * does not say which desk did it" and cannot act on a department that was picked for them.
 */
export function departmentLabel(slug: string | null): string {
  return slug ? (DEPARTMENT_NAMES[slug] ?? "Unattributed") : "Unattributed";
}

/**
 * Elapsed time, in the compact form the surfaces already render ("4s", "22m", "3d").
 *
 * Derivation, not invention: the instant is a recorded column. Clamped at zero because a
 * clock skew of a few seconds should read "just now", not "in 3 seconds".
 */
export function elapsedLabel(occurredAt: string, now: number = Date.now()): string {
  const then = Date.parse(occurredAt);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Coerce one selected row. A malformed row is dropped rather than rendered half-blank. */
export function toActivityItem(raw: unknown): SoloActivityItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string") return null;
  return {
    id: r.id,
    title: r.title,
    summary: typeof r.summary === "string" && r.summary.trim() ? r.summary : null,
    // Anything that is not explicitly Paige is reported as a person. The safe direction:
    // over-crediting Paige for a person's work is the misattribution that matters here.
    byPaige: r.actor_type === "paige_agent",
    byPerson: r.actor_type === "owner_staff",
    // This coercion is a WHITELIST — it builds a new object rather than spreading — so a column the
    // resolver starts returning is dropped here until it is named. That is how the first version of
    // this change shipped attribution the RPC returned and no Solo surface could render.
    actorAgent: typeof r.actor_agent === "string" && r.actor_agent.trim() ? r.actor_agent : null,
    departmentSlug: departmentSlugOf(r as { to_department?: string | null; from_department?: string | null }),
    occurredAt: typeof r.occurred_at === "string" ? r.occurred_at : new Date().toISOString(),
  };
}

/**
 * Refusal or outage — decided from SQLSTATE, never from prose. Mirrors `classifyRailReadError`
 * in `useRailEvents`; the message is checked too so a transport that loses the code cannot
 * silently downgrade a refusal into "the server is having trouble".
 */
export function classifySoloActivityError(
  error: { code?: string | null; message?: string | null } | null | undefined,
): Exclude<SoloActivityStatus, "loading" | "ready"> {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  return code === "42501" || message.includes("RAIL_FORBIDDEN") ? "forbidden" : "unavailable";
}

/**
 * @param workspaceId The active workspace, when the caller knows it. Optional, and never sent to
 *   the server — it exists ONLY so a switch is noticed: it re-keys the read and invalidates
 *   anything in flight, so the previous workspace's activity cannot stay on screen, or land late,
 *   under the new one's heading. A caller that omits it still gets the request-ordering guard (a
 *   slow earlier poll can never overwrite a newer answer) but NOT the switch guard, because
 *   nothing tells this hook the workspace moved.
 */
export function useSoloActivityFeed(workspaceId?: string | null): SoloActivityFeed {
  const [items, setItems] = useState<SoloActivityItem[]>([]);
  const [status, setStatus] = useState<SoloActivityStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const mounted = useRef(false);
  // Monotonic request counter. Bumped on a workspace change (in render) and again per read; a
  // response is honoured only while it still matches.
  const requestSeq = useRef(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // ── THE RENDER-TIME WORKSPACE GUARD. Deliberately not an effect: an effect is passive, so
  // React commits the frame before it runs and the old workspace's activity is briefly painted
  // under the new one's heading. Clearing during render means that frame never exists.
  const scopeKey = workspaceId ?? "";
  const [renderedScope, setRenderedScope] = useState<string>(scopeKey);
  if (renderedScope !== scopeKey) {
    requestSeq.current += 1; // anything in flight for the old workspace is now stale
    setRenderedScope(scopeKey);
    setItems([]);
    setStatus("loading");
    setError(null);
  }

  useEffect(() => {
    mounted.current = true;

    const read = async () => {
      const seq = ++requestSeq.current;
      try {
        const { data, error: readError } = await supabase.rpc(
          // `get_solo_rail_activity` post-dates the last `types.ts` regeneration, so its name is
          // not yet in the generated RPC union. Cast at the call site, as the codebase already
          // does elsewhere, rather than regenerate a shared 20k-line artifact inside this slice.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "get_solo_rail_activity" as any,
          { p_limit: MAX_ITEMS },
        );
        if (!mounted.current || requestSeq.current !== seq) return;
        if (readError) {
          // Never turn a refused or failed read into "nothing happened" (§13).
          setStatus(classifySoloActivityError(readError));
          setError(readError.message || "could not load recent activity");
          return;
        }
        const rows = Array.isArray(data) ? (data as unknown[]) : [];
        setItems(rows.map(toActivityItem).filter((i): i is SoloActivityItem => i !== null));
        setStatus("ready");
        setError(null);
      } catch (err) {
        if (!mounted.current || requestSeq.current !== seq) return;
        setStatus("unavailable");
        setError(err instanceof Error ? err.message : "could not load recent activity");
      }
    };

    void read();
    // Poll rather than subscribe: `paige_client_events` broadcasts to the private rail topics
    // (see useRailEvents) but is not in the `supabase_realtime` publication, so postgres_changes
    // would deliver nothing. Skip while the tab is hidden; the focus handler catches up.
    const id = setInterval(() => { if (!document.hidden) void read(); }, POLL_INTERVAL_MS);
    const onFocus = () => { void read(); };
    window.addEventListener("focus", onFocus);

    return () => {
      mounted.current = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [tick, workspaceId]);

  return useMemo(
    () => ({ items, loading: status === "loading", status, error, refresh }),
    [items, status, error, refresh],
  );
}
