import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Img, Preview, Text, Button, Hr, Section,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import { EmailFooter } from './email-footer.tsx'

// Last-resort platform wordmark, shown ONLY when the resolved tenant/agency brand
// has no logo AND no name (§6/§9). A tenant that HAS set brand overrides both; a
// tenant that hasn't is still stamped with its own name by the resolver
// (_shared/email/branding.ts mergeBrand), so this literal is the floor — never a
// hardcoded Paige logo asset in a coach's client-facing email.
const SITE_NAME = "Paige Agent AI" // customer-identity-exempt: platform legal-name floor, unreachable once the brand resolver stamps the tenant's name

interface CoachingReminderProps {
  name?: string
  sessionDate?: string
  sessionTime?: string
  coachName?: string
  joinUrl?: string
  rescheduleUrl?: string
  agenda?: string
  unsubscribeUrl?: string
  /** Coach's tenant/agency brand (§6/§9). Absent → the coach's own name as a
   *  text wordmark; platform default only when nothing at all resolved. */
  brandName?: string | null
  brandLogoUrl?: string | null
}

const CoachingReminderEmail = ({
  name,
  sessionDate = 'Tomorrow',
  sessionTime = '10:00 AM EST',
  coachName = 'Your session host',
  joinUrl = 'https://app.paigeagent.ai',
  rescheduleUrl = 'https://app.paigeagent.ai',
  agenda = 'Review your progress, work through your current goals, and set the next steps.',
  unsubscribeUrl,
  brandName,
  brandLogoUrl,
}: CoachingReminderProps) => {
  // Brand resolution (§6/§9): the coach's (tenant/agency) brand wins. The header
  // renders the tenant logo when present, else a text wordmark of the tenant's
  // OWN name — never a hardcoded Paige logo. Falls back to the platform default
  // only when no tenant brand/name resolved at all.
  const displayName = (brandName || '').trim() || SITE_NAME
  return (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reminder — your session is {sessionDate}</Preview>
    <Body style={main}>
      <Container style={container}>
        {brandLogoUrl ? (
          <Img src={brandLogoUrl} alt={displayName} height="44" style={logo} />
        ) : (
          <Heading as="h1" style={logoText}>{displayName}</Heading>
        )}
        <Text style={subheading}>Session Reminder</Text>
        <Hr style={hr} />
        <Heading as="h2" style={h2}>{name ? `${name}, your session is ${sessionDate}` : `Your session is ${sessionDate}`}</Heading>
        <Section style={detailBox}>
          <Text style={detailLabel}>When</Text>
          <Text style={detailValue}>{sessionDate}, {sessionTime}</Text>
          <Hr style={innerHr} />
          <Text style={detailLabel}>With</Text>
          <Text style={detailValue}>{coachName}</Text>
          <Hr style={innerHr} />
          <Text style={detailLabel}>Agenda</Text>
          <Text style={detailValue}>{agenda}</Text>
        </Section>
        <Heading as="h3" style={h3}>How to prepare</Heading>
        <Text style={text}>• Open your latest progress notes and action items in your portal</Text>
        <Text style={text}>• Review your current goals and where you left off last session</Text>
        <Text style={text}>• Have your top 2-3 questions ready</Text>
        <Button style={button} href={joinUrl}>
          Join Session
        </Button>
        <Text style={secondaryLink}>
          Need to reschedule? <a href={rescheduleUrl} style={link}>Pick a new time</a>
        </Text>
        <Hr style={hr} />
        <Text style={footer}>© {new Date().getFullYear()} {displayName}. You received this because session reminders are enabled in your notification preferences.</Text>
        <EmailFooter unsubscribeUrl={unsubscribeUrl} businessName={(brandName || '').trim() || null} />
      </Container>
    </Body>
  </Html>
  )
}

export const template = {
  component: CoachingReminderEmail,
  subject: '📅 Reminder — Your Session is Tomorrow',
  displayName: 'Session Reminder',
  previewData: {
    name: 'Jordan',
    sessionDate: 'Tomorrow',
    sessionTime: '10:00 AM EST',
    coachName: 'Alex Rivera',
    brandName: 'Rivera Coaching',
    agenda: 'Review last month\'s wins, work through your current goals, and lock in your next three action items.',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { padding: '40px 25px', maxWidth: '600px', margin: '0 auto' }
const logo = { display: 'block' as const, margin: '0 auto 8px', maxHeight: '44px', width: 'auto' as const }
const logoText = { fontSize: '24px', fontWeight: 'bold' as const, color: '#0a1628', textAlign: 'center' as const, margin: '0 auto 8px', letterSpacing: '0.3px' }
const subheading = { fontSize: '14px', color: '#6b7280', textAlign: 'center' as const, margin: '0' }
const hr = { borderColor: '#e5e7eb', margin: '24px 0' }
const innerHr = { borderColor: '#e5e7eb', margin: '12px 0' }
const h2 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#0a1628', margin: '0 0 16px' }
const h3 = { fontSize: '16px', fontWeight: '600' as const, color: '#0a1628', margin: '20px 0 8px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 6px' }
const detailBox = { backgroundColor: '#f9fafb', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb', margin: '16px 0 24px' }
const detailLabel = { fontSize: '11px', color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '0 0 4px' }
const detailValue = { fontSize: '15px', color: '#0a1628', fontWeight: '600' as const, margin: '0' }
const button = { backgroundColor: '#EBB94C', color: '#ffffff', padding: '12px 30px', borderRadius: '6px', fontSize: '16px', fontWeight: '600' as const, textDecoration: 'none', display: 'block' as const, textAlign: 'center' as const, margin: '24px auto' }
const secondaryLink = { fontSize: '13px', color: '#6b7280', textAlign: 'center' as const, margin: '12px 0 0' }
const link = { color: '#EBB94C', textDecoration: 'underline' }
const footer = { fontSize: '12px', color: '#9ca3af', textAlign: 'center' as const, margin: '0' }
