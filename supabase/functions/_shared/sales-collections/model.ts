import { anchoredDate, integer, MAX_SCHEDULE, type CollectionTerms } from './contract.ts';
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
