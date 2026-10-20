export const CLIENT_DOCUMENT_LIMIT = 20 * 1024 * 1024;
export const CLIENT_DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.docx";
const mimeByExtension: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export type DocumentScope = { actor: string; contact: string; tenant: string };
export interface ClientDocument {
  id: string; tenant_id: string; contact_id: string; uploaded_by_user_id: string;
  storage_path: string; original_filename: string; mime_type: string | null; size_bytes: number | null;
  visibility: "shared" | "client_upload"; upload_state: "pending" | "ready";
  created_at: string; updated_at: string;
}
export const CLIENT_DOCUMENT_COLUMNS = "id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state,created_at,updated_at";
const fields = CLIENT_DOCUMENT_COLUMNS.split(",");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalidFilename = (value: string) => /[/\\]/.test(value) || Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
export function sameDocumentScope(a: DocumentScope | null, b: DocumentScope) {
  return a?.actor === b.actor && a.contact === b.contact && a.tenant === b.tenant;
}
export function clientDocumentMime(file: Pick<File, "name" | "size" | "type">): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = mimeByExtension[ext];
  if (!mime || !file.name.includes(".") || invalidFilename(file.name)
    || file.name !== file.name.trim() || file.name.length > 255 || !Number.isSafeInteger(file.size)
    || file.size < 1 || file.size > CLIENT_DOCUMENT_LIMIT || (file.type && file.type !== mime)) {
    throw new Error("Choose a PDF, JPG, PNG or DOCX file up to 20 MB.");
  }
  return mime;
}
/** A closed file projection, scoped by native relationship and file RLS. */
export function readClientDocument(value: unknown, scope: DocumentScope): ClientDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid file result");
  const f = value as Record<string, unknown>;
  if (Object.keys(f).length !== fields.length || Object.keys(f).some(k => !fields.includes(k))
    || typeof f.id !== "string" || !uuid.test(f.id) || f.tenant_id !== scope.tenant || f.contact_id !== scope.contact
    || typeof f.uploaded_by_user_id !== "string" || !uuid.test(f.uploaded_by_user_id)
    || typeof f.storage_path !== "string" || f.storage_path.split("/")[0] !== scope.tenant
    || /(^|\/)\.\.?($|\/)/.test(f.storage_path) || f.storage_path.includes("\\")
    || typeof f.original_filename !== "string" || !f.original_filename || f.original_filename.length > 255
    || invalidFilename(f.original_filename)
    || (f.mime_type !== null && typeof f.mime_type !== "string")
    || (f.size_bytes !== null && (typeof f.size_bytes !== "number" || !Number.isSafeInteger(f.size_bytes) || f.size_bytes < 0))
    || !["shared", "client_upload"].includes(String(f.visibility))
    || !["pending", "ready"].includes(String(f.upload_state)) || !date(f.created_at) || !date(f.updated_at)) {
    throw new Error("Invalid file scope");
  }
  if (f.upload_state === "pending" && (f.visibility !== "client_upload"
    || f.storage_path !== `${scope.tenant}/${scope.contact}/client_upload/${f.uploaded_by_user_id}/${f.id}`)) {
    throw new Error("Invalid upload reservation");
  }
  return f as unknown as ClientDocument;
}

/**
 * E09 Slice 4 — one row of the customer's Documents library, from client_portal_documents().
 * The server decides what is in it: files the business shared (ready only) and the customer's OWN
 * uploads (pending ones included, so "Check upload" keeps working). It never returns a private file,
 * a description, who on the team shared it, or a staff member's user id.
 */
export interface PortalDocument {
  id: string; filename: string; mime_type: string | null; size_bytes: number | null;
  /** "business": shared with the customer. "you": the customer's own upload. */
  source: "business" | "you"; state: "ready" | "pending";
  shared_at: string | null; created_at: string; storage_path: string;
}
export interface PortalDocumentPage {
  tenant_id: string; client_id: string; summary: {shared: number; from_you: number};
  files: PortalDocument[]; has_more: boolean;
}
export const PORTAL_DOCUMENT_PAGE_SIZE = 50;
const pageKeys = ["tenant_id", "client_id", "summary", "files", "has_more"];
const summaryKeys = ["shared", "from_you"];
const portalKeys = ["id", "filename", "mime_type", "size_bytes", "source", "state", "shared_at", "created_at", "storage_path"];
const exact = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(o, k));
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function readPortalDocument(value: unknown, scope: DocumentScope): PortalDocument {
  if (!isObject(value) || !exact(value, portalKeys)) throw new Error("Invalid document row");
  const f = value;
  if (typeof f.id !== "string" || !uuid.test(f.id)
    || typeof f.filename !== "string" || !f.filename || f.filename.length > 255 || invalidFilename(f.filename)
    || (f.mime_type !== null && typeof f.mime_type !== "string")
    || (f.size_bytes !== null && (typeof f.size_bytes !== "number" || !Number.isSafeInteger(f.size_bytes) || f.size_bytes < 0))
    || (f.source !== "business" && f.source !== "you") || (f.state !== "ready" && f.state !== "pending")
    || (f.shared_at !== null && !date(f.shared_at)) || !date(f.created_at)
    || typeof f.storage_path !== "string" || f.storage_path.split("/")[0] !== scope.tenant
    || /(^|\/)\.\.?($|\/)/.test(f.storage_path) || f.storage_path.includes("\\")) {
    throw new Error("Invalid document row");
  }
  // A business file reaches the customer only once it is shared and saved; a pending row is only ever
  // the customer's own reservation, at the exact path the reservation RPC fixes.
  if (f.source === "business" && (f.state !== "ready" || f.shared_at === null)) throw new Error("Invalid shared document");
  if (f.source === "you" && f.state === "pending"
    && f.storage_path !== `${scope.tenant}/${scope.contact}/client_upload/${scope.actor}/${f.id}`) throw new Error("Invalid upload reservation");
  return {id: f.id, filename: f.filename, mime_type: f.mime_type as string | null, size_bytes: f.size_bytes as number | null,
    source: f.source, state: f.state, shared_at: f.shared_at as string | null, created_at: f.created_at as string, storage_path: f.storage_path};
}

/** client_portal_documents(): exact keys at every level, scoped to the customer the profile resolved. */
export function readPortalDocumentList(value: unknown, scope: DocumentScope): PortalDocumentPage {
  if (!isObject(value) || !exact(value, pageKeys) || value.tenant_id !== scope.tenant || value.client_id !== scope.contact
    || typeof value.has_more !== "boolean" || !Array.isArray(value.files) || value.files.length > PORTAL_DOCUMENT_PAGE_SIZE
    || !isObject(value.summary) || !exact(value.summary, summaryKeys) || !summaryKeys.every(k => count((value.summary as Record<string, unknown>)[k]))) {
    throw new Error("Invalid document list");
  }
  const files = value.files.map(row => readPortalDocument(row, scope));
  if (new Set(files.map(f => f.id)).size !== files.length) throw new Error("Invalid document list");
  const summary = value.summary as {shared: number; from_you: number};
  return {tenant_id: scope.tenant, client_id: scope.contact, summary: {shared: summary.shared, from_you: summary.from_you}, files, has_more: value.has_more};
}

/** The customer's own confirmed upload, in the library's terms (the upload flow reads the full own row). */
export function portalDocumentFromUpload(file: ClientDocument): PortalDocument {
  return {id: file.id, filename: file.original_filename, mime_type: file.mime_type, size_bytes: file.size_bytes,
    source: "you", state: file.upload_state, shared_at: null, created_at: file.created_at, storage_path: file.storage_path};
}
