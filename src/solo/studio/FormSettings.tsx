// Where a form's requests go and who hears about them — for a draft as well as a live form. One
// write seam (growth_form_set_intake, owner/admin only) through the same hook the Catalog uses; a
// save is reported only when the server returns the saved row.
import React from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useFormIntake } from "../useFormIntake";

interface Pipeline { id: string; name: string; stages: { id: string; label: string }[] }

// Scoped to the active workspace explicitly: RLS admits every workspace the person belongs to, and a
// form can only route into its own workspace's pipelines.
function usePipelines(tenantId: string): { pipelines: Pipeline[]; loaded: boolean } {
  const [state, setState] = React.useState<{ pipelines: Pipeline[]; loaded: boolean }>({ pipelines: [], loaded: false });
  React.useEffect(() => {
    let live = true;
    (async () => {
      const [{ data: ps }, { data: ss }] = await Promise.all([
        supabase.from("pipelines").select("id, name").eq("tenant_id", tenantId).order("name"),
        supabase.from("pipeline_stages").select("id, label, pipeline_id, order_index").eq("tenant_id", tenantId).order("order_index"),
      ]);
      if (!live) return;
      const stages = (ss ?? []) as { id: string; label: string; pipeline_id: string }[];
      setState({
        loaded: true,
        pipelines: ((ps ?? []) as { id: string; name: string }[]).map((p) => ({
          id: p.id, name: p.name, stages: stages.filter((s) => s.pipeline_id === p.id).map((s) => ({ id: s.id, label: s.label })),
        })),
      });
    })().catch(() => { if (live) setState({ pipelines: [], loaded: true }); });
    return () => { live = false; };
  }, [tenantId]);
  return state;
}

export function FormSettings({ tenantId, formId, onClose, onSaved }: {
  tenantId: string; formId: string; onClose: () => void; onSaved: () => void;
}) {
  const intake = useFormIntake(tenantId, formId, 1);
  const { pipelines, loaded } = usePipelines(tenantId);
  const [draft, setDraft] = React.useState<{ autoCreateDeal: boolean; pipelineId: string | null; stageId: string | null; notifyEmail: string }>({ autoCreateDeal: false, pipelineId: null, stageId: null, notifyEmail: "" });
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => {
    if (!intake.settings) return;
    setDraft({
      autoCreateDeal: intake.settings.autoCreateDeal,
      pipelineId: intake.settings.pipelineId,
      stageId: intake.settings.stageId,
      notifyEmail: intake.settings.notifyEmail ?? "",
    });
  }, [intake.settings]);

  const pipeline = pipelines.find((p) => p.id === draft.pipelineId) ?? null;
  const save = async () => {
    setSaving(true); setMessage(null);
    const res = await intake.save({ ...draft, notifyEmail: draft.notifyEmail.trim() || null });
    setSaving(false);
    setMessage({ ok: res.ok, text: res.ok ? "Saved." : res.message });
    if (res.ok) onSaved();
  };

  return (
    <aside className="vs-inspector" aria-label="Form settings">
      <header>
        <b>Form settings</b>
        <button type="button" className="vs-icon-btn" aria-label="Close form settings" onClick={onClose}><X size={16} /></button>
      </header>
      {intake.phase === "loading" ? (
        <p className="vs-inspector-note" role="status">Loading…</p>
      ) : intake.phase !== "ready" ? (
        <p className="vs-alert" role="alert">These settings couldn't be loaded. <button type="button" className="vs-link" onClick={intake.retry}>Try again</button></p>
      ) : !intake.canEdit ? (
        <p className="vs-inspector-note">Only this workspace's owner or an admin can change where requests go.</p>
      ) : (
        <div className="vs-inspector-body">
          <div className="vs-toggle">
            <span id="vs-deal-label">Add each request to a pipeline</span>
            <button
              type="button" role="switch" aria-checked={draft.autoCreateDeal} aria-labelledby="vs-deal-label"
              onClick={() => setDraft((d) => ({ ...d, autoCreateDeal: !d.autoCreateDeal, pipelineId: !d.autoCreateDeal ? d.pipelineId ?? pipelines[0]?.id ?? null : d.pipelineId }))}
            ><i aria-hidden="true" /></button>
          </div>
          {draft.autoCreateDeal && (
            !loaded ? <p className="vs-inspector-note">Loading your pipelines…</p>
            : pipelines.length === 0 ? <p className="vs-inspector-note">You don't have a pipeline yet. Create one in Campaigns, then come back.</p>
            : (
              <>
                <label className="vs-field">
                  <span>Pipeline</span>
                  <select value={draft.pipelineId ?? ""} onChange={(e) => setDraft((d) => ({ ...d, pipelineId: e.target.value || null, stageId: null }))}>
                    {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="vs-field">
                  <span>Stage</span>
                  <select value={draft.stageId ?? ""} onChange={(e) => setDraft((d) => ({ ...d, stageId: e.target.value || null }))}>
                    <option value="">First stage</option>
                    {(pipeline?.stages ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </label>
              </>
            )
          )}
          <label className="vs-field">
            <span>Email each request to</span>
            <input type="email" value={draft.notifyEmail} placeholder="you@yourbusiness.com" onChange={(e) => setDraft((d) => ({ ...d, notifyEmail: e.target.value }))} />
            <small>Only you see this. Leave it empty to skip the email.</small>
          </label>
          <div className="vs-inspector-foot">
            {message && <span role={message.ok ? "status" : "alert"} className={message.ok ? "vs-ok" : "vs-alert"}>{message.text}</span>}
            <button type="button" className="vs-btn vs-btn-violet" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      )}
    </aside>
  );
}
