import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { INTERNAL_REVENUE_CLASS, netFleetCount } from "@/operator/data/useFleet";
import { fetchOperatorStanding, isOwnerTier } from "@/lib/auth/operatorStanding";

/**
 * The live signal the operator console's CHROME reads — the rail badges, the rail footer, the
 * header greeting and its status pill. REAL rows only.
 *
 * THE RULE THIS FILE IS BUILT AROUND (§13/§57). Claude Design's pack draws a badge on every
 * branch and a count in every group header because a design pack can invent its numbers. This
 * console cannot: it is the operator's source of truth about his OWN platform, and the anchor
 * case for getting it wrong is a Fleet surface that once printed $397 MRR on tenants with no
 * subscription at all. So a count we cannot substantiate is ABSENT — the key is simply not in
 * `badges`, and the chrome draws no badge. Never a `0` standing in for "we didn't read it",
 * never a plausible number. Every figure below traces to a row this hook actually read.
 *
 * COUNTS ARE `count: "exact", head: true`, NEVER `rows.length` (§13). A PostgREST `select()`
 * is capped by the project's `max-rows` setting, so counting by fetching the rows and taking
 * `.length` reports the CAP as the total the moment the fleet outgrows it — a wrong number that
 * looks completely plausible, which is the exact failure class above. An exact head-count is
 * correct at any size and transfers no rows.
 *
 * WHAT IS REAL HERE, AND WHAT IS DELIBERATELY MISSING:
 *   • `fleet` badge + `statusSummary` — REAL. `systems_check_snapshot('operator')` (the shipped
 *     RPC the Systems Check tile already reads, §18 one seam) returns the latest OPERATOR-scope
 *     scan run and its findings. Red/amber follows the mapping `SystemsCheckTile` uses, so the
 *     rail and the tile can never disagree: an open `fail` at `blocking` severity is red; every
 *     other open fail is amber, and so is an open `error` — a check that FAILED TO RUN is a real
 *     problem, not a benign neutral. A `skip` is "not yet assessable" and counts as neither.
 *   • `tenantCount` / `subAccountCount` — REAL, from `tenants`. A sub-account is a row with a
 *     non-null `parent_tenant_id` (§51). Both operator tiers genuinely read the whole table:
 *     SELECT on `tenants` is the OR of "Platform staff read all tenants" (`is_platform_admin()`)
 *     and "Members read own tenant" (`is_tenant_member(id) OR is_platform_owner()`), so
 *     super_admin and platform_admin each clear one of the two.
 *     THE FOOTER IS SCOPED THE SAME WAY THE FLEET CONSOLE IS (§57). The Fleet Console hides
 *     tenants the platform runs for itself (`revenue_class = 'internal_test'`) and the footer sits
 *     on the same page, so an unfiltered head-count here would print a LARGER fleet than the table
 *     three inches away — two surfaces disagreeing about how many tenants exist. Both now apply
 *     `netFleetCount` from `useFleet` (§18 one predicate): the internal rows are subtracted when
 *     the classification is readable, and NOTHING is filtered when it is not. See that function
 *     for why the unreadable case is unfiltered rather than blank.
 *   • `support` badge — REAL, from `support_tickets` (the platform support inbox: it has no
 *     tenant column, the operator IS the desk), and read ONLY when this session holds
 *     `super_admin`. See the §9/§53 note below — this gate is load-bearing, not a formality.
 *     Open = anything not `resolved`/`closed`, the same predicate `SupportAdmin` uses.
 *   • `roleLabel` — REAL, the operator tier from the one server answer (`operator_standing()`,
 *     through src/lib/auth/operatorStanding.ts). This file names no operator role.
 *   • `provisioning` badge — ABSENT ON PURPOSE. `tenant_provisioning` still exists, but its only
 *     writers (the new-tenant trigger, the queue drain, `run_starter_provisioning`) were all
 *     dropped by `20260915000000_remove_starter_auto_provisioner.sql` when the owner ruled that
 *     nothing auto-provisions. Whatever rows remain are a dead historical ledger, so counting
 *     them as "pending" would put a number on the rail that nothing is working on — exactly the
 *     phantom this file exists to prevent. There is no other provisioning-request queue in the
 *     schema. When one ships, it gets a badge here.
 *   • `incident` — ALWAYS null today. There is no incident table anywhere in the schema (the
 *     generated types and the migrations both have nothing). The field is part of the contract
 *     so the banner can light up the day a real incident record exists; until then the console
 *     says nothing rather than dressing a support ticket up as an outage.
 *
 * §9/§53 — "NO ROWS" IS UNKNOWN, NOT ZERO, AND "SOME ROWS" IS NOT AUTOMATICALLY THE ANSWER.
 * Two different hazards, and only the first is fixed by withholding zeros:
 *   1. A seam we cannot read at all returns 0 rows and looks identical to a genuinely empty one.
 *      So every count here is emitted only when it is POSITIVE — an unreadable seam and an empty
 *      one both render as no badge, the honest outcome for both, instead of a confident "0".
 *      `subAccountCount` is the one legitimate zero: it is a subset of a fleet we did read, so it
 *      only reports 0 when the fleet itself was readable.
 *   2. A seam we can PARTIALLY read returns a positive count of the WRONG rows, and withholding
 *      zeros does nothing about it. `support_tickets` is exactly this. It carries TWO permissive
 *      SELECT policies, which Postgres ORs together: "Staff view all tickets"
 *      (`is_platform_owner()`, which §53 freezes to super_admin) AND "Users view own tickets"
 *      (`auth.uid() = user_id`, which applies to EVERY authenticated session). A `platform_admin`
 *      therefore does not read zero — they read their OWN filed tickets, and publishing that as
 *      "the platform support inbox" is a worse lie than a zero would have been. So the support
 *      read is gated on the session actually holding `super_admin`; for a platform_admin the key
 *      is absent, which honestly says "this desk is not readable from here."
 * (The Systems Check RPC gates on `is_platform_operator()`, so a platform_admin genuinely does
 * see the operator lens there, and `tenants` is readable by both tiers — see above. Support is
 * the one seam where the tiers diverge.)
 */
export type OperatorChromeBadgeTone = "warn" | "risk" | "info";

export type OperatorChrome = {
  /** Operator's first name from RUNTIME auth metadata. null = unknown, undefined = resolving. */
  firstName: string | null | undefined;
  /** Operator's full name from RUNTIME auth metadata (same read as `firstName`). */
  fullName: string | null | undefined;
  /** Operator's sign-in email from the auth session. null = absent; undefined = resolving. */
  email: string | null | undefined;
  /** Per-branch rail badge, keyed by branch SLUG. Only include a key you can substantiate. */
  badges: Record<string, { count: number; tone: OperatorChromeBadgeTone }>;
  /** Fleet totals for the rail footer. null when unread. */
  tenantCount: number | null;
  subAccountCount: number | null;
  /** The operator's role word for the footer, e.g. "super_admin". null when unknown. */
  roleLabel: string | null;
  /** Short status summary for the header pill, e.g. "3 red · 6 amber". null when nothing to say. */
  statusSummary: string | null;
  /** The open incident for the banner, when one genuinely exists. */
  incident: { ref: string; summary: string; href?: string } | null;
  loading: boolean;
};

/** The finding fields this hook reads — the same shape `useSystemsCheck` maps (§18 one seam). */
type ScanFinding = {
  status: "pass" | "fail" | "skip" | "error";
  severity_at_finding: "blocking" | "high" | "medium" | "low" | null;
  resolved_at: string | null;
};

const EMPTY_BADGES: OperatorChrome["badges"] = {};

/** An exact head-count that never returns a number we didn't actually get from the server. */
function exactCount(res: { error: unknown; count: number | null }): number | null {
  return res.error ? null : res.count;
}

/**
 * @param enabled Hold every read until the console is actually behind the operator gate. Defaults
 * to true because the only mount is inside that gate; the flag exists so a caller that resolves
 * the gate asynchronously can wait rather than firing reads that would be denied.
 */
export function useOperatorChrome(enabled: boolean = true): OperatorChrome {
  const [firstName, setFirstName] = useState<string | null | undefined>(undefined);
  const [fullName, setFullName] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [badges, setBadges] = useState<OperatorChrome["badges"]>(EMPTY_BADGES);
  const [tenantCount, setTenantCount] = useState<number | null>(null);
  const [subAccountCount, setSubAccountCount] = useState<number | null>(null);
  const [roleLabel, setRoleLabel] = useState<string | null>(null);
  const [statusSummary, setStatusSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        // Identity first, and published the moment it lands: the greeting is the first thing the
        // operator reads, and it comes from RUNTIME auth metadata — never the repo, never a
        // literal (§45). `undefined` → still resolving; `null` → no name on record, and the
        // header falls back to its name-less opener rather than guessing one. `full_name` is
        // unvalidated user metadata, so anything that is not a string is treated as absent —
        // String()-ing an object would greet the operator as "[object".
        const { data: auth } = await supabase.auth.getUser();
        if (!alive) return;
        const uid = auth?.user?.id ?? null;
        const rawName = auth?.user?.user_metadata?.full_name;
        const full = typeof rawName === "string" ? rawName.trim() : "";
        setFirstName(full.split(/\s+/)[0] || null);
        setFullName(full || null);
        setEmail(typeof auth?.user?.email === "string" ? auth.user.email : null);

        const [tenantsRes, subsRes, classRes, internalRes, internalSubsRes, snapRes, standing] =
          await Promise.all([
            // Exact counts, no rows over the wire, immune to the project's max-rows cap.
            supabase.from("tenants").select("id", { count: "exact", head: true }),
            supabase
              .from("tenants")
              .select("id", { count: "exact", head: true })
              .not("parent_tenant_id", "is", null),
            // Is the operator-internal axis readable AT ALL by this session? One readable row proves
            // it; zero proves nothing either way, which is exactly why the count cannot be filtered
            // on a zero (§9/§53). This mirrors `useFleet`'s `classificationVisible` — same question,
            // asked as a head-count instead of `rows.length` so the cap can never answer it.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabase.from("tenant_revenue_classification" as any)
              .select("tenant_id", { count: "exact", head: true }),
            // How many of them the platform runs for itself, and how many of THOSE are sub-accounts —
            // the two figures the footer has to subtract so its "N tenants, M sub-accounts" stays
            // internally coherent as well as agreeing with the Fleet Console. The sub-account variant
            // needs the topology column, which lives on `tenants`, so it counts through an inner
            // embed on the FK (`tenant_revenue_classification.tenant_id → tenants.id`, the only FK
            // between the two tables, so the embed is unambiguous) — still a head-count, still no
            // rows over the wire. If that embed ever fails to resolve, `exactCount` is null and
            // `netFleetCount` returns null, so the footer simply drops its "M sub-accounts" clause
            // rather than printing an unfiltered one next to a filtered total (§13).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabase.from("tenant_revenue_classification" as any)
              .select("tenant_id", { count: "exact", head: true })
              .eq("revenue_class", INTERNAL_REVENUE_CLASS),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabase.from("tenant_revenue_classification" as any)
              .select("tenant_id, tenants!inner(id)", { count: "exact", head: true })
              .eq("revenue_class", INTERNAL_REVENUE_CLASS)
              .not("tenants.parent_tenant_id", "is", null),
            // The operator lens of the shipped Systems Check seam. Scope is the ONLY argument —
            // the RPC derives the caller in-body and gates operator scope on is_platform_operator()
            // (§59), so this passes no tenant id and can widen nothing. Not in the generated types
            // yet, hence the cast, matching `useSystemsCheck`'s convention.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (supabase as any).rpc("systems_check_snapshot", { p_scope: "operator" }),
            uid ? fetchOperatorStanding() : Promise.resolve(null),
          ]);

        if (!alive) return;

        // ── Fleet totals ──────────────────────────────────────────────────────────────────
        // Scoped through `netFleetCount`, the SAME predicate the Fleet Console filters its rows
        // with (§18/§57) — so the footer and the table on the same page can never quote two
        // different fleet sizes. A failed read and an empty read are both "we don't know" for the
        // total, so both leave the footer blank. Once we DO hold a total, the sub-account split is
        // a real subset of it and may honestly be 0.
        //
        // `classificationVisible` mirrors `useFleet` exactly: one readable classification row
        // proves the operator-internal axis is legible to this session; zero rows — whether the
        // read was denied, errored, or the table is genuinely empty — proves nothing, so we filter
        // nothing and report the whole table, which is the Fleet Console's own behaviour at that
        // tier. That keeps the two surfaces in agreement for super_admin AND platform_admin rather
        // than only for the tier this was built on (§51).
        const classificationVisible = (exactCount(classRes) ?? 0) > 0;
        const total = exactCount(tenantsRes);
        const subs = exactCount(subsRes);
        const netTotal =
          total === null
            ? null
            : netFleetCount(total, exactCount(internalRes), classificationVisible);
        const netSubs =
          subs === null
            ? null
            : netFleetCount(subs, exactCount(internalSubsRes), classificationVisible);
        const haveFleet = netTotal !== null && netTotal > 0;
        setTenantCount(haveFleet ? netTotal : null);
        setSubAccountCount(haveFleet && netSubs !== null ? netSubs : null);

        // ── Role word ─────────────────────────────────────────────────────────────────────
        // Operator tiers only (§53). A session holding neither is not an operator, and printing
        // its tenant-level role in the platform footer would misdescribe who is standing there.
        const ownerTier = isOwnerTier(standing);
        setRoleLabel(standing?.tier ?? null);

        // ── Systems Check → the fleet badge + the header pill ─────────────────────────────
        const snap = (snapRes?.error ? null : snapRes?.data) as
          | { run?: { id: string } | null; findings?: ScanFinding[] | null }
          | null;
        const findings = (snap?.findings ?? []) as ScanFinding[];
        const open = findings.filter((f) => !f.resolved_at);
        const openFails = open.filter((f) => f.status === "fail");
        const red = openFails.filter((f) => (f.severity_at_finding ?? "low") === "blocking").length;
        // An errored check failed to RUN. It is not a pass and not a deferral, so it rides with
        // the amber column rather than disappearing (§13 — the call the tile makes). Only the
        // resolution flow writes `resolved_at`, and it only ever writes it on an open fail, so
        // in practice this agrees with the tile's `errorCount` finding-for-finding; the guard is
        // here so an errored check that someone DOES resolve stops being counted as current.
        const amber = openFails.length - red + open.filter((f) => f.status === "error").length;

        const next: OperatorChrome["badges"] = {};
        if (red > 0) next.fleet = { count: red + amber, tone: "risk" };
        else if (amber > 0) next.fleet = { count: amber, tone: "warn" };

        const parts: string[] = [];
        if (red > 0) parts.push(`${red} red`);
        if (amber > 0) parts.push(`${amber} amber`);
        if (parts.length > 0) {
          setStatusSummary(parts.join(" · "));
        } else {
          // Nothing is failing. Only say "passing" when the scan literally verified something:
          // a run exists and every assessable check passed. A scan of nothing but skips has
          // verified nothing, so the pill stays silent rather than claiming a clean bill.
          const passCount = findings.filter((f) => f.status === "pass").length;
          const assessable = findings.length - findings.filter((f) => f.status === "skip").length;
          setStatusSummary(
            snap?.run && passCount > 0 && passCount === assessable
              ? `all ${passCount} checks passing`
              : null,
          );
        }

        // ── Platform support inbox ────────────────────────────────────────────────────────
        // super_admin ONLY. A platform_admin's read of this table returns their own filed
        // tickets via the "Users view own tickets" policy, not the desk — see the §9/§53 note
        // at the top. Absent beats a real count of the wrong rows.
        if (ownerTier) {
          const openFilter = "(resolved,closed)";
          const [openRes, urgentRes] = await Promise.all([
            supabase
              .from("support_tickets")
              .select("id", { count: "exact", head: true })
              .not("status", "in", openFilter),
            supabase
              .from("support_tickets")
              .select("id", { count: "exact", head: true })
              .not("status", "in", openFilter)
              .eq("priority", "urgent"),
          ]);
          if (!alive) return;
          const openTickets = exactCount(openRes);
          if (openTickets !== null && openTickets > 0) {
            const urgent = exactCount(urgentRes);
            next.support = {
              count: openTickets,
              tone: urgent !== null && urgent > 0 ? "warn" : "info",
            };
          }
        }

        setBadges(next);
      } catch {
        // A thrown read tells us nothing, so the chrome shows nothing — the badges/counts keep
        // their absent state rather than collapsing to zeros the operator would read as facts.
        // `firstName` is the exception that has to be actively settled: `undefined` means "still
        // resolving", and once we have stopped resolving that would leave the greeting spinning
        // forever, so an unresolved name becomes an honest `null`.
        if (alive) {
          setBadges(EMPTY_BADGES);
          setStatusSummary(null);
          setFirstName((prev) => (prev === undefined ? null : prev));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [enabled]);

  return {
    firstName,
    fullName,
    email,
    badges,
    tenantCount,
    subAccountCount,
    roleLabel,
    statusSummary,
    // No incident substrate exists yet (see the header note), so this is a documented constant
    // rather than a guess dressed as a read.
    incident: null,
    loading,
  };
}
