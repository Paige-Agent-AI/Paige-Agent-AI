import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useShellCustomerIdentity } from "@/lib/portal/customerIdentity";
import { useOptionalTenantContext } from "@/hooks/useTenantContext";

/**
 * E09 F2 — whether funding/credit is part of THIS viewer's business, from the one canonical per-business
 * predicate `_tenant_finance_entitled` (F1a). Funding and credit are not standard features (owner ruling
 * 2026-10-19): a business has them only through a deliberate Marketplace install, so every customer-facing
 * funding/credit surface reads this and fails closed.
 *
 * - A customer of one business (a customer frame in the /app shell): the frame's `config.entitlements.finance`,
 *   which get_client_portal_config() computes server-side for the customer's own business.
 * - Anyone else (staff, staff viewing as a client, a person with no active access, and every surface outside the
 *   /app shell): `current_tenant_finance_entitled()`, the caller's own current business (false with none).
 *
 * `loading` is true only while the shell is still finding out which viewer this is, or the staff read is in
 * flight. A failed read is "not entitled", never an error state the page has to explain.
 */
export interface FinanceEntitlement {
  entitled: boolean;
  loading: boolean;
  /** The /app shell's viewer is staff of a business (not a customer frame), including staff viewing as a client. */
  staffViewer: boolean;
}

/**
 * One read per active workspace, shared by every surface on the page (the bell, the menu, the route guard) for a
 * short while, so mounting several of them does not ask the database several times. No provider is needed.
 */
const SHARED_MS = 30_000;
const shared = new Map<string, { at: number; value: Promise<boolean> }>();
function sharedRead(key: string): Promise<boolean> {
  const hit = shared.get(key);
  if (hit && Date.now() - hit.at < SHARED_MS) return hit.value;
  const value = readCurrentTenantFinanceEntitlement();
  shared.set(key, { at: Date.now(), value });
  return value;
}
/** Tests only: forget every shared read. */
export function resetFinanceEntitlementCache(): void {
  shared.clear();
}

/** The caller's own current business, through the caller-scoped wrapper (granted to signed-in users only). */
export async function readCurrentTenantFinanceEntitlement(): Promise<boolean> {
  try {
    const { data, error } = await (supabase.rpc("current_tenant_finance_entitled" as never) as unknown as
      PromiseLike<{ data: unknown; error: unknown }>);
    return !error && data === true;
  } catch {
    return false;
  }
}

export function useFinanceEntitlement(enabled = true): FinanceEntitlement {
  const identity = useShellCustomerIdentity();
  const frame = identity?.frame ?? null;
  const pending = !!identity && !frame && identity.checking;
  // Keyed by the signed-in person and their active workspace, so switching either never reuses another answer.
  const tenantContext = useOptionalTenantContext();
  const ask = enabled && !frame && !pending;
  const key = `${tenantContext?.activeUserId ?? "anon"}:${tenantContext?.activeTenantId ?? "none"}`;
  const [read, setRead] = useState<{ key: string; entitled: boolean } | null>(null);
  useEffect(() => {
    if (!ask) return;
    let live = true;
    void sharedRead(key).then((entitled) => { if (live) setRead({ key, entitled }); });
    return () => { live = false; };
  }, [ask, key]);
  const staff = read?.key === key ? read : null;
  const staffViewer = identity?.viewer === "staff";
  if (!enabled) return { entitled: false, loading: false, staffViewer: false };
  if (frame) return { entitled: frame.config.entitlements?.finance === true, loading: false, staffViewer: false };
  if (pending) return { entitled: false, loading: true, staffViewer: false };
  return { entitled: staff?.entitled === true, loading: staff === null, staffViewer };
}

/**
 * Whether the /app shell shows its funding and credit surfaces to this viewer: the business is entitled — or the
 * viewer is staff, who keep exactly what they had today (owner ruling Q5, option a, 2026-10-19: staff funding and
 * credit work in a business without the entitlement is gated only once that business has a deliberate Marketplace
 * install; a tracked follow-up, EXP14). A customer, and anyone without active access, needs the entitlement.
 */
export function useFinancePortal(enabled = true): { open: boolean; loading: boolean } {
  const e = useFinanceEntitlement(enabled);
  return { open: e.entitled || e.staffViewer, loading: e.loading && !e.staffViewer };
}
