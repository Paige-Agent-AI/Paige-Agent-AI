import type {CustomerFilesContext, CustomerFileInput} from "./client-portal-files-context.ts";

type OriginalFile = Pick<Blob, "size" | "type" | "arrayBuffer">;
type Ports = {
  assertProcessingAllowed(): Promise<void>;
  revalidate(): Promise<CustomerFilesContext | null>;
  download(path: string, signal: AbortSignal): Promise<OriginalFile>;
};
export type CustomerFileBytes = Readonly<{file: CustomerFileInput; bytes: Uint8Array; sha256: string}>;
export class CustomerFileInputError extends Error {
  readonly code: string;
  constructor(code: string) {super(code); this.code = code;}
}
const fail = (code: string): never => {throw new CustomerFileInputError(code);};
const validId = (s: unknown) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);

/** Bounded source-data read, AFTER original native admission and executor/budget
 * authority. Ports must be the existing runtime and customer-JWT Storage service,
 * never request-body paths, a service identity or a new provider/model client.
 * The original caller supplies its byte budget; this helper cannot increase it.
 * Downloaded and hashed does not mean extracted, model-read, sent or published.
 */
export async function loadCustomerFileInputs(context: CustomerFilesContext, ports: Ports,
  byteBudget: number, requestSignal?: AbortSignal, timeoutMs = 15000): Promise<readonly CustomerFileBytes[]> {
  const snapshot = context?.snapshot ? {...context.snapshot, file_ids: [...context.snapshot.file_ids]} : null;
  const files = context?.files?.map(file => ({...file}));
  if (context?.mode !== "bound" || !snapshot || snapshot.thread_id !== context.threadId
    || !validId(context.threadId) || !validId(context.intentId) || !validId(snapshot.tenant_id) || !validId(snapshot.contact_id)
    || !files?.length || files.length > 5 || files.length !== snapshot.file_ids.length
    || new Set(snapshot.file_ids).size !== files.length || files.some((file, i) => !validId(file.id) || file.id !== snapshot.file_ids[i]
      || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 20971520
      || typeof file.path !== "string" || file.path.split("/").length !== 5
      || !file.path.startsWith(`${snapshot.tenant_id}/${snapshot.contact_id}/client_upload/`)
      || !validId(file.path.split("/")[3]) || file.path.split("/")[4] !== file.id)
    || !Number.isSafeInteger(byteBudget) || byteBudget < 1 || byteBudget > 20971520
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail("CUSTOMER_FILES_INPUT_INVALID");
  if (files.reduce((sum, file) => sum + file.bytes, 0) > byteBudget) fail("CUSTOMER_FILES_PROCESSING_LIMIT");
  const source = JSON.stringify(snapshot), originalFiles = JSON.stringify(files);
  const controller = new AbortController();
  let expired = false;
  const retire = () => controller.abort();
  const current = () => {if (controller.signal.aborted || requestSignal?.aborted) fail(expired ? "CUSTOMER_FILES_READ_TIMED_OUT" : "CUSTOMER_FILES_READ_INTERRUPTED");};
  const checkSource = async () => {
    current(); const fresh = await ports.revalidate(); current();
    if (fresh?.mode !== "bound" || fresh.threadId !== context.threadId || fresh.intentId !== context.intentId
      || JSON.stringify(fresh.snapshot) !== source || JSON.stringify(fresh.files) !== originalFiles) fail("CUSTOMER_FILES_SOURCE_CHANGED");
  };
  let onAbort!: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new CustomerFileInputError(expired ? "CUSTOMER_FILES_READ_TIMED_OUT" : "CUSTOMER_FILES_READ_INTERRUPTED"));
    controller.signal.addEventListener("abort", onAbort, {once: true});
  });
  requestSignal?.addEventListener("abort", retire, {once: true});
  const timer = setTimeout(() => {expired = true; retire();}, timeoutMs);
  const read = async () => {
    current();
    const result: CustomerFileBytes[] = [];
    for (const file of files) {
      await ports.assertProcessingAllowed(); current(); await checkSource();
      const downloaded = await ports.download(file.path, controller.signal); current();
      if (!downloaded || downloaded.size !== file.bytes || typeof downloaded.type !== "string"
        || (downloaded.type && downloaded.type.split(";")[0].trim().toLowerCase() !== file.mime)
        || typeof downloaded.arrayBuffer !== "function") fail("CUSTOMER_FILES_BYTES_CHANGED");
      const buffer = await downloaded.arrayBuffer(); current();
      if (Object.prototype.toString.call(buffer) !== "[object ArrayBuffer]" || buffer.byteLength !== file.bytes) fail("CUSTOMER_FILES_BYTES_CHANGED");
      const bytes = new Uint8Array(buffer);
      await ports.assertProcessingAllowed(); current(); await checkSource();
      const hash = await crypto.subtle.digest("SHA-256", bytes.slice()); current();
      result.push({file, bytes, sha256: [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("")});
    }
    await ports.assertProcessingAllowed(); current(); await checkSource();
    return result;
  };
  try {return await Promise.race([read(), interrupted]);}
  catch (error) {if (error instanceof CustomerFileInputError) throw error; return fail("CUSTOMER_FILES_READ_UNAVAILABLE");}
  finally {clearTimeout(timer); requestSignal?.removeEventListener("abort", retire); controller.signal.removeEventListener("abort", onAbort);}
}
