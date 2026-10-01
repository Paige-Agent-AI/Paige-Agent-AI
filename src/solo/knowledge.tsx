// @ts-nocheck
import React from "react";
import { Ic } from "./_shared";
import { useSoloKnowledge } from "./data/useSoloKnowledge";

// Honest marker for a design fixture with no live backend yet (§13).
const PreviewPill=()=>(<span className="pill pill-n" title="Sample layout — not yet wired to your live data">Preview</span>);

export const KC=[
 {id:'play',n:'Playbook & doctrine',c:'#E9A83A',docs:14,trained:'2h ago',dir:[0,.72,.28],
  items:[['Agency doctrine v4','Rewritten Aug 9 · 42 pages'],['Signature program phases','3 phases, 18 steps'],['Escalation rules','When to stop and ask you'],['Tone guardrails','Never hype, never hedge']]},
 {id:'cli',n:'Clients & threads',c:'#8A72F5',docs:31,trained:'12m ago',dir:[-.78,.14,.42],
  items:[['8 client dossiers','History, scope, sentiment'],['19 live threads','Every channel, indexed'],['Scope changes','What shifted and when'],['Portal activity','Login and task signal']]},
 {id:'off',n:'Offers & pricing',c:'#3FA6B8',docs:9,trained:'1d ago',dir:[.76,-.2,.5],
  items:[['Retainer tiers','$1,180 – $6,200'],['Rate card history','Feb 2026 change'],['Proposal templates','4 shapes'],['Win/loss notes','44% at proposal']]},
 {id:'vault',n:'Compliance & vault',c:'#E88A80',docs:12,trained:'6h ago',dir:[-.34,-.7,.4],
  items:[['Insurance & policies','Renews in 7 days'],['Entity filings','DE LLC, USPTO §8'],['Tax calendar','Q3 1040-ES'],['Contracts','8 signed, 2 pending']]},
 {id:'brand',n:'Brand & voice',c:'#F2C97A',docs:7,trained:'3d ago',dir:[.22,.34,-.86],
  items:[['Voice rules','Plain, direct, no hype'],['Palette & type','Geist, gold, violet'],['Asset library','Logos, frames, deck'],['Top performers','Teardown format, 3.1x']]},
 {id:'sys',n:'Systems & data',c:'#4CC48C',docs:17,trained:'14m ago',dir:[-.2,-.3,-.9],
  items:[['30-check catalog','16 running live'],['Stripe & GA4 schema','Field-level map'],['Fix history','23 applied in 30 days'],['Failure patterns','What breaks on publish']]}];

const BrainCanvas=({sel,setSel,onHoverLabel})=>{
const ref=React.useRef(null),wrap=React.useRef(null),st=React.useRef({});
React.useEffect(()=>{
const cv=ref.current,ctx=cv.getContext('2d');
let rng=(s=>()=>((s=s*16807%2147483647)/2147483647))(9161);
const inShape=(x,y,z)=>{const lobe=(cx)=>{const dx=(x-cx)/.62,dy=y/.78,dz=z/.92;return dx*dx+dy*dy+dz*dz};
 const a=Math.min(lobe(-.42),lobe(.42));const cb=((x)/.5)**2+((y+.72)/.3)**2+((z+.35)/.42)**2;
 return a<1||cb<1?Math.min(a,cb):null};
const nodes=[];
while(nodes.length<300){const x=rng()*2.6-1.3,y=rng()*2.2-1.1,z=rng()*2.2-1.1;const v=inShape(x,y,z);
 if(v===null)continue;if(v<.42&&rng()>.22)continue;
 let best=0,bd=-9;KC.forEach((k,i)=>{const d=(x*k.dir[0]+y*k.dir[1]+z*k.dir[2])/Math.hypot(x,y,z);if(d>bd){bd=d;best=i}});
 nodes.push({x,y,z,k:best,r:rng()*1.5+1.1,ph:rng()*Math.PI*2,sx:0,sy:0,sc:1,dep:0})}
const edges=[];
for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];
 const d=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);const same=a.k===b.k;
 if(d<(same?.34:.2)&&rng()<(same?.5:.16))edges.push([i,j])}
const pulses=[];
const s={yaw:.5,pitch:-.16,vyaw:.0016,zoom:1,mx:-999,my:-999,drag:null,hot:-1,t:0};st.current=s;
let raf,W=0,H=0,dpr=Math.min(devicePixelRatio||1,2);
const size=()=>{const r=wrap.current.getBoundingClientRect();W=r.width;H=r.height;
 cv.width=W*dpr;cv.height=H*dpr;cv.style.width=W+'px';cv.style.height=H+'px';ctx.setTransform(dpr,0,0,dpr,0,0)};
const ro=new ResizeObserver(size);ro.observe(wrap.current);size();
const hexA=(h,a)=>{const n=parseInt(h.slice(1),16);return 'rgba('+(n>>16)+','+((n>>8)&255)+','+(n&255)+','+a+')'};
const draw=()=>{s.t+=1;
 if(!s.drag)s.yaw+=s.vyaw;
 const cx=W/2,cy=H/2,f=3.1,scale=Math.min(W,H)*.36*s.zoom;
 const cy1=Math.cos(s.yaw),sy1=Math.sin(s.yaw),cp=Math.cos(s.pitch),sp=Math.sin(s.pitch);
 for(const n of nodes){let x=n.x*cy1+n.z*sy1,z=-n.x*sy1+n.z*cy1,y=n.y*cp-z*sp;z=n.y*sp+z*cp;
  const p=f/(f-z);n.dep=(z+1.4)/2.8;n.sc=p;
  let px=cx+x*scale*p,py=cy+y*scale*p;
  const dx=px-s.mx,dy=py-s.my,dd=Math.hypot(dx,dy);
  if(dd<150){const k=(1-dd/150)**2*26;px+=dx/(dd||1)*k;py+=dy/(dd||1)*k}
  n.sx=px;n.sy=py}
 let hot=-1,hd=30;
 for(let i=0;i<nodes.length;i++){const d=Math.hypot(nodes[i].sx-s.mx,nodes[i].sy-s.my);if(d<hd){hd=d;hot=i}}
 s.hot=hot;
 ctx.clearRect(0,0,W,H);
 const g=ctx.createRadialGradient(cx,cy*.9,10,cx,cy,Math.max(W,H)*.7);
 g.addColorStop(0,'#1C1846');g.addColorStop(.5,'#100D28');g.addColorStop(1,'#070613');
 ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
 ctx.globalCompositeOperation='lighter';
 for(const[i,j]of edges){const a=nodes[i],b=nodes[j];const dep=(a.dep+b.dep)/2;
  const act=sel==null||sel===a.k||sel===b.k;const hov=hot>=0&&(nodes[hot].k===a.k);
  let al=(.05+dep*.16)*(act?1:.18)*(hov&&nodes[hot].k===a.k?1.9:1);
  ctx.strokeStyle=hexA(KC[a.k].c,al);ctx.lineWidth=.6;
  ctx.beginPath();ctx.moveTo(a.sx,a.sy);ctx.lineTo(b.sx,b.sy);ctx.stroke()}
 if(s.t%9===0&&pulses.length<26){const e=edges[(Math.random()*edges.length)|0];if(e)pulses.push({e,t:0,v:.012+Math.random()*.018})}
 for(let p=pulses.length-1;p>=0;p--){const q=pulses[p];q.t+=q.v;if(q.t>1){pulses.splice(p,1);continue}
  const a=nodes[q.e[0]],b=nodes[q.e[1]];const act=sel==null||sel===a.k;
  const x=a.sx+(b.sx-a.sx)*q.t,y=a.sy+(b.sy-a.sy)*q.t;
  ctx.fillStyle=hexA(KC[a.k].c,(.85*(1-Math.abs(q.t-.5)*1.1))*(act?1:.15));
  ctx.beginPath();ctx.arc(x,y,1.9,0,6.283);ctx.fill()}
 for(let i=0;i<nodes.length;i++){const n=nodes[i];const k=KC[n.k];
  const act=sel==null||sel===n.k;const isHot=i===hot||(hot>=0&&nodes[hot].k===n.k);
  const pu=.72+Math.sin(s.t*.03+n.ph)*.28;
  const r=n.r*n.sc*(isHot?1.5:1)*(act?1:.7);
  const al=(.25+n.dep*.6)*pu*(act?1:.14)*(i===hot?1.6:1);
  ctx.fillStyle=hexA(k.c,Math.min(al,1));
  ctx.beginPath();ctx.arc(n.sx,n.sy,r,0,6.283);ctx.fill();
  if(n.dep>.72&&act){ctx.fillStyle=hexA(k.c,.05*pu);ctx.beginPath();ctx.arc(n.sx,n.sy,r*4.5,0,6.283);ctx.fill()}}
 ctx.globalCompositeOperation='source-over';
 KC.forEach((k,i)=>{const ns=nodes.filter(n=>n.k===i);if(!ns.length)return;
  const mx=ns.reduce((a,n)=>a+n.sx,0)/ns.length,my=ns.reduce((a,n)=>a+n.sy,0)/ns.length;
  const md=ns.reduce((a,n)=>a+n.dep,0)/ns.length;
  const on=sel===i||(hot>=0&&nodes[hot].k===i);
  if(sel!=null&&sel!==i)return;
  ctx.globalAlpha=on?1:.34+md*.3;
  ctx.strokeStyle=hexA(k.c,.5);ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(mx,my);ctx.lineTo(mx+16,my-16);ctx.lineTo(mx+30,my-16);ctx.stroke();
  ctx.fillStyle=k.c;ctx.beginPath();ctx.arc(mx,my,2.4,0,6.283);ctx.fill();
  ctx.font='600 11.5px Geist, sans-serif';ctx.fillStyle='rgba(255,255,255,'+(on?.98:.72)+')';
  ctx.fillText(k.n,mx+35,my-12);
  ctx.font='500 10px Geist Mono, monospace';ctx.fillStyle=hexA(k.c,.85);
  ctx.fillText(k.docs+' docs · trained '+k.trained,mx+35,my+1);
  ctx.globalAlpha=1});
 onHoverLabel(hot>=0?{n:KC[nodes[hot].k].n,c:KC[nodes[hot].k].c,x:nodes[hot].sx,y:nodes[hot].sy,k:nodes[hot].k}:null);
 raf=requestAnimationFrame(draw)};
raf=requestAnimationFrame(draw);
const rect=()=>cv.getBoundingClientRect();
const mv=e=>{const r=rect();s.mx=e.clientX-r.left;s.my=e.clientY-r.top;
 if(s.drag){s.yaw+=(s.mx-s.drag.x)*.006;s.pitch=Math.max(-1.1,Math.min(1.1,s.pitch+(s.my-s.drag.y)*.005));s.drag={x:s.mx,y:s.my}}};
const dn=e=>{const r=rect();s.drag={x:e.clientX-r.left,y:e.clientY-r.top};s.moved=false;cv.style.cursor='grabbing'};
const up=()=>{s.drag=null;cv.style.cursor='grab'};
const lv=()=>{s.mx=-999;s.my=-999;s.drag=null};
const cl=()=>{if(s.hot>=0)setSel(p=>p===nodes[s.hot].k?null:nodes[s.hot].k);else setSel(null)};
const wh=e=>{e.preventDefault();s.zoom=Math.max(.7,Math.min(2.1,s.zoom*(e.deltaY>0?.94:1.06)))};
cv.addEventListener('mousemove',mv);cv.addEventListener('mousedown',dn);window.addEventListener('mouseup',up);
cv.addEventListener('mouseleave',lv);cv.addEventListener('click',cl);cv.addEventListener('wheel',wh,{passive:false});
return()=>{cancelAnimationFrame(raf);ro.disconnect();cv.removeEventListener('mousemove',mv);cv.removeEventListener('mousedown',dn);
 window.removeEventListener('mouseup',up);cv.removeEventListener('mouseleave',lv);cv.removeEventListener('click',cl);cv.removeEventListener('wheel',wh)}},[sel]);
return <div ref={wrap} style={{position:'absolute',inset:0}}><canvas ref={ref} style={{display:'block',cursor:'grab'}}/></div>};

export const Knowledge=()=>{
const kb=useSoloKnowledge();
const[sel,setSel]=React.useState(null);
const[hov,setHov]=React.useState(null);
const hovRef=React.useRef(null);
const onHoverLabel=React.useCallback(h=>{const a=hovRef.current,b=h;
 if((a&&a.k)!==(b&&b.k)){hovRef.current=b;setHov(b)}else if(b&&a){hovRef.current=b}},[]);
const total=KC.reduce((s,k)=>s+k.docs,0);
const cur=sel!=null?KC[sel]:null;
return <div style={{display:'grid',gap:16}}>
<div className="two-w">
<div className="card" style={{overflow:'hidden',borderRadius:'var(--r-xl)',position:'relative',minHeight:520,background:'#0A0818',borderColor:'#241F49'}}>
<BrainCanvas sel={sel} setSel={setSel} onHoverLabel={onHoverLabel}/>
<div style={{position:'absolute',top:16,left:18,right:18,display:'flex',gap:12,justifyContent:'space-between',pointerEvents:'none'}}>
<div><div style={{fontSize:10.5,letterSpacing:'.26em',color:'rgba(255,255,255,.55)',fontWeight:600}}>WHAT PAIGE KNOWS</div>
<div style={{color:'#fff',fontSize:19,fontWeight:600,letterSpacing:'-.03em',marginTop:4}}>Knowledge graph</div>
<div style={{color:'rgba(255,255,255,.6)',fontSize:12.4,marginTop:3}}>{total} documents · {KC.length} domains · indexed continuously</div></div>
<div style={{display:'grid',gap:6,justifyItems:'end',pointerEvents:'auto'}}>
<span className="row" title="Sample graph — not yet wired to your live knowledge base" style={{gap:7,height:26,padding:'0 11px',borderRadius:99,background:'rgba(255,255,255,.08)',color:'rgba(255,255,255,.72)',fontSize:11.5,fontWeight:600}}>
<span style={{width:6,height:6,borderRadius:'50%',background:'rgba(255,255,255,.5)'}}/>Preview · sample graph</span>
<span style={{color:'rgba(255,255,255,.45)',fontSize:11}}>Drag to rotate · scroll to zoom · click a domain</span></div></div>

{hov&&<div style={{position:'absolute',left:Math.max(12,hov.x+16),top:Math.max(12,hov.y-10),pointerEvents:'none',
background:'rgba(10,8,24,.9)',border:'1px solid '+hov.c+'55',borderRadius:10,padding:'7px 11px',backdropFilter:'blur(4px)'}}>
<div className="row" style={{gap:7}}><span style={{width:7,height:7,borderRadius:'50%',background:hov.c}}/>
<span style={{color:'#fff',fontSize:12,fontWeight:600}}>{hov.n}</span></div>
<div style={{color:'rgba(255,255,255,.55)',fontSize:10.8,marginTop:2}}>{KC[hov.k].docs} documents · click to open</div></div>}

<div style={{position:'absolute',left:18,bottom:16,right:18,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
{KC.map((k,i)=><button key={k.id} onClick={()=>setSel(sel===i?null:i)} className="row" style={{gap:7,height:28,padding:'0 11px',borderRadius:99,
border:'1px solid '+(sel===i?k.c:'rgba(255,255,255,.16)'),background:sel===i?k.c+'22':'rgba(255,255,255,.05)',
color:sel===i?'#fff':'rgba(255,255,255,.72)',fontSize:11.8,fontWeight:sel===i?600:450}}>
<span style={{width:7,height:7,borderRadius:'50%',background:k.c}}/>{k.n}</button>)}
{sel!=null&&<button onClick={()=>setSel(null)} className="row" style={{gap:6,height:28,padding:'0 11px',borderRadius:99,color:'rgba(255,255,255,.6)',fontSize:11.8}}><Ic.x size={12}/>Clear</button>}</div></div>

<div style={{display:'grid',gap:16}}>
<div className="card"><div className="hd"><div><h3>{cur?cur.n:'Teach Paige something'}</h3>
<div className="sub">{cur?cur.docs+' documents · trained '+cur.trained:'Anything you drop here she reasons from immediately.'}</div></div>
{cur&&<span className="pill" style={{background:cur.c+'22',color:cur.c}}><span className="dot"/>Indexed</span>}</div>
{cur?<div>{cur.items.map(([t,d],i)=><div key={i} className="row" style={{padding:'12px 20px',borderTop:'1px solid var(--line-soft)',gap:12}}>
<span className="tile" style={{width:26,height:26,borderRadius:8,background:cur.c+'1f',color:cur.c}}><Ic.doc size={13}/></span>
<span className="grow" style={{minWidth:0}}><span className="trunc" style={{fontSize:13.2,fontWeight:500,display:'block'}}>{t}</span><span className="sub trunc" style={{display:'block'}}>{d}</span></span>
<button className="btn btn-s">Open</button></div>)}
<div style={{padding:'13px 20px',borderTop:'1px solid var(--line)',background:'var(--surface-2)',fontSize:12.8,color:'var(--ink-2)',lineHeight:1.55}}>
<span style={{fontWeight:600,color:'var(--ink)'}}>Paige: </span>{sel===0?'Your doctrine is the densest cluster in the graph — it touches every other domain, which is why her drafts sound like you.':
sel===1?'Thread history is the freshest thing I hold. It is also what makes the risk scores work.':sel===2?'Pricing is thin. Nine documents, and none of them explain why you moved rates in February.':
sel===3?'Every obligation here has a date. Two of them fall inside 30 days.':sel===4?'Voice rules are three days stale. Say the word and I will re-derive them from your last fifty sends.':
'This domain rebuilds itself from every scan. It is the only cluster that grows without you.'}</div></div>
:<div style={{padding:'18px 20px 20px',display:'grid',gap:12}}>
<div style={{border:'1.5px dashed var(--line)',borderRadius:'var(--r-l)',padding:'26px 18px',textAlign:'center'}}>
<div className="tile" style={{margin:'0 auto 10px',width:40,height:40,borderRadius:14,background:'var(--violet-tint)',color:'var(--violet)'}}><Ic.plus size={19}/></div>
<div style={{fontWeight:600,fontSize:13.6}}>Drop a document, or paste a link</div>
<div className="sub" style={{maxWidth:280,margin:'5px auto 0'}}>PDFs, transcripts, contracts, spreadsheets, a URL. She reads it, files it into a domain, and cites it back.</div>
<div className="row" style={{gap:8,justifyContent:'center',marginTop:14}}><button className="btn btn-s btn-p">Choose files</button><button className="btn btn-s">Paste a link</button></div></div>
<div className="row" style={{gap:8,flexWrap:'wrap'}}>{['Talk to her instead','Import from Drive','Connect a data source'].map(x=>
<button key={x} className="btn btn-s">{x}</button>)}</div></div>}</div>

<div className="card"><div className="hd"><h3>Recently saved</h3><span className="pill pill-v"><Ic.spark size={11}/>Knowledge</span></div>
{kb.error?<div role="status">{kb.error}<button className="btn btn-s" onClick={kb.refresh}>Reload Knowledge</button></div>:kb.loading?<div>{[0,1,2].map(i=><div key={i} className="row" style={{padding:'11px 20px',borderTop:i?'1px solid var(--line-soft)':'0',gap:11}}>
<span style={{width:7,height:7,borderRadius:'50%',background:'var(--surface-sunk)',flex:'none'}}/>
<span className="grow" style={{height:10,background:'var(--surface-sunk)',borderRadius:4}}/><span style={{width:80,height:9,background:'var(--surface-sunk)',borderRadius:4}}/></div>)}</div>
:kb.recentlyLearned.length?<div>{kb.recentlyLearned.map((d,i)=>
<div key={d.id} className="row" style={{padding:'11px 20px',borderTop:i?'1px solid var(--line-soft)':'0',gap:11}}>
<span style={{width:7,height:7,borderRadius:'50%',background:d.color,flex:'none'}}/>
<span className="grow trunc" style={{fontSize:12.9}}>{d.title}</span>{d.domain&&<span className="sub trunc" style={{maxWidth:120}}>{d.domain}</span>}<span className="mono sub" style={{fontSize:11}}>{d.when}</span></div>)}</div>
:<div style={{padding:'26px 20px',textAlign:'center'}}><div className="sub" style={{maxWidth:300,margin:'0 auto'}}>No Knowledge documents loaded.</div></div>}</div></div></div>

<div>{kb.hasMore&&<button className="btn btn-s" disabled={kb.loading} onClick={()=>void kb.loadMore()}>Load more knowledge</button>}</div>
<div className="g4">{[['Sources with recorded chunks',kb.loading?'…':kb.error?'—':String(kb.documentsIndexed),'among loaded documents; coverage unverified',false],['Citations this week','—','she shows her sources',true],['Gaps she flagged','—','what she wants taught',true],['Retrieval accuracy','—','on your own questions',true]].map(([k,v,d,pv],i)=>
<div key={i} className="card" style={{padding:'16px 18px'}}><div className="row" style={{gap:7,alignItems:'center'}}><div className="eyebrow">{k}</div>{pv&&<PreviewPill/>}</div>
<div style={{fontSize:26,fontWeight:600,letterSpacing:'-.03em',marginTop:4}}>{v}</div><div className="sub" style={{marginTop:2}}>{d}</div></div>)}</div></div>};
