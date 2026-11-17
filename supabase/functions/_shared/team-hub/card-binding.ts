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
// The VERIFIED person's own JWT reads only the native binding projection. Private card tables remain
// postgres-only. The projection returns input-token facts, never card/message/conversation metadata.

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
const MAX_BARE = 100; // Technical payload bound; Chat's two validated lists contain at most 32 tokens.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Caller = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export type CardBinding = {
  /** The tokens to keep, in their original order. */
  kept: string[];
  /** The bare tokens dropped because a Team Hub card names their proposal. */
  bound: string[];
  /** True when the binding could not be read, so every bare token was dropped. */
  failed: boolean;
};

export async function withoutTeamHubCardTokens(caller: Caller, userId: string, tokens: readonly string[]): Promise<CardBinding> {
  const bare = [...new Set(tokens.filter((t) => typeof t === "string" && BARE.test(t)))];
  if (!bare.length) return { kept: [...tokens], bound: [], failed: false };
  const dropAll = (): CardBinding => ({ kept: tokens.filter((t) => !BARE.test(t)), bound: [], failed: true });
  if (!UUID.test(userId) || bare.length > MAX_BARE) return dropAll();
  try {
    // One atomic projection, including consumed/expired proposals. No paginated/truncated table read
    // can silently classify a missing card as unbound. A foreign/stale scope is a failed lookup.
    const read = await caller.rpc("team_hub_card_binding", { p_expected_user_id: userId, p_fingerprints: bare });
    const data = read?.data;
    if (read?.error || !data || typeof data !== "object" || Array.isArray(data)) return dropAll();
    const result = data as Record<string, unknown>;
    if (result.ok !== true || !Array.isArray(result.bound) || result.bound.length > bare.length
      || !result.bound.every((t): t is string => typeof t === "string" && bare.includes(t))
      || new Set(result.bound).size !== result.bound.length) return dropAll();
    const boundFingerprints = new Set(result.bound);
    return {
      kept: tokens.filter((t) => !boundFingerprints.has(t)),
      bound: bare.filter((t) => boundFingerprints.has(t)),
      failed: false,
    };
  } catch {
    return dropAll();
  }
}
