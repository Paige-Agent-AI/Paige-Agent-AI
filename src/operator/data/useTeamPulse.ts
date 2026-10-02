import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { OperatorTier } from "@/lib/auth/operatorStanding";

/**
 * Fleet Console — Team Pulse (CD's `P.pulse`, `fleetSpecs.ts`'s `fleet/team-pulse` entry).
 * "Platform seats only — who is carrying the operator work, and who is idle."
 *
 * §18 — `list_platform_staff()` already exists (Platform → Team, `platform_staff_foundation`
 * migrations) and is exactly the seat roster this block needs: every `super_admin`/
 * `platform_admin` user, name + role. Reused as-is, not re-derived.
 *
 * §13 — the roster (who holds a seat) is real and rendered. Utilisation, hours-booked, and
 * "where operator time goes" are NOT: no activity-tracking capability exists yet to measure
 * them, so those stay the honest absence the spec already ships (`null`/empty), not a guess.
 */
export type PlatformSeat = {
  userId: string;
  email: string;
  fullName: string | null;
  /** The seat's operator tier, as the server reports it. Which roles are tiers is server data. */
  role: OperatorTier;
};

export function useTeamPulse(enabled: boolean): {
  seats: PlatformSeat[];
  loading: boolean;
  error: string | null;
} {
  const [seats, setSeats] = useState<PlatformSeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: qErr } = await supabase.rpc("list_platform_staff");

      if (!alive) return;
      if (qErr) {
        setError(qErr.message);
        setSeats([]);
        setLoading(false);
        return;
      }
      setSeats(
        (data ?? []).map((r) => ({
          userId: r.user_id,
          email: r.email,
          fullName: r.full_name,
          role: String(r.role),
        })),
      );
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [enabled]);

  return { seats, loading, error };
}
