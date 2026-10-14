import { Navigate, useLocation } from "react-router-dom";
import { isOperator, useOperatorStanding } from "@/lib/auth/operatorStanding";
import { useTenantContext } from "@/hooks/useTenantContext";
import { EmptyState, PageSkeleton } from "@/components/ui/page";
import { Button } from "@/components/ui/button";

/**
 * RequireOperator — the ONE guard above the whole `/operator/{section}` subtree (§53).
 *
 * The design pack's own handoff note is explicit that the guard "belongs above the router,
 * not per route", and that is also how every other tier subtree already works here — so this
 * is one instance wrapping every operator route, never one copy per route.
 *
 * WHICH ANSWER. The one server answer, `operator_standing()`, read through the one client home
 * (`useOperatorStanding`, src/lib/auth/operatorStanding.ts). Admission is a positive answer only:
 * the caller holds an operator tier. Which roles are tiers is server data (G1), so this file names
 * no role. The home also carries every protection this guard used to implement itself — a verdict
 * keyed to the person it was issued for, the generation guard, bounded retries, and "could not
 * verify" instead of a denial — so there is one implementation of them, not two.
 *
 * WHY THE `loading` GATE STAYS. Children depend on the shared tenant scope having resolved once,
 * so the guard still holds them back until `useTenantContext` has loaded. It never reads that
 * context's operator flags: they are refreshed in the background after sign-in and can be stale
 * for exactly the moment that matters.
 *
 * WHAT THIS IS NOT. A UI guard is not the security boundary. The real boundary stays
 * server-side — RLS plus the operator-gated RPCs. This only decides what to paint.
 */
export default function RequireOperator({ children }: { children: React.ReactNode }) {
  const { loading } = useTenantContext();
  const location = useLocation();
  const standing = useOperatorStanding();

  // 1. Signed out is authoritative and cheap — send them to the door with where they were
  //    going, before spending anything else.
  if (standing.phase === "signed_out") {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/operator/login?next=${next}`} replace />;
  }

  // 2. ALLOW only on a server answer for WHOEVER IS SIGNED IN NOW.
  if (standing.phase === "known" && isOperator(standing.standing)) {
    return <>{children}</>;
  }

  // 3. The check failed and kept failing. Say so — never an endless skeleton (§32) and never a
  //    bounce over what may be a network blip.
  if (standing.phase === "unverifiable") {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6">
        <EmptyState
          title="Couldn't verify your access"
          description="The platform could not confirm your operator role just now. This is usually a network hiccup rather than a permissions problem — try again."
          action={
            <Button variant="gold" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  // 4. Nothing has said yes yet. Wait — do NOT infer a denial from silence.
  if (standing.phase === "resolving" || loading) return <PageSkeleton />;

  // 5. Signed in, and the server said this person holds no operator tier.
  return <Navigate to="/app" replace />;
}
