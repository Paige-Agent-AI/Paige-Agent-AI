import type {ClientPortalPersonaInput} from "./client-portal-persona.ts";
import {contextAvailable, contextDegraded, contextUnavailable, type ContextSourceResult} from "./paige-context/mod.ts";

type Caller = {rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}>};
export type CustomerFilesSnapshot = Readonly<{
  version: 1; kind: "customer_private_files"; tenant_id: string; contact_id: string;
  thread_id: string; file_ids: readonly string[]; source_fingerprint: string;
}>;
export type CustomerFileInput = Readonly<{
  id: string; filename: string; mime: string; bytes: number; path: string; originThreadId: string;
}>;
export type CustomerFilesContext = Readonly<{
  threadId: string; intentId: string; mode: "fresh" | "bound" | "legacy";
  snapshot: CustomerFilesSnapshot | null; files: readonly CustomerFileInput[];
}>;
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const closed = (v: unknown, keys: string[]) => {
  const r = object(v);
  return r && Object.keys(r).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(r, k)) ? r : null;
};
const uuid = (v: unknown): v is string => typeof v === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const inputId = (v: unknown): string | null => typeof v === "string" && uuid(v.toLowerCase()) ? v.toLowerCase() : null;
const date = (v: unknown): v is string => typeof v === "string" && v.length <= 40
  && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const fileKeys = ["id", "tenant_id", "contact_id", "uploaded_by_user_id", "storage_path", "original_filename",
  "mime_type", "size_bytes", "visibility", "upload_state", "created_at", "updated_at", "customer_chat_thread_id"];
const mimeExtensions: Record<string, readonly string[]> = {
  "application/pdf": ["pdf"], "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
};
function ids(v: unknown): string[] | null {
  return Array.isArray(v) && v.length > 0 && v.length <= 5 && v.every(uuid) && new Set(v).size === v.length ? [...v] : null;
}
const equalIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Decode only the native caller-JWT file projection. No browser paths, file text,
 * service-role substitute, business Knowledge read or model invocation. The original
 * database and Storage remain the authority; this decoder cannot grant permission.
 * NULL selection is for an already accepted intent, including legacy no-file turns.
 */
export async function readCustomerFilesContext(caller: Caller, actorInput: string, threadInput: unknown,
  intentInput: unknown, expectedPersona: ClientPortalPersonaInput, selection: unknown = null,
  timeoutMs = 5000): Promise<ContextSourceResult<CustomerFilesContext | null>> {
  const actor = inputId(actorInput), threadId = inputId(threadInput), intentId = inputId(intentInput);
  const binding = expectedPersona?.binding;
  const tenant = inputId(binding?.tenantId), contact = inputId(binding?.clientId);
  const selected = selection === null ? null : ids(selection);
  if (!actor || !threadId || !intentId || !tenant || !contact || binding?.actorId !== actor
    || expectedPersona.enabled !== true || (selection !== null && !selected)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return contextDegraded("customer_files_scope_invalid");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    const {data, error} = await Promise.race([
      Promise.resolve(caller.rpc("client_portal_assistant_files_context", {p_thread: threadId, p_intent: intentId, p_file_ids: selected})),
      new Promise<never>((_, reject) => {timer = setTimeout(() => {expired = true; reject(new Error("timeout"));}, timeoutMs);}),
    ]);
    if (error) return object(error)?.code === "42501" ? contextUnavailable("customer_files_withdrawn") : contextDegraded("customer_files_read_failed");
    const r = closed(data, ["thread_id", "intent_id", "mode", "snapshot", "files"]);
    if (!r || r.thread_id !== threadId || r.intent_id !== intentId || !Array.isArray(r.files)) return contextDegraded("customer_files_invalid");
    if (r.mode === "legacy") return selected === null && r.snapshot === null && r.files.length === 0
      ? contextAvailable({threadId, intentId, mode: "legacy", snapshot: null, files: []}) : contextDegraded("customer_files_invalid");
    const s = closed(r.snapshot, ["version", "kind", "tenant_id", "contact_id", "thread_id", "file_ids", "source_fingerprint"]);
    const bound = ids(s?.file_ids);
    if ((r.mode !== "fresh" && r.mode !== "bound") || (r.mode === "fresh" && selected === null)
      || !s || s.version !== 1 || s.kind !== "customer_private_files" || s.tenant_id !== tenant || s.contact_id !== contact
      || s.thread_id !== threadId || !bound || (selected !== null && !equalIds(selected, bound)) || r.files.length !== bound.length
      || typeof s.source_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(s.source_fingerprint)) return contextDegraded("customer_files_invalid");
    const files: CustomerFileInput[] = [];
    for (let i = 0; i < r.files.length; i++) {
      const entry = closed(r.files[i], ["file", "object"]), f = closed(entry?.file, fileKeys);
      const stored = closed(entry?.object, ["id", "updated_at", "version", "metadata"]), meta = object(stored?.metadata);
      if (!f || !stored || !meta || f.id !== bound[i] || f.tenant_id !== tenant || f.contact_id !== contact
        || f.uploaded_by_user_id !== actor || !uuid(f.customer_chat_thread_id)
        || f.storage_path !== `${tenant}/${contact}/client_upload/${actor}/${bound[i]}`
        || f.visibility !== "client_upload" || f.upload_state !== "ready" || !date(f.created_at) || !date(f.updated_at)
        || typeof f.original_filename !== "string" || !f.original_filename || f.original_filename !== f.original_filename.trim()
        || f.original_filename.length > 255 || !f.original_filename.includes(".") || /[/\\]/.test(f.original_filename)
        || Array.from(f.original_filename).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
        || typeof f.mime_type !== "string" || !Object.prototype.hasOwnProperty.call(mimeExtensions, f.mime_type)
        || !mimeExtensions[f.mime_type].includes(f.original_filename.split(".").pop()?.toLowerCase() ?? "")
        || typeof f.size_bytes !== "number" || !Number.isSafeInteger(f.size_bytes) || f.size_bytes < 1 || f.size_bytes > 20971520
        || !uuid(stored.id) || !date(stored.updated_at)
        || (stored.version !== null && (typeof stored.version !== "string" || !stored.version || stored.version.length > 200))
        || !["number", "string"].includes(typeof meta.size) || String(meta.size) !== String(f.size_bytes)
        || meta.mimetype !== f.mime_type) return contextDegraded("customer_files_invalid");
      // Do not copy arbitrary object metadata, credentials or caller text into model context.
      files.push({id: bound[i], filename: f.original_filename, mime: f.mime_type, bytes: f.size_bytes,
        path: f.storage_path as string, originThreadId: f.customer_chat_thread_id});
    }
    return contextAvailable({threadId, intentId, mode: r.mode,
      snapshot: {version: 1, kind: "customer_private_files", tenant_id: tenant, contact_id: contact, thread_id: threadId,
        file_ids: bound, source_fingerprint: s.source_fingerprint}, files});
  } catch {return contextDegraded(expired ? "customer_files_timed_out" : "customer_files_read_failed");}
  finally {if (timer !== undefined) clearTimeout(timer);}
}

/** The original terminal writer persists this exact native manifest, never a
 * model-proposed provenance field. It still must recheck native publication.
 */
export function customerFilesTerminalSource(snapshot: CustomerFilesSnapshot | null, content: unknown,
  bundle: Record<string, unknown>): {content: unknown; metadata: Record<string, unknown>} {
  if (snapshot && ["WITHHELD", "INTERRUPTED", "REFUSED"].includes(String(object(bundle.turn_state)?.state)))
    return {content: "", metadata: {}};
  return {content, metadata: snapshot ? {customer_files: snapshot} : {}};
}
