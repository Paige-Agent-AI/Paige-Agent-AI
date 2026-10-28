// The inline check — what the reply composer's action row turns into when Send is pressed on an email
// (EXP03 O12 piece 3, owner-approved option B (ii), 2026-10-27). Presentational only: the hook
// (useGovernedEmailReply) owns the state, the door calls, focus and announcements.
//
// One strip, five faces: the check itself (To · From · Subject · Files · When, with gold Send now /
// Schedule send and a quiet Edit), "Sending…" while the confirm is out, the sender choice, a reason
// it can't go (words kept), and an expired check. Gold appears ONCE: the composer hides its own Send
// while this strip stands in for the action row (§11). Token-only; its one entrance — 180 ms, opacity
// and a 4 px rise on the house ease — is skipped entirely under reduced motion.
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Clock, Loader2, Send, WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DoorView, ReadyCheck, StripAction } from "./governedReply";

export type GovernedStripState =
  | { phase: "check"; check: ReadyCheck; fromName: string; sending: boolean }
  | { phase: "choose"; senders: { connectorId: string; name: string; fromAddress: string }[] }
  | { phase: "cant"; view: Extract<DoorView, { kind: "cant" }>; offline: boolean; busy: boolean }
  | { phase: "expired"; busy: boolean };

export interface GovernedReplyStripProps {
  state: GovernedStripState;
  onEdit: () => void;
  onConfirm: () => void;
  onAction: (action: StripAction) => void;
  onChooseSender: (connectorId: string) => void;
  settingsHref: string;
}

const EASE = [0.16, 1, 0.3, 1] as const;
// The strip's quiet controls hover to the muted surface and keep ink text. The shared outline/ghost variants
// now do the same (owner fix 2026-10-27); this stays explicit so the strip never depends on the variant again.
const QUIET_HOVER = "h-9 hover:bg-muted hover:text-foreground";

function StripFrame({ label, children }: { label: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const className = "flex w-full min-w-0 flex-col gap-2 rounded-[10px] border border-[color:var(--pg-line-strong,hsl(var(--border)))] bg-popover px-3 py-2.5 text-foreground shadow-[shadow:var(--pg-lift-1,var(--shadow-xs))]";
  if (reduce) return <div role="group" aria-label={label} data-governed-reply-strip="" className={className}>{children}</div>;
  return (
    <motion.div
      role="group" aria-label={label} data-governed-reply-strip="" className={className}
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function Message({ icon: Icon, head, body }: { icon: typeof AlertTriangle; head: string; body?: string }) {
  return (
    <p className="m-0 flex items-start gap-2.5 text-sm text-foreground">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
      <span><b className="font-semibold">{head}</b>{body ? <> {body}</> : null}</span>
    </p>
  );
}

function Foot({ note, children }: { note: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <p className="m-0 min-w-0 text-xs text-muted-foreground">{note}</p>
      <div className="ml-auto flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/** A quiet strip button: 36 px, outline, never gold. aria-disabled (not disabled) keeps it focusable. */
function Quiet({ onClick, children, focus, busy = false, label }: { onClick: () => void; children: ReactNode; focus?: string; busy?: boolean; label?: string }) {
  return (
    <Button
      type="button" variant="outline" size="sm" className={QUIET_HOVER}
      data-strip-focus={focus} aria-label={label}
      aria-disabled={busy || undefined}
      onClick={() => { if (!busy) onClick(); }}
    >
      {children}
    </Button>
  );
}

export function GovernedReplyStrip({ state, onEdit, onConfirm, onAction, onChooseSender, settingsHref }: GovernedReplyStripProps) {
  const reduce = useReducedMotion();

  if (state.phase === "check") {
    const { check, fromName, sending } = state;
    const scheduled = !!check.when;
    const p = check.preview;
    const act = scheduled ? "Schedule send" : "Send now";
    return (
      <StripFrame label="Check before sending">
        <dl className="m-0 flex min-w-0 flex-wrap gap-x-5 gap-y-0.5">
          <Fact term="To"><b className="font-semibold">{p.to_name || p.to_address}</b>{p.to_name ? <span className="text-[color:var(--pg-ink-2,hsl(var(--foreground)))]"> · {p.to_address}</span> : null}</Fact>
          <Fact term="From">{fromName ? <><b className="font-semibold">{fromName}</b><span className="text-[color:var(--pg-ink-2,hsl(var(--foreground)))]"> · {p.from_address}</span></> : <b className="font-semibold">{p.from_address}</b>}</Fact>
          <Fact term="Subject">{p.subject}</Fact>
          {check.files.length > 0 && (
            <Fact term="Files">
              {check.files.map((f, i) => (
                <span key={`${f.name}-${i}`}>{i > 0 ? ", " : ""}{f.name} <span className="text-[color:var(--pg-ink-2,hsl(var(--foreground)))]">· {f.size}</span></span>
              ))}
            </Fact>
          )}
          {check.when && <Fact term="When"><b className="font-semibold">{check.when}</b></Fact>}
        </dl>
        <Foot note={check.uncertain
          // Re-asked after a lost answer: the earlier try may still be going out. Never "nothing has been sent".
          ? "Couldn't confirm the last try went out. Don't send again unless you're sure it didn't."
          : `${scheduled ? `Nothing has been sent. It goes out ${check.when!.replace(/^Sends /, "")}.` : "Nothing has been sent yet."} Changing the words closes this check.`}>
          <Quiet onClick={onEdit} focus="edit" busy={sending}>Edit</Quiet>
          {/* The ONE gold act while the strip stands in for the action row (§11). */}
          <Button
            type="button" variant="gold" size="sm" className="h-9 px-4"
            data-strip-focus="confirm"
            aria-busy={sending || undefined}
            aria-disabled={sending || undefined}
            onClick={() => { if (!sending) onConfirm(); }}
          >
            {sending
              ? (reduce ? <Clock className="mr-1.5 h-4 w-4" aria-hidden /> : <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />)
              : <Send className="mr-1.5 h-4 w-4" aria-hidden />}
            {sending ? "Sending…" : act}
          </Button>
        </Foot>
      </StripFrame>
    );
  }

  if (state.phase === "choose") {
    return (
      <StripFrame label="Pick who this comes from">
        <Message icon={AlertTriangle} head="Pick who this comes from." body="Your business has more than one address that can send email. Choose one to check again." />
        <div className="flex flex-wrap gap-2">
          {state.senders.map((s, i) => (
            <button
              key={s.connectorId} type="button" data-strip-focus={i === 0 ? "first-option" : undefined}
              onClick={() => onChooseSender(s.connectorId)}
              className="flex min-w-0 max-w-full flex-col items-start rounded-lg border border-border bg-background px-3 py-1.5 text-left hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--primary)/0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            >
              <span className="text-sm font-semibold">{s.name}</span>
              <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{s.fromAddress}</span>
            </button>
          ))}
        </div>
        <Foot note="Nothing has been sent."><Quiet onClick={onEdit} focus="edit">Edit</Quiet></Foot>
      </StripFrame>
    );
  }

  if (state.phase === "expired") {
    return (
      <StripFrame label="Check expired">
        <Message icon={Clock} head="This check expired — check again." body="More than 10 minutes passed, so it has to be confirmed fresh." />
        <Foot note="Nothing has been sent.">
          <Quiet onClick={onEdit} focus="edit">Edit</Quiet>
          <Quiet onClick={() => onAction("recheck")} focus="recheck" busy={state.busy}>{state.busy ? "Checking…" : "Check again"}</Quiet>
        </Foot>
      </StripFrame>
    );
  }

  const { view, offline, busy } = state;
  return (
    <StripFrame label="Can't send">
      <Message icon={offline ? WifiOff : AlertTriangle} head={view.head} body={view.body} />
      <Foot note="Your words are kept.">
        {view.action === "settings" && (
          <Button type="button" variant="outline" size="sm" className={QUIET_HOVER} asChild>
            <Link to={settingsHref} data-strip-focus="settings">Open email settings</Link>
          </Button>
        )}
        {view.action === "retry" && <Quiet onClick={() => onAction("retry")} focus="recheck" busy={busy}>{busy ? "Checking…" : "Try again"}</Quiet>}
        {view.action === "recheck" && <Quiet onClick={() => onAction("recheck")} focus="recheck" busy={busy}>{busy ? "Checking…" : "Check again"}</Quiet>}
        {view.action === "check_status" && <Quiet onClick={() => onAction("check_status")} focus="recheck" busy={busy}>{busy ? "Checking…" : "Check status"}</Quiet>}
        <Quiet onClick={onEdit} focus="edit">Edit</Quiet>
      </Foot>
    </StripFrame>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full items-baseline gap-1.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{term}</dt>
      <dd className={cn("m-0 min-w-0 text-sm text-foreground [overflow-wrap:anywhere]")}>{children}</dd>
    </div>
  );
}
