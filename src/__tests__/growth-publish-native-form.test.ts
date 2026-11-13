// @vitest-environment node
// Real pure readiness and original door; Supabase clients are the existing
// in-memory world. No authenticated native/provider execution is claimed.
import { describe, expect, it } from "vitest";
import { buildPublishPreview, previewReady } from "../../supabase/functions/_shared/growth-publish-command/contract.ts";
import { FORM, MINE, PAGE, THEIRS, livePage, world } from "./growth-publish-door.world.ts";

const OTHER_FORM = "77777777-7777-4777-8777-777777777777";
const nativeForm = (formId: unknown = FORM) => ({ type: "conversion", label: "Request a conversation", destination: { kind: "native_form", formId } });
const form = (over: Record<string, unknown> = {}) => ({ id: FORM, tenant_id: MINE, name: "Northwind inquiry", slug: "northwind-inquiry", status: "draft", ...over });
const publish = { action: "publish", kind: "page", id: PAGE };
const unpublish = { action: "unpublish", kind: "form", id: FORM };
type Check = { key: string; ok: boolean; blocking: boolean; label: string; detail?: string };
const checks = (body: Record<string, unknown>) => (body.preview as { checks: Check[] }).checks;

describe("canonical native forms in pure publish readiness", () => {
  it("refuses an unresolved native form instead of claiming there are no forms", () => {
    const preview = buildPublishPreview("publish", "page", PAGE, { tenantSlug: "northwind", page: livePage({ draft_blocks_json: [nativeForm()] }), pageFormSlugs: new Set() })!;
    expect(previewReady(preview)).toBe(false);
    expect(preview.checks.find(c => c.key === "forms_exist")).toMatchObject({ ok: false, blocking: true });
  });
  it("counts a resolved native form and deduplicates its retained legacy slug", () => {
    const facts = { tenantSlug: "northwind", page: livePage({ draft_blocks_json: [nativeForm(), nativeForm(), { type: "embedded_form", form_slug: "northwind-inquiry" }] }), pageFormSlugs: new Set(["northwind-inquiry"]), pageForms: [{ id: FORM, slug: "northwind-inquiry" }] };
    const preview = buildPublishPreview("publish", "page", PAGE, facts)!;
    expect(previewReady(preview)).toBe(true);
    expect(preview.checks.find(c => c.key === "forms_exist")).toMatchObject({ ok: true, label: "1 form on this page goes live with it" });
  });
  it.each([undefined, null, "", "not-a-form-id", 42])("refuses malformed canonical native form identity %#", (id) => {
    const block = nativeForm(); block.destination.formId = id;
    const preview = buildPublishPreview("publish", "page", PAGE, { tenantSlug: "northwind", page: livePage({ draft_blocks_json: [block] }) })!;
    expect(previewReady(preview)).toBe(false);
    expect(preview.checks.find(c => c.key === "signup_has_form")).toMatchObject({ ok: false, blocking: true });
  });
  it("does not count external destinations or native bookings as CRM forms", () => {
    const preview = buildPublishPreview("publish", "page", PAGE, { tenantSlug: "northwind", page: livePage({ draft_blocks_json: [{ type: "conversion", destination: { kind: "native_booking", slug: "intro" } }, { type: "conversion", destination: { kind: "external_form", mode: "link", url: "https://form.jotform.com/123456789" } }] }) })!;
    expect(preview.checks.find(c => c.key === "forms_exist")?.label).toBe("No forms on this page");
  });
});

describe("original door resolves canonical form IDs before approval", () => {
  it("reads the exact requested form ID in the server tenant with narrow status facts", async () => {
    const w = world({ tables: { growth_pages: [livePage({ draft_blocks_json: [nativeForm()] })], growth_forms: [form(), form({ id: OTHER_FORM, slug: "unrelated" }), form({ tenant_id: THEIRS, slug: "foreign-copy" })] } });
    const result = await w.call(publish);
    expect(result.body.fingerprint).toEqual(expect.any(String));
    expect(checks(result.body).find(c => c.key === "forms_exist")).toMatchObject({ ok: true, label: "1 form on this page goes live with it" });
    expect(w.seen.reads.filter(r => r.table === "growth_forms")).toEqual([expect.objectContaining({ filters: expect.arrayContaining([["eq", "tenant_id", MINE], ["in", "id", [FORM]]]) })]);
    expect(w.seen.selects.filter(r => r.table === "growth_forms")).toEqual([{ table: "growth_forms", columns: "id,tenant_id,slug,status" }]);
    expect(w.executorCalls()).toHaveLength(0);
  });
  it("counts two actual forms but one resource referenced through both supported paths only once", async () => {
    const w = world({ tables: { growth_pages: [livePage({ draft_blocks_json: [nativeForm(), nativeForm(OTHER_FORM), { type: "embedded_form", form_slug: "northwind-inquiry" }] })], growth_forms: [form(), form({ id: OTHER_FORM, slug: "other-inquiry" })] } });
    const result = await w.call(publish);
    expect(checks(result.body).find(c => c.key === "forms_exist")).toMatchObject({ ok: true, label: "2 forms on this page go live with it" });
    for (const read of w.seen.reads.filter(r => r.table === "growth_forms")) expect(read.filters).toContainEqual(["eq", "tenant_id", MINE]);
  });
  it("does not let an earlier legacy alias read mask a subsequently missing canonical ID", async () => {
    const w = world({
      onRead: (table, filters) => { if (table === "growth_forms" && filters.some(([op, field]) => op === "in" && field === "id")) w.tables.growth_forms.length = 0; },
      tables: { growth_pages: [livePage({ draft_blocks_json: [nativeForm(), { type: "embedded_form", form_slug: "northwind-inquiry" }] })], growth_forms: [form()] },
    });
    const result = await w.call(publish);
    expect(result.body.fingerprint).toBeUndefined();
    expect(checks(result.body).find(c => c.key === "forms_exist")).toMatchObject({ ok: false });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });
  it.each([
    ["missing", []],
    ["archived", [form({ status: "archived" })]],
    ["foreign", [form({ tenant_id: THEIRS })]],
    ["same slug, different ID", [form({ id: OTHER_FORM })]],
    ["malformed status", [form({ status: null })]],
  ])("refuses a %s canonical resource before creating an approval", async (_label, growth_forms) => {
    const w = world({ tables: { growth_pages: [livePage({ draft_blocks_json: [nativeForm()] })], growth_forms } });
    const result = await w.call(publish);
    expect(result.body.fingerprint).toBeUndefined();
    expect(result.body.ok).toBe(false);
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
    expect(w.executorCalls()).toHaveLength(0);
  });
  it("leaves an existing approval unspent if its actual form disappears before redemption", async () => {
    const w = world({ tables: { growth_pages: [livePage({ draft_blocks_json: [nativeForm()] })], growth_forms: [form()] } });
    const first = await w.call(publish);
    expect(first.body.fingerprint).toEqual(expect.any(String));
    w.tables.growth_forms.length = 0;
    const result = await w.call({ ...publish, approved_fingerprint: first.body.fingerprint });
    expect(result.body).toMatchObject({ ok: false, outcome: "not_ready" });
    expect(w.tables.paige_pending_confirmations[0].consumed_at).toBeNull();
    expect(w.executorCalls()).toHaveLength(0);
  });
  it("refuses an unreadable canonical resource without spending an existing approval", async () => {
    const readErrors: string[] = [];
    const w = world({ readErrors, tables: { growth_pages: [livePage({ draft_blocks_json: [nativeForm()] })], growth_forms: [form()] } });
    const first = await w.call(publish);
    readErrors.push("growth_forms");
    const result = await w.call({ ...publish, approved_fingerprint: first.body.fingerprint });
    expect(result).toMatchObject({ status: 503, body: { code: "READINESS_UNAVAILABLE" } });
    expect(w.tables.paige_pending_confirmations[0].consumed_at).toBeNull();
    expect(w.executorCalls()).toHaveLength(0);
  });
  it("uses the saved draft's references rather than forms removed from the live copy", async () => {
    const w = world({ readErrors: ["growth_forms"], tables: { growth_pages: [livePage({ status: "published", blocks_json: [nativeForm()], draft_blocks_json: [{ type: "hero", title: "Current saved copy" }] })] } });
    expect((await w.call(publish)).body.fingerprint).toEqual(expect.any(String));
    expect(w.seen.reads.filter(r => r.table === "growth_forms")).toHaveLength(0);
  });
  it("does not add a form-read gate to taking a page offline", async () => {
    const w = world({ readErrors: ["growth_forms"], tables: { growth_pages: [livePage({ status: "published", blocks_json: [nativeForm()], draft_blocks_json: [nativeForm()] })], growth_funnels: [], growth_funnel_steps: [] } });
    expect((await w.call({ action: "unpublish", kind: "page", id: PAGE })).body.fingerprint).toEqual(expect.any(String));
    expect(w.seen.reads.filter(r => r.table === "growth_forms")).toHaveLength(0);
  });
});

describe("original form unpublish inspects live canonical dependencies", () => {
  it.each([
    ["a live canonical form ID", { status: "published", blocks_json: [nativeForm()], draft_blocks_json: [] }],
    ["a still-live form removed only from draft", { status: "published", blocks_json: [nativeForm()], draft_blocks_json: [{ type: "hero", title: "Draft without the form" }] }],
    ["the retained live legacy slug", { status: "published", blocks_json: [{ type: "embedded_form", form_slug: "northwind-inquiry" }], draft_blocks_json: [] }],
  ])("blocks %s before minting an approval", async (_label, page) => {
    const w = world({ tables: { growth_pages: [livePage({ title: "Northwind launch", ...page })], growth_forms: [form({ status: "active" })], growth_funnels: [], growth_funnel_steps: [] } });
    const result = await w.call(unpublish);
    expect(result.body.fingerprint).toBeUndefined();
    expect(checks(result.body).find(c => c.key === "not_in_use")).toMatchObject({ ok: false, detail: "Take “Northwind launch” offline first, then unpublish this." });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
    expect(w.executorCalls()).toHaveLength(0);
  });
  it.each([
    ["a draft-only page", { status: "draft", blocks_json: [nativeForm()], draft_blocks_json: [nativeForm()] }],
    ["a form added only to a live page's draft", { status: "published", blocks_json: [{ type: "hero", title: "Live copy" }], draft_blocks_json: [nativeForm()] }],
    ["another form ID", { status: "published", blocks_json: [nativeForm(OTHER_FORM)] }],
    ["another tenant", { tenant_id: THEIRS, status: "published", blocks_json: [nativeForm()] }],
  ])("does not block for %s", async (_label, page) => {
    const w = world({ tables: { growth_pages: [livePage(page)], growth_forms: [form({ status: "active" })], growth_funnels: [], growth_funnel_steps: [] } });
    expect((await w.call(unpublish)).body.fingerprint).toEqual(expect.any(String));
    for (const read of w.seen.reads.filter(r => r.table === "growth_pages")) expect(read.filters).toEqual(expect.arrayContaining([["eq", "tenant_id", MINE], ["eq", "status", "published"]]));
  });
});
