/**
 * Public booking page — /book/:slug
 *
 * A GHL-style two-column booking widget: a branded panel on the left (logo,
 * optional company name, category, title, duration, selected date, description)
 * and the scheduler on the right (month grid → time slots → details form).
 * Every visual choice is owner-controlled per calendar: logo, company-name
 * visibility, accent color, light/dark theme, and the meeting location (phone /
 * Google Meet / Zoom / in-person / custom / ask-the-invitee). No login, no
 * external provider required — booking creates an internal_bookings appointment.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import {
  format, startOfMonth, endOfMonth, addMonths, startOfWeek, addDays, isSameMonth, isSameDay, parseISO,
} from "date-fns";
import {
  Clock, Loader2, Check, ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, CalendarDays,
  Video, Phone, MapPin, Link2, HelpCircle, Users, Globe, Search, CalendarPlus, Download, ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isEmbedded, useEmbedHeight } from "@/hooks/useEmbedHeight";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PaigeCommandMark } from "@/components/brand/PaigeCommandMark";

type Phase = "loading" | "service" | "pick" | "form" | "done" | "error";
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type LocationOption = { type: string; value: string | null };
type IntakeQuestion = { id: string; label: string; type: string; required: boolean; options: string[]; placeholder: string | null };
// price_cents/currency are OPTIONAL (§2 — pricing is never forced): a null
// price_cents means the service is unpriced and the card shows no price.
type AppointmentType = { id: string; name: string; description: string | null; duration_min: number; price_cents?: number | null; currency?: string };
type Brand = {
  name: string; logoUrl: string | null; accent: string; title: string | null; description: string | null;
  theme: "light" | "dark"; subtitle: string | null; showCompanyName: boolean;
  locationType: string; locationValue: string | null; locationOptions: LocationOption[]; durationMin?: number;
  redirectUrl?: string | null; intakeQuestions?: IntakeQuestion[]; appointmentTypes?: AppointmentType[];
};
// Neutral placeholder shown only until the tenant's own branding loads — it must
// NOT flash the platform master brand ("Paige Agent AI") on a tenant's public
// page (§2/§6). Name is blank + hidden; the tenant's real name/accent override
// on load, and a brand-less tenant simply shows no company name (never ours).
const DEFAULT_BRAND: Brand = {
  name: "", logoUrl: null, accent: "#EBB94C", title: null, description: null,
  theme: "light", subtitle: null, showCompanyName: false, locationType: "google_meet", locationValue: null,
  locationOptions: [{ type: "google_meet", value: null }], redirectUrl: null, intakeQuestions: [], appointmentTypes: [],
};

const LOCATION_META: Record<string, { label: string; icon: typeof Video }> = {
  google_meet: { label: "Google Meet", icon: Video },
  zoom: { label: "Zoom", icon: Video },
  phone: { label: "Phone call", icon: Phone },
  in_person: { label: "In person", icon: MapPin },
  custom: { label: "Details", icon: Link2 },
  ask_invitee: { label: "Choose how to meet", icon: HelpCircle },
};

/** Readable text color over an arbitrary brand accent. */
function textOn(hex: string): string {
  const h = (hex || "").replace("#", "");
  if (h.length < 6) return "#1B1230";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1B1230" : "#FFFFFF";
}

function palette(theme: "light" | "dark") {
  return theme === "dark"
    ? { page: "#0B0912", card: "#14101F", border: "rgba(255,255,255,0.10)", panel: "rgba(255,255,255,0.03)",
        text: "#EDE8F6", sub: "#A79EC2", faint: "#5B5570", hover: "rgba(255,255,255,0.06)", field: "rgba(255,255,255,0.05)" }
    : { page: "#F4F5F7", card: "#FFFFFF", border: "#E7E8EC", panel: "#FBFBFC",
        text: "#101828", sub: "#667085", faint: "#B4B8C2", hover: "#F5F6F8", field: "#FFFFFF" };
}

// --- Timezone-aware formatting (Intl-based; no external tz lib) --------------
// Slots arrive as UTC instants; the guest re-buckets them into any IANA zone.
/** The calendar day ("YYYY-MM-DD") a UTC instant falls on, as seen in `tz`. */
function dayKeyInTz(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return format(new Date(iso), "yyyy-MM-dd");
  }
}
/** The 0–23 wall-clock hour of a UTC instant in `tz` (for AM/PM grouping). */
function hourInTz(iso: string, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit" }).formatToParts(new Date(iso));
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    return h === 24 ? 0 : h;
  } catch {
    return new Date(iso).getHours();
  }
}
/** A short time label ("2:30 PM" / "14:30") for a UTC instant in `tz`. */
function timeLabelInTz(iso: string, tz: string, hour12: boolean): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12 }).format(new Date(iso));
  } catch {
    return format(new Date(iso), hour12 ? "h:mm a" : "HH:mm");
  }
}
/** A long, human date+time label in `tz` (brand panel + confirmation). */
function longLabelInTz(iso: string, tz: string, hour12: boolean): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12, timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return format(new Date(iso), "EEE, MMM d, yyyy · h:mm a");
  }
}
/** A friendly, offset-prefixed timezone label, e.g. "(GMT-04:00) America / New York". */
function tzLabel(tz: string): string {
  let off = "";
  try {
    off = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch { /* older engine — no offset */ }
  const name = tz.replace(/_/g, " ").replace(/\//g, " / ");
  return off ? `(${off}) ${name}` : name;
}
// Curated fallback for engines without Intl.supportedValuesOf (older Safari).
const FALLBACK_TZS = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "America/Toronto", "America/Sao_Paulo", "Europe/London",
  "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Athens", "Africa/Johannesburg",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Bangkok", "Asia/Shanghai", "Asia/Tokyo",
  "Australia/Sydney", "Pacific/Auckland",
];
function allTimezones(): string[] {
  let list: string[] = FALLBACK_TZS;
  try {
    const v = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (Array.isArray(v) && v.length) list = v;
  } catch { /* keep fallback */ }
  // Guarantee the visitor's own zone is selectable even if it's not enumerated.
  return list.includes(browserTz) ? list : [browserTz, ...list];
}

// --- "Add to calendar" (built client-side from the confirmed booking) -------
function icsStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
type CalEvent = { title: string; startMs: number; endMs: number; details: string; location: string };
function googleCalUrl(e: CalEvent): string {
  const p = new URLSearchParams({
    action: "TEMPLATE", text: e.title,
    dates: `${icsStamp(e.startMs)}/${icsStamp(e.endMs)}`,
    details: e.details, location: e.location,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
function downloadIcs(e: CalEvent, uid: string) {
  const clean = (s: string) => String(s ?? "").replace(/([,;\\])/g, "\\$1").replace(/\r?\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Paige Agent AI//Booking//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${icsStamp(Date.now())}`, `DTSTART:${icsStamp(e.startMs)}`, `DTEND:${icsStamp(e.endMs)}`,
    `SUMMARY:${clean(e.title)}`, `DESCRIPTION:${clean(e.details)}`, `LOCATION:${clean(e.location)}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "invite.ics";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Currency label for a price in minor units; whole amounts drop the cents. */
function formatPrice(cents: number, currency?: string): string {
  const code = (currency || "usd").toUpperCase();
  const amount = cents / 100;
  try {
    return amount.toLocaleString(undefined, { style: "currency", currency: code, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
  } catch {
    return `$${amount.toFixed(cents % 100 === 0 ? 0 : 2)}`;
  }
}
/** Two-letter initials from a person's display name (for host avatars). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Static, theme-driven hover/focus styling (class-based so we don't mutate
// element style imperatively; colors come from CSS vars set on the card).
const BOOKING_CSS = `
.bk-svc, .bk-slot, .bk-opt, .bk-focusable { outline: none; }
.bk-motion .bk-svc, .bk-motion .bk-slot { transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease, color .15s ease; }
.bk-svc:hover, .bk-svc:focus-visible { border-color: var(--bk-accent) !important; box-shadow: 0 0 0 3px var(--bk-ring); }
.bk-slot:hover, .bk-slot:focus-visible { background: var(--bk-accent) !important; color: var(--bk-accent-text) !important; }
.bk-focusable:focus-visible { box-shadow: 0 0 0 3px var(--bk-ring); border-color: var(--bk-accent); }
`;

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [durationMin, setDurationMin] = useState(30);
  const [brand, setBrand] = useState<Brand>(DEFAULT_BRAND);
  // Class only: remaining seats per slot, so a slot reads "3 of 10 left"
  // instead of just vanishing at zero. Collective only: who the guest is
  // meeting, shown before they book — not just after, in the confirmation email.
  const [classSpots, setClassSpots] = useState<Record<string, { capacity: number; remaining: number }>>({});
  const [withHosts, setWithHosts] = useState<string | null>(null);
  const [monthCursor, setMonthCursor] = useState<Date>(startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  // Answers to the owner's custom intake questions, keyed by question id.
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [inviteeLocation, setInviteeLocation] = useState("google_meet");
  const [submitting, setSubmitting] = useState(false);
  // The chosen service (appointment type). Null until picked / when the calendar
  // offers no menu. Its id + duration drive the slot grid.
  const [selectedType, setSelectedType] = useState<AppointmentType | null>(null);
  const selectedTypeRef = useRef<AppointmentType | null>(null);
  // Furthest date we've fetched slots through, so paging the calendar forward
  // can pull more (honoring a long booking window) without refetching per view.
  const loadedToRef = useRef<number>(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // Guest-chosen display zone + clock format — slots re-bucket live, no refetch
  // (the instants are fixed; only how we group and label them changes).
  const [tz, setTz] = useState<string>(browserTz);
  const [hour12, setHour12] = useState<boolean>(true);
  // Self-serve manage link, if the create response carries one (see integrator
  // note): powers "Reschedule or cancel" on the confirmation.
  const [manageLink, setManageLink] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const tzOptions = useMemo(() => allTimezones().map((z) => ({ value: z, label: tzLabel(z) })), []);

  // --- Auto-resize when embedded (see public/embed.js) ---------------------
  // The card whose height the parent iframe should match (one home: useEmbedHeight).
  const cardRef = useRef<HTMLDivElement | null>(null);
  // Stable for the life of the page: are we rendered inside a parent frame?
  const embedded = isEmbedded();
  useEmbedHeight(cardRef, { type: "paige-booking-height", slug }, [slug, embedded]);

  // Fetch availability up to `toIso` (omitted = the calendar's default window).
  // The edge function always serves from "now" and caps at the booking horizon,
  // so a wider `to` simply returns a superset — we replace, never merge stale.
  // On the first load, if the calendar offers a service menu and none is picked
  // yet, land on the service step instead of the date picker.
  const fetchAvailability = useCallback(async (toIso?: string) => {
    const typeId = selectedTypeRef.current?.id;
    const { data, error } = await supabase.functions.invoke("public-booking", {
      body: { action: "availability", slug, ...(toIso ? { to: toIso } : {}), ...(typeId ? { appointmentTypeId: typeId } : {}) },
    });
    const res = data as (Partial<Brand> & {
      error?: string; slots?: string[]; durationMin?: number; branding?: Partial<Brand>;
      classSpots?: Record<string, { capacity: number; remaining: number }>; withHosts?: string;
    }) | null;
    if (error || res?.error) { setErrorMsg(res?.error ?? "This booking page isn't available."); setPhase("error"); return; }
    const b = { ...DEFAULT_BRAND, ...(res?.branding ?? {}) } as Brand;
    setSlots(res?.slots ?? []);
    setDurationMin(res?.durationMin ?? b.durationMin ?? 30);
    setBrand(b);
    setClassSpots(res?.classSpots ?? {});
    setWithHosts(res?.withHosts ?? null);
    loadedToRef.current = Date.parse(toIso ?? "") || (Date.now() + 92 * 86_400_000);
    setPhase((b.appointmentTypes?.length && !selectedTypeRef.current) ? "service" : "pick");
  }, [slug]);

  useEffect(() => { void fetchAvailability(); }, [fetchAvailability]);

  // Guest picks a service → remember it, reset the date selection, refetch slots
  // at that service's duration, then continue to the date/time step.
  const chooseService = (t: AppointmentType) => {
    selectedTypeRef.current = t;
    setSelectedType(t);
    setSelectedDay(null); setSelectedSlot(null);
    setPhase("loading");
    void fetchAvailability();
  };
  const backToServices = () => {
    selectedTypeRef.current = null;
    setSelectedType(null);
    setSelectedDay(null); setSelectedSlot(null);
    setPhase("service");
  };

  // Page the month forward; if we scroll past what's loaded, pull more (the edge
  // function caps at the horizon, so an empty result means we've hit the window).
  const goMonth = (delta: number) => {
    setMonthCursor((m) => {
      const next = addMonths(m, delta);
      if (delta > 0 && endOfMonth(next).getTime() > loadedToRef.current) {
        setLoadingMore(true);
        void fetchAvailability(endOfMonth(next).toISOString()).finally(() => setLoadingMore(false));
      }
      return next;
    });
  };

  const c = palette(brand.theme);
  const accentText = textOn(brand.accent);
  // Owner-offered meeting methods. One → fixed; several → the invitee chooses.
  const meetOptions = brand.locationOptions?.length ? brand.locationOptions : [{ type: brand.locationType, value: brand.locationValue }];
  const meetMulti = meetOptions.length > 1;
  const fixedMeet = meetOptions[0];
  const meetLabel = (o: LocationOption) => o.type === "custom" ? (o.value || "Details to follow")
    : o.type === "in_person" ? (o.value || "In person") : (LOCATION_META[o.type]?.label ?? o.type);

  // Owner's custom intake questions + whether every required one is answered.
  const intakeQuestions = brand.intakeQuestions ?? [];
  const setAnswer = (id: string, v: string | string[]) => setAnswers((a) => ({ ...a, [id]: v }));
  const toggleChoice = (id: string, opt: string) => setAnswers((a) => {
    const cur = Array.isArray(a[id]) ? (a[id] as string[]) : [];
    return { ...a, [id]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt] };
  });
  const requiredAnswered = intakeQuestions.every((q) => {
    if (!q.required) return true;
    const v = answers[q.id];
    return Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());
  });

  // Slot instants grouped by the day they fall on in the CHOSEN zone; the set
  // of bookable days. Re-buckets whenever the guest switches timezones.
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots) {
      const key = dayKeyInTz(s, tz);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    return m;
  }, [slots, tz]);
  const days = useMemo(() => Array.from(byDay.keys()).sort(), [byDay]);

  // The selected day's slots split into Morning (AM) / Afternoon (PM) so the
  // list reads as sections instead of one long flat scroll.
  const daySections = useMemo(() => {
    const list = selectedDay ? byDay.get(selectedDay) ?? [] : [];
    const am: string[] = [], pm: string[] = [];
    for (const s of list) (hourInTz(s, tz) < 12 ? am : pm).push(s);
    return { am, pm, total: list.length };
  }, [selectedDay, byDay, tz]);

  // Land on the first available day — and re-anchor if a timezone switch shifts
  // the selected day out of the bookable set (it could land on a now-empty day).
  useEffect(() => {
    if (days.length && (!selectedDay || !byDay.has(selectedDay))) {
      setSelectedDay(days[0]);
      setMonthCursor(startOfMonth(parseISO(days[0])));
    }
  }, [days, byDay, selectedDay]);

  const monthCells = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthCursor));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [monthCursor]);

  const book = async () => {
    if (!selectedSlot) return;
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("public-booking", {
      body: {
        action: "create", slug, start: selectedSlot,
        guest: { name: form.name, email: form.email, phone: form.phone }, notes: form.notes,
        ...(meetMulti ? { location: inviteeLocation } : {}),
        ...(selectedType ? { appointmentTypeId: selectedType.id } : {}),
        ...(intakeQuestions.length ? { answers } : {}),
      },
    });
    setSubmitting(false);
    const res = data as {
      error?: string; manageUrl?: string;
      booking?: { id: string; start_at: string; end_at: string; title: string; manageUrl?: string; manage_url?: string };
    } | null;
    if (error || res?.error) {
      setErrorMsg(res?.error ?? "Couldn't book that time.");
      if (res?.error?.includes("no longer available") || res?.error?.includes("just booked")) {
        setSelectedSlot(null);
        // Reuse the normal fetch path so the selected service (appointmentTypeId)
        // stays intact — a raw refetch here previously fell back to the first
        // service's grid while the UI still showed the chosen one's duration.
        void fetchAvailability();
      }
      return;
    }
    // Self-serve manage link, when the create response carries one (the edge
    // function currently only emails it — see the integrator note).
    setManageLink(res?.booking?.manageUrl ?? res?.booking?.manage_url ?? res?.manageUrl ?? null);
    // Owner-set redirect: send the guest to their own thank-you / community page.
    // Only http(s) — never javascript: or other schemes from tenant-authored input.
    const redirect = (brand.redirectUrl ?? "").trim();
    if (/^https?:\/\//i.test(redirect)) { window.location.assign(redirect); return; }
    setPhase("done");
  };

  // ---- Left brand panel (persists across steps) ----
  const brandPanel = (
    <div className="p-6 sm:p-7 flex flex-col" style={{ borderRight: `1px solid ${c.border}` }}>
      <div className="flex items-center gap-2.5 mb-5">
        {brand.logoUrl
          ? <img src={brand.logoUrl} alt={brand.name} className="h-11 w-11 rounded-xl object-cover" style={{ border: `1px solid ${c.border}` }} />
          : <span className="h-11 w-11 rounded-xl grid place-items-center" style={{ background: brand.accent + "1f" }}><PaigeCommandMark plated={false} className="h-6 w-6" /></span>}
        {brand.showCompanyName && <span className="font-semibold tracking-tight" style={{ color: c.text }}>{brand.name}</span>}
      </div>
      {brand.subtitle && <div className="text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color: c.sub }}>{brand.subtitle}</div>}
      <h1 className="text-2xl font-bold leading-tight mb-4" style={{ color: c.text }}>{selectedType?.name || brand.title || "Book a time"}</h1>
      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-sm" style={{ color: c.sub }}>
          <Clock className="h-4 w-4" style={{ color: brand.accent }} /> {durationMin >= 60 ? `${durationMin % 60 === 0 ? durationMin / 60 : (durationMin / 60).toFixed(1)} hr` : `${durationMin} min`}
        </div>
        {selectedType?.price_cents != null && selectedType.price_cents > 0 && (
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: c.text }}>
            <span className="h-4 w-4 grid place-items-center text-[15px] font-semibold" style={{ color: brand.accent }}>$</span>
            {formatPrice(selectedType.price_cents, selectedType.currency)}
          </div>
        )}
        {(() => { const Icon = meetMulti ? HelpCircle : (LOCATION_META[fixedMeet.type]?.icon ?? Link2); return (
          <div className="flex items-center gap-2 text-sm" style={{ color: c.sub }}>
            <Icon className="h-4 w-4" style={{ color: brand.accent }} />
            {meetMulti ? "Choose how to meet" : meetLabel(fixedMeet)}
          </div>
        ); })()}
        {withHosts && (
          <div className="flex items-start gap-2 text-sm" style={{ color: c.sub }}>
            <Users className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: brand.accent }} />
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              With <AvatarStack names={withHosts} accent={brand.accent} accentText={accentText} c={c} /> {withHosts}
            </span>
          </div>
        )}
        {selectedSlot && (
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: c.text }}>
            <CalendarDays className="h-4 w-4" style={{ color: brand.accent }} />
            {longLabelInTz(selectedSlot, tz, hour12)}
          </div>
        )}
      </div>
      {brand.description && (
        <p className="text-sm leading-relaxed whitespace-pre-line max-h-64 overflow-y-auto pr-1" style={{ color: c.sub }}>
          {brand.description}
        </p>
      )}
    </div>
  );

  // ---- Right: service menu (only when the calendar offers appointment types) ----
  const serviceStep = (
    <div className="p-6 sm:p-7">
      <h2 className="text-base font-semibold mb-4" style={{ color: c.text }}>Choose a service</h2>
      <div className="space-y-2.5">
        {(brand.appointmentTypes ?? []).map((t) => (
          <button key={t.id} onClick={() => chooseService(t)}
            className="bk-svc w-full text-left rounded-xl p-4"
            style={{ border: `1px solid ${c.border}`, background: c.panel }}>
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-sm" style={{ color: c.text }}>{t.name}</span>
              <span className="flex flex-col items-end gap-1 flex-shrink-0" style={{ color: brand.accent }}>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                  <Clock className="h-3.5 w-3.5" /> {t.duration_min >= 60 ? `${t.duration_min % 60 === 0 ? t.duration_min / 60 : (t.duration_min / 60).toFixed(1)} hr` : `${t.duration_min} min`}
                </span>
                {t.price_cents != null && t.price_cents > 0 && (
                  <span className="text-sm font-semibold">{formatPrice(t.price_cents, t.currency)}</span>
                )}
              </span>
            </div>
            {t.description && <p className="text-xs mt-1.5" style={{ color: c.sub }}>{t.description}</p>}
          </button>
        ))}
      </div>
    </div>
  );

  // ---- Right: date+time picker ----
  const picker = (
    <div className="p-6 sm:p-7">
      {selectedType && (
        <button onClick={backToServices} className="inline-flex items-center gap-1.5 text-sm mb-3" style={{ color: c.sub }}>
          <ArrowLeft className="h-4 w-4" /> Services
        </button>
      )}
      <h2 className="text-base font-semibold mb-4" style={{ color: c.text }}>Select Date &amp; Time</h2>
      {/* The month grid + prev/next nav always render so a visitor with no
          openings this month can still page forward to one — an empty window is
          not a dead-end (audit fix). */}
      <div className="grid gap-6 lg:grid-cols-[1fr_170px]">
          {/* Month grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => goMonth(-1)} className="h-8 w-8 grid place-items-center rounded-full" style={{ color: c.sub }} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-sm font-semibold inline-flex items-center gap-1.5" style={{ color: c.text }}>
                {format(monthCursor, "MMMM yyyy")}
                {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: c.sub }} />}
              </span>
              <button onClick={() => goMonth(1)} className="h-8 w-8 grid place-items-center rounded-full" style={{ color: c.sub }} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((d) => <div key={d} className="text-center text-[11px] font-medium py-1" style={{ color: c.sub }}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {monthCells.map((cell) => {
                const key = format(cell, "yyyy-MM-dd");
                const inMonth = isSameMonth(cell, monthCursor);
                const available = byDay.has(key);
                const selected = selectedDay === key;
                const today = isSameDay(cell, new Date());
                return (
                  <div key={cell.toISOString()} className="flex justify-center">
                    <button
                      disabled={!available}
                      onClick={() => setSelectedDay(key)}
                      className="relative h-9 w-9 rounded-full text-sm transition-colors grid place-items-center"
                      style={
                        selected ? { background: brand.accent, color: accentText, fontWeight: 700 }
                        : available ? { background: brand.accent + "1f", color: brand.accent, fontWeight: 600 }
                        : { color: inMonth ? c.faint : "transparent", cursor: "default" }
                      }
                    >
                      {inMonth ? cell.getDate() : ""}
                      {today && !selected && available && <span className="absolute bottom-1 h-1 w-1 rounded-full" style={{ background: brand.accent }} />}
                    </button>
                  </div>
                );
              })}
            </div>
            {days.length === 0 && (
              <p className="text-xs mt-3" style={{ color: c.sub }}>No open times this month — use the arrows to check later dates.</p>
            )}
          </div>
          {/* Time slots — grouped Morning / Afternoon */}
          <div className="max-h-[360px] overflow-y-auto pr-1 space-y-4">
            {daySections.total === 0 && <p className="text-sm" style={{ color: c.sub }}>No times.</p>}
            {([["Morning", daySections.am], ["Afternoon", daySections.pm]] as const).map(([label, list]) =>
              list.length ? (
                <div key={label} className="space-y-2">
                  <div className="sticky top-0 z-10 py-0.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: c.faint, background: c.card }}>{label}</div>
                  {list.map((t) => {
                    // Class only: seats left at this slot, so it reads "3 left"
                    // instead of the slot just vanishing once it's full.
                    const spot = classSpots[t];
                    return (
                      <button key={t}
                        onClick={() => { setSelectedSlot(t); setErrorMsg(""); setInviteeLocation(meetOptions[0].type); setPhase("form"); }}
                        className="bk-slot w-full rounded-lg py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                        style={{ border: `1px solid ${brand.accent}`, color: brand.accent, background: "transparent" }}>
                        {timeLabelInTz(t, tz, hour12)}
                        {spot && (
                          <span className="text-xs font-normal opacity-80">
                            · {spot.remaining} {spot.remaining === 1 ? "seat" : "seats"} left
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : null,
            )}
          </div>
        </div>
      {/* Time zone + clock format — re-buckets the slots above, no refetch */}
      <div className="mt-6 pt-4 space-y-2.5" style={{ borderTop: `1px solid ${c.border}` }}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium" style={{ color: c.sub }}>Time zone</span>
          <div className="inline-flex overflow-hidden rounded-lg" style={{ border: `1px solid ${c.border}` }}>
            {([["12h", true], ["24h", false]] as const).map(([label, is12]) => {
              const on = hour12 === is12;
              return (
                <button key={label} type="button" onClick={() => setHour12(is12)} aria-pressed={on}
                  className="bk-focusable px-2.5 py-1 text-xs font-medium"
                  style={on ? { background: "var(--bk-accent)", color: "var(--bk-accent-text)" } : { background: "transparent", color: c.sub }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <ThemedSelect searchable value={tz} onChange={setTz} options={tzOptions} c={c}
          ariaLabel="Time zone" icon={<Globe className="h-3.5 w-3.5 flex-shrink-0" style={{ color: c.sub }} />} />
      </div>
    </div>
  );

  // ---- Right: details form (location chosen here, after a time is picked) ----
  const detailsForm = (
    <div className="p-6 sm:p-7">
      <button onClick={() => setPhase("pick")} className="inline-flex items-center gap-1.5 text-sm mb-4" style={{ color: c.sub }}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h2 className="text-base font-semibold mb-4" style={{ color: c.text }}>Enter Details</h2>
      <div className="space-y-3">
        <Field label="Name *" c={c}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={fieldStyle(c)} /></Field>
        <Field label="Email *" c={c}><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={fieldStyle(c)} /></Field>
        <Field label={meetMulti && inviteeLocation === "phone" ? "Phone *" : "Phone"} c={c}>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={fieldStyle(c)} />
        </Field>

        {/* How to meet — the invitee chooses when the owner offers several methods */}
        {meetMulti ? (
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: c.sub }}>How would you like to meet?</Label>
            <div className="grid grid-cols-3 gap-2">
              {meetOptions.map((opt) => {
                const Icon = LOCATION_META[opt.type]?.icon ?? Link2; const on = inviteeLocation === opt.type;
                return (
                  <button key={opt.type} type="button" onClick={() => setInviteeLocation(opt.type)}
                    className="rounded-lg py-2 text-xs font-medium flex flex-col items-center gap-1 transition-colors"
                    style={on ? { border: `1.5px solid ${brand.accent}`, color: brand.accent, background: brand.accent + "14" } : { border: `1px solid ${c.border}`, color: c.sub }}>
                    <Icon className="h-4 w-4" /> {meetLabel(opt)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-lg px-3 py-2 text-sm flex items-center gap-2" style={{ background: c.panel, border: `1px solid ${c.border}`, color: c.text }}>
            {(() => { const Icon = LOCATION_META[fixedMeet.type]?.icon ?? Link2; return <Icon className="h-4 w-4" style={{ color: brand.accent }} />; })()}
            <span>
              {fixedMeet.type === "custom" ? (fixedMeet.value || "Details will be shared after booking")
                : fixedMeet.type === "in_person" ? (fixedMeet.value || "In person")
                : fixedMeet.type === "phone" ? "We'll call the number you provide"
                : `${LOCATION_META[fixedMeet.type]?.label ?? "Meeting"} — link sent after you book`}
            </span>
          </div>
        )}

        <Field label="Anything to share?" c={c}><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={fieldStyle(c)} /></Field>

        {/* Owner's custom intake questions */}
        {intakeQuestions.map((q) => {
          const val = answers[q.id];
          const label = q.label + (q.required ? " *" : "");
          if (q.type === "textarea") {
            return <Field key={q.id} label={label} c={c}><Textarea rows={2} required={q.required} aria-required={q.required} value={(val as string) ?? ""} placeholder={q.placeholder ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)} style={fieldStyle(c)} /></Field>;
          }
          if (q.type === "select") {
            return (
              <Field key={q.id} label={label} c={c}>
                <ThemedSelect value={(val as string) ?? ""} onChange={(v) => setAnswer(q.id, v)}
                  options={q.options.map((o) => ({ value: o, label: o }))}
                  placeholder="Select…" ariaLabel={q.label} ariaRequired={q.required} c={c} />
              </Field>
            );
          }
          if (q.type === "radio") {
            return (
              <div key={q.id} className="space-y-1.5" role="radiogroup" aria-required={q.required} aria-label={q.label}>
                <Label className="text-xs" style={{ color: c.sub }}>{label}</Label>
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => {
                    const on = val === o;
                    return (
                      <button key={o} type="button" role="radio" aria-checked={on} onClick={() => setAnswer(q.id, o)}
                        className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
                        style={on ? { border: `1.5px solid ${brand.accent}`, color: brand.accent, background: brand.accent + "14" } : { border: `1px solid ${c.border}`, color: c.sub }}>
                        {o}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }
          if (q.type === "checkbox") {
            const arr = Array.isArray(val) ? val : [];
            return (
              <div key={q.id} className="space-y-1.5" role="group" aria-required={q.required} aria-label={q.label}>
                <Label className="text-xs" style={{ color: c.sub }}>{label}</Label>
                <div className="flex flex-wrap gap-2">
                  {q.options.map((o) => {
                    const on = arr.includes(o);
                    return (
                      <button key={o} type="button" role="checkbox" aria-checked={on} onClick={() => toggleChoice(q.id, o)}
                        className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
                        style={on ? { border: `1.5px solid ${brand.accent}`, color: brand.accent, background: brand.accent + "14" } : { border: `1px solid ${c.border}`, color: c.sub }}>
                        {o}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          }
          const inputType = q.type === "url" ? "url" : q.type === "phone" ? "tel" : q.type === "number" ? "number" : "text";
          return <Field key={q.id} label={label} c={c}><Input type={inputType} required={q.required} aria-required={q.required} value={(val as string) ?? ""} placeholder={q.placeholder ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)} style={fieldStyle(c)} /></Field>;
        })}
      </div>
      {errorMsg && <p className="text-sm mt-3" style={{ color: "#ef4444" }} aria-live="polite">{errorMsg}</p>}
      <button onClick={book}
        disabled={submitting || !form.name.trim() || !form.email.trim() || !requiredAnswered || (meetMulti && inviteeLocation === "phone" && !form.phone.trim())}
        className="w-full mt-5 rounded-lg py-2.5 font-semibold transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-2"
        style={{ background: brand.accent, color: accentText }}>
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Confirm booking
      </button>
    </div>
  );

  // ---- Right: confirmation ----
  const confirmation = (() => {
    const startMs = selectedSlot ? Date.parse(selectedSlot) : NaN;
    const endMs = Number.isFinite(startMs) ? startMs + durationMin * 60000 : NaN;
    const evtTitle = selectedType?.name || brand.title || (brand.showCompanyName ? `${brand.name} booking` : "Your booking");
    // The meeting method the guest actually gets: their pick when several were
    // offered, otherwise the single fixed method.
    const chosenMeet = meetMulti ? (meetOptions.find((o) => o.type === inviteeLocation) ?? meetOptions[0]) : fixedMeet;
    const meetIsLink = !!chosenMeet.value && /^https?:\/\//i.test(chosenMeet.value);
    const evtLocation = chosenMeet.type === "phone"
      ? (chosenMeet.value ? `Phone: ${chosenMeet.value}` : "Phone call")
      : chosenMeet.type === "in_person" ? (chosenMeet.value || "In person")
      : chosenMeet.value || (LOCATION_META[chosenMeet.type]?.label ?? "Details to follow");
    const evt: CalEvent = { title: evtTitle, startMs, endMs, details: (brand.description || "").slice(0, 500), location: evtLocation };
    const MeetIcon = LOCATION_META[chosenMeet.type]?.icon ?? Link2;
    return (
      <div className="p-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: brand.accent + "22", color: brand.accent }}>
          <Check className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold" style={{ color: c.text }}>You're booked</h2>
        <p className="mt-2 font-medium" style={{ color: c.text }}>{selectedSlot && longLabelInTz(selectedSlot, tz, hour12)}</p>
        <p className="text-sm mt-1" style={{ color: c.sub }}>A confirmation is on its way to {form.email}.</p>

        {withHosts && (
          <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: c.sub }}>
            <AvatarStack names={withHosts} accent={brand.accent} accentText={accentText} c={c} /> With {withHosts}
          </div>
        )}

        {/* Meeting method / link */}
        <div className="mt-5 w-full max-w-xs rounded-lg px-3 py-2.5 text-sm flex items-center gap-2 text-left"
          style={{ background: c.panel, border: `1px solid ${c.border}`, color: c.text }}>
          <MeetIcon className="h-4 w-4 flex-shrink-0" style={{ color: brand.accent }} />
          {meetIsLink ? (
            <a href={chosenMeet.value!} target="_blank" rel="noopener noreferrer"
              className="bk-focusable inline-flex items-center gap-1 rounded font-medium underline decoration-1 underline-offset-2" style={{ color: brand.accent }}>
              Join {LOCATION_META[chosenMeet.type]?.label ?? "meeting"} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span>{chosenMeet.type === "google_meet" || chosenMeet.type === "zoom"
              ? `${LOCATION_META[chosenMeet.type]?.label} — link is in your email`
              : chosenMeet.type === "phone" ? (chosenMeet.value ? `Phone: ${chosenMeet.value}` : "We'll call the number you provided")
              : evtLocation}</span>
          )}
        </div>

        {/* Add to calendar — built client-side from the booking */}
        {Number.isFinite(startMs) && (
          <div className="mt-4 w-full max-w-xs">
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: c.faint }}>Add to calendar</div>
            <div className="grid grid-cols-2 gap-2">
              <a href={googleCalUrl(evt)} target="_blank" rel="noopener noreferrer"
                className="bk-focusable inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold"
                style={{ border: `1px solid ${c.border}`, color: c.text }}>
                <CalendarPlus className="h-4 w-4" style={{ color: brand.accent }} /> Google
              </a>
              <button type="button" onClick={() => downloadIcs(evt, `${slug}-${startMs}@paigeagent.ai`)}
                className="bk-focusable inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold"
                style={{ border: `1px solid ${c.border}`, color: c.text }}>
                <Download className="h-4 w-4" style={{ color: brand.accent }} /> .ics file
              </button>
            </div>
          </div>
        )}

        {manageLink && (
          <a href={manageLink} className="bk-focusable mt-5 rounded text-sm font-medium" style={{ color: brand.accent }}>
            Reschedule or cancel
          </a>
        )}
      </div>
    );
  })();

  const rightContent =
    phase === "loading" ? <div className="p-8 flex items-center gap-2" style={{ color: c.sub }}><Loader2 className="h-4 w-4 animate-spin" /> Loading availability…</div>
    : phase === "error" ? (
      <div className="p-8 text-center min-h-[280px] flex flex-col items-center justify-center">
        <CalendarDays className="h-8 w-8 mb-3" style={{ color: c.faint }} />
        <h2 className="text-lg font-semibold" style={{ color: c.text }}>Booking unavailable</h2>
        <p className="text-sm mt-1" style={{ color: c.sub }}>{errorMsg}</p>
      </div>
    )
    : phase === "done" ? confirmation
    : phase === "service" ? serviceStep
    : phase === "form" ? detailsForm
    : picker;

  // Accent-derived CSS vars drive the class-based hover/focus styling (§4) so we
  // never mutate element style imperatively; they cascade to the whole card.
  const cardVars = {
    "--bk-accent": brand.accent,
    "--bk-accent-text": accentText,
    "--bk-ring": brand.accent + "33",
  } as React.CSSProperties;
  return (
    // When embedded we drop the forced full-viewport height so the wrapper
    // collapses to its content — that measured height is what we post to the
    // parent frame, so the iframe fits with no inner scrollbar (public/embed.js).
    <div
      ref={cardRef}
      className={`flex items-center justify-center px-4 ${embedded ? "py-6" : "min-h-dvh py-10"}`}
      style={{ background: c.page }}
    >
      <style>{BOOKING_CSS}</style>
      <div className={`w-full max-w-4xl rounded-2xl overflow-hidden grid md:grid-cols-[minmax(0,320px)_1fr]${reduceMotion ? "" : " bk-motion"}`}
        style={{ ...cardVars, background: c.card, border: `1px solid ${c.border}`, boxShadow: brand.theme === "dark" ? "0 24px 60px rgba(0,0,0,0.5)" : "0 12px 40px rgba(16,24,40,0.10)" }}>
        {brandPanel}
        <div>{rightContent}</div>
      </div>
    </div>
  );
}

// --- Accessible, themed dropdown (replaces native <select>; §11 no-native) --
// A combobox/listbox with full keyboard support, optional type-ahead search,
// and downward/upward flip so it never gets clipped by the card's overflow.
type Opt = { value: string; label: string };
function ThemedSelect({ value, onChange, options, placeholder, ariaLabel, ariaRequired, c, searchable = false, icon }: {
  value: string; onChange: (v: string) => void; options: Opt[]; placeholder?: string;
  ariaLabel?: string; ariaRequired?: boolean; c: ReturnType<typeof palette>; searchable?: boolean; icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);
  const selected = options.find((o) => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Keep the active index in range as the filter narrows the list.
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, filtered.length - 1))); }, [filtered.length]);
  // Follow keyboard navigation with the scroll position.
  useEffect(() => { if (open) document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, open, uid]);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    const below = r ? window.innerHeight - r.bottom : Infinity;
    setDropUp(!!r && below < 280 && r.top > below); // flip up only when there's more room above
    setQuery("");
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
    if (searchable) setTimeout(() => searchRef.current?.focus(), 0);
  };
  const toggle = () => (open ? setOpen(false) : openMenu());
  const choose = (v: string) => { onChange(v); setOpen(false); btnRef.current?.focus(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) openMenu(); else setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (open) setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { if (open) { e.preventDefault(); const o = filtered[active]; if (o) choose(o.value); } }
    else if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); btnRef.current?.focus(); } }
    else if ((e.key === " " || e.key === "Spacebar") && !searchable) { e.preventDefault(); toggle(); }
  };

  return (
    <div ref={rootRef} className="relative">
      <button ref={btnRef} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open}
        aria-required={ariaRequired} aria-label={ariaLabel}
        aria-activedescendant={open && filtered[active] ? `${uid}-opt-${active}` : undefined}
        onClick={toggle} onKeyDown={onKeyDown}
        className="bk-focusable flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm"
        style={fieldStyle(c)}>
        <span className="flex items-center gap-2 truncate" style={{ color: selected ? c.text : c.faint }}>
          {icon}{selected ? selected.label : (placeholder ?? "Select…")}
        </span>
        <ChevronDown className="h-4 w-4 flex-shrink-0" style={{ color: c.sub, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
      </button>
      {open && (
        <div className={`absolute z-30 w-full overflow-hidden rounded-lg border ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}
          style={{ background: c.card, borderColor: c.border, boxShadow: "0 12px 30px rgba(16,24,40,0.18)" }}>
          {searchable && (
            <div className="p-2" style={{ borderBottom: `1px solid ${c.border}` }}>
              <div className="flex items-center gap-2 rounded-md border px-2" style={{ borderColor: c.border, background: c.field }}>
                <Search className="h-3.5 w-3.5 flex-shrink-0" style={{ color: c.faint }} />
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
                  placeholder="Search…" aria-label="Filter options"
                  className="h-8 w-full bg-transparent text-sm outline-none" style={{ color: c.text }} />
              </div>
            </div>
          )}
          <div role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm" style={{ color: c.sub }}>No matches</div>}
            {filtered.map((o, i) => {
              const on = o.value === value, act = i === active;
              return (
                <div key={o.value} id={`${uid}-opt-${i}`} role="option" aria-selected={on}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(o.value); }}
                  className="bk-opt flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm"
                  style={{ background: act ? c.hover : "transparent" }}>
                  <span className="truncate" style={on ? { color: "var(--bk-accent)", fontWeight: 600 } : { color: c.text }}>{o.label}</span>
                  {on && <Check className="h-4 w-4 flex-shrink-0" style={{ color: "var(--bk-accent)" }} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Overlapping initial-badges for a host roster (round-robin / collective).
function AvatarStack({ names, accent, accentText, c }: { names: string; accent: string; accentText: string; c: ReturnType<typeof palette> }) {
  const list = names.split(",").map((n) => n.trim()).filter(Boolean).slice(0, 4);
  if (!list.length) return null;
  return (
    <span className="inline-flex -space-x-1.5 align-middle">
      {list.map((n, i) => (
        <span key={n + i} title={n}
          className="inline-grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold"
          style={{ background: accent, color: accentText, border: `1.5px solid ${c.card}` }}>
          {initials(n)}
        </span>
      ))}
    </span>
  );
}

function fieldStyle(c: ReturnType<typeof palette>): React.CSSProperties {
  return { background: c.field, borderColor: c.border, color: c.text };
}
function Field({ label, c, children }: { label: string; c: ReturnType<typeof palette>; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs" style={{ color: c.sub }}>{label}</Label>
      {children}
    </div>
  );
}
