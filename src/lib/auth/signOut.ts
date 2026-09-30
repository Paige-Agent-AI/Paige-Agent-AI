import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// A tenant's customer must return to their coach's branded gateway on EVERY
// exit — the sign-out button, but also involuntary logouts (session expiry,
// forced sign-out) whose handlers fire when the token is already invalid and an
// RPC can't be trusted. We cache the customer's portal slug (survives the
// sign-out storage wipe via PRESERVE_KEYS) so those paths can resolve the
// gateway synchronously. Staff never get a slug cached, so they still exit to "/".
const PORTAL_SLUG_KEY = "paige_portal_slug";

export function cachePortalSlug(slug: string | null | undefined) {
  if (typeof window === "undefined") return;
  try {
    if (slug) window.localStorage.setItem(PORTAL_SLUG_KEY, slug);
  } catch { /* ignore */ }
}

/** Synchronous, session-free gateway target from the cached slug, or null. */
export function readCachedPortalTarget(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const slug = window.localStorage.getItem(PORTAL_SLUG_KEY);
    return slug ? `/portal/${encodeURIComponent(slug)}` : null;
  } catch {
    return null;
  }
}

/**
 * Resolve where a user should land AFTER sign-out. A tenant's customer returns
 * to their coach's branded gateway (/portal/:slug) — never the Paige platform
 * page (§9). get_client_portal_brand returns a row ONLY for a linked customer,
 * so staff/operators (no row) fall through to `fallback`. Must be called while
 * still authenticated (before performSignOut). Never throws, and never blocks
 * sign-out for more than ~1.5s (a hung RPC falls back to the cached slug).
 */
export async function customerSignOutTarget(fallback = "/"): Promise<string> {
  try {
    const rpc = supabase.rpc("get_client_portal_brand").then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      return (row as { tenant_slug?: string } | null)?.tenant_slug ?? null;
    });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    const slug = await Promise.race([rpc, timeout]);
    if (slug) {
      cachePortalSlug(slug);
      return `/portal/${encodeURIComponent(slug)}`;
    }
    // RPC empty (staff) or timed out — use the cached gateway if we have one.
    return readCachedPortalTarget() ?? fallback;
  } catch {
    return readCachedPortalTarget() ?? fallback;
  }
}

/** True while a performSignOut() is mid-flight (so global listeners can defer). */
export function isSignOutInFlight(): boolean {
  return isSigningOut;
}

const AUTH_STORAGE_KEY_PATTERNS = [
  /^sb-.*-auth-token$/i,
  /^supabase\.auth/i,
  /^supabase-auth-token/i,
];

// Keys that intentionally survive sign-out (e.g. referral attribution).
const PRESERVE_KEYS = new Set<string>(["paige_ref"]);

// Allow consumers (App root) to register the active QueryClient so that
// signOut can flush all cached data even when called from non-React code
// (e.g. global auth listener, fetch interceptor).
let registeredQueryClient: QueryClient | null = null;
export function registerSignOutQueryClient(client: QueryClient | null) {
  registeredQueryClient = client;
}

function clearAuthStorage(opts: { wipeAll: boolean }) {
  if (typeof window === "undefined") return;

  const clearStorage = (storage: Storage) => {
    const keysToRemove: string[] = [];

    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;

      if (PRESERVE_KEYS.has(key)) continue;

      if (opts.wipeAll) {
        keysToRemove.push(key);
      } else if (AUTH_STORAGE_KEY_PATTERNS.some((p) => p.test(key))) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => storage.removeItem(key));
  };

  // sessionStorage is fully wiped (no preserved keys live there).
  try {
    const sess = window.sessionStorage;
    const sessionKeys: string[] = [];
    for (let i = 0; i < sess.length; i += 1) {
      const k = sess.key(i);
      if (k) sessionKeys.push(k);
    }
    sessionKeys.forEach((k) => sess.removeItem(k));
  } catch (e) {
    console.warn("Failed to clear sessionStorage:", e);
  }

  try {
    clearStorage(window.localStorage);
  } catch (e) {
    console.warn("Failed to clear localStorage:", e);
  }
}

/**
 * An operator acting as a tenant holds that act-as on the SERVER. Signing out clears this browser
 * only, so every sign-out first gives the tenant provider a chance to end it through the audited
 * exit. The provider registers the check (it knows the account context); with nothing registered,
 * sign-out behaves exactly as before.
 */
export type ActAsSettlement = "clear" | "refused" | "unknown";
let actAsGuard: (() => Promise<ActAsSettlement>) | null = null;
const ATTEMPT_ACT_AS_TIMEOUT_MS = 3000;
export function registerSignOutActAsGuard(guard: () => Promise<ActAsSettlement>): () => void {
  actAsGuard = guard;
  return () => {
    if (actAsGuard === guard) actAsGuard = null;
  };
}

interface SignOutOptions {
  /**
   * What an open operator act-as means for this sign-out:
   * - `require` (default, a sign-out the person chose): end it first, and stay signed in if it will
   *   not end or cannot be confirmed.
   * - `attempt` (security and timeout sign-outs): end it if possible, and sign out regardless — a
   *   security action is never held.
   * - `skip` (the session is already invalid): no request can reach the server, so don't try.
   */
  actAs?: "require" | "attempt" | "skip";
  /** Where to send the user after sign-out completes. Defaults to "/". */
  redirectTo?: string;
  /** "global" kills refresh tokens on every device for this user. */
  scope?: "local" | "global";
  /** When true, removes everything from localStorage except PRESERVE_KEYS. */
  wipeAllStorage?: boolean;
  /** Optional QueryClient to clear; falls back to the registered one. */
  queryClient?: QueryClient | null;
}

let isSigningOut = false;

export async function performSignOut(
  redirectToOrOptions: string | SignOutOptions = "/",
): Promise<boolean> {
  // Normalize args
  const opts: SignOutOptions =
    typeof redirectToOrOptions === "string"
      ? { redirectTo: redirectToOrOptions }
      : redirectToOrOptions ?? {};

  const redirectTo = opts.redirectTo ?? "/";
  const scope = opts.scope ?? "local";
  const wipeAllStorage = opts.wipeAllStorage ?? true;
  const queryClient = opts.queryClient ?? registeredQueryClient;

  // Re-entrancy guard so listener + button click don't double-fire.
  if (isSigningOut) return false;
  isSigningOut = true;

  const actAs = opts.actAs ?? "require";
  if (actAs !== "skip" && actAsGuard) {
    let settled: ActAsSettlement = "unknown";
    const check = actAsGuard().catch((err) => {
      console.error("Checking for an open act-as before sign-out failed:", err);
      return "unknown" as const;
    });
    // A security sign-out waits for the check only briefly: a stalled request must never keep the
    // session signed in. A chosen sign-out waits for the answer, because it will not proceed without one.
    settled = actAs === "attempt"
      ? await Promise.race([
          check,
          new Promise<ActAsSettlement>((resolve) => setTimeout(() => resolve("unknown"), ATTEMPT_ACT_AS_TIMEOUT_MS)),
        ])
      : await check;
    if (settled !== "clear" && actAs === "require") {
      isSigningOut = false;
      toast.error(settled === "refused"
        ? "Couldn't end your act-as in this tenant, so you're still signed in. Try again."
        : "Paige couldn't confirm whether your act-as is still open, so you're still signed in. Try again.");
      return false;
    }
  }

  try {
    try {
      await supabase.auth.signOut({ scope });
    } catch (err) {
      console.error(`Sign out (${scope}) failed, falling back to local:`, err);
      try {
        await supabase.auth.signOut();
      } catch (innerErr) {
        console.error("Local sign out also failed:", innerErr);
      }
    }
  } finally {
    // Always clear client state even if the network call failed.
    try {
      queryClient?.cancelQueries();
      queryClient?.clear();
    } catch (e) {
      console.warn("Failed to clear React Query cache:", e);
    }

    clearAuthStorage({ wipeAll: wipeAllStorage });

    // Use replace so back-button doesn't return to authenticated view.
    window.location.replace(redirectTo);
  }
  return true;
}
