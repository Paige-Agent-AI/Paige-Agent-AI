/** INT-280 AI-1. Observational contract, never an execution or authority decision.
 * Producers/projections must prove references and readbacks before supplying `canonical`.
 * No prompt, business content, authority snapshot, approval token or provider payload belongs here.
 */
export const TRAJECTORY_CONTRACT_VERSION = 1 as const;
export interface TrajectoryIdentity {
  version: typeof TRAJECTORY_CONTRACT_VERSION;
  workId: string; tenantId: string; actorId: string; threadId: string | null;
  intentId: string; capabilityKey: string; category: string;
}
export type TrajectoryEventKind = 'origin' | 'turn' | 'model' | 'dispatch' | 'execution' | 'approval' | 'receipt' | 'readback' | 'continuation' | 'interruption';
export interface TrajectoryEvidence {
  kind: TrajectoryEventKind; id: string; workId: string; tenantId: string;
  actorId: string; threadId: string | null; at: string; source: 'canonical' | 'unknown';
  outcome?: string; attempt?: number;
}
export type TrajectoryState = 'accepted' | 'in_progress' | 'blocked' | 'failed' | 'cancelled' | 'reconciliation_required' | 'terminal_unverified' | 'conflicting' | 'artifact_verified' | 'read_verified';
export type TerminalCondition = 'artifact' | 'read_only' | 'unavailable';

/** Exact source references only. Even shared conversation, actor or timestamps cannot link tasks.
 * Unknown/mismatched rows are counted, never included; explicit allowlisting drops raw fields.
 */
export function correlateTrajectory(identity: TrajectoryIdentity, candidates: readonly TrajectoryEvidence[]) {
  const events: TrajectoryEvidence[] = [];
  let rejected = 0;
  for (const e of candidates) {
    if (identity.version !== TRAJECTORY_CONTRACT_VERSION || e.source !== 'canonical'
      || e.workId !== identity.workId || e.tenantId !== identity.tenantId
      || e.actorId !== identity.actorId || e.threadId !== identity.threadId
      || !e.id || !Number.isFinite(Date.parse(e.at))) { rejected++; continue; }
    events.push({ kind: e.kind, id: e.id, workId: e.workId, tenantId: e.tenantId,
      actorId: e.actorId, threadId: e.threadId, at: e.at, source: 'canonical',
      ...(e.outcome !== undefined ? { outcome: e.outcome } : {}),
      ...(Number.isSafeInteger(e.attempt) && e.attempt! > 0 ? { attempt: e.attempt } : {}) });
  }
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  return { events, rejected };
}

/** This taxonomy describes recorded work, not eventual business impact.
 * Only current-attempt terminal receipts and independently proven readbacks count.
 * Models, HTTP acceptance, narration and approval requests cannot establish completion.
 */
export function classifyTrajectory(workState: string, evidence: readonly TrajectoryEvidence[], condition: TerminalCondition): TrajectoryState {
  if (workState === 'failed') return 'failed';
  if (workState === 'cancelled') return 'cancelled';
  if (workState === 'blocked') return 'blocked';
  if (workState === 'expired' || workState === 'outcome_unknown') return 'reconciliation_required';
  if (workState === 'claimed') return evidence.some(e => e.source === 'canonical' && (e.kind === 'dispatch' || e.kind === 'model')) ? 'in_progress' : 'accepted';
  if (workState !== 'succeeded') return 'terminal_unverified';
  const attempt = Math.max(0, ...evidence.map(e => e.attempt ?? 0));
  const current = evidence.filter(e => e.source === 'canonical' && (e.attempt ?? 0) === attempt);
  const receipts = current.filter(e => e.kind === 'receipt');
  if (receipts.some(e => ['capability_failed', 'capability_refused', 'capability_outcome_unknown', 'capability_completed_unrecorded'].includes(e.outcome ?? ''))) return 'conflicting';
  if (current.some(e => e.kind === 'execution' && e.outcome !== 'executed')) return 'terminal_unverified';
  if (!receipts.some(e => e.outcome === 'capability_succeeded') || !current.some(e => e.kind === 'readback')) return 'terminal_unverified';
  return condition === 'artifact' ? 'artifact_verified' : condition === 'read_only' ? 'read_verified' : 'terminal_unverified';
}
