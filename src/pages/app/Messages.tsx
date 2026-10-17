/**
 * /app/messages — the customer's conversation with their business (E09).
 *
 * One thread, portal messages only (never the business's email/SMS history).
 * `?topic=help` opens the same thread in help mode: "Contact your team" replaces
 * the platform support desk for customers, and those sends land in the
 * business's own inbox as help requests. A message shows as sent only once the
 * server returned its id; nothing here claims the business has read it.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, BookOpen, Loader2, MessageSquare, RotateCw, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PORTAL_MESSAGE_MAX,
  portalSendFailureCopy,
  useClientPortalMessages,
  type OutboxMessage,
  type PortalMessage,
} from "@/hooks/useClientPortalMessages";
import { useClientPortalBrand } from "@/hooks/useClientPortalBrand";
import { useClientPortalConfigState } from "@/hooks/useClientPortalConfig";
import { usePlaybook } from "@/lib/playbook";
import { applyPortalOverlay, catalogRoutableItems } from "@/lib/portal/moduleNav";
import { readableTextOn } from "@/lib/brand/contrast";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { useClientAccountExit } from "@/components/client/useClientAccountExit";
import { portalBodyLength } from "@/lib/portal-message-body";

/** Refusals where editing the text cannot help: nothing to resend from the composer. */
const NO_EDIT = new Set(["NO_RELATIONSHIP", "MULTIPLE_RELATIONSHIPS", "RATE_LIMITED"]);
/** How far below the fold the reader may be and still count as "following" the conversation. */
const NEAR_BOTTOM_PX = 160;

/** Touch keyboards have no reliable Shift: Enter makes a new line there and the button sends. */
function useCoarsePointer() {
  const query = "(pointer: coarse)";
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [coarse, setCoarse] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const update = () => setCoarse(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);
  return coarse;
}

function snippet(body: string) {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function Bubble({ message, businessName, showAuthor }: { message: PortalMessage; businessName: string; showAuthor: boolean }) {
  const mine = message.author === "customer";
  return (
    <li id={`portal-message-${message.id}`} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      {showAuthor && (
        <span className="mb-1 px-1 text-xs font-medium text-muted-foreground">{mine ? "You" : businessName}</span>
      )}
      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap break-words ${
          mine ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted text-foreground rounded-bl-md"
        }`}
      >
        {message.kind === "help" && (
          <span className={`mb-1 block text-xs font-semibold ${mine ? "text-primary-foreground" : "text-muted-foreground"}`}>
            Help request
          </span>
        )}
        {message.body}
      </div>
      <time dateTime={message.created_at} className="mt-1 px-1 text-[11px] tabular-nums text-muted-foreground">
        {mine ? "Sent " : ""}{timeLabel(message.created_at)}
      </time>
    </li>
  );
}

function PendingBubble({
  entry, blocked, onRetry, onDiscard, onEdit,
}: {
  entry: OutboxMessage;
  blocked: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  onEdit: () => void;
}) {
  const sending = entry.status === "sending";
  const failed = entry.status === "failed";
  return (
    <li className="flex flex-col items-end" aria-busy={sending}>
      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-md px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap break-words ${
          sending ? "bg-primary/70 text-primary-foreground" : "border border-destructive/50 bg-background text-foreground"
        }`}
      >
        {entry.kind === "help" && (
          <span className={`mb-1 block text-xs font-semibold ${sending ? "text-primary-foreground" : "text-muted-foreground"}`}>
            Help request
          </span>
        )}
        {entry.body}
      </div>
      {sending ? (
        <span role="status" className="mt-1 inline-flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" /> Sending…
        </span>
      ) : (
        <div role="alert" className="mt-1.5 flex max-w-[85%] flex-col items-end gap-1.5 text-right">
          <p className="text-xs text-foreground">
            <AlertCircle aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 -translate-y-px align-middle text-destructive" />
            {failed
              ? portalSendFailureCopy(entry.error)
              : "We couldn't confirm this was sent. Retrying won't send it twice."}
          </p>
          <div className="flex flex-wrap justify-end gap-1.5">
            {failed && entry.error === "RATE_LIMITED" ? (
              <Button size="sm" variant="outline" onClick={onRetry} disabled={blocked}>
                <RotateCw aria-hidden="true" className="mr-1 h-3.5 w-3.5" /> Try again
              </Button>
            ) : failed ? (
              !NO_EDIT.has(entry.error ?? "") && (
                <Button size="sm" variant="outline" onClick={onEdit} disabled={blocked}>Edit and resend</Button>
              )
            ) : (
              <Button size="sm" variant="outline" onClick={onRetry} disabled={blocked}>
                <RotateCw aria-hidden="true" className="mr-1 h-3.5 w-3.5" /> Retry
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onDiscard} disabled={blocked}>
              {failed ? "Remove" : "Dismiss"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function ThreadSkeleton() {
  return (
    <div role="status" className="space-y-4 py-4">
      <span className="sr-only">Loading your messages…</span>
      <div className="flex justify-start"><Skeleton className="h-14 w-2/3 rounded-2xl motion-reduce:animate-none" /></div>
      <div className="flex justify-end"><Skeleton className="h-10 w-1/2 rounded-2xl motion-reduce:animate-none" /></div>
      <div className="flex justify-start"><Skeleton className="h-20 w-3/5 rounded-2xl motion-reduce:animate-none" /></div>
    </div>
  );
}

export default function Messages() {
  const [params] = useSearchParams();
  const help = params.get("topic") === "help";
  const thread = useClientPortalMessages();
  const brand = useClientPortalBrand();
  const pb = usePlaybook();
  const { config: portalConfig } = useClientPortalConfigState();
  const businessName = brand?.tenant_name?.trim() || "your team";
  const accent = brand?.tenant_id && brand.tenant_id === thread.tenantId ? brand.primary_color : null;
  const accentStyle = accent ? { backgroundColor: accent, color: readableTextOn(accent) } : undefined;
  const hasLearn = useMemo(
    () => applyPortalOverlay(catalogRoutableItems(pb.portal.modules), portalConfig.modules).some((i) => i.href === "/app/learn"),
    [pb.portal.modules, portalConfig.modules],
  );

  // Drafts belong to the signed-in identity: a scope change retires them. A draft carries whether it
  // is a help request, so a failed request edited and resent from the plain thread stays one.
  const [draft, setDraft] = useState<{ epoch: number; text: string; help: boolean }>({ epoch: thread.scopeEpoch, text: "", help: false });
  const live = draft.epoch === thread.scopeEpoch;
  const text = live ? draft.text : "";
  const draftIsHelp = live && draft.help;
  const setText = (value: string) => setDraft((prev) => ({
    epoch: thread.scopeEpoch,
    text: value,
    help: value.trim().length > 0 && (help || (prev.epoch === thread.scopeEpoch && prev.help)),
  }));
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const lastSeen = useRef<string | null>(null);
  const lastOutbox = useRef(0);
  const lastEpoch = useRef(thread.scopeEpoch);
  const anchor = useRef<string | null>(null);
  const nearBottom = useRef(true);
  const settled = useRef(false);
  const helpFocused = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  const coarse = useCoarsePointer();

  const anyInFlight = sending || thread.outbox.some((o) => o.status === "sending");
  const unresolved = thread.outbox.some((o) => o.status !== "sending");
  const guarded = text.trim().length > 0 || anyInFlight || unresolved;
  useBeforeUnloadGuard(guarded);
  useClientAccountExit(guarded, anyInFlight);

  // Track whether the reader is following the end of the conversation, whatever element scrolls.
  useEffect(() => {
    const measure = () => {
      const el = end.current;
      if (el) nearBottom.current = el.getBoundingClientRect().top <= window.innerHeight + NEAR_BOTTOM_PX;
    };
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    return () => {
      document.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, []);

  // New messages at the end: follow them only if the reader already was (or it's their own send).
  // Prepending history keeps the reader's place and is never announced.
  const newest = thread.messages.length ? thread.messages[thread.messages.length - 1] : null;
  const newestId = newest?.id ?? null;
  const outboxCount = thread.outbox.length;
  // A pending send that turns into a failure grows (its Retry row appears): follow that growth too.
  const outboxShape = thread.outbox.map((o) => o.status).join(",");
  const lastOutboxShape = useRef(outboxShape);
  useEffect(() => {
    // A new signed-in identity is a new conversation: its first load is a first load again, not
    // "new messages" to announce, and no scroll anchor from the old thread carries over.
    if (lastEpoch.current !== thread.scopeEpoch) {
      lastEpoch.current = thread.scopeEpoch;
      settled.current = false;
      lastSeen.current = null;
      lastOutbox.current = 0;
      anchor.current = null;
    }
    const previous = lastSeen.current;
    const initial = !settled.current;
    if (!thread.loading) settled.current = true;
    const ownSend = outboxCount > lastOutbox.current;
    const outboxGrew = outboxShape !== lastOutboxShape.current;
    lastOutboxShape.current = outboxShape;
    lastSeen.current = newestId;
    lastOutbox.current = outboxCount;
    if (anchor.current) {
      document.getElementById(`portal-message-${anchor.current}`)?.scrollIntoView?.({ block: "start" });
      anchor.current = null;
      return;
    }
    const appended = newestId !== null && newestId !== previous;
    if (appended && !initial && newest?.author === "business") {
      setAnnouncement(`New message from ${businessName}: ${snippet(newest.body)}`);
    }
    const firstLoad = appended && initial;
    const followMine = appended && newest?.author === "customer";
    if (ownSend || firstLoad || followMine || ((appended || outboxGrew) && nearBottom.current)) {
      end.current?.scrollIntoView?.({ block: "end" });
      nearBottom.current = true;
    }
  }, [newestId, newest, outboxCount, outboxShape, businessName, thread.loading, thread.scopeEpoch]);

  const length = portalBodyLength(text);
  const tooLong = length > PORTAL_MESSAGE_MAX;
  const blocked = thread.unavailable || thread.multipleBusinesses;
  const canCompose = !thread.loading && !blocked && !!thread.tenantId;

  // Help mode puts the cursor in the composer once it can actually take text (after the first read).
  useEffect(() => {
    if (!help) { helpFocused.current = false; return; }
    if (canCompose && !helpFocused.current) {
      helpFocused.current = true;
      field.current?.focus();
    }
  }, [help, canCompose]);
  const canSend = canCompose && length > 0 && !tooLong && !sending;

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    const body = text;
    const kind = help || draftIsHelp ? "help" : "message";
    setSending(true);
    setText("");
    try {
      await thread.send(body, kind);
    } finally {
      setSending(false);
      field.current?.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (coarse) return;
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const loadEarlier = async () => {
    anchor.current = thread.messages[0]?.id ?? null;
    await thread.loadMore();
  };

  // "Edit and resend" never loses a failed message: it moves into the composer, after any draft.
  const editFailed = (entry: OutboxMessage) => {
    const current = text.replace(/\s+$/, "");
    setDraft({
      epoch: thread.scopeEpoch,
      text: current.trim() ? `${current}\n\n${entry.body}` : entry.body,
      help: draftIsHelp || entry.kind === "help",
    });
    thread.discard(entry.localId);
    field.current?.focus();
  };

  const showThread = !blocked && !(thread.loading && thread.messages.length === 0);
  const empty = showThread && !thread.error && thread.messages.length === 0 && thread.outbox.length === 0;
  const counterId = "portal-message-count";

  return (
    <section
      aria-labelledby="messages-title"
      aria-busy={thread.loading}
      className="mx-auto flex min-h-full max-w-2xl flex-col [&_button]:min-h-[44px] [&_textarea]:text-[16px] md:[&_button]:min-h-[40px]"
    >
      <header className="space-y-1 pb-4">
        {help && (
          <Link
            to="/app/messages"
            replace
            className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" /> All messages
          </Link>
        )}
        <h1 id="messages-title" className="text-2xl font-semibold tracking-tight">
          {help ? "Contact your team" : "Messages"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {help
            ? `Tell ${businessName} what you need. Your request goes to their inbox, and their reply will appear here.`
            : `Your conversation with ${businessName}.`}
        </p>
        {help && hasLearn && (
          <p className="pt-1 text-sm">
            <Link
              to="/app/learn"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
            >
              <BookOpen aria-hidden="true" className="h-4 w-4" /> Browse resources first
            </Link>
          </p>
        )}
      </header>

      {thread.error && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 px-4 py-3 text-sm">
          <p className="inline-flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-destructive" /> {thread.error}
          </p>
          <Button size="sm" variant="outline" onClick={() => void thread.refresh()}>Try again</Button>
        </div>
      )}

      {thread.multipleBusinesses ? (
        <div className="rounded-xl border border-border p-8 text-center">
          <MessageSquare aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Messaging for more than one business isn't available yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Your account is connected to more than one business. Messages here work with one business at a time
            for now, so nothing can be sent from this page yet.
          </p>
        </div>
      ) : thread.unavailable ? (
        <div className="rounded-xl border border-border p-8 text-center">
          <MessageSquare aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">Messages aren't available on this account</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Messaging opens once your account is connected to a business. Sign in with the email your business invited.
          </p>
        </div>
      ) : !showThread ? (
        <div className="flex-1"><ThreadSkeleton /></div>
      ) : (
        <div className="flex flex-1 flex-col">
          {thread.hasMore && (
            <div className="flex justify-center pb-4">
              <Button size="sm" variant="ghost" onClick={() => void loadEarlier()} disabled={thread.loadingMore}>
                {thread.loadingMore && <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin motion-reduce:animate-none" />}
                Load earlier messages
              </Button>
            </div>
          )}

          {empty ? (
            <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
              <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <MessageSquare aria-hidden="true" className="h-6 w-6" />
              </span>
              <h2 className="text-base font-semibold">
                {help ? `What can ${businessName} help with?` : `Start a conversation with ${businessName}`}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {help
                  ? "Describe the problem or question in your own words. The more detail, the faster they can help."
                  : "Ask a question or share an update. It goes to their inbox, and their replies show up here."}
              </p>
            </div>
          ) : (
            // The log itself is not live: loading history or the first page would read the whole
            // thread aloud. New incoming messages are announced once, below.
            <div role="log" aria-label={`Conversation with ${businessName}`} aria-live="off" className="flex-1 pb-4">
              <ol className="space-y-3">
                {thread.messages.map((m, i) => {
                  const prev = thread.messages[i - 1];
                  const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                  return (
                    <FragmentWithDay key={m.id} label={newDay ? dayLabel(m.created_at) : null}>
                      <Bubble message={m} businessName={businessName} showAuthor={newDay || prev.author !== m.author} />
                    </FragmentWithDay>
                  );
                })}
                {thread.outbox.map((o) => (
                  <PendingBubble
                    key={o.localId}
                    entry={o}
                    blocked={anyInFlight}
                    onRetry={() => void thread.retry(o.localId)}
                    onDiscard={() => thread.discard(o.localId)}
                    onEdit={() => editFailed(o)}
                  />
                ))}
              </ol>
            </div>
          )}
          <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        </div>
      )}

      {!blocked && (
        <form
          onSubmit={(e) => void submit(e)}
          className="sticky bottom-0 -mx-1 mt-2 border-t border-border bg-background px-1 pb-1 pt-3 shadow-[shadow:0_2rem_0_0_hsl(var(--background))]"
          aria-label={help ? "Send a help request" : "Send a message"}
        >
          <Label htmlFor="portal-message-body" className="sr-only">
            {help ? `Your request for ${businessName}` : `Message ${businessName}`}
          </Label>
          {draftIsHelp && !help && (
            <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">This goes to {businessName} as a help request.</p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              id="portal-message-body"
              ref={field}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={help ? "What do you need help with?" : `Message ${businessName}`}
              rows={2}
              disabled={!canCompose}
              aria-invalid={tooLong || undefined}
              aria-describedby={counterId}
              className="max-h-48 min-h-[44px] flex-1 resize-none"
            />
            <Button
              type="submit"
              disabled={!canSend}
              style={accentStyle}
              aria-label={help ? "Send request" : "Send message"}
              className={accentStyle ? "shrink-0 dark:ring-1 dark:ring-foreground/30" : "shrink-0"}
            >
              {sending ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <SendHorizontal aria-hidden="true" className="h-4 w-4" />
              )}
              <span className="ml-1.5 hidden sm:inline">{help ? "Send request" : "Send"}</span>
            </Button>
          </div>
          <p id={counterId} className={`mt-1.5 px-1 text-[11px] ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
            {tooLong
              ? `${(length - PORTAL_MESSAGE_MAX).toLocaleString()} characters over the 4,000 limit.`
              : coarse
                ? "Up to 4,000 characters."
                : "Enter to send · Shift+Enter for a new line"}
          </p>
        </form>
      )}
      {/* The end of the conversation sits BELOW the sticky composer, so scrolling it into view brings
          the newest message (and any Retry) out from under the composer instead of behind it. */}
      <div ref={end} aria-hidden="true" />
    </section>
  );
}

function FragmentWithDay({ label, children }: { label: string | null; children: ReactNode }) {
  return (
    <>
      {label && (
        <li role="presentation" className="flex items-center gap-3 py-2 text-[11px] font-medium text-muted-foreground">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          <span>{label}</span>
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </li>
      )}
      {children}
    </>
  );
}
