import * as React from 'npm:react@18.3.1'
import { Link, Text } from 'npm:@react-email/components@0.0.22'

interface EmailFooterProps {
  /**
   * Customer-bound mail (a business writing to its own client): the business's name, or null when none
   * resolved. Omit it for the platform's own mail. A customer never reads the platform's COO name here
   * (owner ruling, 2026-10-19).
   */
  businessName?: string | null
  /**
   * Absolute https link to the tenant-agnostic, platform-level unsubscribe page.
   * When present, a visible opt-out line renders. When absent, nothing renders —
   * so this component is a no-op on transactional/security mail, which is never
   * unsubscribable.
   */
  unsubscribeUrl?: string
}

/**
 * Shared opt-out footer line for BULK email only.
 *
 * §12 — defined once here instead of copy-pasted into every notification
 * template. The `send-transactional-email` edge function injects `unsubscribeUrl`
 * into templateData for templates whose registry `category === 'bulk'`, and omits
 * it for `'transactional'` ones — so security/OTP/invite mail never renders an
 * unsubscribe link even if this component is mounted.
 *
 * §2/§3 — copy is coaching-generic and in-voice: no finance vocabulary, and the
 * link points at the platform unsubscribe page, never a tenant domain.
 */
// customer-identity-exempt: the platform's own mail only (affiliate, welcome, weekly summary); customer-bound templates pass businessName
const PLATFORM_LINE = "You're receiving this as part of your Paige Agent AI updates."

/** The opt-out sentence: the business for its client's mail, the platform for its own. */
export function footerLine(businessName?: string | null): string {
  if (businessName === undefined) return PLATFORM_LINE
  const b = (businessName ?? '').trim()
  return b ? `You're receiving this as part of your updates from ${b}.` : "You're receiving this because these updates are on for your email."
}

export const EmailFooter = ({ unsubscribeUrl, businessName }: EmailFooterProps) => {
  if (!unsubscribeUrl) return null
  return (
    <Text style={optOut}>
      {footerLine(businessName)}{' '}
      <Link href={unsubscribeUrl} style={optOutLink}>Unsubscribe</Link>
    </Text>
  )
}

// Inline literal colors: email clients don't resolve CSS variables, so the
// shared email layer uses the same brand hex the templates already use
// (muted grey footer, #9ca3af / #6b7280). Not app UI — §11 token rule N/A here.
const optOut = {
  fontSize: '12px',
  color: '#9ca3af',
  textAlign: 'center' as const,
  margin: '8px 0 0',
  lineHeight: '1.5',
}
const optOutLink = { color: '#6b7280', textDecoration: 'underline' }
