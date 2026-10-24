import {extractAttachmentText, bytesToBase64, type ModelInvoker} from "./attachment-extract.ts";
import {fenceUploadedFileText} from "./untrusted-fence.ts";
import {loadCustomerFileInputs, CustomerFileInputError, type CustomerFileBytes} from "./client-portal-file-input.ts";
import type {CustomerFilesContext} from "./client-portal-files-context.ts";

type Ports = Parameters<typeof loadCustomerFileInputs>[1] & {
  /** The existing handler's processor limits; storage capacity is not model capacity. */
  preflight(file: CustomerFileBytes): Promise<boolean>;
  /** The ORIGINAL admitted Model Fabric seam, never a new provider client. */
  invokeModel: (system: Parameters<ModelInvoker>[0], parts: Parameters<ModelInvoker>[1],
    processing: {assertCurrent: () => Promise<void>; signal: AbortSignal}) => ReturnType<ModelInvoker>;
};
type Limits = {byteBudget: number; timeoutMs: number; maxTextChars: number};
type FileResult = {fileId: string; filename: string; sha256: string; status: "read" | "unread";
  reason: "unsupported" | "processing_limit" | "empty" | null};
export class CustomerFileReadError extends Error {
  readonly code: string;
  constructor(code: string) {super(code); this.code = code;}
}
const fail = (code: string): never => {throw new CustomerFileReadError(code);};

/** Adapter for the original extraction primitive, not another model runtime or
 * receipt writer. Call only after native admission/executor/budget checks. All
 * bytes and processing ports come from the original customer-scoped handler.
 * Returned reference data is private turn context, never approved Knowledge.
 */
export async function readCustomerFileText(context: CustomerFilesContext, ports: Ports,
  limits: Limits, requestSignal?: AbortSignal): Promise<{files: readonly FileResult[]; referenceText: string}> {
  if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > 360000
    || !Number.isSafeInteger(limits.maxTextChars) || limits.maxTextChars < 1 || limits.maxTextChars > 60000)
    fail("CUSTOMER_FILES_PROCESSING_INVALID");
  const original = JSON.stringify(context);
  const controller = new AbortController();
  let expired = false;
  const stop = () => controller.abort();
  const current = () => {if (controller.signal.aborted || requestSignal?.aborted)
    fail(expired ? "CUSTOMER_FILES_PROCESSING_TIMED_OUT" : "CUSTOMER_FILES_PROCESSING_INTERRUPTED");};
  const assertCurrent = async () => {
    current(); await ports.assertProcessingAllowed(); current();
    const fresh = await ports.revalidate(); current();
    if (!fresh || JSON.stringify(fresh) !== original) fail("CUSTOMER_FILES_SOURCE_CHANGED");
  };
  let onAbort!: () => void;
  const retired = new Promise<never>((_, reject) => {
    onAbort = () => reject(new CustomerFileReadError(expired ? "CUSTOMER_FILES_PROCESSING_TIMED_OUT" : "CUSTOMER_FILES_PROCESSING_INTERRUPTED"));
    controller.signal.addEventListener("abort", onAbort, {once: true});
  });
  requestSignal?.addEventListener("abort", stop, {once: true});
  const timer = setTimeout(() => {expired = true; stop();}, limits.timeoutMs);
  const read = async () => {
    current();
    const inputs = await loadCustomerFileInputs(context, ports, limits.byteBudget, controller.signal,
      Math.min(limits.timeoutMs, 30000));
    const results: FileResult[] = [], blocks: string[] = [];
    let characters = 0;
    for (const input of inputs) {
      await assertCurrent();
      const base = {fileId: input.file.id, filename: input.file.filename, sha256: input.sha256};
      if (!["application/pdf", "image/png", "image/jpeg"].includes(input.file.mime)) {
        results.push({...base, status: "unread", reason: "unsupported"}); continue;
      }
      const allowed = await ports.preflight(input); await assertCurrent();
      if (allowed !== true) {results.push({...base, status: "unread", reason: "processing_limit"}); continue;}
      const text = await extractAttachmentText({base64: bytesToBase64(input.bytes),
        mimeType: input.file.mime, fileName: input.file.filename}, (system, parts) =>
          ports.invokeModel(system, parts, {assertCurrent, signal: controller.signal}));
      await assertCurrent();
      if (!text) {results.push({...base, status: "unread", reason: "empty"}); continue;}
      characters += text.length;
      if (characters > limits.maxTextChars) fail("CUSTOMER_FILES_TEXT_LIMIT");
      blocks.push(fenceUploadedFileText(input.file.filename, text, {maxLen: limits.maxTextChars}));
      results.push({...base, status: "read", reason: null});
    }
    await assertCurrent();
    return {files: results, referenceText: blocks.join("")};
  };
  try {return await Promise.race([read(), retired]);}
  catch (error) {
    if (error instanceof CustomerFileReadError) throw error;
    if (error instanceof CustomerFileInputError) return fail(error.code);
    return fail("CUSTOMER_FILES_PROCESSING_UNAVAILABLE");
  } finally {
    clearTimeout(timer); requestSignal?.removeEventListener("abort", stop);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
