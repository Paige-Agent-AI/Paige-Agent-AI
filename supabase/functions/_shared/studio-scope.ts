// The Vibe Studio capability boundary (V1, owner-ruled 2026-10-03) — one pure home for the rule.
//
// A Studio turn runs through the same paige-ai-chat loop as main PAIGE, so without this it was
// offered every PAIGE tool (CRM, deals, team, calendar, GHL/Zapier/n8n execution, comms, sub-agents)
// and only the prompt kept it on design work. A prompt is not an authority boundary.
//
// The scope is DATA on the canonical role record: `paige_subagents.config.capability_scope` on the
// platform `design-studio` row (tenant_id IS NULL; slug is unique table-wide and tenants cannot
// write NULL-tenant rows, so a tenant can neither edit it nor stand up a competing identity).
// paige-ai-chat reads it server-side and enforces it twice: the tool list is filtered BEFORE the
// model sees it, and dispatch refuses anything outside it with `outside_studio_scope`.
//
// The scope can only NARROW. It filters the tool list a turn would already have; a name in the
// scope that the turn does not carry is never added. Every tool that survives still passes the
// same Spine, risk, Trust Compass and tenant-permission gates as anywhere else.
//
// FAIL CLOSED: a missing or malformed scope leaves the design agent able to ask the owner a
// question and read its own status — nothing that writes — and the caller logs why.

/** What a Studio turn keeps when the stored scope is missing or malformed: no writes. */
export const STUDIO_SCOPE_FAIL_CLOSED: readonly string[] = ["ask_choices", "capability_status"];

export interface RoleToolScope {
  /** Tool names this role may be offered and may dispatch. */
  allowed: ReadonlySet<string>;
  /** False when the stored scope could not be read as a valid allowlist (the fail-closed set applies). */
  valid: boolean;
  /** Why the scope was not valid, for the log line. */
  reason?: string;
}

const TOOL_NAME = /^[a-z][a-z0-9_]{1,63}$/;

/** Read `config.capability_scope` as an allowlist. Anything else fails closed. */
export function resolveRoleToolScope(config: unknown): RoleToolScope {
  const failClosed = (reason: string): RoleToolScope => ({ allowed: new Set(STUDIO_SCOPE_FAIL_CLOSED), valid: false, reason });
  if (!config || typeof config !== "object") return failClosed("no role config");
  const scope = (config as { capability_scope?: unknown }).capability_scope;
  if (!scope || typeof scope !== "object") return failClosed("no capability_scope");
  const { mode, tools } = scope as { mode?: unknown; tools?: unknown };
  if (mode !== "allowlist") return failClosed(`unsupported scope mode ${JSON.stringify(mode)}`);
  if (!Array.isArray(tools) || tools.length === 0) return failClosed("empty tool allowlist");
  if (!tools.every((t) => typeof t === "string" && TOOL_NAME.test(t))) return failClosed("malformed tool name in allowlist");
  return { allowed: new Set(tools as string[]), valid: true };
}

/**
 * Remove, in place, every tool definition whose name is outside `allowed`. Returns the removed
 * names. It never adds a definition, so the scope can only narrow what the turn already carried.
 */
export function narrowToolDefs(defs: unknown[], allowed: ReadonlySet<string>): string[] {
  const removed: string[] = [];
  for (let i = defs.length - 1; i >= 0; i--) {
    const name = (defs[i] as { function?: { name?: unknown } } | null)?.function?.name;
    if (typeof name !== "string" || !allowed.has(name)) {
      removed.push(String(name));
      defs.splice(i, 1);
    }
  }
  return removed.reverse();
}

/** The tool result a Studio turn gets when the model calls something outside its scope. */
export function outsideStudioScope(toolName: string): { success: false; error: "outside_studio_scope"; message: string } {
  return {
    success: false,
    error: "outside_studio_scope",
    message: `"${toolName}" isn't something the design studio can do — it builds pages, funnels, forms, images and content. Nothing was changed. Tell the owner this belongs in their main PAIGE chat.`,
  };
}
