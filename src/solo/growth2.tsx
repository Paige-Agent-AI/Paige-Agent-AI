// @ts-nocheck
import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useSubtabRoute } from "@/lib/routing/useSubtabRoute";
import { branchPath, subtabPath } from "@/lib/routing/tierBranches";
import { Ic, PageHead } from "./_shared";
import { useSoloCampaigns } from "./useSoloCampaigns";
import { CatalogOffers } from "./catalog-offers";
import { SalesOps } from "./sales-ops";
import { SocialCommand } from "./social-command";
import { PipelineDelete } from "./PipelineDelete";
import { PipelineCommandDesk } from "./PipelineCommandDesk";
import CampaignOverview from "./campaign-desk";
import { FormIntakePanel } from "./form-intake";
import "./solo-campaigns.css";

// RETIRED 2026-09-12: the GR projects fixture served only the pre-rebuild Vibe
// Studio overlay. The canonical surface (src/solo/vibe.tsx) now renders real
// governed media jobs, so the fixture data is deleted; the export stays as an
// empty typed shell for any external import until a later cleanup removes it.
export const GR={projects:[] as Array<{n:string;type:string;edited:string;state:string}>};

const TRUTH = {
  overview: ["UNAVAILABLE", "A tenant-authorized all-state campaign rollup is not yet available."],
  catalog: ["PARTIAL", "Published pages, funnels, forms, and captured submissions come from tenant-scoped records."],
  offers: ["PARTIAL", "Offers are read from this workspace’s own product records. Defining and editing them arrives on this screen next; nothing here is a checkout."],
  sales: ["PARTIAL", "Offers, declared payment handling and recorded payments are read from this workspace’s own records. Commercial terms record the arrangement with a client; they are not signed documents. No order names a campaign, so revenue is never attributed to one."],
  pipeline: ["PROPOSED", "Only explicit form routing configuration and recorded outcomes are shown."],
  social: ["PARTIAL", "The accounts this workspace has recorded that it posts from, and its published Vibe Studio outputs, are read from tenant-scoped records. A customer-facing social provider connection is still not ready, so no follower, reach, publishing queue, schedule, or placement figure is available."],
  performance: ["PROPOSED", "Source coverage is visible; cross-source campaign analytics are not yet canonical."],
};

const LEGACY = {
  "brand-kit": { label: "Brand Kit", note: "Brand identity and reusable creative now belong in Vibe Studio." },
  pages: { label: "Pages", note: "Pages are created, edited, and published in Vibe Studio. Published pages appear in Catalog." },
  funnels: { label: "Funnels", note: "Funnels and their pages, forms, and video are managed in Vibe Studio. Published funnels appear in Catalog." },
  forms: { label: "Forms", note: "Forms are managed in Vibe Studio. Campaigns reports submissions and routing outcomes only when recorded." },
  builders: { label: "Builders", note: "Creative tools and builder connections are managed outside Campaigns. Vibe Studio is the creative owner." },
};

const openStudio=(event)=>window.dispatchEvent(new CustomEvent('paige-studio',{detail:{returnFocus:event.currentTarget}}));
let pendingCampaignTabFocus=null;

function formatDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/* The four capability states, said the way a business owner would say them rather than the way a
 * release record does. Owner ruling 2026-09-23 took LIVE / PARTIAL / PROPOSED / UNAVAILABLE off the
 * tenant surface entirely; the underlying statement is honest and stays, because Performance
 * coverage exists precisely to say what can and cannot be reported (§13/§58). Only the words move. */
const PLAIN_STATE = {
  LIVE: "Available",
  PARTIAL: "Partly available",
  PROPOSED: "Planned",
  UNAVAILABLE: "Not available",
};

function TruthTag({ state }) {
  const key = state || "UNAVAILABLE";
  return <span className={`campaigns-truth campaigns-truth--${key.toLowerCase()}`}>{PLAIN_STATE[key] || PLAIN_STATE.UNAVAILABLE}</span>;
}

function StateFrame({ phase, retry, noun, children }) {
  if (phase === "resolving") return <div className="campaigns-state" role="status"><span className="campaigns-spinner"/>Resolving this account’s Campaigns workspace…</div>;
  if (phase === "loading") return <div className="campaigns-skeleton" role="status" aria-label={`Loading ${noun}`}><span/><span/><span/></div>;
  if (phase === "unavailable") return <div className="campaigns-state"><h2>Campaigns needs a resolved workspace</h2><p>No tenant data is read until your account context is confirmed.</p></div>;
  if (phase === "error") return <div className="campaigns-state" role="alert"><h2>Campaigns could not load</h2><p>Your records were not changed. Try the tenant-scoped read again.</p><button className="btn btn-s" onClick={retry}><Ic.arrow size={13}/>Retry</button></div>;
  return children;
}

function Empty({ title, detail }) {
  return <div className="campaigns-state"><h2>{title}</h2><p>{detail}</p></div>;
}

function SurfaceHead({ truthKey, title, description, action }) {
  const [, note] = TRUTH[truthKey];
  return <div className="campaigns-surface-head"><div><div className="campaigns-heading-line"><h2>{title}</h2></div><p>{description}</p><small>{note}</small></div>{action}</div>;
}

export function DetailDrawer({ detail, onClose }) {
  const closeRef = React.useRef(null);
  const drawerRef = React.useRef(null);
  React.useEffect(() => {
    if (!detail) return;
    const previous = document.activeElement;
    const background = document.querySelectorAll(".solo-campaigns > .campaigns-nav, .solo-campaigns > .campaigns-scroll");
    background.forEach((node) => node.setAttribute("inert", ""));
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      // Only what Tab can actually reach: controls inside a collapsed <details> are not focusable,
      // except that details' own <summary>.
      const focusable = [...(drawerRef.current?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])') ?? [])]
        .filter((el) => { const closed = el.closest("details:not([open])"); return !closed || el.parentElement === closed && el.tagName === "SUMMARY"; });
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); background.forEach((node) => node.removeAttribute("inert")); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [detail, onClose]);
  if (!detail) return null;
  return <><button className="campaigns-drawer-scrim" tabIndex={-1} aria-label="Close details" onClick={onClose}/><aside ref={drawerRef} className="campaigns-drawer" role="dialog" aria-modal="true" aria-labelledby="campaigns-detail-title">
    <header><div><span className="eyebrow">Grounded detail</span><h2 id="campaigns-detail-title">{detail.title}</h2></div><button ref={closeRef} className="btn btn-s" onClick={onClose} aria-label="Close details"><Ic.x size={14}/></button></header>
    <div className="campaigns-drawer-body">{detail.rows.map(([label, value]) => <div className="campaigns-detail-row" key={label}><span>{label}</span><strong>{value || "Not recorded"}</strong></div>)}{detail.body}{detail.actions&&<div className="campaigns-detail-actions">{detail.actions}</div>}{detail.note&&<p className="campaigns-detail-note">{detail.note}</p>}</div>
  </aside></>;
}

// Overview is the Campaign Command Desk (docs/prototypes/campaigns-overview.html, owner-approved
// 2026-09-05). It COORDINATES a campaign across the source-owning subtabs and fabricates no campaign
// state. The old "Campaign state rollup unavailable" panel is replaced: a campaign is now an
// owner-authored brief (campaign_briefs / useSoloCampaignBriefs), and each growth-loop stage is a
// real source fact or an honest absence. `data` supplies the loop-source reads (pipeline, artifacts);
// keyed by tenant so a workspace switch clears the desk's filters, drawers and pending edits.
function Overview({ data, onRoute }) {
  return <CampaignOverview key={data.tenantId || "none"} data={data} onRoute={onRoute}/>;
}

// Catalog holds TWO durable concepts under one tab (owner ruling, Gate 1 2026-09-02):
//   Offers          — what this business sells. Catalog owns the definition.
//   Published assets — the Vibe-owned pages, funnels and forms that present it. Unchanged, and
//                      deliberately NOT deleted or reframed as offers.
// A legacy address (/growth/pages and its four siblings, or ?type=) still means the Vibe-owned
// half, so an incoming `initialType` opens Published assets rather than Offers.
function Catalog({ data, setDetail, initialType, onOpenContact, onOpenDeal }) {
  const [section, setSection] = React.useState(initialType ? "assets" : "offers");
  const [type, setType] = React.useState(initialType || "all");
  // The null transition is reachable without unmounting: clicking the already-selected Catalog
  // tab navigates to the bare path and history navigation can drop the query too. Without the
  // else branch the bare /growth/catalog kept showing Published assets, contradicting the
  // initial state on the line above, which makes Offers the bare-route default.
  React.useEffect(()=>{
    if(initialType){ setType(initialType); setSection("assets"); }
    else { setType("all"); setSection("offers"); }
  },[initialType]);
  const shown = type === "all" ? data.artifacts : data.artifacts.filter((artifact)=>artifact.type===type);
  const offers = section === "offers";
  const sectionSwitch = <div className="campaigns-segmented" aria-label="What this tab shows">
    <button aria-pressed={offers} onClick={()=>setSection("offers")}>Offers</button>
    <button aria-pressed={!offers} onClick={()=>setSection("assets")}>Published assets</button>
  </div>;
  if (offers) return <section className="campaigns-surface"><SurfaceHead truthKey="offers" title="Offers" description="What this business sells — products, services, programs, packages and consultations." action={sectionSwitch}/>
    <CatalogOffers setDetail={setDetail}/>
  </section>;
  return <section className="campaigns-surface"><SurfaceHead truthKey="catalog" title="Published assets" description="Read-only published outputs owned by Vibe Studio." action={sectionSwitch}/>
    <div className="campaigns-segmented" aria-label="Filter published outputs" style={{margin:"12px 19px 0"}}>{["all","page","funnel","form"].map((item)=><button key={item} aria-pressed={type===item} onClick={()=>setType(item)}>{item === "all" ? "All" : `${item[0].toUpperCase()}${item.slice(1)}s`}</button>)}</div>
    <StateFrame phase={data.phase} retry={data.retry} noun="published outputs">{shown.length===0?<Empty title="No published outputs in this view" detail="Create and publish creative work in Vibe Studio. Campaigns will list only grounded published outputs here."/>:<div className="campaigns-catalog-grid">{shown.map((artifact)=><article className="campaigns-artifact" key={`${artifact.type}-${artifact.id}`}><div><span className="campaigns-type">{artifact.type}</span><h3>{artifact.name}</h3><p>Updated {formatDate(artifact.updatedAt)}</p></div><div className="campaigns-artifact-actions"><button className="btn btn-s" onClick={()=>setDetail(artifact.type==="form"
  // A form's drawer carries its intake: where submissions go, and what each visitor typed.
  ?{title:artifact.name,rows:[["Type",artifact.type],["Published state",artifact.status],["Recent captures",`${artifact.recentSubmissions} in the latest 200 workspace submissions`],["Routing contract",artifact.routingConfigured?"Configured":"Not configured"]],body:<FormIntakePanel key={artifact.id} tenantId={data.tenantId} formId={artifact.id} workspace={data.pipelineWorkspace} onOpenContact={onOpenContact} onOpenDeal={onOpenDeal}/>,note:"Creative changes remain in Vibe Studio. Recent capture counts are a bounded window, not lifetime totals."}
  :{title:artifact.name,rows:[["Type",artifact.type],["Published state",artifact.status],["Recent captures","Not available"],["Routing contract","Not applicable"]],note:"Creative changes remain in Vibe Studio. Recent capture counts are a bounded window, not lifetime totals."})}>Details</button>{artifact.publicHref&&<a className="btn btn-s" href={artifact.publicHref} target="_blank" rel="noreferrer">Open published <Ic.arrow size={12}/></a>}</div></article>)}</div>}</StateFrame>
  </section>;
}

function Sales({ data, setDetail, onOpenCatalog, onOpenClients, onOpenPipeline }) {
  // The Sales Command Desk owns its own layout, subtabs and the routed-capture foldout now — the
  // wrapper only hands it the tenant-scoped reads the shell already resolved (§18: one drawer,
  // shared here; §58: the routed-capture references + their honesty copy moved INTO SalesOps, not
  // dropped). `deals` and `stages` come from the Campaigns snapshot; Sales reads, never re-queries.
  return <section className="campaigns-surface">
    <SalesOps
      setDetail={setDetail}
      deals={(data.pipelineWorkspace&&data.pipelineWorkspace.deals)||[]}
      stages={(data.pipelineWorkspace&&data.pipelineWorkspace.stages)||[]}
      dealsPhase={data.phase}
      submissions={data.submissions||[]}
      submissionsPhase={data.phase}
      submissionsRetry={data.retry}
      onOpenCatalog={onOpenCatalog}
      onOpenClients={onOpenClients}
      onOpenPipeline={onOpenPipeline}
      truth={TRUTH.sales}
    />
  </section>;
}

function PipelineStageRow({ stage, index, stages, pipeline, canManage, busy, save }) {
  const [draft,setDraft]=React.useState({label:stage.label,description:stage.description||"",movePolicy:stage.movePolicy||"direct",stageType:stage.stageType||"open"});
  React.useEffect(()=>setDraft({label:stage.label,description:stage.description||"",movePolicy:stage.movePolicy||"direct",stageType:stage.stageType||"open"}),[stage.id,stage.label,stage.description,stage.movePolicy,stage.stageType]);
  const reorder=(targetIndex)=>{const ordered=stages.filter((item)=>!item.archivedAt).map((item)=>item.id);const from=ordered.indexOf(stage.id);if(from<0||targetIndex<0||targetIndex>=ordered.length)return;ordered.splice(from,1);ordered.splice(targetIndex,0,stage.id);void save({type:"reorder-stages",pipelineId:pipeline.id,orderedIds:ordered,expectedVersion:pipeline.version});};
  return <article className={stage.archivedAt?"is-archived":""} draggable={canManage&&!busy&&!stage.archivedAt} onDragStart={(event)=>event.dataTransfer.setData("text/pipeline-stage",stage.id)} onDragOver={(event)=>{if(canManage&&!stage.archivedAt)event.preventDefault();}} onDrop={(event)=>{event.preventDefault();const id=event.dataTransfer.getData("text/pipeline-stage");const from=stages.findIndex((item)=>item.id===id);if(from>=0&&id!==stage.id){const ordered=stages.filter((item)=>!item.archivedAt).map((item)=>item.id);ordered.splice(ordered.indexOf(id),1);ordered.splice(ordered.indexOf(stage.id),0,id);void save({type:"reorder-stages",pipelineId:pipeline.id,orderedIds:ordered,expectedVersion:pipeline.version});}}}>
    <div className="pipeline-stage-fields"><label><span>Name</span><input disabled={!canManage||busy||!!stage.archivedAt} value={draft.label} onChange={(event)=>setDraft({...draft,label:event.target.value})}/></label><label><span>Description</span><input disabled={!canManage||busy||!!stage.archivedAt} value={draft.description} onChange={(event)=>setDraft({...draft,description:event.target.value})}/></label><label><span>Stage role</span><select disabled={!canManage||busy||!!stage.archivedAt} value={draft.stageType} onChange={(event)=>setDraft({...draft,stageType:event.target.value})}><option value="open">Active work</option><option value="won">Won outcome</option><option value="lost">Lost / closed outcome</option></select></label><label><span>Move policy</span><select disabled={!canManage||busy||!!stage.archivedAt} value={draft.movePolicy} onChange={(event)=>setDraft({...draft,movePolicy:event.target.value})}><option value="direct">Direct move</option><option value="approval">Approval required</option></select></label></div>
    <div className="pipeline-stage-actions"><button className="btn btn-s" disabled={!canManage||busy||!!stage.archivedAt||!draft.label.trim()} onClick={()=>save({type:"update-stage",stageId:stage.id,expectedVersion:stage.version,...draft})}>Save</button><button className="btn btn-s" disabled={!canManage||busy||index===0||!!stage.archivedAt} onClick={()=>reorder(index-1)} aria-label={`Move ${stage.label} earlier`}>↑</button><button className="btn btn-s" disabled={!canManage||busy||index===stages.filter((item)=>!item.archivedAt).length-1||!!stage.archivedAt} onClick={()=>reorder(index+1)} aria-label={`Move ${stage.label} later`}>↓</button><button className="btn btn-s" disabled={!canManage||busy} onClick={()=>save({type:stage.archivedAt?"restore-stage":"archive-stage",stageId:stage.id,expectedVersion:stage.version})}>{stage.archivedAt?"Restore":"Archive"}</button></div>
  </article>;
}

function PipelineConfigWorkspace({ mode, pipeline, stages, canManage, canDelete, run, onBack, onCreated, onDeleted, newPipeline, setNewPipeline }) {
  const [draft,setDraft]=React.useState({name:pipeline?.name||"",description:pipeline?.description||""});
  const [newStage,setNewStage]=React.useState({label:"",description:"",movePolicy:"direct",stageType:"open"});
  const [message,setMessage]=React.useState("");
  const [pending,setPending]=React.useState(false);
  const [archiveOpen,setArchiveOpen]=React.useState(false);
  const [archiveReference,setArchiveReference]=React.useState("");
  React.useEffect(()=>setDraft({name:pipeline?.name||"",description:pipeline?.description||""}),[pipeline?.id,pipeline?.name,pipeline?.description]);
  React.useEffect(()=>{setArchiveOpen(false);setArchiveReference("");},[pipeline?.id]);
  const save=async(action)=>{if(pending)return null;setPending(true);setMessage("");try{const result=await run({...action,idempotencyKey:crypto.randomUUID()});setMessage(result.message);return result;}finally{setPending(false);}};
  const addDraftStage=()=>{if(!newStage.label.trim())return;setNewPipeline({...newPipeline,stages:[...newPipeline.stages,{label:newStage.label.trim(),description:newStage.description.trim(),movePolicy:newStage.movePolicy,stageType:newStage.stageType}]});setNewStage({label:"",description:"",movePolicy:"direct",stageType:"open"});};
  const updateDraftStage=(index,patch)=>setNewPipeline({...newPipeline,stages:newPipeline.stages.map((stage,stageIndex)=>stageIndex===index?{...stage,...patch}:stage)});
  const moveDraftStage=(index,direction)=>{const target=index+direction;if(target<0||target>=newPipeline.stages.length)return;const next=[...newPipeline.stages];const [stage]=next.splice(index,1);next.splice(target,0,stage);setNewPipeline({...newPipeline,stages:next});};
  const removeDraftStage=(index)=>setNewPipeline({...newPipeline,stages:newPipeline.stages.filter((_,stageIndex)=>stageIndex!==index)});
  const create=async()=>{const result=await save({type:"create-pipeline",...newPipeline});if(result?.ok){const createdId=typeof result.data?.pipeline_id==="string"?result.data.pipeline_id:"";setNewPipeline({name:"",description:"",stages:[]});onCreated(createdId);}};
  const askPaige=()=>{const authoredStages=newPipeline.stages.length?newPipeline.stages.map((stage,index)=>`${index+1}. ${stage.label}: ${stage.description||"No description"} (${stage.movePolicy})`).join("\n"):"No stages have been authored. Start with zero stages unless I explicitly describe the custom stages I want.";window.dispatchEvent(new CustomEvent("paige:open",{detail:{prompt:`Use pipeline.configure to prepare a custom, tenant-owned pipeline for this workflow. Never supply preset stages or a generic sales taxonomy. Keep every field editable and do not activate anything until I approve. Workflow: ${newPipeline.description||newPipeline.name||"I will describe it in chat."}\nOwner-authored stages:\n${authoredStages}`}}));};
  return <section className="pipeline-config-workspace" aria-labelledby="pipeline-config-title" aria-busy={pending}>
    <header><button className="btn btn-s" disabled={pending} onClick={onBack}>← Back to board</button><div><span className="eyebrow">Governed workspace</span><h2 id="pipeline-config-title">Pipeline configuration</h2><p>Create from scratch or manage every tenant-owned stage. Nothing here imposes a global sales process.</p></div></header>
    {!canManage&&<p className="pipeline-readonly"><Ic.shield size={14}/>Read-only access: you can inspect configuration, but every write remains unavailable and the server independently refuses it.</p>}
    {mode==="create"?<div className="pipeline-create-fields"><label><span>Pipeline name</span><input autoFocus disabled={!canManage||pending} value={newPipeline.name} onChange={(event)=>setNewPipeline({...newPipeline,name:event.target.value})}/></label><label><span>Purpose or workflow</span><textarea disabled={!canManage||pending} value={newPipeline.description} onChange={(event)=>setNewPipeline({...newPipeline,description:event.target.value})}/></label><div className="pipeline-create-stage-intro"><h3>Custom stages</h3><p>Start with zero stages for a blank draft, or add only the stages you want. Nothing is supplied automatically.</p></div>{newPipeline.stages.length>0&&<div className="pipeline-draft-stage-list" aria-label="Custom stages to create">{newPipeline.stages.map((stage,index)=><article key={`${index}-${stage.label}`}><div className="pipeline-stage-fields"><label><span>Name</span><input disabled={!canManage||pending} value={stage.label} onChange={(event)=>updateDraftStage(index,{label:event.target.value})}/></label><label><span>Description</span><input disabled={!canManage||pending} value={stage.description} onChange={(event)=>updateDraftStage(index,{description:event.target.value})}/></label><label><span>Stage role</span><select disabled={!canManage||pending} value={stage.stageType||"open"} onChange={(event)=>updateDraftStage(index,{stageType:event.target.value})}><option value="open">Active work</option><option value="won">Won outcome</option><option value="lost">Lost / closed outcome</option></select></label><label><span>Move policy</span><select disabled={!canManage||pending} value={stage.movePolicy} onChange={(event)=>updateDraftStage(index,{movePolicy:event.target.value})}><option value="direct">Direct move</option><option value="approval">Approval required</option></select></label></div><div className="pipeline-stage-actions"><button className="btn btn-s" disabled={!canManage||pending||index===0} onClick={()=>moveDraftStage(index,-1)} aria-label={`Move ${stage.label} earlier`}>↑</button><button className="btn btn-s" disabled={!canManage||pending||index===newPipeline.stages.length-1} onClick={()=>moveDraftStage(index,1)} aria-label={`Move ${stage.label} later`}>↓</button><button className="btn btn-s pipeline-danger" disabled={!canManage||pending} onClick={()=>removeDraftStage(index)}>Remove</button></div></article>)}</div>}<div className="pipeline-create-stage"><label><span>Stage name</span><input disabled={!canManage||pending} value={newStage.label} onChange={(event)=>setNewStage({...newStage,label:event.target.value})}/></label><label><span>Description</span><input disabled={!canManage||pending} value={newStage.description} onChange={(event)=>setNewStage({...newStage,description:event.target.value})}/></label><label><span>Stage role</span><select disabled={!canManage||pending} value={newStage.stageType} onChange={(event)=>setNewStage({...newStage,stageType:event.target.value})}><option value="open">Active work</option><option value="won">Won outcome</option><option value="lost">Lost / closed outcome</option></select></label><label><span>Move policy</span><select disabled={!canManage||pending} value={newStage.movePolicy} onChange={(event)=>setNewStage({...newStage,movePolicy:event.target.value})}><option value="direct">Direct move</option><option value="approval">Approval required</option></select></label><button className="btn btn-s" disabled={!canManage||pending||!newStage.label.trim()} onClick={addDraftStage}>Add custom stage</button></div><div className="pipeline-create-actions"><button className="btn btn-s" disabled={!canManage||pending} onClick={askPaige}>Ask PAIGE</button><button className="btn btn-s btn-p" disabled={!canManage||pending||!newPipeline.name.trim()} onClick={create}>{pending?"Creating…":newPipeline.stages.length?`Create pipeline with ${newPipeline.stages.length} stage${newPipeline.stages.length===1?"":"s"}`:"Create blank pipeline"}</button></div></div>:pipeline&&<>
      <dl className="pipeline-compact-meta" aria-label="Pipeline identity and metadata"><div><dt>Reference</dt><dd>{pipeline.shortRef}</dd></div><div><dt>Created through</dt><dd>{pipeline.createdThrough?.replace("_"," ")||"Not recorded"}</dd></div><div><dt>Created by</dt><dd>{pipeline.createdByName||"Not recorded"}</dd></div>{pipeline.requestedByName&&<div><dt>Requested by</dt><dd>{pipeline.requestedByName}</dd></div>}<div><dt>Created</dt><dd>{pipeline.createdAt?new Date(pipeline.createdAt).toLocaleDateString():"Not recorded"}</dd></div><div><dt>Updated</dt><dd>{pipeline.updatedAt?new Date(pipeline.updatedAt).toLocaleDateString():"Not recorded"}</dd></div><div><dt>Stages</dt><dd>{pipeline.stageCount}</dd></div><div><dt>Deals</dt><dd>{pipeline.dealCount}</dd></div></dl>
      <div className="pipeline-config-fields"><label><span>Name</span><input disabled={!canManage||pending} value={draft.name} onChange={(event)=>setDraft({...draft,name:event.target.value})}/></label><label><span>Purpose</span><input disabled={!canManage||pending} value={draft.description} onChange={(event)=>setDraft({...draft,description:event.target.value})}/></label><button className="btn btn-s" disabled={!canManage||pending||!draft.name.trim()} onClick={()=>save({type:"update-pipeline",pipelineId:pipeline.id,expectedVersion:pipeline.version,...draft})}>Save details</button></div>
      <div className="pipeline-lifecycle"><span>Status: <strong>{pipeline.lifecycleStatus}</strong></span><button className="btn btn-s" disabled={!canManage||pending||pipeline.lifecycleStatus==="active"} onClick={()=>save({type:"activate-pipeline",pipelineId:pipeline.id,expectedVersion:pipeline.version})}>Activate</button><button className="btn btn-s" disabled={!canManage||pending||pipeline.lifecycleStatus==="archived"} onClick={()=>setArchiveOpen(true)}>Archive pipeline</button><button className="btn btn-s" disabled={!canManage||pending||pipeline.lifecycleStatus!=="archived"} onClick={()=>save({type:"restore-pipeline",pipelineId:pipeline.id,expectedVersion:pipeline.version})}>Restore pipeline</button></div>
      {archiveOpen&&<section className="pipeline-archive-confirm" aria-label="Confirm exact pipeline archive"><h3>Archive {pipeline.name} ({pipeline.shortRef})?</h3><p>This pipeline currently has <strong>{pipeline.dealCount}</strong> deal{pipeline.dealCount===1?"":"s"}. Archiving removes it from active selection; it does not hard-delete the pipeline or its history.</p><label><span>Enter {pipeline.shortRef} to confirm</span><input value={archiveReference} onChange={(event)=>setArchiveReference(event.target.value.toUpperCase())}/></label><div><button className="btn btn-s" onClick={()=>{setArchiveOpen(false);setArchiveReference("");}}>Cancel</button><button className="btn btn-s pipeline-danger" disabled={!canManage||pending||archiveReference.trim()!==pipeline.shortRef} onClick={async()=>{const result=await save({type:"archive-pipeline",pipelineId:pipeline.id,pipelineRef:pipeline.shortRef,confirmedReference:archiveReference.trim(),expectedVersion:pipeline.version});if(result?.ok){setArchiveOpen(false);setArchiveReference("");}}}>Archive exact reference</button></div></section>}
      <PipelineDelete key={pipeline.id} pipeline={{...pipeline,stageCount:stages.length}} canDelete={canDelete===true} run={run} onDeleted={onDeleted}/>
      <div className="pipeline-stage-list"><h3>Stages</h3>{stages.map((stage,index)=><PipelineStageRow key={stage.id} stage={stage} index={index} stages={stages} pipeline={pipeline} canManage={canManage} busy={pending} save={save}/>)}</div>
      <div className="pipeline-new-stage"><h3>Add a stage</h3><label><span>Name</span><input disabled={!canManage||pending} value={newStage.label} onChange={(event)=>setNewStage({...newStage,label:event.target.value})}/></label><label><span>Description</span><input disabled={!canManage||pending} value={newStage.description} onChange={(event)=>setNewStage({...newStage,description:event.target.value})}/></label><label><span>Stage role</span><select disabled={!canManage||pending} value={newStage.stageType} onChange={(event)=>setNewStage({...newStage,stageType:event.target.value})}><option value="open">Active work</option><option value="won">Won outcome</option><option value="lost">Lost / closed outcome</option></select></label><label><span>Move policy</span><select disabled={!canManage||pending} value={newStage.movePolicy} onChange={(event)=>setNewStage({...newStage,movePolicy:event.target.value})}><option value="direct">Direct move</option><option value="approval">Approval required</option></select></label><button className="btn btn-s" disabled={!canManage||pending||!newStage.label.trim()} onClick={async()=>{const result=await save({type:"create-stage",pipelineId:pipeline.id,expectedVersion:pipeline.version,...newStage});if(result?.ok)setNewStage({label:"",description:"",movePolicy:"direct",stageType:"open"});}}>{pending?"Saving…":"Add stage"}</button></div>
    </>}
    {message&&<p className="pipeline-save-message" role={message.toLowerCase().includes("could not")?"alert":"status"}>{message}</p>}
  </section>;
}

function PipelineFolderRow({ folder, canManage, pending, save, onArchive }) {
  const [name,setName]=React.useState(folder.name);
  React.useEffect(()=>setName(folder.name),[folder.id,folder.name]);
  return <article className={folder.lifecycleStatus==="archived"?"is-archived":""}><div><strong>{folder.name}</strong><small>{folder.pipelineCount} pipeline{folder.pipelineCount===1?"":"s"} · {folder.lifecycleStatus}</small></div><label><span className="sr-only">Rename {folder.name}</span><input value={name} disabled={!canManage||pending||folder.lifecycleStatus==="archived"} onChange={(event)=>setName(event.target.value)}/></label><button className="btn btn-s" disabled={!canManage||pending||folder.lifecycleStatus==="archived"||!name.trim()||name.trim().toLowerCase()==="unfiled"||name.trim()===folder.name} onClick={()=>save({type:"rename-folder",folderId:folder.id,name:name.trim(),expectedVersion:folder.version})}>Save name</button>{folder.lifecycleStatus==="active"?(onArchive&&<button className="btn btn-s" disabled={!canManage||pending} onClick={()=>onArchive(folder)}>Archive folder</button>):<button className="btn btn-s" disabled={!canManage||pending} onClick={()=>save({type:"restore-folder",folderId:folder.id,expectedVersion:folder.version})}>Restore folder</button>}</article>;
}

function PipelineFolderAssignmentRow({ pipeline, folders, canManage, pending, save }) {
  const [folderId,setFolderId]=React.useState(pipeline.folderId||"");
  React.useEffect(()=>setFolderId(pipeline.folderId||""),[pipeline.id,pipeline.folderId]);
  return <article className="pipeline-folder-pipeline"><div><strong>{pipeline.name}</strong><small>{pipeline.shortRef}</small></div><label><span className="sr-only">Folder for {pipeline.name} {pipeline.shortRef}</span><select value={folderId} disabled={!canManage||pending} onChange={(event)=>setFolderId(event.target.value)}><option value="">Unfiled</option>{folders.map((folder)=><option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label><button className="btn btn-s" disabled={!canManage||pending||folderId===(pipeline.folderId||"")} onClick={()=>save({type:"move-pipeline-to-folder",pipelineId:pipeline.id,pipelineRef:pipeline.shortRef,folderId:folderId||null,expectedVersion:pipeline.version})}>Move</button></article>;
}

function PipelineFolderOrganizer({ workspace, run, onClose }) {
  const activeFolders=workspace.folders.filter((folder)=>folder.lifecycleStatus==="active");
  const returnFocusRef=React.useRef(document.activeElement);
  const [newName,setNewName]=React.useState("");
  const [pending,setPending]=React.useState(false);
  const [message,setMessage]=React.useState("");
  const [archiveFolder,setArchiveFolder]=React.useState(null);
  const [confirmedName,setConfirmedName]=React.useState("");
  const reservedName=newName.trim().toLowerCase()==="unfiled";
  const returnFocus=returnFocusRef.current;
  const save=async(action)=>{if(pending)return null;setPending(true);setMessage("");try{const result=await run({...action,idempotencyKey:crypto.randomUUID()});setMessage(result.message);return result;}finally{setPending(false);}};
  React.useEffect(()=>{const organizer=document.querySelector(".pipeline-folder-organizer");const background=[...document.querySelectorAll(".pipeline-surface>:not(.pipeline-folder-organizer):not(.pipeline-folder-scrim)")];background.forEach((node)=>node.setAttribute("inert",""));organizer?.querySelector("input:not([disabled])")?.focus({preventScroll:true});const onKey=(event)=>{if(event.key==="Escape"&&!pending){onClose();return;}if(event.key==="Tab"&&organizer){const focusable=[...organizer.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled])")];if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};window.addEventListener("keydown",onKey);return()=>{window.removeEventListener("keydown",onKey);background.forEach((node)=>node.removeAttribute("inert"));if(returnFocus instanceof HTMLElement&&returnFocus.isConnected)returnFocus.focus({preventScroll:true});};},[onClose,pending,returnFocus]);
  const directPaige=()=>window.dispatchEvent(new CustomEvent("paige:open",{detail:{prompt:"Use pipeline.catalogue to read my exact tenant-owned folders and pipelines, including empty folders and zero-deal pipelines. Help me organize them through pipeline.configure. Never guess from a display name, never invent a pipeline or folder identity, and ask for exact confirmation before archiving a folder."}}));
  return <><div className="pipeline-folder-scrim" onClick={()=>!pending&&onClose()}/><section className="pipeline-folder-organizer" role="dialog" aria-modal="true" aria-labelledby="pipeline-folder-title" aria-busy={pending}>
    <header><div><span className="eyebrow">Tenant workspace</span><h2 id="pipeline-folder-title">Folder organizer</h2><p>Group pipelines without changing their stages, deals, or identity.</p></div><button className="btn btn-s" disabled={pending} onClick={onClose}>Close</button></header>
    {!workspace.canManage&&<p className="pipeline-readonly"><Ic.shield size={14}/>Read-only access: you can browse folders, but writes remain unavailable.</p>}
    <div className="pipeline-folder-create"><label><span>New folder name</span><input value={newName} disabled={!workspace.canManage||pending} aria-describedby={reservedName?"pipeline-folder-reserved":undefined} onChange={(event)=>setNewName(event.target.value)}/>{reservedName&&<small id="pipeline-folder-reserved">Unfiled is the built-in view for pipelines without a folder. Choose another name.</small>}</label><button className="btn btn-s pipeline-action-folders" disabled={!workspace.canManage||pending||!newName.trim()||reservedName} onClick={async()=>{const result=await save({type:"create-folder",name:newName.trim()});if(result?.ok)setNewName("");}}>Create folder</button><button className="btn btn-s pipeline-action-paige" disabled={!workspace.canManage||pending} onClick={directPaige}>Direct PAIGE</button></div>
    <div className="pipeline-folder-list">
      {workspace.folders.map((folder)=><PipelineFolderRow key={folder.id} folder={folder} canManage={workspace.canManage} pending={pending} save={save} onArchive={workspace.canArchiveFolders?(selected)=>{setArchiveFolder(selected);setConfirmedName("");}:undefined}/>)}
      {workspace.folders.length===0&&<p>No folders yet. Every pipeline is currently Unfiled.</p>}
    </div>
    <div className="pipeline-folder-pipelines"><h3>Pipelines</h3>{workspace.pipelines.filter((pipeline)=>pipeline.lifecycleStatus!=="archived").map((pipeline)=><PipelineFolderAssignmentRow key={pipeline.id} pipeline={pipeline} folders={activeFolders} canManage={workspace.canManage} pending={pending} save={save}/>)}</div>
    {workspace.canManage&&!workspace.canArchiveFolders&&<p className="pipeline-folder-owner-note">Only the workspace owner can archive a folder. You can still create, rename, restore, and organize folders.</p>}
    {archiveFolder&&<section className="pipeline-folder-archive"><h3>Archive {archiveFolder.name}?</h3><p>Its {archiveFolder.pipelineCount} assigned pipeline record{archiveFolder.pipelineCount===1?"":"s"} will move to Unfiled and keep the current lifecycle status. No pipeline, deal, or history is deleted.</p><label><span>Enter {archiveFolder.name} to confirm</span><input value={confirmedName} onChange={(event)=>setConfirmedName(event.target.value)}/></label><div><button className="btn btn-s" onClick={()=>setArchiveFolder(null)}>Cancel</button><button className="btn btn-s pipeline-danger" disabled={!workspace.canArchiveFolders||pending||confirmedName!==archiveFolder.name} onClick={async()=>{const result=await save({type:"archive-folder",folderId:archiveFolder.id,confirmedName,expectedVersion:archiveFolder.version});if(result?.ok)setArchiveFolder(null);}}>Archive exact folder</button></div></section>}
    {message&&<p className="pipeline-save-message" role={message.toLowerCase().includes("could not")?"alert":"status"}>{message}</p>}
  </section></>;
}

export function PipelineSurface({ data, setDetail, focusDealId, onClearFocus, createRequested = false }) {
  const workspace=data.pipelineWorkspace;
  const mounted=React.useRef(false);
  React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [selectedId,setSelectedId]=React.useState("");
  const [folderFilter,setFolderFilter]=React.useState("all");
  const [foldersOpen,setFoldersOpen]=React.useState(false);
  const [focusedStageId,setFocusedStageId]=React.useState("");
  const [view,setView]=React.useState("board");
  const [newPipeline,setNewPipeline]=React.useState({name:"",description:"",stages:[]});
  const [moving,setMoving]=React.useState(null);
  const [movePicker,setMovePicker]=React.useState(null);
  const [keyboardMove,setKeyboardMove]=React.useState(null);
  const [notice,setNotice]=React.useState("");
  const [restoreLabel,setRestoreLabel]=React.useState("");
  const openerRef=React.useRef(null);
  const pendingSelectionRef=React.useRef(null);
  const activePipelines=workspace.pipelines.filter((item)=>item.lifecycleStatus!=="archived");
  const visiblePipelines=activePipelines.filter((item)=>folderFilter==="all"||(folderFilter==="unfiled"?!item.folderId:item.folderId===folderFilter));
  const selected=visiblePipelines.find((item)=>item.id===selectedId)??visiblePipelines[0]??(folderFilter==="all"?workspace.pipelines[0]:null);
  const stages=selected?workspace.stages.filter((stage)=>stage.pipelineId===selected.id).sort((a,b)=>a.orderIndex-b.orderIndex):[];
  const activeStages=stages.filter((stage)=>!stage.archivedAt);
  const focusId=activeStages.some((stage)=>stage.id===focusedStageId)?focusedStageId:activeStages[0]?.id;
  React.useEffect(()=>{pendingSelectionRef.current=null;setView("board");setFolderFilter("all");setFoldersOpen(false);setMoving(null);setMovePicker(null);setKeyboardMove(null);setNotice("");setNewPipeline({name:"",description:"",stages:[]});},[data.tenantId]);
  React.useEffect(()=>{if(folderFilter!=="all"&&folderFilter!=="unfiled"&&!workspace.folders.some((folder)=>folder.id===folderFilter&&folder.lifecycleStatus==="active")){setFolderFilter("unfiled");setSelectedId("");setFocusedStageId("");}},[folderFilter,workspace.folders]);
  React.useEffect(()=>{const pendingId=pendingSelectionRef.current;if(pendingId){if(workspace.pipelines.some((item)=>item.id===pendingId)){setSelectedId(pendingId);setFocusedStageId("");pendingSelectionRef.current=null;}return;}if(selected&&selected.id!==selectedId){setSelectedId(selected.id);setFocusedStageId("");}},[selected,selectedId,workspace.pipelines]);
  React.useEffect(()=>{if(view==="board")return;const onKey=(event)=>{if(event.key==="Escape"&&!moving){event.preventDefault();setView("board");}};window.addEventListener("keydown",onKey);document.querySelector(".pipeline-config-workspace input")?.focus({preventScroll:true});return()=>window.removeEventListener("keydown",onKey);},[view,moving]);
  React.useLayoutEffect(()=>{if(view!=="board"||!restoreLabel)return;const target=[...document.querySelectorAll(".pipeline-actions button")].find((button)=>button.textContent===restoreLabel);target?.focus({preventScroll:true});},[view,restoreLabel]);
  const openConfig=(mode,event)=>{openerRef.current=event.currentTarget;setRestoreLabel(event.currentTarget.textContent||"");const scrollOwner=document.querySelector(".campaigns-scroll");if(scrollOwner)scrollOwner.scrollTop=0;setView(mode);setNotice("");};
  const back=()=>setView("board");
  const created=(pipelineId)=>{pendingSelectionRef.current=pipelineId||null;if(pipelineId)setSelectedId(pipelineId);setFocusedStageId("");setView("board");};
  // Point PAIGE at the client this deal is recorded against. The event carries UI
  // context only: the server re-resolves tenant, authorization and client scope, and
  // refuses the turn if the caller may not read that client. The label says OPEN rather
  // than ASK because that is all this does today — the `prompt` below matches the shape
  // the two existing dispatches already use, and no listener consumes it yet. Offered only
  // when the client is visible to this caller — `clientId` is null otherwise.
  const askPaigeAboutClient=(deal)=>window.dispatchEvent(new CustomEvent("paige:open",{detail:{clientId:deal.clientId,clientLabel:deal.clientName,prompt:"Tell me only what the recorded stage outcomes for this client prove, and name the source reference. If nothing is recorded, say so rather than inferring. Do not attempt to move the deal."}}));
  const openDeal=(deal)=>setDetail({title:deal.title,rows:[["Client",deal.clientName],["Owner",deal.owner],["Status",deal.status],["Next action",deal.nextAction],["Source evidence",deal.source],["Last changed",formatDate(deal.updatedAt)],["Stage history",deal.history.length?deal.history.map((item)=>`${item.summary} · ${formatDate(item.createdAt)}`).join("\n"):"No recorded stage history"],["Customer portal activity","No portal activity source connected"]],actions:<>{deal.clientId&&<button className="btn btn-s" onClick={()=>askPaigeAboutClient(deal)}>Open PAIGE for this client</button>}<button className="btn btn-s" disabled title="Customer portal is not available yet">Send customer invite</button></>,note:"Customer portal is not available yet. Its absence is neutral and is not treated as a retention, client-health, revenue, payment, or lifecycle signal."});
  const moveDeal=async(deal,target)=>{if(!workspace.canManage||deal.stageId===target.id||moving)return;setMoving({dealId:deal.id,targetId:target.id});setNotice("Moving…");const result=await data.pipelineAction({type:"move-deal",dealId:deal.id,targetStageId:target.id,expectedVersion:deal.version,reason:"Pipeline workspace move",idempotencyKey:crypto.randomUUID()});setNotice(result.message);setMoving(null);setMovePicker(null);setKeyboardMove(null);};
  const onCardKey=(event,deal)=>{const currentIndex=activeStages.findIndex((stage)=>stage.id===(keyboardMove?.dealId===deal.id?keyboardMove.targetId:deal.stageId));if(event.key===" "){event.preventDefault();if(keyboardMove?.dealId===deal.id){void moveDeal(deal,activeStages[currentIndex]);}else{setKeyboardMove({dealId:deal.id,targetId:deal.stageId});setNotice(`${deal.title} picked up. Use arrow keys to choose a stage, Enter or Space to drop, Escape to cancel.`);}}else if(keyboardMove?.dealId===deal.id&&(event.key==="ArrowRight"||event.key==="ArrowLeft")){event.preventDefault();const next=Math.max(0,Math.min(activeStages.length-1,currentIndex+(event.key==="ArrowRight"?1:-1)));setKeyboardMove({dealId:deal.id,targetId:activeStages[next].id});setNotice(`Target stage ${activeStages[next].label}.`);}else if(keyboardMove?.dealId===deal.id&&event.key==="Enter"){event.preventDefault();void moveDeal(deal,activeStages[currentIndex]);}else if(keyboardMove?.dealId===deal.id&&event.key==="Escape"){event.preventDefault();setKeyboardMove(null);setNotice("Move cancelled.");}};
  const deleted=(_id,message)=>{pendingSelectionRef.current=null;setSelectedId("");setFocusedStageId("");setFolderFilter("all");setView("board");setNotice(message);data.retry();};
  // The tenant-keyed workspace owns completion: a refreshed catalogue may unmount
  // the selected record's dialog before its own await resolves.
  const runConfig=async(action)=>{const result=await data.pipelineAction(action);if(mounted.current&&action.type==="delete-empty-pipeline"&&result.ok)deleted(action.pipelineId,result.message);return result;};
  if(view!=="board")return <section className="campaigns-surface pipeline-surface"><PipelineConfigWorkspace mode={view==="config-create"?"create":"edit"} pipeline={selected} stages={stages} canManage={workspace.canManage} canDelete={workspace.canDelete} run={runConfig} onBack={back} onCreated={created} onDeleted={()=>{}} newPipeline={newPipeline} setNewPipeline={setNewPipeline}/></section>;
  return <section className="campaigns-surface pipeline-surface"><StateFrame phase={data.phase} retry={data.retry}><PipelineCommandDesk data={data} selectedId={selectedId} setSelectedId={setSelectedId} folderFilter={folderFilter} setFolderFilter={setFolderFilter} onCreatePipeline={(event)=>openConfig("config-create",event)} onManage={(event)=>openConfig("config-edit",event)} onFolders={()=>setFoldersOpen(true)} focusDealId={focusDealId} onClearFocus={onClearFocus} createRequested={createRequested}/></StateFrame>{data.phase==="ready"&&foldersOpen&&<PipelineFolderOrganizer workspace={workspace} run={data.pipelineAction} onClose={()=>setFoldersOpen(false)}/>}</section>;
}

// Social is now its own surface (./social-command.tsx) rather than a fixed panel here.
//
// WHAT CHANGED AND WHY (§58 — recorded, not silently dropped). The panel this replaces was one
// UNAVAILABLE state making five explicit non-inferences: no accounts, followers, publishing queue,
// schedules, or placements. Every one of those is still made, now attached to the specific tile
// that would otherwise imply it, and the surface gained the thing the old panel could not do — an
// owner can RECORD the accounts the business posts from. That write is the first one
// `tenants.features->social_handles` has ever had, and Systems Check #3 has pointed at this page
// since it shipped while admitting the page could not finish the job.
//
// Kept verbatim in the new surface: the placements precondition (published work appears as a
// placement only once a supported provider records it) and the Vibe Studio redirect for creative
// work. `Performance()` below keeps its own "Social performance" UNAVAILABLE card, and the two do
// not contradict each other — neither claims a provider figure.
function Social({ data, onOpenCompass, onOpenPipeline }) {
  const askPaige = React.useCallback(() => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt: "Using only the social accounts on record for this workspace, tell me which are recorded and which are not. Do not report followers, reach, engagement, a publishing queue, a schedule, or where anything went live — none of those exist here. If nothing is recorded, say so." } })), []);
  return <SocialCommand campaigns={data} onOpenStudio={openStudio} onAskPaige={askPaige} onOpenCompass={onOpenCompass} onOpenPipeline={onOpenPipeline}/>;
}

function Performance({ data }) {
  return <section className="campaigns-surface"><SurfaceHead truthKey="performance" title="Performance coverage" description="A source-by-source view of what can—and cannot—be reported truthfully."/><StateFrame phase={data.phase} retry={data.retry} noun="performance sources"><div className="campaigns-coverage"><article><TruthTag state="UNAVAILABLE"/><h3>Campaign runs</h3><p>A tenant-authorized campaign rollup is not available.</p></article><article><TruthTag state="PARTIAL"/><h3>Published outputs</h3><p>{data.artifacts.length?"Published Vibe Studio outputs are available.":"No published outputs were returned."}</p></article><article><TruthTag state="PROPOSED"/><h3>Attribution and outcomes</h3><p>Captured submissions may carry traceable source and routing references; no ROI or revenue is calculated.</p></article><article><TruthTag state="UNAVAILABLE"/><h3>Social performance</h3><p>No supported provider source is connected to this customer-facing surface.</p></article></div></StateFrame></section>;
}

function CompatibilityLanding({ legacy, returnToAssets }) {
  const item = LEGACY[legacy];
  return <section className="campaigns-compat" aria-labelledby="campaigns-compat-title"><span className="campaigns-type">Compatibility address</span><h2 id="campaigns-compat-title">This address moved</h2><p><strong>{item.label}</strong> is no longer a Campaigns subtab. {item.note}</p><div className="campaigns-compat-note"><Ic.shield size={16}/><span>Your workspace and account stay selected. Vibe Studio opens through the existing supported handoff and returns focus here when you leave.</span></div><div className="campaigns-compat-actions"><button className="btn btn-s btn-p" data-solo-vibe-studio-launcher onClick={openStudio}><Ic.spark size={13}/>Vibe Studio</button><button className="btn btn-s" onClick={returnToAssets}>Return to Catalog</button></div></section>;
}

function CampaignTabs({ tabs, current, setCurrent }) {
  // The Solo shell hands this surface what is left after the rail and PAIGE. Solo overrides the
  // PAIGE column (`TenantCommandCenterShell.tsx:483`): docked `minmax(440px,34vw)`, expanded
  // `minmax(620px,52vw)`, and below 1080px it becomes an overlay while the rail compacts to 72px.
  // So a 1366 session is 685px docked and 439px with PAIGE expanded — at 439px six tabs cannot fit
  // at any spacing and the strip scrolls. Scrolling is only acceptable if the SELECTED tab is on
  // screen, so
  // bring it into view however it was chosen: click, keyboard, deep link, or a route restore.
  // `block:"nearest"` keeps the vertical position still; only the strip's own axis moves.
  React.useLayoutEffect(()=>{
    document.getElementById(`campaigns-tab-${current}`)?.scrollIntoView?.({block:"nearest",inline:"nearest"});
  },[current]);
  React.useLayoutEffect(()=>{
    if(pendingCampaignTabFocus!==current)return;
    const focused=document.getElementById(`campaigns-tab-${current}`);
    // preventScroll stops the tabPANEL from jumping. The effect above has already brought this
    // tab into the strip's own view, so focus lands on something visible.
    focused?.focus({preventScroll:true});
    pendingCampaignTabFocus=null;
  },[current]);
  const onKeyDown = (event, index) => {
    if (!["ArrowRight","ArrowLeft","Home","End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length-1 : (index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    const nextKey=tabs[next][0];
    pendingCampaignTabFocus=nextKey;
    setCurrent(nextKey);
  };
  return <div className="campaigns-nav"><div className="campaigns-tabs" role="tablist" aria-label="Campaigns views">{tabs.map((tab,index)=><button id={`campaigns-tab-${tab[0]}`} aria-controls="campaigns-tabpanel" key={tab[0]} role="tab" aria-selected={current===tab[0]} tabIndex={current===tab[0]?0:-1} onClick={()=>setCurrent(tab[0])} onKeyDown={(event)=>onKeyDown(event,index)}>{tab[2]()}<span>{tab[1]}</span></button>)}</div><button className="btn btn-s btn-p campaigns-studio" data-solo-vibe-studio-launcher onClick={openStudio}><Ic.spark size={13}/>Vibe Studio</button></div>;
}

// Retained for the existing hidden Clients compatibility mount. It performs no
// data read and points back to the one canonical Campaigns Pipeline address.
export const Pipeline=()=>{
  const params=useParams();
  const navigate=useNavigate();
  const account=params.account;
  return <div className="solo-campaigns"><div className="campaigns-scroll"><PageHead eyebrow="Campaigns" title="Pipeline moved" sub="Campaign capture and routing now live under Campaigns."/><section className="campaigns-compat"><span className="campaigns-type">Compatibility address</span><h2>Open Campaigns Pipeline</h2><p>This address is preserved so older links do not silently lose their destination.</p><div className="campaigns-compat-actions"><button className="btn btn-s btn-p" disabled={!account} onClick={()=>account&&navigate(`/solo/${account}/growth/pipeline`)}>Go to Pipeline <Ic.arrow size={13}/></button></div></section></div></div>;
};

export const GrowthHub=()=>{
  const[tab,setTab]=useSubtabRoute("solo","growth","ov");
  const tabs=[['ov','Overview',()=><Ic.bolt size={14}/>],['catalog','Catalog',()=><Ic.grid size={14}/>],['sales','Sales',()=><Ic.chart size={14}/>],['pipeline','Pipeline',()=><Ic.trend size={14}/>],['social','Social',()=><Ic.users size={14}/>],['performance','Performance',()=><Ic.pulse size={14}/>]];
  const data=useSoloCampaigns();
  const params=useParams();
  const location=useLocation();
  const navigate=useNavigate();
  const segment=(params["*"]||"").split("/")[1]||"";
  const legacy=LEGACY[segment]?segment:null;
  const query=new URLSearchParams(location.search);
  const requestedType=["all","page","funnel","form"].includes(query.get("type"))?query.get("type"):null;
  // The five retired addresses promise "Published pages appear in Catalog", so their one escape
  // hatch must land on the VIBE-OWNED half. Since Slice 2A made Offers the default section, a bare
  // setTab("catalog") would have dropped them on an empty offer list — a §58 regression on the exact
  // recovery path this landing exists to provide. `?type=all` addresses that half explicitly.
  const returnToAssets=React.useCallback(()=>{
    navigate(`${subtabPath("solo",params.account,"growth","catalog")}?type=all`);
  },[navigate,params.account]);
  // Sales' "Open Catalog" lands on the OFFERS half — the bare catalog path, which Slice 2A made the
  // offers default. Deliberately not `returnToAssets`, which exists for the retired Vibe addresses
  // and forces `?type=all` onto the published-assets half instead.
  const openCatalogOffers=React.useCallback((resumeTerms=false)=>{
    navigate(`${subtabPath("solo",params.account,"growth","catalog")}?origin=sales${resumeTerms === true ? "&resume=terms" : ""}`);
  },[navigate,params.account]);
  const openCompass=React.useCallback(()=>{
    navigate(branchPath("solo",params.account,"trust-compass"));
  },[navigate,params.account]);
  const openPipeline=React.useCallback(()=>{
    navigate(subtabPath("solo",params.account,"growth","pipeline"));
  },[navigate,params.account]);
  // A form submission's contact, by the same `?person=` deep link — without `origin=sales`, which
  // would offer a "Return to commercial terms" that has nothing to do with a form.
  const openContact=React.useCallback((contactId)=>{
    navigate(`${subtabPath("solo",params.account,"clients","people")}?person=${encodeURIComponent(contactId)}`);
  },[navigate,params.account]);
  // `?deal=` is the Pipeline tab's existing focus contract (PipelineSurface focusDealId).
  // A lead can arrive after the workspace's deals were read; refresh them so Pipeline can open it.
  const openDeal=React.useCallback((dealId)=>{
    if(!data.pipelineWorkspace.deals.some((deal)=>deal.id===dealId)) data.retry();
    navigate(`${subtabPath("solo",params.account,"growth","pipeline")}?deal=${encodeURIComponent(dealId)}`);
  },[navigate,params.account,data]);
  // `?person=` is NOT a new contract — TenantRelationshipsClientsWorkspace already reads it as
  // `deepLinkedContactId`. A control labelled "Open <client>'s record" that landed on the general
  // list was not missing a route; it was declining to use one that already existed (§18).
  const openClients=React.useCallback((contactId)=>{
    const base=`${subtabPath("solo",params.account,"clients","people")}?origin=sales`;
    navigate(typeof contactId==="string"&&contactId ? `${base}&person=${encodeURIComponent(contactId)}` : base);
  },[navigate,params.account]);
  // The Command Desk's single router. Overview coordinates; each target opens the subtab that OWNS
  // that stage of the loop (Vibe Studio opens through the existing handoff). Overview never does
  // their work — it routes.
  const onRoute=React.useCallback((target,event)=>{
    const account=params.account; if(!account) return;
    // The Studio opens through the shell's handoff, which returns focus to the launcher on close.
    if(target==="studio"){ window.dispatchEvent(new CustomEvent("paige-studio",{detail:{returnFocus:event?.currentTarget}})); return; }
    if(target==="clients"){ navigate(subtabPath("solo",account,"clients","people")); return; }
    // catalog · sales · pipeline · social · performance are Campaigns subtabs.
    navigate(subtabPath("solo",account,"growth",target));
  },[navigate,params.account]);
  const previousWorkspace=React.useRef({tenantId:data.tenantId,account:params.account});
  const workspaceChanged=(!!previousWorkspace.current.tenantId && previousWorkspace.current.tenantId!==data.tenantId) || previousWorkspace.current.account!==params.account;
  React.useEffect(()=>{
    previousWorkspace.current={tenantId:data.tenantId,account:params.account};
    if(!workspaceChanged)return;
    const next=new URLSearchParams(location.search);
    if(!next.has("origin"))return;
    next.delete("origin"); next.delete("resume");
    navigate({pathname:location.pathname,search:next.toString()},{replace:true});
  },[workspaceChanged,data.tenantId,params.account,location.pathname,location.search,navigate]);
  const [detailSnapshot,setDetailSnapshot]=React.useState(null);
  const setDetail=React.useCallback((value)=>{
    setDetailSnapshot(value ? { value, tenantId:data.tenantId, account:params.account, tab, segment } : null);
  },[data.tenantId,params.account,tab,segment]);
  const detail=detailSnapshot && detailSnapshot.tenantId===data.tenantId && detailSnapshot?.account===params.account && detailSnapshot?.tab===tab && detailSnapshot?.segment===segment && !["resolving","loading","unavailable"].includes(data.phase) ? detailSnapshot.value : null;
  const closeDetail=React.useCallback(()=>setDetailSnapshot(null),[]);
  // Also on TENANT change. A detail snapshot is detached from the list it came from, so an open
  // drawer survived a workspace switch and kept showing the previous tenant's offer name,
  // description and prices indefinitely. `data.tenantId` flips synchronously (useSoloCampaigns
  // guards it outside its effect). The snapshot identity check above hides old content before effects.
  // This covers every drawer on the tab, not only Offers — the campaign, sales and pipeline
  // rows had the same detached snapshot, and the fix cannot be narrowed to one of them
  // without duplicating the state.
  React.useEffect(()=>{setDetailSnapshot(null);},[tab,segment,data.tenantId,params.account]);
  React.useEffect(()=>{if(segment!=="active")return;const account=params.account;if(account)navigate(`/solo/${account}/growth/overview${location.search}`,{replace:true});},[segment,params.account,location.search,navigate]);
  let body=<Overview data={data} onRoute={onRoute}/>;
  if(legacy) body=<CompatibilityLanding legacy={legacy} returnToAssets={returnToAssets}/>;
  else if(tab==="catalog") body=<Catalog data={data} setDetail={setDetail} initialType={requestedType} onOpenContact={openContact} onOpenDeal={openDeal}/>;
  else if(tab==="sales") body=<Sales data={data} setDetail={setDetail} onOpenCatalog={openCatalogOffers} onOpenClients={openClients} onOpenPipeline={openPipeline}/>;
  else if(tab==="pipeline") body=<PipelineSurface key={data.tenantId} data={data} setDetail={setDetail} focusDealId={query.get("deal")} onClearFocus={()=>{const next=new URLSearchParams(location.search);next.delete("deal");navigate({pathname:location.pathname,search:next.toString()},{replace:true});}}/>;
  else if(tab==="social") body=<Social data={data} onOpenCompass={openCompass} onOpenPipeline={openPipeline}/>;
  else if(tab==="performance") body=<Performance data={data}/>;
  return <div className="solo-campaigns" data-campaigns-view={tab}><h1 className="campaigns-sr-only">Campaigns</h1><CampaignTabs tabs={tabs} current={tab} setCurrent={setTab}/><div id="campaigns-tabpanel" role="tabpanel" aria-labelledby={`campaigns-tab-${tab}`} className="campaigns-scroll">{legacy?<PageHead eyebrow="Campaigns" title={LEGACY[legacy].label}/>:null}{tab==="catalog" && query.get("origin")==="sales" && !workspaceChanged && data.tenantId && data.phase!=="resolving" && <div className="so-source-return"><button type="button" className="btn btn-s btn-p" onClick={()=>navigate(`${subtabPath("solo",params.account,"growth","sales")}${query.get("resume")==="terms" ? "?resume=terms" : ""}`)}>{query.get("resume")==="terms" ? "Return to commercial terms" : "Return to Sales"}</button><span>Finish offer setup here in Catalog, then return when ready.</span></div>}{body}</div><DetailDrawer detail={detail} onClose={closeDetail}/></div>;
};
