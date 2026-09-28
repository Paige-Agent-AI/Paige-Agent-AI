// @ts-nocheck
import React from "react";
import { WorkspaceExitControl } from "@/components/auth/WorkspaceExitControl";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Blocks, Building2, CircleDollarSign, FileLock2, Link2, ShieldCheck, Users } from "lucide-react";
import { useTheme } from "next-themes";
import { performSignOut } from "@/lib/auth/signOut";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { SoloSetupReadinessNotice } from "./SoloSetupReadinessNotice";
import { soloShellRole } from "./shell-role";
import { isSoloSetupComplete } from "@/components/auth/RequireSetupComplete";
import { branchBySlug, branchByKey, branchPath, defaultBranchSlug } from "@/lib/routing/tierBranches";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import "./solo-tokens.css";
import { Ic, Logo, Avatar, Wrap, PageHead } from "./_shared";
import { CommandHub } from "./CommandCenter";
import { SoloPaigeWorkspace } from "./SoloPaigeWorkspace";
import { clearPaigeClientScope, readPaigeOpenScope, setPaigeClientScope } from "./paigeClientScope";
import { clearPaigePublicPresenceScope } from "./paigePublicPresenceScope";
import { TenantRelationshipsClientsWorkspace } from "@/components/tenant-relationships/TenantRelationshipsClientsWorkspace";
import { isLegacyRelationshipOwner } from "@/components/tenant-relationships/workspaceModel";
import { ClientsHub } from "./conversations";
import { GrowthHub } from "./growth2";
import { TenantCanonicalCalendarWorkspace } from "@/components/tenant-calendar/TenantCanonicalCalendarWorkspace";
import { Analytics2 } from "./analytics2";
import { Marketplace } from "./marketplace";
import { SoloSettings } from "./settings";
import { SOLO_SETTINGS_DESTINATIONS } from "./settings-contract";
import { canShowVaultNavigation, useVaultAccess } from "./vault/useBusinessVault";
import { VibeStudio } from "./vibe";
import { TenantCommandCenterShell } from "@/components/tenant-shell/TenantCommandCenterShell";
import { resolveTenantAccountContext } from "@/components/tenant-shell/tenantShellRoutes";
import { AgentPresenceProvider, useAgentPresence } from "@/components/ui/paige";
import { VoiceDeviceProvider } from "@/lib/voice/VoiceDeviceProvider";
import { DialPadSurface } from "@/components/admin/voice/DialPadSurface";
import { IncomingCallOverlay } from "@/components/admin/voice/IncomingCallOverlay";
import { LiveTranscriptPanel } from "@/components/admin/voice/LiveTranscriptPanel";

// Trust Compass is reached through Command Center (its third sub-tab), not a top-level rail entry
// (owner-ruled 2026-09-05). The legacy `/solo/{account}/trust-compass` address redirects into it.
// (Merge: keep the compass OUT of the top nav — this PR moved it into Command Center — while taking
// main's NAV2, which relocated Business Vault out of the second rail; do not resurrect it, §58.)
const NAV=[['home','Command Center',()=><Ic.grid/>],['paige','Paige',()=><Ic.spark/>],['auto','Automations',()=><Ic.bolt/>],['clients','Clients',()=><Ic.users/>],['growth','Growth',()=><Ic.trend/>],['analytics','Analytics',()=><Ic.chart/>]];
const NAV2=[['market','Marketplace',()=><Ic.store/>],['integrations','Integrations',()=><Ic.bolt/>],['team','Team',()=><Ic.users/>],['setup','Setup',()=><Ic.gear/>]];
const LEGACY_SETTINGS={setup:'setup',team:'team',integrations:'integrations','business-vault':'vault'};
const SETTINGS_ICONS={setup:Building2,team:Users,connections:Link2,integrations:Blocks,'security-data':ShieldCheck,vault:FileLock2,billing:CircleDollarSign};

const SoloClientsRoute=({openPaige})=>{const[tab]=useSubtabRoute("solo","clients","people");return isLegacyRelationshipOwner("solo",tab)?<ClientsHub openPaige={openPaige}/>:<TenantRelationshipsClientsWorkspace routeTier="solo" openPaige={openPaige}/>};

const Rail=({route,go,collapsed,setCollapsed,homeCount})=>{const w=collapsed?70:238;
const Item=([k,label,Icn])=>{const on=route===k;
return <button key={k} onClick={()=>go(k)} title={label} className="row" style={{width:'100%',gap:12,padding:collapsed?'10px':'9px 12px',borderRadius:11,marginBottom:2,
justifyContent:collapsed?'center':'flex-start',background:on?'var(--rail-2)':'transparent',color:on?'#fff':'var(--rail-text)',position:'relative',transition:'.15s'}}
onMouseEnter={e=>{if(!on)e.currentTarget.style.background='rgba(255,255,255,.05)'}} onMouseLeave={e=>{if(!on)e.currentTarget.style.background='transparent'}}>
{on&&<span style={{position:'absolute',left:collapsed?6:0,top:'50%',transform:'translateY(-50%)',width:3,height:18,borderRadius:3,background:'var(--gold-bright)'}}/>}
<span style={{display:'flex',color:on?'var(--gold-bright)':'inherit'}}>{Icn()}</span>
{!collapsed&&<span className="grow trunc" style={{fontSize:13.4,fontWeight:on?600:450,textAlign:'left'}}>{label}</span>}
{!collapsed&&k==='home'&&homeCount>0&&<span className="pill" style={{background:'var(--gold-bright)',color:'#2A1C00',height:19,padding:'0 7px'}}>{homeCount}</span>}</button>};
return <nav style={{width:w,flex:'none',background:'var(--rail)',display:'flex',flexDirection:'column',padding:collapsed?'16px 12px':'16px 14px',transition:'width .22s',overflowX:'hidden',overflowY:'auto'}}>
<div className="row" style={{gap:10,padding:collapsed?'0 0 18px':'2px 4px 18px',justifyContent:collapsed?'center':'flex-start'}}>
<Logo size={collapsed?24:26}/>{!collapsed&&<div className="grow" style={{minWidth:0}}>
<div style={{color:'#fff',fontWeight:600,fontSize:14.5,letterSpacing:'-.02em'}}>Paige Agent AI</div>
<div style={{color:'var(--rail-text)',fontSize:10.5,letterSpacing:'.1em',textTransform:'uppercase',marginTop:1}}>Solo workspace</div></div>}</div>
{NAV.map(Item)}
<div style={{height:1,background:'var(--rail-line)',margin:'14px 4px'}}/>
{!collapsed&&<div style={{color:'var(--rail-text)',fontSize:10,letterSpacing:'.14em',textTransform:'uppercase',padding:'0 12px 8px',opacity:.7}}>Platform</div>}
{NAV2.map(Item)}
<div style={{marginTop:'auto',paddingTop:14,flex:'none'}}>
{!collapsed&&<div style={{border:'1px solid var(--rail-line)',borderRadius:14,padding:'12px 13px',marginBottom:10}}>
{/* §13 — the "147 hours saved this month" line that sat under this chip was fixture
copy with no backend seam, so it is stripped rather than replaced. "Solo plan" is
tier-accurate on this shell and stays. */}
<div className="row" style={{gap:7,color:'var(--gold-bright)',fontSize:12,fontWeight:600}}><Ic.bolt size={13}/>Solo plan</div></div>}
<button onClick={()=>setCollapsed(!collapsed)} className="row" style={{width:'100%',justifyContent:'center',padding:9,borderRadius:10,color:'var(--rail-text)'}}>
<span style={{display:'flex',transform:collapsed?'':'rotate(180deg)',transition:'.2s'}}><Ic.chev size={15}/></span></button></div></nav>};

const TopBar=({theme,setTheme,openPaige,route,go})=>{const title=[...NAV,...NAV2].find(n=>n[0]===route)?.[1]||'';
const[menu,setMenu]=React.useState(false);
const[foc,setFoc]=React.useState(false);
const mref=React.useRef(null);
React.useEffect(()=>{if(!menu)return;
const onDoc=e=>{if(mref.current&&!mref.current.contains(e.target))setMenu(false)};
const onEsc=e=>{if(e.key==='Escape')setMenu(false)};
window.addEventListener('mousedown',onDoc);window.addEventListener('keydown',onEsc);
return()=>{window.removeEventListener('mousedown',onDoc);window.removeEventListener('keydown',onEsc)}},[menu]);
return <header className="row" style={{height:56,flex:'none',padding:'0 22px',borderBottom:'1px solid var(--line)',background:'var(--surface)',gap:14,zIndex:20}}>
<div className="row" style={{gap:9,fontSize:13,color:'var(--ink-3)',flex:'none',whiteSpace:'nowrap'}}>
<span className="row" style={{gap:7,fontWeight:500,color:'var(--ink)',whiteSpace:'nowrap'}}>Jordan Avery</span>
<Ic.chev size={13}/><span style={{whiteSpace:'nowrap'}}>{title}</span></div>
<div className="row grow hide-1100" style={{justifyContent:'center',minWidth:0}}>
<div className="row" style={{gap:8,height:32,flex:'0 1 400px',minWidth:0,padding:'0 12px',border:'1px solid var(--line)',borderRadius:10,background:'var(--surface-2)',color:'var(--ink-3)'}}>
<Ic.search size={14}/><span className="trunc" style={{fontSize:12.8}}>Search clients, threads, obligations</span>
<span className="mono" style={{marginLeft:'auto',fontSize:11,padding:'1px 5px',border:'1px solid var(--line)',borderRadius:5}}>⌘K</span></div></div>
<div className="row" style={{gap:6,flex:'none',marginLeft:'auto'}}>
<span className="pill pill-n hide-1280" style={{height:26,flex:'none'}}>Provided by Northwind Partners</span>
<button className="btn btn-s" style={{width:30,padding:0,justifyContent:'center'}} onClick={openPaige} title="Ask Paige"><Ic.spark size={15}/></button>
<button className="btn btn-s" style={{width:30,padding:0,justifyContent:'center',position:'relative'}}><Ic.bell size={15}/>
<span style={{position:'absolute',top:5,right:6,width:6,height:6,borderRadius:'50%',background:'var(--bad)'}}/></button>
<button className="btn btn-s" style={{width:30,padding:0,justifyContent:'center'}} onClick={()=>setTheme(theme==='dark'?'light':'dark')} title="Theme">{theme==='dark'?<Ic.sun size={15}/>:<Ic.moon size={15}/>}</button>
<div ref={mref} style={{position:'relative',flex:'none'}}>
<button onClick={()=>setMenu(v=>!v)} title="Account" aria-haspopup="menu" aria-expanded={menu}
onFocus={()=>setFoc(true)} onBlur={()=>setFoc(false)}
style={{padding:0,border:'none',background:'transparent',cursor:'pointer',borderRadius:'50%',display:'flex',outline:'none',boxShadow:(menu||foc)?'0 0 0 2px var(--violet)':'none'}}>
<Avatar name="Jordan Avery" size={28} tone="var(--violet)"/></button>
{menu&&<div role="menu" className="fade-in" style={{position:'fixed',top:58,right:16,zIndex:200,width:220,background:'var(--surface)',border:'1px solid var(--line)',borderRadius:12,boxShadow:'var(--sh-3)',padding:6,overflow:'hidden'}}>
<div style={{padding:'8px 10px 6px'}}>
<div style={{fontSize:13,fontWeight:600,color:'var(--ink)'}}>Jordan Avery</div>
<div style={{fontSize:11.5,color:'var(--ink-3)'}}>Solo workspace</div></div>
<div style={{height:1,background:'var(--line-soft)',margin:'2px 0 4px'}}/>
<button role="menuitem" onClick={()=>{setMenu(false);go('setup')}} className="row"
style={{width:'100%',gap:10,padding:'9px 10px',borderRadius:8,fontSize:13,color:'var(--ink)',background:'transparent',border:'none',cursor:'pointer',textAlign:'left'}}
onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}
onFocus={e=>e.currentTarget.style.background='var(--surface-2)'} onBlur={e=>e.currentTarget.style.background='transparent'}>
<Ic.gear size={15}/><span className="grow">Setup &amp; account</span></button>
<button role="menuitem" onClick={()=>{setMenu(false);performSignOut({redirectTo:'/'})}} className="row"
style={{width:'100%',gap:10,padding:'9px 10px',borderRadius:8,fontSize:13,color:'var(--bad)',background:'transparent',border:'none',cursor:'pointer',textAlign:'left'}}
onMouseEnter={e=>e.currentTarget.style.background='var(--surface-2)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}
onFocus={e=>e.currentTarget.style.background='var(--surface-2)'} onBlur={e=>e.currentTarget.style.background='transparent'}>
<Ic.arrow size={15}/><span className="grow">Sign out</span></button></div>}
</div></div></header>};

const Stub=({title,sub})=>(<Wrap max={900}><PageHead eyebrow="Coming into view" title={title} sub={sub}/>
<div className="card" style={{padding:'54px 30px',textAlign:'center'}}>
<div className="tile" style={{margin:'0 auto 14px',width:44,height:44,borderRadius:15,background:'var(--violet-tint)',color:'var(--violet)'}}><Ic.spark size={22}/></div>
<div style={{fontWeight:600,fontSize:15}}>Not part of this pass</div>
<div className="sub" style={{maxWidth:380,margin:'6px auto 0'}}>Command Center, Paige, Clients, Growth, and Analytics are designed. Say the word and this one is next.</div></div></Wrap>);

const SoloAppContent=()=>{
// §65 R3d-i — every tab is its own deep-linkable route (/solo/{account}/{branch}).
// The screen `route` is DERIVED from the URL slug via the TIER_BRANCHES registry,
// and `go(k)` NAVIGATES rather than mutating local state (mirrors AgencyApp.tsx's
// R0-slice-2/R3c-i conversion, §18 same shell-conversion pattern, tier-parameterized).
// DUAL-MODE (§58): when mounted INLINE without a :account param (Admin.tsx's Solo
// gate, before account_number resolves), it falls back to local state so that path
// stays byte-unchanged. Solo has no act-as/children concept (unlike AgencyApp), so
// there is no sub-prefix parsing here — this is the simpler leg.
const urlParams = useParams();
const navigate = useNavigate();
const location = useLocation();
const { expandRail } = useAgentPresence();
const { resolvedTheme } = useTheme();
const urlAccount = urlParams.account || null;
const urlDriven = !!urlAccount;
const urlBranchSlug = urlDriven ? ((urlParams["*"] || "").split("/")[0] || defaultBranchSlug("solo")) : null;
const[stateRoute,setStateRoute]=React.useState('home');
const[paigeDockedTab,setPaigeDockedTab]=React.useState('chat');
const legacySettingsDestination=LEGACY_SETTINGS[urlBranchSlug]||null;
const route = urlDriven ? (legacySettingsDestination?'settings':branchBySlug("solo", urlBranchSlug)?.key ?? "home") : stateRoute;
// Real approvals count for the rail's Command Center badge (§13 — hidden when 0).
// Own instance (unique realtime topic via the hook's useId); scope:'all' matches
// the Command Center's own read so the badge and the queue agree.
const{items:railApprovals}=usePendingApprovals({scope:'all'});
// Setup renders the shell's OWN designed Setup (setup.tsx) IN-SHELL — never the
// old /admin/setup view (owner directive 2026-08-16). Every nav item drives the shell.
const go = (k) => {
  if (urlDriven) {
    const slug = branchByKey("solo", k)?.slug ?? defaultBranchSlug("solo");
    navigate(branchPath("solo", urlAccount, slug));
  } else {
    setStateRoute(k);
  }
};
// §39 (mirrors task #171/#526) — the /solo/{n} address is NOT authority (§9); RLS
// gates every read. Keep the URL honest: redirect a number that isn't the caller's
// own account to their own, and canonicalize a bare /solo/{n} -> its default branch.
// Acts ONLY once the caller's own account_number is known, so a mid-load null never
// bounces.
const { activeTenant, activeTenantId, activeUserId, isPlatformStaff } = useTenantContext();
// Setup readiness reminder (owner adjudication: Setup is NOT an access gate).
// The SHELL holds the dismissal so it survives route remounts; the reminder
// itself renders INSIDE the height-owned paige-solo column below — the shell
// stays the one viewport owner, tcs-main the one scroll owner. The dismissal
// is keyed to the tenant+user that dismissed it (Codex d4c85392 P2): a
// multi-workspace owner's dismissal in one workspace never hides another
// workspace's readiness notice after an in-place switch.
const [setupReminderDismissal, setSetupReminderDismissed] = React.useState<{ tenant: string; user: string } | null>(null);
const setupReminderDismissed =
  setupReminderDismissal !== null
  && setupReminderDismissal.tenant === activeTenantId
  && setupReminderDismissal.user === activeUserId;
// Codex ea0e7a8b P2: a platform operator acting inside a standalone tenant must
// not receive Solo-owner setup guidance — the staff guard moves WITH the
// notice. Codex 1c401d1b P2: the deep link exists ONLY for callers who can
// actually edit Setup — the server's solo_setup_access_scope() maps everyone
// but owners/admins to read_only, and the tenant-owner fact is the one the
// shell already holds server-derived (activeTenant.owner_user_id vs the
// authenticated subject). Read-only members still see the truthful readiness
// notice, without a CTA into a surface they cannot change.
const showSetupReminder =
  !isPlatformStaff
  && activeTenant?.account_number != null
  && !isSoloSetupComplete(activeTenant?.features);
// Codex 2c3a2321/dda03dcd P2s: solo_setup_access_scope() grants editing to
// owner_full (primary owner via tenants.owner_user_id, OR an active
// membership owner: is_owner / role='owner') AND to admin_operational
// (role='admin' — save_solo_business_context accepts it and the Setup UI
// enables operational editing). The CTA must appear for every non-read_only
// caller. The canonical client-callable predicate for both membership halves
// is has_tenant_role (authenticated-granted, STABLE, the §18 one home); the
// primary-owner half is the server-derived column already in context.
// Fail-closed: on RPC error the primary-owner fact stands alone.
const isPrimaryOwner =
  activeTenant?.owner_user_id != null && activeTenant.owner_user_id === activeUserId;
// Codex a1c5cfd0 P2 (kept): the probe result is TENANT+USER-KEYED so an
// account switch can never surface the previous workspace's verdict — the
// derived values are false the instant the identity changes, before any RPC
// resolves (and stay false if one hangs). INT-071 owner-label repair: the
// probe now carries the owner and admin verdicts SEPARATELY and runs
// whenever the shell has a resolved identity (the Owner/Team label needs the
// owner verdict even when Setup is complete) — still one pair of
// has_tenant_role calls per tenant+user, never per render.
const [roleProbe, setRoleProbe] = React.useState<{ tenant: string; user: string; owner: boolean; admin: boolean } | null>(null);
const isMembershipEditor =
  roleProbe !== null
  && roleProbe.tenant === activeTenantId
  && roleProbe.user === activeUserId
  && (roleProbe.owner || roleProbe.admin);
const probeTenant = activeTenantId;
const probeUser = activeUserId;
React.useEffect(() => {
  let alive = true;
  if (!probeTenant || !probeUser) {
    setRoleProbe(null);
    return () => { alive = false; };
  }
  void (async () => {
    // One probe per role: has_tenant_role answers a single _role, and the
    // owner arm already covers both membership-owner shapes.
    const [owner, admin] = await Promise.all([
      supabase.rpc("has_tenant_role", { _user_id: probeUser, _tenant_id: probeTenant, _role: "owner" }),
      supabase.rpc("has_tenant_role", { _user_id: probeUser, _tenant_id: probeTenant, _role: "admin" }),
    ]);
    if (alive) setRoleProbe({ tenant: probeTenant, user: probeUser, owner: owner.data === true, admin: admin.data === true });
  })().catch(() => { if (alive) setRoleProbe({ tenant: probeTenant, user: probeUser, owner: false, admin: false }); });
  return () => { alive = false; };
}, [probeTenant, probeUser]);
const canFinishSetup = isPrimaryOwner || isMembershipEditor;
const soloSetupHref = showSetupReminder && canFinishSetup
  ? `/solo/${activeTenant!.account_number}/settings/setup`
  : null;
const vaultAccess = useVaultAccess();
const paigeTabEpochRef=React.useRef(activeTenantId);
React.useLayoutEffect(()=>{if(paigeTabEpochRef.current===activeTenantId)return;paigeTabEpochRef.current=activeTenantId;setPaigeDockedTab('chat')},[activeTenantId]);
const urlSplat = urlParams["*"] || "";
React.useEffect(() => {
  if (!urlDriven) return;
  const own = activeTenant?.account_number;
  if (own == null) return;
  if (String(own) !== String(urlAccount)) {
    navigate(branchPath("solo", String(own), defaultBranchSlug("solo")), { replace: true });
    return;
  }
  if (!urlSplat) {
    navigate(branchPath("solo", urlAccount, defaultBranchSlug("solo")), { replace: true });
    return;
  }
  // The standalone Automations page was a fixture-backed surface: it claimed
  // active rules, run counts, success rates and repair actions that no substrate
  // ever produced. It is retired. The one real Automations home is the
  // Integrations sub-tab, so the old address redirects there rather than 404ing —
  // any bookmark a tenant already has keeps working.
  if (urlSplat.split("/")[0] === "automations") {
    navigate(`/solo/${urlAccount}/settings/integrations/automations`, { replace: true });
    return;
  }
  // Trust Compass moved into Command Center as its third sub-tab (owner-ruled 2026-09-05). The old
  // top-level address deep-links into the canonical Command Center path so existing links keep
  // working (§58) — no history entry, and no duplicate top-level surface remains.
  if (urlSplat.split("/")[0] === "trust-compass") {
    navigate(`/solo/${urlAccount}/command-center/trust-compass${location.search}`, { replace: true });
    return;
  }
  if (legacySettingsDestination) {
    navigate(`/solo/${urlAccount}/settings/${legacySettingsDestination}${location.search}`, { replace: true });
  }
}, [urlDriven, urlAccount, urlSplat, activeTenant?.account_number, legacySettingsDestination, location.search, navigate]);
const[studio,setStudio]=React.useState(false);
const studioReturnFocus=React.useRef(null);
const studioReturnOwner=React.useRef(null);
const studioFocusPending=React.useRef(false);
React.useEffect(()=>{const h=(event)=>{
  const target=event instanceof CustomEvent?event.detail?.returnFocus:null;
  const owner=target instanceof HTMLElement?target.closest('[data-tenant-shell]'):null;
  if(!(target instanceof HTMLButtonElement)||target.disabled||!target.hasAttribute('data-solo-vibe-studio-launcher')||!owner)return;
  studioReturnFocus.current=target;
  studioReturnOwner.current=owner;
  studioFocusPending.current=false;
  setStudio(true);
};window.addEventListener('paige-studio',h);return()=>window.removeEventListener('paige-studio',h)},[]);
const closeStudio=React.useCallback(()=>{studioFocusPending.current=true;setStudio(false)},[]);
React.useLayoutEffect(()=>{
  if(studio||!studioFocusPending.current)return;
  studioFocusPending.current=false;
  const target=studioReturnFocus.current;
  const owner=studioReturnOwner.current;
  studioReturnFocus.current=null;
  studioReturnOwner.current=null;
  if(route!=='growth'||!(target instanceof HTMLButtonElement)||!target.isConnected||target.disabled)return;
  if(!owner?.isConnected||target.closest('[data-tenant-shell]')!==owner||target.closest('[hidden],[aria-hidden="true"],[inert]'))return;
  target.focus({preventScroll:true});
},[route,studio]);
React.useEffect(()=>{if(route==='growth')return;setStudio(false);studioFocusPending.current=false;studioReturnFocus.current=null;studioReturnOwner.current=null},[route]);
const theme=resolvedTheme==='light'?'light':'dark';
// Owner directive (2026-08-18) — the slide-in panel pops out from THIS launcher ONLY
// (the TopBar spark / ⌘K). EVERY rail item, "Paige" included, navigates to its own URL
// and nothing more; the rail is navigation, never a panel trigger.
const openPaige=()=>expandRail();
// `paige:open` had three dispatchers in this app and NO listener, so every "Ask PAIGE"
// on Pipeline dispatched into nothing. This is that listener. It does two separable
// things and neither depends on the other: it opens the fold, and — when the event
// names one — it records which client the surface pointed PAIGE at. The scope is UI
// context only; the server re-resolves tenant, authorization and client scope on every
// request that carries it. An event that names no client clears nothing and simply
// opens the fold, which is what the two existing prompt-only dispatches expect.
React.useEffect(()=>{const h=(event:Event)=>{
  const detail=(event as CustomEvent)?.detail;
  const scope=readPaigeOpenScope(detail,activeTenantId);
  if(scope){clearPaigePublicPresenceScope();setPaigeClientScope(scope);}
  expandRail();
};window.addEventListener('paige:open',h);return()=>window.removeEventListener('paige:open',h)},[activeTenantId,expandRail]);
// An account switch invalidates a client scope outright: the client belonged to the
// account being left. `getPaigeClientScope` already refuses to hand out a scope stamped
// with another account, so this is the durable half of the same rule, not the guard.
React.useEffect(()=>{clearPaigeClientScope();clearPaigePublicPresenceScope()},[activeTenantId]);
// Surfaces that manage their own internal scroll regions and must fill the
// frame exactly. Their host is `overflow:hidden` at `height:100%`, so anything
// they render past the fold is CLIPPED and the shell's own scroll owner never
// overflows either — there is then nothing to scroll, by wheel or by key.
//
// `settings` was in this set and must not be: `.solo-settings` is a document
// flow (`min-height:100%`, no internal scroller), so under `full` its long tabs
// — Connections › Calendars most of all — were cut off at the fold with no way
// to reach the rest of the preset. Integrations only looked healthy because it
// is short enough to fit. Off this list the screen host is `overflow:auto` and
// becomes the one deliberate vertical scroll owner, which is what every other
// document-flow route in this shell already does.
const full=route==='paige'||route==='auto'||route==='cal'||route==='home'||route==='analytics'||route==='market';
const accountContext=resolveTenantAccountContext({accountName:activeTenant?.name,accountType:activeTenant?.account_type,parentTenantId:activeTenant?.parent_tenant_id});
const accountEpochKey=activeTenantId??'resolving';
const screens={home:<CommandHub accountContext={accountContext} openPaige={openPaige}/>,auto:null,clients:<SoloClientsRoute openPaige={openPaige}/>,cal:<TenantCanonicalCalendarWorkspace tier="solo" openPaige={openPaige}/>,growth:<GrowthHub/>,analytics:<Analytics2 accountContext={accountContext} accountEpoch={activeTenantId} openPaige={openPaige}/>,market:<Marketplace/>,settings:<SoloSettings openPaige={openPaige}/>};
const settingsActive=urlBranchSlug==='settings'?(urlSplat.split('/')[1]||'setup'):(legacySettingsDestination||'setup');
const contextualNavigation=route==='settings'&&urlDriven?{
  label:'Settings',
  backHref:branchPath('solo',urlAccount,'command-center'),
  backLabel:'Back to PAIGE',
  activeId:settingsActive,
  items:SOLO_SETTINGS_DESTINATIONS.filter(item=>item.key!=='vault'||canShowVaultNavigation(vaultAccess)).map(item=>({id:item.key,label:item.label,href:`/solo/${urlAccount}/settings/${item.key}${location.search}`,icon:SETTINGS_ICONS[item.key]})),
}:undefined;
// INT-071 census repair — presentation only; authorization stays in the
// owning server/RLS contracts. The shell's Owner/Team label derives from
// authoritative membership ownership (the tenant+user-keyed has_tenant_role
// 'owner' verdict), NEVER from the display-only tenants.owner_user_id
// pointer. Fails to "coach" (Team workspace) while the verdict is unresolved
// OR keyed to a previous identity, so an account switch can never show the
// prior workspace's label and a URL/account name can never manufacture the
// visible Owner claim.
const shellRole = soloShellRole(roleProbe, activeTenantId, activeUserId);
return <TenantCommandCenterShell
accountName={accountContext.accountName}
accountType={accountContext.accountType}
userRole={shellRole}
accountControls={<WorkspaceExitControl />}
contextualNavigation={contextualNavigation}
soloPaigeWorkspace={<SoloPaigeWorkspace key={accountEpochKey} full={route==='paige'} dockedTab={paigeDockedTab} onDockedTabChange={setPaigeDockedTab}/>}
paigeFull={route==='paige'}
paigeFullHref={urlDriven?`${branchPath('solo',urlAccount,'paige')}/${paigeDockedTab}`:undefined}
paigeReturnHref={urlDriven?branchPath('solo',urlAccount,'command-center'):undefined}
brandHomeHref={activeTenant?.account_number!=null?branchPath('solo',String(activeTenant.account_number),'command-center'):undefined}
onSignOut={()=>void performSignOut({redirectTo:'/'})}>
<div className="paige-solo" data-theme={theme} style={{width:'100%',maxWidth:'none',height:'100%',minWidth:0,minHeight:0,alignSelf:'stretch',display:'flex',flexDirection:'column'}}>
<SoloSetupReadinessNotice visible={showSetupReminder} setupHref={soloSetupHref} dismissed={setupReminderDismissed} onDismiss={()=>setSetupReminderDismissed(activeTenantId && activeUserId ? { tenant: activeTenantId, user: activeUserId } : null)}/>
<div style={{display:'flex',flex:1,minHeight:0,overflow:'hidden'}}>
<main key={route} data-solo-screen-host style={{flex:1,overflow:full?'hidden':'auto',minHeight:0,minWidth:0}}>{route==='paige'?null:screens[route]}</main>
{studio&&<VibeStudio onBack={closeStudio}/>}</div></div>
</TenantCommandCenterShell>};

const SoloApp=()=> (
<AgentPresenceProvider launcherEnabled={false} hasChatBody>
<VoiceDeviceProvider>
<DialPadSurface/><IncomingCallOverlay/><LiveTranscriptPanel/><SoloAppContent/>
</VoiceDeviceProvider>
</AgentPresenceProvider>
);
export default SoloApp;
