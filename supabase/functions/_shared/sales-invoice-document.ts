import {readAllocatedBalance,readInvoiceFinancialSummary,type InvoiceFinancialSummary} from './sales-payments/balance-projection.ts';
/** Frozen obligation plus separately labelled current balance. No external resources or executable content. */
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
const escape = (v: unknown) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money = (v: unknown) => Number.isSafeInteger(v) && Number(v)>=0 ? `$${(Number(v)/100).toFixed(2)} USD` : 'Unavailable';
const safeAmount = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
/** One canonical native summary; an explicit unsupported/missing version never falls back. */
function currentFinancial(value:ObjectValue):InvoiceFinancialSummary|null|false {
  if(!Object.prototype.hasOwnProperty.call(value,'financial_evidence_version'))return null;
  if(value.financial_evidence_version!==3||value.payment_evidence_version!==2||!object(value.document))return false;
  const id=value.invoice_id??value.id,currency=value.document.currency,version=value.version;
  if(typeof id!=='string'||!id||typeof currency!=='string'||!Number.isSafeInteger(version)||Number(version)<1
    ||typeof value.status!=='string'||value.currency!==undefined&&value.currency!==currency)return false;
  const summary=readInvoiceFinancialSummary(value.financial_summary,{id,version:Number(version),currency,status:value.status});
  if(!summary||value.remaining_cents!==summary.outstanding_minor||value.manual_recorded_cents!==summary.manual_recorded_minor
    ||value.provider_verified_cents!==summary.provider_confirmed_minor||value.test_provider_verified_cents!==summary.test_provider_minor)return false;
  return summary;
}
function displayBalance(value:ObjectValue,total:number):{manual:number;verified:number;allocated:number;remaining:number|null}|null {
  const current=currentFinancial(value);if(current===false)return null;
  if(!current)return readAllocatedBalance(value,total);
  // Validate retained gross receipt facts, which may exceed original principal
  // after a returned payment is replaced. They never calculate current debt.
  const manual=current.manual_recorded_minor,verified=current.provider_confirmed_minor,allocated=value.allocated_cents;
  if(!safeAmount(allocated)||!Number.isSafeInteger(manual+verified)||allocated!==manual+verified)return null;
  return {manual,verified,allocated,remaining:current.outstanding_minor};
}
function currentBalanceLabel(value:ObjectValue):string {
  if(hidesVoidBalance(value))return PORTAL_VOID_BALANCE;
  const current=currentFinancial(value);
  if(current&&current.standing!=='recorded')return 'Verification pending';
  if(current&&current.outstanding_minor===0)return 'No amount due';
  return money(current?current.outstanding_minor:value.remaining_cents);
}
function currentBalanceLine(value:ObjectValue):string {
  const label=currentBalanceLabel(value);
  if(hidesVoidBalance(value)||label==='No amount due')return label;
  return 'Current outstanding: '+label;
}
/**
 * E09 Payments: only the customer portal's ledger read (client_portal_invoice_ledger) adds
 * `test_provider_cents` and a `provider_environment` on each provider receipt. Owner and bearer
 * projections carry neither and take the unchanged path. On the portal a TEST receipt is told as a
 * test that moved no money, never as money received, and the processor is never named.
 * Returns null for an owner/bearer projection, {test} for a portal one, false when it contradicts itself.
 */
function isPortalProjection(value: ObjectValue): boolean {
  // New owner/bearer history also retains receipt environments. Only the
  // original Portal wrapper adds its customer projection's TEST alias.
  if (value.payment_evidence_version === 2) return value.test_provider_cents !== undefined;
  const ledger = value.payment_ledger;
  const rows = object(ledger) && Array.isArray(ledger.rows) ? ledger.rows : [];
  return value.test_provider_cents !== undefined || rows.some(row => object(row) && row.provider_environment !== undefined);
}
function portalTestEvidence(value: ObjectValue, verified: number): {test: number} | null | false {
  const ledger = value.payment_ledger;
  const rows = object(ledger) && Array.isArray(ledger.rows) ? ledger.rows : [];
  if (!isPortalProjection(value)) return null;
  if (!safeAmount(value.test_provider_cents) || value.test_provider_cents > verified) return false;
  for (const row of rows) if (object(row) && (row.provenance === 'provider_verified' ? !['test','live'].includes(String(row.provider_environment)) : row.provider_environment !== undefined)) return false;
  return {test: value.test_provider_cents};
}
function financialEvidence(value: ObjectValue, verified: number): {test: number; actual: boolean; portal: boolean} | false {
  if (!Object.prototype.hasOwnProperty.call(value, 'payment_evidence_version')) {
    const legacy = portalTestEvidence(value, verified);
    return legacy === false ? false : {test: legacy?.test ?? 0, actual: false, portal: !!legacy};
  }
  if (value.payment_evidence_version !== 2 || !safeAmount(value.test_provider_verified_cents)) return false;
  const portal = isPortalProjection(value);
  if (portal && value.test_provider_cents !== value.test_provider_verified_cents) return false;
  const ledger = value.payment_ledger;
  const rows = object(ledger) && Array.isArray(ledger.rows) ? ledger.rows : [];
  for (const row of rows) {
    if (!object(row)) return false;
    if (row.provenance === 'provider_verified') {
      if (row.evidence_kind !== 'provider_verified' || (row.provider_environment !== 'test' && row.provider_environment !== 'live')) return false;
    } else if (row.evidence_kind !== 'manual_recorded' || row.provider_environment !== null) return false;
  }
  return {test: value.test_provider_verified_cents, actual: true, portal};
}
const isVoid = (value: ObjectValue) => value.status === 'void' || value.status === 'voided';
const hidesVoidBalance = (value: ObjectValue) => isVoid(value) && (isPortalProjection(value) || value.payment_evidence_version === 2);
/** E09 Payments round 4: on the portal a voided invoice owes nothing, so no outstanding figure or equation is shown. */
const PORTAL_VOID_BALANCE = 'Nothing owed: this invoice was voided.';
/** E09 Payments round 4: the portal's payment note names only the kinds of money actually present (none: no note,
 *  since the balance section already says no payments are recorded). */
function portalMoneyNote(live: number, businessReceipts: number, corrections: number, test: number): string {
  const notes: string[] = [];
  if (live > 0) notes.push('Confirmed payments were verified by the payment provider.');
  if (businessReceipts > 0) notes.push(corrections > 0 ? 'Business-recorded payments and corrections are not verified by a payment provider.' : 'Business-recorded payments are not verified by a payment provider.');
  else if (corrections > 0) notes.push('Corrections were recorded by the business.');
  if (test > 0) notes.push('Test payments moved no money.');
  return notes.join(' ');
}
function portalStatus(value: ObjectValue, balance: {manual:number;verified:number;allocated:number;remaining:number|null}, test: number): string {
  const live = balance.verified - test;
  if (value.status === 'void' || value.status === 'voided') return 'Voided';
  if (balance.allocated - test === 0) return balance.allocated === 0 ? 'Issued' : balance.remaining === 0 ? 'Settled by a test payment (no money moved)' : 'Issued (a test payment moved no money)';
  if (balance.remaining === 0) return test > 0 ? 'Partially paid (the rest settled by a test payment that moved no money)' : live>0?(balance.manual>0?'Paid (confirmed and business-recorded)':'Paid (provider-confirmed)'):'Paid (business-recorded)';
  return live>0?'Partially paid':'Partially paid (business-recorded)';
}
function accountActivity(value: ObjectValue, total: number): string | null {
  const current=currentFinancial(value);if(current===false)return null;
  const balance=displayBalance(value,total);if(!balance)return null;
  const evidence=financialEvidence(value,balance.verified);if(evidence===false)return null;
  const portal=evidence.portal,test=evidence.test,live=balance.verified-(evidence.actual?0:test);
  const status = current?'Recorded payment history':portal&&!evidence.actual ? portalStatus(value,balance,test) : value.status === 'void' || value.status === 'voided' ? 'Voided' : balance.remaining === 0 ? (balance.verified>0?(balance.manual>0?'Paid (confirmed and business-recorded)':'Paid (provider-confirmed)'):'Paid (business-recorded)') : balance.allocated>0 ? (balance.verified>0?'Partially paid':'Partially paid (business-recorded)') : 'Issued';
  const testNote = test>0 ? ' Test payments moved no money.' : '';
  const voided = (portal||evidence.actual) && isVoid(value);
  const ledger = value.payment_ledger;
  if (ledger == null) {
    const note = portal||evidence.actual ? portalMoneyNote(live,balance.manual,0,test) : (live>0?'Current balance includes provider-confirmed payments and any separately recorded business receipts.':'Current balance reflects business records, not provider verification.') + testNote;
    return '<section class="activity"><h2>' + status + '</h2><p>Itemized payment history unavailable.' + (note ? ' ' + note : '') + '</p></section>';
  }
  if (!object(ledger) || !Array.isArray(ledger.rows) || ledger.rows.length > 1000 || !safeAmount(ledger.receipt_total_cents) || !safeAmount(ledger.reversal_total_cents) || !safeAmount(ledger.count) || ledger.reversal_total_cents > ledger.receipt_total_cents || typeof ledger.as_of !== 'string' || !Number.isFinite(Date.parse(ledger.as_of))) return null;
  const receipts=evidence.actual?ledger.receivable_receipt_total_cents:ledger.receipt_total_cents;
  const reversals=evidence.actual?ledger.receivable_reversal_total_cents:ledger.reversal_total_cents;
  if (!safeAmount(receipts) || !safeAmount(reversals) || receipts>ledger.receipt_total_cents || reversals>ledger.reversal_total_cents || reversals>receipts || receipts-reversals!==balance.allocated) return null;
  if (ledger.complete === true && ledger.rows.length !== ledger.count) return null;
  const complete = ledger.complete === true && ledger.rows.length === ledger.count;
  let received = 0, reversed = 0, verified = 0, tested = 0;
  const rows: string[] = [];
  let ordinal=0;
  for (const row of ledger.rows) {
    if (!object(row) || !['receipt','reversal'].includes(String(row.kind)) || !safeAmount(row.amount_cents) || row.amount_cents === 0 || row.currency !== 'usd' || typeof row.received_at !== 'string' || !Number.isFinite(Date.parse(row.received_at)) || typeof row.posted_at !== 'string' || !Number.isFinite(Date.parse(row.posted_at)) || !['human_recorded','owner_imported_unverified','provider_verified'].includes(String(row.provenance))) return null;
    if(row.provenance==='provider_verified'&&(row.kind!=='receipt'||!['stripe','paypal'].includes(String(row.provider))||typeof row.provider_verified_at!=='string'||!Number.isFinite(Date.parse(row.provider_verified_at))))return null;
    if(row.ordinal !== undefined && row.ordinal !== ++ordinal)return null;
    if (row.kind === 'receipt') received += row.amount_cents; else reversed += row.amount_cents;
    const testRow=(portal||evidence.actual)&&row.provider_environment==='test';if(testRow)tested+=row.amount_cents;
    if(row.provenance==='provider_verified'&&(!evidence.actual||!testRow))verified+=row.amount_cents;
    if (!Number.isSafeInteger(received) || !Number.isSafeInteger(reversed)) return null;
    if(row.running_received_cents !== undefined && (row.running_received_cents !== received-reversed || row.running_remaining_cents !== total-received+reversed))return null;
    if(evidence.actual&&(row.receivable_running_received_cents!==received-reversed-tested || row.receivable_running_remaining_cents!==total-received+reversed+tested))return null;
    rows.push('<tr><td>' + escape(row.received_at.slice(0,10)) + '<br><small>Posted ' + escape(row.posted_at.slice(0,10)) + '</small></td><td>' + (testRow ? 'Test payment' : row.kind === 'reversal' ? 'Payment correction / reversal' : row.provenance==='provider_verified'?(current?'Original provider-confirmed receipt':'Payment confirmed'):'Payment recorded') + '<br><small>' + ((portal||evidence.actual)&&row.provenance==='provider_verified' ? (testRow?'No money moved':'Provider-confirmed payment') : escape(String(row.method ?? '').replace(/_/g,' ')) + ' · ' + (row.provenance==='provider_verified'?'Provider-confirmed payment':row.provenance === 'owner_imported_unverified' ? 'Imported business record' : 'Business record')) + '</small></td><td>' + (evidence.actual&&testRow?'':row.kind === 'receipt' ? '− ' : '+ ') + money(row.amount_cents) + '</td>' + (voided||current ? '' : '<td>' + money(evidence.actual?row.receivable_running_remaining_cents:total-received+reversed) + '</td>') + '</tr>');
  }
  const portalNote = portal||evidence.actual ? portalMoneyNote(live,Math.max(0,receipts-balance.verified),reversals,test) : '';
  if (complete && (received !== ledger.receipt_total_cents || reversed !== ledger.reversal_total_cents || verified!==balance.verified || tested!==test
    || (evidence.actual&&(received-tested!==receipts||reversed!==reversals)))) return null;
  return '<section class="activity"><h2>' + status + '</h2><p>Payment activity as of ' + escape(new Date(ledger.as_of).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'})) + '</p>' + (complete ? (voided||current ? '' : '<p>Invoice total ' + money(total) + ' − recorded receipts ' + money(receipts) + ' + reversals ' + money(reversals) + ' = outstanding ' + money(value.remaining_cents) + '.</p>') : '<p>Partial history: showing ' + ledger.rows.length + ' of ' + ledger.count + ' records. The displayed rows do not represent the complete payment calculation.</p>') + '<div style="overflow-x:auto"><table aria-label="Dated payment activity"><thead><tr><th>Date</th><th>Activity</th><th>Amount</th>' + (voided||current ? '' : '<th>Outstanding</th>') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' + ((portal||evidence.actual) ? (portalNote ? '<p>' + portalNote + '</p>' : '') : '<p>' + (live>0?'Provider-confirmed payments and business-recorded receipts are shown separately.':'Business-recorded payments and corrections; provider settlement is not verified.') + testNote + '</p>') + '</section>';
}
function paymentEvidenceCopy(value:ObjectValue):string {
 const current=currentFinancial(value);
 if(current){
  const lines=[
   current.standing!=='recorded'?'Current balance awaits verification.':'',
   current.manual_recorded_minor>0?'Business-recorded receipts: '+money(current.manual_recorded_minor)+'. Not provider verification.':'',
   current.provider_confirmed_minor>0?'Original provider-confirmed receipts: '+money(current.provider_confirmed_minor)+'. Before later adjustments.':'',
   current.provider_net_minor!==null&&(current.provider_confirmed_minor>0||current.provider_net_minor!==0)?'Provider net after recorded adjustments: '+(current.provider_net_minor<0?'− '+money(Math.abs(current.provider_net_minor)):money(current.provider_net_minor))+'.':'',
   current.credit_minor!==null&&current.credit_minor>0?'Credit applied: '+money(current.credit_minor)+'.':'',
   current.refund_payable_minor!==null&&current.refund_payable_minor>0?'Refund still due: '+money(current.refund_payable_minor)+'. This is not a completed refund.':'',
   current.test_provider_minor>0?'Test payments (no money moved): '+money(current.test_provider_minor)+'.':'',
  ].filter(Boolean);
  if(lines.length)return lines.join('<br>');
  const ledger=value.payment_ledger;
  return object(ledger)&&Number(ledger.receipt_total_cents)>0?'Recorded payments were corrected; no current receipt allocation.':'No payment receipts recorded.';
 }

 if(value.payment_evidence_version===2){
  const lines=[Number(value.manual_recorded_cents)>0?`Business-recorded payments: ${money(value.manual_recorded_cents)}.`:'',
   Number(value.provider_verified_cents)>0?`Provider-confirmed payments: ${money(value.provider_verified_cents)}.`:'',
   Number(value.test_provider_verified_cents)>0?`Test payments (no money moved): ${money(value.test_provider_verified_cents)}.`:''].filter(Boolean);
  const ledger=value.payment_ledger;
  if(lines.length)return lines.join('<br>')+(!object(ledger)?'<br>Totals are after any corrections.':Number(ledger.receivable_reversal_total_cents)>0?'<br>Totals are after corrections.':'');
  if(!object(ledger))return 'No payments count toward this invoice.';
  return ledger.receipt_total_cents===0?'No payments recorded.':'Recorded payments were corrected; nothing counts toward this invoice.';
 }
 // Portal projections carry test_provider_cents (validated by accountActivity before this renders):
 // provider-confirmed means live money only, test money is its own line, and only money present is named.
 // Round 5: business-recorded money has one name, the box says when its totals are after corrections, and "No payments
 // recorded." is said only when the ledger shows no receipt at all (a corrected payment is not "none").
 if(isPortalProjection(value)){
  const test=Number(value.test_provider_cents),manual=Number(value.manual_recorded_cents),live=Number(value.provider_verified_cents ?? 0)-test;
  const lines=[manual>0?`Business-recorded payments: ${money(manual)}.`:'',live>0?`Provider-confirmed payments: ${money(live)}.`:'',test>0?`Test payments (no money moved): ${money(test)}.`:''].filter(Boolean);
  const ledger=value.payment_ledger;
  // Without the ledger the corrections are unknown, so say what is true either way.
  if(lines.length)return lines.join('<br>')+(!object(ledger)?'<br>Totals are after any corrections.':Number(ledger.reversal_total_cents)>0?'<br>Totals are after corrections.':'');
  if(!object(ledger))return 'No payments count toward this invoice.';
  return ledger.receipt_total_cents===0?'No payments recorded.':'Recorded payments were corrected; nothing counts toward this invoice.';
 }
 return `Manually recorded payments: ${money(value.manual_recorded_cents)}.${Number(value.provider_verified_cents)>0?`<br>Provider-confirmed payments: ${money(value.provider_verified_cents)}.`:'<br>Business records, not provider verification.'}`;
}
function reference(value: ObjectValue, document: ObjectValue) {
  const current = value.current_invoice_number ?? value.invoice_number ?? document.invoice_number;
  return {current: typeof current === 'string' && current.startsWith('DRAFT-') ? 'Previously issued invoice' : current, original: ''};
}
function renderLegacyInvoiceDocument(value: unknown): string | null {
  if (!object(value) || !object(value.document)) return null;
  const document=value.document;
  if (document.renderer_version!=='paige-invoice-html-v1' || !object(document.snapshot) || !Array.isArray(document.snapshot.items)
    || typeof value.document_input_digest!=='string' || !/^[0-9a-f]{64}$/.test(value.document_input_digest)) return null;
  const snapshot=document.snapshot;
  if (document.currency !== 'usd' || !safeAmount(document.total_cents)) return null;
  const activity=accountActivity(value,document.total_cents); if(activity===null)return null;
  const ref=reference(value,document);
  let itemTotal=0;
  for(const item of snapshot.items as unknown[]){
    if(!object(item)||!safeAmount(item.unit_minor)||!Number.isSafeInteger(item.quantity)||Number(item.quantity)<1)return null;
    const amount=Number(item.unit_minor)*Number(item.quantity);if(!safeAmount(amount)||!safeAmount(itemTotal+amount))return null;itemTotal+=amount;
  }
  if(itemTotal!==document.total_cents||!safeAmount(snapshot.due_now_minor)||!safeAmount(snapshot.remainder_minor)||snapshot.due_now_minor+snapshot.remainder_minor!==document.total_cents)return null;
  const rows=(snapshot.items as unknown[]).map(item=>{
    if(!object(item)) return '';
    return `<tr><td><strong>${escape(item.item)}</strong><div class="multiline">${escape(item.description)}</div></td><td>${escape(item.quantity)}</td><td>${money(item.unit_minor)}</td><td>${money(Number(item.unit_minor)*Number(item.quantity))}</td></tr>`;
  }).join('');
  const address=object(snapshot.billing_address)?Object.values(snapshot.billing_address).filter(v=>v!==null&&v!=='').map(escape).join('<br>'):'';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Invoice ${escape(ref.current)}</title><style>body{font:16px/1.5 system-ui;color:#172033;background:#fff;margin:0}main{max-width:850px;margin:auto;padding:32px}h1{margin:0;font-size:30px}header{overflow-wrap:anywhere;border-bottom:2px solid #6247aa;padding-bottom:20px}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{text-align:left;vertical-align:top;padding:12px 8px;border-bottom:1px solid #ddd}.multiline{white-space:pre-wrap;overflow-wrap:anywhere}.balance{background:#f3effa;padding:20px;border-radius:12px}footer{font-size:12px;overflow-wrap:anywhere;margin-top:28px}@media(max-width:600px){main{padding:18px}td,th{padding:8px 4px;font-size:14px}}@media print{main{padding:0}.balance{border:1px solid #ddd}}</style></head><body><main><header><h1>${ref.current === 'Previously issued invoice' ? 'Invoice' : 'Invoice ' + escape(ref.current)}</h1>${ref.current === 'Previously issued invoice' ? '<p>Previously issued invoice</p>' : ''}${ref.original}<p>${escape(document.issuer_name)} → ${escape(document.client_name)}</p><p>${address}</p></header><table><thead><tr><th>Item / description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><p><strong>Original invoice total: ${money(document.total_cents)}</strong></p><p>Original requested amount: ${money(snapshot.due_now_minor)}<br>Original remaining schedule: ${money(snapshot.remainder_minor)}<br>Original due date: ${escape(snapshot.due_date)}</p>${snapshot.kind==='recurring'?'<p>This invoice records an obligation. Automatic recurring collection is not activated.</p>':''}<section class="balance"><strong>${currentBalanceLine(value)}</strong><p>${paymentEvidenceCopy(value)}</p></section><p>Requested payment methods: ${Array.isArray(snapshot.payment_method_intents)?snapshot.payment_method_intents.map(escape).join(', '):''}</p><div class="multiline">${escape(snapshot.memo)}</div>${activity}</main></body></html>`;
}

/** V1 remains readable without changing its issued facts. V2 owns customer presentation. */
export function renderSalesInvoiceDocument(value: unknown): string | null {
  if (!object(value) || !object(value.document)) return null;
  if (value.document.renderer_version === 'paige-invoice-html-v1') return renderLegacyInvoiceDocument(value);
  const d = value.document, p = d.presentation, s = d.snapshot;
  if (d.renderer_version !== 'paige-invoice-html-v2' || !object(p) || !object(s) || !Array.isArray(s.items)
    || typeof value.document_input_digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.document_input_digest)
    || !['classic','modern','service'].includes(String(p.template)) || typeof p.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(p.accent)) return null;
  const validMoney = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
  if (!validMoney(d.total_cents) || !displayBalance(value,Number(d.total_cents)) || d.currency !== 'usd') return null;
  const activity=accountActivity(value,Number(d.total_cents)); if(activity===null)return null;
  const ref=reference(value,d);
  if (p.logo_data_uri != null && (typeof p.logo_data_uri !== 'string' || p.logo_data_uri.length > 175000
    || !/^data:image\/(?:png;base64,iVBORw0KGgo|jpeg;base64,\/9j\/)[A-Za-z0-9+/]*={0,2}$/.test(p.logo_data_uri))) return null;
  let total = 0;
  const rows: string[] = [];
  for (const item of s.items) {
    if (!object(item) || !validMoney(item.unit_minor) || !Number.isSafeInteger(item.quantity) || Number(item.quantity) < 1
      || !Number.isSafeInteger(Number(item.unit_minor) * Number(item.quantity))) return null;
    const amount = Number(item.unit_minor) * Number(item.quantity); total += amount; if (!Number.isSafeInteger(total)) return null;
    rows.push(`<tr><td><strong>${escape(item.item)}</strong>${item.description ? `<div class="description">${escape(item.description)}</div>` : ''}</td><td class="numeric">${escape(item.quantity)}</td><td class="numeric">${money(item.unit_minor)}</td><td class="numeric">${money(amount)}</td></tr>`);
  }
  if (total !== d.total_cents || !validMoney(s.due_now_minor) || !validMoney(s.remainder_minor)
    || Number(s.due_now_minor) + Number(s.remainder_minor) !== d.total_cents) return null;
  const address = object(s.billing_address) ? ['line1','line2','city','region','postal_code','country'].map(k => s.billing_address && (s.billing_address as ObjectValue)[k]).filter(Boolean).map(escape).join('<br>') : '';
  const sellerAddress = typeof p.issuer_address === 'string' ? escape(p.issuer_address) : object(p.issuer_address) ? Object.values(p.issuer_address).filter(v => typeof v === 'string' && v).map(escape).join('<br>') : '';
  const contact = [p.issuer_email, p.issuer_phone, p.issuer_website].filter(v => typeof v === 'string' && v).map(escape).join('<br>') + (sellerAddress ? `<br>${sellerAddress}` : '');
  const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? escape(v.slice(0,10)) : 'Not recorded';
  const methods = Array.isArray(s.payment_method_intents) ? s.payment_method_intents.map(v => escape(String(v).replace(/_/g,' '))).join(' · ') : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Invoice ${escape(ref.current)}</title><style>
  :root{--accent:${p.accent}}*{box-sizing:border-box}body{font:15px/1.55 system-ui,sans-serif;color:#172033;background:#eef0f3;margin:0;font-variant-numeric:tabular-nums}main{max-width:880px;margin:28px auto;background:#fff;padding:48px}header{display:flex;justify-content:space-between;gap:28px;padding-bottom:28px;border-bottom:1px solid #d7dce3}h1{font-size:32px;line-height:1.15;letter-spacing:-.03em;margin:0 0 12px}h2{font-size:14px;margin:0 0 8px}p{margin:8px 0}.identity{font-size:20px;font-weight:700}.logo{max-width:180px;max-height:72px;object-fit:contain;display:block;margin-bottom:14px}.muted{color:#4c586b;font-size:13px}.reference{text-align:right;overflow-wrap:anywhere}.parties{display:grid;grid-template-columns:1fr 1fr;gap:36px;padding:26px 0}table{width:100%;border-collapse:collapse;margin:8px 0 26px;table-layout:fixed}th{font-size:12px;color:#4c586b;font-weight:600}td,th{padding:14px 8px;text-align:left;border-bottom:1px solid #d7dce3;vertical-align:top}th:first-child{width:46%}.numeric{text-align:right}.description,.multiline{white-space:pre-wrap;overflow-wrap:anywhere}.description{font-size:13px;color:#4c586b;margin-top:5px}.summary{display:grid;grid-template-columns:1fr minmax(240px,42%);gap:32px}.totals{margin:0}.totals>div{display:flex;justify-content:space-between;gap:20px;padding:9px 0}.totals dd{margin:0;font-weight:600}.due{border-top:2px solid #172033;font-size:20px;margin-top:8px}.balance{margin-top:30px;padding:20px 0;border-top:1px solid #d7dce3;display:flex;justify-content:space-between;gap:24px}.balance strong{font-size:24px}.payment{padding:24px 0;border-top:1px solid #d7dce3}footer{border-top:1px solid #d7dce3;padding-top:18px;font-size:12px;color:#4c586b;margin-top:20px;overflow-wrap:anywhere}.invoice-modern header{border-top:5px solid var(--accent);padding-top:24px}.invoice-modern h1{font-size:38px}.invoice-service th:first-child{width:55%}.invoice-service .description{font-size:14px;line-height:1.7}.invoice-classic header{border-bottom:2px solid #172033}::selection{background:#ddd5fb;color:#172033}
  @media(max-width:600px){body{background:#fff}main{padding:24px 18px;margin:0}header{gap:16px;flex-wrap:wrap}.reference{text-align:left}.parties{gap:20px}.summary{grid-template-columns:1fr;gap:12px}.balance{flex-direction:column;gap:10px}td,th{padding:10px 4px;font-size:12px}.description{font-size:12px}.logo{max-width:140px}h1,.invoice-modern h1{font-size:28px}}
  @page{margin:14mm} @media print{body{background:#fff}main{max-width:none;margin:0;padding:0}header{break-inside:avoid}thead{display:table-header-group}tr,.summary,.balance,.payment{break-inside:avoid}footer{break-inside:avoid}}
  </style></head><body><main class="invoice-${p.template}"><header><div>${p.logo_data_uri ? `<img class="logo" src="${escape(p.logo_data_uri)}" alt="${escape(d.issuer_name)} logo">` : ''}<div class="identity">${escape(d.issuer_name)}</div>${contact ? `<p class="muted">${contact}</p>` : ''}</div><div class="reference"><h1>Invoice</h1><strong>${escape(ref.current)}</strong>${ref.original}<p class="muted">Issued ${date(d.published_at)}<br>Due ${date(s.due_date)}</p></div></header><section class="parties"><div><h2>Bill to</h2><strong>${escape(d.client_name)}</strong><p class="muted">${escape(s.recipient_email)}</p>${address ? `<p>${address}</p>` : ''}</div><div><h2>Payment terms</h2><p>${s.kind === 'deposit' ? 'Deposit and balance' : s.kind === 'recurring' ? 'Recurring obligation' : 'One-time invoice'}</p><p class="muted">${methods}</p></div></section><table><thead><tr><th>Item / description</th><th class="numeric">Qty</th><th class="numeric">Unit price</th><th class="numeric">Amount</th></tr></thead><tbody>${rows.join('')}</tbody></table><section class="summary"><div class="multiline">${escape(s.memo)}</div><dl class="totals"><div><dt>Invoice total</dt><dd>${money(d.total_cents)}</dd></div><div><dt>Original requested amount</dt><dd>${money(s.due_now_minor)}</dd></div>${Number(s.remainder_minor) > 0 ? `<div><dt>Remaining schedule</dt><dd>${money(s.remainder_minor)}</dd></div>` : ''}</dl></section><section class="balance"><div><h2>${hidesVoidBalance(value)?'Balance':'Current outstanding'}</h2><p class="muted">${paymentEvidenceCopy(value)}</p></div><strong>${currentBalanceLabel(value)}</strong></section>${activity}${p.payment_instructions ? `<section class="payment"><h2>Payment instructions</h2><div class="multiline">${escape(p.payment_instructions)}</div></section>` : ''}${s.kind === 'recurring' ? '<p class="muted">This document records an obligation; automatic recurring collection is not activated.</p>' : ''}${p.footer ? `<footer class="multiline">${escape(p.footer)}</footer>` : ''}</main></body></html>`;
}
