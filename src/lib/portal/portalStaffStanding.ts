import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STAFF_ROLES } from "@/components/auth/ClientOnlyRouteGuard";

/**
 * Whether the person on /app has standing as STAFF anywhere on the platform — the question the Customer
 * Portal asks only when it found no customer relationship (the frame's "not-client" phase).
 *
 * Staff previewing /app (an admin, a coach, a platform operator, an agency team member on ?stay=1) keep
 * the owner's assistant; anyone else there is a person whose customer access is not active, and PAIGE,
 * the owner's COO, is never what they talk to (owner ruling, 2026-10-19). The signals are the ones
 * resolveLandingRoute already reads to decide that a person is staff: a staff role (the route guard's
 * STAFF_ROLES; a business's people are recognised by their membership, never a title), a tenant membership,
 * a tenant they own, or an active agency team seat. Each is read under the person's own session (RLS); this is presentation, never
 * authority — the server still decides what any turn may do.
 *
 * null means the role list could not be read: unknown, so the portal shows neither the owner's chat nor
 * the "not active" message as fact.
 */
const PORTAL_STAFF_ROLES: ReadonlySet<string> = new Set(STAFF_ROLES);
const cache = new Map<string, Promise<boolean | null>>();

export function readPortalStaffStanding(userId: string): Promise<boolean | null> {
  const hit = cache.get(userId);
  if (hit) return hit;
  const read = (async (): Promise<boolean | null> => {
    const [roles, member, owned, agency] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("tenant_members").select("tenant_id").eq("user_id", userId).limit(1).maybeSingle(),
      supabase.from("tenants").select("id").eq("owner_user_id", userId).limit(1).maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- agency_team_members is not in the generated types
      (supabase.from("agency_team_members" as any) as any).select("agency_tenant_id").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle(),
    ]);
    if (roles.error || !Array.isArray(roles.data)) return null;
    if (roles.data.some((r: { role: unknown }) => PORTAL_STAFF_ROLES.has(String(r.role)))) return true;
    return !!(member.data || owned.data || (agency as { data: unknown }).data);
  })().catch(() => null);
  cache.set(userId, read);
  // An unknown answer is not remembered: the next look asks again.
  void read.then(v => { if (v === null) cache.delete(userId); });
  return read;
}

/** For tests. */
export function clearPortalStaffStanding(): void { cache.clear(); }

export function usePortalStaffStanding(userId: string | null | undefined, enabled: boolean): { loading: boolean; staff: boolean | null } {
  const [state, setState] = useState<{ key: string | null; staff: boolean | null }>({ key: null, staff: null });
  const key = enabled && userId ? userId : null;
  useEffect(() => {
    if (!key) return;
    let live = true;
    void readPortalStaffStanding(key).then(staff => { if (live) setState({ key, staff }); });
    return () => { live = false; };
  }, [key]);
  if (!key) return { loading: false, staff: null };
  return state.key === key ? { loading: false, staff: state.staff } : { loading: true, staff: null };
}
