import React from "react";
import {
  useFormIntake,
  type FormIntakeField,
  type FormIntakeSettings,
  type FormIntakeSubmission,
} from "./useFormIntake";
import type { PipelineWorkspace } from "./useSoloCampaigns";
import { formatAnswer, humanize, pipelineName, stageLabel, submissionChips, submissionTitle } from "./form-intake-model";

/**
 * The form's own intake, inside the Catalog Details drawer (owner-approved design, 2026-09-29):
 * where each submission goes — a pipeline stage and an alert address — and every submission with
 * what the visitor actually typed, under the form's own labels, and where it went.
 *
 * Owners and admins edit; anyone else reads. The server decides either way (growth_form_set_intake
 * re-checks the caller), so a refusal is shown, never hidden.
 */

const EMAIL = /^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$/;

type Props = {
  tenantId: string | null;
  formId: string;
  workspace: PipelineWorkspace;
  onOpenContact: (contactId: string) => void;
  onOpenDeal: (dealId: string) => void;
};

type Draft = { enabled: boolean; pipelineId: string; stageId: string; email: string };

const toDraft = (s: FormIntakeSettings): Draft => ({
  enabled: s.autoCreateDeal,
  pipelineId: s.pipelineId ?? "",
  stageId: s.stageId ?? "",
  email: s.notifyEmail ?? "",
});

const sameDraft = (a: Draft, b: Draft) =>
  a.enabled === b.enabled && a.email.trim() === b.email.trim() &&
  (!a.enabled || (a.pipelineId === b.pipelineId && a.stageId === b.stageId));

export function FormIntakePanel({ tenantId, formId, workspace, onOpenContact, onOpenDeal }: Props) {
  const intake = useFormIntake(tenantId, formId);
  if (intake.phase === "loading") {
    return <div className="intake-skeleton" aria-busy="true" aria-label="Loading this form's settings and submissions"><span /><span /><span /></div>;
  }
  if (intake.phase === "missing") {
    return <p className="campaigns-detail-note">This form is no longer in this workspace.</p>;
  }
  if (intake.phase === "error" || !intake.settings) {
    return (
      <div className="intake-problem" role="alert">
        <span>This form's settings and submissions didn't load.</span>
        <button type="button" className="btn btn-s" onClick={intake.retry}>Try again</button>
      </div>
    );
  }
  return (
    <>
      {workspace.canManage
        ? <IntakeEditor key={formId} settings={intake.settings} workspace={workspace} save={intake.save} />
        : <IntakeReadOnly settings={intake.settings} workspace={workspace} />}
      <Submissions
        fields={intake.fields}
        submissions={intake.submissions}
        hasMore={intake.hasMore}
        loadingMore={intake.loadingMore}
        loadMore={intake.loadMore}
        workspace={workspace}
        onOpenContact={onOpenContact}
        onOpenDeal={onOpenDeal}
      />
    </>
  );
}

function routeLabel(workspace: PipelineWorkspace, settings: FormIntakeSettings) {
  if (!settings.autoCreateDeal) return "Off";
  const pipeline = pipelineName(workspace, settings.pipelineId) ?? "A pipeline";
  const stage = settings.stageId ? stageLabel(workspace, settings.stageId) : "first stage";
  return `${pipeline} → ${stage ?? "a stage"}`;
}

function IntakeReadOnly({ settings, workspace }: { settings: FormIntakeSettings; workspace: PipelineWorkspace }) {
  return (
    <section className="intake-section" aria-labelledby="intake-heading">
      <h3 id="intake-heading">When someone submits</h3>
      <p className="intake-lede">An owner or admin of this business sets where submissions go.</p>
      <div className="intake-card intake-readonly">
        <div className="campaigns-detail-row"><span>Pipeline</span><strong>{routeLabel(workspace, settings)}</strong></div>
        <div className="campaigns-detail-row"><span>Email alerts</span><strong>{settings.notifyEmail ? "On" : "Off"}</strong></div>
      </div>
    </section>
  );
}

function IntakeEditor({ settings, workspace, save }: {
  settings: FormIntakeSettings;
  workspace: PipelineWorkspace;
  save: (next: FormIntakeSettings) => Promise<{ ok: boolean; message: string }>;
}) {
  const saved = React.useMemo(() => toDraft(settings), [settings]);
  const [draft, setDraft] = React.useState<Draft>(saved);
  const [status, setStatus] = React.useState<{ tone: "ok" | "bad" | "idle"; text: string }>({ tone: "idle", text: "" });
  const [saving, setSaving] = React.useState(false);
  const [triedSave, setTriedSave] = React.useState(false);

  const pipelines = workspace.pipelines.filter(
    (p) => p.lifecycleStatus === "active" || p.id === draft.pipelineId,
  );
  const stages = workspace.stages
    .filter((s) => s.pipelineId === draft.pipelineId && ((!s.archivedAt && s.stageType !== "won" && s.stageType !== "lost") || s.id === draft.stageId))
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const dirty = !sameDraft(draft, saved);
  // An address is judged when the owner saves, never while it is being typed.
  const emailProblem = draft.email.trim() && !EMAIL.test(draft.email.trim())
    ? "Enter a full address, like name@yourbusiness.com." : null;
  const pipelineProblem = draft.enabled && !draft.pipelineId ? "Choose the pipeline new leads go into." : null;

  const update = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setStatus({ tone: "idle", text: "" }); };

  const onToggle = () => {
    const enabled = !draft.enabled;
    const pipelineId = enabled && !draft.pipelineId
      ? (workspace.pipelines.find((p) => p.isDefault && p.lifecycleStatus === "active") ?? workspace.pipelines.find((p) => p.lifecycleStatus === "active"))?.id ?? ""
      : draft.pipelineId;
    update({ enabled, pipelineId, stageId: pipelineId === draft.pipelineId ? draft.stageId : "" });
  };

  const onSave = async () => {
    setTriedSave(true);
    if (emailProblem || pipelineProblem) return;
    setSaving(true);
    const result = await save({
      autoCreateDeal: draft.enabled,
      pipelineId: draft.enabled ? draft.pipelineId || null : null,
      stageId: draft.enabled ? draft.stageId || null : null,
      notifyEmail: draft.email.trim() || null,
    });
    setSaving(false);
    setStatus({ tone: result.ok ? "ok" : "bad", text: result.ok ? "Saved" : result.message });
    if (result.ok) setTriedSave(false);
  };

  React.useEffect(() => { setDraft(saved); }, [saved]);

  const noPipelines = workspace.pipelines.every((p) => p.lifecycleStatus !== "active");

  return (
    <section className="intake-section" aria-labelledby="intake-heading">
      <h3 id="intake-heading">When someone submits</h3>
      <p className="intake-lede">Every submission is saved below. Choose where it goes next.</p>
      <div className="intake-card">
        <div className="intake-toggle">
          <div>
            <strong id="intake-toggle-label">Add them to a pipeline</strong>
            <small id="intake-toggle-help">Paige matches or creates the contact, then opens a deal.</small>
          </div>
          <button
            type="button"
            className="intake-switch"
            role="switch"
            aria-checked={draft.enabled}
            aria-labelledby="intake-toggle-label"
            aria-describedby="intake-toggle-help"
            onClick={onToggle}
            disabled={saving}
          />
        </div>
        {draft.enabled && (noPipelines && !draft.pipelineId ? (
          <p className="intake-hint">There's no pipeline in this workspace yet. Create one under Pipeline, then come back to route this form into it.</p>
        ) : (
          <div className="intake-route">
            <label>
              Pipeline
              <select
                value={draft.pipelineId}
                onChange={(e) => update({ pipelineId: e.target.value, stageId: "" })}
                aria-invalid={triedSave && !!pipelineProblem}
                disabled={saving}
              >
                {!draft.pipelineId && <option value="">Choose a pipeline</option>}
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>
              Stage
              <select value={draft.stageId} onChange={(e) => update({ stageId: e.target.value })} disabled={saving || !draft.pipelineId}>
                <option value="">First stage of the pipeline</option>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
        ))}
        {triedSave && pipelineProblem && <p className="intake-error">{pipelineProblem}</p>}
        <div className="intake-divider" />
        <label htmlFor="intake-email">Email each submission to</label>
        <input
          id="intake-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@yourbusiness.com"
          value={draft.email}
          onChange={(e) => update({ email: e.target.value })}
          aria-invalid={triedSave && !!emailProblem}
          aria-describedby={triedSave && emailProblem ? "intake-email-error" : "intake-email-hint"}
          disabled={saving}
        />
        {triedSave && emailProblem
          ? <p className="intake-error" id="intake-email-error">{emailProblem}</p>
          : <p className="intake-hint" id="intake-email-hint">One address. It gets the answers and a link back here. Leave it blank to turn email off.</p>}
        {(saving || dirty || status.tone !== "idle") && <div className="intake-foot">
          <span className={`intake-status${status.tone === "ok" && !dirty ? " is-ok" : status.tone === "bad" ? " is-bad" : ""}`} role={status.tone === "bad" ? "alert" : "status"}>
            {saving ? "Saving…" : status.tone === "bad" ? status.text : dirty ? "Unsaved changes" : status.tone === "ok" ? "Saved" : ""}
          </span>
          {dirty && (
            <div className="intake-actions">
              <button type="button" className="btn btn-s" onClick={() => { setDraft(saved); setTriedSave(false); setStatus({ tone: "idle", text: "" }); }} disabled={saving}>Discard</button>
              <button type="button" className="btn btn-p btn-s" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
            </div>
          )}
        </div>}
      </div>
    </section>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Submissions({ fields, submissions, hasMore, loadingMore, loadMore, workspace, onOpenContact, onOpenDeal }: {
  fields: FormIntakeField[];
  submissions: FormIntakeSubmission[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  workspace: PipelineWorkspace;
  onOpenContact: (id: string) => void;
  onOpenDeal: (id: string) => void;
}) {
  if (submissions.length === 0) {
    return (
      <section className="intake-section" aria-labelledby="subs-heading">
        <div className="subs-head"><h3 id="subs-heading">Latest submissions</h3></div>
        <div className="subs-empty">
          <strong>Nothing submitted yet</strong>
          When someone fills in this form, their answers appear here, newest first, with where each one went.
        </div>
      </section>
    );
  }
  return (
    <section className="intake-section" aria-labelledby="subs-heading">
      <div className="subs-head"><h3 id="subs-heading">Latest submissions</h3><small>Newest first</small></div>
      <div className="subs-list">
        {submissions.map((row, index) => {
          const known = new Set(fields.map((f) => f.key));
          const extra = Object.keys(row.answers).filter((key) => !known.has(key));
          return (
            <details className="sub" key={row.id} open={index === 0}>
              <summary>
                <div className="sub-top">
                  <strong>{submissionTitle(row, fields)}</strong>
                  <span className="sub-when"><time dateTime={row.createdAt}>{when(row.createdAt)}</time><Chevron /></span>
                </div>
                <div className="sub-states">
                  {submissionChips(row, workspace).map((chip) => <span key={chip.text} className={`pill pill-${chip.tone}`}>{chip.text}</span>)}
                </div>
              </summary>
              <dl className="sub-answers">
                {fields.map((field) => {
                  const value = formatAnswer(field, row.answers[field.key]);
                  return <div key={field.key}><dt>{field.label}</dt><dd className={value ? undefined : "is-empty"}>{value ?? "Left blank"}</dd></div>;
                })}
                {extra.map((key) => {
                  const value = formatAnswer(undefined, row.answers[key]);
                  return <div key={key}><dt>{humanize(key)}<em>No longer on the form</em></dt><dd className={value ? undefined : "is-empty"}>{value ?? "Left blank"}</dd></div>;
                })}
              </dl>
              {(row.contactId || row.dealId) && (
                <div className="sub-links">
                  {row.contactId && <button type="button" className="btn btn-s" onClick={() => onOpenContact(row.contactId!)}>Open contact</button>}
                  {row.dealId && <button type="button" className="btn btn-s" onClick={() => onOpenDeal(row.dealId!)}>Open deal</button>}
                </div>
              )}
            </details>
          );
        })}
      </div>
      {hasMore && (
        <button type="button" className="btn btn-s subs-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      )}
    </section>
  );
}

function Chevron() {
  return (
    <svg className="sub-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
