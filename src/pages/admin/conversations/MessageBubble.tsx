// MessageBubble — the ONE scope-agnostic message bubble for every conversation surface
// (§18 one home). Both the tenant Client Hub inbox and the operator Fleet Communications
// inbox render individual messages through THIS component, so the two surfaces read as one
// continuous system (§6) and never drift into divergent hand-rolled bubbles.
//
// It is deliberately DATA-SOURCE-AGNOSTIC: it takes normalized presentational props, never a
// tenant `MessageRow` or an operator `OperatorMessage` row. Each container maps its own row
// shape onto these props via its data-source adapter — so the same bubble serves SMS, email,
// WhatsApp, IG DM, and voice notes as inline messages in one thread (§49), tenant or operator.
//
// The tenant inbox is a richer surface (email subject lines, attachment chips, foldable long
// email bodies, a scheduled-cancel footer), so those affordances are exposed here as OPTIONAL
// presentational props — the operator call site passes none of them and renders identically.
// The gold Paige-draft CARD is deliberately NOT a variant here: a draft is an ACT (gold is
// earned), so it stays a tenant-side wrapper — this bubble remains gold-free.
//
// §11: token-only, AA both themes, motion-safe, gold NEVER spent here (a bubble is not an act).
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

/**
 * A voice-call summary rendered INLINE in the same thread as SMS/email (§49) — a `channel_type`
 * ='voice' message row. Each part is shown ONLY when its field is present (§13): a call with no
 * recording shows no player; a call still ringing (null duration) shows no duration; an
 * un-transcribed call shows no transcript toggle. The atom stays GOLD-FREE (a bubble is not an
 * act — the CALL BUTTON in the header is the act, §11).
 */
export interface CallSummary {
  direction: "inbound" | "outbound";
  /** Completed-call duration in seconds; null while in-progress/failed/ringing → no duration shown. */
  durationSec?: number | null;
  /** Recording URL; null → no player rendered (never a fabricated link, §13). */
  recordingUrl?: string | null;
  /** At-rest plain-text transcript; null → no transcript toggle. */
  transcript?: string | null;
}

/** Seconds → m:ss (or h:mm:ss) — tabular, never a fabricated value; caller passes null to hide. */
function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

export interface MessageBubbleProps {
  direction: "inbound" | "outbound";
  body: string;
  /** ISO timestamp for the relative "· 3m ago" stamp; null hides it. */
  timestamp?: string | null;
  /** Who sent it — "You" for outbound, the contact's name/handle for inbound. */
  senderLabel: string;
  /** Optional delivery pill (outbound only, e.g. <StatePill>Sent</StatePill>); pass null for inbound. */
  status?: ReactNode;
  /** Failure reason shown under the body when a send failed (§13 — surface the real error). */
  error?: string | null;
  /** Optional leading glyph (e.g. a channel icon) so SMS/email/DM read distinctly in one thread (§49). */
  channelIcon?: ReactNode;
  /**
   * Optional small chip in the sender/meta line, after the sender (e.g. the tenant's "Help request"
   * marker on a portal help request). The caller owns its content; it must stay gold-free (§11).
   */
  badge?: ReactNode;
  /** Optional subject line rendered above the body (email). */
  subject?: string;
  /** Optional slot under the body for attachment chips (the tenant's <Paperclip> list). */
  attachments?: ReactNode;
  /**
   * When true, a long body (email) is clamped with a gradient scrim and a
   * "Show full email"/"Show less" toggle. The expand state is owned INSIDE the atom
   * (self-contained) — the container just declares the body is foldable.
   */
  foldable?: boolean;
  /** Initial expanded state when foldable; defaults to collapsed. */
  defaultExpanded?: boolean;
  /** Optional slot under the body/error for extra controls (e.g. "Scheduled for … · Cancel"). */
  footer?: ReactNode;
  /**
   * When set, the bubble renders in CALL mode (§49): the call summary replaces the text body,
   * showing direction + duration + recording + transcript, each only when present (§13). The
   * outer bubble chrome (alignment, sender label, timestamp, status) is unchanged. Gold-free.
   */
  call?: CallSummary | null;
}

export function MessageBubble({
  direction, body, timestamp, senderLabel, status, error, channelIcon, badge,
  subject, attachments, foldable = false, defaultExpanded = false, footer, call,
}: MessageBubbleProps) {
  const outbound = direction === "outbound";
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptId = useId();
  const collapsed = foldable && !expanded;
  // Stable id so the fold toggle's aria-controls points at the body region it expands/collapses
  // (a11y — restores the association the tenant's hand-rolled bubble had before convergence).
  const bodyId = useId();
  // The scrim fades to the bubble's OWN background token so the clamp reads cleanly in
  // both directions and both themes (§11 token-only): inbound = muted, outbound = the indigo tint.
  const scrimFrom = outbound ? "from-primary/[0.06]" : "from-muted";

  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-xl border p-3 shadow-card",
          // Inbound bubbles get a distinct muted fill so received messages lift off the pane;
          // outbound keeps the indigo tint. Gold is never used on a bubble (§11).
          outbound
            ? "rounded-br-md border-primary/25 bg-primary/[0.06]"
            : "rounded-bl-md border-border bg-muted",
        )}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {channelIcon}
            {senderLabel}
            {timestamp && (
              <span className="opacity-60">
                {" · "}
                {formatDistanceToNow(new Date(timestamp), { addSuffix: true })}
              </span>
            )}
          </span>
          {badge}
          {status && <span className="ml-auto">{status}</span>}
        </div>
        {call ? (
          // ── CALL mode (§49) — direction · duration · recording · transcript, each only when
          //    present (§13). Gold-free (§11 — the header Call BUTTON owns the gold act). ──
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-muted text-muted-foreground"
                aria-hidden
              >
                {call.direction === "inbound" ? (
                  <PhoneIncoming className="h-3.5 w-3.5" />
                ) : (
                  <PhoneOutgoing className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="font-medium">
                {call.direction === "inbound" ? "Incoming call" : "Outgoing call"}
              </span>
              {typeof call.durationSec === "number" && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  · {formatCallDuration(call.durationSec)}
                </span>
              )}
            </div>

            {call.recordingUrl && (
              <audio
                controls
                preload="none"
                src={call.recordingUrl}
                className="h-9 w-full max-w-[16rem]"
                aria-label="Call recording"
              >
                {/* Honest fallback for browsers that can't play the source (§13). */}
                <a href={call.recordingUrl} target="_blank" rel="noreferrer">
                  Open recording
                </a>
              </audio>
            )}

            {call.transcript && (
              <div>
                <button
                  type="button"
                  aria-expanded={transcriptOpen}
                  aria-controls={transcriptId}
                  onClick={() => setTranscriptOpen((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                >
                  <Phone className="h-3 w-3" aria-hidden />
                  {transcriptOpen ? "Hide transcript" : "Show transcript"}
                </button>
                {transcriptOpen && (
                  <p
                    id={transcriptId}
                    className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted/40 p-2 text-sm leading-relaxed text-foreground/90"
                  >
                    {call.transcript}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {subject && <p className="mb-0.5 text-sm font-medium text-foreground">{subject}</p>}
            <div className="relative">
              <p
                id={foldable ? bodyId : undefined}
                className={cn(
                  "whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90",
                  collapsed && "max-h-40 overflow-hidden pb-4",
                )}
              >
                {body || "—"}
              </p>
              {collapsed && (
                <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t to-transparent", scrimFrom)} />
              )}
            </div>
            {foldable && (
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={bodyId}
                onClick={() => setExpanded((value) => !value)}
                className="mt-2 min-h-11 w-full rounded-md border border-border/70 bg-muted/40 px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              >
                {expanded ? "Show less" : "Show full email"}
              </button>
            )}
            {attachments && <div className="mt-2">{attachments}</div>}
          </>
        )}
        {footer && <div className="mt-1.5">{footer}</div>}
        {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  );
}
