import type { PortalAssistant } from "@/hooks/useClientPortalConfig";
import { agentNameAsTyped, customerAgentName } from "../../../supabase/functions/_shared/client-portal-identity";

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
 * that reads like PAIGE is refused (customerAgentName): PAIGE is the owner's own assistant, never a client's.
 * The comparison is against the name as a client would read it (agentNameAsTyped: invisible characters removed,
 * trimmed, 80 characters), so an invisible character or the length alone never raises this notice. "Reads like"
 * rather than "includes": the rule also refuses spaced, accented and look-alike spellings that do not literally
 * contain the word.
 */
export function agentNameNotice(typed: string, saved?: string | null): string | null {
  const t = agentNameAsTyped(typed);
  if (t && customerAgentName(t) !== t) return `Clients will see “Cura”. A name that reads like Paige stays with your own assistant, so the portal uses Cura instead.`;
  const s = agentNameAsTyped(saved);
  if (s && customerAgentName(s) !== s && t === customerAgentName(s)) return `Your saved name “${s}” reads like Paige, so clients see “Cura”. Paige is your own assistant; your clients’ agent has its own name.`;
  return null;
}
