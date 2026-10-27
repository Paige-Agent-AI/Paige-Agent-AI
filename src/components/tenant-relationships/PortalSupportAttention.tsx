import {ArrowRight,MessageCircle} from 'lucide-react';
import type {RelationshipPerson} from './useTenantRelationshipsData';
import {SUPPORT_CASE_LABEL} from './portalSupportAttentionModel';
import {usePortalSupportAttention} from './usePortalSupportAttention';

export function PortalSupportAttention({tenantId,people,openClient}:{tenantId:string;people:RelationshipPerson[];openClient:(id:string)=>void}){
 const read=usePortalSupportAttention(tenantId,people.map(person=>person.id));
 const names=new Map(people.map(person=>[person.id,person.name]));
 return <section className="opd-attention opd-support-attention" aria-label="Support mailbox" aria-busy={read.phase==='loading'||undefined}>
  <header className="opd-section-heading"><h2>Support mailbox</h2><button className="opd-button" type="button" disabled={!people.length||read.phase==='loading'} onClick={()=>void read.refresh()}>Refresh</button></header>
  <p>Cases for loaded clients within the 50-case mailbox window. Portal help requests are in Messages.</p>
  {!people.length?<div className="opd-status" role="status"><strong>Load a client to check their support cases.</strong></div>
   :read.phase==='loading'?<div className="opd-status" role="status"><strong>Checking support cases…</strong></div>
   :read.phase==='unavailable'?<div className="opd-status" role="alert"><strong>Support cases require current business-owner access.</strong><p>Reopen the Portal in your authorized business and try again.</p></div>
   :read.phase==='error'?<div className="opd-status" role="alert"><strong>Support cases couldn’t be checked.</strong><p>Refresh to check the original mailbox records again.</p></div>
   :read.value?.cases.length?<ul>{read.value.cases.map(row=><li key={row.id}><span className="opd-attention-icon" aria-hidden><MessageCircle/></span><div><strong>{names.get(row.contact_id)}</strong><p>{row.subject||'Support conversation'}</p><p>{SUPPORT_CASE_LABEL[row.status]}</p>{row.last_inbound_at&&<p>Last client message <time dateTime={row.last_inbound_at}>{new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.last_inbound_at))}</time></p>}</div><button type="button" className="opd-button" aria-label={`Review client ${names.get(row.contact_id)}`} onClick={()=>openClient(row.contact_id)}>Review client <ArrowRight/></button></li>)}</ul>
   :<div className="opd-status" role="status"><strong>No active cases found in this window.</strong><p>This does not rule out other customer requests or cases outside the loaded window.</p></div>}
 </section>;
}
