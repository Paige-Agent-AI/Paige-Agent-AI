import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { loadAssignableStaff } from "@/lib/team/assignableStaff";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Settings, Filter, TrendingUp, Search, Sparkles, GripVertical } from "lucide-react";
import { Deal, Pipeline, PipelineStage, formatMoney, logDealActivity } from "@/lib/pipelines";
import { useTenantOffers } from "@/hooks/useTenantOffers";
import { useTenantContext } from "@/hooks/useTenantContext";
import { NewDealDialog } from "@/components/admin/pipeline/NewDealDialog";
import { DealDrawer } from "@/components/admin/pipeline/DealDrawer";
import { PipelineFromProgramDialog } from "@/components/admin/pipeline/PipelineFromProgramDialog";
import { PageShell, PageHeader, StatRow, StatTile, SectionCard, Toolbar, EmptyState } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";

export default function PipelineAdmin() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contactMap, setContactMap] = useState<Record<string, { name: string; entity: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newStage, setNewStage] = useState<string | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [coaches, setCoaches] = useState<{ user_id: string; name: string }[]>([]);
  const [showFromProgram, setShowFromProgram] = useState(false);
  const { offerLabel } = useTenantOffers();
  const { activeTenantId } = useTenantContext();

  useEffect(() => { loadPipelines(); }, []);
  useEffect(() => { if (activePipelineId) loadBoard(activePipelineId); }, [activePipelineId]);

  const loadPipelines = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("pipelines").select("*").order("is_default", { ascending: false }).order("name");
    if (error) { toast.error(error.message); setLoading(false); return; }
    setPipelines(data || []);
    if (data && data.length) setActivePipelineId(data[0].id);
    // load the workspace's assignable staff once
    setCoaches(await loadAssignableStaff());
    setLoading(false);
  };

  const loadBoard = async (pid: string) => {
    const [{ data: st }, { data: ds }] = await Promise.all([
      supabase.from("pipeline_stages").select("*").eq("pipeline_id", pid).is("archived_at", null).order("order_index"),
      supabase.from("deals").select("*").eq("pipeline_id", pid).order("created_at", { ascending: false }),
    ]);
    setStages((st as PipelineStage[]) || []);
    const dealList = (ds as Deal[]) || [];
    setDeals(dealList);

    const contactIds = Array.from(new Set(dealList.map((d) => d.contact_client_id).filter(Boolean) as string[]));
    if (contactIds.length) {
      const { data: cs } = await supabase.from("clients").select("id, first_name, last_name, entity_name").in("id", contactIds);
      const map: Record<string, { name: string; entity: string | null }> = {};
      type ContactRow = { id: string; first_name: string | null; last_name: string | null; entity_name: string | null };
      ((cs || []) as ContactRow[]).forEach((c) => {
        map[c.id] = { name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Unnamed", entity: c.entity_name };
      });
      setContactMap(map);
    } else setContactMap({});
  };

  const activePipeline = pipelines.find((p) => p.id === activePipelineId) || null;

  const filteredDeals = useMemo(() => {
    return deals.filter((d) => {
      if (ownerFilter !== "all" && d.owner_user_id !== ownerFilter && !(ownerFilter === "unassigned" && !d.owner_user_id)) return false;
      if (search) {
        const hay = (d.title + " " + (contactMap[d.contact_client_id || ""]?.name || "")).toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [deals, ownerFilter, search, contactMap]);

  const stats = useMemo(() => {
    const open = filteredDeals.filter((d) => d.status === "open");
    const openValue = open.reduce((s, d) => s + (d.value_cents || 0), 0);
    const weighted = open.reduce((s, d) => {
      const stage = stages.find((st) => st.id === d.stage_id);
      return s + ((d.value_cents || 0) * (Number(stage?.probability ?? 0) / 100));
    }, 0);
    const wonThisMonth = filteredDeals.filter((d) => d.status === "won" && d.actual_close_date && new Date(d.actual_close_date).getMonth() === new Date().getMonth() && new Date(d.actual_close_date).getFullYear() === new Date().getFullYear());
    const wonValue = wonThisMonth.reduce((s, d) => s + (d.value_cents || 0), 0);
    return { openCount: open.length, openValue, weighted, wonCount: wonThisMonth.length, wonValue };
  }, [filteredDeals, stages]);

  const onDragStart = (e: React.DragEvent, id: string) => e.dataTransfer.setData("text/plain", id);
  const onDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stage_id === stageId) return;
    const newStage = stages.find((s) => s.id === stageId);
    const payload: Partial<Deal> = { stage_id: stageId };
    if (newStage?.stage_type === "won") { payload.status = "won"; payload.actual_close_date = new Date().toISOString().slice(0, 10); }
    else if (newStage?.stage_type === "lost") { payload.status = "lost"; payload.actual_close_date = new Date().toISOString().slice(0, 10); }
    else { payload.status = "open"; payload.actual_close_date = null; }
    setDeals((prev) => prev.map((d) => d.id === id ? { ...d, ...payload } as Deal : d));
    const { error } = await supabase.from("deals").update(payload).eq("id", id);
    if (error) { toast.error(error.message); loadBoard(activePipelineId); return; }
    await logDealActivity(id, "stage_changed", `Moved to ${newStage?.label}`);
    toast.success(`Moved to ${newStage?.label}`);
  };

  if (loading) return (
    <PageShell width="wide">
      <PageHeader title="Pipeline" description="Drag deals across stages. Click a card for full context." icon={TrendingUp} />
      {/* Board-shaped skeleton — first paint reads as the Kanban, not a bare-text stall (§11). */}
      <StatRow cols={4}>
        {[0, 1, 2, 3].map((i) => <StatTile key={i} loading label="" value="" />)}
      </StatRow>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {[0, 1, 2, 3].map((col) => (
          <SectionCard key={col} className="w-72 shrink-0 space-y-3">
            <Skeleton className="h-4 w-28" />
            {[0, 1, 2].map((c) => <Skeleton key={c} className="h-20 w-full rounded-md" />)}
          </SectionCard>
        ))}
      </div>
    </PageShell>
  );

  if (!pipelines.length) {
    return (
      <PageShell width="wide">
        <PageHeader
          title="Pipeline"
          description="Drag deals across stages. Click a card for full context."
          icon={TrendingUp}
        />
        <EmptyState
          icon={TrendingUp}
          title="No pipelines yet"
          description="Set up your first pipeline and start moving deals toward the close."
          action={
            <Button asChild variant="gold">
              <Link to="/choose-account">Create your first pipeline</Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title="Pipeline"
        description="Drag deals across stages. Click a card for full context."
        icon={TrendingUp}
        actions={
          <>
            <Select value={activePipelineId} onValueChange={setActivePipelineId}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.is_default ? " · default" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button asChild variant="outline" size="sm"><Link to="/choose-account"><Settings className="w-4 h-4 mr-1" /> Configure</Link></Button>
            <Button variant="outline" size="sm" onClick={() => setShowFromProgram(true)}><Sparkles className="w-4 h-4 mr-1" /> Build from a program</Button>
            <Button variant="gold" size="sm" onClick={() => { setNewStage(null); setShowNew(true); }}><Plus className="w-4 h-4 mr-1" /> New Deal</Button>
          </>
        }
      />

      {/* Stats bar */}
      <StatRow cols={4}>
        <StatTile label="Open deals" value={String(stats.openCount)} />
        <StatTile label="Open pipeline value" value={formatMoney(stats.openValue)} />
        <StatTile label="Weighted forecast" value={formatMoney(stats.weighted)} icon={TrendingUp} />
        <StatTile label="Won this month" value={`${stats.wonCount} · ${formatMoney(stats.wonValue)}`} />
      </StatRow>

      {/* Filters */}
      <Toolbar>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search deals or contacts…" className="pl-8 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-48 h-9"><Filter className="w-3.5 h-3.5 mr-1" /><SelectValue placeholder="Owner" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {coaches.map((c) => <SelectItem key={c.user_id} value={c.user_id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Toolbar>

      {/* Board */}
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
        {stages.map((stage) => {
          const items = filteredDeals.filter((d) => d.stage_id === stage.id);
          const stageValue = items.reduce((s, d) => s + (d.value_cents || 0), 0);
          return (
            <div
              key={stage.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, stage.id)}
              className="bg-muted/30 rounded-lg p-3 min-h-[420px] w-72 shrink-0"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ background: stage.color }} />
                  <div className="font-semibold text-sm">{stage.label}</div>
                </div>
                <Badge variant="outline">{items.length}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mb-3 flex justify-between">
                <span>{formatMoney(stageValue)}</span>
                <span>{stage.probability}%</span>
              </div>
              <div className="space-y-2">
                {items.map((d) => {
                  const c = d.contact_client_id ? contactMap[d.contact_client_id] : null;
                  return (
                    <Card
                      key={d.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, d.id)}
                      onClick={() => setSelectedDeal(d)}
                      className="group relative p-3 pr-6 cursor-grab active:cursor-grabbing hover:border-primary transition-colors"
                    >
                      {/* Drag affordance — a grip that signals the card is draggable (the whole
                          card is the drag handle; this just makes it discoverable). Brightens on
                          hover; decorative, so it never eats the click/drag. */}
                      <GripVertical
                        aria-hidden
                        className="pointer-events-none absolute right-1.5 top-2.5 h-4 w-4 text-muted-foreground/30 transition-colors group-hover:text-muted-foreground/70"
                      />
                      <div className="font-medium text-sm line-clamp-2">{d.title}</div>
                      {c && <div className="text-xs text-muted-foreground truncate mt-0.5">{c.name}{c.entity ? ` · ${c.entity}` : ""}</div>}
                      {d.offer_type && (
                        <div className="mt-1.5">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                            {offerLabel(d.offer_type)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center mt-2">
                        <span className="text-xs font-semibold text-gold-dark">{formatMoney(d.value_cents, d.currency)}</span>
                        {d.expected_close_date && <span className="text-[10px] text-muted-foreground">{new Date(d.expected_close_date).toLocaleDateString()}</span>}
                      </div>
                    </Card>

                  );
                })}
                <button
                  onClick={() => { setNewStage(stage.id); setShowNew(true); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 border border-dashed border-border rounded hover:border-primary transition-colors"
                >+ Add deal</button>
              </div>
            </div>
          );
        })}
      </div>

      <NewDealDialog
        open={showNew}
        onOpenChange={setShowNew}
        pipeline={activePipeline}
        stages={stages}
        defaultStageId={newStage}
        onCreated={() => loadBoard(activePipelineId)}
      />

      <DealDrawer
        deal={selectedDeal}
        stages={stages}
        open={!!selectedDeal}
        onOpenChange={(v) => !v && setSelectedDeal(null)}
        onChanged={() => loadBoard(activePipelineId)}
      />

      <PipelineFromProgramDialog
        open={showFromProgram}
        onOpenChange={setShowFromProgram}
        tenantId={activeTenantId}
        onCreated={(id) => { loadPipelines().then(() => setActivePipelineId(id)); }}
      />
    </PageShell>
  );
}
