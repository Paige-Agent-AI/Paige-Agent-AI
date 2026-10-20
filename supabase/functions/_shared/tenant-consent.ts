// A business's consent to message one of its contacts, read from the business's own ledger
// (paige_consent_events: tenant-scoped, append-only, written by the server and the business's admins).
// The latest event for the contact or address on this channel decides: `granted` allows, anything else
// (revoked, nothing on record) does not. A read that fails is `unknown`, and callers hold the send (§13).
//
// This is the same rule the pre-send pipeline applies before a provider send (pre-send-pipeline.ts,
// step 3). Callers that decide BEFORE that pipeline (stage automation) use this, never the platform-level
// communications_consents gates, which answer for Paige's own account messages, not a business's contacts.
import { normalizeAddress } from "./pre-send-pipeline.ts";
import type { ChannelType } from "./channel-adapters.ts";

export type TenantConsent = "granted" | "revoked" | "none" | "unknown";

type Row = { action?: string | null; created_at?: string | null };
type Result = { data: Row[] | null; error: { message?: string } | null };
// deno-lint-ignore no-explicit-any
type Admin = { from: (table: string) => any };

export interface TenantConsentQuery {
  tenantId: string;
  channel: ChannelType;
  contactId?: string | null;
  address?: string | null;
}

async function latest(admin: Admin, q: TenantConsentQuery, column: "contact_id" | "address_normalized", value: string): Promise<Result> {
  return await admin
    .from("paige_consent_events")
    .select("action, created_at")
    .eq("tenant_id", q.tenantId)
    .eq("channel", q.channel)
    .eq(column, value)
    .order("created_at", { ascending: false })
    .limit(1);
}

export async function tenantConsent(admin: Admin, q: TenantConsentQuery): Promise<TenantConsent> {
  if (!q.tenantId) return "unknown";
  const address = q.address ? normalizeAddress(q.channel, q.address) : "";
  if (!q.contactId && !address) return "none";
  try {
    // Two exact-match reads rather than one interpolated `or` filter: an address never becomes filter syntax.
    const reads = await Promise.all([
      q.contactId ? latest(admin, q, "contact_id", q.contactId) : Promise.resolve<Result>({ data: [], error: null }),
      address ? latest(admin, q, "address_normalized", address) : Promise.resolve<Result>({ data: [], error: null }),
    ]);
    if (reads.some((r) => r.error)) return "unknown";
    const rows = reads.flatMap((r) => r.data ?? []);
    if (rows.length === 0) return "none";
    rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return rows[0].action === "granted" ? "granted" : rows[0].action === "revoked" ? "revoked" : "none";
  } catch {
    return "unknown";
  }
}
