/** The incumbent issuer vocabulary, shared without importing server capability code. */
export const BUSINESS_METRIC_KEYS = [
  'business.active_clients_current', 'business.onboarding_current', 'business.lifecycle_current',
  'business.retention', 'business.profitability', 'business.nps',
  'operations.systems_check_latest', 'operations.unresolved_findings_current', 'operations.workflows_active_current',
  'operations.recorded_workflow_runs', 'operations.recorded_workflow_activity', 'operations.current_system_exceptions',
  'team.active_members_current', 'team.role_distribution_current', 'team.performance_scorecards',
  'ai.recorded_model_requests', 'ai.recorded_model_requests_daily', 'ai.recorded_tokens', 'ai.estimated_model_cost',
  'ai.recorded_latency', 'ai.recorded_browser_calls', 'ai.voice_consumption',
  'sales.opportunities.created', 'sales.opportunities.open_current', 'sales.opportunities.won_current_close_date',
  'sales.opportunities.lost_current_close_date', 'sales.pipeline.open_value', 'sales.invoices.issued_count',
  'sales.invoices.issued_amount', 'sales.receivables.outstanding_current', 'sales.receivables.overdue_current',
  'sales.cash.recorded_received', 'sales.payments.posted_net_allocations',
] as const;

/** Existing originating Marketing1.0.0 producer vocabulary; internal evidence only. */
export const MARKETING_METRIC_KEYS = [
  'marketing.leads.received', 'marketing.leads.daily', 'marketing.leads.by_utm_source',
  'marketing.leads.by_campaign_tag', 'marketing.leads.converted_to_opportunity',
  'marketing.capture_points.published_current', 'marketing.forms.unrouted_current',
  'marketing.submissions.failed_current', 'marketing.email.sent', 'marketing.email.opened', 'marketing.email.clicked',
] as const;
