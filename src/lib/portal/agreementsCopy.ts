import type { OpenAgreementFailure } from "@/hooks/useClientPortalAgreements";

/** E09 Slice A — the customer Agreements page's words that its tests and harness assert, kept out of the page module. */

/** The PaigeAgent terms the signed-in user accepted (MyAgreements, unchanged), for customers too (§58). */
export const PLATFORM_TERMS_HREF = "/app/agreements/platform";

/** The suggested words Messages puts in the composer (`?draft=`, the Payments contract) when asking for a new link. */
export function newLinkDraft(title: string): string {
  return `Could you send me a new link to sign "${title}"?`;
}

/** The customer-facing words for each refusal of "Review and sign". */
export function openFailureCopy(code: OpenAgreementFailure, business: string): string {
  switch (code) {
    case "NOT_SIGNABLE_HERE": return `Use the link ${business} emailed you to sign this one.`;
    case "TRY_AGAIN_LATER": return `This agreement has been opened several times in the last hour. Try again later, or use the link ${business} emailed you.`;
    case "NOT_SIGNABLE": return "This agreement can't be signed right now. The list has been refreshed to show where it stands.";
    case "CLIENT_AGREEMENT_UNAVAILABLE": return "This agreement isn't available to you any more. The list has been refreshed.";
    case "MULTIPLE_BUSINESSES": return "Your account is connected to more than one business, so agreements can't be opened here yet.";
    default: return "We couldn't open this agreement. Check your connection and try again.";
  }
}
