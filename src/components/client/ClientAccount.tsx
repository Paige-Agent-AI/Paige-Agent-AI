import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBeforeUnloadGuard } from "@/hooks/useBeforeUnloadGuard";
import { CLIENT_ACCOUNT_MAX, useClientAccount } from "./useClientAccount";
import { ClientPreferences } from "./ClientPreferences";
import { useClientAccountExit } from "./useClientAccountExit";

export function ClientAccount() {
  const account = useClientAccount();
  const waiting = account.outcome === "saving";
  const unresolved = account.outcome === "unknown" || account.outcome === "conflict";
  useBeforeUnloadGuard(account.dirty || waiting || unresolved);
  useClientAccountExit(account.dirty || waiting || unresolved, waiting);
  return (
    <section aria-labelledby="client-account-title" className="mx-auto w-full max-w-3xl text-foreground">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div><h1 id="client-account-title" className="text-2xl font-semibold tracking-tight">Your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your personal information for this business.</p></div>
        <Link to="/app/settings?tab=personal" className="inline-flex min-h-[44px] items-center rounded-md px-2 text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Settings and security</Link>
      </header>
      <h2 className="mb-6 border-b border-border pb-4 text-base font-semibold">Personal information</h2>
      {account.phase === "loading" ? (
        <div role="status" aria-live="polite" className="space-y-4 py-3"><p className="text-sm text-muted-foreground">Loading your information…</p>
          <div aria-hidden="true" className="h-11 rounded-md bg-muted" /><div aria-hidden="true" className="h-11 rounded-md bg-muted" /></div>
      ) : account.phase !== "ready" ? (
        <div className="space-y-4 py-3"><p role="alert" className="max-w-prose text-sm">{account.phase === "signed_out"
          ? "Sign in with your invited account to open your information."
          : account.phase === "unavailable" ? "Your information is unavailable for this business. Contact the business if you need access."
          : "Your information could not be loaded. Check your connection and try again."}</p>
          {account.phase !== "signed_out" && <Button className="min-h-[44px]" variant="outline" onClick={() => void account.reload()}>Try again</Button>}
        </div>
      ) : (
        <form onSubmit={event => { event.preventDefault(); void account.save(); }} className="max-w-2xl space-y-6" aria-busy={waiting}>
          <fieldset disabled={waiting} className="space-y-6">
            <legend className="sr-only">Your personal information</legend>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="client-first-name">First name</Label>
                <Input id="client-first-name" autoComplete="given-name" value={account.draft.first_name} required maxLength={200}
                  className="min-h-[44px] text-[16px] md:text-[16px]" onChange={event => account.edit("first_name", event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="client-last-name">Last name</Label>
                <Input id="client-last-name" autoComplete="family-name" value={account.draft.last_name} required maxLength={200}
                  className="min-h-[44px] text-[16px] md:text-[16px]" onChange={event => account.edit("last_name", event.target.value)} /></div>
            </div>
            <div className="space-y-2"><Label htmlFor="client-email">Email address</Label>
              <Input id="client-email" type="email" value={account.profile?.email ?? ""} readOnly aria-describedby="client-email-help" className="min-h-[44px] text-[16px] md:text-[16px]" />
              <p id="client-email-help" className="text-sm text-muted-foreground">Contact your business if this needs to change.</p></div>
            <div className="space-y-2"><Label htmlFor="client-phone">Phone number</Label>
              <Input id="client-phone" type="tel" autoComplete="tel" value={account.draft.phone} maxLength={200} aria-describedby="client-phone-help"
                className="min-h-[44px] text-[16px] md:text-[16px]" onChange={event => account.edit("phone", event.target.value)} />
              <p id="client-phone-help" className="text-sm text-muted-foreground">To stop texts, use Texts below.</p></div>
            <div className="space-y-2"><Label htmlFor="client-street">Street address</Label>
              <Input id="client-street" autoComplete="street-address" value={account.draft.street_address} maxLength={CLIENT_ACCOUNT_MAX.street_address}
                className="min-h-[44px] text-[16px] md:text-[16px]" onChange={event => account.edit("street_address", event.target.value)} /></div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-2"><Label htmlFor="client-city">City</Label>
                <Input id="client-city" autoComplete="address-level2" value={account.draft.city} maxLength={CLIENT_ACCOUNT_MAX.city}
                  className="min-h-[44px] text-[16px] md:text-[16px]" onChange={event => account.edit("city", event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="client-state">State</Label>
                <Input id="client-state" autoComplete="address-level1" value={account.draft.state} maxLength={CLIENT_ACCOUNT_MAX.state}
                  className="min-h-[44px] text-[16px] md:text-[16px]" onChange={event => account.edit("state", event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="client-zip">ZIP code</Label>
                <Input id="client-zip" autoComplete="postal-code" value={account.draft.zip_code} maxLength={CLIENT_ACCOUNT_MAX.zip_code}
                  className="min-h-[44px] text-[16px] md:text-[16px]" onChange={event => account.edit("zip_code", event.target.value)} /></div>
            </div>
          </fieldset>
          <div role={account.outcome === "invalid" ? "alert" : "status"} aria-live="polite" className="min-h-6 text-sm">{account.notice}</div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="min-h-[44px]" disabled={waiting || unresolved || !account.dirty}>{waiting ? "Saving…" : "Save information"}</Button>
            {account.outcome === "unknown" && <Button className="min-h-[44px]" type="button" variant="outline" onClick={() => void account.reload(true)}>Check saved information</Button>}
            {(unresolved || account.dirty) && !waiting && <Button className="min-h-[44px]" type="button" variant="ghost" onClick={() => void account.reload()}>Discard edits and reload</Button>}
          </div>
          {account.dirty && <p className="text-sm text-muted-foreground">Save before leaving this page.</p>}
        </form>
      )}
      {/* E09 Slice 6: messaging preferences and data sharing, read and written through their own seam.
          Shown once this account's relationship has resolved, and gone with it on sign-out. */}
      {account.profile && <ClientPreferences key={account.profile.linked_user_id} actorId={account.profile.linked_user_id} onCommitted={() => account.revalidate()} />}
    </section>
  );
}
