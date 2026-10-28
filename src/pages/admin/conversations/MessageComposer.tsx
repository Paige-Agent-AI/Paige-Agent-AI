// MessageComposer — the ONE scope-agnostic composer chrome for every conversation surface
// (§18 one home). The textarea + Send affordance shared by the tenant Client Hub inbox and
// the operator Fleet Communications inbox, so the send experience reads as one continuous
// system (§6) and gold is spent in exactly one place across both surfaces.
//
// It owns only the composer CHROME — the value is controlled by the parent (each container
// keeps its own draft state + send handler via its data-source adapter). ⌘/Ctrl+↵ remains the
// shared default; a scope may explicitly opt into plain Enter while Shift+Enter keeps a newline.
//
// The tenant inbox wraps a dense affordance cluster around this same textarea + Send: a
// sending-identity Select, a subject input, attachment chips (ABOVE the textarea), and an
// attach/dictate/Draft-with-Paige/templates/signature/schedule action row (LEFT of Send).
// Those inject through OPTIONAL `header`/`toolbar` slots + optional textarea event handlers,
// WITHOUT this atom knowing anything tenant-specific. The operator call site passes none of
// them and renders identically.
//
// §11: gold ONLY on the Send act (the one earned gold moment); token-only; motion-safe
// (the spinner respects the OS via the Loader2 animate-spin, which CSS-freezes under
// prefers-reduced-motion at the framework level).
import { useRef, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { Clock, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface MessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  sending?: boolean;
  disabled?: boolean;
  /** Disable only the send act while leaving the textarea editable for correction. */
  sendDisabled?: boolean;
  /** Opt-in reply behavior: plain Enter sends; Shift+Enter remains a newline. */
  sendOnEnter?: boolean;
  placeholder?: string;
  /** Compliance/help note under the composer (e.g. the A2P "Reply STOP" line). */
  note?: ReactNode;
  /** Send button label; defaults to "Send". */
  sendLabel?: string;
  rows?: number;
  /** Optional slot ABOVE the textarea (tenant: identity Select + subject input + attachment chips). */
  header?: ReactNode;
  /** Optional slot in the action row, LEFT of the gold Send (tenant: attach/dictate/draft/templates/etc.). */
  toolbar?: ReactNode;
  /** Optional drop-zone / paste-to-attach handlers forwarded onto the textarea (tenant: useCommsAttachments). */
  onDrop?: (e: DragEvent<HTMLTextAreaElement>) => void;
  onDragOver?: (e: DragEvent<HTMLTextAreaElement>) => void;
  /** Clears the drag-over ring when the cursor leaves the textarea without dropping. */
  onDragLeave?: (e: DragEvent<HTMLTextAreaElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Optional extra classes on the textarea (tenant: drop-zone ring styling). */
  textareaClassName?: string;
  /**
   * Optional slot that stands IN PLACE of the toolbar (tenant email reply: the inline check strip).
   * While it is present the gold Send is not rendered — the strip carries the one gold act (§11) — and
   * the send shortcut does nothing, so a keystroke can never confirm what the strip is showing.
   */
  actions?: ReactNode;
  /**
   * The send is being checked: Send reads `sendLabel` (the caller passes "Checking…"), is aria-busy and
   * aria-disabled, and ignores clicks and the shortcut — but stays focusable, so focus is not lost.
   */
  checking?: boolean;
}

export function MessageComposer({
  value, onChange, onSend, sending = false, disabled = false,
  sendDisabled = false, sendOnEnter = false,
  placeholder = "Write a message…", note, sendLabel = "Send", rows = 2,
  header, toolbar, onDrop, onDragOver, onDragLeave, onPaste, textareaClassName, actions, checking = false,
}: MessageComposerProps) {
  const reduce = useReducedMotion();
  const submitLockRef = useRef(false);
  const held = checking || !!actions;
  const submit = () => {
    if (held) return;
    if (sending || disabled || sendDisabled || submitLockRef.current) return;
    submitLockRef.current = true;
    try {
      const result = onSend();
      const release = () => { submitLockRef.current = false; };
      void Promise.resolve(result).then(release, release);
    } catch (error) {
      submitLockRef.current = false;
      throw error;
    }
  };

  return (
    <div className="border-t border-border p-3">
      {header && (
        <div
          className="mb-2 max-h-36 overflow-y-auto overscroll-contain pr-1"
          data-composer-header="true"
        >
          {header}
        </div>
      )}
      <div className="relative" data-composer-writing-surface="true">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={cn("h-24 min-h-24 max-h-24 resize-none overflow-y-auto pb-12 pr-44", textareaClassName)}
          disabled={disabled}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onPaste={onPaste}
          aria-keyshortcuts={sendOnEnter ? "Enter" : "Control+Enter Meta+Enter"}
          onKeyDown={(e) => {
            const plainEnter = !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey;
            const establishedShortcut = !e.shiftKey && (e.metaKey || e.ctrlKey);
            if (e.key === "Enter" && !e.nativeEvent.isComposing && ((sendOnEnter && plainEnter) || establishedShortcut)) {
              // A check is open or running: the send keys are inert (never a confirm, never a newline).
              e.preventDefault();
              submit();
            }
          }}
        />
        {/* Send is the ONE earned gold act on this surface (§11). While `actions` stands in for the
            toolbar, it carries that act and this button is not rendered. */}
        {!actions && (
          <Button
            variant="gold"
            onClick={submit}
            disabled={sending || disabled || sendDisabled}
            aria-busy={checking || undefined}
            aria-disabled={checking || undefined}
            data-composer-send=""
            className="absolute bottom-2 right-5 h-10 shrink-0"
          >
            {checking
              ? (reduce ? <Clock className="mr-1.5 h-4 w-4" aria-hidden /> : <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />)
              : sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {sendLabel}
          </Button>
        )}
      </div>
      {actions
        ? <div className="mt-2">{actions}</div>
        : toolbar && <div className="mt-2 flex flex-wrap items-center gap-2">{toolbar}</div>}
      {note && <p className="mt-1.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}
