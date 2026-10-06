import type { MouseEvent as ReactMouseEvent } from "react";
import { formatDistanceToNow } from "date-fns";
import { StatePill } from "@/components/ui/page";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { Clock, Archive } from "lucide-react";
import {
  type DbThread, type MessageRow, type Label, type ChannelType, type Density,
  CHANNEL_ICON, CHANNEL_LABEL, LABEL_COLOR, bodyPreview, contactNameFromClient, partyLabel, isUntilReply,
  initialsFromName, avatarTint,
} from "./inbox-shared";
import { SnoozeMenu } from "./SnoozeMenu";
import { LabelPopover } from "./LabelPopover";
import { isApprovableDraft } from "./governedSend";

// Real contact avatar: deterministic INITIALS in a tokenized indigo-family circle (no fake
// photo — clients has no avatar column, §13), with the channel glyph as a small corner badge.
function ContactAvatar({
  name, channel, unread, compact,
}: { name: string; channel: ChannelType; unread: boolean; compact: boolean }) {
  const Icon = CHANNEL_ICON[channel];
  return (
    <span className="relative shrink-0">
      <span
        className={cn(
          "grid place-items-center rounded-full border font-semibold",
          compact ? "h-7 w-7 text-[10px]" : "h-8 w-8 text-[11px]",
          avatarTint(name),
          unread && "ring-1 ring-[hsl(var(--primary)/0.35)]",
        )}
        aria-hidden
      >
        {initialsFromName(name)}
      </span>
      <span
        className={cn(
          "absolute -bottom-1 -right-1 grid place-items-center rounded-full border-2 border-[hsl(var(--card))] bg-muted text-muted-foreground",
          compact ? "h-3.5 w-3.5" : "h-4 w-4",
        )}
        title={CHANNEL_LABEL[channel]} aria-label={CHANNEL_LABEL[channel]}
      >
        <Icon className={compact ? "h-2 w-2" : "h-2.5 w-2.5"} aria-hidden />
      </span>
    </span>
  );
}

export function ThreadRow({
  thread, preview, channel, active, onClick,
  catalog, onSnooze, onArchive, onSetThreadLabels, onRenameCatalogLabel,
  density = "comfortable", selected = false, selectionActive = false, onToggleSelect, cursored = false,
  needsAttention = false,
}: {
  thread: DbThread;
  preview: MessageRow | null;
  channel: ChannelType;
  active: boolean;
  onClick: () => void;
  catalog: Label[];
  onSnooze: (id: string, until: Date | string | null) => void;
  onArchive: (id: string, on: boolean) => void;
  onSetThreadLabels: (threadId: string, labels: Label[]) => void;
  onRenameCatalogLabel: (labelId: string, patch: Partial<Label>) => void;
  // #121 — ALL optional so existing callers keep working unchanged.
  density?: Density;                                     // comfortable (default) | compact
  selected?: boolean;                                    // multi-select checked state
  selectionActive?: boolean;                             // any selection exists → keep checkboxes visible
  onToggleSelect?: (e: ReactMouseEvent) => void;         // undefined → no checkbox rendered
  cursored?: boolean;                                    // keyboard-nav highlight (distinct from `active` open state)
  needsAttention?: boolean;                              // Solo queue's unified attention contract
}) {
  const compact = density === "compact";
  const name =
    contactNameFromClient(thread.clients) ||
    (preview ? partyLabel(preview.direction === "inbound" ? preview.sender : preview.recipients?.[0]) : "") ||
    "Unknown contact";
  // #175 — person name is primary; surface the org (and role) as a muted subtitle so the
  // business context isn't lost. Mirrors ContactCardRail's identity block (§18 one pattern).
  // Guard: when there's no person name, entity_name is already the PRIMARY label — don't echo
  // it in the subtitle (a whole rail of entity-only contacts would stack the same name twice, §25).
  // Trim to match contactNameFromClient's own trimming — a whitespace-only first/last name
  // (import/API data) falls back to entity_name as the PRIMARY, so a raw truthiness check here
  // would still echo that same entity in the subtitle (Codex P2). Derive from trimmed fields.
  const hasPersonName = !!(thread.clients?.first_name?.trim() || thread.clients?.last_name?.trim());
  const subtitle = [thread.clients?.title, hasPersonName ? thread.clients?.entity_name : null]
    .filter(Boolean)
    .join(" · ");
  const unread = thread.unread_count > 0;
  // R-N2: a draft is simply the latest message sitting as a draft — unless it is a governed send
  // already approved and on its way (INT-328), which is never "Draft ready".
  const hasDraft = !!preview && isApprovableDraft(preview);
  const scheduled = preview?.status === "queued" && !!preview.scheduled_for;
  const labels = thread.labels ?? [];
  const snoozed = !!thread.snoozed_until && new Date(thread.snoozed_until) > new Date();
  const archived = !!thread.archived_at;
  const ts = thread.last_message_at ?? preview?.sent_at ?? preview?.created_at ?? null;

  return (
    <div
      role="button"
      tabIndex={0}
      data-thread-key={thread.thread_key}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      aria-current={active ? "true" : undefined}
      aria-selected={onToggleSelect ? selected : undefined}
      className={cn(
        "group relative flex w-full cursor-pointer items-start rounded-lg border text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
        compact ? "gap-2.5 px-3 py-1.5" : "gap-3 px-3 py-2.5",
        active
          // Indigo selection accent bar (Linear/Front pattern). before:content-[''] is REQUIRED —
          // a Tailwind pseudo-element with no content defaults to content:none and paints nothing.
          ? "border-[hsl(var(--border-strong))] bg-muted before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-[hsl(var(--primary))] before:content-['']"
          : selected
            ? "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)]"
            : "border-transparent hover:border-border hover:bg-muted/60",
        // Keyboard-cursor highlight — an inset indigo ring, orthogonal to the open (`active`) and
        // multi-select (`selected`) states so a navigating user always sees where the cursor is.
        cursored && "ring-1 ring-inset ring-[hsl(var(--ring))]",
        needsAttention && !active && "border-[hsl(var(--warning)/0.6)] bg-[hsl(var(--warning)/0.07)]",
      )}
    >
      {/* Multi-select checkbox — the Checkbox is pointer-events-none so the wrapper owns the
          click (captures shiftKey for range-select + stopPropagation so it never opens the
          thread). Visible on hover, or forced visible while a selection is active (§36). */}
      {onToggleSelect && (
        <span
          className={cn(
            "flex shrink-0 items-center self-center transition-opacity",
            selected || selectionActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
          )}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleSelect(e); }}
        >
          <Checkbox
            checked={selected}
            tabIndex={-1}
            aria-label={`Select ${name}`}
            className="pointer-events-none"
          />
        </span>
      )}
      {/* Unread rows pop: ring the avatar indigo (§27 contrast). Token, AA both themes. */}
      <ContactAvatar name={name} channel={channel} unread={unread} compact={compact} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm text-foreground", unread ? "font-semibold" : "font-medium")}>
            {name}
          </span>
          {unread && (
            <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-[hsl(var(--primary))] px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
              title={`${thread.unread_count} unread`}>
              {thread.unread_count > 9 ? "9+" : thread.unread_count}
            </span>
          )}
          {needsAttention && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--warning)/0.55)] bg-[hsl(var(--warning)/0.12)] px-1.5 py-0.5 text-[9px] font-semibold text-foreground"
              title="Unread, draft ready, or overdue for a reply"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--warning))] motion-reduce:animate-none" aria-hidden />
              Attention
            </span>
          )}
          {ts && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatDistanceToNow(new Date(ts), { addSuffix: false })}
            </span>
          )}
        </div>

        {subtitle && !compact && (
          // Comfortable only — compact density (#121) exists to fit MORE threads; an always-on
          // third line would quietly defeat it. The business/role context still lives on the
          // contact card + open-thread header, so nothing is lost in compact (§25 density intent).
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
        )}

        <div className={cn("flex items-center gap-2", compact ? "mt-0" : "mt-0.5")}>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {preview?.direction === "outbound" && preview.status !== "draft"
              ? <span className="text-muted-foreground/60">You: </span> : ""}
            {preview ? (bodyPreview(preview) || preview.subject || "—") : "—"}
          </span>
          {hasDraft && <StatePill state="building">Draft ready</StatePill>}
        </div>

        {/* state + labels + hover actions */}
        <div className={cn("flex items-center gap-1.5", compact ? "mt-0.5" : "mt-1")}>
          {/* R-B1: a queued scheduled send is visible in the rail (find-and-cancel surface). */}
          {scheduled && preview?.scheduled_for && (
            <StatePill state="pending" icon={<Clock className="h-2.5 w-2.5" />}>
              Scheduled · {formatDistanceToNow(new Date(preview.scheduled_for))}
            </StatePill>
          )}
          {snoozed && (
            <StatePill state="pending" icon={<Clock className="h-2.5 w-2.5" />}>
              {isUntilReply(thread.snoozed_until) ? "Until reply" : `Snoozed · ${formatDistanceToNow(new Date(thread.snoozed_until!))}`}
            </StatePill>
          )}
          {archived && <StatePill state="off" icon={<Archive className="h-2.5 w-2.5" />}>Archived</StatePill>}
          {labels.slice(0, 2).map((l) => (
            <span key={l.id} className={cn("rounded-full border px-1.5 py-0 text-[10px] font-medium", LABEL_COLOR[l.color])}>
              {l.name}
            </span>
          ))}
          {labels.length > 2 && <span className="text-[10px] text-muted-foreground">+{labels.length - 2}</span>}

          <span className="ml-auto flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <LabelPopover
              thread={thread} catalog={catalog}
              onSetThreadLabels={onSetThreadLabels} onRenameCatalogLabel={onRenameCatalogLabel}
            />
            <SnoozeMenu thread={thread} onSnooze={onSnooze} onArchive={onArchive} />
          </span>
        </div>
      </div>
    </div>
  );
}
