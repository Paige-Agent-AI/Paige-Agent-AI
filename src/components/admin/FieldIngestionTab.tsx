import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { Check, X, Mic, Sparkles, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useTenantFeature } from "@/hooks/useTenantFeature";
import { applyClientUpdateProposal } from "./applyClientUpdateProposal";

type Proposal = {
  id: string;
  tenant_id: string | null;
  client_id: string | null;
  tool_name: string;
  target_table: string | null;
  status: string;
  confidence: string | null;
  source: string;
  external_llm_model: string | null;
  review_reason: string | null;
  diff: Record<string, unknown>;
  payload: Record<string, unknown>;
  actor_user_id: string | null;
  actor_role: string;
  created_at: string;
};

const toolLabel: Record<string, string> = {
  ingest_credit_scores: "Credit Scores",
  ingest_banking_snapshot: "Banking Snapshot",
  append_client_memory: "Coach Note",
  propose_client_update: "Contact Update",
};

export default function FieldIngestionTab() {
  const [items, setItems] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // Credit-score ingestion is a funding-vertical option (§2/§9): generic
  // coaching tenants never surface credit-score proposals for review.
  const { enabled: fundingEnabled } = useTenantFeature("funding_readiness");
  const visibleItems = fundingEnabled
    ? items
    : items.filter((p) => p.tool_name !== "ingest_credit_scores");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("paige_ingestion_proposals")
      .select("*")
      .in("status", ["pending", "needs_review"])
      .order("created_at", { ascending: false })
      .limit(100);
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setItems((data as unknown as Proposal[]) ?? []);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("field-ingestion")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "paige_ingestion_proposals" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const decide = async (p: Proposal, decision: "approve" | "reject") => {
    setBusy(p.id);
    if (decision === "reject") {
      const { error } = await supabase
        .from("paige_ingestion_proposals")
        .update({ status: "rejected", decided_at: new Date().toISOString() })
        .eq("id", p.id);
      setBusy(null);
      if (error) return toast.error(error.message);
      toast.success("Proposal rejected");
      return;
    }
    // Approve: flip to pending (if needs_review), then invoke applyProposal via MCP.
    // We can't call MCP from the browser without an OAuth token, so admin approval
    // applies directly using SQL writes that mirror the MCP applyProposal switch.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing type debt; hotfix changes only the retired route destination
      const payload = (p.payload ?? {}) as any;
      if (p.tool_name === "ingest_credit_scores" && p.client_id) {
        const { data: cli } = await supabase
          .from("clients")
          .select("linked_user_id")
          .eq("id", p.client_id)
          .maybeSingle();
        if (cli?.linked_user_id) {
          const patch: Record<string, number> = {};
          for (const s of payload.scores ?? []) {
            if (s.bureau === "TU") patch.estimated_fico_tu = s.score;
            if (s.bureau === "EX") patch.estimated_fico_ex = s.score;
            if (s.bureau === "EQ") patch.estimated_fico_eq = s.score;
          }
          if (Object.keys(patch).length) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing type debt; hotfix changes only the retired route destination
            await supabase.from("profiles").update(patch as any).eq("user_id", cli.linked_user_id);
          }
        }
        const summary = (payload.scores ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing type debt; hotfix changes only the retired route destination
          .map((s: any) => `${s.bureau} ${s.score} (${s.source}, ${s.pulled_on})`)
          .join("; ");
        await supabase.from("client_memory").insert({
          client_user_id: (await supabase.auth.getUser()).data.user?.id,
          client_id: p.client_id,
          memory_type: "report_upload",
          content: `Credit scores (admin-approved field-ops): ${summary}`,
          metadata: { proposal_id: p.id, scores: payload.scores },
        });
      } else if (p.tool_name === "append_client_memory" && p.client_id) {
        await supabase.from("client_memory").insert({
          client_user_id: (await supabase.auth.getUser()).data.user?.id,
          client_id: p.client_id,
          memory_type: payload.category ?? "coach_note",
          content: payload.note,
          metadata: { proposal_id: p.id, admin_approved: true },
        });
      } else if (p.tool_name === "propose_client_update" && p.client_id) {
        // Addresses are the contact's methods (the address change the proposal asked for, planned
        // on the list held now, as confirm_proposal plans it); every other field is a column on the
        // contact row. Any refusal or failure throws, so the proposal is never marked applied.
        await applyClientUpdateProposal({ client_id: p.client_id, tenant_id: p.tenant_id, payload: p.payload, diff: p.diff });
      } else if (p.tool_name === "ingest_banking_snapshot" && p.client_id) {
        const { data: cli } = await supabase
          .from("clients")
          .select("linked_user_id")
          .eq("id", p.client_id)
          .maybeSingle();
        if (cli?.linked_user_id) {
          await supabase.from("manual_banking_entries").upsert(
            {
              user_id: cli.linked_user_id,
              avg_daily_balance: payload.avg_daily_balance ?? 0,
              avg_monthly_revenue: payload.monthly_deposits ?? 0,
              monthly_nsf_count: payload.nsf_count_30d ?? 0,
            },
            { onConflict: "user_id" },
          );
        }
      }
      await supabase
        .from("paige_ingestion_proposals")
        .update({ status: "applied", decided_at: new Date().toISOString() })
        .eq("id", p.id);
      toast.success("Applied to client record");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Mic className="w-4 h-4" /> Field Ingestion
          <span className="text-xs font-normal text-muted-foreground ml-2">
            Voice / chat / external LLM ingest waiting for review
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>}
        {!loading && visibleItems.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Nothing waiting. Teammates haven't pushed anything from voice or chat yet.
          </p>
        )}
        {visibleItems.map((p) => {
          const needs = p.status === "needs_review";
          return (
            <div
              key={p.id}
              className={`rounded-md border p-3 space-y-2 ${needs ? "border-amber-500/50 bg-amber-500/5" : "hover:bg-muted/30"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="text-[10px]">
                      {toolLabel[p.tool_name] ?? p.tool_name}
                    </Badge>
                    {needs && (
                      <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="w-3 h-3 mr-1" /> Needs review
                      </Badge>
                    )}
                    {p.confidence && (
                      <Badge variant="outline" className="text-[10px]">
                        {p.confidence}
                      </Badge>
                    )}
                    {p.external_llm_model && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Sparkles className="w-3 h-3" /> {p.external_llm_model}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                    </span>
                  </div>
                  {p.client_id && (
                    <Link
                      to={"/choose-account"}
                      className="text-xs text-primary hover:underline mt-1 inline-block"
                    >
                      View client →
                    </Link>
                  )}
                  {p.review_reason && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                      Flag: {p.review_reason}
                    </p>
                  )}
                  <pre className="text-[11px] mt-2 bg-muted/50 rounded p-2 overflow-x-auto max-h-40">
                    {JSON.stringify(p.diff, null, 2)}
                  </pre>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button size="sm" disabled={busy === p.id} onClick={() => decide(p, "approve")}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => decide(p, "reject")}>
                    <X className="w-3.5 h-3.5 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
