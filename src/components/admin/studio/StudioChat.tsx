// The Vibe Studio session's OWN chat (#292) — the LIVE, two-way conversation with the tenant's
// creative-design agent (one of Paige's specialists, NOT Paige; §8/§14). The customer only talks:
// "make an image of X", "build a landing page for Y", "make the headline bolder" — the agent runs
// the real generation tools and what it makes renders on the project canvas to the RIGHT of this
// chat. This is the whole session surface: no mode tabs, no type picker, one conversation (§18/§21).
//
// §18: NOT a second chat system and NOT the full Your-Paige console. It reuses the paige-ai-chat
// streaming engine + paige_chat_threads/paige_chat_turns; the identity is swapped to the
// design-studio sub-agent server-side (gated on the thread's studio_session_id), and the same gate
// LINKS what it creates to the project and streams back a `paige_artifact` frame naming exactly what
// to render (server-authoritative — the client never guesses). This surface: ensures the session's
// thread, hydrates its turns, streams a turn, lifts the newest artifact + busy/step to the parent
// canvas, and renders the agent's clickable option chips (`ask_choices`).
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { supabase } from "@/integrations/supabase/client";
import { PromptComposer } from "./PromptComposer";
import { AgentChoiceCard } from "./chat/AgentChoiceCard";
import { PaigeThinkingIndicator } from "@/components/paige/chat/PaigeThinkingIndicator";
import { PaigeCompactingCard, type CompactingSignal } from "@/components/paige/chat/PaigeCompactingCard";
import type { StudioBuildStep } from "./StudioBuildingScreen";
import { uploadGrowthAsset } from "./studio";
import type { GrowthAsset } from "@/lib/growth";
import { Button } from "@/components/ui/button";
import { Check, Clock, Image as ImageIcon, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** The agent writes in markdown (**bold**, lists, links) — render it as prose, never as raw text with
 *  literal asterisks (owner 2026-07-18: "this has to be a good experience"). Same token-styled
 *  treatment as DocumentPreview's Prose. The value is coerced to a string at the boundary (react-markdown
 *  v10 throws on a truthy non-string), so a mis-typed value degrades to empty rather than crashing the
 *  whole bubble (§13 — degrade, don't crash). User turns stay plain text. */
function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_em]:italic [&_strong]:font-semibold [&_strong]:text-foreground [&_p]:mt-2 first:[&_p]:mt-0 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mt-1 [&_code]:rounded [&_code]:bg-[hsl(var(--foreground)/0.06)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(text ?? "")}</ReactMarkdown>
    </div>
  );
}

// Generated Supabase types don't yet carry the studio thread column/RPC — a scoped cast keeps the
// call sites honest without loosening the whole client (same pattern as usePaigeThreads).
/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

interface ChatMsg { role: "user" | "assistant"; content: string }
interface ChoiceOption { label: string; value: string; description?: string; icon?: string; preview?: string }
interface Choices { prompt: string; options: ChoiceOption[]; multi?: boolean; allow_other?: boolean }

/** A brief the customer STAGED while the agent was mid-turn (roadmap #155). The single-active-command
 *  gate is unchanged — only ONE turn is ever in flight — but a new submission no longer blocks: it
 *  lands here in a FIFO queue and auto-dispatches the moment the current turn returns (the "time
 *  unlock"). Each entry carries its OWN attachment snapshot (the tray it was staged with), so what
 *  ran is exactly what was staged — nothing crosses wires with a later message (§13). */
interface QueuedBrief { id: string; text: string; attachments: GrowthAsset[] }
/** Cap the staging depth so it stays a "next few" affordance, not an unbounded backlog. */
const MAX_QUEUE = 5;

/** What the conversation last put on the canvas — server-authoritative (from the paige_artifact
 *  frame), so the parent renders EXACTLY what was built, never a guessed manifest index. */
export interface StudioChatArtifact {
  kind: "page" | "funnel" | "content" | "document";
  id: string;
  title: string;
  url: string | null; // present for an image (content); null for page/funnel/document
}

export function StudioChat({
  sessionId,
  tenantId,
  className,
  seedBrief,
  canvasArtifact,
  onBusy,
  onNote,
  onSteps,
  onArtifact,
}: {
  sessionId: string | null;
  tenantId: string | null;
  className?: string;
  /** The dashboard→session brief. Auto-sent ONCE as the first turn when the session is brand new
   *  (no prior turns), so the initial build runs through THIS chat, not a second engine. */
  seedBrief?: string | null;
  /** What's currently on the canvas (server-authoritative). Sent up to paige-ai-chat so the model
   *  can UPDATE that same artifact in place — keeping its version history — when the turn refines it,
   *  instead of minting a fresh sibling every regeneration (#292 image/document version stacking). */
  canvasArtifact?: StudioChatArtifact | null;
  /** True while a turn streams — lets the canvas show a live "building" state, not a dead pane. */
  onBusy?: (busy: boolean) => void;
  /** The latest real streamed step label — the honest cutscene narration (§13). */
  onNote?: (note: string | null) => void;
  /** The full ACCUMULATING real step trace for this turn — captured 1:1 from the server's
   *  `paige_step` frames (kind/label/status/detail), reset at the start of each turn. The split
   *  build cutscene renders these as settled real beats; nothing here is fabricated (§13). */
  onSteps?: (steps: StudioBuildStep[]) => void;
  /** The artifact this turn produced (from the server's paige_artifact frame). Null = no visual
   *  artifact this turn (e.g. a pure-copy or chat-only reply) — the parent keeps the current stage. */
  onArtifact?: (artifact: StudioChatArtifact | null) => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null); // live "working…" line
  const [steps, setSteps] = useState<StudioBuildStep[]>([]); // the accumulating REAL step trace (§13)
  const [thinking, setThinking] = useState<string>(""); // U2 — extended-thinking text for THIS turn (distinct channel; empty unless the server opted in, default OFF)
  const [thinkStartedAt, setThinkStartedAt] = useState<number | null>(null); // U2 — performance.now() when reasoning began (drives the live duration)
  const [thinkMs, setThinkMs] = useState<number | null>(null); // U2 — frozen reasoning duration once the answer text begins
  const [loading, setLoading] = useState(true);
  const [writingPhase, setWritingPhase] = useState(false); // #11 — first answer token arrived this turn
  const [compacting, setCompacting] = useState<CompactingSignal | null>(null); // #12 — persisted session → can fold
  const [choices, setChoices] = useState<Choices | null>(null); // pending clickable options
  const [multiPicks, setMultiPicks] = useState<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<GrowthAsset[]>([]); // reference images dropped in-chat
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [queue, setQueue] = useState<QueuedBrief[]>([]); // briefs staged while the agent is busy (#155)
  const failedIntentRef = useRef<{ text: string; id: string } | null>(null);
  const [queuePaused, setQueuePaused] = useState(false); // a turn failed — hold the rest, don't fire into a failing state (§13)
  const scrollRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // Parent callbacks held in refs so a new function identity never re-fires the sync effects.
  const cb = useRef({ onBusy, onNote, onSteps, onArtifact });
  useEffect(() => { cb.current = { onBusy, onNote, onSteps, onArtifact }; }, [onBusy, onNote, onSteps, onArtifact]);
  useEffect(() => { cb.current.onBusy?.(sending); }, [sending]);
  useEffect(() => { cb.current.onNote?.(note); }, [note]);
  useEffect(() => { cb.current.onSteps?.(steps); }, [steps]);

  // Ensure the session's thread + hydrate its turns whenever the session changes.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    // A session switch must NEVER carry staged briefs across — a command queued in project A would
    // otherwise auto-dispatch against project B (a §9/§13 cross-session leak). Drop the queue + pause
    // and reset the thread up front so the auto-dispatch effect can't fire against a stale thread
    // during the switch.
    setQueue([]);
    setQueuePaused(false);
    setThreadId(null);
    if (!sessionId) { setMessages([]); setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const { data: tid, error } = await db.rpc("paige_studio_thread_ensure", { p_session_id: sessionId });
        if (error) throw error;
        if (!live) return;
        const id = tid ? String(tid) : null;
        setThreadId(id);
        if (id) {
          const { data: turns } = await db
            .from("paige_chat_turns")
            .select("role, content, seq")
            .eq("thread_id", id)
            .in("role", ["user", "assistant"])
            .order("seq", { ascending: true });
          if (live) {
            setMessages(((turns ?? []) as ChatMsg[]).map((t) => ({ role: t.role, content: t.content })));
          }
        }
      } catch {
        if (live) toast.error("Couldn't open this session's chat.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [sessionId]);

  // Autostart handoff (§3 / post-deploy fix): a brand-new project fires its FIRST build through THIS
  // chat. `sessionSeedBrief` arrives ASYNC (the parent resolves it after loadSession), often AFTER
  // this component mounts — so the seed can't live in the thread-ensure effect's mount closure. This
  // dedicated effect fires the moment ALL of {thread ready · not loading · no turns yet · brief
  // present} hold, guarded per-session so it never double-fires.
  useEffect(() => {
    if (!sessionId || !threadId || loading || sending) return;
    if (messages.length > 0) return;
    const brief = seedBrief?.trim();
    if (!brief || seededRef.current === sessionId) return;
    seededRef.current = sessionId;
    void send(brief);
  }, [sessionId, threadId, loading, sending, messages.length, seedBrief]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the transcript pinned to the latest as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, note, choices]);

  // Send a turn. `display` lets a tapped chip show its friendly label while the model receives the
  // canonical value.
  const send = useCallback(async (text: string, opts?: { display?: string; attachments?: GrowthAsset[]; queuedItem?: QueuedBrief }) => {
    const trimmed = text.trim();
    // A queued dispatch carries the attachment snapshot it was STAGED with (opts.attachments); a
    // manual/immediate turn uses whatever's live in the tray. Snapshot before we clear the tray, so an
    // image-only turn ("here, build from this") still carries them. Images alone are a valid turn (N4).
    const usingLiveAttachments = opts?.attachments === undefined;
    const turnAttachments = opts?.attachments ?? attachments;
    const hasImages = turnAttachments.length > 0;
    if ((!trimmed && !hasImages) || sending || !threadId) return;
    setInput("");
    setNote(null);
    setChoices(null); // answering (or a fresh turn) clears any pending decision (guards double-fire)
    setMultiPicks(new Set());
    // Image-only turns still need words for the transcript + the model — give it a natural default.
    const modelText = trimmed || "Here's a reference image — use it as the starting point for what you build.";
    const requestIntentId = opts?.queuedItem?.id
      ?? (failedIntentRef.current?.text === modelText ? failedIntentRef.current.id : crypto.randomUUID());
    const shown = opts?.display ?? (trimmed || (hasImages ? `Shared ${turnAttachments.length} reference image${turnAttachments.length > 1 ? "s" : ""}` : trimmed));
    const next = [...messages, { role: "user" as const, content: shown }];
    // What the MODEL receives (canonical value); the transcript shows `shown`.
    const modelMessages = [...messages, { role: "user" as const, content: modelText }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setSending(true);
    setSteps([]); // fresh turn → drop the prior turn's real trace so the cutscene never shows stale beats (§13)
    setWritingPhase(false); // #11 — back to "Thinking…" until the first token this turn
    setCompacting(null); // #12 — clear any prior turn's compacting card
    setThinking(""); // U2 — fresh turn drops the prior turn's thinking so the collapsible block never shows stale reasoning (§13)
    setThinkStartedAt(null); setThinkMs(null); // U2 — reset this turn's reasoning duration tracking (§13)
    let gotChoices = false;
    let gotArtifact: StudioChatArtifact | null = null;
    let ok = false;
    let thinkStart: number | null = null; // U2 — performance.now() when reasoning began this turn (§13 honest timing)
    let thinkFrozen: number | null = null; // U2 — reasoning duration frozen once the answer text begins
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Please sign in again."); // handled uniformly below (roll back + pause)
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          messages: modelMessages,
          threadId,
          requestIntentId,
          attachments: hasImages
            ? turnAttachments.map((a) => ({ url: a.url, name: a.name, mimeType: a.mimeType, kind: a.kind }))
            : undefined,
          // What's on the canvas right now — so the model can refine THAT artifact in place (keeping
          // its version history) rather than mint a new sibling when this turn is an edit (#292).
          canvasArtifact: canvasArtifact ? { id: canvasArtifact.id, kind: canvasArtifact.kind } : undefined,
        }),
      });
      if (!resp.ok) throw new Error(resp.status === 429 ? "Give it a moment — too many requests." : "The chat hit a snag.");

      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let assistant = "";
      let buffer = "";
      let done = false;
      while (reader && !done) {
        const { done: rdone, value } = await reader.read();
        if (rdone) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "" || !line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(payload);
            if (parsed.paige_step) {
              // Keep the rolling label (the honest fallback line) AND accumulate the FULL frame into
              // the real trace — 1:1 from the server, never a fabricated phase (§13). Each frame is
              // terminal (done/error) when it arrives; dedupe defensively by id.
              const ps = parsed.paige_step as {
                id?: unknown; seq?: unknown; kind?: unknown; label?: unknown; status?: unknown; detail?: unknown;
              };
              const label = typeof ps.label === "string" ? ps.label : null;
              setNote(label);
              if (label) {
                setSteps((prev) => {
                  const step: StudioBuildStep = {
                    id: typeof ps.id === "string" && ps.id ? ps.id : `s:${prev.length}`,
                    seq: typeof ps.seq === "number" ? ps.seq : prev.length,
                    kind: ps.kind === "thought" ? "thought" : "action",
                    label,
                    status: ps.status === "error" ? "error" : "done",
                    detail: typeof ps.detail === "string" ? ps.detail : undefined,
                  };
                  return prev.some((p) => p.id === step.id) ? prev : [...prev, step];
                });
              }
              continue;
            }
            // The agent asked a clickable decision — render its chips under the question (§13-honest:
            // chips appear ONLY when the model actually emits them; the prompt IS the assistant turn).
            if (parsed.paige_choices) {
              gotChoices = true;
              const c = parsed.paige_choices as Choices;
              setChoices(c);
              if (!assistant.trim()) { assistant = c.prompt; setMessages([...next, { role: "assistant", content: assistant }]); }
              continue;
            }
            // The server named exactly what to render on the canvas this turn.
            if (parsed.paige_artifact) { gotArtifact = parsed.paige_artifact as StudioChatArtifact; continue; }
            // #11 — the server confirmed the reply is starting (belt-and-braces with the first delta).
            if (parsed.paige_phase === "writing") { setWritingPhase(true); continue; }
            // #12 — conversation-compacting lifecycle for this persisted session.
            if (parsed.paige_compacting) { setCompacting(parsed.paige_compacting as CompactingSignal); continue; }
            // U2 — extended thinking on its DISTINCT channel (`delta.paige_thinking`), GATED OFF by
            // default server-side. It is NEVER answer text: accumulate it separately so the reasoning
            // renders in its own dimmed, collapsible block above the reply and never leaks into the
            // bubble. With the flag off this field never arrives and the branch is dead (byte-identical).
            const think = parsed.choices?.[0]?.delta?.paige_thinking as string | undefined;
            if (typeof think === "string") {
              if (thinkStart == null) { thinkStart = performance.now(); setThinkStartedAt(thinkStart); }
              setThinking((prev) => prev + think);
              continue;
            }
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              if (!assistant) setWritingPhase(true); // #11 — first token → "Writing…"
              // First answer text after reasoning → freeze the thinking duration (thinking always
              // precedes text in Anthropic's stream), so the panel settles to "Thought for Ns" (§13).
              if (thinkStart != null && thinkFrozen == null) { thinkFrozen = performance.now() - thinkStart; setThinkMs(thinkFrozen); }
              assistant += delta;
              setMessages([...next, { role: "assistant", content: assistant }]);
            }
          } catch { buffer = line + "\n" + buffer; break; } // partial JSON — re-buffer
        }
      }
      // §13: nothing streamed AND no chips → say so honestly rather than leave an empty bubble.
      if (!assistant.trim() && !gotChoices) {
        setMessages([...next, { role: "assistant", content: "I didn't catch that — try saying it another way?" }]);
      }
      ok = true;
      failedIntentRef.current = null;
    } catch (e) {
      setMessages(messages); // roll back the optimistic turn
      // §13 nothing lost. A MANUAL turn's text goes back into the composer. A QUEUED turn goes back to
      // the FRONT of the queue (never clobber whatever the customer may now be typing) — it stays a
      // visible chip and re-runs on Resume.
      if (opts?.queuedItem) setQueue((q) => [opts.queuedItem!, ...q]);
      else {
        failedIntentRef.current = { text: modelText, id: requestIntentId };
        setInput(trimmed);
      }
      toast.error(e instanceof Error ? e.message : "The chat hit a snag.");
    } finally {
      setSending(false);
      setNote(null);
      // U2 — reasoning began but never handed off to text (choices-only / empty reply): freeze its
      // duration at turn end so the panel reads "Thought for Ns", never a forever-ticking timer (§13).
      if (thinkStart != null && thinkFrozen == null) setThinkMs(performance.now() - thinkStart);
      // Clear the reference-image tray only on a clean turn that USED the live tray (N3) — a failed
      // turn keeps them, and a queued dispatch used its own snapshot so it must not wipe the live tray.
      if (ok && hasImages && usingLiveAttachments) setAttachments([]);
      // The queue only auto-advances after a SUCCESSFUL turn; a failure pauses it (§13) so the rest is
      // never fired into a failing state. A clean turn clears any prior pause so the "time unlock" runs.
      setQueuePaused(!ok);
      // Hand the parent exactly what the server said it built this turn (null = keep the stage).
      cb.current.onArtifact?.(gotArtifact);
    }
  }, [messages, sending, threadId, attachments, canvasArtifact]);

  // The customer submitted from the composer. Idle → send immediately (unchanged). Busy → STAGE it in
  // the FIFO queue instead of blocking (the single-active-command gate is preserved: exactly one turn
  // in flight). The tray it was staged with rides along on the queued entry, then clears so they can
  // stage a fresh one. Queue is capped (MAX_QUEUE) with a gentle toast rather than an unbounded backlog.
  const onComposerSubmit = useCallback((text: string) => {
    const trimmed = text.trim();
    const live = attachments;
    const hasImages = live.length > 0;
    if (!trimmed && !hasImages) return;
    if (sending) {
      // Enforce the cap INSIDE the functional update so two rapid submits can't both read a stale
      // length and overshoot MAX_QUEUE. `accepted` reflects whether it actually enqueued.
      const item = { id: crypto.randomUUID(), text: trimmed, attachments: live };
      let accepted = true;
      setQueue((q) => {
        if (q.length >= MAX_QUEUE) { accepted = false; return q; }
        return [...q, item];
      });
      if (accepted) {
        setInput("");
        if (hasImages) setAttachments([]); // captured onto the queued entry above
      } else {
        toast(`That's the max of ${MAX_QUEUE} staged — they'll run first, then send more.`);
      }
      return;
    }
    void send(text);
  }, [sending, attachments, send]);

  const onRemoveQueued = useCallback((id: string) => {
    setQueue((q) => q.filter((it) => it.id !== id));
  }, []);

  // The "time unlock" (#155): the queue is only ever populated WHILE a turn is in flight, so this fires
  // exactly on the busy→idle edge — dispatch the next staged brief, which flips `sending` back true and
  // re-gates this until it returns, draining one-at-a-time. Paused (a prior failure) holds it.
  useEffect(() => {
    if (sending || queuePaused || queue.length === 0 || !threadId) return;
    const head = queue[0];
    setQueue((q) => q.slice(1));
    void send(head.text, { attachments: head.attachments, queuedItem: head });
  }, [sending, queuePaused, queue, threadId, send]);

  // A drained queue has nothing left to resume — drop any lingering pause so the banner never sticks.
  useEffect(() => {
    if (queue.length === 0 && queuePaused) setQueuePaused(false);
  }, [queue.length, queuePaused]);

  // The customer dropped image(s) into the chat — upload each to the tenant's growth-assets bucket so
  // it has a public URL the server can fetch + base64-inline as build input. Images only in-chat (§18:
  // the one composer, no picker) — documents route through the doc-attach path, not this tray.
  const onFilesSelected = useCallback(async (files: File[]) => {
    if (!tenantId) { toast.error("Sign in to attach images."); return; }
    setAttachmentsBusy(true);
    try {
      for (const f of files) {
        const asset = await uploadGrowthAsset(tenantId, f, ["image"]);
        setAttachments((prev) => (prev.length >= 3 ? prev : [...prev, asset]));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't attach that image.");
    } finally {
      setAttachmentsBusy(false);
    }
  }, [tenantId]);

  const onRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const isLastAssistant = (i: number) => i === messages.length - 1 && messages[i]?.role === "assistant";

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      {/* Who you're talking to — the tenant's design specialist, never Paige (§8/§14). */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[hsl(var(--studio-chrome-border)/0.5)] px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(var(--studio-chrome-border)/0.6)] bg-[hsl(var(--foreground)/0.04)] text-foreground">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">Design agent</p>
          <p className="truncate text-[11px] text-muted-foreground">Your creative specialist — building right here</p>
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Opening your session…
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto max-w-md pt-8 text-center">
            <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-[hsl(var(--studio-chrome-border)/0.6)] bg-[hsl(var(--foreground)/0.04)] text-foreground">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <p className="text-sm text-foreground">Tell me what you want to make.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              “Build a landing page for my coaching offer.” · “Make an image of a sunrise over mountains.” · “Draft a discovery form.” · “Make the headline bolder.”
            </p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
              {/* #11 — the shared "Thinking… Ns / Writing… Ns" indicator ABOVE the reply (§18 — this
                  replaced the local ReasoningPanel). Its expandable "Thought process" renders the
                  streamed paige_step thoughts (the verbatim paige_thinking channel is server-disabled).
                  Renders only while the last assistant turn is streaming; hides on done. */}
              {m.role === "assistant" && isLastAssistant(i) && sending && (
                <div className="mb-1.5">
                  <PaigeThinkingIndicator
                    active={sending}
                    writing={writingPhase}
                    thoughts={steps.filter((s) => s.kind === "thought").map((s) => ({ id: s.id, label: s.label }))}
                    personaName="Design agent"
                  />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "whitespace-pre-wrap bg-[hsl(var(--ring)/0.16)] text-foreground"
                    : "border border-[hsl(var(--studio-chrome-border)/0.5)] bg-[hsl(var(--foreground)/0.03)] text-foreground",
                )}
              >
                {m.content ? (
                  m.role === "assistant" ? (
                    <ChatMarkdown text={m.content} />
                  ) : (
                    m.content
                  )
                ) : sending && i === messages.length - 1 ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                    {note ?? "Working…"}
                  </span>
                ) : null}
              </div>

              {/* Clickable option chips — the agent asked a decision; tap one (or several) and it
                  becomes a real user turn. §11: gold reserved for the multi-select Continue act. */}
              {choices && isLastAssistant(i) && (
                <div className="mt-2 max-w-[85%]" role={choices.multi ? "listbox" : "radiogroup"} aria-label={choices.prompt}>
                  <div className="flex flex-wrap gap-2">
                    {choices.options.map((opt) => {
                      const picked = multiPicks.has(opt.value);
                      const rich = Boolean(opt.description || opt.icon || opt.preview);
                      const choose = () => {
                        if (choices.multi) {
                          setMultiPicks((prev) => {
                            const nextSet = new Set(prev);
                            if (nextSet.has(opt.value)) nextSet.delete(opt.value);
                            else nextSet.add(opt.value);
                            return nextSet;
                          });
                        } else {
                          void send(opt.value, { display: opt.label });
                        }
                      };
                      // Rich options (description/preview/icon) render as generative-UI CARDS; a bare
                      // {label,value} stays the compact pill (backward-compat, §12/§18). §11: selection
                      // is indigo; gold is reserved for the multi-select "Continue" act below.
                      if (rich) {
                        return (
                          <AgentChoiceCard
                            key={opt.value}
                            option={opt}
                            selected={choices.multi ? picked : false}
                            multi={!!choices.multi}
                            disabled={sending}
                            onSelect={choose}
                          />
                        );
                      }
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role={choices.multi ? "option" : "radio"}
                          aria-checked={choices.multi ? picked : undefined}
                          disabled={sending}
                          onClick={choose}
                          className={cn(
                            "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors motion-reduce:transition-none disabled:opacity-50",
                            picked
                              ? "border-primary/70 bg-[hsl(var(--ring)/0.14)] font-medium text-foreground"
                              : "border-[hsl(var(--studio-chrome-border)/0.6)] bg-[hsl(var(--foreground)/0.03)] text-foreground hover:bg-[hsl(var(--foreground)/0.06)]",
                          )}
                        >
                          {picked && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {choices.allow_other && (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => { setChoices(null); setMultiPicks(new Set()); }}
                      className="mt-2 inline-flex items-center rounded-full px-2 py-1 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-50 motion-reduce:transition-none"
                    >
                      Something else — I’ll type it
                    </button>
                  )}
                  {choices.multi && (
                    <Button
                      variant="gold" size="sm" className="mt-2"
                      disabled={sending || multiPicks.size === 0}
                      onClick={() => {
                        const picks = choices.options.filter((o) => multiPicks.has(o.value));
                        void send(picks.map((p) => p.value).join(", "), { display: picks.map((p) => p.label).join(" · ") });
                      }}
                    >
                      Continue
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
        {/* #12 — conversation-compacting card (this session persists → it can genuinely fold). Renders
            only when the server streams a compacting frame; nothing fake otherwise (§13). */}
        {compacting && (
          <PaigeCompactingCard signal={compacting} personaName="Design agent" />
        )}
      </div>

      {/* Composer — reuse the ONE studio composer (§18/§21: NOT a new surface, just the chat input),
          circular send, docked. Always live, so a submission is never blocked: idle it sends, busy it
          STAGES below. */}
      <div className="shrink-0 px-3 pb-3">
        {/* Staged briefs (#155) — compact removable chips in the SAME visual language as the note/
            attachment chips above (§12/§18), never gold (§11: gold is only the act). Motion-safe
            enter/exit via framer-motion, guarded by useReducedMotion. */}
        {queue.length > 0 && (
          <div className="mb-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden />
                {queuePaused ? "Queue paused" : `Up next · ${queue.length}`}
              </span>
              {queuePaused ? (
                <button
                  type="button"
                  onClick={() => setQueuePaused(false)}
                  className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setQueue([])}
                  className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5" aria-live="polite">
              <AnimatePresence initial={false}>
                {queue.map((item, i) => (
                  <motion.span
                    key={item.id}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: 4, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                    transition={{ duration: reduce ? 0 : 0.16 }}
                    className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-[hsl(var(--studio-glass-border)/0.7)] bg-[hsl(var(--foreground)/0.05)] py-1 pl-2 pr-1.5 text-xs text-foreground"
                  >
                    <span className="shrink-0 tabular-nums text-[11px] font-semibold text-foreground/80">{i + 1}</span>
                    <span className="truncate">
                      {item.text || `${item.attachments.length} reference image${item.attachments.length > 1 ? "s" : ""}`}
                    </span>
                    {item.text && item.attachments.length > 0 && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                        <ImageIcon className="h-3 w-3" aria-hidden />
                        {item.attachments.length}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveQueued(item.id)}
                      aria-label={`Remove staged command ${i + 1}`}
                      className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
            {queuePaused && (
              <p className="px-1 text-[11px] text-muted-foreground">
                A command didn’t send. Resume to retry, or remove staged ones to drop them.
              </p>
            )}
          </div>
        )}

        <PromptComposer
          mode="page"
          value={input}
          onChange={setInput}
          onSubmit={onComposerSubmit}
          // Never gate the submit on `sending` — staging must work while the agent is busy. The live
          // "working" state is shown in the transcript bubble + the helper line below, not by locking
          // the composer.
          busy={false}
          disabled={loading || !threadId}
          enterSubmits
          placeholder="Tell your design agent what to make…"
          helperText={
            sending
              ? queue.length >= MAX_QUEUE
                ? `Queue’s full (${MAX_QUEUE}) — these run first.`
                : "Agent’s on it — your next message queues and runs the moment this one’s done."
              : ""
          }
          submitLabel="Send"
          busyLabel="Working…"
          sendShape="circle"
          minRows={1}
          attachments={attachments}
          onFilesSelected={onFilesSelected}
          onRemoveAttachment={onRemoveAttachment}
          attachmentsBusy={attachmentsBusy}
        />
      </div>
    </div>
  );
}

export default StudioChat;
