// The Studio session's conversation with Paige. One thread per project (paige_studio_thread_ensure),
// streamed from paige-ai-chat. Paige's build steps, her one grouped question and the artifact she
// produced arrive as their own frames; nothing here invents a step or a result the stream did not send.
import React from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureThread, loadTurns, plainError, Said, type ArtifactKind, type ChatTurn } from "./studio-data";

export interface BuildStep { id: string; label: string; detail?: string; status: "done" | "error"; at: number }
export interface ChoiceOption { label: string; value: string; description?: string }
export interface Choices { prompt: string; options: ChoiceOption[]; multi: boolean; allowOther: boolean }
export interface ProducedArtifact { kind: ArtifactKind; id: string; title: string }
/** An action Paige proposed that the owner's settings hold for approval (the paige_confirm frame). */
export interface PendingConfirm { tool: string; summary: string; fingerprint: string }
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
        const history = await loadTurns(id);
        if (!live) return;
        setThreadId(id); setTurns(history); setReady(true);
      } catch (e) {
        if (live) setLoadError(plainError(e, "This project's chat couldn't be opened. Try again in a moment."));
      }
    })();
    return () => { live = false; };
  }, [sessionId]);

  const send = React.useCallback(async (text: string, sendOpts?: { display?: string; approved?: string[]; declined?: string[] }) => {
    const trimmed = text.trim();
    if (!trimmed || sending || !threadId) return;
    setSendError(null); setChoices(null); setConfirms([]); setStatus(null); setSteps([]);
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
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let reply = "";
      let buffer = "";
      let done = false;
      let gotChoices = false;
      let sawStep = false;
      let sawConfirm = false;
      while (reader && !done) {
        const { done: end, value } = await reader.read();
        if (end) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { done = true; break; }
          let parsed: Record<string, unknown>;
          // A line is only parsed once its newline has arrived, so a parse failure is a bad line,
          // never a split one: skip it and keep reading.
          try { parsed = JSON.parse(payload); } catch { continue; }
          if (parsed.paige_step && typeof parsed.paige_step === "object") {
            const ps = parsed.paige_step as Record<string, unknown>;
            if (typeof ps.label === "string" && ps.label) {
              const label = ps.label;
              sawStep = true;
              setStatus(label);
              setSteps((prev) => {
                const id = typeof ps.id === "string" && ps.id ? ps.id : `s:${prev.length}`;
                if (prev.some((p) => p.id === id)) return prev;
                return [...prev, { id, label, detail: typeof ps.detail === "string" ? ps.detail : undefined, status: ps.status === "error" ? "error" : "done", at: Date.now() }];
              });
            }
            continue;
          }
          if (parsed.paige_choices && typeof parsed.paige_choices === "object") {
            const c = parsed.paige_choices as Record<string, unknown>;
            const options = Array.isArray(c.options) ? (c.options as Record<string, unknown>[])
              .filter((o) => typeof o.label === "string")
              .map((o) => ({ label: String(o.label), value: typeof o.value === "string" ? o.value : String(o.label), description: typeof o.description === "string" ? o.description : undefined })) : [];
            const prompt = typeof c.prompt === "string" ? c.prompt : "";
            gotChoices = true;
            setChoices({ prompt, options, multi: c.multi === true, allowOther: c.allow_other === true });
            if (!reply.trim() && prompt) { reply = prompt; setTurns([...shown, { role: "assistant", content: reply }]); }
            continue;
          }
          if (parsed.paige_artifact) { produced = toArtifact(parsed.paige_artifact) ?? produced; continue; }
          if (parsed.paige_confirm && typeof parsed.paige_confirm === "object") {
            const c = parsed.paige_confirm as Record<string, unknown>;
            if (typeof c.summary === "string" && typeof c.fingerprint === "string") {
              const pc = { tool: String(c.tool ?? "action"), summary: c.summary, fingerprint: c.fingerprint };
              sawConfirm = true;
              setConfirms((prev) => (prev.some((x) => x.fingerprint === pc.fingerprint) ? prev : [...prev, pc]));
            }
            continue;
          }
          if (parsed.paige_preview && typeof parsed.paige_preview === "object") {
            const pv = parsed.paige_preview as Record<string, unknown>;
            if (Array.isArray(pv.blocks) && pv.blocks.length) {
              setPreview({ kind: pv.kind === "funnel" ? "funnel" : "page", title: typeof pv.title === "string" ? pv.title : "Draft", blocks: pv.blocks, theme: pv.theme ?? null });
            }
            continue;
          }
          const choicesArr = parsed.choices as { delta?: { content?: unknown } }[] | undefined;
          const delta = choicesArr?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            reply += delta;
            setTurns([...shown, { role: "assistant", content: reply }]);
          }
        }
      }
      if (!reply.trim() && !gotChoices && !produced && !sawStep && !sawConfirm) setTurns([...shown, { role: "assistant", content: "I didn't catch that. Try saying it another way?" }]);
      failedIntent.current = null;
      // A saved piece replaces any unsaved preview: the stage now shows the real thing.
      if (produced) { setPreview(null); cb.current.onArtifact(produced); }
    } catch (e) {
      if (abort.current?.signal.aborted) return;
      setTurns(before);
      setSteps([]);
      failedIntent.current = { text: trimmed, id: requestIntentId };
      setSendError(plainError(e, "Paige couldn't take that just now. Check your connection and try again."));
    } finally {
      if (!controller.signal.aborted) {
        setSending(false);
        setStatus(null);
        cb.current.onTurnDone();
      }
    }
  }, [sending, threadId, turns]);

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
