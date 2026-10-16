import {useCallback, useEffect, useRef, useState} from "react";
import {Link, useNavigate} from "react-router-dom";
import {Helmet} from "react-helmet-async";
import {Loader2, Eye, EyeOff} from "lucide-react";
import {supabase} from "@/integrations/supabase/client";
import {Card, CardContent, CardHeader, CardDescription} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Checkbox} from "@/components/ui/checkbox";
import {readableTextOn} from "@/lib/brand/contrast";
import {readClientPortalSelfProfile} from "@/lib/client-portal-self-profile";
import type {User} from "@supabase/supabase-js";
import "./ConsumerInvitation.css";

export interface ConsumerInviteInfo {
  tenant_id:string; tenant_name:string; is_valid:boolean; invited_email:string|null;
  brand:{logo_url?:string|null;primary_color?:string|null}|null;
}
type Phase="loading"|"choice"|"create"|"signin"|"verify"|"ready"|"wrong"|"accepted"|"unknown"|"invalid"|"error";
type Receipt={tenant_id:string;client_id:string;accepted_at:string;status:"accepted"};
function readReceipt(value:unknown,tenant:string):Receipt|null {
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const r=value as Record<string,unknown>;
  return Object.keys(r).length===4&&r.status==="accepted"&&r.tenant_id===tenant
    &&typeof r.client_id==="string"&&typeof r.accepted_at==="string"
    ?r as Receipt:null;
}
async function bounded<T>(request:PromiseLike<T>):Promise<T> {
  let timer:ReturnType<typeof setTimeout>;
  try{return await Promise.race([Promise.resolve(request),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("timeout")),20_000);})]);}
  finally{clearTimeout(timer!);}
}

/** Ordinary recipient identity flow. The native acceptor alone grants access. */
export function ConsumerInvitation({token,info}:{token:string;info:ConsumerInviteInfo}) {
  const navigate=useNavigate();
  const [phase,setPhase]=useState<Phase>("loading"),[busy,setBusy]=useState(false);
  const [actor,setActor]=useState<User|null>(null),[password,setPassword]=useState("");
  const [showPassword,setShowPassword]=useState(false),[terms,setTerms]=useState(false);
  const [notice,setNotice]=useState(""),[receipt,setReceipt]=useState<Receipt|null>(null);
  const life=useRef({alive:true,sequence:0,working:false}),heading=useRef<HTMLHeadingElement>(null);
  const email=info.invited_email?.trim().toLowerCase()??"";
  const current=(n:number)=>life.current.alive&&n===life.current.sequence;
  const checkedActor=async(n:number,expected?:string)=>{
    const result=await bounded(supabase.auth.getUser());
    if(!current(n))return null;
    if(result.error)throw new Error("session_unavailable");
    if(expected&&result.data.user?.id!==expected)throw new Error("session_changed");
    return result.data.user;
  };
  const status=useCallback(async()=>{
    const result=await bounded(supabase.rpc("client_portal_invite_status" as never,{p_token:token} as never));
    if(result.error)throw new Error("status_unavailable");
    if(result.data===null)return null;
    const value=readReceipt(result.data,info.tenant_id);
    if(!value)throw new Error("status_unavailable");
    return value;
  },[token,info.tenant_id]);
  const validInvitation=useCallback(async()=>{
    const peek=await bounded(supabase.rpc("peek_tenant_invite",{_token:token}));
    if(peek.error)throw new Error("invitation_unavailable");
    const fresh=Array.isArray(peek.data)?peek.data[0]:peek.data;
    return !!fresh&&fresh.is_valid&&fresh.kind==="consumer"&&fresh.tenant_id===info.tenant_id
      &&fresh.invited_email?.trim().toLowerCase()===email;
  },[token,info.tenant_id,email]);
  const refresh=useCallback(async()=>{
    const n=++life.current.sequence;
    setBusy(true);setReceipt(null);setActor(null);setNotice("");setPhase("loading");
    try{
      const result=await bounded(supabase.auth.getUser());if(!current(n))return;
      if(result.error&&result.error.name!=="AuthSessionMissingError")throw new Error("session_unavailable");
      const user=result.data.user;
      if(user){
        const saved=await status();if(!current(n))return;
        const confirmation=await bounded(supabase.auth.getUser());if(!current(n))return;
        if(confirmation.error||confirmation.data.user?.id!==user.id)throw new Error("session_changed");
        setActor(user);
        if(saved){setReceipt(saved);setPhase("accepted");return;}
        const valid=await validInvitation();if(!current(n))return;
        if(!valid){setPhase("invalid");return;}
        if(user.email?.trim().toLowerCase()!==email){setPhase("wrong");return;}
        setPhase(user.email_confirmed_at?"ready":"verify");
      }else{const valid=await validInvitation();if(current(n))setPhase(valid&&email?"choice":"invalid");}
    }catch{if(current(n)){setPhase("error");setNotice("We couldn’t check your session or invitation. Try again when connected.");}}
    finally{if(current(n))setBusy(false);}
  },[email,status,validInvitation]);
  useEffect(()=>{
    const lifetime=life.current;
    lifetime.alive=true;
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event)=>{
      if(event==="INITIAL_SESSION")return;
      ++life.current.sequence;setPassword("");setReceipt(null);setActor(null);setPhase("loading");
      queueMicrotask(()=>{if(life.current.alive)void refresh();});
    });
    void refresh();
    return()=>{lifetime.alive=false;++lifetime.sequence;subscription.unsubscribe();};
  },[refresh]);
  useEffect(()=>{heading.current?.focus();},[phase]);

  const authenticate=async()=>{
    if(life.current.working)return;
    if(!email){setPhase("invalid");return;}
    if(password.length<8){setNotice("Enter a password with at least 8 characters.");return;}
    if(phase==="create"&&!terms){setNotice("Agree to the Terms and Privacy Policy to create your account.");return;}
    const n=++life.current.sequence,creating=phase==="create";
    life.current.working=true;setBusy(true);setNotice("");
    try{
      // Revalidate the token immediately before identity creation. This does not
      // consume it or trust editable user metadata for membership/provisioning.
      // Existing login is also permitted for a consumed link: it can recover
      // already-accepted access, but cannot create or consume a new invitation.
      if(creating){const valid=await validInvitation();if(!current(n))return;if(!valid){setPhase("invalid");return;}}
      const result=creating
        ?await bounded(supabase.auth.signUp({email,password,options:{emailRedirectTo:`${window.location.origin}/join/${encodeURIComponent(token)}`}}))
        :await bounded(supabase.auth.signInWithPassword({email,password}));
      if(!current(n))return;
      if(result.error){setNotice(creating?"Your account could not be created. Try signing in if you already have an account, or try again later.":"Sign-in failed. Check your password and confirm your email before trying again.");return;}
      setPassword("");
      if(creating){setPhase("verify");setNotice("Confirm the email we sent, then return to this invitation. If you already have an account, sign in instead.");}
      else await refresh();
    }catch{if(current(n)){setPassword("");setPhase(creating?"verify":"error");setNotice(creating?"We couldn’t confirm the signup response. Check your email or sign in before trying to create another account.":"We couldn’t confirm sign-in. Check your session before trying again.");}}
    finally{life.current.working=false;if(current(n))setBusy(false);}
  };
  const accept=async()=>{
    if(life.current.working||phase!=="ready"||!actor)return;
    const n=++life.current.sequence,subject=actor.id;
    life.current.working=true;setBusy(true);setNotice("");let dispatched=false;
    try{
      const user=await checkedActor(n,subject);if(!current(n))return;
      if(!user?.email_confirmed_at||user.email?.trim().toLowerCase()!==email)throw new Error("wrong_recipient");
      dispatched=true;
      const result=await bounded(supabase.rpc("accept_tenant_invite",{_token:token}));if(!current(n))return;
      if(result.error)throw new Error("acceptance_unconfirmed");
      const saved=await status();if(!current(n))return;
      if(!saved||result.data!==saved.tenant_id)throw new Error("acceptance_unconfirmed");
      if(!await checkedActor(n,subject)||!current(n))return;
      setReceipt(saved);setPhase("accepted");
      try{localStorage.removeItem("paige_pending_invite");}catch{/* storage is optional */}
    }catch{if(current(n)){setPhase(dispatched?"unknown":"error");setNotice(dispatched?"We couldn’t confirm acceptance. Check the recorded result before trying again.":"Your session changed or could not be verified. Check your session to continue.");}}
    finally{life.current.working=false;if(current(n))setBusy(false);}
  };
  const continueToPortal=async()=>{
    if(!actor||!receipt||life.current.working)return;
    const n=++life.current.sequence;setBusy(true);life.current.working=true;
    try{
      const user=await checkedActor(n,actor.id);if(!user||!current(n))return;
      const saved=await status();if(!current(n))return;
      if(!saved||saved.client_id!==receipt.client_id)throw new Error("relationship_unavailable");
      const result=await bounded(supabase.rpc("client_portal_self_profile",{p_tenant_id:saved.tenant_id}));if(!current(n))return;
      const profile=readClientPortalSelfProfile(result.data,user.id,saved.tenant_id);
      if(result.error||!profile||profile.id!==saved.client_id)throw new Error("relationship_unavailable");
      if(!await checkedActor(n,user.id)||!current(n))return;
      // Keep the established Auth client alive when browser storage is unavailable.
      navigate(["invited","pre_invite"].includes(profile.onboarding_stage??"invited")?"/onboard/welcome":profile.onboarding_stage==="signing_agreement"?"/onboard/agreement":"/app");
    }catch{if(current(n)){setReceipt(null);setPhase("error");setNotice("Your portal access could not be confirmed. Check your invitation or contact the business.");}}
    finally{life.current.working=false;if(current(n))setBusy(false);}
  };
  const resend=async()=>{
    if(busy||life.current.working)return;
    const n=++life.current.sequence;setBusy(true);life.current.working=true;
    try{
      const valid=await validInvitation();if(!current(n))return;if(!valid){setPhase("invalid");return;}
      const result=await bounded(supabase.auth.resend({type:"signup",email,options:{emailRedirectTo:`${window.location.origin}/join/${encodeURIComponent(token)}`}}));
      if(current(n))setNotice(result.error?"Confirmation email could not be requested. Wait a moment, then try again.":"Confirmation email requested. Check your inbox and spam folder; delivery is not yet confirmed.");
    }catch{if(current(n))setNotice("We couldn’t confirm the email request. Check your inbox before requesting another.");}
    finally{life.current.working=false;if(current(n))setBusy(false);}
  };
  const switchAccount=async()=>{
    if(life.current.working)return;
    const n=++life.current.sequence;life.current.working=true;setBusy(true);setNotice("");setPassword("");
    try{
      const result=await bounded(supabase.auth.signOut({scope:"local"}));if(!current(n))return;
      if(result.error)throw new Error("signout_unconfirmed");
      await refresh();
    }catch{if(current(n))setNotice("Sign-out could not be confirmed. Try again when connected.");}
    finally{life.current.working=false;if(current(n))setBusy(false);}
  };
  const color=info.brand?.primary_color||"#150C31",style={backgroundColor:color,color:readableTextOn(color)};
  const titles:Record<Phase,string>={loading:"Checking your invitation…",choice:`Join ${info.tenant_name}`,create:"Create your account",signin:"Sign in",verify:"Check your email",ready:`Join ${info.tenant_name}`,wrong:"Use your invited account",accepted:"Your invitation is accepted",unknown:"Check your invitation",invalid:"This invitation is unavailable",error:"Let’s try again"};
  return <main className="customer-entry min-h-dvh bg-background text-foreground px-4 py-8 sm:py-12 flex items-start sm:items-center justify-center">
    <Helmet><title>{titles[phase]}</title><meta name="robots" content="noindex,nofollow"/><meta name="referrer" content="no-referrer"/></Helmet>
    <Card className="w-full max-w-md">
      <CardHeader>
        {info.brand?.logo_url&&<img src={info.brand.logo_url} alt={info.tenant_name} referrerPolicy="no-referrer" className="h-12 max-w-full w-auto self-start object-contain mb-3"/>}
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold leading-tight break-words focus:outline-none">{titles[phase]}</h1>
        <CardDescription className="break-words">{phase==="create"?`Create a customer login for your work with ${info.tenant_name}.`:phase==="choice"?"Create your customer login, or sign in if you already have one.":email}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 [&_button:not([role=checkbox])]:min-h-11 [&_input]:min-h-11 [&_input]:text-base">
        {notice&&<p role="alert" className="text-sm break-words">{notice}</p>}
        {phase==="loading"?<p role="status" className="flex gap-2 items-center"><Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none"/>Checking access…</p>:null}
        {phase==="choice"&&<><Button className="w-full" style={style} onClick={()=>{setPhase("create");setNotice("");}}>Create your account</Button><Button variant="outline" className="w-full" onClick={()=>{setPhase("signin");setNotice("");}}>Sign in</Button></>}
        {(phase==="create"||phase==="signin")&&<form onSubmit={e=>{e.preventDefault();void authenticate();}} className="space-y-4" aria-busy={busy}>
          <div className="space-y-2"><Label htmlFor="customer-email">Invited email</Label><Input id="customer-email" type="email" autoComplete="username" value={email} readOnly/></div>
          <div className="space-y-2"><Label htmlFor="customer-password">Password</Label><div className="relative"><Input id="customer-password" type={showPassword?"text":"password"} autoComplete={phase==="create"?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required disabled={busy} className="pr-12"/><button type="button" aria-label={showPassword?"Hide password":"Show password"} onClick={()=>setShowPassword(v=>!v)} className="absolute right-0 top-0 px-3" disabled={busy}>{showPassword?<EyeOff aria-hidden="true" className="size-4"/>:<Eye aria-hidden="true" className="size-4"/>}</button></div></div>
          {phase==="create"&&<div className="flex gap-3 items-start min-h-11"><Checkbox id="customer-terms" aria-label="I agree to the Terms and Privacy Policy" className="size-6 shrink-0" checked={terms} onCheckedChange={v=>setTerms(v===true)} disabled={busy}/><Label htmlFor="customer-terms" className="text-sm leading-relaxed">I agree to the <Link className="underline" to="/legal/terms" target="_blank" rel="noreferrer">Terms</Link> and <Link className="underline" to="/legal/privacy" target="_blank" rel="noreferrer">Privacy Policy</Link>.</Label></div>}
          <Button type="submit" disabled={busy} className="w-full" style={style}>{busy?"Please wait…":phase==="create"?"Create account":"Sign in to continue"}</Button>
          <Button type="button" variant="ghost" disabled={busy} className="w-full" onClick={()=>{setPassword("");void refresh();}}>Back</Button>
          {phase==="signin"&&<p className="text-sm"><Link className="underline" to={`/auth?mode=login&next=${encodeURIComponent(`/join/${token}`)}`}>Need help signing in?</Link></p>}
        </form>}
        {phase==="verify"&&<><p>Confirm your email, then return to this invitation. Your customer access starts after you accept.</p><Button style={style} disabled={busy} className="w-full" onClick={()=>void refresh()}>I have confirmed my email</Button><Button variant="outline" disabled={busy} className="w-full" onClick={()=>void resend()}>Resend confirmation email</Button><Button variant="ghost" disabled={busy} className="w-full" onClick={()=>{setPhase("signin");setNotice("");}}>Sign in</Button></>}
        {phase==="ready"&&<><p>Accept to connect your customer account with {info.tenant_name} and open your authorized portal.</p><Button style={style} disabled={busy} className="w-full" onClick={()=>void accept()}>{busy?"Accepting…":"Accept invitation"}</Button></>}
        {phase==="accepted"&&<><p>Your customer relationship is confirmed. Continue to your saved information.</p><Button style={style} disabled={busy} className="w-full" onClick={()=>void continueToPortal()}>{busy?"Checking portal…":"Continue to your portal"}</Button></>}
        {phase==="wrong"&&<><p>This invitation is for {email}. You are signed in as {actor?.email}.</p><Button variant="outline" disabled={busy} className="w-full" onClick={()=>void switchAccount()}>Sign out of this session</Button></>}
        {(phase==="unknown"||phase==="error")&&<Button variant="outline" disabled={busy} className="w-full" onClick={()=>void refresh()}>{phase==="unknown"?"Check acceptance":"Try again"}</Button>}
        {phase==="invalid"&&<><p>Ask the business for a new invitation. No new access has been granted here.</p>{email&&<Button variant="outline" className="w-full" onClick={()=>{setPhase("signin");setNotice("");}}>Sign in to check existing access</Button>}</>}
      </CardContent>
    </Card>
  </main>;
}
