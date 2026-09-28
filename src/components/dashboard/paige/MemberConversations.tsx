import { useCallback, useEffect, useRef, useState } from "react";
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
  message_count: number;
  last_message_at: string | null;
  created_at: string;
};

type OpenedThread = {
  threadId: string;
  ownerName: string;
  openedAt: Date;
  turns: Array<{ role: "user" | "assistant"; content: string; createdAt: string }>;
};

type ListState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; threads: MemberThread[] }
  | { phase: "error" };

const REFUSED = /operator_member_threads_not_permitted|operator_not_acting/;

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
  const restoreFocus = useCallback((event: Event) => {
    event.preventDefault();
    returnFocus.current?.focus();
  }, []);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setList({ phase: "loading" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("operator_list_member_threads");
    if (mine !== generation.current) return;
    if (error) {
      // Not an operator who may, or not in an audited act-as: this door does not exist for them.
      setList(REFUSED.test(String(error.message ?? "")) ? { phase: "idle" } : { phase: "error" });
      return;
    }
    setList({ phase: "ready", threads: (data ?? []) as MemberThread[] });
  }, []);

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
    const { data, error } = await (supabase as any).rpc("operator_open_member_thread", { _thread_id: pending.thread_id });
    // The workspace changed while this was in flight: its conversation belongs to the one left.
    if (epoch !== scopeEpoch.current) return;
    setOpening(false);
    const who = pending.owner_name;
    setPending(null);
    if (error) {
      const message = String(error.message ?? "");
      if (/operator_not_acting/.test(message)) toast.error("You're no longer acting as this workspace, so the conversation wasn't opened.");
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
      openedAt: new Date(),
      turns: Array.isArray(data.turns) ? data.turns : [],
    });
  }, [load, opening, pending]);

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
              <ul className="space-y-0.5">
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
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {thread.message_count} {thread.message_count === 1 ? "message" : "messages"} · {relative(thread.last_message_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <AlertDialog open={!!pending} onOpenChange={(value) => { if (!value && !opening) setPending(null); }}>
        <AlertDialogContent onCloseAutoFocus={(event) => { if (!opened) restoreFocus(event); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>Open {pending?.owner_name}'s conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This is {pending?.owner_name}'s private conversation with PAIGE. Opening it is recorded under
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
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0" onCloseAutoFocus={restoreFocus}>
          <DialogHeader className="border-b border-border px-6 pb-4 pt-6 text-left">
            <DialogTitle>{opened?.ownerName}'s conversation with PAIGE</DialogTitle>
            <DialogDescription>
              Read only. You opened it at {opened ? clock(opened.openedAt) : ""}, and that's recorded.
            </DialogDescription>
          </DialogHeader>
          <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5" aria-label={`${opened?.ownerName ?? "Member"}'s messages`}>
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
