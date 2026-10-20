import {describe,it,expect} from 'vitest';
import {renderSalesInvoiceDocument} from '../../../supabase/functions/_shared/sales-invoice-document';

// E09 Payments round 5. A GENERATED consistency check over the customer portal's invoice document.
// Rounds 2–5 each found one more false sentence by walking cases by hand. This test enumerates the
// ledger shapes a customer can actually reach (no payment; business-recorded; business-recorded then
// partly or fully corrected; live provider; test provider; and their mixes, each part-paying or
// settling) across issued/void, the v1 and v2 documents, and a complete / missing (absent or null) /
// partial ledger, and checks every rendered document against the TRUTH the generator holds, not
// against the projection's own totals:
//   - no sentence says there are no payments while the activity table lists a payment row, and
//     "no payments" / "nothing counts" are only said when nothing counts toward the invoice;
//   - an amount owed is shown if and only if the invoice is not void;
//   - "Paid" / "Partially paid" only from live provider or business-recorded money; "Paid (…)" only
//     when nothing is outstanding and no test money settled it; provider-confirmed claims (including an
//     unqualified "Partially paid") only from live provider money; business-recorded claims only when
//     the business recorded money;
//   - test money is always labelled as moving no money, and never as a confirmed payment;
//   - the payment processor is never named;
//   - the outstanding figure (box, equation and last running balance) equals amount − counted money;
//   - business-recorded money has one name, every named total is non-zero and matches the truth, the
//     box says its totals are after corrections when there were any ("after any" without a ledger),
//     and corrections are never mentioned when there were none.
// It also feeds contradictory portal evidence and expects the document to be refused.

const TOTAL=60000;
const at='2026-09-10T00:00:00Z';
type Row=Record<string,unknown>&{kind:'receipt'|'reversal';amount_cents:number;provenance:string;provider_environment?:'live'|'test'};
const live=(n:number):Row=>({kind:'receipt',amount_cents:n,currency:'usd',received_at:at,posted_at:at,provenance:'provider_verified',provider:'stripe',method:'stripe',provider_verified_at:at,provider_environment:'live'});
const test=(n:number):Row=>({...live(n),provider:'paypal',method:'paypal',provider_environment:'test'});
const business=(n:number,provenance='human_recorded'):Row=>({kind:'receipt',amount_cents:n,currency:'usd',received_at:at,posted_at:at,provenance,method:'bank_transfer'});
const correction=(n:number):Row=>({...business(n),kind:'reversal',method:'other'});

// Each shape: [name, part-paying rows, settling rows | null when the shape cannot settle].
const SHAPES:[string,Row[],Row[]|null][]=[
  ['none',[],null],
  ['manual',[business(20000)],[business(TOTAL)]],
  ['manual (imported)',[business(20000,'owner_imported_unverified')],[business(TOTAL,'owner_imported_unverified')]],
  ['manual partially reversed',[business(20000),correction(5000)],[business(TOTAL),correction(5000),business(5000)]],
  ['manual fully reversed',[business(20000),correction(20000)],null],
  ['manual fully reversed twice',[business(10000),business(5000),correction(10000),correction(5000)],null],
  ['live provider',[live(20000)],[live(TOTAL)]],
  ['test provider',[test(20000)],[test(TOTAL)]],
  ['live + test',[live(20000),test(10000)],[live(40000),test(20000)]],
  ['manual + test',[business(20000),test(10000)],[business(40000),test(20000)]],
  ['manual + live',[business(20000),live(10000)],[business(40000),live(20000)]],
  ['manual fully reversed + test',[business(20000),correction(20000),test(10000)],null],
  ['manual fully reversed + live',[business(20000),correction(20000),live(10000)],null],
  ['manual + live + test',[business(10000),live(20000),test(5000)],[business(10000),live(20000),test(30000)]],
];
const V2={renderer_version:'paige-invoice-html-v2',invoice_number:'INV-0101',published_at:'2026-09-06',issuer_name:'Northwind Studio',client_name:'Jordan Rivera',total_cents:TOTAL,currency:'usd',
  presentation:{template:'modern',accent:'#26483e',issuer_email:'hello@northwind.example',footer:'Thank you'},
  snapshot:{items:[{item:'Strategy session',description:'Two hours',quantity:1,unit_minor:TOTAL}],recipient_email:'jordan@example.test',billing_address:null,due_now_minor:TOTAL,remainder_minor:0,due_date:'2026-09-20',memo:null,payment_method_intents:['card'],kind:'one_time'}};
const V1={renderer_version:'paige-invoice-html-v1',invoice_number:'INV-0101',issuer_name:'Northwind Studio',client_name:'Jordan Rivera',total_cents:TOTAL,currency:'usd',snapshot:V2.snapshot};
type LedgerMode='complete'|'absent'|'null'|'partial';

type Truth={receipts:number;reversals:number;businessReceipts:number;manual:number;live:number;test:number;counted:number;receiptRows:number;void:boolean};
function truthOf(rows:Row[],status:string):Truth{
  let receipts=0,reversals=0,businessReceipts=0,manual=0,liveMoney=0,testMoney=0,receiptRows=0;
  for(const r of rows){
    const s=r.kind==='receipt'?r.amount_cents:-r.amount_cents;
    if(r.kind==='receipt'){receipts+=r.amount_cents;receiptRows++;if(r.provenance!=='provider_verified')businessReceipts+=r.amount_cents;}else reversals+=r.amount_cents;
    if(r.provenance!=='provider_verified')manual+=s;else if(r.provider_environment==='test')testMoney+=s;else liveMoney+=s;
  }
  return {receipts,reversals,businessReceipts,manual,live:liveMoney,test:testMoney,counted:manual+liveMoney+testMoney,receiptRows,void:status!=='issued'};
}
function project(rows:Row[],status:string,document:unknown,mode:LedgerMode,tamper?:(v:Record<string,unknown>)=>void){
  const t=truthOf(rows,status);
  const ordered=rows.map((r,i)=>({...r,ordinal:i+1}));
  const shown=mode==='partial'?ordered.slice(0,ordered.length-1):mode==='complete'?ordered:[];
  const v:Record<string,unknown>={document_input_digest:'0'.repeat(64),status,current_invoice_number:'INV-0101',document,
    remaining_cents:TOTAL-t.counted,manual_recorded_cents:t.manual,provider_verified_cents:t.live+t.test,allocated_cents:t.counted,test_provider_cents:t.test};
  if(mode==='null')v.payment_ledger=null;
  else if(mode!=='absent')v.payment_ledger={complete:mode==='complete',count:ordered.length,as_of:'2026-10-01T00:00:00Z',receipt_total_cents:t.receipts,reversal_total_cents:t.reversals,rows:shown};
  tamper?.(v);
  return {value:v,truth:t,shown};
}
const money=(n:number)=>`$${(n/100).toFixed(2)} USD`;
const plain=(html:string)=>html.replace(/<style[\s\S]*?<\/style>/g,'').replace(/<br\s*\/?>/g,' ').replace(/<[^>]+>/g,' | ').replace(/\s*(\|\s*)+/g,' | ').replace(/\s+/g,' ').trim();
const section=(html:string,cls:string)=>html.match(new RegExp(`<section class="${cls}">[\\s\\S]*?</section>`))?.[0]??'';

type Case={name:string;rows:Row[];status:string;doc:'v1'|'v2';mode:LedgerMode};
const CASES:Case[]=[];
for(const [shape,part,settle] of SHAPES)for(const [scale,rows] of [['part-paying',part],['settling',settle]] as const){
  if(!rows)continue;
  for(const status of ['issued','void','voided'])for(const doc of ['v2','v1'] as const)for(const mode of ['complete','absent','null','partial'] as const){
    if(mode==='partial'&&rows.length===0)continue;
    CASES.push({name:`${shape} (${scale}) · ${status} · ${doc} · ledger ${mode}`,rows,status,doc,mode});
  }
}

function violations(c:Case):string[]{
  const {value,truth:t,shown}=project(c.rows,c.status,c.doc==='v2'?V2:V1,c.mode);
  const html=renderSalesInvoiceDocument(value);
  if(html===null)return ['document refused'];
  const out:string[]=[];
  const fail=(m:string)=>out.push(m);
  const all=plain(html),box=plain(section(html,'balance')),activity=plain(section(html,'activity'));
  const tbody=section(html,'activity').match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1]??'';
  const tableRows=[...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m=>plain(m[1]));
  const paymentRows=tableRows.filter(r=>/\| (Payment recorded|Payment confirmed|Test payment) \|/.test(r));
  const ledgerPresent=c.mode==='complete'||c.mode==='partial';

  // No sentence claims "no payments" while a payment row is listed; "none count" only when nothing counts.
  if(/\bno payments\b/i.test(all)&&paymentRows.length>0)fail(`says "no payments" beside ${paymentRows.length} payment row(s)`);
  if(/No payments recorded/.test(all)&&t.receiptRows>0)fail('"No payments recorded." although payments were recorded');
  if(/\bno payments\b|nothing counts/i.test(all)&&t.counted!==0)fail('says nothing counts although money counts toward the invoice');
  if(ledgerPresent&&shown.length!==tableRows.length)fail(`table lists ${tableRows.length} rows for ${shown.length} ledger rows`);
  if(!ledgerPresent&&tableRows.length>0)fail('table rows without a ledger');

  // Amount owed shown iff not void.
  if(t.void){
    if(/outstanding/i.test(all))fail('void document shows an outstanding amount');
    if(!all.includes('Nothing owed: this invoice was voided.'))fail('void document does not say nothing is owed');
    if(/\bPaid\b|Partially paid/.test(all))fail('void document claims paid');
  }else{
    if(all.includes('Nothing owed'))fail('issued document says nothing owed');
    const shownOwed=c.doc==='v2'?box.match(/\| (\$[\d.]+ USD) \|?$/)?.[1]:box.match(/Current outstanding: (\$[\d.]+ USD)/)?.[1];
    if(shownOwed!==money(TOTAL-t.counted))fail(`outstanding figure ${shownOwed} ≠ amount − counted ${money(TOTAL-t.counted)}`);
    if(c.mode==='complete'){
      const eq=activity.match(/= outstanding (\$[\d.]+ USD)/)?.[1];
      if(eq!==money(TOTAL-t.counted))fail(`equation outstanding ${eq} ≠ ${money(TOTAL-t.counted)}`);
      const last=tableRows.at(-1)?.match(/(\$[\d.]+ USD) \|?$/)?.[1];
      if(tableRows.length&&last!==money(TOTAL-t.counted))fail(`running balance ${last} ≠ ${money(TOTAL-t.counted)}`);
    }
  }

  // Paid claims only from live provider or business-recorded money.
  if(/paid/i.test(all)&&t.manual+t.live<=0)fail('claims paid with no live or business-recorded money');
  if(/\bPaid \(/.test(all)&&(TOTAL-t.counted!==0||t.test>0))fail('"Paid (…)" while something is outstanding or settled by test money');
  if(/\((?:confirmed and )?business-recorded\)/.test(all)&&t.manual<=0)fail('business-recorded status without business money');
  // An unqualified "Partially paid" is the provider-confirmed reading; without live money it must say whose records.
  const status=section(html,'activity').match(/<h2>([^<]*)<\/h2>/)?.[1];
  if(status==='Partially paid'&&t.live<=0)fail('unqualified "Partially paid" without live provider money');
  if(/Provider-confirmed|Payment confirmed|Confirmed payments|\(confirmed|provider-confirmed\)|Paid \(provider/.test(all)&&t.live<=0)fail('provider-confirmed claim without live provider money');
  if(/business-recorded|business record/i.test(all)&&t.businessReceipts===0)fail('business-recorded claim without business money');
  if(ledgerPresent&&/corrections?\b/i.test(all)&&t.reversals===0)fail('mentions corrections that never happened');
  if(!ledgerPresent&&/corrections?\b/i.test(all.replace('Totals are after any corrections.','')))fail('claims corrections it cannot know about');

  // Test money is always labelled as moving no money.
  const testRowsShown=shown.filter(r=>r.provider_environment==='test').length;
  const testRowLabels=tableRows.filter(r=>r.includes('| Test payment | No money moved |')).length;
  if(testRowLabels!==testRowsShown)fail(`${testRowsShown} test rows, ${testRowLabels} labelled as moving no money`);
  const liveRowsShown=shown.filter(r=>r.provider_environment==='live').length;
  if(tableRows.filter(r=>r.includes('| Payment confirmed |')).length!==liveRowsShown)fail('a confirmed row that is not live provider money');
  if(t.test>0){
    if(!box.includes(`Test payments (no money moved): ${money(t.test)}.`))fail('box does not label test money as moving no money');
    if(!/Test payments moved no money\.|test payment moved no money|no money moved/.test(activity))fail('activity does not say test money moved nothing');
  }else if(/test payment/i.test(all))fail('mentions a test payment that does not exist');

  // The processor is never named.
  if(/stripe|paypal/i.test(all))fail('names the payment processor');

  // One name for business-recorded money; named totals true, non-zero, after corrections.
  if(/Manually recorded/i.test(all))fail('a second name for business-recorded money');
  const totals=[['Business-recorded payments',t.manual],['Provider-confirmed payments',t.live],['Test payments (no money moved)',t.test]] as const;
  let named=0;
  for(const [label,amount] of totals){
    const m=box.match(new RegExp(`${label.replace(/[()]/g,'\\$&')}: (\\$[\\d.]+ USD)`));
    if(m){named++;if(m[1]!==money(amount)||amount<=0)fail(`${label} shows ${m[1]}, truth ${money(amount)}`);}
    else if(amount>0)fail(`${label} ${money(amount)} not shown`);
  }
  const after=!ledgerPresent?'Totals are after any corrections.':t.reversals>0?'Totals are after corrections.':null;
  if(named>0&&after&&!box.includes(after))fail(`box totals do not say "${after}"`);
  if(named===0){
    const expected=!ledgerPresent?'No payments count toward this invoice.':t.receipts===0?'No payments recorded.':'Recorded payments were corrected; nothing counts toward this invoice.';
    if(!box.includes(expected))fail(`empty box should say "${expected}", says "${box}"`);
  }
  return out;
}

describe('portal invoice document: generated consistency',()=>{
  it(`enumerates ${CASES.length} reachable documents`,()=>{
    // Guards the generator itself: every axis is present.
    expect(CASES.length).toBeGreaterThan(400);
    for(const axis of ['· issued','· void','· voided','· v1','· v2','ledger complete','ledger absent','ledger null','ledger partial','fully reversed','test provider','live provider'])
      expect(CASES.some(c=>c.name.includes(axis))).toBe(true);
  });
  it('every rendered document tells the truth about the money',()=>{
    const failures=CASES.flatMap(c=>violations(c).map(v=>`${c.name}: ${v}`));
    expect(failures).toEqual([]);
  });
  it('contradictory portal evidence is refused, never rendered',()=>{
    const tampers:[string,(v:Record<string,unknown>)=>void][]=[
      ['test total above the provider total',v=>{v.test_provider_cents=Number(v.provider_verified_cents)+1;}],
      ['test total that disagrees with the rows',v=>{v.test_provider_cents=Number(v.test_provider_cents)===0?1:0;}],
      ['provider row without an environment',v=>{const l=v.payment_ledger as {rows:Row[]};l.rows=l.rows.map(r=>r.provenance==='provider_verified'?{...r,provider_environment:undefined}:r);}],
      ['business row with an environment',v=>{const l=v.payment_ledger as {rows:Row[]};l.rows=l.rows.map(r=>r.provenance!=='provider_verified'?{...r,provider_environment:'live'}:r);}],
    ];
    let checked=0;
    for(const [,part,settle] of SHAPES)for(const rows of [part,settle])for(const mode of ['complete','partial','absent'] as const){
      if(!rows||(mode==='partial'&&rows.length===0))continue;
      for(const [name,tamper] of tampers){
        const hasProvider=rows.some(r=>r.provenance==='provider_verified'),hasBusiness=rows.some(r=>r.provenance!=='provider_verified');
        // Without a ledger there are no rows to disagree with; only the totals can contradict themselves.
        if(mode==='absent'&&name!=='test total above the provider total')continue;
        if(name==='provider row without an environment'&&!hasProvider)continue;
        if(name==='business row with an environment'&&!hasBusiness)continue;
        // A partial history is reconciled by its totals, not row by row, so a row/total mismatch is only checkable when complete.
        if(mode==='partial'&&name==='test total that disagrees with the rows')continue;
        if(mode==='partial'&&name==='provider row without an environment'&&!rows.slice(0,-1).some(r=>r.provenance==='provider_verified'))continue;
        if(mode==='partial'&&name==='business row with an environment'&&!rows.slice(0,-1).some(r=>r.provenance!=='provider_verified'))continue;
        const {value}=project(rows,'issued',V2,mode,tamper);
        expect(renderSalesInvoiceDocument(value),`${name} (${mode})`).toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(80);
  });
});
