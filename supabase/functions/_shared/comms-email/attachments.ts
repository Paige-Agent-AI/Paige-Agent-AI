// INT-328 comms.email_send — the files a governed email carries (one home, §18).
//
// The exact bytes the person approved are the bytes sent:
//   card     the door reads each composer upload with the service role, checks it (size, the bucket's
//            live type allowlist, the file's own signature, its extension) and fingerprints its sha256
//            into the approved call (the manifest);
//   confirm  the door reads and hashes them again — changed bytes are a different manifest, so the
//            approval is not redeemed — then copies the bytes it just hashed to the operation's
//            governed folder, which members can read but never write (20271120000000);
//   send     send-message reads the governed copies, re-hashes them against the binding and sends
//            exactly those bytes, or refuses (nothing sent) when any one is missing or changed.
//
// Free of Deno-only imports so vitest loads it directly. Storage is injected (the service client's
// `storage`), and nothing here logs, returns or stores a file's contents beyond what the caller sends.
import {
  COMMS_EMAIL_ATTACHMENTS_BUCKET, COMMS_EMAIL_ATTACHMENTS_MAX, COMMS_EMAIL_ATTACHMENTS_TOTAL_MAX_BYTES, COMMS_EMAIL_ATTACHMENT_MAX_BYTES,
  UUID, commsEmailAttachmentName, commsEmailGovernedAttachmentPath,
} from "./contract.ts";

/** One approved file. `path` is the governed copy; `source_path` the composer upload it was read from. */
export interface CommsEmailAttachmentEntry {
  path: string;
  source_path: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
}
export type CommsEmailAttachmentManifest = CommsEmailAttachmentEntry[];
/** A manifest entry with the bytes that were hashed into it (never stored, never returned outward). */
export interface CommsEmailAttachmentFile { entry: CommsEmailAttachmentEntry; bytes: Uint8Array }

/** The slice of the storage client these reads and writes use. */
export interface CommsEmailStorageBucket {
  download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
  upload(path: string, body: Uint8Array | Blob, options: { contentType: string; upsert: boolean }): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface CommsEmailStorage {
  from(bucket: string): CommsEmailStorageBucket;
  getBucket(id: string): PromiseLike<{ data: { allowed_mime_types?: string[] | null } | null; error: unknown }>;
}

/* ───────────────────────── what a file may be ───────────────────────── */

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
// Text that is really markup (a page, an image, an XML document) is not a plain-text or CSV file.
const MARKUP_START = /^(?:\uFEFF)?\s*<(?:!doctype|html|svg|\?xml)/i;
const utf8Text = (b: Uint8Array) => {
  if (b.includes(0)) return false;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b); } catch { return false; }
  return !MARKUP_START.test(text.slice(0, 1024));
};

/**
 * The entry names of a ZIP file's central directory (the index every Office reader uses), or null when
 * the end-of-central-directory record or any entry is not where the format says. Bounds-checked; reads
 * at most 65 535 entries. ZIP64 archives (> 4 GiB) are out of scope at a 10 MiB limit and refused.
 */
function zipEntryNames(b: Uint8Array): string[] | null {
  const u16 = (o: number) => b[o] | (b[o + 1] << 8);
  const u32 = (o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = u16(eocd + 10), size = u32(eocd + 12), offset = u32(eocd + 16);
  if (offset + size > eocd) return null;
  const names: string[] = [];
  let p = offset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || u32(p) !== 0x02014b50) return null;
    const nameLength = u16(p + 28), extra = u16(p + 30), comment = u16(p + 32);
    if (p + 46 + nameLength > eocd) return null;
    names.push(new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLength)));
    p += 46 + nameLength + extra + comment;
  }
  return names;
}
/** An Office Open XML package: a ZIP whose index lists [Content_Types].xml and the part folder. */
const ooxml = (folder: string) => (b: Uint8Array) => {
  if (!startsWith(b, ZIP)) return false;
  const names = zipEntryNames(b);
  return !!names && names.includes("[Content_Types].xml") && names.some((n) => n.startsWith(folder));
};
/**
 * A legacy Office (OLE compound) file whose directory names the document's own stream: `WordDocument`
 * for Word, `Workbook` or `Book` for Excel. Directory names are stored as UTF-16LE, so the name is looked
 * for as those bytes anywhere in the file. Best effort, stated honestly: it tells a Word or Excel file
 * from other compound files (an .msi installer's streams are named differently), but a crafted compound
 * file can still carry the name; the receiving program decides how to open it.
 */
const utf16 = (s: string) => [...s].flatMap((c) => [c.charCodeAt(0), 0]);
const holds = (b: Uint8Array, needle: number[]) => {
  outer: for (let i = 0; i + needle.length <= b.length; i++) {
    for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};
const ole = (...streams: string[]) => (b: Uint8Array) => startsWith(b, OLE) && streams.some((s) => holds(b, utf16(s)));

/**
 * The types a governed email may carry, each with the extensions its name may end in and the
 * signature its first bytes must show. The bucket's live allowlist is checked as well; a type the
 * bucket allows but this table does not know is refused (nothing is sent on a declared type alone).
 */
const TYPES: Record<string, { ext: string[]; sniff: (b: Uint8Array) => boolean }> = {
  "application/pdf": { ext: ["pdf"], sniff: (b) => startsWith(b, ascii("%PDF-")) },
  "image/png": { ext: ["png"], sniff: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  "image/jpeg": { ext: ["jpg", "jpeg"], sniff: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  "image/gif": { ext: ["gif"], sniff: (b) => startsWith(b, ascii("GIF87a")) || startsWith(b, ascii("GIF89a")) },
  "image/webp": { ext: ["webp"], sniff: (b) => startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8) },
  [DOCX]: { ext: ["docx"], sniff: ooxml("word/") },
  [XLSX]: { ext: ["xlsx"], sniff: ooxml("xl/") },
  "application/msword": { ext: ["doc"], sniff: ole("WordDocument") },
  "application/vnd.ms-excel": { ext: ["xls"], sniff: ole("Workbook", "Book") },
  "text/plain": { ext: ["txt"], sniff: utf8Text },
  "text/csv": { ext: ["csv"], sniff: utf8Text },
};
/** The canonical type names a manifest may hold (prepare's 15-argument overload checks the same list). */
export const COMMS_EMAIL_ATTACHMENT_TYPES: readonly string[] = Object.freeze(Object.keys(TYPES));

/** `image/jpg` is the bucket's alias for JPEG; a parameter (`; charset=…`) is not part of the type. */
export function canonicalCommsEmailAttachmentMime(value: unknown): string {
  const mime = typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

/** Whether these bytes, named so, really are the type they claim. Pure. */
export function commsEmailAttachmentMatches(bytes: Uint8Array, mime: string, name: string): boolean {
  const t = TYPES[mime];
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return !!t && t.ext.includes(ext) && t.sniff(bytes);
}

export async function commsEmailSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function commsEmailBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}

/* ───────────────────────── the manifest, strictly ───────────────────────── */

const ENTRY_KEYS = ["path", "source_path", "name", "mime", "size", "sha256"];

/**
 * A stored manifest (the approved call's, or the binding's), re-parsed field for field: exactly the six
 * keys, the governed path of THIS tenant and operation numbered in order, the composer source path of the
 * same tenant, a known type, sizes inside the limits. Returned in canonical key order so two manifests
 * compare as text. null = not a manifest this operation can carry.
 */
export function parseCommsEmailAttachmentManifest(value: unknown, tenantId: string, operationId: string): CommsEmailAttachmentManifest | null {
  if (typeof tenantId !== "string" || !UUID.test(tenantId) || typeof operationId !== "string" || !UUID.test(operationId)) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > COMMS_EMAIL_ATTACHMENTS_MAX) return null;
  const tenant = tenantId.toLowerCase();
  const source = new RegExp(`^${tenant}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$`);
  const out: CommsEmailAttachmentManifest = [];
  let total = 0;
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const e = raw as Record<string, unknown>;
    const keys = Object.keys(e);
    if (keys.length !== ENTRY_KEYS.length || !ENTRY_KEYS.every((k) => keys.includes(k))) return null;
    if (typeof e.source_path !== "string" || !source.test(e.source_path) || e.source_path.includes("..")) return null;
    let name: string;
    try { name = commsEmailAttachmentName(e.source_path); } catch { return null; }
    if (e.name !== name || e.path !== commsEmailGovernedAttachmentPath(tenant, operationId, index, name)) return null;
    if (typeof e.mime !== "string" || !TYPES[e.mime]) return null;
    if (typeof e.size !== "number" || !Number.isInteger(e.size) || e.size < 1 || e.size > COMMS_EMAIL_ATTACHMENT_MAX_BYTES) return null;
    if (typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256)) return null;
    total += e.size;
    out.push({ path: e.path as string, source_path: e.source_path, name, mime: e.mime, size: e.size, sha256: e.sha256 });
  }
  if (total > COMMS_EMAIL_ATTACHMENTS_TOTAL_MAX_BYTES) return null;
  if (new Set(out.map((e) => e.path)).size !== out.length) return null;
  return out;
}

/** The manifest's canonical text: every field of every file, in order (key order cannot change it). */
const manifestText = (m: CommsEmailAttachmentManifest) => JSON.stringify(m.map((e) => ENTRY_KEYS.map((k) => e[k as keyof CommsEmailAttachmentEntry])));

/**
 * sha256 of the manifest's canonical text. It rides in the approved call beside the manifest so the
 * confirm redeems ONLY the proposal holding exactly these files with one short, exact filter (a jsonb
 * containment filter on the whole manifest would put kilobytes in the request URL, and is a superset match).
 */
export async function commsEmailManifestDigest(m: CommsEmailAttachmentManifest): Promise<string> {
  return await commsEmailSha256Hex(new TextEncoder().encode(manifestText(m)));
}

/** Two manifests are the same approval only when every field of every file, in order, is equal. */
export function commsEmailManifestsEqual(a: CommsEmailAttachmentManifest | null | undefined, b: CommsEmailAttachmentManifest | null | undefined): boolean {
  const text = (m: CommsEmailAttachmentManifest | null | undefined) => m && m.length ? manifestText(m) : "";
  return text(a) === text(b);
}

/** What the card shows of each file: its name, size and type — never its path or contents. */
export function commsEmailAttachmentPreview(m: CommsEmailAttachmentManifest): { name: string; size: number; mime: string }[] {
  return m.map((e) => ({ name: e.name, size: e.size, mime: e.mime }));
}

/** The words the card's summary sentence adds for the files. */
export function commsEmailAttachmentSummary(m: CommsEmailAttachmentManifest): string {
  return ` — with ${m.length === 1 ? "1 file" : `${m.length} files`}: ${m.map((e) => e.name).join(", ")}`;
}

/* ───────────────────────── reading, copying and re-checking the bytes ───────────────────────── */

export type CommsEmailAttachmentRefusal =
  | "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" | "COMMS_EMAIL_ATTACHMENT_EMPTY" | "COMMS_EMAIL_ATTACHMENT_TOO_LARGE"
  | "COMMS_EMAIL_ATTACHMENTS_TOO_LARGE" | "COMMS_EMAIL_ATTACHMENT_TYPE_REFUSED" | "COMMS_EMAIL_ATTACHMENT_CHANGED";
type Read<T> = { ok: true } & T | { ok: false; code: CommsEmailAttachmentRefusal };

const bytesOf = async (blob: Blob | null): Promise<Uint8Array | null> => {
  if (!blob || typeof (blob as Blob).arrayBuffer !== "function") return null;
  return new Uint8Array(await blob.arrayBuffer());
};

/**
 * Read the composer uploads a person named (paths already parsed against the server tenant) and build
 * the manifest. The bucket's live type allowlist is read first; every file is checked for size, type,
 * signature and extension. A read failure is UNAVAILABLE; nothing is retried or guessed.
 */
export async function readCommsEmailAttachmentSources(
  storage: CommsEmailStorage,
  input: { tenantId: string; operationId: string; paths: string[] },
): Promise<Read<{ manifest: CommsEmailAttachmentManifest; files: CommsEmailAttachmentFile[] }>> {
  const { data: bucket, error: bucketError } = await storage.getBucket(COMMS_EMAIL_ATTACHMENTS_BUCKET);
  if (bucketError || !bucket) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" };
  // A bucket with no allowlist (null) restricts nothing; the type table below still does.
  const allowed = Array.isArray(bucket.allowed_mime_types) ? new Set(bucket.allowed_mime_types.map(canonicalCommsEmailAttachmentMime)) : null;
  const files: CommsEmailAttachmentFile[] = [];
  let total = 0;
  for (const [index, sourcePath] of input.paths.entries()) {
    const name = commsEmailAttachmentName(sourcePath);
    let blob: Blob | null = null;
    try {
      const { data, error } = await storage.from(COMMS_EMAIL_ATTACHMENTS_BUCKET).download(sourcePath);
      if (error) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" };
      blob = data;
    } catch { return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" }; }
    const bytes = await bytesOf(blob);
    if (!bytes) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" };
    if (bytes.length < 1) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_EMPTY" };
    if (bytes.length > COMMS_EMAIL_ATTACHMENT_MAX_BYTES) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_TOO_LARGE" };
    total += bytes.length;
    if (total > COMMS_EMAIL_ATTACHMENTS_TOTAL_MAX_BYTES) return { ok: false, code: "COMMS_EMAIL_ATTACHMENTS_TOO_LARGE" };
    const mime = canonicalCommsEmailAttachmentMime(blob?.type);
    if ((allowed && !allowed.has(mime)) || !commsEmailAttachmentMatches(bytes, mime, name)) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_TYPE_REFUSED" };
    files.push({ bytes, entry: {
      path: commsEmailGovernedAttachmentPath(input.tenantId, input.operationId, index, name), source_path: sourcePath,
      name, mime, size: bytes.length, sha256: await commsEmailSha256Hex(bytes),
    } });
  }
  return { ok: true, manifest: files.map((f) => f.entry), files };
}

/**
 * Copy-on-approve: keep the bytes that were just hashed at the operation's governed paths. Never
 * overwrites (`upsert:false`). When a copy is already there (a replay of this confirm), it is read back
 * and must hash to the approved value, or the copy is CHANGED and nothing is prepared.
 */
export async function copyCommsEmailAttachmentsToGoverned(storage: CommsEmailStorage, files: CommsEmailAttachmentFile[]): Promise<Read<Record<never, never>>> {
  const bucket = storage.from(COMMS_EMAIL_ATTACHMENTS_BUCKET);
  for (const { entry, bytes } of files) {
    if (bytes.length !== entry.size || await commsEmailSha256Hex(bytes) !== entry.sha256) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_CHANGED" };
    let uploadError: unknown = null;
    try { uploadError = (await bucket.upload(entry.path, bytes, { contentType: entry.mime, upsert: false })).error; }
    catch (error) { uploadError = error ?? "upload_failed"; }
    if (!uploadError) continue;
    // Already there (or the answer was lost): the copy counts only if it is exactly these bytes.
    let existing: Uint8Array | null = null;
    try { const { data, error } = await bucket.download(entry.path); existing = error ? null : await bytesOf(data); } catch { existing = null; }
    if (!existing) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_UNAVAILABLE" };
    if (existing.length !== entry.size || await commsEmailSha256Hex(existing) !== entry.sha256) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_CHANGED" };
  }
  return { ok: true };
}

/** A file exactly as the email provider receives it (send-message's SendGrid arm). */
export interface GovernedFileAttachment { content: string; filename: string; type: string }

/**
 * Read every governed copy a manifest names, IN PARALLEL (the manifest is already bounded: at most ten
 * files and 10 MiB together, checked here again and by the database), and prove each is the approved
 * bytes (size and sha256). Any copy missing, unreadable or different is CHANGED — nothing is sent.
 */
export async function readGovernedCommsEmailAttachmentFiles(storage: CommsEmailStorage, manifest: CommsEmailAttachmentManifest): Promise<Read<{ files: CommsEmailAttachmentFile[] }>> {
  if (!manifest.length || manifest.length > COMMS_EMAIL_ATTACHMENTS_MAX
    || manifest.reduce((n, e) => n + e.size, 0) > COMMS_EMAIL_ATTACHMENTS_TOTAL_MAX_BYTES) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_CHANGED" };
  const bucket = storage.from(COMMS_EMAIL_ATTACHMENTS_BUCKET);
  const read = await Promise.all(manifest.map(async (entry) => {
    let bytes: Uint8Array | null = null;
    try { const { data, error } = await bucket.download(entry.path); bytes = error ? null : await bytesOf(data); } catch { bytes = null; }
    return bytes && bytes.length === entry.size && await commsEmailSha256Hex(bytes) === entry.sha256 ? { entry, bytes } : null;
  }));
  if (read.some((f) => f === null)) return { ok: false, code: "COMMS_EMAIL_ATTACHMENT_CHANGED" };
  return { ok: true, files: read as CommsEmailAttachmentFile[] };
}

/** At send: the verified governed copies, base64-encoded exactly as SendGrid receives them. */
export async function readGovernedCommsEmailAttachments(storage: CommsEmailStorage, manifest: CommsEmailAttachmentManifest): Promise<Read<{ files: GovernedFileAttachment[] }>> {
  const read = await readGovernedCommsEmailAttachmentFiles(storage, manifest);
  if (!read.ok) return read;
  return { ok: true, files: read.files.map(({ entry, bytes }) => ({ content: commsEmailBase64(bytes), filename: entry.name, type: entry.mime })) };
}
