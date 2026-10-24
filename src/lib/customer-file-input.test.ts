import {strict as assert} from "node:assert";
import {Blob} from "node:buffer";
import {webcrypto} from "node:crypto";
import {afterEach, test, vi} from "vitest";
import {loadCustomerFileInputs, CustomerFileInputError} from "../../supabase/functions/_shared/client-portal-file-input.ts";
import type {CustomerFilesContext} from "../../supabase/functions/_shared/client-portal-files-context.ts";

afterEach(() => vi.unstubAllGlobals());
const id = (n: number) => `e0997100-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1), tenant = id(2), contact = id(3), thread = id(4), intent = id(5);
function fixture(): CustomerFilesContext {
  const files = [id(6), id(7)].map(file => ({id: file, filename: "Private.pdf", mime: "application/pdf", bytes: 4,
    path: `${tenant}/${contact}/client_upload/${actor}/${file}`, originThreadId: thread}));
  return {threadId: thread, intentId: intent, mode: "bound", files,
    snapshot: {version: 1, kind: "customer_private_files", tenant_id: tenant, contact_id: contact,
      thread_id: thread, file_ids: files.map(file => file.id), source_fingerprint: "a".repeat(64)}};
}
function ports(context = fixture()) {
  return {assertProcessingAllowed: vi.fn(async () => {}), revalidate: vi.fn(async (): Promise<CustomerFilesContext | null> => context),
    download: vi.fn(async (_path: string, _signal: AbortSignal) => new Blob([new Uint8Array([37, 80, 68, 70])], {type: "application/pdf"}))};
}
const code = (expected: string) => (e: unknown) => e instanceof CustomerFileInputError && e.code === expected;
function cryptoReady() {vi.stubGlobal("crypto", webcrypto);}

test("reads original stored paths sequentially, rechecks source and hashes actual downloaded bytes", async () => {
  cryptoReady(); const context = fixture(), p = ports(context);
  const output = await loadCustomerFileInputs(context, p, 8);
  assert.equal(output.length, 2);
  assert.deepEqual(p.download.mock.calls.map(call => call[0]), context.files.map(file => file.path));
  assert.ok(p.download.mock.calls.every(call => call[1] instanceof AbortSignal));
  assert.equal(p.revalidate.mock.calls.length, 5); assert.equal(p.assertProcessingAllowed.mock.calls.length, 5);
  assert.deepEqual([...output[0].bytes], [37, 80, 68, 70]);
  const expected = await webcrypto.subtle.digest("SHA-256", new Uint8Array([37, 80, 68, 70]));
  assert.equal(output[0].sha256, Buffer.from(expected).toString("hex"));
});
test("fresh, legacy, malformed path and over-budget input never download", async () => {
  const context = fixture(), p = ports(context);
  for (const changed of [{...context, mode: "fresh" as const}, {...context, mode: "legacy" as const, snapshot: null},
    {...context, files: context.files.map(f => ({...f, path: "https://untrusted.invalid/file"}))},
    {...context, files: [...context.files].reverse()}])
    await assert.rejects(loadCustomerFileInputs(changed, p, 8), code("CUSTOMER_FILES_INPUT_INVALID"));
  await assert.rejects(loadCustomerFileInputs(context, p, 7), code("CUSTOMER_FILES_PROCESSING_LIMIT"));
  assert.equal(p.download.mock.calls.length, 0); assert.equal(p.assertProcessingAllowed.mock.calls.length, 0);
});
test("current authority refusal or source withdrawal prevents the first download", async () => {
  const context = fixture(), denied = ports(context);
  denied.assertProcessingAllowed.mockRejectedValue(Error("private admission detail"));
  await assert.rejects(loadCustomerFileInputs(context, denied, 8), code("CUSTOMER_FILES_READ_UNAVAILABLE"));
  const withdrawn = ports(context); withdrawn.revalidate.mockResolvedValue(null);
  await assert.rejects(loadCustomerFileInputs(context, withdrawn, 8), code("CUSTOMER_FILES_SOURCE_CHANGED"));
  assert.equal(denied.download.mock.calls.length + withdrawn.download.mock.calls.length, 0);
});
test("source changes during download withhold bytes and do not start the next file", async () => {
  cryptoReady(); const context = fixture(), p = ports(context);
  p.revalidate.mockResolvedValueOnce(context).mockResolvedValue({...context, snapshot: {...context.snapshot!, source_fingerprint: "b".repeat(64)}});
  await assert.rejects(loadCustomerFileInputs(context, p, 8), code("CUSTOMER_FILES_SOURCE_CHANGED"));
  assert.equal(p.download.mock.calls.length, 1);
});
test("wrong size, MIME or actual body length cannot become verified file input", async () => {
  for (const bad of [new Blob(["wrong"], {type: "application/pdf"}), new Blob(["data"], {type: "text/html"}),
    {size: 4, type: "application/pdf", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer}]) {
    const p = ports(); p.download.mockResolvedValue(bad as Blob);
    await assert.rejects(loadCustomerFileInputs(fixture(), p, 8), code("CUSTOMER_FILES_BYTES_CHANGED"));
    assert.equal(p.download.mock.calls.length, 1);
  }
});
test("parent interruption retires a late download without starting another", async () => {
  const context = fixture(), p = ports(context), controller = new AbortController();
  let resolve!: (b: Blob) => void;
  p.download.mockImplementation(() => new Promise(r => {resolve = r;}));
  const result = loadCustomerFileInputs(context, p, 8, controller.signal);
  await vi.waitFor(() => assert.equal(p.download.mock.calls.length, 1));
  controller.abort(); await assert.rejects(result, code("CUSTOMER_FILES_READ_INTERRUPTED"));
  resolve(new Blob(["data"], {type: "application/pdf"})); await new Promise(r => setTimeout(r, 0));
  assert.equal(p.download.mock.calls.length, 1); assert.equal(p.revalidate.mock.calls.length, 1);
});
test("deadline bounds a stuck source read and a pre-aborted request performs no work", async () => {
  const context = fixture(), p = ports(context);
  p.revalidate.mockImplementation(() => new Promise(() => {}));
  await assert.rejects(loadCustomerFileInputs(context, p, 8, undefined, 5), code("CUSTOMER_FILES_READ_TIMED_OUT"));
  assert.equal(p.download.mock.calls.length, 0);
  const controller = new AbortController(); controller.abort(); const stopped = ports(context);
  await assert.rejects(loadCustomerFileInputs(context, stopped, 8, controller.signal), code("CUSTOMER_FILES_READ_INTERRUPTED"));
  assert.equal(stopped.assertProcessingAllowed.mock.calls.length, 0);
});
test("changed original file projection cannot retain a copied fingerprint", async () => {
  const context = fixture(), p = ports(context);
  p.revalidate.mockResolvedValue({...context, files: context.files.map(f => ({...f, filename: "Replaced.pdf"}))});
  await assert.rejects(loadCustomerFileInputs(context, p, 8), code("CUSTOMER_FILES_SOURCE_CHANGED"));
  assert.equal(p.download.mock.calls.length, 0);
});
