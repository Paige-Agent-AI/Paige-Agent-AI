import type { PortalAssistant } from "@/hooks/useClientPortalConfig";
import { customerAgentName } from "../../../supabase/functions/_shared/client-portal-identity";

export const ASSISTANT_TEXT_LIMITS = { display_name: 80, tone: 180, service_scope: 1600, human_handoff: 600 } as const;
export type AssistantFields = { enabled: boolean; display_name: string; tone: string; service_scope: string; human_handoff: string };
export function assistantFields(saved?: PortalAssistant): AssistantFields {
  return { enabled: saved?.enabled !== false, display_name: customerAgentName(saved?.display_name), tone: saved?.tone ?? "", service_scope: saved?.service_scope ?? "", human_handoff: saved?.human_handoff ?? "" };
}
/** Preserve the owner's field-level intent; never replay an untouched, stale enabled value. */
export function assistantPatch(before: AssistantFields, after: AssistantFields): Partial<AssistantFields> | undefined {
  const patch: Partial<AssistantFields> = {};
  if (before.enabled !== after.enabled) patch.enabled = after.enabled;
  for (const key of Object.keys(ASSISTANT_TEXT_LIMITS) as (keyof typeof ASSISTANT_TEXT_LIMITS)[]) {
    if (before[key].trim() !== after[key].trim()) patch[key] = after[key].trim().slice(0, ASSISTANT_TEXT_LIMITS[key]);
  }
  return Object.keys(patch).length ? patch : undefined;
}

/**
 * Why the name a client reads differs from the one the owner typed or saved, or null when it doesn't. A name
 * that carries PAIGE is refused (customerAgentName): PAIGE is the owner's own assistant, never a client's.
 */
export function agentNameNotice(typed: string, saved?: string | null): string | null {
  const t = typed.trim();
  if (t && customerAgentName(t) !== t) return `Clients will see “Cura”. A name that includes Paige stays with your own assistant, so the portal uses Cura instead.`;
  const s = typeof saved === "string" ? saved.trim() : "";
  if (s && customerAgentName(s) !== s && t === customerAgentName(s)) return `Your saved name “${s.slice(0, 80)}” includes Paige, so clients see “Cura”. Paige is your own assistant; your clients’ agent has its own name.`;
  return null;
}
