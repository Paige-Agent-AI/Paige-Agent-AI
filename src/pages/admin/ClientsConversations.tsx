// Conversations — the unified two-way client inbox (Comms C-1 / C-1.5, §7 intelligent portal).
// One thread per client across every channel, reading the REAL public.messages jsonb
// substrate + the public.threads aggregate (order/unread/snooze/archive/labels). Paige
// detects an inbound, the action bus drafts the reply (status='draft', tagged below), and
// a non-technical coach one-click Approves → send-message fires (§36 draft-first + one-click).
//
// C-1.5 adds: search, snooze/archive/labels, the contact rail, composer depth
// (attachments · snippets · signatures · schedule/undo-send), and the four derived
// views the Command-Center tiles deep-link into (?filter=drafts|awaiting-reply|…).
//
// §11/§25 premium on @/components/ui/page + @/components/ui/select (NO native select);
// gold ONLY on Send/Approve; realtime on messages + threads; motion-safe; token-only.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useLocation, useSearchParams, Link } from "react-router-dom";
import {
  MessageCircle, Inbox, Send, Pencil, Loader2, Sparkles, AlertTriangle, Paperclip,
  PanelRight, Bell, Plus, PlugZap, Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageShell, SectionCard, EmptyState, StatePill } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

import {
  type ChannelType, type MessageRow, type DbThread, type Label,
  type ThreadFilter, type Suppression, type SelectedView, type InboxView, type EmailTemplate,
  MESSAGE_COLS, THREAD_COLS, messageRowsFromDb, threadsFromDb, CHANNEL_ICON, CHANNEL_LABEL,
  partyLabel, bodyPreview, msgTime, contactNameFromClient,
  INBOX_VIEWS, endOfTodayMs, readSendResult, resolveMergeVars, UNDO_WINDOW_MS,
  useCommsAttachments,
} from "./conversations/inbox-shared";
import { voiceHistoryStatus } from "@/lib/voice/voiceCallSafety";
import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";
import { ComposeThreadDialog } from "./conversations/ComposeThreadDialog";
import { FirstRunOnboarding } from "./conversations/FirstRunOnboarding";
import { ThreadRow } from "./conversations/ThreadRow";
import { ThreadFilters, useLabelCatalog } from "./conversations/ThreadFilters";
import { ContactCardRail } from "./conversations/ContactCardRail";
import { readableMessageBody, shouldFoldEmail } from "./conversations/messageReading";
// INT-328 — a governed send (an email or invoice already approved and on its way) is never a draft.
import { GOVERNED_SEND_COLS, GOVERNED_SEND_COPY, governedSendView, isApprovableDraft } from "./conversations/governedSend";
// Shared conversation atoms (§18 one home) — the SAME bubble the operator Fleet inbox renders.
import { MessageBubble as SharedMessageBubble } from "./conversations/MessageBubble";
import { SnoozeMenu } from "./conversations/SnoozeMenu";
import { LabelPopover } from "./conversations/LabelPopover";
import { QuickAddDialog } from "@/components/planning/QuickAddDialog";
import { appendDictation } from "@/lib/voice/useDictation";
// The extracted three-column conversation SHELL + its scope-adapter contract (§18 one home) —
// the tenant container feeds this the SAME shell the operator Fleet inbox will feed (Phase 2).
import { ConversationsThreeColumnShell } from "./conversations/shell/ConversationsThreeColumnShell";
import { ConversationsThreadList } from "./conversations/shell/ConversationsThreadList";
import { ConversationsRichComposer } from "./conversations/shell/ConversationsRichComposer";
import { ConversationsContactPanel } from "./conversations/shell/ConversationsContactPanel";
import { ConversationsCallButton } from "./conversations/shell/ConversationsCallButton";
import { useVoiceDevice } from "@/lib/voice/VoiceDeviceProvider";
import type {
  ConversationsCapabilities, ConversationsListModel, ConversationsComposerModel,
  ConversationsContactPanelModel, ShellThread, DraftTone,
} from "./conversations/shell/conversationsAdapter";
import { useTenantContext } from "@/hooks/useTenantContext";
import type { SoloCommsReadinessEvidence } from "./conversations/solo/soloConversationModel";
import { useAgentPresence } from "@/components/ui/paige";
import {
  SoloClientContextPane,
  SoloConversationOperatingBar,
  SoloConversationsWorkspace,
  type ConversationHandlingMode,
} from "./conversations/solo/SoloConversationsWorkspace";
import {
  buildSoloConversationLinks,
  canSendInSolo,
  conversationNeedsAttention,
  createAccountEpochGuard,
  getSoloChannelTruth,
  type AccountEpochToken,
} from "./conversations/solo/soloConversationModel";

// ── Connector (channel_connectors row — kept local, not in shared) ─────────────────
interface Connector {
  id: string;
  channel_type: ChannelType;
  provider: string | null;
  display_name: string | null;
  from_address: string | null;
  from_name: string | null;
  inbound_address: string | null;
  status: "pending" | "active" | "disabled";
  active: boolean;
}

// ── Composer depth (Comms C-1.5) ────────────────────────────────────────────────
// UNDO_WINDOW_MS + the comms-attachment bucket/cap/upload hook now live in inbox-shared
// (§18 — the compose-new modal uploads through the exact same seam).

interface Snippet {
  id: string; user_id: string | null; trigger: string; name: string;
  body: string; variables: Record<string, string> | null;
}
interface Signature {
  id: string; user_id: string | null; name: string; html: string;
  variables: Record<string, string> | null; is_default: boolean;
}

// Merge-var resolver — unknown {{token}} drops to "" so a raw token NEVER ships (§13/§15).
// R1: reads the selected view's dbThread.clients + name (the assembled shape).
function mergeContext(sel: SelectedView | null, sig?: Signature, snip?: Snippet): Record<string, string> {
  const c = sel?.dbThread.clients ?? null;
  return {
    first_name: c?.first_name ?? "",
    last_name: c?.last_name ?? "",
    full_name: [c?.first_name, c?.last_name].filter(Boolean).join(" "),
    client_name: sel?.name ?? "",
    entity_name: c?.entity_name ?? "",
    ...(snip?.variables ?? {}),
    ...(sig?.variables ?? {}),
  };
}
// resolveMergeVars now lives in inbox-shared (§18 one home — the compose-new modal + the
// ported email-template picker resolve merge vars through the exact same helper).

// ── Status pill mapping for a single message ─────────────────────────────────────
function messageStatusPill(m: MessageRow) {
  // A send the server stopped before it left (suppressed, do-not-disturb, no consent) is written
  // 'blocked'. Without a pill it read as an ordinary sent bubble.
  if ((m.status as string) === "blocked") return <StatePill state="error">Not sent</StatePill>;
  if (m.status === "failed") return <StatePill state="error">Failed</StatePill>;
  if (m.status === "sent" || m.status === "delivered" || m.status === "read")
    return <StatePill state="success">Sent</StatePill>;
  if (m.status === "queued") return <StatePill state="pending">Queued</StatePill>;
  return null;
}

function voiceStatusPill(m: MessageRow) {
  const status = voiceHistoryStatus(m.status);
  return status ? <StatePill state={status.state}>{status.label}</StatePill> : null;
}

// ── Channel glyph chip (local — MessageBubble + detail header) ──────────────────────
function ChannelGlyph({ channel, className }: { channel: ChannelType; className?: string }) {
  const Icon = CHANNEL_ICON[channel];
  return (
    <span
      className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-muted text-muted-foreground", className)}
      title={CHANNEL_LABEL[channel]} aria-label={CHANNEL_LABEL[channel]}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

// ── One message bubble (inbound left / outbound right) ────────────────────────────
function MessageBubble({
  m,
  onApprove,
  onEdit,
  onCancelScheduled,
  approving,
  sendDisabled = false,
}: {
  m: MessageRow;
  onApprove: (m: MessageRow) => void;
  onEdit: (m: MessageRow) => void;
  onCancelScheduled: (id: string) => void;
  approving: boolean;
  sendDisabled?: boolean;
}) {
  // INT-328 — a governed send is written as a 'draft' row before it leaves. It is NOT awaiting
  // approval (that was given and consumed), so it never gets the Approve & send card.
  const governed = governedSendView(m);
  const isDraft = m.status === "draft" && governed === null;
  const body = readableMessageBody(m);
  const governedOpen = governed === "sending" || governed === "unconfirmed";

  // A Paige draft is a distinct, approval-forcing card — never a plain sent bubble (§36). This
  // gold "Approve & send" card IS an act (gold is earned), so it stays a TENANT-SIDE wrapper and
  // is deliberately NOT pushed into the shared, gold-free MessageBubble atom (§11 gold only on
  // the act; the atom's contract keeps it gold-free).
  if (isDraft) {
    return (
      <div className="flex justify-end">
        <div className="w-full max-w-[85%] rounded-xl border border-[hsl(var(--gold)/0.45)] bg-[hsl(var(--gold)/0.06)] p-3.5 shadow-card">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--gold-dark))]" aria-hidden />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--gold-dark))]">
              Paige drafted — awaiting your approval
            </span>
          </div>
          {m.subject && <p className="mb-1 text-sm font-medium text-foreground">{m.subject}</p>}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{body || "—"}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="gold"
              size="sm"
              onClick={() => onApprove(m)}
              disabled={approving || sendDisabled}
              className="h-8"
            >
              {approving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Approve &amp; send
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(m)} disabled={approving} className="h-8">
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Every non-draft message renders through the SHARED atom (§18 one home) so the tenant inbox
  // and the operator Fleet inbox never drift into divergent bubbles (§6). The tenant's richer
  // affordances — email subject, attachment chips, foldable long email bodies, the scheduled-cancel
  // control — inject through the atom's OPTIONAL presentational props; the only tenant-local part is
  // the raw MessageRow → props mapping below.
  // §49 — a voice-call row renders INLINE as the shared call bubble (direction/duration/recording/
  // transcript, each only when present, §13). Gold-free; the header Call button owns the act (§11).
  const isCall = m.channel_type === "voice";
  return (
    <SharedMessageBubble
      direction={m.direction}
      body={body}
      timestamp={m.sent_at ?? m.created_at}
      senderLabel={m.direction === "outbound" ? "You" : partyLabel(m.sender) || "Client"}
      status={
        isCall ? voiceStatusPill(m)
        : governed === "sending" ? <StatePill state="pending">{GOVERNED_SEND_COPY.sending.pill}</StatePill>
        : governed === "not_sent" ? (
          // Red deepened toward ink: the plain error pill measured 4.21:1 in light at 10px
          // (render-results.json), the same fix the "Couldn't confirm" pill needed.
          <StatePill state="error" className="text-[color-mix(in_oklab,hsl(var(--destructive))_62%,hsl(var(--foreground)))]">
            {GOVERNED_SEND_COPY.not_sent.pill}
          </StatePill>
        )
        : governed === "unconfirmed" ? (
          // Amber deepened toward ink: the plain warning pill measured 3.75:1 in light at 10px
          // (render-results.json). The same mix the approval card uses for its unconfirmed note.
          <StatePill state="warning" className="text-[color-mix(in_oklab,hsl(var(--warning))_62%,hsl(var(--foreground)))]">
            {GOVERNED_SEND_COPY.unconfirmed.pill}
          </StatePill>
        )
        : messageStatusPill(m)
      }
      error={m.status === "failed" && !governedOpen ? m.error : null}
      subject={isCall ? undefined : (m.subject ?? undefined)}
      foldable={!isCall && shouldFoldEmail(m.channel_type, body)}
      call={
        isCall
          ? {
              direction: m.direction,
              durationSec: m.call_duration_seconds,
              recordingUrl: m.recording_url,
              transcript: m.transcript,
            }
          : null
      }
      attachments={
        m.attachments?.length ? (
          <div className="flex flex-wrap gap-1.5">
            {m.attachments.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                <Paperclip className="h-3 w-3" /> {a.name || "attachment"}
              </span>
            ))}
          </div>
        ) : undefined
      }
      footer={
        governed === "unconfirmed" ? (
          <p data-governed-send="unconfirmed" className="text-[11px] leading-4 text-foreground">
            {GOVERNED_SEND_COPY.unconfirmed.line}
          </p>
        ) :
        // R-B1/R3: a queued scheduled outbound is findable + cancellable in the thread.
        m.status === "queued" && m.scheduled_for ? (
          <button
            type="button"
            onClick={() => onCancelScheduled(m.id)}
            className="text-[11px] text-muted-foreground underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          >
            Scheduled for {new Date(m.scheduled_for).toLocaleString()} · Cancel
          </button>
        ) : undefined
      }
    />
  );
}

// "Needs attention" counts a draft waiting on the owner; a governed send already approved is not one.
function needsAttention(thread: DbThread, msgs: MessageRow[], nowMs: number): boolean {
  return conversationNeedsAttention(
    thread,
    msgs.filter((m) => !(m.status === "draft" && governedSendView(m) !== null)),
    nowMs,
  );
}

function SoloConversationOperatingBarWithPaige(
  props: Omit<ComponentProps<typeof SoloConversationOperatingBar>, "onOpenPaige">,
) {
  const { expandRail } = useAgentPresence();
  return <SoloConversationOperatingBar {...props} onOpenPaige={expandRail} />;
}

// ══════════════════════════════════════════════════════════════════════════════════
export default function ClientsConversations() {
  const reduce = useReducedMotion();
  const location = useLocation();
  const { activeTenantId } = useTenantContext();
  const soloRoute = /^\/solo\/([^/]+)\/clients\/conversations(?:\/|$)/.exec(location.pathname);
  const isSolo = !!soloRoute;
  const soloAccountAddress = soloRoute?.[1] ?? "";
  const accountEpochRef = useRef(createAccountEpochGuard(activeTenantId));
  // The ONE shared Voice Device (§18) — the tenant places calls on their OWN provisioned number
  // via the tenant voice token path; the same Device the top-nav dialer uses.
  const voice = useVoiceDevice();
  const [rows, setRows] = useState<MessageRow[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [messageLoadFailure, setMessageLoadFailure] = useState<string | null>(null);
  const [threadLoadFailure, setThreadLoadFailure] = useState<string | null>(null);
  const loadFailure = messageLoadFailure ?? threadLoadFailure;
  const [connectorReadReported, setConnectorReadReported] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A freshly composed thread may not have streamed into dbThreads yet — hold its key so the
  // keep-valid-selection guard doesn't clobber the pick to visibleThreads[0] in the gap.
  const pendingSelectRef = useRef<string | null>(null);
  const contactSeekHandledRef = useRef<string | null>(null);
  const suppReqRef = useRef(0);

  // #121 GHL-parity list UX now lives INSIDE the extracted ConversationsThreadList (§18):
  // density (+ its localStorage persistence), sort, multi-select, and the Gmail-style keyboard
  // cursor are all list-internal. The container keeps only the single OPEN-thread selection.
  const paneRef = useRef<HTMLDivElement>(null);         // Enter focuses the thread pane
  useEffect(() => { setContactDrawerOpen(false); }, [selectedKey]);

  // C-1.5 threads-as-source-of-truth
  const [dbThreads, setDbThreads] = useState<DbThread[]>([]);
  const [view, setView] = useState<InboxView>("active");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [matchedKeys, setMatchedKeys] = useState<Set<string> | null>(null); // null = no active search
  const [searching, setSearching] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [contactDrawerOpen, setContactDrawerOpen] = useState(false);
  const [handlingMode, setHandlingMode] = useState<ConversationHandlingMode>("human");
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  // §43 — compose a NEW outbound thread (the surface is a tool, not just a viewer).
  const [composeOpen, setComposeOpen] = useState(false);
  // When the composer is opened from a Client-360 "Message {name}" deep-link, pre-address it.
  const [composeContact, setComposeContact] = useState<{ id: string; name?: string } | null>(null);
  // Gate the ?contact deep-link on a real first threads pull, so an empty (not-yet-loaded)
  // dbThreads never gets read as "no thread exists" (which would wrongly open the composer).
  const [threadsReady, setThreadsReady] = useState(false);
  const [accountHasThreads, setAccountHasThreads] = useState<boolean | null>(null);

  // Composer state (reply into the selected thread)
  const [composeChannel, setComposeChannel] = useState<ChannelType | "">("");
  const [composeConnectorId, setComposeConnectorId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // Latest body, so the dictation callback appends onto current text without a
  // stale closure (it feeds THROUGH handleBodyChange so snippet expansion still runs).
  const bodyRef = useRef("");
  useEffect(() => { bodyRef.current = body; }, [body]);
  const [sending, setSending] = useState(false);
  // Synchronous, epoch-scoped lock: repeated keyboard/click submits cannot enqueue the same
  // reply before React paints `sending`, and an old account's completion cannot unlock a new one.
  const sendInFlightRef = useRef<AccountEpochToken | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Composer depth state. Attachments run through the ONE shared upload seam (§18) — the
  // exact hook the compose-new modal uses — reading the resolved tenant from the ref below.
  const tenantIdRef = useRef<string | null>(null);
  const {
    attachments, uploading, uploadFiles, removeAttachment,
    reset: resetAttachments,
  } = useCommsAttachments(() => tenantIdRef.current);
  const [dragOver, setDragOver] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string | null>(null); // ISO | null
  const [, setUndo] = useState<{ messageId: string; expiresAt: number } | null>(null);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]); // ported email-template picker (§31)
  const [appendSignature, setAppendSignature] = useState(true); // email only, default on

  // "Draft with Paige" (#482 Phase-1): on-demand reply drafting via the subagent-email-composer
  // seam (§18 — the same seam the compose-new modal uses). Email-only for Phase-1 (the composer is an
  // EMAIL composer; SMS-native drafting is a fast-follow, §13 — don't route SMS through it and
  // pretend it's SMS-native). Draft-first, one-click, non-gold assist (§36/§11).
  const [drafting, setDrafting] = useState(false);
  // #176 — truthful label: true only while a draft-with-Paige call is ALSO reading staged
  // document(s). Drives the "Reading attachment…" button state; never claimed with no doc.
  const [draftReadingDoc, setDraftReadingDoc] = useState(false);
  const [draftFlags, setDraftFlags] = useState<string[]>([]);
  // The Draft-with-Paige guide popover (guide + tone), the schedule popover open state, and the
  // hidden file input now live INSIDE the extracted ConversationsRichComposer (§18); guide/tone
  // arrive as call args on onDraftWithPaige below.
  // #482 Phase-2 — the current operator's auth id, so the thread-header "Set a reminder"
  // quick action can file a plan row (plan_set_reminder is keyed to the caller). Server-derived.
  const [userId, setUserId] = useState<string | null>(null);

  // The parent also keys this page by the server-resolved tenant, but every asynchronous seam
  // still carries an explicit epoch. A late response from account A can therefore never paint
  // into account B even if it resolves during the remount/route transition gap.
  useEffect(() => {
    accountEpochRef.current.advance(activeTenantId);
    tenantIdRef.current = null;
    setRows([]); setConnectors([]); setLoading(true); setRetrying(false); setMessageLoadFailure(null); setThreadLoadFailure(null); setConnectorReadReported(true); setSelectedKey(null);
    pendingSelectRef.current = null; contactSeekHandledRef.current = null;
    setDbThreads([]); setView("active"); setLabelFilter(null); setSearch("");
    setMatchedKeys(null); setSearching(false); setSuppressions([]);
    setComposeOpen(false); setComposeContact(null); setThreadsReady(false); setAccountHasThreads(null);
    setComposeChannel(""); setComposeConnectorId(""); setSubject(""); setBody("");
    setScheduledFor(null); resetAttachments(); setSnippets([]); setSignatures([]); setTemplates([]);
    setAppendSignature(true); setDragOver(false); setUndo(null);
    setHandlingMode("human"); setUserId(null); setDrafting(false); setDraftReadingDoc(false);
    setDraftFlags([]); setSending(false); sendInFlightRef.current = null; setApprovingId(null); setEditingDraftId(null); suppReqRef.current += 1;
  }, [activeTenantId, resetAttachments]);

  // ── Deep-link: read ?filter=<view> once; unknown slug → keep default (never blank). ─
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const v = searchParams.get("filter");
    if (v && (INBOX_VIEWS as string[]).includes(v) && (v !== "attention" || isSolo)) setView(v as InboxView);
  }, [isSolo, searchParams]);
  useEffect(() => { if (!isSolo && view === "attention") setView("active"); }, [isSolo, view]);

  // Command Center and other Paige-governed entry points can open the ONE
  // existing compose surface directly; no duplicate quick-email modal.
  useEffect(() => {
    if (searchParams.get("compose") === "1") {
      setComposeContact(null);
      setComposeOpen(true);
    }
  }, [searchParams]);

  // ── message pull (500-row) + connectors + composer resources (R2: one reconciled load) ─
  const load = useCallback(async () => {
    const epoch = accountEpochRef.current.capture();
    if (epoch.account !== activeTenantId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [msgRes, connRes, snipRes, sigRes, tplRes, tidRes] = await Promise.all([
      sb.from("messages").select(`${MESSAGE_COLS}, ${GOVERNED_SEND_COLS}`).order("sent_at", { ascending: false, nullsFirst: true }).limit(500),
      sb.from("channel_connectors").select("id, channel_type, provider, display_name, from_address, from_name, inbound_address, status, active").order("created_at", { ascending: true }),
      sb.from("snippets").select("id, user_id, trigger, name, body, variables"),
      sb.from("signatures").select("id, user_id, name, html, variables, is_default"),
      sb.from("email_templates").select("template_key, subject, body_markdown, body_html, category").eq("active", true).order("category"),
      sb.rpc("current_user_tenant_id"),
    ]);
    if (!accountEpochRef.current.accept(epoch)) return;
    if (msgRes.error) {
      toast.error("Couldn't load conversations.");
      setMessageLoadFailure(msgRes.error.message || "Conversation messages are unavailable.");
    } else {
      setMessageLoadFailure(null);
      setRows(messageRowsFromDb(msgRes.data));
    }
    if (connRes.error) {
      setConnectorReadReported(false);
    } else {
      setConnectorReadReported(true);
      setConnectors((connRes.data as unknown as Connector[]) ?? []);
    }
    setSnippets((snipRes.data as unknown as Snippet[]) ?? []);
    setSignatures((sigRes.data as unknown as Signature[]) ?? []);
    setTemplates((tplRes.data as unknown as EmailTemplate[]) ?? []);
    tenantIdRef.current = (tidRes.data as string | null) ?? null;
    setLoading(false);
  }, [activeTenantId]);

  // Server query filters by the underlying STATE; derived views ride on a base state.
  const baseFilter: ThreadFilter =
    view === "snoozed" || view === "waking-today" ? "snoozed"
    : view === "archived" ? "archived"
    : view === "all" ? "all"
    : "active"; // active | drafts | awaiting-reply | scheduled

  // ── threads pull (source of truth for order/state/labels) ──────────────────────────
  const loadThreads = useCallback(async () => {
    const epoch = accountEpochRef.current.capture();
    if (epoch.account !== activeTenantId) return;
    const nowIso = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    let q = sb.from("threads").select(THREAD_COLS)
      .order("last_message_at", { ascending: false, nullsFirst: false }).limit(500);
    if (baseFilter === "active")        q = q.is("archived_at", null).or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`);
    else if (baseFilter === "snoozed")  q = q.is("archived_at", null).gt("snoozed_until", nowIso);
    else if (baseFilter === "archived") q = q.not("archived_at", "is", null);
    // "all" → no state predicate
    const { data, error } = await q;
    if (!accountEpochRef.current.accept(epoch)) return;
    if (error) {
      toast.error("Couldn't load the inbox.");
      setThreadLoadFailure(error.message || "The conversation queue is unavailable.");
    } else {
      setDbThreads(threadsFromDb(data));
      setThreadLoadFailure(null);
    }
    setThreadsReady(true); // gate the ?contact deep-link on a real first threads pull
  }, [activeTenantId, baseFilter]);

  // ── first-run existence probe (UNFILTERED, §9 RLS-scoped) ──────────────────────────
  // `loadThreads` filters by the current VIEW (active/archived/snoozed), so dbThreads being
  // empty means "no threads in THIS view", NOT "the account has no threads". First-run must
  // key off whether the tenant has ANY thread in ANY state — otherwise an account with only
  // archived/snoozed threads lands on the default active view, sees zero, and gets the
  // onboarding surface in place of the whole inbox (incl. ThreadFilters), trapping those
  // existing conversations out of reach. null = not yet known (never flash onboarding early).
  const checkAccountHasThreads = useCallback(async () => {
    const epoch = accountEpochRef.current.capture();
    if (epoch.account !== activeTenantId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error } = await (supabase as any).from("threads")
      .select("thread_key", { count: "exact", head: true });
    if (accountEpochRef.current.accept(epoch) && !error) setAccountHasThreads((count ?? 0) > 0);
  }, [activeTenantId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => { void checkAccountHasThreads(); }, [checkAccountHasThreads]);
  const retryConversations = useCallback(async () => {
    const epoch = accountEpochRef.current.capture();
    setRetrying(true);
    await Promise.all([load(), loadThreads(), checkAccountHasThreads()]);
    if (accountEpochRef.current.accept(epoch)) setRetrying(false);
  }, [checkAccountHasThreads, load, loadThreads]);

  // ── Deep-link: ?contact=<id> — the Client-360 "Message {name}" action lands here (§18: the
  // Conversations hub is the ONE comms home now that the old ContactCommsPanel is retired).
  // Declared AFTER loadThreads so the dep array reads an initialized binding (no TDZ, TS2448).
  // Once the first threads pull is in: if a thread already exists for that contact, auto-select
  // it via the same pendingSelectRef machinery a fresh compose uses; if none exists yet, open the
  // composer pre-addressed to the contact. Handled once per contact-id so realtime thread updates
  // don't re-fire it (mirrors the ?filter= pattern above). ─────────────────────────────────────
  useEffect(() => {
    const cid = searchParams.get("contact");
    if (!cid || !cid.trim()) return;
    if (!threadsReady) return;                          // wait for a real first threads pull
    if (contactSeekHandledRef.current === cid) return;  // act on each contact-param exactly once
    contactSeekHandledRef.current = cid;
    const match = dbThreads.find((t) => t.contact_id === cid);
    if (match) {
      pendingSelectRef.current = match.thread_key;
      setView("active"); setLabelFilter(null); setSearch("");
      void loadThreads(); // re-pull bumps dbThreads → the keep-valid-selection guard honors the pick
      return;
    }
    // Not in the active set — the contact's ONLY thread may be ARCHIVED or SNOOZED (both excluded by
    // the default active pull), so probe the threads table directly (tenant-scoped by RLS, §9) before
    // falling back to a fresh compose. If any thread exists, switch to the "all" view (which surfaces
    // archived/snoozed) and hold the pick; only compose when the contact genuinely has no thread (§13).
    void (async () => {
      const epoch = accountEpochRef.current.capture();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from("threads")
        .select("thread_key").eq("contact_id", cid)
        .order("last_message_at", { ascending: false, nullsFirst: false }).limit(1);
      if (!accountEpochRef.current.accept(epoch)) return;
      const key = (data as { thread_key: string }[] | null)?.[0]?.thread_key ?? null;
      if (key) {
        pendingSelectRef.current = key;
        setView("all"); setLabelFilter(null); setSearch("");
        void loadThreads();
      } else {
        setComposeContact({ id: cid });
        setComposeOpen(true);
      }
    })();
  }, [searchParams, threadsReady, dbThreads, loadThreads]);

  // ── realtime: messages + threads (§7 two-way, live unread/snooze/archive) ───────────
  useEffect(() => {
    const epoch = accountEpochRef.current.capture();
    const channelSuffix = `${epoch.account ?? "unresolved"}:${epoch.epoch}`;
    const current = () => accountEpochRef.current.accept(epoch);
    const chM = supabase.channel(`comms_inbox:${channelSuffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => { if (current()) { void load(); void loadThreads(); } })
      .subscribe();
    const chT = supabase.channel(`comms_threads:${channelSuffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "threads" }, () => { if (current()) { void loadThreads(); void checkAccountHasThreads(); } })
      .subscribe();
    return () => { void supabase.removeChannel(chM); void supabase.removeChannel(chT); };
  }, [checkAccountHasThreads, load, loadThreads]);

  // ── full-text search over messages.search_tsv (websearch → no injection), 300ms ─────
  useEffect(() => {
    const term = search.trim();
    if (!term) { setMatchedKeys(null); setSearching(false); return; }
    setSearching(true);
    const h = setTimeout(async () => {
      const epoch = accountEpochRef.current.capture();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data, error } = await sb.from("messages").select("thread_key")
        .textSearch("search_tsv", term, { type: "websearch", config: "english" }).limit(1000);
      if (!accountEpochRef.current.accept(epoch)) return;
      if (error) toast.error("Search hit a snag — try again.");
      setMatchedKeys(new Set(((data as { thread_key: string }[]) ?? []).map((r) => r.thread_key)));
      setSearching(false);
    }, 300);
    return () => clearTimeout(h);
  }, [search]);

  // ── message maps (preview + detail hydration) ──────────────────────────────────────
  const messagesByKey = useMemo(() => {
    const m = new Map<string, MessageRow[]>();
    for (const r of rows) { const a = m.get(r.thread_key) ?? []; a.push(r); m.set(r.thread_key, a); }
    for (const arr of m.values()) arr.sort((a, b) => msgTime(a) - msgTime(b));
    return m;
  }, [rows]);
  const previewByKey = useMemo(() => {
    const m = new Map<string, MessageRow>();
    for (const [k, arr] of messagesByKey) m.set(k, arr[arr.length - 1]);
    return m;
  }, [messagesByKey]);

  const labelCatalog = useLabelCatalog(dbThreads);
  const activeUnread = useMemo(
    () => dbThreads.reduce((s, t) => s + (!t.archived_at && (!t.snoozed_until || new Date(t.snoozed_until) <= new Date()) ? t.unread_count : 0), 0),
    [dbThreads],
  );

  // Resolve the operator's own auth id once (§9 server-derived) for the reminder quick action.
  useEffect(() => {
    const epoch = accountEpochRef.current.capture();
    if (epoch.account !== activeTenantId) return;
    supabase.auth.getUser().then(({ data }) => {
      if (accountEpochRef.current.accept(epoch)) setUserId(data.user?.id ?? null);
    });
  }, [activeTenantId]);

  // ── derived view predicate (R3): drafts/awaiting-reply/waking-today/scheduled ───────
  const nowMs = Date.now();
  const viewPredicate = useCallback((t: DbThread): boolean => {
    const msgs = messagesByKey.get(t.thread_key) ?? [];
    switch (view) {
      case "attention":
        return needsAttention(t, msgs, nowMs);
      case "drafts":
        return msgs.some(isApprovableDraft);
      case "awaiting-reply":
        return t.last_direction === "outbound" && !!t.last_message_at
          && (nowMs - new Date(t.last_message_at).getTime()) > 3 * 864e5 && !t.archived_at
          && (!t.snoozed_until || new Date(t.snoozed_until).getTime() <= nowMs);
      case "waking-today":
        return !!t.snoozed_until && new Date(t.snoozed_until).getTime() > nowMs
          && new Date(t.snoozed_until).getTime() <= endOfTodayMs();
      case "scheduled":
        return msgs.some((m) => m.status === "queued" && !!m.scheduled_for);
      case "unread":
        // rides the 'active' server base (baseFilter falls through to active); narrows to
        // genuinely-unread, non-archived, not-future-snoozed threads (§13 real state).
        return t.unread_count > 0 && !t.archived_at
          && (!t.snoozed_until || new Date(t.snoozed_until).getTime() <= nowMs);
      default:
        return true;
    }
  }, [view, messagesByKey, nowMs]);

  // §36 proactive pull: threads sitting in the folded draft-first views (Drafts /
  // Awaiting reply) still tug the eye — badge the "More" chip trigger with their count
  // (#148 foldout) so collapsing those moat views to reclaim space never buries the
  // draft-first surfacing. Predicate mirrors viewPredicate's drafts/awaiting cases.
  const foldedPending = useMemo(() => {
    let n = 0;
    for (const t of dbThreads) {
      const msgs = messagesByKey.get(t.thread_key) ?? [];
      if (isSolo ? needsAttention(t, msgs, nowMs) : (
        !t.archived_at
        && (!t.snoozed_until || new Date(t.snoozed_until).getTime() <= nowMs)
        && (msgs.some(isApprovableDraft)
          || (t.last_direction === "outbound" && !!t.last_message_at && nowMs - new Date(t.last_message_at).getTime() > 3 * 864e5))
      )) n++;
    }
    return n;
  }, [dbThreads, isSolo, messagesByKey, nowMs]);

  // ── visible threads: state filter is server-side; search + label + view client-side. The FINAL sort
  // now lives INSIDE ConversationsThreadList (§18) over the normalized threads — the container
  // hands the rail the already-filtered list in recent order (the list's default), and the list
  // re-sorts per the user's chosen mode. The only order-dependent consumer left here is the
  // keep-valid-selection fallback (visibleThreads[0]); the default recent order matches the
  // shipped behavior, so auto-selection is unchanged (§13 zero regression).
  const visibleThreads = useMemo(() =>
    dbThreads.filter((t) =>
      (matchedKeys === null || matchedKeys.has(t.thread_key)) &&
      (labelFilter === null || (t.labels ?? []).some((l) => l.id === labelFilter)) &&
      viewPredicate(t)),
    [dbThreads, matchedKeys, labelFilter, viewPredicate]);

  const activeConnectors = useMemo(() => connectors.filter((c) => c.active && c.status === "active"), [connectors]);
  const sendableConnectors = useMemo(
    () => activeConnectors.filter((c) => c.channel_type === "email" || c.channel_type === "sms"),
    [activeConnectors],
  );
  const composerConnectors = isSolo ? sendableConnectors : activeConnectors;

  // The channel disclosure reads the SAME canonical record Settings -> Connections
  // renders, so the two surfaces cannot report different answers about whether
  // this account can text. Solo only: the disclosure itself is Solo-only.
  const [commsReadiness, setCommsReadiness] = useState<SoloCommsReadinessEvidence | null>(null);
  useEffect(() => {
    // CLEAR FIRST, unconditionally. On an account switch this effect previously went straight to
    // its async arm, so the PREVIOUS workspace's readiness kept feeding getSoloChannelTruth until
    // the new workspace's RPC returned — the disclosure asserted one business's texting state under
    // another business's heading. Settings → Connections already cleared before every load
    // (useCommsReadiness in src/solo/settings.tsx); this consumer of the same resolver did not.
    setCommsReadiness(null);
    if (!isSolo || !activeTenantId) return;
    let cancelled = false;
    void (async () => {
      // RPC is deployed but not yet present in generated database types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("tenant_comms_readiness");
      if (cancelled) return;
      // On any failure the disclosure keeps saying "Not reported" rather than
      // inferring readiness from connector presence.
      const row = error ? null : ((data as SoloCommsReadinessEvidence | null) ?? null);
      // BIND to the workspace on screen. The resolver derives its tenant server-side from the
      // session, so if that has not caught up with the client's active account the answer belongs
      // to a DIFFERENT business — discard it rather than render it here (§9). Absent is honest;
      // substituted is not.
      //
      // The match must be POSITIVE. An earlier draft read `row.tenant_id && row.tenant_id !== …`,
      // which lets a payload carrying NO tenant fall through and render — absence treated as a
      // match, which is precisely the inference this whole change exists to remove, and the exact
      // opposite of what the field's own type comment promises. Costs nothing today (the resolver
      // always emits tenant_id) and is the safe direction if it ever stops.
      setCommsReadiness(row && row.tenant_id === activeTenantId ? row : null);
    })();
    return () => { cancelled = true; };
  }, [isSolo, activeTenantId]);

  const soloChannelTruth = getSoloChannelTruth(connectors, connectorReadReported, commsReadiness);

  // keep a valid selection as threads stream in
  useEffect(() => {
    // Hold a just-composed selection until its thread arrives in dbThreads — don't clobber it
    // to visibleThreads[0] in the gap (compose selection race). Honor it the moment it lands.
    if (pendingSelectRef.current) {
      if (dbThreads.some((t) => t.thread_key === pendingSelectRef.current)) {
        const key = pendingSelectRef.current;
        pendingSelectRef.current = null;
        setSelectedKey(key);
      }
      return;
    }
    if (visibleThreads.length === 0) { if (selectedKey !== null) setSelectedKey(null); return; }
    if (!selectedKey || !visibleThreads.some((t) => t.thread_key === selectedKey)) setSelectedKey(visibleThreads[0].thread_key);
  }, [visibleThreads, selectedKey, dbThreads]);

  const selectedThread = useMemo(() => dbThreads.find((t) => t.thread_key === selectedKey) ?? null, [dbThreads, selectedKey]);
  const soloLinks = buildSoloConversationLinks(soloAccountAddress, selectedThread?.contact_id ?? null);
  const tenantRoot = tenantRoutePrefixForPath(location.pathname);
  const connectionsHref = isSolo
    ? soloLinks.connections
    : tenantRoot
      ? `${tenantRoot}/integrations`
      : "/choose-account";

  // selected view = DbThread + its loaded messages (all fields the composer/approve need)
  const selected = useMemo((): SelectedView | null => {
    if (!selectedThread) return null;
    const msgs = messagesByKey.get(selectedThread.thread_key) ?? [];
    const preview = msgs[msgs.length - 1] ?? null;
    const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");
    const lastOutbound = [...msgs].reverse().find((m) => m.direction === "outbound");
    const channel: ChannelType = preview?.channel_type ?? "email";
    const toAddress =
      selectedThread.clients?.email?.trim() ||
      lastInbound?.sender?.address?.trim() ||
      lastOutbound?.recipients?.[0]?.address?.trim() || "";
    const name = contactNameFromClient(selectedThread.clients) ||
      (preview ? partyLabel(preview.direction === "inbound" ? preview.sender : preview.recipients?.[0]) : "") || "Unknown contact";
    return {
      key: selectedThread.thread_key, dbThread: selectedThread, messages: msgs, channel, name,
      hasDraft: msgs.some(isApprovableDraft),
      contactId: selectedThread.contact_id, connectorId: preview?.connector_id ?? null, toAddress,
    };
  }, [selectedThread, messagesByKey]);

  // ── suppression read for the contact card (tenant RLS-scoped, §9) ───────────────────
  // ONE loader, guarded by a monotonic request id so the LATEST request always wins — whether
  // triggered by a selection change (the effect) or a rail DND toggle (refreshSuppressions).
  // A rail toggle changes suppressions WITHOUT changing contact_id, so the selection effect alone
  // wouldn't refresh; and without the shared guard a slow toggle-read for contact A could clobber
  // a newer read for contact B, staling the pre-send opt-out guard. The shared counter closes both
  // races cleanly (§13). Server-side pre-send remains authoritative regardless.
  const loadSuppressionsFor = useCallback(async (cid: string | null) => {
    const req = ++suppReqRef.current;
    const epoch = accountEpochRef.current.capture();
    if (epoch.account !== activeTenantId) return;
    if (!cid) { if (req === suppReqRef.current) setSuppressions([]); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data } = await sb.from("paige_suppressions").select("channel, reason").eq("contact_id", cid);
    if (req === suppReqRef.current && accountEpochRef.current.accept(epoch)) setSuppressions((data as Suppression[]) ?? []);
  }, [activeTenantId]);
  useEffect(() => { void loadSuppressionsFor(selectedThread?.contact_id ?? null); }, [selectedThread?.contact_id, loadSuppressionsFor]);
  const refreshSuppressions = useCallback(
    () => loadSuppressionsFor(selectedThread?.contact_id ?? null),
    [loadSuppressionsFor, selectedThread?.contact_id],
  );

  // Default the composer channel to the thread's channel when a connector supports it.
  useEffect(() => {
    if (!selected) return;
    const threadConnector = composerConnectors.find(
      (c) => c.id === selected.connectorId && c.channel_type === selected.channel,
    );
    const fallbackConnector = composerConnectors.find((c) => c.channel_type === selected.channel)
      ?? composerConnectors[0]
      ?? null;
    const chosenConnector = threadConnector ?? fallbackConnector;
    setComposeConnectorId(chosenConnector?.id ?? "");
    setComposeChannel(chosenConnector?.channel_type ?? "");
    setEditingDraftId(null);
    setSubject("");
    setBody("");
  }, [selectedKey, selected, composerConnectors]);
  useEffect(() => {
    if (isSolo && handlingMode === "draft" && composeChannel !== "email") setHandlingMode("human");
  }, [composeChannel, handlingMode, isSolo]);

  // Scroll the thread to the newest message on change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [selectedKey, selected?.messages.length, reduce]);

  // ── Thread-state mutations ──────────────────────────────────────────────────────────
  const optimisticThread = (id: string, patch: Partial<DbThread>) =>
    setDbThreads((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  // Each seam returns a success boolean and honors { silent } so the bulk runner (#121) can
  // reuse the EXACT same path in a loop and report honestly (§13) without per-row toast spam.
  // Single callers ignore the return + get their toast — behavior unchanged.
  type MutOpts = { silent?: boolean };
  const snoozeThread = async (id: string, until: Date | string | null, opts?: MutOpts): Promise<boolean> => {
    const epoch = accountEpochRef.current.capture();
    const iso = until == null ? null : typeof until === "string" ? until : until.toISOString();
    optimisticThread(id, { snoozed_until: iso });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("threads").update({ snoozed_until: iso }).eq("id", id);
    if (!accountEpochRef.current.accept(epoch)) return false;
    if (error) { if (!opts?.silent) toast.error("Couldn't snooze that thread."); void loadThreads(); return false; }
    if (!opts?.silent) toast.success(iso ? "Snoozed." : "Back in your inbox.");
    return true;
  };
  const archiveThread = async (id: string, on: boolean, opts?: MutOpts): Promise<boolean> => {
    const epoch = accountEpochRef.current.capture();
    const iso = on ? new Date().toISOString() : null;
    optimisticThread(id, { archived_at: iso });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("threads").update({ archived_at: iso }).eq("id", id);
    if (!accountEpochRef.current.accept(epoch)) return false;
    if (error) { if (!opts?.silent) toast.error("Couldn't update that thread."); void loadThreads(); return false; }
    if (!opts?.silent) toast.success(on ? "Archived." : "Moved to inbox.");
    return true;
  };
  // #4 delete-conversation (Option A: Archive-with-Delete-UX). The trash SOFT-ARCHIVES
  // via the §10-callable delete_conversation RPC (§39 audit row written server-side).
  // §9: JWT caller → tenant is server-derived inside the DEFINER fn; we NEVER pass
  // _tenant_id from the client. Optimistic archive locally; on error/false, reload.
  const deleteConversation = async (id: string): Promise<boolean> => {
    const epoch = accountEpochRef.current.capture();
    optimisticThread(id, { archived_at: new Date().toISOString() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("delete_conversation", { _thread_id: id });
    if (!accountEpochRef.current.accept(epoch)) return false;
    if (error || data === false) { toast.error("Couldn't remove that conversation."); void loadThreads(); return false; }
    // Definitive delete: drop it from local state NOW so it leaves the inbox immediately and the
    // selection-validity effect can't reselect it — don't wait on Realtime convergence (which the
    // active view relies on, since visibleThreads doesn't itself filter archived_at). Reversible
    // toggles (snooze/archive) keep the optimistic patch; a delete is a leave-the-list action.
    setDbThreads((prev) => prev.filter((t) => t.id !== id));
    toast.success("Conversation removed to Archive.");
    return true;
  };
  const markThreadRead = async (id: string, opts?: MutOpts): Promise<boolean> => {
    const epoch = accountEpochRef.current.capture();
    optimisticThread(id, { unread_count: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("threads").update({ unread_count: 0 }).eq("id", id);
    if (!accountEpochRef.current.accept(epoch)) return false;
    if (error) { void loadThreads(); return false; }
    return true;
  };
  const setThreadLabels = async (threadId: string, labels: Label[], opts?: MutOpts): Promise<boolean> => {
    const epoch = accountEpochRef.current.capture();
    optimisticThread(threadId, { labels });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("threads").update({ labels }).eq("id", threadId);
    if (!accountEpochRef.current.accept(epoch)) return false;
    if (error) { if (!opts?.silent) toast.error("Couldn't save labels."); void loadThreads(); return false; }
    return true;
  };
  const renameCatalogLabel = async (labelId: string, patch: Partial<Label>) => {
    const affected = dbThreads.filter((t) => (t.labels ?? []).some((l) => l.id === labelId));
    await Promise.all(affected.map((t) =>
      setThreadLabels(t.id, (t.labels ?? []).map((l) => (l.id === labelId ? { ...l, ...patch } : l)))));
  };

  const selectThread = (key: string) => {
    setSelectedKey(key);
    // The Gmail-style keyboard cursor lives in ConversationsThreadList and follows the open
    // thread there; multi-select, bulk, and keyboard nav are all list-internal now (§18).
    const t = dbThreads.find((x) => x.thread_key === key);
    if (t && t.unread_count > 0) void markThreadRead(t.id);
  };

  // Cancel a queued scheduled send (R3) — routed through the any handle (typed-RPC ratchet).
  const cancelScheduled = async (id: string) => {
    const epoch = accountEpochRef.current.capture();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("cancel_scheduled_message", { _id: id });
    if (!accountEpochRef.current.accept(epoch)) return;
    if (error || data === false) { toast.error("Too late — Paige already sent it."); return; }
    toast.success("Canceled — back to your draft."); void load(); void loadThreads();
  };

  // ── One-click approve: send the existing draft row via the single outbound seam ──
  const approveDraft = async (m: MessageRow) => {
    if (!selected) return;
    if (isSolo && !canSendInSolo(handlingMode, m.channel_type)) { toast.error("This handling mode or channel cannot send. Hand back to Human reply and use a ready email or SMS identity."); return; }
    if (!selected.toAddress) {
      toast.error("No client address on this thread to send to.");
      return;
    }
    setApprovingId(m.id);
    const epoch = accountEpochRef.current.capture();
    try {
      const { data, error } = await supabase.functions.invoke("send-message", {
        body: {
          channel: m.channel_type,
          to: selected.toAddress,
          subject: m.subject ?? undefined,
          body: m.body_html || m.body_text || "",
          contact_id: m.contact_id ?? undefined,
          thread_key: m.thread_key,
          connector_id: m.connector_id ?? undefined,
          message_id: m.id, // patch THIS draft row → sent (idempotent)
        },
      });
      if (!accountEpochRef.current.accept(epoch)) return;
      if (error) throw new Error(error.message);
      // §37: read `outcome` first so a gated/blocked approval reports the true reason.
      const res = data as { status?: string; outcome?: string; reason?: string } | null;
      const outcome = res?.outcome ?? (res?.status === "sent" ? "sent" : "failed");
      if (outcome === "sent") { toast.success("Approved — Paige sent it."); }
      else if (outcome.startsWith("blocked_")) { toast.error(res?.reason ?? "Blocked — can't message this contact."); }
      else if (outcome.startsWith("queued_")) { toast(`Held: ${res?.reason ?? "will send when allowed."}`); }
      else { throw new Error(res?.reason ?? "send_failed"); }
      void load();
    } catch (e) {
      if (!accountEpochRef.current.accept(epoch)) return;
      toast.error(e instanceof Error ? e.message : "Couldn't send the reply.");
    } finally {
      if (accountEpochRef.current.accept(epoch)) setApprovingId(null);
    }
  };

  const editDraft = (m: MessageRow) => {
    setEditingDraftId(m.id);
    setComposeChannel(m.channel_type);
    setSubject(m.subject ?? "");
    setBody(m.body_text || (m.body_html ? m.body_html.replace(/<[^>]+>/g, "") : ""));
    bottomRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  };

  // Attachment upload/remove now come from useCommsAttachments (§18 one home) — the
  // compose-new modal uploads through the identical seam, so the two can never drift.

  // ── (d) Snippet #trigger expansion on a word-boundary keystroke ─────────────────
  const handleBodyChange = useCallback((val: string) => {
    const m = /(\S+)([ \t\n])$/.exec(val); // last whitespace-terminated token
    if (m) {
      const snip = snippets.find((s) => s.trigger.toLowerCase() === m[1].toLowerCase());
      if (snip) {
        const expanded = resolveMergeVars(snip.body, mergeContext(selected, undefined, snip));
        setBody(val.slice(0, m.index) + expanded + m[2]);
        return;
      }
    }
    setBody(val);
  }, [snippets, selected]);

  // ── (e) Signature resolution (email only): user default → tenant default → none ──
  const effectiveSignature = useCallback((): Signature | null =>
    signatures.find((s) => s.user_id && s.is_default) ??
    signatures.find((s) => s.user_id === null && s.is_default) ?? null,
  [signatures]);

  const bodyWithSignature = useCallback((html: string): string => {
    const sig = effectiveSignature();
    if (composeChannel !== "email" || !appendSignature || !sig) return html;
    const rendered = resolveMergeVars(sig.html, mergeContext(selected, sig));
    return `${html}<br/><br/><hr/>${rendered}`; // divider + appended signature
  }, [composeChannel, appendSignature, effectiveSignature, selected]);

  const hasSignature = composeChannel === "email" && !!effectiveSignature();

  const resetComposer = useCallback(() => {
    setBody(""); setSubject(""); resetAttachments();
    setScheduledFor(null); setEditingDraftId(null);
  }, [resetAttachments]);

  // ── Insert a saved email template (ported from the retired ContactCommsPanel, §31) — resolves
  //    {{merge}} vars against the selected thread's contact and lands subject+body for review/edit.
  //    A fresh reply, never an edit of the passive draft row. ({{coach_name}} isn't in the thread
  //    merge context, so it drops to "" — the signature carries the sign-off, §13-honest note.) ──
  const applyTemplate = useCallback((key: string) => {
    const t = templates.find((x) => x.template_key === key);
    if (!t) return;
    const ctx = mergeContext(selected);
    setEditingDraftId(null);
    setSubject(resolveMergeVars(t.subject ?? "", ctx));
    setBody(resolveMergeVars(t.body_markdown || (t.body_html ? t.body_html.replace(/<[^>]+>/g, "") : ""), ctx));
  }, [templates, selected]);

  const applySnippet = useCallback((id: string) => {
    const snippet = snippets.find((item) => item.id === id);
    if (!snippet) return;
    const expanded = resolveMergeVars(snippet.body, mergeContext(selected, undefined, snippet));
    setBody((current) => current ? `${current}${current.endsWith("\n") ? "" : "\n"}${expanded}` : expanded);
  }, [selected, snippets]);

  // ── (b)+(c) ONE send body builder + ONE dispatch that reads outcome (§37) ────────
  const buildSendBody = useCallback((overrides: { scheduled_for?: string } = {}) => {
    const conn = composerConnectors.find((c) => c.id === composeConnectorId && c.channel_type === composeChannel) ?? null;
    if (!conn) throw new Error("Choose an active sending address.");
    const html = composeChannel === "email" ? bodyWithSignature(body.trim()) : body.trim();
    return {
      channel: composeChannel,
      to: selected!.toAddress,
      subject: composeChannel === "email" ? subject.trim() : undefined,
      body: html,
      contact_id: selected!.contactId ?? undefined,
      thread_key: selected!.key,
      connector_id: conn.id,
      message_id: editingDraftId ?? undefined,
      attachments: attachments.length ? attachments : undefined,      // contract §2
      ...(overrides.scheduled_for ? { scheduled_for: overrides.scheduled_for } : {}),
    };
  }, [composeChannel, composeConnectorId, composerConnectors, bodyWithSignature, body, selected, subject,
      editingDraftId, attachments]);

  const dispatchSend = useCallback(async (overrides: { scheduled_for?: string } = {}) => {
    const { data, error } = await supabase.functions.invoke("send-message", { body: buildSendBody(overrides) });
    if (error) throw new Error(error.message);
    // R7-outcome via the ONE shared parser (inbox-shared) — the compose-new modal reads the
    // send result through the exact same helper, so reply and compose can never drift (§18/§37).
    const r = readSendResult(data);
    return { outcome: r.outcome, reason: r.reason, messageId: r.messageId, scheduledFor: r.scheduledFor };
  }, [buildSendBody]);

  const cancelUndo = useCallback(async (messageId: string) => {
    const epoch = accountEpochRef.current.capture();
    // R4: cancel through the any handle so the typed-RPC ratchet doesn't break tsc.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("cancel_scheduled_message", { _id: messageId });
    if (!accountEpochRef.current.accept(epoch)) return;
    if (error || data === false) { toast.error("Too late — Paige already sent it."); return; }
    toast.success("Undone — back to your draft.");
    setUndo(null); void load();
  }, [load]);

  // ── "Draft with Paige": ask the email-composer sub-agent to draft a reply on demand ──
  // Reads the thread's last inbound message as context (§36 one-click) + optional guide/tone.
  // Lands the draft in the composer for review/edit/send — never auto-sends (§36 draft-first).
  const draftWithPaige = useCallback(async ({ guide, tone }: { guide: string; tone: DraftTone }) => {
    if (!selected) return;
    // §13: never silently discard the coach's typed reply. Only draft into an empty body.
    if (body.trim()) {
      toast.error("You've already started a reply — clear it first to draft with Paige.");
      return;
    }
    setDrafting(true);
    const epoch = accountEpochRef.current.capture();
    setDraftFlags([]);
    // #176 — the document(s) the coach wants Paige to consider are the attachments STAGED
    // into this composer (guaranteed comms-attachments object paths `${tenantId}/…`, so the
    // server's §9 prefix guard can enforce them). Inbound provider-hosted attachments are
    // remote URLs, not storage objects — out of scope for this path (honest caveat).
    const attachmentPaths = attachments.map((a) => a.url).filter((u): u is string => !!u);
    setDraftReadingDoc(attachmentPaths.length > 0);
    try {
      // §36 context: the client's most recent inbound message (capped so a long thread
      // doesn't blow the prompt budget — verifier #6).
      const lastInbound = [...selected.messages].reverse().find((m) => m.direction === "inbound");
      const lastText = lastInbound ? bodyPreview(lastInbound).slice(0, 1500) : "";

      const { data, error } = await supabase.functions.invoke("subagent-email-composer", {
        body: {
          input: {
            intent: guide.trim() || "Write a reply to the client's most recent message in this conversation.",
            tone,
            length: "medium",
            key_points: [lastText ? `Client's last message: ${lastText}` : ""].filter(Boolean),
            contact_id: selected.contactId ?? undefined,
            recipient_name: selected.name || undefined,
            recipient_email: selected.toAddress || undefined,
            format: "html",
            // Only send when present; the server §9-guards each path against the caller's tenant.
            attachment_paths: attachmentPaths.length ? attachmentPaths : undefined,
          },
          context: { contact_id: selected.contactId ?? undefined },
        },
      });
      if (!accountEpochRef.current.accept(epoch)) return;
      // §13/§36 honest error: a non-2xx (compliance_blocked 422, reviewer_unavailable/timeout 503)
      // returns FunctionsHttpError whose `.message` is the generic "non-2xx status code" — the REAL
      // reason (summary/error) is in `.context`. Surface that so the coach knows to revise, never a
      // dev-tool leak.
      if (error) {
        let msg = "Paige couldn't draft that — try again.";
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = await (error as any).context?.json?.();
          if (b?.summary || b?.error) msg = b.summary ?? b.error;
        } catch { /* keep the friendly default */ }
        throw new Error(msg);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const draft = (data as any)?.draft ?? data;
      const text = draft?.body_text || (draft?.body_html ? String(draft.body_html).replace(/<[^>]+>/g, "") : "");
      if (!text.trim()) throw new Error("Paige returned an empty draft.");

      // Fresh reply — not an edit of the passive draft row (verifier #4): clear any edit binding
      // so Send dispatches a NEW message, not an update to a stale draft.
      setEditingDraftId(null);
      if (draft?.subject && !subject.trim()) setSubject(draft.subject);
      setBody(text);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setDraftFlags(((data as any)?.compliance_flags ?? []) as string[]);
      // §13 honesty (critic): don't let a generic "drafted" success imply the attachment was
      // used when it wasn't. Compare what the server actually READ to what was staged — if a
      // staged doc couldn't be read, say so plainly instead of claiming "Reading attachment…".
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const readCount = Number((data as any)?.attachments_read ?? 0);
      if (attachmentPaths.length > 0 && readCount < attachmentPaths.length) {
        const missed = attachmentPaths.length - readCount;
        toast.warning(
          readCount === 0
            ? "Paige drafted a reply, but couldn't read the attached file — review before you send."
            : `Paige drafted a reply, but couldn't read ${missed} of the attached files — review before you send.`,
        );
      } else {
        toast.success("Paige drafted a reply — review before you send.");
      }
    } catch (e) {
      if (!accountEpochRef.current.accept(epoch)) return;
      toast.error(e instanceof Error ? e.message : "Paige couldn't draft that — try again.");
    } finally {
      if (accountEpochRef.current.accept(epoch)) {
        setDrafting(false);
        setDraftReadingDoc(false);
      }
    }
  }, [selected, body, subject, attachments]);

  // ── Send a fresh reply (or an edited draft) into the selected thread ──────────────
  const send = async () => {
    if (!selected) return;
    if (isSolo && !canSendInSolo(handlingMode, composeChannel)) { toast.error("This handling mode or channel cannot send. Hand back to Human reply and use a ready email or SMS identity."); return; }
    if (isSolo && !selected.contactId) { toast.error("Associate this participant with a client before sending."); return; }
    if (!composeChannel) { toast.error("Connect a channel first — Paige needs a way to send."); return; }
    if (!selected.toAddress) { toast.error("No client address on this thread to send to."); return; }
    if (!body.trim()) { toast.error("Write a reply first."); return; }
    if (composeChannel === "email" && !subject.trim()) { toast.error("Add a subject for the email."); return; }
    if (attachments.length > 10) { toast.error("Remove attachments until 10 or fewer remain."); return; }
    // R-HIGH3: truthful pre-send guard — never enqueue for a contact who opted out of this channel.
    const blocked = suppressions.find((s) => s.channel === composeChannel);
    if (blocked) { toast.error(`This contact opted out of ${CHANNEL_LABEL[composeChannel]} — Paige won't send.`); return; }

    const activeSend = sendInFlightRef.current;
    if (activeSend && accountEpochRef.current.accept(activeSend)) return;
    const epoch = accountEpochRef.current.capture();
    sendInFlightRef.current = epoch;
    setSending(true);
    try {
      // Default path = undo-send: queue 30s out so the toast's Undo can cancel before delivery.
      const iso = scheduledFor ?? new Date(Date.now() + UNDO_WINDOW_MS).toISOString();
      const r = await dispatchSend({ scheduled_for: iso });
      if (!accountEpochRef.current.accept(epoch)) return;

      if (r.outcome === "queued_scheduled") {
        if (scheduledFor) {
          toast.success(`Scheduled for ${new Date(scheduledFor).toLocaleString()}.`);
          resetComposer();
        } else if (r.messageId) {
          const id = r.messageId;
          setUndo({ messageId: id, expiresAt: Date.now() + UNDO_WINDOW_MS });
          toast("Sending…", {
            action: {
              label: "Undo",
              onClick: () => {
                if (accountEpochRef.current.accept(epoch)) void cancelUndo(id);
              },
            },
            duration: UNDO_WINDOW_MS,
          });
          resetComposer();
        } else {
          // R6: queued with no message_id, undo unavailable — ack + reset, never a silent stuck box.
          toast.success("Sending…"); resetComposer();
        }
      } else if (r.outcome === "sent") {
        toast.success("Sent."); resetComposer();
      } else if (r.outcome.startsWith("blocked_")) {
        toast.error(r.reason ?? "Blocked — can't message this contact.");
      } else if (r.outcome.startsWith("queued_")) {
        toast(`Held: ${r.reason ?? "Paige will send when it's allowed."}`); resetComposer();
      } else {
        throw new Error(r.reason ?? "send_failed");
      }
      void load();
    } catch (e) {
      if (!accountEpochRef.current.accept(epoch)) return;
      toast.error(e instanceof Error ? e.message : "Couldn't send.");
    } finally {
      if (sendInFlightRef.current?.account === epoch.account && sendInFlightRef.current?.epoch === epoch.epoch) {
        sendInFlightRef.current = null;
      }
      if (accountEpochRef.current.accept(epoch)) setSending(false);
    }
  };

  const noChannel = composerConnectors.length === 0;
  // send-message only handles email|sms today, so "New conversation" needs a SENDABLE channel.
  // A whatsapp-only tenant HAS a connector (noChannel=false) but the compose modal would be a
  // dead-end — gate the CTA on a real sendable channel, not merely any channel (§13/§43).
  const canCompose = sendableConnectors.length > 0;

  // The GENUINE first-run zero-state (§36): the account has no threads at all AND nothing is
  // narrowing the view — no active search, no label filter, the default "active" view. Only then
  // do we show the one guided FirstRunOnboarding surface. A search-no-match or a filtered/archived/
  // snoozed empty keeps its own dedicated EmptyState inside the rail/pane (untouched below).
  const isFirstRun =
    threadsReady && !loading && !searching &&
    accountHasThreads === false &&   // UNFILTERED — no threads in ANY state, not just this view
    matchedKeys === null &&
    search.trim() === "" &&
    view === "active" &&
    labelFilter === null;

  // ── Shell wiring (§18 extract-not-fork): normalize the tenant's threads / messages /
  //    connectors + existing seams onto the scope-adapter the extracted three-column shell
  //    consumes. Every tenant capability is ON — this is the full-fidelity tenant scope. ─────
  const capabilities: ConversationsCapabilities = {
    canDraftWithPaige: true,
    canSchedule: true,
    hasTemplates: true,
    hasSignature: true,
    hasAttachments: true,
    hasContactBusinessPanels: true,
  };

  // visibleThreads (DbThread, already view+label+search filtered) → the shell's normalized shape.
  // `raw` hands each row's DbThread straight back to renderRow so the EXISTING ThreadRow renders
  // at full fidelity (§13/§37 zero regression). Fields mirror what ThreadRow itself resolves.
  const shellThreads: ShellThread<DbThread>[] = visibleThreads.map((t) => {
    const p = previewByKey.get(t.thread_key) ?? null;
    return {
      id: t.id,
      key: t.thread_key,
      title:
        contactNameFromClient(t.clients) ||
        (p ? partyLabel(p.direction === "inbound" ? p.sender : p.recipients?.[0]) : "") ||
        "Unknown contact",
      lastPreview: p ? (bodyPreview(p) || p.subject || "") : "",
      unread: t.unread_count,
      lastMessageAt: t.last_message_at,
      lastDirection: t.last_direction,
      labels: t.labels ?? [],
      snoozedUntil: t.snoozed_until,
      archivedAt: t.archived_at,
      channel: p?.channel_type ?? "email",
      hasDraft: !!p && isApprovableDraft(p),
      scheduled: p?.status === "queued" && !!p.scheduled_for,
      raw: t,
    };
  });

  // LEFT-rail list model — the container owns the DATA (server state filter, view predicate,
  // label filter, search matched-keys, the thread mutators); the list owns the PRESENTATION
  // (sort, density, select-all, multi-select, Gmail keyboard cursor, bulk toolbar). renderRow
  // reuses the EXISTING ThreadRow verbatim (its SnoozeMenu/LabelPopover intact) so the rich row
  // never changed (§37). resetKey bumps on view/label/search → the list resets selection + cursor.
  const listModel: ConversationsListModel<DbThread> = {
    threads: shellThreads,
    loading,
    searching,
    search,
    onSearch: setSearch,
    matchedEmpty: matchedKeys?.size === 0,
    selectedKey,
    onSelect: selectThread,
    onOpenFocus: () => paneRef.current?.focus(),
    snooze: snoozeThread,
    archive: archiveThread,
    markRead: markThreadRead,
    setLabels: setThreadLabels,
    labelCatalog,
    resetKey: `${view}|${labelFilter ?? ""}|${search}`,
    renderRow: (t, ctx) => (
      <ThreadRow
        key={t.id}
        thread={t.raw}
        preview={previewByKey.get(t.key) ?? null}
        channel={previewByKey.get(t.key)?.channel_type ?? "email"}
        active={ctx.active}
        cursored={ctx.cursored}
        onClick={ctx.onClick}
        catalog={labelCatalog}
        onSnooze={snoozeThread}
        onArchive={archiveThread}
        onSetThreadLabels={setThreadLabels}
        onRenameCatalogLabel={renameCatalogLabel}
        density={ctx.density}
        selected={ctx.selected}
        selectionActive={ctx.selectionActive}
        onToggleSelect={ctx.onToggleSelect}
        needsAttention={isSolo && needsAttention(t.raw, messagesByKey.get(t.key) ?? [], Date.now())}
      />
    ),
    renderFilters: () => (
      <ThreadFilters
        view={view} onView={setView} activeUnread={activeUnread} foldedPending={foldedPending}
        catalog={labelCatalog} labelFilter={labelFilter} onLabelFilter={setLabelFilter}
        soloAttention={isSolo}
      />
    ),
    // §43 — start a NEW outbound thread (gold on the act, §11). With no sendable channel this is
    // NOT a dead disabled button — it routes to setup (§31 no dead-end; §36 the label tells a
    // non-technical coach exactly what to do). The first-run surface owns its own gold act.
    renderNewConversation: () =>
      !canCompose ? (
        <Button variant="gold" size="sm" className="w-full" asChild>
          <Link to={connectionsHref}>
            <PlugZap className="mr-1.5 h-4 w-4" /> Connect a channel
          </Link>
        </Button>
      ) : (
        <Button variant="gold" size="sm" className="w-full" onClick={() => setComposeOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New conversation
        </Button>
      ),
    // The view-dependent empty (archived / snoozed / active + connect CTA). The shell renders the
    // loading skeleton and the search-no-match state itself; this fills the "rows in no view" slot.
    renderEmpty: () => (
      <EmptyState
        icon={Inbox} tone="brand"
        title={view === "archived" ? "Nothing archived." : view === "snoozed" ? "Nothing snoozed." : "No conversations yet."}
        description={
          view === "active"
            ? !canCompose
              ? isSolo
                ? "Connect a ready email or SMS identity in Settings. Inbound capability and PAIGE drafting remain channel-specific until reported ready."
                : "Connect an email or SMS channel and the moment a client reaches out, their thread lands here — with Paige's draft reply ready for your approval."
              : isSolo
                ? "Start a conversation with a ready email or SMS identity. PAIGE can prepare editable email drafts; you remain the sender."
                : "Start a new conversation, or the moment a client reaches out their thread lands here — with Paige's draft reply ready for your approval."
            : "When you snooze or archive a conversation, it shows up here."
        }
        action={
          view === "active"
            ? canCompose
              ? (
                // Secondary (outline), not gold — the always-visible left-rail "New conversation"
                // at the top of this column is the ONE gold compose act (§11).
                <Button variant="outline" size="sm" onClick={() => setComposeOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> New conversation
                </Button>
              )
              : (
                <Button variant="outline" size="sm" asChild>
                  <Link to={connectionsHref}>Connect a channel</Link>
                </Button>
              )
            : undefined
        }
        className="py-10"
      />
    ),
  };

  // Composer model — the container keeps ALL substantive values + seams (body, subject,
  // scheduledFor, attachments, drafting, send/draft/schedule); ConversationsRichComposer owns
  // only the transient popover state. Templates stay EMAIL-only (empty list on SMS) to preserve
  // the shipped gating without widening the static capability flag (§37). Dictation feeds THROUGH
  // handleBodyChange (via bodyRef, no stale closure) so #trigger snippet expansion still runs.
  const uploadComposerFiles = (files: FileList | File[]) => {
    if (attachments.length + Array.from(files).length > 10) {
      toast.error("Attach no more than 10 files to one message.");
      return;
    }
    void uploadFiles(files);
  };

  const composerModel: ConversationsComposerModel | null = selected ? {
    capabilities: { ...capabilities, canSchedule: capabilities.canSchedule && !(isSolo && handlingMode === "governed") },
    value: body,
    onChange: handleBodyChange,
    onSend: send,
    sending,
    disabled: drafting || uploading || (isSolo && handlingMode === "governed"),
    sendDisabled: isSolo && (
      !canSendInSolo(handlingMode, composeChannel)
      || !composeChannel
      || !selected.contactId
      || !selected.toAddress
      || !body.trim()
      || (composeChannel === "email" && !subject.trim())
      || attachments.length > 10
      || suppressions.some((suppression) => suppression.channel === composeChannel)
    ),
    sendOnEnter: isSolo,
    placeholder: `Reply to ${selected.name}…  (drop a file to attach)`,
    rows: 2,
    sendLabel: scheduledFor ? "Schedule" : editingDraftId ? "Send edited" : "Send",
    note: selected.toAddress ? `To ${selected.toAddress}` : "No address on this thread",
    textareaClassName: "h-24 min-h-24 max-h-24",
    identities: composerConnectors.map((c) => ({
      id: c.id,
      label: c.display_name?.trim() || CHANNEL_LABEL[c.channel_type],
      sublabel: c.from_address,
      channel: c.channel_type,
    })),
    identityId: composeConnectorId,
    onIdentityChange: (id) => {
      const connector = composerConnectors.find((c) => c.id === id);
      setComposeConnectorId(id);
      setComposeChannel(connector?.channel_type ?? "");
    },
    showSubject: composeChannel === "email",
    subject,
    onSubjectChange: setSubject,
    attachments,
    uploading,
    onAttachFiles: uploadComposerFiles,
    onRemoveAttachment: (a) => void removeAttachment(a),
    showDraftWithPaige: composeChannel === "email",
    onDraftWithPaige: ({ guide, tone }) => void draftWithPaige({ guide, tone }),
    drafting,
    draftReadingDoc,
    draftFlags,
    canDraft: !!selected.toAddress,
    templates: composeChannel === "email" ? templates : [],
    onApplyTemplate: applyTemplate,
    snippets: isSolo ? snippets : [],
    onApplySnippet: applySnippet,
    showCombinedInsert: isSolo,
    signatureAvailable: hasSignature,
    appendSignature,
    onToggleSignature: () => setAppendSignature((s) => !s),
    scheduledFor,
    onSchedule: isSolo && handlingMode === "governed" ? undefined : setScheduledFor,
    showDictation: true,
    dictationScopeEpoch: `${activeTenantId ?? "resolving"}|${selected.key}|${editingDraftId ?? "new-reply"}`,
    onDictate: (seg) => handleBodyChange(appendDictation(bodyRef.current, seg)),
    onDictateError: (msg) => toast.error(msg),
    editingDraft: !!editingDraftId,
    onCancelEdit: resetComposer,
    dragOver,
    onDropFiles: uploadComposerFiles,
    onDragOverZone: () => setDragOver(true),
    onDragLeaveZone: () => setDragOver(false),
  } : null;

  // RIGHT rail — the rich tenant ContactCardRail, reused UNCHANGED as a pass-through (§37). Two
  // instances differ only by onClose target (desktop rail toggle vs mobile Sheet).
  const contactPanelDesktop: ConversationsContactPanelModel | null = selected ? {
    hasContactBusinessPanels: true,
    renderRich: () => (
      <ContactCardRail
        contact={selectedThread?.clients ?? null}
        channel={selected.channel}
        toAddress={selected.toAddress}
        recentMessages={selected.messages}
        labels={selectedThread?.labels ?? []}
        suppressions={suppressions}
        userId={userId}
        tenantId={tenantIdRef.current}
        onClose={() => setRailOpen(false)}
        onChanged={() => { void load(); void loadThreads(); void refreshSuppressions(); }}
      />
    ),
  } : null;
  const contactPanelMobile: ConversationsContactPanelModel | null = selected ? {
    hasContactBusinessPanels: true,
    renderRich: () => (
      <ContactCardRail
        contact={selectedThread?.clients ?? null}
        channel={selected.channel}
        toAddress={selected.toAddress}
        recentMessages={selected.messages}
        labels={selectedThread?.labels ?? []}
        suppressions={suppressions}
        userId={userId}
        tenantId={tenantIdRef.current}
        onClose={() => setContactDrawerOpen(false)}
        onChanged={() => { void load(); void loadThreads(); void refreshSuppressions(); }}
      />
    ),
  } : null;
  const soloClientContext = (
    <SoloClientContextPane
      contact={selectedThread?.clients ?? null}
      labels={selectedThread?.labels ?? []}
      recentMessages={selected?.messages ?? []}
      links={soloLinks}
    />
  );

  // ── call capability for the open thread (Phase 4) — the tenant dials the contact's phone on the
  //    SAME shared Device (§18) via the tenant voice token path. §13: no fake dial — the button
  //    disables with an honest tooltip when there's no phone on file or voice reports needs_config. ──
  const tenantVoiceReady = !!voice && voice.status !== "needs_config";
  const callDestination = selected?.dbThread.clients?.phone ?? null;
  const placeTenantCall = (destination: string) => { voice?.callFrom(destination); };

  // MIDDLE pane — container-owned (it carries the tenant's draft-card MessageBubble wrapper + the
  // thread-header quick actions + the composer). Passed to the shell as the `activeThread` slot.
  const activeThread = (
    <SectionCard padded={false} bodyClassName="flex min-h-0 flex-1 flex-col" className="flex min-h-0 flex-col overflow-hidden">
      {isSolo && loadFailure ? (
        <div className="grid flex-1 place-items-center p-4" role="alert">
          <EmptyState
            icon={AlertTriangle}
            tone="muted"
            title={/permission|denied|rls|403/i.test(loadFailure) ? "Conversation access is limited" : "Conversations couldn't load"}
            description={/permission|denied|rls|403/i.test(loadFailure)
              ? "This account has not granted access to the conversation data requested. Existing account context stays in place."
              : "The current account remains selected. Retry without switching accounts or clearing the workspace."}
            action={<Button variant="outline" size="sm" disabled={retrying} onClick={() => void retryConversations()}>{retrying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Retry</Button>}
          />
        </div>
      ) : !selected ? (
        <div className="grid flex-1 place-items-center">
          <EmptyState
            icon={MessageCircle}
            tone="brand"
            title="Your unified inbox."
            description="Pick a conversation on the left to read the thread and approve Paige's drafted reply. One thread per client, so nothing gets missed."
          />
        </div>
      ) : (
        <>
          {/* Thread header — also the focus target when Enter is pressed in the rail (#121). */}
          <div
            ref={paneRef}
            tabIndex={-1}
            className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))]"
          >
            <ChannelGlyph channel={selected.channel} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{selected.name}</p>
              <p className="truncate text-[11px] text-muted-foreground select-text">
                {CHANNEL_LABEL[selected.channel]}{selected.toAddress ? ` · ${selected.toAddress}` : ""}
              </p>
            </div>
            {/* #482 Phase-2 — thread-level quick actions promoted to the open-thread header
                (§18 reuse: the same SnoozeMenu/LabelPopover already wired on the list rows), so
                label / snooze / archive / remind are reachable without hovering a row. All
                icon-only ghost buttons; gold stays on Send/Approve (§11). */}
            <div className="flex items-center gap-1">
              {/* CALL act — gold (§11, a distinct primary act like Send/Approve). Shared
                  ConversationsCallButton, adapter-driven; disabled with an honest tooltip when the
                  contact has no phone on file or voice isn't provisioned (§13 — no blind dial). */}
              <ConversationsCallButton
                hasVoiceCalling={tenantVoiceReady}
                destination={callDestination}
                onPlaceCall={placeTenantCall}
                unavailableReason={voice?.reason ?? "Calling isn’t set up for this practice yet."}
                iconOnly
                className="mr-0.5"
              />
              <LabelPopover
                thread={selected.dbThread} catalog={labelCatalog}
                onSetThreadLabels={setThreadLabels} onRenameCatalogLabel={renameCatalogLabel}
              />
              <SnoozeMenu thread={selected.dbThread} onSnooze={snoozeThread} onArchive={archiveThread} />
              {userId && selected.contactId && (
                <QuickAddDialog
                  userId={userId}
                  contactId={selected.contactId}
                  contactName={selected.name}
                  defaultKind="reminder"
                  onCreated={() => toast.success("Reminder set.")}
                  trigger={
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      aria-label="Set a reminder about this contact"
                    >
                      <Bell className="h-4 w-4" />
                    </Button>
                  }
                />
              )}
              {/* #4 delete-conversation — trash sits where GHL users expect it, in the thread
                  header (§36). Soft-archive via the RPC; destructive/red confirm, NEVER gold (§11). */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the conversation from your inbox. It stays in your Archive, where you can restore it anytime.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={async () => {
                        const ok = await deleteConversation(selected.dbThread.id);
                        if (ok) setSelectedKey(null);
                      }}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            {selected.hasDraft && <StatePill state="building">Draft ready</StatePill>}
            {!isSolo && <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] xl:hidden"
              onClick={() => setContactDrawerOpen(true)}
              aria-label="Show contact details"
            >
              <PanelRight className="h-4 w-4" />
            </Button>}
            {!isSolo && !railOpen && (
              <Button
                variant="ghost" size="icon"
                className="hidden h-7 w-7 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] xl:inline-flex"
                onClick={() => setRailOpen(true)} aria-label="Show contact panel"
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            )}
          </div>

          {isSolo && (
            <SoloConversationOperatingBarWithPaige
              mode={handlingMode}
              onModeChange={setHandlingMode}
              channels={soloChannelTruth}
              activeChannel={composeChannel || selected.channel}
              canDraftWithPaige={composeChannel === "email" && !!selected.toAddress && sendableConnectors.some((connector) => connector.id === composeConnectorId && connector.channel_type === "email")}
              connectionsHref={connectionsHref}
              selectedClientName={selected.name}
              selectedThreadLabel={`${CHANNEL_LABEL[selected.channel]} · ${selected.toAddress || "recipient not reported"}`}
            />
          )}

          {/* Messages (chronological) */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {selected.messages.map((m) =>
              reduce ? (
                <MessageBubble
                  key={m.id}
                  m={m}
                  onApprove={approveDraft}
                  onEdit={editDraft}
                  onCancelScheduled={cancelScheduled}
                  approving={approvingId === m.id}
                  sendDisabled={isSolo && handlingMode === "governed"}
                />
              ) : (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <MessageBubble
                    m={m}
                    onApprove={approveDraft}
                    onEdit={editDraft}
                    onCancelScheduled={cancelScheduled}
                    approving={approvingId === m.id}
                    sendDisabled={isSolo && handlingMode === "governed"}
                  />
                </motion.div>
              ),
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer — converged onto the shared MessageComposer atom via the extracted
              ConversationsRichComposer (§18/§6): the tenant's full affordance cluster injects
              through the shell's capability-gated slots; gold is spent once, on its Send act
              (the only other earned gold is the draft card's "Approve & send", kept tenant-side
              above). No sendable channel → the connect CTA replaces the composer entirely. */}
          <div className="mt-auto">
            {noChannel ? (
              <div className="border-t border-border/60 bg-muted/30 px-3 py-2">
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]" />
                    <span>{isSolo
                      ? "Connect a ready email or SMS identity in Settings. Connection alone does not prove send permission, inbound capability, A2P, or operational health."
                      : "Connect a channel and Paige sends from here — inbound messages start landing in this inbox once a channel is live."}</span>
                  </p>
                  {/* Secondary connect CTA → outline, so it never becomes a SECOND gold
                      "Connect a channel" co-visible with the rail-top gold one (§11 gold budget). */}
                  <Button variant="outline" size="sm" asChild className="shrink-0 self-start sm:self-auto">
                    <Link to={connectionsHref}>
                      <PlugZap className="mr-1.5 h-4 w-4" /> Connect a channel
                    </Link>
                  </Button>
                </div>
              </div>
            ) : composerModel ? (
              <ConversationsRichComposer {...composerModel} />
            ) : null}
          </div>
        </>
      )}
    </SectionCard>
  );
  const composeEpoch = accountEpochRef.current.capture();

  return (
    <PageShell width="full" fill className={cn("lg:flex-1 lg:overflow-hidden", isSolo && "solo-conversations-page-shell")}>
      <h1 className="sr-only">Conversations</h1>
      {/* The three-column conversation shell (§18 one home) — pure layout: the §36 first-run
          swap, the railOpen 3↔2-col toggle, and the mobile contact Sheet. The container feeds it
          the rendered LEFT rail, the container-owned MIDDLE pane, and the RIGHT contact panel. */}
      {isSolo ? (
        <SoloConversationsWorkspace
          firstRun={
            <EmptyState
              icon={MessageCircle}
              tone="brand"
              title="No conversations yet"
              description={canCompose
                ? "Start with a ready email or SMS identity. PAIGE email drafts stay editable and never send without you."
                : "Connect and verify an email or SMS identity in Settings. Readiness is reported separately for each channel."}
              action={canCompose
                ? <Button variant="gold" size="sm" onClick={() => setComposeOpen(true)}><Plus className="mr-1.5 h-4 w-4" />New conversation</Button>
                : <Button variant="outline" size="sm" asChild><Link to={connectionsHref}>Open Connections</Link></Button>}
            />
          }
          showFirstRun={isFirstRun && !loadFailure}
          threadList={<ConversationsThreadList {...listModel} />}
          activeThread={activeThread}
          clientContext={soloClientContext}
          hasSelection={!!selected}
        />
      ) : <ConversationsThreeColumnShell
        firstRun={
          <FirstRunOnboarding
            canCompose={canCompose}
            onCompose={() => setComposeOpen(true)}
            connectHref={connectionsHref}
          />
        }
        showFirstRun={isFirstRun}
        threadList={<ConversationsThreadList {...listModel} />}
        activeThread={activeThread}
        contactPanel={contactPanelDesktop ? <ConversationsContactPanel {...contactPanelDesktop} /> : undefined}
        mobileContactPanel={contactPanelMobile ? <ConversationsContactPanel {...contactPanelMobile} /> : undefined}
        hasSelection={!!selected}
        railOpen={railOpen}
        mobileSheetOpen={contactDrawerOpen}
        onMobileSheetOpenChange={setContactDrawerOpen}
        mobileSheetTitle={selected?.name}
      />}

      {/* §43 — compose a NEW outbound thread (reuses the send-message seam + canonical
          thread key so it merges cleanly with any later inbound reply). */}
      <ComposeThreadDialog
        open={composeOpen}
        onOpenChange={(v) => { setComposeOpen(v); if (!v) setComposeContact(null); }}
        activeConnectors={composerConnectors}
        tenantId={tenantIdRef.current}
        initialContact={composeContact ?? undefined}
        emailTemplates={templates}
        onSent={(key) => {
          if (!accountEpochRef.current.accept(composeEpoch)) return;
          // §36 proactive surfacing: drop any filter that would hide the just-created thread,
          // then reload. pendingSelectRef holds the pick until the new row streams in, so the
          // keep-valid-selection guard can't clobber it to visibleThreads[0] first (race fix).
          pendingSelectRef.current = key;
          setView("active"); setLabelFilter(null); setSearch("");
          void load(); void loadThreads();
          // Safety valve (§13): if the composed thread never streams in (e.g. a swallowed insert
          // on the send path returning success with no message row), don't freeze auto-selection
          // forever — after a bounded wait, release the hold and re-pull so the keep-valid guard
          // resumes its normal path. Guarded on the same key so a resolved/superseded pick is untouched.
          window.setTimeout(() => {
            if (pendingSelectRef.current === key) { pendingSelectRef.current = null; void loadThreads(); }
          }, 12_000);
        }}
      />
    </PageShell>
  );
}
