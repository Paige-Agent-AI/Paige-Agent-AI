import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";
import { useClientPortalBooking } from "@/hooks/useClientPortalBooking";
import { readCustomerBookingAvailability, readCustomerBookingCalendars,
  type CustomerBookingAvailability, type CustomerBookingCalendar, type CustomerBookingQuestion } from "@/lib/client-portal-booking";

const QUIET = "min-h-11 hover:bg-muted hover:text-foreground";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const METHOD: Record<string, string> = { zoom: "Zoom", google_meet: "Google Meet", phone: "Phone call", in_person: "In person", custom: "With your team" };
const held = new Set(["AUTH_REQUIRED", "CUSTOMER_RELATIONSHIP_UNAVAILABLE", "CUSTOMER_CONTACT_REQUIRED", "COMMS_PROVIDER_EXECUTION_DISABLED"]);
function when(iso: string, tz: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}
function Question({ question: q, value, onChange }: { question: CustomerBookingQuestion; value: string | string[]; onChange: (v: string | string[]) => void }) {
  const id = `customer-booking-question-${q.id}`;
  const label = `${q.label}${q.required ? " (required)" : ""}`;
  if (q.type === "checkbox") return <fieldset className="space-y-2"><legend className="text-sm font-medium">{label}</legend>{q.options.map(option =>
    <label key={option} className={`flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2 ${FOCUS}`}>
      <input type="checkbox" checked={Array.isArray(value) && value.includes(option)} onChange={e => {
        const prior = Array.isArray(value) ? value : []; onChange(e.target.checked ? [...prior, option] : prior.filter(v => v !== option));
      }} className="h-4 w-4 accent-primary" /><span className="min-w-0 break-words text-sm">{option}</span>
    </label>)}</fieldset>;
  if (q.type === "radio" || q.type === "select") return <div><Label htmlFor={id}>{label}</Label>
    <select id={id} required={q.required} value={typeof value === "string" ? value : ""} onChange={e => onChange(e.target.value)}
      className={`mt-2 min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base ${FOCUS}`}>
      <option value="">Choose an option</option>{q.options.map(v => <option key={v} value={v}>{v}</option>)}
    </select></div>;
  const props = { id, required: q.required, value: typeof value === "string" ? value : "", placeholder: q.placeholder ?? undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value), maxLength: 4000, className: "mt-2 min-h-11 text-base" };
  return <div><Label htmlFor={id}>{label}</Label>{q.type === "textarea" ? <Textarea {...props} />
    : <Input {...props} type={q.type === "number" ? "number" : q.type === "url" ? "url" : q.type === "phone" ? "tel" : "text"} />}</div>;
}

/** Extends the original Sessions screen. All scheduling and authority stay in
 * the existing calendar service; this surface only chooses and confirms. */
export function CustomerBooking({ onSaved, accent }: { onSaved: () => void | Promise<void>; accent?: CSSProperties }) {
  const identity = useCustomerIdentity(), booking = useClientPortalBooking();
  const [open, setOpen] = useState(false), [step, setStep] = useState<"choose" | "time" | "details">("choose");
  const [calendars, setCalendars] = useState<CustomerBookingCalendar[]>([]), [next, setNext] = useState<string | null>(null);
  const [calendar, setCalendar] = useState<CustomerBookingCalendar | null>(null), [availability, setAvailability] = useState<CustomerBookingAvailability | null>(null);
  const [service, setService] = useState<string | null>(null), [offset, setOffset] = useState(0), [picked, setPicked] = useState("");
  const [location, setLocation] = useState<string | null>(null), [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), title = useRef<HTMLHeadingElement>(null), result = useRef<HTMLDivElement>(null), errorNotice = useRef<HTMLDivElement>(null);
  const seq = useRef(0), alive = useRef(true);
  const business = identity.businessName ?? "your team", scopeKey = booking.key;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { ++seq.current; setOpen(false); setStep("choose"); setCalendar(null); setAvailability(null);
    setCalendars([]); setNext(null); setPicked(""); setNotes(""); setAnswers({}); setError(null); setLoading(false);
  }, [scopeKey]);
  useEffect(() => {
    if (!booking.enabled) { ++seq.current; setLoading(false); }
  }, [booking.enabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active === document.body || active?.closest('[role="dialog"]'))
      (error ? errorNotice.current : booking.phase === "saved" || booking.phase === "unverified" || booking.phase === "storage-unavailable" ? result.current : title.current)?.focus();
  }, [open, step, booking.phase, error]);

  async function loadCalendars(after: string | null = null) {
    const scope = booking.scope; if (!scope?.current()) return;
    const request = ++seq.current;
    setLoading(true); setError(null);
    if (after === null) { setCalendars([]); setNext(null); }
    try {
      const page = await readCustomerBookingCalendars(scope, after);
      if (!alive.current || !scope.current() || seq.current !== request) return;
      setCalendars(prior => after === null ? page.calendars : [...prior, ...page.calendars.filter(v => !prior.some(p => p.id === v.id))]); setNext(page.next);
    } catch { if (alive.current && scope.current() && seq.current === request) setError("Booking options couldn’t be checked. Try again, or message your team."); }
    finally { if (alive.current && scope.current() && seq.current === request) setLoading(false); }
  }
  async function loadTimes(chosen: CustomerBookingCalendar, serviceId: string | null, days: number) {
    const scope = booking.scope; if (!scope?.current()) return;
    const request = ++seq.current, from = new Date(Date.now() + days * 86400000), to = new Date(from.getTime() + 7 * 86400000);
    setLoading(true); setError(null); setPicked(""); setAvailability(null); setOffset(days);
    try {
      const page = await readCustomerBookingAvailability(scope, chosen, serviceId, from.toISOString(), to.toISOString());
      if (!alive.current || !scope.current() || seq.current !== request) return;
      setAvailability(page); setService(serviceId ?? page.services[0]?.id ?? null); setLocation(page.locations[0] ?? null);
    } catch { if (alive.current && scope.current() && seq.current === request) setError("Available times couldn’t be checked. Try again, or message your team."); }
    finally { if (alive.current && scope.current() && seq.current === request) setLoading(false); }
  }
  function begin() {
    setOpen(true);
    if (booking.pending || booking.busy || booking.phase === "storage-unavailable") return;
    booking.resetResult(); setStep("choose"); setCalendar(null); setNotes(""); setAnswers({}); void loadCalendars();
  }
  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!calendar || !availability || !picked || !booking.scope?.current() || booking.busy || booking.pending) return;
    if (availability.questions.some(q => q.required && (q.type === "checkbox" ? !Array.isArray(answers[q.id]) || answers[q.id].length === 0 : !String(answers[q.id] ?? "").trim()))) {
      setError("Please complete the required session questions."); return;
    }
    setError(null);
    const saved = await booking.confirm({ calendar, start: picked, appointmentTypeId: service, location, notes, answers });
    if (saved && alive.current) void onSaved();
  }
  async function checkBooking() { if (await booking.reconcile() && alive.current) void onSaved(); }
  if (!booking.enabled || !booking.ready) return null;
  const pending = !!booking.pending || booking.busy;
  const refusedHeld = booking.phase === "refused" && !!booking.code && held.has(booking.code);
  const feedback = booking.phase === "saved" || pending || booking.phase === "storage-unavailable" || refusedHeld;
  const receipt = booking.booking;
  return <>
    <Button ref={trigger} type="button" style={accent} className="min-h-11 shrink-0 dark:ring-1 dark:ring-foreground/30" onClick={begin}>
      <CalendarDays aria-hidden="true" className="mr-2 h-4 w-4" />{pending ? "Review booking request" : "Book a time"}
    </Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>button]:z-10 motion-reduce:!animate-none motion-reduce:transition-none"
        overlayClassName="motion-reduce:!animate-none motion-reduce:transition-none"
        onOpenAutoFocus={e => { e.preventDefault(); title.current?.focus(); }}
        onCloseAutoFocus={e => { e.preventDefault(); trigger.current?.focus(); }}>
        <SheetHeader className="shrink-0 border-b border-border px-5 pb-5 pt-7 text-left">
          <SheetTitle ref={title} tabIndex={-1} className={`pr-8 ${FOCUS}`}>Book a time</SheetTitle>
          <SheetDescription>With {business}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {feedback ? <div ref={result} tabIndex={-1} role="status" className={`rounded-lg p-1 ${FOCUS}`}>
            {booking.phase === "saved" && receipt ? <>
              <Check aria-hidden="true" className="mb-4 h-6 w-6" />
              <h2 className="text-xl font-semibold">{receipt.status === "scheduled" && Date.parse(receipt.end_at) > Date.now() ? "Your session is booked" : "Your booking was found"}</h2>
              <p className="mt-4 break-words font-medium">{receipt.title}</p><p className="mt-2 text-sm">{when(receipt.start_at, tz)}</p>
              <p className="mt-2 text-sm text-muted-foreground">Status: {receipt.status.replace(/_/g, " ")}. Its current details are in Sessions.</p>
              <Button style={accent} className="mt-6 min-h-11 w-full dark:ring-1 dark:ring-foreground/30" onClick={() => setOpen(false)}>Return to Sessions</Button>
            </> : booking.phase === "storage-unavailable" ? <>
              <h2 className="text-lg font-semibold">Booking isn’t available in this browser</h2>
              <p className="mt-3 text-sm text-muted-foreground">We couldn’t safely retain your booking request for recovery. Message your team to arrange a time.</p>
            </> : refusedHeld ? <>
              <h2 className="text-lg font-semibold">This booking can’t continue</h2>
              <p className="mt-3 text-sm text-muted-foreground">{booking.code === "CUSTOMER_CONTACT_REQUIRED" ? "Your customer profile needs a saved contact email before you book." : "Your sign-in, access or online booking needs to be checked. Message your team if you need help."}</p>
              {booking.code === "CUSTOMER_CONTACT_REQUIRED" && <Link to="/app/settings" className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Open your profile</Link>}
              <Button variant="outline" className={`mt-4 w-full ${QUIET}`} onClick={() => void identity.retryAccess?.()}>Check access</Button>
            </> : <>
              <h2 className="text-lg font-semibold">{booking.busy ? "Checking your booking…" : "Let’s check your booking"}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{booking.phase === "sending" ? "Your request is being checked against the business’s calendar. You can close this panel and return." : "The original request still needs verification. Check its status before booking again."}</p>
              <Button style={accent} className="mt-5 min-h-11 w-full dark:ring-1 dark:ring-foreground/30" disabled={booking.busy} onClick={() => void checkBooking()}>
                {booking.busy ? <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RotateCw aria-hidden="true" className="mr-2 h-4 w-4" />}
                {booking.busy ? "Checking…" : "Check booking"}
              </Button>
            </>}
            <Link to="/app/messages" className={`mt-5 inline-flex min-h-11 items-center text-sm underline underline-offset-4 ${FOCUS}`}>Message {business}</Link>
          </div> : <>
            {error && <div ref={errorNotice} tabIndex={-1} role="alert" className={`mb-5 rounded-lg border border-destructive/40 p-4 text-sm ${FOCUS}`}><p>{error}</p>
              {step !== "details" && <Button variant="outline" className={`mt-3 ${QUIET}`} onClick={() => step === "choose" ? void loadCalendars() : calendar && void loadTimes(calendar, service, offset)}>Try again</Button>}</div>}
            {booking.phase === "refused" && <p role="alert" className="mb-5 rounded-lg border border-border p-4 text-sm">{booking.code === "SLOT_UNAVAILABLE" ? "That time is no longer available. Choose another time." : booking.message ?? "This booking wasn’t made. Check the details and try again."}</p>}
            {step === "choose" ? <>
              <h2 className="text-lg font-semibold">What would you like to book?</h2>
              {loading ? <p role="status" className="mt-5 text-sm text-muted-foreground">Loading booking options…</p> : !error && calendars.length === 0 ?
                <p className="mt-4 text-sm text-muted-foreground">There are no online booking options here yet. Message {business} to arrange a time.</p> : null}
              <div className="mt-4 space-y-3">{calendars.map(c => <button key={c.id} type="button" disabled={loading || !!error}
                className={`w-full rounded-lg border border-border p-4 text-left hover:bg-muted disabled:opacity-50 ${FOCUS}`}
                onClick={() => { setCalendar(c); setStep("time"); setAnswers({}); void loadTimes(c, null, 0); }}>
                <span className="flex items-start justify-between gap-3"><strong className="min-w-0 break-words">{c.title}</strong><ArrowRight aria-hidden="true" className="h-5 w-5 shrink-0" /></span>
                {c.description && <span className="mt-2 block break-words text-sm text-muted-foreground">{c.description}</span>}
                <span className="mt-3 flex items-center gap-2 text-sm"><Clock aria-hidden="true" className="h-4 w-4" />{c.durationMin} minutes{c.description ? "" : " · See available times"}</span>
              </button>)}</div>
              {next && <Button variant="outline" className={`mt-4 w-full ${QUIET}`} disabled={loading} onClick={() => void loadCalendars(next)}>More booking options</Button>}
            </> : <>
              <Button type="button" variant="ghost" className={`-ml-3 mb-4 ${QUIET}`} onClick={() => { ++seq.current; setLoading(false); setError(null); setStep(step === "details" ? "time" : "choose"); booking.resetResult(); if (step === "details" && calendar) void loadTimes(calendar, service, offset); }}>
                <ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />{step === "details" ? "Choose a time" : "Session types"}
              </Button>
              <h2 className="break-words text-lg font-semibold">{availability?.services.find(s => s.id === service)?.name ?? calendar?.title}</h2>
              {step === "time" ? <>
                {availability && availability.services.length > 0 && <div className="mt-4"><Label htmlFor="customer-booking-service">Session type</Label>
                  <select id="customer-booking-service" value={service ?? ""} className={`mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ${FOCUS}`}
                    onChange={e => { setService(e.target.value); if (calendar) void loadTimes(calendar, e.target.value, offset); }}>
                    {availability.services.map(s => <option key={s.id} value={s.id}>{s.name} · {s.duration_min} minutes</option>)}
                  </select></div>}
                <p className="mt-3 text-sm text-muted-foreground">Times shown in {tz.replace(/_/g, " ")}.</p>
                {loading ? <p role="status" className="mt-5 text-sm text-muted-foreground">Checking available times…</p> : availability ? <>
                  <div className="mt-5 flex items-center justify-between gap-3"><Button variant="outline" className={QUIET} disabled={offset === 0} onClick={() => calendar && void loadTimes(calendar, service, Math.max(0, offset - 7))}>Earlier</Button>
                    <Button variant="outline" className={QUIET} disabled={offset + 7 >= availability.horizonDays} onClick={() => calendar && void loadTimes(calendar, service, offset + 7)}>Later</Button></div>
                  {availability.slots.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No available times in this period. Try later dates or message your team.</p> :
                    <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">{availability.slots.map(iso => <Button key={iso} type="button" variant="outline" className={`h-auto min-h-11 whitespace-normal py-3 text-left ${QUIET}`}
                      onClick={() => { setPicked(iso); setStep("details"); booking.resetResult(); }}>{when(iso, tz)}</Button>)}</div>}
                </> : null}
              </> : availability && calendar ? <form onSubmit={e => void confirm(e)} className="mt-3 space-y-5">
                <div><p className="text-sm">{when(picked, tz)}</p><p className="mt-1 text-sm text-muted-foreground">{availability.durationMin} minutes</p></div>
                <div className="border-y border-border py-4 text-sm"><p>For {identity.customerName ?? "your customer account"}</p>
                  <p className="mt-1 break-all text-muted-foreground">{identity.frame?.profile.email ?? "Add a contact email in your profile before booking."}</p></div>
                {availability.locations.length > 1 ? <div><Label htmlFor="customer-booking-location">How would you like to meet?</Label>
                  <select id="customer-booking-location" value={location ?? ""} onChange={e => setLocation(e.target.value)} className={`mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 text-base ${FOCUS}`}>
                    {availability.locations.map(v => <option key={v} value={v}>{METHOD[v]}</option>)}</select></div> :
                  <p className="text-sm">{METHOD[availability.locations[0]] ?? "Meeting details will appear with your session."}</p>}
                {availability.questions.map(q => <Question key={q.id} question={q} value={answers[q.id] ?? (q.type === "checkbox" ? [] : "")} onChange={v => setAnswers(prior => ({ ...prior, [q.id]: v }))} />)}
                <div><Label htmlFor="customer-booking-notes">Anything to share? (optional)</Label><Textarea id="customer-booking-notes" value={notes} maxLength={1000} onChange={e => setNotes(e.target.value)} className="mt-2 text-base" /></div>
                <Button type="submit" style={accent} disabled={booking.busy || !!booking.pending || !identity.frame?.profile.email} className="min-h-11 w-full dark:ring-1 dark:ring-foreground/30">Confirm booking</Button>
                {!identity.frame?.profile.email && <Link to="/app/settings" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Update your profile</Link>}
              </form> : null}
            </>}
            <Link to="/app/messages" className={`mt-6 inline-flex min-h-11 items-center text-sm underline underline-offset-4 ${FOCUS}`}>Message {business}</Link>
          </>}
        </div>
      </SheetContent>
    </Sheet>
  </>;
}
