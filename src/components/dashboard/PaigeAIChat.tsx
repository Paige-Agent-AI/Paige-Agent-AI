import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { mergeIntoDraft, subscribePaigePromptHandoff } from "@/lib/paigePromptHandoff";
import { StepTimeline, upsertStep, type PaigeStep, type PaigeStepFrame } from "@/components/dashboard/PaigeStepTrace";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Loader2, Clock, Paperclip, X, ArrowDown, ArrowRight, Hand, CircleHelp } from "lucide-react";
import { Link, useInRouterContext } from "react-router-dom";
import { PaigeResearchCard, type PaigeResearchResult } from "@/components/paige/chat/PaigeResearchCard";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { parsePaigeChatError } from "@/lib/paigeChatError";
import { DictationMicButton } from "@/components/voice/DictationMicButton";
import { appendDictation } from "@/lib/voice/useDictation";
import { ResponseFeedback } from "@/components/chat/ResponseFeedback";
import { MessageMeta } from "@/components/chat/MessageMeta";
import { SlashCommandMenu } from "@/components/chat/SlashCommandMenu";
import { useQuery } from "@tanstack/react-query";
import { getUserClock } from "@/lib/userClock";
import { EntityDiagramCard } from "@/components/chat/EntityDiagramCard";
import { extractEntityDiagram } from "@/lib/entityDiagram";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { PaigeConfirmCard, PaigeConfirmRecord } from "@/components/chat/PaigeConfirmCard";
import { previewOf, rehydrateConfirmItems, type ConfirmEmailPreview } from "@/components/chat/confirmPreview";
import { PaigeAskCard, PaigeAskRecord, type PaigeAskOption } from "@/components/chat/PaigeAskCard";
import {
  applyServerOutcome,
  approvalOutcomeTranscript,
  askAgainRequest,
  checkLinks,
  outcomeCardView,
  pendingApprovalOutcome,
  type ApprovalOutcome,
} from "@/components/chat/approvalOutcome";
import { PaigeCrmResultCard, type PaigeCrmResult } from "@/components/chat/PaigeCrmResultCard";
import { usePlaybook } from "@/lib/playbook";
import { cn } from "@/lib/utils";
import type { QuickChip } from "@/components/paige/commandCenterTypes";
import { usePaigeThreads, type PaigeThread } from "@/hooks/usePaigeThreads";
import { useScopedUserId } from "@/hooks/useScopedUserId";
import { useTenantContext } from "@/hooks/useTenantContext";
import { ThreadRail } from "@/components/dashboard/paige/ThreadRail";
import { PanelLeft } from "lucide-react";
import { useChatDocumentUpload, type AttachedDocument, type AttachedDocKind } from "@/hooks/useChatDocumentUpload";
import { DocumentAttachmentChip } from "@/components/chat/DocumentAttachmentChip";
import { DocumentMessageBubble } from "@/components/chat/DocumentMessageBubble";
import { MessageAudioButton } from "@/components/chat/MessageAudioButton";
import { PaigeArtifactCard, type PaigeArtifact } from "@/components/paige/chat/PaigeArtifactCard";
import { ExtractionProposalCard, type ExtractionProposal } from "@/components/chat/ExtractionProposalCard";
import { PaigeCompactingCard, type CompactingSignal } from "@/components/paige/chat/PaigeCompactingCard";
import { PaigeLiveConversation, type LiveVoiceSink } from "@/components/paige/live/PaigeLiveConversation";
import {
  DECISION_REPLY,
  TURN_LINE_GATE_MS,
  decisionCardResult,
  deriveLiveTurnView,
  deriveSnapshotView,
  isDecisionReplyText,
  mergeResumedRows,
  outcomeFromRecord,
  readPaigeStreamWithRaw,
  readTurnRecord,
  readTurnTrace,
  settleOpenSteps,
  settleTurnRows,
  upsertTurnRow,
  type AskStanding,
  type TurnEndCause,
  type TurnRow,
  type TurnSnapshot,
  type TurnView,
} from "@/lib/paige-stream";
import { PaigeLiveTurnStatus, PaigeTurnFooter, PaigeTurnStatus } from "@/components/paige/chat/PaigeTurnStatus";
import type { TurnFrame } from "../../../supabase/functions/_shared/paige-turn/contract";
import { ANSWER_STRANDED_AFTER_MINUTES, readAnswerClaim, readAskRecord, readResumeRecord } from "../../../supabase/functions/_shared/paige-turn/resume";
import { parseLiveConversationCard, type LiveConversationCard } from "@/lib/paigeLiveConversation/contract";
import { createAnchoredTranscriptScroll, messageScrollAnchorKey } from "@/components/chat/anchoredTranscriptScroll";
import {
  acceptComposerDelivery,
  clearComposerDraft,
  COMPOSER_FOCUS_NONE,
  composerDraftKey,
  composerDraftHandlesMatch,
  composerScopeIdentityKey,
  createComposerRequestFence,
  createComposerScopeIdentity,
  initialComposerConversation,
  moveComposerDraft,
  readComposerDraft,
  resolveComposerScopeState,
  shouldClearComposerDraft,
  transitionComposerConversation,
  useComposerDraft,
  type ComposerConversationState,
  type ComposerDraftHandle,
  type ComposerConversationIntent,
  type ComposerRequestTicket,
} from "@/lib/paigeComposerScopeState";

// Phase 1a / INT-180 relief: keep this exactly symmetric with paige-ai-chat's
// server budget. The durable-work envelope remains the real disconnect/retry fix.
const PAIGE_INTERACTIVE_TURN_BUDGET_MS = 360_000;

// INT-328 — the server's preview of the exact email a confirm card will send rides the
// `paige_confirm` frame beside `command` (as `preview` or `confirm_preview`); `previewOf` passes it
// through the card's one gate (components/chat/confirmPreview), live and on reload.

/** An action Paige filed to the approvals queue this turn (propose→confirm). */
type QueuedApproval = { id: string; summary: string; category: string; contact_id: string | null };
// REMOVED 2026-09-02 with the channel they described: `PipelineConfirmedAction` and
// `PaigeConfirmation` typed the token echo that #709 and #718 sent alongside the general
// approval. The surface now echoes one thing — the fingerprint of the exact call it rendered —
// and both archives keep their server-issued preview binding as a precondition on the server.
type Message = {
  /** Stable id — survives array splices; underwrites copy/retry/feedback (1c-vi). */
  id: string;
  /** Creation time (ms) — powers the hover timestamp; omitted-time turns hide it. */
  ts: number;
  role: "user" | "assistant";
  content: string;
  /** In-session only (not persisted): the attachment sent on a user turn, so the
   *  transcript shows a document bubble. The extracted content reaches the model
   *  via the POST `document` field, not this label (§13 — honest, no dead chip). */
  documentFileName?: string;
  documentKind?: AttachedDocKind;
  queued?: QueuedApproval[];
  /** `fingerprint` is the server's hash of the EXACT call each summary describes. Approve echoes
   *  them back so the gate runs that call and not whatever the model re-emits — see the gate's own
   *  note. Optional: a rehydrated turn has summaries but no live fingerprints, which is correct,
   *  because a past decision must never be re-fired (§15). */
  confirm?: Array<{ tool: string; summary: string; fingerprint?: string; command?: Record<string, unknown>; idempotency_key?: string; preview?: ConfirmEmailPreview }>;
  /** True on turns rehydrated from history: their confirm cards render settled,
   *  not as a live Approve button (§15 — never re-fire a past action). */
  confirmResolved?: boolean;
  /** Solo: what the person decided on this turn's card. The card settles into a record where it
   *  was asked, with no button left to press twice. Live session only; a reloaded turn shows the
   *  older settled line instead. */
  confirmDecision?: "approved" | "declined";
  /** Solo: the approval this turn ran, and what became of each action once the server reports
   *  (`paige_approval_outcome`). Live session only, like the card that asked for it. */
  approvalOutcome?: ApprovalOutcome;
  crmResults?: PaigeCrmResult[];
  /** R2b — inline deep-research result(s) this turn produced (one card per run;
   *  attached to the SAME assistant message — one Paige turn, ruling §7). Live turns
   *  carry the streamed payload; reloaded turns rehydrate from the run reference
   *  through the governed get RPC (§12 — reference + canonical reload). */
  research?: PaigeResearchResult[];
  /** #29 — deliverables Paige produced this turn (document/image), streamed as
   *  `paige_artifact` frames or restored from the completion turn's persisted bundle_ref.
   *  The card re-hydrates the artifact itself from marketing_content by id. */
  artifacts?: PaigeArtifact[];
  /** A document Paige read produced fields she is PROPOSING to record. Nothing has been written
   *  when this arrives — the card is where a person picks what to keep. Live-turn only: once
   *  applied or declined the proposal is settled server-side, so a rehydrated turn must not
   *  re-offer it (§15 — never re-fire a past action). */
  extractionProposal?: ExtractionProposal;
  /** C3a — how this answer's turn ended, for its status line: stamped when a live read settles, or
   *  rebuilt from `bundle_ref.turn_state` + `turn_trace` on reload. Presentation only — never sent. */
  turnSnapshot?: TurnSnapshot;
  /** C3a — on a USER turn: this is the approval card's own sentence, sent on the person's behalf.
   *  Hidden in PRESENTATION only (owner ruling 2026-10-05): it stays in `messages`, in every POST,
   *  and in the saved thread exactly as before. */
  decision?: "approved" | "declined";
  /** C3a — reload: what the next user turn said about this answer's card. Claims nothing about
   *  whether the action ran — only what the person answered. */
  confirmReceipt?: { decision: "approved" | "declined"; ts: number | null; result: string | null };
  /** C4c — on an ASSISTANT turn: PAIGE paused this piece of work to ask (her question is `content`).
   *  `askId` is the server's own id for it, from the frame live or `bundle_ref.paige_ask` on reload. */
  ask?: { askId: string; options: PaigeAskOption[]; multi: boolean; question?: string };
  /** C4c — on a USER turn: this reply was sent AS the answer to that question (the server bound it,
   *  once). A skip ("use your best guess") is the fixed sentence `ASK_SKIP_REPLY`, hidden in
   *  presentation like a decision sentence — it stays in `messages` and in the saved thread. */
  answer?: { askId: string; skipped: boolean };
};

/** C4c — what "Skip, use your best guess" sends on the person's behalf (c6). The server is told it
 *  is a skip by the request (`resume.skipped`), never by these words. */
const ASK_SKIP_REPLY = "Use your best guess.";

/** C3a — the answer being read right now (or just finished in this session). Keyed by the
 *  assistant message id it belongs to; cleared at every transcript reset. */
type LiveTurn = {
  assistantId: string;
  startedAt: number;
  frame: TurnFrame | null;
  rows: TurnRow[];
  writing: boolean;
  gateOpen: boolean;
  streaming: boolean;
  endCause: TurnEndCause | null;
  elapsedMs: number | null;
  /** The request as the person typed it — "Ask again" puts it back in the composer. */
  userText: string;
  /** After Stop, move keyboard focus to the footer. False when Stop came from a Live voice
   *  interruption: the person is talking, not tabbing, and focus must not be pulled. */
  stopFocus: boolean;
  /** C4a — the server said `resumed`: this answer carries the person's approval forward. */
  resumed: boolean;
  /** C4c — this read was sent as the ANSWER to PAIGE's question: its `resumed` frame carries an
   *  answer forward, not an approval, so it is never drawn or announced as one. */
  answering?: boolean;
};

// crypto.randomUUID is undefined in some insecure-context / older webviews — guard
// it so building a message can never white-screen the whole chat (S4).
const safeUuid = (): string => {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};
const durableIntentUuid = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const mkMsg = (m: Omit<Message, "id" | "ts"> & Partial<Pick<Message, "id" | "ts">>): Message =>
  ({ ...m, id: m.id ?? safeUuid(), ts: m.ts ?? Date.now() });

// Optional, back-compatible props (cc-spec §3). Legacy mounts (Dashboard) pass
// none of these and behave exactly as before.
export interface PaigeAIChatProps {
  hideHeader?: boolean;
  /** Command-center mode: fill the region, drop the max-w-4xl centering. */
  fill?: boolean;
  /** Focused customer id — added to the chat POST body so Paige acts on them. */
  clientId?: string | null;
  /** Selected canonical Business Mission id; server-authorized UI context, never authority. */
  businessMissionId?: string | null;
  /** Prose describing the focused customer — added to the chat POST body. */
  clientContext?: string;
  surfaceContext?: { kind: "public_presence"; step: "confirm_facts" | "verify_website" | "connect_venues" | "compare_facts" | "set_authority" | "maintain_presence"; intendedAction: "review" | "plan" | "prepare_connection" | "resolve_mismatch" };
  /** The chat is telling the surface that OWNS focus to let it go. Two reasons, both cases where
   *  continuing to assert a focus would make the UI say something untrue:
   *
   *  `refused`        — the server returned a PERMISSION verdict: that client is not in this
   *                     workspace. (Never for the four UNKNOWN refusal categories; a failed RPC is
   *                     not a fact about ownership.)
   *  `thread_resumed` — the person opened a saved conversation. Threads in the rail are
   *                     owner-level (`contact_id IS NULL`) and their content may be about a
   *                     DIFFERENT client than the one currently focused — focus is not persisted
   *                     with the thread, so an earlier turn under focus A lives in an owner-level
   *                     transcript. Replaying it under focus B would ship A's content on the next
   *                     turn with B's scope. Releasing focus is what makes the resumed conversation
   *                     mean what it says.
   *
   *  Carries the reason only, never a client identifier. */
  onFocusRelease?: (reason: "refused" | "thread_resumed") => void;
  /** Sticky strip above the message list, shown only when a customer is focused. */
  focusBanner?: React.ReactNode;
  /** Quick-action chips above the composer. */
  chips?: QuickChip[];
  /** Opening bubble. Command center passes an operator-flavored opener. */
  greeting?: string;
  /** Fires with the live step trace so a parent surface (Live desk) can render it. */
  onTrace?: (steps: PaigeStep[], loading: boolean) => void;
  /** Suppress the inline reasoning strip (desktop: the Live desk owns the timeline). */
  hideReasoningStrip?: boolean;
  /** Owner "Your Paige" mode (#94): mount the multi-chat history rail, persist
   *  every conversation, and rehydrate on reload. Off by default — legacy and
   *  client-focused mounts keep their exact single-session behavior. */
  enableHistory?: boolean;
  /** Platform-operator mode (#130 / §45): the Super Admin's tenant-less Paige.
   *  Threads are created/listed with lens='platform' + NULL tenant, so this works
   *  with no active tenant. Off by default — every tenant mount is unchanged. */
  platform?: boolean;
  /**
   * Replace the built-in `ThreadRail` with the caller's own, driven by the SAME
   * live thread state (#546 follow-up). The operator console draws Claude Design's
   * 236px rail; without this seam it had to mount its own empty list next to the
   * real one, so the screen carried two "New chat" buttons and two chat lists
   * (§18/§21). The rail is presentation — the threads, the selection and every
   * mutation stay here, so nothing about history changes (§58).
   */
  renderRail?: (api: ChatRailApi) => React.ReactNode;
  /** Rendered inside the conversation frame, above the thread — the caller's own
   *  chat header. Distinct from `focusBanner`, which is the focused-customer strip.
   *  A function form receives the SAME `ChatRailApi` as `renderRail` — so a header
   *  that draws its own "new thread" affordance (CD's pack does) calls the real
   *  `onNewChat` instead of needing a second wiring path for one button (§18). */
  conversationHeader?: React.ReactNode | ((api: ChatRailApi) => React.ReactNode);
  /**
   * Which chrome the conversation wears. `app` (default) is byte-for-byte today's
   * surface for every existing mount. `operator` is Claude Design's platform desk:
   * its warm right-aligned bubble, its framed composer with the tool row and the
   * visible prompt chips, and its collapsible reasoning strip. The ENGINE is
   * identical either way — streaming, voice, playback, attachments, artifacts,
   * approvals and thread persistence are the same code (§58).
   */
  presentation?: "app" | "operator";
  /** The line under the operator composer. Absent → no line (never invented). */
  composerFootNote?: string;
  /**
   * CONTROLLED thread selection. Omit (the default) and this component owns the
   * selection exactly as it always has — every existing mount is unchanged.
   *
   * Pass it and the caller owns it, which is what lets the SAME conversation be
   * open through two doors at once. The operator console mounts Paige twice — the
   * Paige branch and the top-bar slide-out — and CD's own panel foot states the
   * contract: "Same brain as the Paige tab — one thread, two doors." Without this
   * seam the second mount keeps its own `activeThreadId`, so its first send calls
   * `ensureThread` and forks a brand-new thread row (§18 one home — a fork is two
   * homes for one conversation).
   *
   * `null` means "no thread yet"; `undefined` means "not controlled" — the two are
   * deliberately different, so a controlled caller can express an empty selection.
   */
  activeThreadId?: string | null;
  /** Fires whenever the selection moves (resume, pick, new chat, lazy create). */
  onActiveThreadIdChange?: (id: string | null) => void;
  /**
   * Solo-only opt-in for the active-account timeout/status and explicit cancel affordance.
   * Request ownership and scope-transition cancellation apply to every history mount;
   * the accepted tenant epoch is still read from authenticated context inside this
   * component, so callers cannot supply authority through props.
   */
  soloTenantSafety?: boolean;
  /**
   * Does the CURRENT account type carry Live Conversation? (§60.) The answer is derived in the one
   * home — `hasFeature(classification, "live_conversation")` — and passed in, because this component
   * mounts outside `TenantProvider` in several tests and must not start requiring it. Defaults to
   * true so no existing mount changes behaviour; it only ever HIDES the control, and the database
   * refuses independently of whatever is rendered (`live_conversation_tier_allows`).
   */
  liveConversation?: boolean;
  /**
   * An optional caller-owned control rendered in the Solo composer action bar, next to the
   * attachment/mic controls. The dedicated Solo workspace passes the real Paige-permissions chip
   * here; every other mount omits it, so the chip never leaks onto a non-Solo surface. Rendered only
   * in the `soloTenantSafety` composer branch. It is a ReactNode the caller wires to the real
   * governance seam — this component makes no authority claim of its own.
   */
  composerAutonomyControl?: React.ReactNode;
}

/** Everything a caller-supplied history rail needs, and nothing it could corrupt. */
export type ChatRailApi = {
  threads: PaigeThread[];
  isLoading: boolean;
  activeThreadId: string | null;
  streamingThreadId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

/**
 * Where to check an action that may have gone through. An in-app link inside the app's router; a
 * plain link anywhere without one, so the chat never starts depending on a router to render.
 */
function ApprovalCheckLinks({ links }: { links: Array<{ label: string; to: string }> }) {
  const inRouter = useInRouterContext();
  // Ink with an underline at rest, as the approved design draws it. The Solo shell paints every
  // link gold (`[data-pg] a`), and gold is spent on Approve alone, so the colour is set firmly here.
  const className = "inline-flex items-center gap-1 text-[13px] font-semibold !text-foreground";
  const label = (text: string) => (
    <span className="underline decoration-[color:var(--pg-line-strong,hsl(var(--border)))] underline-offset-[3px] hover:decoration-current">
      {text}
    </span>
  );
  return (
    <>
      {links.map((link) => inRouter ? (
        <Link key={link.to} to={link.to} className={className}>
          {label(link.label)}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : (
        <a key={link.to} href={link.to} className={className}>
          {label(link.label)}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      ))}
    </>
  );
}

const PaigeAIChatInner = ({
  hideHeader = false,
  fill = false,
  clientId = null,
  businessMissionId = null,
  clientContext,
  surfaceContext,
  onFocusRelease,
  focusBanner,
  chips,
  greeting,
  onTrace,
  hideReasoningStrip = false,
  enableHistory = false,
  platform = false,
  renderRail,
  conversationHeader,
  presentation = "app",
  composerFootNote,
  activeThreadId: controlledThreadId,
  onActiveThreadIdChange,
  soloTenantSafety = false,
  liveConversation = true,
  composerAutonomyControl,
}: PaigeAIChatProps) => {
  /** Claude Design's operator chrome. Presentation only — never a second engine. */
  const cd = presentation === "operator";
  // The tenant's authored persona names the assistant in the default header —
  // audience-broad, voice-compliant, never a hardcoded vertical (doctrine §2/§3).
  const playbook = usePlaybook();
  const persona = playbook.persona;
  const sessionId = useRef(`session-${Date.now()}`).current;
  
  // Check if user is admin or coach for feedback visibility
  const { data: userRole } = useQuery({
    queryKey: ["user-role-for-feedback"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const roles = (data || []).map((r: { role: string }) => r.role);
      return { isAdmin: roles.includes("admin") };
    },
    staleTime: 5 * 60 * 1000,
  });
  const showFeedback = userRole?.isAdmin;
  const [messages, setMessages] = useState<Message[]>([
    mkMsg({ role: "assistant", content: greeting ?? "Hey, how can I help?" }),
  ]);
  const [dictationGeneration, setDictationGeneration] = useState(0);
  const [slashActive, setSlashActive] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [steps, setSteps] = useState<PaigeStep[]>([]);
  // #11 — true once the first answer token arrives this turn (label flips Thinking→Writing).
  const [writingPhase, setWritingPhase] = useState(false);
  // #12 — the live conversation-compacting signal (this surface persists → it can fold). Reset per turn.
  const [compacting, setCompacting] = useState<CompactingSignal | null>(null);
  // Presentation-only projection of a real current object. It never persists a card or creates
  // an action path; canonical records and confirmations remain owned by the chat/Spine response.
  const [streamedLiveCard, setStreamedLiveCard] = useState<LiveConversationCard | null>(null);
  // C3a — the living status of the answer being read. `liveTurnRef` is the source of truth (the
  // stream loop, Stop and the six-minute window all write it synchronously); the state copy renders.
  // Thoughts never enter it: a per-answer trace holds actions only (owner proof 9).
  const [liveTurn, setLiveTurnState] = useState<LiveTurn | null>(null);
  const liveTurnRef = useRef<LiveTurn | null>(null);
  const writeLiveTurn = useCallback((next: LiveTurn | null) => {
    liveTurnRef.current = next;
    setLiveTurnState(next);
  }, []);
  const updateLiveTurn = useCallback((assistantId: string, fn: (t: LiveTurn) => LiveTurn) => {
    const current = liveTurnRef.current;
    if (!current || current.assistantId !== assistantId) return;
    writeLiveTurn(fn(current));
  }, [writeLiveTurn]);
  /** The read ended. Freeze the line and stamp the answer (if it is still on screen) so it keeps the
   *  same "What PAIGE did" after the next turn starts. A rolled-back answer has no message to stamp. */
  const settleLiveTurn = useCallback((cause: TurnEndCause, assistantId?: string, opts?: { stopFocus?: boolean }) => {
    const t = liveTurnRef.current;
    if (!t || !t.streaming || (assistantId && t.assistantId !== assistantId)) return;
    const next: LiveTurn = {
      ...t, streaming: false, endCause: cause, rows: settleTurnRows(t.rows, cause), elapsedMs: Date.now() - t.startedAt,
      stopFocus: opts?.stopFocus ?? t.stopFocus,
    };
    writeLiveTurn(next);
    setMessages((prev) => prev.some((m) => m.id === next.assistantId)
      ? prev.map((m) => m.id === next.assistantId ? {
          ...m,
          turnSnapshot: {
            outcome: next.frame ? { state: next.frame.state, mode: next.frame.mode } : null,
            rows: next.rows,
            elapsedMs: next.elapsedMs,
            endCause: cause,
            source: "live",
            hasContent: m.content.trim() !== "",
            ...(next.resumed ? { resumed: true } : {}),
          },
        } : m)
      : prev);
  }, [writeLiveTurn]);
  // A decided card is replaced by its record — so the button the person pressed vanished with it and
  // keyboard focus fell to <body>. After that commit, if nothing else took focus, it lands on the
  // record that replaced the card ("Skipped · nothing changed", "Approved", and the result when one
  // was recorded): the person keeps their place and hears what their decision became. Not the
  // composer — it is disabled while the follow-up request runs, so focus could not land there.
  // (Solo's Approve is answered by the report card, which focuses itself; it is excluded.)
  const decisionFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const id = decisionFocusRef.current;
    if (!id) return;
    decisionFocusRef.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.querySelector<HTMLElement>(`[data-paige-message-id="${id}"] [data-paige-decided-record]`)?.focus({ preventScroll: true });
  }, [messages]);
  // Which answers' "What PAIGE did" is open (the Stop footer's "See what finished" opens one).
  const [turnTraceOpen, setTurnTraceOpen] = useState<Record<string, boolean>>({});
  // C4c — the question the person chose to talk past ("Ask something else instead"): the composer
  // then sends an ordinary message, and the question is left unanswered (c5).
  const [askSetAside, setAskSetAside] = useState<string | null>(null);
  // The live approval card scrolled out of view → a quiet hint above the composer (frame a2).
  const [approvalOffscreen, setApprovalOffscreen] = useState(false);
  const approvalObserverRef = useRef<IntersectionObserver | null>(null);
  const observeLiveApproval = useCallback((node: HTMLDivElement | null) => {
    approvalObserverRef.current?.disconnect();
    approvalObserverRef.current = null;
    if (!node) { setApprovalOffscreen(false); return; }
    if (typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver((entries) => setApprovalOffscreen(!entries[0]?.isIntersecting));
    io.observe(node);
    approvalObserverRef.current = io;
  }, []);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atLatestRef = useRef(true);
  const hasNewerContentRef = useRef(false);
  const [isAtLatest, setIsAtLatest] = useState(true);
  const [latestAnnouncement, setLatestAnnouncement] = useState("");
  const { toast } = useToast();

  // Document attachment (#480) — PDF/image/DOCX. Shared hook (§18 one home): docx
  // is extracted to text client-side, pdf/image ride as base64; 10MB cap. In-session
  // only (no turn-persistence of the attachment), matching PaigeChat.
  const {
    attachedDoc,
    isProcessingFile,
    isDragOver,
    fileInputRef,
    acceptString,
    handleFileSelect,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    openFilePicker,
    setAttachedDoc,
  } = useChatDocumentUpload();
  // ── Multi-chat history (#94) — owner "Your Paige" only (enableHistory). ──
  const scopedUserId = useScopedUserId();
  const { activeTenantId, activeTenant } = useTenantContext();
  const threadsApi = usePaigeThreads({ callerUserId: scopedUserId, tenantId: activeTenantId, platform });
  // Controlled/uncontrolled selection. `controlledThreadId === undefined` ⇒ this
  // component owns it, which is every pre-existing mount (behavior unchanged).
  const isThreadControlled = controlledThreadId !== undefined;
  const [localThreadId, setLocalThreadId] = useState<string | null>(null);
  const activeThreadId = isThreadControlled ? controlledThreadId : localThreadId;
  // Focus is a first-class part of ComposerScopeIdentity. Keep the conversation slot stable so
  // client/mission isolation has exactly one owner instead of being duplicated in this id.
  const newConversationId = "new-chat";
  const [conversationState, setConversationState] = useState<ComposerConversationState>(
    () => initialComposerConversation(enableHistory, newConversationId),
  );
  const conversationStateRef = useRef(conversationState);
  conversationStateRef.current = conversationState;
  const applyConversationEvent = useCallback((
    event: Parameters<typeof transitionComposerConversation>[1],
  ) => {
    const next = transitionComposerConversation(conversationStateRef.current, event);
    conversationStateRef.current = next;
    setConversationState(next);
    return next;
  }, []);
  const requestedConversation = enableHistory && isThreadControlled
    ? controlledThreadId
      ? conversationState.requested.kind === "thread" && conversationState.requested.id === controlledThreadId
        ? conversationState
        : transitionComposerConversation(conversationState, {
            type: "thread-requested",
            id: controlledThreadId,
            intent: "controlled",
          })
      : conversationState.requested.kind === "new"
        ? conversationState
        : {
            ...conversationState,
            history: "settled" as const,
            requested: { kind: "new" as const, id: conversationState.newConversationId },
            intent: "controlled" as const,
          }
    : conversationState;
  // Which thread the CURRENT `messages` were hydrated from. Distinct from
  // `activeThreadId`: a controlled parent can move the selection out from under us,
  // and this is how the sync effect below notices it has to re-hydrate.
  const hydratedFromRef = useRef<string | null>(null);
  const setActiveThreadId = useCallback(
    (id: string | null) => {
      if (!isThreadControlled) setLocalThreadId(id);
      onActiveThreadIdChange?.(id);
    },
    [isThreadControlled, onActiveThreadIdChange],
  );
  const [streamingThreadId, setStreamingThreadId] = useState<string | null>(null);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  // CD's reasoning strip is a disclosure, not an always-open list. Collapsed at rest.
  const [traceOpen, setTraceOpen] = useState(false);
  const openingGreeting = greeting ?? "Hey, how can I help?";
  const requestFenceRef = useRef(createComposerRequestFence());
  // === THE TURN'S SCOPE, AS ONE VALUE (§9, purpose clause 2) ===
  // Draft storage, writability, request delivery, busy ownership, dictation and retry all use this
  // complete identity: workspace, effective user, focused client and focused Business Mission.
  //
  // That mattered because this component re-POSTs its entire local `messages` array on every
  // turn. Focusing a different client — or clearing focus — left the previous client's answers
  // in that array, and the next request shipped them to the model under the new scope. The
  // backend's client-scope guard authorizes the client NAMED in the body; it has no way to know
  // that the prose already in the transcript is about someone else. So the isolation had to be
  // here, on the surface that owns the array.
  //
  // Focus is normalized into the handle itself rather than living only in an epoch. Every consumer
  // therefore agrees on the same scope and the explicit `none` focus is a real isolated slot.
  //
  const draftIdentity = createComposerScopeIdentity({
    tenantId: platform ? "platform" : activeTenantId,
    userId: scopedUserId,
    focusedClientId: clientId,
    focusedBusinessMissionId: businessMissionId,
  });
  const scopeEpoch = draftIdentity ? composerScopeIdentityKey(draftIdentity) : "identity-unresolved";
  const requestScopeHandle = draftIdentity
    ? { ...draftIdentity, conversationId: requestedConversation.requested.id }
    : null;
  const requestScopeEpoch = requestScopeHandle
    ? composerDraftKey(requestScopeHandle)
    : "identity-unresolved";
  const requestScopeRef = useRef({ handle: requestScopeHandle, epoch: requestScopeEpoch });
  requestScopeRef.current = { handle: requestScopeHandle, epoch: requestScopeEpoch };
  const acceptedRequestScopeEpochRef = useRef(requestScopeEpoch);
  const requestScopeFor = (_kind: "new" | "thread", id: string) => {
    if (!draftIdentity) return null;
    const handle = { ...draftIdentity, conversationId: id };
    return { handle, epoch: composerDraftKey(handle) };
  };
  const displayedDraftIdentityRef = useRef(draftIdentity);
  const composerScope = resolveComposerScopeState({
    currentIdentity: draftIdentity,
    displayedIdentity: displayedDraftIdentityRef.current,
    conversation: requestedConversation,
    busy: isLoading,
  });
  const composerScopeRef = useRef(composerScope);
  composerScopeRef.current = composerScope;
  const draft = useComposerDraft(composerScope);
  const input = draft.value;
  const setInput = draft.setValue;
  // Ask PAIGE from any surface puts its question in this composer (never sends it); see
  // src/lib/paigePromptHandoff.ts. A draft already typed here is kept, the question appended.
  // The composer accepts writes only once its scope is writable; until then a question waits.
  const composerWritable = Boolean(draft.writableHandle);
  useEffect(() => composerWritable ? subscribePaigePromptHandoff((prompt) => setInput((current) => mergeIntoDraft(current, prompt))) : undefined, [composerWritable, setInput]);
  // A deployment reload must never discard an unsent prompt, attachment, or
  // response currently arriving from Paige.
  useBeforeUnloadGuard(input.trim().length > 0 || attachedDoc !== null || isProcessingFile || isLoading);
  const dictationEpoch = requestScopeEpoch;
  const dictationDeliveryEpoch = `${dictationEpoch}:${dictationGeneration}`;
  const [dictationActivity, setDictationActivity] = useState({
    epoch: dictationEpoch,
    active: false,
  });
  const dictationActive =
    dictationActivity.epoch === dictationEpoch && dictationActivity.active;
  const handleDictationActivity = useCallback((active: boolean) => {
    setDictationActivity({ epoch: dictationEpoch, active });
  }, [dictationEpoch]);
  const transcriptContextPrefix = [
    platform ? "platform" : soloTenantSafety ? "solo" : presentation,
    scopedUserId ?? "anonymous",
    activeTenantId ?? "no-tenant",
  ].join(":");
  const transcriptContext = [
    transcriptContextPrefix,
    enableHistory ? (activeThreadId ?? messages[0]?.id ?? "new") : scopeEpoch,
  ].join(":");
  const transcriptScrollRef = useRef<ReturnType<typeof createAnchoredTranscriptScroll> | null>(null);
  if (!transcriptScrollRef.current) {
    transcriptScrollRef.current = createAnchoredTranscriptScroll({
      storagePrefix: "paige-transcript-position-v1",
      onPinnedChange: (pinned) => {
        atLatestRef.current = pinned;
        setIsAtLatest(pinned);
        if (pinned) {
          hasNewerContentRef.current = false;
          setLatestAnnouncement("");
        }
      },
    });
  }
  // The thread a person asked for, parked across the reset their own click causes (#765).
  // Same idiom, and same reason, as the refusal notice below: releasing focus changes the
  // epoch, and the epoch change invalidates the very load the release was made for.
  const pendingThreadSelectionRef = useRef<{ epoch: string; id: string } | null>(null);
  // A refusal releases focus, which CHANGES this epoch, which resets the transcript — so a naive
  // "clear focus on refusal" deletes the very sentence the person needs to read. The notice is
  // parked here on the way out and adopted as the opening message on the way back in, so the
  // explanation survives its own consequence. A ref rather than state: the reset effect has to
  // read it in the same pass the refusal triggers, without scheduling another render.
  // STAMPED WITH THE EPOCH IT WAS PARKED UNDER, not a bare string.
  //
  // "Cleared on read" is only true if something reads it. When focus is ALREADY null at the moment
  // the refusal arrives — the person cleared the banner mid-stream, or an earlier reset released it
  // — `onFocusRelease` is a no-op, the epoch never changes, and an unstamped notice sits in
  // the ref indefinitely. The next epoch change of ANY kind then adopts it, so switching WORKSPACES
  // could open the new one with "I couldn't confirm that client belongs to your workspace" about a
  // client in the other one. Found by an independent reviewer driving exactly that sequence.
  //
  // The notice is adopted only when the epoch actually moves OFF the one it was parked under, and
  // discarded otherwise. A notice about a scope nobody is leaving is not a notice.
  const pendingScopeNoticeRef = useRef<{ epoch: string; text: string } | null>(null);
  const acceptedEpochRef = useRef<string>(scopeEpoch);
  const dictationGenerationRef = useRef(0);
  const [cancelled, setCancelled] = useState(false);
  // `server` joins `offline` and `timeout` because all three are the same thing to the person:
  // the turn did not happen and trying again is worth doing. A 4xx is NOT in this set — a request
  // the server refused on its merits will be refused identically on a retry, and offering one
  // would be a button that cannot work (§70).
  const [connectionIssue, setConnectionIssue] = useState<"offline" | "timeout" | "server" | "live-interrupted" | null>(null);
  const retryTurnRef = useRef<{
    base: Message[];
    rollback: Message[];
    userText: string;
    doc?: AttachedDocument | null;
    draftHandle: ComposerDraftHandle | null;
    requestIntentId: string;
    /** C4c — an answer is retried with its question's id. The server binds it once: a retry is refused
     *  as already with PAIGE (her continuation exists, or may still be running) or — when PAIGE was
     *  never reached — the question is asked again under a new id and the reply says so. Never a
     *  second continuation, and never "already answered" when nothing came of it. */
    answer?: { askId: string; skipped: boolean; card?: boolean };
    live?: boolean;
    /** Solo: the turn carried an approval or a decline, which a retry can never replay. */
    decision?: boolean;
  } | null>(null);

  // §13 — `!ticket ||` USED TO SHORT-CIRCUIT THIS TO `true`, AND THAT UNDID THE WHOLE FENCE ON THE
  // ONE SURFACE THAT NEEDED IT. A ticket was only issued when `soloTenantSafety` was set, and the
  // shared workspace — the only mount that focuses clients — does not set it. So there the ticket
  // was null, every late result was "accepted", the fetch carried no abort signal, and
  // `invalidate()` aborted a controller that had never been created.
  //
  // The visible consequence was worse than no fence: the scope reset DID run, clearing the
  // transcript, and then the next streamed chunk called `setMessages([...newMessages, …])` with the
  // array captured BEFORE the switch — restoring the previous client's question and answer under
  // the new client's scope, and shipping them on the next turn. The refusal notice was overwritten
  // by the same mechanism, so the explanation flashed and vanished. An independent reviewer drove
  // both.
  //
  // Acceptance is not a Solo nicety; it is the second half of the isolation the reset starts.
  // Cancellation, the timeout fence and the offline pre-flight stay behind the flag — those are
  // genuinely presentational choices — but whether a resolved request may still commit is not.
  const ticketAccepted = useCallback(
    (ticket: ComposerRequestTicket) => requestFenceRef.current.isCurrent(
      ticket,
      requestScopeRef.current.handle,
      requestScopeRef.current.epoch,
    ),
    [],
  );
  const claimRequestBusy = useCallback((ticket: ComposerRequestTicket) => {
    if (!requestFenceRef.current.claimBusy(ticket)) return false;
    setIsLoading(true);
    return true;
  }, []);
  const releaseRequestBusy = useCallback((ticket: ComposerRequestTicket) => {
    if (!requestFenceRef.current.releaseBusy(ticket)) return false;
    setIsLoading(false);
    return true;
  }, []);
  const abortActiveRequest = useCallback(() => {
    if (requestFenceRef.current.invalidate()) setIsLoading(false);
    // The stopped read will never close a step it started, so none is left spinning.
    setSteps(settleOpenSteps);
    setStreamingThreadId(null);
    setWritingPhase(false);
    setCompacting(null);
    setStreamedLiveCard(null);
  }, []);

  const cancelSoloRequest = useCallback((opts?: { fromVoice?: boolean }) => {
    if (!soloTenantSafety) return;
    const cancelledTurn = retryTurnRef.current;
    // C3a — the answer's line says "Stopped by you" and keeps the step that had started, marked as
    // possibly still finishing. Settled BEFORE the abort, which would otherwise drop that step.
    // A Live voice interruption stops the read too, but never moves keyboard focus.
    settleLiveTurn("cancelled", undefined, { stopFocus: !opts?.fromVoice });
    abortActiveRequest();
    // A decision is never rolled back: an approval may already have reached Paige and run, and
    // putting its card back would offer a second Approve for something that may be done. Its
    // outcome card stays and, with no report, says it couldn't confirm.
    if (cancelledTurn && !cancelledTurn.live && !cancelledTurn.decision) setMessages(cancelledTurn.rollback);
    if (cancelledTurn?.live || cancelledTurn?.decision) retryTurnRef.current = null;
    setCancelled(true);
    setConnectionIssue(null);
  }, [abortActiveRequest, settleLiveTurn, soloTenantSafety]);

  const syncTranscriptPosition = useCallback(() => {
    transcriptScrollRef.current?.handleScroll();
  }, []);
  const setTranscriptElement = useCallback((node: HTMLDivElement | null) => {
    transcriptScrollRef.current?.attach(node);
  }, []);

  const jumpToLatest = useCallback(() => {
    const reduceMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = reduceMotion ? "auto" : "smooth";
    transcriptScrollRef.current?.jumpToBottom(behavior);
    hasNewerContentRef.current = false;
    setLatestAnnouncement("Latest PAIGE message reached.");
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (acceptedRequestScopeEpochRef.current === requestScopeEpoch) return;
    acceptedRequestScopeEpochRef.current = requestScopeEpoch;
    abortActiveRequest();
  }, [abortActiveRequest, requestScopeEpoch]);

  // SCOPE changes — the workspace or the client in focus — are a hard frontend isolation
  // boundary. Invalidate first, then clear every scope-derived or scope-authored state before
  // the new query can hydrate. The key on SoloPaigeWorkspace also remounts this tree
  // synchronously; this engine-level guard rejects work that outlives that boundary.
  //
  // §13 — THIS IS NO LONGER GATED ON `soloTenantSafety`, and the removal is deliberate. That
  // prop conflates two unrelated things: Solo's presentation extras (the offline banner, the
  // cancel affordance, the tenant-required composer block) and this isolation fence. Only the
  // first is a Solo choice. Carrying one workspace's transcript into another is a defect on
  // every surface that mounts this component, and it was live on the shared workspace mount —
  // which is the ONE surface that focuses clients — precisely because the fence was opt-in.
  //
  // The tenant-required blocking stays behind the flag, because it is genuinely Solo-only: the
  // operator desk is legitimately tenant-less, and un-gating `!activeTenantId` would block its
  // composer permanently. Un-gating the RESET is safe there for the same reason it is a no-op:
  // a tenant-less, client-less surface has the constant epoch `"|"`, so this never fires.
  useEffect(() => {
    if (acceptedEpochRef.current === scopeEpoch) return;
    const leavingEpoch = acceptedEpochRef.current;
    acceptedEpochRef.current = scopeEpoch;
    displayedDraftIdentityRef.current = createComposerScopeIdentity({
      tenantId: platform ? "platform" : activeTenantId,
      userId: scopedUserId,
      focusedClientId: clientId,
      focusedBusinessMissionId: businessMissionId,
    });
    dictationGenerationRef.current += 1;
    setDictationGeneration(dictationGenerationRef.current);
    abortActiveRequest();
    hydratedFromRef.current = null;
    setActiveThreadId(null);
    // A refusal parked a notice on its way out; adopt it as the opening message so the
    // explanation survives the reset it caused. Cleared on read — it is a one-shot handoff, not
    // sticky state, and a stale notice greeting an unrelated switch would be its own lie.
    // Adopted only by the transition it belongs to: the one LEAVING the epoch the refusal happened
    // under. Any other epoch change discards it, so a notice cannot survive to greet an unrelated
    // switch. Discarded either way — it is a one-shot handoff, never sticky state.
    const parkedSelection = pendingThreadSelectionRef.current;
    pendingThreadSelectionRef.current =
      parkedSelection?.epoch === leavingEpoch ? { epoch: scopeEpoch, id: parkedSelection.id } : null;
    const parked = pendingScopeNoticeRef.current;
    pendingScopeNoticeRef.current = null;
    const scopeNotice = parked?.epoch === leavingEpoch ? parked.text : null;
    setMessages([mkMsg({ role: "assistant", content: scopeNotice ?? openingGreeting })]);
    setAttachedDoc(null);
    setSteps([]);
    writeLiveTurn(null);
    setTurnTraceOpen({});
    setCancelled(false);
    setConnectionIssue(null);
    retryTurnRef.current = null;
    // RE-ARMING THE AUTO-RESUME IS WHAT ERASED THE EXPLANATION (#765).
    //
    // Clearing this re-opens the initial-history effect below, which resumes `threads[0]`
    // and overwrites `messages` — including a refusal notice this reset has just adopted as
    // the opening message. The notice is parked precisely so it can survive the reset it
    // causes; resuming a saved thread over it defeated that on every account with any
    // history, which is every real one. When a notice was adopted, history is already
    // settled: show the explanation and resume nothing.
    let nextConversation = initialComposerConversation(enableHistory, newConversationId);
    if (scopeNotice !== null) {
      nextConversation = transitionComposerConversation(nextConversation, {
        type: "history-confirmed-empty",
      });
    }
    conversationStateRef.current = nextConversation;
    setConversationState(nextConversation);
    setMobileRailOpen(false);
  }, [
    activeTenantId,
    abortActiveRequest,
    businessMissionId,
    clientId,
    enableHistory,
    newConversationId,
    openingGreeting,
    platform,
    scopeEpoch,
    scopedUserId,
    setActiveThreadId,
    setAttachedDoc,
    writeLiveTurn,
  ]);

  useEffect(() => {
    const requestFence = requestFenceRef.current;
    return () => { requestFence.invalidate(); };
  }, []);

  useLayoutEffect(() => {
    transcriptScrollRef.current?.setContext(transcriptContext);
  }, [transcriptContext]);

  const previousScrollLayoutRef = useRef({ messages, steps, isLoading, scopeStatus: composerScope.status });
  useLayoutEffect(() => {
    const previous = previousScrollLayoutRef.current;
    const scopeHydrating = composerScope.status === "hydrating" || composerScope.status === "history-unresolved";
    const previousScopeHydrating = previous.scopeStatus === "hydrating" || previous.scopeStatus === "history-unresolved";
    const source = scopeHydrating || previousScopeHydrating ? "hydration"
      : previous.isLoading && !isLoading ? "assistant-completion"
      : previous.steps !== steps ? "status-tool-receipt"
      : isLoading && previous.messages !== messages ? "stream-token" : "layout-effect";
    previousScrollLayoutRef.current = { messages, steps, isLoading, scopeStatus: composerScope.status };
    transcriptScrollRef.current?.notifyLayoutChange(source);
    if (!atLatestRef.current && !hasNewerContentRef.current) {
      hasNewerContentRef.current = true;
      setLatestAnnouncement("Newer PAIGE content is available.");
    }
  }, [messages, steps, compacting, isLoading, cancelled, connectionIssue, composerScope.status]);

  // Mirror the live step trace up so a parent surface (the Live desk) can render it.
  useEffect(() => { onTrace?.(steps, isLoading); }, [steps, isLoading, onTrace]);

  // Collapse the composer back to one line once it's cleared (after send / new chat).
  useEffect(() => { if (input === "" && inputRef.current) inputRef.current.style.height = "auto"; }, [input]);

  // Chip click: prefill the composer + focus so the operator can edit before
  // Paige acts (cc-spec §3). Only chips flagged autoSend dispatch immediately.
  const handleChip = (chip: QuickChip) => {
    if (dictationActive || !composerScope.writable) return;
    if (chip.autoSend) {
      void handleSend(chip.prompt);
      return;
    }
    setInput(chip.prompt);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  // Rebuild the message list from a thread's stored turns. Cards are reconstructed
  // from bundle_ref and marked resolved — a reloaded confirm renders settled, never
  // a live Approve button for an action already taken (§15).
  const turnsToMessages = (turns: Awaited<ReturnType<typeof threadsApi.loadTurns>>): Message[] => {
    // R2b §12 — every reload run reference across the transcript, resolved after the
    // map through the governed get RPC (see the runner below the map).
    const researchRefsAll: Array<{ run_id: string | null; question: string; saved: boolean }> = [];
    const mapped =
    turns
      .filter((t) => t.role === "user" || t.role === "assistant")
      .map((t) => {
        const b = (t.bundle_ref ?? {}) as Record<string, unknown>;
        const queued = Array.isArray(b.approval_queued) ? (b.approval_queued as QueuedApproval[]) : undefined;
        // Rehydrated summaries only. Deliberately NOT given a live state: a stored turn carries no live
        // fingerprint, and `confirmResolved` below renders it settled, so there is nothing here that
        // could re-fire a decision already taken (§15). INT-328 — stored items pass the same preview
        // gate as the live frame.
        const confirm = rehydrateConfirmItems(b.paige_confirm);
        const crmResults = Array.isArray(b.paige_crm_result) ? b.paige_crm_result as PaigeCrmResult[] : undefined;
        // R2b §12 — a reloaded turn carries the run REFERENCE; the evidence rehydrates
        // from research_runs through the governed get RPC (the same door the Research
        // library uses, so citations keep one identity). The card starts in its reference
        // state and upgrades when the RPC resolves; a null readback (unsaved/foreign)
        // keeps the honest not-saved shape. Collected for resolution after the map.
        const turnResearchRefs = Array.isArray(b.paige_research)
          ? (b.paige_research as Array<{ run_id: string | null; question: string; saved: boolean }>)
          : undefined;
        const artifacts = Array.isArray(b.paige_artifact)
          ? b.paige_artifact.flatMap((candidate): PaigeArtifact[] => {
              if (!candidate || typeof candidate !== "object") return [];
              const raw = candidate as Record<string, unknown>;
              if (typeof raw.id !== "string" || typeof raw.title !== "string") return [];
              if (raw.artifactType !== "document" && raw.artifactType !== "image") return [];
              return [{
                id: raw.id,
                title: raw.title,
                artifactType: raw.artifactType,
                ...(typeof raw.url === "string" ? { url: raw.url } : {}),
                ...(typeof raw.tenant_id === "string" ? { tenantId: raw.tenant_id } : {}),
              }];
            })
          : undefined;
        // Honest timestamp: use the turn's stored created_at when present; if the
        // stored turn has none, omit it and the hover time simply hides (never faked).
        const tid = (t as { id?: string }).id;
        const created = (t as { created_at?: string }).created_at;
        // C3a — the saved turn state and trace rebuild the same "What PAIGE did" the live turn showed
        // (labels, status and department; the record keeps no step detail and no duration). An old
        // row with no record keeps no line, exactly as before.
        const record = t.role === "assistant" ? readTurnRecord(b.turn_state) : null;
        const turnSnapshot: TurnSnapshot | undefined = record ? {
          outcome: outcomeFromRecord(record),
          rows: readTurnTrace(b.turn_trace),
          elapsedMs: null,
          endCause: null,
          source: "reload",
          hasContent: t.content.trim() !== "",
          // C4a — only an APPROVAL carried forward draws the two answers as one (a3/a4). An answer
          // carried forward (C4c) is the person speaking between them, so the two stay two (c3).
          ...(record.resumed?.kind === "approval" ? { resumed: true } : {}),
        } : undefined;
        // C4c — the question this answer ended on, and (on the person's turn) the question it answered.
        const askRecord = t.role === "assistant" ? readAskRecord(b.paige_ask) : null;
        const answerClaim = t.role === "user" ? readAnswerClaim(b.paige_resume) : null;
        return mkMsg({
          ...(tid ? { id: tid } : {}),
          ...(created ? { ts: Date.parse(created) } : {}),
          role: t.role as "user" | "assistant",
          content: t.content,
          queued: queued?.length ? queued : undefined,
          confirm: confirm?.length ? confirm : undefined,
          confirmResolved: true,
          crmResults: crmResults?.length ? crmResults : undefined,
          research: turnResearchRefs?.length
            ? turnResearchRefs.map((ref) => ({
                run_id: ref.run_id,
                question: ref.question,
                saved: ref.saved,
                configured: true,
                stop_reason: null,
                is_dossier: false,
                findings: [],
                sources: [],
                unverified_notes: [],
                rehydrating: !!ref.run_id,
              }))
            : undefined,
          artifacts: artifacts?.length ? artifacts : undefined,
          ...(turnSnapshot ? { turnSnapshot } : {}),
          ...(askRecord ? { ask: { askId: askRecord.ask_id, options: askRecord.options.map(({ label, value, description }) => ({ label, value, ...(description ? { description } : {}) })), multi: askRecord.multi, question: askRecord.question } } : {}),
          ...(answerClaim ? { answer: { askId: answerClaim.key.slice("answer:".length), skipped: answerClaim.skipped === true } } : {}),
        });
        if (turnResearchRefs?.length) researchRefsAll.push(...turnResearchRefs);
      });
    // C3a — a decision sentence the approval card sent on the person's behalf is hidden on reload too,
    // but ONLY when it is anchored: exactly one of the client's own two sentences AND directly after
    // an answer that carried a card (`bundle_ref.paige_confirm`). The same words typed anywhere else
    // are the person's own and stay visible. The card's settled line gains a receipt of what they
    // said — never a claim about what ran.
    for (let i = 1; i < mapped.length; i += 1) {
      const m = mapped[i];
      const prev = mapped[i - 1];
      if (m.role !== "user" || prev.role !== "assistant" || !prev.confirm?.length) continue;
      const said = isDecisionReplyText(m.content);
      if (!said) continue;
      mapped[i] = { ...m, decision: said };
      const created = turns.find((t) => (t as { id?: string }).id === m.id) as { created_at?: string } | undefined;
      const at = created?.created_at ? Date.parse(created.created_at) : NaN;
      mapped[i - 1] = { ...prev, confirmReceipt: { decision: said, ts: Number.isFinite(at) ? at : null, result: decisionCardResult(m.content) } };
    }
    // C4a — an answer that carried an approval forward saved the card's report exactly as the wire
    // sent it (`bundle_ref.paige_resume.approval_outcome`), so a reload draws the same report card the
    // person saw live — through the same reader (`applyServerOutcome`), against the card that asked.
    for (let i = 0; i < mapped.length; i += 1) {
      const m = mapped[i];
      if (m.role !== "assistant" || !m.turnSnapshot?.resumed) continue;
      const saved = turns.find((t) => (t as { id?: string }).id === m.id) as { bundle_ref?: Record<string, unknown> | null } | undefined;
      const report = readResumeRecord(saved?.bundle_ref?.paige_resume)?.approval_outcome;
      if (!report?.actions.length) continue;
      mapped[i] = { ...m, approvalOutcome: applyServerOutcome(pendingApprovalOutcome(mapped.slice(0, i), report.actions.map((a) => a.fingerprint)), report) };
    }
      // R2b §12 — resolve the research references through the governed get RPC after the
      // transcript paints (history load never blocks on research reads). A resolved run
      // upgrades the card to the full evidence (the SAME payload shape the Research
      // library renders — one citation identity); a null readback settles the honest
      // not-saved/not-available state.
      if (researchRefsAll.length > 0) {
        void (async () => {
          const { supabase } = await import("@/integrations/supabase/client");
          for (const ref of researchRefsAll) {
            if (!ref.run_id) continue;
            try {
              const { data } = await supabase.rpc("get_workspace_research_run", { _run_id: ref.run_id });
              if (!data) {
                // R2b review P2/P3: settle the reference — a null readback clears the
                // rehydrating state AND the saved claim (a once-confirmed run whose row
                // is gone must not keep its badge), so the card shows its honest
                // unavailable wording — never an eternal "Loading…", never a stale
                // "Saved" badge, never a fabricated evidence card.
                setMessages((prev) => prev.map((m) => m.research?.some((r) => r.run_id === ref.run_id)
                  ? { ...m, research: m.research!.map((r) => r.run_id === ref.run_id ? { ...r, rehydrating: false, saved: false } : r) }
                  : m));
                continue;
              }
              const run = data as unknown as Record<string, unknown>;
              setMessages((prev) => prev.map((m) => m.research?.some((r) => r.run_id === ref.run_id)
                ? { ...m, research: m.research!.map((r) => r.run_id === ref.run_id
                    ? {
                        run_id: r.run_id, question: typeof run.question === "string" ? run.question : r.question,
                        saved: true, configured: run.configured !== false,
                        stop_reason: typeof run.stop_reason === "string" ? run.stop_reason : null,
                        is_dossier: !!run.entity_profile,
                        findings: Array.isArray(run.findings) ? run.findings as PaigeResearchResult["findings"] : [],
                        sources: Array.isArray(run.sources)
                          ? (run.sources as Array<Record<string, unknown>>).map((src) => ({
                              index: Number(src.index ?? 0),
                              url: String(src.url ?? ""),
                              title: typeof src.title === "string" ? src.title : null,
                              reliability: typeof src.reliability === "string" ? src.reliability : null,
                              tier: typeof src.tier === "string" ? src.tier : null,
                              published_at: typeof src.published_at === "string" ? src.published_at : null,
                              excluded: src.excluded === true,
                            })) : [],
                        unverified_notes: Array.isArray((run.coverage as Record<string, unknown> | undefined)?.unverified_notes)
                          ? (run.coverage as { unverified_notes: string[] }).unverified_notes
                          : [],
                      }
                    : r) }
                : m));
            } catch { /* the card keeps its honest reference state */ }
          }
        })();
      }
    return mapped;
  }

  const selectThread = async (
    id: string,
    intent: Extract<ComposerConversationIntent, "automatic" | "explicit" | "controlled"> = "explicit",
  ) => {
    // Guard on what is actually HYDRATED, not on the selection. In controlled mode the
    // parent has already moved `activeThreadId` to this id before we load it, so an
    // `id === activeThreadId` guard would early-return and the transcript would never
    // arrive. A requested scope transition aborts the prior reply before accepting the target.
    if (
      id === hydratedFromRef.current
      && conversationStateRef.current.displayed.kind === "thread"
      && conversationStateRef.current.displayed.id === id
    ) return;
    if (soloTenantSafety && !activeTenantId) return;
    const currentConversation = conversationStateRef.current;
    if (
      currentConversation.requested.kind === "thread"
      && currentConversation.requested.id === id
      && !(
        currentConversation.displayed.kind === "thread"
        && currentConversation.displayed.id === id
      )
    ) return;
    const targetRequestScope = requestScopeFor("thread", id);
    if (!targetRequestScope) return;
    abortActiveRequest();
    requestScopeRef.current = targetRequestScope;
    acceptedRequestScopeEpochRef.current = targetRequestScope.epoch;
    applyConversationEvent({ type: "thread-requested", id, intent });
    // OPENING A SAVED CONVERSATION RELEASES THE FOCUSED CLIENT.
    //
    // The rail lists owner-level threads (`contact_id IS NULL`). Focus is not persisted with a
    // thread, so a transcript written while client A was focused lives in one of these — and
    // loading it while client B is focused replays A's content and ships it on the next turn under
    // B's scope. The composite scope epoch closes the LIVE prop path; this is the same carry-over
    // arriving through persistence, one click away, on the same surface.
    //
    // Released rather than refused: the person asked to open this conversation, and it is a
    // conversation they own. What is not true is that it is about the client currently in focus.
    if (clientId || businessMissionId) {
      if (draftIdentity) {
        const focusedThreadDraft = { ...draftIdentity, conversationId: id };
        moveComposerDraft(focusedThreadDraft, {
          ...focusedThreadDraft,
          focusedClientId: COMPOSER_FOCUS_NONE,
          focusedBusinessMissionId: COMPOSER_FOCUS_NONE,
        });
      }
      // Park BEFORE releasing. The release drops the focus, which moves the epoch, which
      // invalidates this load through the request fence — so without this the person's click
      // is discarded and hydration resumes `threads[0]`, opening a conversation they did not
      // ask for. Parked against the epoch it was made under, so it can only be adopted by the
      // transition it belongs to.
      pendingThreadSelectionRef.current = { epoch: scopeEpoch, id };
      onFocusRelease?.("thread_resumed");
    }
    const previousTranscriptThreadId = conversationStateRef.current.displayed.kind === "thread"
      ? conversationStateRef.current.displayed.id
      : null;
    const requestTicket = requestFenceRef.current.begin(
      targetRequestScope.handle,
      targetRequestScope.epoch,
    );
    if (soloTenantSafety) setCancelled(false);
    if (soloTenantSafety || isThreadControlled) setActiveThreadId(id);
    try {
      const turns = await threadsApi.loadTurns(id);
      if (!ticketAccepted(requestTicket)) return;
      const hydrated = turnsToMessages(turns);
      setMessages(hydrated.length ? hydrated : [mkMsg({ role: "assistant", content: openingGreeting })]);
      hydratedFromRef.current = id;
      applyConversationEvent({ type: "thread-loaded", id });
      if (!soloTenantSafety && !isThreadControlled) setActiveThreadId(id);
      setSteps([]);
      writeLiveTurn(null);
      setTurnTraceOpen({});
      if (soloTenantSafety) {
        setConnectionIssue(null);
        retryTurnRef.current = null;
      }
    } catch (e) {
      if (!ticketAccepted(requestTicket)) return;
      applyConversationEvent({ type: "thread-load-failed", id });
      if (soloTenantSafety || isThreadControlled) setActiveThreadId(previousTranscriptThreadId);
      console.error("[PaigeAIChat] load thread failed:", e);
      toast({ title: "Couldn't open that chat", description: "Give it another try in a moment.", variant: "destructive" });
    } finally {
      // Writability is derived by ComposerScopeState; no second hydration flag.
    }
  };

  const startNewChat = () => {
    if (composerScopeRef.current.status === "ready-new") {
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      return;
    }
    const targetRequestScope = requestScopeFor("new", conversationStateRef.current.newConversationId);
    if (!targetRequestScope) return;
    abortActiveRequest();
    requestScopeRef.current = targetRequestScope;
    acceptedRequestScopeEpochRef.current = targetRequestScope.epoch;
    hydratedFromRef.current = null;
    applyConversationEvent({ type: "new-chat-requested" });
    setActiveThreadId(null);
    setMessages([mkMsg({ role: "assistant", content: openingGreeting })]);
    setSteps([]);
    writeLiveTurn(null);
    setTurnTraceOpen({});
    setCancelled(false);
    setConnectionIssue(null);
    retryTurnRef.current = null;
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  // On first load in history mode, resume the most recent chat (or start fresh).
  // Gate on isFetched (a real, enabled fetch settled) — NOT isLoading, which is
  // false for a disabled query before the user/tenant ids resolve. Latching on
  // that empty pre-resolution render would strand the owner on a blank chat.
  useEffect(() => {
    if (
      !enableHistory
      || conversationStateRef.current.history !== "pending"
      || !threadsApi.isFetched
    ) return;
    // A FOCUSED CLIENT STARTS ON A FRESH CONVERSATION, AND IS NEVER AUTO-RESUMED INTO ONE (#765).
    //
    // Focusing a client changes `scopeEpoch`, so the reset effect above nulls `hydratedFromRef`
    // and returns the state machine to history-unresolved. Without this guard it resumed
    // `threads[0]` and `selectThread` released the focus that had just been set, so on any
    // account with a saved conversation the person lost their client before they could send a
    // turn. It worked only on an account with NO saved thread, which is why it hid for so long.
    //
    // The release in `selectThread` is deliberately NOT weakened to fix this. The rail lists
    // owner-level threads, so opening one really must drop a client focus — that transcript may
    // be about someone else. What was wrong is treating hydration as if it were the person
    // choosing. Skipping the resume is also the safer half of that pair: resuming while keeping
    // the focus would carry another client's transcript into this client's context.
    //
    // Clearing the focus changes the epoch again, so the owner-level history resumes normally.
    if (clientId || businessMissionId) {
      pendingThreadSelectionRef.current = null;
      applyConversationEvent({ type: "history-confirmed-empty" });
      return;
    }
    // A controlled parent that already knows the thread wins over "resume the newest":
    // the other door has a selection, and guessing threads[0] here would fight it.
    if (isThreadControlled && controlledThreadId) {
      void selectThread(controlledThreadId, "controlled");
      return;
    }
    // A thread the person actually asked for outranks "resume the newest". Their click was
    // parked because the focus release it triggered invalidated its own load.
    const requested = pendingThreadSelectionRef.current;
    pendingThreadSelectionRef.current = null;
    const target = requested?.id ?? threadsApi.threads[0]?.id;
    if (target) {
      void selectThread(target, requested ? "explicit" : "automatic");
    } else {
      applyConversationEvent({ type: "history-confirmed-empty" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    businessMissionId,
    clientId,
    controlledThreadId,
    enableHistory,
    isThreadControlled,
    threadsApi.isFetched,
    threadsApi.threads,
  ]);

  // CONTROLLED SYNC — the other half of "one thread, two doors". When the parent moves
  // the selection (the other door opened a thread, or created one on its first send),
  // adopt it: load that thread's turns so both doors show the SAME transcript. Keyed on
  // `hydratedFromRef`, not on `activeThreadId`, because our own writes already set both
  // — without that guard this would re-load in a loop. A real selection change interrupts
  // the prior scope's reply; a same-thread synchronization does not.
  useEffect(() => {
    if (!enableHistory || !isThreadControlled) return;
    if (controlledThreadId === hydratedFromRef.current) return;
    if (controlledThreadId) {
      void selectThread(controlledThreadId, "controlled");
    } else {
      // Parent cleared the selection (New chat in the other door) — reset to a fresh one.
      abortActiveRequest();
      hydratedFromRef.current = null;
      applyConversationEvent({ type: "new-chat-requested" });
      setMessages([mkMsg({ role: "assistant", content: openingGreeting })]);
      setSteps([]);
      writeLiveTurn(null);
      setTurnTraceOpen({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abortActiveRequest, controlledThreadId, enableHistory, isThreadControlled]);

  // One turn runner, reused by send + regenerate. `base` ends at the user turn to
  // answer; `rollback` is the list restored if the turn fails; `userText` seeds the
  // lazy thread title in history mode. A single assistantId/Ts is threaded through
  // every streamed setMessages so the bubble never remounts mid-stream (copy/retry/
  // feedback stay stable).
  const streamTurn = async (
    base: Message[],
    rollback: Message[],
    userText: string,
    doc?: AttachedDocument | null,
    originDraft: ComposerDraftHandle | null = null,
    approvedFingerprints?: string[],
    declinedFingerprints?: string[],
    voiceSink?: LiveVoiceSink,
    requestIntentId: string = durableIntentUuid(),
    /** C4c — this message answers PAIGE's open question (the server binds it to that question once).
     *  `card`: the answer was a choice (or the skip) made on her question's card, not typed words. */
    answer?: { askId: string; skipped: boolean; card?: boolean },
  ) => {
    if (soloTenantSafety && !activeTenantId) return;
    // Solo: this turn carries a decision; an approval's outcome card answers for it (see below).
    const approvalTurn = Boolean(soloTenantSafety && approvedFingerprints?.length);
    const decisionTurn = Boolean(soloTenantSafety && (approvedFingerprints?.length || declinedFingerprints?.length));
    const requestHandle = originDraft ?? composerScopeRef.current.writableHandle;
    const requestScope = requestScopeRef.current;
    if (!requestHandle || !composerDraftHandlesMatch(requestHandle, requestScope.handle)) return;
    let requestTicket = requestFenceRef.current.begin(requestHandle, requestScope.epoch);
    // Deliberately NOT stored on the retry: an approval is for one call at one moment. Replaying it
    // on a network retry would re-approve whatever the model emits the second time, which is the
    // exact substitution the fingerprint exists to prevent.
    let persistedDraft = originDraft;
    retryTurnRef.current = {
      base,
      rollback,
      userText,
      doc,
      draftHandle: persistedDraft,
      requestIntentId,
      ...(answer ? { answer } : {}),
      live: Boolean(voiceSink),
      decision: decisionTurn,
    };
    setConnectionIssue(null);
    if (soloTenantSafety && typeof navigator !== "undefined" && navigator.onLine === false) {
      // A decision that never left is undone, card and all: the person decides again when they are
      // back online. A Retry could not carry it — an approval is never replayed on a retry.
      if (decisionTurn) {
        setMessages(rollback);
        retryTurnRef.current = null;
      }
      setConnectionIssue("offline");
      return;
    }
    const newMessages = base;
    const assistantId = safeUuid();
    const assistantTs = Date.now();
    if (!claimRequestBusy(requestTicket)) return;
    setCancelled(false);
    setSteps([]); // fresh "watch her work" trace per turn
    setWritingPhase(false); // #11 — back to "Thinking…" until the first token this turn
    setCompacting(null); // #12 — clear any prior turn's compacting card
    setStreamedLiveCard(null);
    // C3a — this answer's living status. Nothing is drawn for the first 400 ms: a fast answer
    // should feel instant, not staged. A previous read still open (Approve pressed mid-stream)
    // settles first, so its answer keeps the line it earned instead of losing it.
    settleLiveTurn("done");
    writeLiveTurn({
      assistantId, startedAt: assistantTs, frame: null, rows: [], writing: false, gateOpen: false,
      streaming: true, endCause: null, elapsedMs: null, userText, stopFocus: true, resumed: false, answering: !!answer,
    });
    const gateId = window.setTimeout(() => updateLiveTurn(assistantId, (t) => ({ ...t, gateOpen: true })), TURN_LINE_GATE_MS);
    const timeoutId = soloTenantSafety ? window.setTimeout(() => {
      if (!ticketAccepted(requestTicket)) return;
      // The line stops honestly ("Stopped listening at six minutes"), never "Done".
      settleLiveTurn("timeout", assistantId);
      abortActiveRequest();
      if (voiceSink) {
        voiceSink.failed();
        retryTurnRef.current = null;
        setConnectionIssue("live-interrupted");
      } else if (approvalTurn) {
        // The outcome card already says Paige couldn't report back and to check first.
        retryTurnRef.current = null;
      } else {
        // A decline has no outcome card, so it keeps the notice — but never a Retry: resending
        // the words without the decision would skip nothing.
        if (decisionTurn) retryTurnRef.current = null;
        setConnectionIssue("timeout");
      }
    }, PAIGE_INTERACTIVE_TURN_BUDGET_MS) : null;
    let liveRequestDispatched = false;
    // THE CARD THAT ANSWERS FOR AN APPROVAL (owner-approved recovery design, 2026-09-26). It is on
    // screen the moment Approve is pressed, saying Running…, and it settles when the server reports
    // what became of each action. Until then — and if the report never comes — it can only say it
    // couldn't confirm; it never guesses done (approvalOutcome.ts).
    let outcomeThisTurn: ApprovalOutcome | undefined = approvalTurn && approvedFingerprints
      ? pendingApprovalOutcome(base, approvedFingerprints) : undefined;
    let approvalDispatched = false;
    if (outcomeThisTurn) setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: "", approvalOutcome: outcomeThisTurn }]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!ticketAccepted(requestTicket)) return;
      
      if (!session) {
        toast({
          title: "Authentication Error",
          description: "Please sign in to use Paige AI.",
          variant: "destructive",
        });
        setMessages(rollback);
        releaseRequestBusy(requestTicket);
        return;
      }

      // History mode: create the thread lazily on the first send, then stream
      // into it. The server is the single writer of turns — we only pass the id.
      let threadId = activeThreadId;
      if (enableHistory) {
        try {
          if (!threadId) {
            threadId = await threadsApi.ensureThread(userText);
            if (!ticketAccepted(requestTicket)) return;
            const threadRequestScope = {
              handle: { ...requestTicket.scopeHandle, conversationId: threadId },
              epoch: composerDraftKey({ ...requestTicket.scopeHandle, conversationId: threadId }),
            };
            requestScopeRef.current = threadRequestScope;
            acceptedRequestScopeEpochRef.current = threadRequestScope.epoch;
            requestTicket = requestFenceRef.current.rebind(
              requestTicket,
              threadRequestScope.handle,
              threadRequestScope.epoch,
            );
            if (persistedDraft) {
              const threadDraft = { ...persistedDraft, conversationId: threadId };
              moveComposerDraft(persistedDraft, threadDraft);
              persistedDraft = threadDraft;
              if (retryTurnRef.current) {
                retryTurnRef.current = {
                  ...retryTurnRef.current,
                  draftHandle: threadDraft,
                };
              }
            }
            // The transcript on screen IS this new thread's — mark it hydrated so the
            // controlled-sync effect below doesn't immediately re-load and wipe it.
            hydratedFromRef.current = threadId;
            applyConversationEvent({ type: "lazy-thread-created", id: threadId });
            transcriptScrollRef.current?.adoptContext([transcriptContextPrefix, threadId].join(":"));
            setActiveThreadId(threadId);
          }
          setStreamingThreadId(threadId);
        } catch (e) {
          if (!ticketAccepted(requestTicket)) return;
          console.error("[PaigeAIChat] ensureThread failed:", e);
          toast({ title: "Couldn't start that chat", description: "Give it another try in a moment.", variant: "destructive" });
          setMessages(rollback);
          releaseRequestBusy(requestTicket);
          return;
        }
      }

      liveRequestDispatched = Boolean(voiceSink);
      // From here the approval may reach Paige and run, so no failure below may put the card back
      // or say the message wasn't sent.
      approvalDispatched = Boolean(outcomeThisTurn);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-ai-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            // An approval turn Paige never got to put words to carries what its card showed, since the
            // server refuses an empty message and that turn stays on screen (approvalOutcome.ts).
            // C3a's display-only fields (an answer's `turnSnapshot` and reloaded `confirmReceipt`, a
            // decision turn's `decision`) never ride the wire: what is sent is the shape it was before C3.
            messages: voiceSink ? [{ role: "user", content: userText }] : newMessages.map(({ turnSnapshot: _view, confirmReceipt: _receipt, decision: _decided, ask: _ask, answer: _answer, ...m }) =>
              m.role === "assistant" && m.content.trim() === "" && m.approvalOutcome
                ? { ...m, content: approvalOutcomeTranscript(m.approvalOutcome) } : m),
            ...(voiceSink ? { liveRuntimeChallenge: voiceSink.challenge } : {}),
            ...(threadId ? { threadId } : {}),
            requestIntentId,
            ...(clientId ? { clientId } : {}),
            ...(clientContext ? { clientContext } : {}),
            ...(surfaceContext ? { surfaceContext } : {}),
            ...(businessMissionId ? { businessMissionId } : {}),
            // The exact calls the person ticked on a confirm card. The gate will only run a call
            // whose fingerprint is here; `confirm:true` on its own no longer opens it.
            ...(approvedFingerprints?.length ? { approvedConfirmations: approvedFingerprints } : {}),
            ...(declinedFingerprints?.length ? { declinedConfirmations: declinedFingerprints } : {}),
            // C4c — this message answers PAIGE's question. It names the question; it grants nothing.
            ...(answer && !voiceSink ? { resume: { kind: "answer", ask_id: answer.askId, ...(answer.skipped ? { skipped: true } : {}) } } : {}),
            // Attachment (#480): the edge inlines pdf/image as image_url and docx
            // textContent as a text block. Pass the REAL mimeType/kind/textContent
            // — the hook already extracted docx client-side.
            ...(doc
              ? {
                  document: {
                    base64: doc.base64,
                    fileName: doc.name,
                    mimeType: doc.mimeType,
                    textContent: doc.textContent,
                    kind: doc.kind,
                  },
                }
              : {}),
            ...getUserClock(),
          }),
          // Always. A conditional signal meant the surface that focuses clients issued
          // un-abortable requests, so a switch could clear the transcript and then have the still-
          // running stream write the previous client's content back into it.
          signal: requestTicket.signal,
        }
      );

      if (!ticketAccepted(requestTicket)) return;

      if (!response.ok) {
        // Once dispatched, an HTTP failure does not prove the turn or its
        // governed tools did nothing. Keep the Live transcript, never replay it.
        if (voiceSink) throw new Error("live_answer_unavailable");
        // C4c — THE ANSWER WAS NOT CARRIED FORWARD. Either it was never bound (the question was moved
        // past, PAIGE already has an answer to it, or it could not be checked), or it was bound but PAIGE
        // was never reached (the gateway refused, the request failed) and the server ASKED THE QUESTION
        // AGAIN under a new id (`ASK_REOPENED`, whatever the status). Checked before the status branches
        // below, because a re-asked question can come back on a 429 as well. The message is NOT
        // reinterpreted as an ordinary one and never re-sent by itself: it goes back where it was — the
        // typed words are still in the composer — and the transcript is re-read, so what is on screen is
        // what the thread really holds (the re-asked question, open; or the other tab's answer and
        // PAIGE's continuation).
        if (answer) {
          const refusal = await response.clone().json().then((b: { code?: unknown; answer_kept?: unknown }) => b && typeof b === "object" ? b : null).catch(() => null);
          const code = typeof refusal?.code === "string" ? refusal.code : null;
          if (code === "ASK_ALREADY_ANSWERED" || code === "ASK_NOT_OPEN" || code === "ASK_ANSWER_UNAVAILABLE" || code === "ASK_ANSWER_IN_PROGRESS" || code === "ASK_REOPENED") {
            const askErr = await parsePaigeChatError(response);
            if (!ticketAccepted(requestTicket)) return;
            // The server says what happened to the answer; where the person's words are now is this
            // client's to say, because it is what put them there. Typed words stay in the composer.
            // A choice made on the card was never in the composer — the card itself comes back if
            // the question is open again — so nothing is said about the box. An answer the server
            // KEPT in the conversation (another message reached PAIGE first) is in the transcript the
            // re-read below draws, so it leaves the composer — sending it again would only repeat it.
            const kept = refusal?.answer_kept === true;
            if (kept && persistedDraft && shouldClearComposerDraft({ terminalDone: true, currentDraft: readComposerDraft(persistedDraft), submittedText: userText })) {
              clearComposerDraft(persistedDraft);
            }
            const where = kept || answer.card ? "" : " Your message is back in the box.";
            toast({ title: kept ? "Another message came first" : askErr.title, description: `${askErr.description}${where}` });
            setMessages(rollback);
            retryTurnRef.current = null;
            releaseRequestBusy(requestTicket);
            if (enableHistory) setStreamingThreadId(null);
            settleLiveTurn("done", assistantId);
            if (threadId && code !== "ASK_ANSWER_UNAVAILABLE") {
              try {
                const turns = await threadsApi.loadTurns(threadId);
                if (ticketAccepted(requestTicket) && turns.length) setMessages(turnsToMessages(turns));
              } catch { /* the rollback stands */ }
            }
            return;
          }
        }
        if (response.status === 429) {
          toast({
            title: "Rate Limit Reached",
            description: "Please wait a moment before sending another message.",
            variant: "destructive",
          });
          setMessages(rollback);
          releaseRequestBusy(requestTicket);
          return;
        }
        // #587 — read the structured { code, reason, recommendation } body and show the SPECIFIC
        // message (e.g. a 15 MB size limit) instead of a generic "Failed to send message" toast.
        const chatErr = await parsePaigeChatError(response);
        if (!ticketAccepted(requestTicket)) return;
        toast({ title: chatErr.title, description: chatErr.description, variant: "destructive" });
        setMessages(rollback);
        releaseRequestBusy(requestTicket);
        if (enableHistory) setStreamingThreadId(null);
        // §70 — A TRANSIENT SERVER FAILURE LEFT NO WAY BACK. Retry existed only for the offline and
        // timeout cases; a 5xx rolled the turn back with a toast and nothing else, so the person's
        // message was gone and their only recourse was to type it again from memory. The turn is
        // already captured in `retryTurnRef`, so the affordance costs nothing but was never offered.
        //
        // Deliberately 5xx ONLY. A 4xx — too large, malformed, refused on its merits — will be
        // refused identically next time, and a Retry button that cannot succeed is exactly the kind
        // of control §70 counts as not delivered.
        // The card is back as it was, so the way to try again is on it. A Retry would resend the
        // words without the decision, which approves or skips nothing.
        if (decisionTurn) retryTurnRef.current = null;
        if (response.status >= 500) setConnectionIssue("server");
        return;
      }
      // This is the canonical PAIGE runtime request, under the same caller JWT,
      // thread, tenant context and governed approval path as text chat.

      let assistantMessage = "";
      let queuedThisTurn: QueuedApproval[] = [];
      const crmResultsThisTurn: PaigeCrmResult[] = [];
      // R2b — inline research results streamed this turn (paige_research frames).
      const researchThisTurn: PaigeResearchResult[] = [];
      // Accumulate EVERY pending confirmation this turn — a blanket "Approve" runs
      // all of them, so the operator must see all of them (design-crew B1).
      const confirmThisTurn: Array<{ tool: string; summary: string; fingerprint?: string }> = [];
      // #29 — deliverables (document/image) Paige persisted this turn, streamed as
      // paige_artifact frames BEFORE the reply text, rendered as inline handoff cards.
      const artifactsThisTurn: PaigeArtifact[] = [];
      // The document proposal, if this turn produced one. At most one per turn — a turn carries at
      // most one attached document — so a variable rather than a list.
      let proposalThisTurn: ExtractionProposal | null = null;
      // C4c — the question this answer ended on, if PAIGE paused to ask (`paige_choices`).
      let askThisTurn: Message["ask"] | undefined;
      let streamDone = false;

      setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: "", approvalOutcome: outcomeThisTurn }]);

      // The bytes are framed by the shared reader (src/lib/paige-stream): one buffer across chunks,
      // CR stripping, comments and blank lines skipped. This surface keeps its OWN dispatch below,
      // in its own branch order, over the whole parsed object — so `raw`, not the one key the
      // decoder names. The decoder's naming decides only two things here: `[DONE]` ends the turn,
      // and a line that is not JSON HALTS the turn (`malformed: "drain"`). Before the move that line
      // was pushed back and failed again on every chunk, so nothing after it was ever acted on and
      // the turn fell to the incomplete-turn branch below only when the server closed the body;
      // "drain" keeps exactly that — nothing more is yielded, and the read waits for the body to
      // end. A frame whose handling throws halts the same way (`halted`), as it did before; the
      // reader runs with `stopAtDone: false` and this loop breaks on `[DONE]` itself, so once halted
      // a later `[DONE]` is skipped and the turn still waits for the body to close.
      //
      // The `paige_turn` frame (C1) is THE control signal for this answer's status line (C3a). It is
      // read by name before the raw dispatch below, and it changes nothing else.
      let halted = false;
      for await (const { frame, raw } of readPaigeStreamWithRaw(response.body, { stopAtDone: false, malformed: "drain" })) {
        if (!ticketAccepted(requestTicket)) return;
        if (halted) continue;
        if (frame.type === "done") {
          streamDone = true;
          voiceSink?.done();
          break;
        }
        if (frame.type === "malformed") { halted = true; continue; }
        if (frame.type === "turn") {
          const turnFrame = frame.turn;
          // C4a — `resumed` sticks for the rest of the read: later frames (the terminal) replace the
          // frame, never the fact that this answer carries an approval forward.
          updateLiveTurn(assistantId, (t) => ({ ...t, frame: turnFrame, resumed: t.resumed || (turnFrame.event === "resumed" && !t.answering) }));
          continue;
        }
        try {
          // The parsed JSON exactly as JSON.parse returned it, read with the optional chaining the
          // branches below always used. A frame that throws here (JSON `null`, for one) halts the
          // read exactly as a line that is not JSON does.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsed = raw as any;
          if (voiceSink && parsed.paige_live_error) {
            voiceSink.failed();
            break;
          }
          if (typeof parsed.paige_live_output === "string") {
            voiceSink?.proof(parsed.paige_live_output);
            continue;
          }
          // Structured event: a "watch her work" step (#95). Upsert by id, sorted by seq.
          if (parsed.paige_step) {
            setSteps((prev) => upsertStep(prev, parsed.paige_step as PaigeStepFrame));
            const stepFrame = parsed.paige_step as unknown;
            updateLiveTurn(assistantId, (t) => ({ ...t, rows: upsertTurnRow(t.rows, stepFrame, Date.now()) }));
            continue;
          }
          const liveCard = parseLiveConversationCard(parsed.paige_live_card);
          if (liveCard) {
            setStreamedLiveCard(liveCard);
            continue;
          }
          // #11 — the server confirmed the transition into the reply. A lightweight signal; the
          // client also derives "writing" from the first content delta below, so this is belt-and-braces.
          if (parsed.paige_phase === "writing") {
            setWritingPhase(true);
            updateLiveTurn(assistantId, (t) => ({ ...t, writing: true }));
            continue;
          }
          // The server refused the focused client — that client does not belong to this
          // workspace. This frame shipped for several releases with NO consumer anywhere in the
          // app (zero hits repo-wide), which the handler's own comment described as "an
          // advisory signal is not a control": the refusal reached the transcript as prose while
          // the surface went on asserting a focus the server had denied.
          //
          // Two things happen, in this order. The refusal SENTENCE the server streams is parked
          // so it survives the transcript reset that releasing focus is about to cause; then the
          // surface that owns focus is told to let it go. `reason` is one of the handler's fixed
          // refusal categories — never an identifier for the client that was refused, which is
          // the whole point of the backend not echoing it.
          // A document Paige read produced fields she is PROPOSING. NOTHING HAS BEEN WRITTEN.
          //
          // This frame existed for several releases with no consumer anywhere in the app, while
          // the credit-report path wrote eight tables — three FICO columns on `profiles`,
          // negative items, accounts, inquiries, factor scores, funding readiness — the moment a
          // PDF was dropped in, and this surface did not even parse the `sync_status` that
          // reported it. So the write was invisible AND unasked. Now the write waits for the
          // card below.
          if (parsed.extraction_proposal?.id && Array.isArray(parsed.extraction_proposal.fields)) {
            proposalThisTurn = parsed.extraction_proposal as ExtractionProposal;
            // Committed HERE, not left for a later delta to carry. This frame is emitted at the
            // CLOSE of the turn, after the last reply token, so no subsequent `setMessages` runs
            // — a proposal parked in a local and never committed would simply never appear, and
            // the person would be left with a document Paige said she read and nothing to do
            // about it. Same shape as the approval and confirm frames above, for the same reason.
            setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn.length ? queuedThisTurn : undefined, confirm: confirmThisTurn.length ? [...confirmThisTurn] : undefined, crmResults: crmResultsThisTurn.length ? [...crmResultsThisTurn] : undefined, research: researchThisTurn.length ? [...researchThisTurn] : undefined, artifacts: artifactsThisTurn.length ? [...artifactsThisTurn] : undefined, extractionProposal: proposalThisTurn }]);
            continue;
          }
          if (parsed.client_scope?.status === "refused") {
            // ONLY a PERMISSION verdict releases focus. Four of the server's six refusal
            // categories mean UNKNOWN — an RPC blip, a failed authorization read, a thrown
            // exception — and the handler's own comment says so: "a read failure is UNKNOWN
            // authority, never permission." Treating those as "this client is not yours"
            // permanently dropped the operator's focused client on a transient failure and told
            // them something untrue about who the client belongs to. Both kinds still refuse the
            // turn; only one is a fact about ownership.
            const permissionRefusal = parsed.client_scope.kind === "permission";
            const noticeText = permissionRefusal
              ? "I couldn't confirm that client belongs to your workspace, so I've let go of that focus. Nothing was saved. Reopen them from your client list if you think that's wrong."
              : "I couldn't check that client just now, so I stopped rather than guess. Nothing was saved — try that again.";
            // THE NOTICE GOES IN THIS TURN'S TRANSCRIPT FIRST, unconditionally. That is where an
            // explanation of a refused turn belongs, and it is what a person sees when nothing
            // else happens.
            assistantMessage = assistantMessage ? `${assistantMessage}\n\n${noticeText}` : noticeText;
            setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn }]);
            // It is ALSO parked — but only when focus is genuinely about to be released, because
            // that release resets the transcript and would otherwise delete the line just added.
            //
            // §13 — PARKING IT UNCONDITIONALLY WAS WRONG, and a test written for the stranding
            // case caught it. A notice parked when nothing releases focus survives in the ref and
            // is adopted by the NEXT epoch change of any kind — so a later, unrelated switch
            // opened with an explanation of a refusal that had nothing to do with it. Epoch
            // stamping alone does not fix that: both transitions leave the same epoch. Not
            // parking it is what fixes it, and it is also the simpler truth — the notice only
            // needs to survive a reset when a reset is coming.
            if (permissionRefusal && onFocusRelease) {
              pendingScopeNoticeRef.current = { epoch: scopeEpoch, text: noticeText };
              onFocusRelease("refused");
            }
            continue;
          }
          // C4c — PAIGE paused this piece of work to ask. Her question IS the answer's words (the server
          // ends the turn on it and saves it as the turn's content); its id is the server's, so the
          // reply can be bound to exactly this question. Bounded here as the server bounded it.
          if (parsed.paige_choices && typeof parsed.paige_choices === "object" && typeof parsed.paige_choices.ask_id === "string") {
            const c = parsed.paige_choices as { prompt?: unknown; options?: unknown; multi?: unknown; ask_id: string };
            const options: PaigeAskOption[] = Array.isArray(c.options)
              ? (c.options as Array<Record<string, unknown>>).filter((o) => typeof o?.label === "string" && typeof o?.value === "string")
                .slice(0, 4).map((o) => ({ label: String(o.label), value: String(o.value), ...(typeof o.description === "string" && o.description ? { description: String(o.description) } : {}) }))
              : [];
            askThisTurn = { askId: c.ask_id, options: options.length >= 2 ? options : [], multi: c.multi === true, ...(typeof c.prompt === "string" && c.prompt ? { question: c.prompt } : {}) };
            if (!assistantMessage && typeof c.prompt === "string") assistantMessage = c.prompt;
            setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn.length ? queuedThisTurn : undefined, confirm: confirmThisTurn.length ? [...confirmThisTurn] : undefined, crmResults: crmResultsThisTurn.length ? [...crmResultsThisTurn] : undefined, research: researchThisTurn.length ? [...researchThisTurn] : undefined, artifacts: artifactsThisTurn.length ? [...artifactsThisTurn] : undefined, ask: askThisTurn }]);
            continue;
          }
          // #12 — conversation-compacting lifecycle (approaching/start/progress/done/skipped).
          if (parsed.paige_compacting) { setCompacting(parsed.paige_compacting as CompactingSignal); continue; }
          // Structured event: Paige queued an action to the approvals desk.
          if (Array.isArray(parsed.approval_queued)) {
            queuedThisTurn = parsed.approval_queued as QueuedApproval[];
            // #29 §39 — carry artifacts here too so the invariant "the card survives every rebuild"
            // never depends on the backend's frame ORDER (today approval_queued precedes paige_artifact,
            // but a reorder or a second approval_queued after an artifact must not wipe the card).
            setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn, confirm: confirmThisTurn.length ? confirmThisTurn : undefined, crmResults: crmResultsThisTurn.length ? [...crmResultsThisTurn] : undefined, research: researchThisTurn.length ? [...researchThisTurn] : undefined, artifacts: artifactsThisTurn.length ? [...artifactsThisTurn] : undefined, extractionProposal: proposalThisTurn ?? undefined }]);
            continue;
          }
          // What became of each approval this turn carried. Only the card that asked reads it;
          // on any other mount the frame is consumed and changes nothing.
          if (parsed.paige_approval_outcome) {
            if (outcomeThisTurn) {
              outcomeThisTurn = applyServerOutcome(outcomeThisTurn, parsed.paige_approval_outcome);
              setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn.length ? queuedThisTurn : undefined, confirm: confirmThisTurn.length ? [...confirmThisTurn] : undefined, crmResults: crmResultsThisTurn.length ? [...crmResultsThisTurn] : undefined, research: researchThisTurn.length ? [...researchThisTurn] : undefined, artifacts: artifactsThisTurn.length ? [...artifactsThisTurn] : undefined, extractionProposal: proposalThisTurn ?? undefined }]);
            }
            continue;
          }
          // Structured event: Paige is asking to confirm a mutating action → render an approve/deny card.
          if (parsed.paige_confirm?.summary) {
            confirmThisTurn.push({ tool: String(parsed.paige_confirm.tool || "action"), summary: String(parsed.paige_confirm.summary), ...(parsed.paige_confirm.fingerprint ? { fingerprint: String(parsed.paige_confirm.fingerprint) } : {}), ...(parsed.paige_confirm.command && typeof parsed.paige_confirm.command === "object" ? { command: parsed.paige_confirm.command as Record<string, unknown> } : {}), ...(parsed.paige_confirm.idempotency_key ? { idempotency_key: String(parsed.paige_confirm.idempotency_key) } : {}), ...previewOf(parsed.paige_confirm) });
            setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn.length ? queuedThisTurn : undefined, confirm: [...confirmThisTurn], crmResults: crmResultsThisTurn.length ? [...crmResultsThisTurn] : undefined, research: researchThisTurn.length ? [...researchThisTurn] : undefined, artifacts: artifactsThisTurn.length ? [...artifactsThisTurn] : undefined, extractionProposal: proposalThisTurn ?? undefined }]);
            continue;
          }
          if (parsed.paige_crm_result?.action && parsed.paige_crm_result?.receipt_recorded === true) {
            crmResultsThisTurn.push(parsed.paige_crm_result as PaigeCrmResult);
            // R2b review P2: card survival must not depend on frame order — this rebuild
            // carries the research cards too (researchTrace flushes after crmResultTrace
            // today, but the invariant is the crm pattern's, not the ordering's).
            setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn.length ? queuedThisTurn : undefined, confirm: confirmThisTurn.length ? [...confirmThisTurn] : undefined, crmResults: [...crmResultsThisTurn], research: researchThisTurn.length ? [...researchThisTurn] : undefined, artifacts: artifactsThisTurn.length ? [...artifactsThisTurn] : undefined, extractionProposal: proposalThisTurn ?? undefined }]);
            continue;
          }
          // R2b — the inline research card arrives attached to the SAME assistant turn
          // (one Paige turn, ruling §7) and renders immediately, like the crm cards.
          if (Array.isArray(parsed.paige_research?.findings)) {
            researchThisTurn.push(parsed.paige_research as PaigeResearchResult);
            setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn.length ? queuedThisTurn : undefined, confirm: confirmThisTurn.length ? [...confirmThisTurn] : undefined, crmResults: crmResultsThisTurn.length ? [...crmResultsThisTurn] : undefined, research: [...researchThisTurn], artifacts: artifactsThisTurn.length ? [...artifactsThisTurn] : undefined, extractionProposal: proposalThisTurn ?? undefined }]);
            continue;
          }
          // #29 — Paige handed the user a deliverable (document/image) → attach an inline handoff card.
          // Arrives BEFORE the reply text, so build the assistant bubble now; the content rebuild below
          // preserves artifactsThisTurn so the card survives the streaming text.
          if (parsed.paige_artifact?.id && (parsed.paige_artifact.artifactType === "document" || parsed.paige_artifact.artifactType === "image")) {
            const a = parsed.paige_artifact as PaigeArtifact;
            // Capture the frame's tenant_id — the EXACT tenant the row was saved under — so the card's
            // RLS-safe hydrate scopes to it, not the viewer's activeTenantId (they diverge when an
            // operator manages another tenant → wrong-tenant query → 0 rows → "Preview unavailable").
            artifactsThisTurn.push({ id: String(a.id), title: String(a.title ?? ""), url: a.url ?? undefined, artifactType: a.artifactType, tenantId: (parsed.paige_artifact.tenant_id as string | undefined) ?? undefined });
            setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn.length ? queuedThisTurn : undefined, confirm: confirmThisTurn.length ? [...confirmThisTurn] : undefined, crmResults: crmResultsThisTurn.length ? [...crmResultsThisTurn] : undefined, research: researchThisTurn.length ? [...researchThisTurn] : undefined, artifacts: [...artifactsThisTurn] }]);
            continue;
          }
          // Only a string is an answer's words (the shared decoder's rule): a non-string `content`
          // is dropped rather than coerced into the transcript.
          const content: unknown = parsed.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) {
            if (!assistantMessage) setWritingPhase(true); // #11 — first token → "Writing…"
            assistantMessage += content;
            setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn.length ? queuedThisTurn : undefined, confirm: confirmThisTurn.length ? [...confirmThisTurn] : undefined, crmResults: crmResultsThisTurn.length ? [...crmResultsThisTurn] : undefined, research: researchThisTurn.length ? [...researchThisTurn] : undefined, artifacts: artifactsThisTurn.length ? [...artifactsThisTurn] : undefined, extractionProposal: proposalThisTurn ?? undefined, ...(askThisTurn ? { ask: askThisTurn } : {}) }]);
          }
        } catch {
          halted = true;
        }
      }

      if (!ticketAccepted(requestTicket)) return;
      if (!streamDone && outcomeThisTurn) {
        // The approval reached Paige, so it may have run. Keep everything that arrived — never roll
        // the turn back and never say the message wasn't sent — and let the card say so.
        if (!outcomeThisTurn.reported) outcomeThisTurn = { ...outcomeThisTurn, dropped: true };
        setMessages([...newMessages, { id: assistantId, ts: assistantTs, role: "assistant", content: assistantMessage, approvalOutcome: outcomeThisTurn, queued: queuedThisTurn.length ? queuedThisTurn : undefined, confirm: confirmThisTurn.length ? [...confirmThisTurn] : undefined, crmResults: crmResultsThisTurn.length ? [...crmResultsThisTurn] : undefined, research: researchThisTurn.length ? [...researchThisTurn] : undefined, artifacts: artifactsThisTurn.length ? [...artifactsThisTurn] : undefined, extractionProposal: proposalThisTurn ?? undefined }]);
        retryTurnRef.current = null;
        releaseRequestBusy(requestTicket);
        setStreamingThreadId(null);
        return;
      }
      if (!streamDone) {
        // A released Live sentence may already have been heard and persisted.
        // Keep that same transcript; an incomplete answer is never a success
        // and must not offer replay of a possibly executed tool turn.
        if (voiceSink) {
          voiceSink.failed();
          retryTurnRef.current = null;
        } else setMessages(rollback);
        releaseRequestBusy(requestTicket);
        setStreamingThreadId(null);
        setConnectionIssue(voiceSink ? "live-interrupted" : "server");
        return;
      }
      if (persistedDraft && shouldClearComposerDraft({
        terminalDone: streamDone,
        currentDraft: readComposerDraft(persistedDraft),
        submittedText: userText,
      })) {
        clearComposerDraft(persistedDraft);
      }
      retryTurnRef.current = null;
      releaseRequestBusy(requestTicket);
      if (enableHistory) {
        setStreamingThreadId(null);
        // Reorder the rail + pick up the server-side auto-title. The assistant
        // turn + title write run in the edge fn's waitUntil after the stream
        // closes, so refresh once now and again shortly to catch that commit.
        threadsApi.onTurnPersisted();
        window.setTimeout(() => {
          if (ticketAccepted(requestTicket)) threadsApi.onTurnPersisted();
        }, 1800);
      }
    } catch (error) {
      if (!ticketAccepted(requestTicket)) return;
      if (liveRequestDispatched && voiceSink) {
        voiceSink.failed();
        retryTurnRef.current = null;
        releaseRequestBusy(requestTicket);
        setStreamingThreadId(null);
        setConnectionIssue("live-interrupted");
        return;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        releaseRequestBusy(requestTicket);
        setStreamingThreadId(null);
        setCancelled(true);
        return;
      }
      if (approvalDispatched) {
        // Same as a stream that ended early: the approval may have run, so the card answers for it.
        console.error("Chat error after an approval was sent:", error);
        setMessages((current) => current.map((message) => message.id === assistantId && message.approvalOutcome && !message.approvalOutcome.reported
          ? { ...message, approvalOutcome: { ...message.approvalOutcome, dropped: true } }
          : message));
        retryTurnRef.current = null;
        releaseRequestBusy(requestTicket);
        if (enableHistory) setStreamingThreadId(null);
        return;
      }
      console.error("Chat error:", error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
      setMessages(rollback);
      releaseRequestBusy(requestTicket);
      if (enableHistory) setStreamingThreadId(null);
      if (decisionTurn) retryTurnRef.current = null;
      if (soloTenantSafety) setConnectionIssue("server");
    } finally {
      // C2 — the no-stuck-working safety net: the fence release is idempotent (it checks
      // the ticket first), so calling it here catches any exit path that missed it. Without
      // this, an unexpected exception between the specific handlers leaves the working
      // indicator on with no stream behind it — the exact fake-working state C2 forbids.
      releaseRequestBusy(requestTicket);
      // However the read ended — [DONE], a rollback, an error — a step it started and never
      // closed is dropped, so the trace and the strip stop saying she is at work. A superseded
      // request leaves the trace alone: it now belongs to the turn that replaced it.
      if (ticketAccepted(requestTicket)) setSteps(settleOpenSteps);
      // C3a — however an accepted read ended, the answer's line settles. A rolled-back answer is gone
      // from the transcript, so nothing is stamped and nothing is drawn for it.
      if (ticketAccepted(requestTicket)) settleLiveTurn("done", assistantId);
      window.clearTimeout(gateId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (businessMissionId && ticketAccepted(requestTicket)) {
        window.dispatchEvent(new CustomEvent("business-mission:refresh", { detail: { missionId: businessMissionId } }));
      }
      // Any screen PAIGE's tools may have changed during this turn (the email editor, for one) looks again.
      if (ticketAccepted(requestTicket)) window.dispatchEvent(new CustomEvent("paige:turn-settled"));
    }
  };

  /**
   * Applies exactly what the person ticked — BY KEY, never by value.
   *
   * The request carries the upload id and the selected field keys. It does NOT carry the numbers.
   * The server re-reads its own stored extraction and writes from that, so the human approves and
   * the server writes the same thing by construction. If the values travelled through the browser,
   * this surface would be deciding what lands on a credit profile, and "approved" would mean
   * "posted a form" rather than "agreed to what I was shown".
   *
   * An empty selection is a real answer — Skip — not a no-op: it tells the server the person
   * declined, so the proposal settles instead of sitting open forever.
   */
  const applyExtraction = async (proposal: ExtractionProposal, selectedKeys: string[]) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      toast({ title: "Please sign in", description: "Your session expired. Sign in and try again.", variant: "destructive" });
      throw new Error("no session");
    }
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-apply-extraction`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ upload_id: proposal.id, approved_keys: selectedKeys }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // The card renders its own error state from a thrown promise. Surfacing the server's
      // sentence rather than a generic one, because it is the one that says whether anything was
      // written (§13 — it says "Nothing was changed" when nothing was).
      toast({ title: "Couldn't save those", description: String(body?.error ?? "Try again in a moment."), variant: "destructive" });
      throw new Error(String(body?.error ?? "apply failed"));
    }
    // §13/§70 — NOTHING IS UNMOUNTED HERE, AND THAT IS THE FIX. The first version marked the turn
    // settled on success, which unmounted the card in the same commit — reproducing, one step
    // later, exactly the invisibility this slice is about: the write to a credit profile happened
    // and the person saw nothing. The card vanished, its own "Saved" state never rendered, and the
    // only toast was on failure. An independent reviewer read the post-apply DOM and found the
    // transcript back at the greeting.
    //
    // `ExtractionProposalCard` already owns a settled state and shows what was recorded. It only
    // needed to be left alone to do it. Not re-rendering the message list is also what preserves
    // that internal state — a `setMessages` here would reconcile the card back to `idle`.
    //
    // Re-offering after a reload is not a risk to guard against: `extractionProposal` is live-turn
    // only and is never rehydrated, so there is nothing to re-offer.
  };

  /** `approvedFingerprints` carries the exact calls a person ticked on a confirm card. The server's
   *  gate requires the call it is about to run to be one of them; a `confirm:true` flag alone no
   *  longer opens it. Absent on every ordinary turn. */
  const handleSend = async (overrideText?: string, approvedFingerprints?: string[], declinedFingerprints?: string[], voiceSink?: LiveVoiceSink, opts?: { answer?: { askId: string; skipped: boolean } }) => {
    const originDraft = composerScope.writableHandle;
    if (dictationActive || !originDraft) { voiceSink?.failed(); return; }
    const text = (overrideText ?? input).trim();
    // Allow a send with text OR an attachment alone (#480). An override (confirm
    // card Approve/Deny) never carries a doc, so snapshot only on a real compose.
    const currentDoc = overrideText === undefined ? attachedDoc : null;
    if ((!text && !currentDoc) || !composerScope.writable) { voiceSink?.failed(); return; }
    let voiceSettled = false;
    const trackedVoiceSink: LiveVoiceSink | undefined = voiceSink && {
      challenge: voiceSink.challenge,
      proof: (token) => voiceSink.proof(token),
      done: () => { voiceSettled = true; voiceSink.done(); },
      failed: () => { if (!voiceSettled) { voiceSettled = true; voiceSink.failed(); } },
    };
    // An accepted send closes the current dictation generation before clearing
    // the composer. A delayed provider final can never become the next draft.
    dictationGenerationRef.current += 1;
    setDictationGeneration(dictationGenerationRef.current);
    const rollback = messages;
    let userContent = text || (currentDoc ? `Analyze this document: ${currentDoc.name}` : "");
    // C4c — is this message the ANSWER to PAIGE's open question? Only when it says so: a choice or a
    // skip on the question's own card, or words typed while the composer is answering it (the person
    // can switch that off with "Ask something else instead"). A decision on an approval card, a voice
    // turn, a document or a quick chip is never an answer. The server re-checks that the question is
    // still open and binds the answer to it once.
    const answer = opts?.answer
      ?? (overrideText === undefined && !voiceSink && !approvedFingerprints?.length && !declinedFingerprints?.length && !currentDoc && answeringAsk
        ? { askId: answeringAsk.askId, skipped: false }
        : undefined);
    // The card that asked settles into a record of the answer, in place. `rollback` keeps the live
    // card, so a decision that never leaves puts it back exactly as it was.
    //
    // C3a — NO LONGER SOLO-ONLY. The decision sentence below is now hidden in presentation on every
    // mount, and on the drawer mount the decided card used to simply vanish — hiding the bubble too
    // would have erased the only visible trace of the decision. So the drawer card settles into the
    // same record (§58: an addition there, not a removal). What a decision turn RUNS is unchanged:
    // `decisionTurn` / `approvalTurn` in streamTurn and the outcome stamp below stay Solo-gated.
    const decision = approvedFingerprints?.length ? "approved" as const : declinedFingerprints?.length ? "declined" as const : undefined;
    const decided = approvedFingerprints?.length ? approvedFingerprints : declinedFingerprints ?? [];
    // PR 2b — the approved card executes the STORED proposal. A CRM-door confirmation carries
    // its canonical command; the door claims the stored row atomically and executes the decided
    // args, so the model is never the source of execution arguments after approval. Executed
    // confirmations are stripped from the model turn's echo: there is nothing left to re-dispatch.
    const executedOutcomes: Array<{ fingerprint: string; summary: string; tool: string; outcome: "ran" | "not_run" | "unconfirmed"; note?: string; reproposed?: { fingerprint: string; summary: string } }> = [];
    let echoFingerprints = approvedFingerprints ? [...approvedFingerprints] : undefined;
    if (echoFingerprints?.length) {
      const actionable = new Map<string, { command: Record<string, unknown>; idempotency_key: string; summary: string; tool: string }>();
      for (const m of messages) {
        for (const c of m.confirm ?? []) {
          if (c.fingerprint && echoFingerprints.includes(c.fingerprint) && c.command && c.idempotency_key && !actionable.has(c.fingerprint)) {
            actionable.set(c.fingerprint, { command: c.command, idempotency_key: c.idempotency_key, summary: c.summary, tool: c.tool });
          }
        }
      }
      for (const [fingerprint, item] of actionable) {
        let body: Record<string, unknown> = {};
        let transportFailed = false;
        let errorPresent = false;
        try {
          const { data, error } = await supabase.functions.invoke("crm-command", {
            body: { command: item.command, idempotency_key: item.idempotency_key, approved_fingerprint: fingerprint },
          });
          if (data && typeof data === "object" && !Array.isArray(data)) body = data as Record<string, unknown>;
          if (error) {
            errorPresent = true;
            // An ANSWERED refusal or failure still carries the door's structured body on the
            // FunctionsHttpError context — the same source the chat handler parses. A body without
            // the door's own marker (a gateway or relay answer, or none at all) leaves the
            // command's outcome genuinely unconfirmed; the door marks possibly-committed answers
            // explicitly, and foreign answers never downgrade to did-not-run.
            const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
            if (ctx && typeof ctx.json === "function") {
              try {
                const parsed = await ctx.json();
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
              } catch { /* the answer itself failed to decode: treat as transport */ transportFailed = true; }
            } else {
              transportFailed = true;
            }
          }
        } catch {
          transportFailed = true;
        }
        // A spent or raced fingerprint makes the door mint a FRESH single-use proposal; carry it
        // so the card can re-render the new approval instead of dead-ending on the consumed one.
        const reproposed = body.outcome === "approval_required" && typeof body.fingerprint === "string" && body.fingerprint !== fingerprint
          ? { fingerprint: String(body.fingerprint), summary: typeof body.summary === "string" ? body.summary : item.summary }
          : undefined;
        // The shared answered/unanswered rule (approval-outcome.ts), client-side: an error whose
        // parsed body carries the door's own `ok` marker is an ANSWER (its outcome classes stand);
        // an error with a foreign body — a gateway or relay answer, or none at all — may hide a
        // committed command, so it reports as could-not-confirm, never as did-not-run.
        const doorAnswered = !transportFailed && body.ok !== undefined;
        const outcome = body.outcome === "succeeded" && !errorPresent && !transportFailed
          ? "ran"
          : body.outcome_unknown === true || transportFailed || (errorPresent && !doorAnswered)
          ? "unconfirmed"
          : "not_run";
        executedOutcomes.push({
          fingerprint, summary: item.summary, tool: item.tool, outcome,
          note: typeof body.message === "string" ? body.message.slice(0, 200) : undefined,
          ...(reproposed ? { reproposed } : {}),
        });
      }
      if (executedOutcomes.length) {
        const executed = new Set(executedOutcomes.map((o) => o.fingerprint));
        echoFingerprints = echoFingerprints.filter((f) => !executed.has(f));
        if (!echoFingerprints.length) echoFingerprints = undefined;
      }
    }

    // PACKAGE B — the approved PIPELINE card executes its stored proposal through the human
    // door. The general gate mints pipeline proposals into paige_pending_confirmations with the
    // model's exact arguments; on the approve click we read THAT row (never the model's re-
    // emission) and run it through configure_tenant_pipeline — the same executor the board
    // calls — under the clicking user's own session with _actor_kind "human", because the human
    // clicking Approve is the authority executing it. The stored idempotency key makes a double
    // click a replay (the door returns the cached result; the action runs once), and an expired
    // row refuses honestly. A typed "yes" never reaches this path: it reads only the approved
    // card fingerprints. The chat handler is untouched (Knowledge #1615 owns that seam).
    if (echoFingerprints?.length) {
      const pipelineItems: Array<{ fingerprint: string; summary: string; tool: string }> = [];
      for (const m of messages) {
        for (const c of m.confirm ?? []) {
          if (c.fingerprint && echoFingerprints.includes(c.fingerprint) && c.tool === "pipeline_configure" && !pipelineItems.some((x) => x.fingerprint === c.fingerprint)) {
            pipelineItems.push({ fingerprint: c.fingerprint, summary: c.summary, tool: c.tool });
          }
        }
      }
      for (const item of pipelineItems) {
        let ran: "ran" | "not_run" | "unconfirmed" = "unconfirmed";
        let note: string | undefined;
        try {
          // The stored proposal IS the authority: args, tenant and expiry come from the row the
          // server minted, scoped to this user by row-level security.
          // The general gate's cards carry a SCOPED token (fingerprint:requestNonce) while the
          // stored row's column is the bare 16-hex fingerprint — the server's own claim path
          // splits the same way. Look up by the bare form.
          // The table is internal to the approval machinery and absent from the generated
          // types, so the board's `as never` pattern types the whole chain off — the runtime
          // shape is pinned by the suite.
          const rowPromise = supabase
            .from("paige_pending_confirmations" as never)
            .select("args,tenant_id,expires_at,tool_name" as never)
            .eq("fingerprint" as never, item.fingerprint.split(":")[0] as never)
            .eq("tool_name" as never, "pipeline_configure" as never)
            .is("consumed_at" as never, null as never)
            .maybeSingle() as unknown as Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
          const { data: row, error: rowError } = await rowPromise;
          const stored = row && typeof row === "object" ? row as { args?: Record<string, unknown>; tenant_id?: string; expires_at?: string } : null;
          const argsObj = stored && typeof stored.args === "object" && stored.args !== null ? stored.args as Record<string, unknown> : null;
          const expired = !stored?.expires_at || new Date(String(stored.expires_at)).getTime() <= Date.now();
          if (rowError || !stored || !argsObj || typeof stored.tenant_id !== "string"
              || typeof argsObj.command !== "object" || typeof argsObj.idempotency_key !== "string") {
            ran = "not_run";
            note = "The stored approval could not be read. Ask Paige to propose the action again.";
          } else if (expired) {
            ran = "not_run";
            note = "That approval expired. Ask Paige to propose the action again.";
          } else {
            const { data, error } = await supabase.rpc("configure_tenant_pipeline" as never, {
              _tenant_id: stored.tenant_id,
              _command: argsObj.command,
              _idempotency_key: argsObj.idempotency_key,
              _actor_kind: "human",
            } as never);
            const body = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
            // supabase.rpc answers refusals as {error} with the message inline — an ANSWER, so
            // its outcome class stands; a transport failure stays could-not-confirm.
            if (error) {
              // A 4xx is the door ANSWERING (a governed refusal, rolled back); a 5xx or an
              // unclassed failure may hide a committed command behind a lost response — the
              // same answered-or-ambiguous rule the CRM lane applies, never a false did-not-run.
              const status = typeof (error as { status?: number }).status === "number" ? (error as { status?: number }).status : 0;
              if (status >= 400 && status < 500) {
                ran = "not_run";
                note = typeof error.message === "string" ? error.message.slice(0, 200) : undefined;
              } else {
                ran = "unconfirmed";
                note = typeof error.message === "string" ? error.message.slice(0, 200) : undefined;
              }
            } else if (body.ok === false) {
              ran = "not_run";
              note = typeof body.message === "string" ? body.message.slice(0, 200) : undefined;
            } else {
              ran = "ran";
            }
          }
        } catch {
          ran = "unconfirmed";
        }
        executedOutcomes.push({ fingerprint: item.fingerprint, summary: item.summary, tool: item.tool, outcome: ran, ...(note ? { note } : {}) });
      }
      if (executedOutcomes.length) {
        const executed = new Set(executedOutcomes.map((o) => o.fingerprint));
        echoFingerprints = echoFingerprints.filter((f) => !executed.has(f));
        if (!echoFingerprints.length) echoFingerprints = undefined;
      }
    }
    // The turn carries the card's verified result so the model narrates from the outcome, never
    // from an assumption that approval implies execution.
    if (executedOutcomes.length) {
      userContent += ` [Card result — ${executedOutcomes.map((o) => `${o.summary.split(".")[0]}: ${o.outcome === "ran" ? "ran" : o.outcome === "not_run" ? "didn't run" : "couldn't confirm"}`).join("; ")}]`;
    }
    let askedAt = -1;
    for (let i = messages.length - 1; decision && i >= 0 && askedAt < 0; i -= 1) {
      const m = messages[i];
      if (m.role === "assistant" && !m.confirmResolved
        && m.confirm?.some((c) => !!c.fingerprint && decided.includes(c.fingerprint))) askedAt = i;
    }
    const executedStamp = executedOutcomes.length ? {
      reported: true as const,
      actions: executedOutcomes.map((o) => ({ fingerprint: o.fingerprint, summary: o.summary, tool: o.tool, outcome: o.outcome, ...(o.note ? { note: o.note } : {}) })),
    } : undefined;
    const reproposedAny = executedOutcomes.some((o) => o.reproposed);
    const shown = askedAt >= 0 ? messages.map((m, i) => {
      if (i !== askedAt) return m;
      return {
        ...m,
        // A re-proposed confirmation replaces its consumed twin with the fresh fingerprint, and
        // the decision marker lifts so the live Approve renders for the NEW single-use proposal.
        ...(reproposedAny && m.confirm?.length ? {
          confirm: m.confirm.map((c) => {
            const o = executedOutcomes.find((x) => x.fingerprint === c.fingerprint);
            return o?.reproposed ? { ...c, fingerprint: o.reproposed.fingerprint, summary: o.reproposed.summary } : c;
          }),
        } : {}),
        confirmDecision: decision && !reproposedAny ? decision : undefined,
        ...(executedStamp && soloTenantSafety ? { approvalOutcome: executedStamp } : {}),
      };
    }) : messages;
    const base = [
      ...shown,
      mkMsg({
        role: "user",
        content: userContent,
        ...(currentDoc ? { documentFileName: currentDoc.name, documentKind: currentDoc.kind } : {}),
        // C3a — the card's own sentence: kept in `messages`, so the content the server receives, the
        // model's history and the saved thread are what they were before C3; the `decision` mark is
        // stripped at the POST and only decides where the transcript is drawn.
        ...(decision ? { decision } : {}),
        ...(answer ? { answer } : {}),
      }),
    ];
    if (askedAt >= 0 && (decision === "declined" || (decision && !soloTenantSafety))) decisionFocusRef.current = messages[askedAt].id;
    setMessages(base);
    if (currentDoc) setAttachedDoc(null);
    // Once the stored proposal has EXECUTED, the rollback snapshot is the post-decision state:
    // a later stream failure may not resurrect the live Approve button for an action that
    // already ran (a second click self-heals via idempotency readback, but the surface must
    // never falsely assert nothing happened).
    const effectiveRollback = executedOutcomes.length ? shown : rollback;
    await streamTurn(
      base,
      effectiveRollback,
      userContent,
      currentDoc,
      originDraft,
      echoFingerprints,
      declinedFingerprints,
      trackedVoiceSink,
      undefined,
      answer && opts?.answer ? { ...answer, card: true } : answer,
    );
    if (trackedVoiceSink && !voiceSettled) trackedVoiceSink.failed();
  };

  // Regenerate an assistant turn: re-run the nearest preceding user turn and REPLACE
  // the stale answer (truncate to that user turn, then stream a fresh one). Guarded
  // against in-flight + live voice. History mode is gated off at the call site (the
  // server is the single turn-writer; a retry would double-write) until the server
  // grows a regenerate flag — filed as a fast-follow.
  const handleRetry = (assistantId: string) => {
    if (!composerScope.writable || dictationActive) return;
    const aIdx = messages.findIndex((m) => m.id === assistantId);
    if (aIdx < 0) return;
    let uIdx = -1;
    for (let i = aIdx - 1; i >= 0; i--) {
      if (messages[i].role === "user") { uIdx = i; break; }
    }
    if (uIdx < 0) return; // nothing to regenerate (e.g. the opening greeting)
    const rollback = messages;
    const base = messages.slice(0, uIdx + 1);
    setMessages(base);
    void streamTurn(base, rollback, messages[uIdx].content, null, null);
  };

  const handleConnectionRetry = () => {
    const retry = retryTurnRef.current;
    if (
      !retry
      || retry.live
      || !retry.draftHandle
      || !composerScope.writable
      || !composerDraftHandlesMatch(retry.draftHandle, composerScope.writableHandle)
    ) return;
    void streamTurn(
      retry.base,
      retry.rollback,
      retry.userText,
      retry.doc,
      retry.draftHandle,
      undefined,
      undefined,
      undefined,
      retry.requestIntentId,
      retry.answer,
    );
  };

  const visibleChips = (chips ?? []).filter((c) => !c.visibleWhenFocused || !!clientId);

  // Slash-command palette (replaces the always-visible chips). The commands ARE the
  // quick-chips; the menu opens only while the value is a bare "/token" — anchoring
  // to ^/ means a mid-sentence "/" (e.g. "and/or") never triggers it and a trailing
  // space closes it, so the value is then sent literally.
  const slashMatch = /^\/(\S*)$/.exec(input);
  const slashQuery = slashMatch?.[1] ?? "";
  const filteredCommands = slashMatch
    ? visibleChips.filter((c) => c.label.toLowerCase().includes(slashQuery.toLowerCase()))
    : [];
  const slashOpen = !!slashMatch
    && filteredCommands.length > 0
    && composerScope.writable
    && !dictationActive;
  const pickCommand = (c: QuickChip) => {
    if (dictationActive || !composerScope.writable) return;
    setInput("");
    setSlashActive(0);
    handleChip(c);
  };

  // The user turn that produced the assistant message at `index` — stored as the
  // L2 eval-case input alongside the thumbs rating.
  const precedingUserText = (index: number): string | undefined => {
    for (let i = index - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i].content;
    return undefined;
  };

  // CD's trace label, computed from the REAL streamed steps — how many of her
  // departments actually worked this turn, never a written-in number (§13/§14).
  const visibleSteps = soloTenantSafety ? steps.filter((step) => step.kind !== "thought") : steps;
  const traceDepartments = new Set(visibleSteps.map((st) => st.group)).size;
  const traceLabel =
    visibleSteps.length === 0
      ? `${persona.name || "Paige"} is getting started`
      : traceDepartments > 0
        ? `${traceDepartments} ${traceDepartments === 1 ? "department" : "departments"} worked on this`
        : `${visibleSteps.length} ${visibleSteps.length === 1 ? "step" : "steps"} so far`;
  const composerBlocked = !composerScope.writable;
  const composerSendBlocked = composerBlocked || dictationActive;
  // ── C4c — PAIGE's open question (frames c2 / c3 / c5) ─────────────────────────────────────────
  // A question is OPEN while it is the last thing in the conversation and nothing is being read.
  // While it is open the composer answers it — it says so, and "Ask something else instead" turns
  // that off for this question (the message is then an ordinary one and the question stays
  // unanswered). The server, not this, decides what is open: it re-checks every answer.
  // A message carrying a file is never an answer (the server refuses one beside a document), so while
  // a file is attached the composer says it is sending a new message — never that it is answering.
  const lastMessage = messages[messages.length - 1];
  const openAsk = !isLoading && lastMessage?.role === "assistant" && lastMessage.ask ? lastMessage.ask : null;
  // An answer CLAIMED with nothing after it: the person's reply directly follows her question and is
  // the thread's newest turn, so nothing came back from PAIGE — the request may still be running, or it
  // died (a reload, or the "already has your answer" re-read, shows exactly this). The composer stays bound to
  // that question: a re-send names it, so the server can say it already has the answer while the claim is
  // young and ask the question again once it is not — never a second, unbound message that could start
  // the same work twice. The question's card stays frozen ("Answered below"); only the composer binds.
  const priorMessage = messages[messages.length - 2];
  const claimedAsk = !isLoading && !openAsk && lastMessage?.role === "user" && lastMessage.answer
    && priorMessage?.role === "assistant" && priorMessage.ask?.askId === lastMessage.answer.askId ? priorMessage.ask : null;
  const boundAsk = openAsk ?? claimedAsk;
  const askFileAttached = !!boundAsk && !!attachedDoc;
  const answeringAsk = boundAsk && askSetAside !== boundAsk.askId && composerScope.writable && !askFileAttached ? boundAsk : null;

  // The composer's pieces, built once and arranged by presentation. Both chromes
  // drive the SAME handlers — one engine, two frames (§18: no forked composer).
  const composerTextarea = (
    <Textarea
      ref={inputRef}
      value={input}
      rows={1}
      onChange={(e) => {
        setInput(e.target.value);
        setSlashActive(0);
        const el = e.target; el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      }}
      onKeyDown={(e) => {
        // IME composition: don't hijack Enter/nav while composing (N3).
        if (e.nativeEvent.isComposing) return;
        // Slash palette open → arrows/enter/escape drive the menu.
        if (slashOpen) {
          if (e.key === "ArrowDown") { e.preventDefault(); setSlashActive((a) => (a + 1) % filteredCommands.length); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); setSlashActive((a) => (a - 1 + filteredCommands.length) % filteredCommands.length); return; }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); pickCommand(filteredCommands[Math.min(slashActive, filteredCommands.length - 1)]); return; }
          if (e.key === "Escape") { e.preventDefault(); setInput(""); return; }
        }
        // Enter sends; Shift+Enter inserts a newline (so long messages wrap).
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
      }}
      placeholder={
        answeringAsk
          ? claimedAsk ? "Send your answer again…" : answeringAsk.options.length ? "Or type your own answer…" : "Type your answer…"
          : cd
          ? "Ask about the platform — the fleet, the rails, the machine"
          : soloTenantSafety
            ? "Talk while she works…"
          : `Message ${persona.name || "Paige"} — type / for commands`
      }
      className={cn(
        "min-w-0 max-h-40 resize-none",
        cd
          // Inside CD's frame the input carries no border of its own.
          ? "min-h-[2.25rem] min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-[13px] leading-[1.5] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          : soloTenantSafety
            ? "min-h-[3.25rem] w-full border-0 bg-transparent px-0 py-0 text-[13px] leading-[1.55] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            : "min-h-[2.5rem] flex-1",
      )}
      disabled={composerBlocked}
    />
  );

  /* Attach a document (#480) — ghost icon, never gold (Send owns the gold act, §11).
     Guarded while a reply is streaming. */
  const attachButton = (
    <Button
      onClick={openFilePicker}
      variant="ghost"
      size="icon"
      aria-label="Attach a document"
      disabled={composerBlocked}
      title="Attach a PDF, image, or Word document"
      className={cd ? "h-[27px] w-[27px] rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted" : undefined}
    >
      {cd ? <span aria-hidden className="text-[11.5px] leading-none">＋</span> : <Paperclip className="w-4 h-4" />}
    </Button>
  );

  /* Tap-to-dictate — neutral/indigo mic, never gold. Dictated words append into
     the composer; the operator edits before sending. The callback closes over the
     authenticated epoch so a late prior-account final cannot enter the new composer. */
  // Dictation adds the authenticated user and open thread to the turn scope. The
  // hook owns teardown for that full epoch; the callback also checks the accepted
  // tenant/client/mission scope and local generation before it may append.
  const micButton = (
    <DictationMicButton
      scopeEpoch={dictationDeliveryEpoch}
      composerRef={inputRef}
      showStatus={soloTenantSafety}
      onActiveChange={handleDictationActivity}
      onText={(seg, insertionPoint) => {
        if (acceptedEpochRef.current !== scopeEpoch) return;
        if (dictationGenerationRef.current !== dictationGeneration) return;
        const captured = composerScope.writableHandle;
        if (!captured || !acceptComposerDelivery(captured, composerScopeRef.current)) return;
        setInput((prev) => appendDictation(prev, seg, insertionPoint));
      }}
      onError={(msg) => {
        const captured = composerScope.writableHandle;
        if (!captured || !acceptComposerDelivery(captured, composerScopeRef.current)) return;
        toast({ title: "Voice typing", description: msg, variant: "destructive" });
      }}
      disabled={composerBlocked}
    />
  );

  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
  const liveConfirmation = lastAssistantMessage?.confirmResolved ? undefined : lastAssistantMessage?.confirm;
  const liveConfirmationFingerprints = (liveConfirmation ?? []).map((item) => item.fingerprint).filter((value): value is string => !!value);
  const latestArtifact = lastAssistantMessage?.artifacts?.at(-1);
  const activeLiveCard: LiveConversationCard | null = streamedLiveCard ?? (liveConfirmation?.length ? {
    id: `governed-${lastAssistantMessage?.id ?? "current"}`,
    kind: "governed-action",
    title: liveConfirmation.length > 1 ? `${liveConfirmation.length} actions need your confirmation` : "This action needs your confirmation",
    body: liveConfirmation.map((item) => item.summary).join("; "),
    source: { availability: "LIVE", provenanceLabel: "Paige authority review" },
    action: {
      toolName: liveConfirmation.map((item) => item.tool).join(", "),
      authorityStatus: "confirmation-required",
      scopeSummary: liveConfirmation.map((item) => item.summary).join("; "),
      confirmationFingerprints: liveConfirmationFingerprints,
    },
  } : latestArtifact ? {
    id: `result-${latestArtifact.id}`,
    kind: "evidence-result",
    title: latestArtifact.title || "Paige result",
    body: `A ${latestArtifact.artifactType} Paige created in this conversation is ready to review in chat.`,
    source: { availability: "PARTIAL", canonicalRef: latestArtifact.id, provenanceLabel: "Paige conversation artifact" },
    resultLabel: "Ready to review in this conversation",
  } : null);
  const displayedConfirmationFingerprints = activeLiveCard?.kind === "governed-action"
    && activeLiveCard.action.authorityStatus === "confirmation-required"
    && activeLiveCard.action.confirmationFingerprints?.length === liveConfirmationFingerprints.length
    && activeLiveCard.action.confirmationFingerprints.every((fingerprint, index) => fingerprint === liveConfirmationFingerprints[index])
    ? [...liveConfirmationFingerprints]
    : [];

  const ensureLiveThread = useCallback(async () => {
    if (activeThreadId) return activeThreadId;
    const originDraft = composerScope.visibleHandle;
    const originScope = requestScopeRef.current;
    const id = await threadsApi.ensureThread("Live Conversation");
    if (
      !originDraft
      || !composerDraftHandlesMatch(originDraft, originScope.handle)
      || originScope.epoch !== requestScopeRef.current.epoch
      || !composerDraftHandlesMatch(originScope.handle, requestScopeRef.current.handle)
    ) return id;
    if (originDraft.conversationId === conversationStateRef.current.newConversationId) {
      const threadDraft = { ...originDraft, conversationId: id };
      moveComposerDraft(originDraft, threadDraft);
    }
    hydratedFromRef.current = id;
    applyConversationEvent({ type: "lazy-thread-created", id });
    setActiveThreadId(id);
    return id;
  }, [activeThreadId, applyConversationEvent, composerScope.visibleHandle, setActiveThreadId, threadsApi]);

  const liveConversationButton = soloTenantSafety && enableHistory && liveConversation ? (
    <PaigeLiveConversation
      disabled={composerBlocked || dictationActive}
      contextEpoch={scopeEpoch}
      threadId={activeThreadId}
      ensureThread={ensureLiveThread}
      transcript={messages.map(({ id, role, content }) => ({ id, role, content }))}
      activeCard={activeLiveCard}
      working={isLoading}
      workingLabel={steps.at(-1)?.label ?? (writingPhase ? "Preparing your response" : null)}
      confirmationFingerprints={displayedConfirmationFingerprints}
      onAnswer={(answer) => void handleSend(answer)}
      onApprove={(fingerprints) => void handleSend(DECISION_REPLY.approved, fingerprints)}
      onDecline={(fingerprints) => void handleSend(DECISION_REPLY.declined, undefined, fingerprints)}
      onVoiceTurn={(text, sink) => handleSend(text, undefined, undefined, sink)}
      onVoiceInterrupt={() => cancelSoloRequest({ fromVoice: true })}
    />
  ) : null;

  const clearComposerButton = soloTenantSafety && input ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Clear unsent message"
      title="Clear the unsent message"
      className={cd ? "h-[27px] w-[27px] flex-none rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted" : "flex-none"}
      disabled={!composerScope.writable}
      onClick={() => {
        if (!composerScope.writable) return;
        dictationGenerationRef.current += 1;
        setDictationGeneration(dictationGenerationRef.current);
        setInput("");
        setAttachedDoc(null);
        requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      }}
    >
      <X className="h-4 w-4" aria-hidden />
    </Button>
  ) : null;

  // ── C3a — the living status on each PAIGE answer ─────────────────────────────────────────────
  // The approval card for this answer is live: on screen and undecided. The SAME condition that
  // draws the decide card below, so the line can never wait on a card that is not there.
  const confirmCardLive = (message: Message, index: number) =>
    !!message.confirm?.length && !message.confirmResolved && !message.confirmDecision
    && (index === messages.length - 1 || (message.approvalOutcome?.reported === true && message.confirm.some((c) => !!c.fingerprint && !(message.approvalOutcome?.actions ?? []).some((a) => a.fingerprint === c.fingerprint))));
  /** C4c — where the question an answer ended on stands: open while nothing has been said since; then
   *  answered (the next thing the person said was sent AS its answer — or a skip) or not answered. */
  const askStandingAt = (index: number): AskStanding | undefined => {
    const m = messages[index];
    if (m?.role !== "assistant" || !m.ask) return undefined;
    const reply = messages.slice(index + 1).find((x) => x.role === "user");
    if (!reply) return "open";
    return reply.answer?.askId === m.ask.askId ? "answered" : "unanswered";
  };
  const assistantIsEmpty = (m: Message) =>
    !m.content.trim() && !m.approvalOutcome && !m.queued?.length && !m.crmResults?.length && !m.research?.length
    && !m.confirm?.length && !m.artifacts?.length && !m.extractionProposal;
  const liveInputFor = (lt: LiveTurn, hasContent: boolean, awaitingApproval: boolean) => ({
    frame: lt.frame, rows: lt.rows, streaming: lt.streaming, writing: lt.writing, gateOpen: lt.gateOpen,
    startedAt: lt.startedAt, endCause: lt.endCause, elapsedMs: lt.elapsedMs, hasContent, awaitingApproval,
    personaName: persona.name, resumed: lt.resumed, ask: askStandingAt(messages.findIndex((m) => m.id === lt.assistantId)),
  });
  // ── C4a — ONE ANSWER, ONE LINE (prototype frames a3/a4) ─────────────────────────────────────
  // When the server carries an approval forward (`resumed`, live or saved), the answer that showed the
  // card and the answer that ran it are one piece of work, and the runtime now says so. They are drawn
  // as one: a single line at the top of the answer that asked — it restarts on the same line ("Sending
  // to Daniel"), then reads "What PAIGE did" over the steps before AND after the card — and no seam
  // between the two bubbles. Only when the server said `resumed`; any other decision follow-up keeps
  // C3's closer-gap presentation, unchanged.
  const isResumedAnswer = (m: Message | undefined): boolean => !!m && m.role === "assistant"
    && ((liveTurn?.assistantId === m.id && liveTurn.resumed) || m.turnSnapshot?.resumed === true);
  /** For a resumed answer at `index`: the index of the answer it continues, or -1. */
  const resumesFrom = (index: number): number => {
    if (index < 2 || !isResumedAnswer(messages[index])) return -1;
    const decision = messages[index - 1];
    const asked = messages[index - 2];
    return decision?.role === "user" && decision.decision === "approved" && asked?.role === "assistant" ? index - 2 : -1;
  };
  /** For the answer that asked: the index of the resumed answer that continues it, or -1. */
  const resumedAt = (index: number): number => (index + 2 < messages.length && resumesFrom(index + 2) === index ? index + 2 : -1);
  // A resumed answer can itself propose and be approved again, so the work forms a CHAIN: the answer
  // that first asked (the head), every answer that carried an approval forward, and the last one (the
  // tail). The whole chain is one answer — one line at the head over every step, one footer under the
  // tail — never a line that covers only the first two.
  const chainHead = (index: number): number => {
    let i = index;
    for (let from = resumesFrom(i); from >= 0; from = resumesFrom(i)) i = from;
    return i;
  };
  const chainTail = (index: number): number => {
    let i = index;
    for (let next = resumedAt(i); next >= 0; next = resumedAt(i)) i = next;
    return i;
  };
  /** Steps and time of every answer in the chain before the tail, in order. */
  const chainPrior = (head: number, tail: number): { rows: TurnRow[]; elapsedMs: number | null } => {
    let rows: TurnRow[] = [];
    let elapsedMs: number | null = 0;
    for (let i = head; i < tail; i += 2) {
      const snap = messages[i].turnSnapshot;
      rows = i === head ? [...(snap?.rows ?? [])] : mergeResumedRows(rows, snap?.rows ?? []);
      elapsedMs = elapsedMs !== null && typeof snap?.elapsedMs === "number" ? elapsedMs + snap.elapsedMs : null;
    }
    return { rows, elapsedMs };
  };
  const addElapsed = (prior: number | null, own: number | null | undefined): number | null =>
    prior !== null && typeof own === "number" ? prior + own : null;
  /** The chain's line, over every answer's steps and the time all of them took. */
  const resumedViewFor = (head: number, tail: number): TurnView | null => {
    const resumed = messages[tail];
    const prior = chainPrior(head, tail);
    const awaitingApproval = confirmCardLive(resumed, tail);
    if (liveTurn && liveTurn.assistantId === resumed.id) {
      const input = liveInputFor(liveTurn, resumed.content.trim() !== "", awaitingApproval);
      return deriveLiveTurnView({ ...input, rows: mergeResumedRows(prior.rows, liveTurn.rows), elapsedMs: addElapsed(prior.elapsedMs, input.elapsedMs), now: Date.now() });
    }
    return resumed.turnSnapshot
      ? deriveSnapshotView({ ...resumed.turnSnapshot, rows: mergeResumedRows(prior.rows, resumed.turnSnapshot.rows), elapsedMs: addElapsed(prior.elapsedMs, resumed.turnSnapshot.elapsedMs) }, { personaName: persona.name, awaitingApproval })
      : null;
  };
  const turnViewFor = (message: Message, index: number): TurnView | null => {
    if (message.role !== "assistant") return null;
    if (resumesFrom(index) >= 0 || resumedAt(index) >= 0) return resumedViewFor(chainHead(index), chainTail(index));
    const awaitingApproval = confirmCardLive(message, index);
    if (liveTurn && liveTurn.assistantId === message.id) {
      return deriveLiveTurnView({ ...liveInputFor(liveTurn, message.content.trim() !== "", awaitingApproval), now: Date.now() });
    }
    return message.turnSnapshot ? deriveSnapshotView(message.turnSnapshot, { personaName: persona.name, awaitingApproval, ask: askStandingAt(index) }) : null;
  };
  // "Ask again" puts the original request back in the composer and never sends it: a request that
  // already did things (wrote to the CRM, for one) would be repeated if it were re-sent by itself.
  const askAgainFor = (original: string | undefined) => {
    if (!original || isDecisionReplyText(original) || !composerScope.writable) return undefined;
    return () => {
      setInput((current) => !current.trim() ? original : current.includes(original) ? current : mergeIntoDraft(current, original));
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    };
  };
  const openTurnTrace = (id: string, open: boolean) => setTurnTraceOpen((m) => ({ ...m, [id]: open }));
  // Opening "What PAIGE did" is the person's own move: the transcript stops following the bottom
  // and holds that answer where it is, so the line they pressed stays in view while the list grows
  // beneath it (the drawer is short; pinned-to-bottom used to push the line out of sight).
  const holdTurnLine = (line: HTMLElement) => transcriptScrollRef.current?.holdMessageAt(line);
  const renderTurnLine = (message: Message, index: number, view: TurnView | null) => {
    if (!view) return null;
    // C4a — the resumed answer's line is drawn once, at the top of the answer that asked (a3/a4).
    if (resumesFrom(index) >= 0) return null;
    if (resumedAt(index) >= 0) {
      const resumedIndex = chainTail(index);
      const resumed = messages[resumedIndex];
      const lineProps = {
        idBase: `turn-${message.id}`,
        open: turnTraceOpen[message.id] ?? false,
        onOpenChange: (open: boolean) => openTurnTrace(message.id, open),
        onTraceToggle: holdTurnLine,
        personaName: persona.name,
      };
      if (liveTurn && liveTurn.assistantId === resumed.id) {
        const awaiting = confirmCardLive(resumed, resumedIndex);
        // One voice per state, as on every other answer: where the report card speaks for the
        // approval (Solo), the line stays quiet; where there is none (the drawer), the line says
        // "Approved. PAIGE is working" (frame a3).
        const prior = chainPrior(index, resumedIndex);
        const own = liveInputFor(liveTurn, resumed.content.trim() !== "", awaiting);
        const input = { ...own, rows: mergeResumedRows(prior.rows, liveTurn.rows), elapsedMs: addElapsed(prior.elapsedMs, own.elapsedMs) };
        return <PaigeLiveTurnStatus input={input} announce={!awaiting && !resumed.approvalOutcome} {...lineProps} />;
      }
      return <PaigeTurnStatus view={view} {...lineProps} />;
    }
    const common = {
      idBase: `turn-${message.id}`,
      open: turnTraceOpen[message.id] ?? false,
      onOpenChange: (open: boolean) => openTurnTrace(message.id, open),
      onTraceToggle: holdTurnLine,
      personaName: persona.name,
    };
    if (liveTurn && liveTurn.assistantId === message.id) {
      const awaiting = confirmCardLive(message, index);
      // One voice per state. The approval card announces "Needs your OK" itself and the report card
      // announces its own outcome, so the line stays quiet when either is speaking for the answer.
      const speaks = !awaiting && !message.approvalOutcome;
      return <PaigeLiveTurnStatus input={liveInputFor(liveTurn, message.content.trim() !== "", awaiting)} announce={speaks} {...common} />;
    }
    return <PaigeTurnStatus view={view} {...common} />;
  };
  // After Stop the existing rollback leaves the request in the composer. When it is there, the
  // footer says so and offers no "Ask again" — that button would do nothing new. When it is not
  // (a decision turn, which is never rolled back), "Ask again" puts it back.
  const footerFor = (footer: NonNullable<TurnView["footer"]>, kind: TurnView["kind"], original: string | undefined) => {
    const inComposer = kind === "stop" && !!original?.trim() && input.includes(original.trim());
    if (!inComposer) return footer;
    return {
      text: `${footer.text} Your question is back in the message box.`,
      actions: footer.actions.filter((a) => a !== "askAgain"),
    };
  };
  const renderTurnFooter = (message: Message, index: number, view: TurnView | null) => {
    if (!view?.footer) return null;
    // C4a — the combined answer's footer closes the combined answer, under the resumed one; its "Ask
    // again" is the person's own request, never the card's decision sentence.
    if (resumedAt(index) >= 0) return null;
    const live = liveTurn?.assistantId === message.id;
    const original = resumesFrom(index) >= 0 ? precedingUserText(chainHead(index)) : live ? liveTurn?.userText : precedingUserText(index);
    return (
      <PaigeTurnFooter
        footer={footerFor(view.footer, view.kind, original)}
        onAskAgain={askAgainFor(original)}
        onSee={() => openTurnTrace(messages[resumesFrom(index) >= 0 ? chainHead(index) : index].id, true)}
        focusOnMount={live && liveTurn?.endCause === "cancelled" && liveTurn.stopFocus}
        quietAskAgain={view.kind === "stop"}
        disabled={composerSendBlocked}
      />
    );
  };
  // Before the response arrives — and after a Stop or the six-minute window took the answer off the
  // transcript — the live turn has no message to sit in. It is drawn in the same bubble, in place.
  const orphanTurn = liveTurn && !messages.some((m) => m.id === liveTurn.assistantId)
    && (liveTurn.streaming || liveTurn.endCause === "cancelled" || liveTurn.endCause === "timeout")
    ? liveTurn : null;
  const orphanView = orphanTurn ? deriveLiveTurnView({ ...liveInputFor(orphanTurn, false, false), now: Date.now() }) : null;

  // Built once and reused by BOTH the rail and the header — so a caller's header
  // that draws its own "new thread" button (CD's pack does) and a caller's rail
  // are always looking at the identical live state, never two copies that could
  // drift (§18: one object, two render sites).
  const railApi: ChatRailApi = {
    threads: threadsApi.threads,
    isLoading: threadsApi.isLoading,
    activeThreadId,
    streamingThreadId,
    onSelect: (id) => void selectThread(id),
    onNewChat: startNewChat,
    onRename: threadsApi.renameThread,
    onArchive: threadsApi.archiveThread,
    onDelete: (id) => {
      if (id === activeThreadId) startNewChat();
      void threadsApi.deleteThread(id);
    },
    mobileOpen: mobileRailOpen,
    onMobileOpenChange: setMobileRailOpen,
  };

  return (
    <div data-solo-chat-engine={soloTenantSafety ? "true" : undefined} className={fill ? "w-full h-full" : `max-w-4xl mx-auto w-full ${hideHeader ? "h-full" : "h-[calc(100vh-4rem)]"}`}>
      <div className={enableHistory ? (cd ? "flex h-full min-h-0 gap-3.5" : "flex h-full min-h-0 gap-4 px-3 pt-3 md:px-4") : "flex flex-col h-full"}>
        {/* History rail. The caller may draw its own (the operator console draws
            Claude Design's) — it gets the SAME live threads and the SAME handlers,
            so rename/archive/delete/select/new-chat all keep working (§58). */}
        {enableHistory &&
          (renderRail
            ? renderRail(railApi)
            : (
              <ThreadRail
                threads={railApi.threads}
                isLoading={railApi.isLoading}
                activeThreadId={railApi.activeThreadId}
                streamingThreadId={railApi.streamingThreadId}
                onSelect={railApi.onSelect}
                onNewChat={railApi.onNewChat}
                onRename={railApi.onRename}
                onArchive={railApi.onArchive}
                onDelete={railApi.onDelete}
                mobileOpen={railApi.mobileOpen}
                onMobileOpenChange={railApi.onMobileOpenChange}
              />
            ))}
        <div
          className={enableHistory ? "flex flex-col h-full min-w-0 flex-1" : "contents"}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
        {!hideHeader && (
          <div className="mb-6">
            <h2 className="text-3xl font-bold text-foreground">
              Chat with {persona.name || "Paige"}
            </h2>
            <p className="text-muted-foreground mt-2">
              Talk to her about your work — she's here to help.
            </p>
          </div>
        )}

        {enableHistory && (
          <div data-solo-mobile-history={soloTenantSafety ? "true" : undefined} className={cn("mb-3 flex items-center gap-2", cd ? "lg:hidden" : "md:hidden")}>
            <Button variant="outline" size="sm" onClick={() => setMobileRailOpen(true)}>
              <PanelLeft className="mr-2 h-4 w-4" /> Chats
            </Button>
            <Button variant="gold" size="sm" onClick={startNewChat}>
              New chat
            </Button>
          </div>
        )}

        <Card
          className={cn(
            "relative flex-1 min-h-0 flex flex-col bg-card border-border overflow-hidden",
            // CD's conversation card: 14px radius, hairline border, no drop shadow —
            // depth comes from the elevation stack around it, not a shadow (§22).
            cd ? "rounded-[14px] shadow-none" : "shadow-card",
          )}
        >
          {/* Drop target overlay (#480) — tokened, theme-aware, motion-safe. Solid indigo frame
              (no dashed "upload-widget" tell, §25); gold stays reserved for the send act (§11/§23).
              Drag handlers live on the wrapper above so a drop on the header can't escape to the
              browser (they catch child drops via bubbling). */}
          {isDragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none animate-in fade-in duration-150 motion-reduce:animate-none">
              <div className="rounded-xl border-2 border-primary bg-card px-6 py-4 text-center shadow-lg">
                <p className="text-sm font-medium text-primary">Drop file here</p>
                <p className="mt-0.5 text-xs text-muted-foreground">PDF, image, or Word document · up to 10MB</p>
              </div>
            </div>
          )}
          {typeof conversationHeader === "function" ? conversationHeader(railApi) : conversationHeader}
          {focusBanner}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              id={soloTenantSafety ? "solo-paige-transcript" : undefined}
              ref={setTranscriptElement}
              data-paige-transcript-scroll="true"
              aria-label="PAIGE conversation"
              tabIndex={0}
              onScroll={syncTranscriptPosition}
              className={cn(
                // overflow-x-hidden is DEFENCE-IN-DEPTH, not a cover-up: the real cause (a flex
                // message bubble missing min-w-0, plus unwrapped user text) is fixed below, so
                // content wraps and nothing is clipped. Without this, `overflow-y-auto` makes the
                // browser compute overflow-x:auto too, rendering the reported horizontal scrollbar
                // right above the composer the instant any child exceeds the width. Genuinely wide
                // children (entity diagrams) self-scroll in their own overflow-x-auto container, so
                // they stay reachable (§ paige-ui: never hide content with clipping).
                "flex-1 min-h-0 overflow-y-auto overflow-x-hidden",
                cd ? "px-4 py-3.5 space-y-4" : "p-6 space-y-4",
              )}
            >
            {messages.map((message, index) => {
              // C3a — the approval card's own sentence is not drawn (owner ruling 2026-10-05: no
              // visible "Approved — run it." bubble). It stays in `messages`, in every POST and in the
              // saved thread; only this drawing skips it.
              if (message.role === "user" && message.decision) return null;
              // C4c — "Skip, use your best guess" is said by the question's own record ("You let PAIGE
              // choose"), not by a bubble of words the person did not type (c6). It stays in `messages`.
              if (message.role === "user" && message.answer?.skipped) return null;
              const turnView = turnViewFor(message, index);
              // An answer with nothing to show yet (the first 400 ms) draws no empty bubble.
              if (message.role === "assistant" && !turnView && assistantIsEmpty(message)) return null;
              // The answer that follows a decision reads as part of the same piece of work — a closer
              // gap, nothing more. It keeps its own line and its own steps: the server still runs it
              // as a new request, and nothing here says otherwise (server-carried resume is C4).
              const continues = message.role === "assistant" && index > 0
                && messages[index - 1]?.role === "user" && !!messages[index - 1]?.decision;
              // C4a — when the server carried the approval forward, the two answers are ONE answer:
              // no gap, and (in bubble mode) one bubble, the seam closed on both sides.
              const resumedHere = resumesFrom(index) >= 0;
              const continuedBelow = resumedAt(index) >= 0;
              return (
              <div
                key={message.id}
                data-paige-message-id={message.id}
                data-paige-message-anchor-key={messageScrollAnchorKey(message.role, message.content)}
                data-paige-continues={resumedHere ? "resumed" : continues ? "approval" : undefined}
                className={cn(
                  "flex min-w-0",
                  message.role === "user" ? "flex-row-reverse" : "w-full flex-row",
                  continues && "!mt-2",
                  resumedHere && "!mt-0",
                )}
              >
                <div
                  className={cn(
                    "group relative",
                    // CD's operator thread: the operator's own turn is the warm
                    // right-aligned bubble (cream ground, hairline border, one square
                    // corner); Paige's answer carries NO card or portrait — her name
                    // and words use the full message width without an avatar gutter.
                    cd
                      ? message.role === "user"
                        ? "max-w-[76%] min-w-0 rounded-[14px_14px_4px_14px] border border-border bg-muted px-[13px] py-2.5 text-[13.5px] leading-[1.6]"
                        : "min-w-0 flex-1 text-[13.5px] leading-[1.66]"
                      : cn(
                          // min-w-0 is the ROOT-CAUSE fix: this bubble is the sole flex item of the
                          // row above, and a flex item defaults to min-width:auto, which refuses to
                          // shrink below its content's min-content width — so a wide child (a long
                          // token, a code block, a diagram) pushed the whole transcript wider than
                          // the panel and produced the horizontal scrollbar. The operator (`cd`)
                          // branch already carried min-w-0; the app branch every live mount uses did
                          // not. max-w-full keeps the bubble within the wrapped column.
                          "max-w-[80%] min-w-0 rounded-lg p-4",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/30 border border-border",
                          // C3a — an answer carrying a status line or an approval card takes the
                          // column (still capped at 80%), so the line and the card are not squeezed
                          // into a bubble shrunk to its first sentence.
                          message.role === "assistant" && (turnView || (!!message.confirm?.length && !message.confirmResolved)) && "w-full",
                          // INT-328 — on a phone, an answer carrying an email to approve takes the whole
                          // column: at 80% the email wrapped at ~20 characters a line.
                          message.role === "assistant" && !message.confirmResolved && message.confirm?.some((c) => !!c.preview) && "max-[479px]:max-w-full max-[479px]:p-3",
                          // C4a — one bubble across the resumed seam (and both halves take the column).
                          continuedBelow && "w-full rounded-b-none border-b-0 pb-2",
                          resumedHere && "w-full rounded-t-none border-t-0 pt-2",
                        ),
                  )}
                >
                  {message.role === "assistant" ? (() => {
                    const { before, diagram, after } = extractEntityDiagram(message.content);
                    return (
                      <>
                        {/* C3a — the status line leads the answer: what PAIGE is doing, is waiting
                            on, or did. Then the approval report, then her words (Q1: one order,
                            live and on reload, so a saved answer never rearranges itself). */}
                        {renderTurnLine(message, index, turnView)}
                        {/* The approval this turn ran, answered for first: Running… while it runs,
                            then what became of each action. Paige's words follow it. */}
                        {message.approvalOutcome && (() => {
                          const outcome = message.approvalOutcome;
                          const view = outcomeCardView(outcome, isLoading && index === messages.length - 1);
                          const cardHere = !!message.confirm?.length && !message.confirmResolved;
                          const again = index === messages.length - 1 && !isLoading && !cardHere ? askAgainRequest(outcome) : null;
                          const links = checkLinks(outcome, view, activeTenant?.account_number);
                          return (
                            <PaigeConfirmCard
                              mode="report"
                              className={cn("mt-0", (message.content || message.crmResults?.length) && "mb-3")}
                              actions={view.actions}
                              note={view.note}
                              focusOnMount
                              recovery={again ? { onPress: () => void handleSend(again), disabled: composerSendBlocked } : undefined}
                              check={links.length ? <ApprovalCheckLinks links={links} /> : undefined}
                            />
                          );
                        })()}
                        {before && <MarkdownMessage content={before} />}
                        {diagram && <EntityDiagramCard data={diagram} />}
                        {after && <MarkdownMessage content={after} />}
                        {/* C4c — the question's choices while it is open (c2), then its record in place:
                            answered below, PAIGE chose, or not answered (c3 / c6 / c5). */}
                        {message.ask && (() => {
                          const ask = message.ask;
                          const standing = askStandingAt(index);
                          if (standing === "open") {
                            return (
                              <PaigeAskCard
                                options={ask.options}
                                multi={ask.multi}
                                question={ask.question ?? message.content}
                                disabled={composerSendBlocked || isLoading}
                                focusOnMount={soloTenantSafety}
                                onAnswer={(reply) => void handleSend(reply, undefined, undefined, undefined, { answer: { askId: ask.askId, skipped: false } })}
                                onSkip={() => void handleSend(ASK_SKIP_REPLY, undefined, undefined, undefined, { answer: { askId: ask.askId, skipped: true } })}
                              />
                            );
                          }
                          const reply = messages.slice(index + 1).find((x) => x.role === "user");
                          return <PaigeAskRecord name={persona.name || "PAIGE"} standing={standing === "answered" ? (reply?.answer?.skipped ? "skipped" : "answered") : "unanswered"} />;
                        })()}
                        {message.queued?.map((q) => (
                          <div key={q.id} className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5">
                            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium leading-snug">{q.summary}</p>
                              <p className="text-xs text-muted-foreground">{soloTenantSafety ? "PAIGE queued this approval. This conversation remains the canonical record; nothing proceeds until the existing approval flow confirms it." : "Paige queued this — it's waiting on you. Approve it in your Live desk and it goes out."}</p>
                            </div>
                          </div>
                        ))}
                        {!!message.crmResults?.length && (
                          <div className="flex flex-col gap-2">
                            {message.crmResults.map((result, resultIndex) => (
                              <PaigeCrmResultCard key={`${result.action}:${String(result.record_locator?.record_id || resultIndex)}`} result={result} />
                            ))}
                          </div>
                        )}
                        {/* R2b — inline deep research: the evidence card rides the SAME
                            assistant turn (one Paige turn, ruling §7); citation [n] markers
                            are the engine's canonical indices (§11). */}
                        {!!message.research?.length && (
                          <div className="flex flex-col gap-2">
                            {message.research.map((r, i) => (
                              <PaigeResearchCard key={r.run_id ?? `research-${i}`} result={r} />
                            ))}
                          </div>
                        )}
                        {/* C2 — the card renders MID-STREAM: removing the !isLoading gate means
                            the card appears the instant the server mints it, not after [DONE].
                            With C1's continuation loop keeping the stream alive through the
                            task, the old gate hid cards for the entire multi-round duration.
                            Clicking Approve mid-stream supersedes the model's turn (the
                            approval click aborts the current stream and dispatches directly). */}
                        {confirmCardLive(message, index) && (
                          <div ref={observeLiveApproval} data-paige-live-decide>
                          <PaigeConfirmCard
                            // Summary and fingerprint stay PAIRED. The previous version built two
                            // parallel arrays and `.filter()`ed the fingerprints, so one action
                            // missing a fingerprint shifted every later summary onto the wrong
                            // call — an approval spendable on a neighbouring action. Pairing them
                            // in one object makes that misalignment unrepresentable.
                            actions={message.confirm.map((c) => ({
                              summary: c.summary,
                              fingerprint: c.fingerprint,
                              // INT-328 — the email itself, when the call sends one.
                              ...(c.preview ? { preview: c.preview } : {}),
                            }))}
                            disabled={composerSendBlocked}
                            // Solo: after "Ask Paige again" the button that was pressed is gone, so
                            // the fresh card takes focus — but only when nothing else holds it.
                            focusOnMount={soloTenantSafety}
                            onApprove={(fps) => void handleSend(DECISION_REPLY.approved, fps)}
                            // Declining CANCELS the stored proposal, rather than only saying so in
                            // prose the model interprets. Without this the row stays live for its
                            // full window, and a later turn could still act on something the
                            // person had already said no to.
                            onDeny={(fps) => void handleSend(DECISION_REPLY.declined, undefined, fps)}
                          />
                          </div>
                        )}
                        {/* Solo: decided in this session. The card is now a record of the answer. */}
                        {!!message.confirm?.length && !message.confirmResolved && message.confirmDecision && (
                          // Focusable (never in the Tab order): it receives focus when the decided
                          // card's button disappears, so a keyboard user keeps their place.
                          <div tabIndex={-1} data-paige-decided-record className="w-fit max-w-full rounded-md outline-offset-2">
                            <PaigeConfirmRecord
                              decision={message.confirmDecision}
                              count={message.confirm.filter((c) => !!c.fingerprint).length || message.confirm.length}
                            />
                            {/* C3a — the hidden decision sentence carried the client's own verified
                                result. Where no report card answers for it (the drawer), it is
                                drawn here, so hiding the bubble never hides whether it ran. */}
                            {(() => {
                              const next = messages[index + 1];
                              const result = !message.approvalOutcome && next?.role === "user" && next.decision
                                ? decisionCardResult(next.content) : null;
                              return result ? (
                                <p className="mt-1.5 text-xs text-muted-foreground" data-paige-card-result>Result: {result}</p>
                              ) : null;
                            })()}
                          </div>
                        )}
                        {/* Reloaded from history: the confirm moment already passed —
                            show it settled, never a live Approve button (§15). */}
                        {!!message.confirm?.length && message.confirmResolved && (
                          <div className="mt-2 rounded-md border border-border bg-muted/30 p-2.5">
                            <p className="text-xs text-muted-foreground">
                              Earlier, Paige asked you to confirm: {message.confirm.map((c) => c.summary).join("; ")}
                              {/* C3a — what the person said, from the saved turn after it. Never
                                  a claim about whether it ran. */}
                              {message.confirmReceipt && (
                                <>
                                  {" · "}You {message.confirmReceipt.decision === "approved" ? "approved" : "skipped"}
                                  {message.confirmReceipt.ts !== null && <> · {new Date(message.confirmReceipt.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</>}
                                </>
                              )}
                            </p>
                            {/* The client's own verified result, saved in that turn — the only
                                statement about whether it ran, and only when one was recorded. */}
                            {message.confirmReceipt?.result && (
                              <p className="mt-1 text-xs text-muted-foreground" data-paige-card-result>Result: {message.confirmReceipt.result}</p>
                            )}
                          </div>
                        )}
                        {/* #29 — inline handoff cards for the deliverables Paige produced this turn. Open
                            renders the real artifact; Send prefills the composer so Paige drives the send
                            through her own tools (§10/§16 — never a dead-end send button). Gold is spent
                            only on that Send inside the card. Needs a resolved tenant for the RLS hydrate. */}
                        {!!message.artifacts?.length && activeTenantId && (
                          <div className="mt-2 flex flex-col gap-2">
                            {message.artifacts.map((a) => (
                              <PaigeArtifactCard
                                key={a.id}
                                artifact={a}
                                tenantId={a.tenantId ?? activeTenantId}
                                onSend={composerScope.writable ? () => {
                                  setInput(`Send "${a.title}" to `);
                                  requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
                                } : undefined}
                              />
                            ))}
                          </div>
                        )}
                        {/* A document Paige read produced fields she is PROPOSING. Nothing has been
                            written yet; this card is where a person decides what gets recorded. The
                            same component the client portal already ships — this is a port, not a
                            new interaction (§00: CD owns how it looks, and it already ruled on
                            this one). Live-turn only: a rehydrated turn must never re-offer a
                            proposal that has already been applied or declined server-side. */}
                        {message.extractionProposal && (
                          <div className="mt-2">
                            <ExtractionProposalCard
                              proposal={message.extractionProposal}
                              onConfirm={(selectedKeys) => applyExtraction(message.extractionProposal!, selectedKeys)}
                              onSkip={() => void applyExtraction(message.extractionProposal!, [])}
                            />
                          </div>
                        )}
                        {/* C3a — what is true now, and the one way forward that exists. */}
                        {renderTurnFooter(message, index, turnView)}
                      </>
                    );
                  })() : (
                    <>
                      {message.documentFileName && (
                        <DocumentMessageBubble fileName={message.documentFileName} kind={message.documentKind} />
                      )}
                      {/* whitespace-pre-wrap preserves the user's own line breaks; break-words wraps
                          a long unbroken token (a URL, path, or id) instead of forcing the bubble —
                          and thus the transcript — wider than the panel (overflow cause #3). */}
                      {message.content && <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>}
                    </>
                  )}
                  {/* Hover-revealed meta: timestamp + copy (both roles), regenerate
                      (assistant only, non-history), and the thumbs feedback slot. */}
                  {message.content && (
                    <MessageMeta
                      role={message.role}
                      content={message.content}
                      ts={message.ts}
                      onRetry={
                        message.role === "assistant" && !enableHistory && index === messages.length - 1 && !isLoading && !dictationActive
                          ? () => handleRetry(message.id)
                          : undefined
                      }
                      audioSlot={
                        message.role === "assistant"
                          ? <MessageAudioButton messageId={message.id} content={message.content} />
                          : undefined
                      }
                      feedback={
                        message.role === "assistant" && showFeedback
                          ? (
                            <ResponseFeedback
                              messageContent={message.content}
                              messageId={message.id}
                              userPrompt={precedingUserText(index)}
                              sessionId={sessionId}
                            />
                          )
                          : undefined
                      }
                    />
                  )}
                </div>
              </div>
              );
            })}

            {/* #11/#12 — live thinking timer + conversation-compacting card. It aligns
                directly with PAIGE's messages; no portrait gutter is reserved. The card
                renders only when the server streams a compacting frame, so this surface
                persists threads and can genuinely fold (§13). */}
            {/* C3a — the live answer before it has a message to sit in (the request is in flight),
                or after Stop / the six-minute window took it off the transcript. Same bubble, same
                line; replaces the "Thinking…" pill and the old cancel notice, whose truth now lives
                in the Stop footer. Thoughts are never drawn (owner proof 9). */}
            {orphanTurn && orphanView && (
              <div className="flex w-full min-w-0 flex-row" data-paige-pending-turn>
                <div className={cd ? "min-w-0 flex-1 text-[13.5px] leading-[1.66]" : cn("group relative max-w-[80%] min-w-0 rounded-lg border border-border bg-muted/30 p-4", orphanView.footer && "w-full")}>
                  <PaigeLiveTurnStatus
                    input={liveInputFor(orphanTurn, false, false)}
                    idBase={`turn-${orphanTurn.assistantId}`}
                    announce
                    open={turnTraceOpen[orphanTurn.assistantId] ?? false}
                    onOpenChange={(open) => openTurnTrace(orphanTurn.assistantId, open)}
                    onTraceToggle={holdTurnLine}
                    personaName={persona.name}
                  />
                  {orphanView.footer && (
                    <PaigeTurnFooter
                      footer={footerFor(orphanView.footer, orphanView.kind, orphanTurn.userText)}
                      onAskAgain={askAgainFor(orphanTurn.userText)}
                      onSee={() => openTurnTrace(orphanTurn.assistantId, true)}
                      focusOnMount={orphanTurn.endCause === "cancelled" && orphanTurn.stopFocus}
                      quietAskAgain={orphanView.kind === "stop"}
                      disabled={composerSendBlocked}
                    />
                  )}
                </div>
              </div>
            )}
            {compacting && (
              <div className="flex flex-col gap-2">
                <PaigeCompactingCard signal={compacting} personaName={persona.name} />
              </div>
            )}
            {soloTenantSafety && !composerScope.writable && !isLoading && composerScope.unavailableReason && (
              <div role="status" className="rounded-lg border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                {composerScope.unavailableReason}
              </div>
            )}
            {soloTenantSafety && connectionIssue && (
              <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground">
                <span>{connectionIssue === "live-interrupted" ? "Paige's answer was interrupted. What arrived is still shown here. You can continue in text chat." : connectionIssue === "offline" ? "You appear to be offline. This message has not been sent." : connectionIssue === "server" ? "Something went wrong on our side and PAIGE didn't get to answer. Your message wasn't sent — try again." : `PAIGE was ${writingPhase ? "writing the response" : "working on your request"} when the six-minute interactive window ended. This chat stopped listening, so I can't confirm whether that work finished or was saved.${retryTurnRef.current && !retryTurnRef.current.live ? " Retry may start the work again." : ""}`}</span>
                {connectionIssue !== "live-interrupted" && retryTurnRef.current && !retryTurnRef.current.live && <Button type="button" variant="outline" size="sm" disabled={!composerScope.writable || dictationActive} onClick={handleConnectionRetry}>Retry</Button>}
              </div>
            )}
            </div>
            {soloTenantSafety && !isAtLatest && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Jump to latest message"
                aria-controls="solo-paige-transcript"
                title={hasNewerContentRef.current ? "Newer PAIGE content is available" : "Jump to latest message"}
                onClick={jumpToLatest}
                className="absolute bottom-3 right-3 z-10 h-11 w-11 rounded-full border-border-strong bg-card shadow-lg transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none"
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
                {hasNewerContentRef.current && (
                  <span aria-hidden className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
                )}
              </Button>
            )}
            {soloTenantSafety && (
              <span role="status" aria-live="polite" className="sr-only">
                {latestAnnouncement}
              </span>
            )}
          </div>

          {/* Her working. CD draws it as a collapsible strip with a right-aligned
              meter; the app draws the persistent "on watch" strip. Same REAL steps
              (`paige_step` frames) either way — CD's per-message trace has no backing
              here, because the engine streams a trace per TURN and never persists it,
              so the strip sits with the live turn instead of under an old answer, and
              the meter reads "—" rather than a plausible latency (§13). */}
          {!hideReasoningStrip && cd && (isLoading || visibleSteps.length > 0) && (
            <div className="flex-none border-t border-border px-3.5 py-2">
              <button
                type="button"
                aria-expanded={traceOpen}
                onClick={() => setTraceOpen((o) => !o)}
                className="flex w-full min-w-0 items-center gap-2 rounded-[9px] border border-border bg-muted/40 px-2.5 py-1.5 text-left transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden className="flex-none text-[10px] text-[hsl(var(--primary))]">
                  {traceOpen ? "▾" : "▸"}
                </span>
                <span className="min-w-0 truncate text-[11px]">{traceLabel}</span>
                <span
                  title="Latency and token cost aren't reported back to this surface yet."
                  className="ml-auto flex-none font-mono text-[9.5px] text-muted-foreground"
                >
                  —
                </span>
              </button>
              {traceOpen && (
                <div className="mt-1.5 border-l-2 border-[hsl(var(--primary)/0.35)] pl-[11px]">
                  <StepTimeline steps={visibleSteps} loading={isLoading} />
                </div>
              )}
            </div>
          )}

          {/* C3a — the pinned "on watch / at work" strip is gone from this chrome (owner ruling,
              OD1): each answer carries its own living line and its own "What PAIGE did" inline. */}

          <div
            className={cn(
              cd
                // CD's composer well: the whole footer sits on the raised ground and
                // the input is a framed card inside it.
                ? "flex-none border-t border-border bg-muted/40 px-3 pb-[11px] pt-[9px]"
                : "border-t border-border p-4",
            )}
          >
            {/* Hidden picker — accepts ALL supported kinds (pdf/image/docx), not
                pdf-only. Change resets its value in the hook so re-picking the same
                file re-fires. */}
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptString}
              onChange={handleFileSelect}
              className="hidden"
            />
            {/* CD's prompt chips. These are the SAME `chips` the slash palette already
                serves — the operator console just shows them instead of making the
                human know to type "/" first (§36). Clicking one writes the prompt into
                the composer; nothing is sent without the operator pressing Send. */}
            {cd && visibleChips.length > 0 && (
              <div className="flex items-center gap-[7px] overflow-x-auto pb-2">
                {visibleChips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => handleChip(c)}
                    disabled={composerSendBlocked}
                    className="flex-none whitespace-nowrap rounded-full border border-border bg-card px-[11px] py-1.5 text-[11px] transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {/* C3a — the live approval card has scrolled out of view: say so, quietly. */}
            {approvalOffscreen && !cd && (
              // No live region: the line already said "needs your OK" once. Scrolling the card in and
              // out of view must not say it again.
              <p className="mb-2 flex items-center gap-1.5 px-1 text-xs text-muted-foreground" data-paige-approval-hint>
                <Hand className="h-3.5 w-3.5 text-foreground/80" aria-hidden />
                {persona.name || "PAIGE"} is waiting on your OK above
              </p>
            )}
            {/* C4c — the composer is answering PAIGE's question (c2): it says so, and the person can
                turn that off for this question and say something else instead (c5). */}
            {boundAsk && composerScope.writable && (
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs leading-4 text-muted-foreground" data-paige-answering={answeringAsk ? (claimedAsk ? "claimed" : "answer") : "new"}>
                <CircleHelp className="h-3.5 w-3.5 shrink-0 text-foreground/80" aria-hidden />
                <span className="min-w-0">
                  {claimedAsk
                    // The server's own window (ANSWER_STRANDED_AFTER_MINUTES): younger, a re-send is
                    // told she already has it; older, she asks the question again.
                    ? answeringAsk
                      ? `${persona.name || "PAIGE"} has your answer. No reply within ${ANSWER_STRANDED_AFTER_MINUTES} minutes? Send it again and she'll ask again.`
                      : askFileAttached ? "Your file goes as a new message" : "Sending as a new message"
                    : answeringAsk
                      ? `${persona.name || "PAIGE"} is waiting on your answer above`
                      : askFileAttached
                        ? "Your file goes as a new message — her question stays unanswered"
                        : "Sending as a new message — her question stays unanswered"}
                </span>
                {/* With a file attached there is nothing to switch: removing the file (its chip, just
                    below) is how the composer answers her again. */}
                {!askFileAttached && (
                  <button
                    type="button"
                    onClick={() => setAskSetAside(answeringAsk ? boundAsk.askId : null)}
                    className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                  >
                    {answeringAsk ? "Ask something else instead" : claimedAsk ? "Send it as your answer" : "Answer her question"}
                  </button>
                )}
              </div>
            )}
            {/* Pending attachment chip — sits above the input, removable (§13). */}
            {attachedDoc && (
              <div className="mb-2">
                <DocumentAttachmentChip
                  fileName={attachedDoc.name}
                  kind={attachedDoc.kind}
                  sizeBytes={attachedDoc.size}
                  onRemove={removeAttachment}
                />
              </div>
            )}
            {/* Composer + slash palette + inline voice. The palette anchors above the
                input in both chromes and focus never leaves the Textarea. */}
            <div
              className={cn(
                "relative",
                cd
                  // CD's framed well: input on top, the tool row beneath it.
                  ? "overflow-visible rounded-xl border border-border bg-card focus-within:border-border-strong"
                  : soloTenantSafety
                    ? "overflow-visible rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 motion-reduce:transition-none"
                  : "flex items-end gap-2",
              )}
              data-solo-composer={soloTenantSafety ? "true" : undefined}
            >
              <SlashCommandMenu
                open={slashOpen}
                items={filteredCommands}
                activeIndex={Math.min(slashActive, Math.max(0, filteredCommands.length - 1))}
                onHover={setSlashActive}
                onPick={pickCommand}
              />
              {cd ? (
                <>
                  <div className="flex min-w-0 items-start gap-2.5 px-3 pb-1 pt-2.5">
                    <span aria-hidden className="mt-1 flex-none text-[12px] text-muted-foreground">✦</span>
                    {composerTextarea}
                  </div>
                  <div className="flex min-w-0 items-center gap-1.5 px-2.5 pb-2 pt-1.5">
                    {attachButton}
                    {/* CD's other two tool keys. Neither has a seam behind it yet, so
                        each is rendered in CD's shape and DISABLED, saying what it is
                        waiting on — never a control that looks live and does nothing
                        (§13). They light up when the seam lands, not before. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled
                      aria-label="Reference a tenant"
                      title="Reference a tenant — not wired to the fleet record yet."
                      className="h-[27px] w-[27px] rounded-lg border border-border bg-card text-muted-foreground"
                    >
                      <span aria-hidden className="text-[11.5px] leading-none">⌗</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled
                      aria-label="Run a skill"
                      title="Run a skill — the skill runner isn't callable from this composer yet."
                      className="h-[27px] w-[27px] rounded-lg border border-border bg-card text-muted-foreground"
                    >
                      <span aria-hidden className="text-[11.5px] leading-none">⚡</span>
                    </Button>
                    <span className="ml-auto flex-none font-mono text-[9.5px] text-muted-foreground">
                      ⌘↵ to send
                    </span>
                    {clearComposerButton}
                    {micButton}
                    <Button
                      onClick={() => (soloTenantSafety && isLoading ? cancelSoloRequest() : handleSend())}
                      disabled={soloTenantSafety ? (!isLoading && (composerSendBlocked || (!input.trim() && !attachedDoc))) : composerSendBlocked || (!input.trim() && !attachedDoc)}
                      variant="gold"
                      size="sm"
                      aria-label={soloTenantSafety && isLoading ? "Cancel PAIGE response" : "Send message"}
                      className="h-[29px] flex-none gap-1.5 rounded-[9px] px-3.5 text-[12px] font-semibold"
                    >
                      {isLoading && !soloTenantSafety ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
                      ) : isLoading ? (
                        <span aria-hidden className="text-[10px] leading-none">■</span>
                      ) : (
                        <span aria-hidden className="text-[10px] leading-none">↑</span>
                      )}
                      {soloTenantSafety && isLoading ? "Cancel" : "Send"}
                    </Button>
                  </div>
                </>
              ) : soloTenantSafety ? (
                <>
                  <div data-solo-composer-input className="min-w-0 px-3.5 pb-1 pt-3">
                    {composerTextarea}
                  </div>
                  {/* §70/§13 — THREE ADVERTISED AFFORDANCES, NONE OF WHICH EXISTED HERE.
                      This strip offered three sigils — at-sign for handing work to someone, slash
                      for calling a skill, hash for remembering something. Solo passes no chips, so
                      `filteredCommands` is always empty and the slash menu can never open; there is
                      no at-sign or hash handling anywhere in this file. A person typing any of the
                      three got nothing and no explanation. "UI that describes a capability without
                      allowing its human flow" is the §70.1 definition of not delivered.

                      THE ELEMENT STAYS, THE CLAIM GOES. The three-level composer — input, this
                      row, actions — is a layout CD designed, and deleting a level would be me
                      restyling their surface, which §00 forbids. So the row renders nothing rather
                      than something false: an honest absence, which is what CC owes when a value
                      has no capability behind it. What belongs here instead is CD's to decide, and
                      it is filed as owed rather than filled in by me. */}
                  <div
                    data-solo-composer-guidance
                    className="truncate px-3.5 pb-2 text-[10px] leading-4 text-muted-foreground"
                  />
                  <div
                    data-solo-composer-actions
                    className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-border/70 px-2.5 py-2"
                  >
                    {/* The real Paige-permissions chip (Solo only). It reflects + controls the
                        canonical per-tool autonomy seam; it never gates or claims authority here. */}
                    {composerAutonomyControl}
                    {micButton}
                    {liveConversationButton}
                    {attachButton}
                    {clearComposerButton}
                    <Button
                      onClick={() => (isLoading ? cancelSoloRequest() : handleSend())}
                      disabled={!isLoading && (composerSendBlocked || (!input.trim() && !attachedDoc))}
                      variant="gold"
                      size="icon"
                      aria-label={isLoading ? "Cancel PAIGE response" : "Send message"}
                      className="ml-auto flex-none"
                    >
                      {isLoading ? <span aria-hidden>■</span> : <Send className="h-4 w-4" aria-hidden />}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {composerTextarea}
                  {attachButton}
                  {clearComposerButton}
                  {micButton}
                  <Button
                    onClick={() => (soloTenantSafety && isLoading ? cancelSoloRequest() : handleSend())}
                    disabled={soloTenantSafety ? (!isLoading && (composerSendBlocked || (!input.trim() && !attachedDoc))) : composerSendBlocked || (!input.trim() && !attachedDoc)}
                    variant="gold"
                    size="icon"
                    aria-label={soloTenantSafety && isLoading ? "Cancel PAIGE response" : "Send message"}
                  >
                    {isLoading && !soloTenantSafety ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" /> : isLoading ? <span aria-hidden>■</span> : <Send className="w-4 h-4" />}
                  </Button>
                </>
              )}
            </div>
            {cd && composerFootNote && (
              <div className="mt-[7px] text-[10px] text-muted-foreground">{composerFootNote}</div>
            )}
          </div>
        </Card>
        </div>
      </div>
    </div>
  );
};

export const PaigeAIChat = (props: PaigeAIChatProps = {}) => <PaigeAIChatInner {...props} />;
