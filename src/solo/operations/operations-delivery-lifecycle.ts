export type DeliveryState = 'in_review' | 'revision_requested' | 'approved';
export type DeliveryAction = 'approve' | 'request_revision' | 'share' | 'accept';
export type DeliveryActor = 'reviewer' | 'owner' | 'staff' | 'client';

/** Presentation guard only. Database authorization must independently enforce every decision. */
export function nextDeliveryState(input: {
  state: DeliveryState;
  action: DeliveryAction;
  actor: DeliveryActor;
  currentVersion: string;
  submittedVersion: string;
  currentDigest: string;
  submittedDigest: string;
}): DeliveryState {
  if (!input.currentVersion || !input.submittedVersion || !input.currentDigest || !input.submittedDigest
    || input.currentVersion !== input.submittedVersion || input.currentDigest !== input.submittedDigest) {
    throw new Error('DELIVERY_SOURCE_CHANGED');
  }
  const { state, action, actor } = input;
  if (state === 'in_review' && actor === 'reviewer') {
    if (action === 'approve') return 'approved';
    if (action === 'request_revision') return 'revision_requested';
  }
  throw new Error('DELIVERY_DECISION_FORBIDDEN');
}
