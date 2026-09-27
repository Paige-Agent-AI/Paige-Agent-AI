import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { loadAssignableStaff } from "@/lib/team/assignableStaff";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  PageShell, PageHeader, StatRow, StatTile, SectionCard, DataTableShell,
  EmptyState, FilterChip, StatePill, type Column, type PillState,
} from "@/components/ui/page";
import {
  Search, Plus, Download, Users, Briefcase, Sparkles, Tag, Pencil, BanIcon,
  Star, Filter, Trash2, Flame, Snowflake, ThermometerSun, ThermometerSnowflake, Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  LIFECYCLE_STAGES, lifecycleMeta, contactsToCSV, downloadCSV, deleteContact,
} from "@/lib/contacts";
import { formatMoney } from "@/lib/pipelines";
import { NewContactDialog } from "@/components/admin/contacts/NewContactDialog";
import { EditContactDialog } from "@/components/admin/contacts/EditContactDialog";
import { BulkActionsBar } from "@/components/admin/contacts/BulkActionsBar";
import { formatDistanceToNow, format } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useUserRoles } from "@/hooks/useUserRoles";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useCommandCenterView } from "@/hooks/useCommandCenterView";
import {
  resolvePersona, TEAM_VIEW_ENABLED, type CommandCenterView,
} from "@/lib/roleViews/commandCenterRegistry";
import { ClientsViewToggle } from "@/components/clients/ClientsViewToggle";

type ClientRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  entity_name: string | null;
  title: string | null;
  funding_goal: number | null;
  status: string;
  lifecycle_stage: string;
  // Activity-derived heat axis (hot/warm/cool/cold), distinct from lifecycle_stage.
  // Shipped by 1c-viii-a; arrives via the existing select("*") — NO query change,
  // NO tenant_id param (§9 RLS-only). NULL until classify_client_temperature runs.
  temperature: string | null;
  source: string | null;
  tags: string[] | null;
  lead_score: number | null;
  last_contacted_at: string | null;
  do_not_contact: boolean | null;
  current_notes: string | null;
  assigned_coach_user_id: string | null;
  linked_user_id: string | null;
  created_at: string;
};

type Coach = { user_id: string; name: string };
type Rollup = {
  contact_id: string;
  open_deals: number;
  won_deals: number;
  open_value_cents: number;
  won_value_cents: number;
};

type SegmentCtx = { meId: string | null; partnerIds: Set<string> };
type Segment = {
  id: string;
  label: string;
  description: string;
  match: (c: ClientRow, ctx: SegmentCtx) => boolean;
};

const SEGMENTS: Segment[] = [
  { id: "my", label: "My coachees", description: "Assigned to me",
    match: (c, { meId }) => !!meId && c.assigned_coach_user_id === meId },
  { id: "unassigned", label: "Unassigned", description: "No coach yet",
    match: (c) => !c.assigned_coach_user_id },
  { id: "hot", label: "Hot leads", description: "Lead score ≥ 70",
    match: (c) => (c.lead_score ?? 0) >= 70 },
  { id: "stale", label: "Stale (30d+)", description: "No touch in 30+ days",
    match: (c) => {
      const t = c.last_contacted_at ? new Date(c.last_contacted_at).getTime() : 0;
      return Date.now() - t > 30 * 86_400_000;
    } },
  { id: "btf", label: "BTF Active", description: "Tagged BTF Active",
    match: (c) => (c.tags || []).includes("BTF Active") },
  { id: "dnc", label: "DNC", description: "Do Not Contact",
    match: (c) => !!c.do_not_contact },
  { id: "churned", label: "Churned", description: "Churned lifecycle",
    match: (c) => c.lifecycle_stage === "client_churned" },
];

// View presets — the second, coarser axis over the same RLS-scoped rows. Each is a
// Segment (same match shape) so it reuses the existing client-side filter plumbing;
// they map onto lifecycle_stage (verified values in LIFECYCLE_STAGES) + temperature +
// client_types, NEVER a new tenant_id param (§9). "All" is the no-preset state.
const VIEW_PRESETS: Segment[] = [
  { id: "leads", label: "Leads", description: "New, qualified, and nurturing leads",
    match: (c) => ["new_lead", "qualified", "nurturing"].includes(c.lifecycle_stage) },
  { id: "prospects", label: "Prospects", description: "Hot leads and deals in negotiation",
    match: (c) => ["hot_lead", "negotiating"].includes(c.lifecycle_stage) },
  { id: "clients", label: "Clients", description: "Won and active clients",
    match: (c) => ["won", "client_active", "client_paused", "client_funded"].includes(c.lifecycle_stage) },
  { id: "alumni", label: "Alumni", description: "Alumni and churned clients",
    match: (c) => ["client_alumni", "client_churned"].includes(c.lifecycle_stage) },
  { id: "partners", label: "Partners", description: "Partners, referral sources, and vendors",
    match: (c, ctx) => ctx.partnerIds.has(c.id) },
  { id: "call_queue", label: "Call Queue", description: "Hot/warm and contactable — call these first",
    match: (c) => ["hot", "warm"].includes(c.temperature || "") && !c.do_not_contact },
];

// Narrow, lint-clean accessor for a table not yet in the generated Supabase types.
// clients.temperature + client_types shipped in 1c-viii-a (20260722160000) but
// src/integrations/supabase/types.ts was never regenerated for them. Rather than
// regenerate (which would drag unrelated schema drift into this UI-only slice) or
// reach for `as any` (the repo lint bans no-explicit-any), we read the table through
// an `unknown` shim. The shim chains `.eq()` so this read carries the SAME explicit
// active-tenant filter as the typed reads (§9 — see load(): the clients RLS has an
// is_platform_owner() bypass, so RLS alone is NOT sufficient on a tenant surface).
type UntypedFilter = PromiseLike<{ data: unknown; error: unknown }> & {
  eq: (column: string, value: unknown) => UntypedFilter;
};
type UntypedSelect = { select: (columns: string) => UntypedFilter };
const fromUntyped = (table: string): UntypedSelect =>
  (supabase.from as unknown as (t: string) => UntypedSelect)(table);

// Retire the lifecycle rainbow: collapse the per-stage color soup into the
// three semantic pill tones. Label still carries the exact stage name.
function lifecyclePill(stage: string): PillState {
  if (["client_active", "won", "client_funded"].includes(stage)) return "success";
  if (stage === "client_churned") return "error";
  return "pending";
}

// Temperature → semantic pill tone. Non-gold (§11): a heat signal is not an ACT.
// §23 CONSCIOUS COLOR CHOICE (heat, not danger): the ramp is the conventional
// heat map red→amber→indigo→gray = hot→warm→cool→cold, so it reads intuitively at
// a glance. `hot` reuses the destructive-red *token* deliberately as RED-HOT (highest
// intent — call them first), NOT as an error signal: this Heat column carries no
// error/failure pills to collide with, and the Title-case LABEL + distinct icon carry
// the meaning independent of hue. A dedicated heat token would be the only way to fully
// separate the two semantics — logged as a follow-up, not blocking.
function temperaturePill(t: string | null): PillState {
  switch (t) {
    case "hot": return "error";     // red-hot — highest intent (see §23 note above)
    case "warm": return "warning";  // amber
    case "cool": return "building"; // indigo (cool), NOT gold
    case "cold": return "off";      // muted (dormant)
    default: return "off";
  }
}

// Distinct glyph per step so the ramp reads by SHAPE, not color alone (§25 — no
// duplicated-icon tell): flame → sun-thermometer → snow-thermometer → snowflake.
function temperatureIcon(t: string | null) {
  switch (t) {
    case "hot": return <Flame className="h-3 w-3" />;
    case "warm": return <ThermometerSun className="h-3 w-3" />;
    case "cool": return <ThermometerSnowflake className="h-3 w-3" />;
    case "cold": return <Snowflake className="h-3 w-3" />;
    default: return undefined;
  }
}

// Title-case label for the pill — never the raw lowercase enum (§3/§11 polish).
const TEMPERATURE_LABEL: Record<string, string> = {
  hot: "Hot", warm: "Warm", cool: "Cool", cold: "Cold",
};

export default function ContactsAdmin() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [rollup, setRollup] = useState<Record<string, Rollup>>({});
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [editTarget, setEditTarget] = useState<ClientRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [alsoDeleteAuth, setAlsoDeleteAuth] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // contact_ids that carry a partner/referral/vendor relationship (client_types).
  // RLS-scoped, no tenant param — powers the Partners view preset (§18: honest, a
  // real read, never faked from tags).
  const [partnerIds, setPartnerIds] = useState<Set<string>>(new Set());
  const { isAdmin, roles, userId } = useUserRoles();
  const { activeTenant, activeTenantId, isPlatformOwner } = useTenantContext();

  // View mode (My Queue / Team View / All) — presentation-only, mirrors the 1c-vii
  // Command Center pattern EXACTLY. NEVER gates a data read; NO tenant_id param.
  const isOwner = !!userId && activeTenant?.owner_user_id === userId;
  const persona = resolvePersona(roles, isOwner);
  const availableViews = useMemo<CommandCenterView[]>(
    () => persona.views.filter((v) => v !== "team" || TEAM_VIEW_ENABLED), // Team OFF until 1c-ix
    [persona.views],
  );
  const { view, setView } = useCommandCenterView(availableViews, persona.defaultView, "paige_clients_view");

  // URL-synced filters
  const search = searchParams.get("q") || "";
  const lifecycle = searchParams.get("lifecycle") || "all";
  const coachFilter = searchParams.get("coach") || "all";
  const tagFilter = searchParams.get("tag") || "all";
  const segment = searchParams.get("segment") || "";
  const preset = searchParams.get("preset") || "";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  // Re-load whenever the active tenant changes so the §9 explicit-.eq scope always
  // matches the current workspace. `load` is intentionally NOT in the deps: it is a
  // fresh closure each render (over the current activeTenantId), so the effect uses
  // the matching-render `load` — adding it would infinite-loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [activeTenantId]);

  const load = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setMeId(user?.id || null);

      // §9 tenant isolation BY CONSTRUCTION. This is a TENANT surface, so every read
      // + count must be scoped to the active tenant with an EXPLICIT filter — the
      // clients RLS carries an is_platform_owner() bypass (migration 20260629180214),
      // so a platform owner's RLS spans EVERY tenant and RLS alone would let the
      // StatTiles/`stats` memo count cross-tenant rows (the count-vs-list bleed this
      // fix closes). With NO workspace selected (platform owner at the God tier,
      // activeTenantId === null) we render a zeroed/empty state, NEVER the all-tenant
      // rows. Mirrors the CampaignsOverviewStats explicit-.eq pattern (§18).
      if (!activeTenantId) {
        setClients([]);
        setPartnerIds(new Set());
        setRollup({});
        setCoaches([]);
        return;
      }

      const [clientsRes, staff, typesRes] = await Promise.all([
        supabase.from("clients").select("*").eq("tenant_id", activeTenantId).order("created_at", { ascending: false }),
        loadAssignableStaff(),
        // client_types HAS its own tenant_id (server-derived from the parent client),
        // so it takes the same explicit active-tenant filter (§9).
        fromUntyped("client_types").select("contact_id,type").eq("tenant_id", activeTenantId),
      ]);
      if (clientsRes.error) throw clientsRes.error;
      // `as unknown as` (not `as any`, lint-clean): generated types.ts still lacks the
      // 1c-viii-a clients.temperature column, so the row shape doesn't overlap ClientRow
      // until types.ts is regenerated (tracked #234). The column exists at runtime.
      const tenantClients = (clientsRes.data || []) as unknown as ClientRow[];
      setClients(tenantClients);
      const tenantClientIds = new Set(tenantClients.map((c) => c.id));

      // §32 loud degrade: the Partners preset depends on client_types. If that read
      // fails, it degrades gracefully (empty Partners) but must NOT be silent.
      if (typesRes.error) console.warn("client_types read failed — Partners preset will be empty:", typesRes.error);
      const partnerSet = new Set<string>();
      ((typesRes.data as { contact_id: string; type: string }[] | null) || []).forEach((t) => {
        if (["partner", "referral_source", "vendor"].includes(t.type)) partnerSet.add(t.contact_id);
      });
      setPartnerIds(partnerSet);

      setCoaches(staff);

      // contact_deal_rollup is a security_invoker VIEW with NO tenant_id column, so under
      // the clients owner-bypass an unbounded read returns cross-tenant rows — for the
      // platform-owner account that is the ENTIRE platform (the likely 8-10s People-load
      // culprit, Cowork #113). Bounding by this tenant's client ids pushes the filter into
      // the view so the GROUP BY collapses from O(all-platform) to O(tenant). Zero semantic
      // change (§9 count==list): the map already discarded non-tenant rows below; this just
      // stops FETCHING them. Runs after clients resolve (needs their ids), not in parallel.
      // Chunk the id list: a single .in() over the ENTIRE tenant client set can blow the
      // request-URL length ceiling (HTTP 414) for a large tenant and SILENTLY return empty
      // deal stats. Batching keeps the tenant-scoping (no cross-tenant read, §9) AND stays
      // under the URL cap; 200/chunk is well below the limit even for full uuids. Runs the
      // batches concurrently so the perf win over the old unbounded read holds.
      const map: Record<string, Rollup> = {};
      const rollupIds = Array.from(tenantClientIds);
      const ROLLUP_CHUNK = 200;
      const rollupBatches: string[][] = [];
      for (let i = 0; i < rollupIds.length; i += ROLLUP_CHUNK) rollupBatches.push(rollupIds.slice(i, i + ROLLUP_CHUNK));
      const rollupResults = await Promise.all(
        rollupBatches.map((batch) => supabase.from("contact_deal_rollup").select("*").in("contact_id", batch)),
      );
      for (const { data: rollupData, error: rollupErr } of rollupResults) {
        if (rollupErr) { console.warn("contact_deal_rollup read failed — deal stats will be empty:", rollupErr); continue; }
        ((rollupData || []) as Rollup[]).forEach((r) => {
          if (tenantClientIds.has(r.contact_id)) map[r.contact_id] = r;
        });
      }
      setRollup(map);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  };

  const coachName = (id: string | null) =>
    id ? (coaches.find((c) => c.user_id === id)?.name || "Coach") : "Unassigned";

  const allTags = useMemo(() => {
    const s = new Set<string>();
    clients.forEach((c) => (c.tags || []).forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [clients]);

  const filtered = useMemo(() => clients.filter((c) => {
    // View mode (My Queue / Team View / All) — PRESENTATION-ONLY persona filter now
    // (§9). Tenant isolation is enforced upstream by the explicit .eq("tenant_id",
    // activeTenantId) on the clients read in load(), so `clients` already contains
    // ONLY the active tenant's rows; this "My Queue" narrowing is no longer
    // load-bearing for cross-tenant isolation, it just scopes the view to rows
    // assigned to me. Kept as the 1c-vii persona experience, not a security guard.
    const scopeMine = view === "mine" || (view === "business" && isPlatformOwner);
    if (scopeMine && meId && c.assigned_coach_user_id !== meId) return false;

    if (lifecycle !== "all" && (c.lifecycle_stage || "new_lead") !== lifecycle) return false;
    if (coachFilter === "unassigned" && c.assigned_coach_user_id) return false;
    if (coachFilter !== "all" && coachFilter !== "unassigned" && c.assigned_coach_user_id !== coachFilter) return false;
    if (tagFilter !== "all" && !(c.tags || []).includes(tagFilter)) return false;
    if (preset) {
      const p = VIEW_PRESETS.find((x) => x.id === preset);
      if (p && !p.match(c, { meId, partnerIds })) return false;
    }
    if (segment) {
      const seg = SEGMENTS.find((s) => s.id === segment);
      if (seg && !seg.match(c, { meId, partnerIds })) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      const hay = `${c.first_name} ${c.last_name} ${c.email || ""} ${c.entity_name || ""} ${(c.tags || []).join(" ")}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [clients, search, lifecycle, coachFilter, tagFilter, segment, preset, meId, partnerIds, view, isPlatformOwner]);

  const stats = useMemo(() => {
    const totalOpenDeals = Object.values(rollup).reduce((a, r) => a + (r.open_deals || 0), 0);
    const totalOpenValue = Object.values(rollup).reduce((a, r) => a + (r.open_value_cents || 0), 0);
    // KPI tiles count the SAME rows the table shows (`filtered`), not the full `clients`
    // set — otherwise a scoped view (e.g. "My Queue" narrowing to my assigned rows) shows
    // tiles like "2 leads" over a listing of 0, which reads as a bug. Tiles now move in
    // lockstep with the table. (open-deal counts stay rollup-based — a deal aggregate, not
    // a per-contact-row metric.)
    const customers = filtered.filter((c) => c.lifecycle_stage === "client_active").length;
    const leads = filtered.filter((c) => ["new_lead", "qualified", "nurturing", "hot_lead"].includes(c.lifecycle_stage)).length;
    return { totalOpenDeals, totalOpenValue, customers, leads };
  }, [filtered, rollup]);

  const assignCoach = async (clientId: string, coachId: string | null) => {
    const { error } = await supabase.from("clients").update({ assigned_coach_user_id: coachId }).eq("id", clientId);
    if (error) return toast.error(error.message);
    toast.success(coachId ? "Coach assigned" : "Coach unassigned");
    setClients((prev) => prev.map((c) => c.id === clientId ? { ...c, assigned_coach_user_id: coachId } : c));
  };

  const updateLifecycle = async (clientId: string, stage: string) => {
    const { error } = await supabase.from("clients").update({ lifecycle_stage: stage }).eq("id", clientId);
    if (error) return toast.error(error.message);
    setClients((prev) => prev.map((c) => c.id === clientId ? { ...c, lifecycle_stage: stage } : c));
  };

  const exportCSV = () => {
    const source = selected.size > 0
      ? filtered.filter((c) => selected.has(c.id))
      : filtered;
    const rows = source.map((c) => ({
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: c.phone,
      business: c.entity_name,
      title: c.title,
      lifecycle: c.lifecycle_stage,
      source: c.source,
      tags: (c.tags || []).join("; "),
      lead_score: c.lead_score ?? "",
      do_not_contact: c.do_not_contact ? "yes" : "",
      coach: coachName(c.assigned_coach_user_id),
      open_deals: rollup[c.id]?.open_deals || 0,
      open_value: ((rollup[c.id]?.open_value_cents || 0) / 100).toFixed(2),
      created_at: c.created_at,
    }));
    downloadCSV(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, contactsToCSV(rows));
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // If the contact has a portal login and admin opted in, nuke the auth user too.
      if (alsoDeleteAuth && deleteTarget.linked_user_id) {
        const { data, error } = await supabase.functions.invoke("admin-delete-user", {
          body: { user_id: deleteTarget.linked_user_id, keep_contact: false },
        });
        if (error) throw error;
        const payload = data as { error?: string } | null;
        if (payload?.error) throw new Error(payload.error);
      } else {
        await deleteContact(deleteTarget.id);
      }
      toast.success(alsoDeleteAuth ? "Contact + platform account deleted" : "Contact deleted");
      setClients((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      setDeleteTarget(null);
      setAlsoDeleteAuth(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column[] = [
    {
      key: "sel",
      className: "w-8",
      header: (
        <Checkbox
          checked={selected.size > 0 && selected.size === filtered.length}
          onCheckedChange={toggleSelectAll}
          aria-label="Select all"
        />
      ),
    },
    { key: "contact", header: "Contact" },
    { key: "lifecycle", header: "Lifecycle" },
    { key: "temp", header: "Heat" },
    { key: "tags", header: "Tags" },
    { key: "score", header: "Score", numeric: true },
    { key: "deals", header: "Open deals", numeric: true },
    { key: "coach", header: "Coach" },
    { key: "touch", header: "Last touch" },
    { key: "actions", header: "Actions", numeric: true },
  ];

  return (
    <TooltipProvider delayDuration={250}>
      <PageShell width="wide" className="pb-24">
        <PageHeader
          icon={Users}
          title="People"
          description="Your CRM contact book — segment, assign, edit, and push straight into the pipeline."
          actions={
            <>
              <ClientsViewToggle views={availableViews} value={view} onChange={setView} />
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-1" /> Export {selected.size > 0 ? `(${selected.size})` : "CSV"}
              </Button>
              <Button variant="gold" size="sm" onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> New contact
              </Button>
            </>
          }
        />

        <StatRow cols={4}>
          <StatTile icon={Users} label="Total contacts" value={filtered.length.toString()} />
          <StatTile icon={Sparkles} label="Active leads (Lead → SQL)" value={stats.leads.toString()} />
          <StatTile icon={Briefcase} label="Open deals" value={stats.totalOpenDeals.toString()} hint={formatMoney(stats.totalOpenValue)} />
          <StatTile icon={Tag} label="Customers" value={stats.customers.toString()} />
        </StatRow>

        {/* View presets — the coarse Lifecycle × Temperature axis over RLS-scoped rows. */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground flex items-center gap-1 mr-1">
            <Eye className="h-3 w-3" /> Views:
          </span>
          <FilterChip active={!preset} onClick={() => setParam("preset", "")}>All</FilterChip>
          {VIEW_PRESETS.map((p) => (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <span>
                  <FilterChip
                    active={preset === p.id}
                    onClick={() => setParam("preset", preset === p.id ? "" : p.id)}
                  >
                    {p.label}
                  </FilterChip>
                </span>
              </TooltipTrigger>
              <TooltipContent>{p.description}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Smart segments */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground flex items-center gap-1 mr-1">
            <Filter className="h-3 w-3" /> Segments:
          </span>
          <FilterChip active={!segment} onClick={() => setParam("segment", "")}>All</FilterChip>
          {SEGMENTS.map((s) => (
            <Tooltip key={s.id}>
              <TooltipTrigger asChild>
                <span>
                  <FilterChip
                    active={segment === s.id}
                    onClick={() => setParam("segment", segment === s.id ? "" : s.id)}
                  >
                    {s.label}
                  </FilterChip>
                </span>
              </TooltipTrigger>
              <TooltipContent>{s.description}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <SectionCard padded={false} className="p-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, email, business, tag…"
                value={search}
                onChange={(e) => setParam("q", e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={lifecycle} onValueChange={(v) => setParam("lifecycle", v)}>
              <SelectTrigger className="w-[170px]"><SelectValue placeholder="Lifecycle" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lifecycle stages</SelectItem>
                {LIFECYCLE_STAGES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={coachFilter} onValueChange={(v) => setParam("coach", v)}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Coach" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All coaches</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {coaches.map((c) => (
                  <SelectItem key={c.user_id} value={c.user_id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tagFilter} onValueChange={(v) => setParam("tag", v)}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Tag" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tags</SelectItem>
                {allTags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </SectionCard>

        <DataTableShell
          columns={columns}
          loading={loading}
          isEmpty={!loading && filtered.length === 0}
          empty={
            <EmptyState
              icon={Users}
              title="No contacts match your filters"
              description={clients.length === 0
                ? "Add your first contact to get started."
                : "Try clearing filters or change your search."}
              action={
                <Button variant="gold" size="sm" onClick={() => setNewOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> New contact
                </Button>
              }
            />
          }
        >
          {filtered.map((c) => {
            const meta = lifecycleMeta(c.lifecycle_stage);
            const r = rollup[c.id];
            const name = `${c.first_name} ${c.last_name}`.trim() || c.email || "Unnamed";
            const isSel = selected.has(c.id);
            return (
              <TableRow key={c.id} className={isSel ? "bg-primary/5" : undefined}>
                <TableCell>
                  <Checkbox
                    checked={isSel}
                    onCheckedChange={() => toggleSelect(c.id)}
                    aria-label={`Select ${name}`}
                  />
                </TableCell>
                <TableCell>
                  <button className="text-left" onClick={() => navigate("/choose-account")}>
                    <div className="font-medium flex items-center gap-2">
                      {name}
                      {c.do_not_contact && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <BanIcon className="h-3.5 w-3.5 text-destructive" />
                          </TooltipTrigger>
                          <TooltipContent>Do Not Contact</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.entity_name || "—"}{c.email ? ` · ${c.email}` : ""}
                    </div>
                  </button>
                </TableCell>
                <TableCell>
                  <Select value={c.lifecycle_stage || "new_lead"} onValueChange={(v) => updateLifecycle(c.id, v)}>
                    <SelectTrigger className="h-8 w-[150px] border-0 bg-transparent p-0 focus:ring-0">
                      <StatePill state={lifecyclePill(c.lifecycle_stage || "new_lead")}>
                        {meta.label}
                      </StatePill>
                    </SelectTrigger>
                    <SelectContent>
                      {LIFECYCLE_STAGES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {/* §13: temperature is NULL until classify_client_temperature runs —
                      show an em-dash, never invent a heat value. */}
                  {c.temperature ? (
                    <StatePill state={temperaturePill(c.temperature)} icon={temperatureIcon(c.temperature)}>
                      {TEMPERATURE_LABEL[c.temperature] ?? c.temperature}
                    </StatePill>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                    {(c.tags || []).slice(0, 3).map((t) => (
                      <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                    ))}
                    {(c.tags || []).length > 3 && (
                      <span className="text-xs text-muted-foreground">+{(c.tags || []).length - 3}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <LeadScore score={c.lead_score} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="font-medium">{r?.open_deals || 0}</div>
                  <div className="text-xs text-muted-foreground">
                    {r?.open_value_cents ? formatMoney(r.open_value_cents) : "—"}
                  </div>
                </TableCell>
                <TableCell>
                  <Select
                    value={c.assigned_coach_user_id || "unassigned"}
                    onValueChange={(v) => assignCoach(c.id, v === "unassigned" ? null : v)}
                  >
                    <SelectTrigger className="h-8 w-[170px]">
                      <SelectValue>{coachName(c.assigned_coach_user_id)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {coaches.map((co) => (
                        <SelectItem key={co.user_id} value={co.user_id}>{co.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.last_contacted_at ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>{formatDistanceToNow(new Date(c.last_contacted_at), { addSuffix: true })}</span>
                      </TooltipTrigger>
                      <TooltipContent>{format(new Date(c.last_contacted_at), "PPpp")}</TooltipContent>
                    </Tooltip>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" onClick={() => setEditTarget(c)} aria-label="Edit contact">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {isAdmin && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(c)}
                          aria-label="Delete contact"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete contact (admin)</TooltipContent>
                    </Tooltip>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => navigate("/choose-account")}>
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </DataTableShell>

        <BulkActionsBar
          selectedIds={Array.from(selected)}
          coaches={coaches}
          knownTags={allTags}
          onCleared={() => setSelected(new Set())}
          onChanged={load}
          onExport={exportCSV}
        />

        <NewContactDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          onCreated={(id) => navigate("/choose-account")}
        />

        <EditContactDialog
          open={!!editTarget}
          onOpenChange={(v) => !v && setEditTarget(null)}
          contact={editTarget}
          coaches={coaches}
          knownTags={allTags}
          onSaved={(updated) => {
            setClients((prev) => prev.map((c) => c.id === updated.id ? { ...c, ...updated } : c));
            setEditTarget(null);
          }}
        />

        <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v && !deleting) { setDeleteTarget(null); setAlsoDeleteAuth(false); } }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {deleteTarget ? `${deleteTarget.first_name} ${deleteTarget.last_name}`.trim() || deleteTarget.email || "this contact" : "contact"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the contact and their CRM history — deals, activities, notes,
                documents, and coach assignments. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteTarget?.linked_user_id && (
              <label className="flex items-start gap-2 text-sm bg-destructive/5 border border-destructive/30 rounded p-3 -mt-1">
                <Checkbox
                  className="mt-0.5"
                  checked={alsoDeleteAuth}
                  onCheckedChange={(v) => setAlsoDeleteAuth(v === true)}
                  disabled={deleting}
                />
                <span>
                  <strong>Also delete the platform login account.</strong> Removes their auth user,
                  roles, subscriptions, and consumer access. Use this when the person should no
                  longer exist on the platform at all.
                </span>
              </label>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); confirmDelete(); }}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Deleting…" : "Delete contact"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageShell>
    </TooltipProvider>
  );
}

function LeadScore({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-muted-foreground">—</span>;
  const state: PillState = score >= 70 ? "success" : score >= 40 ? "pending" : "off";
  return (
    <StatePill state={state} icon={<Star className="h-3 w-3" />}>{score}</StatePill>
  );
}
