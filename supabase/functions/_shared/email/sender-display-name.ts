/**
 * The From name on a business's email to its own client (send-message). The client hears from the business,
 * never from the platform's COO: the configured sender name (connector or tenant identity) first, else the
 * business's own name, else the platform's CONFIGURED default (data, not a literal), else no name at all —
 * the address alone. Round 2 (compliance #2): the old literal fallback was "Paige Agent".
 */
export function senderDisplayName(input: {
  fromName?: string | null;
  tenantName?: string | null;
  platformDefault?: string | null;
}): string | null {
  for (const v of [input.fromName, input.tenantName, input.platformDefault]) {
    const t = typeof v === "string" ? v.trim() : "";
    if (t) return t.slice(0, 120);
  }
  return null;
}
