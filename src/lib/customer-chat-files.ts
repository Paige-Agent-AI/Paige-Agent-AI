import {
  clientDocumentMime,
  readClientDocument,
  type ClientDocument,
  type DocumentScope,
} from "./client-portal-documents";

export const CUSTOMER_CHAT_FILE_LIMIT = 5;
export type CustomerChatFile = ClientDocument & { customer_chat_thread_id: string };
export type CustomerChatFileStatus = { file: CustomerChatFile | null; object_verified: boolean };
export type CustomerChatFilePage = {
  tenant_id: string; client_id: string; files: CustomerChatFile[]; has_more: boolean;
};
export type CustomerChatFileDraft = { id: string; file: File; mime: string };
export type CustomerChatFileSelection = {
  files: CustomerChatFileDraft[];
  issues: { filename: string | null; message: string }[];
};

const uuid = (v: unknown): v is string => typeof v === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const record = (v: unknown): v is Record<string, unknown> => v !== null
  && typeof v === "object" && !Array.isArray(v);
const closed = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length
  && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));

/** Decode the native private projection; this does not establish authorization.
 * The original caller-scoped RPC and Storage rules must still authorize every read.
 */
export function readCustomerChatFile(value: unknown, scope: DocumentScope): CustomerChatFile {
  if (!record(value) || !Object.prototype.hasOwnProperty.call(value, "customer_chat_thread_id")
    || !uuid(value.customer_chat_thread_id)) throw new Error("Invalid private file result");
  const { customer_chat_thread_id: origin, ...base } = value;
  const file = readClientDocument(base, scope);
  // An old own thread is a valid historical origin. The current private thread
  // authorizes retrieval; comparing its ID here would break returning sessions.
  if (file.uploaded_by_user_id !== scope.actor || file.visibility !== "client_upload"
    || file.storage_path !== `${scope.tenant}/${scope.contact}/client_upload/${scope.actor}/${file.id}`
    || file.mime_type === null || file.size_bytes === null) throw new Error("Invalid private file scope");
  clientDocumentMime({ name: file.original_filename, type: file.mime_type, size: file.size_bytes });
  return { ...file, customer_chat_thread_id: origin };
}

export function readCustomerChatFileStatus(
  value: unknown, scope: DocumentScope, expectedFileId: string,
): CustomerChatFileStatus {
  if (!uuid(expectedFileId) || !record(value) || !closed(value, ["file", "object_verified"])
    || typeof value.object_verified !== "boolean") throw new Error("Invalid private upload status");
  const file = value.file === null ? null : readCustomerChatFile(value.file, scope);
  if ((file && file.id !== expectedFileId) || (!file && value.object_verified)) {
    throw new Error("Private upload identity changed");
  }
  return { file, object_verified: value.object_verified };
}

/** A saved metadata row alone is not proof that its object is still available. */
export function customerChatFileSaved(status: CustomerChatFileStatus): boolean {
  return status.file?.upload_state === "ready" && status.object_verified;
}

export function readCustomerChatFilePage(value: unknown, scope: DocumentScope): CustomerChatFilePage {
  if (!record(value) || !closed(value, ["tenant_id", "client_id", "files", "has_more"])
    || value.tenant_id !== scope.tenant || value.client_id !== scope.contact
    || typeof value.has_more !== "boolean" || !Array.isArray(value.files) || value.files.length > 50
    || (value.has_more && value.files.length === 0)) {
    throw new Error("Invalid private file list");
  }
  const files = value.files.map(f => readCustomerChatFile(f, scope));
  if (new Set(files.map(f => f.id)).size !== files.length) throw new Error("Duplicate private file result");
  return { tenant_id: scope.tenant, client_id: scope.contact, files, has_more: value.has_more };
}

/** Only draft selection. No upload, deletion, sharing, extraction or message send.
 * Each ID is kept for the original idempotent reservation/status/finish lifecycle.
 */
export function selectCustomerChatFiles(
  existing: readonly CustomerChatFileDraft[], incoming: readonly File[],
  makeId: () => string = () => crypto.randomUUID(),
): CustomerChatFileSelection {
  if (existing.length > CUSTOMER_CHAT_FILE_LIMIT || new Set(existing.map(f => f.id)).size !== existing.length
    || existing.some(f => !uuid(f.id))) throw new Error("Private file selection changed");
  if (existing.length + incoming.length > CUSTOMER_CHAT_FILE_LIMIT) return {
    files: [...existing], issues: [{ filename: null, message: "Choose up to five files for one message." }],
  };
  const files = [...existing], issues: CustomerChatFileSelection["issues"] = [];
  for (const file of incoming) {
    let mime: string;
    try { mime = clientDocumentMime(file); }
    catch {
      issues.push({ filename: file.name, message: "Choose a PDF, JPG, PNG or DOCX file up to 20 MB." });
      continue;
    }
    const id = makeId();
    if (!uuid(id) || files.some(f => f.id === id)) throw new Error("Private file selection changed");
    files.push({ id, file, mime });
  }
  return { files, issues };
}
