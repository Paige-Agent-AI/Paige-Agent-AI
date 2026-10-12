// A visit to a business's own published page, live funnel or standalone form (INT-298 MBC 7a).
//
// The public renderers call recordGrowthVisit once the target has loaded (and a funnel again at each step); the
// server (growth-public-visit) decides whether it may be recorded and for which business. The browser keeps only
// the visit token the server hands back, in this tab's sessionStorage, so the same tab continues the same visit
// for 30 idle minutes; submitGrowthForm then hands the token back so the submission can be linked to the visit.
// Nothing here identifies the visitor. A browser that sends Do Not Track or Global Privacy Control is never
// recorded: it is not even asked, and the server refuses it too.
import { supabase } from "@/integrations/supabase/client";

export type GrowthVisitKind = "page" | "funnel" | "form";

const IDLE_MS = 30 * 60 * 1000;
const TOKEN_RE = /^pv_[0-9a-f]{64}$/;
let active: string | null = null;

/** The visit the visitor is on now, for growth-public-submit to link a submission to; null when none was recorded. */
export function activeVisitToken(): string | null {
  return active;
}

/** Forget the active visit (the renderer that recorded it is gone). Only clears the token it was given. */
export function clearActiveVisit(token: string | null): void {
  if (token && active === token) active = null;
}

/** True when the browser asked not to be tracked. */
export function visitorOptedOut(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav) return true;
  const gpc = (nav as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  const dnt = nav.doNotTrack === "1" || (window as Window & { doNotTrack?: string }).doNotTrack === "1";
  return gpc || dnt;
}

const storageKey = (kind: GrowthVisitKind, targetId: string) => `paige.visit.${kind}.${targetId}`;

function readStored(key: string): string | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: unknown; at?: unknown };
    if (typeof parsed.token !== "string" || !TOKEN_RE.test(parsed.token) || typeof parsed.at !== "number") return null;
    return Date.now() - parsed.at < IDLE_MS ? parsed.token : null;
  } catch {
    return null;
  }
}

function store(key: string, token: string | null): void {
  try {
    if (token) sessionStorage.setItem(key, JSON.stringify({ token, at: Date.now() }));
    else sessionStorage.removeItem(key);
  } catch { /* storage unavailable: the visit still counts, this tab just starts a new one next time */ }
}

/** Record (or continue) a visit. Resolves to the visit token, or null when nothing was recorded. Never throws:
 *  a visit that could not be recorded must never break the page the visitor came to see. */
export async function recordGrowthVisit(
  kind: GrowthVisitKind, targetId: string, opts: { step?: number; utm?: Record<string, string> } = {},
): Promise<string | null> {
  if (visitorOptedOut()) { active = null; return null; }
  const key = storageKey(kind, targetId);
  try {
    const { data, error } = await supabase.functions.invoke("growth-public-visit", {
      body: {
        kind,
        target_id: targetId,
        token: readStored(key),
        step: kind === "funnel" ? opts.step ?? 0 : 0,
        utm: opts.utm ?? {},
        referrer: typeof document === "undefined" ? null : document.referrer || null,
      },
    });
    const token = (data as { recorded?: unknown; token?: unknown } | null)?.recorded === true ? (data as { token?: unknown }).token : null;
    if (error || typeof token !== "string" || !TOKEN_RE.test(token)) {
      store(key, null);
      active = null;
      return null;
    }
    store(key, token);
    active = token;
    return token;
  } catch (e) {
    console.warn("[growth-visit] not recorded:", e);
    active = null;
    return null;
  }
}
