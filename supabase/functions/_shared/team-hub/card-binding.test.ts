// node --test supabase/functions/_shared/team-hub/card-binding.test.ts
// EXP08 Team Hub agents A2b (plan D10) — the one choke point that keeps a Team Hub card's bare token out
// of PAIGE chat. Every query goes to an in-memory fake that records exactly what would reach PostgREST.
// EVIDENCE CLASS: automated unit tests of the module; the chat's use of it is pinned structurally by
// paige-ai-chat/team-hub-a2b-wiring.test.ts. No authenticated drive is claimed here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withoutTeamHubCardTokens } from "./card-binding.ts";
import { eqOf, fakeDb, hasFilter, type Query, type Resolver } from "./a2b-test-fakes.ts";

const SAM = "22222222-2222-4222-8222-222222222222";
const CARD_FP = "aaaaaaaaaaaaaaaa";
const CHAT_FP = "bbbbbbbbbbbbbbbb";
const SCOPED = "cccccccccccccccc:dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CONF_CARD = "11111111-1111-4111-8111-111111111111";
const CONF_CHAT = "33333333-3333-4333-8333-333333333333";

function service(opts: { confirmations?: Resolver; cards?: Resolver } = {}) {
  const log: Query[] = [];
  const db = fakeDb((q) => {
    if (q.table === "paige_pending_confirmations") return opts.confirmations ? opts.confirmations(q)
      : { data: [{ id: CONF_CARD, fingerprint: CARD_FP }, { id: CONF_CHAT, fingerprint: CHAT_FP }], error: null };
    if (q.table === "team_hub_message_cards") return opts.cards ? opts.cards(q) : { data: [{ confirmation_id: CONF_CARD }], error: null };
    return { data: null, error: null };
  }, log);
  return { db, log };
}

describe("withoutTeamHubCardTokens", () => {
  it("drops a bare token bound to a Team Hub card, keeps an unbound bare token and a scoped token, in order", async () => {
    const s = service();
    const r = await withoutTeamHubCardTokens(s.db, SAM, [SCOPED, CARD_FP, CHAT_FP]);
    assert.deepEqual(r, { kept: [SCOPED, CHAT_FP], bound: [CARD_FP], failed: false });
    const [conf, cards] = s.log;
    assert.equal(conf.table, "paige_pending_confirmations");
    assert.equal(eqOf(conf, "user_id"), SAM, "only this person's rows");
    assert.ok(hasFilter(conf, "is", "thread_id"), "only door rows (outside any chat thread)");
    assert.deepEqual(conf.filters.find(([op, k]) => op === "in" && k === "fingerprint")?.[2], [CARD_FP, CHAT_FP], "only the bare tokens are looked up");
    assert.equal(cards.table, "team_hub_message_cards");
    assert.deepEqual(cards.filters.find(([op]) => op === "in")?.[2], [CONF_CARD, CONF_CHAT]);
  });
  it("a request with only scoped tokens (or none) reads nothing and keeps everything", async () => {
    for (const tokens of [[SCOPED], []]) {
      const s = service();
      assert.deepEqual(await withoutTeamHubCardTokens(s.db, SAM, tokens), { kept: tokens, bound: [], failed: false });
      assert.equal(s.log.length, 0);
    }
  });
  it("a bare token with no proposal row at all is kept (an unbound token behaves exactly as before)", async () => {
    const s = service({ confirmations: () => ({ data: [], error: null }) });
    assert.deepEqual(await withoutTeamHubCardTokens(s.db, SAM, [CHAT_FP]), { kept: [CHAT_FP], bound: [], failed: false });
  });
  it("a consumed card's token is still a card's token (the lookup is not limited to live rows)", async () => {
    const s = service();
    await withoutTeamHubCardTokens(s.db, SAM, [CARD_FP]);
    assert.equal(hasFilter(s.log[0], "is", "consumed_at"), false);
    assert.equal(hasFilter(s.log[0], "gt", "expires_at"), false);
  });
  it("a lookup that fails or throws drops ONLY the bare tokens, never a scoped one (fail closed)", async () => {
    const broken: Array<{ confirmations?: Resolver; cards?: Resolver }> = [
      { confirmations: () => ({ data: null, error: { message: "down" } }) },
      { cards: () => ({ data: null, error: { message: "down" } }) },
      { confirmations: () => { throw new Error("socket hang up"); } },
      { cards: () => { throw new Error("socket hang up"); } },
    ];
    for (const opts of broken) {
      const s = service(opts);
      assert.deepEqual(await withoutTeamHubCardTokens(s.db, SAM, [CHAT_FP, SCOPED, CARD_FP]), { kept: [SCOPED], bound: [], failed: true });
    }
  });
});
