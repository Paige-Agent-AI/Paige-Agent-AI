import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {Button as BaseButton} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {Input} from '@/components/ui/input';
import {AccountRpcError,previewRetirementResources,readRetirementResources,runRetirementResources,type AccountDetails,type ResourceMode,type ResourcePreview,type ResourceReceipt} from '@/operator/data/accountControls';

function Button({variant='default',className,...props}:ComponentProps<typeof BaseButton>){
 return <BaseButton {...props} variant={variant} className={cn('min-h-11 focus-visible:ring-[var(--pg-gold-core)]',
  variant==='outline'?'border-[var(--pg-line)] bg-[var(--pg-raised)] text-[var(--pg-ink)] hover:bg-[var(--pg-surface)] hover:text-[var(--pg-ink)]':'bg-[var(--pg-gold-core)] text-[var(--pg-raised)] hover:bg-[var(--pg-gold-deep)]',className)}/>;
}

const reasons:Record<string,string>={twilio_management_credentials_unavailable:'The configured Twilio management credential is unavailable.',twilio_account_read_unavailable:'Twilio account management refused or could not verify this account. Verify the configured parent Auth Token or Main API key scope.',twilio_calls_in_flight:'Calls remain in flight. Wait for them to finish, then read the provider outcome.',twilio_call_quiescence_unverified:'Twilio could not verify that calls have finished.',twilio_identity_not_owned_by_platform:'Twilio ownership differs from the selected account. Reconcile the protected binding.',operator_authority_changed:'Your Admin authority or the account scope changed. Refresh access before proceeding.'};
export default function AccountResourcesPanel({details,mode,onPrepared,onCancel,onBusy}:{details:AccountDetails;mode:ResourceMode;onPrepared:()=>void;onCancel:()=>void;onBusy:(busy:boolean)=>void}){
 const [review,setReview]=useState<ResourcePreview|null>(null),[receipt,setReceipt]=useState<ResourceReceipt|null>(null);
 const [confirmation,setConfirmation]=useState(''),[consequences,setConsequences]=useState(false),[retain,setRetain]=useState(false);
 const [busy,setBusy]=useState(true),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
 const operation=useRef<string|null>(null),pending=useRef(false),alive=useRef(true);
 const requiresN8n=Boolean(review?.resources.some(r=>r.provider==='n8n'));
 const requiresTwilio=Boolean(review?.resources.some(r=>r.provider==='twilio'));
 const requiresCache=Boolean(review?.resources.some(r=>r.provider==='tts_cache'));
 const confirmed=confirmation===details.name&&consequences&&(!requiresN8n||retain);
 async function load(){
  if(pending.current)return;pending.current=true;setBusy(true);onBusy(true);setError('');
  try{
   const current=await readRetirementResources(details.id,null);
   const p=await previewRetirementResources(details.id,mode);
   if(!alive.current)return;
   setReview(p);
   if(current&&current.mode===mode&&['resources_preparing','resources_unknown','resources_failed'].includes(current.state)){operation.current=current.operation_id;setReceipt(current);}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Resource review unavailable. Retry.');}
  finally{pending.current=false;if(alive.current){setBusy(false);onBusy(false);}}
 }
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;onBusy(false);};/* keyed to actor/account by Fleet */
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[details.id,mode]);
 async function run(action:'prepare'|'continue'|'read'){
  if(pending.current||(action!=='read'&&!confirmed)||(action==='prepare'&&!review?.execution_available))return;
  const id=operation.current??crypto.randomUUID();operation.current=id;pending.current=true;setBusy(true);onBusy(true);setError('');
  try{const result=await runRetirementResources(details.id,id,action,review??undefined,confirmation,retain);if(alive.current){setReceipt(result);setUnknown(false);}}
  catch(e){if(alive.current){setUnknown(true);setError(e instanceof Error?e.message:'Provider outcome unknown. Read the operation.');
   if(action==='prepare'&&e instanceof AccountRpcError&&e.beforeExecution){operation.current=null;setUnknown(false);setReview(null);}
  }}finally{pending.current=false;if(alive.current){setBusy(false);onBusy(false);}}
 }
 return <section aria-busy={busy} className="space-y-4">
  <h3 className="text-lg font-medium">{mode==='archive'?'Prepare connections for Archive':'Retire resources for deletion'}</h3>
  {requiresTwilio&&<p>{mode==='archive'?'Suspend the listed Twilio subaccounts and pause PAIGE execution. Phone-number charges can continue; suspension does not terminate billing.':'Close the listed Twilio subaccounts permanently, verify closure, and retire their exclusive PAIGE credentials.'}</p>}
  {requiresCache&&<p>Permanently remove only the listed accounts’ generated audio cache. Other accounts and platform audio are preserved. Cached audio cannot be restored here.</p>}
  {busy&&<p role="status">PROCESSING · Verifying connected resources…</p>}
  {error&&<p role="alert" className="break-words text-[var(--pg-negative)]">{unknown?'OUTCOME UNKNOWN · ':''}{error}</p>}
  {review&&<>
   <h4 className="font-medium">Exact account scope</h4><ul className="list-disc pl-5 break-words space-y-1">{review.accounts.map(a=><li key={a.id}>{a.name} · {a.account_type.replace(/_/g,' ')}</li>)}</ul>
   <ul className="list-disc pl-5 space-y-1">{review.resources.map(r=><li key={r.provider+':'+r.tenant_id}>{review.accounts.find(a=>a.id===r.tenant_id)?.name}: {r.provider==='tts_cache'?`Remove ${r.object_count} cached audio ${r.object_count===1?'file':'files'}`:r.provider==='twilio'?(r.action==='close'?'Close Twilio subaccount':'Suspend Twilio subaccount'):'Disconnect PAIGE from n8n'}</li>)}</ul>
   {review.blockers.length>0&&<><p role="status" className="text-[var(--pg-warning)]">BLOCKED · Resolve these requirements.</p><ul className="list-disc pl-5 break-words">{review.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul></>}
  </>}
  {receipt&&<><p role="status">{receipt.state==='resources_ready'?'READY · Resource disposition verified. Refresh the account preflight next.':receipt.state==='resources_preparing'?'PROCESSING · Continue to the next listed resource.':'OUTCOME UNKNOWN · Read the resource outcome before retrying.'}</p><ul className="list-disc pl-5 break-words">{receipt.results.map((r,i)=><li key={i}>{r.provider==='tts_cache'?'Cached audio':r.provider==='twilio'?'Twilio':'n8n'} · {r.state==='verified'?r.provider_status:'Unverified'}{r.reason?' · '+(reasons[r.reason]??'Resource retirement remains unverified. Read again or resolve its configuration.'):''}</li>)}</ul></>}
  {requiresN8n&&<p>Disconnecting removes this account’s PAIGE API credentials. External n8n workflows remain in n8n and may continue running independently. Visible workflow counts do not prove ownership.</p>}
  {receipt?.state!=='resources_ready'&&review&&<div className="space-y-3">
   <label htmlFor="fleet-resource-confirm">Type “{details.name}” to confirm the listed resource scope</label><Input id="fleet-resource-confirm" autoComplete="off" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/>
   <label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--pg-gold-core)]" checked={consequences} disabled={busy} onChange={e=>setConsequences(e.target.checked)}/><span>{mode==='archive'?'I approve the listed connection changes and pausing PAIGE execution.':`I approve permanent retirement of the listed resources${requiresCache?', including deletion of cached audio':''}${requiresTwilio?' and closure of Twilio subaccounts':''}.`}</span></label>
   {requiresN8n&&<label className="flex min-h-11 items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--pg-gold-core)]" checked={retain} disabled={busy} onChange={e=>setRetain(e.target.checked)}/><span>I approve retention of external n8n workflows and disconnection of PAIGE’s credentials.</span></label>}
  </div>}
  <div className="flex flex-wrap gap-3 [&_button]:min-h-11 [&_button]:focus-visible:ring-[var(--pg-gold-core)]">
   <Button variant="outline" disabled={busy} onClick={onCancel}>{operation.current?'Close preparation':'Back'}</Button>
   {receipt?.state==='resources_ready'?<Button onClick={onPrepared}>Refresh account preflight</Button>:<>
    {operation.current&&<Button variant="outline" disabled={busy} onClick={()=>void run('read')}>Read resource outcome</Button>}
    {!review&&<Button variant="outline" disabled={busy} onClick={()=>void load()}>Retry resource review</Button>}
    {review&&<Button disabled={busy||unknown||!confirmed||(!operation.current&&!review.execution_available)} onClick={()=>void run(operation.current?'continue':'prepare')}>{operation.current?(receipt?.state==='resources_unknown'?'Retry preparation':'Continue preparation'):mode==='archive'?'Suspend connections':'Retire listed resources'}</Button>}
   </>}
  </div>
 </section>;
}
