/** Reference only. Status, URL, media and authority must be re-read from their original source. */
export type SocialPublicationReference = { schema: 1; tenant_id: string; content_id: string; content_revision: string; publication_id: string | null };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const KEYS = new Set(["schema","tenant_id","content_id","content_revision","publication_id"]);
export function readSocialPublicationReference(value: unknown): SocialPublicationReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r=value as Record<string,unknown>;
  if (Object.keys(r).some(k=>!KEYS.has(k)) || r.schema!==1 || typeof r.tenant_id!=="string" || !UUID.test(r.tenant_id)
    || typeof r.content_id!=="string" || !UUID.test(r.content_id) || typeof r.content_revision!=="string" || r.content_revision.length>80
    || !Number.isFinite(Date.parse(r.content_revision)) || (r.publication_id!==null && (typeof r.publication_id!=="string" || !UUID.test(r.publication_id)))) return null;
  return {schema:1,tenant_id:r.tenant_id,content_id:r.content_id,content_revision:r.content_revision,publication_id:r.publication_id as string|null};
}
