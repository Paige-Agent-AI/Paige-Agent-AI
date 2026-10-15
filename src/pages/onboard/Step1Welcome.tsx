import { useEffect, useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { IntakeField } from "@/lib/playbook/types";
import type { WelcomeAnswer } from "@/lib/client-portal-welcome";
import { readableTextOn } from "@/lib/brand/contrast";
import { useClientAccountExit } from "@/components/client/useClientAccountExit";
import { useClientWelcome } from "./useClientWelcome";
import type { OnboardClient } from "./useOnboardingClient";
import type { OnboardBrand } from "./OnboardLayout";

type Ctx = {client:OnboardClient;brand:OnboardBrand|null;refresh:()=>void;acceptSavedProfile:(profile:OnboardClient)=>boolean};
const controlClass="min-h-[44px] text-[16px] md:text-[16px]";
function IntakeQuestion({field,value,onChange,disabled}:{field:IntakeField;value:WelcomeAnswer|undefined;onChange:(v:WelcomeAnswer)=>void;disabled:boolean}) {
  const id=`welcome-answer-${field.key}`;
  return <div className="space-y-2"><Label htmlFor={id}>{field.label}{!field.required&&<span className="text-xs ml-1">(optional)</span>}</Label>
    {field.type==="longtext"?<Textarea id={id} className={controlClass} value={value??""} disabled={disabled} required={field.required}
      onChange={e=>onChange(e.target.value)} rows={3} maxLength={10000}/>
      :field.type==="select"?<select id={id} className={`w-full rounded-md border px-3 bg-white ${controlClass}`} value={value??""}
        disabled={disabled} required={field.required} onChange={e=>onChange(e.target.value)}>
        <option value="">Select…</option>{field.options?.map(option=><option key={option} value={option}>{option}</option>)}
      </select>:<Input id={id} className={controlClass} type={field.type==="number"?"number":field.type==="date"?"date":field.type==="phone"?"tel":"text"}
        step={field.type==="number"?"any":undefined}
        value={value??""} disabled={disabled} required={field.required} maxLength={field.type==="address"?1000:2000}
        onChange={e=>onChange(field.type==="number"?(e.target.value===""?null:Number(e.target.value)):e.target.value)}/>}
  </div>;
}

export default function Step1Welcome() {
  const {client,brand,refresh,acceptSavedProfile}=useOutletContext<Ctx>();
  const model=useClientWelcome(client),navigate=useNavigate(),navigation=useRef(false);
  const [continuationError,setContinuationError]=useState(false);
  const busy=model.outcome==="saving",blocked=["conflict","unknown"].includes(model.outcome);
  const guarded=model.dirty||busy||model.outcome==="unknown";
  useClientAccountExit(guarded,busy);
  useEffect(()=>{
    if(!guarded)return;
    const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",prevent);return()=>window.removeEventListener("beforeunload",prevent);
  },[guarded]);
  useEffect(()=>{
    if(model.phase!=="ready"||model.outcome!=="saved"||!model.state||navigation.current)return;
    if(!acceptSavedProfile(model.state.profile)){setContinuationError(true);return;}
    navigation.current=true;
    const stage=model.state.profile.onboarding_stage;
    navigate(["accepting_payment","completing_intake","uploading_docs","completed"].includes(stage??"")?"/app":"/onboard/agreement");
  },[model.phase,model.outcome,model.state,acceptSavedProfile,navigate]);
  const accent=brand?.primary_color,workspace=brand?.tenant_name??"your business";
  const reload=()=>{if(!model.dirty||window.confirm("Discard your edits and reload saved information?"))void model.reload(true);};
  return <section aria-labelledby="welcome-title">
    <div className="mb-6"><h1 id="welcome-title" className="onboard-h1">Welcome.</h1>
      <p className="onboard-sub">Confirm your details for {workspace}, then review your agreement.</p>
      <p className="text-sm mb-2">Step 1 of 2 · Your info</p>
      <div className="onboard-progress"><div style={{width:"50%",transition:"none"}}/></div>
    </div>
    <div className="onboard-card p-6 sm:p-8 space-y-6">
      {continuationError?<div role="alert"><p>The next step could not be opened. Reload your onboarding to continue.</p>
        <Button className={`mt-4 ${controlClass}`} onClick={refresh}>Reload onboarding</Button></div>
        :model.phase==="loading"?<p role="status">Loading your information…</p>
        :model.phase!=="ready"?<div role="alert"><p>{model.phase==="signed_out"?"Sign in again to continue."
          :model.phase==="unavailable"?"Your information is unavailable for this business. Contact the business for help."
          :"Your information could not be loaded. Your edits have been kept in this session. Try again when connected."}</p>
          {model.phase==="signed_out"?<Button asChild className={`mt-4 ${controlClass}`}><a href="/auth" style={{color:"hsl(var(--primary-foreground))"}}>Go to sign in</a></Button>
            :<Button className={`mt-4 ${controlClass}`} onClick={()=>void model.reload()}>Try again</Button>}</div>
        :model.state?.status==="configuration_required"?<div role="status"><p>{workspace} needs to finish setting up your welcome questions. Contact the business before continuing.</p>
          <Button className={`mt-4 ${controlClass}`} onClick={()=>void model.reload()}>Check again</Button></div>
        :<form className="space-y-6" onSubmit={e=>{e.preventDefault();void model.save();}}>
          <div><div className="text-xs uppercase tracking-wide">Account on file</div><p>{model.state?.profile.email??"No email on file"}</p></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([['first_name','First name','given-name'],['last_name','Last name','family-name'],['phone','Phone number','tel'],
              ['street_address','Street address','street-address'],['city','City','address-level2'],['state','State','address-level1'],['zip_code','ZIP','postal-code']] as const).map(([key,label,autocomplete])=>
              <div key={key} className={`space-y-2 ${key==='phone'||key==='street_address'?'sm:col-span-2':''}`}>
                <Label htmlFor={`welcome-${key}`}>{label}{!['first_name','last_name','phone'].includes(key)&&<span className="text-xs ml-1">(optional)</span>}</Label>
                <Input id={`welcome-${key}`} className={controlClass} autoComplete={autocomplete} type={key==='phone'?'tel':'text'}
                  required={['first_name','last_name','phone'].includes(key)} disabled={busy} maxLength={key==='street_address'?500:200}
                  value={model.draft[key]} onChange={e=>model.edit(key,e.target.value)}/>
              </div>)}
          </div>
          {!!model.state?.fields.length&&<div className="space-y-5 pt-4 border-t">{model.state.fields.map(field=><IntakeQuestion key={field.key}
            field={field} value={model.answers[field.key]} onChange={v=>model.answer(field.key,v)} disabled={busy}/>)}</div>}
          {model.notice&&<p role={model.outcome==='invalid'||blocked?'alert':'status'} aria-live="polite">{model.notice}</p>}
          {blocked&&<div className="flex flex-wrap gap-3">
            {model.outcome==='unknown'&&<Button type="button" variant="outline" className={controlClass} onClick={()=>void model.reload(false,true)}>Check saved information</Button>}
            <Button type="button" variant="outline" className={controlClass} onClick={reload}>Discard edits and reload</Button>
          </div>}
          <div className="flex justify-end"><Button type="submit" className={controlClass} disabled={busy||blocked||model.outcome==='saved'}
            style={accent?{backgroundColor:accent,color:readableTextOn(accent)}:undefined}>{busy?"Saving…":"Continue to agreement"}</Button></div>
        </form>}
    </div>
  </section>;
}
