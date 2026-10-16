import {describe,it,expect} from 'vitest';
import {readQuickBooksStatementSummary} from '../../../supabase/functions/_shared/finance/quickbooks-statement-summary.ts';
import {calculateStatementMeasures} from '../../../supabase/functions/_shared/finance/statement-measures.ts';
const expected={basis:'accrual' as const,start:'2026-09-01',end:'2026-09-30'};
const row=(group:string,label:string,value:string)=>({group,type:'Section',Summary:{ColData:[{value:label},{value}]}});
const report={Header:{ReportName:'ProfitAndLoss',ReportBasis:'Accrual',Currency:'EUR',StartPeriod:expected.start,EndPeriod:expected.end,Time:'2026-10-01T10:00:00Z',SummarizeColumnsBy:'Total'},Columns:{Column:[{ColTitle:'',ColType:'Account',MetaData:[{Name:'ColKey',Value:'account'}]},{ColTitle:'Totale',ColType:'Money',MetaData:[{Name:'ColKey',Value:'total'}]}]},Rows:{Row:[row('Income','Revenus source','1000.00'),row('COGS','Coûts directs','200'),row('Expenses','Charges','300'),row('OtherIncome','Autres revenus','0'),row('OtherExpenses','Autres charges','10'),row('GrossProfit','Marge brute','800'),row('NetOperatingIncome','Résultat opérationnel','500'),row('NetIncome','Résultat net','490')]} };
describe('controlled native QuickBooks statement summary',()=>{
 it('retains labels, currency, period and native group evidence for exact statement math',()=>{
  const s=readQuickBooksStatementSummary(report,expected);expect(s.status).toBe('source_statement_summary');if(s.status!=='source_statement_summary')throw Error('No summary');
  expect(s.figures).toMatchObject({income:'1000.00',reportedNetProfit:'490'});expect(s.evidence[0]).toMatchObject({sourceGroup:'Income',sourceLabel:'Revenus source',columnIndex:1});
  expect(calculateStatementMeasures({companyId:'controlled-company',currency:s.report.currency!,basis:s.report.basis!,periodStart:s.report.start!,periodEnd:s.report.end!,sourceRef:'controlled-observation',sourceVersion:'1',classificationVersion:s.classificationVersion,sourceCoverage:'complete',factKind:'historical_statement',figures:s.figures})).toMatchObject({status:'supported_statement'});
 });
 it('keeps missing expense groups unknown without a fabricated zero',()=>{
  const s=readQuickBooksStatementSummary({...report,Rows:{Row:[report.Rows.Row[0],report.Rows.Row[7]]}},expected);
  expect(s).toMatchObject({figures:{income:'1000.00',costOfGoods:null,operatingExpenses:null,reportedNetProfit:'490'}});
 });
 it('does not classify English labels without native group identifiers',()=>{
  const Row=report.Rows.Row.map(r=>({...r,group:'Owner-defined account'}));expect(readQuickBooksStatementSummary({...report,Rows:{Row}},expected).status).toBe('unavailable');
 });
 it('never sums nested detail, even when the display label resembles profit',()=>{
  const s=readQuickBooksStatementSummary({...report,Rows:{Row:[{...report.Rows.Row[0],Rows:{Row:[{group:'NetIncome',ColData:[{value:'Profit'},{value:'999999'}]}]}}]}},expected);
  expect(s).toMatchObject({figures:{income:'1000.00',reportedNetProfit:null}});
 });
 it('refuses duplicate source semantic groups',()=>expect(readQuickBooksStatementSummary({...report,Rows:{Row:[...report.Rows.Row,report.Rows.Row[0]]}},expected).status).toBe('unavailable'));
 it('refuses a detail row masquerading as a statement summary',()=>expect(readQuickBooksStatementSummary({...report,Rows:{Row:[{...report.Rows.Row[0],type:'Data'}]}},expected).status).toBe('unavailable'));
 it.each(['','NaN','1e3','1,000.00'])('does not treat invalid summary amount %s as zero',value=>expect(readQuickBooksStatementSummary({...report,Rows:{Row:[row('NetIncome','Profit',value)]}},expected).status).toBe('unavailable'));
 it('preserves explicit source zero and loss',()=>{for(const value of ['0','-50.50'])expect(readQuickBooksStatementSummary({...report,Rows:{Row:[row('NetIncome','Original label',value)]}},expected)).toMatchObject({figures:{reportedNetProfit:value}});});
 it('refuses ambiguous columns, missing source dates and changed reporting periods',()=>{
  for(const changed of [{...report,Columns:undefined},{...report,Header:{...report.Header,Time:undefined}},{...report,Header:{...report.Header,StartPeriod:'2026-08-01'}}])expect(readQuickBooksStatementSummary(changed,expected).status).toBe('unavailable');
 });
 it.each(['Customer','Vendor','Employee','Item','Class','Department','Account'])('does not treat a report filtered by %s as the whole company statement',key=>{
  const scoped={...report,Header:{...report.Header,[key]:'controlled-filter-reference'}};
  expect(readQuickBooksStatementSummary(scoped,expected)).toMatchObject({status:'unavailable',reason:'statement_source_filter_not_supported',figures:null});
 });
 it('refuses a balance sheet presented as an income statement',()=>expect(readQuickBooksStatementSummary({...report,Header:{...report.Header,ReportName:'BalanceSheet'}},expected).status).toBe('unavailable'));
});
