/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
  /**
   * Deliverability class (set centrally below — templates need not declare it):
   *  - 'transactional': security/OTP/invite/receipt mail the recipient cannot
   *    opt out of. Gets NO List-Unsubscribe header and NO visible opt-out link.
   *  - 'bulk': notifications/marketing. Gets the RFC 2369 / 8058 List-Unsubscribe
   *    headers AND a visible footer opt-out link.
   * Ambiguous templates default to 'transactional' (safer: you can't unsubscribe
   * from a security alert). See BULK_TEMPLATES below.
   */
  category?: 'transactional' | 'bulk'
}

import { template as roleInvitation } from './role-invitation.tsx'
import { template as welcomeEmail } from './welcome.tsx'
import { template as affiliateInvitation } from './affiliate-invitation.tsx'
// credit-alert / score-milestone / funding-opportunity archived to ./_archive-mma/
// (§2 finance prohibition + §9 platform-vs-tenant separation). Reusable by future
// MMA / Project Mogul Enterprise tenant accounts as THEIR templates — never here.
import { template as weeklySummary } from './weekly-summary.tsx'
import { template as onboardingWelcome } from './onboarding-welcome.tsx'
import { template as coachingReminder } from './coaching-reminder.tsx'
import { template as smsVerification } from './sms-verification.tsx'
import { template as affiliateApplicationReceived } from './affiliate-application-received.tsx'
import { template as affiliateApprovedWelcome } from './affiliate-approved-welcome.tsx'
import { template as affiliateConversionEarned } from './affiliate-conversion-earned.tsx'
import { template as affiliateCommissionPaid } from './affiliate-commission-paid.tsx'
import { template as eliteWaitlistConfirmed } from './elite-waitlist-confirmed.tsx'
import { template as affiliateMonthlyStatement } from './affiliate-monthly-statement.tsx'
import { template as brokerApplicationReceived } from './broker-application-received.tsx'
import { template as brokerApprovedWelcome } from './broker-approved-welcome.tsx'
import { template as brokerClientInvite } from './broker-client-invite.tsx'
import { template as mccNewServiceRequest } from './mcc-new-service-request.tsx'
import { template as businessSlotAdded } from './business-slot-added.tsx'
import { template as supportTicketCreated } from './support-ticket-created.tsx'
import { template as supportTicketReply } from './support-ticket-reply.tsx'
import { template as supportTicketResolved } from './support-ticket-resolved.tsx'
// INT-163 — the agreements engine's outbound messages.
import { template as agreementSignatureRequest } from './agreement-signature-request.tsx'
import { template as agreementActivity } from './agreement-activity.tsx'
import { template as agreementCompleted } from './agreement-completed.tsx'
import { template as featureRequestStatusUpdate } from './feature-request-status-update.tsx'
import { template as brokerTeamInvitation } from './broker-team-invitation.tsx'
import { template as betaLaunchWelcome } from './beta-launch-welcome.tsx'
import { template as soloBetaWelcome } from './solo-beta-welcome.tsx'

import { template as approvalNotification } from './approval-notification.tsx'
import { template as securityCanaryRegression } from './security-canary-regression.tsx'
import { template as securitySignedOut } from './security-signed-out.tsx'
import { template as formSubmissionAlert } from './form-submission-alert.tsx'

/**
 * BULK templates (§ deliverability): notifications + marketing that a recipient
 * may opt out of. Everything NOT listed here defaults to 'transactional' — the
 * safe default, since security/OTP/invite/receipt mail must never carry an
 * unsubscribe. Kept as one central list (§12) so the classification is findable
 * and the send path derives headers from data, not hardcoded per template.
 */
const BULK_TEMPLATES: ReadonlySet<string> = new Set([
  'welcome',
  'onboarding-welcome',
  'weekly-summary',
  'coaching-reminder',
  'beta-launch-welcome',
  'affiliate-invitation',
  'affiliate-application-received',
  'affiliate-approved-welcome',
  'affiliate-conversion-earned',
  'affiliate-commission-paid',
  'affiliate-monthly-statement',
  'elite-waitlist-confirmed',
  'feature-request-status-update',
])

const RAW_TEMPLATES: Record<string, TemplateEntry> = {
  'role-invitation': roleInvitation,
  'welcome': welcomeEmail,
  'affiliate-invitation': affiliateInvitation,
  'weekly-summary': weeklySummary,
  'onboarding-welcome': onboardingWelcome,
  'coaching-reminder': coachingReminder,
  'sms-verification': smsVerification,
  'affiliate-application-received': affiliateApplicationReceived,
  'affiliate-approved-welcome': affiliateApprovedWelcome,
  'affiliate-conversion-earned': affiliateConversionEarned,
  'affiliate-commission-paid': affiliateCommissionPaid,
  'elite-waitlist-confirmed': eliteWaitlistConfirmed,
  'affiliate-monthly-statement': affiliateMonthlyStatement,
  'broker-application-received': brokerApplicationReceived,
  'broker-approved-welcome': brokerApprovedWelcome,
  'broker-client-invite': brokerClientInvite,
  'mcc-new-service-request': mccNewServiceRequest,
  'business-slot-added': businessSlotAdded,
  'support-ticket-created': supportTicketCreated,
  'support-ticket-reply': supportTicketReply,
  'support-ticket-resolved': supportTicketResolved,
  'feature-request-status-update': featureRequestStatusUpdate,
  'broker-team-invitation': brokerTeamInvitation,
  'beta-launch-welcome': betaLaunchWelcome,
  'solo-beta-welcome': soloBetaWelcome,

  'approval-notification': approvalNotification,
  'security-canary-regression': securityCanaryRegression,
  'security-signed-out': securitySignedOut,
  'form-submission-alert': formSubmissionAlert,
  'agreement-signature-request': agreementSignatureRequest,
  'agreement-activity': agreementActivity,
  'agreement-completed': agreementCompleted,
}

// Resolve each entry's deliverability category once, centrally. A template may
// still self-declare `category` (override wins); otherwise it's derived from the
// BULK_TEMPLATES set with a 'transactional' default.
export const TEMPLATES: Record<string, TemplateEntry> = Object.fromEntries(
  Object.entries(RAW_TEMPLATES).map(([key, entry]) => [
    key,
    {
      ...entry,
      category: entry.category ?? (BULK_TEMPLATES.has(key) ? 'bulk' : 'transactional'),
    } satisfies TemplateEntry,
  ]),
)
