// Experience 04 E4-S3 PR-0 — the Sales engagement and signature words, in ONE module, moved verbatim
// from sales-ops.tsx so the Sales workspace and the client record (Track D) read the same labels.

/**
 * Five states and a sixth READING. There is no `paid`, `invoiced` or `delivered`, because this
 * record can observe none of them — it holds what was agreed, never what happened afterwards.
 *
 * This is the ENGAGEMENT's state: whether the work is running, paused or finished. It is NOT the
 * signature's state, and since the owner's 2026-09-22 ruling the two are kept apart on purpose —
 * see `SIGNATURE_STATE` below.
 */
export const AGREEMENT_STATE: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "opportunity" },
  active: { label: "Active", tone: "ok" },
  paused: { label: "Paused", tone: "warn" },
  completed: { label: "Completed", tone: "n" },
  cancelled: { label: "Cancelled", tone: "n" },
  unrecognised: { label: "Not readable", tone: "n" },
};

/**
 * The SIGNATURE's state — a different fact from the engagement's, and the owner ruled they must
 * never be merged: a document can be signed while the work has not started, and the work can be
 * running under a document nobody ever countersigned.
 *
 * There is no `Signed` separate from `Completed`. With one signer the two cannot be told apart, so
 * carrying both would put a word on the screen that nothing in the record could distinguish (§13).
 * `Expired` is DERIVED by the adapter from the state plus the clock, because nothing in this build
 * walks the table to flip it — see `useSoloAgreementSignings.displayState`.
 *
 * `none` is not a stored value either: it is what a commercial record with no document says, and
 * saying "Draft" there would claim a document exists.
 */
export const SIGNATURE_STATE: Record<string, { label: string; tone: string }> = {
  none: { label: "No document", tone: "n" },
  draft: { label: "Not sent", tone: "opportunity" },
  sent: { label: "Sent", tone: "warn" },
  viewed: { label: "Opened", tone: "warn" },
  partially_signed: { label: "Partly signed", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
  voided: { label: "Stopped", tone: "n" },
  expired: { label: "Link expired", tone: "bad" },
  unrecognised: { label: "Not readable", tone: "n" },
};

/** Original signing-hook display rule, moved verbatim for the selected-record page. */
export function displaySignatureState<T extends string>(stored: T, expiresAt: string | null): T | 'expired' {
  if (stored !== 'sent' && stored !== 'viewed') return stored;
  const at = expiresAt ? Date.parse(expiresAt) : NaN;
  return !Number.isNaN(at) && at <= Date.now() ? 'expired' : stored;
}

/** Pending signatures never establish message delivery or document review. */
export function signingPreparationLabel(stored: string, expiresAt: string | null): string {
  const state = displaySignatureState(stored, expiresAt);
  if (state === 'sent') return 'Awaiting signature';
  if (state === 'viewed') return 'Signing link opened';
  return SIGNATURE_STATE[state]?.label ?? 'Status unavailable';
}
export const SIGNER_STATE: Record<string, string> = {
  // A prepared party is pending before any request is issued. Sending has its
  // own agreement/provider evidence; this state only confirms no signature.
  pending: 'Not signed', viewed: 'Signing link opened', signed: 'Signature recorded', declined: 'Declined',
};

type AgreementEventAction = 'prepared_signature_credentials_recorded' | 'prepared_signature_request_recorded';
/** Only the original native event discriminators reach the display adapter. */
export function readAgreementEventAction(value: unknown): AgreementEventAction | null {
  return value === 'prepared_signature_credentials_recorded' || value === 'prepared_signature_request_recorded' ? value : null;
}
const AGREEMENT_EVENT_LABELS: Record<string, string> = {
  created: 'Draft recorded', edited: 'Agreement updated', sent: 'Signature request issued',
  delivered: 'Delivery recorded', viewed: 'Signing page opened', consented: 'Electronic consent recorded',
  signed: 'Signature recorded', completed: 'Signing completed', declined: 'Signing declined',
  voided: 'Agreement stopped', expired: 'Signing request expired', sealed: 'Signed document sealed',
  downloaded: 'Document copy requested', resent: 'Signature request reissued',
  signer_added: 'Signer added', signer_removed: 'Signer removed',
};
/** Preparation is not revised wording, a sent message, delivery or a signature. */
export function agreementEventLabel(type: string, action?: unknown): string {
  if (type === 'edited' && action === 'prepared_signature_credentials_recorded') return 'Signing links prepared';
  if (type === 'sent' && action === 'prepared_signature_request_recorded') return 'Signature request result recorded';
  return Object.prototype.hasOwnProperty.call(AGREEMENT_EVENT_LABELS, type) ? AGREEMENT_EVENT_LABELS[type] : 'Agreement activity recorded';
}
