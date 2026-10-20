// Local presentation fixtures only. No customer session, RPC, provider or evidence issuance.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentPresenceProvider } from '@/components/ui/paige/AgentPresenceContext';
import { TenantCommandCenterShell } from '@/components/tenant-shell/TenantCommandCenterShell';
import { SalesPerformance } from '@/solo/sales/performance/SalesPerformance';
import type { SalesMetricBundle, SalesPerformanceRangeKey } from '@/solo/sales/performance/types';
import type { AnalyticsEvidenceBundle } from '@/solo/data/useAnalyticsEvidence';
import '@/index.css';
import '@/solo/solo-tokens.css';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const calendar = params.get('calendar') ?? 'configured';
const keys = ['sales.opportunities.created', 'sales.opportunities.open_current', 'sales.opportunities.won_current_close_date', 'sales.opportunities.lost_current_close_date', 'sales.pipeline.open_value', 'sales.invoices.issued_count', 'sales.invoices.issued_amount', 'sales.receivables.outstanding_current', 'sales.receivables.overdue_current', 'sales.cash.recorded_received', 'sales.payments.posted_net_allocations'];
localStorage.setItem('paige.agentRail.collapsed', String(params.get('paige') !== 'open'));
localStorage.setItem('paige.tenantShell.navExpanded', 'false');
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function fixtureMetric(key: string, index: number, range: SalesPerformanceRangeKey, revision: number): SalesMetricBundle {
  const money = [4, 6, 7, 8, 9, 10].includes(index);
  const unavailable = index === 8 && calendar !== 'configured';
  return {
    metric_key: key, metric_version: index === 8 ? '1.1.0' : '1.0.0', owner_department: 'sales',
    label: index === 8 ? 'Overdue receivables now' : key,
    definition: 'LOCAL SYNTHETIC FIXTURE: canonical remaining issued balance, by currency. Due today is not overdue.',
    formula: 'Fixture presentation of the server contract; not a local business calculation.',
    range: { start: '2026-09-07T02:00:00Z', end: '2026-10-07T02:00:00Z', bounds: '[start,end)', timezone: 'UTC', semantics: [1, 4, 7, 8].includes(index) ? 'current_snapshot' : 'event_timestamp_cohort' },
    dimensions: { fixture_range: range },
    values: unavailable ? null : money ? { kind: 'currency_totals', by_currency: [{ currency: 'USD', amount_minor: index === 8 ? '50000' : '350000', record_count: 1 }, { currency: 'EUR', amount_minor: '30000', record_count: 1 }], breakdown: index === 9 ? [{ currency: 'USD', amount_minor: '350000', record_count: 1, source: 'human_recorded' }, { currency: 'EUR', amount_minor: '30000', record_count: 1, source: 'owner_imported_unverified' }] : [] } : { kind: 'count', count: index === 2 ? 2 : 4 },
    unit: money ? 'currency_minor_units' : 'count', source_refs: index === 8 ? ['public.paige_invoices', 'public.tenant_business_time_zones'] : ['LOCAL_FIXTURE'],
    as_of: '2026-10-07T02:00:00Z', freshness: { queried_at: '2026-10-07T02:00:00Z', source_updated_through: '2026-10-06T12:00:00Z' },
    coverage: { state: unavailable ? 'unavailable' : 'complete', candidate_count: 2, contributing_count: unavailable ? 0 : 2, excluded_count: unavailable ? 2 : 0 },
    exclusions: unavailable ? [{ reason: `business_time_zone_${calendar}`, count: 2 }] : [], truth_state: unavailable ? 'UNAVAILABLE' : 'LIVE', caveats: ['LOCAL FIXTURES: not production values or authenticated acceptance.'],
    source_revision_ref: `fixture:${range}:${revision}:${index}`, evidence_ref: null, evidence_state: 'shared_issuance_required',
    ...(index === 8 ? { business_time_zone: calendar === 'configured' ? { state: 'configured' as const, zone: 'America/Los_Angeles', set_at: '2026-09-01T00:00:00Z', as_of_date: '2026-10-06' } : { state: calendar === 'missing' ? 'missing' as const : 'invalid' as const, zone: null, set_at: calendar === 'missing' ? null : '2026-09-01T00:00:00Z', as_of_date: null } } : {}),
  };
}
function Fixture() {
  const [range, setRange] = React.useState<SalesPerformanceRangeKey>('month');
  const [revision, setRevision] = React.useState(0);
  const metrics = keys.map((key, index) => fixtureMetric(key, index, range, revision));
  const funnel: AnalyticsEvidenceBundle = {
    metric: { id: 'sales_funnel.created_deals_by_current_stage', version: '1.0.0', label: 'Current stages', definition: 'Synthetic created-period current-stage cohort', formula: 'Fixture server stage counts' },
    range: { key: 'last_30_days', start: '2026-09-07T02:00:00Z', end: '2026-10-07T02:00:00Z' }, source_references: [], contributing_record_count: 4,
    coverage: { state: 'complete', candidate_count: 4, contributing_count: 4, excluded_count: 0 }, exclusions: [], freshness: { queried_at: '2026-10-07T02:00:00Z', source_updated_through: null }, truth_state: 'LIVE', account_epoch_ref: 'local-fixture', source_revision_ref: `fixture-stage:${range}:${revision}`, reference_expires_at: '2099-01-01T00:00:00Z',
    values: { kind: 'sales_funnel_stages', pipeline_label: 'Synthetic pipeline', stages: [{ stage_key: 'stage_1', label: 'Qualified', stage_type: 'open', order: 1, count: 3 }, { stage_key: 'stage_2', label: 'Proposal', stage_type: 'open', order: 2, count: 1 }] }, caveats: ['Local fixtures only.'],
  };
  return <div className="paige-solo" data-pg={theme} data-theme={theme} style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', padding: 12 }}>
    <SalesPerformance metrics={metrics} phase="ready" range={range} onRangeChange={setRange} onRetry={() => setRevision(value => value + 1)} onNavigate={() => undefined} workspaceEpoch="local-fixture" stageFunnel={funnel} stagePhase="ready" />
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><ThemeProvider attribute="class" defaultTheme={theme} storageKey={`sales-performance-fixture-${theme}`} enableSystem={false}><AgentPresenceProvider launcherEnabled={false} hasChatBody={false}><BrowserRouter><TenantCommandCenterShell accountName="Synthetic Sales review workspace" accountType="standalone" userRole="admin" onSignOut={() => undefined} soloPaigeWorkspace={<div style={{ padding: 16 }}>LOCAL PAIGE SLOT · transport and authentication unavailable</div>}><Fixture /></TenantCommandCenterShell><div data-harness-chrome style={{ position: 'fixed', bottom: 0, left: 0, zIndex: 200, background: '#111', color: '#fff', padding: 2, fontSize: 10 }}>LOCAL FIXTURES · NO CUSTOMER AUTH OR PROVIDER EFFECTS</div></BrowserRouter></AgentPresenceProvider></ThemeProvider></QueryClientProvider></React.StrictMode>);
