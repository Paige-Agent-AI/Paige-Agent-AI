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
  return { actorId: scope.actorId, tenantId: scope.tenantId, releaseId: scope.releaseId,
    submissionId: row.submission_id, state: row.state as ClientDeliveryArtifact['state'],
    revisionNo: Number(row.revision_no), artifactDigest: row.artifact_digest,
    title: row.title, body: row.body, updatedAt: row.updated_at };
}
