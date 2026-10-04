// @vitest-environment node
// Review fixes for the one publish door (PR #1699). Each check names the defect it kills, and each
// fails with its fix reverted (§71.4). Real handler; only the Supabase clients are doubles.
import { describe, expect, it } from "vitest";
import { IMAGE, MINE, PAGE, THEIRS, USER, livePage, pagePublished, world } from "./growth-publish-door.world.ts";

const publishPage = { action: "publish", kind: "page", id: PAGE };
const chat = { ...publishPage, chat_attempt: true };

describe("1. opening the panel files no Rail line; an attempt files one, stably", () => {
  it("three panel prepares against a switched-off lane write no receipt and no audit row", async () => {
    const w = world({ lane: "off" });
    for (let i = 0; i < 3; i++) expect((await w.call(publishPage)).body).toMatchObject({ disabled: true });
    expect(w.seen.receipts).toHaveLength(0);
    expect(w.tables.paige_audit_log).toHaveLength(0);
  });

  it("a chat attempt against a switched-off lane files one refusal, and a repeat folds onto the same run", async () => {
    const w = world({ lane: "off" });
    await w.call(chat); await w.call(chat);
    expect(w.seen.receipts).toHaveLength(2);
    expect(w.seen.receipts[0]).toMatchObject({ _capability_key: "growth_page_publish", _outcome: "capability_refused", _tenant_id: MINE, _actor_id: USER, _detail: { refused: "autonomy_off" } });
    expect(w.seen.receipts[1]._run_id).toBe(w.seen.receipts[0]._run_id);
    // ...but a different artifact is a different attempt.
    await w.call({ action: "publish", kind: "image", id: IMAGE, chat_attempt: true });
    expect(w.seen.receipts[2]._run_id).not.toBe(w.seen.receipts[0]._run_id);
  });

  it("the chat flag must be a boolean", async () => {
    expect((await world().call({ ...publishPage, chat_attempt: "yes" })).status).toBe(400);
  });
});

describe("2. refusals before a proposal reach the Rail for attempts", () => {
  it("a non-admin's chat attempt files a refusal in the workspace they are in; a panel prepare does not", async () => {
    const panel = world({ admin: false });
    expect((await panel.call(publishPage)).status).toBe(403);
    expect(panel.seen.receipts).toHaveLength(0);
    const asked = world({ admin: false });
    expect((await asked.call(chat)).status).toBe(403);
    expect(asked.seen.receipts).toEqual([expect.objectContaining({ _tenant_id: MINE, _outcome: "capability_refused",
      _detail: expect.objectContaining({ refused: "workspace_owner_or_admin_required", page_id: PAGE }) })]);
  });

  it.each([
    ["not found", { growth_pages: [livePage({ tenant_id: THEIRS })] }, 404, "not_found"],
    ["not ready", { growth_pages: [livePage({ draft_blocks_json: [] })] }, 202, "not_ready"],
  ])("%s: a chat attempt files one refusal, a panel prepare none", async (_l, tables, status, reason) => {
    const panel = world({ tables });
    expect((await panel.call(publishPage)).status).toBe(status);
    expect(panel.seen.receipts).toHaveLength(0);
    const asked = world({ tables });
    expect((await asked.call(chat)).status).toBe(status);
    expect(asked.seen.receipts).toEqual([expect.objectContaining({ _outcome: "capability_refused", _detail: expect.objectContaining({ refused: reason }) })]);
  });

  it("a redeem whose workspace moved before the claim files one refusal and spends nothing", async () => {
    const mint = world();
    const { body } = await mint.call(publishPage);
    // Reads: resolveStudioCaller (1), then stillCurrent before the claim (2) — switched there.
    const moved = world({ switchAfter: 1, tables: { paige_pending_confirmations: mint.tables.paige_pending_confirmations } });
    const r = await moved.call({ ...publishPage, approved_fingerprint: body.fingerprint });
    expect(r).toMatchObject({ status: 409, body: { code: "WORKSPACE_CHANGED" } });
    expect(moved.tables.paige_pending_confirmations[0].consumed_at).toBeNull();
    expect(moved.seen.receipts).toEqual([expect.objectContaining({ _outcome: "capability_refused", _detail: expect.objectContaining({ refused: "workspace_changed" }) })]);
  });
});

describe("3. one approval settles the act", () => {
  it("a successful claim retires a sibling proposal for the same act on the same artifact, and nothing else", async () => {
    const w = world({ rpc: pagePublished });
    const first = await w.call(publishPage);
    const sibling = { ...w.tables.paige_pending_confirmations[0], fingerprint: "abcdefabcdefabcd", consumed_at: null };
    const otherArtifact = { ...w.tables.paige_pending_confirmations[0], fingerprint: "1234123412341234", consumed_at: null,
      args: { ...(w.tables.paige_pending_confirmations[0].args as Record<string, unknown>), id: "77777777-7777-4777-8777-777777777777" } };
    w.tables.paige_pending_confirmations.push(sibling, otherArtifact);
    const r = await w.call({ ...publishPage, approved_fingerprint: first.body.fingerprint });
    expect(r.body).toMatchObject({ ok: true });
    expect(sibling.consumed_at).toBeTruthy();
    expect(otherArtifact.consumed_at).toBeNull();
    expect((await w.call({ ...publishPage, approved_fingerprint: "abcdefabcdefabcd" })).status).toBe(409);
    expect(w.executorCalls()).toHaveLength(1);
  });
});

describe("4. a lost answer in supabase-js's words is unknown on the receipt too", () => {
  it("files capability_outcome_unknown, matching the response", async () => {
    const w = world({ rpc: () => { throw new Error("error sending request for url (https://db.test/rest/v1/rpc/growth_page_publish)"); } });
    const first = await w.call(publishPage);
    const r = await w.call({ ...publishPage, approved_fingerprint: first.body.fingerprint });
    expect(r.body).toMatchObject({ outcome: "outcome_unknown" });
    expect(w.seen.receipts).toEqual([expect.objectContaining({ _outcome: "capability_outcome_unknown" })]);
  });
});
