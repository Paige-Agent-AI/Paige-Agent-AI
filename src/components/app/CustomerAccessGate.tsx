import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientPortalFrameProvider, useClientPortalFrame, type WithheldCustomerAccess } from "@/hooks/useClientPortalFrame";
import { customerAccessCopy } from "@/lib/client-portal-access";
import { customerSignOutTarget, performSignOut } from "@/lib/auth/signOut";
import {clientPortalEntry, rememberClientPortalBusiness, CLIENT_PORTAL_CHOOSE_HREF} from "@/lib/client-portal-entry";
import {CustomerBusinessChoice, CustomerPortalSignOut} from "./CustomerBusinessChoice";

/**
 * E09 Slice 7 — the /app shell's door for a customer whose business paused or ended their access.
 *
 * The shell children (menu, Paige, the page) are NOT rendered for those two phases, so neither the
 * platform Support desk nor the platform Playbook persona can load or flash (owner decision
 * 2026-10-17: a customer is helped by their business, never by the platform desk). Until the first
 * answer, the shell holds; after it, a re-check (focus, auth refresh) keeps the current view.
 * Explicit customer intent cannot fall through to staff. Same-scope rechecks conceal/inert the
 * retained shell so local unfinished work survives while its current access is unverified.
 */
export function CustomerAccessGate({ userId, enabled, children, search = window.location.search }: { userId: string | null; enabled: boolean; children: ReactNode; search?: string }) {
  const entry = useMemo(() => clientPortalEntry(userId, search), [userId, search]);
  const customer = useClientPortalFrame(userId, enabled && !entry.choose && !entry.invalid, entry.intentional, entry.businessId);
  useEffect(() => {
    if (enabled && userId && customer.phase === "ready" && customer.frame?.actorId === userId) {
      rememberClientPortalBusiness(userId, customer.frame.profile.tenant_id);
    }
  }, [enabled, userId, customer.phase, customer.frame]);
  if (!enabled) return <>{children}</>;
  if (userId && (entry.choose || customer.phase === "choose-business")) return <CustomerBusinessChoice key={userId} actor={userId}/>;
  if (entry.invalid || (entry.intentional && !customer.frame && (customer.phase === "error" || customer.phase === "unavailable" || customer.phase === "not-client"))) {
    return <main className="min-h-dvh bg-background text-foreground grid place-items-center px-5 py-12"><section className="w-full max-w-md" aria-labelledby="portal-entry-error">
      <h1 id="portal-entry-error" className="text-2xl font-semibold tracking-tight">This portal couldn’t be opened.</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">Choose a business to check your current portal access.</p>
      <Button asChild className="mt-6 min-h-11"><a href={CLIENT_PORTAL_CHOOSE_HREF}>Choose business</a></Button>
      {!entry.invalid && <Button variant="outline" className="ml-3 mt-6 min-h-11" onClick={() => void customer.reload()}>Try again</Button>}
      <div className="mt-6"><CustomerPortalSignOut/></div>
    </section></main>;
  }
  if (customer.phase === "loading") {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center" role="status" aria-label="Opening your portal">
        <span className="h-1 w-24 rounded-full bg-muted animate-pulse motion-reduce:animate-none" aria-hidden="true" />
      </div>
    );
  }
  if ((customer.phase === "paused" || customer.phase === "ended") && customer.access) {
    return <CustomerAccessState state={customer.phase} access={customer.access} />;
  }
  // The shell's home and chat read this same answer instead of asking again (one reader per page).
  const hold = !!customer.frame && (customer.checking || customer.phase === "error");
  return userId ? <ClientPortalFrameProvider value={{ actorId: userId, value: customer }}>
    {hold && <main className="min-h-dvh bg-background text-foreground grid place-items-center px-5 py-12"><section className="max-w-md">
      <p role={customer.checking ? "status" : "alert"} className="text-lg font-medium">{customer.checking ? "Checking your portal access…" : "Your portal access couldn’t be checked."}</p>
      {!customer.checking && <><p className="mt-3 text-muted-foreground">Your unfinished work is kept here while you try again.</p><Button className="mt-5 min-h-11" onClick={() => void customer.reload()}>Try again</Button><a href={CLIENT_PORTAL_CHOOSE_HREF} className="ml-3 inline-flex min-h-11 items-center rounded-md px-3 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Choose business</a></>}
    </section></main>}
    <div hidden={hold} {...(hold ? {inert: ""} : {})}>{children}</div>
  </ClientPortalFrameProvider> : <>{children}</>;
}

/** A calm, full-height page under the business's own name. One action: Sign out. */
export function CustomerAccessState({ state, access }: { state: "paused" | "ended"; access: WithheldCustomerAccess }) {
  const [signingOut, setSigningOut] = useState(false);
  const [stillSignedIn, setStillSignedIn] = useState(false);
  const copy = customerAccessCopy(state, access.businessName);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setStillSignedIn(false);
    let left = false;
    try {
      // Customers land on their business's gateway; without one cached, the site root.
      const target = await customerSignOutTarget("/");
      // false: nothing was signed out (an open act-as was refused or could not be checked, or a sign-out was
      // already running). The page's only control must then work again, never sit disabled on "Signing out…".
      left = (await performSignOut(target)) !== false;
    } catch {
      left = false;
    }
    if (!left) { setSigningOut(false); setStillSignedIn(true); }
  };
  return (
    <main className="customer-access-state min-h-dvh bg-background text-foreground flex items-center justify-center px-4 py-12" data-access-state={state}>
      <section aria-labelledby="customer-access-title" className="w-full max-w-[36rem] flex flex-col items-center text-center gap-7">
        {access.logoUrl ? (
          <>
            {/* The business's own dark-surface mark when it has one, so the logo reads in both themes. */}
            <img src={access.logoUrl} alt={access.businessName} className={`h-14 w-auto max-w-[12rem] object-contain${access.logoDarkUrl ? " dark:hidden" : ""}`} />
            {access.logoDarkUrl && <img src={access.logoDarkUrl} alt={access.businessName} className="hidden h-14 w-auto max-w-[12rem] object-contain dark:block" />}
          </>
        ) : (
          <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card text-xl font-semibold text-foreground shadow-sm">
            {access.businessName.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="flex flex-col gap-3">
          <h1 id="customer-access-title" className="text-[1.75rem] sm:text-[2rem] font-semibold leading-[1.15] tracking-[-0.02em] text-balance">{copy.title}</h1>
          <p className="mx-auto max-w-[34rem] text-[16px] sm:text-[17px] leading-relaxed text-muted-foreground text-pretty">{copy.body}</p>
        </div>
        <a href={CLIENT_PORTAL_CHOOSE_HREF} className="inline-flex min-h-11 items-center rounded-md px-3 text-[15px] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Choose another business</a>
        <Button variant="outline" className="min-h-[44px] min-w-[10rem] gap-2 text-[15px]" onClick={() => void signOut()} disabled={signingOut}>
          <LogOut aria-hidden className="h-4 w-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
        {stillSignedIn && <p role="alert" className="-mt-3 text-[15px] text-foreground">You’re still signed in. Try signing out again.</p>}
      </section>
    </main>
  );
}
