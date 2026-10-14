import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, RefreshCw, Sparkles } from "lucide-react";
import { StatePill, type PillState } from "@/components/ui/page/StatePill";
import { routeLinkTarget } from "@/lib/links/workspaceLinks";
import { useClientEngagementStatus } from "@/solo/engagement/useClientEngagementStatus";
import { businessCalendarHeldNote, businessDateLabel } from "@/solo/data/useBusinessTimeZone";
import { AGREEMENT_STATE, SIGNATURE_STATE } from "@/solo/sales/agreementVocabulary";
import { collectionMoney } from "@/solo/sales/collections/presentation";
import {
  ATTENTION_DESTINATION,
  ATTENTION_TEXT,
  NOT_RECORDED_TEXT,
} from "../../../supabase/functions/_shared/client-engagement/labels";
import type { ClientEngagementStatus } from "../../../supabase/functions/_shared/client-engagement/status";
import type { ReadLinkDestination } from "../../../supabase/functions/_shared/paige-turn/record-links";
import "./client-standing.css";

/**
 * Experience 04 E4-S3 PR beta (Track D) — "Where {client} stands", the first section of the Solo
 * client record. It answers one question and links to where each fact is kept:
 *
 *   agreement and signing (the Sales words, signature kept apart from the engagement) · money, with
 *   provider-verified, owner-recorded and test money never summed · payment requests in flight (never
 *   paid) · delivery work · the next steps PAIGE would name, in the SAME sentences she uses.
 *
 * It is read through the same governed read and the same composer PAIGE answers from
 * (public.read_client_engagement_status → status.ts), so the record and the chat cannot disagree.
 * The read is a pure read (20271031005000): opening a record writes nothing to the Rail.
 *
 * A total that cannot be known says why; it is never shown as $0. Without the business time zone,
 * overdue is "On hold" (cross-track contract §2.4), in the words of the one shared held-note helper, and
 * no timestamp is printed as a business date ("not shown", as PAIGE's chat does). Links come only from the
 * shared route map and its frozen labels (`routeLinkTarget`), for the Solo tree this record lives in.
 *
 * Deliberate rule: ONE link per row, to where that fact is kept (Agreement → terms & agreements, Money →
 * invoices, Delivery → delivery work), even when the row is empty — on a record, "where would this live"
 * is the useful answer. Chat links only places that hold something (`standingRecordLinks`). Recorded as a
 * deviation in journey §16.4.
 */
type Props = { contactId: string; clientName: string; account: string | null; openPaige: () => void };

/** Sales' tones, spoken in the shared pill vocabulary. No gold: nothing here is an act. */
const PILL_FOR_TONE: Record<string, PillState> = { ok: "success", warn: "warning", bad: "error", opportunity: "pending", n: "off" };
const pill = (entry: { label: string; tone: string } | undefined) => ({ state: PILL_FOR_TONE[entry?.tone ?? "n"] ?? "off", label: entry?.label ?? "Not readable" });

/** The composer says `signed`; Sales deliberately says "Completed" (one signer cannot be told apart). */
function signatureKey(state: ClientEngagementStatus["agreement"]["state"]): string {
  return state === "signed" ? "completed" : state;
}

function moneyPill(s: ClientEngagementStatus): { state: PillState; label: string } {
  const m = s.money;
  if (m.outstanding_minor === null) return { state: "off", label: "Not added up" };
  if ((m.overdue_minor ?? 0) > 0) return { state: "error", label: "Overdue" };
  if (s.as_of_date === null && m.outstanding_minor > 0) return { state: "pending", label: "On hold" };
  if ((m.awaiting_confirmation_minor ?? 0) > 0 || m.outcome_unknown_count > 0) return { state: "pending", label: "Awaiting confirmation" };
  if ((m.invoiced_minor ?? 0) > 0 && m.outstanding_minor === 0) return { state: "success", label: "Paid up" };
  if (m.outstanding_minor > 0) return { state: "warning", label: "Outstanding" };
  return { state: "off", label: "Nothing invoiced" };
}

const WORK_PILL: Record<ClientEngagementStatus["work"]["state"], { state: PillState; label: string }> = {
  none: { state: "off", label: "No delivery work" },
  complete: { state: "success", label: "Complete" },
  on_schedule: { state: "success", label: "On schedule" },
  behind: { state: "error", label: "Behind" },
  undated: { state: "pending", label: "No due dates" },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a date reads as when there is no business zone to put a timestamp on (chat.ts `at()` says the same). */
const NOT_SHOWN = "date not shown";

function dayLabel(value: string | null, zone: string | null): string | null {
  if (!value) return null;
  // A bare calendar date is already the business's own date; never shift it through a zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return businessDateLabel(value);
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return null;
  // A timestamp is only a business date in the business's zone. Without one it is not shown, never
  // printed in the viewer's own zone as if it were the business's day.
  if (!zone) return NOT_SHOWN;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone }).format(at);
}

/** When this read happened. A clock time, not a business date: always printed with its zone's name. */
function timeLabel(value: string, zone: string | null): string {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "just now";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(zone ? { timeZone: zone } : {}) }).format(at);
}

function StandingLink({ destination, account, label }: { destination: ReadLinkDestination; account: string | null; label?: string }) {
  const target = routeLinkTarget({ destination, record_id: null }, "solo", account);
  if (!target) return null;
  const text = label ?? target.label, cut = text.lastIndexOf(" ");
  // The arrow travels with the last word, so a wrapped link never strands it at the cell's far edge.
  return <Link className="trc-standing-link" to={target.to}>{cut > 0 ? `${text.slice(0, cut)} ` : ""}<span className="trc-standing-link-tail">{text.slice(cut + 1)}<ArrowRight aria-hidden /></span></Link>;
}

/** One ledger row: its name, then its state beside it, then the facts and where to act on them. */
function Row({ state, label, children, actions }: { state: { state: PillState; label: string }; label: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <li className="trc-standing-row">
      <strong className="trc-standing-label">{label}</strong>
      <div className="trc-standing-state" data-state={state.state}><StatePill state={state.state}>{state.label}</StatePill></div>
      <div className="trc-standing-body">{children}</div>
      {actions && <div className="trc-standing-actions">{actions}</div>}
    </li>
  );
}

function notKnown(s: ClientEngagementStatus): string {
  if (s.money.mixed_currency) return "More than one currency, so not added up";
  if (s.truncated.invoices || s.truncated.terms) return "More invoices than one check reads, so not added up";
  return "Not known from these records";
}

function Amount({ value, s, currency }: { value: number | null; s: ClientEngagementStatus; currency: string }) {
  if (value === null) return <>Not known<small>{notKnown(s)}</small></>;
  return <>{collectionMoney(value, currency)}</>;
}

function Standing({ s, name, account, openPaige }: { s: ClientEngagementStatus; name: string; account: string | null; openPaige: () => void }) {
  const [allSteps, setAllSteps] = useState(false);
  const zone = s.time_zone.state === "configured" ? s.time_zone.zone : null;
  const currency = s.money.currency ?? s.terms?.currency ?? "usd";
  const empty = s.agreement.state === "none" && !s.terms && s.invoices.length === 0 && s.work.total === 0;
  const notTracked = s.not_recorded.map(key => NOT_RECORDED_TEXT[key]).filter(Boolean);
  const source = (
    <p className="trc-standing-source">
      From your Sales and Operations records. Checking changes nothing.
      {notTracked.length > 0 && <> Not tracked here: {notTracked.join(", ")}.</>}
    </p>
  );

  if (empty) {
    return (
      <>
        <div className="trc-standing-empty">
          <p><strong>Nothing commercial is recorded for {name} yet.</strong></p>
          <p>Terms, signatures, invoices and delivery work appear here as they’re added in Sales and Operations.</p>
          <div className="trc-standing-actions">
            <StandingLink destination="sales_agreements" account={account} label="Set up terms" />
            <button type="button" className="trc-standing-quiet" onClick={openPaige}><Sparkles aria-hidden />Ask PAIGE about {name}</button>
          </div>
        </div>
        {source}
      </>
    );
  }

  const signature = pill(SIGNATURE_STATE[signatureKey(s.agreement.state)] ?? SIGNATURE_STATE.unrecognised);
  const terms = s.terms;
  const termsLine = terms
    ? [`Terms: ${(AGREEMENT_STATE[terms.status] ?? AGREEMENT_STATE.unrecognised).label}`,
        terms.agreed_minor !== null && terms.currency ? `${collectionMoney(terms.agreed_minor, terms.currency)} agreed` : null,
        terms.recurring ? "recurring" : terms.schedule.length ? plural(terms.schedule.length, "scheduled payment") : null,
      ].filter(Boolean).join(" · ")
    : "No terms agreed yet";
  const marks: Array<[word: string, day: string]> = [];
  for (const [word, value] of [["Sent", s.agreement.sent_at], ["Completed", s.agreement.completed_at]] as const) {
    const day = dayLabel(value, zone);
    if (day) marks.push([word, day]);
  }
  // Each "word date" pair stays on one line (a phone wraps between facts, never inside a date).
  const signedLine: ReactNode = marks.length === 0 ? null : marks.some(([, day]) => day === NOT_SHOWN)
    ? `${marks.map(([word]) => word).join(" · ")} · ${marks.length > 1 ? "dates" : "date"} not shown until the business time zone is set`
    : marks.map(([word, day], i) => <span key={word}>{i > 0 && " · "}<span className="trc-standing-nowrap">{word} {day}</span></span>);
  const held = s.as_of_date === null ? businessCalendarHeldNote(s.time_zone.state === "invalid" ? "invalid" : "missing", "record") : null;

  const m = s.money;
  const requests = [
    (m.awaiting_confirmation_minor ?? 0) > 0 ? `${collectionMoney(m.awaiting_confirmation_minor!, currency)} awaiting payment provider confirmation — not received` : null,
    m.outcome_unknown_count > 0 ? `${plural(m.outcome_unknown_count, "payment")} with an unknown outcome` : null,
    m.failed_request_count > 0 ? plural(m.failed_request_count, "failed payment request") : null,
  ].filter(Boolean);
  const test = m.received.test_environment_minor ?? 0;

  const w = s.work;
  const workLine = w.total === 0
    ? `No delivery work is linked to ${name}.`
    : [`${w.done} of ${w.total} done`, w.blocked ? `${w.blocked} blocked` : null, w.overdue ? `${w.overdue} overdue` : null].filter(Boolean).join(" · ");

  // The time-zone line lives on the Overdue figure itself, so it is not repeated as a step.
  const steps = s.attention.filter(a => a !== "business_time_zone_unset");

  return (
    <>
      <ol className="trc-standing-rows">
        <Row state={signature} label="Agreement" actions={<StandingLink destination="sales_agreements" account={account} />}>
          <span>{s.agreement.title ?? (s.agreement.state === "none" ? "No agreement document yet" : "Untitled agreement")}</span>
          {signedLine && <span className="trc-standing-quiet-line">{signedLine}</span>}
          <span className="trc-standing-quiet-line">{termsLine}</span>
        </Row>

        <Row state={moneyPill(s)} label="Money" actions={<>
          <StandingLink destination="sales_invoices" account={account} />
          {terms?.schedule.length ? <StandingLink destination="sales_collections" account={account} /> : null}
        </>}>
          <dl className="trc-standing-money">
            <div><dt>Paid · verified by your payment provider</dt><dd><Amount value={m.received.verified_minor} s={s} currency={currency} /></dd></div>
            <div><dt>Recorded by you · not provider-verified</dt><dd><Amount value={m.received.recorded_by_owner_minor} s={s} currency={currency} /></dd></div>
            <div><dt>Outstanding</dt><dd><Amount value={m.outstanding_minor} s={s} currency={currency} /></dd></div>
            <div className={held ? "trc-standing-money-wide" : undefined}><dt>Overdue</dt><dd className={held ? "trc-standing-held" : undefined}>{held
              ? <><span>{held}</span><StandingLink destination="business_time_zone" account={account} /></>
              : <Amount value={m.overdue_minor} s={s} currency={currency} />}</dd></div>
            {(m.not_yet_invoiced_minor ?? 0) > 0 && <div><dt>Agreed, not yet invoiced</dt><dd>{collectionMoney(m.not_yet_invoiced_minor!, currency)}</dd></div>}
          </dl>
          <span className="trc-standing-requests">{requests.length ? requests.join(" · ") : "No payment requests in flight."}</span>
          {test > 0 && <span className="trc-standing-test">Test payments (not real money): {collectionMoney(test, currency)} — never counted above.</span>}
        </Row>

        <Row state={WORK_PILL[w.state]} label="Delivery" actions={<StandingLink destination="operations_work" account={account} />}>
          <span>{workLine}</span>
          {w.next && <span className="trc-standing-quiet-line">Next: {w.next.title ?? "Untitled"} · {dayLabel(w.next.due_at, zone) === NOT_SHOWN ? "due date not shown until the business time zone is set" : <span className="trc-standing-nowrap">due {dayLabel(w.next.due_at, zone)}</span>}</span>}
        </Row>

        {steps.length > 0 && (
          <Row state={{ state: "warning", label: plural(steps.length, "to look at", "to look at") }} label="Next steps">
            <ul className="trc-standing-next">
              {steps.slice(0, allSteps ? steps.length : 3).map((step, i, shown) => {
                // One link per place: a second step that goes to the same place does not repeat it.
                const destination = ATTENTION_DESTINATION[step];
                const repeat = destination !== null && shown.slice(0, i).some(prior => ATTENTION_DESTINATION[prior] === destination);
                return <li key={step}><span>{ATTENTION_TEXT[step]}</span>{destination && !repeat && <StandingLink destination={destination} account={account} />}</li>;
              })}
            </ul>
            {steps.length > 3 && <button type="button" className="trc-standing-quiet" aria-expanded={allSteps} onClick={() => setAllSteps(v => !v)}>{allSteps ? "Show fewer" : `Show ${steps.length - 3} more`}</button>}
            <button type="button" className="trc-standing-quiet" onClick={openPaige}><Sparkles aria-hidden />Ask PAIGE about {name}</button>
          </Row>
        )}
      </ol>
      {source}
    </>
  );
}

export function ClientStanding({ contactId, clientName, account, openPaige }: Props) {
  const read = useClientEngagementStatus(contactId);
  const busy = read.phase === "loading" || read.phase === "idle";
  // "Check again" re-reads; the last answer for THIS client stays on screen, at full ink, until the new one
  // lands. The skeleton is only for the first read, so the record below never jumps.
  const last = useRef<{ contactId: string; status: ClientEngagementStatus } | null>(null);
  if (read.phase === "ready") last.current = { contactId, status: read.status };
  const shown = read.phase === "ready" ? read.status : busy && last.current?.contactId === contactId ? last.current.status : null;
  const refreshing = busy && shown !== null;
  const zone = shown?.time_zone.state === "configured" ? shown.time_zone.zone : null;
  return (
    <section id="client-standing" className="trc-record-section trc-standing" aria-labelledby="trc-standing-title" aria-busy={busy || undefined}>
      <div className="trc-standing-head">
        <h3 id="trc-standing-title">Where {clientName} stands</h3>
        <div className="trc-standing-meta">
          {shown && <span role="status">{refreshing ? "Checking again…" : <>Checked <span className="trc-standing-nowrap">{timeLabel(shown.read_at, zone)}</span></>}</span>}
          {read.phase !== "refused" && read.phase !== "no_workspace" && read.phase !== "error" && (
            <button type="button" className="trc-standing-quiet" onClick={() => { if (!busy) read.retry(); }} aria-disabled={busy || undefined}><RefreshCw aria-hidden />Check again</button>
          )}
        </div>
      </div>
      <div className="trc-standing-content" data-refreshing={refreshing || undefined}>
        {busy && !shown && (
          <>
            <span className="sr-only" role="status">Checking where {clientName} stands…</span>
            <ol className="trc-standing-rows" aria-busy="true" aria-hidden="true">
              {[0, 1, 2].map(i => <li key={i} className="trc-standing-row trc-standing-skeleton"><i /><b /><b /></li>)}
            </ol>
          </>
        )}
        {read.phase === "refused" && <p className="trc-standing-state-line" role="status">Only the business owner or an admin can see agreements and payments for {clientName}.</p>}
        {read.phase === "no_workspace" && <p className="trc-standing-state-line" role="status">Open a business workspace to see where this client stands.</p>}
        {read.phase === "error" && (
          <div className="trc-standing-state-line" role="alert">
            <p>We couldn’t check where {clientName} stands. Nothing here is shown as zero; it wasn’t read.</p>
            <button type="button" className="trc-standing-quiet" onClick={read.retry}><RefreshCw aria-hidden />Try again</button>
          </div>
        )}
        {shown && <Standing s={shown} name={clientName} account={account} openPaige={openPaige} />}
      </div>
    </section>
  );
}
