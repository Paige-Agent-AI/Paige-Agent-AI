/**
 * useBusinessReview — the Executive Overview's read of the one business review.
 *
 * E2-6 (2026-10-13): the UI never composes figures itself and never reads a department table
 * directly. This hook calls the thin seam (`paige-business-review`), which runs the fabric
 * composer on the signed-in person's OWN session — the same composer, the same issuer, the
 * same authority the chat tool `get_business_snapshot` uses. What renders here IS what PAIGE
 * narrates; there is no second source of truth.
 *
 * Re-read discipline: every mount (and every workspace switch, via the epoch key the caller
 * passes) composes FRESH — nothing is cached, because a business review is a statement about
 * now. A failed invoke is an honest error state, never a stale render.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getUserClock } from "@/lib/userClock";
import { isSnapshotDomain, validateDomainSnapshot, type BusinessOperatingSnapshot, type DomainSnapshot, type SnapshotMetric, type SnapshotPeriodKey, type SnapshotDomain } from "../../../supabase/functions/_shared/paige-context/snapshot";

/** Import the actual Fabric contract; never maintain a second snapshot vocabulary. */
export type ReviewMetric = SnapshotMetric;
export type ReviewDomain = DomainSnapshot;
export type BusinessReviewSnapshot = BusinessOperatingSnapshot;
export type BusinessReviewState =
  | { state: "loading" }
  | { state: "ready"; snapshot: BusinessReviewSnapshot }
  | { state: "failed"; message: string };

/** Optional consumer assertions, never additional server authority. */
export type BusinessReviewFocus = { focus: readonly SnapshotDomain[]; actorId: string };
type ExpectedReview = BusinessReviewFocus & { period: SnapshotPeriodKey };
const validFocus = (focus: readonly string[]) => focus.length > 0 && focus.length <= 6
  && new Set(focus).size === focus.length && focus.every(isSnapshotDomain);

/** Reject an out-of-scope/malformed transport response before it can paint company evidence. */
export function parseBusinessReview(data: unknown, tenant: string, timezone: string, expected?: ExpectedReview): BusinessReviewSnapshot | null {
  const value = data as { ok?: boolean; snapshot?: BusinessReviewSnapshot } | null;
  const s = value?.snapshot;
  if (!value?.ok || !s || s.tenant_id !== tenant || s.version !== 1 || !s.period || s.period.timezone !== timezone
    || !Array.isArray(s.requested) || !s.domains || !Array.isArray(s.degradation)
    || !Number.isFinite(Date.parse(s.composed_at)) || !Number.isFinite(Date.parse(s.period.start))
    || !Number.isFinite(Date.parse(s.period.end)) || typeof s.period.label !== "string") return null;
  if (expected && (value.ok !== true || !expected.actorId || s.actor_id !== expected.actorId
    || s.period.key !== expected.period || !validFocus(expected.focus)
    || s.requested.length !== expected.focus.length || new Set(s.requested).size !== s.requested.length
    || s.requested.some(domain => !expected.focus.includes(domain))
    || typeof s.domains !== 'object' || Array.isArray(s.domains)
    || Object.keys(s.domains).length !== expected.focus.length
    || Object.keys(s.domains).some(domain => !expected.focus.includes(domain as SnapshotDomain)))) return null;
  const domains = { ...s.domains };
  for (const domain of s.requested) {
    const entry = domains[domain];
    if (!entry || !["available", "degraded", "unavailable"].includes(entry.status)) return null;
    if (expected && entry.status !== 'available'
      && (entry.data !== null || typeof entry.reason !== 'string' || !entry.reason.trim())) return null;
    if (entry.status === "available") {
      const checked = validateDomainSnapshot(entry.data, { domain: domain as SnapshotDomain, period: s.period, tenantId: tenant });
      if ("reason" in checked) return null;
      domains[domain] = { status: "available", data: checked.snapshot };
    }
  }
  return { ...s, domains };
}

export function useBusinessReview(accountEpoch: string | null | undefined, period: SnapshotPeriodKey = "last_7_days", focused?: BusinessReviewFocus) {
  const [tick, setTick] = useState(0);
  const focusKey = focused?.focus.join(','), focusedActor = focused?.actorId;
  const key = `${accountEpoch ?? ""}:${period}:${focusKey === undefined ? 'default' : `focus=${focusKey}:${focusedActor ?? ''}`}:${tick}`;
  const [settled, setSettled] = useState<{ key: string; value: BusinessReviewState }>({ key, value: { state: "loading" } });
  // Retire this component's prior selection before children paint. A reusable
  // tuple alone can resurrect old A evidence during an A→B→A transition.
  if (settled.key !== key) setSettled({ key, value: { state: 'loading' } });
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const update = (value: BusinessReviewState) => { if (alive) setSettled({ key, value }); };
    if (!accountEpoch) return;
    const focus = focusKey === undefined ? undefined : focusKey.split(',') as SnapshotDomain[];
    if (focus && (!validFocus(focus) || !focusedActor)) {
      update({ state: 'failed', message: 'The review could not be verified for this workspace. Refresh to read it again.' });
      return;
    }
    // The producer bounds composition, but the browser also needs a finite transport
    // outcome. Default Executive requests keep their incumbent behavior unchanged.
    const deadline = focus ? setTimeout(() => {
      update({ state: 'failed', message: 'Your business review could not be read right now. Nothing was changed.' });
      controller.abort();
    }, 15_000) : undefined;
    (async () => {
      try {
        // Same reporting clock as PaigeAIChat. This does not substitute for E4's saved
        // BUSINESS calendar: mission due-date judgements keep that separate fail-closed read.
        const timezone = getUserClock().userTimezone;
        const { data, error } = await supabase.functions.invoke("paige-business-review?finance_sources=1", {
          body: { period, timezone, ...(focus ? { focus } : {}) }, signal: controller.signal,
        });
        if (!alive || controller.signal.aborted) return;
        if (error || !data || typeof data !== "object") {
          update({ state: "failed", message: "Your business review could not be read right now. Nothing was changed." });
          return;
        }
        const payload = data as { ok?: boolean; reason?: string; snapshot?: BusinessReviewSnapshot; error?: string };
        if (payload.ok === false) {
          update({ state: "failed", message: "This review period could not be read. Check the reporting time zone and try again." });
          return;
        }
        const snapshot = parseBusinessReview(data, accountEpoch, timezone,
          focus ? { focus, actorId: focusedActor!, period } : undefined);
        if (!snapshot) {
          update({ state: "failed", message: "The review could not be verified for this workspace. Refresh to read it again." });
          return;
        }
        update({ state: "ready", snapshot });
      } catch {
        if (!controller.signal.aborted) update({ state: "failed", message: "Your business review could not be read right now. Nothing was changed." });
      } finally { clearTimeout(deadline); }
    })();
    return () => { alive = false; clearTimeout(deadline); controller.abort(); };
  }, [accountEpoch, period, key, focusKey, focusedActor]);

  // An epoch/period/refresh change hides the prior result in render, before passive effects run.
  return { ...(settled.key === key ? settled.value : { state: "loading" as const }), refresh };
}
