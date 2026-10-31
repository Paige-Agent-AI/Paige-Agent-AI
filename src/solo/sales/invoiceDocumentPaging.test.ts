import {describe,it,expect} from 'vitest';
import {collectInvoiceLedger as collect} from '../../../supabase/functions/_shared/sales-invoice-ledger';
import {renderSalesInvoiceDocument} from '../../../supabase/functions/_shared/sales-invoice-document';
const page=(n:number,more:boolean,count:number)=>({version:1,current_invoice_number:'INV-1',payment_ledger:{rows:Array.from({length:n},()=>({})),count,as_of:'2026-10-04'},has_more:more,next_cursor:more?{ordinal:n}:null});
describe('actual document edge bounded ledger collector',()=>{
 it('collects scoped pages with only server cursor and marks complete',async()=>{const calls:Record<string,unknown>[]=[];const pages=[page(100,true,101),page(1,false,101)];const result=await collect({rpc:async(name,args)=>{expect(name).toBe('read_public_sales_invoice_payment_ledger');calls.push(args);return {data:pages.shift(),error:null};}},'read_public_sales_invoice_payment_ledger',{_token_hash:'hash'});expect(result?.ledger_complete).toBe(true);expect(calls[1]).toEqual({_token_hash:'hash',_limit:100,_cursor:{ordinal:100}});});
 it('stops at 1000 and labels omitted records incomplete',async()=>{let calls=0;const result=await collect({rpc:async()=>{calls++;return{data:{...page(100,true,1001),next_cursor:{ordinal:calls*100}},error:null};}},'read_sales_invoice_payment_ledger',{});expect(calls).toBe(10);expect(result?.ledger_complete).toBe(false);expect((result?.payment_ledger as {rows:unknown[]}).rows).toHaveLength(1000);});
 it('refuses changed version, backend denial and oversized page',async()=>{let n=0;expect(await collect({rpc:async()=>({data:{...page(100,true,200),version:++n},error:null})},'x',{})).toBeNull();expect(await collect({rpc:async()=>({data:null,error:{code:'42501'}})},'x',{})).toBeNull();expect(await collect({rpc:async()=>({data:page(101,false,101),error:null})},'x',{})).toBeNull();});
});

describe('original scoped ledger to original invoice document', () => {
  const at = '2026-10-01T12:00:00Z';
  const cases = ['read_sales_invoice_payment_ledger', 'read_public_sales_invoice_payment_ledger', 'client_portal_invoice_ledger']
    .flatMap(reader => ['paige-invoice-html-v1', 'paige-invoice-html-v2'].map(renderer => ({reader, renderer})));

  function documentPages(reader: string, renderer: string) {
    const document = {
      renderer_version: renderer, invoice_number: 'INV-1', issuer_name: 'Example Studio', client_name: 'Example Client', currency: 'usd', total_cents: 10000,
      published_at: at, presentation: {template: 'modern', accent: '#26483e'},
      snapshot: {items: [{item: 'Consulting', description: 'Original agreed service', quantity: 1, unit_minor: 10000}], due_now_minor: 10000, remainder_minor: 0, due_date: '2026-10-20', kind: 'one_time'},
    };
    return [0, 1].map(index => ({
      ...page(1, index === 0, 2), invoice_id: 'original-invoice', status: 'issued', document, document_input_digest: 'a'.repeat(64),
      manual_recorded_cents: 3000, provider_verified_cents: 0, allocated_cents: 3000, remaining_cents: 7000,
      ...(reader === 'client_portal_invoice_ledger' ? {test_provider_cents: 0} : {}),
      payment_ledger: {
        as_of: at, count: 2, receipt_total_cents: 3000, reversal_total_cents: 0, complete: false,
        rows: [{id: `receipt-${index}`, kind: 'receipt', amount_cents: index === 0 ? 1000 : 2000, currency: 'usd', method: 'cash', received_at: at, posted_at: at, provenance: 'human_recorded',
          ordinal: index + 1, running_received_cents: index === 0 ? 1000 : 3000, running_remaining_cents: index === 0 ? 9000 : 7000}],
      },
    }));
  }

  it.each(cases)('$reader retains the original $renderer content and native balance after paging', async ({reader, renderer}) => {
    const pages = documentPages(reader, renderer);
    const collected = await collect({rpc: async name => {expect(name).toBe(reader); return {data: pages.shift(), error: null};}}, reader, {});
    const html = renderSalesInvoiceDocument(collected);
    expect(html).not.toBeNull();
    expect(html).toContain('Original agreed service');
    expect(html).toContain('$70.00 USD');
    expect(html).toContain('− recorded receipts $30.00 USD + reversals $0.00 USD = outstanding $70.00 USD');
    expect(html).not.toContain('Partial history');
    expect(html).not.toContain('Paid (provider-confirmed)');
  });

  it.each(cases)('$reader refuses a mixed invoice before rendering either $renderer artifact', async ({reader, renderer}) => {
    const pages = documentPages(reader, renderer).map((value, index) => index === 0 ? value : {...value, invoice_id: 'another-invoice'});
    const collected = await collect({rpc: async () => ({data: pages.shift(), error: null})}, reader, {});
    expect(collected).toBeNull();
    expect(renderSalesInvoiceDocument(collected)).toBeNull();
  });
});

const financialPage = (more: boolean) => ({
  ...page(1, more, 2),
  invoice_id: 'original-invoice',
  invoice_number: 'INV-1',
  document_input_digest: 'retained-digest',
  document: {invoice_number: 'INV-1', snapshot: {memo: 'Reviewed original', total_cents: 10000}},
  payment_evidence_version: 2,
  manual_recorded_cents: 1000,
  provider_verified_cents: 2000,
  test_provider_verified_cents: 5000,
  allocated_cents: 3000,
  remaining_cents: 7000,
  payment_ledger: {
    ...page(1, more, 2).payment_ledger,
    receipt_total_cents: 8000,
    reversal_total_cents: 0,
  },
});

async function readPages(pages: unknown[]) {
  return collect({rpc: async () => ({data: pages.shift(), error: null})}, 'read_sales_invoice_payment_ledger', {});
}

describe('original invoice document financial snapshot continuity', () => {
  it('retains a single native financial representation without recalculating its totals', async () => {
    const result = await readPages([financialPage(true), financialPage(false)]);
    expect(result?.remaining_cents).toBe(7000);
    expect(result?.test_provider_verified_cents).toBe(5000);
    expect(result?.ledger_complete).toBe(true);
    expect((result?.payment_ledger as {rows: unknown[]}).rows).toHaveLength(2);
  });

  it.each([
    ['invoice identity', {invoice_id: 'another-invoice'}],
    ['original reference', {invoice_number: 'INV-2'}],
    ['document digest', {document_input_digest: 'another-digest'}],
    ['frozen document', {document: {...financialPage(false).document, snapshot: {memo: 'Changed', total_cents: 10000}}}],
    ['financial representation', {payment_evidence_version: undefined}],
    ['provider total', {provider_verified_cents: 7000}],
    ['TEST evidence', {test_provider_verified_cents: 0}],
    ['allocated total', {allocated_cents: 8000}],
    ['remaining balance', {remaining_cents: 2000}],
    ['settlement meaning', {settlement: 'provider_verified_settled'}],
  ])('refuses changed %s even when the original version, number and as-of match', async (_label, patch) => {
    expect(await readPages([financialPage(true), {...financialPage(false), ...patch}])).toBeNull();
  });

  it.each([
    ['receipt total', {receipt_total_cents: 13000}],
    ['reversal total', {reversal_total_cents: 1000}],
    ['record count', {count: 3}],
  ])('refuses a changed ledger %s within the same original invoice version', async (_label, patch) => {
    expect(await readPages([financialPage(true), {...financialPage(false), payment_ledger: {...financialPage(false).payment_ledger, ...patch}}])).toBeNull();
  });

  it('compares JSON facts rather than object property order and preserves the server cursor', async () => {
    const first = financialPage(true);
    first.next_cursor = {ordinal: 1};
    const second = financialPage(false);
    second.document = {snapshot: {total_cents: 10000, memo: 'Reviewed original'}, invoice_number: 'INV-1'};
    const calls: Record<string, unknown>[] = [];
    const pages = [first, second];
    const result = await collect({rpc: async (_name, args) => {calls.push(args); return {data: pages.shift(), error: null};}}, 'read_sales_invoice_payment_ledger', {_expected_tenant_id: 'original-business'});
    expect(result?.ledger_complete).toBe(true);
    expect(calls[1]).toEqual({_expected_tenant_id: 'original-business', _limit: 100, _cursor: {ordinal: 1}});
  });

  it('refuses an RPC exception without retrying or changing the original read authority', async () => {
    let calls = 0;
    const result = await collect({rpc: async () => {calls++; throw new Error('Connection interrupted');}}, 'client_portal_invoice_ledger', {p_invoice_id: 'original-invoice', p_tenant_id: 'original-business'});
    expect(result).toBeNull();
    expect(calls).toBe(1);
  });

  it('refuses a repeated server cursor instead of duplicating payment history up to the cap', async () => {
    let calls = 0;
    const result = await collect({rpc: async () => {calls++; return {data: page(1, true, 20), error: null};}}, 'read_sales_invoice_payment_ledger', {});
    expect(result).toBeNull();
    expect(calls).toBe(2);
  });

  it('refuses a server cursor cycle without another call or a synthetic restart', async () => {
    const pages = [1, 2, 1].map(ordinal => ({...page(1, true, 20), next_cursor: {ordinal}}));
    let calls = 0;
    const result = await collect({rpc: async () => {calls++; return {data: pages.shift(), error: null};}}, 'client_portal_invoice_ledger', {p_tenant_id: 'original-business'});
    expect(result).toBeNull();
    expect(calls).toBe(3);
  });

  it.each([null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2'])('refuses an invalid native ledger count %s', async count => {
    expect(await readPages([{...financialPage(false), payment_ledger: {...financialPage(false).payment_ledger, count}}])).toBeNull();
  });

  it.each([
    ['empty continuation', {...page(0, true, 2), next_cursor: {ordinal: 1}}],
    ['excess rows', page(2, false, 1)],
    ['premature end', page(1, false, 2)],
    ['false continuation', page(1, true, 1)],
    ['non-boolean continuation', {...page(1, false, 1), has_more: 'true'}],
    ['missing server cursor', {...page(1, true, 2), next_cursor: null}],
    ['scalar server cursor', {...page(1, true, 2), next_cursor: 'invented'}],
  ])('refuses %s rather than manufacturing a complete payment document', async (_label, value) => {
    expect(await readPages([value])).toBeNull();
  });

  it('retains a genuinely empty complete native history', async () => {
    expect(await readPages([page(0, false, 0)])).toMatchObject({ledger_complete: true, payment_ledger: {count: 0, rows: [], complete: true}});
  });
});
