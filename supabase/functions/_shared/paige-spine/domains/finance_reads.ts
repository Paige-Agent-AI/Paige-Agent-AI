import type { SpineCapability } from '../contracts.ts';

// Candidate declarations only: no registration, Chat tools or executor changes.
// The protected Chat/Live binding owner must adopt these after release review.
export const FINANCE_READ_CAPABILITIES = [
  { key: 'finance.source_catalog', executor: 'public.read_finance_source_catalog' },
  { key: 'finance.account_source', executor: 'public.read_finance_account_source' },
  { key: 'finance.liability_source', executor: 'public.read_finance_liability_source' },
  { key: 'finance.accounting_obligations', executor: 'public.read_finance_accounting_obligations' },
  { key: 'finance.budget_read', executor: 'public.read_finance_budget' },
  { key: 'finance.cash_scenario_read', executor: 'public.read_finance_cash_scenario' },
].map(({ key, executor }) => ({
  key, domain: 'finance', owner: 'finance', humanSurface: '/solo/:account/finance',
  readiness: 'none', selfDescribe: false,
  action: { classification: 'read', executor, seatAuthority: 'workspace-admin', idempotency: 'Caller-JWT canonical company/source read; no records or provider effects written.', riskPolicyKey: 'read_only', approvalAuthority: 'none' },
  chatBinding: 'UNAVAILABLE', mindBinding: 'UNAVAILABLE', sharedPrimitiveChange: 'NONE', maturity: 'UNAVAILABLE',
} as const satisfies SpineCapability));

type RpcResult = { data: unknown; error: unknown };
export type FinanceCallerClient = {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, input?: Record<string, unknown>): PromiseLike<RpcResult>;
};
type ReadResult = { outcome: 'read' | 'refused' | 'unavailable'; evidence: unknown; reason: string | null; financialEffectsExecuted: false };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const result = (outcome: ReadResult['outcome'], reason: string | null, evidence: unknown = null): ReadResult => ({ outcome, evidence, reason, financialEffectsExecuted: false });
function pick(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = object(value);
  if (!row) throw new Error('Invalid evidence row');
  return Object.fromEntries(keys.filter(key => Object.hasOwn(row, key)).map(key => {
    const v = row[key];
    if (!(v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || typeof v === 'string' && v.length <= 500)) throw new Error('Invalid evidence value');
    return [key, v];
  }));
}
function planningProjection(evidence: Record<string, unknown>, command: Record<string, unknown>) {
  if (evidence.id !== command.plan_id || evidence.entity_id !== command.entity_id || evidence.company_identity_current !== true
    || !Number.isSafeInteger(evidence.version) || (evidence.version as number) < 1
    || !Number.isSafeInteger(evidence.current_version) || (evidence.current_version as number) < (evidence.version as number)
    || command.version !== undefined && evidence.version !== command.version) throw new Error('Invalid planning evidence');
  if (command.capability === 'finance.budget_read') {
    if (evidence.basis !== 'owner_entered_plan' || evidence.actuals !== null || !Array.isArray(evidence.lines) || evidence.lines.length > 500) throw new Error('Invalid budget evidence');
    return { ...pick(evidence, ['id','entity_id','currency','period_start','period_end','title','version','current_version','company_identity_current','basis','receipt_run_id','created_at']),
      assumptions: boundedText(evidence.assumptions, 10000), actuals: null,
      lines: evidence.lines.map(row => {
        const line = pick(row, ['id','source_label','direction','planned_amount_decimal']);
        if (!['income','expense'].includes(String(line.direction)) || !money(line.planned_amount_decimal)) throw new Error('Invalid budget amount');
        return line;
      }) };
  }
  const config = object(evidence.config);
  if (evidence.basis !== 'owner_entered_assumptions' || evidence.amount_unit !== 'decimal_major' || evidence.verified_opening_cash !== null
    || evidence.contractual_obligations !== null || evidence.guaranteed_result !== false || !config || !Array.isArray(config.events)
    || config.events.length > 5000 || ![30,60,90].includes(config.horizon_days as number)
    || config.opening_cash !== null && !money(config.opening_cash, true) || config.cash_floor !== null && !money(config.cash_floor)) throw new Error('Invalid scenario evidence');
  return { ...pick(evidence, ['id','entity_id','version','current_version','company_identity_current','basis','amount_unit','receipt_run_id','created_at']),
    verified_opening_cash: null, contractual_obligations: null, guaranteed_result: false,
    config: { ...pick(config, ['title','currency','start_date','horizon_days','opening_cash','cash_floor']), assumptions: boundedText(config.assumptions,10000),
      events: config.events.map(row => {
        const event = pick(row, ['id','source_label','date','direction','amount','occurrence_ref']);
        if (!['inflow','outflow'].includes(String(event.direction)) || !money(event.amount)) throw new Error('Invalid scenario event');
        return event;
      }) } };
}
function boundedText(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid planning text');
  return value;
}
function money(value: unknown, signed = false) {
  return typeof value === 'string' && (signed ? /^-?\d{1,24}(\.\d{1,6})?$/ : /^\d{1,24}(\.\d{1,6})?$/).test(value);
}

function accountProjection(value: unknown) {
  const row=pick(value,['native_id','source_label','source_path','institution_label','product','currency','current_balance','available_cash','available_credit','credit_limit','source_updated_at']);
  if(typeof row.native_id!=='string'||!row.native_id.trim()) throw new Error('Invalid native account identity');
  for(const key of ['current_balance','available_cash','available_credit','credit_limit'])
    if(Object.hasOwn(row,key)&&row[key]!==null&&!money(row[key],true)) throw new Error('Invalid exact account amount');
  return row;
}

function recordProjection(evidence: Record<string, unknown>, command: Record<string, unknown>) {
  const debt = command.capability === 'finance.liability_source';
  if (!['partial', 'complete', 'unavailable'].includes(String(evidence.coverage))) throw new Error('Invalid source coverage');
  if (evidence.coverage === 'unavailable') return { ...pick(evidence, ['coverage', 'reason']), records: null, calculated_totals: null };
  if (evidence.binding_id !== command.binding_id || !Array.isArray(evidence.records) || evidence.records.length > 500
    || evidence.temporal_basis !== 'source_snapshot' || evidence.institution_freshness_verified !== false
    || debt && (evidence.coverage !== 'partial' || evidence.company_wide_debt !== null || evidence.scheduled_debt_service !== null)
    || !debt && (evidence.domain !== command.domain || evidence.recognized_expenses !== null
      || evidence.bank_settlement_verified !== false || evidence.payment_execution_supported !== false)) throw new Error('Invalid source evidence');
  const records = evidence.records.map(value => {
    const row = object(value);
    if (!row || typeof row.nativeId !== 'string' || !row.nativeId.trim() || row.nativeId.length > 500) throw new Error('Invalid record identity');
    const keys = debt ? ['nativeId','sourceLabel','sourceType','sourceSubtype','product','currency','unofficialCurrency',
      'outstandingBalance','principalBalance','originalPrincipal','creditLimit','availableCredit','minimumPayment','nextPayment',
      'nextPaymentDueDate','maturityDate','drawPeriodEndDate','paymentFrequency','interestRatePercentage','interestRateType',
      'principalPayment','interestPayment','collateralVerified','guaranteeVerified','institutionUpdatedAt','accountingClassificationVerified','companyOwnershipVerified']
      : ['nativeId','documentNumber','currency','transactionDate','dueDate','recordedTotal','recordedOutstanding','accountingStatus',
        'bankSettlementVerified','paymentExecutionSupported','paymentType','isCredit','recognizedExpense'];
    const projected = pick(row, keys);
    const amounts = debt ? ['outstandingBalance','principalBalance','originalPrincipal','creditLimit','availableCredit','minimumPayment','nextPayment','interestRatePercentage']
      : ['recordedTotal','recordedOutstanding'];
    for (const key of amounts) if (Object.hasOwn(row,key) && row[key] !== null && !money(row[key], debt)) throw new Error('Invalid source amount');
    if (debt) {
      if (!['credit_card','revolving_line','loan_obligation'].includes(String(row.product))) throw new Error('Invalid debt product');
      if (row.accountingClassificationVerified !== false || row.companyOwnershipVerified !== false
        || ['principalPayment','interestPayment','collateralVerified','guaranteeVerified','institutionUpdatedAt'].some(key=>row[key] !== null)) throw new Error('Unsupported lender conclusion');
      if (row.aprs !== null && (!Array.isArray(row.aprs) || row.aprs.length > 50)) throw new Error('Invalid APR coverage');
      projected.aprs = row.aprs === null ? null : (row.aprs as unknown[]).map(apr => pick(apr,['percentage','sourceType','subjectBalance','interestCharge']));
    } else {
      if (row.bankSettlementVerified !== false || command.domain === 'expenses' && row.recognizedExpense !== null) throw new Error('Unsupported accounting conclusion');
      for (const key of ['vendor','entity','paymentAccount']) if (Object.hasOwn(row,key)) projected[key] = row[key] === null ? null : pick(row[key],['nativeId','sourceLabel']);
      if (Object.hasOwn(row,'issues')) {
        if (!Array.isArray(row.issues) || row.issues.length > 6 || row.issues.some(v=>typeof v !== 'string' || v.length > 100)) throw new Error('Invalid source issues');
        projected.issues = row.issues;
      }
    }
    return projected;
  });
  if (new Set(records.map(row=>row.nativeId)).size !== records.length) throw new Error('Conflicting native records');
  return { ...pick(evidence,['binding_id','binding_revision','version','account_snapshot_version','provider','domain','coverage','pages_complete',
    'source_observed_at','synchronized_at','normalized_digest','observation_id','receipt_run_id','temporal_basis','institution_freshness_verified']),
    records, calculated_totals: null,
    ...(debt ? { company_wide_debt: null, scheduled_debt_service: null } : { recognized_expenses: null, bank_settlement_verified: false, payment_execution_supported: false }) };
}

// Use the existing caller-JWT client. Auth/service grants on the underlying RPCs
// are enforced in PostgreSQL; an injected selector or this interface grants nothing.
// Do not pass a privileged fallback client or retain evidence as durable Memory.
export async function executeFinanceRead(client: FinanceCallerClient, input: unknown): Promise<ReadResult> {
  const command = object(input);
  if (!command || !FINANCE_READ_CAPABILITIES.some(c => c.key === command.capability)) return result('refused', 'invalid_finance_read');
  const planning = ['finance.budget_read','finance.cash_scenario_read'].includes(String(command.capability));
  const obligations = command.capability === 'finance.accounting_obligations';
  const allowed = planning ? ['capability','entity_id','plan_id',...(command.version === undefined ? [] : ['version'])]
    : command.capability === 'finance.source_catalog' ? ['capability'] : ['capability', 'entity_id', 'binding_id', ...(obligations ? ['domain'] : [])];
  if (Object.keys(command).length !== allowed.length || Object.keys(command).some(key => !allowed.includes(key))
    || !planning && command.capability !== 'finance.source_catalog' && (!uuid(command.entity_id) || !uuid(command.binding_id))
    || obligations && !['bills','expenses'].includes(String(command.domain))
    || planning && (!uuid(command.entity_id) || !uuid(command.plan_id) || command.version !== undefined && (!Number.isSafeInteger(command.version) || (command.version as number)<1))) return result('refused', 'invalid_finance_read');
  try {
    const actor = await client.auth.getUser();
    if (actor.error || !uuid(actor.data.user?.id)) return result('refused', 'actor_unavailable');
    const workspace = await client.rpc('current_user_tenant_id');
    if (workspace.error || !uuid(workspace.data)) return result('refused', 'workspace_unavailable');
    let entityVersion: number | undefined;
    if (planning) {
      const catalog = await client.rpc('read_finance_source_catalog', { _expected_tenant_id: workspace.data });
      const metadata = object(catalog.data);
      if (catalog.error || metadata?.tenant_id !== workspace.data || !Array.isArray(metadata.entities) || metadata.entities.length > 200) return result('unavailable','finance_company_unavailable');
      const entities = metadata.entities.map(object).filter(e => e?.id === command.entity_id);
      const entity = entities.length === 1 ? entities[0] : null;
      if (!entity || entity.is_active !== true || !Number.isSafeInteger(entity.version) || (entity.version as number)<1) return result('unavailable','finance_company_unavailable');
      entityVersion = entity.version as number;
    }
    const read = planning
      ? await client.rpc(command.capability === 'finance.budget_read' ? 'read_finance_budget' : 'read_finance_cash_scenario',
        { _tenant: workspace.data, _entity: command.entity_id, _entity_version: entityVersion,
          [command.capability === 'finance.budget_read' ? '_budget' : '_scenario']: command.plan_id, _version: command.version ?? null })
      : command.capability === 'finance.source_catalog'
      ? await client.rpc('read_finance_source_catalog', { _expected_tenant_id: workspace.data })
      : await client.rpc(command.capability === 'finance.liability_source' ? 'read_finance_liability_source' : obligations ? 'read_finance_accounting_obligations' : 'read_finance_account_source',
        { _expected_tenant: workspace.data, _entity_id: command.entity_id, _binding_id: command.binding_id, ...(obligations ? { _domain: command.domain } : {}) });
    if (read.error) return result('unavailable', 'finance_source_read_failed');
    const evidence = object(read.data);
    if (!evidence) return result('unavailable', 'invalid_finance_evidence');
    // A workspace switch during the read invalidates the result; no old-account
    // result is returned after the canonical caller scope changes.
    const after = await client.rpc('current_user_tenant_id');
    if (after.error || after.data !== workspace.data) return result('refused', 'workspace_changed');
    const afterActor = await client.auth.getUser();
    if (afterActor.error || afterActor.data.user?.id !== actor.data.user?.id) return result('refused', 'actor_changed');
    if (planning) return result('read', null, planningProjection(evidence, command));
    if (command.capability === 'finance.liability_source' || obligations) return result('read', null, recordProjection(evidence, command));
    if (command.capability === 'finance.source_catalog') {
      if (evidence.tenant_id !== workspace.data || !Array.isArray(evidence.entities) || evidence.entities.length > 200
        || !Array.isArray(evidence.sources) || evidence.sources.length > 1000) return result('unavailable', 'invalid_finance_evidence');
    } else if (!['complete', 'partial', 'unavailable'].includes(String(evidence.coverage))
      || evidence.coverage !== 'unavailable' && (evidence.binding_id !== command.binding_id || !Array.isArray(evidence.accounts) || evidence.accounts.length > 500
        || evidence.temporal_basis !== 'source_snapshot' || evidence.institution_freshness_verified !== false)) return result('unavailable', 'invalid_finance_evidence');
    // Closed projections prevent future RPC additions leaking credentials/raw
    // provider payloads. No command fields are merged into trusted evidence.
    const projection = command.capability === 'finance.source_catalog'
      ? { ...pick(evidence, ['tenant_id', 'read_at']),
        entities: (evidence.entities as unknown[]).map(row => pick(row, ['id', 'legal_name', 'kind', 'identity_basis', 'version', 'is_active'])),
        sources: (evidence.sources as unknown[]).map(row => pick(row, ['id', 'entity_id', 'provider', 'environment', 'verification_state', 'revision', 'verified_at', 'connection_active'])) }
      : { ...pick(evidence, ['binding_id', 'binding_revision', 'version', 'provider', 'environment', 'coverage', 'pages_complete', 'source_observed_at', 'synchronized_at', 'normalized_digest', 'observation_id', 'receipt_run_id', 'temporal_basis', 'institution_freshness_verified', 'reason']),
        accounts: evidence.coverage === 'unavailable' ? null : (evidence.accounts as unknown[]).map(accountProjection), calculated_totals: null };
    if('accounts' in projection&&Array.isArray(projection.accounts)&&new Set(projection.accounts.map(row=>row.native_id)).size!==projection.accounts.length)
      return result('unavailable','conflicting_native_accounts');
    return result('read', null, projection);
  } catch { return result('unavailable', 'finance_source_read_failed'); }
}
