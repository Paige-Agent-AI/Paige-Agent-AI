/** Frozen obligation plus separately labelled current balance. No external resources or executable content. */
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
const escape = (v: unknown) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const money = (v: unknown) => Number.isSafeInteger(v) && Number(v)>=0 ? `$${(Number(v)/100).toFixed(2)} USD` : 'Unavailable';
const safeAmount = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
function accountActivity(value: ObjectValue, total: number): string | null {
  if (!safeAmount(value.manual_recorded_cents) || !safeAmount(value.remaining_cents) || value.manual_recorded_cents + value.remaining_cents !== total) return null;
  const status = value.status === 'void' || value.status === 'voided' ? 'Voided' : value.remaining_cents === 0 ? 'Paid (business-recorded)' : value.manual_recorded_cents > 0 ? 'Partially paid (business-recorded)' : 'Issued';
  const ledger = value.payment_ledger;
  if (ledger == null) return '<section class="activity"><h2>' + status + '</h2><p>Itemized payment history unavailable. Current balance reflects business records, not provider verification.</p></section>';
  if (!object(ledger) || !Array.isArray(ledger.rows) || ledger.rows.length > 1000 || !safeAmount(ledger.receipt_total_cents) || !safeAmount(ledger.reversal_total_cents) || !safeAmount(ledger.count) || ledger.reversal_total_cents > ledger.receipt_total_cents || ledger.receipt_total_cents - ledger.reversal_total_cents !== value.manual_recorded_cents || typeof ledger.as_of !== 'string' || !Number.isFinite(Date.parse(ledger.as_of))) return null;
  if (ledger.complete === true && ledger.rows.length !== ledger.count) return null;
  const complete = ledger.complete === true && ledger.rows.length === ledger.count;
  let received = 0, reversed = 0;
  const rows: string[] = [];
  let ordinal=0;
  for (const row of ledger.rows) {
    if (!object(row) || !['payment','reversal'].includes(String(row.kind)) || !safeAmount(row.amount_cents) || row.amount_cents === 0 || row.currency !== 'usd' || typeof row.received_at !== 'string' || !Number.isFinite(Date.parse(row.received_at)) || typeof row.posted_at !== 'string' || !Number.isFinite(Date.parse(row.posted_at)) || !['human_recorded','owner_imported_unverified'].includes(String(row.provenance))) return null;
    if(row.ordinal !== undefined && row.ordinal !== ++ordinal)return null;
    if (row.kind === 'payment') received += row.amount_cents; else reversed += row.amount_cents;
    if (!Number.isSafeInteger(received) || !Number.isSafeInteger(reversed)) return null;
    if(row.running_received_cents !== undefined && (row.running_received_cents !== received-reversed || row.running_remaining_cents !== total-received+reversed))return null;
    rows.push('<tr><td>' + escape(row.received_at.slice(0,10)) + '<br><small>Posted ' + escape(row.posted_at.slice(0,10)) + '</small></td><td>' + (row.kind === 'reversal' ? 'Payment correction / reversal' : 'Payment recorded') + '<br><small>' + escape(String(row.method ?? '').replace(/_/g,' ')) + ' · ' + (row.provenance === 'owner_imported_unverified' ? 'Imported business record' : 'Business record') + '</small></td><td>' + (row.kind === 'payment' ? '− ' : '+ ') + money(row.amount_cents) + '</td><td>' + money(total-received+reversed) + '</td></tr>');
  }
  if (complete && (received !== ledger.receipt_total_cents || reversed !== ledger.reversal_total_cents)) return null;
  return '<section class="activity"><h2>' + status + '</h2><p>Payment activity as of ' + escape(new Date(ledger.as_of).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'})) + '</p>' + (complete ? '<p>Invoice total ' + money(total) + ' − recorded receipts ' + money(ledger.receipt_total_cents) + ' + reversals ' + money(ledger.reversal_total_cents) + ' = outstanding ' + money(value.remaining_cents) + '.</p>' : '<p>Partial history: showing ' + ledger.rows.length + ' of ' + ledger.count + ' records. The displayed rows do not represent the complete payment calculation.</p>') + '<div style="overflow-x:auto"><table aria-label="Dated payment activity"><thead><tr><th>Date</th><th>Activity</th><th>Amount</th><th>Outstanding</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div><p>Business-recorded payments and corrections; provider settlement is not verified.</p></section>';
}
function reference(value: ObjectValue, document: ObjectValue) {
  const current = value.current_invoice_number ?? value.invoice_number ?? document.invoice_number;
  return {current: typeof current === 'string' && current.startsWith('DRAFT-') ? 'Previously issued invoice' : current, original: current !== document.invoice_number || (typeof current === 'string' && current.startsWith('DRAFT-')) ? '<p class="muted">Original reference: ' + escape(document.invoice_number) + '</p>' : ''};
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Invoice ${escape(ref.current)}</title><style>body{font:16px/1.5 system-ui;color:#172033;background:#fff;margin:0}main{max-width:850px;margin:auto;padding:32px}h1{margin:0;font-size:30px}header{overflow-wrap:anywhere;border-bottom:2px solid #6247aa;padding-bottom:20px}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{text-align:left;vertical-align:top;padding:12px 8px;border-bottom:1px solid #ddd}.multiline{white-space:pre-wrap;overflow-wrap:anywhere}.balance{background:#f3effa;padding:20px;border-radius:12px}footer{font-size:12px;overflow-wrap:anywhere;margin-top:28px}@media(max-width:600px){main{padding:18px}td,th{padding:8px 4px;font-size:14px}}@media print{main{padding:0}.balance{border:1px solid #ddd}}</style></head><body><main><header><h1>Invoice ${escape(ref.current)}</h1>${ref.original}<p>${escape(document.issuer_name)} → ${escape(document.client_name)}</p><p>${address}</p></header><table><thead><tr><th>Item / description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><p><strong>Original invoice total: ${money(document.total_cents)}</strong></p><p>Original requested amount: ${money(snapshot.due_now_minor)}<br>Original remaining schedule: ${money(snapshot.remainder_minor)}<br>Original due date: ${escape(snapshot.due_date)}</p>${snapshot.kind==='recurring'?'<p>This invoice records an obligation. Automatic recurring collection is not activated.</p>':''}<section class="balance"><strong>Current outstanding: ${money(value.remaining_cents)}</strong><p>Payments manually recorded by the business: ${money(value.manual_recorded_cents)}. These are human records, not provider verification.</p></section><p>Requested payment methods: ${Array.isArray(snapshot.payment_method_intents)?snapshot.payment_method_intents.map(escape).join(', '):''}</p><div class="multiline">${escape(snapshot.memo)}</div>${activity}</main></body></html>`;
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
  if (!validMoney(d.total_cents) || !validMoney(value.remaining_cents) || !validMoney(value.manual_recorded_cents)
    || Number(value.remaining_cents) + Number(value.manual_recorded_cents) !== d.total_cents || d.currency !== 'usd') return null;
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
  </style></head><body><main class="invoice-${p.template}"><header><div>${p.logo_data_uri ? `<img class="logo" src="${escape(p.logo_data_uri)}" alt="${escape(d.issuer_name)} logo">` : ''}<div class="identity">${escape(d.issuer_name)}</div>${contact ? `<p class="muted">${contact}</p>` : ''}</div><div class="reference"><h1>Invoice</h1><strong>${escape(ref.current)}</strong>${ref.original}<p class="muted">Issued ${date(d.published_at)}<br>Due ${date(s.due_date)}</p></div></header><section class="parties"><div><h2>Bill to</h2><strong>${escape(d.client_name)}</strong><p class="muted">${escape(s.recipient_email)}</p>${address ? `<p>${address}</p>` : ''}</div><div><h2>Payment terms</h2><p>${s.kind === 'deposit' ? 'Deposit and balance' : s.kind === 'recurring' ? 'Recurring obligation' : 'One-time invoice'}</p><p class="muted">${methods}</p></div></section><table><thead><tr><th>Item / description</th><th class="numeric">Qty</th><th class="numeric">Unit price</th><th class="numeric">Amount</th></tr></thead><tbody>${rows.join('')}</tbody></table><section class="summary"><div class="multiline">${escape(s.memo)}</div><dl class="totals"><div><dt>Invoice total</dt><dd>${money(d.total_cents)}</dd></div><div><dt>Original requested amount</dt><dd>${money(s.due_now_minor)}</dd></div>${Number(s.remainder_minor) > 0 ? `<div><dt>Remaining schedule</dt><dd>${money(s.remainder_minor)}</dd></div>` : ''}</dl></section><section class="balance"><div><h2>Current outstanding</h2><p class="muted">Manually recorded payments: ${money(value.manual_recorded_cents)}.<br>Business records; provider settlement is not verified.</p></div><strong>${money(value.remaining_cents)}</strong></section>${activity}${p.payment_instructions ? `<section class="payment"><h2>Payment instructions</h2><div class="multiline">${escape(p.payment_instructions)}</div></section>` : ''}${s.kind === 'recurring' ? '<p class="muted">This document records an obligation; automatic recurring collection is not activated.</p>' : ''}${p.footer ? `<footer class="multiline">${escape(p.footer)}</footer>` : ''}</main></body></html>`;
}
