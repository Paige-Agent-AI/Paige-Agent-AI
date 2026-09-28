import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { performSignOut, registerSignOutQueryClient, readCachedPortalTarget, isSignOutInFlight } from "@/lib/auth/signOut";

const PUBLIC_ROUTES = new Set([
  "/",
  "/auth",
  "/reset-password",
  "/terms",
  "/privacy",
  "/unsubscribe",
  "/affiliates",
  "/become-an-affiliate",
  "/pricing",
]);

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  // Allow public marketing/affiliate landing variants
  if (pathname.startsWith("/affiliates/")) return true;
  // Tenant-branded customer portal gateway (signed-out landing / log back in).
  if (pathname.startsWith("/portal/")) return true;
  return false;
}

function looksLikeJwtError(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const m = message.toLowerCase();
  return (
    m.includes("jwt expired") ||
    m.includes("invalid jwt") ||
    m.includes("invalid session") ||
    m.includes("session_not_found") ||
    m.includes("session not found") ||
    m.includes("refresh_token_not_found") ||
    m.includes("not authenticated") && m.includes("session")
  );
}

let interceptorInstalled = false;
let sessionExpiredHandled = false;

async function handleExpiredSession() {
  if (sessionExpiredHandled) return;

  // Only treat a 401 as "expired" when we actually have a session to expire.
  // Unauthenticated 401s on public routes (e.g. /auth) must not trigger a
  // toast + redirect loop.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
  } catch {
    return;
  }

  if (typeof window !== "undefined" && isPublicRoute(window.location.pathname)) {
    return;
  }

  sessionExpiredHandled = true;
  toast.error("Your session expired — please sign in again.");
  // A tenant's customer returns to their branded gateway, never the Paige
  // auth page (§9); staff (no cached slug) fall back to /auth.
  const expiredTarget = readCachedPortalTarget() ?? "/auth";
  setTimeout(() => {
    // The session is already invalid: no request can reach the server, so no act-as check.
    performSignOut({ redirectTo: expiredTarget, scope: "local", actAs: "skip" });
  }, 250);
}

function installFetchInterceptor() {
  if (interceptorInstalled || typeof window === "undefined") return;
  interceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);

    let url = "";
    try {
      url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    } catch {
      url = "";
    }

    if (!url.includes("supabase.co")) return response;
    if (response.status !== 401) return response;

    // Requests without an Authorization header are anonymous by design
    // (e.g. public marketing queries). A 401 here just means "not allowed
    // anonymously", not "your session expired".
    let hadAuthHeader = false;
    try {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      hadAuthHeader = headers.has("authorization");
    } catch {
      hadAuthHeader = false;
    }
    if (!hadAuthHeader) return response;

    try {
      const cloned = response.clone();
      const text = await cloned.text();
      if (text && looksLikeJwtError(text)) {
        void handleExpiredSession();
      }
    } catch {
      // ignore
    }

    return response;
  };
}

/**
 * Mount once near the top of the React tree. Wires up:
 *  - QueryClient registration so non-React code can flush cache on sign-out.
 *  - Global onAuthStateChange listener: on SIGNED_OUT, flush state + redirect.
 *  - Global fetch interceptor: on Supabase 401 / JWT expired, auto sign out.
 */
export function GlobalAuthSessionManager() {
  const queryClient = useQueryClient();
  const lastEventRef = useRef<string | null>(null);
  const forcedLogoutHandledRef = useRef(false);

  useEffect(() => {
    registerSignOutQueryClient(queryClient);

    installFetchInterceptor();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Reset the expired-session guard when a fresh session is established.
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
          sessionExpiredHandled = false;
        }

        if (event === "SIGNED_OUT" && lastEventRef.current !== "SIGNED_OUT") {
          lastEventRef.current = "SIGNED_OUT";

          try {
            queryClient.cancelQueries();
            queryClient.clear();
          } catch (e) {
            console.warn("Failed to clear cache on SIGNED_OUT:", e);
          }

          // If an explicit performSignOut() is driving this, let it own the
          // post-signout navigation (it targets the customer's tenant gateway);
          // redirecting here would race it and could land on the Paige page (§9).
          if (isSignOutInFlight()) return;
          // If user is on a public page, no redirect needed.
          if (!isPublicRoute(window.location.pathname)) {
            // Use replace so back button doesn't return to a logged-in view.
            // Prefer the customer's branded gateway if we know it.
            window.location.replace(readCachedPortalTarget() ?? "/");
          }
          return;
        }

        if (event === "SIGNED_IN") {
          lastEventRef.current = "SIGNED_IN";
        }
      },
    );

    return () => {
      subscription.unsubscribe();
      registerSignOutQueryClient(null);
    };
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;

    const checkForcedLogout = async () => {
      if (forcedLogoutHandledRef.current || cancelled) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id || cancelled) return;

        const { data } = await supabase
          .from("audit_logs")
          .select("id, created_at")
          .eq("user_id", session.user.id)
          .eq("entity", "auth_session")
          .eq("action", "emergency_force_signout")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!data || cancelled) return;

        const auditAt = data.created_at ? new Date(data.created_at).getTime() : 0;
        const lastSignInAt = session.user.last_sign_in_at
          ? new Date(session.user.last_sign_in_at).getTime()
          : 0;
        // Only clear sessions that were already active when the emergency
        // sign-out was written. A fresh login after the audit row must remain
        // valid, otherwise the user would be kicked out again forever.
        if (lastSignInAt && auditAt && auditAt <= lastSignInAt) return;
        if (!lastSignInAt && auditAt && Date.now() - auditAt > 10 * 60 * 1000) return;

        // Server-side sessions were revoked out-of-band; clear this tab too so
        // the user is not trapped in a stale authenticated loading loop.
        forcedLogoutHandledRef.current = true;
        toast.error("Your session was reset — please sign in again.");
        // Server-side sessions were already revoked: no act-as check can reach the server.
        await performSignOut({ redirectTo: readCachedPortalTarget() ?? "/auth", scope: "local", actAs: "skip" });
      } catch {
        // Non-blocking: ordinary auth/session handling still applies.
      }
    };

    void checkForcedLogout();
    const id = window.setInterval(checkForcedLogout, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return null;
}
