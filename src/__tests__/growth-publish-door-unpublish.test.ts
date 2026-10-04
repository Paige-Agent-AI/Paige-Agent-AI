// @vitest-environment node
// The door's five acts that only the Studio panel performed before V2b — page/form/funnel unpublish and
// image publish/unpublish — driven through the REAL handler with their risk class present.
//
// Their real risk class (Migration E, action-risk.ts) and real declarations (STUDIO_PUBLISH_KIT_BY_ACTION)
// are used — nothing here is mocked but the two Supabase clients.
import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { FORM, FUNNEL, IMAGE, MINE, PAGE, livePage, world } from "./growth-publish-door.world.ts";

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
    expect(first.body).toMatchObject({ approval_required: true, capability: "growth_page_unpublish", preview: { action: "unpublish", checks: [{ key: "is_live", ok: true }] } });
    expect(String(first.body.summary)).toMatch(/offline/);
    expect(second).toMatchObject({ status: 200, body: { ok: true, action: "unpublish", kind: "page", id: PAGE, status: "draft" } });
    expect(second!.body.url).toBeUndefined();
    expect(w.executorCalls()).toEqual([{ fn: "growth_page_unpublish", args: { p_tenant_id: null, p_id: PAGE }, client: "caller" }]);
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
    expect(r).toMatchObject({ status: 200, body: { outcome: "not_ready", approval_required: false } });
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

  it("copy and an image with no file have nothing to approve", async () => {
    const copy = world({ tables: { marketing_content: [{ id: IMAGE, tenant_id: MINE, title: "Post", kind: "copy", image_url: null, status: "draft" }] } });
    const r = await copy.call({ action: "publish", kind: "image", id: IMAGE });
    expect(r.body).toMatchObject({ outcome: "not_ready" });
    expect((r.body.preview as { checks: Array<{ key: string; ok: boolean }> }).checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(["is_image", "has_file"]);
  });
});
