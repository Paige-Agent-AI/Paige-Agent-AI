import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * The Sales Agreements a business sent the signed-in customer (E09 Slice A).
 *
 * Reads go through client_portal_agreements(), which resolves the customer relationship from the
 * auth subject server-side (§9) and returns only agreements whose contact IS that relationship:
 * never the body, a storage key, a hash, token data, a signer's name or email, an amount, or the
 * agreement's event history. Customers cannot read paige_agreements, so there is no realtime: the
 * list re-reads when the window regains focus or the tab becomes visible again, which is also what
 * refreshes it after the customer comes back from the signing page.
 *
 * Signing never happens here. "Review and sign" asks client_portal_open_agreement_signing for a
 * link to the existing, frozen /sign/:token page (§28) and the page itself does the signing. That
 * link REPLACES the one the business emailed (owner decision D-A4): the emailed link stops working.
 *
 * The signed copy is streamed by the agreement-document function's portal door with the session the
 * customer already holds; no storage address ever reaches the browser.
 *
 * Every row is checked against the exact key allowlist the server promises. A row carrying any other
 * key is refused, so a widened projection fails closed instead of being shown.
 */

export type PortalAgreementState =
  | "awaiting_you" | "awaiting_business" | "awaiting_others" | "signed" | "declined" | "withdrawn" | "expired" | "unavailable";
/** Why an agreement that waits for this customer is not signable from the portal: the emailed link is the way. */
export type PortalAgreementSignNote = "use_email_link";

export interface PortalAgreement {
  id: string;
  title: string;
  /** The name of the Sales agreement this document belongs to, when it is the customer's own (D-A8). */
  engagement_title: string | null;
  state: PortalAgreementState;
  sent_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  /** Only ever true while the state is awaiting_you. */
  can_sign: boolean;
  /** Only ever true for a signed agreement whose sealed copy exists. */
  can_download: boolean;
  sign_note: PortalAgreementSignNote | null;
}

export interface PortalAgreementsSummary {
  awaiting_you: number;
  signed: number;
}

export interface PortalAgreementsPage {
  tenant_id: string;
  business_name: string | null;
  server_now: string;
  summary: PortalAgreementsSummary;
  agreements: PortalAgreement[];
  has_more: boolean;
}

export const PORTAL_AGREEMENTS_LIMIT = 50;

const PAGE_KEYS = ["tenant_id", "business_name", "server_now", "summary", "agreements", "has_more"];
const SUMMARY_KEYS = ["awaiting_you", "signed"];
const ROW_KEYS = ["id", "title", "engagement_title", "state", "sent_at", "completed_at", "expires_at", "can_sign", "can_download", "sign_note"];
const STATES = new Set<PortalAgreementState>([
  "awaiting_you", "awaiting_business", "awaiting_others", "signed", "declined", "withdrawn", "expired", "unavailable",
]);
const TOKEN = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcResult = { data: unknown; error: unknown };
type PortalAgreementRpc = "client_portal_agreements" | "client_portal_open_agreement_signing";
/** The E09 RPCs are newer than the generated Database types; keep the call shape typed locally. */
function portalRpc(name: PortalAgreementRpc, args: Record<string, unknown>) {
  return supabase.rpc(name as never, args as never) as unknown as PromiseLike<RpcResult>;
}

/**
 * The relationship resolver raises 42501 when the account is linked to more than one business.
 * 42501 is also "not signed in"; that case is handled by the auth scope, so only the relationship
 * refusal is classified here.
 */
export function isMultipleRelationships(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code !== "42501") return false;
  return !(typeof e.message === "string" && /authentication required/i.test(e.message));
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Exactly these keys: nothing missing, nothing extra. */
const exactKeys = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
const isDate = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const isDateOrNull = (v: unknown): v is string | null => v === null || isDate(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function parseRow(raw: unknown): PortalAgreement {
  if (!isObject(raw) || !exactKeys(raw, ROW_KEYS)) throw new Error("Unexpected agreement");
  const { id, title, engagement_title, state, sent_at, completed_at, expires_at, can_sign, can_download, sign_note } = raw;
  if (typeof id !== "string" || !UUID.test(id) || typeof title !== "string"
    || (engagement_title !== null && typeof engagement_title !== "string")
    || typeof state !== "string" || !STATES.has(state as PortalAgreementState)
    || !isDateOrNull(sent_at) || !isDateOrNull(completed_at) || !isDateOrNull(expires_at)
    || typeof can_sign !== "boolean" || typeof can_download !== "boolean"
    || (sign_note !== null && sign_note !== "use_email_link")) {
    throw new Error("Unexpected agreement");
  }
  // The server only offers what it will honour: a button the writer would refuse is never drawn.
  if ((can_sign && (state !== "awaiting_you" || sign_note !== null)) || (can_download && state !== "signed")) {
    throw new Error("Unexpected agreement");
  }
  return {
    id, title: title.trim() || "Untitled agreement",
    engagement_title: typeof engagement_title === "string" && engagement_title.trim() ? engagement_title.trim() : null,
    state: state as PortalAgreementState, sent_at, completed_at, expires_at, can_sign, can_download,
    sign_note: sign_note as PortalAgreementSignNote | null,
  };
}

/** Null = no customer relationship. Throws on any payload outside the promised shape. */
export function parseAgreementsPage(data: unknown): PortalAgreementsPage | null {
  if (data === null || data === undefined) return null;
  if (!isObject(data) || !exactKeys(data, PAGE_KEYS)) throw new Error("Unexpected agreements response");
  const { tenant_id, business_name, server_now, summary, agreements, has_more } = data;
  if (typeof tenant_id !== "string" || !UUID.test(tenant_id) || (business_name !== null && typeof business_name !== "string")
    || !isDate(server_now) || typeof has_more !== "boolean"
    || !Array.isArray(agreements) || agreements.length > PORTAL_AGREEMENTS_LIMIT
    || !isObject(summary) || !exactKeys(summary, SUMMARY_KEYS) || !SUMMARY_KEYS.every((k) => isCount(summary[k]))) {
    throw new Error("Unexpected agreements response");
  }
  const parsed = agreements.map(parseRow);
  if (new Set(parsed.map((a) => a.id)).size !== parsed.length) throw new Error("Unexpected agreements response");
  return {
    tenant_id, business_name: typeof business_name === "string" && business_name.trim() ? business_name.trim() : null,
    server_now, has_more,
    summary: { awaiting_you: summary.awaiting_you as number, signed: summary.signed as number },
    agreements: parsed,
  };
}

/** One read of the caller's agreements. Null = no customer relationship. Throws on a failed read. */
export async function readPortalAgreements(args: { tenantId?: string | null; limit?: number } = {}): Promise<PortalAgreementsPage | null> {
  const { data, error } = await portalRpc("client_portal_agreements", {
    p_tenant_id: args.tenantId ?? null,
    p_limit: args.limit ?? PORTAL_AGREEMENTS_LIMIT,
  });
  if (error) throw error;
  return parseAgreementsPage(data);
}

/** The server's refusal codes for opening an agreement to sign, plus the two the browser can meet on its own. */
export type OpenAgreementFailure =
  | "CLIENT_AGREEMENT_UNAVAILABLE" | "NOT_SIGNABLE" | "NOT_SIGNABLE_HERE" | "TRY_AGAIN_LATER"
  | "MULTIPLE_BUSINESSES" | "FAILED";
export type OpenAgreementResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; code: OpenAgreementFailure };
const OPEN_CODES = new Set<OpenAgreementFailure>(["CLIENT_AGREEMENT_UNAVAILABLE", "NOT_SIGNABLE", "NOT_SIGNABLE_HERE", "TRY_AGAIN_LATER"]);

/**
 * Ask for a link to the signing page for one of the caller's own agreements. A success is only a
 * success when it carries a well-formed token and deadline; anything else is a failure, never a
 * navigation to a page that cannot open.
 */
export async function openAgreementForSigning(agreementId: string, tenantId: string | null): Promise<OpenAgreementResult> {
  try {
    const { data, error } = await portalRpc("client_portal_open_agreement_signing", {
      p_agreement_id: agreementId,
      p_tenant_id: tenantId,
    });
    if (error) return { ok: false, code: isMultipleRelationships(error) ? "MULTIPLE_BUSINESSES" : "FAILED" };
    if (!isObject(data)) return { ok: false, code: "FAILED" };
    if (data.ok === true) {
      if (!exactKeys(data, ["ok", "token", "expires_at"]) || typeof data.token !== "string" || !TOKEN.test(data.token) || !isDate(data.expires_at)) {
        return { ok: false, code: "FAILED" };
      }
      return { ok: true, token: data.token, expiresAt: data.expires_at };
    }
    const code = data.error;
    return { ok: false, code: typeof code === "string" && OPEN_CODES.has(code as OpenAgreementFailure) ? code as OpenAgreementFailure : "FAILED" };
  } catch {
    return { ok: false, code: "FAILED" };
  }
}

/**
 * Into the existing signing page, in the SAME tab: a pop-up opened after an await is blocked, and signing is
 * the next step anyway. Coming back (Back, or the page's own links) lands on a list that re-reads itself.
 */
export function goToSigningPage(token: string): void {
  window.location.assign(`/sign/${encodeURIComponent(token)}`);
}

export type SignedCopyResult = { ok: true; blob: Blob } | { ok: false };

/**
 * The customer's own sealed copy, streamed by agreement-document's portal door (door three) with the
 * session they already hold. A document is only a document when bytes actually arrived: the endpoint
 * answers every refusal with the same JSON shape, so anything that is not a non-empty Blob fails.
 */
export async function fetchSignedCopy(agreementId: string, tenantId: string | null, download: boolean): Promise<SignedCopyResult> {
  const q = new URLSearchParams({ portal: "1", agreementId });
  if (tenantId) q.set("tenantId", tenantId);
  if (download) q.set("download", "1");
  try {
    const { data, error } = await supabase.functions.invoke(`agreement-document?${q.toString()}`, { method: "GET" });
    if (error || !(data instanceof Blob) || data.size === 0) return { ok: false };
    return { ok: true, blob: data };
  } catch {
    return { ok: false };
  }
}

/** A file name for the saved copy, from the agreement's title: letters, digits, spaces and dashes only. */
export function signedCopyFilename(title: string): string {
  const base = title.normalize("NFKD").replace(/[^\w\s-]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${base || "agreement"} (signed).pdf`;
}

export interface ClientPortalAgreementsState {
  /** In the server's order: waiting for you first (soonest deadline), then the rest, newest first. */
  agreements: PortalAgreement[];
  summary: PortalAgreementsSummary | null;
  businessName: string | null;
  hasMore: boolean;
  serverNow: string | null;
  /** First read in flight with nothing loaded yet. */
  loading: boolean;
  /** The last read failed; a loaded list (if any) is kept but may be stale. */
  error: string | null;
  /** Resolved: the caller has no customer relationship (the read returned null). */
  unavailable: boolean;
  /** Resolved: the account is linked to more than one business, which agreements don't support yet. */
  multipleBusinesses: boolean;
  /** Business of the loaded list (server-resolved), or null before the first read. */
  tenantId: string | null;
  /** Bumped whenever the signed-in identity changes. */
  scopeEpoch: number;
  refresh: () => Promise<void>;
}

export const PORTAL_AGREEMENTS_LOAD_ERROR = "We couldn't load your agreements. Check your connection and try again.";
/** A failed re-read while the last list is still on screen: the list is there, it may just be behind. */
export const PORTAL_AGREEMENTS_REFRESH_ERROR = "We couldn't refresh this list, so it may be out of date.";

export function useClientPortalAgreements(): ClientPortalAgreementsState {
  const [agreements, setAgreements] = useState<PortalAgreement[]>([]);
  const [summary, setSummary] = useState<PortalAgreementsSummary | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [multipleBusinesses, setMultipleBusinesses] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [scopeEpoch, setScopeEpoch] = useState(0);

  // Mirrors for async callbacks; each async result is applied only if its epoch is current.
  const epoch = useRef(0);
  const actor = useRef<string | null>(null);
  const tenantRef = useRef<string | null>(null);
  const readSeq = useRef(0);
  const alive = useRef(true);
  /** Set once the server refused for multiple relationships: no further reads for this identity. */
  const halted = useRef(false);
  /** A list for this identity is on screen, so a failed read is a failed refresh, not a failed load. */
  const shown = useRef(false);

  const clearData = useCallback(() => {
    shown.current = false;
    setAgreements([]);
    setSummary(null);
    setBusinessName(null);
    setHasMore(false);
    setServerNow(null);
  }, []);

  const resetScope = useCallback(() => {
    epoch.current += 1;
    readSeq.current += 1;
    tenantRef.current = null;
    halted.current = false;
    clearData();
    setError(null);
    setUnavailable(false);
    setMultipleBusinesses(false);
    setLoading(true);
    setTenantId(null);
    setScopeEpoch(epoch.current);
  }, [clearData]);

  const refresh = useCallback(async () => {
    if (halted.current) return;
    const myEpoch = epoch.current;
    const seq = ++readSeq.current;
    const current = () => alive.current && myEpoch === epoch.current && seq === readSeq.current;
    const pinned = tenantRef.current;
    try {
      const page = await readPortalAgreements({ tenantId: pinned });
      if (!current()) return;
      if (!page) {
        clearData();
        setUnavailable(true);
      } else {
        // The first read pins the business; a later answer for another one is never shown.
        if (pinned && page.tenant_id !== pinned) throw new Error("Agreements business changed");
        tenantRef.current = page.tenant_id;
        setTenantId(page.tenant_id);
        setUnavailable(false);
        setAgreements(page.agreements);
        setSummary(page.summary);
        setBusinessName(page.business_name);
        setHasMore(page.has_more);
        setServerNow(page.server_now);
        shown.current = true;
      }
      setError(null);
    } catch (err) {
      if (!current()) return;
      if (isMultipleRelationships(err)) {
        halted.current = true;
        clearData();
        setError(null);
        setMultipleBusinesses(true);
      } else {
        setError(shown.current ? PORTAL_AGREEMENTS_REFRESH_ERROR : PORTAL_AGREEMENTS_LOAD_ERROR);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [clearData]);

  // Identity scope + initial read.
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    const start = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      actor.current = user?.id ?? null;
      if (!user) { setLoading(false); setUnavailable(true); return; }
      await refresh();
    };
    void start();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      const next = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && next === actor.current) return;
      if (next === actor.current && event !== "SIGNED_OUT") return;
      actor.current = next;
      resetScope();
      if (!next || event === "SIGNED_OUT") { setLoading(false); setUnavailable(true); return; }
      // Do not call SDK Auth/RPC methods while its Auth callback holds the lock.
      queueMicrotask(() => { if (!cancelled) void refresh(); });
    });
    return () => {
      cancelled = true;
      alive.current = false;
      subscription.unsubscribe();
    };
  }, [refresh, resetScope]);

  // Freshness without realtime: focus and becoming visible — which is how the customer comes back from
  // signing, or from the email, to a list that already says what happened.
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const live = () => !!actor.current && !halted.current;
    const onFocus = () => { if (live()) void refresh(); };
    const onVisibility = () => { if (visible() && live()) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  return {
    agreements, summary, businessName, hasMore, serverNow, loading, error, unavailable, multipleBusinesses, tenantId, scopeEpoch, refresh,
  };
}

export type PortalAgreementsGlance =
  | { state: "loading" }
  | { state: "ready"; awaitingYou: number }
  | { state: "unavailable" }
  | { state: "error" };

/** Home's glance: how many agreements wait for this customer's signature, from a one-row read. */
export function usePortalAgreementsGlance(enabled = true): PortalAgreementsGlance {
  const [glance, setGlance] = useState<PortalAgreementsGlance>({ state: "loading" });
  useEffect(() => {
    if (!enabled) { setGlance({ state: "unavailable" }); return; }
    let cancelled = false;
    setGlance({ state: "loading" });
    readPortalAgreements({ limit: 1 })
      .then((page) => {
        if (cancelled) return;
        setGlance(page ? { state: "ready", awaitingYou: page.summary.awaiting_you } : { state: "unavailable" });
      })
      .catch((err) => {
        if (cancelled) return;
        setGlance(isMultipleRelationships(err) ? { state: "unavailable" } : { state: "error" });
      });
    return () => { cancelled = true; };
  }, [enabled]);
  return glance;
}
