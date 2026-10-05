import { isDefinedCapability } from './defineCapability.ts';
import type { DefinedCapability } from './types.ts';
import { classifyAction } from '../action-risk.ts';
import { decideGovernedExecution } from '../paige-spine/governedExecution.ts';

type Input = Parameters<typeof decideGovernedExecution>[0];
/** Bind construction metadata to the existing gate. Identity, scope, availability and redeemed
 * approval remain server adapter obligations; this creates no permission or approval channel. */
export function decideDeclaredCapability(declaration: DefinedCapability, input: Input) {
  if (!isDefinedCapability(declaration)) throw new TypeError('CAPABILITY_DECLARATION_REQUIRED');
  const key = declaration.governance.actionRiskKey;
  if (!key || key !== input.capability.id || classifyAction(key) !== declaration.governance.risk)
    throw new TypeError('CAPABILITY_DECLARATION_MISMATCH');
  if (declaration.effect === 'read' || input.capability.effect !== 'mutate'
      || declaration.governance.approval !== 'confirm' || declaration.governance.risk !== 'high')
    throw new TypeError('CAPABILITY_EFFECT_MISMATCH');
  if (input.capability.outcomeChannel !== declaration.receipt.recorder
      || !input.capability.availability || input.capability.availability === 'unknown')
    throw new TypeError('CAPABILITY_EVIDENCE_BOUNDARY_REQUIRED');
  return decideGovernedExecution(input);
}
/** Ordinary internal mutations use the same gate and current Trust lane. This adapter
 * binds a declaration; it grants no authority and cannot admit external or high-risk acts. */
export function decideDeclaredOrdinaryCapability(declaration: DefinedCapability, input: Input) {
  if (!isDefinedCapability(declaration)) throw new TypeError('CAPABILITY_DECLARATION_REQUIRED');
  const key = declaration.governance.actionRiskKey;
  if (!key || key !== input.capability.id || classifyAction(key) !== declaration.governance.risk)
    throw new TypeError('CAPABILITY_DECLARATION_MISMATCH');
  if (declaration.effect !== 'mutation' || input.capability.effect !== 'mutate'
      || declaration.governance.approval !== 'confirm' || declaration.governance.risk !== 'ordinary'
      || declaration.providerBinding.kind !== 'internal' || declaration.providerBinding.connectionResolver !== null)
    throw new TypeError('CAPABILITY_EFFECT_MISMATCH');
  if (input.capability.outcomeChannel !== declaration.receipt.recorder
      || !input.capability.availability || input.capability.availability === 'unknown')
    throw new TypeError('CAPABILITY_EVIDENCE_BOUNDARY_REQUIRED');
  return decideGovernedExecution(input);
}
