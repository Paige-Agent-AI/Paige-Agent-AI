import { executeFinanceRead, type FinanceCallerClient } from '../../paige-spine/domains/finance_reads.ts';
import type { MetricCaller } from '../../analytics-metrics/read.ts';
import { FINANCE_REVIEW_SOURCE_LIMIT, financeObject, financeRevision, financeSourceObservation, financeUuid,
  validateFinanceReviewEvidence, type FinanceReviewEvidence, type FinanceReviewSource } from '../../finance/business-review-evidence.ts';
import { contextAvailable, contextDegraded, type ContextSourceResult } from '../mod.ts';
import type { DomainSnapshot, DomainSnapshotAdapter } from '../snapshot.ts';

export type BusinessReviewCaller = MetricCaller & { readonly auth?: FinanceCallerClient['auth'] };
export const FINANCE_ADAPTER_ID = 'finance.canonical_source_evidence.v1';
type Company = { id: string; legal_name: string; version: number; is_active: boolean };
type Source = { id: string; entity_id: string; provider: 'plaid' | 'quickbooks'; environment: string;
  verification_state: string; revision: number; connection_active: boolean };
function catalogue(value: unknown, tenant: string): { entities: Company[]; sources: Source[] } | null {
  if (!financeObject(value) || value.tenant_id !== tenant || !Array.isArray(value.entities) || value.entities.length > 200
    || !Array.isArray(value.sources) || value.sources.length > 1000) return null;
  const entities: Company[] = [], sources: Source[] = [];
  for (const row of value.entities) {
    if (!financeObject(row) || !financeUuid(row.id) || typeof row.legal_name !== 'string' || !row.legal_name.trim()
      || row.legal_name.length > 500 || !financeRevision(row.version) || typeof row.is_active !== 'boolean'
      || entities.some(e => e.id === row.id)) return null;
    entities.push({ id: row.id, legal_name: row.legal_name, version: row.version, is_active: row.is_active });
  }
  for (const row of value.sources) {
    if (!financeObject(row) || !financeUuid(row.id) || !financeUuid(row.entity_id) || !financeRevision(row.revision)
      || !['plaid', 'quickbooks'].includes(String(row.provider)) || !['production', 'sandbox', 'development'].includes(String(row.environment))
      || typeof row.verification_state !== 'string' || typeof row.connection_active !== 'boolean' || sources.some(s => s.id === row.id)) return null;
    sources.push({ id: row.id, entity_id: row.entity_id, revision: row.revision, provider: row.provider as Source['provider'],
      environment: row.environment as string, verification_state: row.verification_state, connection_active: row.connection_active });
  }
  return { entities, sources };
}

/** Stored canonical Finance reads only. This does not register dormant Finance tools or call providers. */
export function createFinanceSnapshotAdapter(caller: BusinessReviewCaller, scope: { tenantId: string | null }, clock = Date.now): DomainSnapshotAdapter {
  return { domain: 'finance', owner: 'finance', async read(ctx): Promise<ContextSourceResult<DomainSnapshot>> {
    const gap = (reason: string) => contextDegraded<DomainSnapshot>(reason);
    if (!scope.tenantId || scope.tenantId !== ctx.identity.tenantId) return gap('finance_review_scope_mismatch');
    if (ctx.signal?.aborted) return gap('finance_review_aborted');
    if (!caller.auth || typeof caller.auth.getUser !== 'function') return gap('finance_caller_auth_unavailable');
    const client: FinanceCallerClient = { auth: caller.auth, rpc: (name, args) => caller.rpc(name, args) };
    try {
      const actor = await client.auth.getUser();
      if (actor.error || actor.data.user?.id !== ctx.identity.actorId) return gap('finance_review_actor_changed');
      const read = await executeFinanceRead(client, { capability: 'finance.source_catalog' });
      if (read.outcome !== 'read') return gap(read.outcome === 'refused' ? 'finance_review_refused' : 'finance_catalogue_unavailable');
      const initial = catalogue(read.evidence, scope.tenantId);
      if (!initial) return gap('finance_evidence_invalid');
      const eligible = initial.sources.filter(s => s.environment === 'production' && s.verification_state === 'verified' && s.connection_active
        && initial.entities.some(e => e.id === s.entity_id && e.is_active));
      const evidence: FinanceReviewEvidence = { tenant_id: scope.tenantId, eligible_sources: eligible.length, sources: [] };
      for (const binding of eligible.slice(0, FINANCE_REVIEW_SOURCE_LIMIT)) {
        if (ctx.signal?.aborted) return gap('finance_review_aborted');
        const company = initial.entities.find(e => e.id === binding.entity_id)!;
        const base = { company_id: company.id, company_label: company.legal_name, company_version: company.version,
          binding_id: binding.id, binding_revision: binding.revision, provider: binding.provider };
        const result = await executeFinanceRead(client, { capability: 'finance.account_source', entity_id: company.id, binding_id: binding.id });
        if (result.outcome === 'refused') return gap('finance_review_refused');
        if (result.outcome === 'unavailable') return gap('finance_source_read_unavailable');
        if (!financeObject(result.evidence)) return gap('finance_evidence_invalid');
        let source: FinanceReviewSource = { ...base, state: 'unavailable', reason: 'source_snapshot_unavailable' };
        if (result.evidence.coverage !== 'unavailable') {
          const observed = financeSourceObservation(base, result.evidence, clock());
          if (!observed) return gap('finance_evidence_invalid');
          source = observed;
        }
        evidence.sources.push(source);
      }
      // A later read cannot preserve earlier figures after company/source revocation.
      // Re-enter the existing authority, never duplicate its owner/admin decision.
      const final = await executeFinanceRead(client, { capability: 'finance.source_catalog' });
      if (final.outcome !== 'read') return gap('finance_review_authority_changed');
      const current = catalogue(final.evidence, scope.tenantId);
      if (!current) return gap('finance_evidence_invalid');
      const currentEligible = current.sources.filter(s => s.environment === 'production' && s.verification_state === 'verified' && s.connection_active
        && current.entities.some(e => e.id === s.entity_id && e.is_active));
      if (currentEligible.map(s => s.id).sort().join(',') !== eligible.map(s => s.id).sort().join(',')) return gap('finance_review_source_changed');
      for (const source of evidence.sources) {
        const company = current.entities.find(e => e.id === source.company_id);
        const binding = current.sources.find(s => s.id === source.binding_id);
        if (!company?.is_active || company.version !== source.company_version || company.legal_name !== source.company_label
          || !binding || binding.entity_id !== source.company_id || binding.provider !== source.provider || binding.environment !== 'production'
          || binding.verification_state !== 'verified' || !binding.connection_active || binding.revision !== source.binding_revision) return gap('finance_review_source_changed');
      }
      const afterActor = await client.auth.getUser();
      if (afterActor.error || afterActor.data.user?.id !== ctx.identity.actorId || ctx.signal?.aborted) return gap('finance_review_actor_changed');
      const checked = validateFinanceReviewEvidence(evidence, scope.tenantId, clock());
      if (!checked) return gap('finance_evidence_invalid');
      const readable = checked.sources.filter(s => s.state === 'available').length;
      return contextAvailable({ domain: 'finance', owner: 'finance', period: { ...ctx.period }, as_of: new Date(clock()).toISOString(),
        freshness: 'snapshot', coverage: 'partial',
        coverage_note: `Stored Finance source facts, not current bank-wide cash, profit or a forecast. ${readable} of ${checked.sources.length} sampled source snapshots readable; ${checked.eligible_sources} eligible production sources. Test and unverified sources excluded.`,
        headline: [], changes: [], outcomes: [], risks: [], upcoming: [], goal_links: [], finance_evidence: checked,
        sources: [{ system: 'finance', adapter: FINANCE_ADAPTER_ID }] });
    } catch { return gap('finance_review_unavailable'); }
  } };
}
