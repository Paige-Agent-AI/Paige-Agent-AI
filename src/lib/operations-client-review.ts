export interface ClientDeliveryArtifact {
  actorId: string;
  tenantId: string;
  releaseId: string;
  submissionId: string;
  state: 'awaiting_client' | 'client_revision_requested' | 'accepted';
  revisionNo: number;
  artifactDigest: string;
  title: string;
  body: string;
  updatedAt: string;
  decisionBy: string | null;
  decisionAt: string | null;
  clientNote: string | null;
}

/** Validates scoped server readback only; never grants release or client authority. */
export function readClientDeliveryArtifact(value: unknown, scope: {
  actorId: string; tenantId: string; releaseId: string;
}): ClientDeliveryArtifact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!scope.actorId || !scope.tenantId || !scope.releaseId || row.actor_id !== scope.actorId
    || row.tenant_id !== scope.tenantId || row.release_id !== scope.releaseId
    || typeof row.submission_id !== 'string' || !row.submission_id
    || typeof row.state !== 'string'
    || !['awaiting_client', 'client_revision_requested', 'accepted'].includes(row.state)
    || !Number.isSafeInteger(row.revision_no) || Number(row.revision_no) < 1
    || typeof row.artifact_digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.artifact_digest)
    || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 500
    || typeof row.body !== 'string' || !row.body.trim() || row.body.length > 200000
    || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))) return null;
  const awaiting = row.state === 'awaiting_client';
  // Awaiting legacy projections remain readable. A decided version requires the
  // client's canonical evidence, never a state-only acknowledgement.
  const decisionBy = row.decision_by ?? null;
  const decisionAt = row.decision_at ?? null;
  const clientNote = row.client_note ?? null;
  if (!awaiting && !['decision_by', 'decision_at', 'client_note'].every(field => Object.prototype.hasOwnProperty.call(row, field))) return null;
  if (clientNote !== null && (typeof clientNote !== 'string' || clientNote.length > 4000)) return null;
  if (awaiting ? decisionBy !== null || decisionAt !== null || clientNote !== null
    : decisionBy !== scope.actorId || typeof decisionAt !== 'string' || !Number.isFinite(Date.parse(decisionAt))
      || (row.state === 'client_revision_requested' && (typeof clientNote !== 'string' || !clientNote.trim()))) return null;
  return { actorId: scope.actorId, tenantId: scope.tenantId, releaseId: scope.releaseId,
    submissionId: row.submission_id, state: row.state as ClientDeliveryArtifact['state'],
    revisionNo: Number(row.revision_no), artifactDigest: row.artifact_digest,
    title: row.title, body: row.body, updatedAt: row.updated_at,
    decisionBy: decisionBy as string | null, decisionAt: decisionAt as string | null,
    clientNote: clientNote as string | null };
}

export interface ClientDeliveryCaller {
  rpc(name: 'operations_delivery_client_decide_scoped' | 'operations_delivery_client_read_scoped',
    args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export type ClientDeliveryDecisionResult =
  | { kind: 'verified'; artifact: ClientDeliveryArtifact }
  | { kind: 'invalid' | 'scope_changed' | 'refused' | 'unverified' };

/** Existing client RPC + independent readback. No retries, authority grant or receipt store. */
export async function decideClientDelivery(caller: ClientDeliveryCaller, original: ClientDeliveryArtifact,
  decision: 'accepted' | 'client_revision_requested', note: string | null,
  isCurrentScope: () => boolean): Promise<ClientDeliveryDecisionResult> {
  if (!isCurrentScope()) return { kind: 'scope_changed' };
  if (original.state !== 'awaiting_client'
    || !['accepted', 'client_revision_requested'].includes(decision)
    || (note !== null && typeof note !== 'string')
    || (note?.length ?? 0) > 4000
    || (decision === 'client_revision_requested' && !note?.trim())) return { kind: 'invalid' };
  const scope = { actorId: original.actorId, tenantId: original.tenantId, releaseId: original.releaseId };
  const expectedNote = note?.trim() || null;
  const matchesSource = (value: unknown) => {
    const artifact = readClientDeliveryArtifact(value, scope);
    return artifact && artifact.submissionId === original.submissionId
      && artifact.revisionNo === original.revisionNo && artifact.artifactDigest === original.artifactDigest
      && artifact.state === decision && artifact.title === original.title && artifact.body === original.body
      && artifact.decisionBy === original.actorId && artifact.decisionAt !== null && artifact.clientNote === expectedNote
      ? artifact : null;
  };
  try {
    const response = await caller.rpc('operations_delivery_client_decide_scoped', {
      p_release_id: original.releaseId, p_expected_actor_id: original.actorId,
      p_expected_tenant_id: original.tenantId, p_expected_updated_at: original.updatedAt,
      p_decision: decision, p_note: expectedNote,
    });
    if (!isCurrentScope()) return { kind: 'scope_changed' };
    if (response.error) {
      const error = response.error as { code?: unknown };
      return { kind: typeof error.code === 'string' && ['42501', '40001', '22023'].includes(error.code)
        ? 'refused' : 'unverified' };
    }
    const acknowledgement = matchesSource(response.data);
    if (!acknowledgement) return { kind: 'unverified' };
    const readback = await caller.rpc('operations_delivery_client_read_scoped', {
      p_release_id: original.releaseId, p_expected_actor_id: original.actorId,
      p_expected_tenant_id: original.tenantId,
    });
    if (!isCurrentScope()) return { kind: 'scope_changed' };
    const artifact = !readback.error && matchesSource(readback.data);
    return artifact && artifact.updatedAt === acknowledgement.updatedAt
      && artifact.decisionAt === acknowledgement.decisionAt
      ? { kind: 'verified', artifact } : { kind: 'unverified' };
  } catch {
    return { kind: isCurrentScope() ? 'unverified' : 'scope_changed' };
  }
}
