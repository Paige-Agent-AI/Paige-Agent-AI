import { anchoredDate, date, integer, object, only, parseCollectionTerms, MAX_SCHEDULE, type CollectionTerms } from './contract.ts';
export type ScheduleRow={sequence:number;due_date:string;amount_cents:number;currency:string;label:string|null};
export type SchedulePreview={rows:ScheduleRow[];amount_basis:'total'|'per_cycle';has_more:boolean};
export function previewCollectionSchedule(terms:CollectionTerms,limit=MAX_SCHEDULE):SchedulePreview{
  integer(limit,1,MAX_SCHEDULE);const rows:ScheduleRow[]=[];
  const desired=terms.count??(terms.dates.length||MAX_SCHEDULE+1);const months={monthly:1,quarterly:3,annual:12,custom:0}[terms.cadence];
  let remaining=false;
  for(let i=0;i<desired;i++){
    const anchorYear=Number(terms.anchor_date.slice(0,4)),anchorMonth=Number(terms.anchor_date.slice(5,7))-1;
    if(terms.cadence!=='custom'&&anchorYear*12+anchorMonth+i*months>9999*12+11)break;
    const explicit=terms.dates[i];const due=explicit?.due_date??anchoredDate(terms.anchor_date,i,months);
    if(terms.end_date&&due>terms.end_date)break;
    if(rows.length===limit){remaining=true;break;}
    const count=terms.count??desired;
    const amount=explicit?.amount_cents??(terms.kind==='recurring'?terms.total_cents:terms.kind==='deposit'?(i===0?terms.deposit_cents!:terms.total_cents-terms.deposit_cents!):Math.floor(terms.total_cents/count)+(i<terms.total_cents%count?1:0));
    rows.push({sequence:i+1,due_date:due,amount_cents:amount,currency:terms.currency,label:explicit?.label??null});
  }
  return {rows,amount_basis:terms.kind==='recurring'?'per_cycle':'total',has_more:remaining};
}
/** Preview only: no persisted debt, charge, legal approval or autonomous accrual. */
export function previewAgreedCharges(terms:CollectionTerms,remainingMinor:number,daysOverdue:number){
  integer(remainingMinor);integer(daysOverdue,0,36500);
  const principal=BigInt(remainingMinor),days=BigInt(daysOverdue);
  const late=daysOverdue>terms.late_fee.grace_days&&remainingMinor>0?BigInt(terms.late_fee.fixed_cents)+principal*BigInt(terms.late_fee.rate_bps)/10000n:0n;
  const interest=principal*BigInt(terms.interest.annual_bps)*days/3650000n;
  if(late+interest>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('COLLECTION_PREVIEW_OVERFLOW');
  return {late_fee_cents:Number(late),interest_cents:Number(interest),total_cents:Number(late+interest),provenance:'agreed_metadata_preview_only' as const};
}

export type FixedRepaymentAssembly =
  | {state:'needs_input';fields:string[]}
  | {state:'refused';code:'INVALID_REPAYMENT_INPUT'|'SCHEDULE_LIMIT'|'CUSTOM_DATES_COUNT_MISMATCH'}
  | {state:'ready';deposit_cents:number;remaining_after_deposit_cents:number;installment_count:number;
      cadence:'monthly'|'quarterly'|'custom';terms:CollectionTerms;rows:ScheduleRow[]};

/** Principal-only preview, not an invoice, mandate, approval, charge or financial write.
 * Reuses the canonical finite Collections schedule. Exact amounts never become rounded percentages.
 * Resource resolution, agreed fees/taxes and executed-term conflicts must be checked by assembly.
 */
export function assembleFixedRepaymentSchedule(input:unknown):FixedRepaymentAssembly {
  if(!object(input))return {state:'refused',code:'INVALID_REPAYMENT_INPUT'};
  try {
    only(input,['total_cents','currency','deposit_cents','deposit_date','installment_cents','first_installment_date','cadence','custom_dates']);
    const missing=['total_cents','currency','deposit_cents','installment_cents','cadence'].filter(k=>input[k]===undefined||input[k]===null);
    if(typeof input.deposit_cents==='number'&&input.deposit_cents>0&&input.deposit_date==null)missing.push('deposit_date');
    if(input.cadence==='custom'&&input.custom_dates==null)missing.push('custom_dates');
    if((input.cadence==='monthly'||input.cadence==='quarterly')&&input.first_installment_date==null)missing.push('first_installment_date');
    if(missing.length)return {state:'needs_input',fields:missing};
    const total=integer(input.total_cents,1),deposit=integer(input.deposit_cents,0,total-1),installment=integer(input.installment_cents,1);
    if(typeof input.currency!=='string'||!/^[a-z]{3}$/.test(input.currency)||!['monthly','quarterly','custom'].includes(String(input.cadence)))throw Error();
    const cadence=input.cadence as 'monthly'|'quarterly'|'custom';
    const remaining=total-deposit;
    const count=Number((BigInt(remaining)+BigInt(installment)-1n)/BigInt(installment));
    if(count+(deposit>0?1:0)>MAX_SCHEDULE)return {state:'refused',code:'SCHEDULE_LIMIT'};
    let explicit:string[]=[];
    let anchor:string;
    if(cadence==='custom'){
      if(!Array.isArray(input.custom_dates))throw Error();
      if(input.custom_dates.length!==count)return {state:'refused',code:'CUSTOM_DATES_COUNT_MISMATCH'};
      explicit=input.custom_dates.map(v=>date(v));anchor=explicit[0];
      if(input.first_installment_date!=null&&date(input.first_installment_date)!==anchor)throw Error();
    }else{
      if(input.custom_dates!==undefined&&input.custom_dates!==null)throw Error();
      anchor=date(input.first_installment_date);
    }
    const dates:CollectionTerms['dates']=[];
    if(deposit>0){const due=date(input.deposit_date);if(due>=anchor)throw Error();dates.push({due_date:due,amount_cents:deposit,label:'Deposit'});}
    else if(input.deposit_date!==undefined&&input.deposit_date!==null)date(input.deposit_date);
    for(let i=0;i<count;i++){
      const due=cadence==='custom'?explicit[i]:anchoredDate(anchor,i,cadence==='monthly'?1:3);
      const amount=Number(BigInt(remaining)-BigInt(installment)*BigInt(i));
      dates.push({due_date:due,amount_cents:Math.min(installment,amount),label:`Installment ${i+1}`});
    }
    const terms=parseCollectionTerms({schema_version:1,kind:'custom',currency:input.currency,total_cents:total,
      anchor_date:dates[0].due_date,cadence:'custom',count:dates.length,end_date:null,dates,deposit_cents:null});
    const preview=previewCollectionSchedule(terms);
    if(preview.has_more||preview.rows.reduce((sum,row)=>sum+row.amount_cents,0)!==total)throw Error();
    return {state:'ready',deposit_cents:deposit,remaining_after_deposit_cents:remaining,installment_count:count,cadence,terms,rows:preview.rows};
  }catch{return {state:'refused',code:'INVALID_REPAYMENT_INPUT'};}
}
