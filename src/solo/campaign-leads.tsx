// Campaigns › dossier: the leads this campaign brought in (Experience 03 S1d). Each lead was credited when it
// arrived — through a form attached to this campaign, a link tagged with its reference, or both — and its
// place in Sales is read as it stands now (useCampaignLeads). Owners and admins see who; members see that a
// lead arrived and where it stands. Read only: nothing here contacts anyone or moves an opportunity.
import React from "react";
import { Ic as SharedIcons } from "./_shared";
import { ATTRIBUTION_LABEL, statusLabel, statusTone, useCampaignLeads, type CampaignLead } from "./useCampaignLeads";

const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;

const day = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const list = (names: readonly string[]) => names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// Who a lead is, in words that are true for this viewer: a member is not shown names; an owner sees the name,
// or that the lead has not become a contact yet.
function who(lead: CampaignLead, canManage: boolean): { text: string; hidden: boolean } {
  if (lead.name) return { text: lead.name, hidden: false };
  if (!canManage) return { text: "A lead", hidden: true };
  return { text: lead.status === "waiting" ? "Being saved as a contact" : "Not saved as a contact", hidden: false };
}

function LeadRow({ lead, canManage, showPipeline }: { lead: CampaignLead; canManage: boolean; showPipeline: boolean }) {
  const where = showPipeline && lead.status === "open" && lead.pipelineName ? `${lead.pipelineName} · ` : "";
  const person = who(lead, canManage);
  return (
    <li className="cl-row">
      <span className={`cl-n ${person.hidden ? "cc-hidden" : ""} ${!person.hidden && !lead.name ? "cl-pending" : ""}`}>{person.text}</span>
      <time className="cl-when" dateTime={lead.receivedAt ?? undefined}>{day(lead.receivedAt)}</time>
      <span className="cl-via">{ATTRIBUTION_LABEL[lead.attribution]}{lead.formName ? ` · ${lead.formName}` : ""}</span>
      <span className={`loop-state cl-state ${statusTone(lead.status)}`}><span className="sd"/>{where}{statusLabel(lead)}</span>
    </li>
  );
}

export function CampaignLeads({ tenantId, briefId, shortRef }: { tenantId: string | null; briefId: string; shortRef: string | null }) {
  const leads = useCampaignLeads(tenantId, briefId);
  if (leads.phase === "loading") return <div className="campaigns-skeleton" style={{ padding: 0 }}><span style={{ height: 72 }}/></div>;
  if (leads.phase === "error") return <div className="cl"><div className="dw-note" role="alert">This campaign's leads couldn't load. Nothing was changed. <button type="button" className="btn btn-s" onClick={leads.retry}>Try again</button></div></div>;

  const { counts } = leads;
  const forms = leads.captureForms.map((form) => form.name);
  const tag = shortRef ? <b>{shortRef}</b> : "its reference";
  // Name the pipeline once when every lead with an opportunity sits in the same one; otherwise on each row.
  const pipelines = [...new Set(leads.leads.filter((lead) => lead.pipelineName && lead.status !== "waiting" && lead.status !== "failed").map((lead) => lead.pipelineName))];
  return (
    <div className="cl">
      {counts.leads > 0 ? <>
        <p className="cl-tally" aria-label={`${plural(counts.leads, "lead", "leads")}, ${counts.opportunities} became opportunities, ${counts.won} won, ${counts.lost} lost`}>
          <span><b>{counts.leads.toLocaleString()}</b> {counts.leads === 1 ? "lead" : "leads"}</span>
          <span><b>{counts.opportunities.toLocaleString()}</b> {counts.opportunities === 1 ? "opportunity" : "opportunities"}</span>
          <span className={counts.won ? "is-won" : ""}><b>{counts.won.toLocaleString()}</b> won</span>
          <span><b>{counts.lost.toLocaleString()}</b> lost</span>
          {pipelines.length === 1 && <span className="cl-in">in {pipelines[0]}</span>}
        </p>
        <ul className="cl-list">{leads.leads.map((lead) => <LeadRow key={lead.id} lead={lead} canManage={leads.canManage} showPipeline={pipelines.length > 1}/>)}</ul>
        {leads.truncated && <p className="cc-foot">Showing the newest {leads.leads.length}. The counts cover all {counts.leads.toLocaleString()}.</p>}
        {!leads.canManage && <p className="cc-foot">Owners and admins see who each lead is.</p>}
      </> : <div className="cl-empty">
        <Ic.users size={15}/>
        <p>{forms.length
          ? <>No leads yet. Anyone who fills in {list(forms)}, or arrives on a link tagged {tag}, shows up here.</>
          : <>No leads yet, and no form is attached. Attach the form people sign up on under <b>Land</b> above, or share a link tagged {tag}.</>}</p>
      </div>}
      {leads.uncredited > 0 && <p className="cl-note"><Ic.bell size={12}/> {plural(leads.uncredited, "lead", "leads")} on this campaign's forms also fit another campaign, so {leads.uncredited === 1 ? "it isn't" : "they aren't"} counted here. Tag each campaign's link with its own reference to tell them apart.</p>}
      <p className="cc-foot">A lead is credited to a campaign the moment it arrives, never afterwards and never by a guess. Revenue isn't credited to campaigns yet.</p>
    </div>
  );
}
