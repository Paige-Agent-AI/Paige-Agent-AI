import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { tenantRoutePrefixForPath } from "@/components/tenant-shell/tenantShellRoutes";
import { useTenantContext } from "@/hooks/useTenantContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowRight } from "lucide-react";
import { formatMoney, Pipeline, PipelineStage } from "@/lib/pipelines";
import { NewDealDialog } from "@/components/admin/pipeline/NewDealDialog";

type Deal = {
  id: string; title: string; status: string;
  value_cents: number; currency: string;
  stage_id: string; pipeline_id: string;
  expected_close_date: string | null;
};

export function ContactDealsSection({ contactId }: { contactId: string }) {
  const { activeTenantId, accountContextLoading } = useTenantContext();
  const navigate = useNavigate();
  const location = useLocation();
  const tenantRoot = tenantRoutePrefixForPath(location.pathname);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [defaultPipeline, setDefaultPipeline] = useState<Pipeline | null>(null);

  const [generation, setGeneration] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const key = `${activeTenantId}:${contactId}`;
  const current = loadedKey === key && !accountContextLoading;
  const visibleDeals = current && phase === "ready" ? deals : [];
  useEffect(() => {
    let alive = true;
    setNewOpen(false); setDefaultPipeline(null); setLoadedKey(""); setPhase("loading");
    if (!activeTenantId || accountContextLoading) return;
    void (async () => {
      try {
        const [ds, ps, sts] = await Promise.all([
          supabase.from("deals").select("*").eq("tenant_id", activeTenantId).eq("contact_client_id", contactId).order("created_at", { ascending: false }),
          supabase.from("pipelines").select("*").eq("tenant_id", activeTenantId).order("is_default", { ascending: false }),
          supabase.from("pipeline_stages").select("*").eq("tenant_id", activeTenantId).is("archived_at", null).order("order_index"),
        ]);
        if (!alive) return;
        if (ds.error || ps.error || sts.error) throw new Error("read failed");
        const piped = (ps.data || []) as Pipeline[];
        setDeals((ds.data || []) as Deal[]); setPipelines(piped);
        setStages((sts.data || []) as PipelineStage[]);
        setDefaultPipeline(piped.find(p => p.is_default) || piped[0] || null);
        setLoadedKey(key); setPhase("ready");
      } catch {
        if (alive) { setDeals([]); setPipelines([]); setStages([]); setDefaultPipeline(null); setLoadedKey(key); setPhase("error"); }
      }
    })();
    return () => { alive = false; };
  }, [activeTenantId, accountContextLoading, contactId, generation, key]);

  const stageLabel = (id: string) => stages.find((s) => s.id === id)?.label || "—";
  const pipelineName = (id: string) => pipelines.find((p) => p.id === id)?.name || "Pipeline";
  const dealStages = defaultPipeline ? stages.filter((s) => s.pipeline_id === defaultPipeline.id) : [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {!activeTenantId ? "Choose a workspace to view linked deals." : !current || phase === "loading" ? "Loading linked deals…" : phase === "error" ? "Could not load linked deals." : visibleDeals.length === 0 ? "No deals linked to this client in this workspace." : `${visibleDeals.length} linked deal${visibleDeals.length === 1 ? "" : "s"}`}

        </div>
        <Button size="sm" onClick={() => setNewOpen(true)} disabled={!current || phase !== "ready" || !defaultPipeline}>
          <Plus className="h-4 w-4 mr-1" /> New deal
        </Button>
      </div>

      {visibleDeals.length > 0 && (
        <div className="space-y-2">
          {visibleDeals.map((d) => (
            <button
              key={d.id}
              onClick={() => navigate(tenantRoot ? `${tenantRoot}/sales/opportunities?view=board&deal=${encodeURIComponent(d.id)}` : "/choose-account")}
              className="w-full text-left border border-border rounded-lg p-3 hover:bg-muted/40 transition-colors flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{d.title}</div>
                <div className="text-xs text-muted-foreground">
                  {pipelineName(d.pipeline_id)} · {stageLabel(d.stage_id)}
                  {d.expected_close_date ? ` · close ${new Date(d.expected_close_date).toLocaleDateString()}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="font-semibold">{formatMoney(d.value_cents, d.currency)}</div>
                  <Badge
                    variant="outline"
                    className={
                      d.status === "won" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" :
                      d.status === "lost" ? "border-red-500/40 text-red-700 dark:text-red-300" : ""
                    }
                  >
                    {d.status}
                  </Badge>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>
      )}

      {current && phase === "error" && <Button variant="outline" onClick={() => setGeneration(n => n + 1)}>Retry linked deals</Button>}
      {current && phase === "ready" && visibleDeals.length === 0 && <p className="text-xs text-muted-foreground">Other workspace opportunities may be unlinked. Review them in Sales before choosing a client association.</p>}
      {current && phase === "ready" && defaultPipeline && (
        <NewDealDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          pipeline={defaultPipeline}
          stages={dealStages}
          defaultStageId={dealStages[0]?.id}
          defaultContactId={contactId}
          onCreated={() => setGeneration(n => n + 1)}
        />
      )}
    </div>
  );
}
