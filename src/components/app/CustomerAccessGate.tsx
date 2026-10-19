import { useState, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientPortalFrameProvider, useClientPortalFrame, type WithheldCustomerAccess } from "@/hooks/useClientPortalFrame";
import { customerAccessCopy } from "@/lib/client-portal-access";
import { customerSignOutTarget, performSignOut } from "@/lib/auth/signOut";

/**
 * E09 Slice 7 — the /app shell's door for a customer whose business paused or ended their access.
 *
 * The shell children (menu, Paige, the page) are NOT rendered for those two phases, so neither the
 * platform Support desk nor the platform Playbook persona can load or flash (owner decision
 * 2026-10-17: a customer is helped by their business, never by the platform desk). Until the first
 * answer, the shell holds; after it, a re-check (focus, auth refresh) keeps the current view.
 * Every other phase — an open customer, staff, a non-customer, a failed read — renders the shell
 * exactly as before.
 */
export function CustomerAccessGate({ userId, enabled, children }: { userId: string | null; enabled: boolean; children: ReactNode }) {
  const customer = useClientPortalFrame(userId, enabled);
  if (!enabled) return <>{children}</>;
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
  return userId ? <ClientPortalFrameProvider value={{ actorId: userId, value: customer }}>{children}</ClientPortalFrameProvider> : <>{children}</>;
}

/** A calm, full-height page under the business's own name. One action: Sign out. */
export function CustomerAccessState({ state, access }: { state: "paused" | "ended"; access: WithheldCustomerAccess }) {
  const [signingOut, setSigningOut] = useState(false);
  const copy = customerAccessCopy(state, access.businessName);
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    // Customers land on their business's gateway; without one cached, the site root.
    const target = await customerSignOutTarget("/");
    await performSignOut(target);
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
        <Button variant="outline" className="min-h-[44px] min-w-[10rem] gap-2 text-[15px]" onClick={() => void signOut()} disabled={signingOut}>
          <LogOut aria-hidden className="h-4 w-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
      </section>
    </main>
  );
}
