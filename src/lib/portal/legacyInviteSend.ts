import { readFunctionErrorBody } from "@/lib/integrations/connectError";

/**
 * E09 Slice 6 (M2a, §37 consumer inventory). The legacy `send-portal-invite` token path now runs the same
 * pre-send check as the canonical invitation command, and answers 409
 * `{ ok:false, emailed:false, status:'held', code:'INVITATION_POLICY_HELD' }` when the client cannot be
 * emailed: they turned email off, unsubscribed or reported an email, their address bounced, the business
 * paused email to them, or a do-not-disturb hold applies. The answer does not say which, so the words
 * below never name one cause, and they never tell staff to send the link some other way: an opt-out is
 * the client's own choice, and a hand-sent link would go around it.
 *
 * One reader for every legacy caller (§18). A 409 arrives as `{ data:null, error:FunctionsHttpError }`,
 * so the body is read from the error's Response, through the repo's one helper.
 */
export type LegacyInviteSend = "emailed" | "held" | "not_emailed";

export async function readLegacyInviteSend(data: unknown, error: unknown): Promise<LegacyInviteSend> {
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : await readFunctionErrorBody(error, data);
  if (body?.code === "INVITATION_POLICY_HELD") return "held";
  return !error && body?.emailed === true ? "emailed" : "not_emailed";
}

/** Shown when the invitation was held. True whichever hold applies; no hand-off is offered. */
export function legacyInviteHeldText(name: string): string {
  return `${name} has email turned off or on hold, so Paige didn't send the invitation.`;
}
