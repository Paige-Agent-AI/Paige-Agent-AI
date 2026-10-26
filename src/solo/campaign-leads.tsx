// Campaigns › dossier › Brought in › the leads themselves (Experience 03 S1d-2, owner-approved 2026-10-12 as
// reviewed: collapsed under the lane's counts). The counts are said once (the lane) and the rows sit right under
// them. Each lead was credited when it arrived; its place in Sales is read as it stands now (useCampaignLeads).
// Who a lead is comes from the server, which returns names and record ids only to the workspace's owners and
// admins (members and an agency manager working in a sub-account get none). Read only: nothing here contacts
// anyone or moves an opportunity.
import React from "react";
import { ATTRIBUTION_LABEL, statusLabel, statusTone, type CampaignLead, type CampaignLeadsState } from "./useCampaignLeads";

// The year shows only when it isn't this year, so an old lead never reads as a recent one.
const day = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, thisYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
};

// Who a lead is, in words that are true for this viewer: a member is not shown names; an owner sees the name,
// that the contact has no name on file, or that the lead has not become a contact yet.
function who(lead: CampaignLead, canManage: boolean): { text: string; hidden: boolean } {
  if (lead.name) return { text: lead.name, hidden: false };
  if (!canManage) return { text: "A lead", hidden: true };
  if (lead.hasContact) return { text: "Contact with no name", hidden: false };
  return { text: lead.status === "waiting" ? "Being saved as a contact" : "Not saved as a contact", hidden: false };
}

// F8 (Progress to customer): what Sales' own records say about the opportunity, in words that promise
// nothing they don't. The recipient is a name (an owner sees it or that no one holds it yet; a member
// doesn't). Invoices are raw counts; a won deal carries Sales' own close date.
export function progressLine(lead: CampaignLead, canManage: boolean): string | null {
  if (lead.status !== "open" && lead.status !== "won" && lead.status !== "lost") return null;
  const parts: string[] = [];
  if (canManage) parts.push(lead.ownerName ? `with ${lead.ownerName}` : "no one in Sales yet");
  if (lead.invoiceCount > 0) {
    parts.push(lead.invoicePaidCount >= lead.invoiceCount
      ? (lead.invoiceCount === 1 ? "invoice paid" : `${lead.invoiceCount} invoices, all paid`)
      : `${lead.invoicePaidCount} of ${lead.invoiceCount} invoices paid`);
  } else {
    parts.push("no invoice yet");
  }
  if (lead.status === "won" && lead.wonAt) parts.push(`won ${day(lead.wonAt)}`);
  return parts.join(" · ");
}

function LeadRow({ lead, canManage, showPipeline }: { lead: CampaignLead; canManage: boolean; showPipeline: boolean }) {
  const where = showPipeline && lead.status === "open" && lead.pipelineName ? `${lead.pipelineName} · ` : "";
  const person = who(lead, canManage);
  const progress = progressLine(lead, canManage);
  return (
    <li className="cl-row">
      <span className={`cl-n ${person.hidden ? "cc-hidden" : ""} ${!person.hidden && !lead.name ? "cl-pending" : ""}`}>{person.text}</span>
      <time className="cl-when" dateTime={lead.receivedAt ?? undefined}>{day(lead.receivedAt)}</time>
      <span className="cl-via">{ATTRIBUTION_LABEL[lead.attribution]}{lead.formName ? ` · ${lead.formName}` : ""}</span>
      {progress && <span className="cl-via cl-progress">{progress}</span>}
      <span className={`loop-state cl-state ${statusTone(lead.status)}`}><span className="sd"/>{where}{statusLabel(lead)}</span>
    </li>
  );
}

export function CampaignLeadRows({ id, leads }: { id: string; leads: CampaignLeadsState }) {
  // Name the pipeline once when every lead with an opportunity sits in the same one; otherwise on each row.
  const pipelines = [...new Set(leads.leads.filter((lead) => lead.pipelineName && lead.status !== "waiting" && lead.status !== "failed").map((lead) => lead.pipelineName))];
  return (
    <div className="cl" id={id}>
      {pipelines.length === 1 && <p className="cl-in">Stages are in {pipelines[0]}, in Sales.</p>}
      <ul className="cl-list">{leads.leads.map((lead) => <LeadRow key={lead.id} lead={lead} canManage={leads.canManage} showPipeline={pipelines.length > 1}/>)}</ul>
      {leads.truncated && <p className="cc-foot">Showing the newest {leads.leads.length}. The counts above cover all {leads.counts.leads.toLocaleString()}.</p>}
      {/* F8: say what is NOT linked, rather than letting a stage or an invoice read as a full handoff. */}
      <p className="cc-foot">An agreement or a booked call isn't linked to an opportunity in the records yet, so neither shows here. When those links exist, they will.</p>
      {!leads.canManage && <p className="cc-foot">Owners and admins see who each lead is.</p>}
    </div>
  );
}
