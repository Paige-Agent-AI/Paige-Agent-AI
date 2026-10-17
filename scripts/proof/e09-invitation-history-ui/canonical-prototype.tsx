// Throwaway native-component flow prototype. No SDK, provider or persistent writes.
import {useRef,useState} from 'react';
import {PaigeConfirmCard} from '../../../src/components/chat/PaigeConfirmCard';
import type {RelationshipPerson} from '../../../src/components/tenant-relationships/useTenantRelationshipsData';
type Phase='idle'|'review'|'working'|'accepted'|'uncertain'|'refused';
const records=new Map<string,{phase:Phase;effects:number;reads:number;cycle:number}>();
let next:'accepted'|'uncertain'|'refused'='accepted';
Object.assign(window,{invitationCommandPrototype:{setOutcome:(v:typeof next)=>{next=v},records:()=>[...records.entries()]}});
export function PortalInvitationManager({tenantId,person,onReadback}:{tenantId:string;person:RelationshipPerson;onReadback:()=>Promise<unknown>}){
 const key=`${tenantId}:${person.id}`,button=useRef<HTMLButtonElement>(null),[version,setVersion]=useState(0);
 void version;
 const current=records.get(key)??{phase:'idle' as const,effects:0,reads:0,cycle:0};records.set(key,current);
 const update=(phase:Phase)=>{records.set(key,{...current,phase});setVersion(v=>v+1)};
 const summary=`Email the existing one-use portal invitation to ${person.email}. Delivery and customer acceptance are separate.`;
 const fingerprint=current.cycle.toString(16).padStart(16,'0');
 const review=()=>{records.set(key,{...current,phase:'review',cycle:current.cycle+1});setVersion(v=>v+1)};
 const approve=(values:string[])=>{
  if(current.phase!=='review'||values.length!==1||values[0]!==fingerprint)return;
  records.set(key,{...current,phase:'working',effects:current.effects+1});setVersion(v=>v+1);
  setTimeout(()=>{const saved=records.get(key)!;records.set(key,{...saved,phase:next});setVersion(v=>v+1)},120);
 };
 const check=()=>{records.set(key,{...current,reads:current.reads+1});setVersion(v=>v+1);void onReadback()};
 return <section className="opd-invitation" aria-label={`Invitation for ${person.name}`}>
  <h3>{person.name}</h3><p>{person.email}</p><p>Prototype · simulated invitations only</p>
  {current.phase==='idle'&&<button ref={button} className="opd-button opd-primary" onClick={review}>Review invitation</button>}
  {current.phase==='review'&&<PaigeConfirmCard key="review" actions={[{summary,fingerprint}]} focusOnMount
   onApprove={approve} onDeny={()=>{update('idle');requestAnimationFrame(()=>button.current?.focus())}}/>}
  {current.phase!=='idle'&&current.phase!=='review'&&<PaigeConfirmCard key={current.phase} mode="report" focusOnMount
   actions={[{summary,state:current.phase==='working'?'working':current.phase==='accepted'?'done':current.phase==='uncertain'?'unconfirmed':'failed',
    note:current.phase==='working'?'Checking the original invitation…':current.phase==='accepted'?'The email provider accepted this invitation. Delivery and customer acceptance are separate.':current.phase==='uncertain'?'The original send could not be confirmed. Check status before any recovery.':'The invitation was not accepted for sending.'}]}
   check={<button className="opd-button" onClick={check}>Check status</button>}/>}
  {current.phase==='uncertain'&&<><p role="status">{current.reads?'Status checked. The original send remains unconfirmed.':'The original result is unconfirmed.'}</p><button className="opd-button" onClick={review}>Review recovery</button></>}
  {current.phase==='accepted'&&<button className="opd-button" onClick={check}>Refresh history</button>}
  {current.phase==='refused'&&<button className="opd-button" onClick={review}>Review invitation again</button>}
 </section>;
}
