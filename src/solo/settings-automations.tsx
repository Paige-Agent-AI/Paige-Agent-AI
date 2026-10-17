/**
 * Settings → Integrations → Automations.
 *
 * OWNER BOUNDARY (2026-08-31): this file is owned by the Integrations surface. It
 * imports nothing from Systems Check, Mind or Command Center, alters none of their
 * contracts, and offers no link into them. Its one outbound link is the tenant's
 * own pipeline setup, a Campaigns surface. Existing governed data is consumed
 * read-only through its own tenant-scoped policy, in owner language, with nothing
 * raw surfaced.
 *
 * HONESTY CONTRACT (§13). A rule authored here is genuinely saved — the write is a
 * live tenant-admin contract — and the deal-stage trigger genuinely matches it. It
 * cannot yet reach anybody, because the dispatcher only forwards to a delivery
 * route and none is configured anywhere. That is stated on the surface in plain
 * words, on the card and again at the moment of turning a rule on. Nothing here
 * shows a run count, a success rate, a health signal or a repair action, because
 * no automation has ever run.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AlertTriangle, Check, Plus, RefreshCw, Trash2 } from "lucide-react";
import { OwnerTaskAutomations } from "./owner-task-automations";
import {
  outcomeLabel,
  useSoloAutomations,
  type AutomationDraft,
  type AutomationRule,
  type ComposeIntent,
  type PipelineStage,
  type SendMode,
} from "./data/useSoloAutomations";

/** Labels for the real `compose_intent` values, in the owner's language. */
const INTENTS: ReadonlyArray<{ value: ComposeIntent; label: string; note: string }> = [
  { value: "transactional", label: "Something they expect", note: "A confirmation or a next step they already agreed to." },
  { value: "notification", label: "A heads-up", note: "Letting them know something happened." },
  { value: "nurture", label: "Keeping in touch", note: "Staying useful between pieces of work." },
  { value: "marketing", label: "An offer", note: "Promoting something. Only goes to people who agreed to marketing." },
];

const TONES = ["warm", "professional", "consultative", "welcoming", "encouraging", "celebratory"] as const;

const MODES: ReadonlyArray<{ value: SendMode; label: string; note: string }> = [
  { value: "draft_for_review", label: "Show me first", note: "She writes it and waits for you. Nothing leaves without your say-so." },
  { value: "auto_send", label: "Let her send it", note: "It goes without you, once the checks pass." },
];

function stageLabel(stages: PipelineStage[], id: string | null): string {
  if (!id) return "any stage";
  return stages.find((s) => s.id === id)?.label ?? "a stage you removed";
}

function ruleSentence(rule: AutomationRule, stages: PipelineStage[]): string {
  const intent = INTENTS.find((i) => i.value === rule.compose_intent)?.label.toLowerCase() ?? "a message";
  return `When a client moves from ${stageLabel(stages, rule.from_stage_id)} to ${stageLabel(stages, rule.to_stage_id)}, send ${intent} in a ${rule.tone || "neutral"} voice.`;
}

/** The one genuinely available next step when a workspace has no pipeline yet. */
function usePipelineHref(): string | null {
  const { pathname } = useLocation();
  const match = pathname.match(/^(\/solo\/[^/]+)(?:\/|$)/);
  return match ? `${match[1]}/growth/pipeline` : null;
}

export function SoloAutomationsView() {
  return <div className="sa-root"><OwnerTaskAutomations /><PipelineAutomationsView /></div>;
}

/** Pipeline message rules keep their own read/error state and off-only controls. */
function PipelineAutomationsView() {
  const a = useSoloAutomations();
  const pipelineHref = usePipelineHref();
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  // Stages are resolved PER RULE, never from a single "first" pipeline. A
  // workspace may have several, and reading them all off pipelines[0] made every
  // rule on another pipeline render as "a stage you removed" — telling an owner
  // their rule was broken when it was fine.
  const stagesFor = useCallback(
    (pipelineId: string) => a.stagesByPipeline.get(pipelineId) ?? [],
    [a.stagesByPipeline],
  );

  // A new rule is authored against the first pipeline that actually HAS stages,
  // which is also the condition `hasPipeline` reports on.
  const authoringPipeline = useMemo(
    () => a.pipelines.find((p) => (a.stagesByPipeline.get(p.id)?.length ?? 0) > 0) ?? null,
    [a.pipelines, a.stagesByPipeline],
  );

  // Editing keeps the rule on ITS OWN pipeline. Passing the first pipeline here
  // silently moved an edited rule onto a different pipeline, and repointed its
  // stage at a foreign pipeline's stage — a corrupting write, not a display bug.
  const editorPipelineId =
    editing && editing !== "new" ? editing.pipeline_id : authoringPipeline?.id ?? null;

  // Never leave an editor open against data that no longer supports it.
  useEffect(() => {
    if (!a.hasPipeline) setEditing(null);
  }, [a.hasPipeline]);

  if (a.loading) {
    return <div className="ss-state" role="status"><RefreshCw className="ss-spin" aria-hidden />Checking what is set up…</div>;
  }

  if (a.error) {
    return (
      <div className="ss-state" role="alert">
        <AlertTriangle aria-hidden />
        <span>
          <strong>Couldn’t check your automations</strong>
          Nothing is being claimed either way — not that you have none, and not that they are running.
        </span>
        <button type="button" onClick={() => void a.refresh()}>Try again</button>
      </div>
    );
  }

  const live = a.rules.filter((r) => r.is_active).length;

  return (
    <div className="sa-root">
      <section className="sa-status" aria-labelledby="sa-status-title">
        <div className="sa-status-head">
          <h2 id="sa-status-title">
            {a.rules.length === 0
              ? "Nothing is set up yet"
              : live === 0
                ? `${a.rules.length} saved, none turned on`
                : `${live} of ${a.rules.length} turned on`}
          </h2>
          <span className="sa-pill" data-tone={a.rules.length === 0 ? "idle" : live ? "on" : "held"}>
            {a.rules.length === 0 ? "Nothing set up" : live ? "On" : "Off"}
          </span>
        </div>

        <p>
          Automations are things Paige does on her own so you do not have to remember them. The kind
          you can set up here follows a client through your pipeline.
        </p>

        {/* This used to promise that no route out existed and nothing could reach a
            client. That was read off one environment and is not true wherever the
            platform fallback route was seeded, so the promise is gone. What replaces
            it is enforced rather than asserted: rules are saved off, and this surface
            has no control that starts one. */}
        <p className="sa-caveat">
          <strong>Worth knowing before you build one.</strong> Rules you build here are saved switched
          off, and nothing on this page switches one on. Building and changing them is safe. Whether a
          message would actually go out once a rule is running is decided elsewhere and is not settled
          here — so treat starting one as a separate decision, not a side effect of saving.
        </p>

        {!a.hasPipeline && (
          <div className="sa-actions">
            {pipelineHref ? (
              <Link className="sa-action" data-primary to={pipelineHref}>
                Set up your pipeline
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M5 12h13" /><path d="m12 6 6 6-6 6" /></svg>
              </Link>
            ) : (
              <span className="sa-action" aria-disabled>Set up your pipeline</span>
            )}
            <span className="sa-actions-note">
              A rule watches for a client reaching a stage, so your stages come first. You can create
              them yourself.
            </span>
          </div>
        )}

        {a.hasPipeline && !a.canWrite && (
          <p className="sa-caveat">
            You can see what is set up here, but changing it needs an owner or admin on this workspace.
          </p>
        )}
      </section>

      <section className="sa-panel" aria-labelledby="sa-list-title">
        <header className="sa-panel-head">
          <div>
            <h2 id="sa-list-title">Yours</h2>
            <p>{a.rules.length === 0 ? "Nothing here yet." : "Turn one off at any time."}</p>
          </div>
          {a.hasPipeline && a.canWrite && editing === null && (
            <button type="button" className="sa-action" data-primary onClick={() => setEditing("new")}>
              <Plus size={14} aria-hidden />New automation
            </button>
          )}
        </header>

        {a.writeError && (
          <p className="sa-write-error" role="alert">
            <AlertTriangle size={14} aria-hidden />{a.writeError}
          </p>
        )}

        {a.rules.length === 0 && editing === null && (
          <p className="sa-empty">
            {a.hasPipeline
              ? "When you make one it appears here, with whether it is on and when it last changed."
              : "Once your pipeline exists, this is where the ones you build will live."}
          </p>
        )}

        {a.rules.length > 0 && (
          <ul className="sa-rules">
            {a.rules.map((rule) => (
              <li key={rule.id} className="sa-rule" data-on={rule.is_active ? "true" : "false"}>
                <div className="sa-rule-copy">
                  <p className="sa-rule-sentence">{ruleSentence(rule, stagesFor(rule.pipeline_id))}</p>
                  <p className="sa-rule-meta">
                    {MODES.find((m) => m.value === rule.send_mode)?.label ?? rule.send_mode}
                    {" · "}
                    {rule.is_active ? "On" : "Off"}
                  </p>
                </div>
                <div className="sa-rule-controls">
                  {a.canWrite && (
                    <>
                      {/* Off is offered, on is not. Switching a rule off can only ever
                          reduce what runs; switching one on from here would start
                          something whose delivery behaviour this surface cannot see. */}
                      {rule.is_active && (
                        <button type="button" className="sa-ctl" disabled={a.saving}
                          onClick={() => void a.setActive(rule.id, false)}>
                          Turn off
                        </button>
                      )}
                      <button type="button" className="sa-ctl" disabled={a.saving} onClick={() => setEditing(rule)}>
                        Change
                      </button>
                      {confirmingDelete === rule.id ? (
                        <span className="sa-confirm">
                          <button type="button" className="sa-ctl" data-danger disabled={a.saving}
                            onClick={() => { setConfirmingDelete(null); void a.deleteRule(rule.id); }}>
                            <Check size={13} aria-hidden />Delete it
                          </button>
                          <button type="button" className="sa-ctl" onClick={() => setConfirmingDelete(null)}>Keep it</button>
                        </span>
                      ) : (
                        <button type="button" className="sa-ctl" aria-label="Delete this automation"
                          disabled={a.saving} onClick={() => setConfirmingDelete(rule.id)}>
                          <Trash2 size={13} aria-hidden />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {editing !== null && editorPipelineId && (
          <AutomationEditor
            key={editing === "new" ? "new" : editing.id}
            rule={editing === "new" ? null : editing}
            pipelineId={editorPipelineId}
            stages={stagesFor(editorPipelineId)}
            saving={a.saving}
            onCancel={() => setEditing(null)}
            onSave={async (draft) => {
              const ok = editing === "new" ? await a.createRule(draft) : await a.updateRule(editing.id, draft);
              if (ok) setEditing(null);
            }}
          />
        )}
      </section>

      <section className="sa-panel" aria-labelledby="sa-history-title">
        <header className="sa-panel-head">
          <div>
            <h2 id="sa-history-title">What has happened</h2>
            <p>
              {a.outcomesUnavailable
                ? "This could not be checked just now."
                : a.outcomes.length === 0
                  ? "Nothing has run here."
                  : "Newest first. Only the outcome is kept here — never the message itself."}
            </p>
          </div>
        </header>

        {a.outcomesUnavailable ? (
          <p className="sa-empty">
            The record of what has happened could not be read, so nothing is being claimed either
            way — not that something ran, and not that nothing did.
          </p>
        ) : a.outcomes.length === 0 ? (
          <p className="sa-empty">
            Once an automation is running and a client moves, every time it is considered will be
            listed here — including the times it held back, and why.
          </p>
        ) : (
          <ul className="sa-history">
            {a.outcomes.slice(0, 12).map((o) => (
              <li key={o.id} className="sa-history-row">
                <span className="sa-history-what">{outcomeLabel(o.status)}</span>
                <span className="sa-history-when">
                  {o.created_at ? new Date(o.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AutomationEditor({
  rule, pipelineId, stages, saving, onSave, onCancel,
}: {
  rule: AutomationRule | null;
  pipelineId: string;
  stages: PipelineStage[];
  saving: boolean;
  onSave: (draft: AutomationDraft) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState<string>(rule?.from_stage_id ?? "");
  const [to, setTo] = useState<string>(rule?.to_stage_id ?? stages[0]?.id ?? "");
  const [intent, setIntent] = useState<ComposeIntent>(rule?.compose_intent ?? "nurture");
  const [tone, setTone] = useState<string>(rule?.tone || "warm");
  const [mode, setMode] = useState<SendMode>(rule?.send_mode ?? "draft_for_review");

  const valid = Boolean(to) && to !== from;

  return (
    <form
      className="sa-editor"
      aria-label={rule ? "Change this automation" : "New automation"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || saving) return;
        void onSave({ pipeline_id: pipelineId, from_stage_id: from || null, to_stage_id: to, compose_intent: intent, tone, send_mode: mode });
      }}
    >
      <div className="sa-field">
        <span className="sa-label" id="sa-when">When a client moves</span>
        <div className="sa-row" role="group" aria-labelledby="sa-when">
          <label className="sa-select">
            <span>from</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">any stage</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="sa-select">
            <span>to</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} required>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
        {!valid && to && to === from && <p className="sa-note" role="alert">Pick two different stages — a client has to actually move.</p>}
      </div>

      <fieldset className="sa-field">
        <legend className="sa-label">Send</legend>
        <div className="sa-row">
          {INTENTS.map((i) => (
            <button key={i.value} type="button" className="sa-chip" aria-pressed={intent === i.value} onClick={() => setIntent(i.value)}>
              {i.label}
            </button>
          ))}
        </div>
        <p className="sa-note">{INTENTS.find((i) => i.value === intent)?.note}</p>
      </fieldset>

      <fieldset className="sa-field">
        <legend className="sa-label">In a voice that is</legend>
        <div className="sa-row">
          {TONES.map((t) => (
            <button key={t} type="button" className="sa-chip" aria-pressed={tone === t} onClick={() => setTone(t)}>{t}</button>
          ))}
        </div>
      </fieldset>

      <fieldset className="sa-field">
        <legend className="sa-label">Before it goes</legend>
        <div className="sa-row">
          {MODES.map((m) => (
            <button key={m.value} type="button" className="sa-chip" aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="sa-note">{MODES.find((m) => m.value === mode)?.note}</p>
      </fieldset>

      <div className="sa-editor-foot">
        <button type="submit" className="sa-action" data-primary disabled={!valid || saving}>
          {saving ? "Saving…" : rule ? "Save changes" : "Save automation"}
        </button>
        <button type="button" className="sa-action" onClick={onCancel} disabled={saving}>Cancel</button>
        <span className="sa-editor-note">
          {rule
            ? "Saving a change does not switch a rule on or off — it stays as it is."
            : "Saved switched off, so nothing starts on its own."}
        </span>
      </div>
    </form>
  );
}
