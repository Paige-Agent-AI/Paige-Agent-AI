import type { TaskTrajectory } from "@/operator/data/intelligenceContract";
import { displayCost, displayNumber } from "@/operator/data/intelligenceContract";

/** Labels describe the server's current evidence check, never assistant narration. */
export function trajectoryResult(t: TaskTrajectory) {
  if (t.work_state === "failed") return "Failed";
  if (t.work_state === "cancelled") return "Cancelled";
  if (t.work_state === "blocked") return "Blocked";
  if (["expired", "outcome_unknown"].includes(t.work_state)) return "Reconciliation required";
  if (t.work_state === "claimed") return t.dispatch_attempt > 0 ? "Execution attempted" : "Accepted";
  if (t.work_state !== "succeeded") return "Terminal outcome unverified";
  if (t.receipt_conflict) return "Conflicting receipts";
  if (!t.terminal_verified || !t.scope_consistent) return "Terminal outcome unverified";
  return t.terminal_condition === "artifact" ? "Artifact creation verified" : t.terminal_condition === "read_only" ? "Read result verified" : "Terminal outcome unverified";
}
type Event = { key: string; at: string; kind: string; label: string; source: string; ref: string; tone: string };
export function trajectoryTimeline(t: TaskTrajectory, observedAt: string): Event[] {
  const events: Event[] = t.history.events.map(h => ({ key: `work:${h.version}`, at: h.at, kind: "Work observation",
    label: `${h.state} · attempt ${h.attempt} · dispatch ${h.dispatch_attempt}${h.blocked_code ? ` · ${h.blocked_code}` : ""}${h.readback_claimed ? " · source claimed readback" : ""}`,
    source: "paige_durable_work", ref: `${t.id} · version ${h.version}`, tone: ["blocked", "failed", "expired", "outcome_unknown"].includes(h.state) ? "warning" : "investigation" }));
  for (const m of t.models) events.push({ key: `model:${m.id}`, at: m.created_at, kind: "Model call", label: `${m.provider ?? "Unknown provider"} · ${m.model ?? "Unknown model"} · ${m.status} · attempt attribution unavailable`, source: "paige_llm_trace", ref: m.id, tone: m.status === "error" ? "failure" : "model" });
  for (const a of t.executions) {
    events.push({ key: `decision:${a.id}`, at: a.decided_at, kind: "Capability decision", label: `${a.capability_key} · lane ${a.effective_lane}`, source: "paige_act_executions", ref: a.id, tone: "investigation" });
    if (a.dispatched_at) events.push({ key: `dispatch:${a.id}`, at: a.dispatched_at, kind: "Tool dispatch", label: "Attempt recorded; does not establish execution", source: "paige_act_executions", ref: a.id, tone: "investigation" });
    if (a.settled_at) events.push({ key: `execution:${a.id}`, at: a.settled_at, kind: "Execution outcome", label: `${a.outcome} · provider reference ${a.provider_reference_recorded ? "recorded, private" : "not recorded"} · attempt attribution unavailable`, source: "paige_act_executions", ref: a.id, tone: a.outcome === "executed" ? "evaluation" : "warning" });
  }
  for (const a of t.approvals) events.push({ key: `approval:${a.id}`, at: a.reviewed_at ?? a.created_at, kind: "Approval record", label: `${a.status} · current recorded decision; earlier revisions unavailable`, source: "paige_pending_approvals", ref: a.id, tone: ["approved", "sent"].includes(a.status) ? "evaluation" : "warning" });
  for (const r of t.receipts) events.push({ key: `receipt:${r.id}`, at: r.occurred_at, kind: "Canonical receipt", label: `${r.outcome} · attempt ${r.attempt ?? "unknown"}${r.release_id ? ` · release ${r.release_id}` : " · release not recorded"}`, source: "paige_workspace_events", ref: r.id, tone: r.outcome === "capability_succeeded" ? "evaluation" : "failure" });
  for (const c of t.turns) events.push({ key: `turn:${c.id}`, at: c.created_at, kind: "Linked conversation turn", label: `${c.role} · content withheld${c.processing_state ? ` · processing ${c.processing_state}` : ""}`, source: "paige_chat_turns", ref: c.id, tone: "investigation" });
  for (const e of t.evaluations) events.push({ key: `eval:${e.id}`, at: e.created_at, kind: "Evaluation result", label: `${e.scorer} · ${e.status} · score ${displayNumber(e.score)} · operational outcome remains independent`, source: "paige_eval_result", ref: e.id, tone: "evaluation" });
  events.push({ key: "readback", at: observedAt, kind: "Current server readback", label: trajectoryResult(t), source: "operator_intelligence_trajectories", ref: t.artifact_ref ?? "No verified destination reference", tone: t.terminal_verified ? "evaluation" : "warning" });
  return events.filter(e => Number.isFinite(Date.parse(e.at))).sort((a,b) => Date.parse(a.at)-Date.parse(b.at) || a.key.localeCompare(b.key));
}
export function TrajectoryEvidence({ task, observedAt }: { task: TaskTrajectory; observedAt: string }) {
  const costs = task.models.map(m => m.cost_estimate_usd).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const latency = task.models.map(m => m.latency_ms).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  const limited = Object.entries(task.limit_reached).filter(([, value]) => value).map(([key]) => key);
  return <div>
    <p className="intel-source">Observed {new Date(observedAt).toLocaleString()} · contract v{task.contract_version} · work v{task.work_version} · source-backed metadata; authenticated production acceptance UNVERIFIED.</p>
    <dl className="intel-detail">
      <Entry label="Task reference" value={task.id} /><Entry label="Objective category" value={task.category} />
      <Entry label="Starting state" value={task.history.complete ? task.history.events[0]?.state ?? "Not recorded" : "Historical initiation unavailable"} /><Entry label="Accepted at" value={new Date(task.created_at).toLocaleString()} />
      <Entry label="Capability" value={task.capability_key} /><Entry label="Recorded work state" value={`${task.work_state} · attempt ${task.attempt}`} />
      <Entry label="Outcome evidence" value={trajectoryResult(task)} /><Entry label="Destination reference" value={task.artifact_ref ?? "Unavailable"} />
      <Entry label="Conversation reference" value={task.thread_ref ?? "Not recorded"} /><Entry label="Accepted intent reference" value={task.intent_ref} />
      <Entry label="Known model estimates" value={`${costs.length ? displayCost(costs.reduce((a,b) => a+b,0)) : "Not recorded"} · ${costs.length}/${task.model_count} calls measured; not complete spend`} />
      <Entry label="Recorded call latency" value={`${latency.length ? displayNumber(latency.reduce((a,b) => a+b,0), " ms") : "Not recorded"} · ${latency.length}/${task.model_count} calls measured; excludes waiting and tool time`} />
    </dl>
    <p>{task.terminal_condition === "artifact" ? "Verification concerns this artifact's creation and current revision. Publication, sending and business effects are unverified." : task.terminal_condition === "read_only" ? "Read-result evidence concerns recorded findings and usable citations. It does not establish business impact or activate research execution." : "The terminal condition for this domain is unavailable. A recorded success state cannot establish a verified outcome here."}</p>
    <p role="status">History {task.history.complete ? "captured from acceptance" : "incomplete: initiation or earlier observations unavailable"}{task.history.truncated ? " · older observations dropped at the 128-event limit" : ""}.{limited.length > 0 && ` Source limits reached for ${limited.join(", ")}; references may be omitted.`}</p>
    {!task.scope_consistent && <p role="alert">Source scope is inconsistent. Verification is refused.</p>}
    <h4>Recorded task timeline</h4>
    <p className="intel-source">Ordered by source timestamps; concurrent timestamps do not establish causality. No relationships were inferred. Unrecorded steps remain unknown.</p>
    <ol className="intel-task-timeline">{trajectoryTimeline(task, observedAt).map(e => <li key={e.key} data-tone={e.tone}>
      <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time><div><strong>{e.kind}</strong><p>{e.label}</p><small className="intel-id">{e.source} · {e.ref}</small></div>
    </li>)}</ol>
    <h4>Recorded runtime fingerprints</h4>
    {task.models.length === 0 ? <p>No proven model links. No model configuration has been inferred.</p> : <div className="intel-table-wrap"><table><caption className="sr-only">Linked model runtime metadata</caption><thead><tr><th>Model / provider</th><th>Class / tier</th><th>Recorded router version</th><th>Route / fallback</th></tr></thead><tbody>{task.models.map(m => <tr key={m.id}><td>{m.model ?? "Unknown"}<small>{m.provider ?? "Unknown"}</small></td><td>{m.route_class ?? "Unknown"}<small>{m.tier ?? "Unknown tier"}</small></td><td>{m.router_version ?? "Unknown"}</td><td>{m.route_provider ?? "Unknown"} · {m.route_model ?? "Unknown"}<small>Fallback {typeof m.route_fallback !== "boolean" ? "unknown" : m.route_fallback ? "recorded" : "not used"}</small></td></tr>)}</tbody></table></div>}
    <p className="intel-source">PARTIAL · Prompt, policy, harness, tool-schema and feature-flag versions are not universally recorded. Cross-work parent objectives and unrelated historical evidence remain unavailable. Approval and tool attempt attribution are partial. Private objectives, transcripts, documents and provider payloads are withheld.</p>
  </div>;
}
function Entry({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd className="intel-id">{value}</dd></div>; }
