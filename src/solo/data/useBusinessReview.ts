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
import { validateDomainSnapshot, type BusinessOperatingSnapshot, type DomainSnapshot, type SnapshotMetric, type SnapshotPeriodKey, type SnapshotDomain } from "../../../supabase/functions/_shared/paige-context/snapshot";

/** Import the actual Fabric contract; never maintain a second snapshot vocabulary. */
export type ReviewMetric = SnapshotMetric;
export type ReviewDomain = DomainSnapshot;
export type BusinessReviewSnapshot = BusinessOperatingSnapshot;
export type BusinessReviewState =
  | { state: "loading" }
  | { state: "ready"; snapshot: BusinessReviewSnapshot }
  | { state: "failed"; message: string };

/** Reject an out-of-scope/malformed transport response before it can paint company evidence. */
export function parseBusinessReview(data: unknown, tenant: string, timezone: string): BusinessReviewSnapshot | null {
  const value = data as { ok?: boolean; snapshot?: BusinessReviewSnapshot } | null;
  const s = value?.snapshot;
  if (!value?.ok || !s || s.tenant_id !== tenant || s.version !== 1 || !s.period || s.period.timezone !== timezone
    || !Array.isArray(s.requested) || !s.domains || !Array.isArray(s.degradation)
    || !Number.isFinite(Date.parse(s.composed_at)) || !Number.isFinite(Date.parse(s.period.start))
    || !Number.isFinite(Date.parse(s.period.end)) || typeof s.period.label !== "string") return null;
  const domains = { ...s.domains };
  for (const domain of s.requested) {
    const entry = domains[domain];
    if (!entry || !["available", "degraded", "unavailable"].includes(entry.status)) return null;
    if (entry.status === "available") {
      const checked = validateDomainSnapshot(entry.data, { domain: domain as SnapshotDomain, period: s.period });
      if ("reason" in checked) return null;
      domains[domain] = { status: "available", data: checked.snapshot };
    }
  }
  return { ...s, domains };
}

export function useBusinessReview(accountEpoch: string | null | undefined, period: SnapshotPeriodKey = "last_7_days") {
  const [tick, setTick] = useState(0);
  const key = `${accountEpoch ?? ""}:${period}:${tick}`;
  const [settled, setSettled] = useState<{ key: string; value: BusinessReviewState }>({ key, value: { state: "loading" } });
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const update = (value: BusinessReviewState) => { if (alive) setSettled({ key, value }); };
    if (!accountEpoch) return;
    (async () => {
      try {
        // Same reporting clock as PaigeAIChat. This does not substitute for E4's saved
        // BUSINESS calendar: mission due-date judgements keep that separate fail-closed read.
        const timezone = getUserClock().userTimezone;
        const { data, error } = await supabase.functions.invoke("paige-business-review", { body: { period, timezone }, signal: controller.signal });
        if (!alive) return;
        if (error || !data || typeof data !== "object") {
          update({ state: "failed", message: "Your business review could not be read right now. Nothing was changed." });
          return;
        }
        const payload = data as { ok?: boolean; reason?: string; snapshot?: BusinessReviewSnapshot; error?: string };
        if (payload.ok === false) {
          update({ state: "failed", message: "This review period could not be read. Check the reporting time zone and try again." });
          return;
        }
        const snapshot = parseBusinessReview(data, accountEpoch, timezone);
        if (!snapshot) {
          update({ state: "failed", message: "The review could not be verified for this workspace. Refresh to read it again." });
          return;
        }
        update({ state: "ready", snapshot });
      } catch {
        update({ state: "failed", message: "Your business review could not be read right now. Nothing was changed." });
      }
    })();
    return () => { alive = false; controller.abort(); };
  }, [accountEpoch, period, key]);

  // An epoch/period/refresh change hides the prior result in render, before passive effects run.
  return { ...(settled.key === key ? settled.value : { state: "loading" as const }), refresh };
}
