import type { OpenAgreementFailure, PortalAgreementCounterparty, PortalAgreementSignNote, PortalAgreementState } from "@/hooks/useClientPortalAgreements";

/** E09 Slice A — the customer Agreements page's words that its tests and harness assert, kept out of the page module. */

/** The PaigeAgent terms the signed-in user accepted (MyAgreements, unchanged), for customers too (§58). */
export const PLATFORM_TERMS_HREF = "/app/agreements/platform";

/**
 * Where a customer asks the business for a new link: their Messages thread. No suggested words (`?draft=`)
 * until Messages reads them (Slice 5); a parameter nothing reads would only look like it does something.
 */
export const ASK_FOR_NEW_LINK_HREF = "/app/messages";

/**
 * Words that may be followed by the "ask {Business} for a new link" Messages link. `ask` is how the link
 * is drawn: `inline` finishes the sentence ("…, or ask {Business} for a new link."), `button` stands on its own.
 */
export interface AgreementCopy {
  text: string;
  ask: "inline" | "button" | null;
  /** The inline link's own words, when "ask {Business} for a new link" would not be true (nothing was ever sent). */
  askLabel?: string;
}

/**
 * Why a row waiting on a signature is not signable here, in words that are true in every case the server
 * returns them. A dead link (expired or revoked) is never offered as the way to sign.
 */
export function signNoteCopy(note: PortalAgreementSignNote, business: string): AgreementCopy {
  switch (note) {
    case "link_expired": return { text: `The signing link ${business} emailed you has expired.`, ask: "button" };
    case "link_revoked": return { text: `The signing link ${business} emailed you is no longer active.`, ask: "button" };
    case "no_link_sent": return { text: `${business} hasn't emailed you a signing link for this one. If you need one,`, ask: "inline", askLabel: `ask ${business} for it` };
    default: return { text: `${business} sent this one's signing link by email. If you can't use it,`, ask: "inline" };
  }
}

/** The customer-facing words for each refusal of "Review and sign". */
export function openFailureCopy(code: OpenAgreementFailure, business: string, note?: PortalAgreementSignNote): AgreementCopy {
  switch (code) {
    case "NOT_SIGNABLE_HERE": return signNoteCopy(note ?? "use_email_link", business);
    // Ten portal opens in an hour: the first of them already replaced the emailed link (D-A4), so that link is
    // never the way out here.
    case "TRY_AGAIN_LATER": return { text: "This agreement has been opened several times in the last hour. Try again in an hour, or", ask: "inline" };
    case "NOT_SIGNABLE": return { text: "This agreement can't be signed right now. The list has been refreshed to show where it stands.", ask: null };
    case "CLIENT_AGREEMENT_UNAVAILABLE": return { text: "This agreement isn't available to you any more. The list has been refreshed.", ask: null };
    case "MULTIPLE_BUSINESSES": return { text: "Your account is connected to more than one business, so agreements can't be opened here yet.", ask: null };
    default: return { text: "We couldn't open this agreement. Check your connection and try again.", ask: null };
  }
}

/**
 * Where an agreement that is not waiting on this customer stands, in words true for whose signature it is. Only a
 * signature the server proved is this customer's (`you`) is ever "You've signed", and only their own turn is
 * ever "You'll be able to sign".
 */
export function waitingNote(state: PortalAgreementState, counterparty: PortalAgreementCounterparty, business: string): string | null {
  switch (state) {
    case "awaiting_business":
      return counterparty === "you" ? `${business} signs first. You'll be able to sign once they have.` : `${business} signs first.`;
    case "awaiting_countersign":
      return counterparty === "you" ? `You've signed. It's complete once ${business} signs.`
        : counterparty === "other" ? `It's been signed. It's complete once ${business} signs.`
        : `It's complete once ${business} signs.`;
    case "awaiting_others":
      return counterparty === "you" ? "You've signed. It's complete once everyone else has."
        : counterparty === "other" ? "It's been signed. It's complete once everyone else has."
        : "It's complete once everyone has signed.";
    default: return null;
  }
}

/** Above the signable rows, when every one of them had a link emailed: opening here replaces it (D-A4). */
export function replacesEmailedLinkHint(business: string): string {
  return `Opening an agreement here replaces the signing link ${business} emailed you.`;
}

/**
 * Beside one signable row, when the signable rows differ: what opening THIS one does. A link that was never
 * emailed is never said to be replaced; the portal's own link for it lasts at most a day (integrator default).
 */
export function signHereNote(linkEmailed: boolean, business: string): string {
  return linkEmailed
    ? `Opening it here replaces the signing link ${business} emailed you.`
    : "Opening it here gives you a private signing link that works for up to a day.";
}
