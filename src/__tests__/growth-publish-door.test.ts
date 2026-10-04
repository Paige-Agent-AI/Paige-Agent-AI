// @vitest-environment node
// THE ONE PUBLISH DOOR (growth-publish-command, Vibe Studio V2b). The Studio Publish panel and
// Paige's chat both publish through this handler, so its governance is proven here once: who may
// call it, the autonomy lane, the server readiness checks, the server-issued proposal, the atomic
// single-use claim that runs the STORED call, the readback, and exactly one receipt.
//
// These drive the REAL handler with in-memory doubles for the two Supabase clients
// (growth-publish-door.world.ts). Not authenticated runtime proof against Supabase.
import { describe, expect, it } from "vitest";
import { classifyAction } from "../../supabase/functions/_shared/action-risk.ts";
import { confirmFingerprint } from "../../supabase/functions/_shared/confirm-fingerprint.ts";
import { FORM, FUNNEL, IMAGE, MINE, OTHER_USER, PAGE, THEIRS, USER, livePage, pagePublished, world } from "./growth-publish-door.world.ts";

const publishPage = { action: "publish", kind: "page", id: PAGE };

async function approve(w: ReturnType<typeof world>, body: Record<string, unknown> = publishPage) {
  const first = await w.call(body);
  expect(first.status).toBe(202);
  return { first, second: await w.call({ ...body, approved_fingerprint: first.body.fingerprint }) };
}

describe("growth-publish-command — who may publish", () => {
  it("refuses an unauthenticated caller before reading anything", async () => {
    const w = world({ user: null });
    const r = await w.call(publishPage);
    expect(r.status).toBe(401);
    expect(w.seen.reads).toHaveLength(0);
    expect(w.seen.receipts).toHaveLength(0);
  });

  it("refuses a caller who is not the workspace's owner, admin or managing agency", async () => {
    const w = world({ admin: false, manages: false });
    const r = await w.call(publishPage);
    expect(r).toMatchObject({ status: 403, body: { ok: false, refused: true, forbidden: true, code: "NOT_ADMIN" } });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
    expect(w.executorCalls()).toHaveLength(0);
  });

  it("lets the managing agency through, by the same rule", async () => {
    const w = world({ admin: false, manages: true });
    expect((await w.call(publishPage)).status).toBe(202);
  });

  it("refuses a body tenant naming another workspace rather than swapping to it", async () => {
    const w = world();
    const r = await w.call({ ...publishPage, expected_tenant_id: THEIRS });
    expect(r).toMatchObject({ status: 403, body: { code: "OTHER_WORKSPACE" } });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });

  it("refuses a malformed or open-ended body", async () => {
    const w = world();
    for (const body of [{ ...publishPage, kind: "copy" }, { ...publishPage, id: "33333333" }, { ...publishPage, tenant_id: MINE }, { ...publishPage, approved_fingerprint: "nope" }]) {
      expect((await w.call(body)).status).toBe(400);
    }
    expect(w.seen.reads).toHaveLength(0);
  });

  it("does not show another workspace's artifact: it is simply not in this workspace", async () => {
    const w = world({ tables: { growth_pages: [livePage({ tenant_id: THEIRS })] } });
    const r = await w.call(publishPage);
    expect(r).toMatchObject({ status: 404, body: { code: "ARTIFACT_NOT_FOUND" } });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });
});

describe("growth-publish-command — the autonomy lane", () => {
  it("off: refuses with disabled, files one refused receipt, and leaves an offered approval unspent", async () => {
    const w = world();
    const first = await w.call(publishPage);
    const off = world({ lane: "off", tables: { paige_pending_confirmations: w.tables.paige_pending_confirmations } });
    const r = await off.call({ ...publishPage, approved_fingerprint: first.body.fingerprint });
    expect(r).toMatchObject({ status: 403, body: { ok: false, disabled: true, refused: true } });
    expect(off.executorCalls()).toHaveLength(0);
    expect(off.tables.paige_pending_confirmations[0].consumed_at).toBeNull();
    expect(off.seen.receipts).toHaveLength(1);
    expect(off.seen.receipts[0]).toMatchObject({ _capability_key: "growth_page_publish", _outcome: "capability_refused", _tenant_id: MINE, _actor_id: USER });
  });

  it("an unreadable lane refuses rather than guessing one", async () => {
    const w = world({ laneError: true });
    const r = await w.call(publishPage);
    expect(r).toMatchObject({ status: 403, body: { code: "autonomy_lane_unrecognized" } });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });

  it("an unreadable lane leaves an offered approval unspent", async () => {
    const w = world();
    const first = await w.call(publishPage);
    const broken = world({ laneError: true, rpc: () => ({ data: null, error: null }), tables: { paige_pending_confirmations: w.tables.paige_pending_confirmations } });
    const r = await broken.call({ ...publishPage, approved_fingerprint: first.body.fingerprint });
    expect(r).toMatchObject({ status: 403, body: { code: "autonomy_lane_unrecognized" } });
    expect(broken.tables.paige_pending_confirmations[0].consumed_at).toBeNull();
    expect(broken.executorCalls()).toHaveLength(0);
  });

  it("auto never runs a high-risk publish unattended: it still proposes", async () => {
    expect(classifyAction("growth_page_publish")).toBe("high");
    const w = world({ lane: "auto", rpc: pagePublished });
    expect((await w.call(publishPage)).status).toBe(202);
    expect(w.executorCalls()).toHaveLength(0);
  });
});

describe("growth-publish-command — the proposal", () => {
  it("returns 202 with a fingerprint and a preview, stores a thread-less server-issued proposal, and files no receipt", async () => {
    const w = world();
    const r = await w.call(publishPage);
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ ok: false, approval_required: true, capability: "growth_page_publish" });
    expect(r.body.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(r.body.preview).toMatchObject({ kind: "page", id: PAGE, title: "Spring offer", action: "publish", address: "/p/acme/spring-offer" });
    expect((r.body.preview as { checks: unknown[] }).checks.every((c) => (c as { ok: boolean; blocking: boolean }).ok || !(c as { blocking: boolean }).blocking)).toBe(true);
    const [row] = w.tables.paige_pending_confirmations;
    expect(row).toMatchObject({ user_id: USER, tenant_id: MINE, tool_name: "growth_page_publish", thread_id: null, scoped_client_id: null, consumed_at: null, fingerprint: r.body.fingerprint });
    expect(row.server_issued_at).toBeTruthy();
    expect(row.args).toMatchObject({ action: "publish", kind: "page", id: PAGE, expected_tenant_id: MINE });
    expect(r.body.fingerprint).toBe(await confirmFingerprint("growth_page_publish", row.args as Record<string, unknown>));
    expect(w.executorCalls()).toHaveLength(0);
    expect(w.seen.receipts).toHaveLength(0);
    expect(w.tables.paige_audit_log.at(-1)).toMatchObject({ action: "studio.publish_governed_decision", tenant_id: MINE, payload: { decision: "propose", capability: "growth_page_publish" } });
  });

  it("asking twice shows one card, not two", async () => {
    const w = world();
    const a = await w.call(publishPage), b = await w.call(publishPage);
    expect(a.body.fingerprint).toBe(b.body.fingerprint);
    expect(w.tables.paige_pending_confirmations).toHaveLength(1);
  });

  it.each([
    ["an empty page", { growth_pages: [livePage({ draft_blocks_json: [] })] }, "has_sections"],
    ["an unfilled placeholder", { growth_pages: [livePage({ draft_blocks_json: [{ type: "hero", title: "Join us on [ADD_WEBINAR_DATE]" }] })] }, "no_placeholders"],
    ["a placeholder word", { growth_pages: [livePage({ draft_blocks_json: [{ type: "hero", title: "Hi [your name here]" }] })] }, "no_placeholders"],
    ["a signup section with no form", { growth_pages: [livePage({ draft_blocks_json: [{ type: "embedded_form" }] })] }, "signup_has_form"],
    ["a signup form that does not exist", { growth_pages: [livePage({ draft_blocks_json: [{ type: "embedded_form", form_slug: "ghost" }] })] }, "forms_exist"],
    ["nothing saved yet", { growth_pages: [livePage({ draft_blocks_json: null })] }, "has_sections"],
    ["an archived page", { growth_pages: [livePage({ status: "archived" })] }, "not_archived"],
    ["no public address", { tenants: [{ id: MINE, slug: "" }] }, "public_address"],
  ])("a failed blocking check (%s) returns the preview with no fingerprint and nothing to approve", async (_label, tables, key) => {
    const w = world({ tables });
    const r = await w.call(publishPage);
    expect(r).toMatchObject({ status: 202, body: { ok: false, outcome: "not_ready", approval_required: true } });
    expect(r.body.fingerprint).toBeUndefined();
    const check = (r.body.preview as { checks: Array<{ key: string; ok: boolean; blocking: boolean }> }).checks.find((c) => c.key === key);
    expect(check).toMatchObject({ ok: false, blocking: true });
    expect(String(r.body.error)).not.toMatch(/GROWTH_|SQLSTATE|_publish/);
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
    expect(w.seen.receipts).toHaveLength(0);
  });

  // FAITHFUL TO THE SERVER, INCLUDING ITS DEFECT. _growth_page_go_live's word pattern runs over the
  // blocks' JSON text, whose own outer brackets enclose ordinary copy — so "Get your weekends back"
  // is refused as a placeholder. Measured on production 2026-10-04 (the same expression returns true
  // for that text and false for "Get the weekends back"). The card must never say "ready" for a page
  // the server will refuse, so the mirror refuses it too; fixing the pattern is a migration.
  it("mirrors the server's placeholder pattern exactly, even where it over-matches ordinary copy", async () => {
    const w = world({ tables: { growth_pages: [livePage({ draft_blocks_json: [{ type: "hero", title: "Get your weekends back" }] })] } });
    expect((await w.call(publishPage)).body).toMatchObject({ outcome: "not_ready" });
  });

  it("an existing form on the page passes; a non-blocking form gap is a warning, not a refusal", async () => {
    const page = livePage({ draft_blocks_json: [{ type: "embedded_form", form_slug: "intake" }] });
    expect((await world({ tables: { growth_pages: [page] } }).call(publishPage)).status).toBe(202);
    const noEmail = world({ tables: { growth_forms: [{ id: FORM, tenant_id: MINE, name: "Intake", slug: "intake", status: "draft",
      draft_schema_json: { sections: [{ fields: [{ key: "name" }] }] } }] } });
    const r = await noEmail.call({ action: "publish", kind: "form", id: FORM });
    expect(r.status).toBe(202);
    expect((r.body.preview as { checks: Array<{ key: string; ok: boolean }> }).checks.find((c) => c.key === "asks_email")).toMatchObject({ ok: false, blocking: false });
    const empty = world({ tables: { growth_forms: [{ id: FORM, tenant_id: MINE, name: "Intake", slug: "intake", status: "draft", draft_schema_json: { sections: [] } }] } });
    expect((await empty.call({ action: "publish", kind: "form", id: FORM })).body).toMatchObject({ outcome: "not_ready" });
  });

  it("a funnel step with nothing attached, and an image with no file, have nothing to approve", async () => {
    const f = world({ tables: { growth_funnel_steps: [{ funnel_id: FUNNEL, tenant_id: MINE, step_type: "form", page_id: null, form_id: null }] } });
    expect((await f.call({ action: "publish", kind: "funnel", id: FUNNEL })).body).toMatchObject({ outcome: "not_ready" });
    const none = world({ tables: { growth_funnel_steps: [] } });
    expect((await none.call({ action: "publish", kind: "funnel", id: FUNNEL })).body).toMatchObject({ outcome: "not_ready" });
    expect((await world().call({ action: "publish", kind: "funnel", id: FUNNEL })).status).toBe(202);
  });
});

describe("growth-publish-command — the claim and the act", () => {
  it("claims the stored proposal once, runs the STORED call on the caller's own client, proves it, and files one receipt", async () => {
    const w = world({ rpc: pagePublished });
    const { first, second } = await approve(w);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, action: "publish", kind: "page", id: PAGE, status: "published", url: "/p/acme/spring-offer",
      governance: { approval_channel: "operator_card", approved_fingerprint: first.body.fingerprint } });
    expect(w.executorCalls()).toEqual([{ fn: "growth_page_publish", args: { p_tenant_id: null, p_id: PAGE }, client: "caller" }]);
    expect(w.tables.paige_pending_confirmations[0].consumed_at).toBeTruthy();
    expect(w.seen.receipts).toHaveLength(1);
    expect(w.seen.receipts[0]).toMatchObject({ _capability_key: "growth_page_publish", _outcome: "capability_succeeded", _tenant_id: MINE, _actor_id: USER,
      _detail: { approval: "operator_card", page_id: PAGE, status: "published", door: "growth-publish-command" } });
  });

  it("the receipt's run id is stable per fingerprint, so a retried receipt folds to one row", async () => {
    const a = world({ rpc: pagePublished }), b = world({ rpc: pagePublished });
    await approve(a);
    // Same proposal row replayed into a fresh world: same key, tenant and fingerprint → same run id.
    b.tables.paige_pending_confirmations.push({ ...a.tables.paige_pending_confirmations[0], consumed_at: null });
    await b.call({ ...publishPage, approved_fingerprint: a.tables.paige_pending_confirmations[0].fingerprint });
    expect(b.seen.receipts[0]._run_id).toBe(a.seen.receipts[0]._run_id);
  });

  it("a replayed fingerprint is refused: nothing runs, no new card, no second receipt", async () => {
    const w = world({ rpc: pagePublished });
    const { first } = await approve(w);
    const replay = await w.call({ ...publishPage, approved_fingerprint: first.body.fingerprint });
    expect(replay).toMatchObject({ status: 409, body: { refused: true, code: "APPROVAL_NOT_AVAILABLE" } });
    expect(w.executorCalls()).toHaveLength(1);
    expect(w.tables.paige_pending_confirmations).toHaveLength(1);
    expect(w.seen.receipts).toHaveLength(1);
  });

  it("a fresh cycle after a used approval gets a new fingerprint, so the old one can never redeem it", async () => {
    const w = world({ rpc: pagePublished });
    const { first } = await approve(w);
    const again = await w.call(publishPage);
    expect(again.body.fingerprint).not.toBe(first.body.fingerprint);
    expect((await w.call({ ...publishPage, approved_fingerprint: first.body.fingerprint })).status).toBe(409);
    expect(w.executorCalls()).toHaveLength(1);
  });

  it("another person's approval, another workspace's, another act's or another artifact's is never claimable", async () => {
    const mint = world();
    const { body } = await mint.call(publishPage);
    const store = mint.tables.paige_pending_confirmations;
    const fp = body.fingerprint;
    const otherPerson = await world({ user: OTHER_USER, tables: { paige_pending_confirmations: store } }).call({ ...publishPage, approved_fingerprint: fp });
    const otherWorkspace = await world({ active: THEIRS, tables: { paige_pending_confirmations: store, growth_pages: [livePage({ tenant_id: THEIRS })] } })
      .call({ ...publishPage, approved_fingerprint: fp });
    const otherArtifact = await world({ tables: { paige_pending_confirmations: store, growth_pages: [livePage(), livePage({ id: "77777777-7777-4777-8777-777777777777" })] } })
      .call({ ...publishPage, id: "77777777-7777-4777-8777-777777777777", approved_fingerprint: fp });
    for (const r of [otherPerson, otherWorkspace, otherArtifact]) expect(r).toMatchObject({ status: 409, body: { code: "APPROVAL_NOT_AVAILABLE" } });
    // Another act: the tool key names the act, so a publish approval cannot be spent on an unpublish.
    const otherAct = await world({ tables: { paige_pending_confirmations: store, growth_pages: [livePage({ status: "published" })] } })
      .call({ action: "unpublish", kind: "page", id: PAGE, approved_fingerprint: fp });
    expect(otherAct).toMatchObject({ status: 409, body: { code: "APPROVAL_NOT_AVAILABLE" } });
    expect(store[0].consumed_at).toBeNull();
  });

  it("a workspace switched between the claim and the act runs nothing and is refused", async () => {
    const w = world({ rpc: pagePublished });
    const first = await w.call(publishPage);
    const switched = world({ rpc: pagePublished, switchAfter: 2, tables: { paige_pending_confirmations: w.tables.paige_pending_confirmations } });
    const r = await switched.call({ ...publishPage, approved_fingerprint: first.body.fingerprint });
    expect(r).toMatchObject({ status: 409, body: { code: "WORKSPACE_CHANGED" } });
    expect(switched.executorCalls()).toHaveLength(0);
  });

  it("a publish whose readback proves no live address is unverified — recorded as unknown, never as success", async () => {
    const w = world({ rpc: (_fn, args) => ({ data: { id: args.p_id, status: "published", published_at: "2026-10-04T10:00:00Z", url: null }, error: null }) });
    const { second } = await approve(w);
    expect(second).toMatchObject({ status: 200, body: { ok: false, outcome: "unverified" } });
    expect(w.seen.receipts).toEqual([expect.objectContaining({ _outcome: "capability_outcome_unknown" })]);
  });

  it.each([
    ["42501", 403, "GROWTH_FORBIDDEN: the workspace owner or an admin is required", "Only this workspace's owner or an admin can do that."],
    ["22023", 409, "GROWTH_UNRESOLVED_PLACEHOLDER: page has unresolved editable placeholders — fill them before publishing", "Page has unresolved editable placeholders — fill them before publishing."],
    ["P0002", 409, "GROWTH_NOT_FOUND: page not found in this tenant", "Page not found in this tenant."],
  ])("an RPC refusal (%s) is a plain sentence with no machine code, and a refused receipt", async (code, status, message, sentence) => {
    const w = world({ rpc: () => ({ data: null, error: { code, message } }) });
    const { second } = await approve(w);
    expect(second).toMatchObject({ status, body: { ok: false, refused: true, error: sentence } });
    expect(String(second.body.error)).not.toMatch(/GROWTH_|42501|22023|P0002/);
    expect(w.seen.receipts).toEqual([expect.objectContaining({ _outcome: "capability_refused" })]);
  });

  it("an answer that never came back is unknown, never 'nothing changed'", async () => {
    const w = world({ rpc: () => { throw new Error("fetch failed: connection reset"); } });
    const { second } = await approve(w);
    expect(second).toMatchObject({ status: 503, body: { ok: false, outcome: "outcome_unknown" } });
    expect(w.seen.receipts).toEqual([expect.objectContaining({ _outcome: "capability_outcome_unknown" })]);
  });

  it("will not act without recording its decision", async () => {
    const w = world({ auditFails: true, rpc: pagePublished });
    const r = await w.call(publishPage);
    expect(r).toMatchObject({ status: 503, body: { code: "DECISION_RECEIPT_FAILED" } });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
  });

  it("form and funnel publish through the same door with their own keys and live states", async () => {
    const f = world({ rpc: (_fn, a) => ({ data: { id: a.p_id, status: "active", published_at: "2026-10-04T10:00:00Z", url: `/form/${a.p_id}` }, error: null }) });
    const formBody = { action: "publish", kind: "form", id: FORM };
    expect((await approve(f, formBody)).second.body).toMatchObject({ ok: true, url: `/form/${FORM}` });
    expect(f.executorCalls()[0].fn).toBe("growth_form_publish");
    const fu = world({ rpc: (_fn, a) => ({ data: { id: a.p_id, status: "active", published_at: "2026-10-04T10:00:00Z", url: "/f/acme/launch" }, error: null }) });
    expect((await approve(fu, { action: "publish", kind: "funnel", id: FUNNEL })).second.body).toMatchObject({ ok: true, url: "/f/acme/launch" });
    expect(fu.seen.receipts[0]).toMatchObject({ _capability_key: "growth_funnel_publish", _detail: { funnel_id: FUNNEL } });
  });
});

// The authority decision is the Kit gate over STUDIO_PUBLISH_KIT_BY_ACTION (bound in index.ts). When it
// cannot decide an act — no declaration, or one contradicting the risk policy, which makes the gate
// throw — that act refuses on its own, files a refused receipt, and never runs ungoverned.
describe("growth-publish-command — an act the Kit gate cannot decide fails closed", () => {
  it("refuses without touching the approval store or the RPC, while other acts keep working", async () => {
    const w = world({ decideOverride: (key, input, real) => {
      if (key === "growth_page_unpublish") throw new TypeError("CAPABILITY_DECLARATION_MISMATCH");
      return real(key, input);
    }, tables: { growth_pages: [livePage({ status: "published" })] } });
    const r = await w.call({ action: "unpublish", kind: "page", id: PAGE });
    expect(r).toMatchObject({ status: 503, body: { refused: true, code: "CAPABILITY_NOT_GOVERNED" } });
    expect(w.tables.paige_pending_confirmations).toHaveLength(0);
    expect(w.executorCalls()).toHaveLength(0);
    expect(w.seen.receipts).toEqual([expect.objectContaining({ _capability_key: "growth_page_unpublish", _outcome: "capability_refused" })]);
    expect((await w.call({ action: "publish", kind: "image", id: IMAGE })).status).toBe(202);
  });

  it("decides every act through the real declaration for its own key", async () => {
    const asked: string[] = [];
    const w = world({ decideOverride: (key, input, real) => { asked.push(key); return real(key, input); } });
    await w.call(publishPage);
    await w.call({ action: "publish", kind: "image", id: IMAGE });
    expect(asked).toEqual(["growth_page_publish", "studio_image_publish"]);
  });
});
