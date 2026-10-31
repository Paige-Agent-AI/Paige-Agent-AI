// conversationsAdapter — the ONE scope-agnostic contract every conversation container
// implements (§18 extract-not-fork). The three-column conversation SHELL
// (ConversationsThreeColumnShell · ConversationsThreadList · ConversationsRichComposer ·
// ConversationsContactPanel) is driven ENTIRELY by this interface, so a single shell serves
// BOTH the tenant Client-Hub inbox (ClientsConversations, reading messages/threads +
// channel_connectors) AND the operator Fleet Communications inbox (PlatformFleetCommunications,
// reading operator_conversations/operator_messages via is_platform_owner()) without the shell
// ever knowing WHICH scope it is (§9/§51 — the operator adapter never reads a tenant's data;
// the tenant adapter never reads the operator store).
//
// The contract expresses ONLY what the shell needs — a normalized thread list, a normalized
// message list, the sending-identity list, action callbacks, and capability FLAGS — with zero
// tenant/operator specifics. A scope turns off what it lacks via the flags; the shell renders
// nothing scope-aware on its own. Scope-specific rendering (the tenant's rich ThreadRow /
// ThreadFilters / ContactCardRail, the operator's minimal row / contact panel) enters through
// explicit render slots so a container reuses its EXISTING components unchanged — the refactor
// is thin adapter wiring, never a rewrite (§13/§37 zero regression).
//
// §11: token-only, gold spent only on the act (Send / New-conversation), motion-safe.
import type { ReactNode } from "react";
import type {
  ChannelType, Direction, Label, Attachment, EmailTemplate, Density,
} from "../inbox-shared";

// ── shared option types ───────────────────────────────────────────────────────────────
/** Every mutator honors { silent } so the bulk runner reuses the EXACT same seam in a loop
 *  and reports honestly (§13) without per-row toast spam. Single callers omit it + get a toast. */
export interface MutOpts { silent?: boolean }

/** A sending identity, normalized. Tenant: one per active channel_connectors row
 *  (label = display name, sublabel = from_address). Operator: the single master A2P
 *  identity. The shell renders a picker when there is more than one and `showIdentity`
 *  is not false; a single identity renders as a static line. */
export interface SendingIdentity {
  id: string;
  label: string;
  sublabel?: string | null;
  channel: ChannelType;
}

// ── normalized thread (data-source-agnostic) ───────────────────────────────────────────
/**
 * The shell's own generic logic (sort · search-match · keyboard nav · multi-select · bulk)
 * reads ONLY these normalized fields. Each thread also carries `raw` — the scope's own row
 * (tenant DbThread, operator OperatorConversation) — handed straight back to `renderRow` so
 * the container renders its EXISTING row component at full fidelity (§18/§13). `TRaw` keeps
 * that pass-through type-safe end to end.
 */
export interface ShellThread<TRaw = unknown> {
  /** Stable DB id — every mutator (snooze/archive/markRead/setLabels) keys on THIS. */
  id: string;
  /** thread_key — the selection + keyboard-nav + search-match key (distinct from `id`). */
  key: string;
  /** Resolved display name (contact name, else the preview party) — sort "Name (A–Z)" uses it. */
  title: string;
  /** Last-message preview text for the row + the operator minimal panel. */
  lastPreview: string;
  unread: number;
  lastMessageAt: string | null;
  lastDirection: Direction | null;
  labels: Label[];
  snoozedUntil: string | null;
  archivedAt: string | null;
  channel: ChannelType;
  /** A Paige draft sits in this thread (drives the row's "Draft ready" pill). */
  hasDraft: boolean;
  /** A queued scheduled outbound sits in this thread. */
  scheduled: boolean;
  raw: TRaw;
}

/** A normalized message for the middle pane's own rendering + the minimal contact panel's
 *  "recent" list. The tenant middle pane still renders its rich MessageBubble/draft-card
 *  wrapper off the raw row; this normalized shape is what the SHELL-owned surfaces read. */
export interface ShellMessage {
  id: string;
  direction: Direction;
  body: string;
  status: string;
  timestamp: string | null;      // sent_at ?? created_at
  channelType: ChannelType;
  subject?: string | null;
  attachments?: Attachment[] | null;
  error?: string | null;
  // Phase 4 call fields — surfaced INLINE in the thread when channelType === 'voice' (§49),
  // rendered by the shared MessageBubble's call variant. Each is shown ONLY when present (§13):
  // a call with no recording/transcript/duration renders that part absent, never fabricated.
  callDurationSec?: number | null;
  callRecordingUrl?: string | null;
  callTranscript?: string | null;
  callDirection?: Direction | null;
}

// ── capability flags ────────────────────────────────────────────────────────────────────
/**
 * The canonical scope-off switches. A scope sets a flag false and the shell simply does NOT
 * render that affordance — no fork, no scope branch in the shell. (List-level features —
 * sort/density/bulk/labels — are gated by the presence of their render slots + label catalog
 * on the list model below, keeping this object to the composer/contact surface flags the brief
 * enumerates.)
 */
export interface ConversationsCapabilities {
  /** "Draft with Paige" one-click reply drafting (tenant email; operator: off for now). */
  canDraftWithPaige: boolean;
  /** Schedule / undo-send popover. */
  canSchedule: boolean;
  /** Saved email-template inserts. */
  hasTemplates: boolean;
  /** Signature append toggle (email). */
  hasSignature: boolean;
  /** File attachments (attach button + chips + drop-zone). */
  hasAttachments: boolean;
  /** The contact panel renders the rich tenant business rail (deals/billing/portal). When
   *  false the shell renders the MINIMAL contact panel (name/phone/labels/reach/recent) — an
   *  operator SMS counterparty has no deals/billing/portal, so those are honestly absent (§13). */
  hasContactBusinessPanels: boolean;
}

// ── per-row render context (shell → renderRow) ─────────────────────────────────────────
/** The shell owns list orchestration (open/cursor/selection/density); it hands each row its
 *  computed state so the scope's row component stays a pure presenter. The rendered row MUST
 *  set `data-thread-key={thread.key}` on its outer node so the shell's keyboard nav can resolve
 *  the focused row (the tenant ThreadRow already does; an operator row must too). */
export interface ThreadRowContext {
  active: boolean;            // the open thread
  cursored: boolean;         // keyboard-nav highlight (distinct from `active`)
  selected: boolean;         // multi-select checked
  selectionActive: boolean;  // any selection exists → keep checkboxes visible
  onClick: () => void;
  onToggleSelect: (e: { shiftKey: boolean }) => void;
  density: Density;
}

// ── LIST model (drives ConversationsThreadList) ────────────────────────────────────────
/**
 * The container computes the DATA concerns (server state filter, view predicate, label filter,
 * search matched-keys) and hands the LEFT rail the already-filtered normalized threads; the
 * list owns the PRESENTATION concerns (sort, density, select-all, multi-select, Gmail-style
 * keyboard cursor, bulk toolbar) internally and calls back through these mutators.
 */
export interface ConversationsListModel<TRaw = unknown> {
  threads: ShellThread<TRaw>[];
  loading: boolean;
  searching: boolean;

  // search (input lives in the rail; execution lives in the container)
  search: string;
  onSearch: (term: string) => void;
  /** A search ran and matched zero threads (drives the search-no-match EmptyState). */
  matchedEmpty: boolean;

  // open selection (drives the 3-col vs 2-col shell layout + mark-read)
  selectedKey: string | null;
  /** Open a thread (the adapter marks it read). */
  onSelect: (key: string) => void;
  /** Optional — focus the middle pane after Enter-to-open (tenant wires its pane ref). */
  onOpenFocus?: () => void;

  // thread-state mutators (each returns success for honest bulk reporting, §13)
  snooze: (id: string, until: Date | string | null, opts?: MutOpts) => Promise<boolean>;
  archive: (id: string, on: boolean, opts?: MutOpts) => Promise<boolean>;
  markRead: (id: string, opts?: MutOpts) => Promise<boolean>;
  setLabels: (id: string, labels: Label[], opts?: MutOpts) => Promise<boolean>;

  /** Tenant-authored label vocabulary for the bulk-label menu (empty → Label bulk disabled). */
  labelCatalog: Label[];

  /** When any of view/label/search change, the container bumps this string so the list resets
   *  its selection + keyboard cursor (a bulk action can never reach a row the user can't see). */
  resetKey: string;

  // scope-specific render slots
  /** Render one row for this scope (tenant: <ThreadRow …/>; operator: its minimal row). */
  renderRow: (thread: ShellThread<TRaw>, ctx: ThreadRowContext) => ReactNode;
  /** The filter strip above the list (tenant: <ThreadFilters …/>). Omitted → no filter strip. */
  renderFilters?: () => ReactNode;
  /** The New-conversation / Connect-a-channel act atop the rail (gold is the scope's, §11). */
  renderNewConversation?: () => ReactNode;
  /** The view-dependent empty state when there are rows in no view (tenant: archived/snoozed/
   *  active messaging + connect CTA). Omitted → the shell's generic "No conversations yet". */
  renderEmpty?: () => ReactNode;

  // list-feature switches (present-slot based; explicit flags keep intent readable)
  hasSort?: boolean;      // default true
  hasDensity?: boolean;   // default true
  hasBulk?: boolean;      // default true
}

// ── COMPOSER model (drives ConversationsRichComposer) ──────────────────────────────────
/**
 * Wraps the shared MessageComposer atom and injects the affordance cluster through its
 * header/toolbar slots, EACH gated by a capability flag. A flag off → the affordance simply
 * is not rendered (no fork). The composer owns transient UI-only state (the draft-guide popover,
 * the schedule popover open state); the container owns the substantive values (body, subject,
 * scheduledFor, attachments, drafting status).
 */
interface ConversationsComposerModelBase {
  capabilities: ConversationsCapabilities;

  // core (passthrough → MessageComposer)
  value: string;
  onChange: (v: string) => void;
  onSend: () => void | Promise<void>;
  sending: boolean;
  disabled?: boolean;
  /** Disable only send while the reply remains editable (validation, DND, association, permission). */
  sendDisabled?: boolean;
  /** Solo reply opt-in: plain Enter sends; Shift+Enter inserts a newline. */
  sendOnEnter?: boolean;
  placeholder?: string;
  note?: ReactNode;
  sendLabel?: string;
  rows?: number;
  textareaClassName?: string;
  /** Stands in place of the action row (tenant email reply: the inline check); hides the gold Send. */
  actions?: ReactNode;
  /** The send is being checked: Send is aria-busy/aria-disabled and inert, but keeps focus. */
  checking?: boolean;

  // sending identity
  identities: SendingIdentity[];
  identityId: string;
  onIdentityChange: (id: string) => void;
  /** Force-hide the identity picker even with identities present (single static line). */
  showIdentity?: boolean;

  // subject (email)
  showSubject?: boolean;
  subject?: string;
  onSubjectChange?: (v: string) => void;

  // attachments (gated by capabilities.hasAttachments)
  attachments?: Attachment[];
  uploading?: boolean;
  onAttachFiles?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (a: Attachment) => void;
  /** The staged files are held exactly as checked (an email check is open or being confirmed). */
  attachmentsLocked?: boolean;

  // "Draft with Paige" (gated by capabilities.canDraftWithPaige && showDraftWithPaige)
  showDraftWithPaige?: boolean;
  /** true only for the channels that support it today (tenant: email). */
  onDraftWithPaige?: (opts: { guide: string; tone: DraftTone }) => void;
  drafting?: boolean;
  draftReadingDoc?: boolean;
  draftFlags?: string[];
  /** enable the draft act (tenant: a resolved recipient address exists). */
  canDraft?: boolean;

  // templates (gated by capabilities.hasTemplates)
  templates?: EmailTemplate[];
  onApplyTemplate?: (key: string) => void;
  // discoverable saved snippets; insertion remains editable and never sends
  snippets?: Array<{ id: string; trigger: string; name: string; body: string }>;
  onApplySnippet?: (id: string) => void;
  /** Solo opt-in; false preserves the established template Select for every other consumer. */
  showCombinedInsert?: boolean;

  // signature (gated by capabilities.hasSignature && signatureAvailable)
  signatureAvailable?: boolean;
  appendSignature?: boolean;
  onToggleSignature?: () => void;

  // schedule (gated by capabilities.canSchedule)
  scheduledFor?: string | null;
  onSchedule?: (iso: string | null) => void;

  // editing-an-existing-draft banner
  editingDraft?: boolean;
  onCancelEdit?: () => void;
  onSaveDraft?: () => void;
  savingDraft?: boolean;
  saveUnconfirmed?: boolean;
  draftSaveDisabled?: boolean;
  draftSaveNote?: string;

  // drop-zone (forwarded onto the textarea when hasAttachments)
  dragOver?: boolean;
  onDropFiles?: (files: FileList | File[]) => void;
  onDragOverZone?: () => void;
  onDragLeaveZone?: () => void;
}

type ConversationsDictationConfig =
  | {
      /** Dictation requires an explicit tenant + thread context epoch. */
      showDictation: true;
      dictationScopeEpoch: string;
      /** Append through the container's snippet-expanding onChange seam. */
      onDictate?: (segment: string) => void;
      /** Surface a dictation/STT failure to the user — never swallowed (§13). */
      onDictateError?: (message: string) => void;
    }
  | {
      showDictation?: false;
      dictationScopeEpoch?: never;
      onDictate?: never;
      onDictateError?: never;
    };

export type ConversationsComposerModel =
  ConversationsComposerModelBase & ConversationsDictationConfig;

export type DraftTone = "professional" | "friendly" | "warm" | "direct";

// ── CONTACT-PANEL model (drives ConversationsContactPanel) ─────────────────────────────
export interface ContactPanelMinimal {
  name: string;
  phone?: string | null;
  /** How to reach this counterparty (channel + address); rendered as read-only lines. */
  reach?: { channel: ChannelType; address: string }[];
  labels: Label[];
  /** The last few messages, newest last — a lightweight recap, NOT the rich rail (§13). */
  recent: ShellMessage[];
  onClose?: () => void;
}

export interface ConversationsContactPanelModel {
  /** true → render the rich tenant rail via `renderRich`; false → the minimal panel. */
  hasContactBusinessPanels: boolean;
  /** Tenant: () => <ContactCardRail …/>. Pass-through; the shell never owns the rich rail. */
  renderRich?: () => ReactNode;
  /** Operator (and any no-business scope): the minimal panel data. */
  minimal?: ContactPanelMinimal;
}

// ── CALL model (drives ConversationsCallButton in the open-thread header) ──────────────
/**
 * The click-to-call capability for the OPEN thread, assembled per-scope so the shared
 * ConversationsCallButton stays scope-agnostic (§9/§51 — the button never knows tenant vs
 * operator). The tenant maps this over the contact's phone + the tenant voice token path; the
 * operator over `counterparty_phone` + the Phase-3 operator voice token path. Both `placeCall`
 * implementations drive the ONE shared VoiceDeviceProvider Device (§18) — the button only
 * decides how to present the act (gold when available, indigo indicator while live, disabled +
 * honest tooltip when not, §11/§13).
 */
export interface ConversationsCallModel {
  /** Voice caller-id is provisioned for this scope. False → disabled control + honest tooltip. */
  hasVoiceCalling: boolean;
  /** The dialable number for the open thread; null → disabled with a "no number" tooltip (§13). */
  destination: string | null;
  /** Place the call (scope drives the shared Device via voice.callFrom). */
  placeCall: (destination: string) => void;
  /** Honest tooltip when hasVoiceCalling is false (e.g. operator caller-id not yet configured). */
  unavailableReason?: string | null;
}

// ── the master adapter ─────────────────────────────────────────────────────────────────
/** The one object a container assembles from its own state + seams and hands to the shell. */
export interface ConversationsAdapter<TThread = unknown> {
  capabilities: ConversationsCapabilities;
  list: ConversationsListModel<TThread>;
  /** A factory — the container builds the composer model against its OPEN thread, so the shell
   *  can render the composer only when a thread is selected. */
  composerFor?: (threadKey: string) => ConversationsComposerModel;
  contactPanel?: ConversationsContactPanelModel;
  /** The open thread's call capability (Phase 4). Absent → the header renders no call button. */
  call?: ConversationsCallModel;
}
