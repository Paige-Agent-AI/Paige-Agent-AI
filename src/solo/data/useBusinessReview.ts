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
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** The structural subset the Overview renders — the composer owns the real shape. */
export interface ReviewMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  currency?: string;
  basis: string;
  window_note?: string;
}
export interface ReviewDomain {
  domain: string;
  as_of: string;
  coverage: "complete" | "partial" | "none";
  coverage_note?: string;
  headline: ReviewMetric[];
  risks: { kind: string; summary: string; severity: string; reference?: string }[];
  changes: { summary: string }[];
}
export interface BusinessReviewSnapshot {
  period: { label: string; start: string; end: string; timezone: string };
  composed_at: string;
  requested: string[];
  domains: Record<string, { status: string; reason?: string; data?: ReviewDomain | null }>;
  degradation: { domain: string; reason: string }[];
}
export type BusinessReviewState =
  | { state: "loading" }
  | { state: "ready"; snapshot: BusinessReviewSnapshot }
  | { state: "failed"; message: string };

export function useBusinessReview(accountEpoch: string | null | undefined): BusinessReviewState {
  const [status, setStatus] = useState<BusinessReviewState>({ state: "loading" });
  const epochRef = useRef<string | null | undefined>(accountEpoch);
  epochRef.current = accountEpoch;

  useEffect(() => {
    let alive = true;
    setStatus({ state: "loading" });
    (async () => {
      try {
        // The default review (empty body): the composer picks the period, observes the
        // workspace before and after, and reports every domain honestly.
        const { data, error } = await supabase.functions.invoke("paige-business-review", { body: {} });
        if (!alive) return;
        if (error || !data || typeof data !== "object") {
          setStatus({ state: "failed", message: "Your business review could not be read right now. Nothing was changed." });
          return;
        }
        const payload = data as { ok?: boolean; reason?: string; snapshot?: BusinessReviewSnapshot; error?: string };
        if (payload.ok === false) {
          setStatus({ state: "failed", message: "The review period could not be used (" + String(payload.reason ?? "unknown") + "). Nothing was read." });
          return;
        }
        if (!payload.ok || !payload.snapshot) {
          setStatus({ state: "failed", message: payload.error ?? "Your business review could not be read right now. Nothing was changed." });
          return;
        }
        setStatus({ state: "ready", snapshot: payload.snapshot });
      } catch {
        if (alive) setStatus({ state: "failed", message: "Your business review could not be read right now. Nothing was changed." });
      }
    })();
    return () => { alive = false; };
  }, [accountEpoch]);

  return status;
}
