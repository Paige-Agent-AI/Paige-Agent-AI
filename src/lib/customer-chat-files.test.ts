import { describe, expect, it } from "vitest";
import { CLIENT_DOCUMENT_LIMIT } from "./client-portal-documents";
import {
  customerChatFileSaved, readCustomerChatFile, readCustomerChatFilePage,
  readCustomerChatFileStatus, selectCustomerChatFiles,
} from "./customer-chat-files";

const actor = "e0991000-0000-4000-8000-000000000001";
const contact = "e0991000-0000-4000-8000-000000000002";
const tenant = "e0991000-0000-4000-8000-000000000003";
const id = "e0991000-0000-4000-8000-000000000004";
const origin = "e0991000-0000-4000-8000-000000000005";
const other = "e0991000-0000-4000-8000-000000000006";
const scope = { actor, contact, tenant };
const native = () => ({ id, tenant_id: tenant, contact_id: contact, uploaded_by_user_id: actor,
  storage_path: `${tenant}/${contact}/client_upload/${actor}/${id}`,
  original_filename: "Working notes.pdf", mime_type: "application/pdf", size_bytes: 4,
  visibility: "client_upload", upload_state: "ready", customer_chat_thread_id: origin,
  created_at: "2026-10-23T12:00:00Z", updated_at: "2026-10-23T12:00:00Z" });
const pdf = (name = "Notes.pdf") => new File(["test"], name, { type: "application/pdf" });

describe("private CURA native file projections", () => {
  it("retains an old own private origin for a returning conversation", () => {
    expect(readCustomerChatFile(native(), scope).customer_chat_thread_id).toBe(origin);
  });
  for (const [name, patch] of [
    ["another business", { tenant_id: other }], ["another customer", { contact_id: other }],
    ["another uploader", { uploaded_by_user_id: other }], ["business share", { visibility: "shared" }],
    ["cleared private origin", { customer_chat_thread_id: null }],
    ["forged ready path", { storage_path: `${tenant}/foreign.pdf` }],
    ["an external download URL", { storage_path: "https://example.invalid/file.pdf" }],
    ["missing MIME", { mime_type: null }], ["mismatched MIME", { mime_type: "image/png" }],
    ["oversized file", { size_bytes: CLIENT_DOCUMENT_LIMIT + 1 }],
    ["empty file", { size_bytes: 0 }], ["hidden extra content", { extracted_text: "untrusted" }],
  ] as const) it(`refuses ${name}`, () => {
    expect(() => readCustomerChatFile({ ...native(), ...patch }, scope)).toThrow();
  });
  it("does not promote a ready metadata row with an unverified object to saved", () => {
    expect(customerChatFileSaved(readCustomerChatFileStatus({ file: native(), object_verified: false }, scope, id))).toBe(false);
  });
  it("does not promote verified object presence before finish", () => {
    expect(customerChatFileSaved(readCustomerChatFileStatus({ file: { ...native(), upload_state: "pending" }, object_verified: true }, scope, id))).toBe(false);
  });
  it("recognizes only the exact ready file and verified original object", () => {
    expect(customerChatFileSaved(readCustomerChatFileStatus({ file: native(), object_verified: true }, scope, id))).toBe(true);
    expect(() => readCustomerChatFileStatus({ file: native(), object_verified: true }, scope, other)).toThrow();
  });
  it("accepts a missing reservation without inventing an upload", () => {
    expect(readCustomerChatFileStatus({ file: null, object_verified: false }, scope, id).file).toBeNull();
    expect(() => readCustomerChatFileStatus({ file: null, object_verified: true }, scope, id)).toThrow();
  });
  it("refuses unexpected fields in status or list envelopes", () => {
    expect(() => readCustomerChatFileStatus({ file: native(), object_verified: true, success: true }, scope, id)).toThrow();
    expect(() => readCustomerChatFilePage({ tenant_id: tenant, client_id: contact, files: [], has_more: false, success: true }, scope)).toThrow();
  });
  it("preserves bounded returning pages and refuses duplicates or foreign pages", () => {
    const page = { tenant_id: tenant, client_id: contact, files: [native()], has_more: true };
    expect(readCustomerChatFilePage(page, scope).has_more).toBe(true);
    expect(() => readCustomerChatFilePage({ ...page, files: [native(), native()] }, scope)).toThrow();
    expect(() => readCustomerChatFilePage({ ...page, client_id: other }, scope)).toThrow();
    expect(() => readCustomerChatFilePage({ ...page, files: Array(51).fill(native()) }, scope)).toThrow();
  });
  it("refuses a more-pages claim without an original file cursor", () => {
    const page = { tenant_id: tenant, client_id: contact, files: [], has_more: false };
    expect(readCustomerChatFilePage(page, scope).files).toEqual([]);
    expect(() => readCustomerChatFilePage({ ...page, has_more: true }, scope)).toThrow();
  });
});

describe("bounded private draft selection", () => {
  it("keeps one original identity per selection; matching filenames are not content equality", () => {
    const first = selectCustomerChatFiles([], [pdf()], () => id);
    const second = selectCustomerChatFiles(first.files, [pdf()], () => other);
    expect(second.files.map(f => f.id)).toEqual([id, other]);
    expect(first.files).toHaveLength(1);
  });
  it("reports a bad file while keeping valid files in the same selection", () => {
    const result = selectCustomerChatFiles([], [new File(["test"], "Script.exe"), pdf()], () => id);
    expect(result.files.map(f => f.id)).toEqual([id]);
    expect(result.issues.map(e => e.filename)).toEqual(["Script.exe"]);
  });
  it("keeps five selected files unchanged when another is pasted", () => {
    let n = 10;
    const first = selectCustomerChatFiles([], Array.from({ length: 5 }, () => pdf()),
      () => `e0991000-0000-4000-8000-${String(n++).padStart(12, "0")}`);
    const extra = selectCustomerChatFiles(first.files, [pdf("Extra.pdf")], () => other);
    expect(extra.files).toEqual(first.files);
    expect(extra.issues).toHaveLength(1);
  });
  it("refuses an oversized batch before generating reservations", () => {
    expect(selectCustomerChatFiles([], Array.from({ length: 6 }, () => pdf()), () => { throw Error("must not generate"); }).files).toEqual([]);
  });
  it("refuses a repeated UUID rather than silently replacing a previous selection", () => {
    const first = selectCustomerChatFiles([], [pdf()], () => id);
    expect(() => selectCustomerChatFiles(first.files, [pdf()], () => id)).toThrow();
    expect(first.files[0].id).toBe(id);
  });
});
