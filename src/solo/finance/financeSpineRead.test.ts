import { describe, expect, it, vi } from 'vitest';
import { executeFinanceRead, FINANCE_READ_CAPABILITIES } from '../../../supabase/functions/_shared/paige-spine/domains/finance_reads.ts';
const actor = '10000000-0000-0000-0000-000000000001', tenant = '20000000-0000-0000-0000-000000000001', entity = '30000000-0000-0000-0000-000000000001', binding = '50000000-0000-0000-0000-000000000001';
const command = { capability: 'finance.account_source', entity_id: entity, binding_id: binding };
const debtCommand = { ...command, capability: 'finance.liability_source' };
const billCommand = { ...command, capability: 'finance.accounting_obligations', domain: 'bills' };
const sourceBase = () => ({ binding_id: binding, binding_revision: 1, coverage: 'partial', temporal_basis: 'source_snapshot', institution_freshness_verified: false });
const debtEvidence = () => ({ ...sourceBase(), company_wide_debt: null, scheduled_debt_service: null,
  records: [{ nativeId: 'card-a', sourceLabel: 'Original institution label', product: 'credit_card', currency: 'USD',
    outstandingBalance: '123.00', availableCredit: '0', principalBalance: null, aprs: null,
    accountingClassificationVerified: false, companyOwnershipVerified: false, principalPayment: null, interestPayment: null,
    collateralVerified: null, guaranteeVerified: null, institutionUpdatedAt: null }] });
const billEvidence = () => ({ ...sourceBase(), domain: 'bills', recognized_expenses: null, bank_settlement_verified: false, payment_execution_supported: false,
  records: [{ nativeId: 'bill-a', currency: 'EUR', recordedTotal: '250', recordedOutstanding: '0', accountingStatus: 'recorded_zero_balance',
    bankSettlementVerified: false, paymentExecutionSupported: false, vendor: { nativeId: 'vendor-a', sourceLabel: 'Original vendor wording' }, issues: [] }] });
const evidence = () => ({ binding_id: binding, binding_revision: 1, coverage: 'partial', accounts: [{ native_id: 'native-a', source_label: 'Owner label', current_balance: null, available_cash: '0', currency: 'USD' }], temporal_basis: 'source_snapshot', institution_freshness_verified: false });
function client(data: unknown = evidence()) {
  return { auth: { getUser: vi.fn(async () => ({ data: { user: { id: actor } }, error: null })) }, rpc: vi.fn(async (name: string, _args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => ({ data: name === 'current_user_tenant_id' ? tenant : name==='read_finance_source_catalog'
    ? data&&typeof data==='object'&&'tenant_id' in data ? data : {tenant_id:tenant,entities:[{id:entity,is_active:true,version:1}],sources:[{id:binding,entity_id:entity,revision:1,verification_state:'verified',connection_active:true}]} : data, error: null })) };
}
describe('Finance Spine read candidate', () => {
  it('reads distinct debt records without turning available credit into cash or a company aggregate', async () => {
    const c = client(debtEvidence()); const r = await executeFinanceRead(c, debtCommand);
    expect(c.rpc).toHaveBeenCalledWith('read_finance_liability_source',{ _expected_tenant: tenant, _entity_id: entity, _binding_id: binding });
    expect(r).toMatchObject({ outcome: 'read', evidence: { records: [{ sourceLabel: 'Original institution label', availableCredit: '0', principalBalance: null }], company_wide_debt: null, scheduled_debt_service: null, calculated_totals: null } });
  });
  it('preserves zero bill balance while withholding settlement and expense recognition', async () => {
    const c = client(billEvidence()); const r = await executeFinanceRead(c, billCommand);
    expect(c.rpc).toHaveBeenCalledWith('read_finance_accounting_obligations',{ _expected_tenant: tenant, _entity_id: entity, _binding_id: binding, _domain: 'bills' });
    expect(r).toMatchObject({ outcome: 'read', evidence: { records: [{ recordedOutstanding: '0', accountingStatus: 'recorded_zero_balance', vendor: { sourceLabel: 'Original vendor wording' } }], bank_settlement_verified: false, recognized_expenses: null } });
  });
  it('rejects unsupported source conclusions and completed company-wide debt claims', async () => {
    for (const change of [{ company_wide_debt: '123' }, { scheduled_debt_service: '5' }, { coverage: 'complete' }, { institution_freshness_verified: true }])
      expect((await executeFinanceRead(client({ ...debtEvidence(), ...change }), debtCommand)).outcome).toBe('unavailable');
    expect((await executeFinanceRead(client({ ...billEvidence(), bank_settlement_verified: true }), billCommand)).outcome).toBe('unavailable');
    expect((await executeFinanceRead(client({ ...billEvidence(), recognized_expenses: '250' }), billCommand)).outcome).toBe('unavailable');
  });
  it('refuses source domain and actor/tenant injection before making source reads', async () => {
    for (const selector of [{ ...billCommand, domain: 'payments' }, { ...debtCommand, tenant_id: tenant }, { ...debtCommand, entity_id: 'wrong' }]) {
      const c = client(); expect((await executeFinanceRead(c, selector)).outcome).toBe('refused'); expect(c.rpc).not.toHaveBeenCalled();
    }
  });
  it('rejects duplicate native records and altered bindings', async () => {
    const e=debtEvidence(); expect((await executeFinanceRead(client({ ...e, records: [...e.records,...e.records] }),debtCommand)).outcome).toBe('unavailable');
    expect((await executeFinanceRead(client({ ...billEvidence(),binding_id: entity }),billCommand)).outcome).toBe('unavailable');
  });
  it('keeps unknown revoked or stale source results unavailable without zero substitution', async () => {
    for (const selector of [debtCommand,billCommand]) expect(await executeFinanceRead(client({ coverage: 'unavailable', records: null, reason: 'account_evidence_changed' }),selector))
      .toMatchObject({ outcome: 'read', evidence: { records: null, calculated_totals: null, reason: 'account_evidence_changed' } });
  });
  it('omits future raw credentials and nested private accounting fields', async () => {
    const e=billEvidence(); e.records[0].vendor=Object.assign(e.records[0].vendor,{ token: 'SECRET' });
    expect(JSON.stringify(await executeFinanceRead(client({ ...e, raw_payload: 'SECRET' }),billCommand))).not.toContain('SECRET');
  });
  it('resolves workspace from the authenticated caller, preserving unknown and explicit zero', async () => {
    const c = client(); const r = await executeFinanceRead(c, command);
    expect(c.rpc).toHaveBeenCalledWith('read_finance_account_source', { _expected_tenant: tenant, _entity_id: entity, _binding_id: binding });
    expect(r).toMatchObject({ outcome: 'read', financialEffectsExecuted: false, evidence: { accounts: [{ current_balance: null, available_cash: '0', source_label: 'Owner label' }], calculated_totals: null } });
  });
  it('refuses caller-supplied workspace identifiers before reading', async () => {
    const c = client(); expect((await executeFinanceRead(c, { ...command, tenant_id: tenant })).outcome).toBe('refused'); expect(c.rpc).not.toHaveBeenCalled();
  });
  it('refuses actor identifiers and unknown commands', async () => {
    const c = client(); expect((await executeFinanceRead(c, { ...command, actor_id: actor })).outcome).toBe('refused'); expect((await executeFinanceRead(c, { capability: 'bank.transfer' })).outcome).toBe('refused');
  });
  it('refuses malformed company/source selectors', async () => expect((await executeFinanceRead(client(), { ...command, entity_id: 'other' })).outcome).toBe('refused'));
  it('refuses unauthenticated reads without privileged fallback', async () => {
    const c = client(); c.auth.getUser.mockResolvedValue({ data: { user: { id: '' } }, error: null }); expect((await executeFinanceRead(c, command)).reason).toBe('actor_unavailable'); expect(c.rpc).not.toHaveBeenCalled();
  });
  it('refuses unavailable server workspace resolution', async () => { const c = client(); c.rpc.mockResolvedValue({ data: null, error: null }); expect((await executeFinanceRead(c, command)).reason).toBe('workspace_unavailable'); });
  it('sanitizes server tenant, company, membership and provider failures', async () => {
    const c = client(); c.rpc.mockImplementation(async name => name === 'current_user_tenant_id' ? { data: tenant, error: null } : { data: null, error: { message: 'SECRET provider credential', code: '42501' } });
    const r = await executeFinanceRead(c, command); expect(r.outcome).toBe('unavailable'); expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  it('rejects cross-account switching during a read', async () => {
    const c = client(); c.rpc.mockResolvedValueOnce({ data: tenant, error: null }).mockResolvedValueOnce({ data: evidence(), error: null }).mockResolvedValueOnce({ data: '20000000-0000-0000-0000-000000000002', error: null });
    expect(await executeFinanceRead(c, command)).toMatchObject({ outcome: 'refused', reason: 'workspace_changed', evidence: null });
  });
  it('preserves unavailable evidence without synthesizing accounts or zero totals', async () => {
    expect((await executeFinanceRead(client({ coverage: 'unavailable', accounts: null, reason: 'source_revoked' }), command)).evidence).toEqual({ coverage: 'unavailable', reason: 'source_revoked', accounts: null, calculated_totals: null });
  });
  it('refuses same-workspace identity changes and revoked sessions after the source read', async () => {
    for (const nextActor of ['', '10000000-0000-0000-0000-000000000002']) {
      const c = client();
      c.auth.getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: null })
        .mockResolvedValueOnce({ data: { user: { id: nextActor } }, error: null });
      expect(await executeFinanceRead(c, command)).toMatchObject({ outcome: 'refused', reason: 'actor_changed', evidence: null });
    }
  });
  it('rejects mismatched source identity and false freshness claims', async () => {
    expect((await executeFinanceRead(client({ ...evidence(), binding_id: entity }), command)).outcome).toBe('unavailable');
    expect((await executeFinanceRead(client({ ...evidence(), institution_freshness_verified: true }), command)).outcome).toBe('unavailable');
  });
  it('uses closed evidence projections that omit unknown sensitive fields', async () => {
    const e = evidence(); const r = await executeFinanceRead(client({ ...e, access_token: 'SECRET', accounts: [{ ...e.accounts[0], raw_provider: 'SECRET' }] }), command);
    expect(r.outcome).toBe('read'); expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  it('rejects malformed and oversized source rows', async () => {
    expect((await executeFinanceRead(client({ ...evidence(), accounts: [null] }), command)).outcome).toBe('unavailable');
    expect((await executeFinanceRead(client({ ...evidence(), accounts: Array(501).fill({}) }), command)).outcome).toBe('unavailable');
  });
  it('withholds conflicting native account identities and approximate or malformed balances', async () => {
    const e=evidence();
    expect((await executeFinanceRead(client({...e,accounts:[...e.accounts,...e.accounts]}),command)).outcome).toBe('unavailable');
    for(const balance of [9007199254740992,'1e9','NaN','1,000'])
      expect((await executeFinanceRead(client({...e,accounts:[{...e.accounts[0],current_balance:balance}]}),command)).outcome).toBe('unavailable');
  });
  it('reads bounded company/source metadata without leaking unknown fields', async () => {
    const r = await executeFinanceRead(client({ tenant_id: tenant, entities: [{ id: entity, legal_name: 'Company', token: 'SECRET' }], sources: [{ id: binding, provider: 'plaid', secret: 'SECRET' }] }), { capability: 'finance.source_catalog' });
    expect(r.outcome).toBe('read'); expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  it('refuses catalog tenant mismatch', async () => expect((await executeFinanceRead(client({ tenant_id: entity, entities: [], sources: [] }), { capability: 'finance.source_catalog' })).outcome).toBe('unavailable'));
  it('sanitizes thrown transport failures', async () => { const c = client(); c.auth.getUser.mockRejectedValue(new Error('SECRET')); expect(await executeFinanceRead(c, command)).toMatchObject({ outcome: 'unavailable', reason: 'finance_source_read_failed', evidence: null }); });
  it('does not claim Chat or Mind adoption before the protected binding is released', () => {
    expect(FINANCE_READ_CAPABILITIES).toHaveLength(6); for (const c of FINANCE_READ_CAPABILITIES) { expect(c.chatBinding).toBe('UNAVAILABLE'); expect(c.mindBinding).toBe('UNAVAILABLE'); expect(c.selfDescribe).toBe(false); expect(c.action.classification).toBe('read'); expect(c.action).not.toHaveProperty('chatTool'); }
  });
});

const planId = '61000000-0000-0000-0000-000000000001';
const planningCommand = { capability: 'finance.cash_scenario_read', entity_id: entity, plan_id: planId };
const scenario = () => ({ id: planId, entity_id: entity, version: 1, current_version: 1, company_identity_current: true,
  basis: 'owner_entered_assumptions', amount_unit: 'decimal_major', verified_opening_cash: null, contractual_obligations: null,
  guaranteed_result: false, receipt_run_id: planId, created_at: '2026-10-10T21:00:00Z',
  config: { title: 'Owner scenario', currency: 'USD', start_date: '2026-11-01', horizon_days: 90, opening_cash: null, cash_floor: '100',
    assumptions: 'Not bank-verified', events: [{ id: 'event', source_label: 'Original label', date: '2026-11-02', direction: 'outflow', amount: '1.000001', occurrence_ref: null }] } });
function planningClient(data: unknown = scenario()) {
  const c = client(data);
  c.rpc.mockImplementation(async name => ({ data: name === 'current_user_tenant_id' ? tenant
    : name === 'read_finance_source_catalog' ? { tenant_id: tenant, entities: [{ id: entity, version: 7, is_active: true }], sources: [] } : data, error: null }));
  return c;
}
describe('Finance Spine planning reads', () => {
  it('resolves current company version server-side and preserves unknown opening cash', async () => {
    const c = planningClient(); const r = await executeFinanceRead(c, planningCommand);
    expect(c.rpc).toHaveBeenCalledWith('read_finance_cash_scenario', { _tenant: tenant, _entity: entity, _entity_version: 7, _scenario: planId, _version: null });
    expect(r).toMatchObject({ outcome: 'read', evidence: { verified_opening_cash: null, config: { opening_cash: null } }, financialEffectsExecuted: false });
  });
  it.each(['tenant_id','actor_id','entity_version','approved'])('refuses injected %s authority', async field => {
    const c = planningClient(); expect((await executeFinanceRead(c, { ...planningCommand, [field]: 7 })).outcome).toBe('refused');
    expect(c.rpc).not.toHaveBeenCalled();
  });
  it('rejects changed company identity without financial conclusions', async () => {
    expect((await executeFinanceRead(planningClient({ ...scenario(), company_identity_current: false }), planningCommand)).outcome).toBe('unavailable');
  });
  it('refuses unexpected actual-cash claims', async () => {
    expect((await executeFinanceRead(planningClient({ ...scenario(), verified_opening_cash: '0' }), planningCommand)).outcome).toBe('unavailable');
  });
  it('supports historical versions without silently substituting current version', async () => {
    expect((await executeFinanceRead(planningClient(), { ...planningCommand, version: 2 })).outcome).toBe('unavailable');
    expect((await executeFinanceRead(planningClient(), { ...planningCommand, version: 1 })).outcome).toBe('read');
  });
  it('removes raw and unknown fields from planning evidence', async () => {
    const s = scenario(); const r = await executeFinanceRead(planningClient({ ...s, token: 'SECRET', config: { ...s.config, raw: 'SECRET',
      events: [{ ...s.config.events[0], access_token: 'SECRET' }] } }), planningCommand);
    expect(r.outcome).toBe('read'); expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  it('rejects workspace changes before returning planning evidence', async () => {
    const c = planningClient(); let workspaces = 0;
    const ordinary = c.rpc.getMockImplementation()!;
    c.rpc.mockImplementation(async (name, args) => name === 'current_user_tenant_id' && ++workspaces === 2
      ? { data: entity, error: null } : ordinary(name, args));
    expect((await executeFinanceRead(c, planningCommand)).reason).toBe('workspace_changed');
  });
  it('reads a budget without inventing accounting actuals', async () => {
    const c = planningClient({ id: planId, entity_id: entity, version: 1, current_version: 1, company_identity_current: true, basis: 'owner_entered_plan',
      currency: 'EUR', period_start: '2026-11-01', period_end: '2026-11-30', title: 'Owner plan', assumptions: '', actuals: null,
      lines: [{ id: 'expense', source_label: 'Original label', direction: 'expense', planned_amount_decimal: '0' }] });
    expect(await executeFinanceRead(c, { ...planningCommand, capability: 'finance.budget_read' })).toMatchObject({ outcome: 'read', evidence: { actuals: null } });
  });
});

it('keeps validated source selectors stable during actor resolution',async()=>{
  const mutable={...command};const c=client();
  c.auth.getUser.mockImplementation(async()=>{mutable.binding_id=entity;return {data:{user:{id:actor}},error:null};});
  await executeFinanceRead(c,mutable);
  expect(c.rpc).toHaveBeenCalledWith('read_finance_account_source',{_expected_tenant:tenant,_entity_id:entity,_binding_id:binding});
});


describe('Finance read final authority and source fence',()=>{
 it('withholds prior facts when owner/admin authority is revoked after the source read',async()=>{
  const c=client();const ordinary=c.rpc.getMockImplementation()!;
  c.rpc.mockImplementation(async(name,args)=>name==='read_finance_source_catalog'
   ?{data:null,error:{code:'42501',message:'private membership detail'}}:ordinary(name,args));
  expect(await executeFinanceRead(c,command)).toMatchObject({outcome:'refused',reason:'finance_authority_changed',evidence:null});
 });
 it('withholds prior facts when the selected company becomes inactive after the source read',async()=>{
  const c=client();const ordinary=c.rpc.getMockImplementation()!;
  c.rpc.mockImplementation(async(name,args)=>name==='read_finance_source_catalog'
   ?{data:{tenant_id:tenant,entities:[{id:entity,is_active:false,version:1}],sources:[]},error:null}:ordinary(name,args));
  expect(await executeFinanceRead(c,command)).toMatchObject({outcome:'refused',reason:'finance_company_changed',evidence:null});
 });
 it('withholds a source snapshot when binding authority changes after the read',async()=>{
  const c=client({...evidence(),binding_revision:3});const ordinary=c.rpc.getMockImplementation()!;
  c.rpc.mockImplementation(async(name,args)=>name==='read_finance_source_catalog'
   ?{data:{tenant_id:tenant,entities:[{id:entity,is_active:true,version:1}],sources:[{id:binding,entity_id:entity,revision:4,verification_state:'verified',connection_active:true}]},error:null}:ordinary(name,args));
  expect(await executeFinanceRead(c,command)).toMatchObject({outcome:'refused',reason:'finance_source_changed',evidence:null});
 });
 it('withholds an owner plan when company identity changes after its historical read',async()=>{
  const c=planningClient();const ordinary=c.rpc.getMockImplementation()!;let catalogs=0;
  c.rpc.mockImplementation(async(name,args)=>name==='read_finance_source_catalog'&&++catalogs===2
   ?{data:{tenant_id:tenant,entities:[{id:entity,is_active:true,version:8}],sources:[]},error:null}:ordinary(name,args));
  expect(await executeFinanceRead(c,planningCommand)).toMatchObject({outcome:'refused',reason:'finance_company_changed',evidence:null});
 });
});


it('voids source evidence if workspace switching occurs during the final authority read',async()=>{
 const c=client();const ordinary=c.rpc.getMockImplementation()!;let reads=0;
 c.rpc.mockImplementation(async(name,args)=>name==='current_user_tenant_id'&&++reads===3
  ?{data:entity,error:null}:ordinary(name,args));
 expect(await executeFinanceRead(c,command)).toMatchObject({outcome:'refused',reason:'workspace_changed',evidence:null});
});
it('voids source evidence if actor switching occurs during the final authority read',async()=>{
 const c=client();c.auth.getUser.mockResolvedValueOnce({data:{user:{id:actor}},error:null})
  .mockResolvedValueOnce({data:{user:{id:actor}},error:null}).mockResolvedValueOnce({data:{user:{id:entity}},error:null});
 expect(await executeFinanceRead(c,command)).toMatchObject({outcome:'refused',reason:'actor_changed',evidence:null});
});
it.each([{verification_state:'revoked'},{connection_active:false},{entity_id:tenant}])('refuses final binding lifecycle mismatch %j',async(change)=>{
 const c=client();const ordinary=c.rpc.getMockImplementation()!;
 c.rpc.mockImplementation(async(name,args)=>name==='read_finance_source_catalog'
  ?{data:{tenant_id:tenant,entities:[{id:entity,is_active:true,version:1}],sources:[{id:binding,entity_id:entity,revision:1,verification_state:'verified',connection_active:true,...change}]},error:null}:ordinary(name,args));
 expect(await executeFinanceRead(c,command)).toMatchObject({outcome:'refused',reason:'finance_source_changed',evidence:null});
});
it('does not leak final authority transport failures or return prior financial facts',async()=>{
 const c=client();const ordinary=c.rpc.getMockImplementation()!;
 c.rpc.mockImplementation(async(name,args)=>{if(name==='read_finance_source_catalog')throw new Error('SECRET private transport');return ordinary(name,args);});
 const r=await executeFinanceRead(c,command);expect(r).toMatchObject({outcome:'unavailable',reason:'finance_source_read_failed',evidence:null});expect(JSON.stringify(r)).not.toContain('SECRET');
});
