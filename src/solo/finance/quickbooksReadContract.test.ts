import { describe, expect, it, vi } from 'vitest';
import { parseQuickBooksAccount, parseQuickBooksReport, readQuickBooksPages, sourceDecimal } from '../../../supabase/functions/_shared/finance/quickbooks-read-contract';

describe('controlled QuickBooks read contracts — no provider traffic', () => {
  it('preserves original labels and separate native accounts; accounting balance is not available cash or credit', () => {
    const account = { Id: 'test-account-1', Name: 'Operating / réserve', FullyQualifiedName: 'Assets:Operating / réserve', AccountType: 'Bank', AccountSubType: 'Checking', CurrentBalance: 0, CurrencyRef: { value: 'EUR' } };
    expect(parseQuickBooksAccount(account)).toMatchObject({ nativeId: 'test-account-1', sourceLabel: account.Name, sourcePath: account.FullyQualifiedName, currency: 'EUR', accountingBalance: '0', product: 'deposit', availableCash: null, availableCredit: null });
    expect(parseQuickBooksAccount({ ...account, Id: 'test-account-2' })?.nativeId).toBe('test-account-2');
  });
  it('keeps a credit card distinct from LOC, AP and unknown-name liabilities', () => {
    expect(parseQuickBooksAccount({ Id: 'test-card', Name: 'LOC', AccountType: 'Credit Card' })?.product).toBe('credit_card');
    expect(parseQuickBooksAccount({ Id: 'test-ap', Name: 'Loan', AccountType: 'Accounts Payable' })?.product).toBe('unclassified');
    expect(parseQuickBooksAccount({ Id: 'test-loc', Name: 'LOC', AccountType: 'Other Current Liability' })?.product).toBe('unclassified');
  });
  it('preserves unknown currency and missing balances without zero defaults', () => {
    expect(parseQuickBooksAccount({ Id: 'test-account', Name: 'Loan', AccountType: 'Long Term Liability', AccountSubType: 'NotesPayable' })).toMatchObject({ currency: null, accountingBalance: null, product: 'loan_obligation', availableCredit: null });
  });
  it.each([undefined, null, '', '£1,234.56', 'NaN', NaN, Infinity, '1e3', '1.23456789', Number.MAX_SAFE_INTEGER, Number('9007199254740993')])('rejects unsupported decimals %j', value => expect(sourceDecimal(value)).toBeNull());
  it('retains explicit negative and zero decimal source facts', () => {
    expect(sourceDecimal('-1234.50')).toBe('-1234.50');
    expect(sourceDecimal('0.00')).toBe('0.00');
    expect(sourceDecimal('9007199254740993.123456')).toBe('9007199254740993.123456');
  });
  it('reads every page including the terminal page, without merging equal labels', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ QueryResponse: { startPosition: 1, Account: [{ Id: 'test-1', Name: 'Same name' }, { Id: 'test-2', Name: 'Same name' }] } }).mockResolvedValueOnce({ QueryResponse: {} });
    expect(await readQuickBooksPages('Account', fetchPage, { pageSize: 2 })).toMatchObject({ pagesComplete: true, pagesRead: 2, records: [{ Id: 'test-1' }, { Id: 'test-2' }] });
    expect(fetchPage.mock.calls[1][0]).toContain('STARTPOSITION 3');
  });
  it.each([undefined, 1])('rejects an earlier advertised count when a terminal page supplies %s', async terminalCount => {
    const fetchPage=vi.fn().mockResolvedValueOnce({QueryResponse:{Account:[{Id:'first'}],totalCount:3}})
      .mockResolvedValueOnce({QueryResponse:terminalCount===undefined?{}:{totalCount:terminalCount}});
    expect(await readQuickBooksPages('Account',fetchPage,{pageSize:1})).toMatchObject({pagesComplete:false,reason:'source_count_conflict'});
  });
  it('marks a source page failure partial and retains already observed records', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ QueryResponse: { Account: [{ Id: 'test-1' }] } }).mockRejectedValueOnce(new Error('test provider failure with token'));
    expect(await readQuickBooksPages('Account', fetchPage, { pageSize: 1 })).toMatchObject({ pagesComplete: false, reason: 'source_read_failed', records: [{ Id: 'test-1' }] });
  });
  it.each([
    { QueryResponse: { Account: [{ Id: 'test-1' }] } },
    { QueryResponse: { startPosition: 1, Account: [{ Id: 'test-2' }] } },
    { Fault: { Error: ['test error'] } },
  ])('refuses repeated, shifted or failed pages', async second => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ QueryResponse: { Account: [{ Id: 'test-1' }] } }).mockResolvedValueOnce(second);
    expect((await readQuickBooksPages('Account', fetchPage, { pageSize: 1 })).pagesComplete).toBe(false);
  });
  it('does not call a capped traversal complete', async () => {
    expect(await readQuickBooksPages('Bill', async () => ({ QueryResponse: { Bill: [{ Id: 'test-bill' }] } }), { pageSize: 1, pageCap: 1 })).toMatchObject({ pagesComplete: false, reason: 'source_page_cap' });
  });
  it('does not interpret a missing object with a positive source count as an empty success', async () => {
    expect(await readQuickBooksPages('Bill', async () => ({ QueryResponse: { maxResults: 3 } }))).toMatchObject({ pagesComplete: false, reason: 'source_count_conflict' });
  });
});

const expected = { name: 'ProfitAndLoss', basis: 'accrual', start: '2026-09-01', end: '2026-09-30' } as const;
const report = { Header: { ReportName: 'ProfitAndLoss', ReportBasis: 'Accrual', Currency: 'USD', StartPeriod: expected.start, EndPeriod: expected.end, Time: '2026-10-01T10:00:00Z',SummarizeColumnsBy:'Total' },Columns:{Column:[{ColTitle:'',ColType:'Account',MetaData:[{Name:'ColKey',Value:'account'}]},{ColTitle:'Somme originale',ColType:'Money',MetaData:[{Name:'ColKey',Value:'total'}]}]}, Rows: { Row: [{ group: 'Income', Summary: { ColData: [{ value: 'Original source label' }, { value: '0.00' }] } }] } };
describe('controlled accounting report metadata', () => {
  it('selects a total only from native metadata, preserving original localized titles',()=>{
    expect(parseQuickBooksReport(report,expected)).toMatchObject({totalColumnIndex:1,columns:[{sourceKey:'account'},{sourceTitle:'Somme originale',sourceKey:'total'}]});
  });
  it('retains report rows but withholds completeness and calculation column when metadata is absent',()=>{
    expect(parseQuickBooksReport({...report,Columns:undefined},expected)).toMatchObject({coverage:'partial',totalColumnIndex:null,columns:[],reasons:['report_columns_unavailable']});
  });
  it('does not interpret a display title as total or silently select a period column',()=>{
    const Columns={Column:[report.Columns.Column[0],{ColTitle:'Total',ColType:'Money',MetaData:[{Name:'ColKey',Value:'September'}]}]};
    expect(parseQuickBooksReport({...report,Columns},expected).totalColumnIndex).toBeNull();
    expect(parseQuickBooksReport({...report,Header:{...report.Header,SummarizeColumnsBy:'Month'}},expected).totalColumnIndex).toBeNull();
  });
  it('refuses duplicate semantic keys within a column and unbounded column metadata',()=>{
    for(const Column of [[{...report.Columns.Column[1],MetaData:[{Name:'ColKey',Value:'total'},{Name:'ColKey',Value:'total'}]}],Array.from({length:1001},()=>report.Columns.Column[1])]){
      expect(parseQuickBooksReport({...report,Columns:{Column}},expected)).toMatchObject({coverage:'partial',totalColumnIndex:null,columns:[]});
    }
  });
  it('projects closed column fields without raw credential metadata',()=>{
    const Column=report.Columns.Column.map(c=>({...c,access_token:'SECRET',MetaData:[...c.MetaData,{Name:'access_token',Value:'SECRET'}]}));
    expect(JSON.stringify(parseQuickBooksReport({...report,Columns:{Column}},expected))).not.toContain('SECRET');
  });
  it('does not choose a total from misaligned nested summary cells',()=>{
    const Rows={Row:[{Rows:{Row:[{group:'Income',Summary:{ColData:[{value:'1.00'}]}}]}}]};
    expect(parseQuickBooksReport({...report,Rows},expected)).toMatchObject({coverage:'partial',totalColumnIndex:null,reasons:['report_column_alignment_unavailable']});
  });
  it('retains native labels and explicit zero rows without deriving figures from words', () => {
    expect(parseQuickBooksReport(report, expected)).toMatchObject({ coverage: 'complete', currency: 'USD', basis: 'accrual', rows: report.Rows.Row });
  });
  it('makes missing reports unavailable', () => expect(parseQuickBooksReport(null, expected).coverage).toBe('unavailable'));
  it.each(['Currency', 'ReportBasis', 'StartPeriod', 'Time'])('marks missing %s partial', key => {
    const Header: Record<string, unknown> = { ...report.Header }; delete Header[key];
    expect(parseQuickBooksReport({ ...report, Header }, expected).coverage).toBe('partial');
  });
  it('refuses mismatched report identity and malformed rows', () => {
    expect(parseQuickBooksReport({ ...report, Header: { ...report.Header, ReportName: 'BalanceSheet' } }, expected).coverage).toBe('unavailable');
    expect(parseQuickBooksReport({ ...report, Rows: { Row: [null] } }, expected).coverage).toBe('unavailable');
    expect(parseQuickBooksReport({ ...report, Rows: { Row: [{}] } }, expected).coverage).toBe('unavailable');
    expect(parseQuickBooksReport({ ...report, Rows: { Row: [{ Rows: { Row: [null] } }] } }, expected).coverage).toBe('unavailable');
  });
  it('preserves empty accounting coverage without synthesizing zero profit', () => expect(parseQuickBooksReport({ ...report, Rows: { Row: [] } }, expected)).toMatchObject({ coverage: 'partial', rows: [], reasons: ['report_empty'] }));
  it('projects only native row structure, labels, IDs and values', () => {
    const r = parseQuickBooksReport({ ...report, Rows: { Row: [{ type: 'Section', group: 'Income', access_token: 'SECRET', Header: { ColData: [{ value: 'Original heading', id: 'native-id', credential: 'SECRET' }] }, Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Original nested label', raw_address: 'SECRET' }, { value: '1.00' }], token: 'SECRET' }] }, Summary: { ColData: [{ value: 'Original total label' }, { value: '1.00' }], secret: 'SECRET' } }] } }, expected);
    expect(r.coverage).toBe('complete'); expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(r.rows[0]).toMatchObject({ Header: { ColData: [{ value: 'Original heading', id: 'native-id' }] }, Rows: { Row: [{ ColData: [{ value: 'Original nested label' }, { value: '1.00' }] }] } });
  });
  it('refuses malformed native report headers', () => expect(parseQuickBooksReport({ ...report, Rows: { Row: [{ ...report.Rows.Row[0], Header: { ColData: [null] } }] } }, expected).coverage).toBe('unavailable'));
  it('validates summary cells even when separate data cells exist', () => expect(parseQuickBooksReport({ ...report, Rows: { Row: [{ ColData: [{ value: 'Valid data' }], Summary: { ColData: [null] } }] } }, expected).coverage).toBe('unavailable'));
  it('bounds report cells across all rows rather than only each row', () => {
    const Row = Array.from({ length: 51 }, () => ({ ColData: Array.from({ length: 1000 }, () => ({ value: '1' })) }));
    expect(parseQuickBooksReport({ ...report, Rows: { Row } }, expected).coverage).toBe('unavailable');
  });
  it('does not normalize midnight overflow or excessive timestamp precision', () => {
    for (const Time of ['2026-09-30T24:00:00Z', '2026-09-30T10:00:00.1234567Z']) expect(parseQuickBooksReport({ ...report, Header: { ...report.Header, Time } }, expected).generatedAt).toBeNull();
  });
  it.each(['2026-09-30', '2026-09-30T10:00:00', '2026-02-30T10:00:00Z'])('does not invent a source timezone or normalize an invalid source date: %s', Time => {
    expect(parseQuickBooksReport({ ...report, Header: { ...report.Header, Time } }, expected)).toMatchObject({ coverage: 'partial', generatedAt: null });
  });
});
