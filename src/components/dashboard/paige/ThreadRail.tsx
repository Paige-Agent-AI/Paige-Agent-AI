import { useMemo, useState, type ReactNode } from "react";
import { MessageSquarePlus, MoreHorizontal, Pencil, Archive, Trash2, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { GlyphPlate } from "@/components/ui/page/GlyphPlate";
import { StatePill } from "@/components/ui/page/StatePill";
import { EmptyState } from "@/components/ui/page/EmptyState";
import { cn } from "@/lib/utils";
import type { PaigeThread } from "@/hooks/usePaigeThreads";

interface ThreadRailProps {
  threads: PaigeThread[];
  isLoading: boolean;
  activeThreadId: string | null;
  streamingThreadId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  /** Mobile drawer control. Desktop ignores these (rail is always mounted). */
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  /** Rendered below the list — an acting operator's door to members' conversations. */
  footer?: ReactNode;
}

type Bucket = { label: string; items: PaigeThread[] };

function groupByRecency(threads: PaigeThread[]): Bucket[] {
  const now = Date.now();
  const DAY = 86_400_000;
  const buckets: Record<string, PaigeThread[]> = { Today: [], Yesterday: [], "Previous 7 days": [], Earlier: [] };
  for (const t of threads) {
    const ts = t.last_message_at ? new Date(t.last_message_at).getTime() : (t.updated_at ? new Date(t.updated_at).getTime() : 0);
    const age = now - ts;
    if (age < DAY) buckets.Today.push(t);
    else if (age < 2 * DAY) buckets.Yesterday.push(t);
    else if (age < 7 * DAY) buckets["Previous 7 days"].push(t);
    else buckets.Earlier.push(t);
  }
  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function ThreadRow({
  thread, active, streaming, onSelect, onRename, onArchive, onDelete,
}: {
  thread: PaigeThread;
  active: boolean;
  streaming: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(thread.title ?? "");

  const commit = () => {
    const next = draft.trim();
    if (next && next !== thread.title) onRename(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="px-2 py-1.5">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(thread.title ?? ""); setEditing(false); }
          }}
          className="h-8 text-sm"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-primary/[0.06] ring-1 ring-inset ring-[hsl(var(--ring))]"
          : "hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 truncate rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        title={thread.title ?? "Untitled chat"}
      >
        <span className={cn("truncate", active ? "font-medium text-foreground" : "text-foreground/80")}>
          {thread.title?.trim() || "Untitled chat"}
        </span>
      </button>

      {streaming && <StatePill state="on">Live</StatePill>}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Chat options"
            className={cn(
              "shrink-0 rounded-md p-1 text-muted-foreground opacity-0 outline-none transition-opacity",
              "hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100",
              active && "opacity-100",
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => { setDraft(thread.title ?? ""); setEditing(true); }}>
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onArchive}>
            <Archive className="mr-2 h-4 w-4" /> Archive
          </DropdownMenuItem>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={(e) => e.preventDefault()}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the conversation and everything in it. There's no undo —
                  archive it instead if you might want it back.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={onDelete}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ThreadList(props: Omit<ThreadRailProps, "mobileOpen" | "onMobileOpenChange">) {
  const { threads, isLoading, activeThreadId, streamingThreadId, onSelect, onNewChat, onRename, onArchive, onDelete, footer } = props;
  const buckets = useMemo(() => groupByRecency(threads), [threads]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-border px-4 pb-3 pt-4">
        <GlyphPlate icon={MessagesSquare} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-sm font-semibold text-foreground">Your chats</h3>
          <p className="truncate text-xs text-muted-foreground">Every conversation, saved.</p>
        </div>
      </div>

      <div className="px-3 pb-3 pt-3">
        <Button variant="gold" size="sm" className="w-full" onClick={onNewChat}>
          <MessageSquarePlus className="mr-2 h-4 w-4" /> New chat
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2">
        {isLoading ? (
          <div className="space-y-1.5 px-1 py-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="No chats yet"
            description="Start one and it'll live here — come back anytime and pick up right where you left off."
            className="py-10"
          />
        ) : (
          <div className="space-y-3 pb-3">
            {buckets.map((bucket) => (
              <div key={bucket.label}>
                <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {bucket.label}
                </p>
                <div className="space-y-0.5">
                  {bucket.items.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      active={t.id === activeThreadId}
                      streaming={t.id === streamingThreadId}
                      onSelect={() => onSelect(t.id)}
                      onRename={(title) => onRename(t.id, title)}
                      onArchive={() => onArchive(t.id)}
                      onDelete={() => onDelete(t.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
      {footer}
    </div>
  );
}

/**
 * The Your Paige history rail (#94). Desktop: a fixed w-72 card rail. Mobile: the
 * same list inside a left Sheet driven by mobileOpen. Gold discipline (§11): the
 * only gold in here is "New chat" (the act) and the "Live" pill on the streaming
 * thread; the active row is an indigo --ring inset, never gold.
 */
export function ThreadRail(props: ThreadRailProps) {
  const { mobileOpen, onMobileOpenChange, ...list } = props;

  return (
    <>
      <aside className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card md:flex">
        <ThreadList {...list} />
      </aside>

      <Sheet open={!!mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-[85vw] max-w-xs p-0">
          <ThreadList
            {...list}
            onSelect={(id) => { list.onSelect(id); onMobileOpenChange?.(false); }}
            onNewChat={() => { list.onNewChat(); onMobileOpenChange?.(false); }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
