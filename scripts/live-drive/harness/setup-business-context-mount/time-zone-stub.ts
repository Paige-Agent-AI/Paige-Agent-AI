import { supabase as base } from "../settings-mount/supabase-paige-stub";

/**
 * Experience 04 E4-S2 render harness: answers ONLY the two business time zone RPCs, in memory, so the
 * real Setup, the real hook and the real component render every state. `?tz=` picks the starting
 * state: missing (default) · configured · admin (configured, cannot change) · invalid · refused ·
 * readerror. A save is kept for the page's life and read back like the database would. Synthetic
 * data; never persistence, permission or tenant proof (supabase/tests/exp04_client_engagement_status.sql
 * owns those).
 */
const PATTERN = /^(UTC|(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z][A-Za-z0-9_+-]*)?)$/;
const mode = () => new URLSearchParams(window.location.search).get("tz") ?? "missing";
let stored: string | null | undefined;
const zone = () => {
  if (stored === undefined) stored = { configured: "America/New_York", admin: "America/New_York", invalid: "America/Nowhere" }[mode()] ?? null;
  return stored;
};
const localDate = (z: string) => new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ok = (data: unknown) => Promise.resolve({ data, error: null });
const refuse = (code: string) => Promise.resolve({ data: null, error: { code, message: "harness refusal" } });

function readZone() {
  if (mode() === "readerror") return refuse("57014");
  if (mode() === "refused") return refuse("42501");
  const z = zone();
  const can_set = mode() !== "admin";
  if (!z) return ok({ state: "missing", zone: null, set_at: null, local_date: null, can_set, receipt_id: "harness" });
  if (z === "America/Nowhere") return ok({ state: "invalid", zone: null, set_at: "2026-10-12T20:00:00Z", local_date: null, can_set, receipt_id: "harness" });
  return ok({ state: "configured", zone: z, set_at: "2026-10-12T20:00:00Z", local_date: localDate(z), can_set, receipt_id: "harness" });
}

export const supabase = {
  ...base,
  rpc: (name: string, args?: Record<string, unknown>) => {
    if (name === "read_business_time_zone") return readZone();
    if (name === "set_business_time_zone") {
      if (mode() === "admin") return refuse("42501");
      const next = String(args?._time_zone ?? "");
      if (!PATTERN.test(next)) return refuse("22023");
      stored = next;
      return ok({ time_zone: next, receipt_id: "harness" });
    }
    return base.rpc(name, args);
  },
};
export default { supabase };
