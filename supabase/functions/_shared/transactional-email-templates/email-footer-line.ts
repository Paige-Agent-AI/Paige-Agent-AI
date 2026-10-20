// The bulk opt-out sentence, in a plain module so it is testable without the email renderer.

// customer-identity-exempt: the platform's own mail only (affiliate, welcome, weekly summary); customer-bound templates pass businessName
const PLATFORM_LINE = "You're receiving this as part of your Paige Agent AI updates."

/**
 * The business for its client's mail, the platform for its own (E09 CURA round 2: a customer never reads the
 * platform's COO name here). undefined = the platform's own mail; null or blank = a business with no name resolved.
 */
export function footerLine(businessName?: string | null): string {
  if (businessName === undefined) return PLATFORM_LINE
  const b = (businessName ?? '').trim()
  return b ? `You're receiving this as part of your updates from ${b}.` : "You're receiving this because these updates are on for your email."
}
