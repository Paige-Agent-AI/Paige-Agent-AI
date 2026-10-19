import { useEffect, useId, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CURRENT_DISCLOSURE, disclosureText } from "@/lib/client-portal-preferences";
import { useClientPortalPreferences, type PreferenceKey } from "@/hooks/useClientPortalPreferences";
import { day, on, outcomeText, preferenceCards, type PreferenceCard as Card } from "./clientPreferencesCopy";

/**
 * E09 Slice 6 — "How {Business} can reach you" and "What {Business} can use", on Your account.
 *
 * Every line here is the server's derived state (client_portal_communication_preferences): what the
 * business's sends will actually respect, who made the deciding choice and when. A
 * switch is offered only where the server says the customer may make that change; a switch that is
 * not offered always says why, next to it, and names the real route (reply START, ask the business).
 * Nothing here is an act of approval, so there is no gold (§11): switches are the indigo primary.
 *
 * Owner decisions this copy states: texts can be turned OFF here but only turned on by replying START
 * (D1); email off also unsubscribes from updates and offers and email back on does not re-subscribe (D4,
 * disclosure email-pref:v3); booking confirmations and agreements the customer is asked to sign still
 * arrive (D5, integrator default (owner may overrule), 2026-10-18); a spam report is the customer's own act, which they can undo
 * here and the business never can. Data sharing says only what the switch governs (CURA-D1, integrator
 * default, owner may overrule, 2026-10-19; round 5 corrected it in place): the action items the business's team
 * sends through the portal (admin_propose_paige_actions; staff type them in ContactPaigePanel, and the owner's
 * PAIGE chat drafts them through advance_action) and the fuller summary (load_contact_context). It does not gate
 * messages, shared work, agreements or invoices, what the customer's portal assistant uses, or what the business
 * already reads in its own records, and PAIGE is never named to a customer (owner ruling, 2026-10-19). No action
 * item gets through either route today (the chat's action kinds fail the table's action_type check; the panel is
 * unmounted), so the switch has no practical effect yet: tracked in master §5.
 * The old "It has no effect yet" (D2, M3) is gone from data-sharing:v2. The sharing section's strings use
 * curly apostrophes, matching its stored sentence.
 */

const SWITCH_TARGET = "relative after:absolute after:inset-x-0 after:-inset-y-[12px] after:content-['']";

export function ClientPreferences({ actorId, onCommitted }: { actorId: string; onCommitted?: (key: PreferenceKey) => void }) {
  const prefs = useClientPortalPreferences({ actorId, onCommitted });
  const location = useLocation();
  const section = useRef<HTMLElement | null>(null);
  const business = prefs.preferences?.business_name?.trim() || "your business";
  const ready = prefs.phase === "ready" && !!prefs.preferences;
  useEffect(() => {
    if (ready && location.hash === "#preferences") section.current?.scrollIntoView?.({ block: "start" });
  }, [ready, location.hash]);
  const busy = prefs.pending !== null;
  const savingId = useId();
  const notice = prefs.outcome ? outcomeText(prefs.outcome, business, prefs.stale) : null;
  const noticeFor = (key: PreferenceKey) => (prefs.outcome?.key === key ? notice : null);

  return (
    <>
      <section ref={section} id="preferences" aria-labelledby="client-preferences-title" aria-busy={prefs.phase === "loading" || busy} className="mt-12 max-w-2xl scroll-mt-6">
        <h2 id="client-preferences-title" className="mb-2 text-lg font-semibold tracking-tight">How {business} can reach you</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          {ready ? `These choices apply to messages ${business} sends you.` : "Your messaging choices for this business."}
        </p>
        {prefs.phase === "loading" && (
          <div role="status" aria-live="polite" className="space-y-4 py-1" data-testid="preferences-loading">
            <p className="text-sm text-muted-foreground">Loading your preferences…</p>
            {[0, 1, 2].map(i => <div key={i} aria-hidden="true" className="h-14 rounded-md bg-muted motion-safe:animate-pulse" />)}
          </div>
        )}
        {prefs.phase !== "loading" && !ready && <PhaseMessage phase={prefs.phase} onRetry={() => void prefs.reload()} />}
        {ready && prefs.stale && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <span>We couldn't refresh your preferences, so they may be out of date.</span>
            <Button variant="outline" className="min-h-[44px]" onClick={() => void prefs.reload()}>Try again</Button>
          </div>
        )}
        {ready && busy && <p id={savingId} role="status" className="mb-3 text-sm text-foreground" data-testid="pref-saving">Saving your change…</p>}
        {ready && prefs.preferences && (
          <ul className="divide-y divide-border border-y border-border">
            {preferenceCards(prefs.preferences, business).map(card => (
              <PreferenceRow key={card.key} card={card} business={business} pending={prefs.pending?.key === card.key ? prefs.pending.enabled : undefined}
                locked={busy} savingId={savingId} notice={noticeFor(card.key)}
                onChange={enabled => { if (card.key !== "sharing") void prefs.setChannel(card.key, enabled); }} />
            ))}
          </ul>
        )}
      </section>

      {ready && prefs.preferences && (
        <section aria-labelledby="client-sharing-title" className="mt-12 max-w-2xl">
          <h2 id="client-sharing-title" className="mb-5 border-b border-border pb-4 text-lg font-semibold tracking-tight">Action items and summaries from {business}’s team</h2>
          <ul className="divide-y divide-border border-b border-border">
            <PreferenceRow business={business} locked={busy} savingId={savingId} notice={noticeFor("sharing")}
              pending={prefs.pending?.key === "sharing" ? prefs.pending.enabled : undefined}
              onChange={allow => void prefs.setSharing(allow)}
              card={{
                key: "sharing",
                label: `Let ${business}’s team send you action items and use a fuller summary of you`,
                disclosure: CURRENT_DISCLOSURE.sharing,
                state: prefs.preferences.data_sharing.allowed ? `Allowed${on(day(prefs.preferences.data_sharing.updated_at))}` : "Not allowed",
                detail: "Turning it off doesn’t delete anything.",
                control: { checked: prefs.preferences.data_sharing.allowed, enabled: true, aria: `Let ${business}’s team send you action items and use a fuller summary of you` },
              }} />
          </ul>
        </section>
      )}
    </>
  );
}

function PhaseMessage({ phase, onRetry }: { phase: string; onRetry: () => void }) {
  const text = phase === "signed_out" ? "Sign in with your invited account to see your preferences."
    : phase === "unavailable" ? "Your preferences aren't available for this business."
      : phase === "multipleBusinesses" ? "Your account is linked to more than one business, so preferences can't be changed here yet."
        : "Your preferences couldn't be loaded. Check your connection and try again.";
  return (
    <div className="space-y-4 py-1">
      <p role={phase === "error" ? "alert" : "status"} className="max-w-prose text-sm">{text}</p>
      {phase === "error" && <Button variant="outline" className="min-h-[44px]" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

function PreferenceRow({ card, business, pending, locked, savingId, notice, onChange }: {
  card: Card; business: string; pending: boolean | undefined; locked: boolean; savingId: string;
  notice: { text: string; alert: boolean } | null; onChange: (enabled: boolean) => void;
}) {
  const base = useId();
  const stateId = `${base}-state`, reasonId = `${base}-reason`, detailId = `${base}-detail`;
  const control = card.control;
  const checked = pending !== undefined ? pending : !!control?.checked;
  const disabled = !control?.enabled || locked;
  const showReason = !!control && !control.enabled && !!control.reason;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-5 gap-y-2 py-4" data-testid={`pref-${card.key}`} aria-busy={pending !== undefined || undefined}>
      <div className="min-w-0 space-y-1">
        <p className="text-balance text-base font-medium [overflow-wrap:anywhere]" data-testid="pref-label">{card.label}</p>
        <p id={stateId} className="flex items-start gap-1.5 text-sm text-foreground" data-testid="pref-state">
          {card.paused && <PauseCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
          <span>{pending !== undefined ? "Saving…" : card.state}</span>
        </p>
        <p id={detailId} className="max-w-prose text-sm text-muted-foreground" data-testid="pref-disclosure" data-disclosure={card.disclosure}>{disclosureText(card.disclosure, business)}</p>
        {card.detail && <p className="max-w-prose text-sm text-muted-foreground" data-testid="pref-detail">{card.detail}</p>}
        {showReason && <p id={reasonId} className="max-w-prose text-sm text-foreground" data-testid="pref-reason">{control!.reason}</p>}
        {(card.keepOff || card.messageLink) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            {card.keepOff && (
              <Button type="button" variant="outline" className="min-h-[44px]" disabled={locked} aria-describedby={`${base}-keep`}
                onClick={() => onChange(false)}>{card.keepOff.label}</Button>
            )}
            {card.messageLink && (
              <Link to="/app/messages" className="inline-flex min-h-[44px] items-center rounded-md text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Message {business}
              </Link>
            )}
          </div>
        )}
        {card.keepOff && <p id={`${base}-keep`} className="max-w-prose text-sm text-muted-foreground">{card.keepOff.help}</p>}
        {notice && <p role={notice.alert ? "alert" : "status"} className="max-w-prose text-sm text-foreground" data-testid="pref-notice">{notice.text}</p>}
      </div>
      {control && (
        <div className="flex min-h-[44px] items-center">
          <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} className={SWITCH_TARGET}
            aria-label={control.aria} aria-describedby={[stateId, showReason ? reasonId : detailId, locked && control.enabled ? savingId : null].filter(Boolean).join(" ")} />
        </div>
      )}
    </li>
  );
}
