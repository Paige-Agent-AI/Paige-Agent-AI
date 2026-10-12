import { describe, expect, it } from 'vitest';
import { nextDeliveryState } from './operations-delivery-lifecycle';

describe('delivery decisions against the submitted version', () => {
  const source = { currentVersion: 'v1', submittedVersion: 'v1', currentDigest: 'digest1', submittedDigest: 'digest1' };
  it.each([
    ['in_review', 'approve', 'reviewer', 'approved'],
    ['in_review', 'request_revision', 'reviewer', 'revision_requested'],
  ] as const)('permits %s → %s only for the responsible actor', (state, action, actor, expected) => {
    expect(nextDeliveryState({ state, action, actor, ...source })).toBe(expected);
  });
  it.each(['owner', 'reviewer', 'staff'] as const)('refuses %s accepting for the client', actor => {
    expect(() => nextDeliveryState({ state: 'approved', action: 'accept', actor, ...source })).toThrow('DELIVERY_DECISION_FORBIDDEN');
  });
  it('refuses a changed source version', () => {
    expect(() => nextDeliveryState({ state: 'in_review', action: 'approve', actor: 'reviewer', ...source, currentVersion: 'v2' })).toThrow('DELIVERY_SOURCE_CHANGED');
  });
  it('refuses altered bytes under the same version', () => {
    expect(() => nextDeliveryState({ state: 'approved', action: 'accept', actor: 'client', ...source, currentDigest: 'digest2' })).toThrow('DELIVERY_SOURCE_CHANGED');
  });
  it.each(['in_review', 'approved', 'revision_requested'] as const)('refuses acceptance from %s', state => {
    expect(() => nextDeliveryState({ state, action: 'accept', actor: 'client', ...source })).toThrow('DELIVERY_DECISION_FORBIDDEN');
  });
  it('refuses sharing before a verified client projection exists', () => {
    expect(() => nextDeliveryState({ state: 'approved', action: 'share', actor: 'owner', ...source })).toThrow('DELIVERY_DECISION_FORBIDDEN');
  });
  it('does not treat internal approval as client acceptance', () => {
    expect(nextDeliveryState({ state: 'in_review', action: 'approve', actor: 'reviewer', ...source })).toBe('approved');
  });
});
