import {expect,it,vi} from 'vitest';
import {projectClientCommercialStatus,readClientCommercialStatus} from './client-commercial-status';

const id=(n:number)=>`ec041100-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),client=id(2),tenant=id(3),invoice=id(4);
const scope={actorId:actor,clientId:client,tenantId:tenant};
const date='2026-10-14T12:00:00+00:00';
const row={id:invoice,invoice_number:'SYN-1',status:'issued',currency:'usd',issued_at:date,due_date:'2026-10-15',issued_snapshot_version:1,
  amount_minor:'350000',allocated_minor:'45000',remaining_minor:'305000',manual_recorded_minor:'2000',provider_verified_minor:'43000',test_provider_minor:'3000',document_available:true};
const envelope=()=>({schema_version:1,actor_id:actor,tenant_id:tenant,client_id:client,invoices:[{...row}],invoice_count:1,has_more:false,next_cursor:null,
  balances:[{currency:'usd',remaining_minor:'305000',manual_recorded_minor:'2000',provider_verified_minor:'43000',test_provider_minor:'3000'}],invoice:null as unknown,
  next_payment:{state:'unavailable',reason:'effective_due_obligation_not_recorded'},engagement_completion:{state:'not_evaluated'},balance_basis:'canonical_invoice_allocations',read_at:date});
function fixture(){
  const profile=vi.fn().mockResolvedValue({data:{id:client,tenant_id:tenant,linked_user_id:actor},error:null});
  const domain=vi.fn().mockResolvedValue({data:envelope(),error:null});
  const caller={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:actor}},error:null})},
    from:vi.fn(()=>{throw Error('Raw CRM read unavailable');}),
    rpc:vi.fn((name:string,args:Record<string,unknown>)=>name==='client_portal_self_profile'?profile(args):domain(name,args))};
  return {caller,profile,domain};
}
it('uses actual SDK/self-link authority and passes only canonical scoped read arguments',async()=>{
  const {caller,domain}=fixture();
  const result=await readClientCommercialStatus(caller,actor,()=>true);
  expect(result.kind).toBe('ready');
  expect(caller.auth.getUser).toHaveBeenCalledTimes(4);
  expect(caller.from).not.toHaveBeenCalled();
  expect(caller.rpc).toHaveBeenCalledWith('client_portal_self_profile',{});
  expect(domain).toHaveBeenCalledOnce();
  expect(domain).toHaveBeenCalledWith('read_client_commercial_status_scoped',{
    p_expected_actor_id:actor,p_expected_tenant_id:tenant,p_client_id:client,p_invoice_id:null,p_limit:40,p_after:null,
  });
  if(result.kind==='ready'){
    expect(result.status.balances[0]).toEqual({currency:'usd',remainingMinor:'305000',manualRecordedMinor:'2000',providerVerifiedMinor:'43000',testProviderMinor:'3000'});
    expect(result.status.nextPayment.state).toBe('unavailable');expect(result.status.engagementCompletion.state).toBe('not_evaluated');
  }
});
it('refuses a wrong actual actor before any domain read',async()=>{
  const {caller}=fixture();caller.auth.getUser.mockResolvedValue({data:{user:{id:id(9)}},error:null});
  expect(await readClientCommercialStatus(caller,actor,()=>true)).toEqual({kind:'refused'});expect(caller.rpc).not.toHaveBeenCalled();
});
it.each([
  {rows:null,expected:'unlinked'},
  {rows:[{id:client,tenant_id:tenant},{id:id(8),tenant_id:id(9)}],expected:'unavailable'},
])('does not choose the first missing or ambiguous link ($expected)',async({rows,expected})=>{
  const {caller,profile,domain}=fixture();profile.mockResolvedValue({data:rows,error:null});
  expect((await readClientCommercialStatus(caller,actor,()=>true)).kind).toBe(expected);expect(domain).not.toHaveBeenCalled();
});
it('discards returned financial data when the real relation changes during the read',async()=>{
  const {caller,profile,domain}=fixture();domain.mockImplementation(async()=>{
    profile.mockResolvedValue({data:{id:id(7),tenant_id:tenant,linked_user_id:actor},error:null});return {data:envelope(),error:null};
  });
  expect(await readClientCommercialStatus(caller,actor,()=>true)).toEqual({kind:'refused'});
});
it('discards the reply after the current view retires and does not issue another lookup',async()=>{
  const {caller,domain}=fixture();let alive=true;
  domain.mockImplementation(async()=>{alive=false;return {data:envelope(),error:null};});
  expect(await readClientCommercialStatus(caller,actor,()=>alive)).toEqual({kind:'scope_changed'});
  expect(caller.auth.getUser).toHaveBeenCalledTimes(2);
});
it('does no work for a retired view or an invalid invoice selector',async()=>{
  const {caller}=fixture();expect(await readClientCommercialStatus(caller,actor,()=>false)).toEqual({kind:'scope_changed'});
  expect(await readClientCommercialStatus(caller,actor,()=>true,{invoiceId:'invalid'})).toEqual({kind:'unavailable'});
  expect(caller.auth.getUser).not.toHaveBeenCalled();expect(caller.rpc).not.toHaveBeenCalled();
});
it.each(['42501','40001','22023'])('treats canonical authorization/source refusal as refusal (%s)',async code=>{
  const {caller,domain}=fixture();domain.mockResolvedValue({data:null,error:{code}});
  expect(await readClientCommercialStatus(caller,actor,()=>true)).toEqual({kind:'refused'});
});
it('keeps an absent backend unavailable rather than presenting zero balances',async()=>{
  const {caller,domain}=fixture();domain.mockResolvedValue({data:null,error:{code:'PGRST202'}});
  expect(await readClientCommercialStatus(caller,actor,()=>true)).toEqual({kind:'unavailable'});
});
it('does not round integer strings or collapse test evidence into live payment evidence',()=>{
  const value=envelope();value.balances[0].remaining_minor='9007199254740993123456';
  expect(projectClientCommercialStatus(value,scope)?.balances[0].remainingMinor).toBe('9007199254740993123456');
  expect(projectClientCommercialStatus(value,scope)?.balances[0].testProviderMinor).toBe('3000');
});
it.each([
  (v:ReturnType<typeof envelope>)=>{v.actor_id=id(9)},
  (v:ReturnType<typeof envelope>)=>{v.tenant_id=id(9)},
  (v:ReturnType<typeof envelope>)=>{v.client_id=id(9)},
  (v:ReturnType<typeof envelope>)=>{v.invoices[0].remaining_minor='1.5'},
  (v:ReturnType<typeof envelope>)=>{v.invoices[0].remaining_minor='NaN'},
  (v:ReturnType<typeof envelope>)=>{v.balances.push({...v.balances[0]})},
  (v:ReturnType<typeof envelope>)=>{v.invoices.push({...v.invoices[0]});v.invoice_count=2},
  (v:ReturnType<typeof envelope>)=>{v.next_payment.state='paid'},
  (v:ReturnType<typeof envelope>)=>{v.engagement_completion.state='completed'},
])('refuses malformed scope, money, duplicate records or unsupported completion claims',change=>{
  const value=envelope();change(value);expect(projectClientCommercialStatus(value,scope)).toBeNull();
});
it('keeps currency balances separate and exact cursor continuity tied to the last row',()=>{
  const value=envelope();value.invoice_count=2;value.has_more=true;
  Object.assign(value,{next_cursor:{issued_at:date,id:invoice}});
  value.balances.push({currency:'eur',remaining_minor:'1200',manual_recorded_minor:'0',provider_verified_minor:'0',test_provider_minor:'0'});
  expect(projectClientCommercialStatus(value,scope)?.balances).toHaveLength(2);
  expect(projectClientCommercialStatus(value,scope)?.nextCursor).toEqual({issued_at:date,id:invoice});
  Object.assign(value,{next_cursor:{issued_at:date,id:id(8)}});expect(projectClientCommercialStatus(value,scope)).toBeNull();
});
it('requires an exact requested invoice and refuses a detail returned without a selector',()=>{
  const value=envelope();value.invoice={...row,document:{snapshot:{title:'Synthetic issued document'}}};
  expect(projectClientCommercialStatus(value,scope,invoice)?.invoice?.id).toBe(invoice);
  expect(projectClientCommercialStatus(value,scope,id(8))).toBeNull();expect(projectClientCommercialStatus(value,scope)).toBeNull();
});
it('reloads canonical corrections rather than preserving an invented settled balance',async()=>{
  const {caller,domain}=fixture();const first=await readClientCommercialStatus(caller,actor,()=>true);
  const corrected=envelope();corrected.invoices[0].remaining_minor='300000';corrected.invoices[0].allocated_minor='50000';corrected.invoices[0].manual_recorded_minor='7000';
  corrected.balances[0].remaining_minor='300000';corrected.balances[0].manual_recorded_minor='7000';
  domain.mockResolvedValue({data:corrected,error:null});const second=await readClientCommercialStatus(caller,actor,()=>true);
  expect(first.kind==='ready'&&first.status.balances[0].remainingMinor).toBe('305000');
  expect(second.kind==='ready'&&second.status.balances[0].remainingMinor).toBe('300000');
});
