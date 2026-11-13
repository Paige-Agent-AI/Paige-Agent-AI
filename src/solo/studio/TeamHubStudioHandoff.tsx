import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { StudioLaunchButton, STUDIO_SESSION_ID } from "./StudioLaunchButton";
import { StudioBusinessContextPanel } from "./StudioBusinessContextPanel";
import { useStudioBusinessContext } from "./useStudioBusinessContext";
import { projectStudioBusinessContext, type StudioBusinessContext, type StudioBusinessSource, type StudioContextTarget } from "./business-context";
import { StudioBusinessSelector } from "./StudioBusinessSelector";
import { applyStudioBusinessSelection } from "./studio-business-selection";
import { ProjectStartUnknown, readTeamHubStudioReference, startTeamHubStudio, type StudioProjectContext, type TeamHubStudioReference } from "./studio-data";
import { projectStudioRequestIntent } from "./studio-request-intent";
import "./TeamHubStudioHandoff.css";

export interface TeamHubStudioHandoffProps {
  messageId: string; expectedTenant: string; actorId: string; agentKey: "nexus" | "paige";
  /** Optional ORIGINAL human request text, not an assistant/model brief. Proposal data only. */
  originalRequestText?: string;
}
type Values = StudioBusinessContext["projectValues"];
type ContextProps = { tenantId: string; tenantSlug: string; target: StudioContextTarget; values: Values; disabled: boolean; businessSelection?: React.ReactNode; selectedBusinessName?: string; onChange: (values: Values) => void; onTargetChange: (kind: StudioContextTarget["kind"]) => void };
function WorkspaceContext({ tenantId, tenantSlug, target, values, ...props }: ContextProps) {
  const projection = useStudioBusinessContext(tenantId, tenantSlug, target, values);
  return <StudioBusinessContextPanel projection={projection} projectValues={values} {...props} />;
}
function AuthoredContext({ tenantId, target, values, ...props }: ContextProps) {
  const projection = projectStudioBusinessContext({ expectedTenantId: tenantId, target, projectValues: values, readStatus: "unavailable", context: null });
  return <StudioBusinessContextPanel projection={projection} projectValues={values} businessSelection={props.businessSelection} selectedBusinessName={props.selectedBusinessName} disabled={props.disabled} onChange={props.onChange} onTargetChange={props.onTargetChange} />;
}

/** The native reader, not arbitrary message fields, supplies every preparation
 * and original session reference. Scope changes unmount the private child. */
export function TeamHubStudioHandoff(props: TeamHubStudioHandoffProps) {
  const account = useTenantContext();
  if (account.accountContextLoading || account.accountContextStatus !== "ready" || account.activeUserId !== props.actorId
    || account.activeTenantId !== props.expectedTenant || account.activeTenant?.id !== props.expectedTenant
    || !STUDIO_SESSION_ID.test(props.expectedTenant) || !STUDIO_SESSION_ID.test(props.messageId)
    || (props.agentKey !== "nexus" && props.agentKey !== "paige")) return null;
  return <BoundStudioSourceHandoff key={`${props.actorId}:${props.expectedTenant}:${props.messageId}:${props.agentKey}`} {...props} tenantSlug={account.activeTenant.slug} />;
}

type SourceReaders = {
  readReference?: typeof readTeamHubStudioReference;
  startReference?: typeof startTeamHubStudio;
};
export function BoundStudioSourceHandoff({ messageId, expectedTenant, tenantSlug, originalRequestText, readReference = readTeamHubStudioReference, startReference = startTeamHubStudio }: TeamHubStudioHandoffProps & { tenantSlug: string } & SourceReaders) {
  const [reference, setReference] = useState<TeamHubStudioReference | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "checking" | "unknown" | "retry" | "refused">("idle");
  const [target, setTarget] = useState<StudioContextTarget | null>(null);
  const [values, setValues] = useState<Values>({});
  const [businessSource, setBusinessSource] = useState<StudioBusinessSource>();
  const [businessName, setBusinessName] = useState<string>();
  const [message, setMessage] = useState<string | null>(null);
  const alive = useRef(false), pending = useRef(false), sequence = useRef(0);
  const originalContext = useRef<StudioProjectContext | null>(null);
  const proposalSettled = useRef(false);
  const labelId = useId();
  const readSame = useCallback(async (recovery: boolean) => {
    const request = ++sequence.current;
    if (recovery) setPhase("checking");
    const found = await readReference(expectedTenant, messageId);
    if (!alive.current || sequence.current !== request) return;
    if (found.ok === true) { setReference(found); setPhase(found.state === "ready" ? "idle" : recovery ? "retry" : "idle"); }
    else if (recovery && found.code === "unknown") setPhase("unknown");
    else { setReference(found); setPhase(recovery ? "refused" : "idle"); originalContext.current = null; }
  }, [expectedTenant, messageId, readReference]);
  useEffect(() => {
    const requestSequence = sequence;
    alive.current = true; void readSame(false);
    return () => { alive.current = false; requestSequence.current++; };
  }, [readSame]);
  const busy = phase === "starting" || phase === "checking";
  const locked = busy || phase === "unknown" || phase === "retry";
  useEffect(() => {
    if (proposalSettled.current || originalContext.current || target || phase !== "idle"
      || reference?.ok !== true || reference.state !== "prepared" || !originalRequestText) return;
    proposalSettled.current = true;
    const proposal = projectStudioRequestIntent(originalRequestText);
    if (!proposal) return;
    try {
      setTarget(proposal.kind === "workspace" ? { kind: "workspace" } : { kind: proposal.kind, reference: crypto.randomUUID() });
      setValues(proposal.values);
    } catch { setMessage("A project reference could not be created in this browser. Choose the target again."); }
  }, [originalRequestText, phase, reference, target]);
  function chooseTarget(kind: StudioContextTarget["kind"]) {
    if (locked) return;
    proposalSettled.current = true;
    if (target?.kind === kind) return;
    try { setTarget(kind === "workspace" ? { kind } : { kind, reference: crypto.randomUUID() }); setBusinessSource(undefined); setBusinessName(undefined); setValues({}); setMessage(null); }
    catch { setMessage("A project reference could not be created in this browser. Try again."); }
  }
  async function start(retry = false) {
    if (pending.current || reference?.ok !== true || reference.state !== "prepared" || !target || (retry ? phase !== "retry" : phase !== "idle")) return;
    const projection = projectStudioBusinessContext({ expectedTenantId: expectedTenant, target, projectValues: values, readStatus: "unavailable", context: null });
    if (!projection.target || projection.issues.some(issue => issue.source === "project" && issue.field && values[issue.field]?.trim())) { setMessage("Check the project details before starting."); return; }
    // Blank keys are explicit project suppression, not permission to fall back
    // to saved Setup. Match the original Studio start's authored-value contract.
    const authoredValues = Object.fromEntries(Object.keys(values).map(key => [key, projection.projectValues[key as keyof typeof values] ?? ""]));
    const context = retry ? originalContext.current : { target: projection.target, values: authoredValues, ...(businessSource ? { business_source: businessSource, ...(businessName ? { business_name: businessName } : {}) } : {}), template_id: "nexus-editorial-landing-v1" as const };
    if (!context) return;
    originalContext.current = context; pending.current = true; setPhase("starting"); setMessage(null);
    try {
      const ready = await startReference(expectedTenant, messageId, context);
      if (!alive.current) return;
      setReference({ ok: true, state: "ready", sessionId: ready.sessionId }); setPhase("idle");
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ProjectStartUnknown) await readSame(true);
      else { setReference({ ok: false, code: "unavailable" }); setPhase("refused"); originalContext.current = null; setValues({}); setBusinessSource(undefined); setBusinessName(undefined); setTarget(null); }
    } finally { pending.current = false; }
  }
  if (phase === "refused") return <p className="th-studio-feedback" role="status">This Studio handoff is no longer available in the current workspace.</p>;
  if (phase === "unknown" || phase === "checking") return <div className="th-studio-handoff">
    <p className="th-studio-help" role="status">The project start is not confirmed. Check this same handoff before trying again.</p>
    <button type="button" className="th-btn" disabled={busy} onClick={() => void readSame(true)}>{busy ? "Checking…" : "Check same handoff"}</button>
  </div>;
  if (reference?.ok !== true) return null;
  if (reference.state === "ready") return <div className="th-studio-handoff th-studio-ready"><span>Studio project</span><StudioLaunchButton sessionId={reference.sessionId} className="th-btn" /></div>;
  const contextProps: ContextProps | null = target ? { tenantId: expectedTenant, tenantSlug, target, values, selectedBusinessName: businessName, disabled: locked,
    businessSelection: <StudioBusinessSelector tenantId={expectedTenant} target={target} selected={businessSource} disabled={locked} onSelect={business => {
      if (locked) return;
      const next = applyStudioBusinessSelection({ target, values }, business, crypto.randomUUID());
      proposalSettled.current = true; setTarget(next.target); setValues(next.values); setBusinessSource(next.business_source); setBusinessName(next.business_name);
    }} />,
    onChange: next => { if (!locked) { proposalSettled.current = true; setValues(next); } }, onTargetChange: chooseTarget } : null;
  return <div className="th-studio-handoff" role="group" aria-labelledby={labelId}>
    <details>
      <summary className="th-studio-summary"><FileText aria-hidden="true" /><span id={labelId}>Review Studio brief</span></summary>
      <p className="th-studio-brief">{reference.brief}</p>
    </details>
    <label className="th-studio-target-label" htmlFor={`${labelId}-target`}>Project target</label>
    <select id={`${labelId}-target`} aria-label="Project target" value={target?.kind ?? ""} disabled={locked}
      onChange={event => chooseTarget(event.target.value as StudioContextTarget["kind"])}>
      <option value="" disabled>Choose a target</option><option value="workspace">My business</option><option value="client">Client</option><option value="prospect">Prospect</option><option value="custom">Custom</option>
    </select>
    {target && target.kind !== "workspace" && <p className="th-studio-help">Enter details for this project. No CRM record or saved client context is selected.</p>}
    {contextProps && <div className="vs-studio th-studio-context">{target?.kind === "workspace" ? <WorkspaceContext {...contextProps} /> : <AuthoredContext {...contextProps} />}</div>}
    {phase === "retry" && <p role="status" className="th-studio-help">This same source still has a prepared brief. Retrying keeps its original project target and details.</p>}
    {message && <p role="alert" className="th-studio-feedback">{message}</p>}
    <div className="th-studio-actions"><button type="button" className="th-btn" disabled={busy || !target} onClick={() => void start(phase === "retry")}>{busy ? "Starting…" : phase === "retry" ? "Retry same start" : "Start Studio project"}</button></div>
    <p className="th-studio-help">Starts the original Studio project with this brief. Building and publishing remain separate actions in Studio.</p>
  </div>;
}
