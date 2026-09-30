import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, CirclePause, ExternalLink, Hand, Mic, MicOff, Minimize2, PhoneOff, RefreshCw, ShieldCheck, Square, Volume2, X } from "lucide-react";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAIGE_LIVE_CONVERSATION_ENABLED, type LiveConversationCard } from "@/lib/paigeLiveConversation/contract";
import { acceptPaigeLiveTerms, renewPaigeLiveRelayTicket, startPaigeLiveConversation, transitionPaigeLiveConversation, type PaigeLiveEntryMode, type PaigeLiveStartResult } from "@/lib/paigeLiveConversation/client";
import { connectPaigeLiveRelay, type RelayTransport } from "@/lib/paigeLiveConversation/relayTransport";
import { PaigePresence3D } from "./PaigePresence3D";
import { usePaigeOutput } from "./usePaigeOutput";
import { resolvePresenceState } from "@/lib/paigeLiveConversation/presence";
import { createAnchoredTranscriptScroll, messageScrollAnchorKey } from "@/components/chat/anchoredTranscriptScroll";
import "./paige-live-conversation.css";

export type PaigeLiveTranscriptTurn = Readonly<{ id: string; role: "user" | "assistant"; content: string }>;
export type LiveVoiceSink = Readonly<{
  challenge: string;
  proof(token: string): void;
  done(): void;
  failed(): void;
}>;
type LiveSurfaceState = "checking" | "unavailable" | "permission-denied" | "listening" | "thinking" | "waiting" | "speaking" | "interrupted" | "held" | "reconnecting";

const STATE_LABEL: Record<LiveSurfaceState, string> = {
  checking: "Checking availability",
  unavailable: "Live audio unavailable",
  "permission-denied": "Microphone permission denied",
  listening: "Listening",
  thinking: "Thinking",
  waiting: "Waiting",
  speaking: "Speaking",
  interrupted: "Interrupted",
  held: "On hold",
  reconnecting: "Reconnecting",
};

function ConversationCard({ card, disabled, canConfirm, onAnswer, onApprove, onDecline }: {
  card: LiveConversationCard;
  disabled: boolean;
  canConfirm: boolean;
  onAnswer: (answer: string) => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); if (answer.trim()) onAnswer(answer.trim()); };
  return (
    <section className="plc-card" aria-labelledby={`plc-card-${card.id}`} data-card-kind={card.kind}>
      <div className="plc-card__eyebrow">
        <span>{card.kind === "evidence-result" ? "Evidence / result" : card.kind.replace("-", " ")}</span>
        <span className="plc-availability">{card.source.availability}</span>
      </div>
      <h2 id={`plc-card-${card.id}`}>{card.title}</h2>
      {card.body && <p className="plc-card__body">{card.body}</p>}
      {card.source.provenanceLabel && <p className="plc-card__source">Source: {card.source.provenanceLabel}</p>}
      {card.kind === "question" && (
        <form onSubmit={submit} className="plc-answer">
          <label className="sr-only" htmlFor={`plc-answer-${card.id}`}>Answer Paige</label>
          <input id={`plc-answer-${card.id}`} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder={card.placeholder ?? "Type your answer"} disabled={disabled} />
          <Button type="submit" size="sm" disabled={disabled || !answer.trim()}>Answer</Button>
        </form>
      )}
      {card.kind === "choice" && (
        <div className="plc-choices" role="group" aria-label={card.title}>
          {card.choices.slice(0, 4).map((choice, index) => (
            <Button key={choice.id} type="button" variant="outline" disabled={disabled} onClick={() => onAnswer(choice.label)}>
              <span aria-hidden>{index + 1}</span>{choice.label}
            </Button>
          ))}
        </div>
      )}
      {card.kind === "plan" && card.statusLabel && <p className="plc-card__status">{card.statusLabel}</p>}
      {card.kind === "evidence-result" && card.resultLabel && <p className="plc-card__status">{card.resultLabel}</p>}
      {card.kind === "governed-action" && (
        <div className="plc-governed">
          <div className="plc-governed__status"><ShieldCheck aria-hidden />{card.action.authorityStatus.replace(/-/g, " ")}</div>
          {card.action.scopeSummary && <p><strong>Exact scope:</strong> {card.action.scopeSummary}</p>}
          {card.action.authorityStatus === "confirmation-required" && canConfirm && (
            <div className="plc-card__actions">
              <Button variant="gold" disabled={disabled} onClick={onApprove}><Check aria-hidden />Confirm this action</Button>
              <Button variant="ghost" disabled={disabled} onClick={onDecline}><X aria-hidden />Not now</Button>
            </div>
          )}
          {card.action.receiptRef && <p className="plc-card__source">Receipt: {card.action.receiptRef}</p>}
          {card.action.railEvidenceRef && <p className="plc-card__source">Rail evidence: {card.action.railEvidenceRef}</p>}
        </div>
      )}
      {card.kind === "recap" && (
        <ul className="plc-recap">
          {card.points.map((point) => <li key={point.id}>{point.ownerConfirmed ? <Check aria-label="Confirmed" /> : <Square aria-label="Not confirmed" />}{point.text}</li>)}
        </ul>
      )}
    </section>
  );
}

export function PaigeLiveConversation({ disabled, contextEpoch, threadId, ensureThread, transcript, activeCard, workingLabel, working, confirmationFingerprints = [], onAnswer, onApprove, onDecline, onVoiceTurn, onVoiceInterrupt }: {
  disabled?: boolean;
  contextEpoch: string;
  threadId: string | null;
  ensureThread: () => Promise<string>;
  transcript: ReadonlyArray<PaigeLiveTranscriptTurn>;
  activeCard: LiveConversationCard | null;
  workingLabel?: string | null;
  working: boolean;
  confirmationFingerprints?: string[];
  onAnswer: (answer: string) => void;
  onApprove: (fingerprints: string[]) => void;
  onDecline: (fingerprints: string[]) => void;
  onVoiceTurn: (text: string, sink: LiveVoiceSink) => void | Promise<void>;
  onVoiceInterrupt: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageWindowRef = useRef<Window | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionScopeRef = useRef<{ threadId: string; contextEpoch: string } | null>(null);
  const relayRef = useRef<RelayTransport | null>(null);
  const relayReadyRef = useRef(false);
  const activeVoiceTurnRef = useRef<string | null>(null);
  // A socket outlives renders. Always dispatch into the current same-thread
  // composer/history scope, never the closure captured before lazy creation.
  const voiceCallbacksRef = useRef({ onVoiceTurn, onVoiceInterrupt });
  voiceCallbacksRef.current = { onVoiceTurn, onVoiceInterrupt };
  const stopRelay = useCallback(() => {
    if (activeVoiceTurnRef.current) {
      activeVoiceTurnRef.current = null;
      voiceCallbacksRef.current.onVoiceInterrupt();
    }
    relayRef.current?.stop();
    relayRef.current = null;
    relayReadyRef.current = false;
    if (mounted.current) attachOutputRef.current(null);
  }, []);
  const previousEpochRef = useRef(contextEpoch);
  const previousThreadRef = useRef(threadId);
  const requestGeneration = useRef(0);
  const mounted = useRef(true);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LiveSurfaceState>("checking");
  const [muted, setMuted] = useState(false);
  // Ticket renewal is asynchronous. Capture must follow the most recent control
  // choice, not the mute value captured when renewal began.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [availability, setAvailability] = useState("PROOF OWED");
  const [explanation, setExplanation] = useState("Live audio setup is being verified. Paige will not request microphone access until it is authorized.");
  const [portalDocument, setPortalDocument] = useState<Document | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // The refusal CODE, kept because one of them is the only one a person can act on themselves.
  const [reason, setReason] = useState<string | null>(null);
  const [acceptingTerms, setAcceptingTerms] = useState(false);
  // Set once the database has refused an acceptance from THIS person. It is the difference between
  // "we have not asked yet" and "we asked, and their consent is not what is missing" — and without
  // it the surface re-offers a control that has already proven it cannot do anything.
  const [consentRefused, setConsentRefused] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [scrollController] = useState(() => createAnchoredTranscriptScroll({ storagePrefix: "paige-live-reading", onPinnedChange: setPinned }));
  const scrollContext = `${contextEpoch}:${threadId ?? "new"}`;
  const output = usePaigeOutput(open && state !== "held", transcript.map((turn) => turn.id));
  const attachOutputRef = useRef(output.attachRelay);
  attachOutputRef.current = output.attachRelay;
  const stopPlayback = useRef(output.stop);
  stopPlayback.current = output.stop;
  const invalidatePending = useCallback(() => { requestGeneration.current++; }, []);

  useLayoutEffect(() => {
    // A null -> UUID prop alone does not prove creation; it may be history selection.
    // Never overwrite an existing thread's persisted anchor by inferring adoption here.
    scrollController.setContext(scrollContext);
  }, [contextEpoch, threadId, scrollContext, scrollController]);

  useLayoutEffect(() => {
    if (!open || !portalDocument || !stageRef.current) return;
    const view = portalDocument.defaultView;
    const media = view?.matchMedia?.("(max-width: 800px)");
    let scrollElement: HTMLDivElement | null = null;
    const bind = () => {
      scrollElement?.removeEventListener("scroll", scrollController.handleScroll);
      scrollElement = stageRef.current?.querySelector<HTMLDivElement>(media?.matches ? ".plc-stage__main" : ".plc-transcript") ?? null;
      scrollController.attach(scrollElement);
      scrollElement?.addEventListener("scroll", scrollController.handleScroll, { passive: true });
    };
    bind();
    media?.addEventListener("change", bind);
    return () => { media?.removeEventListener("change", bind); scrollElement?.removeEventListener("scroll", scrollController.handleScroll); scrollController.detach(); };
  }, [open, portalDocument, scrollController]);

  const transitionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const transitionCurrent = useCallback((transition: "hold" | "resume" | "minimize" | "restore" | "retry" | "end"): Promise<void> => {
    const scope = sessionScopeRef.current;
    const id = sessionIdRef.current;
    if (!id || !scope) return transitionQueueRef.current;
    const next = transitionQueueRef.current.then(() => transitionPaigeLiveConversation(id, transition, scope)).catch(() => undefined);
    transitionQueueRef.current = next;
    return next;
  }, []);

  const closeStage = useCallback((kind: "minimize" | "end") => {
    requestGeneration.current++;
    stopPlayback.current();
    stopRelay();
    transitionCurrent(kind);
    if (kind === "end") { sessionIdRef.current = null; sessionScopeRef.current = null; setSessionId(null); }
    const child = stageWindowRef.current;
    stageWindowRef.current = null;
    if (child && !child.closed) child.close();
    setOpen(false);
    setState("unavailable");
    setPortalDocument(null);
    setAnnouncement(kind === "end" ? "Live Conversation ended. The Paige chat is unchanged." : "Live Conversation minimized. Returned to the same Paige conversation.");
    requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
  }, [transitionCurrent, stopRelay]);

  useEffect(() => {
    if (!open) return;
    const ownerDocument = triggerRef.current?.ownerDocument ?? document;
    setPortalDocument(ownerDocument);
  }, [open]);

  useEffect(() => {
    if (!open || !portalDocument) return;
    requestAnimationFrame(() => stageRef.current?.focus({ preventScroll: true }));
  }, [open, portalDocument]);

  useEffect(() => {
    if (!open || !portalDocument || !stageRef.current) return;
    const stageElement = stageRef.current;
    // Realm-neutral: an existing chat pop-out's elements are not instanceof the opener realm's
    // HTMLElement constructor even though they are real elements in portalDocument.
    const siblings = Array.from(portalDocument.body.children).filter((node) => node.nodeType === 1 && node !== stageElement) as HTMLElement[];
    const previous = siblings.map((node) => ({ node, inert: node.hasAttribute("inert"), ariaHidden: node.getAttribute("aria-hidden") }));
    for (const { node } of previous) { node.setAttribute("inert", ""); node.setAttribute("aria-hidden", "true"); }
    return () => {
      for (const item of previous) {
        if (!item.inert) item.node.removeAttribute("inert");
        if (item.ariaHidden === null) item.node.removeAttribute("aria-hidden"); else item.node.setAttribute("aria-hidden", item.ariaHidden);
      }
    };
  }, [open, portalDocument]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidatePending();
      stopPlayback.current();
      stopRelay();
      transitionCurrent("end");
      const child = stageWindowRef.current;
      stageWindowRef.current = null;
      if (child && !child.closed) child.close();
    };
  }, [transitionCurrent, invalidatePending, stopRelay]);

  useEffect(() => {
    if (previousEpochRef.current === contextEpoch) return;
    previousEpochRef.current = contextEpoch;
    closeStage("end");
  }, [closeStage, contextEpoch, open]);

  useEffect(() => {
    const previous = previousThreadRef.current;
    previousThreadRef.current = threadId;
    if (sessionScopeRef.current && ((threadId && sessionScopeRef.current.threadId !== threadId) || (previous && threadId === null))) closeStage("end");
  }, [threadId, closeStage]);

  useEffect(() => {
    if (!open || !portalDocument) return;
    const stopHidden = () => {
      if (!portalDocument.hidden) return;
      stopPlayback.current();
      stopRelay();
      setState("reconnecting");
      setExplanation("Live audio stopped when this window was hidden. Try again or continue in chat.");
    };
    const disconnected = () => {
      stopPlayback.current();
      stopRelay();
      setState("reconnecting");
      setExplanation("The connection was interrupted. Try again or continue in chat.");
    };
    portalDocument.addEventListener("visibilitychange", stopHidden);
    portalDocument.defaultView?.addEventListener("offline", disconnected);
    return () => { portalDocument.removeEventListener("visibilitychange", stopHidden); portalDocument.defaultView?.removeEventListener("offline", disconnected); };
  }, [open, portalDocument, stopRelay]);

  const begin = async () => {
    if (!PAIGE_LIVE_CONVERSATION_ENABLED || disabled) return;
    const generation = ++requestGeneration.current;
    setOpen(true);
    if (sessionIdRef.current && sessionScopeRef.current?.contextEpoch === contextEpoch && sessionScopeRef.current.threadId === threadId) {
      await transitionCurrent("restore");
      if (!mounted.current || generation !== requestGeneration.current) return;
      const scope = sessionScopeRef.current;
      try {
        const renewed = await renewPaigeLiveRelayTicket({
          sessionId: sessionIdRef.current, threadId: scope.threadId, contextEpoch: scope.contextEpoch,
          entryMode: "embedded",
        });
        if (mounted.current && generation === requestGeneration.current) connectResult(renewed, generation);
      } catch {
        if (mounted.current && generation === requestGeneration.current) {
          stopPlayback.current();
          stopRelay();
          setState("unavailable");
          // A reconnect failure is not something a person accepts their way out of, so the audio
          // consent panel must not be left standing under it from an earlier refusal.
          setReason(null);
          setAvailability("UNAVAILABLE");
          setExplanation("Paige could not reconnect live audio. You can continue in chat.");
          setAnnouncement("Live audio unavailable. Paige could not reconnect live audio. You can continue in chat.");
        }
      }
      return;
    }
    setState("checking");
    setExplanation("Paige is checking whether live audio is authorized for this workspace.");
    try {
      const resolvedThread = threadId ?? await ensureThread();
      if (!mounted.current || generation !== requestGeneration.current) return;
      sessionScopeRef.current = { threadId: resolvedThread, contextEpoch };
      const ownerWindow = triggerRef.current?.ownerDocument.defaultView;
      const entryMode: PaigeLiveEntryMode = ownerWindow && ownerWindow !== window ? "existing-popout" : "embedded";
      const result = await startPaigeLiveConversation({ threadId: resolvedThread, contextEpoch, entryMode });
      if (!mounted.current || generation !== requestGeneration.current) {
        if (result.sessionId) void transitionPaigeLiveConversation(result.sessionId, "end", { threadId: resolvedThread, contextEpoch }).catch(() => undefined);
        return;
      }
      sessionIdRef.current = result.sessionId;
      setSessionId(result.sessionId);
      if (result.ok && result.sessionId && result.ticket) {
        setReason(null);
        connectResult(result, generation);
        return;
      }
      setAvailability(result.availability);
      setExplanation(result.explanation);
      setReason(result.code);
      setState(result.code === "microphone_permission_denied" ? "permission-denied" : "unavailable");
      setAnnouncement(`${result.availability}. ${result.explanation}`);
    } catch (error) {
      if (!mounted.current || generation !== requestGeneration.current) return;
      // Not a refusal anyone can accept their way out of, so the consent panel must not appear.
      setReason(null);
      setAvailability("UNAVAILABLE");
      setState("unavailable");
      setExplanation(error instanceof Error && error.message === "session_expired"
        ? "Your session expired. Sign in again, then return to this conversation."
        : "Paige could not verify live audio availability. Nothing was recorded or sent. Try again or continue in chat.");
    }
  };

  const connectResult = (result: PaigeLiveStartResult, generation: number) => {
    if (!result.ok || !result.sessionId || !result.ticket) {
      stopPlayback.current();
      stopRelay();
      setState("unavailable");
      setReason(null);
      setAvailability("UNAVAILABLE");
      setExplanation(result.explanation);
      setAnnouncement(`UNAVAILABLE. ${result.explanation}`);
      return;
    }
    stopRelay();
    setState("checking");
    setAvailability("PROOF OWED");
    setExplanation("Paige is checking the live connection. Your microphone has not started.");
    let transport: RelayTransport | null = null;
    transport = connectPaigeLiveRelay({
      sessionId: result.sessionId,
      ticket: result.ticket,
      onVoiceTurn: (text, turnId, challenge) => {
        if (!mounted.current || generation !== requestGeneration.current || !transport ||
          relayRef.current !== transport) return;
        activeVoiceTurnRef.current = turnId;
        const send = (kind: "proof" | "done" | "failed", value?: string) => {
          if (activeVoiceTurnRef.current !== turnId || relayRef.current !== transport) return;
          if (kind === "proof" && value) transport.runtimeProof(turnId, value);
          else if (kind === "done") { activeVoiceTurnRef.current = null; }
          else if (kind === "failed") { transport.runtimeFailed(turnId); activeVoiceTurnRef.current = null; }
        };
        setState("thinking");
        void Promise.resolve(voiceCallbacksRef.current.onVoiceTurn(text, {
          challenge,
          proof: (value) => send("proof", value),
          done: () => send("done"),
          failed: () => send("failed"),
        })).catch(() => send("failed"));
      },
      onRuntimeCancel: (turnId) => {
        if (activeVoiceTurnRef.current !== turnId) return;
        activeVoiceTurnRef.current = null;
        voiceCallbacksRef.current.onVoiceInterrupt();
        setState("listening");
      },
      onState: (next) => {
        if (!mounted.current || generation !== requestGeneration.current || relayRef.current !== transport) return;
        if (["unavailable", "permission-denied", "disconnected"].includes(next.kind)) stopRelay();
        if (next.kind === "ready") {
          relayReadyRef.current = true;
          setState("listening");
          setAvailability("LIVE");
          setExplanation("Paige is listening in this conversation.");
        } else if (next.kind === "speaking") {
          setState("speaking");
          setAvailability("LIVE");
        } else if (next.kind === "permission-denied") {
          relayReadyRef.current = false;
          setState("permission-denied");
          setReason(null);
          setAvailability("UNAVAILABLE");
          setExplanation("Microphone access is off. Allow it in your browser settings, then try again.");
        } else if (next.kind === "disconnected") {
          relayReadyRef.current = false;
          setState("reconnecting");
          setReason(null);
          setAvailability("UNAVAILABLE");
          setExplanation("The live connection ended. Try again or continue in chat.");
        } else {
          relayReadyRef.current = false;
          setState("unavailable");
          setReason(null);
          setAvailability("UNAVAILABLE");
          setExplanation(next.message);
        }
      },
    });
    relayRef.current = transport;
    attachOutputRef.current(transport);
    relayRef.current.setMuted(mutedRef.current);
  };

  const retry = async () => {
    if (disabled) return;
    // Clear the last refusal BEFORE re-asking. It is written on every refusal and was cleared in
    // only one place, so after the first "not open yet" it stayed set through retries and reopens —
    // and any LATER, different failure (a dropped socket, an expired session) would still render
    // the audio-retention consent panel underneath it, inviting someone to accept provider
    // retention in order to fix a network error. begin() sets it again if the answer is unchanged.
    setReason(null);
    transitionCurrent("end");
    sessionIdRef.current = null;
    sessionScopeRef.current = null;
    await begin();
  };

  /**
   * The person accepts Live's terms for themselves, then we try again.
   *
   * §70 — this is the difference between a capability that exists and one someone can finish. The
   * database has always been willing to take an acceptance; until this control existed there was no
   * way in the product to give one, so an open rollout still left a Solo user with nothing to press.
   *
   * §13 — the RPC refuses when the rollout does not cover this caller, writes nothing, and says so.
   * We surface that refusal as the same honest unavailable state, never as an error and never as a
   * success we are hoping for. It takes no identity argument: the subject is the signed-in person.
   */
  const acceptTerms = async () => {
    if (disabled || acceptingTerms) return;
    setAcceptingTerms(true);
    setAnnouncement("Turning on Live Conversation.");
    try {
      const outcome = await acceptPaigeLiveTerms();
      if (!mounted.current) return;
      if (!outcome.accepted) {
        // THE BUG THIS REPLACES. The old branch set the explanation to the byte-for-byte sentence
        // already on screen and left the consent panel and its button exactly as they were, so a
        // press produced NO visible change whatsoever and was indistinguishable from a dead control.
        // The owner pressed it and reported it broken, which is precisely §70: the code path ran and
        // a person could not tell. A refusal is an outcome and has to look like one.
        setConsentRefused(true);
        setReason(outcome.code ?? "live_audio_not_enabled");
        setExplanation("Live audio is not open on this platform yet. Your acceptance was not what was missing, so nothing was recorded, sent, or saved. Paige stays available in this conversation.");
        setAnnouncement("Live audio is not open on this platform yet. Nothing was recorded or sent. Paige stays available in this conversation.");
        return;
      }
      setConsentRefused(false);
      setReason(null);
      await retry();
    } catch {
      // A press that does nothing and says nothing is the failure this whole control exists to
      // remove, so it cannot be the way this control itself fails. The reachable case is ordinary:
      // acceptPaigeLiveTerms dynamically imports the Supabase client, and a hashed chunk goes stale
      // the moment a deploy lands under an open tab — which, shipping straight to main, is the
      // common case rather than the exotic one.
      if (!mounted.current) return;
      setExplanation("Paige could not turn Live on just now. Nothing was recorded, sent, or saved. Reload the page and try again, or keep working in this conversation.");
      setAnnouncement("Paige could not turn Live on. Nothing was recorded or sent.");
    } finally {
      if (mounted.current) setAcceptingTerms(false);
    }
  };

  const toggleHold = () => {
    const resuming = state === "held";
    if (resuming) output.resume(); else output.pause();
    const live = resuming && relayReadyRef.current;
    relayRef.current?.setMuted(!live || muted);
    const next = resuming ? (live ? "listening" : "unavailable") : "held";
    setState(next);
    setAnnouncement(next === "held" ? "Live Conversation is on hold." : live ? "Live Conversation resumed." : "Live Conversation resumed. Audio remains unavailable until setup is verified.");
    transitionCurrent(next === "held" ? "hold" : "resume");
  };

  const openInWindow = () => {
    const child = window.open("", "paige-live-conversation", "popup,width=960,height=760,resizable=yes");
    if (!child) { setAnnouncement("Your browser blocked the live window. Allow pop-ups and try again."); return; }
    child.document.title = "Live Conversation with Paige";
    child.document.head.replaceChildren(...Array.from(document.head.querySelectorAll('link[rel="stylesheet"],style')).map((node) => node.cloneNode(true)));
    child.document.documentElement.className = document.documentElement.className;
    for (const attribute of ["data-pg", "data-theme"]) {
      const value = document.documentElement.getAttribute(attribute);
      if (value) child.document.documentElement.setAttribute(attribute, value);
    }
    child.document.documentElement.style.colorScheme = getComputedStyle(document.documentElement).colorScheme;
    child.document.body.className = document.body.className;
    child.document.body.replaceChildren();
    child.document.body.style.margin = "0";
    child.document.body.style.height = "100vh";
    child.document.body.style.overflow = "hidden";
    stageWindowRef.current = child;
    child.addEventListener("beforeunload", () => {
      if (stageWindowRef.current !== child) return;
      stageWindowRef.current = null;
      requestGeneration.current++;
      stopPlayback.current();
      stopRelay();
      transitionCurrent("minimize");
      setOpen(false);
      setPortalDocument(null);
      setAnnouncement("Live Conversation closed. Returned to the same Paige conversation.");
      requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    }, { once: true });
    setPortalDocument(child.document);
    setAnnouncement("Live Conversation moved to its companion window. Your platform page remains behind it.");
  };

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); closeStage("minimize"); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(stageRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []);
    if (!focusable.length) { event.preventDefault(); stageRef.current?.focus(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = portalDocument?.activeElement;
    const inside = !!active && stageRef.current?.contains(active);
    if (event.shiftKey && (!inside || active === stageRef.current || active === first)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (!inside || active === stageRef.current || active === last)) { event.preventDefault(); first.focus(); }
  };

  const lastTurns = useMemo(() => transcript.filter((turn) => turn.content.trim()), [transcript]);
  const controlsDisabled = state === "unavailable" || state === "checking" || state === "permission-denied" || state === "reconnecting" || state === "interrupted";
  const presenceState = resolvePresenceState({
    phase: output.playing ? "speaking" : state === "held" || state === "interrupted" ? state
      : state === "reconnecting" ? "disconnected" : state === "listening" ? "listening"
        : state === "thinking" ? "thinking" : state === "checking" ? "ready" : "unavailable",
    outputPlaying: output.playing,
    microphoneActive: state === "listening" && relayReadyRef.current && !muted,
    working: working && !output.playing,
  });
  const stage = open && portalDocument ? createPortal(
    <div className="plc-stage" role="dialog" aria-modal="true" aria-labelledby="plc-title" aria-describedby="plc-description" ref={stageRef} tabIndex={-1} onKeyDown={trapFocus}>
      <header className="plc-stage__header">
        <div className="plc-stage__identity"><PaigeCommandMark plated={false} label={null} className="h-8 w-8" /><div><strong id="plc-title">Live Conversation with Paige</strong><span>Same workspace · same conversation</span></div></div>
        <div className="plc-stage__header-actions">
          {portalDocument === document && <Button variant="ghost" size="sm" onClick={openInWindow}><ExternalLink aria-hidden />Open in window</Button>}
          <Button variant="ghost" size="sm" onClick={() => closeStage("minimize")}><Minimize2 aria-hidden />Minimize</Button>
          <Button variant="ghost" size="icon" aria-label="End Live Conversation" onClick={() => closeStage("end")}><X aria-hidden /></Button>
        </div>
      </header>
      <main className="plc-stage__main">
        <section className="plc-presence" aria-label="Paige Presence and live audio status" data-live-state={state}>
          <PaigePresence3D state={presenceState} visible={open} readEnergy={output.readEnergy} />
          <p className="plc-state"><span />{output.playing ? "Speaking" : state === "listening" && muted ? "Muted" : STATE_LABEL[state]}</p>
          <p id="plc-description" className="plc-context">Working in this exact Paige thread. Nothing here creates a second assistant or a separate memory.</p>
          <div className="plc-working" aria-live="polite"><span>Paige is working on</span><strong>{working ? (workingLabel || "your current request") : "No active work"}</strong></div>
          {(state !== "checking" && availability !== "LIVE") && (
            <div className="plc-notice">
              {/* Only the availability line is a live region. It used to wrap the whole notice,
                  which was fine when that was a heading, a sentence and one static button — but the
                  terms added ~90 words and a button whose label changes on press, and any mutation
                  inside a live region re-announces the WHOLE region. Pressing "I understand" would
                  have re-read the availability, the explanation, both bullets and both buttons, on
                  top of the separate polite announcement this same action already makes. */}
              <div role="status">
                <strong>{availability}</strong>
                <p>{explanation}</p>
              </div>
              {reason === "live_audio_not_enabled" && (
                <div className="plc-terms">
                  {/* Said plainly, before anyone speaks, because it is true and because a person
                      cannot agree to something they were not told. No claim is made here that is
                      not also enforced in the database. */}
                  <p className="plc-terms__lede">Before Paige can hear you, two things you should know:</p>
                  <ul className="plc-terms__list">
                    <li>Your voice is sent to the speech provider and kept under their default retention. Paige has not verified a zero-retention arrangement, so do not assume one.</li>
                    <li>Paige treats the microphone as one speaker — you. She cannot tell voices apart, so anyone else in the room is heard as you.</li>
                  </ul>
                  <p className="plc-terms__scope">This is your own decision for your own account. Nobody can make it on your behalf, and you can stop at any time.</p>
                  {consentRefused ? (
                    // Once the database has refused, offering the button again would be asking the
                    // person to repeat an act that cannot succeed. Say what is actually blocking and
                    // who can move it, and stop pretending this is theirs to unlock (§36/§70).
                    <p className="plc-terms__blocked">
                      Live audio has not been opened on this platform yet, so there is nothing for you
                      to accept right now. This is not something you can turn on from here — it is
                      released centrally once the speech provider’s data-retention review is settled.
                      Paige will ask you again when it is.
                    </p>
                  ) : (
                    <Button variant="gold" size="sm" disabled={disabled || acceptingTerms} onClick={() => void acceptTerms()}>
                      <ShieldCheck aria-hidden />{acceptingTerms ? "Turning on Live…" : "I understand — turn on Live"}
                    </Button>
                  )}
                </div>
              )}
              <Button variant="outline" size="sm" disabled={disabled} onClick={() => void retry()}><RefreshCw aria-hidden />Retry setup check</Button>
            </div>
          )}
        </section>
        <section className="plc-workspace" aria-label="Live conversation workspace">
          <div className="plc-transcript" aria-label="Conversation transcript">
            <div className="plc-section-title"><span>Transcript</span><small>Same Paige conversation</small></div>
            {lastTurns.length ? lastTurns.map((turn) => <div key={turn.id} data-paige-message-id={turn.id} data-paige-message-anchor-key={messageScrollAnchorKey(turn.role, turn.content)} className={cn("plc-turn", turn.role === "user" && "plc-turn--owner")}><span>{turn.role === "user" ? "You" : "Paige"}</span><p>{turn.content}</p></div>) : <p className="plc-empty">Your conversation will remain here. Audio has not started.</p>}
          </div>
          <div className="plc-card-layer" aria-label="Current conversation card">
            <div className="plc-section-title"><span>On screen</span><small>One current object at a time</small></div>
            {activeCard ? <ConversationCard card={activeCard} disabled={working || Boolean(disabled)} canConfirm={confirmationFingerprints.length > 0} onAnswer={onAnswer} onApprove={() => onApprove(confirmationFingerprints)} onDecline={() => onDecline(confirmationFingerprints)} /> : <div className="plc-empty-card"><PaigeCommandMark plated={false} label={null} className="h-7 w-7" /><p>No card is needed right now.</p><span>Paige will put a real question, choice, plan, evidence, action, or recap here when it helps the conversation.</span></div>}
          </div>
        </section>
      </main>
      <footer className="plc-controls" aria-label="Live Conversation controls">
        {!pinned && <Button variant="outline" onClick={() => scrollController.jumpToBottom("auto")}>Jump to latest</Button>}
        <Button variant="outline" disabled={controlsDisabled && !output.playing && !muted} aria-pressed={muted} onClick={() => { relayRef.current?.setMuted(state === "held" || !muted); setMuted((value) => !value); }}>{muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}{muted ? "Unmute" : "Mute"}</Button>
        <Button variant="outline" disabled={controlsDisabled && !output.playing} aria-pressed={state === "held"} onClick={toggleHold}><CirclePause aria-hidden />{state === "held" ? "Resume" : "Hold"}</Button>
        <Button variant="outline" data-act={state === "speaking" ? "available" : undefined} disabled={controlsDisabled && !output.playing} onClick={() => { stopPlayback.current(); relayRef.current?.interrupt(); relayRef.current?.setMuted(mutedRef.current); if (activeVoiceTurnRef.current) { activeVoiceTurnRef.current = null; voiceCallbacksRef.current.onVoiceInterrupt(); } setState(relayReadyRef.current ? "listening" : "interrupted"); setAnnouncement("Paige stopped speaking. You can continue in this conversation."); }}><Hand aria-hidden />Interrupt</Button>
        <Button variant="outline" onClick={() => closeStage("minimize")}><Minimize2 aria-hidden />Minimize</Button>
        <Button variant="destructive" onClick={() => closeStage("end")}><PhoneOff aria-hidden />End</Button>
      </footer>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>, portalDocument.body) : null;

  return <><Button ref={triggerRef} type="button" variant="outline" size="sm" className="plc-trigger" disabled={disabled || !PAIGE_LIVE_CONVERSATION_ENABLED} onClick={() => void begin()} aria-haspopup="dialog" aria-expanded={open}><Volume2 aria-hidden />Talk live with Paige</Button>{stage}<span className="sr-only" aria-live="polite">{open ? "" : announcement}</span></>;
}
