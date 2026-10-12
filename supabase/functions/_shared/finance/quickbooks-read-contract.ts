// Provider read normalization only. This module grants no caller/company authority and makes no network calls.
// Integration-owned authorization and ingestion must bind these results before Finance consumes them.
type RecordValue = Record<string, unknown>;
export const object = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const text = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 && value.length <= 500 ? value : null;
export function sourceDecimal(value: unknown): string | null {
  // JSON numbers outside the safe six-decimal range have already lost source
  // precision. Larger exact amounts must arrive as decimal strings, never guesses.
  if (typeof value === 'number' && Math.abs(value) > Number.MAX_SAFE_INTEGER / 1_000_000) return null;
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  return typeof raw === 'string' && /^-?\d{1,24}(?:\.\d{1,6})?$/.test(raw) ? raw : null;
}
const currency = (value: unknown): string | null => typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null;
const date = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
const sourceTimestamp = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) && date(value.slice(0, 10)) && Number.isFinite(Date.parse(value)) ? value : null;

export type QuickBooksAccountRead = {
  nativeId: string; sourceLabel: string; sourcePath: string | null; sourceType: string | null; sourceSubtype: string | null;
  currency: string | null; accountingBalance: string | null; availableCash: null; availableCredit: null;
  product: 'deposit' | 'cash_on_hand' | 'credit_card' | 'loan_obligation' | 'unclassified';
  active: boolean | null; sourceUpdatedAt: string | null;
};
export function parseQuickBooksAccount(value: unknown): QuickBooksAccountRead | null {
  const row = object(value);
  if (!row) return null;
  const nativeId = text(row.Id), sourceLabel = text(row.Name);
  if (!nativeId || !sourceLabel) return null;
  const sourceType = text(row.AccountType), sourceSubtype = text(row.AccountSubType);
  let product: QuickBooksAccountRead['product'] = 'unclassified';
  if (sourceType === 'Credit Card') product = 'credit_card';
  else if (sourceType === 'Bank' && sourceSubtype === 'CashOnHand') product = 'cash_on_hand';
  else if (sourceType === 'Bank' && ['Checking', 'Savings', 'MoneyMarket'].includes(sourceSubtype ?? '')) product = 'deposit';
  else if (['Other Current Liability', 'Long Term Liability'].includes(sourceType ?? '') && ['LoanPayable', 'NotesPayable'].includes(sourceSubtype ?? '')) product = 'loan_obligation';
  const updated = object(row.MetaData)?.LastUpdatedTime;
  return {
    nativeId, sourceLabel, sourcePath: text(row.FullyQualifiedName), sourceType, sourceSubtype,
    currency: currency(object(row.CurrencyRef)?.value), accountingBalance: sourceDecimal(row.CurrentBalance), availableCash: null, availableCredit: null,
    product, active: typeof row.Active === 'boolean' ? row.Active : null,
    sourceUpdatedAt: sourceTimestamp(updated),
  };
}

export const QUICKBOOKS_FINANCE_OBJECTS = ['Account', 'Bill', 'Purchase', 'BillPayment', 'Deposit'] as const;
export type QuickBooksFinanceObject = typeof QUICKBOOKS_FINANCE_OBJECTS[number];
export type QuickBooksPageRead = { records: RecordValue[]; pagesComplete: boolean; reason: string | null; pagesRead: number };
/** Stage every page before a canonical write. A page cap, read error or repeated identity is incomplete, never zero. */
export async function readQuickBooksPages(
  entity: QuickBooksFinanceObject,
  fetchPage: (query: string) => Promise<unknown>,
  options: { pageSize?: number; pageCap?: number } = {},
): Promise<QuickBooksPageRead> {
  if (!QUICKBOOKS_FINANCE_OBJECTS.includes(entity)) throw new Error('Unsupported accounting object');
  const pageSize = options.pageSize ?? 1000, pageCap = options.pageCap ?? 20;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 || !Number.isSafeInteger(pageCap) || pageCap < 1 || pageCap > 100) throw new Error('Invalid accounting page bounds');
  const records: RecordValue[] = [], ids = new Set<string>();
  let pagesRead = 0;
  let advertisedCount: number | null = null;
  for (let page = 0; page < pageCap; page++) {
    const start = page * pageSize + 1;
    let payload: unknown;
    try { payload = await fetchPage(`SELECT * FROM ${entity} STARTPOSITION ${start} MAXRESULTS ${pageSize}`); }
    catch { return { records, pagesComplete: false, reason: 'source_read_failed', pagesRead }; }
    pagesRead++;
    const body = object(payload), response = object(body?.QueryResponse);
    if (!body || body.Fault || !response || response.Warnings || (response.startPosition !== undefined && response.startPosition !== start)) return { records, pagesComplete: false, reason: 'invalid_source_page', pagesRead };
    // QBO represents an exhausted query as QueryResponse:{}; a nonempty page must contain the requested object array.
    const values = response[entity] ?? (Object.keys(response).every(key => ['startPosition', 'maxResults', 'totalCount'].includes(key)) ? [] : null);
    if (!Array.isArray(values) || values.length > pageSize) return { records, pagesComplete: false, reason: 'invalid_source_page', pagesRead };
    if ((response.maxResults !== undefined && (!Number.isSafeInteger(response.maxResults) || response.maxResults !== values.length))
      || (response.totalCount !== undefined && (!Number.isSafeInteger(response.totalCount) || Number(response.totalCount) < 0))) return { records, pagesComplete: false, reason: 'source_count_conflict', pagesRead };
    if(response.totalCount!==undefined){
      if(advertisedCount!==null&&advertisedCount!==response.totalCount) return {records,pagesComplete:false,reason:'source_count_conflict',pagesRead};
      advertisedCount=response.totalCount as number;
    }
    const staged: RecordValue[] = [];
    for (const value of values) {
      const record = object(value), id = text(record?.Id);
      if (!record || !id || ids.has(id)) return { records, pagesComplete: false, reason: 'missing_or_repeated_source_identity', pagesRead };
      ids.add(id); staged.push(record);
    }
    records.push(...staged);
    if(advertisedCount!==null&&records.length>advertisedCount) return {records,pagesComplete:false,reason:'source_count_conflict',pagesRead};
    if (values.length < pageSize) {
      if (advertisedCount !== null && advertisedCount !== records.length) return { records, pagesComplete: false, reason: 'source_count_conflict', pagesRead };
      return { records, pagesComplete: true, reason: null, pagesRead };
    }
  }
  return { records, pagesComplete: false, reason: 'source_page_cap', pagesRead };
}

export type QuickBooksReportRead = {
  reportName: string | null; currency: string | null; basis: 'cash' | 'accrual' | null;
  start: string | null; end: string | null; generatedAt: string | null; rows: RecordValue[];
  coverage: 'complete' | 'partial' | 'unavailable'; reasons: string[];
  columns: { sourceTitle: string | null; sourceType: string | null; sourceKey: string | null }[];
  totalColumnIndex: number | null;
};
function reportColumns(value: unknown) {
  if(!Array.isArray(value)||value.length===0||value.length>1000)return null;
  const columns=[];
  for(const raw of value){
    const column=object(raw);if(!column)return null;
    const title=column.ColTitle, type=column.ColType, metadata=column.MetaData;
    if(typeof title!=='string'||title.length>8192||typeof type!=='string'||type.length>100||!Array.isArray(metadata)||metadata.length>20)return null;
    const keys=metadata.filter(v=>object(v)?.Name==='ColKey');
    if(keys.length>1)return null;
    const key=keys.length===1?text(object(keys[0])?.Value):null;
    if(keys.length===1&&(!key||key.length>200))return null;
    columns.push({sourceTitle:title,sourceType:type,sourceKey:key});
  }
  return columns;
}
function reportRowsSupplied(rows: unknown, depth = 0, budget = { remaining: 10000, cells: 50000, characters: 2000000 }): rows is RecordValue[] {
  if (!Array.isArray(rows) || rows.length > 10000 || depth > 16) return false;
  return rows.every(value => {
    if (--budget.remaining < 0) return false;
    const row = object(value);
    if (!row) return false;
    const columns = row.ColData ?? object(row.Summary)?.ColData;
    const children = object(row.Rows)?.Row;
    if (columns === undefined && children === undefined) return false;
    for (const values of [row.ColData, object(row.Header)?.ColData, object(row.Summary)?.ColData]) {
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.length === 0 || values.length > 1000) return false;
      for (const col of values) {
        const value = object(col)?.value;
        if (--budget.cells < 0 || typeof value !== 'string' || value.length > 8192 || (budget.characters -= value.length) < 0) return false;
      }
    }
    return children === undefined || reportRowsSupplied(children, depth + 1, budget);
  });
}
function projectReportRows(rows: RecordValue[]): RecordValue[] {
  const columns = (values: unknown[]) => values.map(value => {
    const row = object(value)!;
    return { value: row.value, ...(text(row.id) !== null ? { id: row.id } : {}) };
  });
  return rows.map(row => {
    const projection: RecordValue = {};
    if (text(row.type) !== null) projection.type = row.type;
    if (text(row.group) !== null) projection.group = row.group;
    if (Array.isArray(row.ColData)) projection.ColData = columns(row.ColData);
    for (const key of ['Header', 'Summary']) {
      const values = object(row[key])?.ColData;
      if (Array.isArray(values)) projection[key] = { ColData: columns(values) };
    }
    const children = object(row.Rows)?.Row;
    if (Array.isArray(children)) projection.Rows = { Row: projectReportRows(children as RecordValue[]) };
    return projection;
  });
}
/** Preserve native rows and labels; no English-name formulas or synthesized totals. */
export function parseQuickBooksReport(value: unknown, expected: { name: 'ProfitAndLoss' | 'BalanceSheet'; basis: 'cash' | 'accrual'; start: string; end: string }): QuickBooksReportRead {
  const body = object(value), header = object(body?.Header), rawRows = object(body?.Rows)?.Row;
  const reportName = text(header?.ReportName), reportCurrency = currency(header?.Currency);
  const basis = header?.ReportBasis === 'Cash' ? 'cash' : header?.ReportBasis === 'Accrual' ? 'accrual' : null;
  const start = date(header?.StartPeriod), end = date(header?.EndPeriod), generated = header?.Time;
  const generatedAt = sourceTimestamp(generated);
  const reasons: string[] = [];
  const columns=reportColumns(object(body?.Columns)?.Column);
  if(!columns)reasons.push('report_columns_unavailable');
  const totals=columns?.map((column,index)=>column.sourceType==='Money'&&column.sourceKey==='total'?index:-1).filter(index=>index>=0)??[];
  // A localized title saying "Total" is never a semantic source key. Period
  // columns are preserved for display, but cannot be silently summed or picked.
  let totalColumnIndex=columns?.length===2&&columns[0].sourceType==='Account'&&columns[0].sourceKey==='account'
    &&totals.length===1&&header?.SummarizeColumnsBy==='Total'?totals[0]:null;
  if (!body || body.Fault || !header || reportName !== expected.name) reasons.push('report_identity_unavailable');
  if (!reportCurrency) reasons.push('currency_unavailable');
  if (!basis || basis !== expected.basis) reasons.push('report_basis_unavailable_or_changed');
  if (!start || !end || start > end || start !== expected.start || end !== expected.end) reasons.push('report_period_unavailable_or_changed');
  if (!generatedAt) reasons.push('report_source_date_unavailable');
  const rowsValid = reportRowsSupplied(rawRows);
  const rows = rowsValid ? projectReportRows(rawRows) : [];
  const aligned=(items:RecordValue[]):boolean=>items.every(row=>{
    const data=row.ColData,summary=object(row.Summary)?.ColData,children=object(row.Rows)?.Row;
    return [data,summary].every(cells=>cells===undefined||Array.isArray(cells)&&cells.length===columns?.length)
      &&(!Array.isArray(children)||aligned(children as RecordValue[]));
  });
  if(columns&&rowsValid&&!aligned(rows)){reasons.push('report_column_alignment_unavailable');totalColumnIndex=null;}
  if (!rowsValid) reasons.push('report_rows_unavailable');
  if (rows.length === 0) reasons.push('report_empty');
  return { reportName, currency: reportCurrency, basis, start, end, generatedAt, rows,columns:columns??[],totalColumnIndex,
    coverage: reasons.includes('report_identity_unavailable') || reasons.includes('report_rows_unavailable') ? 'unavailable' : reasons.length ? 'partial' : 'complete', reasons };
}
