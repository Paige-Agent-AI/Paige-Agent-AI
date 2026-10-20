/** DEV-ONLY native React mount. Actual E5 Panel/Entry and Calendar/Chat presentation; synthetic transport. */
import { useEffect,useState,type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter,Routes,Route,Link,useLocation,useNavigate } from 'react-router-dom';
import { ImpersonationProvider } from '@/contexts/ImpersonationContext';
import { getScopedUserId,setScopedUserId } from '@/lib/scopedUser';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { CalendarDays,PanelLeftClose,PanelLeftOpen,MessageSquare,X } from 'lucide-react';
import { WeeklyResponsibilityPanel } from '@/solo/weekly/WeeklyResponsibilityPanel';
import { WeeklyDraftPrototype } from './weekly-draft-prototype';
import { WeeklyCalendarResponsibility } from '@/solo/weekly/WeeklyCalendarResponsibility';
import { useWeeklyResponsibility } from '@/solo/weekly/useWeeklyResponsibility';
import { SoloCalendarWorkspace } from '@/components/tenant-calendar/SoloCalendarWorkspace';
import { SoloPaigeWorkspace } from '@/solo/SoloPaigeWorkspace';
import { OperationsRoute } from '@/solo/operations/OperationsRoute';
import { tenantShellDestinationsForPath } from '@/components/tenant-shell/tenantShellRoutes';
import { CommandMark } from '@/operator/shell/CommandMark';
import { scenarios,scenario,setScenario,calls,effects,TENANT,rawDto,type Scenario } from './weekly-responsibility.fixture';
import '@/index.css';
import '@/components/tenant-shell/tenant-command-center-shell.css';
import '@/components/tenant-relationships/tenant-relationships-clients-workspace.css';
import './weekly-responsibility.harness.css';
const params=new URLSearchParams(location.search),initialTheme=params.get('theme')==='light'?'light':'dark';
document.documentElement.dataset.pg=initialTheme;document.documentElement.classList.toggle('dark',initialTheme==='dark');
// All network effects are refused. Vite module/HMR loads are outside this JS fetch seam.
window.fetch=async()=>{effects.push('fetch');throw Error('Synthetic render: no network actions');};
const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
const CLIENT='90000000-0000-4000-8000-000000000005';
// Only synthetic in-memory/session fixture state; never invokes impersonation RPCs.
function persona(mode:'owner'|'effective-client'|'view-client'){
  if(mode==='view-client')sessionStorage.setItem('paige_impersonating_contact',JSON.stringify({contactId:CLIENT,targetUserId:CLIENT,targetName:'Synthetic client'}));
  else sessionStorage.removeItem('paige_impersonating_contact');
  setScopedUserId(mode==='effective-client'?CLIENT:null);
  window.dispatchEvent(new StorageEvent('storage',{key:'paige_impersonating_contact'}));
}
function Chat({full=false}:{full?:boolean}){return <SoloPaigeWorkspace full={full} dockedTab="chat"/>;}
function App(){const location=useLocation(),navigate=useNavigate();const [state,setState]=useState<Scenario>(scenario()),[theme,setTheme]=useState(initialTheme),[surface,setSurface]=useState(params.get('surface')||'panel'),[open,setOpen]=useState(params.get('paige')==='open'),[nav,setNav]=useState(innerWidth>=1440),[epoch,setEpoch]=useState(0),[personaMode,setPersonaMode]=useState<'owner'|'effective-client'|'view-client'>('owner');const {read,refresh}=useWeeklyResponsibility();
useEffect(()=>{document.documentElement.dataset.pg=theme;document.documentElement.classList.toggle('dark',theme==='dark');},[theme]);
useEffect(()=>{void refresh();},[state]);
useEffect(()=>{if(location.pathname.includes('/clients/calendar'))setSurface('calendar');else if(location.pathname.includes('/paige/chat'))setSurface(s=>s==='calendar'?'chat':s);},[location.pathname]);
const choose=(value:Scenario)=>{setScenario(value);setState(value);setEpoch(n=>n+1);window.dispatchEvent(new Event('focus'));};
const applyPersona=(mode:'owner'|'effective-client'|'view-client')=>{setPersonaMode(mode);persona(mode);};
const destinations=tenantShellDestinationsForPath('/solo/05/clients/calendar');
const overlay=innerWidth<=1080,paigeColumn=!open||overlay?'0px':'minmax(440px,34vw)';
(window as unknown as {__weeklyHarness:unknown}).__weeklyHarness={choose,state,read,rawDto,calls,effects,pathname:location.pathname,refresh,persona:applyPersona,getScopedUserId};
return <div className="weekly-harness-root"><div className="weekly-synthetic-label">SYNTHETIC LOCAL REVIEW · actual React components · no real records, authorization, execution or network actions</div><details className="weekly-review-controls"><summary>Local state and layout controls</summary><label>Record state<select id="review-state" value={state} onChange={e=>choose(e.target.value as Scenario)}>{scenarios.map(x=><option key={x}>{x}</option>)}</select></label><label>Theme<select id="review-theme" value={theme} onChange={e=>setTheme(e.target.value)}><option value="dark">Obsidian</option><option value="light">Mineral</option></select></label><label>Surface<select id="review-surface" value={surface} onChange={e=>{setSurface(e.target.value);navigate(e.target.value==='calendar'?'/solo/05/clients/calendar':'/solo/05/paige/chat');}}><option value="draft">Draft save flow</option><option value="panel">Native responsibility panel</option><option value="calendar">Native Calendar</option><option value="chat">Native Chat</option></select></label><label>Audience fixture<select id="review-persona" value={personaMode} onChange={e=>applyPersona(e.target.value as typeof personaMode)}><option value="owner">Owner</option><option value="effective-client">Effective client store</option><option value="view-client">View as Client context</option></select></label><label><input id="review-paige" type="checkbox" checked={open} onChange={e=>setOpen(e.target.checked)}/>PAIGE open</label><button onClick={()=>void refresh()}>Repeat synthetic read</button><button onClick={()=>navigate(-1)}>History Back</button><button onClick={()=>navigate(1)}>History Forward</button></details>
<div data-tenant-shell data-pg={theme} data-nav={nav?'expanded':'compact'} data-paige={open?'open':'closed'} data-solo-paige="true" className="weekly-review-shell" style={{'--tcs-paige':paigeColumn} as CSSProperties}>
<nav className="tcs-nav" aria-label="Tenant workspace"><div className="tcs-brand tcs-brand--solo"><Link className="tcs-brand-home" to="/solo/05/command-center" aria-label="PAIGE Solo home"><CommandMark state="dormant" size={26}/><span className="tcs-brand-copy"><strong>PAIGE</strong><span>Solo</span></span></Link><button className="tcs-icon-button tcs-nav-fold" aria-label={nav?'Fold navigation':'Expand navigation'} onClick={()=>setNav(!nav)}>{nav?<PanelLeftClose/>:<PanelLeftOpen/>}</button></div><div className="tcs-nav-links">{destinations.map(({id,label,href,icon:Icon})=><Link key={id} to={href} title={label} className={id==='clients'?'is-active':''}><Icon aria-hidden/><span>{label}</span><i aria-hidden/></Link>)}</div><div className="tcs-account-seal"><span>SR</span><div><strong>Synthetic review</strong><span>Solo · Owner fixture</span></div></div></nav>
<section className="tcs-canvas"><header className="tcs-command-row"><div className="tcs-context"><strong>{surface==='calendar'?'Clients / Calendar':surface==='chat'?'PAIGE':'Weekly responsibility'}</strong></div><button className="tcs-command-field" onClick={()=>setOpen(!open)} aria-expanded={open} aria-label="Direct PAIGE"><MessageSquare size={17}/><span>Direct PAIGE</span></button></header><main className="tcs-main" id="tenant-shell-main">
{location.pathname.includes('/operations/')?<OperationsRoute openPaige={()=>setOpen(true)}/>:surface==='draft'?<div className="weekly-native-panel"><WeeklyDraftPrototype/></div>:surface==='panel'?<div className="weekly-native-panel" key={epoch}><WeeklyResponsibilityPanel read={read} refresh={()=>void refresh()} pathname={location.pathname} onRequestPrepared={()=>{setSurface('chat');navigate('/solo/05/paige/chat');}}/></div>:surface==='calendar'?<div className="weekly-calendar-host"><div className="trc-canonical-mount trc-canonical-mount--direct" data-calendar-owner="clients"><WeeklyCalendarResponsibility>{slot=><SoloCalendarWorkspace activeTenantId={TENANT} connectionsHref="/solo/05/settings/connections" openPaige={()=>setOpen(true)} weeklyResponsibility={slot}/>}</WeeklyCalendarResponsibility></div></div>:<div className="weekly-chat-host"><Chat full/></div>}
</main></section>{open&&<><button className="tcs-paige-backdrop" aria-label="Close PAIGE" onClick={()=>setOpen(false)}/><aside className="tcs-paige" id="tenant-paige-workspace" data-solo-paige="true"><header className="tcs-paige-header"><CalendarDays size={18}/><div><strong>PAIGE</strong><span>Same review scope</span></div><button className="tcs-icon-button" onClick={()=>setOpen(false)} aria-label="Fold PAIGE"><X/></button></header><div className="tcs-paige-body"><Chat/></div></aside></>}
</div></div>;}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={qc}><ImpersonationProvider><MemoryRouter initialEntries={[params.get('surface')==='calendar'?'/solo/05/clients/calendar':'/solo/05/paige/chat']}><Routes><Route path="/solo/:account/*" element={<App/>}/></Routes></MemoryRouter></ImpersonationProvider></QueryClientProvider>);
