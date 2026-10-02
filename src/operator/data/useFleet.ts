import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The fleet read for the operator console — REAL tenants, no fixtures.
 *
 * Same tables the shipped operator tenant list already reads, so this is one more caller of a
 * proven query rather than a new data path (§18). The owner's standing rule is that a figure the
 * platform cannot substantiate must render as "—", never as a plausible number: the §57 anchor
 * case was a Fleet surface showing $397/$149 MRR on tenants that have no paid subscription at
 * all. So `mrr` here is DELIBERATELY absent — `revenue_class` is what the platform actually
 * knows, and the surface prints that instead of inventing a dollar figure (§13).
 */
export type FleetTenant = {
  id: string;
  slug: string | null;
  name: string;
  status: string | null;
  /** agency | enterprise | sub_account | standalone — the §51 tier, read from the record. */
  accountType: string | null;
  /** Non-null on a sub-account: the agency it belongs to (§51 invariant). */
  parentTenantId: string | null;
  planOffer: string | null;
  /** paid | promotional | internal_test — operator-internal axis, owner-only via RLS. */
  revenueClass: string | null;
  seats: number;
  customers: number;
  trialEndsAt: string | null;
};

/**
 * The ONE revenue class that means "the platform runs this tenant for itself" (§18 one home).
 * Every surface that scopes the fleet — the Fleet Console's row filter, the rail footer's exact
 * head-counts — reads this constant, so the word can never drift between two spellings.
 */
export const INTERNAL_REVENUE_CLASS = "internal_test";

/**
 * A tenant the platform runs for ITSELF — a fixture, a test account, a retired shell — rather
 * than a customer. It is a real row and the operator can still ask to see it, but counting it
 * as fleet would overstate the platform's own size on the operator's own console, which is the
 * §57 divergence (a surface asserting something the God-level record contradicts) in miniature.
 */
export function isInternal(t: FleetTenant): boolean {
  return t.revenueClass === INTERNAL_REVENUE_CLASS;
}

/**
 * THE FLEET-SCOPE RULE, in one place (§18/§57), so "how many tenants are there" means exactly the
 * same thing on the Fleet Console and on the rail footer of the same page.
 *
 * The Fleet Console applies it to ROWS (`tenants.filter(t => !isInternal(t))`, and only when
 * `classificationVisible`); the operator chrome applies it to exact head-COUNTS, because a
 * `rows.length` over a `select()` reports the project's max-rows cap as the total the moment the
 * fleet outgrows it (§13). Two different mechanics, one predicate — hence this shared function
 * rather than the same condition written twice.
 *
 * §9/§53 — WHEN THE CLASSIFICATION IS UNREADABLE, NOTHING IS FILTERED. `tenant_revenue_classification`
 * is `is_platform_owner()`-only, so a scoped `platform_admin` reads ZERO rows, which is
 * indistinguishable from "no tenant is internal". Filtering on an answer we never got would drop or
 * keep the wrong rows, so the honest move is the UNFILTERED total — the same call `FleetConsole`
 * makes, where the header additionally says out loud that fixtures are counted in. Both surfaces
 * therefore agree at BOTH operator tiers.
 *
 * @returns null when we know we OUGHT to subtract but could not count what to subtract — an absent
 * figure, never an over-reported one.
 */
export function netFleetCount(
  total: number,
  internal: number | null,
  classificationVisible: boolean,
): number | null {
  if (!classificationVisible) return total;
  if (internal === null) return null;
  // Clamped: the total and the internal count are two round-trips, so a tenant deleted between
  // them must never render as a negative fleet.
  return Math.max(0, total - internal);
}

export type FleetData = {
  tenants: FleetTenant[];
  /**
   * Whether the operator-internal classification is READABLE by this session at all.
   *
   * `tenant_revenue_classification` is owner-only by RLS, so a scoped `platform_admin` reads
   * ZERO rows — and zero rows is indistinguishable from "no tenant is internal". Without this
   * flag the console would quietly show every fixture as fleet, with no chip to reveal them and
   * no hint that anything was missing: a wrong count that looks right (§13/§57). The surface
   * uses it to say what it cannot see instead of filtering on an answer it never got.
   */
  classificationVisible: boolean;
  /**
   * True when the seat or client read FAILED (a timeout, a 5xx) or came back TRUNCATED at the row
   * cap (`rowReadComplete`). The rows then carry
   * `seats: 0` / `customers: 0` that were never read, so the surface must treat the counts as
   * unknown — never as zeros to display or grade (§13). See `fleetDetailVisible`.
   */
  detailReadFailed: boolean;
  loading: boolean;
  /** True when the read failed — the surface says so rather than rendering an empty fleet. */
  error: string | null;
};

/**
 * Whether this session's per-tenant SEAT and CLIENT counts are real — `true`, `false`, or `null`
 * when that cannot be established.
 *
 * Full-fleet reads of `tenant_members` and `clients` are granted to the platform owner
 * (`is_platform_owner()`, i.e. super_admin) and otherwise only within tenants the caller belongs to
 * or administers. A tenant-less `platform_admin` therefore receives no rows, and every tenant
 * arrives with `seats: 0` — a zero that was never read. So a count is shown and graded only when
 * the server has said this session is the owner AND both reads succeeded. A platform_admin who
 * administers some tenant could read that one tenant's rows; the directory still treats its counts
 * as not visible, which can only understate, never overstate. If who may read these rows changes,
 * this rule changes with it.
 *
 * `isPlatformOwner` is the server's answer from `useOperatorStanding` (null = not answered yet).
 */
export function fleetDetailVisible(isPlatformOwner: boolean | null, readFailed: boolean): boolean | null {
  if (readFailed || isPlatformOwner === null) return null;
  return isPlatformOwner;
}

/**
 * Whether a row read returned EVERY row the server matched. PostgREST caps an unpaginated read at
 * the project's max-rows and returns the first page without saying so, so per-tenant counts built
 * from that page would undercount — and could print "no clients" for a tenant whose rows were cut —
 * the moment the fleet outgrows the cap. The read therefore asks the server for the exact match
 * count, and a count the page does not cover, or a count the server did not give, is treated as a
 * failed read: the surface then says the counts could not be confirmed (§13). A server-side grouped
 * count would remove the cap altogether; that is a backend change, filed rather than made here.
 */
export function rowReadComplete(rowsReturned: number, matched: number | null): boolean {
  return matched !== null && matched <= rowsReturned;
}

export function useFleet(enabled: boolean): FleetData {
  const [tenants, setTenants] = useState<FleetTenant[]>([]);
  const [classificationVisible, setClassificationVisible] = useState(false);
  const [detailReadFailed, setDetailReadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [
          { data: rows, error: tErr },
          { data: members, error: membersErr, count: membersMatched },
          { data: clients, error: clientsErr, count: clientsMatched },
          { data: revenue },
        ] =
          await Promise.all([
            supabase
              .from("tenants")
              .select("id, slug, name, status, account_type, parent_tenant_id, plan_offer, trial_ends_at")
              .order("created_at", { ascending: true }),
            supabase.from("tenant_members").select("tenant_id", { count: "exact" }).eq("status", "active"),
            supabase.from("clients").select("tenant_id", { count: "exact" }),
            // Operator-internal revenue axis. RLS is owner-only, so a scoped platform_admin
            // reads 0 rows and every tenant simply shows no class — a narrower view, never a
            // leak and never a wrong number (§9).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabase.from("tenant_revenue_classification" as any).select("tenant_id, revenue_class"),
          ]);

        if (!alive) return;
        if (tErr) {
          setError(tErr.message);
          setTenants([]);
          setLoading(false);
          return;
        }

        const seatBy = new Map<string, number>();
        (members ?? []).forEach((m) =>
          seatBy.set(m.tenant_id, (seatBy.get(m.tenant_id) ?? 0) + 1),
        );
        const custBy = new Map<string, number>();
        (clients ?? []).forEach((c) => {
          if (!c.tenant_id) return;
          custBy.set(c.tenant_id, (custBy.get(c.tenant_id) ?? 0) + 1);
        });
        // Any row at all proves the read is permitted for this session. None proves nothing
        // either way, so we report it as not-visible rather than as an empty classification.
        setClassificationVisible((revenue ?? []).length > 0);
        setDetailReadFailed(
          Boolean(membersErr || clientsErr) ||
            !rowReadComplete((members ?? []).length, membersMatched ?? null) ||
            !rowReadComplete((clients ?? []).length, clientsMatched ?? null),
        );
        const classBy = new Map<string, string>(
          ((revenue ?? []) as unknown as Array<{ tenant_id: string; revenue_class: string }>).map(
            (r) => [r.tenant_id, r.revenue_class],
          ),
        );

        setTenants(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((rows ?? []) as any[]).map((t) => ({
            id: t.id,
            slug: t.slug ?? null,
            name: t.name,
            status: t.status ?? null,
            accountType: t.account_type ?? null,
            parentTenantId: t.parent_tenant_id ?? null,
            planOffer: t.plan_offer ?? null,
            revenueClass: classBy.get(t.id) ?? null,
            seats: seatBy.get(t.id) ?? 0,
            customers: custBy.get(t.id) ?? 0,
            trialEndsAt: t.trial_ends_at ?? null,
          })),
        );
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load the fleet.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [enabled]);

  return { tenants, classificationVisible, detailReadFailed, loading, error };
}
