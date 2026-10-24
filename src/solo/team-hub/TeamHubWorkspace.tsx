import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { ArrowLeft, AtSign, Hash, Lock, MessageSquareReply, Plus, Search, SendHorizontal, UserPlus, Users, WifiOff, X } from "lucide-react";
import { useTenantContext } from "@/hooks/useTenantContext";
import {
  bodyProblem,
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
  TEAM_HUB_UNAVAILABLE_TITLE,
  type PickedMention,
  type TeamHubConversation,
  type TeamHubMessage,
  type TeamHubPerson,
} from "./team-hub-contract";
import { useTeamHub, type PendingMessage, type TeamHub } from "./useTeamHub";
import "./team-hub.css";

/**
 * EXP08 Team Hub, increment 1: channels, direct messages and one-level threads between the
 * active teammates of this workspace. Approved prototype v2, increment-1 subset only — no
 * specialist mentions, no /PAIGE commands, no Team work panel, no attachments. Those are
 * omitted here rather than shown dead (contract §1).
 */
export function TeamHubWorkspace({ onOpenTeamSettings }: { onOpenTeamSettings?: () => void }) {
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
    onOpenTeamSettings={onOpenTeamSettings} />;
}

function ScopedTeamHub({ tenantId, onTenantRefresh, onOpenTeamSettings }: {
  tenantId: string; onTenantRefresh?: () => unknown; onOpenTeamSettings?: () => void;
}) {
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((text: string) => {
    setAnnouncement("");
    window.requestAnimationFrame(() => setAnnouncement(text));
  }, []);
  // New arrivals found by a refresh are announced as a count through the hub's one live region.
  const hub = useTeamHub(tenantId, { onTenantRefresh, onIncoming: announce });

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
  return <ReadyHub hub={hub} announce={announce} announcement={announcement} onOpenTeamSettings={onOpenTeamSettings} />;
}

type Form = { kind: "channel" } | { kind: "dm" } | null;

/** Same thresholds as the stylesheet's `@container th-hub (max-width: 759.98px | 1149.98px)`. */
const ONE_COLUMN_BELOW = 760;
const OVERLAY_BELOW = 1150;
type HubLayout = "unknown" | "one-column" | "overlay" | "wide";

/**
 * The hub's own width decides its layout, never the viewport: the PAIGE panel narrows the hub at
 * any viewport size. The stylesheet does this with container queries; this mirrors the two
 * thresholds the screen needs in script: which pane is on screen (so what may be marked read), and
 * which panes the thread drawer covers (so what is inert). A hub that reports no width has not been
 * laid out, and is treated as wide.
 */
function useHubLayout(ref: RefObject<HTMLElement>): HubLayout {
  const [layout, setLayout] = useState<HubLayout>("unknown");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (width: number) => setLayout(width <= 0 ? "wide" : width < ONE_COLUMN_BELOW ? "one-column" : width < OVERLAY_BELOW ? "overlay" : "wide");
    measure(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => { const entry = entries[entries.length - 1]; if (entry) measure(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return layout;
}

function ReadyHub({ hub, announce, announcement, onOpenTeamSettings }: {
  hub: TeamHub; announce: (text: string) => void; announcement: string; onOpenTeamSettings?: () => void;
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
  const layout = useHubLayout(hubRef);
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

  const send = async () => {
    if (!hub.activeId || !active) return;
    const problem = bodyProblem(draft);
    if (problem === "empty" || !hub.online) return;
    if (problem === "too_long") { const text = refusalMessage("too_long", "send"); setComposerError(text); announce(text); return; }
    const mentions = resolveMentions(draft, pickedHere, people);
    if (!mentions.ok) { setComposerError(mentions.problem); announce(mentions.problem); return; }
    const channelId = hub.activeId;
    setDrafts((current) => ({ ...current, [channelId]: "" }));
    setPicked((current) => ({ ...current, [channelId]: [] }));
    setComposerError(null);
    focusComposer();
    const outcome = await hub.send({ channelId, parentId: null, body: draft, mentionIds: mentions.ids });
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
    if (problem === "empty") return;
    if (problem === "too_long") { const text = refusalMessage("too_long", "send"); setThreadError(text); announce(text); return; }
    const body = threadDraft;
    setThreadDraft("");
    setThreadError(null);
    window.requestAnimationFrame(() => threadComposerRef.current?.focus());
    const outcome = await hub.send({ channelId: thread.channelId, parentId: thread.rootId, body, mentionIds: [] });
    if (outcome.kind === "sent") announce("Reply posted");
    else if (outcome.kind === "failed") announce("Reply not sent. Retry is available.");
    else { setThreadDraft((current) => current || outcome.body); setThreadError(outcome.message); announce(outcome.message); }
  };

  const retry = async (item: PendingMessage) => {
    const outcome = await hub.retry(item.localId);
    // The Retry button is gone or replaced; return to the composer the message came from.
    window.requestAnimationFrame(() => (item.parentId ? threadComposerRef : composerRef).current?.focus());
    announce(outcome.kind === "sent" ? (item.parentId ? "Reply posted" : "Message sent") : outcome.kind === "failed" ? "Still not sent. Your message is kept here." : outcome.message);
    if (outcome.kind === "refused") { if (item.parentId) setThreadError(outcome.message); else setComposerError(outcome.message); }
  };

  const focusThreadWhenReady = useRef(false);
  const openThread = (rootId: string, trigger: HTMLElement) => {
    threadReturn.current = trigger;
    setThreadDraft("");
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
    if (event.key !== "Escape" || event.nativeEvent.defaultPrevented || !hub.thread) return;
    event.preventDefault();
    closeThread();
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
  const conversationCovered = threadOpen && (layout === "overlay" || oneColumn);
  const listCovered = threadOpen && oneColumn;

  return <div ref={hubRef} className="th-hub" onKeyDown={onHubKeyDown}>
   <div className="th-grid" data-view={mobileView} data-thread={thread ? "open" : "closed"}>
    <section className="th-list" aria-label="Conversations" {...(listCovered ? { inert: "" } : {})}>
      <div className="th-list-head">
        <label className="th-search">
          <Search aria-hidden="true" />
          <span className="th-sr">Search your conversations</span>
          <input ref={searchRef} type="search" value={search} placeholder="Search" autoComplete="off"
            onChange={(event) => setSearch(event.target.value)} />
        </label>
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
          onDiscard={(item) => { hub.discard(item.localId); announce("Unsent message deleted"); focusComposer(); }}
          composer={active && hub.stream?.status === "ready" ? <Composer key={active.id} inputRef={composerRef} conversation={active} people={people} meId={meId}
            online={hub.online} value={draft} onChange={(value) => { setDraft(value); setComposerError(null); }}
            picked={pickedHere} onPick={(mention) => hub.activeId && setPicked((current) => ({ ...current, [hub.activeId!]: [...(current[hub.activeId!] ?? []), mention] }))}
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
          <MessageRow message={thread.root} people={people} meId={meId} />
          {/* A separator's own text is not read out, so its words are its accessible name too. */}
          <Separator className="th-day" label={thread.root.reply_count === 1 ? "1 reply" : `${thread.root.reply_count} replies`} />
          {thread.hasMore && <div className="th-older">
            <button type="button" className="th-btn th-btn--ghost" disabled={thread.loadingOlder || !hub.online}
              onClick={() => void hub.loadEarlierReplies()}>{thread.loadingOlder ? "Loading earlier replies…" : "Show earlier replies"}</button>
            {thread.olderFailed && <p className="th-error" role="alert">Earlier replies couldn't load. Try again.</p>}
          </div>}
          {thread.replies.map((reply) => <MessageRow key={reply.id} message={reply} people={people} meId={meId} />)}
          {pendingReplies.map((item) => <PendingRow key={item.localId} item={item} me={me} online={hub.online}
            onRetry={() => void retry(item)} onDiscard={() => { hub.discard(item.localId); announce("Unsent reply deleted"); window.requestAnimationFrame(() => threadComposerRef.current?.focus()); }} />)}
        </>}
      </div>
      {thread.status === "ready" && <div className="th-composer-wrap">
        {/* Announced once, through the live region; shown here and tied to the field. */}
        {threadError && <p id="th-thread-error" className="th-error">{threadError}</p>}
        <div className="th-composer">
          <label htmlFor="th-thread-reply" className="th-sr">Reply in thread</label>
          <textarea id="th-thread-reply" ref={threadComposerRef} rows={1} placeholder="Reply in thread" value={threadDraft}
            aria-describedby={threadError ? "th-thread-error" : undefined}
            onChange={(event) => { setThreadDraft(event.target.value); setThreadError(null); }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void sendReply(); } }} />
          <div className="th-composer-row">
            <span className="th-hint">{hub.online ? "Replies stay in this thread" : "Offline · draft kept"}</span>
            <SendButton ready={Boolean(threadDraft.trim()) && hub.online && bodyProblem(threadDraft) !== "too_long"} disabled={!hub.online}
              label="Send reply" onClick={() => void sendReply()} />
          </div>
        </div>
      </div>}
    </aside>}
   </div>
    <div className="th-sr" aria-live="polite" role="status">{announcement}</div>
  </div>;
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

function Conversation({ hub, people, meId, active, onBack, onOpenThread, announce, pending, onRetry, onDiscard, onMembershipDone, composer }: {
  hub: TeamHub; people: TeamHubPerson[]; meId: string; active: TeamHubConversation | null; onMembershipDone: (leftPrivate: boolean) => void;
  onBack: () => void; onOpenThread: (rootId: string, trigger: HTMLElement) => void; announce: (text: string) => void;
  pending: PendingMessage[]; onRetry: (item: PendingMessage) => void; onDiscard: (item: PendingMessage) => void; composer: ReactNode;
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
      pending={pending} onRetry={onRetry} onDiscard={onDiscard} onOpenThread={onOpenThread} />}
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

function Stream({ hub, people, meId, title, kind, pending, onRetry, onDiscard, onOpenThread }: {
  hub: TeamHub; people: TeamHubPerson[]; meId: string; title: string; kind: "channel" | "dm";
  pending: PendingMessage[]; onRetry: (item: PendingMessage) => void; onDiscard: (item: PendingMessage) => void;
  onOpenThread: (rootId: string, trigger: HTMLElement) => void;
}) {
  const stream = hub.stream!;
  const ref = useRef<HTMLDivElement>(null);
  const me = people.find((person) => person.user_id === meId) ?? null;
  const placed = useRef<string | null>(null);
  const older = useRef<{ height: number; top: number } | null>(null);
  const nearBottom = useRef(true);
  const pendingKey = pending.map((item) => `${item.localId}:${item.status}`).join("|");

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (older.current) {
      // Keep the reader's place when earlier messages load above it.
      element.scrollTop = element.scrollHeight - older.current.height + older.current.top;
      older.current = null;
      return;
    }
    if (placed.current !== stream.channelId) {
      placed.current = stream.channelId;
      const divider = element.querySelector<HTMLElement>("[data-new-divider]");
      element.scrollTop = divider ? Math.max(0, divider.offsetTop - element.offsetTop - 8) : element.scrollHeight;
      return;
    }
    if (nearBottom.current) element.scrollTop = element.scrollHeight;
    // Keyed on each pending row's status too: a send that fails grows its row (Retry, Delete), and
    // that recovery must stay in view.
  }, [stream.channelId, stream.messages, pendingKey]);

  const loadOlder = () => {
    const element = ref.current;
    if (element) older.current = { height: element.scrollHeight, top: element.scrollTop };
    void hub.loadOlder();
  };

  let lastDay = "";
  // A labelled region, not a live log: arrivals are announced once, as a count, by the hub's live region.
  return <div ref={ref} className="th-stream" role="region" aria-label="Messages" tabIndex={-1}
    onScroll={(event) => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
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
        <MessageRow message={message} people={people} meId={meId} onOpenThread={onOpenThread} />
      </div>;
    })}
    {pending.map((item) => <PendingRow key={item.localId} item={item} me={me} online={hub.online}
      onRetry={() => onRetry(item)} onDiscard={() => onDiscard(item)} />)}
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

function MessageRow({ message, people, meId, onOpenThread }: {
  message: TeamHubMessage; people: TeamHubPerson[]; meId: string; onOpenThread?: (rootId: string, trigger: HTMLElement) => void;
}) {
  const author = people.find((person) => person.user_id === message.author_user_id) ?? null;
  const name = author?.display_name ?? "Former teammate";
  return <article className="th-msg" aria-label={`${name} at ${timeLabel(message.created_at)}`}>
    <span className="th-avatar th-avatar--lg" aria-hidden="true">{initials(name)}</span>
    <div className="th-msg-body">
      <Author person={author} people={people} meId={meId} at={message.created_at} />
      <p className="th-text">{mentionRuns(message.body, message.mentions, people).map((run, index) =>
        run.mention ? <span key={index} className="th-mention">{run.text}</span> : <span key={index}>{run.text}</span>)}</p>
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
  return <article className="th-msg th-msg--pending" aria-label={item.status === "failed" ? "Your message, not sent" : "Your message, sending"}>
    <span className="th-avatar th-avatar--lg" aria-hidden="true">{initials(name)}</span>
    <div className="th-msg-body">
      <div className="th-who"><b>{name} (you)</b>{item.status === "sending" && <span className="th-role">Sending…</span>}</div>
      <p className="th-text">{item.body}</p>
      {/* Announced once by the live region when the send fails; shown here with its recovery. */}
      {item.status === "failed" && <div className="th-fail">Not sent. Your message is kept here.
        <button type="button" disabled={!online} onClick={onRetry}>Retry</button>
        <button type="button" onClick={onDiscard}>Delete</button></div>}
    </div>
  </article>;
}

type ComposerProps = {
  conversation: TeamHubConversation; people: TeamHubPerson[]; meId: string; online: boolean;
  value: string; onChange: (value: string) => void; picked: PickedMention[]; onPick: (mention: PickedMention) => void;
  error: string | null; onSend: () => void; inputRef: MutableRefObject<HTMLTextAreaElement | null>;
};

function Composer({ conversation, people, meId, online, value, onChange, picked, onPick, error, onSend, inputRef }: ComposerProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [index, setIndex] = useState(0);
  const caret = useRef<number | null>(null);
  const scope = mentionScope(conversation);
  // Offered only when someone besides the author can see this conversation.
  const mentionsOffered = mentionCandidates(scope, people, meId, "").length > 0;
  const options = useMemo(() => mention ? mentionCandidates(scope, people, meId, mention.query) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope derives from the conversation
    [mention, people, meId, conversation]);
  const listOpen = Boolean(mention && options.length);
  const label = conversation.kind === "dm" ? `Message ${conversationLabel(conversation, people)}` : `Message #${conversation.name}`;
  const problem = bodyProblem(value);
  const ready = online && problem === null;
  const listId = `th-mentions-${conversation.id}`;

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
    if (!mentionsOffered) { setMention(null); return; }
    const before = text.slice(0, position);
    const at = before.lastIndexOf("@");
    if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) { setMention(null); return; }
    const query = before.slice(at + 1);
    if (/\n/.test(query) || query.length > 60) { setMention(null); return; }
    const matches = mentionCandidates(scope, people, meId, query);
    if (!matches.length && /\s/.test(query)) { setMention(null); return; }
    setMention({ start: at, query });
    setIndex(0);
  };

  const pick = (person: TeamHubPerson) => {
    if (!mention) return;
    const text = mentionLabel(person, people);
    const end = mention.start + 1 + mention.query.length;
    const next = `${value.slice(0, mention.start)}@${text} ${value.slice(end)}`;
    caret.current = mention.start + text.length + 2;
    onPick({ user_id: person.user_id, label: text });
    onChange(next);
    setMention(null);
    localRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (listOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      return;
    }
    if (listOpen && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      pick(options[index]);
      return;
    }
    if (event.key === "Escape" && mention) {
      event.preventDefault();
      setMention(null);
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
    setMention({ start: position + spacer.length, query: "" });
    setIndex(0);
    element?.focus();
  };

  return <div className="th-composer-wrap">
    {listOpen && <div className="th-pop" id={listId} role="listbox" aria-label="People in this conversation">
      {options.map((person, optionIndex) => <div key={person.user_id} id={`${listId}-${person.user_id}`} role="option"
        aria-selected={optionIndex === index} className="th-option"
        onMouseDown={(event) => event.preventDefault()} onClick={() => pick(person)} onMouseEnter={() => setIndex(optionIndex)}>
        <span className="th-avatar" aria-hidden="true">{initials(person.display_name)}</span>
        <span className="th-option-meta"><span>{mentionLabel(person, people)}</span>
          <small>{[permissionLabel(person.permission) ?? "Member", person.title].filter(Boolean).join(" · ")}</small></span>
      </div>)}
    </div>}
    {mention && !options.length && <p className="th-pop th-pop--note" role="status">No active teammate in this conversation matches.</p>}
    {/* Refusals are announced once, by the hub's live region; here they are shown and tied to the field. */}
    {error && <p id={`${listId}-error`} className="th-error">{error}</p>}
    {problem === "too_long" && !error && <p id={`${listId}-length`} className="th-error">{value.trim().length.toLocaleString()} of {MESSAGE_MAX_LENGTH.toLocaleString()} characters.</p>}
    <div className="th-composer">
      <label htmlFor={`th-composer-${conversation.id}`} className="th-sr">{label}</label>
      <textarea id={`th-composer-${conversation.id}`} ref={setRefs} rows={1} value={value} placeholder={label}
        role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={listOpen ? `${listId}-${options[index]?.user_id}` : undefined}
        aria-describedby={error ? `${listId}-error` : problem === "too_long" ? `${listId}-length` : undefined}
        onChange={(event) => { onChange(event.target.value); detect(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
        onKeyDown={onKeyDown}
        onBlur={() => setMention(null)} />
      <div className="th-composer-row">
        {mentionsOffered && <button type="button" className="th-icon-btn" aria-label="Mention someone" disabled={!online}
          onMouseDown={(event) => event.preventDefault()} onClick={insertAt}><AtSign aria-hidden="true" /></button>}
        <span className="th-hint">{online ? (mentionsOffered ? "@ to mention · Shift+Enter for a new line" : "Shift+Enter for a new line") : "Offline · draft kept"}</span>
        <SendButton ready={ready} disabled={!online} label="Send" onClick={onSend} />
      </div>
    </div>
    {picked.length > 0 && <span className="th-sr">Mentioning {picked.map((item) => item.label).join(", ")}</span>}
  </div>;
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
