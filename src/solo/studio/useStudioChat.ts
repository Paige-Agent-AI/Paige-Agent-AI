// The Studio session's conversation with Paige. One thread per project (paige_studio_thread_ensure),
// streamed from paige-ai-chat. Paige's build steps, her one grouped question and the artifact she
// produced arrive as their own frames; nothing here invents a step or a result the stream did not send.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeStepStatus, readPaigeStream, settleOpenSteps } from "@/lib/paige-stream";
import { ensureThread, loadHeldConfirms, loadTurns, plainError, Said, type ArtifactKind, type ChatTurn } from "./studio-data";

/** One thing Paige did this turn. "running" while it is under way; it closes on the same id. */
export interface BuildStep { id: string; label: string; detail?: string; status: "running" | "done" | "error"; at: number }
export interface ChoiceOption { label: string; value: string; description?: string }
export interface Choices { prompt: string; options: ChoiceOption[]; multi: boolean; allowOther: boolean }
export interface ProducedArtifact { kind: ArtifactKind; id: string; title: string }
/** An action Paige proposed that the owner's settings hold for approval (the paige_confirm frame). */
export interface PendingConfirm {
  tool: string; summary: string; fingerprint: string;
  /** Unset while it waits. "sent" once decided; then the server's own answer (paige_approval_outcome). */
  state?: "sent" | "ran" | "not_run" | "unconfirmed" | "declined";
  note?: string;
}
/** A page Paige designed this turn but did not save (the paige_preview frame). */
export interface DraftPreview { kind: "page" | "funnel"; title: string; blocks: unknown[]; theme: unknown }

/** What the stream says was produced. "form" now arrives too; older kinds pass through. */
function toArtifact(raw: unknown): ProducedArtifact | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind ?? "");
  const mapped: ArtifactKind | null = kind === "page" || kind === "form" || kind === "funnel" ? kind : kind === "content" || kind === "image" || kind === "document" || kind === "copy" ? "content" : null;
  if (!mapped || typeof o.id !== "string") return null;
  return { kind: mapped, id: o.id, title: typeof o.title === "string" && o.title ? o.title : "Untitled" };
}

export interface StudioChatState {
  ready: boolean;
  loadError: string | null;
  turns: ChatTurn[];
  sending: boolean;
  steps: BuildStep[];
  status: string | null;
  choices: Choices | null;
  confirms: PendingConfirm[];
  preview: DraftPreview | null;
  sendError: string | null;
  send: (text: string, opts?: { display?: string; approved?: string[]; declined?: string[] }) => Promise<void>;
  /** Approve or decline one held action; the server runs only the exact call it fingerprinted. */
  decide: (fingerprint: string, approve: boolean) => Promise<void>;
}

export function useStudioChat(opts: {
  sessionId: string | null;
  seedBrief: string | null;
  canvas: { kind: ArtifactKind; id: string } | null;
  onArtifact: (a: ProducedArtifact) => void;
  onTurnDone: () => void;
}): StudioChatState {
  const { sessionId, seedBrief } = opts;
  const [threadId, setThreadId] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [sending, setSending] = React.useState(false);
  const [steps, setSteps] = React.useState<BuildStep[]>([]);
  const [status, setStatus] = React.useState<string | null>(null);
  const [choices, setChoices] = React.useState<Choices | null>(null);
  const [confirms, setConfirms] = React.useState<PendingConfirm[]>([]);
  const [preview, setPreview] = React.useState<DraftPreview | null>(null);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const cb = React.useRef(opts);
  cb.current = opts;
  const seeded = React.useRef<string | null>(null);
  const failedIntent = React.useRef<{ text: string; id: string } | null>(null);
  // Leaving the project stops the stream; nothing is set on an unmounted workspace.
  const abort = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => abort.current?.abort(), []);

  React.useEffect(() => {
    let live = true;
    setThreadId(null); setReady(false); setTurns([]); setSteps([]); setChoices(null); setConfirms([]); setPreview(null); setLoadError(null); setSendError(null);
    if (!sessionId) return;
    (async () => {
      try {
        const id = await ensureThread(sessionId);
        const [history, held] = await Promise.all([loadTurns(id), loadHeldConfirms(id)]);
        if (!live) return;
        setThreadId(id); setTurns(history); setConfirms(held); setReady(true);
      } catch (e) {
        if (live) setLoadError(plainError(e, "This project's chat couldn't be opened. Try again in a moment."));
      }
    })();
    return () => { live = false; };
  }, [sessionId]);

  const send = React.useCallback(async (text: string, sendOpts?: { display?: string; approved?: string[]; declined?: string[] }) => {
    const trimmed = text.trim();
    if (!trimmed || sending || !threadId) return;
    setSendError(null); setChoices(null); setStatus(null); setSteps([]);
    // A decision keeps its card on screen as "sent" until the server says what happened; any other
    // message clears the cards it passes over. Either way the snapshot comes back if the send fails.
    const confirmsBefore = confirms;
    const decided = [...(sendOpts?.approved ?? []), ...(sendOpts?.declined ?? [])];
    setConfirms(decided.length
      ? confirmsBefore.filter((c) => decided.includes(c.fingerprint)).map((c) => ({ ...c, state: sendOpts?.declined?.includes(c.fingerprint) ? "declined" as const : "sent" as const }))
      : []);
    const requestIntentId = failedIntent.current?.text === trimmed ? failedIntent.current.id : crypto.randomUUID();
    const before = turns;
    const shown = [...before, { role: "user" as const, content: sendOpts?.display ?? trimmed }];
    const modelMessages = [...before, { role: "user" as const, content: trimmed }];
    setTurns([...shown, { role: "assistant", content: "" }]);
    setSending(true);
    let produced: ProducedArtifact | null = null;
    const controller = new AbortController();
    abort.current = controller;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Said("Please sign in again.");
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        signal: controller.signal,
        body: JSON.stringify({
          messages: modelMessages,
          threadId,
          requestIntentId,
          canvasArtifact: cb.current.canvas ? { id: cb.current.canvas.id, kind: cb.current.canvas.kind } : undefined,
          ...(sendOpts?.approved?.length ? { approvedConfirmations: sendOpts.approved } : {}),
          ...(sendOpts?.declined?.length ? { declinedConfirmations: sendOpts.declined } : {}),
        }),
      });
      if (!resp.ok) throw new Said(resp.status === 429 ? "Give it a moment — too many requests." : "Paige couldn't take that just now. Try again.");
      let reply = "";
      let gotChoices = false;
      // This turn's steps, owned by the read: a later frame for an id replaces the earlier one in
      // place, "withdrawn" removes it, and whatever is still running when the read ends is dropped.
      let built: BuildStep[] = [];
      // A frame with no id of its own gets the next of these. A count, never the list's length:
      // a withdrawn row shrinks the list, and a reused id would merge a new step over an old one.
      let anonSteps = 0;
      let sawConfirm = false;
      // The shared reader (src/lib/paige-stream) owns the framing. As this loop always did, [DONE]
      // ends the read and a line that is not JSON is skipped; a frame it does not name is dropped.
      for await (const frame of readPaigeStream(resp.body, { stopAtDone: true, malformed: "skip" })) {
        if (frame.type === "step") {
          if (typeof frame.step !== "object") continue;
          const ps = frame.step as Record<string, unknown>;
          // The shared rule (normalizeStepStatus): no status still means "done"; a status this client
          // does not know is dropped rather than drawn as done.
          const stepStatus = normalizeStepStatus(ps.status);
          if (stepStatus === null) continue;
          const id = typeof ps.id === "string" && ps.id ? ps.id : `s:${anonSteps++}`;
          if (stepStatus === "withdrawn") {
            // Its label goes with it: the status line falls back to the step still standing.
            if (built.some((b) => b.id === id)) { built = built.filter((b) => b.id !== id); setSteps(built); setStatus(built.at(-1)?.label ?? null); }
            continue;
          }
          // The closing frame merges over the opening one, as the main chat's trace does: what it
          // leaves out (a label, a detail) is kept, and the row keeps the time it started.
          const earlier = built.find((b) => b.id === id);
          const label = typeof ps.label === "string" && ps.label ? ps.label : earlier?.label;
          if (label) {
            if (typeof ps.label === "string" && ps.label) setStatus(label);
            const step: BuildStep = { id, label, detail: typeof ps.detail === "string" ? ps.detail : earlier?.detail, status: stepStatus, at: earlier?.at ?? Date.now() };
            built = earlier ? built.map((b) => (b.id === id ? step : b)) : [...built, step];
            setSteps(built);
          }
          continue;
        }
        if (frame.type === "choices") {
          if (typeof frame.choices !== "object") continue;
          const c = frame.choices as Record<string, unknown>;
          const options = Array.isArray(c.options) ? (c.options as Record<string, unknown>[])
            .filter((o) => typeof o.label === "string")
            .map((o) => ({ label: String(o.label), value: typeof o.value === "string" ? o.value : String(o.label), description: typeof o.description === "string" ? o.description : undefined })) : [];
          const prompt = typeof c.prompt === "string" ? c.prompt : "";
          gotChoices = true;
          setChoices({ prompt, options, multi: c.multi === true, allowOther: c.allow_other === true });
          if (!reply.trim() && prompt) { reply = prompt; setTurns([...shown, { role: "assistant", content: reply }]); }
          continue;
        }
        if (frame.type === "artifact") { produced = toArtifact(frame.artifact) ?? produced; continue; }
        if (frame.type === "confirm") {
          if (typeof frame.confirm !== "object") continue;
          const c = frame.confirm as Record<string, unknown>;
          if (typeof c.summary === "string" && typeof c.fingerprint === "string") {
            const pc = { tool: String(c.tool ?? "action"), summary: c.summary, fingerprint: c.fingerprint };
            sawConfirm = true;
            setConfirms((prev) => (prev.some((x) => x.fingerprint === pc.fingerprint) ? prev : [...prev, pc]));
          }
          continue;
        }
        if (frame.type === "approval_outcome") {
          if (typeof frame.outcome !== "object") continue;
          const o = frame.outcome as { actions?: Array<{ fingerprint?: string; outcome?: string; note?: string }>; note?: string };
          const byFp = new Map((o.actions ?? []).map((a) => [String(a.fingerprint), a]));
          setConfirms((prev) => prev.map((c) => {
            const a = byFp.get(c.fingerprint);
            if (!a || (a.outcome !== "ran" && a.outcome !== "not_run" && a.outcome !== "unconfirmed")) return c;
            return { ...c, state: a.outcome, note: a.note ?? o.note };
          }));
          continue;
        }
        if (frame.type === "preview") {
          if (typeof frame.preview !== "object") continue;
          const pv = frame.preview as Record<string, unknown>;
          if (Array.isArray(pv.blocks) && pv.blocks.length) {
            setPreview({ kind: pv.kind === "funnel" ? "funnel" : "page", title: typeof pv.title === "string" ? pv.title : "Draft", blocks: pv.blocks, theme: pv.theme ?? null });
          }
          continue;
        }
        if (frame.type === "content" && frame.text) {
          reply += frame.text;
          setTurns([...shown, { role: "assistant", content: reply }]);
        }
      }
      const settled = settleOpenSteps(built);
      if (settled !== built) { built = settled; setSteps(built); }
      const sawStep = built.length > 0;
      if (!reply.trim() && !gotChoices && !produced && !sawStep && !sawConfirm) setTurns([...shown, { role: "assistant", content: "I didn't catch that. Try saying it another way?" }]);
      failedIntent.current = null;
      // A saved piece replaces any unsaved preview: the stage now shows the real thing.
      if (produced) { setPreview(null); cb.current.onArtifact(produced); }
    } catch (e) {
      if (abort.current?.signal.aborted) return;
      setTurns(before);
      setSteps([]);
      setConfirms(confirmsBefore);
      failedIntent.current = { text: trimmed, id: requestIntentId };
      setSendError(plainError(e, "Paige couldn't take that just now. Check your connection and try again."));
    } finally {
      if (!controller.signal.aborted) {
        setSending(false);
        setStatus(null);
        cb.current.onTurnDone();
      }
    }
  }, [sending, threadId, turns, confirms]);

  // A brand-new project's first build: the brief from Studio home, sent once, the moment the
  // thread is ready and empty.
  React.useEffect(() => {
    if (!sessionId || !ready || sending || turns.length > 0) return;
    const brief = seedBrief?.trim();
    if (!brief || seeded.current === sessionId) return;
    seeded.current = sessionId;
    void send(brief);
  }, [sessionId, ready, sending, turns.length, seedBrief, send]);

  const decide = React.useCallback(async (fingerprint: string, approve: boolean) => {
    // The same words and fields the main Paige chat sends from its approval card: the gate runs
    // only a call whose fingerprint is in approvedConfirmations, and a decline cancels the proposal.
    await send(approve ? "Approved — run it." : "Hold off — skip that one.", approve ? { approved: [fingerprint] } : { declined: [fingerprint] });
  }, [send]);

  return { ready, loadError, turns, sending, steps, status, choices, confirms, preview, sendError, send, decide };
}
