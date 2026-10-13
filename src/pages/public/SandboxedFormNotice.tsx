// A Paige form placed on a business's website inside a sandbox that hides its origin (a site builder's "custom HTML"
// block without allow-same-origin). The app can't run there: the browser refuses it storage, and the public intake
// refuses answers from an address-less origin. So instead of a blank frame, or a form that fails only after the
// visitor has typed everything, the visitor gets the form's own page. Rendered by src/main.tsx with no providers,
// because every provider reads storage.
import { Button } from "@/components/ui/button";

/** The form's own page: this address and its campaign tags, without the embedded presentation. */
export function formPageHref(href: string): string {
  const page = new URL(href);
  page.searchParams.delete("embed");
  page.searchParams.delete("theme");
  return page.href;
}

export function SandboxedFormNotice() {
  return (
    <div className="p-1">
      <div className="rounded-xl border border-border bg-card text-card-foreground p-5 sm:p-7 shadow-sm text-center" role="status">
        <h1 className="font-display text-lg font-semibold text-foreground">This form opens on its own page</h1>
        <p className="mt-1 text-sm text-muted-foreground">It can't be sent from inside this part of the site.</p>
        <Button asChild className="mt-4"><a href={formPageHref(window.location.href)} target="_blank" rel="noopener">Open the form</a></Button>
      </div>
    </div>
  );
}
