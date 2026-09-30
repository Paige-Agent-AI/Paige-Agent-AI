import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, CheckCircle2, ChevronRight, Mail, MessageSquare,
  CalendarCheck, FileSignature, Landmark, TrendingUp, StickyNote,
  CreditCard, Sparkles, Activity, Send,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { CLIENT_CONTACT_METHODS_EMBED, withPrimaryAddresses, type WithClientContactMethods } from "@/lib/contact-methods";

// Widened to string: the generated types do not know the contact-methods embed yet.
const JOURNEY_CLIENT_SELECT: string = `id, first_name, last_name, linked_user_id, journey_stage_id, journey_stage_slug, journey_stage_entered_at, created_at, ${CLIENT_CONTACT_METHODS_EMBED}`;

// Shape returned by get_tenant_journey_stages(): the tenant-authored journey when
// one is installed, else the platform default. Slug is the source of truth; there
// is no plain integer `id` (a tenant-only stage has no global int — stage_id_global
// is null for those). Position is display_order, not a row id.
type Stage = {
  slug: string;
  label: string;
  description: string | null;
  display_order: number;
  color_hex: string | null;
  is_tenant: boolean;
  stage_id_global: number | null;
};

type Transition = {
  id: string;
  contact_id: string;
  from_stage_id: number | null;
  to_stage_id: number | null;
  from_stage_slug: string | null;
  to_stage_slug: string | null;
  transitioned_at: string;
  source_event: string | null;
  metadata: Record<string, unknown> | null;
};

type Client = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  linked_user_id: string | null;
  journey_stage_id: number | null;
  journey_stage_slug: string | null;
  journey_stage_entered_at: string | null;
  created_at: string;
};

type Event = {
  ts: string;
  kind: string;
  icon: React.ReactNode;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
};

// Heterogeneous, loosely-typed rows from several ad-hoc timeline reads (messages,
// bookings, snapshots, the remote bridge). Each field is guarded at its use site
// below, so one permissive alias keeps the dynamic shape without scattering `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TimelineRow = Record<string, any>;

// Humanize a raw stage slug (e.g. "business_coaching_active_engagement" → "Business
// Coaching Active Engagement") for the honest fallback when a client's slug isn't in
// the tenant's current journey set.
const prettyStageLabel = (slug: string) =>
  slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const ICON: Record<string, React.ReactNode> = {
  stage: <Sparkles className="h-4 w-4" />,
  tier: <TrendingUp className="h-4 w-4" />,
  message: <Mail className="h-4 w-4" />,
  conversation: <MessageSquare className="h-4 w-4" />,
  booking: <CalendarCheck className="h-4 w-4" />,
  signature: <FileSignature className="h-4 w-4" />,
  credit: <CreditCard className="h-4 w-4" />,
  banking: <Landmark className="h-4 w-4" />,
  note: <StickyNote className="h-4 w-4" />,
  default: <Activity className="h-4 w-4" />,
};

export default function ClientJourney() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmStage, setConfirmStage] = useState<Stage | null>(null);

  useEffect(() => { if (id) load(id); }, [id]);

  async function load(contactId: string) {
    setLoading(true);
    try {
      const [stagesRes, contactRes] = await Promise.all([
        // §18 one read seam — the tenant's authored journey (Blueprint) or the
        // platform default; tenant is resolved server-side (§9), no body param.
        // `as never`: RPC lands in generated types after the migration applies (types
        // regen is task #234); it's real on prod once this slice's migration ships.
        supabase.rpc("get_tenant_journey_stages" as never),
        supabase.from("clients").select(JOURNEY_CLIENT_SELECT).eq("id", contactId).maybeSingle(),
      ]);
      if (stagesRes.error) throw stagesRes.error;
      if (contactRes.error) throw contactRes.error;
      if (!contactRes.data) { toast.error("Contact not found"); navigate("/choose-account"); return; }
      const stageList = ((stagesRes.data || []) as Stage[])
        .slice()
        .sort((a, b) => a.display_order - b.display_order);
      setStages(stageList);
      // `email` is the contact's PRIMARY address, from its contact methods. Everything below reads
      // this derived row; the raw row carries no email.
      const contact = withPrimaryAddresses(contactRes.data as unknown as Omit<Client, "email"> & WithClientContactMethods);
      setClient(contact);

      const trRes = await supabase
        .from("paige_journey_stage_transitions")
        .select("*")
        .eq("contact_id", contactId)
        .order("transitioned_at", { ascending: false });
      // `as unknown`: from_/to_stage_slug columns land in generated types after
      // this slice's migration applies (types regen is task #234).
      const tr = (trRes.data || []) as unknown as Transition[];
      setTransitions(tr);

      const composed = await composeTimeline(contact, tr, stageList);
      setEvents(composed);
    } catch (e: unknown) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Failed to load journey");
    } finally {
      setLoading(false);
    }
  }

  async function composeTimeline(c: Client, tr: Transition[], stageList: Stage[]): Promise<Event[]> {
    const out: Event[] = [];
    const labelForSlug = (slug: string | null) =>
      (slug ? stageList.find(s => s.slug === slug)?.label : null) ?? slug ?? null;

    for (const t of tr) {
      const toLabel = labelForSlug(t.to_stage_slug);
      out.push({
        ts: t.transitioned_at,
        kind: "stage",
        icon: ICON.stage,
        title: toLabel ? `Moved to ${toLabel}` : "Stage transition",
        detail: t.source_event ?? "manual",
        meta: t.metadata ?? undefined,
      });
    }

    if (c.linked_user_id) {
      const safe = async <T,>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> => {
        try { const r = await p; return (r.data ?? []) as T[]; } catch { return []; }
      };

      const msgs = await safe<TimelineRow>(
        supabase.from("paige_messages_audit").select("created_at, channel, subject, body, status, contact_id").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(50)
      );
      const conv = await safe<TimelineRow>(
        supabase.from("communication_log").select("created_at, channel, message_type, subject, preview").eq("user_id", c.linked_user_id).order("created_at", { ascending: false }).limit(50)
      );
      const book = await safe<TimelineRow>(
        supabase.from("paige_bookings").select("created_at, status, scheduled_at, event_type, title").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(20)
      );
      const sig = await safe<TimelineRow>(
        supabase.from("paige_signature_envelopes").select("created_at, status, envelope_type").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(20)
      );
      const bc = await safe<TimelineRow>(
        supabase.from("paige_business_credit_profiles").select("last_pulled_at, business_name, scores").eq("contact_id", c.id).order("last_pulled_at", { ascending: false }).limit(10)
      );
      const oc = await safe<TimelineRow>(
        supabase.from("paige_owner_credit_snapshots").select("pulled_at, bureau, score").eq("contact_id", c.id).order("pulled_at", { ascending: false }).limit(10)
      );
      const cf = await safe<TimelineRow>(
        supabase.from("paige_cash_flow_snapshots").select("period_end, runway_days, funding_readiness_score").eq("contact_id", c.id).order("period_end", { ascending: false }).limit(10)
      );
      const notes = await safe<TimelineRow>(
        supabase.from("client_memory").select("created_at, memory_type, content").eq("client_user_id", c.linked_user_id).eq("is_active", true).order("created_at", { ascending: false }).limit(30)
      );

      for (const m of msgs) out.push({
        ts: m.created_at, kind: "message", icon: ICON.message,
        title: `${m.channel ?? "message"}${m.subject ? ` — ${m.subject}` : ""}`,
        detail: typeof m.body === "string" ? m.body.slice(0, 200) : undefined,
      });
      for (const m of conv) out.push({
        ts: m.created_at, kind: "conversation", icon: ICON.conversation,
        title: `Conversation (${m.channel ?? "?"}${m.message_type ? ` · ${m.message_type}` : ""})`,
        detail: m.subject ?? m.preview ?? undefined,
      });
      for (const b of book) out.push({
        ts: b.created_at, kind: "booking", icon: ICON.booking,
        title: `Booking ${b.status ?? ""}${b.event_type ? ` — ${b.event_type}` : ""}`,
        detail: b.scheduled_at ? `Scheduled ${new Date(b.scheduled_at).toLocaleString()}` : undefined,
      });
      for (const s of sig) out.push({
        ts: s.created_at, kind: "signature", icon: ICON.signature,
        title: `Signature ${s.status ?? ""}${s.envelope_type ? ` — ${s.envelope_type}` : ""}`,
      });
      for (const x of bc) if (x.last_pulled_at) {
        const scores = (x.scores ?? {}) as Record<string, unknown>;
        const paydex = scores.paydex ?? scores.dnb_paydex ?? "—";
        const intelli = scores.intelliscore ?? scores.experian_intelliscore ?? "—";
        out.push({
          ts: x.last_pulled_at, kind: "credit", icon: ICON.credit,
          title: `Business credit refreshed${x.business_name ? ` — ${x.business_name}` : ""}`,
          detail: `Paydex ${paydex} · Intelliscore ${intelli}`,
        });
      }
      for (const x of oc) if (x.pulled_at) out.push({
        ts: x.pulled_at, kind: "credit", icon: ICON.credit,
        title: `Owner credit (${x.bureau ?? "?"}) ${x.score ?? "—"}`,
      });
      for (const x of cf) if (x.period_end) out.push({
        ts: x.period_end, kind: "banking", icon: ICON.banking,
        title: "Cash-flow snapshot",
        detail: `Runway ${x.runway_days ?? "—"}d · readiness ${x.funding_readiness_score ?? "—"}/100`,
      });
      for (const n of notes) out.push({
        ts: n.created_at, kind: "note", icon: ICON.note,
        title: `Note (${n.memory_type ?? "general"})`,
        detail: typeof n.content === "string" ? n.content.slice(0, 220) : undefined,
      });
    }

    // Try Paige Agent AI bridge (stub-safe)
    try {
      const { data } = await supabase.functions.invoke("tenant-journey", {
        body: { verb: "get_journey", payload: { contact_id: c.id, email: c.email } },
      });
      const remote = (data as { data?: { events?: TimelineRow[] } } | null)?.data?.events ?? [];
      for (const r of remote) {
        if (!r?.ts) continue;
        out.push({
          ts: r.ts,
          kind: r.kind ?? "default",
          icon: ICON[r.kind as keyof typeof ICON] ?? ICON.default,
          title: r.title ?? "Event",
          detail: r.detail,
          meta: r.meta,
        });
      }
    } catch { /* stub-safe */ }

    out.sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
    return out;
  }

  const currentStage = useMemo(() => {
    const found = stages.find(s => s.slug === client?.journey_stage_slug);
    if (found) return found;
    // The tenant's journey (get_tenant_journey_stages) is a WHOLESALE replacement — once
    // they install a Blueprint it returns only their authored stages. A client captured
    // earlier can still sit on a slug that isn't in the current set (e.g. a global default).
    // Show that real stage honestly instead of "Unassigned"; display_order -1 keeps it out
    // of the pipeline's current/past highlighting (it isn't one of these stages).
    const slug = client?.journey_stage_slug;
    if (!slug) return null;
    return {
      slug, label: prettyStageLabel(slug), description: null,
      display_order: -1, color_hex: null, is_tenant: false, stage_id_global: null,
    } as Stage;
  }, [stages, client?.journey_stage_slug]);

  const eventsByStage = useMemo(() => {
    // group events by the stage (slug) that was active when they happened
    const sortedTr = [...transitions].sort((a, b) => +new Date(a.transitioned_at) - +new Date(b.transitioned_at));
    const fallback = client?.journey_stage_slug ?? stages[0]?.slug ?? "";
    const groups: Record<string, Event[]> = {};
    for (const e of events) {
      const t = +new Date(e.ts);
      // Find the latest transition <= event time; else the current/first stage.
      let active = sortedTr[0]?.to_stage_slug ?? fallback;
      for (const tr of sortedTr) {
        if (+new Date(tr.transitioned_at) <= t && tr.to_stage_slug) active = tr.to_stage_slug;
      }
      (groups[active] ||= []).push(e);
    }
    return groups;
  }, [events, transitions, client?.journey_stage_slug, stages]);

  // Events bucketed under a slug that isn't in the current journey set (e.g. a transition
  // to a global/legacy stage before a Blueprint install) would otherwise never render —
  // the timeline iterates only over `stages`. Collect them into a catch-all group so no
  // event silently disappears (§13).
  const orphanEvents = useMemo(() => {
    const known = new Set(stages.map(s => s.slug));
    return Object.entries(eventsByStage)
      .filter(([slug]) => !known.has(slug))
      .flatMap(([, list]) => list)
      .sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
  }, [eventsByStage, stages]);

  // One ordered list of timeline groups: the journey stages (newest-first) plus the
  // orphan catch-all last, each rendered through the same markup.
  const timelineGroups = useMemo(() => {
    const groups = [...stages]
      .reverse()
      .map(s => ({ key: s.slug, label: s.label, color: s.color_hex, list: eventsByStage[s.slug] ?? [] }));
    if (orphanEvents.length) {
      groups.push({ key: "__earlier__", label: "Earlier stages", color: null, list: orphanEvents });
    }
    return groups.filter(g => g.list.length > 0);
  }, [stages, eventsByStage, orphanEvents]);

  async function setStage(stage: Stage) {
    if (!client) return;
    const { data, error } = await supabase.rpc("set_journey_stage", {
      _contact_id: client.id,
      _stage_slug: stage.slug,
      _source_event: "admin_manual",
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Moved to ${stage.label}`);
    setConfirmStage(null);
    load(client.id);
  }

  if (loading || !client) {
    return <div className="p-6 text-sm text-muted-foreground">Loading journey…</div>;
  }

  const fullName = `${client.first_name ?? ""} ${client.last_name ?? ""}`.trim() || client.email || "Contact";

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate("/choose-account")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to contact
        </Button>
        {stages.length > 0 && (
          <Badge variant="outline" className="text-xs">{stages.length}-stage journey</Badge>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{fullName}</h1>
        <p className="text-sm text-muted-foreground">Member journey timeline</p>
      </div>

      {/* Current stage */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-white"
              style={{ backgroundColor: currentStage?.color_hex ?? "#64748b" }}
            >
              {currentStage?.label ?? "Unassigned"}
            </span>
            <span className="text-sm text-muted-foreground">
              {client.journey_stage_entered_at
                ? `Entered ${formatDistanceToNow(new Date(client.journey_stage_entered_at), { addSuffix: true })}`
                : "Stage entry time unknown"}
            </span>
          </div>
          {currentStage?.slug === "ultimate_offer" && (
            <p className="max-w-md text-xs text-muted-foreground">
              MMA acts as a partner/facilitator on this engagement — never an equity holder.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Pipeline chevrons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Journey pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {stages.map((s, idx) => {
              const isCurrent = s.slug === client.journey_stage_slug;
              // Ranked by display_order (the journey's real ordering), not a row id.
              const isPast = (currentStage?.display_order ?? -1) > s.display_order;
              return (
                <button
                  key={s.slug}
                  onClick={() => setConfirmStage(s)}
                  className={`group flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                    isCurrent ? "ring-2 ring-offset-2" : "hover:bg-muted/50"
                  } ${isPast ? "opacity-90" : !isCurrent ? "opacity-60" : ""}`}
                  style={isCurrent ? { borderColor: s.color_hex ?? undefined } : {}}
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: s.color_hex ?? "#64748b" }}
                  >
                    {isPast ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                  </span>
                  <span className="font-medium">{s.label}</span>
                  {idx < stages.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Click any stage to manually move this contact. Stage transitions are logged.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Chronological timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {events.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No events yet. Stage data and rich events are loading from Paige Agent AI as the bridge comes online.
              </p>
            )}
            {timelineGroups.map(group => {
              return (
                <div key={group.key}>
                  <div
                    className="mb-3 inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold text-white"
                    style={{ backgroundColor: group.color ?? "#64748b" }}
                  >
                    {group.label}
                  </div>
                  <ul className="space-y-2">
                    {group.list.map((e, i) => (
                      <li key={i} className="flex gap-3 rounded-md border bg-card p-3">
                        <div className="mt-0.5 text-muted-foreground">{e.icon}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium">{e.title}</p>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(e.ts), { addSuffix: true })}
                            </span>
                          </div>
                          {e.detail && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-3">{e.detail}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <Separator className="mt-4" />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start" onClick={() => navigate("/choose-account")}>
              <Send className="mr-2 h-4 w-4" /> Enroll in campaign
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => toast.info("Compose coming in Wave 3")}>
              <Mail className="mr-2 h-4 w-4" /> Send one-off message
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => navigate("/choose-account")}>
              <MessageSquare className="mr-2 h-4 w-4" /> Open conversation
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => toast.info("Cal.com scheduler coming")}>
              <CalendarCheck className="mr-2 h-4 w-4" /> Schedule call
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => toast.info("Milestone capture coming")}>
              <Sparkles className="mr-2 h-4 w-4" /> Add milestone
            </Button>
            <Separator />
            <p className="text-xs text-muted-foreground">
              Paige Agent AI bridge v15 will populate cross-system events automatically once <code>get_journey</code> ships.
            </p>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!confirmStage} onOpenChange={(o) => !o && setConfirmStage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to "{confirmStage?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmStage?.description ?? "This will log a journey-stage transition."}
              {confirmStage?.slug === "ultimate_offer" && (
                <span className="mt-2 block text-xs">
                  Reminder: MMA acts as facilitator at this stage and never holds equity in the client's deals.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmStage && setStage(confirmStage)}>
              Confirm transition
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
