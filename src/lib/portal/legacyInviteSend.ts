import { readFunctionErrorBody } from "@/lib/integrations/connectError";

/**
 * E09 Slice 6 (M2a, §37 consumer inventory). The legacy `send-portal-invite` token path runs the same
 * pre-send check as the canonical invitation command. When Paige does not send, it revokes the token it was
 * handed (so nothing reads "pending") and answers one of:
 *
 * - 409 `{ ok:false, emailed:false, status:'held', code:'INVITATION_POLICY_HELD', hold }`, where `hold` is
 *   `'contact'` (the client turned email off, unsubscribed or reported an email, their address bounced, or
 *   the business paused email to them) or `'business_quiet_hours'` (the business's own email quiet hours).
 *   An answer without `hold` (an older deployment) gets wording that blames neither side.
 * - 503 `{ ok:false, emailed:false, status:'unavailable', code:'INVITATION_POLICY_UNAVAILABLE' }` when the
 *   check itself could not run. That is not the client's choice and is never worded as one.
 *
 * None of the words tell staff to send the link some other way: an opt-out is the client's own choice, and
 * a hand-sent link would go around it — and an unverified check is treated the same until it can run.
 *
 * One reader for every legacy caller (§18). A non-2xx arrives as `{ data:null, error:FunctionsHttpError }`,
 * so the body is read from the error's Response, through the repo's one helper.
 */
export type LegacyInviteHold = "held" | "held_business_quiet_hours" | "held_unspecified" | "check_unavailable";
export type LegacyInviteSend = "emailed" | "not_emailed" | LegacyInviteHold;

export async function readLegacyInviteSend(data: unknown, error: unknown): Promise<LegacyInviteSend> {
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : await readFunctionErrorBody(error, data);
  if (body?.code === "INVITATION_POLICY_UNAVAILABLE") return "check_unavailable";
  if (body?.code === "INVITATION_POLICY_HELD") {
    if (body.hold === "contact") return "held";
    if (body.hold === "business_quiet_hours") return "held_business_quiet_hours";
    return "held_unspecified";
  }
  return !error && body?.emailed === true ? "emailed" : "not_emailed";
}

/** True when Paige deliberately did not send: no link is copied and no hand-off is offered. */
export function isLegacyInviteHeld(outcome: LegacyInviteSend): outcome is LegacyInviteHold {
  return outcome !== "emailed" && outcome !== "not_emailed";
}

/** What staff are told when Paige did not send. Each line names only the cause the server reported. */
export function legacyInviteHeldText(name: string, outcome: LegacyInviteHold = "held"): string {
  switch (outcome) {
    case "held_business_quiet_hours":
      return "Paige held this invitation because your business's email quiet hours are on. Send it again after they end.";
    case "held_unspecified":
      return "Paige held this invitation because of an email hold (the client's preference or your quiet hours).";
    case "check_unavailable":
      return `Paige couldn't check ${name}'s email preferences, so she didn't send the invitation. Try again in a few minutes.`;
    default:
      return `${name} has email turned off or on hold, so Paige didn't send the invitation.`;
  }
}
