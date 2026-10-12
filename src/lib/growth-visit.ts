// A visit to a business's own published page, live funnel or standalone form (INT-298 MBC 7a).
//
// The public renderers call recordGrowthVisit once the target has loaded (and a funnel again at each step); the
// server (growth-public-visit) decides whether it may be recorded and for which business. The browser keeps only
// the visit token the server hands back, in this tab's sessionStorage, so the same tab continues the same visit
// for 30 idle minutes; submitGrowthForm then hands the token back so the submission can be linked to the visit.
// Nothing here identifies the visitor. A browser that sends Do Not Track or Global Privacy Control is never
// recorded: it is not even asked, and the server refuses it too. Nor is anyone signed in to Paige, so a business
// looking at its own page does not count as its own visitor.
import { supabase } from "@/integrations/supabase/client";

export type GrowthVisitKind = "page" | "funnel" | "form";

const IDLE_MS = 30 * 60 * 1000;
const TOKEN_RE = /^pv_[0-9a-f]{64}$/;
let active: string | null = null;

/** The visit the visitor is on now, for growth-public-submit to link a submission to; null when none was recorded. */
export function activeVisitToken(): string | null {
  return active;
}

/** Make a recorded visit the one a submission links to. Called by the renderer that recorded it, only while it is
 *  still on screen, so a late answer for a page the visitor has left never claims the next page's submission. */
export function setActiveVisit(token: string | null): void {
  active = token && TOKEN_RE.test(token) ? token : null;
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

/** Someone signed in to Paige (the business's own people, checking their page) is not a visitor. */
async function signedIn(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data?.session);
  } catch {
    return false;
  }
}

// One request at a time per target: a funnel visitor who moves on before the first answer arrives waits for its
// token, so the whole funnel is one visit, never a second one starting at the later step.
const inFlight = new Map<string, Promise<string | null>>();

/** Record (or continue) a visit. Resolves to the visit token, or null when nothing was recorded. Never throws:
 *  a visit that could not be recorded must never break the page the visitor came to see. The caller decides
 *  whether it becomes the active visit (setActiveVisit), because only the caller knows it is still on screen. */
export function recordGrowthVisit(
  kind: GrowthVisitKind, targetId: string, opts: { step?: number; utm?: Record<string, string> } = {},
): Promise<string | null> {
  const key = storageKey(kind, targetId);
  const next = (inFlight.get(key) ?? Promise.resolve(null)).then(() => send(kind, targetId, key, opts));
  inFlight.set(key, next);
  void next.finally(() => { if (inFlight.get(key) === next) inFlight.delete(key); });
  return next;
}

async function send(
  kind: GrowthVisitKind, targetId: string, key: string, opts: { step?: number; utm?: Record<string, string> },
): Promise<string | null> {
  if (visitorOptedOut() || await signedIn()) return null;
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
      return null;
    }
    store(key, token);
    return token;
  } catch (e) {
    console.warn("[growth-visit] not recorded:", e);
    return null;
  }
}
