// Who may publish an anonymized outcome document about a person (EXP08 stage 0, owner ruling
// 2026-10-26).
//
// The handler reads the person's profile, businesses and contact methods with the SERVICE ROLE to
// scrub them from the text, then embeds it into the shared knowledge base. It used to admit the
// affected person, the service role, or anyone holding the GLOBAL `admin` role — a row written for
// an owner/admin seat in ANY workspace — so every workspace owner could have it read any person on
// the platform by `payload.user_id`. Now:
//
//   - the service role (an internal caller; the bearer must EQUAL the service key — a substring
//     match passed a header that merely contained it, and an empty configured key matched every
//     header);
//   - the affected person themselves (the only live caller: /funding-journey, UpdateOutcomeDialog,
//     where `application.user_id` is the signed-in person);
//   - the Platform Operator (§53, is_platform_operator — super_admin OR platform_admin).
//
// No workspace-admin path: the coach view that would have sent a client's id (ClientFileView →
// ClientFundingJourneyTab, coachMode) is not mounted anywhere, and the document lands in the
// cross-tenant knowledge base, which is not any one workspace's to publish into.

export function isServiceRoleBearer(authHeader: string | null | undefined, serviceKey: string | null | undefined): boolean {
  return typeof serviceKey === "string" && serviceKey.length > 0 && authHeader === `Bearer ${serviceKey}`;
}

export async function decideOutcomeIngestAccess(
  callerId: string | null,
  targetUserId: string,
  isOperator: () => Promise<boolean>,
): Promise<boolean> {
  if (!callerId) return false;
  if (callerId === targetUserId) return true;
  return await isOperator();
}
