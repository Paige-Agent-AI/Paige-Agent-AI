/**
 * Original-library media resolution for the existing publication door.
 * This is a read/validation helper, not a writer, upload transport or authority grant.
 * Callers must supply their JWT-scoped library reader after resolving current authority.
 * The same snapshot must be re-resolved at effect time and bound to the original approval.
 *
 * sourceUrl is PAIGE's original storage source, NEVER a Zernio mediaItems URL:
 * the provider adapter must transfer approved bytes through its own documented upload
 * operation rather than disclose the tenant-prefixed storage path to the provider.
 */
import { safeFetchBytes } from "../ssrfGuard.ts";

export interface SavedPublicationAsset {
  id: string;
  tenant_id: string;
  kind: string;
  status: string;
  updated_at: string;
  image_path: string | null;
  image_url: string | null;
  meta?: Record<string, unknown> | null;
}
export interface PublicationStorageFacts {
  contentType: string;
  size: number;
  etag: string;
  lastModified: string;
}
export interface PublicationMediaReader {
  /** The caller's protected original marketing_content projection, not a service-role lookup. */
  readAssets(ids: readonly string[]): Promise<{ rows: readonly SavedPublicationAsset[] | null; error: boolean }>;
  /** Existing Storage metadata reader; called only after the library row and own prefix verify. */
  readObject(path: string): Promise<PublicationStorageFacts | null>;
}
export interface ResolvedPublicationAsset {
  readonly contentId: string;
  readonly contentRevision: string;
  readonly type: "image" | "video";
  readonly storagePath: string;
  readonly sourceUrl: string;
  readonly contentType: string;
  readonly size: number;
  readonly etag: string;
  readonly lastModified: string;
  readonly altText: string | null;
}
export type PublicationMediaResolution =
  | { status: "ready"; assets: readonly ResolvedPublicationAsset[]; snapshot: string }
  | { status: "refused"; code: "MEDIA_REFERENCES_INVALID" | "MEDIA_SOURCE_UNVERIFIED" | "MEDIA_NOT_AVAILABLE" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AVAILABLE = new Set(["draft", "published", "ready"]);
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
// The original media completion lane already bounds a copied artifact to 25 MiB.
// This resolver does not authorize a platform format; that remains the adapter's gate.
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const refusal = (code: Extract<PublicationMediaResolution, { status: "refused" }>["code"]): PublicationMediaResolution => ({ status: "refused", code });
const validStamp = (value: unknown): value is string => typeof value === "string"
  && value.length <= 80 && Number.isFinite(Date.parse(value));

function storageSource(origin: string, tenantId: string, path: unknown, recordedUrl: unknown): string | null {
  if (typeof path !== "string" || path.length > 600 || !path.startsWith(`${tenantId}/`)
    || path.split("/").some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(segment)
      || segment === "." || segment === "..") || typeof recordedUrl !== "string" || recordedUrl.length > 2048) return null;
  const expected = `${origin}/storage/v1/object/public/paige-generated/${path.split("/").map(encodeURIComponent).join("/")}`;
  try {
    const recorded = new URL(recordedUrl);
    return !recorded.username && !recorded.password && !recorded.search && !recorded.hash
      && recorded.href === expected ? expected : null;
  } catch { return null; }
}

export async function resolveSavedPublicationMedia(input: {
  tenantId: string;
  mediaContentIds: unknown;
  storageOrigin: string;
  reader: PublicationMediaReader;
}): Promise<PublicationMediaResolution> {
  const { tenantId, mediaContentIds: ids, reader } = input;
  if (!UUID.test(tenantId) || !Array.isArray(ids) || ids.length > 20
    || ids.some(id => typeof id !== "string" || !UUID.test(id))
    || new Set(ids.map(id => String(id).toLowerCase())).size !== ids.length) return refusal("MEDIA_REFERENCES_INVALID");
  // Existing text-only publication has no storage dependency.
  if (ids.length === 0) return { status: "ready", assets: [], snapshot: "[]" };
  let origin: string;
  try {
    const configured = new URL(input.storageOrigin);
    if (configured.protocol !== "https:" || configured.username || configured.password || configured.search
      || configured.hash || configured.pathname !== "/") return refusal("MEDIA_SOURCE_UNVERIFIED");
    origin = configured.origin;
  } catch { return refusal("MEDIA_SOURCE_UNVERIFIED"); }

  try {
    const read = await reader.readAssets(ids);
    if (read.error || !Array.isArray(read.rows) || read.rows.length !== ids.length) return refusal("MEDIA_NOT_AVAILABLE");
    const byId = new Map(read.rows.map(row => [row.id, row]));
    if (byId.size !== ids.length) return refusal("MEDIA_NOT_AVAILABLE");
    const sources: Array<{ row: SavedPublicationAsset; url: string }> = [];
    // Validate the WHOLE requested set before any privileged object lookup.
    for (const id of ids) {
      const row = byId.get(id);
      if (!row || row.tenant_id !== tenantId || !AVAILABLE.has(row.status)
        || !["image", "video"].includes(row.kind) || !validStamp(row.updated_at)) return refusal("MEDIA_NOT_AVAILABLE");
      const url = storageSource(origin, tenantId, row.image_path, row.image_url);
      if (!url) return refusal("MEDIA_SOURCE_UNVERIFIED");
      sources.push({ row, url });
    }
    const assets: ResolvedPublicationAsset[] = [];
    for (const { row, url } of sources) {
      const facts = await reader.readObject(row.image_path as string);
      if (!facts || !Number.isSafeInteger(facts.size) || facts.size <= 0 || facts.size > MAX_ASSET_BYTES
        || typeof facts.etag !== "string" || !/^[\x21-\x7e]{1,200}$/.test(facts.etag)
        || !validStamp(facts.lastModified)) return refusal("MEDIA_SOURCE_UNVERIFIED");
      const mime = typeof facts.contentType === "string" ? facts.contentType.toLowerCase().trim() : "";
      if (row.kind === "image" ? !IMAGE_MIME.has(mime) : mime !== "video/mp4") return refusal("MEDIA_NOT_AVAILABLE");
      const altText = typeof row.meta?.alt_text === "string" ? row.meta.alt_text.trim().slice(0, 1000) || null : null;
      assets.push(Object.freeze({ contentId: row.id, contentRevision: row.updated_at,
        type: row.kind as "image" | "video", storagePath: row.image_path as string, sourceUrl: url,
        contentType: mime, size: facts.size, etag: facts.etag,
        lastModified: new Date(facts.lastModified).toISOString(), altText }));
    }
    // A scalar snapshot fits the original door's stored-args equality/CAS contract.
    // Array order is significant. No provider identifiers, credentials or mutable row meta.
    const snapshot = JSON.stringify(assets.map(asset => ({ content_id: asset.contentId,
      content_revision: asset.contentRevision, type: asset.type, storage_path: asset.storagePath,
      source_url: asset.sourceUrl, mime_type: asset.contentType, size: asset.size,
      etag: asset.etag, last_modified: asset.lastModified, alt_text: asset.altText })));
    return { status: "ready", assets: Object.freeze(assets), snapshot };
  } catch {
    return refusal("MEDIA_SOURCE_UNVERIFIED");
  }
}

function strongEtag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  return /^[A-Za-z0-9._:-]{1,160}$/.test(tag) ? `"${tag}"` : null;
}

/** A signature check, not a full decoder or a claim that a platform accepts the media. */
function matchesMediaSignature(bytes: Uint8Array, mime: string): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (mime === "image/png") return bytes.length >= 16
    && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) && ascii(12, 16) === "IHDR";
  if (mime === "image/jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") return bytes.length >= 16 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  return mime === "video/mp4" && bytes.length >= 16 && ascii(4, 8) === "ftyp";
}

/**
 * Read the approved original object immediately before its transfer by the existing
 * Social adapter. The provider receives bytes, never this URL or tenant path.
 * Conditional identity, DNS, no redirects, deadline and streaming cap all apply.
 * No credentials or upstream error details escape this read-only helper.
 */
export async function readResolvedPublicationAsset(input: {
  tenantId: string;
  storageOrigin: string;
  asset: ResolvedPublicationAsset;
}): Promise<Uint8Array | null> {
  const { tenantId, asset } = input;
  let source: string | null;
  try {
    const origin = new URL(input.storageOrigin);
    if (!UUID.test(tenantId) || origin.protocol !== "https:" || origin.pathname !== "/"
      || origin.username || origin.password || origin.search || origin.hash) return null;
    source = storageSource(origin.origin, tenantId, asset.storagePath, asset.sourceUrl);
  } catch { return null; }
  const etag = strongEtag(asset.etag);
  if (!source || !etag || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ASSET_BYTES
    || !validStamp(asset.lastModified) || !(asset.type === "image" ? IMAGE_MIME.has(asset.contentType)
      : asset.type === "video" && asset.contentType === "video/mp4")) return null;

  try {
    const response = await safeFetchBytes(source, {
      method: "GET", headers: { "If-Match": etag },
    }, { timeoutMs: 15_000, maxBytes: asset.size });
    if (response.status !== 200 || response.truncated
      || strongEtag(response.headers.get("ETag")) !== etag
      || response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== asset.contentType
      || response.headers.get("Content-Length") !== String(asset.size)
      || Math.floor(Date.parse(response.headers.get("Last-Modified") ?? "") / 1000)
        !== Math.floor(Date.parse(asset.lastModified) / 1000)) return null;
    const bytes = response.body;
    if (bytes.byteLength !== asset.size) return null;
    return matchesMediaSignature(bytes, asset.contentType) ? bytes : null;
  } catch { return null; }
}
