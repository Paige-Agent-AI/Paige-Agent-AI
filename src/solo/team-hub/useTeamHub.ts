import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  beginRefusalReason,
  compareMessages,
  filePrecheck,
  fileRefusalMessage,
  fileTypeFor,
  incomingAnnouncement,
  mergeMessages,
  newDividerBefore,
  parseAcknowledged,
  parseAdded,
  parseBegunFile,
  parseChannelId,
  parseConversationList,
  parseFinished,
  parseMessagePage,
  parsePosted,
  parseTaskReads,
  parseTaskRequested,
  parseThreadPage,
  parseWorkList,
  refreshLeavesGap,
  refusalMessage,
  TASK_COMMAND_TEXT,
  type TeamHubChannelSummary,
  type TeamHubFileMime,
  type TeamHubFileRefusal,
  type TeamHubMessage,
  type TeamHubMessagePage,
  type TeamHubOverview,
  type TeamHubRefusal,
  type TeamHubResult,
  type TeamHubTaskRead,
  type TeamHubWorkItem,
} from "./team-hub-contract";

/**
 * EXP08 Team Hub data hook. Every call goes through `supabase.rpc` with the
 * contract's exact function name and ALWAYS carries `p_expected_tenant`, so a
 * workspace switch mid-request is refused by the server (`scope_changed`) instead
 * of answering for the wrong business. The caller remounts this hook per
 * workspace, which is what clears all state on a switch.
 *
 * Increment 1 has no realtime push: the hook refreshes on window focus, when the
 * browser comes back online, and every 15 seconds while the tab is visible.
 *
 * Unread integrity: a conversation is marked read only while its stream is on screen. The
 * workspace reports that through `setStreamVisible` (wide layout, or the phone conversation
 * view with no thread over it); the phone list view and any background refresh of an off-screen
 * conversation never mark anything read. Each mark names the newest top-level message actually
 * held for display (A8), so the server never marks read a message the client hadn't shown.
 *
 * A refresh reads the newest page only. If that page has more behind it and is entirely newer
 * than what is held, the held list is replaced and "Load earlier messages" offered, so a long
 * absence never leaves a silent hole in the stream.
 *
 * Increment 2 (docs/delivery/exp08-team-hub-increment2-work-contract.md): `requestTask` is the one
 * new write, through `team_hub_request_task`, with the same pending and Retry semantics as a post
 * (one client request id per attempt, reused by Retry, so Operations never gets a second task).
 * Status is never stored here: `readTaskStatuses` reads the original `plan_items` rows by id through
 * the caller's own RLS, and an id the read doesn't return is `unreadable` — never guessed.
 *
 * Increment 3 (docs/delivery/exp08-team-hub-increment3-attachments-contract.md §7): each attached
 * file is a chip held per composer (`attachmentScope`). It is checked here first with the server's
 * own rules, then `team_hub_begin_file` → an upload to the server-built path → the `team-hub-file`
 * finish step, which checks the real type. Only a chip in the ready state is ever posted, by id, in
 * `p_file_ids`. A chip keeps one client request id for every Retry, so a retry never makes a second
 * record; removing a chip discards its record (best-effort). Downloads mint a fresh 60-second URL on
 * every click and are never cached here.
 */

export const REFRESH_INTERVAL_MS = 15_000;
const PAGE_SIZE = 50;
const THREAD_PAGE_SIZE = 50;

/** `account_unavailable` is the server's `unavailable` (A1): not a canonical SOLO workspace. */
export type HubStatus = "loading" | "ready" | "unavailable" | "account_unavailable" | "not_member" | "scope_changed";

export interface StreamState {
  channelId: string;
  status: "loading" | "ready" | "not_found" | "unavailable";
  channel: TeamHubChannelSummary | null;
  messages: TeamHubMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  /** The message the "new" divider sits above, fixed when the conversation was opened. */
  dividerBefore: string | null;
  /**
   * The newest message a listed page returned. A refresh is joined to this, not to the newest
   * held message: a message just sent is appended locally and says nothing about what was read
   * between the last page and it.
   */
  listedNewest?: TeamHubMessage | null;
}

export interface ThreadState {
  channelId: string;
  rootId: string;
  status: "loading" | "ready" | "not_found" | "unavailable";
  root: TeamHubMessage | null;
  /** Oldest → newest for display; the server returns them newest-first (A7). */
  replies: TeamHubMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  /** As on StreamState: the newest reply a listed page returned, never a locally appended one. */
  listedNewest?: TeamHubMessage | null;
}

/** What a task request asks Operations for; kept with the attempt so Retry sends the same thing. */
export interface TaskDraft {
  title: string;
  assigneeId: string;
  /** An instant (end of the chosen day), or null for no due date. */
  dueAt: string | null;
}

export interface PendingMessage {
  /** Increment 2: a task request is pending exactly like a message, and recovers the same way. */
  kind: "message" | "task";
  task?: TaskDraft;
  localId: string;
  /** Generated once per message attempt and reused by Retry, so the server never stores it twice. */
  clientRequestId: string;
  channelId: string;
  parentId: string | null;
  body: string;
  mentionIds: string[];
  /** Increment 3: the ready files this message posts, by record id, in the order they were attached. */
  files: AttachmentChip[];
  status: "sending" | "failed";
}

export const TEAM_HUB_FILE_BUCKET = "comms-attachments";
export const SIGNED_URL_SECONDS = 60;

/** The browser leaves for a signed download URL through here, so a test can see where it went. */
export const teamHubNavigation = { assign: (url: string) => window.location.assign(url) };

/** One composer's files: the conversation, or one thread inside it. */
export function attachmentScope(channelId: string, parentId: string | null): string {
  return parentId ? `${channelId}:${parentId}` : channelId;
}

export interface AttachmentChip {
  localId: string;
  /** Generated once per chip; every Retry reuses it, so the server keeps one record. */
  clientRequestId: string;
  channelId: string;
  name: string;
  size: number;
  mime: TeamHubFileMime | null;
  state: "uploading" | "checking" | "ready" | "refused" | "failed";
  reason: TeamHubFileRefusal | null;
  /** The server's record, once `team_hub_begin_file` made it. */
  fileId: string | null;
  path: string | null;
  /** Kept for Retry; never sent anywhere but the record's own path. */
  file: File | null;
}

export type SendOutcome =
  | { kind: "sent"; duplicate: boolean; messageId: string }
  | { kind: "refused"; message: string; body: string; task?: TaskDraft }
  | { kind: "failed" };

export interface WorkState {
  status: "idle" | "loading" | "ready" | "unavailable";
  items: TeamHubWorkItem[];
}

export type ActionOutcome<T = true> = { ok: true; value: T; message?: undefined } | { ok: false; message: string; value?: undefined };

type RpcAnswer = { data: unknown; error: unknown };

/** What a load did, for the refresh that asked: new arrivals by others, and the newest id now held. */
interface LoadReport<T> {
  result: TeamHubResult<T>;
  incoming: number;
  gap: boolean;
  newestId: string | null;
}

/** Storage's answer when the object is already there (409 / "already exists"). */
function alreadyStored(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const failure = error as { statusCode?: unknown; status?: unknown; message?: unknown; error?: unknown };
  return String(failure.statusCode ?? failure.status ?? "") === "409" || /already exists|duplicate/i.test(`${failure.message ?? ""} ${failure.error ?? ""}`);
}

function newRequestId(): string {
  return crypto.randomUUID();
}

/** The compound cursor (A6): both halves of the oldest row shown, or neither. */
function cursorBefore(oldest: TeamHubMessage | undefined): { p_before: string | null; p_before_id: string | null } {
  return oldest ? { p_before: oldest.created_at, p_before_id: oldest.id } : { p_before: null, p_before_id: null };
}

/** The message words for an action that did not complete, from what actually came back. */
function failureCode(result: TeamHubResult<unknown>): TeamHubRefusal | "no_answer" {
  return result.kind === "refused" ? result.code : "no_answer";
}

const ENDS_HUB = new Set<TeamHubRefusal>(["not_member", "unavailable", "scope_changed"]);

const newestOf = (messages: TeamHubMessage[]) => messages.length ? [...messages].sort(compareMessages)[messages.length - 1] : undefined;

export function useTeamHub(tenantId: string, options: { onTenantRefresh?: () => unknown; onIncoming?: (announcement: string) => void; onAttachment?: (announcement: string) => void } = {}) {
  const [status, setStatus] = useState<HubStatus>("loading");
  const [overview, setOverview] = useState<TeamHubOverview | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [work, setWork] = useState<WorkState>({ status: "idle", items: [] });
  const [taskReads, setTaskReads] = useState<Record<string, TeamHubTaskRead>>({});
  const [attachments, setAttachments] = useState<Record<string, AttachmentChip[]>>({});

  // Latest values for async continuations; a response for a conversation that is no
  // longer open is dropped instead of painted over the one that is.
  const live = useRef({ activeId, stream, thread, overview, status, work, taskReads, attachments });
  live.current = { activeId, stream, thread, overview, status, work, taskReads, attachments };
  const alive = useRef(true);
  // Set on every setup, not only at creation: React StrictMode runs setup, cleanup, setup in
  // development, and a ref left false after that first cleanup would drop every response.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const tenantRefresh = useRef(options.onTenantRefresh);
  tenantRefresh.current = options.onTenantRefresh;
  const onIncoming = useRef(options.onIncoming);
  onIncoming.current = options.onIncoming;
  const onAttachment = useRef(options.onAttachment);
  onAttachment.current = options.onAttachment;
  const scopeRetried = useRef(false);
  const unavailableRetried = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const streamVisible = useRef(false);

  const call = useCallback(async (name: string, params: Record<string, unknown>): Promise<RpcAnswer> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- migration RPCs await generated types
      const { data, error } = await (supabase as any).rpc(name, { p_expected_tenant: tenantId, ...params });
      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }, [tenantId]);

  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshAfterAction = useRef<() => Promise<void>>(async () => undefined);

  /** Refusals that end the whole hub are handled here, for every call alike. */
  const settle = useCallback(<T,>(result: TeamHubResult<T>): TeamHubResult<T> => {
    if (!alive.current || result.kind !== "refused") return result;
    const clear = () => { setOverview(null); setStream(null); setThread(null); setPending([]); setWork({ status: "idle", items: [] }); setTaskReads({}); setAttachments({}); };
    if (result.code === "unavailable" && !unavailableRetried.current) {
      // The account type may have been read from a stale workspace context. Re-read it once and ask
      // again before settling on "not available for this account type".
      unavailableRetried.current = true;
      setStatus("loading");
      clear();
      void Promise.resolve(tenantRefresh.current?.()).finally(() => { if (alive.current) void refreshAfterAction.current(); });
    } else if (result.code === "not_member" || result.code === "unavailable") {
      setStatus(result.code === "not_member" ? "not_member" : "account_unavailable");
      clear();
    } else if (result.code === "scope_changed") {
      setStatus("scope_changed");
      clear();
      if (!scopeRetried.current) {
        // Re-read which workspace is active, then ask again once for that workspace.
        scopeRetried.current = true;
        void Promise.resolve(tenantRefresh.current?.()).finally(() => { if (alive.current) void refreshAfterAction.current(); });
      }
    }
    return result;
  }, []);

  const loadStream = useCallback(async (channelId: string, mode: "open" | "refresh" | "older", unreadAtOpen = 0): Promise<LoadReport<TeamHubMessagePage>> => {
    const cursor = cursorBefore(mode === "older" ? live.current.stream?.messages[0] : undefined);
    if (mode === "open") {
      setStream({ channelId, status: "loading", channel: null, messages: [], hasMore: false, loadingOlder: false, olderFailed: false, dividerBefore: null });
    } else if (mode === "older") {
      setStream((current) => current && current.channelId === channelId ? { ...current, loadingOlder: true, olderFailed: false } : current);
    }
    const answer = await call("team_hub_list_messages", { p_channel_id: channelId, p_thread_root: null, ...cursor, p_limit: PAGE_SIZE });
    const result = settle(parseMessagePage(answer.data, answer.error, channelId));
    const report: LoadReport<TeamHubMessagePage> = { result, incoming: 0, gap: false, newestId: null };
    if (!alive.current || live.current.activeId !== channelId) return report;
    if (result.kind === "refused" && ENDS_HUB.has(result.code)) return report;
    const meId = live.current.overview?.me.user_id ?? "";
    const top = result.kind === "ok" ? result.value.messages.filter((message) => !message.parent_message_id) : [];
    if (result.kind === "ok") {
      const held = mode === "open" || live.current.stream?.channelId !== channelId ? [] : live.current.stream.messages;
      const heldIds = new Set(held.map((message) => message.id));
      const anchor = mode === "open" ? null : live.current.stream?.listedNewest ?? null;
      report.gap = mode === "refresh" && refreshLeavesGap(anchor ? [anchor] : [], top, result.value.has_more);
      report.incoming = mode === "refresh" ? top.filter((message) => !heldIds.has(message.id) && message.author_user_id !== meId).length : 0;
      report.newestId = newestOf(report.gap ? top : [...held, ...top])?.id ?? null;
    }
    setStream((current) => {
      const base = current && current.channelId === channelId ? current : null;
      if (result.kind === "ok") {
        const page = result.value;
        const held = mode === "open" ? [] : base?.messages ?? [];
        // A refresh that can't be joined to what is held replaces it (keeping anything newer than
        // the page, such as a message just sent) and offers the earlier messages instead.
        const anchor = mode === "open" ? null : base?.listedNewest ?? null;
        const gap = mode === "refresh" && refreshLeavesGap(anchor ? [anchor] : [], top, page.has_more);
        const pageNewest = newestOf(top);
        const kept = gap && pageNewest ? held.filter((message) => compareMessages(message, pageNewest) > 0) : held;
        const messages = mergeMessages(kept, top);
        const listedNewest = mode === "older" ? anchor : gap ? pageNewest ?? null : newestOf([...(anchor ? [anchor] : []), ...top]) ?? null;
        return {
          channelId,
          status: "ready",
          channel: page.channel,
          messages,
          // A refresh that joins the held list decides nothing about what lies above it; an older
          // page, an open, or a refresh that left a gap does.
          hasMore: gap ? true : mode === "refresh" ? base?.hasMore ?? page.has_more : page.has_more,
          loadingOlder: false,
          olderFailed: false,
          dividerBefore: mode === "open" ? newDividerBefore(messages, unreadAtOpen, meId) : base?.dividerBefore ?? null,
          listedNewest,
        };
      }
      if (result.kind === "refused" && result.code === "not_found") {
        return { channelId, status: "not_found", channel: null, messages: [], hasMore: false, loadingOlder: false, olderFailed: false, dividerBefore: null };
      }
      if (mode === "older" && base) return { ...base, loadingOlder: false, olderFailed: true };
      // A failed background refresh keeps what is already on screen.
      if (mode === "refresh" && base?.status === "ready") return base;
      return { channelId, status: "unavailable", channel: null, messages: [], hasMore: false, loadingOlder: false, olderFailed: false, dividerBefore: null };
    });
    return report;
  }, [call, settle]);

  /** Marks read through the newest top-level message held for display, never further (A8). */
  const markRead = useCallback(async (channelId: string, throughMessageId: string) => {
    const answer = await call("team_hub_mark_read", { p_channel_id: channelId, p_through_message_id: throughMessageId });
    const result = settle(parseAcknowledged(answer.data, answer.error));
    if (result.kind === "ok" && alive.current) {
      setOverview((current) => current && {
        ...current,
        conversations: current.conversations.map((conversation) => conversation.id === channelId ? { ...conversation, unread: 0 } : conversation),
      });
    }
    return result;
  }, [call, settle]);

  const loadThread = useCallback(async (channelId: string, rootId: string, mode: "open" | "refresh" | "older"): Promise<number> => {
    if (mode === "open") setThread({ channelId, rootId, status: "loading", root: null, replies: [], hasMore: false, loadingOlder: false, olderFailed: false });
    if (mode === "older") setThread((current) => current && current.rootId === rootId ? { ...current, loadingOlder: true, olderFailed: false } : current);
    const cursor = cursorBefore(mode === "older" ? live.current.thread?.replies[0] : undefined);
    const answer = await call("team_hub_list_messages", { p_channel_id: channelId, p_thread_root: rootId, ...cursor, p_limit: THREAD_PAGE_SIZE });
    const result = settle(parseThreadPage(answer.data, answer.error, channelId, rootId));
    if (!alive.current || live.current.thread?.rootId !== rootId) return 0;
    if (result.kind === "refused" && ENDS_HUB.has(result.code)) return 0;
    const meId = live.current.overview?.me.user_id ?? "";
    const heldIds = new Set((live.current.thread?.replies ?? []).map((reply) => reply.id));
    const incoming = mode === "refresh" && result.kind === "ok"
      ? result.value.replies.filter((reply) => !heldIds.has(reply.id) && reply.author_user_id !== meId).length : 0;
    setThread((current) => {
      if (!current || current.rootId !== rootId) return current;
      if (result.kind === "ok") {
        const page = result.value;
        const held = mode === "open" ? [] : current.replies;
        // Same rule as the stream: a newest page that can't be joined to the held replies replaces them.
        const anchor = mode === "open" ? null : current.listedNewest ?? null;
        const gap = mode === "refresh" && refreshLeavesGap(anchor ? [anchor] : [], page.replies, page.has_more);
        const pageNewest = newestOf(page.replies);
        const kept = gap && pageNewest ? held.filter((reply) => compareMessages(reply, pageNewest) > 0) : held;
        // Newest-first from the server; mergeMessages keeps them oldest → newest for reading.
        const replies = mergeMessages(kept, page.replies);
        const listedNewest = mode === "older" ? anchor : gap ? pageNewest ?? null : newestOf([...(anchor ? [anchor] : []), ...page.replies]) ?? null;
        return {
          channelId, rootId, status: "ready", root: page.root, replies, listedNewest,
          // A refresh that joins the held replies decides nothing about what lies above them.
          hasMore: gap ? true : mode === "refresh" ? current.hasMore : page.has_more,
          loadingOlder: false, olderFailed: false,
        };
      }
      if (result.kind === "refused" && result.code === "not_found") return { ...current, status: "not_found" };
      if (mode === "older") return { ...current, loadingOlder: false, olderFailed: true };
      return mode === "refresh" && current.status === "ready" ? current : { ...current, status: "unavailable" };
    });
    return incoming;
  }, [call, settle]);

  /**
   * Read each task's original Operations record by id, through the caller's own RLS (as Operations'
   * `createOperationsWork` reads back). A held answer stays on screen while it is read again; an id
   * the read doesn't return is `unreadable`, and a failed read says so instead of keeping a guess.
   */
  const readTaskStatuses = useCallback(async (ids: string[]) => {
    const wanted = [...new Set(ids.filter((id) => typeof id === "string" && id))];
    if (!wanted.length) return;
    setTaskReads((current) => {
      const next = { ...current };
      for (const id of wanted) if (!next[id]) next[id] = { state: "loading" };
      return next;
    });
    for (let start = 0; start < wanted.length; start += 100) {
      const chunk = wanted.slice(start, start + 100);
      let answer: RpcAnswer;
      try {
        const { data, error } = await supabase.from("plan_items")
          .select("id,title,status,assigned_to_user_id,due_at,updated_at")
          .eq("tenant_id", tenantId)
          .in("id", chunk);
        answer = { data, error };
      } catch (error) {
        answer = { data: null, error };
      }
      if (!alive.current) return;
      const reads = parseTaskReads(answer.data, answer.error, chunk, new Date().toISOString());
      setTaskReads((current) => ({ ...current, ...reads }));
    }
  }, [tenantId]);

  /** The links behind the Team work panel; their statuses are read from Operations right after. */
  const listWork = useCallback(async (mode: "open" | "refresh" = "open") => {
    if (mode === "open") setWork((current) => ({ status: current.status === "ready" ? "ready" : "loading", items: current.items }));
    const answer = await call("team_hub_list_work", { p_limit: 50 });
    const result = settle(parseWorkList(answer.data, answer.error));
    if (!alive.current) return;
    if (result.kind === "ok") {
      setWork({ status: "ready", items: result.value });
      void readTaskStatuses(result.value.map((item) => item.work_id));
    } else if (!(result.kind === "refused" && ENDS_HUB.has(result.code))) {
      // A failed background re-list keeps the last good list; a first load says it couldn't.
      setWork((current) => mode === "refresh" && current.status === "ready" ? current : { status: "unavailable", items: [] });
    }
  }, [call, settle, readTaskStatuses]);

  const closeWork = useCallback(() => setWork({ status: "idle", items: [] }), []);

  const runRefresh = useCallback(async () => {
    const answer = await call("team_hub_list_conversations", {});
    const result = settle(parseConversationList(answer.data, answer.error, tenantId));
    if (!alive.current) return;
    if (result.kind === "ok") {
      scopeRetried.current = false;
      setOverview(result.value);
      setStatus("ready");
      setRefreshFailed(false);
      const { activeId: current, stream: openStream, thread: openThread } = live.current;
      const listed = current ? result.value.conversations.find((conversation) => conversation.id === current) : null;
      const tabVisible = document.visibilityState === "visible";
      let newMessages = 0;
      let orMore = false;
      if (current && openStream?.channelId === current && openStream.status === "ready") {
        const load = await loadStream(current, "refresh");
        // Someone else wrote while this conversation was ON SCREEN in a visible tab. A conversation
        // left open behind the phone list view (or under a phone thread) is refreshed but stays unread.
        const onScreen = streamVisible.current && tabVisible;
        if (listed?.joined && listed.unread > 0 && onScreen && load.newestId) void markRead(current, load.newestId);
        if (onScreen) { newMessages = load.incoming; orMore = load.gap; }
      }
      const newReplies = openThread && openThread.status === "ready" ? await loadThread(openThread.channelId, openThread.rootId, "refresh") : 0;
      // Statuses are read again from Operations on every refresh, so a card never goes stale silently.
      if (live.current.work.status !== "idle") await listWork("refresh");
      const shown = [...(live.current.stream?.messages ?? []), ...(live.current.thread?.replies ?? [])]
        .map((message) => message.work_ref?.id).filter((id): id is string => Boolean(id));
      void readTaskStatuses(shown);
      // The hub's one live region says how many arrived; the stream itself is not a live region.
      const text = incomingAnnouncement(newMessages, tabVisible ? newReplies : 0, orMore);
      if (text && alive.current) onIncoming.current?.(text);
    } else if (result.kind === "unavailable" || (result.kind === "refused" && !ENDS_HUB.has(result.code))) {
      // Keep the last good list on screen and say it could not be refreshed.
      if (live.current.overview) setRefreshFailed(true);
      else setStatus("unavailable");
    }
  }, [call, settle, tenantId, loadStream, loadThread, markRead, listWork, readTaskStatuses]);

  /**
   * A background refresh (focus, reconnect, interval) is skipped while one is running.
   * A refresh after an action waits for it and then reads again, so what the action
   * changed is always in the list it returns to.
   */
  const refresh = useCallback(async (mode: "background" | "after_action" = "after_action") => {
    if (inFlight.current) {
      if (mode === "background") return;
      await inFlight.current.catch(() => undefined);
    }
    const run = runRefresh();
    inFlight.current = run;
    try { await run; } finally { if (inFlight.current === run) inFlight.current = null; }
  }, [runRefresh]);
  refreshRef.current = () => refresh("background");
  refreshAfterAction.current = () => refresh("after_action");

  useEffect(() => { void refresh("background"); }, [refresh]);

  // Focus, reconnect and a visible-tab interval. Nothing here claims live delivery.
  useEffect(() => {
    const onFocus = () => { void refreshRef.current(); };
    const onOnline = () => { setOnline(true); void refreshRef.current(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshRef.current();
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(timer);
    };
  }, []);

  const openConversation = useCallback(async (channelId: string) => {
    const conversation = live.current.overview?.conversations.find((item) => item.id === channelId);
    setActiveId(channelId);
    live.current.activeId = channelId;
    setThread(null);
    const { result, newestId } = await loadStream(channelId, "open", conversation?.unread ?? 0);
    if (result.kind === "ok" && result.value.channel.joined && newestId && alive.current && live.current.activeId === channelId && streamVisible.current) {
      void markRead(channelId, newestId);
    }
  }, [loadStream, markRead]);

  /**
   * The workspace says whether the open conversation's stream is actually on screen. When it
   * comes into view (the phone list → conversation step, or a narrow hub widening), an unread,
   * joined conversation is marked read then — never before.
   */
  const setStreamVisible = useCallback((visible: boolean) => {
    const was = streamVisible.current;
    streamVisible.current = visible;
    if (!visible || was) return;
    const { activeId: current, stream: openStream, overview: listedNow } = live.current;
    const listed = current ? listedNow?.conversations.find((conversation) => conversation.id === current) : null;
    const newest = openStream?.messages[openStream.messages.length - 1];
    if (current && newest && openStream?.channelId === current && openStream.status === "ready" && openStream.channel?.joined && (listed?.unread ?? 0) > 0) {
      void markRead(current, newest.id);
    }
  }, [markRead]);

  const clearConversation = useCallback(() => {
    setActiveId(null);
    live.current.activeId = null;
    setStream(null);
    setThread(null);
  }, []);

  const loadOlder = useCallback(async () => {
    const current = live.current.stream;
    if (!current || current.status !== "ready" || !current.hasMore || current.loadingOlder) return;
    await loadStream(current.channelId, "older");
  }, [loadStream]);

  const openThread = useCallback((rootId: string) => {
    const channelId = live.current.activeId;
    if (!channelId) return;
    live.current.thread = { channelId, rootId, status: "loading", root: null, replies: [], hasMore: false, loadingOlder: false, olderFailed: false };
    void loadThread(channelId, rootId, "open");
  }, [loadThread]);

  const loadEarlierReplies = useCallback(async () => {
    const current = live.current.thread;
    if (!current || current.status !== "ready" || !current.hasMore || current.loadingOlder) return;
    await loadThread(current.channelId, current.rootId, "older");
  }, [loadThread]);

  const closeThread = useCallback(() => { setThread(null); live.current.thread = null; }, []);

  // ── Attachments (increment 3) ──
  const removedChips = useRef(new Set<string>());

  /** The `team-hub-file` edge function, always for this workspace; its own JWT check comes first there. */
  const invokeFile = useCallback(async (action: "finish" | "discard", fileId: string): Promise<RpcAnswer> => {
    try {
      const { data, error } = await supabase.functions.invoke("team-hub-file", { body: { action, expected_tenant: tenantId, file_id: fileId } });
      return { data, error };
    } catch (error) {
      return { data: null, error };
    }
  }, [tenantId]);

  /**
   * Best-effort: an unposted record is discarded and its bytes removed. A posted file is refused there.
   * Asked once per record, whether Remove or an upload still in flight gets there first.
   */
  const discarded = useRef(new Set<string>());
  const discardFile = useCallback((fileId: string) => {
    if (discarded.current.has(fileId)) return;
    discarded.current.add(fileId);
    void invokeFile("discard", fileId);
  }, [invokeFile]);

  const setScopeChips = useCallback((scope: string, update: (chips: AttachmentChip[]) => AttachmentChip[]) => {
    const apply = (current: Record<string, AttachmentChip[]>) => {
      const next = update(current[scope] ?? []);
      const copy = { ...current };
      if (next.length) copy[scope] = next; else delete copy[scope];
      return copy;
    };
    // Kept current for a second pick made before React renders, so the 5-per-message count holds.
    live.current.attachments = apply(live.current.attachments);
    setAttachments(apply);
  }, []);

  /** begin → upload to the server-built path → finish. Every step re-checks that the chip still exists. */
  const runChip = useCallback(async (scope: string, chip: AttachmentChip) => {
    const removed = () => removedChips.current.has(chip.localId);
    const patch = (next: Partial<AttachmentChip>) => setScopeChips(scope, (chips) => chips.map((item) => item.localId === chip.localId ? { ...item, ...next } : item));
    const refuse = (reason: TeamHubFileRefusal) => {
      patch({ state: "refused", reason, file: null });
      onAttachment.current?.(`File refused: ${fileRefusalMessage(reason)}`);
    };
    const fail = () => {
      patch({ state: "failed" });
      onAttachment.current?.("Upload didn't finish. Retry is available.");
    };
    const mime = chip.mime;
    if (!mime || !chip.file) { refuse("type"); return; }
    patch({ state: "uploading", reason: null });
    const begun = await call("team_hub_begin_file", {
      p_channel_id: chip.channelId,
      p_name: chip.name,
      p_mime: mime,
      p_size: chip.size,
      p_client_request_id: chip.clientRequestId,
    });
    const record = settle(parseBegunFile(begun.data, begun.error, tenantId, { name: chip.name, mime, size: chip.size }));
    if (!alive.current) return;
    if (record.kind === "refused") { if (!ENDS_HUB.has(record.code)) refuse(beginRefusalReason(record.code)); return; }
    if (record.kind === "unavailable") { fail(); return; }
    const { id, path, state } = record.value;
    if (removed()) { discardFile(id); return; }
    patch({ fileId: id, path });
    // A retry can find the record already decided.
    if (state === "ready") { patch({ state: "ready", file: null }); onAttachment.current?.("File ready"); return; }
    if (state === "rejected") { refuse("rejected"); return; }
    if (state === "discarded") { refuse("gone"); return; }
    let uploaded = false;
    try {
      const { error } = await supabase.storage.from(TEAM_HUB_FILE_BUCKET).upload(path, chip.file, { contentType: mime, upsert: false });
      // A retry after a lost answer finds its own bytes already there (no overwrite is allowed): go on to the check.
      uploaded = !error || alreadyStored(error);
    } catch {
      uploaded = false;
    }
    if (!alive.current) return;
    if (removed()) { discardFile(id); return; }
    if (!uploaded) { fail(); return; }
    patch({ state: "checking" });
    const check = await invokeFile("finish", id);
    const finished = parseFinished(check.data, check.error, id);
    if (!alive.current) return;
    if (removed()) { discardFile(id); return; }
    if (finished.kind === "ready") { patch({ state: "ready", file: null }); onAttachment.current?.("File ready"); return; }
    if (finished.kind === "rejected") { refuse("rejected"); return; }
    if (finished.kind === "refused") {
      if (ENDS_HUB.has(finished.code)) { settle({ kind: "refused", code: finished.code }); return; }
      refuse(finished.code === "invalid" ? "gone" : beginRefusalReason(finished.code));
      return;
    }
    fail();
  }, [call, settle, tenantId, discardFile, invokeFile, setScopeChips]);

  /**
   * Attach picked or dropped files to one composer. Each is checked first with the server's rules; a
   * file that fails is a refused chip at once and is never uploaded. Refused chips don't count toward five.
   */
  const attach = useCallback((channelId: string, parentId: string | null, files: File[]) => {
    if (!files.length) return;
    const scope = attachmentScope(channelId, parentId);
    let held = (live.current.attachments[scope] ?? []).filter((chip) => chip.state !== "refused").length;
    const chips = files.map<AttachmentChip>((file) => {
      const reason = filePrecheck({ name: file.name, size: file.size, type: file.type }, held);
      if (!reason) held += 1;
      return {
        localId: newRequestId(), clientRequestId: newRequestId(), channelId, name: file.name, size: file.size,
        mime: fileTypeFor(file.name, file.type)?.mime ?? null, state: reason ? "refused" : "uploading", reason,
        fileId: null, path: null, file: reason ? null : file,
      };
    });
    setScopeChips(scope, (current) => [...current, ...chips]);
    const starting = chips.filter((chip) => chip.state === "uploading");
    const refused = chips.filter((chip) => chip.reason);
    const parts = [
      starting.length ? `Uploading ${starting.length === 1 ? "1 file" : `${starting.length} files`}` : null,
      ...refused.map((chip) => `File refused: ${fileRefusalMessage(chip.reason!)}`),
    ].filter(Boolean);
    if (parts.length) onAttachment.current?.(parts.join(". "));
    for (const chip of starting) void runChip(scope, chip);
  }, [runChip, setScopeChips]);

  /** Retry a chip whose upload didn't finish: the same client request id, so the same record. */
  const retryAttachment = useCallback((scope: string, localId: string) => {
    const chip = live.current.attachments[scope]?.find((item) => item.localId === localId);
    if (!chip || chip.state !== "failed") return;
    onAttachment.current?.("Uploading 1 file");
    void runChip(scope, chip);
  }, [runChip]);

  /** Remove a chip before sending. Its record, if one was made, is discarded best-effort. */
  const removeAttachment = useCallback((scope: string, localId: string) => {
    const chip = live.current.attachments[scope]?.find((item) => item.localId === localId);
    removedChips.current.add(localId);
    setScopeChips(scope, (chips) => chips.filter((item) => item.localId !== localId));
    if (chip?.fileId) discardFile(chip.fileId);
  }, [discardFile, setScopeChips]);

  /**
   * A fresh 60-second signed URL for one Team Hub file of this workspace, minted on every call and
   * never cached. With `download`, it is served as an attachment under the file's own name.
   */
  const fileUrl = useCallback(async (path: string, download?: string): Promise<string | null> => {
    if (!path.startsWith(`${tenantId.toLowerCase()}/team-hub/`)) return null;
    try {
      const bucket = supabase.storage.from(TEAM_HUB_FILE_BUCKET);
      const { data, error } = download
        ? await bucket.createSignedUrl(path, SIGNED_URL_SECONDS, { download })
        : await bucket.createSignedUrl(path, SIGNED_URL_SECONDS);
      return !error && data && typeof data.signedUrl === "string" && data.signedUrl ? data.signedUrl : null;
    } catch {
      return null;
    }
  }, [tenantId]);

  const deliver = useCallback(async (attempt: PendingMessage): Promise<SendOutcome> => {
    setPending((current) => current.map((item) => item.localId === attempt.localId ? { ...item, status: "sending" } : item));
    const isTask = attempt.kind === "task" && attempt.task;
    const answer = isTask
      ? await call("team_hub_request_task", {
        p_channel_id: attempt.channelId,
        p_title: attempt.task!.title,
        p_assignee: attempt.task!.assigneeId,
        p_due_at: attempt.task!.dueAt,
        p_client_request_id: attempt.clientRequestId,
        p_parent_message_id: attempt.parentId,
      })
      : await call("team_hub_post_message", {
        p_channel_id: attempt.channelId,
        p_body: attempt.body,
        p_client_request_id: attempt.clientRequestId,
        p_parent_message_id: attempt.parentId,
        p_mention_ids: attempt.mentionIds,
        p_file_ids: attempt.files.map((file) => file.fileId),
      });
    const parsed = isTask ? parseTaskRequested(answer.data, answer.error) : parsePosted(answer.data, answer.error);
    // For a task, the server's `unavailable` also means Operations refused (PLAN_FORBIDDEN, contract
    // §4), so it stays a task refusal here; the next list read still settles a workspace that isn't SOLO.
    const result = isTask && parsed.kind === "refused" && parsed.code === "unavailable" ? parsed : settle(parsed);
    if (!alive.current) return { kind: "failed" };
    if (result.kind === "ok") {
      const message = result.value.message;
      setPending((current) => current.filter((item) => item.localId !== attempt.localId));
      if (!message.parent_message_id) {
        setStream((current) => current && current.channelId === attempt.channelId
          ? { ...current, messages: mergeMessages(current.messages, [message]), channel: current.channel && { ...current.channel, joined: true } }
          : current);
      } else {
        setThread((current) => current && current.rootId === message.parent_message_id
          ? { ...current, replies: mergeMessages(current.replies, [message]), root: current.root && (result.value.duplicate ? current.root : { ...current.root, reply_count: current.root.reply_count + 1, last_reply_at: message.created_at }) }
          : current);
        if (!result.value.duplicate) {
          setStream((current) => current && current.channelId === attempt.channelId
            ? { ...current, messages: current.messages.map((item) => item.id === message.parent_message_id ? { ...item, reply_count: item.reply_count + 1, last_reply_at: message.created_at } : item) }
            : current);
        }
      }
      // Posting to a team channel joins the caller, as the server does.
      setOverview((current) => current && {
        ...current,
        conversations: current.conversations.map((conversation) => conversation.id === attempt.channelId
          ? { ...conversation, joined: true, last_message_at: message.created_at }
          : conversation),
      });
      if (message.work_ref) void readTaskStatuses([message.work_ref.id]);
      return { kind: "sent", duplicate: result.value.duplicate, messageId: message.id };
    }
    if (result.kind === "refused") {
      setPending((current) => current.filter((item) => item.localId !== attempt.localId));
      // Nothing was stored: the files go back to the composer they came from, still ready.
      if (attempt.files.length) setScopeChips(attachmentScope(attempt.channelId, attempt.parentId), (chips) => [...attempt.files, ...chips]);
      if (result.code === "not_found") {
        if (attempt.parentId) setThread((current) => current && current.rootId === attempt.parentId ? { ...current, status: "not_found" } : current);
        else setStream((current) => current && current.channelId === attempt.channelId ? { ...current, status: "not_found", messages: [], channel: null } : current);
      }
      return { kind: "refused", message: refusalMessage(result.code, isTask ? "task" : "send"), body: attempt.body, task: attempt.task };
    }
    setPending((current) => current.map((item) => item.localId === attempt.localId ? { ...item, status: "failed" } : item));
    return { kind: "failed" };
  }, [call, settle, readTaskStatuses, setScopeChips]);

  /** With `withFiles`, the composer's ready files leave it and travel with the message (and its Retry). */
  const send = useCallback((input: { channelId: string; parentId: string | null; body: string; mentionIds: string[]; withFiles?: boolean }) => {
    const scope = attachmentScope(input.channelId, input.parentId);
    const files = input.withFiles ? (live.current.attachments[scope] ?? []).filter((chip) => chip.state === "ready" && chip.fileId) : [];
    if (files.length) setScopeChips(scope, (chips) => chips.filter((chip) => !files.some((file) => file.localId === chip.localId)));
    const attempt: PendingMessage = {
      kind: "message",
      localId: newRequestId(),
      clientRequestId: newRequestId(),
      channelId: input.channelId,
      parentId: input.parentId,
      body: input.body.trim(),
      mentionIds: input.mentionIds,
      files,
      status: "sending",
    };
    setPending((current) => [...current, attempt]);
    return deliver(attempt);
  }, [deliver, setScopeChips]);

  /**
   * Create one task in Operations from this conversation. Like a post, the attempt keeps one client
   * request id and Retry reuses it, so a lost answer can never become a second task.
   */
  const requestTask = useCallback((input: { channelId: string; parentId: string | null; task: TaskDraft }) => {
    const attempt: PendingMessage = {
      kind: "task",
      task: { title: input.task.title.trim(), assigneeId: input.task.assigneeId, dueAt: input.task.dueAt },
      localId: newRequestId(),
      clientRequestId: newRequestId(),
      channelId: input.channelId,
      parentId: input.parentId,
      body: TASK_COMMAND_TEXT,
      mentionIds: [],
      files: [],
      status: "sending",
    };
    setPending((current) => [...current, attempt]);
    return deliver(attempt);
  }, [deliver]);

  // Every message whose task hasn't been read yet is read once it is shown (later refreshes re-read).
  const shownWorkIds = useMemo(() => [...(stream?.messages ?? []), ...(thread?.replies ?? []), ...(thread?.root ? [thread.root] : [])]
    .map((message) => message.work_ref?.id).filter((id): id is string => Boolean(id)).sort().join(","), [stream, thread]);
  useEffect(() => {
    if (!shownWorkIds) return;
    const unread = shownWorkIds.split(",").filter((id) => !live.current.taskReads[id]);
    if (unread.length) void readTaskStatuses(unread);
  }, [shownWorkIds, readTaskStatuses]);

  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const retry = useCallback((localId: string) => {
    const attempt = pendingRef.current.find((item) => item.localId === localId);
    // Same client request id: if the first attempt reached the server, this returns it.
    return attempt ? deliver(attempt) : Promise.resolve<SendOutcome>({ kind: "failed" });
  }, [deliver]);

  const discard = useCallback((localId: string) => {
    // An unsent message's files are discarded with it (a file that did post is refused there, so kept).
    for (const file of pendingRef.current.find((item) => item.localId === localId)?.files ?? []) if (file.fileId) discardFile(file.fileId);
    setPending((current) => current.filter((item) => item.localId !== localId));
  }, [discardFile]);

  const createChannel = useCallback(async (input: { name: string; visibility: "team" | "private"; memberIds: string[]; clientRequestId: string }): Promise<ActionOutcome<string>> => {
    const answer = await call("team_hub_create_channel", {
      p_name: input.name,
      p_visibility: input.visibility,
      p_member_ids: input.visibility === "private" ? input.memberIds : [],
      p_client_request_id: input.clientRequestId,
    });
    const result = settle(parseChannelId(answer.data, answer.error));
    if (result.kind !== "ok") return { ok: false, message: refusalMessage(failureCode(result), "create") };
    await refresh();
    await openConversation(result.value);
    return { ok: true, value: result.value };
  }, [call, settle, refresh, openConversation]);

  const openDm = useCallback(async (userId: string): Promise<ActionOutcome<string>> => {
    const existing = live.current.overview?.conversations.find((conversation) => conversation.kind === "dm" && conversation.dm_user_id === userId);
    if (existing) {
      await openConversation(existing.id);
      return { ok: true, value: existing.id };
    }
    const answer = await call("team_hub_open_dm", { p_user_id: userId });
    const result = settle(parseChannelId(answer.data, answer.error));
    if (result.kind !== "ok") return { ok: false, message: refusalMessage(failureCode(result), "dm") };
    await refresh();
    await openConversation(result.value);
    return { ok: true, value: result.value };
  }, [call, settle, refresh, openConversation]);

  const membership = useCallback(async (name: "team_hub_join_channel" | "team_hub_leave_channel", channelId: string): Promise<ActionOutcome> => {
    const answer = await call(name, { p_channel_id: channelId });
    const result = settle(parseAcknowledged(answer.data, answer.error));
    const action = name === "team_hub_join_channel" ? "join" : "leave";
    if (result.kind !== "ok") return { ok: false, message: refusalMessage(failureCode(result), action) };
    const joined = action === "join";
    setOverview((current) => current && {
      ...current,
      conversations: current.conversations.map((conversation) => conversation.id === channelId ? { ...conversation, joined, unread: 0 } : conversation),
    });
    setStream((current) => current && current.channelId === channelId && current.channel ? { ...current, channel: { ...current.channel, joined } } : current);
    await refresh();
    return { ok: true, value: true };
  }, [call, settle, refresh]);

  const joinChannel = useCallback((channelId: string) => membership("team_hub_join_channel", channelId), [membership]);
  const leaveChannel = useCallback((channelId: string) => membership("team_hub_leave_channel", channelId), [membership]);

  const addMembers = useCallback(async (channelId: string, userIds: string[]): Promise<ActionOutcome<number>> => {
    const answer = await call("team_hub_add_members", { p_channel_id: channelId, p_user_ids: userIds });
    const result = settle(parseAdded(answer.data, answer.error));
    if (result.kind !== "ok") return { ok: false, message: refusalMessage(failureCode(result), "add") };
    await refresh();
    return { ok: true, value: result.value };
  }, [call, settle, refresh]);

  const retryAfterScopeChange = useCallback(async () => {
    scopeRetried.current = true;
    setStatus("loading");
    await Promise.resolve(tenantRefresh.current?.());
    if (alive.current) await refresh();
  }, [refresh]);

  const retryLoad = useCallback(async () => {
    setStatus((current) => current === "unavailable" ? "loading" : current);
    await refresh();
  }, [refresh]);

  const activeConversation = useMemo(
    () => overview?.conversations.find((conversation) => conversation.id === activeId) ?? null,
    [overview, activeId],
  );

  return {
    status,
    overview,
    refreshFailed,
    online,
    activeId,
    activeConversation,
    stream,
    thread,
    pending,
    refresh,
    retryLoad,
    retryAfterScopeChange,
    openConversation,
    clearConversation,
    loadOlder,
    setStreamVisible,
    openThread,
    loadEarlierReplies,
    closeThread,
    send,
    requestTask,
    work,
    listWork,
    closeWork,
    taskReads,
    readTaskStatuses,
    retry,
    discard,
    attachments,
    attach,
    retryAttachment,
    removeAttachment,
    fileUrl,
    createChannel,
    openDm,
    joinChannel,
    leaveChannel,
    addMembers,
  };
}

export type TeamHub = ReturnType<typeof useTeamHub>;
export type { TeamHubRefusal };
