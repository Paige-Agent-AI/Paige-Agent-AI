// @vitest-environment node
// The door's five acts that only the Studio panel performed before V2b — page/form/funnel unpublish and
// image publish/unpublish — driven through the REAL handler with their risk class present.
//
// Their real risk class (Migration E, action-risk.ts) and real declarations (STUDIO_PUBLISH_KIT_BY_ACTION)
// are used — nothing here is mocked but the two Supabase clients.
import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { FORM, FUNNEL, IMAGE, MINE, PAGE, livePage, serverCall, world } from "./growth-publish-door.world.ts";

it("the five door-only acts are classified high by the canonical policy", () => {
  for (const k of ["growth_page_unpublish", "growth_form_unpublish", "growth_funnel_unpublish", "studio_image_publish", "studio_image_unpublish"]) {
    expect(classifyAction(k)).toBe("high");
  }
});

async function approve(w: ReturnType<typeof world>, body: Record<string, unknown>) {
  const first = await w.call(body);
  return { first, second: first.status === 202 ? await w.call({ ...body, approved_fingerprint: first.body.fingerprint }) : null };
}

describe("growth-publish-command — unpublish and image through the one door", () => {
  it("unpublishes a live page: proposal, claim, the stored call, a readback that it came down, one receipt", async () => {
    const w = world({ tables: { growth_pages: [livePage({ status: "published", blocks_json: [{ type: "hero" }] })] },
      rpc: (_fn, a) => ({ data: { id: a.p_id, status: "draft" }, error: null }) });
    const body = { action: "unpublish", kind: "page", id: PAGE };
    const { first, second } = await approve(w, body);
    expect(first.body).toMatchObject({ approval_required: true, capability: "growth_page_unpublish", preview: { action: "unpublish", checks: [{ key: "is_live", ok: true }, { key: "not_in_use", ok: true }] } });
    expect(String(first.body.summary)).toMatch(/offline/);
    expect(second).toMatchObject({ status: 200, body: { ok: true, action: "unpublish", kind: "page", id: PAGE, status: "draft" } });
    expect(second!.body.url).toBeUndefined();
    expect(w.executorCalls()).toEqual([serverCall("growth_page_unpublish", PAGE)]);
    expect(w.seen.receipts).toEqual([expect.objectContaining({ _capability_key: "growth_page_unpublish", _outcome: "capability_succeeded", _detail: expect.objectContaining({ approval: "operator_card" }) })]);
  });

  it("an unpublish whose readback still says live is unverified, never success", async () => {
    const w = world({ tables: { growth_pages: [livePage({ status: "published" })] }, rpc: (_fn, a) => ({ data: { id: a.p_id, status: "published" }, error: null }) });
    const { second } = await approve(w, { action: "unpublish", kind: "page", id: PAGE });
    expect(second).toMatchObject({ status: 200, body: { ok: false, outcome: "unverified" } });
    expect(w.seen.receipts).toEqual([expect.objectContaining({ _outcome: "capability_outcome_unknown" })]);
  });

  it("nothing to take down: a draft has no unpublish to approve", async () => {
    const w = world();
    const r = await w.call({ action: "unpublish", kind: "page", id: PAGE });
    expect(r).toMatchObject({ status: 202, body: { outcome: "not_ready", approval_required: true } });
    expect(r.body.fingerprint).toBeUndefined();
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });

  it("a form still in use is refused in the server's words, without its code", async () => {
    const w = world({ tables: { growth_forms: [{ id: FORM, tenant_id: MINE, name: "Intake", slug: "intake", status: "active" }] },
      rpc: () => ({ data: null, error: { code: "22023", message: 'GROWTH_FORM_IN_USE: "Spring offer" is live and collects through this form — unpublish it first' } }) });
    const { second } = await approve(w, { action: "unpublish", kind: "form", id: FORM });
    expect(second).toMatchObject({ status: 409, body: { refused: true, error: '"Spring offer" is live and collects through this form — unpublish it first.' } });
    expect(w.seen.receipts).toEqual([expect.objectContaining({ _capability_key: "growth_form_unpublish", _outcome: "capability_refused" })]);
  });

  it("unpublishes a live funnel under its own key", async () => {
    const w = world({ tables: { growth_funnels: [{ id: FUNNEL, tenant_id: MINE, name: "Launch", slug: "launch", status: "active" }] },
      rpc: (_fn, a) => ({ data: { id: a.p_id, status: "draft" }, error: null }) });
    const { second } = await approve(w, { action: "unpublish", kind: "funnel", id: FUNNEL });
    expect(second!.body).toMatchObject({ ok: true, status: "draft" });
    expect(w.executorCalls()[0].fn).toBe("growth_funnel_unpublish");
  });

  it("publishes and unpublishes an image, filed under the image keys with its content id", async () => {
    const pub = world({ rpc: (_fn, a) => ({ data: { id: a.p_id, status: "published", published_at: "2026-10-04T10:00:00Z", url: "https://cdn.test/a.png" }, error: null }) });
    const p = await approve(pub, { action: "publish", kind: "image", id: IMAGE });
    expect(p.first.body).toMatchObject({ preview: { kind: "image", title: "Hero shot", address: "https://cdn.test/a.png" } });
    expect(p.second!.body).toMatchObject({ ok: true, url: "https://cdn.test/a.png" });
    expect(pub.seen.receipts[0]).toMatchObject({ _capability_key: "studio_image_publish", _detail: { content_id: IMAGE } });

    const un = world({ tables: { marketing_content: [{ id: IMAGE, tenant_id: MINE, title: "Hero shot", kind: "image", image_url: "https://cdn.test/a.png", status: "published" }] },
      rpc: (_fn, a) => ({ data: { id: a.p_id, status: "draft" }, error: null }) });
    expect((await approve(un, { action: "unpublish", kind: "image", id: IMAGE })).second!.body).toMatchObject({ ok: true, status: "draft" });
    expect(un.seen.receipts[0]).toMatchObject({ _capability_key: "studio_image_unpublish" });
  });

  // The Studio panel's contract (Builder D, 2026-10-04): an unpublish gets a real prepare, and what the
  // unpublish RPC would refuse — a live funnel using the page, a live page or funnel collecting through
  // the form — comes back as a failed check with a plain detail and NO fingerprint.
  const checksOf = (r: { body: Record<string, unknown> }) => (r.body.preview as { checks: Array<{ key: string; ok: boolean; label: string; detail?: string }> }).checks;
  const ACTIVE_FUNNEL = (over: Record<string, unknown> = {}) => ({ id: FUNNEL, tenant_id: MINE, name: "Free strategy call", slug: "call", status: "active", entry_page_id: null, success_page_id: null, ...over });
  it.each([
    ["a live funnel's entry page", { growth_funnels: [ACTIVE_FUNNEL({ entry_page_id: PAGE })], growth_funnel_steps: [] }],
    ["a page in a live funnel's steps", { growth_funnels: [ACTIVE_FUNNEL()], growth_funnel_steps: [{ funnel_id: FUNNEL, tenant_id: MINE, step_type: "page", page_id: PAGE, form_id: null }] }],
  ])("unpublishing %s is blocked before anyone approves it", async (_l, tables) => {
    const w = world({ tables: { growth_pages: [livePage({ status: "published" })], ...tables } });
    const r = await w.call({ action: "unpublish", kind: "page", id: PAGE });
    expect(r).toMatchObject({ status: 202, body: { approval_required: true, outcome: "not_ready" } });
    expect(r.body.fingerprint).toBeUndefined();
    expect(checksOf(r).find((c) => c.key === "not_in_use")).toEqual({ key: "not_in_use", ok: false, blocking: true,
      label: "A live funnel uses this page", detail: "Take \u201cFree strategy call\u201d offline first, then unpublish this." });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });

  it("a draft funnel using the page does not block its unpublish", async () => {
    const w = world({ tables: { growth_pages: [livePage({ status: "published" })], growth_funnels: [ACTIVE_FUNNEL({ status: "draft", entry_page_id: PAGE })] } });
    const r = await w.call({ action: "unpublish", kind: "page", id: PAGE });
    expect(r.body.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(checksOf(r).find((c) => c.key === "not_in_use")).toMatchObject({ ok: true });
  });

  it.each([
    ["a live page that collects through it", { growth_pages: [livePage({ title: "Referral workshop", status: "published", blocks_json: [{ type: "embedded_form", form_slug: "intake" }] })], growth_funnel_steps: [] }, "A live page collects through this form", "Referral workshop"],
    ["a live funnel step", { growth_funnels: [ACTIVE_FUNNEL()], growth_funnel_steps: [{ funnel_id: FUNNEL, tenant_id: MINE, step_type: "form", page_id: null, form_id: FORM }] }, "A live funnel collects through this form", "Free strategy call"],
  ])("unpublishing a form used by %s is blocked with a plain reason", async (_l, tables, label, name) => {
    const w = world({ tables: { growth_forms: [{ id: FORM, tenant_id: MINE, name: "Intake", slug: "intake", status: "active" }], ...tables } });
    const r = await w.call({ action: "unpublish", kind: "form", id: FORM });
    expect(r.body.fingerprint).toBeUndefined();
    expect(checksOf(r).find((c) => c.key === "not_in_use")).toMatchObject({ ok: false, label, detail: `Take \u201c${name}\u201d offline first, then unpublish this.` });
  });

  it("prepare never acts, even on an auto lane, for publish or unpublish", async () => {
    const w = world({ lane: "auto", tables: { growth_pages: [livePage({ status: "published" })] }, rpc: (_fn, a) => ({ data: { id: a.p_id, status: "draft" }, error: null }) });
    expect((await w.call({ action: "unpublish", kind: "page", id: PAGE })).body).toMatchObject({ approval_required: true });
    expect((await w.call({ action: "publish", kind: "image", id: IMAGE })).body).toMatchObject({ approval_required: true });
    expect(w.executorCalls()).toHaveLength(0);
  });

  it("every check label and detail is a plain sentence — no codes, keys or table names", async () => {
    const bodies = [
      await world({ tables: { growth_pages: [livePage({ draft_blocks_json: [{ type: "embedded_form", form_slug: "ghost" }, { type: "hero", title: "[ADD_DATE]" }] })], tenants: [{ id: MINE, slug: "" }] } }).call({ action: "publish", kind: "page", id: PAGE }),
      await world({ tables: { growth_forms: [{ id: FORM, tenant_id: MINE, name: "Intake", slug: "intake", status: "draft", draft_schema_json: { sections: [] } }] } }).call({ action: "publish", kind: "form", id: FORM }),
      await world({ tables: { growth_funnel_steps: [{ funnel_id: FUNNEL, tenant_id: MINE, step_type: "form", page_id: null, form_id: null }] } }).call({ action: "publish", kind: "funnel", id: FUNNEL }),
      await world({ tables: { marketing_content: [{ id: IMAGE, tenant_id: MINE, title: "x", kind: "document", image_url: null, status: "draft" }] } }).call({ action: "publish", kind: "image", id: IMAGE }),
      await world({ tables: { growth_pages: [livePage({ status: "published" })], growth_funnels: [ACTIVE_FUNNEL({ entry_page_id: PAGE })] } }).call({ action: "unpublish", kind: "page", id: PAGE }),
    ];
    for (const r of bodies) for (const c of checksOf(r)) {
      // A bracketed example such as [ADD_DATE] is the owner's own page text, quoted so they can find it.
      for (const text of [c.label, c.detail ?? ""].map((t) => t.replace(/\[[A-Z_]+\]/g, ""))) expect(text).not.toMatch(/GROWTH_|[a-z]+_[a-z]+|\b[A-Z]{2,}_|SQLSTATE|\buuid\b/);
    }
  });

  it("copy and an image with no file have nothing to approve", async () => {
    const copy = world({ tables: { marketing_content: [{ id: IMAGE, tenant_id: MINE, title: "Post", kind: "copy", image_url: null, status: "draft" }] } });
    const r = await copy.call({ action: "publish", kind: "image", id: IMAGE });
    expect(r.body).toMatchObject({ outcome: "not_ready" });
    expect((r.body.preview as { checks: Array<{ key: string; ok: boolean }> }).checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(["is_image", "has_file"]);
  });
});
