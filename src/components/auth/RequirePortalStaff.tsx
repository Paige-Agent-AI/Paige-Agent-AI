import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/ui/page";
import { usePortalStaffStanding } from "@/lib/portal/portalStaffStanding";

/**
 * A /app page that belongs to STAFF, not to a customer (round 2: /app/paige-team, the PAIGE team directory).
 * Staff (any staff role, tenant membership, owned tenant or agency seat — portalStaffStanding) see the page; a
 * customer who opens the address gets the portal's ordinary not-available state, which names nothing staff
 * see. PAIGE is the owner's COO and never inside the Customer Portal (owner ruling, 2026-10-19).
 *
 * Presentation only: what the page reads is still decided by RLS and the server.
 * The identity guard (lint:customer-identity) requires every child route wrapped in this to be named, with
 * its reason, in STAFF_ONLY_ROUTES — and every route named there to be wrapped.
 */
export function RequirePortalStaff({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.auth.getUser().then(({ data }) => { if (live) setUserId(data.user?.id ?? null); });
    return () => { live = false; };
  }, []);
  const standing = usePortalStaffStanding(userId, !!userId);
  if (standing.staff === true) return <>{children}</>;
  if (!userId || standing.loading) {
    return <div role="status" aria-live="polite" className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  return (
    <EmptyState
      icon={Compass}
      title="This page isn't part of your portal"
      description="Everything your business shares with you is on your home page."
      action={<Link to="/app" className="inline-flex min-h-[44px] items-center rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Back to home</Link>}
    />
  );
}
