import { expect, it } from "vitest";
import { parseOwnerFileList } from "./useClientFilesOwner";

const tenant = "e0924000-0000-4000-8000-0000000000a1", contact = "e0934000-0000-4000-8000-0000000000a1";
const file = (over: Record<string, unknown> = {}) => ({ id: "e0944000-0000-4000-8000-000000000001", filename: "Brand guidelines.pdf", mime_type: "application/pdf",
  size_bytes: 2048, visibility: "shared", upload_state: "ready", source: "business", shared_at: "2026-01-02T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z", storage_path: `${tenant}/${contact}/internal/e0944000-0000-4000-8000-000000000001`, ...over });
const list = (files: unknown[]) => ({ ok: true, contact_id: contact, portal_connected: true, files, has_more: false });

it("reads a file shared before the share stamp existed: shared_at backfilled, the sharer unknown", () => {
  // The backfill sets shared_at from updated_at and leaves shared_by NULL; the list must not refuse it.
  expect(parseOwnerFileList(list([file()]), tenant, contact).files).toHaveLength(1);
  expect(parseOwnerFileList(list([file({ shared_by: null })]), tenant, contact).files).toHaveLength(1);
  expect(parseOwnerFileList(list([file({ shared_by: "e0914000-0000-4000-8000-0000000000a1" })]), tenant, contact).files[0].visibility).toBe("shared");
});
it("still refuses a malformed sharer, an unpromised key, and a shared row with no share date", () => {
  expect(() => parseOwnerFileList(list([file({ shared_by: "not-a-user" })]), tenant, contact)).toThrow();
  expect(() => parseOwnerFileList(list([file({ description: "internal" })]), tenant, contact)).toThrow();
  expect(() => parseOwnerFileList(list([file({ shared_at: null })]), tenant, contact)).toThrow();
  expect(() => parseOwnerFileList(list([file({ storage_path: undefined })]), tenant, contact)).toThrow();
});
