// A contact's opt-outs, read from the business's own suppression ledger (public.paige_suppressions), for
// the send paths that do NOT go through runPreSend: stage automations that hand a contact to an outside
// sender (n8n, Zapier, a custom webhook), and booking reminders that call the provider directly.
//
// It reads the same rows runPreSend step 2 reads (tenant + channel, by contact id OR normalized address)
// and adds one fact runPreSend does not need: whether the CONTACT holds the row (their portal choice,
// their STOP, their unsubscribe click, their complaint) rather than the business (a pause) or delivery
// (a hard bounce). That mirrors public._suppression_customer_held in the E09 Slice 6 migration.
//
// Two exact-match reads per channel, never an interpolated filter (the tenant-consent.ts pattern), and a
// read that fails is `unknown`: callers hold the send rather than guess (§13).
import { normalizeAddress } from "./pre-send-pipeline.ts";

export type OptOutChannel = "email" | "sms";

export type ContactOptOuts =
  | { status: "ok"; channels: OptOutChannel[]; customerHeld: OptOutChannel[] }
  | { status: "unknown"; channels: OptOutChannel[]; customerHeld: OptOutChannel[] };

type Row = { reason?: string | null; source?: string | null };
type Result = { data: Row[] | null; error: { message?: string } | null };
// deno-lint-ignore no-explicit-any
type Admin = { from: (table: string) => any };

export interface ContactOptOutQuery {
  tenantId: string;
  contactId?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Which channels to read; both by default. */
  channels?: OptOutChannel[];
}

/** The same rule as public._suppression_customer_held (SQL). */
export function isCustomerHeld(row: Row): boolean {
  return row.source === "customer_portal" ||
    ["user_stop", "unsubscribe_link", "complaint", "customer_request"].includes(String(row.reason ?? ""));
}

async function read(admin: Admin, tenantId: string, channel: OptOutChannel, column: "contact_id" | "address_normalized", value: string): Promise<Result> {
  return await admin
    .from("paige_suppressions")
    .select("reason, source")
    .eq("tenant_id", tenantId)
    .eq("channel", channel)
    .eq(column, value)
    .limit(20);
}

export async function contactOptOuts(admin: Admin, q: ContactOptOutQuery): Promise<ContactOptOuts> {
  const channels: OptOutChannel[] = q.channels ?? ["email", "sms"];
  const out = { channels: [] as OptOutChannel[], customerHeld: [] as OptOutChannel[] };
  if (!q.tenantId) return { status: "unknown", ...out };
  try {
    for (const channel of channels) {
      const raw = channel === "email" ? q.email : q.phone;
      const address = raw ? normalizeAddress(channel, raw) : "";
      const usable = address && address !== "+";
      const reads = await Promise.all([
        q.contactId ? read(admin, q.tenantId, channel, "contact_id", q.contactId) : Promise.resolve<Result>({ data: [], error: null }),
        usable ? read(admin, q.tenantId, channel, "address_normalized", address) : Promise.resolve<Result>({ data: [], error: null }),
      ]);
      if (reads.some((r) => r.error)) return { status: "unknown", ...out };
      const rows = reads.flatMap((r) => r.data ?? []);
      if (rows.length > 0) out.channels.push(channel);
      if (rows.some(isCustomerHeld)) out.customerHeld.push(channel);
    }
    return { status: "ok", ...out };
  } catch {
    return { status: "unknown", ...out };
  }
}

/** One email recipient: may a non-runPreSend path email them? `unknown` means hold the send. */
export async function emailOptOut(admin: Admin, q: { tenantId: string | null; contactId?: string | null; email: string }): Promise<"clear" | "suppressed" | "unknown"> {
  if (!q.tenantId) return "unknown";
  const r = await contactOptOuts(admin, { tenantId: q.tenantId, contactId: q.contactId ?? null, email: q.email, channels: ["email"] });
  if (r.status === "unknown") return "unknown";
  return r.channels.includes("email") ? "suppressed" : "clear";
}
