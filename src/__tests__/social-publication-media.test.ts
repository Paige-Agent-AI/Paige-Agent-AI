import { describe, expect, it } from "vitest";
import { resolveSavedPublicationMedia, type PublicationMediaReader, type SavedPublicationAsset } from "../../supabase/functions/_shared/social-publish-command/media.ts";

const TENANT = "10000000-0000-4000-8000-000000000001";
const FOREIGN = "10000000-0000-4000-8000-000000000002";
const FIRST = "20000000-0000-4000-8000-000000000001";
const SECOND = "20000000-0000-4000-8000-000000000002";
const ORIGIN = "https://test-project.supabase.co";
const REVISION = "2026-11-11T12:00:00.000Z";
const file = (id = FIRST): SavedPublicationAsset => ({
  id, tenant_id: TENANT, kind: "image", status: "draft", updated_at: REVISION,
  image_path: `${TENANT}/media/${id}.png`,
  image_url: `${ORIGIN}/storage/v1/object/public/paige-generated/${TENANT}/media/${id}.png`,
  meta: { alt_text: "A saved sample image" },
});
function world(rows: SavedPublicationAsset[] = [file()]) {
  const queried: string[][] = [], inspected: string[] = [];
  const reader: PublicationMediaReader = {
    async readAssets(ids) { queried.push([...ids]); return { rows, error: false }; },
    async readObject(path) {
      inspected.push(path);
      return { contentType: "image/png", size: 1024, etag: '"original-object"', lastModified: REVISION };
    },
  };
  return { reader, queried, inspected };
}
const resolve = (reader: PublicationMediaReader, ids: unknown = [FIRST], origin = ORIGIN) =>
  resolveSavedPublicationMedia({ tenantId: TENANT, mediaContentIds: ids, storageOrigin: origin, reader });

describe("original saved-library media resolution before publication approval", () => {
  it("preserves text-only calls without any asset/storage query", async () => {
    const w = world();
    expect(await resolve(w.reader, [])).toEqual({ status: "ready", assets: [], snapshot: "[]" });
    expect(w.queried).toEqual([]);
    expect(w.inspected).toEqual([]);
  });
  it("resolves the existing original asset and binds its storage identity", async () => {
    const w = world(); const r = await resolve(w.reader);
    expect(r.status).toBe("ready");
    if (r.status !== "ready") throw Error("Expected permitted media");
    expect(r.assets[0]).toMatchObject({ contentId: FIRST, contentRevision: REVISION, type: "image", storagePath: file().image_path, contentType: "image/png", size: 1024, etag: '"original-object"' });
    expect(JSON.parse(r.snapshot)[0]).toMatchObject({ content_id: FIRST, content_revision: REVISION, etag: '"original-object"', alt_text: "A saved sample image" });
    expect(w.inspected).toEqual([file().image_path]);
    expect(Object.isFrozen(r.assets[0])).toBe(true);
  });
  it("uses requested carousel order even when the query returns another order", async () => {
    const w = world([file(SECOND), file(FIRST)]); const r = await resolve(w.reader, [FIRST, SECOND]);
    expect(r.status).toBe("ready");
    if (r.status !== "ready") throw Error("Expected permitted media");
    expect(r.assets.map(a => a.contentId)).toEqual([FIRST, SECOND]);
    const reordered = await resolve(w.reader, [SECOND, FIRST]);
    expect(reordered.status === "ready" && reordered.snapshot).not.toBe(r.snapshot);
  });
  it("changes the approval snapshot when the object changes without a library-row edit", async () => {
    const w = world(); const before = await resolve(w.reader);
    w.reader.readObject = async () => ({ contentType: "image/png", size: 1024, etag: '"replacement-object"', lastModified: REVISION });
    const after = await resolve(w.reader);
    expect(before.status === "ready" && before.snapshot).not.toBe(after.status === "ready" && after.snapshot);
  });
  it.each([null, {}, "not-an-array", ["not-a-uuid"], [FIRST, FIRST], Array.from({ length: 21 }, () => FIRST)])("refuses malformed/duplicate/unbounded references %j before reads", async ids => {
    const w = world(); expect((await resolve(w.reader, ids)).status).toBe("refused");
    expect(w.queried).toEqual([]); expect(w.inspected).toEqual([]);
  });
  it("refuses a foreign row even if its public URL is reachable", async () => {
    const w = world([{ ...file(), tenant_id: FOREIGN }]);
    expect((await resolve(w.reader)).status).toBe("refused"); expect(w.inspected).toEqual([]);
  });
  it("refuses a partial/missing or duplicate read instead of publishing the visible subset", async () => {
    expect((await resolve(world([]).reader)).status).toBe("refused");
    expect((await resolve(world([file(), file()]).reader)).status).toBe("refused");
    expect((await resolve(world().reader, [FIRST, SECOND])).status).toBe("refused");
  });
  it.each([`${FOREIGN}/media/file.png`, `${TENANT}/../foreign.png`, `${TENANT}/%2e%2e/foreign.png`, `${TENANT}\\file.png`, `${TENANT}//file.png`, `${TENANT}/file.png?token=private`])("never inspects an unsafe storage path %s", async path => {
    const w = world([{ ...file(), image_path: path }]);
    expect((await resolve(w.reader)).status).toBe("refused"); expect(w.inspected).toEqual([]);
  });
  it.each(["https://another.example/file.png", file().image_url + "?token=private", file().image_url?.replace(TENANT, FOREIGN), "http://127.0.0.1/file.png", "data:image/png;base64,AAAA"])('refuses an arbitrary or foreign URL %s', async url => {
    const w = world([{ ...file(), image_url: url ?? null }]);
    expect((await resolve(w.reader)).status).toBe("refused"); expect(w.inspected).toEqual([]);
  });
  it.each(["archived", "processing", "uploading", "failed", "outcome_unknown", "revoked"])("refuses unavailable asset state %s", async status => {
    const w = world([{ ...file(), status }]); expect((await resolve(w.reader)).status).toBe("refused"); expect(w.inspected).toEqual([]);
  });
  it("does not trust the editable row metadata to establish storage MIME or size", async () => {
    const w = world([{ ...file(), meta: { mime_type: "image/png", bytes: 1 } }]);
    w.reader.readObject = async () => ({ contentType: "text/html", size: 1, etag: "html-object", lastModified: REVISION });
    expect((await resolve(w.reader)).status).toBe("refused");
  });
  it.each([null, { contentType: "image/png", size: 0, etag: "x", lastModified: REVISION }, { contentType: "image/png", size: 1024, etag: "", lastModified: REVISION }, { contentType: "image/png", size: 1024, etag: "x", lastModified: "unknown" }])("refuses missing/unverifiable storage facts %j", async facts => {
    const w = world(); w.reader.readObject = async () => facts;
    expect((await resolve(w.reader)).status).toBe("refused");
  });
  it("fails closed on query/storage errors without leaking a private provider error", async () => {
    const a = world(); a.reader.readAssets = async () => { throw Error("private storage credential"); };
    const b = world(); b.reader.readObject = async () => { throw Error("private storage credential"); };
    for (const reader of [a.reader, b.reader]) {
      const r = await resolve(reader); expect(r.status).toBe("refused");
      expect(JSON.stringify(r)).not.toContain("private storage credential");
    }
  });
  it("binds video storage as video and refuses a kind/MIME substitution", async () => {
    const row = { ...file(), kind: "video", image_path: `${TENANT}/media/video.mp4`, image_url: `${ORIGIN}/storage/v1/object/public/paige-generated/${TENANT}/media/video.mp4` };
    const w = world([row]); w.reader.readObject = async () => ({ contentType: "video/mp4", size: 1024, etag: "video-object", lastModified: REVISION });
    const r = await resolve(w.reader); expect(r.status === "ready" && r.assets[0].type).toBe("video");
    w.reader.readObject = async () => ({ contentType: "image/png", size: 1024, etag: "image-object", lastModified: REVISION });
    expect((await resolve(w.reader)).status).toBe("refused");
  });
  it.each(["http://test-project.supabase.co", "https://test-project.supabase.co/foreign/path", "https://name:secret@test-project.supabase.co", "https://test-project.supabase.co/?token=secret"])("refuses a noncanonical configured origin %s", async origin => {
    const w = world(); expect((await resolve(w.reader, [FIRST], origin)).status).toBe("refused"); expect(w.inspected).toEqual([]);
  });
});
