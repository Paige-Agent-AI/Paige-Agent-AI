import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

// Sent to the address a business set on one of its forms, each time a visitor submits it.
// Rendered in the business's own name (brandName is threaded in by send-transactional-email from
// the tenant's branding); the answers are the visitor's own words, labelled by the form's fields.

interface Field { label: string; value: string }

interface Props {
  brandName?: string
  formName?: string
  visitorName?: string | null
  visitorEmail?: string | null
  fields?: Field[]
  submittedAt?: string
}

function when(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toUTCString().replace(' GMT', ' UTC')
}

const FormSubmissionAlertEmail = ({ brandName, formName, visitorName, visitorEmail, fields, submittedAt }: Props) => {
  const who = visitorName || visitorEmail || 'Someone'
  const form = formName || 'your form'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${who} filled in ${form}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={headerBar}>
            <Text style={brand}>{brandName || 'Your business'}</Text>
          </Section>
          <Section style={content}>
            <Heading as="h2" style={h2}>{`New submission: ${form}`}</Heading>
            <Text style={text}>
              {`${who} just submitted ${form}${visitorEmail ? '. Reply to this email to answer them directly.' : '.'}`}
            </Text>
            <Section style={answers}>
              {(fields ?? []).map((f, i) => (
                <React.Fragment key={i}>
                  <Text style={label}>{f.label}</Text>
                  <Text style={value}>{f.value}</Text>
                </React.Fragment>
              ))}
            </Section>
            {submittedAt ? <Text style={meta}>{`Submitted ${when(submittedAt)}`}</Text> : null}
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            You receive this because this address is set to be alerted when this form is submitted.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: FormSubmissionAlertEmail,
  subject: (data: Record<string, any>) => {
    const who = data?.visitorName || data?.visitorEmail || 'New submission'
    return `${who} — ${data?.formName || 'form'}`.slice(0, 180)
  },
  displayName: 'Form submission alert',
  previewData: {
    brandName: 'Northline Consulting',
    formName: 'Book a discovery call',
    visitorName: 'Dana Reyes',
    visitorEmail: 'dana@example.com',
    fields: [
      { label: 'Name', value: 'Dana Reyes' },
      { label: 'Email', value: 'dana@example.com' },
      { label: 'What do you need help with?', value: 'Onboarding new clients faster.' },
    ],
    submittedAt: '2026-09-29T14:05:00.000Z',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }
const container = { maxWidth: '600px', margin: '0 auto' }
const headerBar = { backgroundColor: '#0c1034', padding: '24px 40px', borderRadius: '8px 8px 0 0' }
const brand = { fontSize: '18px', fontWeight: '700' as const, color: '#f0f0fc', margin: '0' }
const content = { padding: '32px 40px 16px' }
const h2 = { fontSize: '22px', fontWeight: '700' as const, color: '#0c1034', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#374151', lineHeight: '1.6', margin: '0 0 18px' }
const answers = { margin: '8px 0 12px', padding: '16px 20px', backgroundColor: '#f6f7fb', borderRadius: '6px' }
const label = { fontSize: '12px', color: '#4b5563', fontWeight: '600' as const, margin: '10px 0 2px' }
const value = { fontSize: '15px', color: '#111827', lineHeight: '1.5', margin: '0', whiteSpace: 'pre-wrap' as const }
const meta = { fontSize: '12px', color: '#6b7280', margin: '12px 0 0' }
const hr = { borderColor: '#e5e7eb', margin: '24px 40px' }
const footer = { fontSize: '12px', color: '#6b7280', textAlign: 'center' as const, margin: '0', padding: '0 40px 28px' }
