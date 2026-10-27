// A BUSINESS's From, sent through PAIGE's SendGrid transport — the one place a non-send-message sender
// (paige-mcp's send tools, skill-runner's approved document email) turns a business's sender into the
// From and Reply-To that actually go out.
//
// Security H2 (see tenantFrom in platform-sendgrid.ts): a mail.paigeagent.ai From is kept only when it is
// THIS business's own managed address, read server-side; another business's managed address, any PAIGE
// address and a business's own domain are sent as notifications@mail.paigeagent.ai under its name.
//
// Replies: when the From had to change, the email no longer comes from an address the business reads, so
// with no Reply-To of its own a reply would land on the shared notifications@ address. It goes to the
// address the email used to come from instead — never to a paigeagent.ai address, which no business owns.
// This mirrors send-message's SendGrid arm.
import { PLATFORM_FROM_DOMAIN, tenantFrom } from "./platform-sendgrid.ts";

const ADDRESS = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
const PAIGE_DOMAIN = /@(?:[^@]+\.)?paigeagent\.ai$/i;

// The minimal read this needs, so callers with differently-typed clients can pass theirs.
type IdentityReader = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error?: unknown }> };
    };
  };
};

/**
 * THIS business's own managed address(es) on mail.paigeagent.ai, for `tenantId` resolved server-side by
 * the caller (never a request body): any address the caller already resolved server-side for the tenant
 * (its sender identity), plus the business's active registered identity row. A failed read keeps only
 * what was passed — it can only make the From more conservative, never borrow an address.
 */
export async function ownManagedAddresses(
  admin: IdentityReader,
  tenantId: string | null | undefined,
  resolved: ReadonlyArray<string | null | undefined> = [],
): Promise<string[]> {
  const own = resolved.map((a) => String(a ?? "").trim()).filter((a) => ADDRESS.test(a));
  if (!tenantId) return own;
  try {
    const { data } = await admin.from("tenant_email_identities").select("local_part, status").eq("tenant_id", tenantId).maybeSingle();
    const row = (data ?? null) as { local_part?: unknown; status?: unknown } | null;
    if (row && typeof row.local_part === "string" && row.local_part && row.status === "active") {
      own.push(`${row.local_part}@${PLATFORM_FROM_DOMAIN}`);
    }
  } catch (e) {
    console.warn("[tenant-sender] own managed identity read failed; only the resolved address is kept:", (e as Error)?.message);
  }
  return own;
}

function bareAddress(fromHeader: string): string {
  const raw = String(fromHeader ?? "").trim();
  return (/<\s*([^<>\s]+)\s*>\s*$/.exec(raw)?.[1] ?? raw).trim();
}

/** The From header and Reply-To to hand sendPlatformEmail for a business's sender. */
export function tenantAddressing(
  fromHeader: string,
  ownManaged: ReadonlyArray<string | null | undefined>,
  replyTo?: string | null,
): { from: string; replyTo: string | null } {
  const f = tenantFrom(fromHeader, ownManaged);
  const from = f.name ? `${f.name} <${f.email}>` : f.email;
  const explicit = String(replyTo ?? "").trim();
  if (explicit && ADDRESS.test(explicit)) return { from, replyTo: explicit };
  const original = bareAddress(fromHeader);
  const moved = f.email !== original.toLowerCase();
  return { from, replyTo: moved && ADDRESS.test(original) && !PAIGE_DOMAIN.test(original) ? original : null };
}
