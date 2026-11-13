import { describe, expect, it, vi } from "vitest";
import { createStudioPageSave } from "../../../supabase/functions/_shared/growth/studio-page-save";
import type { StudioPageSaveSource } from "../../../supabase/functions/_shared/growth/studio-page-source";

const TENANT = "10000000-0000-4000-8000-000000000001", SESSION = "10000000-0000-4000-8000-000000000002";
const PAGE = "10000000-0000-4000-8000-000000000003", VERSION = "10000000-0000-4000-8000-000000000004";
const OTHER = "10000000-0000-4000-8000-000000000005";
const source = (): StudioPageSaveSource => ({ ok: true, tenant_id: TENANT, session_id: SESSION,
  artifact_refs: [{ kind: "page", id: PAGE, title: "Page" }], project_context: { target: { kind: "workspace" }, values: {} },
  page_id: PAGE, updated_at: "2026-11-13T12:00:00Z", conversion: null });
const input = () => ({ slug: "planning-workshop", title: "Planning workshop", blocks: [{ type: "hero", title: "A practical next step" }], theme: null, seo: null });
const nativeSaved = (extra = {}) => ({ ok: true, page: { id: PAGE, tenant_id: TENANT, slug: "planning-workshop", title: "Planning workshop", status: "draft" },
  version_id: VERSION, forms: [], changed: true, reconciled: false, ...extra });
const ok = (data: unknown) => ({ data, error: null });

describe("Studio save source identity and uncertain acknowledgment", () => {
  it("clamps every authority/revision field to the admitted native source and returns actual IDs", async () => {
    const rpc = vi.fn(async () => ok(nativeSaved()));
    const result = await createStudioPageSave(source(), { caller: { rpc }, current: () => true }).save(input());
    expect(rpc).toHaveBeenCalledExactlyOnceWith("studio_save_page", {
      p_expected_tenant: TENANT, p_session_id: SESSION, p_expected_artifact_refs: source().artifact_refs,
      p_expected_project_context: source().project_context, p_page_id: PAGE,
      p_expected_updated_at: source().updated_at, p_expected_conversion: null,
      p_slug: input().slug, p_title: input().title, p_blocks_json: input().blocks,
      p_theme_json: null, p_seo_json: null, p_form_schema_json: null,
    });
    expect(result).toMatchObject({ ok: true, page: { id: PAGE, tenant_id: TENANT }, versionId: VERSION });
  });
  it("never accepts a model-selected page instead of the actual canvas", async () => {
    const rpc = vi.fn();
    const result = await createStudioPageSave(source(), { caller: { rpc }, current: () => true }).save({ ...input(), pageId: OTHER });
    expect(result).toEqual({ ok: false, code: "invalid", notApplied: true }); expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["40001", "23505", "P0002", "42501", "22023"])("keeps native transactional refusal %s distinct from a transport uncertainty", async code => {
    const rpc = vi.fn(async () => ({ data: null, error: { code, message: "private-native-detail" } }));
    const result = await createStudioPageSave(source(), { caller: { rpc }, current: () => true }).save(input());
    expect(result).toMatchObject({ ok: false, notApplied: true }); expect(rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-native-detail");
  });
  it("inspects the exact original source and desired payload after a lost write acknowledgment", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { message: "reply lost" } })
      .mockResolvedValueOnce(ok(nativeSaved({ changed: false, reconciled: true })));
    const result = await createStudioPageSave(source(), { caller: { rpc }, current: () => true }).save(input());
    expect(result).toMatchObject({ ok: true, versionId: VERSION, changed: false, reconciled: true });
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["studio_save_page", "studio_page_save_state"]);
    expect(rpc.mock.calls[1][1]).toEqual(rpc.mock.calls[0][1]);
  });
  it("never replays a write after UNKNOWN, including an identical explicit retry", async () => {
    const rpc = vi.fn(async (name: string) => name === "studio_save_page"
      ? { data: null, error: { message: "transport lost" } } : ok({ ok: false, code: "unknown" }));
    const handle = createStudioPageSave(source(), { caller: { rpc }, current: () => true });
    expect(await handle.save(input())).toEqual({ ok: false, code: "unknown", notApplied: false });
    expect(await handle.save(input())).toEqual({ ok: false, code: "unknown", notApplied: false });
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["studio_save_page", "studio_page_save_state", "studio_page_save_state"]);
  });
  it("does not call a changed lookup refusal proof that the original uncertain write did not happen", async () => {
    const rpc = vi.fn().mockRejectedValueOnce(new Error("private transport message"))
      .mockResolvedValueOnce(ok({ ok: false, code: "changed" }));
    expect(await createStudioPageSave(source(), { caller: { rpc }, current: () => true }).save(input()))
      .toEqual({ ok: false, code: "unknown", notApplied: false });
  });
  it("freezes payload identity and refuses a changed retry without another dispatch", async () => {
    const rpc = vi.fn(async () => ok(nativeSaved()));
    const handle = createStudioPageSave(source(), { caller: { rpc }, current: () => true });
    await handle.save(input());
    expect(await handle.save({ ...input(), title: "A different requested revision" }))
      .toEqual({ ok: false, code: "changed", notApplied: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch on withdrawal, and never promotes a late response after cancellation", async () => {
    const controller = new AbortController(); const rpc = vi.fn(async () => { controller.abort(); return ok(nativeSaved()); });
    const handle = createStudioPageSave(source(), { caller: { rpc }, current: () => true, signal: controller.signal });
    expect(await handle.save(input())).toEqual({ ok: false, code: "unknown", notApplied: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await handle.save(input())).toEqual({ ok: false, code: "unknown", notApplied: false });
    const never = vi.fn();
    expect(await createStudioPageSave(source(), { caller: { rpc: never }, current: () => false }).save(input()))
      .toEqual({ ok: false, code: "not_allowed", notApplied: true }); expect(never).not.toHaveBeenCalled();
  });
  it.each([
    nativeSaved({ page: { id: OTHER, tenant_id: TENANT, slug: "x", title: "x", status: "draft" } }),
    nativeSaved({ page: { id: PAGE, tenant_id: OTHER, slug: "x", title: "x", status: "draft" } }),
    nativeSaved({ version_id: null }),
    nativeSaved({ forms: [{ id: "unverified", slug: "form" }] }),
  ])("does not promote malformed or foreign native readback", async malformed => {
    const rpc = vi.fn().mockResolvedValueOnce(ok(malformed)).mockResolvedValueOnce(ok({ ok: false, code: "unknown" }));
    expect(await createStudioPageSave(source(), { caller: { rpc }, current: () => true }).save(input()))
      .toEqual({ ok: false, code: "unknown", notApplied: false });
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["studio_save_page", "studio_page_save_state"]);
  });
});
