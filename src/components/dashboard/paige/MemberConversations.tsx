import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Members' private conversations with PAIGE, for an operator acting as the workspace.
 *
 * Owner ruling 2026-09-28: hidden by default, openable on purpose, recorded when opened. The
 * panel's own list shows only the viewer's conversations; this is the deliberate door to someone
 * else's. It lists who and when (never titles, which quote the first message), asks before opening,
 * says the open is recorded, and shows the conversation read-only and named as that member's —
 * never inside the viewer's own transcript, where it could read as theirs.
 *
 * The server decides everything: `operator_list_member_threads()` refuses anyone who does not hold
 * the capability or is not in an audited act-as, and `operator_open_member_thread()` records the
 * open before it returns a word. A refused list renders nothing here.
 */

type MemberThread = {
  thread_id: string;
  owner_name: string;
  owner_email: string | null;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  /** The server's paging key: the time shown for the thread. */
  sort_at: string;
};

// A page of the list, and the server's own cap on it. The transcript is windowed by the server too.
const PAGE = 50;

type OpenedThread = {
  threadId: string;
  ownerName: string;
  ownerEmail: string | null;
  openedAt: Date;
  /** Where earlier turns begin, or null when the start of the conversation is shown. */
  earlierBeforeSeq: number | null;
  turns: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
};

type ListState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; threads: MemberThread[]; hasMore: boolean }
  | { phase: "error" };

const REFUSED = /operator_member_threads_not_permitted|operator_not_acting|operator_scope_moved/;

function relative(iso: string | null): string {
  if (!iso) return "no messages yet";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

function clock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Keyed by workspace: each workspace gets a fresh instance, so no frame of one workspace can ever
// paint another's members or transcript (an effect-time reset runs only after the frame commits).
export function MemberConversations({ scopeKey }: { scopeKey: string }) {
  return <MemberConversationsForWorkspace key={scopeKey} scopeKey={scopeKey} />;
}

function MemberConversationsForWorkspace({ scopeKey }: { scopeKey: string }) {
  const [list, setList] = useState<ListState>({ phase: "idle" });
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<MemberThread | null>(null);
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState<OpenedThread | null>(null);
  const generation = useRef(0);
  // Moves on every workspace change: a reply begun in one workspace is never shown in the next.
  const scopeEpoch = useRef(0);
  // Both dialogs open from a row, not from a trigger Radix knows, so focus is handed back by hand:
  // after Cancel, or after the conversation is closed, the keyboard is where it was.
  const returnFocus = useRef<HTMLElement | null>(null);
  // These dialogs render in a portal, but React still sends their key events up the component tree,
  // so the Solo history sheet around this section saw Escape and Tab too: Escape on the confirm
  // closed the whole sheet, and the sheet's Tab trap could pull focus out of the dialog. The dialog
  // handles its own keys (Radix listens on the document), so nothing above needs them.
  const keepKeysInside = useCallback((event: KeyboardEvent<HTMLDivElement>) => { event.stopPropagation(); }, []);
  const restoreFocus = useCallback((event: Event) => {
    event.preventDefault();
    returnFocus.current?.focus();
  }, []);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setList({ phase: "loading" });
    // The workspace this tab shows, asserted; the server's own act-as decides (another tab may have moved it).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("operator_list_member_threads", { _expected_tenant: scopeKey, _limit: PAGE });
    if (mine !== generation.current) return;
    if (error) {
      // Not an operator who may, or not in an audited act-as: this door does not exist for them.
      setList(REFUSED.test(String(error.message ?? "")) ? { phase: "idle" } : { phase: "error" });
      return;
    }
    const rows = (data ?? []) as MemberThread[];
    setList({ phase: "ready", threads: rows, hasMore: rows.length === PAGE });
  }, [scopeKey]);

  // The workspace this tab shows is asserted on every request, but that cannot take back what is
  // already on screen if another tab moves the operator's act-as. So whenever this tab comes back
  // (focus, or visible again) it asks the server once more, quietly; if the server now refuses, the
  // list and any open conversation are cleared, and the operator is told why (Codex review of 3ca53c69).
  const shownRef = useRef(false);
  shownRef.current = list.phase === "ready" || !!opened || !!pending;
  const idleRef = useRef(true);
  idleRef.current = list.phase === "idle";
  // The server refused this workspace (another tab left or moved it): clear everything shown and
  // revoke everything in flight — list loads (generation) and opens or earlier-message reads (epoch)
  // — so none of them can land after this and repaint what was cleared. The section comes back
  // collapsed, as it starts, if a later check finds the operator back.
  const revoke = useCallback((message: string) => {
    const wasShowing = shownRef.current;
    generation.current += 1;
    scopeEpoch.current += 1;
    setOpening(false);
    setOpened(null);
    setPending(null);
    setExpanded(false);
    setList({ phase: "idle" });
    if (wasShowing) {
      toast.error(/operator_scope_moved/.test(message)
        ? "You've moved to another workspace in a different tab, so members' conversations here were closed."
        : "You're no longer acting as this workspace, so members' conversations here were closed.");
    }
  }, []);
  const revalidate = useCallback(async () => {
    const mine = generation.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("operator_list_member_threads", { _expected_tenant: scopeKey, _limit: PAGE });
    if (mine !== generation.current) return;
    if (!error) {
      // Cleared earlier (or refused at first) and allowed again: the operator is back in this
      // workspace, so the section returns with the first page this check just read (Codex review of 0e81cac9).
      if (idleRef.current) {
        const rows = (data ?? []) as MemberThread[];
        setList({ phase: "ready", threads: rows, hasMore: rows.length === PAGE });
      }
      return;
    }
    const message = String(error.message ?? "");
    // A transient failure changes nothing: what is shown was allowed a moment ago and may still be.
    if (!REFUSED.test(message)) return;
    revoke(message);
  }, [revoke, scopeKey]);

  useEffect(() => {
    const onFocus = () => { void revalidate(); };
    const onVisibility = () => { if (document.visibilityState !== "hidden") void revalidate(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [revalidate]);

  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    if (list.phase !== "ready" || !list.hasMore || loadingMore) return;
    const last = list.threads[list.threads.length - 1];
    const mine = generation.current;
    setLoadingMore(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("operator_list_member_threads", {
      _expected_tenant: scopeKey, _limit: PAGE, _before_sort_at: last.sort_at, _before_thread_id: last.thread_id,
    });
    // Free the button first: a reply that is stale (the list reloaded meanwhile) is dropped, but it
    // must not leave Show more disabled for the list that replaced it.
    setLoadingMore(false);
    if (mine !== generation.current) return;
    if (error) {
      const message = String(error.message ?? "");
      // A refusal is not a failed fetch: the rows already shown were read under an authority that is gone.
      if (REFUSED.test(message)) revoke(message);
      else toast.error("Couldn't load more members' conversations. Try again.");
      return;
    }
    const rows = (data ?? []) as MemberThread[];
    setList({ phase: "ready", threads: [...list.threads, ...rows], hasMore: rows.length === PAGE });
  }, [list, loadingMore, revoke, scopeKey]);

  useEffect(() => {
    setExpanded(false);
    setPending(null);
    setOpened(null);
    setOpening(false);
    void load();
    return () => {
      generation.current += 1;
      scopeEpoch.current += 1;
    };
  }, [load, scopeKey]);

  const open = useCallback(async () => {
    if (!pending || opening) return;
    setOpening(true);
    const epoch = scopeEpoch.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("operator_open_member_thread", { _thread_id: pending.thread_id, _expected_tenant: scopeKey });
    // The workspace changed while this was in flight: its conversation belongs to the one left.
    if (epoch !== scopeEpoch.current) return;
    setOpening(false);
    const who = pending.owner_name;
    setPending(null);
    if (error) {
      const message = String(error.message ?? "");
      if (/operator_not_acting/.test(message)) toast.error("You're no longer acting as this workspace, so the conversation wasn't opened.");
      else if (/operator_scope_moved/.test(message)) toast.error("You've moved to another workspace in a different tab, so this conversation wasn't opened.");
      else if (/member_thread_not_available/.test(message)) toast.error(`${who}'s conversation isn't available any more.`);
      // The server may have recorded the open before the reply was lost, so this cannot say it
      // wasn't; opening again records another open, which is the truth of what happened.
      else toast.error(`Paige couldn't confirm ${who}'s conversation opened. If it did, the open was recorded. Try again.`);
      void load();
      return;
    }
    setOpened({
      threadId: data.threadId,
      ownerName: data.ownerName ?? who,
      ownerEmail: data.ownerEmail ?? null,
      earlierBeforeSeq: typeof data.earlierBeforeSeq === "number" ? data.earlierBeforeSeq : null,
      // The recorded time, read back from the server's audit row; the browser clock is only a fallback.
      openedAt: data.openedAt ? new Date(data.openedAt) : new Date(),
      turns: Array.isArray(data.turns) ? data.turns : [],
    });
  }, [load, opening, pending, scopeKey]);

  // Earlier turns of the open conversation, a window at a time. Each read is an open of its own on the
  // server and is recorded as one.
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loadEarlier = useCallback(async () => {
    if (!opened || opened.earlierBeforeSeq == null || loadingEarlier) return;
    const epoch = scopeEpoch.current;
    setLoadingEarlier(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("operator_open_member_thread", {
      _thread_id: opened.threadId, _expected_tenant: scopeKey, _before_seq: opened.earlierBeforeSeq,
    });
    // Free the button first: a reply dropped as stale must not leave it on "Loading…" for the
    // conversation opened after it (Codex review of 290b942e).
    setLoadingEarlier(false);
    if (epoch !== scopeEpoch.current) return;
    if (error) {
      const message = String(error.message ?? "");
      // A refusal is not a failed fetch: this workspace was taken back, so the transcript goes too.
      if (REFUSED.test(message)) revoke(message);
      else toast.error("Couldn't load earlier messages. Try again.");
      return;
    }
    const earlier = Array.isArray(data.turns) ? data.turns : [];
    setOpened((current) => current && current.threadId === opened.threadId
      ? { ...current, turns: [...earlier, ...current.turns], earlierBeforeSeq: typeof data.earlierBeforeSeq === "number" ? data.earlierBeforeSeq : null }
      : current);
  }, [loadingEarlier, opened, revoke, scopeKey]);

  if (list.phase === "idle" || list.phase === "loading") return null;
  if (list.phase === "ready" && list.threads.length === 0) return null;

  return (
    <section aria-label="Members' conversations" className="mx-2 mb-2 border-t border-border pt-2">
      {list.phase === "error" ? (
        <p className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          Couldn't load members' conversations.
          <button
            type="button"
            onClick={() => void load()}
            className="rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </p>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              aria-hidden
              className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none", expanded && "rotate-90")}
            />
            <span className="min-w-0 flex-1 font-medium leading-snug">Members' conversations</span>
            <span className="tabular-nums">{list.threads.length}</span>
          </button>
          {expanded && (
            <div className="mt-1">
              <p className="px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                Private to each member. Opening one is recorded under your name.
              </p>
              {/* Its own bounded scroll: the section sits below the rail's list, outside its scroll owner. */}
              <ul className="max-h-[min(40vh,18rem)] space-y-0.5 overflow-y-auto overscroll-contain">
                {list.threads.map((thread) => (
                  <li key={thread.thread_id}>
                    <button
                      type="button"
                      onClick={(event) => { returnFocus.current = event.currentTarget; setPending(thread); }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <LockKeyhole aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-foreground">{thread.owner_name}</span>
                        {/* Names repeat or are missing; the email says which member this is. */}
                        {thread.owner_email && <span className="block truncate text-[11px] text-muted-foreground">{thread.owner_email}</span>}
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {thread.message_count} {thread.message_count === 1 ? "message" : "messages"} · {relative(thread.last_message_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {list.hasMore && (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {loadingMore ? "Loading…" : "Show more"}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <AlertDialog open={!!pending} onOpenChange={(value) => { if (!value && !opening) setPending(null); }}>
        <AlertDialogContent onKeyDown={keepKeysInside} onCloseAutoFocus={(event) => { if (!opened) restoreFocus(event); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Open {pending?.owner_name}'s conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This is {pending?.owner_name}'s{pending?.owner_email ? ` (${pending.owner_email})` : ""} private conversation with PAIGE. Opening it is recorded under
              your name, with the time. You'll be able to read it, not add to it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={opening}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={opening}
              onClick={(event) => { event.preventDefault(); void open(); }}
            >
              {opening ? "Opening…" : "Open conversation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!opened} onOpenChange={(value) => { if (!value) setOpened(null); }}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0" onKeyDown={keepKeysInside} onCloseAutoFocus={restoreFocus}>
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6 text-left">
            <DialogTitle>{opened?.ownerName}'s conversation with PAIGE</DialogTitle>
            <DialogDescription>
              {opened?.ownerEmail ? `${opened.ownerEmail}. ` : ""}Read only. You opened it at {opened ? clock(opened.openedAt) : ""}, and that's recorded.
            </DialogDescription>
          </DialogHeader>
          <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5" aria-label={`${opened?.ownerName ?? "Member"}'s messages`}>
            {opened?.earlierBeforeSeq != null && (
              <li>
                <Button variant="ghost" size="sm" disabled={loadingEarlier} onClick={() => void loadEarlier()}>
                  {loadingEarlier ? "Loading…" : "Show earlier messages"}
                </Button>
              </li>
            )}
            {opened && opened.turns.length === 0 && (
              <li className="text-sm text-muted-foreground">This conversation has no messages.</li>
            )}
            {opened?.turns.map((turn, index) => (
              <li key={index}>
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                  {turn.role === "user" ? opened.ownerName : "PAIGE"}
                </p>
                <p
                  className={cn(
                    "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed text-foreground",
                    turn.role === "user" ? "bg-muted" : "border border-border",
                  )}
                >
                  {turn.content}
                </p>
              </li>
            ))}
          </ol>
          <DialogFooter className="border-t border-border px-6 py-3">
            <Button variant="outline" onClick={() => setOpened(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
