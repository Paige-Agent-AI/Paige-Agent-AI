import {useEffect, useRef, useState} from "react";
import {ArrowRight, Building2, LogOut} from "lucide-react";
import {Button} from "@/components/ui/button";
import {useClientPortalRelationshipChoices} from "@/hooks/useClientPortalRelationshipChoices";
import {clientPortalBusinessHref} from "@/lib/client-portal-entry";
import {customerSignOutTarget, performSignOut} from "@/lib/auth/signOut";

export function CustomerPortalSignOut() {
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const leave = async () => {
    if (busy) return; setBusy(true); setFailed(false);
    try {if (await performSignOut(await customerSignOutTarget("/")) !== false) return;} catch {/* Retain a usable recovery. */}
    setBusy(false); setFailed(true);
  };
  return <div><Button variant="ghost" className="min-h-11 gap-2" disabled={busy} onClick={() => void leave()}><LogOut aria-hidden className="h-4 w-4"/>{busy ? "Signing out…" : "Sign out"}</Button>
    {failed && <p role="alert" className="mt-2 text-sm text-muted-foreground">You’re still signed in. Try signing out again.</p>}</div>;
}

/** Existing customer entry surface. Rows are native presentation choices, never access grants. */
export function CustomerBusinessChoice({actor}: {actor: string}) {
  const choices = useClientPortalRelationshipChoices(actor);
  const added = useRef<HTMLAnchorElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {if (choices.addedId) added.current?.focus();}, [choices.addedId]);
  return <main className="min-h-dvh bg-background text-foreground flex items-center justify-center px-5 py-12 sm:px-8">
    <section aria-labelledby="customer-business-title" className="w-full max-w-[34rem]">
      <Building2 aria-hidden className="mb-7 h-7 w-7 text-muted-foreground"/>
      <h1 ref={title} tabIndex={-1} id="customer-business-title" className="text-[2rem] sm:text-[2.5rem] font-semibold leading-[1.1] tracking-[-0.025em] text-balance">Choose your business</h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">Open the portal for the business you’re working with.</p>
      <div className="mt-8" aria-busy={choices.phase === "loading" || choices.loadingMore}>
        {choices.phase === "loading" ? <div role="status" className="py-8 text-muted-foreground">Checking your portal access…</div>
          : choices.phase === "error" ? <div role="alert" className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Your businesses couldn’t be checked.</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Try again to check your current access.</p><Button variant="outline" className="mt-4 min-h-11" onClick={() => {title.current?.focus(); void choices.reload();}}>Try again</Button></div>
          : choices.rows.length === 0 ? <div className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">No active portal access</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Open an invitation from your business, or contact them for help with access.</p></div>
          : <><ul className="space-y-3" aria-label="Your businesses">{choices.rows.map(row => <li key={row.clientId}>
            <a ref={row.clientId === choices.addedId ? added : undefined} href={clientPortalBusinessHref(row.tenantId)} className="flex min-h-[84px] w-full items-center gap-4 rounded-xl border border-border bg-card px-4 py-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none">
              {row.logoUrl ? <><img src={row.logoUrl} alt="" className={`h-10 w-10 shrink-0 object-contain${row.logoDarkUrl ? " dark:hidden" : ""}`}/>{row.logoDarkUrl && <img src={row.logoDarkUrl} alt="" className="hidden h-10 w-10 shrink-0 object-contain dark:block"/>}</>
                : <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted font-semibold">{row.businessName.charAt(0).toUpperCase()}</span>}
              <span className="min-w-0 flex-1 break-words font-medium leading-snug">{row.businessName}</span><ArrowRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground"/>
            </a></li>)}</ul>
            {choices.more && <Button variant="outline" className="mt-4 min-h-11" disabled={choices.loadingMore} onClick={() => void choices.loadMore()}>{choices.loadingMore ? "Checking more…" : "More businesses"}</Button>}</>}
      </div>
      <div className="mt-8 border-t border-border pt-4"><CustomerPortalSignOut/></div>
    </section>
  </main>;
}
