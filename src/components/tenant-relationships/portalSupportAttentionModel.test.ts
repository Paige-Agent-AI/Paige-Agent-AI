import {expect,it} from 'vitest';
import {readPortalSupportAttention} from './portalSupportAttentionModel';
const actor='e0917000-0000-4000-8000-000000000001',tenant='e0927000-0000-4000-8000-000000000001',contact='e0937000-0000-4000-8000-000000000001';
const row={id:'e0947000-0000-4000-8000-000000000001',contact_id:contact,status:'awaiting_owner',subject:'Welcome guide question',last_inbound_at:'2026-10-26T12:00:00Z'};
const payload=()=>({schema_version:1,actor_id:actor,tenant_id:tenant,source_window:50,source_count:1,cases:[{...row}],read_at:'2026-10-26T12:05:00Z'});
const read=(value:unknown)=>readPortalSupportAttention(value,actor,tenant,[contact]);
it('reads only the exact owner/business and known CRM cases',()=>expect(read(payload())?.cases).toEqual([row]));
it('retains an actual empty source window as an empty result',()=>expect(read({...payload(),source_count:0,cases:[]})?.cases).toEqual([]));
it.each(['actor','tenant','unknown client','wider envelope','wider case','duplicate','bad date','window overflow','case overflow','wrong state','missing field'])('refuses %s rather than rendering empty success',mode=>{
 const value=payload();
 if(mode==='actor')value.actor_id=contact;
 if(mode==='tenant')value.tenant_id=contact;
 if(mode==='unknown client')value.cases[0].contact_id=tenant;
 if(mode==='wider envelope')Object.assign(value,{private_notes:'not allowed'});
 if(mode==='wider case')Object.assign(value.cases[0],{body:'not allowed'});
 if(mode==='duplicate'){value.cases.push({...row});value.source_count=2;}
 if(mode==='bad date')value.cases[0].last_inbound_at='yesterday';
 if(mode==='window overflow')value.source_count=51;
 if(mode==='case overflow')value.source_count=0;
 if(mode==='wrong state')value.cases[0].status='resolved';
 if(mode==='missing field')delete (value as Partial<typeof value>).read_at;
 expect(read(value)).toBeNull();
});
