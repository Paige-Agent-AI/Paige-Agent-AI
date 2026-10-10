// @ts-nocheck
import React from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { legacySalesRoute } from "./sales/legacySalesRoute";
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
import { useSoloCampaignBriefs } from "./useSoloCampaignBriefs";
import { SUBMISSION_READ_LIMIT, submissionsInPeriod } from "./marketing-overview-model";
import { FormIntakePanel } from "./form-intake";
import { MarketingAds, MarketingContent } from "./marketing-planned";
import { CAPTURE_FILTERS, MarketingOverview } from "./marketing-overview";
import { MarketingEmail } from "./marketing-email";
import { MarketingAudience } from "./marketing-audience";
import "./solo-chart-tokens.css";
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
  capture: ["PARTIAL", "Pages, funnels and forms are created and published in Vibe Studio. Submission counts cover this workspace’s latest 200 submissions, not lifetime totals."],
  marketing: ["PARTIAL", "Briefs, published capture points and submissions are read from this workspace’s own records. Email broadcasts, paid ads and spend are not connected, so no reach or cost figure is shown."],
  analytics: ["PARTIAL", "Sources come from the tracking tags on the link a visitor submitted from, not their earlier visits. Visits, spend and revenue by campaign are not recorded, so no conversion rate, cost per lead or return is calculated."],
};

// INT-342 (owner-approved 2026-10-10): Lead capture is no longer a tab. Every address it, and the
// earlier creative tabs, ever had lands on Overview with its intent kept — the capture
// filter, the form it named — and one line saying where the work lives now (§58: no copied link
// silently loses its destination).
const MOVED = {
  "lead-capture": { text: "Lead capture moved here. Capture points, routing and recent leads are on Overview now." },
  catalog: { text: "Published pages, forms and funnels are on Overview, under Capture points." },
  pages: { text: "Pages are on Overview, under Capture points.", filter: "page" },
  funnels: { text: "Funnels are on Overview, under Capture points.", filter: "funnel" },
  forms: { text: "Forms are on Overview, under Capture points.", filter: "form" },
  "brand-kit": { text: "Your brand kit is in Vibe Studio.", studio: true },
  builders: { text: "Builders live in Vibe Studio. Your live pages and forms are below.", studio: true },
  "missing-form": { text: "That form isn’t live or in draft in this workspace. Here are the capture points that are." },
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


function StateFrame({ phase, retry, noun, children }) {
  if (phase === "resolving") return <div className="campaigns-state" role="status"><span className="campaigns-spinner"/>Resolving this account’s Marketing workspace…</div>;
  if (phase === "loading") return <div className="campaigns-skeleton" role="status" aria-label={`Loading ${noun}`}><span/><span/><span/></div>;
  if (phase === "unavailable") return <div className="campaigns-state"><h2>Marketing needs a resolved workspace</h2><p>Nothing is read until your account is confirmed.</p></div>;
  if (phase === "error") return <div className="campaigns-state" role="alert"><h2>Marketing could not load</h2><p>Your records were not changed. Try again.</p><button className="btn btn-s" onClick={retry}><Ic.arrow size={13}/>Retry</button></div>;
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
  // The effect runs when a different item opens, never on a re-render of the same one: callers
  // build `detail` and `onClose` inline, and re-running it moved focus to Close mid-edit (INT-342).
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const openKey = detail ? (detail.key ?? detail.title) : null;
  React.useEffect(() => {
    if (openKey === null) return;
    const onClose = () => onCloseRef.current();
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
  }, [openKey]);
  if (!detail) return null;
  return <><button className="campaigns-drawer-scrim" tabIndex={-1} aria-label="Close details" onClick={onClose}/><aside ref={drawerRef} className="campaigns-drawer" role="dialog" aria-modal="true" aria-labelledby="campaigns-detail-title">
    <header><div><span className="eyebrow">Grounded detail</span><h2 id="campaigns-detail-title">{detail.title}</h2></div><button ref={closeRef} className="btn btn-s" onClick={onClose} aria-label="Close details"><Ic.x size={14}/></button></header>
    <div className="campaigns-drawer-body">{detail.rows.map(([label, value]) => <div className="campaigns-detail-row" key={label}><span>{label}</span><strong>{value || "Not recorded"}</strong></div>)}{detail.body}{detail.actions&&<div className="campaigns-detail-actions">{detail.actions}</div>}{detail.note&&<p className="campaigns-detail-note">{detail.note}</p>}</div>
  </aside></>;
}

// Campaigns is the Campaign Command Desk (docs/prototypes/campaigns-overview.html, owner-approved
// 2026-09-05). It COORDINATES a campaign across the source-owning subtabs and fabricates no campaign
// state. The old "Campaign state rollup unavailable" panel is replaced: a campaign is now an
// owner-authored brief (campaign_briefs / useSoloCampaignBriefs), and each growth-loop stage is a
// real source fact or an honest absence. `data` supplies the loop-source reads (pipeline, artifacts);
// keyed by tenant so a workspace switch clears the desk's filters, drawers and pending edits.
function Campaigns({ data, onRoute, autoOpenBrief, onAutoOpenConsumed }) {
  return <CampaignOverview key={data.tenantId || "none"} data={data} onRoute={onRoute} autoOpenBrief={autoOpenBrief} onAutoOpenConsumed={onAutoOpenConsumed}/>;
}

// Offers: what this business sells. The definition belongs to the Sales lane (owner ruling
// 2026-10-03); it stays reachable here, unchanged, until the top-level Sales destination lands.
// The Vibe-owned "Published assets" half that used to share this tab moved to Lead capture, where
// it is measured by how it captures leads. Old `?type=` addresses are redirected there (GrowthHub).
function Catalog({ setDetail }) {
  return <section className="campaigns-surface"><SurfaceHead truthKey="offers" title="Offers" description="What this business sells — products, services, programs, packages and consultations."/>
    <CatalogOffers setDetail={setDetail}/>
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

export function PipelineSurface({ data, setDetail, focusDealId, onClearFocus, createRequested = false, dealFilter = null, selectedPipelineId = null, onSelectedPipelineChange = null }) {
  const workspace=data.pipelineWorkspace;
  const mounted=React.useRef(false);
  React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const [localSelectedId,setLocalSelectedId]=React.useState("");
  const selectedId=selectedPipelineId??localSelectedId;
  const setSelectedId=(id)=>{setLocalSelectedId(id);onSelectedPipelineChange?.(id)};
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
  return <section className="campaigns-surface pipeline-surface"><StateFrame phase={data.phase} retry={data.retry}><PipelineCommandDesk data={data} selectedId={selectedId} setSelectedId={setSelectedId} folderFilter={folderFilter} setFolderFilter={setFolderFilter} onCreatePipeline={(event)=>openConfig("config-create",event)} onManage={(event)=>openConfig("config-edit",event)} onFolders={()=>setFoldersOpen(true)} focusDealId={focusDealId} onClearFocus={onClearFocus} createRequested={createRequested} dealFilter={dealFilter}/></StateFrame>{data.phase==="ready"&&foldersOpen&&<PipelineFolderOrganizer workspace={workspace} run={data.pipelineAction} onClose={()=>setFoldersOpen(false)}/>}</section>;
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
// work. Marketing › Analytics lists social reach as not measured; neither surface claims a
// provider figure.
function Social({ data, onOpenCompass, onOpenPipeline }) {
  const askPaige = React.useCallback(() => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt: "Using only the social accounts on record for this workspace, tell me which are recorded and which are not. Do not report followers, reach, engagement, a publishing queue, a schedule, or where anything went live — none of those exist here. If nothing is recorded, say so." } })), []);
  return <SocialCommand campaigns={data} onOpenStudio={openStudio} onAskPaige={askPaige} onOpenCompass={onOpenCompass} onOpenPipeline={onOpenPipeline}/>;
}

// ── Marketing department views (owner ruling 2026-10-03; docs/product/solo-marketing-ia-proposal.md) ──
//
// Every figure below comes from a read this hub already makes: owner briefs (useSoloCampaignBriefs),
// published and draft Vibe outputs, and the latest 200 form submissions (useSoloCampaigns). Nothing is
// estimated. Email, ads, visits and spend have no source in this workspace, so they are named as
// unavailable instead of shown as zero.

const LEAD_WINDOW_DAYS = 30;

// The one definition of "last N days" (marketing-overview-model.ts), shared with Overview so the same
// tenant never sees two different 30-day lead counts one click apart.
function leadsInWindow(submissions) {
  const { within, capped } = submissionsInPeriod(submissions, LEAD_WINDOW_DAYS);
  return { within, capped };
}

function countLabel(count, capped) {
  return capped ? `${count}+` : String(count);
}

const TYPE_LABEL = { page: "Page", funnel: "Funnel", form: "Form" };

function combinedPhase(...phases) {
  if (phases.includes("unavailable")) return "unavailable";
  if (phases.includes("resolving")) return "resolving";
  if (phases.includes("error")) return "error";
  if (phases.includes("loading")) return "loading";
  return "ready";
}

function StudioLauncher({ label = "Open Vibe Studio", primary = false }) {
  return <button className={`btn btn-s ${primary ? "btn-p" : ""}`} data-solo-vibe-studio-launcher onClick={openStudio}><Ic.spark size={13}/>{label}</button>;
}

// Overview, mounted only on its own tab so the briefs read happens only here.
// A failed briefs read never hides the capture points, form panel or leads: Overview still renders
// from the Marketing read and says the brief items could not load.
function OverviewTab({ data, moved, onDismissMoved, onCanManage, ...rest }) {
  const briefsState = useSoloCampaignBriefs();
  const canManage = briefsState.canManage === true;
  React.useEffect(() => { onCanManage(canManage); }, [canManage, onCanManage]);
  React.useEffect(() => () => onCanManage(false), [onCanManage]);
  const briefsReady = briefsState.phase === "ready";
  const briefsFailed = briefsState.phase === "error" || briefsState.phase === "unavailable";
  const phase = data.phase === "ready" && !briefsReady && !briefsFailed ? "loading" : data.phase;
  const dismiss = () => { onDismissMoved(); requestAnimationFrame(() => document.querySelector(".mov-sum")?.focus({ preventScroll: true })); };
  const briefsNotice = briefsFailed ? <div className="mov-briefs-off" role="status"><p>Campaign briefs couldn’t load, so briefs waiting on you aren’t listed here.</p>{briefsState.retry && <button className="btn btn-s" onClick={() => briefsState.retry()}>Try again</button>}</div> : null;
  return <StateFrame phase={phase} retry={() => { data.retry?.(); briefsState.retry?.(); }} noun="marketing">
    {moved && <div className="mov-moved" role="status"><p><b>{MOVED[moved].text}</b></p>{MOVED[moved].studio && canManage && <StudioLauncher/>}<button className="btn btn-s" onClick={dismiss}>Dismiss</button></div>}
    <MarketingOverview data={data} briefs={briefsReady ? briefsState.briefs || [] : []} canManage={canManage} briefsNotice={briefsNotice} studioLauncher={(label) => <StudioLauncher label={label}/>} {...rest}/>
  </StateFrame>;
}

// One ruled band of four facts, read left to right — not four floating metric cards.
function MarketingStat({ label, value, foot }) {
  return <div className="mk-stat"><dt>{label}</dt><dd><strong>{value}</strong>{foot && <span>{foot}</span>}</dd></div>;
}


function SourceBars({ rows, empty }) {
  if (!rows.length) return <Empty title="Nothing to show yet" detail={empty}/>;
  const max = Math.max(...rows.map(([, count]) => count));
  return <ul className="mk-bars">{rows.map(([label, count, note]) => <li key={label}><span className="mk-bar-label"><strong>{label}</strong>{note && <small>{note}</small>}</span><span className="mk-bar-track" aria-hidden="true"><i style={{ width: `${Math.max(4, Math.round((count / max) * 100))}%` }}/></span><span className="mk-bar-count">{count}</span></li>)}</ul>;
}

function MarketingAnalytics({ data, onGo }) {
  const briefsState = useSoloCampaignBriefs();
  const phase = combinedPhase(data.phase, briefsState.phase);
  const retry = () => { data.retry?.(); briefsState.retry?.(); };
  const { within, capped } = leadsInWindow(data.submissions || []);
  const tagged = within.filter((submission) => submission.trackingSource);
  const campaignTagged = within.filter((submission) => submission.trackingCampaign).length;
  const opened = within.filter((submission) => submission.dealId).length;
  const group = (pick) => Object.entries(within.reduce((counts, submission) => { const key = pick(submission); if (key) counts[key] = (counts[key] || 0) + 1; return counts; }, {})).sort((a, b) => b[1] - a[1]);
  // Tags merge case-insensitively, as on Overview; the first spelling seen is the one shown.
  const spelling = {};
  const bySource = group((submission) => { const tag = submission.trackingSource?.trim(); if (!tag) return "No tracking tag"; return (spelling[tag.toLowerCase()] ??= tag); });
  const refs = Object.fromEntries((briefsState.briefs || []).filter((brief) => brief.shortRef).map((brief) => [brief.shortRef.toLowerCase(), brief.name]));
  const byCampaign = group((submission) => submission.trackingCampaign).map(([tag, count]) => [tag, count, refs[tag.toLowerCase()] ? `Brief: ${refs[tag.toLowerCase()]}` : "No brief uses this reference"]);
  return <>
    <div className="mk-view"><StateFrame phase={phase} retry={retry} noun="marketing analytics">
      {(data.submissions || []).length === 0 ? <section className="campaigns-surface"><div className="campaigns-state"><h2>No leads to measure yet</h2><p>When a published form collects a submission, where it came from appears here. Share your form’s link with a tracking tag on it, such as <code>?utm_source=newsletter</code>, so each lead says which channel sent it.</p><button className="btn btn-s" onClick={() => onGo("capture")}>Open capture points</button></div></section> : <>
        <dl className="mk-ledger">
          <MarketingStat label={`Leads · last ${LEAD_WINDOW_DAYS} days`} value={countLabel(within.length, capped)} foot={capped ? `Counted from the latest ${SUBMISSION_READ_LIMIT} submissions` : "Across every published form"}/>
          <MarketingStat label="With a source tag" value={`${countLabel(tagged.length, capped)} of ${countLabel(within.length, capped)}`} foot="Everything below rests on this coverage"/>
          <MarketingStat label="Became opportunities" value={countLabel(opened, capped)} foot="Revenue from them is tracked in Sales"/>
          <MarketingStat label="Tagged with a campaign" value={`${countLabel(campaignTagged, capped)} of ${countLabel(within.length, capped)}`} foot="Matched to a brief by its reference"/>
        </dl>
        <div className="mk-two">
          <section className="campaigns-surface"><SurfaceHead truthKey="analytics" title="Leads by source" description={`Last ${LEAD_WINDOW_DAYS} days · from the source tag on the link each lead submitted from (utm_source).`}/>
            <SourceBars rows={bySource} empty="No submissions in this window."/>
          </section>
          <section className="campaigns-surface"><div className="campaigns-surface-head"><div><h2>Leads by campaign</h2><p>Counted when the link carries a campaign tag (utm_campaign). Use a brief’s reference as the tag and it matches that brief.</p></div><button className="btn btn-s" onClick={() => onGo("campaigns")}>Open Campaigns</button></div>
            <SourceBars rows={byCampaign} empty="No submission in this window arrived on a link tagged with a campaign."/>
          </section>
        </div>
        <section className="campaigns-surface"><div className="campaigns-surface-head"><div><h2>Not measured here</h2><p>Each needs a source this workspace doesn’t record yet.</p></div></div>
          <div className="campaigns-list">
            {[["Form and page conversion", "Visits to published pages aren’t counted, so there is no conversion rate."],
              ["Cost per lead and acquisition cost", "No ad spend or budget actual is recorded."],
              ["Multi-touch attribution", "Only the link a visitor submitted from is known, not their earlier visits."],
              ["Revenue by campaign", "No order or deal names a campaign. Revenue stays in Sales."]].map(([title, why]) => <div className="campaigns-list-row mk-row" key={title}><div className="mk-row-main"><strong>{title}</strong><small>{why}</small></div><span className="mk-flag">{PLAIN_STATE.UNAVAILABLE}</span></div>)}
          </div>
        </section>
      </>}
    </StateFrame></div>
  </>;
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
  return <div className="campaigns-nav"><div className="campaigns-tabs" role="tablist" aria-label="Marketing views">{tabs.map((tab,index)=><React.Fragment key={tab[0]}>{tab[3]==="sales"&&tabs[index-1]?.[3]!=="sales"&&<span className="campaigns-tab-divider" aria-hidden="true" title="Moving to Sales"/>}<button id={`campaigns-tab-${tab[0]}`} aria-controls="campaigns-tabpanel" role="tab" aria-selected={current===tab[0]} tabIndex={current===tab[0]?0:-1} onClick={()=>setCurrent(tab[0])} onKeyDown={(event)=>onKeyDown(event,index)}>{tab[2]()}<span>{tab[1]}</span></button></React.Fragment>)}</div><button className="btn btn-s btn-p campaigns-studio" title="Vibe Studio" data-solo-vibe-studio-launcher onClick={openStudio}><Ic.spark size={13}/>Vibe Studio</button></div>;
}

// Retained for the existing hidden Clients compatibility mount. It performs no
// data read and points back to the one canonical Campaigns Pipeline address.
export const Pipeline=()=>{
  const params=useParams();
  const navigate=useNavigate();
  const account=params.account;
  return <div className="solo-campaigns"><div className="campaigns-scroll"><PageHead eyebrow="Marketing" title="Pipeline moved" sub="Pipeline now lives under Marketing until it moves to Sales."/><section className="campaigns-compat"><span className="campaigns-type">Compatibility address</span><h2>Open Pipeline</h2><p>This address is preserved so older links do not silently lose their destination.</p><div className="campaigns-compat-actions"><button className="btn btn-s btn-p" disabled={!account} onClick={()=>account&&navigate(`/solo/${account}/growth/pipeline`)}>Go to Pipeline <Ic.arrow size={13}/></button></div></section></div></div>;
};

export const GrowthHub=({ salesInShell = false } = {})=>{
  const params=useParams();
  const location=useLocation();
  const target=legacySalesRoute(params.account ?? null,(params["*"]||"").split("/")[1]||"",location.search,location.hash);
  return target ? <Navigate to={target} replace/> : <MarketingWorkspace salesInShell={salesInShell}/>;
};

const MarketingWorkspace=({ salesInShell = false })=>{
  const[tab,setTab]=useSubtabRoute("solo","growth","overview");
  // Commercial addresses resolve to Sales before Marketing readers mount.
  // The owner's order (2026-10-04).
  const tabs=[['overview','Overview',()=><Ic.pulse size={14}/>],['campaigns','Campaigns',()=><Ic.bolt size={14}/>],['audience','Audience',()=><Ic.users size={14}/>],['content','Content',()=><Ic.grid size={14}/>],['social','Social',()=><Ic.send size={14}/>],['email','Email',()=><Ic.mail size={14}/>],['ads','Ads',()=><Ic.trend size={14}/>],['analytics','Analytics',()=><Ic.chart size={14}/>]];
  const data=useSoloCampaigns();
  const params=useParams();
  const location=useLocation();
  const navigate=useNavigate();
  const segment=(params["*"]||"").split("/")[1]||"";
  const query=new URLSearchParams(location.search);
  const requestedType=["all","page","funnel","form"].includes(query.get("type"))?query.get("type"):null;
  // Sales' "Open Catalog" lands on Offers, the bare catalog path. Published Vibe work lives in
  // Lead capture now, so nothing here forces a `?type=`.
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
    // SoloApp opens Vibe Studio only for a real launcher button it can return focus to; an event
    // without one was silently ignored, so every "Open Studio" in the desk did nothing. The tab
    // strip's launcher is that button.
    if(target==="studio"){
      // Prefer the button that was pressed (it carries the launcher marker, even inside an open
      // drawer, so focus comes back to it); otherwise the tab strip's own launcher.
      const pressed=event?.currentTarget;
      const launcher=pressed instanceof HTMLButtonElement&&pressed.hasAttribute("data-solo-vibe-studio-launcher")?pressed:document.querySelector(".campaigns-nav [data-solo-vibe-studio-launcher]");
      window.dispatchEvent(new CustomEvent("paige-studio",{detail:{returnFocus:launcher}}));
      return;
    }
    if(target==="clients"){ navigate(subtabPath("solo",account,"clients","people")); return; }
    // Everything else is a Marketing subtab, addressed by its slug (or a key the registry knows).
    const slug={overview:"overview",campaigns:"campaigns",capture:"overview",performance:"analytics"}[target]||target;
    navigate(subtabPath("solo",account,"growth",slug));
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
  // Previously shipped addresses resolve to their new canonical home with a replace redirect, so a
  // copied link keeps working and the address bar shows where the work lives now (§58).
  //   /growth/active                       → Campaigns (the desk's earlier address)
  //   /growth/performance                  → Analytics
  //   /growth/lead-capture[?type=&form=]   → Overview, same filter, same form panel (INT-342)
  //   /growth/brand-kit|pages|funnels|forms|builders → Overview, with where that work lives now
  //   /growth/catalog?type=                → Overview, that filter (published Vibe work)
  const movedFrom=tab==="capture"?(Object.hasOwn(MOVED,segment??"")?segment:"lead-capture"):(segment==="catalog"&&requestedType)?"catalog":null;
  const redirectTo=segment==="active"?"campaigns":segment==="performance"?"analytics":movedFrom?"overview":null;
  React.useEffect(()=>{
    const account=params.account; if(!redirectTo||!account)return;
    const old=new URLSearchParams(location.search);
    const next=new URLSearchParams();
    if(movedFrom){
      next.set("moved",movedFrom);
      const filter=MOVED[movedFrom].filter||(requestedType&&requestedType!=="all"?requestedType:null);
      if(filter) next.set("capture",filter);
      if(old.get("form")) next.set("form",old.get("form"));
    }else{
      old.forEach((value,key)=>{ if(key!=="type") next.set(key,value); });
    }
    const search=next.toString();
    navigate(`${subtabPath("solo",account,"growth",redirectTo)}${search?`?${search}`:""}`,{replace:true});
  },[redirectTo,movedFrom,requestedType,params.account,location.search,navigate]);
  const goTo=React.useCallback((target)=>onRoute(target),[onRoute]);
  // Overview's "Create campaign brief" opens the builder on the Campaigns desk, the one home for briefs.
  const createBrief=React.useCallback(()=>{
    const account=params.account; if(!account)return;
    navigate(`${subtabPath("solo",account,"growth","campaigns")}?brief=new`);
  },[navigate,params.account]);
  const clearBriefRequest=React.useCallback(()=>{
    const next=new URLSearchParams(location.search); if(!next.has("brief"))return;
    next.delete("brief");
    navigate({pathname:location.pathname,search:next.toString()},{replace:true});
  },[location.pathname,location.search,navigate]);
  // One query-string writer for Overview's own state: the capture filter, the open form panel and
  // the "moved" notice live in the address, so a reload or a shared link reopens the same view.
  const setOverviewQuery=React.useCallback((patch,{replace=true}={})=>{
    const next=new URLSearchParams(location.search);
    Object.entries(patch).forEach(([key,value])=>{ if(value==null||value==="") next.delete(key); else next.set(key,value); });
    navigate({pathname:location.pathname,search:next.toString()},{replace});
  },[location.pathname,location.search,navigate]);
  // Overview owns the briefs read (no other tab pays for it); it reports whether this account may
  // edit, so the form panel offers "Edit in Vibe Studio" only to someone who can.
  const [overviewCanManage,setOverviewCanManage]=React.useState(false);
  // The one form panel: a form's routing and every submission with what the visitor typed. Opened
  // from Overview, and by any old Lead capture link that named a form; `?form=` is its address.
  const formParam=tab==="overview"?query.get("form"):null;
  const panelForm=formParam?[...data.artifacts,...(data.drafts||[])].find((item)=>item.type==="form"&&item.id===formParam):null;
  const formMissing=!!formParam&&!panelForm&&data.phase==="ready";
  React.useEffect(()=>{ if(formMissing) setOverviewQuery({form:null,moved:"missing-form"}); },[formMissing,setOverviewQuery]);
  const openForm=React.useCallback((formId)=>{
    const account=params.account; if(!account)return;
    // Replace, like closing: a pushed entry made Back land on an identical Overview after close.
    if(tab==="overview") setOverviewQuery({form:formId});
    else navigate(`${subtabPath("solo",account,"growth","overview")}?form=${encodeURIComponent(formId)}`);
  },[navigate,params.account,setOverviewQuery,tab]);
  const closeForm=React.useCallback(()=>setOverviewQuery({form:null}),[setOverviewQuery]);
  const formRoute=!panelForm?null:panelForm.routingConfigured?(panelForm.intakePipelineId?"Routed to a pipeline (set below)":"Routed by an automation"):panelForm.intakeAlert?"No pipeline: each lead is only emailed":"Not routed: no pipeline, no alert";
  const formDetail=panelForm?{
    key:`form-${panelForm.id}`,
    title:panelForm.name,
    rows:[["Type","Form"],["State",panelForm.status==="active"?"Live":"Draft"],["Recent submissions",`${panelForm.recentSubmissions??0} in the latest ${SUBMISSION_READ_LIMIT} submissions`],["Where leads go",formRoute]],
    // A saved route re-reads Marketing, so the chain, Needs you and this row change in place (§70.1).
    body:<FormIntakePanel key={panelForm.id} tenantId={data.tenantId} formId={panelForm.id} workspace={data.pipelineWorkspace} onOpenContact={openContact} onOpenDeal={openDeal} onSaved={()=>data.retry?.()}/>,
    actions:<>{panelForm.publicHref&&<a className="btn btn-s" href={panelForm.publicHref} target="_blank" rel="noreferrer">Open public link <Ic.arrow size={12}/></a>}{overviewCanManage&&<StudioLauncher label="Edit in Vibe Studio"/>}</>,
    note:"The form itself is built in Vibe Studio. Its routing saves here or in Vibe Studio’s form settings; both are the same setting.",
  }:null;
  const openAsset=React.useCallback((artifact)=>setDetail({title:artifact.name,rows:[["Type",TYPE_LABEL[artifact.type]],["State","Live"],["Updated",formatDate(artifact.updatedAt)],["Where leads go",`Through the form on this ${artifact.type}. Its routing lives on that form.`]],actions:artifact.publicHref?<a className="btn btn-s" href={artifact.publicHref} target="_blank" rel="noreferrer">Open public link <Ic.arrow size={12}/></a>:null,note:"Visits aren’t recorded on public pages yet, so there is no conversion rate."}),[setDetail]);
  const captureFilter=CAPTURE_FILTERS.includes(query.get("capture"))?query.get("capture"):"all";
  const moved=tab==="overview"&&Object.hasOwn(MOVED,query.get("moved")??"")?query.get("moved"):null;
  const toSales=React.useCallback(()=>{ const account=params.account; if(!account)return; navigate(salesInShell?subtabPath("solo",account,"sales","pipeline"):subtabPath("solo",account,"growth","pipeline")); },[navigate,params.account,salesInShell]);
  let body=<OverviewTab data={data} moved={moved} scrollToCapture={Boolean(moved&&moved!=="missing-form")||captureFilter!=="all"} onDismissMoved={()=>setOverviewQuery({moved:null})} onCanManage={setOverviewCanManage} captureFilter={captureFilter} onCaptureFilter={(filter)=>setOverviewQuery({capture:filter==="all"?null:filter})} onGo={goTo} onCreateBrief={createBrief} onOpenSales={toSales} onOpenForm={openForm} onOpenAsset={openAsset} onOpenContact={openContact} onOpenDeal={openDeal}/>;
  if(redirectTo) body=null;
  else if(tab==="campaigns") body=<Campaigns data={data} onRoute={onRoute} autoOpenBrief={query.get("brief")==="new"} onAutoOpenConsumed={clearBriefRequest}/>;
  else if(tab==="analytics") body=<MarketingAnalytics data={data} onGo={goTo}/>;
  else if(tab==="catalog") body=<Catalog setDetail={setDetail}/>;
  else if(tab==="sales") body=<Sales data={data} setDetail={setDetail} onOpenCatalog={openCatalogOffers} onOpenClients={openClients} onOpenPipeline={openPipeline}/>;
  else if(tab==="pipeline") body=<PipelineSurface key={data.tenantId} data={data} setDetail={setDetail} focusDealId={query.get("deal")} onClearFocus={()=>{const next=new URLSearchParams(location.search);next.delete("deal");navigate({pathname:location.pathname,search:next.toString()},{replace:true});}}/>;
  else if(tab==="social") body=<Social data={data} onOpenCompass={openCompass} onOpenPipeline={openPipeline}/>;
  else if(tab==="audience") body=<MarketingAudience tenantId={data.tenantId} onOpenClients={()=>params.account&&navigate(subtabPath("solo",params.account,"clients","people"))}/>;
  else if(tab==="email") body=<MarketingEmail tenantId={data.tenantId} onOpenAudience={()=>setTab("audience")} onOpenConnections={params.account?()=>navigate(`${subtabPath("solo",params.account,"settings","connections")}?segment=communications`):null} onOpenSettings={params.account?()=>navigate(`${subtabPath("solo",params.account,"settings","connections")}?segment=registration`):null}/>;
  else if(tab==="content") body=<MarketingContent tenantId={data.tenantId} published={{phase:data.phase,pages:data.artifacts.filter((a)=>a.type==="page").length,funnels:data.artifacts.filter((a)=>a.type==="funnel").length,forms:data.artifacts.filter((a)=>a.type==="form").length,unpublished:(data.drafts||[]).length}} onOpenCapture={()=>goTo("capture")} onRetryPublished={()=>data.retry?.()} studioLauncher={<StudioLauncher/>}/>;
  else if(tab==="ads") body=<MarketingAds tenantId={data.tenantId} onOpenIntegrations={params.account?()=>navigate(subtabPath("solo",params.account,"settings","integrations")):null}/>;
  return <div className="solo-campaigns" data-campaigns-view={tab}><h1 className="campaigns-sr-only">Marketing</h1><CampaignTabs tabs={tabs} current={tab==="capture"?"overview":tab} setCurrent={setTab}/><div id="campaigns-tabpanel" role="tabpanel" aria-labelledby={`campaigns-tab-${tab==="capture"?"overview":tab}`} className="campaigns-scroll">{tab==="catalog" && query.get("origin")==="sales" && !workspaceChanged && data.tenantId && data.phase!=="resolving" && <div className="so-source-return"><button type="button" className="btn btn-s btn-p" onClick={()=>navigate(`${subtabPath("solo",params.account,"growth","sales")}${query.get("resume")==="terms" ? "?resume=terms" : ""}`)}>{query.get("resume")==="terms" ? "Return to commercial terms" : "Return to Sales"}</button><span>Finish offer setup here in Offers, then return when ready.</span></div>}{body}</div><DetailDrawer detail={detail||formDetail} onClose={detail?closeDetail:closeForm}/></div>;
};
