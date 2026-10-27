import {isClientPortalBusinessId as uuid} from '@/lib/client-portal-scope';

export const SUPPORT_CASE_LABEL = {
  open: 'Open', awaiting_owner: 'Waiting for the business', drafted: 'Reply drafted',
  sent: 'Reply sent', awaiting_customer: 'Waiting for the client',
} as const;
export type PortalSupportCase = {id:string;contact_id:string;status:keyof typeof SUPPORT_CASE_LABEL;subject:string|null;last_inbound_at:string|null};
export type PortalSupportAttention = {cases:PortalSupportCase[];source_count:number;read_at:string};
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,expected:string[])=>Object.keys(v).length===expected.length&&expected.every(k=>Object.hasOwn(v,k));
const date=(v:unknown):v is string=>typeof v==='string'&&v.length<=64&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v));

/** Closed original-record projection: never turn a refusal or a widened payload into empty success. */
export function readPortalSupportAttention(value:unknown,actor:string,tenant:string,contacts:readonly string[]):PortalSupportAttention|null{
 if(!object(value)||!keys(value,['schema_version','actor_id','tenant_id','source_window','source_count','cases','read_at'])
  ||value.schema_version!==1||value.actor_id!==actor||value.tenant_id!==tenant||value.source_window!==50
  ||!Number.isInteger(value.source_count)||(value.source_count as number)<0||(value.source_count as number)>50
  ||!Array.isArray(value.cases)||value.cases.length>(value.source_count as number)||!date(value.read_at))return null;
 const allowed=new Set(contacts),seen=new Set<string>();
 for(const row of value.cases){
  if(!object(row)||!keys(row,['id','contact_id','status','subject','last_inbound_at'])||!uuid(row.id)||seen.has(row.id)
   ||!uuid(row.contact_id)||!allowed.has(row.contact_id)||typeof row.status!=='string'||!Object.hasOwn(SUPPORT_CASE_LABEL,row.status)
   ||!(row.subject===null||typeof row.subject==='string'&&row.subject.length<=120)
   ||!(row.last_inbound_at===null||date(row.last_inbound_at)))return null;
  seen.add(row.id);
 }
 return {cases:value.cases as PortalSupportCase[],source_count:value.source_count as number,read_at:value.read_at};
}
