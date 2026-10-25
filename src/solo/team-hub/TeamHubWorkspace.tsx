import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { ArrowLeft, AtSign, ClipboardList, Download, FileImage, FileSpreadsheet, FileText, Hash, Lock, MessageSquareReply, PanelRight, Paperclip, Plus, Search, SendHorizontal, Slash, UserPlus, Users, WifiOff, X } from "lucide-react";
import { useTenantContext } from "@/hooks/useTenantContext";
import { handOffPaigePrompt } from "@/lib/paigePromptHandoff";
import { clearPaigeClientScope } from "@/solo/paigeClientScope";
import { clearPaigePublicPresenceScope } from "@/solo/paigePublicPresenceScope";
import { workStatusLabel } from "@/solo/operations/operations-presentation";
import { VP_ROSTER } from "../../../supabase/functions/_shared/paige-context/vp-address";
import {
  bodyProblem,
  commandMatches,
  commandQuery,
  commandRemainder,
  dueAtFor,
  dueProblem,
  paigeHandoffDraft,
  specialistMentioned,
  taskTitleProblem,
  withoutSpecialists,
  SPECIALIST_NAMES,
  TEAM_HUB_COMMANDS,
  type SpecialistName,
  type TeamHubCommand,
  type TeamHubCommandKind,
  type TeamHubTaskRead,
  type TeamHubWorkItem,
  channelNameProblem,
  conversationLabel,
  dayKey,
  dayLabel,
  initials,
  mentionCandidates,
  mentionLabel,
  mentionRuns,
  mentionScope,
  normalizeChannelName,
  permissionLabel,
  refusalMessage,
  resolveMentions,
  timeLabel,
  MESSAGE_MAX_LENGTH,
  messageLength,
  TEAM_HUB_UNAVAILABLE_TITLE,
  type PickedMention,
  type TeamHubConversation,
  type TeamHubMessage,
  type TeamHubPerson,
  fileKind,
  fileRefusalMessage,
  fileSizeLabel,
  isImageMime,
  TEAM_HUB_ATTACH_LABEL,
  TEAM_HUB_DOWNLOAD_FAILED,
  TEAM_HUB_FILE_ACCEPT,
  TEAM_HUB_FILE_DISCLOSURE,
  TEAM_HUB_FILE_TYPES,
  TEAM_HUB_FILE_TYPES_NOTE,
  type TeamHubFile,
} from "./team-hub-contract";
import { attachmentScope, teamHubNavigation, useTeamHub, type AttachmentChip, type PendingMessage, type TaskDraft, type TeamHub } from "./useTeamHub";
import "./team-hub.css";

/**
 * EXP08 Team Hub: channels, direct messages and one-level threads between the active teammates of
 * this workspace (increment 1), plus team work (increment 2): the `/` command menu, Draft a task
 * (one real task in Operations, its card reading status from the original record), the PAIGE
 * handoffs for specialists, approvals and meetings, and the Team work panel. Approved prototype v2.
 *
 * Team Hub never delegates, approves or books anything itself. A specialist, approval or meeting
 * request only PREFILLS PAIGE (`handOffPaigePrompt` + the shell's `openPaige`); the person presses
 * send there, and PAIGE keeps the approval card and the owner/admin delegation check.
 *
 * Increment 3 adds attachments (docs/delivery/exp08-team-hub-increment3-attachments-contract.md §7):
 * the paperclip and drop target in both composers, file chips that show each upload's real state,
 * and file rows on messages whose Download mints a fresh 60-second URL on every click. Files are not
 * scanned, and the screen says so. Realtime and links back from PAIGE are later increments and are
 * omitted, not shown dead.
 */
export function TeamHubWorkspace({ onOpenTeamSettings, openPaige }: { onOpenTeamSettings?: () => void; openPaige?: () => void }) {
  const { activeTenant, activeUserId, loading, accountContextStatus, refresh } = useTenantContext();
  if (loading || accountContextStatus === "resolving") return <HubSkeleton />;
  const tenantId = activeTenant?.id ?? null;
  if (!tenantId || !activeUserId || accountContextStatus !== "ready") {
    return <div className="th-hub th-hub--state"><CenterState icon={<Users aria-hidden="true" />} title="Choose your workspace">
      Open a company workspace to see its team conversations.
    </CenterState></div>;
  }
  // Remount per actor and workspace: a switch clears every conversation, draft and pending send.
  return <ScopedTeamHub key={`${activeUserId}:${tenantId}`} tenantId={tenantId} onTenantRefresh={refresh}
    onOpenTeamSettings={onOpenTeamSettings} openPaige={openPaige} />;
}

function ScopedTeamHub({ tenantId, onTenantRefresh, onOpenTeamSettings, openPaige }: {
  tenantId: string; onTenantRefresh?: () => unknown; onOpenTeamSettings?: () => void; openPaige?: () => void;
}) {
  const [announcement, setAnnouncement] = useState("");
  // One polite region, one write per frame. Everything said before the next frame paints (a pick
  // that starts two uploads and refuses a third, a mocked-fast check that finishes in the same
  // frame) is joined into that one write instead of the last message silently replacing the rest.
  const queued = useRef<string[]>([]);
  const flushing = useRef(false);
  const announce = useCallback((text: string) => {
    if (!text) return;
    if (!queued.current.includes(text)) queued.current.push(text);
    if (flushing.current) return;
    flushing.current = true;
    // Cleared first, so the same words said twice in a row are still read the second time.
    setAnnouncement("");
    window.requestAnimationFrame(() => {
      const said = joinAnnouncements(queued.current);
      queued.current = [];
      flushing.current = false;
      setAnnouncement(said);
    });
  }, []);
  // New arrivals found by a refresh are announced as a count through the hub's one live region.
  // Attachment progress (Uploading 2 files, File ready, File refused: …) goes through the same one region.
  const hub = useTeamHub(tenantId, { onTenantRefresh, onIncoming: announce, onAttachment: announce });

  if (hub.status === "account_unavailable") {
    // The server's `unavailable` (A1): not a canonical SOLO workspace. One honest state, no controls.
    return <div className="th-hub th-hub--state"><CenterState icon={<Users aria-hidden="true" />} title={TEAM_HUB_UNAVAILABLE_TITLE} role="status" /></div>;
  }
  if (hub.status === "not_member") {
    return <div className="th-hub th-hub--state"><CenterState icon={<Lock aria-hidden="true" />} title="You're no longer on this team" role="alert">
      Your access to Team Hub and its conversations ended. Ask an owner if you should be invited again.
    </CenterState></div>;
  }
  if (hub.status === "scope_changed") {
    return <div className="th-hub th-hub--state"><CenterState icon={<Users aria-hidden="true" />} title="Your workspace changed" role="alert"
      action={<button type="button" className="th-btn" onClick={() => void hub.retryAfterScopeChange()}>Reload Team Hub</button>}>
      Team Hub only shows the workspace you're in now. Reload to open its conversations.
    </CenterState></div>;
  }
  if (hub.status === "loading" || !hub.overview) {
    if (hub.status === "unavailable") {
      return <div className="th-hub th-hub--state"><CenterState icon={<Users aria-hidden="true" />} title="Team Hub couldn't load" role="alert"
        action={<button type="button" className="th-btn" onClick={() => void hub.retryLoad()}>Try again</button>}>
        Your conversations weren't changed. Check your connection and try again.
      </CenterState></div>;
    }
    return <HubSkeleton />;
  }
  return <ReadyHub hub={hub} announce={announce} announcement={announcement} onOpenTeamSettings={onOpenTeamSettings} openPaige={openPaige} />;
}

/** Several messages for the one live region, read as sentences in the order they were said. */
function joinAnnouncements(parts: string[]): string {
  const said = parts.map((part) => part.trim()).filter(Boolean);
  return said.map((part, index) => index < said.length - 1 && !/[.!?…]$/.test(part) ? `${part}.` : part).join(" ");
}

type Form = { kind: "channel" } | { kind: "dm" } | null;

/** How close to the newest message still counts as "at it" when the stream or its rows resize. */
const PIN_SLACK_PX = 4;

/** Same thresholds as the stylesheet's `@container th-hub (max-width: 759.98px | 1149.98px | 1439.98px)`. */
const ONE_COLUMN_BELOW = 760;
const OVERLAY_BELOW = 1150;
/** The Team work panel is a third column only on a hub at least this wide (contract §5). */
const WORK_OVERLAY_BELOW = 1440;
type HubLayout = "unknown" | "one-column" | "overlay" | "wide";

/**
 * The hub's own width decides its layout, never the viewport: the PAIGE panel narrows the hub at
 * any viewport size. The stylesheet does this with container queries; this mirrors the two
 * thresholds the screen needs in script: which pane is on screen (so what may be marked read), and
 * which panes the thread drawer covers (so what is inert). A hub that reports no width has not been
 * laid out, and is treated as wide.
 */
function useHubLayout(ref: RefObject<HTMLElement>): { layout: HubLayout; workOverlays: boolean } {
  const [layout, setLayout] = useState<HubLayout>("unknown");
  const [workOverlays, setWorkOverlays] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (width: number) => {
      setLayout(width <= 0 ? "wide" : width < ONE_COLUMN_BELOW ? "one-column" : width < OVERLAY_BELOW ? "overlay" : "wide");
      setWorkOverlays(width > 0 && width < WORK_OVERLAY_BELOW);
    };
    measure(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => { const entry = entries[entries.length - 1]; if (entry) measure(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return { layout, workOverlays };
}

/** An inline preview above the composer. Only Draft a task writes; the others continue in PAIGE. */
type Preview =
  | { kind: "task"; channelId: string; title: string; assigneeId: string; due: string; restoreDraft: string; busy: boolean; error: string | null }
  | { kind: "specialist" | "approval" | "meeting"; channelId: string; specialist: SpecialistName; ask: string; restoreDraft: string; alsoPost: boolean; busy: boolean; error: string | null };

const localDay = (instant: string | null) => {
  if (!instant) return "";
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function ReadyHub({ hub, announce, announcement, onOpenTeamSettings, openPaige }: {
  hub: TeamHub; announce: (text: string) => void; announcement: string; onOpenTeamSettings?: () => void; openPaige?: () => void;
}) {
  const overview = hub.overview!;
  const people = overview.people;
  const meId = overview.me.user_id;
  const me = people.find((person) => person.user_id === meId) ?? null;
  const teammates = people.filter((person) => person.user_id !== meId);
  const canInvite = Boolean(onOpenTeamSettings) && (me?.permission === "owner" || me?.permission === "admin");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Form>(null);
  const [mobileView, setMobileView] = useState<"list" | "conv">("list");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, PickedMention[]>>({});
  const [composerError, setComposerError] = useState<string | null>(null);
  const [threadDraft, setThreadDraft] = useState("");
  const [threadError, setThreadError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const threadComposerRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const newChannelRef = useRef<HTMLButtonElement>(null);
  const newDmRef = useRef<HTMLButtonElement>(null);
  const threadReturn = useRef<HTMLElement | null>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const { layout, workOverlays } = useHubLayout(hubRef);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [workOpen, setWorkOpen] = useState(false);
  const workToggleRef = useRef<HTMLButtonElement>(null);
  const previewFirstRef = useRef<HTMLElement | null>(null);
  const { fileUrl } = hub;
  const fileAccess = useMemo(() => ({ sign: fileUrl, announce }), [fileUrl, announce]);
  // Assigning someone else is Operations' own rule: an owner or admin may, a member only themselves.
  const canAssignOthers = me?.permission === "owner" || me?.permission === "admin";
  // The PAIGE handoffs exist only where the shell can open PAIGE; without it they're omitted, not dead.
  const commands = useMemo(() => TEAM_HUB_COMMANDS.filter((command) => command.kind === "task" || Boolean(openPaige)), [openPaige]);
  const oneColumn = layout === "one-column";
  const multiColumn = layout === "wide" || layout === "overlay";
  const conversations = overview.conversations;
  const active = hub.activeConversation;
  const opened = useRef(false);
  const threadOpen = Boolean(hub.thread);

  // The stream is on screen in a multi-column layout, or in the one-column conversation view with
  // no thread drawn over it. Only then may the hook mark it read; the one-column list view never does.
  const { setStreamVisible } = hub;
  useEffect(() => {
    setStreamVisible(multiColumn || (mobileView === "conv" && !threadOpen));
  }, [multiColumn, mobileView, threadOpen, setStreamVisible]);

  // Open the first conversation once, so a wide screen never starts on an empty pane. In one
  // column the list is what is on screen, so nothing is opened (or marked read) behind it.
  useEffect(() => {
    if (!multiColumn || opened.current || hub.activeId || !conversations.length) return;
    opened.current = true;
    const first = conversations.find((conversation) => conversation.joined) ?? conversations[0];
    void hub.openConversation(first.id);
  }, [multiColumn, conversations, hub]);

  // A conversation that disappears from the list (left, removed from a private channel) closes.
  useEffect(() => {
    if (hub.activeId && hub.stream?.status !== "loading" && !conversations.some((conversation) => conversation.id === hub.activeId)) {
      if (hub.stream?.status !== "not_found") hub.clearConversation();
    }
  }, [conversations, hub]);

  const focusComposer = useCallback(() => {
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  const open = useCallback(async (id: string) => {
    setForm(null);
    setComposerError(null);
    setMobileView("conv");
    // Opening puts this conversation on screen in every layout. The hook switches to it first, so
    // the visibility change can never mark the previously open conversation read.
    const opening = hub.openConversation(id);
    hub.setStreamVisible(true);
    await opening;
    focusComposer();
  }, [hub, focusComposer]);

  const query = search.trim().toLowerCase();
  const visibleConversations = conversations.filter((conversation) =>
    !query || conversationLabel(conversation, people).toLowerCase().includes(query));
  const channels = visibleConversations.filter((conversation) => conversation.kind === "channel")
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  const dms = visibleConversations.filter((conversation) => conversation.kind === "dm")
    .sort((a, b) => conversationLabel(a, people).localeCompare(conversationLabel(b, people)));

  const draft = hub.activeId ? drafts[hub.activeId] ?? "" : "";
  const setDraft = (value: string) => { if (hub.activeId) { const id = hub.activeId; setDrafts((current) => ({ ...current, [id]: value })); } };
  const pickedHere = hub.activeId ? picked[hub.activeId] ?? [] : [];

  // A preview belongs to the conversation it was opened in. Switching away closes it and puts the
  // words it came from back in that conversation's composer, so nothing typed is lost.
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useEffect(() => {
    const open = previewRef.current;
    if (!open || open.channelId === hub.activeId || open.busy) return;
    if (open.restoreDraft) setDrafts((current) => current[open.channelId] ? current : { ...current, [open.channelId]: open.restoreDraft });
    setPreview(null);
  }, [hub.activeId]);

  const openTaskPreview = (title: string, restoreDraft: string) => {
    if (!hub.activeId) return;
    setComposerError(null);
    setPreview({ kind: "task", channelId: hub.activeId, title, assigneeId: meId, due: "", restoreDraft, busy: false, error: null });
  };
  const openHandoffPreview = (kind: "specialist" | "approval" | "meeting", ask: string, restoreDraft: string, options: { specialist?: SpecialistName; alsoPost?: boolean } = {}) => {
    if (!hub.activeId || !openPaige) return;
    setComposerError(null);
    setPreview({ kind, channelId: hub.activeId, specialist: options.specialist ?? "ZION", ask, restoreDraft, alsoPost: options.alsoPost ?? false, busy: false, error: null });
  };

  /** A command picked from the `/` menu: its text leaves the composer and the person's words prefill the preview. */
  const pickCommand = (command: TeamHubCommand, currentDraft: string) => {
    if (!hub.activeId) return;
    const channelId = hub.activeId;
    const remainder = commandRemainder(currentDraft, command);
    setDrafts((current) => ({ ...current, [channelId]: "" }));
    if (command.kind === "task") openTaskPreview(remainder, remainder);
    else openHandoffPreview(command.kind, remainder, remainder);
    announce(command.kind === "task" ? "Draft a task. Review it before it's created." : `${command.title}. Review it before PAIGE opens.`);
  };

  /** A specialist picked from the @ list: the preview opens with the rest of the draft as the ask. */
  const pickSpecialist = (name: SpecialistName, draftWithoutQuery: string) => {
    if (!hub.activeId) return;
    const channelId = hub.activeId;
    setDrafts((current) => ({ ...current, [channelId]: draftWithoutQuery }));
    openHandoffPreview("specialist", withoutSpecialists(draftWithoutQuery), draftWithoutQuery, { specialist: name });
    announce(`Ask ${name}. Review it before PAIGE opens.`);
  };

  const closePreview = useCallback(() => {
    const open = previewRef.current;
    if (!open || open.busy) return;
    // Cancel keeps the draft: the words go back to the composer they came from.
    if (open.restoreDraft) setDrafts((current) => current[open.channelId] ? current : { ...current, [open.channelId]: open.restoreDraft });
    setPreview(null);
    focusComposer();
  }, [focusComposer]);

  useEffect(() => {
    // Focus moves into a preview when it opens, never on each keystroke inside it.
    if (preview) window.requestAnimationFrame(() => previewFirstRef.current?.focus());
  }, [preview?.kind, preview?.channelId]); // eslint-disable-line react-hooks/exhaustive-deps -- open/replace only

  const createTask = async () => {
    const open = previewRef.current;
    if (!open || open.kind !== "task" || open.busy || !hub.online) return;
    const problem = taskTitleProblem(open.title) ?? dueProblem(open.due);
    if (problem) {
      setPreview({ ...open, error: problem });
      announce(problem);
      return;
    }
    const assigneeId = canAssignOthers ? open.assigneeId : meId;
    setPreview({ ...open, busy: true, error: null });
    const outcome = await hub.requestTask({ channelId: open.channelId, parentId: null, task: { title: open.title, assigneeId, dueAt: dueAtFor(open.due) } });
    if (outcome.kind === "sent") {
      setPreview(null);
      announce(outcome.duplicate ? "That task was already created in Operations" : "Task created in Operations");
      focusComposer();
    } else if (outcome.kind === "refused") {
      // A refusal is kept in the draft: the preview stays open with every field as it was.
      setPreview((current) => current && current.kind === "task" ? { ...current, busy: false, error: outcome.message } : current);
      announce(outcome.message);
      window.requestAnimationFrame(() => previewFirstRef.current?.focus());
    } else {
      // No answer: the attempt waits in the conversation with Retry, which reuses its request id.
      setPreview(null);
      announce("Task not confirmed. Retry is available.");
      focusComposer();
    }
  };

  const continueInPaige = async () => {
    const open = previewRef.current;
    if (!open || open.kind === "task" || open.busy || !openPaige) return;
    let messageId: string | null = null;
    if (open.kind === "specialist" && open.alsoPost) {
      // The person's own message, posted as plain text: the specialist's name is never a stored mention.
      // What the person wrote, as written; a preview opened without a draft posts the ask instead.
      const body = (open.restoreDraft.trim() || `@${open.specialist} ${open.ask.trim()}`).trim();
      const problem = bodyProblem(body);
      if (!hub.online || problem === "empty") return;
      if (problem === "too_long") { const text = refusalMessage("too_long", "send"); setPreview({ ...open, error: text }); announce(text); return; }
      // The message posts with the files attached to it, so they must all be ready first.
      const waiting = filesProblem(hub.attachments[attachmentScope(open.channelId, null)] ?? []);
      if (waiting) { setPreview({ ...open, error: waiting }); announce(waiting); return; }
      const mentions = resolveMentions(body, pickedHere, people);
      if (!mentions.ok) { setPreview({ ...open, error: mentions.problem }); announce(mentions.problem); return; }
      setPreview({ ...open, busy: true, error: null });
      const outcome = await hub.send({ channelId: open.channelId, parentId: null, body, mentionIds: mentions.ids, withFiles: true });
      if (outcome.kind !== "sent") {
        // Not posted, so PAIGE isn't opened yet. A lost answer leaves the message below with Retry, and
        // turns posting off here so Continue can't post it a second time.
        const text = outcome.kind === "refused" ? outcome.message : "Your message wasn't confirmed. It's kept below with Retry; Continue now opens PAIGE without posting it again.";
        setPreview((current) => current && current.kind !== "task" ? { ...current, busy: false, error: text, alsoPost: outcome.kind === "refused" ? current.alsoPost : false } : current);
        announce(text);
        return;
      }
      messageId = outcome.messageId;
      setPicked((current) => ({ ...current, [open.channelId]: [] }));
    }
    const conversation = conversations.find((item) => item.id === open.channelId);
    handOffPaigePrompt(paigeHandoffDraft(open.kind, open.ask, {
      conversation: conversation ? conversationTitle(conversation, people) : "Team Hub conversation",
      channel_id: open.channelId,
      message_id: messageId,
    }, open.kind === "specialist" ? open.specialist : null));
    // The words went to PAIGE's composer; they don't also stay here.
    setDrafts((current) => ({ ...current, [open.channelId]: "" }));
    setPreview(null);
    announce("PAIGE is open with your request. Review it and press send there.");
    clearPaigeClientScope();
    clearPaigePublicPresenceScope();
    openPaige();
  };

  const send = async () => {
    if (!hub.activeId || !active) return;
    const problem = bodyProblem(draft);
    const chips = hub.attachments[attachmentScope(hub.activeId, null)] ?? [];
    // A message may be files only; it may not leave while a file is still uploading or was refused.
    if ((problem === "empty" && !chips.length) || !hub.online) return;
    const waiting = filesProblem(chips);
    if (waiting) { setComposerError(waiting); announce(waiting); return; }
    // Any draft that starts with /PAIGE, one line or several: the menu reads a single line only, so a
    // multi-line /PAIGE draft would otherwise be posted as if the command had run.
    if (/^\s*\/paige\b/i.test(draft)) {
      // /PAIGE is the command menu typed out; a command that matches nothing is never posted as if it ran.
      const text = "Pick a command from the list, or remove /PAIGE to send this as a message.";
      setComposerError(text); announce(text); return;
    }
    const specialist = openPaige ? specialistMentioned(draft) : null;
    if (specialist) {
      // A message to a specialist continues in PAIGE; the preview says so before anything happens.
      openHandoffPreview("specialist", withoutSpecialists(draft), draft, { specialist, alsoPost: true });
      announce(`Ask ${specialist}. Review it before PAIGE opens.`);
      return;
    }
    if (problem === "too_long") { const text = refusalMessage("too_long", "send"); setComposerError(text); announce(text); return; }
    const mentions = resolveMentions(draft, pickedHere, people);
    if (!mentions.ok) { setComposerError(mentions.problem); announce(mentions.problem); return; }
    const channelId = hub.activeId;
    setDrafts((current) => ({ ...current, [channelId]: "" }));
    setPicked((current) => ({ ...current, [channelId]: [] }));
    setComposerError(null);
    focusComposer();
    const outcome = await hub.send({ channelId, parentId: null, body: draft, mentionIds: mentions.ids, withFiles: true });
    if (outcome.kind === "sent") announce("Message sent");
    else if (outcome.kind === "failed") announce("Message not sent. Retry is available.");
    else {
      // A refused message goes back in the composer so nothing typed is lost.
      setDrafts((current) => current[channelId] ? current : { ...current, [channelId]: outcome.body });
      setComposerError(outcome.message);
      announce(outcome.message);
    }
  };

  const sendReply = async () => {
    const thread = hub.thread;
    if (!thread || thread.status !== "ready" || !hub.online) return;
    const problem = bodyProblem(threadDraft);
    const chips = hub.attachments[attachmentScope(thread.channelId, thread.rootId)] ?? [];
    if (problem === "empty" && !chips.length) return;
    if (problem === "too_long") { const text = refusalMessage("too_long", "send"); setThreadError(text); announce(text); return; }
    const waiting = filesProblem(chips);
    if (waiting) { setThreadError(waiting); announce(waiting); return; }
    const body = threadDraft;
    setThreadDraft("");
    setThreadError(null);
    window.requestAnimationFrame(() => threadComposerRef.current?.focus());
    const outcome = await hub.send({ channelId: thread.channelId, parentId: thread.rootId, body, mentionIds: [], withFiles: true });
    if (outcome.kind === "sent") announce("Reply posted");
    else if (outcome.kind === "failed") announce("Reply not sent. Retry is available.");
    else { restoreReply(thread.rootId, outcome.body, outcome.message); announce(outcome.message); }
  };

  // The reply box is shared by every thread, and a refusal can arrive after another thread was
  // opened. A refused reply goes back only into its own thread: straight into the box if that
  // thread is still open, otherwise held until it is opened again.
  const openRootRef = useRef<string | null>(null);
  openRootRef.current = hub.thread?.rootId ?? null;
  const heldReplies = useRef<Record<string, string>>({});
  const restoreReply = (rootId: string, body: string, message: string) => {
    if (openRootRef.current === rootId) {
      setThreadDraft((current) => current || body);
      setThreadError(message);
    } else if (!heldReplies.current[rootId]) {
      heldReplies.current[rootId] = body;
    }
  };

  const retry = async (item: PendingMessage) => {
    const outcome = await hub.retry(item.localId);
    if (item.kind === "task") {
      announce(outcome.kind === "sent" ? "Task created in Operations" : outcome.kind === "failed" ? "Still not confirmed. Retry checks first, so the task is never created twice." : outcome.message);
      if (outcome.kind === "refused" && outcome.task) {
        // Refused on retry: the task goes back into its preview, every field as it was sent.
        setPreview({ kind: "task", channelId: item.channelId, title: outcome.task.title, assigneeId: outcome.task.assigneeId,
          due: localDay(outcome.task.dueAt), restoreDraft: "", busy: false, error: outcome.message });
      } else focusComposer();
      return;
    }
    // The Retry button is gone or replaced; return to the composer the message came from.
    window.requestAnimationFrame(() => (item.parentId ? threadComposerRef : composerRef).current?.focus());
    announce(outcome.kind === "sent" ? (item.parentId ? "Reply posted" : "Message sent") : outcome.kind === "failed" ? "Still not sent. Your message is kept here." : outcome.message);
    // A refused retry takes the pending row away, so its text goes back to the composer it came
    // from, as a refused first send does; a draft already being written there is not overwritten.
    if (outcome.kind === "refused") {
      if (item.parentId) restoreReply(item.parentId, outcome.body, outcome.message);
      else { setDrafts((current) => current[item.channelId] ? current : { ...current, [item.channelId]: outcome.body }); setComposerError(outcome.message); }
    }
  };

  // The Team work panel and the thread share one slot: only one is open at a time.
  const workReturn = useRef<HTMLElement | null>(null);
  const workHeadingRef = useRef<HTMLHeadingElement>(null);
  const openWork = () => {
    if (hub.thread) hub.closeThread();
    workReturn.current = workToggleRef.current;
    setWorkOpen(true);
    void hub.listWork("open");
    window.requestAnimationFrame(() => workHeadingRef.current?.focus());
  };
  const closeWork = useCallback((returnFocus = true) => {
    setWorkOpen(false);
    hub.closeWork();
    const target = workReturn.current;
    workReturn.current = null;
    if (returnFocus) window.requestAnimationFrame(() => (target?.isConnected ? target : composerRef.current)?.focus());
  }, [hub]);

  // Opening a row jumps to its message: open its conversation, page back until the message is held,
  // then scroll to it and move focus there. A message that isn't in the history any more says so.
  const [jump, setJump] = useState<{ channelId: string; messageId: string; pages: number } | null>(null);
  const jumpTo = async (item: TeamHubWorkItem) => {
    // Where the panel covers the conversation, it steps aside so the message can be seen.
    if (workOverlays || oneColumn) closeWork(false);
    setMobileView("conv");
    // A task started in a thread reply lands on that thread's root, which is what the stream holds.
    setJump({ channelId: item.channel_id, messageId: item.parent_message_id ?? item.message_id, pages: 0 });
    if (hub.activeId !== item.channel_id) {
      setForm(null);
      const opening = hub.openConversation(item.channel_id);
      hub.setStreamVisible(true);
      await opening;
    }
  };
  useEffect(() => {
    if (!jump) return;
    const stream = hub.stream;
    if (!stream || stream.channelId !== jump.channelId || stream.status === "loading" || stream.loadingOlder) return;
    if (stream.status !== "ready") { setJump(null); announce("That conversation isn't available to you."); return; }
    if (stream.messages.some((message) => message.id === jump.messageId)) {
      setJump(null);
      window.requestAnimationFrame(() => {
        const element = document.getElementById(`th-msg-${jump.messageId}`);
        element?.scrollIntoView?.({ block: "center" });
        element?.focus();
      });
      return;
    }
    if (stream.hasMore && jump.pages < 10 && !stream.olderFailed) {
      setJump({ ...jump, pages: jump.pages + 1 });
      void hub.loadOlder();
      return;
    }
    setJump(null);
    announce("That message couldn't be found in this conversation's history.");
  }, [jump, hub, announce]);

  const focusThreadWhenReady = useRef(false);
  const openThread = (rootId: string, trigger: HTMLElement) => {
    if (workOpen) closeWork(false);
    threadReturn.current = trigger;
    const held = heldReplies.current[rootId];
    delete heldReplies.current[rootId];
    setThreadDraft(held ?? "");
    setThreadError(null);
    // The reply box exists only once the thread has loaded; focus moves there then, not before.
    focusThreadWhenReady.current = true;
    hub.openThread(rootId);
  };
  const threadStatus = hub.thread?.status;
  useEffect(() => {
    if (!focusThreadWhenReady.current || !threadStatus || threadStatus === "loading") return;
    focusThreadWhenReady.current = false;
    // A thread that can't be shown leaves focus on what opened it.
    if (threadStatus === "ready") threadComposerRef.current?.focus();
  }, [threadStatus]);
  const closeThread = useCallback(() => {
    hub.closeThread();
    const target = threadReturn.current;
    threadReturn.current = null;
    window.requestAnimationFrame(() => (target?.isConnected ? target : composerRef.current)?.focus());
  }, [hub]);

  // Esc closes the thread from anywhere in the hub. It is handled here, inside React, and marked
  // handled, so the shell's own window-level Esc (which folds PAIGE) leaves it alone. Controls
  // with their own Esc (the @ list, the inline forms, the leave confirmation) handle it first.
  const onHubKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.defaultPrevented) return;
    // Innermost first: the menus and the preview handle their own Esc; an open preview closes before
    // a drawer even when focus is in the composer below it; then the drawer that is open.
    const open = previewRef.current;
    // The preview sits in the conversation pane, so it is innermost only for a key pressed there: Esc
    // inside a thread drawer or the Team work panel closes that layer, never a preview under it.
    const inConversation = event.target instanceof Element && Boolean(event.target.closest(".th-conv"));
    if (open && open.channelId === hub.activeId && inConversation) { event.preventDefault(); if (!open.busy) closePreview(); return; }
    if (hub.thread) { event.preventDefault(); closeThread(); return; }
    if (workOpen) { event.preventDefault(); closeWork(); }
  };

  const closeForm = (returnTo: "channel" | "dm") => {
    setForm(null);
    window.requestAnimationFrame(() => (returnTo === "channel" ? newChannelRef : newDmRef).current?.focus());
  };

  const firstUse = !conversations.length;
  const pendingTop = hub.pending.filter((item) => item.channelId === hub.activeId && !item.parentId);
  const pendingReplies = hub.pending.filter((item) => hub.thread && item.parentId === hub.thread.rootId);
  const firstUseState = (where: "list" | "conv") => <FirstUse teammates={teammates} canInvite={canInvite} onOpenTeamSettings={onOpenTeamSettings}
    compact={where === "list"}
    onCreate={() => { setForm({ kind: "channel" }); setMobileView("list"); }}
    onMessage={() => { setForm({ kind: "dm" }); setMobileView("list"); }} />;
  const thread = hub.thread;
  // While the thread drawer is drawn over a pane, that pane is inert: nothing under the drawer can
  // be reached by keyboard or pointer. It overlays the conversation below 1150px, and in one column
  // it covers everything.
  const conversationCovered = (threadOpen && (layout === "overlay" || oneColumn)) || (workOpen && (workOverlays || oneColumn));
  const listCovered = (threadOpen || workOpen) && oneColumn;
  const assignable = canAssignOthers ? people : people.filter((person) => person.user_id === meId);
  const previewHere = preview && preview.channelId === hub.activeId ? preview : null;
  const mainScope = hub.activeId ? attachmentScope(hub.activeId, null) : null;
  const threadScope = thread ? attachmentScope(thread.channelId, thread.rootId) : null;
  const threadChips = threadScope ? hub.attachments[threadScope] ?? [] : [];
  const threadFilesOk = threadChips.every((chip) => chip.state === "ready");
  const removeThreadFile = (localId: string) => {
    if (!threadScope) return;
    hub.removeAttachment(threadScope, localId);
    announce("File removed");
    window.requestAnimationFrame(() => threadComposerRef.current?.focus());
  };

  return <FileAccess.Provider value={fileAccess}><div ref={hubRef} className="th-hub" onKeyDown={onHubKeyDown}>
   <div className="th-grid" data-view={mobileView} data-thread={thread ? "open" : "closed"} data-work={workOpen && !thread ? "open" : "closed"}>
    <section className="th-list" aria-label="Conversations" {...(listCovered ? { inert: "" } : {})}>
      <div className="th-list-head">
        <label className="th-search">
          <Search aria-hidden="true" />
          <span className="th-sr">Search your conversations</span>
          <input ref={searchRef} type="search" value={search} placeholder="Search" autoComplete="off"
            onChange={(event) => setSearch(event.target.value)} />
        </label>
        {/* A disclosure, so it stays neutral. Reachable from the list in every layout, the phone included. */}
        <button ref={workToggleRef} type="button" className="th-icon-btn" aria-label="Team work" aria-expanded={workOpen} aria-controls="th-work"
          onClick={() => workOpen ? closeWork() : openWork()}><PanelRight aria-hidden="true" /></button>
      </div>
      <div className="th-list-body">
        {/* In one column the list is the only pane on screen, so first use is explained here. */}
        {firstUse && oneColumn && firstUseState("list")}
        <div className="th-group">
          <h2>Channels
            <button ref={newChannelRef} type="button" className="th-icon-btn" aria-label="Create a channel" aria-expanded={form?.kind === "channel"}
              onClick={() => setForm((current) => current?.kind === "channel" ? null : { kind: "channel" })}><Plus aria-hidden="true" /></button>
          </h2>
          {form?.kind === "channel" && <NewChannelForm teammates={teammates} people={people} online={hub.online}
            onCancel={() => closeForm("channel")}
            onCreate={async (input) => {
              const result = await hub.createChannel(input);
              if (result.ok) { setForm(null); setMobileView("conv"); hub.setStreamVisible(true); announce("Channel created"); focusComposer(); }
              else announce(result.message);
              return result;
            }} />}
          {channels.map((conversation) => <ConversationButton key={conversation.id} conversation={conversation} people={people}
            current={conversation.id === hub.activeId} onOpen={() => void open(conversation.id)} />)}
          {!channels.length && <p className="th-note">{query ? "No channels match." : "No channels yet."}</p>}
        </div>
        <div className="th-group">
          <h2>Direct messages
            <button ref={newDmRef} type="button" className="th-icon-btn" aria-label="Message a teammate" aria-expanded={form?.kind === "dm"}
              onClick={() => setForm((current) => current?.kind === "dm" ? null : { kind: "dm" })}><Plus aria-hidden="true" /></button>
          </h2>
          {form?.kind === "dm" && <PersonPicker teammates={teammates} people={people} online={hub.online}
            onCancel={() => closeForm("dm")}
            onPick={async (person) => {
              const result = await hub.openDm(person.user_id);
              if (result.ok) { setForm(null); setMobileView("conv"); hub.setStreamVisible(true); focusComposer(); }
              else announce(result.message);
              return result;
            }} />}
          {dms.map((conversation) => <ConversationButton key={conversation.id} conversation={conversation} people={people}
            current={conversation.id === hub.activeId} onOpen={() => void open(conversation.id)} />)}
          {!dms.length && <p className="th-note">{query ? "No direct messages match." : "No direct messages yet."}</p>}
        </div>
        {query && <p className="th-note">Search covers the conversations you can see.</p>}
      </div>
    </section>

    <section className="th-conv" aria-label={active ? conversationTitle(active, people) : "Conversation"} {...(conversationCovered ? { inert: "" } : {})}>
      {hub.refreshFailed && <p className="th-notice" role="status">Team Hub couldn't refresh. You're seeing what loaded last.
        <button type="button" onClick={() => void hub.retryLoad()}>Try again</button></p>}
      {!hub.online && <p className="th-notice th-notice--warn" role="status"><WifiOff aria-hidden="true" />
        You're offline. Your draft stays here and nothing is sent until you're back.</p>}
      {firstUse && !hub.activeId
        ? (oneColumn ? null : firstUseState("conv"))
        : <Conversation hub={hub} people={people} meId={meId} active={active}
          onBack={() => { setMobileView("list"); window.requestAnimationFrame(() => document.getElementById(`th-conv-${hub.activeId}`)?.focus()); }}
          onOpenThread={openThread} announce={announce} pending={pendingTop} onRetry={retry}
          onMembershipDone={(left) => { if (left) window.requestAnimationFrame(() => searchRef.current?.focus()); else focusComposer(); }}
          onDiscard={(item) => { hub.discard(item.localId); announce("Removed from this screen"); focusComposer(); }}
          taskReads={hub.taskReads}
          preview={active && hub.stream?.status === "ready" && previewHere
            ? previewHere.kind === "task"
              ? <TaskPreview preview={previewHere} people={people} assignable={assignable} meId={meId} canAssignOthers={canAssignOthers}
                where={conversationTitle(active, people)} online={hub.online} firstRef={previewFirstRef}
                onChange={(next) => setPreview((current) => current && current.kind === "task" ? { ...current, ...next, error: null } : current)}
                onCancel={closePreview} onCreate={() => void createTask()} />
              : <HandoffPreview preview={previewHere} where={conversationTitle(active, people)} online={hub.online} canDelegate={canAssignOthers}
                firstRef={previewFirstRef}
                onChange={(next) => setPreview((current) => current && current.kind !== "task" ? { ...current, ...next, error: null } : current)}
                onCancel={closePreview} onContinue={() => void continueInPaige()} />
            : null}
          composer={active && hub.stream?.status === "ready" ? <Composer key={active.id} inputRef={composerRef} conversation={active} people={people} meId={meId}
            online={hub.online} value={draft} onChange={(value) => { setDraft(value); setComposerError(null); }}
            picked={pickedHere} onPick={(mention) => hub.activeId && setPicked((current) => ({ ...current, [hub.activeId!]: [...(current[hub.activeId!] ?? []), mention] }))}
            commands={commands} specialistsOffered={Boolean(openPaige)}
            onCommand={pickCommand} onSpecialist={pickSpecialist}
            attachments={mainScope ? hub.attachments[mainScope] ?? [] : []}
            onAttach={(files) => { if (hub.activeId) { setComposerError(null); hub.attach(hub.activeId, null, files); } }}
            onRetryAttachment={(localId) => mainScope && hub.retryAttachment(mainScope, localId)}
            onRemoveAttachment={(localId) => {
              if (!mainScope) return;
              hub.removeAttachment(mainScope, localId);
              setComposerError(null);
              announce("File removed");
              window.requestAnimationFrame(() => composerRef.current?.focus());
            }}
            error={composerError} onSend={() => void send()} /> : null} />}
    </section>

    {thread && <aside className="th-thread" aria-label="Thread">
      <header className="th-thread-head">
        <h2>Thread{active?.kind === "channel" ? <span> · #{active.name}</span> : null}</h2>
        <button type="button" className="th-icon-btn" aria-label="Close thread" onClick={closeThread}><X aria-hidden="true" /></button>
      </header>
      <div className="th-thread-body">
        {thread.status === "loading" && <StreamSkeleton rows={2} />}
        {(thread.status === "not_found" || thread.status === "unavailable") && <p className="th-note th-note--pad">
          {thread.status === "not_found" ? "This thread isn't available to you." : "This thread couldn't load. Close it and try again."}</p>}
        {thread.status === "ready" && thread.root && <>
          <MessageRow message={thread.root} people={people} meId={meId} taskReads={hub.taskReads} />
          {/* A separator's own text is not read out, so its words are its accessible name too. */}
          <Separator className="th-day" label={thread.root.reply_count === 1 ? "1 reply" : `${thread.root.reply_count} replies`} />
          {thread.hasMore && <div className="th-older">
            <button type="button" className="th-btn th-btn--ghost" disabled={thread.loadingOlder || !hub.online}
              onClick={() => void hub.loadEarlierReplies()}>{thread.loadingOlder ? "Loading earlier replies…" : "Show earlier replies"}</button>
            {thread.olderFailed && <p className="th-error" role="alert">Earlier replies couldn't load. Try again.</p>}
          </div>}
          {thread.replies.map((reply) => <MessageRow key={reply.id} message={reply} people={people} meId={meId} taskReads={hub.taskReads} />)}
          {pendingReplies.map((item) => <PendingRow key={item.localId} item={item} me={me} online={hub.online}
            onRetry={() => void retry(item)} onDiscard={() => { hub.discard(item.localId); announce("Unsent reply deleted"); window.requestAnimationFrame(() => threadComposerRef.current?.focus()); }} />)}
        </>}
      </div>
      {thread.status === "ready" && <div className="th-composer-wrap">
        {/* Announced once, through the live region; shown here and tied to the field. */}
        {threadError && <p id="th-thread-error" className="th-error">{threadError}</p>}
        <DropZone online={hub.online} onFiles={(files) => { setThreadError(null); hub.attach(thread.channelId, thread.rootId, files); }}>
          <label htmlFor="th-thread-reply" className="th-sr">Reply in thread</label>
          <textarea id="th-thread-reply" ref={threadComposerRef} rows={1} placeholder="Reply in thread" value={threadDraft}
            aria-describedby={threadError ? "th-thread-error" : undefined}
            onChange={(event) => { setThreadDraft(event.target.value); setThreadError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendReply(); } }} />
          <AttachmentTray chips={threadChips} onRemove={removeThreadFile}
            onRetry={(localId) => threadScope && hub.retryAttachment(threadScope, localId)} />
          <div className="th-composer-row">
            <AttachButton online={hub.online} onFiles={(files) => { setThreadError(null); hub.attach(thread.channelId, thread.rootId, files); }} />
            <span className="th-hint">{!hub.online ? "Offline · draft kept" : filesHint(threadChips) ?? "Replies stay in this thread"}</span>
            <SendButton ready={(Boolean(threadDraft.trim()) || threadChips.length > 0) && threadFilesOk && hub.online && bodyProblem(threadDraft) !== "too_long"}
              disabled={!hub.online || !threadFilesOk} label="Send reply" onClick={() => void sendReply()} />
          </div>
        </DropZone>
      </div>}
    </aside>}
    {workOpen && !thread && <WorkPanel hub={hub} people={people} conversations={conversations} headingRef={workHeadingRef}
      onClose={() => closeWork()} onJump={(item) => void jumpTo(item)} />}
   </div>
    <div className="th-sr" aria-live="polite" role="status">{announcement}</div>
    {/* The one description every file row carries (§1.4): files are not scanned. */}
    <span id={FILE_DISCLOSURE_ID} className="th-sr">{TEAM_HUB_FILE_DISCLOSURE}</span>
  </div></FileAccess.Provider>;
}

function conversationTitle(conversation: TeamHubConversation, people: TeamHubPerson[]): string {
  return conversation.kind === "channel" ? `#${conversation.name}` : conversationLabel(conversation, people);
}

function ConversationButton({ conversation, people, current, onOpen }: {
  conversation: TeamHubConversation; people: TeamHubPerson[]; current: boolean; onOpen: () => void;
}) {
  const label = conversationLabel(conversation, people);
  const unread = conversation.joined ? conversation.unread : 0;
  return <button type="button" id={`th-conv-${conversation.id}`} className="th-conv-item" data-unread={unread > 0 ? "true" : undefined}
    aria-current={current ? "page" : undefined} onClick={onOpen}>
    {conversation.kind === "dm"
      ? <span className="th-avatar" aria-hidden="true">{initials(label)}</span>
      : conversation.visibility === "private" ? <Lock aria-hidden="true" /> : <Hash aria-hidden="true" />}
    <span className="th-conv-name">{label}{conversation.visibility === "private" && conversation.kind === "channel" ? <span className="th-sr">, private</span> : null}</span>
    {unread > 0 && <><span className="th-badge">{unread}</span><span className="th-sr"> unread</span></>}
  </button>;
}

function NewChannelForm({ teammates, people, online, onCancel, onCreate }: {
  teammates: TeamHubPerson[]; people: TeamHubPerson[]; online: boolean; onCancel: () => void;
  onCreate: (input: { name: string; visibility: "team" | "private"; memberIds: string[]; clientRequestId: string }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"team" | "private">("team");
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request id per form: a retry after a lost answer returns the same channel.
  const requestId = useRef(crypto.randomUUID());
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);
  const normalized = normalizeChannelName(name);
  const nameProblem = channelNameProblem(normalized);
  const canSubmit = Boolean(normalized) && !nameProblem && online && !busy;
  return <form className="th-inline-form" aria-label="Create a channel" onSubmit={async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const result = await onCreate({ name: normalized, visibility, memberIds: members, clientRequestId: requestId.current });
    setBusy(false);
    // The caller announces the refusal; here it is shown and tied to the name field.
    if (!result.ok) { setError(result.message ?? null); nameRef.current?.focus(); }
  }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
    <label className="th-field">Name
      <input ref={nameRef} value={name} autoComplete="off" placeholder="e.g. kickoff-week" maxLength={40}
        aria-invalid={nameProblem ? true : undefined}
        aria-describedby={[nameProblem ? "th-newch-problem" : "", error ? "th-newch-error" : ""].filter(Boolean).join(" ") || undefined}
        onChange={(event) => { setName(normalizeChannelName(event.target.value)); setError(null); }} />
    </label>
    {nameProblem && <p id="th-newch-problem" className="th-error">{nameProblem}</p>}
    <div className="th-seg" role="group" aria-label="Who can see it">
      <button type="button" aria-pressed={visibility === "team"} onClick={() => setVisibility("team")}><Hash aria-hidden="true" />Everyone on the team</button>
      <button type="button" aria-pressed={visibility === "private"} onClick={() => setVisibility("private")}><Lock aria-hidden="true" />Only people I add</button>
    </div>
    {visibility === "private" && <>
      {teammates.length
        ? <div className="th-chips" role="group" aria-label="Add people">{teammates.map((person) =>
          <button key={person.user_id} type="button" className="th-chip" aria-pressed={members.includes(person.user_id)}
            onClick={() => setMembers((current) => current.includes(person.user_id) ? current.filter((id) => id !== person.user_id) : [...current, person.user_id])}>
            {mentionLabel(person, people)}</button>)}</div>
        : <p className="th-note">You're the only person on the team right now.</p>}
      <p className="th-note">People you don't add won't see its name, members or messages.</p>
    </>}
    {error && <p id="th-newch-error" className="th-error">{error}</p>}
    <div className="th-form-actions">
      <button type="button" className="th-btn th-btn--ghost" onClick={onCancel}>Cancel</button>
      <button type="submit" className="th-btn th-btn--act" disabled={!canSubmit} aria-busy={busy || undefined}>
        {!online ? "Offline" : busy ? "Creating…" : "Create channel"}</button>
    </div>
  </form>;
}

function PersonPicker({ teammates, people, online, onCancel, onPick }: {
  teammates: TeamHubPerson[]; people: TeamHubPerson[]; online: boolean; onCancel: () => void;
  onPick: (person: TeamHubPerson) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  return <div className="th-inline-form" role="group" aria-label="Message a teammate"
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
    {teammates.length
      ? teammates.map((person, index) => <button key={person.user_id} ref={index === 0 ? firstRef : undefined} type="button" className="th-option"
        disabled={!online || Boolean(busy)} onClick={async () => {
          setBusy(person.user_id);
          setError(null);
          const result = await onPick(person);
          setBusy(null);
          if (!result.ok) setError(result.message ?? null);
        }}>
        <span className="th-avatar" aria-hidden="true">{initials(person.display_name)}</span>
        <span className="th-option-meta"><span>{mentionLabel(person, people)}</span>
          <small>{[permissionLabel(person.permission) ?? "Member", person.title].filter(Boolean).join(" · ")}</small></span>
      </button>)
      : <p className="th-note">No one else is on the team yet.</p>}
    {error && <p className="th-error">{error}</p>}
    <button ref={teammates.length ? undefined : firstRef} type="button" className="th-btn th-btn--ghost" onClick={onCancel}>Cancel</button>
  </div>;
}

function FirstUse({ teammates, canInvite, onOpenTeamSettings, onCreate, onMessage, compact = false }: {
  teammates: TeamHubPerson[]; canInvite: boolean; onOpenTeamSettings?: () => void; onCreate: () => void; onMessage: () => void; compact?: boolean;
}) {
  return <CenterState icon={<Users aria-hidden="true" />} title="Your team's conversations start here" compact={compact}
    action={<div className="th-actions">
      <button type="button" className="th-btn" onClick={onCreate}>Create a channel</button>
      {teammates.length > 0 && <button type="button" className="th-btn th-btn--ghost" onClick={onMessage}>Message a teammate</button>}
      {canInvite && <button type="button" className="th-link" onClick={onOpenTeamSettings}>Invite people in Settings → Team</button>}
    </div>}>
    Talk with your team in channels and direct messages. Channels can be open to everyone on the team or private to the people you add.
    {teammates.length === 0 && <span className="th-note"> Right now you're the only person here.</span>}
  </CenterState>;
}

function Conversation({ hub, people, meId, active, onBack, onOpenThread, announce, pending, onRetry, onDiscard, onMembershipDone, composer, preview, taskReads }: {
  hub: TeamHub; people: TeamHubPerson[]; meId: string; active: TeamHubConversation | null; onMembershipDone: (leftPrivate: boolean) => void;
  onBack: () => void; onOpenThread: (rootId: string, trigger: HTMLElement) => void; announce: (text: string) => void;
  pending: PendingMessage[]; onRetry: (item: PendingMessage) => void; onDiscard: (item: PendingMessage) => void; composer: ReactNode;
  preview: ReactNode; taskReads: Record<string, TeamHubTaskRead>;
}) {
  const stream = hub.stream;
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<"join" | "leave" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setAdding(false); setActionError(null); setConfirmLeave(false); }, [hub.activeId]);
  const back = <button type="button" className="th-icon-btn th-back" aria-label="Back to conversations" onClick={onBack}><ArrowLeft aria-hidden="true" /></button>;

  if (!hub.activeId || !stream) {
    return <div className="th-conv-main"><div className="th-conv-head">{back}</div>
      <CenterState icon={<Hash aria-hidden="true" />} title="Pick a conversation">Choose a channel or a direct message to read it.</CenterState></div>;
  }
  if (stream.status === "not_found" || (stream.status === "ready" && !active && !stream.channel)) {
    return <div className="th-conv-main"><div className="th-conv-head">{back}<h2>Conversation unavailable</h2></div>
      <CenterState icon={<Lock aria-hidden="true" />} title="This conversation isn't available to you">
        Pick another conversation from the list.</CenterState></div>;
  }
  if (stream.status === "unavailable") {
    return <div className="th-conv-main"><div className="th-conv-head">{back}</div>
      <CenterState icon={<Hash aria-hidden="true" />} title="This conversation couldn't load" role="alert"
        action={<button type="button" className="th-btn" onClick={() => void hub.openConversation(stream.channelId)}>Try again</button>}>
        Nothing was changed. Check your connection and try again.</CenterState></div>;
  }

  const channel = stream.channel;
  const kind = active?.kind ?? channel?.kind ?? "channel";
  const visibility = active?.visibility ?? channel?.visibility ?? "team";
  const joined = active?.joined ?? channel?.joined ?? false;
  const title = active ? conversationLabel(active, people) : channel?.name ?? "";
  const dmPerson = active?.kind === "dm" ? people.find((person) => person.user_id === active.dm_user_id) : null;
  const subtitle = kind === "dm"
    ? dmPerson?.title ?? (dmPerson ? permissionLabel(dmPerson.permission) ?? "Member" : "No longer on the team")
    : visibility === "private"
      // The count is shown only when the server returned one; it is never guessed.
      ? typeof active?.member_count === "number" ? `Private · ${active.member_count} ${active.member_count === 1 ? "member" : "members"}` : "Private"
      : joined ? "Everyone on the team" : "Everyone on the team · you haven't joined";

  const membership = async (action: "join" | "leave") => {
    if (!hub.activeId) return;
    setConfirmLeave(false);
    setBusy(action);
    setActionError(null);
    const result = action === "join" ? await hub.joinChannel(hub.activeId) : await hub.leaveChannel(hub.activeId);
    setBusy(null);
    if (!result.ok) { setActionError(result.message); announce(result.message); return; }
    announce(action === "join" ? `Joined #${title}` : `Left #${title}`);
    // The pressed button is replaced (Join ⇄ Leave) or the channel is gone: put focus somewhere real.
    onMembershipDone(action === "leave" && visibility === "private");
  };

  return <div className="th-conv-main">
    <header className="th-conv-head">
      {back}
      <h2>{kind === "dm"
        ? <span className="th-avatar" aria-hidden="true">{initials(title)}</span>
        : visibility === "private" ? <Lock aria-hidden="true" /> : <Hash aria-hidden="true" />}<span className="th-conv-title">{title}</span></h2>
      <p>{subtitle}</p>
      {stream.status === "ready" && kind === "channel" && <div className="th-head-actions">
        {/* A disclosure, so it stays neutral; gold is spent on the form's own submit. */}
        {visibility === "private" && <button ref={addRef} type="button" className="th-btn" aria-expanded={adding}
          disabled={!hub.online} onClick={() => setAdding((current) => !current)}><UserPlus aria-hidden="true" />Add people</button>}
        {visibility === "team" && !joined && <button type="button" className="th-btn" disabled={!hub.online || Boolean(busy)}
          onClick={() => void membership("join")}>{busy === "join" ? "Joining…" : "Join"}</button>}
        {/* A team channel can be rejoined, so it leaves in one click. A private one asks first. */}
        {joined && <button ref={leaveRef} type="button" className="th-btn th-btn--ghost" disabled={!hub.online || Boolean(busy)}
          aria-expanded={visibility === "private" ? confirmLeave : undefined}
          onClick={() => visibility === "private" ? setConfirmLeave((current) => !current) : void membership("leave")}>{busy === "leave" ? "Leaving…" : "Leave"}</button>}
      </div>}
    </header>
    {confirmLeave && visibility === "private" && kind === "channel" && <LeaveConfirm title={title} lastMember={active?.member_count === 1}
      online={hub.online} onLeave={() => void membership("leave")}
      onCancel={() => { setConfirmLeave(false); window.requestAnimationFrame(() => leaveRef.current?.focus()); }} />}
    {actionError && <p className="th-error th-error--pad">{actionError}</p>}
    {adding && hub.activeId && <AddPeople channelId={hub.activeId} memberIds={active?.member_ids ?? []} people={people} meId={meId} online={hub.online} hub={hub} announce={announce}
      onClose={() => { setAdding(false); window.requestAnimationFrame(() => addRef.current?.focus()); }} />}
    {stream.status === "loading" ? <StreamSkeleton rows={4} /> : <Stream hub={hub} people={people} meId={meId} title={title} kind={kind}
      pending={pending} onRetry={onRetry} onDiscard={onDiscard} onOpenThread={onOpenThread} taskReads={taskReads} />}
    {preview}
    {composer}
  </div>;
}

/** Leaving a private channel ends access until someone adds you back; the last member archives it (A5). */
function LeaveConfirm({ title, lastMember, online, onLeave, onCancel }: {
  title: string; lastMember: boolean; online: boolean; onLeave: () => void; onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  return <div className="th-inline-form th-inline-form--wide th-confirm" role="group" aria-labelledby="th-leave-question"
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
    <p id="th-leave-question" className="th-confirm-text"><b>Leave #{title}?</b>{" "}
      {lastMember
        ? "You're the only member. Leaving archives the channel and its messages, and no one will be able to open it again."
        : "You'll stop seeing its messages. Someone still in the channel has to add you back."}</p>
    <div className="th-form-actions">
      <button ref={cancelRef} type="button" className="th-btn th-btn--ghost" onClick={onCancel}>Stay</button>
      <button type="button" className="th-btn" disabled={!online} onClick={onLeave}>{lastMember ? "Leave and archive" : "Leave channel"}</button>
    </div>
  </div>;
}

function AddPeople({ channelId, memberIds, people, meId, online, hub, announce, onClose }: {
  channelId: string; memberIds: string[]; people: TeamHubPerson[]; meId: string; online: boolean; hub: TeamHub; announce: (text: string) => void; onClose: () => void;
}) {
  // Only active teammates who aren't in the channel yet (member_ids, A4).
  const teammates = people.filter((person) => person.user_id !== meId && !memberIds.includes(person.user_id));
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <form className="th-inline-form th-inline-form--wide" aria-label="Add people to this channel"
    onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}
    onSubmit={async (event) => {
      event.preventDefault();
      if (!chosen.length || busy || !online) return;
      setBusy(true);
      setError(null);
      const result = await hub.addMembers(channelId, chosen);
      setBusy(false);
      if (!result.ok) { setError(result.message); announce(result.message); return; }
      announce(result.value === 0 ? "Everyone you picked was already in this channel" : result.value === 1 ? "Added 1 person" : `Added ${result.value} people`);
      onClose();
    }}>
    {teammates.length
      ? <div className="th-chips" role="group" aria-label="Teammates">{teammates.map((person) =>
        <button key={person.user_id} type="button" className="th-chip" aria-pressed={chosen.includes(person.user_id)}
          onClick={() => setChosen((current) => current.includes(person.user_id) ? current.filter((id) => id !== person.user_id) : [...current, person.user_id])}>
          {mentionLabel(person, people)}</button>)}</div>
      : <p className="th-note">{people.some((person) => person.user_id !== meId) ? "Everyone on the team is already in this channel." : "No one else is on the team yet."}</p>}
    {error && <p className="th-error">{error}</p>}
    <div className="th-form-actions">
      <button type="button" className="th-btn th-btn--ghost" onClick={onClose}>Cancel</button>
      {teammates.length > 0 && <button type="submit" className="th-btn th-btn--act" disabled={!chosen.length || busy || !online} aria-busy={busy || undefined}>
        {busy ? "Adding…" : chosen.length === 1 ? "Add 1 person" : chosen.length > 1 ? `Add ${chosen.length} people` : "Add people"}</button>}
    </div>
  </form>;
}

function Stream({ hub, people, meId, title, kind, pending, onRetry, onDiscard, onOpenThread, taskReads }: {
  hub: TeamHub; people: TeamHubPerson[]; meId: string; title: string; kind: "channel" | "dm";
  pending: PendingMessage[]; onRetry: (item: PendingMessage) => void; onDiscard: (item: PendingMessage) => void;
  onOpenThread: (rootId: string, trigger: HTMLElement) => void; taskReads: Record<string, TeamHubTaskRead>;
}) {
  const stream = hub.stream!;
  const ref = useRef<HTMLDivElement>(null);
  const me = people.find((person) => person.user_id === meId) ?? null;
  const placed = useRef<string | null>(null);
  const older = useRef<{ height: number; top: number } | null>(null);
  const nearBottom = useRef(true);
  /** At the newest message (within PIN_SLACK_PX) as of the last scroll: the only reader a resize re-pins. */
  const atEnd = useRef(true);
  /** The stream's size when its position was last read. A scroll event that arrives with a different
   *  size was caused by layout (our own placement landing a frame late, the browser's scroll
   *  anchoring, a shrinking stream), not by the reader, and is left to the resize handling. */
  const seen = useRef({ height: 0, client: 0 });
  const content = useRef<HTMLDivElement>(null);
  const pendingKey = pending.map((item) => `${item.localId}:${item.status}`).join("|");
  const remember = useCallback((element: HTMLElement) => {
    const gap = element.scrollHeight - element.scrollTop - element.clientHeight;
    nearBottom.current = gap < 80;
    atEnd.current = gap <= PIN_SLACK_PX;
    seen.current = { height: element.scrollHeight, client: element.clientHeight };
  }, []);
  const place = useCallback((element: HTMLElement, top: number) => {
    element.scrollTop = top;
    remember(element);
  }, [remember]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (older.current) {
      // Keep the reader's place when earlier messages load above it.
      place(element, element.scrollHeight - older.current.height + older.current.top);
      older.current = null;
      return;
    }
    if (placed.current !== stream.channelId) {
      placed.current = stream.channelId;
      const divider = element.querySelector<HTMLElement>("[data-new-divider]");
      // Recorded now, not on the scroll event a frame later, so a resize in between can't misread it.
      place(element, divider ? Math.max(0, divider.offsetTop - element.offsetTop - 8) : element.scrollHeight);
      return;
    }
    if (nearBottom.current) place(element, element.scrollHeight);
    // Keyed on each pending row's status too: a send that fails grows its row (Retry, Delete), and
    // that recovery must stay in view.
  }, [stream.channelId, stream.messages, pendingKey, place]);

  // The stream also changes size without a new message: the composer grows when files are attached
  // (the stream gets shorter), and rows grow once their own reads land (a task card's Operations
  // read, an image thumbnail). A reader who was at the newest message stays there; a reader who
  // scrolled up is never moved.
  useEffect(() => {
    const element = ref.current;
    const inner = content.current;
    if (!element || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atEnd.current) place(element, element.scrollHeight);
      else seen.current = { height: element.scrollHeight, client: element.clientHeight };
    });
    observer.observe(element);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [place]);

  const loadOlder = () => {
    const element = ref.current;
    if (element) older.current = { height: element.scrollHeight, top: element.scrollTop };
    void hub.loadOlder();
  };

  let lastDay = "";
  // A labelled region, not a live log: arrivals are announced once, as a count, by the hub's live region.
  return <div ref={ref} className="th-stream" role="region" aria-label="Messages" tabIndex={-1}
    onScroll={(event) => {
      const element = event.currentTarget;
      if (element.scrollHeight !== seen.current.height || element.clientHeight !== seen.current.client) {
        // Layout moved it, not the reader: keep whether they were at the end, and take the new size.
        seen.current = { height: element.scrollHeight, client: element.clientHeight };
        return;
      }
      remember(element);
    }}>
    {/* One box around every row, so a row that grows after placement is one observed size change. */}
    <div ref={content} className="th-stream-content">
    {stream.hasMore && <div className="th-older">
      <button type="button" className="th-btn th-btn--ghost" disabled={stream.loadingOlder || !hub.online} onClick={loadOlder}>
        {stream.loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}</button>
      {stream.olderFailed && <p className="th-error" role="alert">Earlier messages couldn't load. Try again.</p>}
    </div>}
    {!stream.messages.length && !pending.length && <div className="th-empty">
      <p className="th-empty-title">{kind === "dm" ? `This is the start of your conversation with ${title}.` : `No messages in #${title} yet.`}</p>
      <p>Say hello to start the conversation.</p>
    </div>}
    {stream.messages.map((message) => {
      const day = dayKey(message.created_at);
      const separator = day !== lastDay ? <Separator className="th-day" label={dayLabel(message.created_at)} /> : null;
      lastDay = day;
      return <div key={message.id}>
        {separator}
        {stream.dividerBefore === message.id && <Separator className="th-new" label="New messages" text="New" newDivider />}
        <MessageRow message={message} people={people} meId={meId} onOpenThread={onOpenThread} taskReads={taskReads} />
      </div>;
    })}
    {pending.map((item) => <PendingRow key={item.localId} item={item} me={me} online={hub.online}
      onRetry={() => onRetry(item)} onDiscard={() => onDiscard(item)} />)}
    </div>
  </div>;
}

function Separator({ className, label, text = label, newDivider = false }: { className: string; label: string; text?: string; newDivider?: boolean }) {
  return <div className={className} role="separator" aria-label={label} {...(newDivider ? { "data-new-divider": "" } : {})}>{text}</div>;
}

function Author({ person, people, meId, at }: { person: TeamHubPerson | null; people: TeamHubPerson[]; meId: string; at?: string }) {
  // Two active people with one name are told apart by title here too, not only in the @ list.
  const namesake = person ? people.filter((other) => other.display_name === person.display_name).length > 1 : false;
  const role = person ? [namesake ? person.title : null, permissionLabel(person.permission)].filter(Boolean).join(" · ") : "";
  return <div className="th-who">
    <b>{person?.display_name ?? "Former teammate"}{person?.user_id === meId ? " (you)" : ""}</b>
    {role && <span className="th-role">{role}</span>}
    {at && <time dateTime={at}>{timeLabel(at)}</time>}
  </div>;
}

function MessageRow({ message, people, meId, onOpenThread, taskReads }: {
  message: TeamHubMessage; people: TeamHubPerson[]; meId: string; onOpenThread?: (rootId: string, trigger: HTMLElement) => void;
  taskReads?: Record<string, TeamHubTaskRead>;
}) {
  const author = people.find((person) => person.user_id === message.author_user_id) ?? null;
  const name = author?.display_name ?? "Former teammate";
  return <article id={`th-msg-${message.id}`} tabIndex={-1} className="th-msg" aria-label={`${name} at ${timeLabel(message.created_at)}`}>
    <span className="th-avatar th-avatar--lg" aria-hidden="true">{initials(name)}</span>
    <div className="th-msg-body">
      <Author person={author} people={people} meId={meId} at={message.created_at} />
      {message.work_ref
        // A command message: its fixed words are a tag, and the task itself is read from Operations.
        ? <p className="th-text"><span className="th-cmdtag">{message.body}</span></p>
        // A files-only message has no text line at all, not an empty one.
        : message.body || !message.files.length ? <p className="th-text">{mentionRuns(message.body, message.mentions, people).map((run, index) =>
          run.mention ? <span key={index} className="th-mention">{run.text}</span> : <span key={index}>{run.text}</span>)}</p> : null}
      {message.files.length > 0 && <MessageFiles files={message.files} />}
      {message.work_ref && <TaskCard id={message.work_ref.id} read={taskReads?.[message.work_ref.id]} people={people} meId={meId} />}
      {onOpenThread && message.reply_count > 0 && <button type="button" className="th-replies"
        onClick={(event) => onOpenThread(message.id, event.currentTarget)}>
        <MessageSquareReply aria-hidden="true" />{message.reply_count === 1 ? "1 reply" : `${message.reply_count} replies`}
        {message.last_reply_at && <span> · last {timeLabel(message.last_reply_at)}</span>}</button>}
    </div>
    {onOpenThread && <button type="button" className="th-icon-btn th-reply-action" aria-label={`Reply in thread to ${name}`}
      onClick={(event) => onOpenThread(message.id, event.currentTarget)}><MessageSquareReply aria-hidden="true" /></button>}
  </article>;
}

function PendingRow({ item, me, online, onRetry, onDiscard }: {
  item: PendingMessage; me: TeamHubPerson | null; online: boolean; onRetry: () => void; onDiscard: () => void;
}) {
  const name = me?.display_name ?? "You";
  const task = item.kind === "task" ? item.task : undefined;
  return <article className="th-msg th-msg--pending" aria-label={task
    ? (item.status === "failed" ? "Your task, not confirmed" : "Your task, being created")
    : (item.status === "failed" ? "Your message, not sent" : "Your message, sending")}>
    <span className="th-avatar th-avatar--lg" aria-hidden="true">{initials(name)}</span>
    <div className="th-msg-body">
      <div className="th-who"><b>{name} (you)</b>{item.status === "sending" && <span className="th-role">{task ? "Creating task…" : "Sending…"}</span>}</div>
      {task
        ? <p className="th-text"><span className="th-cmdtag">{item.body}</span> {task.title}</p>
        : item.body ? <p className="th-text">{item.body}</p> : null}
      {item.files.length > 0 && <ul className="th-files" aria-label={item.files.length === 1 ? "1 file" : `${item.files.length} files`}>
        {item.files.map((file) => <li key={file.localId}><div className="th-file">
          <span className="th-file-glyph" aria-hidden="true"><FileGlyph mime={file.mime} /></span>
          <span className="th-file-meta"><span className="th-file-name" title={file.name}>{file.name}</span><small><span className="th-file-size">{fileSizeLabel(file.size)}</span></small></span>
        </div></li>)}
      </ul>}
      {/* Announced once by the live region when the send fails; shown here with its recovery. */}
      {item.status === "failed" && <div className="th-fail">{task ? "Not confirmed. Retry checks first, so the task is never created twice." : "Not sent. Your message is kept here."}
        <button type="button" disabled={!online} onClick={onRetry}>Retry</button>
        <button type="button" onClick={onDiscard}>Remove</button></div>}
    </div>
  </article>;
}

type ComposerProps = {
  conversation: TeamHubConversation; people: TeamHubPerson[]; meId: string; online: boolean;
  value: string; onChange: (value: string) => void; picked: PickedMention[]; onPick: (mention: PickedMention) => void;
  error: string | null; onSend: () => void; inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  /** The `/` menu's commands (increment 2); the PAIGE handoffs are left out where PAIGE can't open. */
  commands: readonly TeamHubCommand[];
  onCommand: (command: TeamHubCommand, draft: string) => void;
  /** The six specialists join the @ list only where a pick can continue in PAIGE. */
  specialistsOffered: boolean;
  onSpecialist: (name: SpecialistName, draftWithoutQuery: string) => void;
  /** Increment 3: this composer's file chips, and what picking, retrying and removing one does. */
  attachments: AttachmentChip[];
  onAttach: (files: File[]) => void;
  onRetryAttachment: (localId: string) => void;
  onRemoveAttachment: (localId: string) => void;
};

const SPECIALIST_ROLES: Record<string, string> = Object.fromEntries(VP_ROSTER.map((vp) => [vp.name, vp.role.replace(/^VP /, "")]));

type MentionItem = { kind: "person"; key: string; person: TeamHubPerson } | { kind: "specialist"; key: string; name: SpecialistName };

function Composer({ conversation, people, meId, online, value, onChange, picked, onPick, error, onSend, inputRef, commands, onCommand, specialistsOffered, onSpecialist,
  attachments, onAttach, onRetryAttachment, onRemoveAttachment }: ComposerProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  // The `/` menu: typed (the draft starts with `/` or `/PAIGE`) or opened by the slash button over a draft.
  const [command, setCommand] = useState<{ query: string; fromButton: boolean } | null>(null);
  const [index, setIndex] = useState(0);
  const caret = useRef<number | null>(null);
  const scope = mentionScope(conversation);
  const peopleOffered = mentionCandidates(scope, people, meId, "").length > 0;
  // Offered when someone besides the author can see this conversation, or a specialist can be asked.
  const mentionsOffered = peopleOffered || specialistsOffered;
  const items = useMemo<MentionItem[]>(() => {
    if (!mention) return [];
    const needle = mention.query.trim().toLowerCase();
    const found: MentionItem[] = mentionCandidates(scope, people, meId, mention.query).map((person) => ({ kind: "person", key: person.user_id, person }));
    if (specialistsOffered) {
      for (const name of SPECIALIST_NAMES) if (name.toLowerCase().startsWith(needle)) found.push({ kind: "specialist", key: `sp-${name}`, name });
    }
    return found;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- scope derives from the conversation
  }, [mention, people, meId, conversation, specialistsOffered]);
  const commandOptions = command ? commandMatches(command.query, commands) : [];
  const mentionOpen = Boolean(mention && items.length);
  const commandOpen = Boolean(command && commandOptions.length);
  const listOpen = mentionOpen || commandOpen;
  const optionCount = commandOpen ? commandOptions.length : items.length;
  const label = conversation.kind === "dm" ? `Message ${conversationLabel(conversation, people)}` : `Message #${conversation.name}`;
  const problem = bodyProblem(value);
  // Files only is a message too; every chip must be ready before anything leaves.
  const filesOk = attachments.every((chip) => chip.state === "ready");
  const ready = online && filesOk && (problem === null || (problem === "empty" && attachments.length > 0));
  const listId = `th-mentions-${conversation.id}`;
  const commandListId = `th-commands-${conversation.id}`;
  const disabledCommand = (item: TeamHubCommand) => item.kind === "task" && !online;
  const activeOption = commandOpen ? `${commandListId}-${commandOptions[index]?.kind}` : mentionOpen ? `${listId}-${items[index]?.key}` : undefined;

  useLayoutEffect(() => {
    if (caret.current === null || !localRef.current) return;
    localRef.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  const setRefs = (node: HTMLTextAreaElement | null) => {
    localRef.current = node;
    inputRef.current = node;
  };

  const detect = (text: string, position: number) => {
    const typedCommand = commandQuery(text);
    if (typedCommand) {
      setMention(null);
      setCommand((current) => {
        if (!current || current.fromButton || current.query !== typedCommand.query) setIndex(0);
        return { query: typedCommand.query, fromButton: false };
      });
      return;
    }
    setCommand(null);
    if (!mentionsOffered) { setMention(null); return; }
    const before = text.slice(0, position);
    const at = before.lastIndexOf("@");
    if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) { setMention(null); return; }
    const query = before.slice(at + 1);
    if (/\n/.test(query) || query.length > 60) { setMention(null); return; }
    const matches = mentionCandidates(scope, people, meId, query).length
      + (specialistsOffered ? SPECIALIST_NAMES.filter((name) => name.toLowerCase().startsWith(query.trim().toLowerCase())).length : 0);
    if (!matches && /\s/.test(query)) { setMention(null); return; }
    setMention({ start: at, query });
    setIndex(0);
  };

  const pick = (item: MentionItem) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    if (item.kind === "specialist") {
      // A specialist isn't a stored mention: the pick opens the PAIGE preview with the rest of the draft.
      const next = `${value.slice(0, mention.start)}${value.slice(end)}`.replace(/[ \t]{2,}/g, " ");
      setMention(null);
      onSpecialist(item.name, next);
      return;
    }
    const text = mentionLabel(item.person, people);
    const next = `${value.slice(0, mention.start)}@${text} ${value.slice(end)}`;
    caret.current = mention.start + text.length + 2;
    onPick({ user_id: item.person.user_id, label: text });
    onChange(next);
    setMention(null);
    localRef.current?.focus();
  };

  const pickCommand = (item: TeamHubCommand | undefined) => {
    if (!item || disabledCommand(item)) return;
    setCommand(null);
    onCommand(item, value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (listOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + optionCount) % optionCount);
      return;
    }
    if (listOpen && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      if (commandOpen) pickCommand(commandOptions[index]);
      else pick(items[index]);
      return;
    }
    if (event.key === "Escape" && (mention || command)) {
      event.preventDefault();
      setMention(null);
      setCommand(null);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  const insertAt = () => {
    const element = localRef.current;
    const position = element?.selectionStart ?? value.length;
    const spacer = position > 0 && !/\s/.test(value[position - 1]) ? " " : "";
    const next = `${value.slice(0, position)}${spacer}@${value.slice(position)}`;
    caret.current = position + spacer.length + 1;
    onChange(next);
    setCommand(null);
    setMention({ start: position + spacer.length, query: "" });
    setIndex(0);
    element?.focus();
  };

  const openCommands = () => {
    setMention(null);
    setIndex(0);
    if (!value.trim()) {
      caret.current = 1;
      onChange("/");
      setCommand({ query: "", fromButton: false });
    } else {
      // Over a written draft the menu opens without touching it; the draft becomes the prefill.
      setCommand({ query: "", fromButton: true });
    }
    localRef.current?.focus();
  };

  return <div className="th-composer-wrap">
    {mentionOpen && <div className="th-pop" id={listId} role="listbox" aria-label="People and specialists">
      {items.map((item, optionIndex) => {
        const heading = item.kind === "specialist" && (optionIndex === 0 || items[optionIndex - 1].kind !== "specialist");
        return <Fragment key={item.key}>
          {heading && <div className="th-pop-head" aria-hidden="true">PAIGE's specialists</div>}
          <div id={`${listId}-${item.key}`} role="option" aria-selected={optionIndex === index} className="th-option"
            onMouseDown={(event) => event.preventDefault()} onClick={() => pick(item)} onMouseEnter={() => setIndex(optionIndex)}>
            {item.kind === "person"
              ? <><span className="th-avatar" aria-hidden="true">{initials(item.person.display_name)}</span>
                <span className="th-option-meta"><span>{mentionLabel(item.person, people)}</span>
                  <small>{[permissionLabel(item.person.permission) ?? "Member", item.person.title].filter(Boolean).join(" · ")}</small></span></>
              : <><span className="th-avatar th-avatar--sp" aria-hidden="true">{item.name.slice(0, 3)}</span>
                <span className="th-option-meta"><span>{item.name}</span>
                  <small>{SPECIALIST_ROLES[item.name] ?? "Specialist"} · continues in PAIGE</small></span></>}
          </div>
        </Fragment>;
      })}
    </div>}
    {mention && !items.length && <p className="th-pop th-pop--note" role="status">No active teammate in this conversation matches.</p>}
    {commandOpen && <div className="th-pop" id={commandListId} role="listbox" aria-label="PAIGE commands">
      <div className="th-pop-head" aria-hidden="true">PAIGE</div>
      {commandOptions.map((item, optionIndex) => <div key={item.kind} id={`${commandListId}-${item.kind}`} role="option"
        aria-selected={optionIndex === index} aria-disabled={disabledCommand(item) || undefined} className="th-option"
        onMouseDown={(event) => event.preventDefault()} onClick={() => pickCommand(item)} onMouseEnter={() => setIndex(optionIndex)}>
        <span className="th-pmark" aria-hidden="true"><CommandGlyph /></span>
        <span className="th-option-meta"><span>{item.title}</span>
          <small>{disabledCommand(item) ? "Unavailable while offline" : item.description}</small></span>
        <span className="th-kbd">{item.risk}</span>
      </div>)}
    </div>}
    {command && !commandOptions.length && <p className="th-pop th-pop--note" role="status">No command matches. Try Draft a task.</p>}
    {/* Refusals are announced once, by the hub's live region; here they are shown and tied to the field. */}
    {error && <p id={`${listId}-error`} className="th-error">{error}</p>}
    {problem === "too_long" && !error && <p id={`${listId}-length`} className="th-error">{messageLength(value).toLocaleString()} of {MESSAGE_MAX_LENGTH.toLocaleString()} characters.</p>}
    <DropZone online={online} onFiles={onAttach}>
      <label htmlFor={`th-composer-${conversation.id}`} className="th-sr">{label}</label>
      <textarea id={`th-composer-${conversation.id}`} ref={setRefs} rows={1} value={value} placeholder={label}
        role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={listOpen}
        aria-controls={commandOpen ? commandListId : mentionOpen ? listId : undefined}
        aria-activedescendant={listOpen ? activeOption : undefined}
        aria-describedby={error ? `${listId}-error` : problem === "too_long" ? `${listId}-length` : undefined}
        onChange={(event) => { onChange(event.target.value); detect(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
        onKeyDown={onKeyDown}
        onBlur={() => { setMention(null); setCommand(null); }} />
      <AttachmentTray chips={attachments} onRemove={onRemoveAttachment} onRetry={onRetryAttachment} />
      <div className="th-composer-row">
        {mentionsOffered && <button type="button" className="th-icon-btn" aria-label="Mention someone" disabled={!online}
          onMouseDown={(event) => event.preventDefault()} onClick={insertAt}><AtSign aria-hidden="true" /></button>}
        {/* Between @ and /, as approved (§7). */}
        <AttachButton online={online} onFiles={onAttach} />
        <button type="button" className="th-icon-btn" aria-label="PAIGE commands" aria-haspopup="listbox" aria-expanded={commandOpen}
          onMouseDown={(event) => event.preventDefault()} onClick={openCommands}><Slash aria-hidden="true" /></button>
        <span className="th-hint">{!online ? "Offline · draft kept" : filesHint(attachments) ?? (mentionsOffered ? "@ to mention · / for PAIGE" : "/ for PAIGE · Shift+Enter for a new line")}</span>
        <SendButton ready={ready} disabled={!online || !filesOk} label="Send" onClick={onSend} />
      </div>
    </DropZone>
    {picked.length > 0 && <span className="th-sr">Mentioning {picked.map((item) => item.label).join(", ")}</span>}
  </div>;
}

/** The PAIGE command mark (a slash and an orb): the geometry the shell's Command Mark uses, in hub tokens. */
function CommandGlyph() {
  return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <polygon points="21,13.6 30.5,13.6 21,34.4 11.5,34.4" fill="var(--pg-ink-2)" stroke="var(--pg-ink-2)" strokeWidth="3.2" strokeLinejoin="round" />
    <circle cx="34.5" cy="30.5" r="5.5" fill="var(--pg-violet)" />
  </svg>;
}

/** A single-choice row of chips (a radio group): arrow keys move the choice, as a radio group does. */
function RadioChips<T extends string>({ label, options, value, onChange, disabled }: {
  label: string; options: Array<{ value: T; text: string; detail?: string }>; value: T; onChange: (value: T) => void; disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || options.length < 2) return;
    event.preventDefault();
    const at = Math.max(0, options.findIndex((option) => option.value === value));
    const next = (at + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return <div className="th-chips" role="radiogroup" aria-label={label} onKeyDown={move}>
    {options.map((option, optionIndex) => <button key={option.value} ref={(node) => { refs.current[optionIndex] = node; }} type="button"
      role="radio" aria-checked={option.value === value} tabIndex={option.value === value ? 0 : -1} className="th-chip" disabled={disabled}
      onClick={() => onChange(option.value)}>{option.text}{option.detail && <small>{option.detail}</small>}</button>)}
  </div>;
}

function PreviewHead({ id, title, busy, onCancel }: { id: string; title: string; busy: boolean; onCancel: () => void }) {
  return <header className="th-pv-head">
    <span className="th-pmark" aria-hidden="true"><CommandGlyph /></span>
    <h3 id={id}>{title}</h3>
    <button type="button" className="th-icon-btn" aria-label="Cancel" disabled={busy} onClick={onCancel}><X aria-hidden="true" /></button>
  </header>;
}

/** Esc closes the preview (the innermost layer) unless it is mid-request; either way the hub's Esc waits. */
const previewEscape = (busy: boolean, onCancel: () => void) => (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.key !== "Escape" || event.nativeEvent.defaultPrevented) return;
  event.preventDefault();
  if (!busy) onCancel();
};

function TaskPreview({ preview, people, assignable, meId, canAssignOthers, where, online, firstRef, onChange, onCancel, onCreate }: {
  preview: Extract<Preview, { kind: "task" }>; people: TeamHubPerson[]; assignable: TeamHubPerson[]; meId: string; canAssignOthers: boolean;
  where: string; online: boolean; firstRef: MutableRefObject<HTMLElement | null>;
  onChange: (next: Partial<Pick<Extract<Preview, { kind: "task" }>, "title" | "assigneeId" | "due">>) => void; onCancel: () => void; onCreate: () => void;
}) {
  const busy = preview.busy;
  const today = localDay(new Date().toISOString());
  const options = (assignable.length ? assignable : people.filter((person) => person.user_id === meId)).map((person) => ({
    value: person.user_id, text: person.user_id === meId ? `${person.display_name} (you)` : mentionLabel(person, people),
  }));
  // noValidate: the preview says what is wrong in its own words, instead of a browser bubble blocking submit.
  return <form className="th-preview" aria-labelledby="th-pv-task" noValidate onKeyDown={previewEscape(busy, onCancel)}
    onSubmit={(event) => { event.preventDefault(); onCreate(); }}>
    <PreviewHead id="th-pv-task" title="Draft a task" busy={busy} onCancel={onCancel} />
    <div className="th-pv-body">
      <label className="th-field">Task
        <input ref={(node) => { firstRef.current = node; }} value={preview.title} autoComplete="off" maxLength={500} disabled={busy}
          aria-invalid={preview.error ? true : undefined} aria-describedby={preview.error ? "th-pv-task-error" : undefined}
          placeholder="What needs to be done" onChange={(event) => onChange({ title: event.target.value })} />
      </label>
      <div className="th-pv-grid">
        <div className="th-field"><span>Assignee</span>
          {canAssignOthers
            ? <RadioChips label="Assignee" options={options} value={preview.assigneeId} disabled={busy} onChange={(assigneeId) => onChange({ assigneeId })} />
            : <span className="th-pv-static">{options[0]?.text ?? "You"}</span>}
        </div>
        <label className="th-field">Due (optional)
          <input type="date" min={today} value={preview.due} disabled={busy} onChange={(event) => onChange({ due: event.target.value })} />
        </label>
        <div className="th-field"><span>Linked to</span><span className="th-pv-static">{where}</span></div>
      </div>
      {!canAssignOthers && <p className="th-note">Only an owner or admin can give a task to someone else, so this one is yours.</p>}
      {preview.error && <p id="th-pv-task-error" className="th-error">{preview.error}</p>}
      <p className="th-pv-why">Creates one task in Operations. This conversation shows its status from there. Nothing is sent to a client.</p>
    </div>
    <div className="th-pv-foot">
      <span className="th-pv-risk">Creates a task in Operations</span>
      <button type="button" className="th-btn th-btn--ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      {/* The one gold act in increment 2. */}
      <button type="submit" className="th-btn th-btn--act" disabled={busy || !online} aria-busy={busy || undefined}>
        {!online ? "Offline" : busy ? "Creating…" : "Create task"}</button>
    </div>
  </form>;
}

const HANDOFF_TITLES = { specialist: "Ask a specialist", approval: "Request approval", meeting: "Schedule a meeting" } as const;

function HandoffPreview({ preview, where, online, canDelegate, firstRef, onChange, onCancel, onContinue }: {
  preview: Extract<Preview, { kind: "specialist" | "approval" | "meeting" }>; where: string; online: boolean; canDelegate: boolean;
  firstRef: MutableRefObject<HTMLElement | null>;
  onChange: (next: Partial<Pick<Extract<Preview, { kind: "specialist" | "approval" | "meeting" }>, "specialist" | "ask" | "alsoPost">>) => void;
  onCancel: () => void; onContinue: () => void;
}) {
  const busy = preview.busy;
  const kind: TeamHubCommandKind = preview.kind;
  const specialist = preview.specialist;
  const field = preview.kind === "specialist" ? `What ${specialist} should do` : preview.kind === "approval" ? "What needs approval" : "What the meeting is for";
  const why = preview.kind === "specialist"
    ? `The request goes to PAIGE, addressed to ${specialist}. You press send there, and PAIGE shows the approval card before ${specialist} starts anything.`
    : preview.kind === "approval"
      ? "The request goes to PAIGE. PAIGE shows the approval there, through the one approval queue, before anything is sent."
      : "The request goes to PAIGE. PAIGE checks Calendar and shows the slot there before anything is booked.";
  const posting = preview.kind === "specialist" && preview.alsoPost;
  return <form className="th-preview" aria-labelledby={`th-pv-${kind}`} noValidate onKeyDown={previewEscape(busy, onCancel)}
    onSubmit={(event) => { event.preventDefault(); onContinue(); }}>
    <PreviewHead id={`th-pv-${kind}`} title={HANDOFF_TITLES[preview.kind]} busy={busy} onCancel={onCancel} />
    <div className="th-pv-body">
      {preview.kind === "specialist" && <div className="th-field"><span>Specialist</span>
        <RadioChips label="Specialist" value={specialist} disabled={busy} onChange={(next) => onChange({ specialist: next })}
          options={SPECIALIST_NAMES.map((name) => ({ value: name, text: name, detail: SPECIALIST_ROLES[name] }))} />
      </div>}
      <label className="th-field">{field}
        <input ref={(node) => { firstRef.current = node; }} value={preview.ask} autoComplete="off" maxLength={2000} disabled={busy}
          aria-describedby={preview.error ? `th-pv-${kind}-error` : undefined} onChange={(event) => onChange({ ask: event.target.value })} />
      </label>
      {preview.kind === "specialist" && <>
        <button type="button" className="th-chip th-pv-toggle" aria-pressed={preview.alsoPost} disabled={busy}
          onClick={() => onChange({ alsoPost: !preview.alsoPost })}>Also post my message in {where}</button>
        {preview.alsoPost && <p className="th-note">Posted as @{specialist} in plain text. It doesn't notify anyone or start any work.</p>}
        {!canDelegate && <p className="th-pv-notice" role="note">Only an owner or admin can hand work to a specialist. PAIGE checks this before anything starts.</p>}
      </>}
      {preview.error && <p id={`th-pv-${kind}-error`} className="th-error">{preview.error}</p>}
      <p className="th-pv-why">{why} Nothing is created in Team Hub.</p>
    </div>
    <div className="th-pv-foot">
      <span className="th-pv-risk">Opens PAIGE · you confirm there</span>
      <button type="button" className="th-btn th-btn--ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      {/* Neutral, never gold: PAIGE holds the act. */}
      <button type="submit" className="th-btn" disabled={busy || (posting && !online)} aria-busy={busy || undefined}>
        {busy ? "Posting…" : "Continue in PAIGE"}</button>
    </div>
  </form>;
}

const dueLabel = (instant: string | null) => instant
  ? new Date(instant).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  : "No due date";

function assigneeLabel(userId: string | null, people: TeamHubPerson[], meId: string): string {
  if (!userId) return "Unassigned";
  const person = people.find((item) => item.user_id === userId);
  if (!person) return "Former teammate";
  return person.user_id === meId ? `${person.display_name} (you)` : mentionLabel(person, people);
}

/**
 * The card a task message carries. Everything but the record id is read from the original
 * Operations record, with the time it was read; Team Hub stores none of it. A record the caller's
 * RLS doesn't return is said to be out of sight — its status is never guessed.
 */
function TaskCard({ id, read, people, meId }: { id: string; read: TeamHubTaskRead | undefined; people: TeamHubPerson[]; meId: string }) {
  const short = id.slice(0, 8);
  const state = read?.state ?? "loading";
  return <div className="th-src" role="group" aria-label={`Task in Operations, record ${short}`}>
    <div className="th-src-top"><ClipboardList aria-hidden="true" /><span className="th-src-kind">Task in Operations</span>
      <span className="th-src-id" title={id}>{short}</span></div>
    <div className="th-src-mid">
      {read?.state === "read"
        ? <>
          <strong>{read.record.title || "Untitled task"}</strong>
          <dl className="th-facts">
            <dt>Assignee</dt><dd>{assigneeLabel(read.record.assigned_to_user_id, people, meId)}</dd>
            <dt>Due</dt><dd>{dueLabel(read.record.due_at)}</dd>
            <dt>Status</dt><dd><span className="th-state" data-status={read.record.status}>{workStatusLabel(read.record.status)}</span></dd>
          </dl>
        </>
        : <p className="th-src-note">{state === "unreadable" ? "You can't see this task in Operations."
          : state === "failed" ? "Its status couldn't be read from Operations. Team Hub reads it again on the next refresh."
            : "Reading status from Operations…"}</p>}
    </div>
    {read && read.state !== "loading" && <div className="th-src-foot">
      <span className="th-src-fresh">{read.state === "read" ? `Read from Operations · ${timeLabel(read.readAt)}` : `Checked ${timeLabel(read.readAt)}`}</span>
    </div>}
  </div>;
}

/**
 * The Team work panel: tasks started from conversations the caller can see now, newest first. The
 * list holds links only; each status is read from Operations, with its time, and a row the caller
 * can't read there says so. A row opens its message.
 */
function WorkPanel({ hub, people, conversations, headingRef, onClose, onJump }: {
  hub: TeamHub; people: TeamHubPerson[]; conversations: TeamHubConversation[]; headingRef: RefObject<HTMLHeadingElement>;
  onClose: () => void; onJump: (item: TeamHubWorkItem) => void;
}) {
  const work = hub.work;
  const where = (channelId: string) => {
    const conversation = conversations.find((item) => item.id === channelId);
    return conversation ? conversationTitle(conversation, people) : "Conversation";
  };
  return <aside id="th-work" className="th-thread th-work" aria-labelledby="th-work-title">
    <header className="th-thread-head">
      <button type="button" className="th-icon-btn th-back" aria-label="Back" onClick={onClose}><ArrowLeft aria-hidden="true" /></button>
      <h2 id="th-work-title" ref={headingRef} tabIndex={-1}>Team work</h2>
      <button type="button" className="th-icon-btn th-work-close" aria-label="Close team work" onClick={onClose}><X aria-hidden="true" /></button>
    </header>
    <div className="th-thread-body th-work-body">
      {(work.status === "loading" || work.status === "idle") && <StreamSkeleton rows={3} />}
      {work.status === "unavailable" && <div className="th-work-empty" role="alert"><b>Team work couldn't load</b>
        <span>Nothing was changed. Check your connection and try again.</span>
        <button type="button" className="th-btn" onClick={() => void hub.listWork("open")}>Try again</button></div>}
      {work.status === "ready" && !work.items.length && <div className="th-work-empty"><b>No team work yet</b>
        <span>Tasks you start here show with their status from Operations.</span></div>}
      {work.status === "ready" && work.items.length > 0 && <ul className="th-work-list">
        {work.items.map((item) => {
          const read = hub.taskReads[item.work_id];
          const short = item.work_id.slice(0, 8);
          return <li key={item.message_id}>
            <button type="button" className="th-work-row" onClick={() => onJump(item)}>
              <span className="th-work-top">
                <b>{read?.state === "read" ? read.record.title || "Untitled task" : `Task ${short}`}</b>
                {read?.state === "read" && <span className="th-state" data-status={read.record.status}>{workStatusLabel(read.record.status)}</span>}
              </span>
              {read?.state === "unreadable" && <span className="th-work-note">You can't see this task in Operations</span>}
              {read?.state === "failed" && <span className="th-work-note">Its status couldn't be read from Operations</span>}
              {(!read || read.state === "loading") && <span className="th-work-note">Reading status from Operations…</span>}
              <small>{short} · {where(item.channel_id)}{read && read.state !== "loading" ? ` · read ${timeLabel(read.readAt)}` : ""}</small>
            </button>
          </li>;
        })}
      </ul>}
    </div>
  </aside>;
}

// ── Increment 3: attachments ──

const FILE_DISCLOSURE_ID = "th-file-disclosure";

/** How file rows mint their URLs and speak, without threading both through every message row. */
const FileAccess = createContext<{ sign: (path: string, download?: string) => Promise<string | null>; announce: (text: string) => void }>({
  sign: async () => null, announce: () => undefined,
});

/** Why a composer can't send yet because of its files, or null when every file is ready. */
function filesProblem(chips: AttachmentChip[]): string | null {
  if (chips.some((chip) => chip.state === "refused" || chip.state === "failed")) return "Remove the files that can't be attached, or retry them, then send.";
  if (chips.some((chip) => chip.state === "uploading" || chip.state === "checking")) return "Wait for your files to finish uploading.";
  return null;
}

/** The composer hint while files are in play; null leaves the usual hint. */
function filesHint(chips: AttachmentChip[]): string | null {
  if (chips.some((chip) => chip.state === "uploading" || chip.state === "checking")) return "Uploading files…";
  if (chips.some((chip) => chip.state === "failed")) return "Retry or remove files to send";
  if (chips.some((chip) => chip.state === "refused")) return "Remove refused files to send";
  return null;
}

function FileGlyph({ mime }: { mime: string | null }) {
  const kind = mime && TEAM_HUB_FILE_TYPES.some((type) => type.mime === mime) ? fileKind(mime as TeamHubFile["mime"]) : "document";
  return kind === "image" ? <FileImage aria-hidden="true" /> : kind === "sheet" ? <FileSpreadsheet aria-hidden="true" /> : <FileText aria-hidden="true" />;
}

const typeLabel = (mime: string) => TEAM_HUB_FILE_TYPES.find((type) => type.mime === mime)?.label ?? "File";

/**
 * The composer box, which also takes dropped files. Only a drag that carries files is accepted, so
 * dragging text into the box still drops text.
 */
function DropZone({ online, onFiles, children }: { online: boolean; onFiles: (files: File[]) => void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const carriesFiles = (event: ReactDragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  return <div className="th-composer" data-drop={over ? "" : undefined}
    onDragOver={(event) => { if (!online || !carriesFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setOver(true); }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }}
    onDrop={(event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setOver(false);
      if (online) onFiles(Array.from(event.dataTransfer.files ?? []));
    }}>
    {children}
  </div>;
}

/** The paperclip and its hidden input, whose `accept` is exactly the allowed extensions. */
function AttachButton({ online, onFiles }: { online: boolean; onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <>
    <button type="button" className="th-icon-btn" aria-label={TEAM_HUB_ATTACH_LABEL} title={TEAM_HUB_ATTACH_LABEL} disabled={!online}
      onMouseDown={(event) => event.preventDefault()} onClick={() => inputRef.current?.click()}><Paperclip aria-hidden="true" /></button>
    <input ref={inputRef} type="file" multiple accept={TEAM_HUB_FILE_ACCEPT} hidden tabIndex={-1}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        // Cleared, so picking the same file again (after removing it) is a new pick.
        event.target.value = "";
        onFiles(files);
      }} />
  </>;
}

/**
 * The files waiting in a composer, each as a chip with its real state: Uploading…, Checking…, ready,
 * or refused with the reason. A chip is removable in every state; a failed upload can be retried.
 * The disclosure sits under the chips, quiet, whenever a file is in play.
 */
function AttachmentTray({ chips, onRemove, onRetry }: { chips: AttachmentChip[]; onRemove: (localId: string) => void; onRetry: (localId: string) => void }) {
  if (!chips.length) return null;
  const typeRefused = chips.some((chip) => chip.reason === "type");
  return <div className="th-atts">
    <ul className="th-att-list" aria-label={chips.length === 1 ? "1 attached file" : `${chips.length} attached files`}>
      {chips.map((chip) => {
        const status = chip.state === "uploading" ? "Uploading…"
          : chip.state === "checking" ? "Checking…"
            : chip.state === "ready" ? `${fileSizeLabel(chip.size)} · Ready`
              : chip.state === "failed" ? "Upload didn't finish"
                : fileRefusalMessage(chip.reason ?? "type");
        return <li key={chip.localId} className="th-att" data-state={chip.state}>
          <span className="th-att-glyph" aria-hidden="true"><FileGlyph mime={chip.mime} /></span>
          <span className="th-att-meta">
            <span className="th-att-name" title={chip.name}>{chip.name}</span>
            <small className="th-att-state">{status}</small>
          </span>
          {chip.state === "failed" && <button type="button" className="th-att-retry" aria-label={`Retry ${chip.name}`}
            onMouseDown={(event) => event.preventDefault()} onClick={() => onRetry(chip.localId)}>Retry</button>}
          <button type="button" className="th-icon-btn" aria-label={`Remove ${chip.name}`}
            onClick={() => onRemove(chip.localId)}><X aria-hidden="true" /></button>
        </li>;
      })}
    </ul>
    {typeRefused && <p className="th-att-note">{TEAM_HUB_FILE_TYPES_NOTE}</p>}
    <p className="th-att-note">{TEAM_HUB_FILE_DISCLOSURE}</p>
  </div>;
}

function MessageFiles({ files }: { files: TeamHubFile[] }) {
  return <ul className="th-files" aria-label={files.length === 1 ? "1 file" : `${files.length} files`}>
    {files.map((file) => <FileRow key={file.id} file={file} />)}
  </ul>;
}

/**
 * One posted file. Download mints a fresh 60-second URL on every click, served as an attachment under
 * the file's own name, then goes to it; nothing is cached. Download is neutral, never gold.
 */
function FileRow({ file }: { file: TeamHubFile }) {
  const access = useContext(FileAccess);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const errorId = `th-file-error-${file.id}`;
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const url = await access.sign(file.path, file.name);
    setBusy(false);
    if (!url) { setFailed(true); access.announce(TEAM_HUB_DOWNLOAD_FAILED); return; }
    teamHubNavigation.assign(url);
  };
  return <li><div className="th-file" role="group" aria-label={`${file.name}, ${typeLabel(file.mime)}, ${fileSizeLabel(file.size)}`} aria-describedby={FILE_DISCLOSURE_ID}>
    {isImageMime(file.mime) ? <FileThumb file={file} /> : <span className="th-file-glyph" aria-hidden="true"><FileGlyph mime={file.mime} /></span>}
    <span className="th-file-meta">
      <span className="th-file-name" title={file.name}>{file.name}</span>
      <small>{typeLabel(file.mime)} · <span className="th-file-size">{fileSizeLabel(file.size)}</span></small>
    </span>
    {/* aria-disabled while minting, so focus stays on the button. On a narrow row the stylesheet
        hides the visible word and the button is a 40px icon; its name is always "Download <file>". */}
    <button type="button" className="th-btn th-file-dl" aria-label={`Download ${file.name}`} title={`Download ${file.name}`} aria-disabled={busy || undefined}
      aria-describedby={failed ? `${errorId} ${FILE_DISCLOSURE_ID}` : FILE_DISCLOSURE_ID} onClick={() => void download()}><Download aria-hidden="true" /><span className="th-file-dl-label">{busy ? "Getting…" : "Download"}</span></button>
    {failed && <p id={errorId} className="th-error th-file-error">{TEAM_HUB_DOWNLOAD_FAILED}</p>}
  </div></li>;
}

/**
 * An image's small thumbnail, from its own 60-second URL; the type glyph stands in until, or instead.
 * A lazy image scrolled into view after a minute meets an expired URL, so a failed load mints one
 * fresh URL and tries once more before settling on the glyph.
 */
function FileThumb({ file }: { file: TeamHubFile }) {
  const { sign } = useContext(FileAccess);
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  // Which path the answers belong to, and whether this path has had its one fresh URL.
  const current = useRef({ path: file.path, reminted: false });
  const mint = useCallback((path: string) => {
    void sign(path).then((next) => {
      if (current.current.path !== path) return;
      if (next) setUrl(next); else setBroken(true);
    });
  }, [sign]);
  useEffect(() => {
    current.current = { path: file.path, reminted: false };
    setUrl(null);
    setBroken(false);
    mint(file.path);
    return () => { current.current = { path: "", reminted: true }; };
  }, [file.path, mint]);
  const failed = () => {
    if (current.current.reminted) { setBroken(true); return; }
    current.current.reminted = true;
    setUrl(null);
    mint(file.path);
  };
  return <span className="th-file-thumb" aria-hidden="true">
    {url && !broken
      ? <img src={url} alt="" loading="lazy" decoding="async" onError={failed} />
      : <FileGlyph mime={file.mime} />}
  </span>;
}

function SendButton({ ready, disabled, label, onClick }: { ready: boolean; disabled: boolean; label: string; onClick: () => void }) {
  return <button type="button" className="th-send" data-ready={ready ? "true" : undefined} disabled={disabled}
    aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={onClick}><SendHorizontal aria-hidden="true" /></button>;
}

function CenterState({ icon, title, children, action, role, compact = false }: {
  icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode; role?: "alert" | "status"; compact?: boolean;
}) {
  return <div className={compact ? "th-center th-center--compact" : "th-center"} role={role}>
    <span className="th-center-mark">{icon}</span>
    <h2>{title}</h2>
    {children && <p>{children}</p>}
    {action}
  </div>;
}

function StreamSkeleton({ rows }: { rows: number }) {
  return <div className="th-stream th-stream--skeleton" aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => <div key={index} className="th-msg">
      <i className="th-sk th-sk--avatar" /><div className="th-sk-lines"><i className="th-sk" style={{ width: "24%" }} /><i className="th-sk" style={{ width: `${80 - index * 9}%` }} /></div>
    </div>)}
  </div>;
}

function HubSkeleton() {
  return <div className="th-hub" aria-busy="true" role="status" aria-label="Loading Team Hub">
    <div className="th-grid th-grid--loading">
      <section className="th-list" aria-hidden="true"><div className="th-list-body th-sk-list">
        {[60, 82, 48, 70, 40].map((width) => <i key={width} className="th-sk th-sk--row" style={{ width: `${width}%` }} />)}
      </div></section>
      <section className="th-conv" aria-hidden="true"><div className="th-conv-main">
        <div className="th-conv-head"><i className="th-sk" style={{ width: "28%" }} /></div>
        <StreamSkeleton rows={4} />
      </div></section>
    </div>
  </div>;
}
