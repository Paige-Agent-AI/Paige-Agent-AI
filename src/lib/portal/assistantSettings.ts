import type { PortalAssistant } from "@/hooks/useClientPortalConfig";

export const ASSISTANT_TEXT_LIMITS = { display_name: 80, tone: 180, service_scope: 1600, human_handoff: 600 } as const;
export type AssistantFields = { enabled: boolean; display_name: string; tone: string; service_scope: string; human_handoff: string };
export function assistantFields(saved?: PortalAssistant): AssistantFields {
  return { enabled: saved?.enabled !== false, display_name: saved?.display_name ?? "", tone: saved?.tone ?? "", service_scope: saved?.service_scope ?? "", human_handoff: saved?.human_handoff ?? "" };
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
