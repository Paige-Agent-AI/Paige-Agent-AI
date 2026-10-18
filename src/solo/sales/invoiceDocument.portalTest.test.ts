import {describe,it,expect} from 'vitest';
import {renderSalesInvoiceDocument} from '../../../supabase/functions/_shared/sales-invoice-document';

// E09 Payments round 3. Only the customer portal's ledger read (client_portal_invoice_ledger) adds a
// `provider_environment` to provider receipts and a top-level `test_provider_cents`. A TEST receipt is
// never told to the customer as money received, and the portal document never names the processor.
// Owner and bearer projections carry neither key and render exactly as before.
const text=(html:string|null)=>(html??'NULL').replace(/<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
const v2={renderer_version:'paige-invoice-html-v2',invoice_number:'INV-0101',published_at:'2026-09-06',issuer_name:'Northwind Studio',client_name:'Jordan Rivera',total_cents:60000,currency:'usd',
  presentation:{template:'modern',accent:'#26483e',issuer_email:'hello@northwind.example',footer:'Thank you'},
  snapshot:{items:[{item:'Strategy session',description:'Two hours',quantity:1,unit_minor:60000}],recipient_email:'jordan@example.test',billing_address:null,due_now_minor:60000,remainder_minor:0,due_date:'2026-09-20',memo:null,payment_method_intents:['card'],kind:'one_time'}};
const at='2026-09-10T00:00:00Z';
const provider=(amount:number,ordinal:number,env?:'test'|'live')=>({kind:'receipt',amount_cents:amount,currency:'usd',received_at:at,posted_at:at,provenance:'provider_verified',provider:'stripe',method:'stripe',provider_verified_at:at,ordinal,...(env?{provider_environment:env}:{})});
const manual=(amount:number,ordinal:number)=>({kind:'receipt',amount_cents:amount,currency:'usd',received_at:at,posted_at:at,provenance:'human_recorded',method:'bank_transfer',ordinal});
const projection=(o:{manual:number;verified:number;test?:number;rows:Record<string,unknown>[];complete?:boolean;count?:number})=>({
  document_input_digest:'0'.repeat(64),status:'issued',current_invoice_number:'INV-0101',
  remaining_cents:60000-o.manual-o.verified,manual_recorded_cents:o.manual,provider_verified_cents:o.verified,allocated_cents:o.manual+o.verified,
  ...(o.test!==undefined?{test_provider_cents:o.test}:{}),document:v2,
  payment_ledger:{complete:o.complete??true,count:o.count??o.rows.length,as_of:'2026-10-01T00:00:00Z',receipt_total_cents:o.manual+o.verified,reversal_total_cents:0,rows:o.rows}});

describe('portal document: a test payment moved no money',()=>{
  it('settled only by test money never reads as paid or provider-confirmed, and never names the processor',()=>{
    const t=text(renderSalesInvoiceDocument(projection({manual:0,verified:60000,test:60000,rows:[provider(60000,1,'test')]})));
    expect(t).not.toBe('NULL');
    expect(t).not.toMatch(/Paid|Provider-confirmed|Payment confirmed|stripe/i);
    expect(t).toContain('Settled by a test payment (no money moved)');
    expect(t).toContain('Test payment No money moved');
    expect(t).toContain('Test payments (no money moved): $600.00 USD');
  });
  it('mixed live and test money: live money is confirmed, the test part moved nothing, and the status never says Paid',()=>{
    const t=text(renderSalesInvoiceDocument(projection({manual:0,verified:60000,test:20000,rows:[provider(40000,1,'live'),provider(20000,2,'test')]})));
    expect(t).not.toMatch(/stripe/i);
    expect(t).not.toMatch(/\bPaid\b/);
    expect(t).toContain('Partially paid (the rest settled by a test payment that moved no money)');
    expect(t).toContain('Provider-confirmed payments: $400.00 USD');
    expect(t).toContain('Test payments (no money moved): $200.00 USD');
    expect(t).toContain('Payment confirmed');
    expect(t).toContain('Test payment No money moved');
  });
  it('manual money plus a test payment: recorded by the business, the test part moved nothing',()=>{
    const t=text(renderSalesInvoiceDocument(projection({manual:40000,verified:20000,test:20000,rows:[manual(40000,1),provider(20000,2,'test')]})));
    expect(t).not.toMatch(/Provider-confirmed payments:|stripe/i);
    expect(t).not.toMatch(/\bPaid\b/);
    expect(t).toContain('Partially paid (the rest settled by a test payment that moved no money)');
    expect(t).toContain('bank transfer');
  });
  it('a test payment that only part-settles the invoice never makes it partially paid',()=>{
    const p=projection({manual:0,verified:20000,test:20000,rows:[provider(20000,1,'test')]});
    const t=text(renderSalesInvoiceDocument(p));
    expect(t).not.toMatch(/Partially paid|Provider-confirmed|stripe/i);
    expect(t).toContain('Issued (a test payment moved no money)');
  });
  it('live provider money on the portal reads confirmed, without the processor name',()=>{
    const t=text(renderSalesInvoiceDocument(projection({manual:0,verified:60000,test:0,rows:[provider(60000,1,'live')]})));
    expect(t).toContain('Paid (provider-confirmed)');
    expect(t).toContain('Provider-confirmed payments: $600.00 USD');
    expect(t).not.toMatch(/stripe/i);
    expect(t).not.toMatch(/Test payment|no money moved/);
  });
  it('refuses a portal projection whose test total contradicts the evidence',()=>{
    expect(renderSalesInvoiceDocument(projection({manual:0,verified:20000,test:30000,rows:[provider(20000,1,'test')]}))).toBeNull();
    expect(renderSalesInvoiceDocument(projection({manual:0,verified:60000,test:0,rows:[provider(60000,1,'test')]}))).toBeNull();
    expect(renderSalesInvoiceDocument(projection({manual:0,verified:60000,rows:[provider(60000,1,'test')]}))).toBeNull();
    expect(renderSalesInvoiceDocument({...projection({manual:0,verified:60000,test:60000,rows:[provider(60000,1,'test')]}),test_provider_cents:-1})).toBeNull();
    // A partial history cannot be reconciled row by row, so the totals themselves must agree.
    expect(renderSalesInvoiceDocument(projection({manual:0,verified:20000,test:30000,rows:[provider(20000,1,'test')],complete:false,count:2}))).toBeNull();
    // On the portal every provider receipt says which environment it came from, and only provider receipts do.
    expect(renderSalesInvoiceDocument(projection({manual:0,verified:60000,test:0,rows:[provider(60000,1)]}))).toBeNull();
    expect(renderSalesInvoiceDocument(projection({manual:60000,verified:0,test:0,rows:[{...manual(60000,1),provider_environment:'live'}]}))).toBeNull();
    expect(renderSalesInvoiceDocument(projection({manual:0,verified:60000,test:0,rows:[provider(60000,1,'sandbox' as 'live')]}))).toBeNull();
  });
  it('business-recorded money plus a test payment that part-pays the invoice credits only the business',()=>{
    // manual $200 + test $100 of $600: the live (non-test) provider money is zero, so the heading says business-recorded.
    const t=text(renderSalesInvoiceDocument(projection({manual:20000,verified:10000,test:10000,rows:[manual(20000,1),provider(10000,2,'test')]})));
    expect(t).toContain('Partially paid (business-recorded)');
    expect(t).not.toMatch(/Provider-confirmed|stripe/i);
  });
  it('the payment notes describe only the money present',()=>{
    const testOnly=text(renderSalesInvoiceDocument(projection({manual:0,verified:60000,test:60000,rows:[provider(60000,1,'test')]})));
    expect(testOnly).not.toMatch(/business|Manually recorded|corrections/i);
    expect(testOnly).toContain('Test payments moved no money.');
    const live=text(renderSalesInvoiceDocument(projection({manual:0,verified:60000,test:0,rows:[provider(60000,1,'live')]})));
    expect(live).not.toMatch(/business|Manually recorded|corrections/i);
    const both=text(renderSalesInvoiceDocument(projection({manual:40000,verified:20000,test:20000,rows:[manual(40000,1),provider(20000,2,'test')]})));
    expect(both).toContain('Business-recorded payments: $400.00 USD');
    expect(both).not.toMatch(/Manually recorded/);
    expect(both).toContain('Business-recorded payments are not verified by a payment provider.');
    expect(both).toContain('Test payments moved no money.');
    expect(both).not.toMatch(/corrections/i);
    const none=text(renderSalesInvoiceDocument(projection({manual:0,verified:0,test:0,rows:[]})));
    expect(none).toContain('No payments recorded.');
    expect(none).not.toMatch(/business|Manually recorded|provider settlement/i);
  });
  it('a voided invoice owes nothing: no outstanding figure and no outstanding equation, on the document and the PDF it becomes',()=>{
    const cases=[
      projection({manual:0,verified:0,test:0,rows:[]}),
      projection({manual:0,verified:20000,test:20000,rows:[provider(20000,1,'test')]}),
      projection({manual:10000,verified:20000,test:0,rows:[manual(10000,1),provider(20000,2,'live')]}),
      projection({manual:10000,verified:0,test:0,rows:[manual(10000,1)],complete:false,count:3}),
    ];
    for(const c of cases){
      const html=renderSalesInvoiceDocument({...c,status:'void'});
      const t=text(html);
      expect(t).not.toBe('NULL');
      expect(t).toContain('Nothing owed: this invoice was voided.');
      expect(t).not.toMatch(/outstanding/i);
      expect(t).toContain('Voided');
      expect(t).not.toMatch(/stripe/i);
    }
    // The ledger read may be absent; the balance still says nothing is owed.
    const {payment_ledger:_drop,...noLedger}={...projection({manual:0,verified:0,test:0,rows:[]}),status:'voided'};
    const n=text(renderSalesInvoiceDocument(noLedger));
    expect(n).toContain('Nothing owed: this invoice was voided.');
    expect(n).not.toMatch(/outstanding|business records/i);
    // The legacy (v1) document says the same.
    const v1={renderer_version:'paige-invoice-html-v1',invoice_number:'INV-0101',issuer_name:'Northwind Studio',client_name:'Jordan Rivera',total_cents:60000,currency:'usd',snapshot:v2.snapshot};
    const l=text(renderSalesInvoiceDocument({...projection({manual:0,verified:0,test:0,rows:[]}),status:'void',document:v1}));
    expect(l).toContain('Nothing owed: this invoice was voided.');
    expect(l).not.toMatch(/outstanding/i);
  });
  it('an owner or bearer void document is unchanged: it still shows its outstanding figure',()=>{
    const t=text(renderSalesInvoiceDocument({...projection({manual:0,verified:0,rows:[]}),status:'void'}));
    expect(t).toContain('Current outstanding');
    expect(t).toContain('= outstanding $600.00 USD');
    expect(t).not.toContain('Nothing owed');
  });
  // Round 5: the balance box only says "No payments recorded." when the ledger shows no receipts at all.
  const reversal=(amount:number,ordinal:number)=>({...manual(amount,ordinal),kind:'reversal'});
  const reversedProjection=(status:string,document:Record<string,unknown>)=>({...projection({manual:0,verified:0,test:0,rows:[manual(20000,1),reversal(20000,2)]}),
    status,document,payment_ledger:{complete:true,count:2,as_of:'2026-10-01T00:00:00Z',receipt_total_cents:20000,reversal_total_cents:20000,rows:[manual(20000,1),reversal(20000,2)]}});
  const v1doc={renderer_version:'paige-invoice-html-v1',invoice_number:'INV-0101',issuer_name:'Northwind Studio',client_name:'Jordan Rivera',total_cents:60000,currency:'usd',snapshot:v2.snapshot};
  it('a recorded payment that was later corrected never reads as "No payments recorded."',()=>{
    for(const status of ['issued','void'])for(const document of [v2,v1doc]){
      const t=text(renderSalesInvoiceDocument(reversedProjection(status,document)));
      expect(t).not.toBe('NULL');
      expect(t).toContain('Payment recorded');
      expect(t).toContain('Payment correction / reversal');
      expect(t).not.toMatch(/no payments/i);
      expect(t).toContain('Recorded payments were corrected; nothing counts toward this invoice.');
    }
  });
  it('without the ledger the balance box says only what is true either way',()=>{
    const {payment_ledger:_drop,...noLedger}=projection({manual:0,verified:0,test:0,rows:[]});
    for(const status of ['issued','void']){
      const t=text(renderSalesInvoiceDocument({...noLedger,status}));
      expect(t).toContain('No payments count toward this invoice.');
      expect(t).not.toMatch(/No payments recorded/);
    }
    // An empty ledger really does show no receipts.
    expect(text(renderSalesInvoiceDocument(projection({manual:0,verified:0,test:0,rows:[]})))).toContain('No payments recorded.');
  });
  it('business-recorded money has one name, and the box says its totals are after corrections',()=>{
    const rows=[manual(20000,1),reversal(5000,2)];
    const p={...projection({manual:15000,verified:0,test:0,rows}),payment_ledger:{complete:true,count:2,as_of:'2026-10-01T00:00:00Z',receipt_total_cents:20000,reversal_total_cents:5000,rows}};
    const html=renderSalesInvoiceDocument(p)!;
    const box=text(html.match(/<section class="balance">[\s\S]*?<\/section>/)![0]);
    expect(box).toContain('Business-recorded payments: $150.00 USD.');
    expect(box).toContain('Totals are after corrections.');
    expect(text(html)).not.toMatch(/Manually recorded/);
  });
  it('owner and bearer projections (no environment key) keep the confirmed label and the method',()=>{
    const t=text(renderSalesInvoiceDocument(projection({manual:0,verified:60000,rows:[provider(60000,1)]})));
    expect(t).toContain('Paid (provider-confirmed)');
    expect(t).toContain('stripe · Provider-confirmed payment');
    expect(t).toContain('Provider-confirmed payments: $600.00 USD');
  });
});
