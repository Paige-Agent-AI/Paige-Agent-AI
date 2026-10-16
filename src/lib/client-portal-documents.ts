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
