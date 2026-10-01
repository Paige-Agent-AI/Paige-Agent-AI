// client_ref — the one home for turning the reference Paige is shown into a contact.
//
// Paige never handles a contact's raw id: every read gives her `client_ref`, the contact's
// immutable, workspace-scoped account number (`CLT-…`). Every write that names a contact resolves
// that reference here, INSIDE the caller's own workspace, so a reference from another workspace is
// simply not found. Pure: the database client is injected.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (...args: any[]) => any };

/** The stored form of a client_ref: trimmed and upper-cased, as account numbers are written. */
export function normalizeClientRef(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const normalized = ref.trim().toUpperCase();
  return normalized ? normalized : null;
}

/**
 * The contact id a client_ref names inside one workspace, or null when it names none there.
 * A lookup failure is logged and reads as not found, never as a match.
 */
export async function resolveClientRef(
  admin: Client,
  tenantId: string | null | undefined,
  ref: unknown,
  caller: string,
): Promise<string | null> {
  const normalized = normalizeClientRef(ref);
  if (!tenantId || !normalized) return null;
  const { data, error } = await admin.from("clients").select("id")
    .eq("tenant_id", tenantId).eq("account_number", normalized).maybeSingle();
  if (error) {
    console.error(`[${caller}] client_ref_lookup_failed`, { code: error.code, message: error.message });
    return null;
  }
  return typeof data?.id === "string" ? data.id : null;
}
