/** Navigation format only; native readers independently enforce access. */
export const STUDIO_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ChatStudioReference = { sourceTurnId: string; tenantId: string };
/** A closed native-source pointer, never a ready project, URL or receipt. */
export function parseChatStudioReference(value: unknown): ChatStudioReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["artifactType", "kind", "id", "title", "tenant_id", "url"].includes(key))
    || row.artifactType !== "studio" || row.kind !== "studio_source" || row.title !== "Studio brief"
    || typeof row.id !== "string" || !STUDIO_SESSION_ID.test(row.id)
    || typeof row.tenant_id !== "string" || !STUDIO_SESSION_ID.test(row.tenant_id)
    || (row.url !== undefined && row.url !== null)) return null;
  return { sourceTurnId: row.id, tenantId: row.tenant_id };
}
