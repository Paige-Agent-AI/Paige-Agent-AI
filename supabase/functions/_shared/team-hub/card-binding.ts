// EXP08 Team Hub agents, A2b (plan D10): THE ONE CHOKE POINT that keeps a Team Hub card's token out of
// PAIGE chat.
//
// A Team Hub card is a door proposal row like any other (paige_pending_confirmations, thread_id NULL), and
// its token is the door's bare 16-hex fingerprint. PAIGE chat redeems (and declines) bare door tokens
// through the same doors, so without this a card's fingerprint sent to PAIGE chat would run the act there
// and the card would never learn it. paige-ai-chat passes every approved and declined token through
// withoutTeamHubCardTokens once, before either set exists:
//   - a bare token bound to a Team Hub card (team_hub_message_cards) is dropped (`bound`);
//   - a scoped `fp:nonce` token is never a door's or a card's, and passes through untouched;
//   - an unbound bare token passes through exactly as before (§58);
//   - if the binding cannot be read, every bare token is dropped (`failed`): fail closed, never let a
//     card's token through on a lookup that did not answer.
// Card tokens are redeemed only through their own door (card-act.ts → team_hub_decide_card).
//
// KNOWN GAP (plan D10, not closed here): Studio's direct growth-door call and the browser's direct CRM
// door call do not pass through paige-ai-chat. The same person could redeem their own card's proposal
// there; it is the same person, so no authority widens, and the card then reads "unconfirmed".
//
// Service role, keyed on the VERIFIED user id: the binding is a fact about the person's own rows.

const BARE = /^[0-9a-f]{16}$/;

/**
 * PAIGE chat's tool result when a publish door hands back a proposal that already has a Team Hub card
 * (A2b D11, the other direction): no chat card is shown, nothing is live, and the person is pointed at the
 * card. Written for the model; the chat never shows its own card for this proposal.
 */
export const TEAM_HUB_CARD_ALREADY_WAITING = Object.freeze({
  success: false, not_applied: true, already_waiting_in_team_hub: true,
  error: "This is already waiting for an Approve on its card in Team Hub.",
  note: "Tell the person it is already waiting on its card in their Team Hub DM, and that nothing is live yet. Nothing new was prepared here. Do not call this tool again for it.",
});
const CHUNK = 100;

// deno-lint-ignore no-explicit-any
type FromClient = { from(table: string): any };
export type CardBinding = {
  /** The tokens to keep, in their original order. */
  kept: string[];
  /** The bare tokens dropped because a Team Hub card names their proposal. */
  bound: string[];
  /** True when the binding could not be read, so every bare token was dropped. */
  failed: boolean;
};

export async function withoutTeamHubCardTokens(service: FromClient, userId: string, tokens: readonly string[]): Promise<CardBinding> {
  const bare = [...new Set(tokens.filter((t) => typeof t === "string" && BARE.test(t)))];
  if (!bare.length) return { kept: [...tokens], bound: [], failed: false };
  const dropAll = (): CardBinding => ({ kept: tokens.filter((t) => !BARE.test(t)), bound: [], failed: true });
  try {
    // Every door row of this person carrying one of these fingerprints, live or not: a consumed card's
    // token is still a card's token.
    const rows: Array<{ id: string; fingerprint: string }> = [];
    for (let i = 0; i < bare.length; i += CHUNK) {
      const read = await service.from("paige_pending_confirmations").select("id,fingerprint")
        .eq("user_id", userId).in("fingerprint", bare.slice(i, i + CHUNK)).is("thread_id", null).limit(1000);
      if (read?.error || !Array.isArray(read?.data)) return dropAll();
      for (const r of read.data) if (r && typeof r.id === "string" && typeof r.fingerprint === "string") rows.push(r);
    }
    if (!rows.length) return { kept: [...tokens], bound: [], failed: false };
    const carded = new Set<string>();
    const ids = [...new Set(rows.map((r) => r.id))];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const read = await service.from("team_hub_message_cards").select("confirmation_id").in("confirmation_id", ids.slice(i, i + CHUNK)).limit(1000);
      if (read?.error || !Array.isArray(read?.data)) return dropAll();
      for (const r of read.data) if (r && typeof r.confirmation_id === "string") carded.add(r.confirmation_id);
    }
    const boundFingerprints = new Set(rows.filter((r) => carded.has(r.id)).map((r) => r.fingerprint));
    return {
      kept: tokens.filter((t) => !boundFingerprints.has(t)),
      bound: bare.filter((t) => boundFingerprints.has(t)),
      failed: false,
    };
  } catch {
    return dropAll();
  }
}
