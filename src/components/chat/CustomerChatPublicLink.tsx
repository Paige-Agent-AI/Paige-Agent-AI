import {useId, useLayoutEffect, useRef, useState, type ReactNode} from "react";
import {Link2, X} from "lucide-react";
import {Button} from "@/components/ui/button";
import {customerPublicLinkUrl} from "../../../supabase/functions/_shared/client-portal-public-link";

type Props = {
  value: string | null;
  locked: boolean;
  /** Increment only when the original Send refuses this local selection. */
  validationAttempt: number;
  onChange: (value: string | null) => void;
  onContinue: () => void;
  children: (parts: {action: ReactNode; field: ReactNode}) => ReactNode;
};
const invalidMessage = (value: string) => value.trim().length > 500
  ? "Use a shorter public page address (up to 500 characters)."
  : "Use a public https:// page address without ? or #. Private sharing and sign-in links aren’t supported.";

/** Local presentation only. A selected URL is neither a publicness check nor a
 * fetch, send, authority grant or saved result. The original turn owns those.
 * The parent must key/reset this draft with its original customer relationship.
 */
export function CustomerChatPublicLink(props: Props) {
  const id = useId(), input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [error, setError] = useState<{value: string; text: string} | null>(null);
  const closingFrom = useRef<HTMLElement | null>(null);
  const previousOpen = useRef(0), previousValidation = useRef(props.validationAttempt);
  const open = props.value !== null;
  const shownError = error?.value === props.value ? error.text : null;
  useLayoutEffect(() => {
    if (previousOpen.current !== openAttempt) {
      previousOpen.current = openAttempt;
      if (open && !props.locked) input.current?.focus();
    }
    if (previousValidation.current !== props.validationAttempt) {
      previousValidation.current = props.validationAttempt;
      if (open && !props.locked && props.value!.trim() && !customerPublicLinkUrl(props.value)) {
        setError({value: props.value!, text: invalidMessage(props.value!)});
        input.current?.focus();
      }
    }
    if (!open && closingFrom.current) {
      const from = closingFrom.current; closingFrom.current = null;
      if (!props.locked && (document.activeElement === document.body || document.activeElement === from)) trigger.current?.focus();
    }
  }, [openAttempt, open, props.locked, props.validationAttempt, props.value]);
  const remove = (from: HTMLElement) => {
    if (props.locked) return;
    closingFrom.current = from; setError(null); props.onChange(null);
  };
  const action = <Button ref={trigger} type="button" variant="ghost" disabled={props.locked}
    className="min-h-11 shrink-0 gap-2 px-2 text-sm" aria-expanded={open} aria-controls={open ? `${id}-field` : undefined}
    onClick={() => {
      if (props.locked) return;
      props.onChange(props.value ?? ""); setOpenAttempt(value => value + 1);
    }}><Link2 aria-hidden="true" className="h-4 w-4"/>{open ? "Edit link" : "Add link"}</Button>;
  const field = open ? <section id={`${id}-field`} aria-label="Public link for this message" className="min-w-0 space-y-1.5">
    <label htmlFor={`${id}-url`} className="block text-sm font-medium">Public link</label>
    <div className="flex min-w-0 items-start gap-2">
      <input ref={input} id={`${id}-url`} type="url" inputMode="url" autoComplete="off" spellCheck={false}
        value={props.value!} disabled={props.locked} placeholder="https://example.org/guide"
        className="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        aria-invalid={shownError ? true : undefined} aria-describedby={`${id}-help${shownError ? ` ${id}-error` : ""}`}
        onChange={event => {if (!props.locked) {setError(null); props.onChange(event.currentTarget.value);}}}
        onKeyDown={event => {
          if (props.locked || event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); remove(event.currentTarget);}
          if (event.key === "Enter") {
            event.preventDefault(); event.stopPropagation();
            if (props.value!.trim() && !customerPublicLinkUrl(props.value)) {
              setError({value: props.value!, text: invalidMessage(props.value!)}); return;
            }
            props.onContinue();
          }
        }}/>
      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={props.locked}
        aria-label="Remove public link" onClick={event => remove(event.currentTarget)}><X aria-hidden="true" className="h-4 w-4"/></Button>
    </div>
    <p id={`${id}-help`} className="text-xs text-muted-foreground">Public pages only. Sending asks Cura to read this link.</p>
    {shownError && <p id={`${id}-error`} role="alert" className="break-words text-sm text-destructive [overflow-wrap:anywhere]">{shownError}</p>}
  </section> : null;
  return props.children({action, field});
}
