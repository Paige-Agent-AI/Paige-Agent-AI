/** Canonical strict SOLO-shell predicate, shared by UI mount and server readers.
 * This pure predicate does not validate a database response or grant authority.
 * Server consumers must first prove the exact row and explicit classification fields.
 */
export function isSoloStandalone(c: { account_type: string | null; parent_tenant_id: string | null }): boolean {
  return !c.parent_tenant_id && c.account_type === "standalone";
}
