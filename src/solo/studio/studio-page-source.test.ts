import { describe, expect, it } from "vitest";
import { normalizeStudioLandingBlocks } from "../../../supabase/functions/_shared/growth/studio-landing-draft";
import { parseStudioPageSaveSource, sameStudioPageSaveSource } from "../../../supabase/functions/_shared/growth/studio-page-source";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const PAGE = "33333333-3333-4333-8333-333333333333";
const FORM = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const DATE = "2026-11-13T17:05:06.123456+00:00";
const context = () => ({ target: { kind: "workspace" }, values: { publicName: "Northwind", offers: "  Editorial services  ", primaryColor: "", tagline: "   " }, template_id: "nexus-editorial-landing-v1" });
const conversion = () => ({ type: "conversion", title: "Discuss your project", label: "Book a conversation", destination: { kind: "native_booking", slug: "northwind-intro" } });
const ref = (id = PAGE) => ({ kind: "page", id, title: "Northwind landing page", slug: "northwind", thumbnail_url: null, added_at: DATE });
const source = () => ({ ok: true, tenant_id: TENANT, session_id: SESSION, artifact_refs: [ref()], project_context: context(), page_id: PAGE, updated_at: DATE, conversion: conversion() });
const read = (raw: unknown, page: unknown = PAGE) => parseStudioPageSaveSource(TENANT, SESSION, page, raw);

describe("complete original Studio page save source", () => {
  it("preserves a selected business identity revision as expected state, without granting authority", () => {
    const raw = { ...source(), project_context: {
      target: { kind: "client", reference: OTHER, label: "Cedar Consulting" }, values: {},
      business_source: { id: OTHER, updated_at: DATE },
    } };
    expect(read(raw)).toEqual(raw);
    expect(read(raw)?.project_context.business_source).toEqual({ id: OTHER, updated_at: DATE });
    const later = { ...raw, project_context: { ...raw.project_context, business_source: { id: OTHER, updated_at: "2026-11-13T17:05:06.123457+00:00" } } };
    const original = read(raw), changed = read(later);
    expect(original && changed && sameStudioPageSaveSource(original, changed)).toBe(false);
  });

  it.each([
    ["workspace", { target: { kind: "workspace" }, values: {}, business_source: { id: OTHER, updated_at: DATE } }],
    ["custom", { target: { kind: "custom", reference: OTHER }, values: {}, business_source: { id: OTHER, updated_at: DATE } }],
    ["different target", { target: { kind: "client", reference: PAGE }, values: {}, business_source: { id: OTHER, updated_at: DATE } }],
    ["missing revision", { target: { kind: "client", reference: OTHER }, values: {}, business_source: { id: OTHER } }],
    ["invalid revision", { target: { kind: "client", reference: OTHER }, values: {}, business_source: { id: OTHER, updated_at: "latest" } }],
    ["invented verified flag", { target: { kind: "client", reference: OTHER }, values: {}, business_source: { id: OTHER, updated_at: DATE, verified: true } }],
    ["null source", { target: { kind: "client", reference: OTHER }, values: {}, business_source: null }],
  ])("refuses malformed business binding: %s", (_label, project_context) => {
    expect(read({ ...source(), project_context })).toBeNull();
  });

  it("admits the actual native tuple and preserves exact manifest/context/conversion data", () => {
    const raw = source();
    const admitted = read(raw);
    expect(admitted).toEqual(raw);
    expect(admitted?.project_context.values).toEqual(context().values);
    expect(admitted).not.toBe(raw);
    expect(admitted?.artifact_refs).not.toBe(raw.artifact_refs);
    expect(admitted?.project_context).not.toBe(raw.project_context);
  });

  it("admits an explicit new-page intent only with null page, revision and conversion", () => {
    const raw = { ...source(), artifact_refs: [], page_id: null, updated_at: null, conversion: null };
    expect(read(raw, null)).toEqual(raw);
    for (const change of [{ page_id: PAGE }, { updated_at: DATE }, { conversion: conversion() }]) expect(read({ ...raw, ...change }, null)).toBeNull();
    expect(read(raw, undefined)).toBeNull();
  });

  it.each([
    ["wrong tenant", { tenant_id: OTHER }],
    ["wrong session", { session_id: OTHER }],
    ["wrong page", { page_id: OTHER }],
    ["refused", { ok: false }],
    ["unavailable revision", { updated_at: null }],
    ["missing revision", { updated_at: undefined }],
    ["free-form revision", { updated_at: "2026-11-13 private note" }],
    ["impossible calendar date", { updated_at: "2026-02-30T17:05:06Z" }],
    ["invalid time", { updated_at: "2026-11-13T25:05:06Z" }],
    ["unknown field", { owner_email: "private@example.invalid" }],
    ["missing choice", { conversion: undefined }],
  ])("refuses %s without a fallback source", (_label, change) => {
    expect(read({ ...source(), ...change })).toBeNull();
  });

  it("requires valid explicit expected UUIDs and an original manifest-bound page", () => {
    for (const expected of [undefined, null, "northwind", "", "  " + TENANT]) expect(parseStudioPageSaveSource(expected, SESSION, PAGE, source())).toBeNull();
    expect(parseStudioPageSaveSource(TENANT, "session-label", PAGE, source())).toBeNull();
    expect(parseStudioPageSaveSource(TENANT, SESSION, undefined, source())).toBeNull();
    expect(read({ ...source(), artifact_refs: [] })).toBeNull();
    expect(read({ ...source(), artifact_refs: [ref(OTHER)] })).toBeNull();
    expect(read({ ...source(), artifact_refs: [{ ...ref(), kind: "form" }] })).toBeNull();
  });

  it("preserves authoritative cleared conversion and the exact original legacy form source", () => {
    expect(read({ ...source(), conversion: null })?.conversion).toBeNull();
    const legacy = { type: "embedded_form", form_slug: "northwind-intro", title: "Talk to Northwind" };
    const result = read({ ...source(), conversion: legacy });
    expect(result?.conversion).toEqual(legacy);
    const draft = normalizeStudioLandingBlocks([{ type: "hero", title: "Editorial services" }], null, result?.conversion);
    expect(draft.ok && draft.blocks.at(-1)).toEqual({ type: "embedded_form", form_slug: "northwind-intro" });
  });

  it.each([
    { type: "conversion", destination: { kind: "native_form", formId: FORM }, label: "x".repeat(61) },
    { ...conversion(), destination: { kind: "native_booking", slug: "../private" } },
    { ...conversion(), destination: { kind: "external_form", mode: "link", url: "javascript:alert(1)" } },
    { ...conversion(), vault: { token: "private" } },
    { type: "embedded_form", form_slug: "North Wind" },
    { type: "cta", title: "Not a saved source", href: "https://example.invalid" },
  ])("refuses malformed/noncanonical saved conversion %#", (value) => {
    expect(read({ ...source(), conversion: value })).toBeNull();
  });

  it("refuses unknown, duplicate, oversized and malformed manifest references instead of dropping them", () => {
    const invalid = [
      null, {}, [ref(), ref()], [{ ...ref(), kind: "unknown" }], [{ ...ref(), id: "page-label" }],
      [{ ...ref(), owner: { email: "private@example.invalid" } }], [{ ...ref(), title: "x".repeat(4001) }],
      [{ ...ref(), added_at: "yesterday" }], [{ ...ref(), thumbnail_url: { vault: "private" } }],
    ];
    for (const artifact_refs of invalid) expect(read({ ...source(), artifact_refs })).toBeNull();
  });

  it("refuses absent/legacy/unknown project targets and private nested values without inventing a workspace", () => {
    const invalid = [null, {}, { values: {} }, { ...context(), target: { kind: "client", label: "A label is not a target reference" } },
      { ...context(), target: { kind: "workspace", reference: "not-allowed" } },
      { ...context(), target: { kind: "custom", reference: "client-1", verified: true } },
      { ...context(), template_id: "unknown" }, { ...context(), owner: { email: "private@example.invalid" } },
      { ...context(), values: { ...context().values, Vault: "private" } },
      { ...context(), values: { ...context().values, offers: "api_key=private-secret-value" } },
      { ...context(), values: { ...context().values, offers: "private@example.invalid" } },
      { ...context(), values: { ...context().values, offers: "x".repeat(4001) } },
      { ...context(), values: { ...context().values, primaryColor: "blue" } },
    ];
    for (const project_context of invalid) expect(read({ ...source(), project_context })).toBeNull();
  });

  it("preserves explicit custom project data without adding workspace or authority fields", () => {
    const project_context = { target: { kind: "client", reference: "client-1", label: "Northwind client" }, values: { publicName: "Client business", primaryColor: "", offers: "\n" } };
    expect(read({ ...source(), project_context })?.project_context).toEqual(project_context);
  });

  it("preserves source UUID spelling and blank optional source text rather than rewriting CAS input", () => {
    const raw = { ...source(), tenant_id: TENANT.toUpperCase(), artifact_refs: [{ ...ref(), title: "", slug: null }], conversion: { ...conversion(), title: "", description: " " } };
    expect(read(raw)).toEqual(raw);
  });

  it("does not mutate frozen input and detaches every admitted nested structure", () => {
    const raw = source();
    const freeze = (value: unknown): void => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
    freeze(raw);
    const result = read(raw)!;
    result.project_context.values!.publicName = "Changed locally";
    result.artifact_refs[0].title = "Changed locally";
    expect(raw.project_context.values.publicName).toBe("Northwind");
    expect(raw.artifact_refs[0].title).toBe("Northwind landing page");
  });

  it("refuses non-JSON optional values and accessors rather than normalizing or evaluating them", () => {
    expect(read({ ...source(), conversion: { ...conversion(), title: undefined } })).toBeNull();
    let getterCalls = 0;
    const chosen = { ...conversion(), get destination() { getterCalls += 1; return { kind: "native_booking", slug: "northwind-intro" }; } };
    expect(read({ ...source(), conversion: chosen })).toBeNull();
    expect(getterCalls).toBe(0);
  });
});

describe("full source comparison before original atomic save", () => {
  it("ignores object-key serialization order but preserves exact blank edits and ordered manifest", () => {
    const before = read(source())!;
    const raw = source();
    const reordered = { conversion: raw.conversion, updated_at: raw.updated_at, page_id: raw.page_id, project_context: { values: raw.project_context.values, template_id: raw.project_context.template_id, target: raw.project_context.target }, artifact_refs: raw.artifact_refs, session_id: raw.session_id, tenant_id: raw.tenant_id, ok: true };
    expect(sameStudioPageSaveSource(before, read(reordered)!)).toBe(true);
    const twoRefs = read({ ...source(), artifact_refs: [ref(), { ...ref(OTHER), kind: "form" }] })!;
    const reversed = read({ ...source(), artifact_refs: [...twoRefs.artifact_refs].reverse() })!;
    expect(sameStudioPageSaveSource(twoRefs, reversed)).toBe(false);
  });

  it.each([
    ["revision", () => ({ ...source(), updated_at: "2026-11-13T17:05:07Z" })],
    ["saved conversion", () => ({ ...source(), conversion: null })],
    ["manifest title", () => ({ ...source(), artifact_refs: [{ ...ref(), title: "Renamed" }] })],
    ["manifest membership", () => ({ ...source(), artifact_refs: [ref(), { ...ref(OTHER), kind: "form" }] })],
    ["target", () => ({ ...source(), project_context: { ...context(), target: { kind: "custom", reference: "client-1" } } })],
    ["explicit blank", () => ({ ...source(), project_context: { ...context(), values: { ...context().values, primaryColor: "#123456" } } })],
    ["whitespace edit", () => ({ ...source(), project_context: { ...context(), values: { ...context().values, offers: "Editorial services" } } })],
    ["removed edit", () => ({ ...source(), project_context: { ...context(), values: { publicName: "Northwind" } } })],
  ])("detects changed %s even when the page/conversion identity otherwise matches", (_label, change) => {
    expect(sameStudioPageSaveSource(read(source())!, read(change())!)).toBe(false);
  });

  it("keeps the owner-selected destination through normalization and ignores model conversion output", () => {
    const current = read(source())!;
    const draft = normalizeStudioLandingBlocks([{ type: "hero", title: "Editorial services", cta_label: "Invented", cta_href: "https://example.invalid" }, { type: "embedded_form", form_slug: "invented-form" }], null, current.conversion);
    expect(draft.ok && draft.blocks).toEqual([{ type: "hero", title: "Editorial services" }, current.conversion]);
    const cleared = normalizeStudioLandingBlocks([{ type: "hero", title: "Editorial services" }, conversion()], null, read({ ...source(), conversion: null })!.conversion);
    expect(cleared.ok && cleared.blocks).toEqual([{ type: "hero", title: "Editorial services" }]);
  });
});
