import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Experience 04 E4-S2 — the business time zone, the one setting that decides which payment dates are
 * due or overdue (owner ruling 2026-10-12). One store: public.tenant_business_time_zones, read through
 * public.read_business_time_zone (owner/admin of the active workspace) and written only through
 * public.set_business_time_zone (active owner). Both run on the signed-in person's own session.
 *
 * A save is not reported until the value is READ BACK from the database and equals what the owner
 * chose. Customer contact timing never reads this value; it uses each customer's verified zone.
 */
export type BusinessTimeZoneState = "configured" | "missing" | "invalid";
export type BusinessTimeZone = {
  state: BusinessTimeZoneState;
  zone: string | null;
  setAt: string | null;
  localDate: string | null;
  canSet: boolean;
};
export type BusinessTimeZoneLoad =
  | { status: "loading" }
  | { status: "ready"; value: BusinessTimeZone }
  | { status: "refused" }
  | { status: "error" };
export type BusinessTimeZoneSave =
  | { ok: true; value: BusinessTimeZone }
  | { ok: false; kind: "refused" | "invalid" | "failed" | "unconfirmed" };

/** The database's own accepted shape (the writer and the table CHECK use the same pattern). */
export const BUSINESS_ZONE_PATTERN = /^(UTC|(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z][A-Za-z0-9_+-]*)?)$/;

const code = (error: unknown) => (error as { code?: string } | null)?.code;

export function parseBusinessTimeZone(data: unknown): BusinessTimeZone | null {
  const v = data as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return null;
  if (v.state !== "configured" && v.state !== "missing" && v.state !== "invalid") return null;
  const zone = typeof v.zone === "string" ? v.zone : null;
  if (v.state === "configured" && !zone) return null;
  return {
    state: v.state,
    zone: v.state === "configured" ? zone : null,
    setAt: typeof v.set_at === "string" ? v.set_at : null,
    localDate: typeof v.local_date === "string" ? v.local_date : null,
    canSet: v.can_set === true,
  };
}

export async function readBusinessTimeZone(tenantId: string): Promise<BusinessTimeZoneLoad> {
  const { data, error } = await supabase.rpc("read_business_time_zone" as never, { _expected_tenant_id: tenantId } as never);
  if (error) return code(error) === "42501" ? { status: "refused" } : { status: "error" };
  const value = parseBusinessTimeZone(data);
  return value ? { status: "ready", value } : { status: "error" };
}

export async function saveBusinessTimeZone(tenantId: string, zone: string): Promise<BusinessTimeZoneSave> {
  if (!BUSINESS_ZONE_PATTERN.test(zone)) return { ok: false, kind: "invalid" };
  const { error } = await supabase.rpc("set_business_time_zone" as never, { _expected_tenant_id: tenantId, _time_zone: zone } as never);
  if (error) {
    const c = code(error);
    return { ok: false, kind: c === "42501" ? "refused" : c === "22023" ? "invalid" : "failed" };
  }
  // The write said yes; the database's own read decides whether it holds.
  const read = await readBusinessTimeZone(tenantId);
  if (read.status !== "ready" || read.value.state !== "configured" || read.value.zone !== zone) return { ok: false, kind: "unconfirmed" };
  return { ok: true, value: read.value };
}

export function useBusinessTimeZone(tenantId: string | null) {
  const [load, setLoad] = useState<BusinessTimeZoneLoad>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  // A response for a workspace the person has since left is dropped, never shown.
  const current = useRef(tenantId);
  current.current = tenantId;

  const refresh = useCallback(async () => {
    if (!tenantId) { setLoad({ status: "refused" }); return; }
    setLoad({ status: "loading" });
    const next = await readBusinessTimeZone(tenantId);
    if (current.current === tenantId) setLoad(next);
  }, [tenantId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (zone: string): Promise<BusinessTimeZoneSave> => {
    if (!tenantId) return { ok: false, kind: "refused" };
    setSaving(true);
    try {
      const result = await saveBusinessTimeZone(tenantId, zone);
      if (current.current !== tenantId) return { ok: false, kind: "failed" };
      if (result.ok) setLoad({ status: "ready", value: result.value });
      return result;
    } finally {
      setSaving(false);
    }
  }, [tenantId]);

  return { load, saving, refresh, save };
}
