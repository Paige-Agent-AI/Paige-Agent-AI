// @ts-nocheck
import React from "react";

const I=(p,vb)=>({size=18,style,...r})=>React.createElement('svg',{width:size,height:size,viewBox:vb||'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round',style,...r},p);
export const Ic={
grid:I(<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>),
spark:I(<><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></>),
users:I(<><path d="M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19"/><circle cx="10" cy="7.5" r="3.2"/><path d="M17 11.2a3 3 0 100-6M20 19v-1.2a3.2 3.2 0 00-2.2-3"/></>),
store:I(<><path d="M4 9.5V19a1 1 0 001 1h14a1 1 0 001-1V9.5"/><path d="M3 9.5l1.6-4A1 1 0 015.5 5h13a1 1 0 01.9.5L21 9.5z"/><path d="M9 20v-5h6v5"/></>),
trend:I(<><path d="M4 16.5l4.5-5 3.5 3 6-7.5"/><path d="M14.5 7h4v4"/></>),
chart:I(<><path d="M4 20V6M9 20v-7M14 20V9M19 20v-4"/></>),
gear:I(<><circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M4.9 7.5l1.9 1.1M17.2 15.4l1.9 1.1M4.9 16.5l1.9-1.1M17.2 8.6l1.9-1.1"/></>),
vault:I(<><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="11" cy="12" r="3.2"/><path d="M11 8.8v1M11 15.2v1M17 10v4"/></>),
pulse:I(<><path d="M3 12h3.5l2-4.5 3 9 2.5-6 1.6 3H21"/></>),
check:I(<><path d="M5 12.5l4.2 4L19 7.5"/></>),
x:I(<><path d="M6 6l12 12M18 6L6 18"/></>),
arrow:I(<><path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/></>),
bell:I(<><path d="M18 15.5V11a6 6 0 10-12 0v4.5L4.5 18h15z"/><path d="M10 21h4"/></>),
moon:I(<><path d="M20 14.5A8.2 8.2 0 019.5 4 8.5 8.5 0 1020 14.5z"/></>),
sun:I(<><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/></>),
search:I(<><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></>),
mail:I(<><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 7.5l7.3 5.2a1.2 1.2 0 001.4 0L20 7.5"/></>),
chev:I(<><path d="M9 6l6 6-6 6"/></>),
dots:I(<><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/></>),
send:I(<><path d="M4.5 12l15-7-7 15-1.8-6.2z"/></>),
doc:I(<><path d="M14 3.5H7A1.5 1.5 0 005.5 5v14A1.5 1.5 0 007 20.5h10a1.5 1.5 0 001.5-1.5V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/></>),
clock:I(<><circle cx="12" cy="12" r="8"/><path d="M12 8v4.3l3 1.8"/></>),
shield:I(<><path d="M12 3.5l7 2.5v5.5c0 4.3-3 7.4-7 9-4-1.6-7-4.7-7-9V6z"/><path d="M9 12l2.2 2.2L15.5 10"/></>),
bolt:I(<><path d="M13.5 3L6 13.5h4.5L10 21l7.5-10.5H13z"/></>),
filter:I(<><path d="M4 6.5h16M7 12h10M10 17.5h4"/></>),
cal:I(<><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/><circle cx="8.5" cy="14" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r="1.1" fill="currentColor" stroke="none"/></>),
plus:I(<><path d="M12 5.5v13M5.5 12h13"/></>),
};
export const Logo=({size=26})=>(<svg width={size} height={size} viewBox="0 0 48 48" fill="none"><polygon points="21,13.6 30.5,13.6 21,34.4 11.5,34.4" fill="var(--gold-bright)" stroke="var(--gold-bright)" strokeWidth="3.2" strokeLinejoin="round"/><circle cx="34.5" cy="30.5" r="5.5" fill="var(--gold-bright)"/></svg>);
export const Avatar=({name,size=28,tone})=>{const init=name.split(' ').map(w=>w[0]).slice(0,2).join('');const tones=['var(--violet)','var(--gold)','#2E7D8F','#8A5A9E','#3F7A4B'];const c=tone||tones[name.charCodeAt(0)%5];
return <div style={{width:size,height:size,borderRadius:'50%',background:c,color:'#fff',display:'grid',placeItems:'center',fontSize:size*.36,fontWeight:600,flex:'none',letterSpacing:'.02em'}}>{init}</div>};

export const Foldout=({open,onClose,title,sub,wide,children})=>{
React.useEffect(()=>{if(!open)return;const k=e=>e.key==='Escape'&&onClose();window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[open,onClose]);
if(!open)return null;
return <><div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(23,19,49,.42)',backdropFilter:'blur(4px)',zIndex:88}}/>
<div className="fade-in card" style={{position:'fixed',inset:0,margin:'auto',
width:wide?'min(1080px,94vw)':'min(720px,94vw)',height:'max-content',maxHeight:'88vh',display:'flex',flexDirection:'column',zIndex:89,borderRadius:'var(--r-xl)',boxShadow:'var(--sh-3)',overflow:'hidden'}}>
<div className="hd" style={{flex:'none'}}><div style={{minWidth:0}}><h3>{title}</h3>{sub&&<div className="sub">{sub}</div>}</div>
<button className="btn btn-s" onClick={onClose} style={{width:28,height:28,padding:0,justifyContent:'center',borderRadius:'50%'}}><Ic.x size={13}/></button></div>
<div className="pane" style={{flex:1}}>{children}</div></div></>};

export const ExpandBtn=({onClick,label='Expand'})=>(<button onClick={e=>{e.stopPropagation();onClick()}} title={label} className="row"
style={{gap:6,height:26,padding:'0 10px',borderRadius:99,border:'1px solid var(--line)',fontSize:11.6,fontWeight:500,color:'var(--ink-2)'}}>
<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
<path d="M9 4H4v5M15 20h5v-5M20 9V4h-5M4 15v5h5"/></svg>{label}</button>);

export const PeekCard=({title,sub,right,peek,children,wide,foldTitle})=>{const[open,setOpen]=React.useState(false);
return <><div className="card" style={{display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}}>
<div className="hd" style={{flex:'none',padding:'10px 14px'}}><div style={{minWidth:0}}><h3 style={{fontSize:13.4}}>{title}</h3>{sub&&<div className="sub trunc">{sub}</div>}</div>
<div className="row" style={{gap:8,flex:'none'}}>{right}<ExpandBtn onClick={()=>setOpen(true)}/></div></div>
<div className="pane" style={{flex:1}}>{peek||children}</div></div>
<Foldout open={open} onClose={()=>setOpen(false)} title={foldTitle||title} sub={sub} wide={wide}>{children}</Foldout></>};

export const Collapse=({title,sub,icon,badge,children,defaultOpen})=>{const[o,setO]=React.useState(!!defaultOpen);
return <div className="card" style={{overflow:'hidden'}}>
<button onClick={()=>setO(!o)} className="row" style={{width:'100%',textAlign:'left',gap:12,padding:'12px 18px'}}>
{icon&&<span className="tile" style={{width:30,height:30,borderRadius:10,background:'var(--violet-tint)',color:'var(--violet)'}}>{icon}</span>}
<span className="grow" style={{minWidth:0}}><span style={{fontWeight:600,fontSize:13.4,display:'block'}}>{title}</span>
{sub&&<span className="sub trunc" style={{display:'block'}}>{sub}</span>}</span>
{badge}<span style={{display:'flex',color:'var(--ink-3)',transform:o?'rotate(90deg)':'',transition:'.2s'}}><Ic.chev size={15}/></span></button>
{o&&<div className="fade-in" style={{borderTop:'1px solid var(--line-soft)'}}>{children}</div>}</div>};

export const PageHead=({eyebrow,title,sub,right})=>(<div className="pg-hd row" style={{alignItems:'center',gap:16,flexWrap:'wrap'}}>
<div className="grow" style={{minWidth:220}}>
<div className="row" style={{gap:10,alignItems:'baseline',flexWrap:'wrap'}}>
{eyebrow&&<span className="eyebrow" style={{fontSize:10}}>{eyebrow}</span>}
<h1 style={{fontSize:20,letterSpacing:'-.03em'}}>{title}</h1></div>
{sub&&<p className="pg-sub" style={{color:'var(--ink-2)',fontSize:12.8,marginTop:3,maxWidth:760}}>{sub}</p>}</div>{right}</div>);
export const Wrap=({children,max=1440})=>{const ar=React.Children.toArray(children);
const hd=ar.length&&ar[0]&&ar[0].type===PageHead?ar[0]:null;
return <div className="fade-in pg" style={{width:'100%',maxWidth:max,margin:'0 auto'}}>{hd}
<div className="pg-body">{hd?ar.slice(1):ar}</div></div>};

export const SubTabs=({tabs,cur,set,under,right})=>(<div className="row" style={{gap:0,borderBottom:under?'0':'1px solid var(--line)',background:under?'transparent':'var(--surface)',padding:under?'0':'0 22px',flex:'none',minWidth:0}}>
<div className="row tabstrip" style={{gap:under?4:20,minWidth:0,flex:'1 1 auto'}}>
{tabs.map(t=>{const on=cur===t[0];
return <button key={t[0]} onClick={()=>set(t[0])} className="row" style={{gap:7,padding:under?'6px 12px':'12px 0 11px',borderRadius:under?9:0,fontSize:13.2,fontWeight:on?600:450,
color:on?'var(--ink)':'var(--ink-3)',background:under&&on?'var(--surface-sunk)':'transparent',borderBottom:!under&&on?'2px solid var(--gold)':'2px solid transparent',marginBottom:under?0:-1}}>
{t[2]&&<span style={{display:'flex',color:on?'var(--gold)':'inherit'}}>{t[2]()}</span>}{t[1]}
{t[3]&&<span className="pill pill-warn" style={{height:18,padding:'0 6px'}}>{t[3]}</span>}</button>})}</div>
{right&&<div className="row" style={{gap:8,flex:'none',paddingLeft:14}}>{right}</div>}</div>);

export const DATA={
approvals:[
 {id:'a1',dept:'Client Success',title:'Renewal note to Harper & Vale',why:'Retainer renews in 21 days. Usage up 34% this quarter.',preview:"Hi Dana — before we roll into Q4 I wanted to flag how much ground the team covered: 34% more briefs shipped than last quarter, and your inbound reply rate is up to 18%. I've put together the renewal at the same rate with two extra strategy sessions folded in…",conf:94,type:'Email draft',urgency:'today',aging:'2h'},
 {id:'a2',dept:'Growth',title:'Reprice mid-tier package — competitor moved',why:'Coach Sarah dropped her mid-tier to $890. You sit at $1,150.',preview:'Recommendation: hold price, reframe the tier. Draft positioning copy emphasizes the included Systems Check, which she does not offer. Wednesday email ready.',conf:81,type:'Decision',urgency:'today',aging:'5h'},
 {id:'a3',dept:'Finance',title:'Chase 3 failed charges ($4,180)',why:'Stripe webhook flagged 3 declines in the last 48 hours.',preview:'Three cards declined: Ridgeline Co. ($2,400), Mercer Studio ($1,180), Okonkwo Group ($600). Dunning sequence drafted, softest tone first, escalating over 9 days.',conf:97,type:'Sequence',urgency:'today',aging:'11h'},
 {id:'a4',dept:'Marketing',title:'October content calendar (12 pieces)',why:'Last month\'s top performer was the teardown format, 3.1x engagement.',preview:'Eight teardowns, two client stories, two POV essays. Each has a hook, outline, and channel plan. Nothing publishes without your yes.',conf:76,type:'Plan',urgency:'week',aging:'1d'},
 {id:'a5',dept:'Operations',title:'Onboard Northwind Partners',why:'Contract signed Tuesday. Kickoff window closes Friday.',preview:'Workspace provisioned, intake form sent, kickoff invite drafted for Thursday 10am, first 30-day plan generated from the Consulting Playbook.',conf:90,type:'Workflow',urgency:'week',aging:'1d'},
 {id:'a6',dept:'Client Success',title:'Re-engage Selby Group before it slips',why:'No reply in 19 days. Two skipped calls. Risk score 74.',preview:"Short, low-pressure check-in that names the gap without guilt and offers two concrete next steps — a 15-minute reset call or an async update.",conf:88,type:'Email draft',urgency:'week',aging:'2d'}
],
systems:[
 {name:'Deliverability',state:'ok',detail:'SPF, DKIM & DMARC pass on 3 domains',metric:'98.2% inbox'},
 {name:'Infrastructure',state:'ok',detail:'Uptime 99.98%, LCP 1.4s',metric:'30/30 checks'},
 {name:'Marketing & tracking',state:'warn',detail:'Meta Pixel not firing on /book-a-call',metric:'2 issues'},
 {name:'Forms & booking',state:'ok',detail:'6 lead forms tested, all delivering',metric:'62% show rate'},
 {name:'Payments',state:'bad',detail:'3 failed charges, webhook retry queued',metric:'$4,180 at risk'},
 {name:'Data quality',state:'warn',detail:'11 clients missing portal access',metric:'94% complete'}
],
vault:[
 {name:'General liability policy',org:'Hartwell Mutual',days:7,amount:'$2,340/yr',state:'bad',action:'Renewal drafted'},
 {name:'Delaware LLC annual report',org:'State filing',days:24,amount:'$300',state:'warn',action:'Form pre-filled'},
 {name:'Q3 estimated tax',org:'IRS 1040-ES',days:31,amount:'$18,400 est.',state:'warn',action:'Worksheet ready'},
 {name:'paigeagent.ai domain',org:'Cloudflare',days:58,amount:'$42/yr',state:'ok',action:'Auto-renew on'},
 {name:'Trademark maintenance',org:'USPTO §8 decl.',days:112,amount:'$525',state:'ok',action:'Reminder filed'}
],
team:[
 {who:'Jordan Avery',role:'You',act:'approved Paige\'s renewal note to Bellweather',t:'12m ago',kind:'approve'},
 {who:'Paige',role:'Growth agent',act:'drafted 4 follow-ups after the Ridgeline call',t:'38m ago',kind:'paige'},
 {who:'Jordan Avery',role:'You',act:'edited the October calendar before sending it back to Paige',t:'1h ago',kind:'edit'},
 {who:'Paige',role:'Systems agent',act:'caught the Meta Pixel drop on /book-a-call',t:'2h ago',kind:'paige'},
 {who:'Jordan Avery',role:'You',act:'raised Finance autonomy to Act with notice',t:'3h ago',kind:'setting'},
 {who:'Paige',role:'Client success agent',act:'closed 6 conversations in Selby Group\'s thread after your replies',t:'4h ago',kind:'paige'}
],
checklist:[
 {t:'Activate your Paige email',d:'Confirm your sending address, then email a client from Conversations in minutes.',done:true,cta:'Open'},
 {t:'Add and message your first client',d:'Create the client inside Conversations and keep every reply in one thread.',done:true,cta:'Open'},
 {t:'Meet Paige & shape your Playbook',d:'Teach her your voice, your questions, and how you run the practice.',done:false,cta:'Open Your Paige'},
 {t:'Connect your data sources',d:'Stripe, GA4, and your calendar — Systems Check gets sharper with each one.',done:false,cta:'Connect'},
 {t:'Set your autonomy',d:'Tell Paige how far to go on her own, department by department.',done:false,cta:'Set it'}
],
depts:[
 {name:'Client Success',level:2},{name:'Growth',level:1},{name:'Marketing',level:2},
 {name:'Finance',level:2},{name:'Operations',level:3},{name:'Systems',level:3}
],
clients:[
 {name:'Harper & Vale',owner:'Jordan Avery',tier:'Retainer',mrr:4800,health:92,risk:'Healthy',last:'2h ago',stage:'Delivery',open:3},
 {name:'Ridgeline Co.',owner:'Jordan Avery',tier:'Retainer',mrr:2400,health:61,risk:'Watch',last:'1d ago',stage:'Delivery',open:5},
 {name:'Selby Group',owner:'Jordan Avery',tier:'Project',mrr:1900,health:38,risk:'At risk',last:'19d ago',stage:'Delivery',open:1},
 {name:'Northwind Partners',owner:'Jordan Avery',tier:'Retainer',mrr:6200,health:80,risk:'Healthy',last:'4h ago',stage:'Onboarding',open:7},
 {name:'Mercer Studio',owner:'Jordan Avery',tier:'Retainer',mrr:1180,health:55,risk:'Watch',last:'3d ago',stage:'Delivery',open:2},
 {name:'Okonkwo Group',owner:'Jordan Avery',tier:'Advisory',mrr:600,health:71,risk:'Healthy',last:'6h ago',stage:'Delivery',open:0},
 {name:'Bellweather Co.',owner:'Jordan Avery',tier:'Retainer',mrr:3400,health:88,risk:'Healthy',last:'1h ago',stage:'Renewal',open:4},
 {name:'Cairn Advisory',owner:'Jordan Avery',tier:'Project',mrr:2750,health:74,risk:'Healthy',last:'2d ago',stage:'Delivery',open:1}
],
pipeline:[
 {stage:'New lead',deals:[{n:'Lumen Health',v:3200,src:'Referral',age:'2d'},{n:'Fairgrove Coaching',v:1400,src:'Website',age:'1d'},{n:'Atlas Reps',v:2600,src:'Webinar',age:'4d'}]},
 {stage:'Discovery',deals:[{n:'Perrin & Co.',v:5400,src:'Referral',age:'6d'},{n:'Hale Studio',v:1900,src:'LinkedIn',age:'9d'}]},
 {stage:'Proposal',deals:[{n:'Verity Partners',v:8800,src:'Referral',age:'3d'},{n:'Grantham Group',v:4200,src:'Website',age:'11d'}]},
 {stage:'Closing',deals:[{n:'Northwind Partners',v:6200,src:'Referral',age:'1d'}]}
],
campaigns:[
 {n:'Teardown series — Q3',ch:'Email + LinkedIn',sent:2840,open:41,rep:9.2,state:'Live'},
 {n:'Systems Check offer',ch:'Meta ads',sent:18400,open:2.9,rep:1.4,state:'Live'},
 {n:'Client story: Harper & Vale',ch:'Email',sent:1210,open:52,rep:14.1,state:'Draft'},
 {n:'Dormant list revival',ch:'Email',sent:4600,open:22,rep:3.8,state:'Paused'}
],
// §13 TRUTH WAVE (owner ruling 2026-08-18) — `metrics` and `convo` DELETED here.
//
// `metrics` was the fabricated "$23,230 MRR / 112% NRR / 147 hours saved / 89%
// approval rate" strip, complete with invented 12-point sparklines. Its ONLY consumer
// was the dead `Analytics` export in `screens.tsx` (deleted in the same commit), so
// nothing rendered it — but it was the source the owner flagged, and a fixture nobody
// reads is still a fixture waiting to be wired up by mistake.
//
// `convo` was a scripted Paige conversation ("three failed charges worth $4,180",
// "Selby Group has gone quiet for 19 days") with ZERO consumers anywhere.
//
// NOT deleted here — `pipeline` and `campaigns` are equally fabricated but the LIVE
// `growth2.tsx` still renders them, so removing them now would blank a mounted screen
// with no replacement. They get their own slice of this wave.
};

// Shared primitives consumed pack-wide via `from "./_shared"` (team, team-dir,
// market, automations all import these). Relocated here to their intended one
// home — the definitions are the exact ported markup, moved not rewritten.
export const Meter=({pct,tone,h=6})=>(<div style={{height:h,borderRadius:h/2,background:'var(--surface-sunk)',overflow:'hidden'}}>
<div style={{width:Math.min(pct,100)+'%',height:'100%',background:tone,borderRadius:h/2,transition:'width .5s var(--ease,ease)'}}/></div>);

export const SlideOut=({open,onClose,title,sub,icon,tone,children,foot,wide})=>{
React.useEffect(()=>{if(!open)return;const k=e=>e.key==='Escape'&&onClose();window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k)},[open,onClose]);
if(!open)return null;
return <><div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(23,19,49,.36)',backdropFilter:'blur(3px)',zIndex:80}}/>
<aside className="fade-in" style={{position:'fixed',top:0,right:0,bottom:0,width:wide?'min(640px,96vw)':'min(520px,96vw)',
background:'var(--surface)',borderLeft:'1px solid var(--line)',boxShadow:'var(--sh-3)',zIndex:81,display:'flex',flexDirection:'column'}}>
<div className="row" style={{padding:'15px 20px',borderBottom:'1px solid var(--line)',gap:12,flex:'none'}}>
{icon&&<span className="tile" style={{width:32,height:32,borderRadius:10,background:tone||'var(--violet-tint)',color:tone?'var(--ink)':'var(--violet)',flex:'none'}}>{icon}</span>}
<div className="grow" style={{minWidth:0}}><div className="trunc" style={{fontWeight:600,fontSize:14.5}}>{title}</div>{sub&&<div className="sub trunc">{sub}</div>}</div>
<button className="btn btn-s" onClick={onClose} style={{width:30,height:30,padding:0,justifyContent:'center',borderRadius:'50%'}}><Ic.x size={14}/></button></div>
<div className="pane" style={{flex:1,padding:'18px 20px 24px'}}>{children}</div>
{foot&&<div className="row" style={{padding:'12px 20px',borderTop:'1px solid var(--line)',gap:9,flex:'none',flexWrap:'wrap'}}>{foot}</div>}</aside></>};
