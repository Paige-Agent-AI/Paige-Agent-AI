// A Paige form page in a sandbox that hides its origin: framed in a site builder's "custom HTML" block without
// allow-same-origin, or a tab opened from one (a tab opened from a sandbox inherits it unless the block allows popups
// to escape). The app can't run there: the browser refuses it storage, and the public intake refuses answers from an
// address-less origin. So instead of a blank page, or a form that fails only after the visitor has typed everything,
// the visitor gets the form's own address: a link that works where the block lets tabs escape, and the address itself
// to copy into a new browser tab where it doesn't. Rendered by src/main.tsx with no providers, because every provider
// reads storage.
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formPageHref } from "@/hooks/useEmbedHeight";

export function SandboxedFormNotice() {
  const address = formPageHref(window.location.href);
  const framed = window.parent !== window;
  const [copied, setCopied] = useState<"idle" | "copied" | "select">("idle");
  const addressRef = useRef<HTMLParagraphElement | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied("copied");
    } catch {
      // A sandbox usually refuses the clipboard too: select the address so the visitor can copy it by hand.
      const el = addressRef.current;
      const sel = window.getSelection();
      if (el && sel) { const range = document.createRange(); range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range); }
      setCopied("select");
    }
  };
  return (
    <div className={framed ? "p-1" : "min-h-dvh bg-background flex items-center justify-center px-4"}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card text-card-foreground p-5 sm:p-7 shadow-sm text-center" role="status">
        <h1 className="font-display text-lg font-semibold text-foreground">This form opens on its own page</h1>
        <p className="mt-1 text-sm text-muted-foreground">It can't be sent from here. Open it, or copy its address into a new browser tab.</p>
        <p ref={addressRef} className="mt-3 select-all break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground">{address}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {framed && <Button asChild><a href={address} target="_blank" rel="noopener">Open the form</a></Button>}
          <Button type="button" variant="outline" onClick={() => void copy()}>{copied === "copied" ? "Copied" : "Copy address"}</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
          {copied === "copied" ? "Paste it into a new browser tab." : copied === "select" ? "The address is selected: copy it with your keyboard." : ""}
        </p>
      </div>
    </div>
  );
}
