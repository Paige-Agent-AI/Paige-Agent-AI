import {parseQuickBooksReport,sourceDecimal} from './quickbooks-read-contract.ts';
import type {StatementFigures} from './statement-measures.ts';

// Private source normalizer; caller/company, connection, period authorization,
// immutable observation and canonical evidence issuance remain server duties.
// Native group keys carry report semantics; display labels never classify data.
const groups={Income:'income',COGS:'costOfGoods',Expenses:'operatingExpenses',OtherIncome:'otherIncome',OtherExpenses:'otherExpenses',GrossProfit:'reportedGrossProfit',NetOperatingIncome:'reportedOperatingProfit',NetIncome:'reportedNetProfit'} as const;
const object=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
export function readQuickBooksStatementSummary(value:unknown,expected:{basis:'cash'|'accrual';start:string;end:string}){
 const report=parseQuickBooksReport(value,{...expected,name:'ProfitAndLoss'});
 const unavailable=(reason:string)=>({status:'unavailable' as const,reason,report,figures:null,classificationVersion:'quickbooks-native-summary-v1',bankCashCalculated:false,financialEffectsExecuted:false});
 // These dimensions identify a subset report, not the company-wide statement.
 // Filter absence is not authority: the canonical producer must still bind an
 // unfiltered request and company/source evidence before financial interpretation.
 const header=object(object(value)?.Header);
 if(header&&['Customer','Vendor','Employee','Item','Class','Department','Account'].some(key=>Object.prototype.hasOwnProperty.call(header,key)))
  return unavailable('statement_source_filter_not_supported');
 if(report.coverage!=='complete'||report.totalColumnIndex===null)return unavailable('statement_source_incomplete_or_ambiguous');
 const figures:StatementFigures={income:null,costOfGoods:null,operatingExpenses:null,otherIncome:null,otherExpenses:null,reportedGrossProfit:null,reportedOperatingProfit:null,reportedNetProfit:null};
 const evidence:{sourceGroup:string;sourceLabel:string|null;columnIndex:number;value:string|null}[]=[];
 const seen=new Set<string>();
 for(const row of report.rows){
  const group=row.group;
  if(typeof group!=='string'||!Object.prototype.hasOwnProperty.call(groups,group))continue;
  if(row.type!=='Section')return unavailable('statement_summary_type_unavailable');
  if(seen.has(group))return unavailable('conflicting_statement_groups');seen.add(group);
  const cells=object(row.Summary)?.ColData;
  // Section detail is not the section total; never sum child/subtotal rows.
  if(!Array.isArray(cells)||cells.length!==report.columns.length)return unavailable('statement_summary_unavailable');
  const raw=object(cells[report.totalColumnIndex])?.value;
  const amount=sourceDecimal(raw);
  // An explicit empty/invalid summary cell is unknown, never zero.
  if(amount===null)return unavailable('statement_summary_amount_unavailable');
  figures[groups[group as keyof typeof groups]]=amount;
  const label=object(cells[0])?.value;
  evidence.push({sourceGroup:group,sourceLabel:typeof label==='string'?label:null,columnIndex:report.totalColumnIndex,value:amount});
 }
 if(seen.size===0)return unavailable('statement_classification_unavailable');
 return {status:'source_statement_summary' as const,reason:null,report,figures,evidence,classificationVersion:'quickbooks-native-summary-v1',bankCashCalculated:false,financialEffectsExecuted:false};
}
