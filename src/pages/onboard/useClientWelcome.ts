import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readClientWelcomeState, type ClientWelcomeState, type WelcomeAnswer } from "@/lib/client-portal-welcome";
import type { OnboardClient } from "./useOnboardingClient";

const profileKeys = ["first_name","last_name","phone","street_address","city","state","zip_code"] as const;
type Draft = Record<typeof profileKeys[number],string>;
type Model = { phase:"loading"|"ready"|"unavailable"|"signed_out"|"read_error"; state:ClientWelcomeState|null;
  draft:Draft; answers:Record<string,WelcomeAnswer>; outcome:"idle"|"saving"|"invalid"|"conflict"|"unknown"|"saved"|"reconciled"; notice:string };
const emptyDraft = (): Draft => ({first_name:"",last_name:"",phone:"",street_address:"",city:"",state:"",zip_code:""});
const initial = (): Model => ({phase:"loading",state:null,draft:emptyDraft(),answers:{},outcome:"idle",notice:""});
const fromState = (s:ClientWelcomeState): Model => ({...initial(),phase:"ready",state:s,
  draft:Object.fromEntries(profileKeys.map(k=>[k,s.profile[k]??""])) as Draft,answers:{...s.answers}});
const dirty = (m:Model) => !!m.state && (profileKeys.some(k=>m.draft[k] !== (m.state!.profile[k]??""))
  || JSON.stringify(m.answers) !== JSON.stringify(m.state.answers));
const sameScope = (a:ClientWelcomeState,b:ClientWelcomeState) => a.profile.id===b.profile.id
  && a.profile.tenant_id===b.profile.tenant_id && a.profile.linked_user_id===b.profile.linked_user_id;
const matches = (s:ClientWelcomeState,m:Model) => profileKeys.every(k=>(s.profile[k]??"")===m.draft[k].trim())
  && s.fields.every(f=>(s.answers[f.key]??null)===(m.answers[f.key]??null));
class ReadFailure extends Error { constructor(readonly phase:"unavailable"|"signed_out"|"read_error") {super(phase);} }

/** This mounted form's request/draft lifetime; native records remain authoritative. */
export function useClientWelcome(expected:OnboardClient) {
  const expectedId=expected.id,expectedTenantId=expected.tenant_id,expectedSubjectId=expected.linked_user_id;
  const [model,setModel]=useState<Model>(initial);
  const latest=useRef(model), actions=useRef<{load:(discard?:boolean,reconcile?:boolean)=>Promise<void>;save:()=>Promise<void>}|null>(null);
  const publish=useCallback((next:Model)=>{latest.current=next;setModel(next);},[]);
  useEffect(()=>{
    let disposed=false,signedOut=false,sequence=0,writing=false,actor:string|null=null;
    let deferred:{actor:string;preserve?:Model;sequence:number}|null=null;
    const retire=new AbortController();
    const current=(n:number)=>!disposed&&!signedOut&&n===sequence;
    const wait=<T,>(p:PromiseLike<T>):Promise<T>=>new Promise((resolve,reject)=>{
      const finish=(fn:()=>void)=>{clearTimeout(timer);retire.signal.removeEventListener("abort",abort);fn();};
      const abort=()=>finish(()=>reject(new Error("retired")));
      const timer=setTimeout(()=>finish(()=>reject(new Error("timeout"))),20_000);
      retire.signal.addEventListener("abort",abort,{once:true});
      Promise.resolve(p).then(v=>finish(()=>resolve(v)),e=>finish(()=>reject(e)));
    });
    const credential=async(n:number)=>{
      const session=await wait(supabase.auth.getSession()); if(!current(n))return null;
      if(session.error)throw new ReadFailure(session.error.status===401?"signed_out":"read_error");
      const token=session.data.session?.access_token;if(!token)throw new ReadFailure("signed_out");
      const result=await wait(supabase.auth.getUser(token));if(!current(n))return null;
      if(result.error?.status===401||result.error?.name==="AuthSessionMissingError")throw new ReadFailure("signed_out");
      if(result.error)throw new ReadFailure("read_error");
      if(!result.data.user)throw new ReadFailure("signed_out");
      if(result.data.user.id!==expectedSubjectId)throw new ReadFailure("unavailable");
      actor=result.data.user.id;return token;
    };
    const read=async(n:number)=>{
      const token=await credential(n);if(!token||!current(n))return null;
      const result=await wait(supabase.rpc("client_portal_welcome_state" as never).setHeader("Authorization",`Bearer ${token}`)) as {data:unknown;error:{code?:string}|null};
      if(!current(n))return null;
      if(result.error)throw new ReadFailure(result.error.code==="42501"?"unavailable":"read_error");
      const value=readClientWelcomeState(result.data,expectedSubjectId,{id:expectedId,tenant_id:expectedTenantId});
      if(!value)throw new ReadFailure("read_error");
      // Verify again before exposing data; an SDK notification may arrive late.
      if(!await credential(n)||!current(n))return null;
      return value;
    };
    const load=async(preserve?:Model,reconcile=false)=>{
      if(disposed||signedOut||writing)return;
      const n=++sequence;
      publish(preserve?{...preserve,phase:"loading"}:initial());
      try{
        const state=await read(n);if(!state||!current(n))return;
        let next=fromState(state);
        if(preserve?.state&&sameScope(state,preserve.state)){
          next={...next,draft:preserve.draft,answers:preserve.answers};
          if(reconcile&&matches(state,preserve))next={...fromState(state),outcome:"reconciled",notice:"Your saved information matches this form. Continue when you are ready."};
          else if(preserve.outcome==="unknown")next={...next,outcome:"unknown",notice:"Your edits differ from the saved information. Keep a copy or discard edits before another save."};
          else if(preserve.outcome==="conflict"||(dirty(preserve)&&state.expected_token!==preserve.state.expected_token))
            next={...next,outcome:"conflict",notice:"Your information changed. Reload saved information before saving again."};
        }
        publish(next);
      }catch(e){if(current(n)){const phase=e instanceof ReadFailure?e.phase:"read_error";
        publish(phase==="read_error"&&preserve?{...preserve,phase}:{...initial(),phase});}}
    };
    const save=async()=>{
      const before=latest.current;
      if(!current(sequence)||writing||before.phase!=="ready"||before.state?.status!=="ready"
        ||["conflict","unknown","saving","saved"].includes(before.outcome))return;
      if(!before.draft.first_name.trim()||!before.draft.last_name.trim()
        ||before.draft.phone.replace(/\D/g,"").length<7||before.state.fields.some(f=>f.required&&(before.answers[f.key]===null||before.answers[f.key]===undefined||String(before.answers[f.key]).trim()===""))){
        publish({...before,outcome:"invalid",notice:"Enter your name, phone number and required answers."});return;
      }
      if(before.outcome==="reconciled"&&!dirty(before)&&before.state.intake_submitted_at
        &&["signing_agreement","accepting_payment","completing_intake","uploading_docs","completed"].includes(before.state.profile.onboarding_stage??"")){
        publish({...before,outcome:"saved",notice:"Saved information loaded."});return;
      }
      const n=++sequence;writing=true;let dispatched=false;
      publish({...before,outcome:"saving",notice:"Saving your information…"});
      try{
        const token=await credential(n);if(!token||!current(n))return;
        const patch=Object.fromEntries(profileKeys.map(k=>[k,before.draft[k].trim()||null]));
        dispatched=true;
        const result=await wait(supabase.rpc("client_portal_save_welcome" as never,{p_expected_token:before.state.expected_token,
          p_profile:patch,p_answers:before.answers} as never).setHeader("Authorization",`Bearer ${token}`)) as {data:unknown;error:{code?:string}|null};
        if(!current(n))return;
        if(result.error?.code==="42501")throw new ReadFailure("unavailable");
        if(result.error?.code==="40001"){publish({...before,outcome:"conflict",notice:"Your information changed. Reload saved information before saving again."});return;}
        if(result.error?.code==="22023"){publish({...before,outcome:"invalid",notice:"Check your contact information and answers before trying again."});return;}
        if(result.error?.code==="55000"){publish({...initial(),phase:"ready",state:{...before.state,status:"configuration_required",fields:[],answers:{},expected_token:null}});return;}
        if(result.error)throw new Error("unconfirmed");
        const saved=readClientWelcomeState(result.data,expectedSubjectId,{id:expectedId,tenant_id:expectedTenantId});
        if(!saved||!matches(saved,before))throw new Error("unconfirmed");
        const confirmed=await read(n);if(!confirmed||!current(n))return;
        if(confirmed.expected_token!==saved.expected_token||!matches(confirmed,before))throw new Error("unconfirmed");
        publish({...fromState(confirmed),outcome:"saved",notice:"Information saved."});
      }catch(e){if(current(n)){
        if(e instanceof ReadFailure)publish(e.phase==="read_error"?{...before,phase:"read_error",outcome:dispatched?"unknown":"idle"}:{...initial(),phase:e.phase});
        else publish({...before,outcome:dispatched?"unknown":"invalid",notice:dispatched?"We couldn’t confirm the save. Check saved information before another save.":"Your session could not be verified. Try again when connected."});
      }}finally{writing=false;if(deferred&&current(deferred.sequence)){const next=deferred;deferred=null;void load(next.preserve);}}
    };
    actions.current={load:(discard=false,reconcile=false)=>load(discard?undefined:latest.current.state?latest.current:undefined,reconcile),save};
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      if(disposed)return;
      const next=session?.user.id??null;
      if(event==="INITIAL_SESSION"&&(!actor||next===actor))return;
      const previous=latest.current,preserve=next===actor&&previous.state?{...previous,outcome:writing?"unknown" as const:previous.outcome}:undefined;
      sequence++;actor=next;signedOut=event==="SIGNED_OUT";
      publish(signedOut||!next?{...initial(),phase:"signed_out"}:preserve?{...preserve,phase:"loading"}:initial());
      if(!next||signedOut){deferred=null;return;}
      const scheduled=sequence;
      queueMicrotask(()=>{if(!current(scheduled))return;if(writing)deferred={actor:next,preserve,sequence:scheduled};else void load(preserve);});
    });
    const focus=()=>{if(!disposed&&!signedOut&&!writing)void load(latest.current.state?latest.current:undefined);};
    window.addEventListener("focus",focus);void load();
    return()=>{disposed=true;sequence++;deferred=null;actions.current=null;retire.abort();subscription.unsubscribe();window.removeEventListener("focus",focus);};
  },[expectedId,expectedTenantId,expectedSubjectId,publish]);
  const edit=(key:keyof Draft,value:string)=>{
    const m=latest.current;if(m.phase!=="ready"||m.outcome==="saving")return;
    publish({...m,draft:{...m.draft,[key]:value},outcome:["conflict","unknown"].includes(m.outcome)?m.outcome:"idle",notice:["conflict","unknown"].includes(m.outcome)?m.notice:""});
  };
  const answer=(key:string,value:WelcomeAnswer)=>{
    const m=latest.current;if(m.phase!=="ready"||m.outcome==="saving"||!m.state?.fields.some(f=>f.key===key))return;
    publish({...m,answers:{...m.answers,[key]:value},outcome:["conflict","unknown"].includes(m.outcome)?m.outcome:"idle",notice:["conflict","unknown"].includes(m.outcome)?m.notice:""});
  };
  const visible=model.state&&(model.state.profile.id!==expected.id||model.state.profile.tenant_id!==expected.tenant_id
    ||model.state.profile.linked_user_id!==expected.linked_user_id)?initial():model;
  return {...visible,dirty:dirty(visible),edit,answer,save:()=>actions.current?.save(),
    reload:(discard=false,reconcile=false)=>actions.current?.load(discard,reconcile)};
}
