import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { useSoloBusinessContext } from "./data/useSoloBusinessContext";
import { applySetupProposal, prepareOwnerConfirmedBrief, setupSourceLabel, validateSoloSetupBrief, type SoloSetupBrief } from "./settings-setup-contract";
import { INTERVIEW_FIELDS, cleanInterviewCheckpoint, isOperationalProposal, nextInterviewField, type InterviewField } from "./solo-business-interview-contract";
import "./solo-business-interview.css";

async function checkpointRpc(name: string, args: Record<string, unknown>) {
  try {
    // Generated types follow the forward migration; the caller JWT owns the scope.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (supabase as any).rpc(name, args);
  } catch { return { data: null, error: true }; }
}

export function SoloBusinessInterview({ threadId, busy, refreshEpoch, onPause }: {
  threadId: string | null; busy: boolean; refreshEpoch: number; onPause: () => void;
}) {
  const context = useSoloBusinessContext();
  const { activeTenantId, activeTenant } = useTenantContext();
  const navigate = useNavigate();
  const panel = useRef<HTMLElement | null>(null);
  const scope = `${activeTenantId}:${threadId}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const progressGeneration = useRef(0);
  const returnFocusField = useRef<InterviewField | null>(null);
  const [draft, setDraft] = useState<{ brief: SoloSetupBrief; revision: number | null; field: InterviewField; fields: InterviewField[]; proposalId: string | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const [nextField, setNextField] = useState<InterviewField | null | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const ready = !context.loading && !context.error && context.resolvedTenantId === activeTenantId && context.accessScope === "owner_full" && Number.isSafeInteger(context.contextRevision);
  const locked = busy || context.saving || checkpointBusy;
  const setup = () => { if (activeTenant?.account_number) navigate(`/solo/${activeTenant.account_number}/settings/setup/business-profile`); };
  const refreshRef = useRef(context.refresh); refreshRef.current = context.refresh;

  useEffect(() => { liveScope.current = scope; progressGeneration.current++; returnFocusField.current = null; setDraft(null); setMessage(null); setError(null); setPaused(false); setNextField(undefined); setCheckpointBusy(false); return () => { liveScope.current = ""; progressGeneration.current++; }; }, [scope]);
  useEffect(() => {
    if (locked || !ready || !returnFocusField.current) return;
    const field = returnFocusField.current;
    const capturedScope = scope;
    const frame = requestAnimationFrame(() => {
      if (liveScope.current !== capturedScope) return;
      const target = draft ? panel.current?.querySelector<HTMLTextAreaElement>("textarea")
        : panel.current?.querySelector<HTMLButtonElement>(`[data-interview-field="${field}"]`);
      if (target && !target.disabled) { target.focus(); returnFocusField.current = null; }
    });
    return () => cancelAnimationFrame(frame);
  }, [locked, ready, draft, scope, error]);
  useEffect(() => { if (refreshEpoch > 0) void refreshRef.current(); }, [refreshEpoch]);
  useEffect(() => {
    if (!activeTenantId || !threadId) return;
    let current = true;
    const generation = ++progressGeneration.current;
    void checkpointRpc("get_solo_business_interview_checkpoint", { _thread_id: threadId }).then(result => {
      if (!current || liveScope.current !== scope || generation !== progressGeneration.current) return;
      if (result.error) { setError("Interview progress could not be loaded. Your Setup records are still the source of truth."); return; }
      const saved = cleanInterviewCheckpoint(result.data, activeTenantId, threadId);
      if (saved) { setNextField(saved.nextField); setPaused(saved.phase === "paused"); }
    });
    return () => { current = false; };
  }, [activeTenantId, threadId, scope]);

  async function checkpoint(phase: "active" | "paused" | "completed", field: InterviewField | null, revision: number | null) {
    if (!activeTenantId || !threadId) return false;
    // A deliberate navigation/save supersedes any earlier read in this scope.
    const generation = ++progressGeneration.current;
    const result = await checkpointRpc("save_solo_business_interview_checkpoint", {
      _expected_tenant_id: activeTenantId, _thread_id: threadId,
      _checkpoint: { phase, nextField: field }, _expected_context_revision: revision,
    });
    return generation === progressGeneration.current && !result.error && !!cleanInterviewCheckpoint(result.data, activeTenantId, threadId);
  }
  function edit(field: InterviewField) {
    if (!ready || locked) return;
    setDraft({ brief: { ...context.brief, provenance: { ...context.brief.provenance } }, revision: context.contextRevision, field, fields: [field], proposalId: null });
    setMessage(null); setError(null);
  }
  function reviewProposal() {
    const proposal = context.pendingProposal;
    if (!ready || locked || !proposal || !isOperationalProposal(proposal)) return;
    const field = INTERVIEW_FIELDS.find(([key]) => key in proposal.patch)![0];
    setDraft({ brief: applySetupProposal(context.brief, proposal), revision: context.contextRevision, field, fields: INTERVIEW_FIELDS.filter(([key]) => key in proposal.patch).map(([key]) => key), proposalId: proposal.id });
    setMessage(null); setError(null);
  }
  async function save() {
    if (!draft || !ready || locked) return;
    if (draft.revision !== context.contextRevision || draft.brief.updatedAt !== context.brief.updatedAt) {
      setError("Setup changed while you were reviewing. Cancel this edit and reload before saving."); return;
    }
    const confirmed = prepareOwnerConfirmedBrief(draft.brief, undefined, context.brief, Object.fromEntries(draft.fields.map(field => [field,
      context.brief.provenance[field]?.source === "connection_sourced" && draft.brief[field].trim() !== context.brief[field].trim() ? "override" as const : "adopt" as const,
    ])));
    const validation = validateSoloSetupBrief(confirmed);
    if (Object.keys(validation).length) { setError(Object.values(validation)[0] ?? "Review the business details in Setup before saving."); return; }
    const capturedScope = scope;
    const result = await context.save({ brief: confirmed, businessOwners: context.businessOwners,
      primaryBusinessEmail: context.primaryBusinessEmail, knowledgeSources: context.knowledgeSources,
      paigeProfile: context.paigeProfile, voiceExamples: context.voiceExamples, proposalId: draft.proposalId });
    if (liveScope.current !== capturedScope) return;
    if (result.ok === false) { returnFocusField.current = draft.field; setError(result.error); return; }
    const following = nextField === undefined ? nextInterviewField(result.readback.brief) : nextField && draft.fields.includes(nextField) ? nextInterviewField(result.readback.brief, nextField) : nextField;
    const reviewedField = draft.field;
    returnFocusField.current = reviewedField;
    setDraft(null); setNextField(following); setPaused(false); setError(null);
    setMessage("Saved to Setup and read back from the server. You can correct any detail below, then continue in the same conversation.");
    if (threadId) {
      setCheckpointBusy(true);
      const recorded = await checkpoint("active", following, result.readback.contextRevision);
      if (liveScope.current !== capturedScope) return;
      setCheckpointBusy(false);
      if (!recorded) setError("Setup was saved. Interview progress was not recorded; reopen this conversation and reload Setup before continuing.");
    }
  }
  async function move(phase: "active" | "paused", field: InterviewField | null) {
    if (!ready || locked || !threadId) return;
    const capturedScope = scope; setCheckpointBusy(true); setError(null);
    const recorded = await checkpoint(phase, field, context.contextRevision);
    if (liveScope.current !== capturedScope) return;
    setCheckpointBusy(false);
    if (!recorded) { setError("Progress could not be recorded. Keep this conversation open and retry."); return; }
    setNextField(field); setPaused(phase === "paused");
    setMessage(phase === "paused" ? "Interview paused in this conversation." : "Continue with PAIGE in this conversation. Use the Continue interview prompt below, then press Send.");
    if (phase === "paused") onPause();
  }
  const proposal = context.pendingProposal;
  const pending = nextField === undefined ? nextInterviewField(context.brief) : nextField;
  return <aside ref={panel} className="sbi" aria-label="Business interview profile">
    <div className="sbi-head"><div><strong>Your business profile</strong><span>Review a detail before saving it to Setup.</span></div><button type="button" onClick={setup}>Open Setup</button></div>
    {context.loading && <p role="status">Loading your Setup records…</p>}
    {(context.error || error) && <p role="alert" className="sbi-error">{context.error || error}</p>}
    {message && <p role="status" className="sbi-status">{message}</p>}
    {!context.loading && !ready && !context.error && <p>Only the business owner can review and save this interview profile.</p>}
    {ready && <>
      <p className="sbi-note">Use Chat for this interview. Review suggestions when available, or enter a detail yourself. Never share passwords or connection secrets in chat.</p>
      {proposal && <div className="sbi-proposal"><strong>A suggestion is ready for review</strong><p>{isOperationalProposal(proposal) ? proposal.reason : "This suggestion includes details that need the complete Setup review."}</p><button disabled={locked} type="button" onClick={isOperationalProposal(proposal) ? reviewProposal : setup}>{isOperationalProposal(proposal) ? "Review suggestion" : "Review in Setup"}</button></div>}
      {!draft ? <dl className="sbi-facts">{INTERVIEW_FIELDS.map(([field, label]) => <div key={field}><dt>{label}<small>{setupSourceLabel(context.brief.provenance[field]?.source)}</small></dt><dd>{context.brief[field] || "Not yet recorded"}</dd><button data-interview-field={field} type="button" disabled={locked} onClick={() => edit(field)} aria-label={`${context.brief[field] ? "Correct" : "Add"} ${label}`}>{context.brief[field] ? "Correct" : "Add"}</button></div>)}</dl> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <h3>{draft.proposalId ? "Review PAIGE’s suggestion" : "Review this detail"}</h3>
        {INTERVIEW_FIELDS.filter(([field]) => draft.fields.includes(field)).map(([field, label], index) => <label key={field}>{label}<textarea autoFocus={index === 0} maxLength={4000} value={draft.brief[field]} disabled={locked} onChange={event => { const value = event.target.value; setDraft(current => current ? { ...current, brief: { ...current.brief, [field]: value } } : null); }} /></label>)}
        <p>{draft.fields.some(field => context.brief.provenance[field]?.source === "connection_sourced" && draft.brief[field].trim() !== context.brief[field].trim()) ? "This review replaces changed connection-sourced details with your confirmed values." : "Your review saves only through the existing Setup controls."}</p><div className="sbi-actions"><button type="submit" disabled={locked}>{context.saving ? "Saving…" : "Confirm and save to Setup"}</button><button type="button" disabled={locked} onClick={() => { returnFocusField.current = draft.field; setDraft(null); }}>Cancel</button></div>
      </form>}
      <div className="sbi-actions"><button type="button" disabled={locked || !!draft} onClick={() => void context.refresh()}>Reload Setup</button>{threadId && <><button type="button" disabled={locked || !!draft || !pending} onClick={() => void move("active", pending ? nextInterviewField(context.brief, pending) : null)}>Skip this topic</button><button type="button" disabled={locked || !!draft} onClick={() => void move(paused ? "active" : "paused", pending)}>{paused ? "Resume interview" : "Pause interview"}</button></>}</div>
      {!threadId && <p className="sbi-note">Send your first message to keep interview progress with this conversation.</p>}
    </>}
  </aside>;
}
