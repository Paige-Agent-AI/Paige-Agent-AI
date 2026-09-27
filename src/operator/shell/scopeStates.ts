/**
 * The band's scope states — the shape of the pack's `P.SCOPES`
 * (`docs/design-references/cd-packs/super-admin-shell-v3/paige-ia.js` L2704-L2708): rest, read, act.
 *
 * They live beside the band rather than inside it so the component file exports a component and
 * nothing else, and so the scope wiring changes a VALUE here rather than the band's shape.
 *
 * WHAT THE COPY MAY SAY. The pack printed a database column (`tenant_id IS NULL`) and an audit
 * table name (`paige_audit_log · session open`) as the band's third line. Those are backend names
 * in visible copy, which §11 rules out, so the third line says the same thing in the operator's
 * own words. There is no "read" state: no read-only way into a tenant exists, and inventing one
 * would tell the operator they are somewhere they are not (§9/§13).
 */
export type ScopeTone = "none" | "read" | "act";

export type ScopeState = {
  readonly tone: ScopeTone;
  readonly kicker: string;
  readonly scope: string;
  readonly audit: string;
};

/** Scope 0 — the operator's own ground: no tenant is entered. */
export const PLATFORM_SCOPE: ScopeState = {
  tone: "none",
  kicker: "Platform scope",
  scope: "No tenant · operator surface",
  audit: "Not acting as a tenant",
};

/**
 * Scope 2 — an audited act-as is open. `tenantName` is null when the session holds a tenant it
 * cannot name (not in its readable list); the band still says it is acting, never "No tenant".
 */
export function actingScope(tenantName: string | null): ScopeState {
  return {
    tone: "act",
    kicker: "Acting as",
    scope: tenantName ?? "a tenant this session cannot name",
    audit: "Entry and exit are recorded",
  };
}
