// Admin UI for scheduled credit + funding readiness proposals (Ship #2).
// Lists proposals across the tenant with status filter, approve/reject
// controls, and per-scan-run cost visibility.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Check, X, DollarSign, Users, ScanLine } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CLIENT_CONTACT_METHODS_EMBED, primaryAddressesOf, type WithClientContactMethods } from "@/lib/contact-methods";

// Widened to string: the generated types do not know the contact-methods embed yet.
const PROPOSAL_SELECT: string = "id, contact_id, status, readiness_delta_json, recommended_actions_json, proposed_at, approved_at, rejected_at, rejection_reason, expires_at, scan_run_id, " +
  `clients(first_name, last_name, ${CLIENT_CONTACT_METHODS_EMBED})`;

type Status = "all" | "pending" | "approved" | "rejected" | "expired" | "executed" | "insufficient_data";

interface Proposal {
  id: string;
  contact_id: string;
  status: string;
  readiness_delta_json: { readiness_score_delta?: number; readiness_score_current?: number } | null;
  recommended_actions_json: { priority?: string; label?: string }[] | null;
  proposed_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  expires_at: string;
  scan_run_id: string | null;
  clients: { first_name: string | null; last_name: string | null; email: string | null } | null;
}

interface ScanRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  cadence: string;
  contacts_scanned: number;
  proposals_generated: number;
  proposals_insufficient_data: number;
  credit_provider_calls_count: number;
  credit_provider_cost_usd: number;
  trigger_source: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-red-500/15 text-red-700 dark:text-red-300",
  expired: "bg-muted text-muted-foreground",
  executed: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  insufficient_data: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

export default function ReadinessProposalsAdmin() {
  const [rows, setRows] = useState<Proposal[]>([]);
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [status, setStatus] = useState<Status>("pending");
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<Proposal | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function load() {
    setLoading(true);
    let q = supabase
      .from("paige_readiness_proposals")
      .select(PROPOSAL_SELECT)
      .order("proposed_at", { ascending: false })
      .limit(200);
    if (status !== "all") q = q.eq("status", status);
    const [{ data: p }, { data: r }] = await Promise.all([
      q,
      supabase.from("paige_readiness_scan_runs").select("*").order("started_at", { ascending: false }).limit(10),
    ]);
    // The contact's `email` is its PRIMARY address, from its contact methods.
    setRows(((p ?? []) as unknown as Array<Omit<Proposal, "clients"> & { clients: ({ first_name: string | null; last_name: string | null } & WithClientContactMethods) | null }>)
      .map((row) => ({
        ...row,
        clients: row.clients
          ? { first_name: row.clients.first_name, last_name: row.clients.last_name, email: primaryAddressesOf(row.clients.client_contact_methods).email }
          : null,
      })));
    setRuns((r ?? []) as unknown as ScanRun[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [status]);

  const totals = useMemo(() => {
    const cost = runs.reduce((sum, r) => sum + Number(r.credit_provider_cost_usd || 0), 0);
    const scanned = runs.reduce((sum, r) => sum + (r.contacts_scanned || 0), 0);
    const generated = runs.reduce((sum, r) => sum + (r.proposals_generated || 0), 0);
    return { cost, scanned, generated };
  }, [runs]);

  async function approve(id: string) {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("paige_readiness_proposals")
      .update({ status: "approved", approved_by: u?.user?.id ?? null, approved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast({ title: "Approval failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Proposal approved", description: "Client will see the update in their workspace." }); setDrawer(null); load(); }
  }

  async function reject(id: string) {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("paige_readiness_proposals")
      .update({
        status: "rejected",
        rejected_by: u?.user?.id ?? null,
        rejected_at: new Date().toISOString(),
        rejection_reason: rejectReason || null,
      })
      .eq("id", id);
    if (error) toast({ title: "Rejection failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Proposal rejected" }); setDrawer(null); setRejectReason(""); load(); }
  }

  // Manual scan removed (§9 producer-inventory reconciliation): readiness-scan
  // is now cron-only and rejects caller-supplied scan parameters. A §9-safe
  // "scan now" (tenant derived server-side, role-gated, rate-limited, audited)
  // is tracked in #445; the scheduled monthly cron continues the work.

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Readiness Proposals</h1>
        <p className="text-sm text-muted-foreground">
          Scheduled credit + funding readiness scans for BTF clients. Two-phase per §122 — approve before send.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs text-muted-foreground">Contacts scanned (last 10 runs)</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{totals.scanned}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs text-muted-foreground">Proposals generated</CardTitle>
            <ScanLine className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{totals.generated}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs text-muted-foreground">iSoftpull cost (USD)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">${totals.cost.toFixed(2)}</div></CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["pending","approved","rejected","expired","executed","insufficient_data","all"] as Status[]).map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">No proposals in this view.</div>
          ) : (
            <div className="divide-y">
              {rows.map((r) => {
                const name = [r.clients?.first_name, r.clients?.last_name].filter(Boolean).join(" ") || r.clients?.email || r.contact_id.slice(0, 8);
                const delta = r.readiness_delta_json?.readiness_score_delta;
                const cur = r.readiness_delta_json?.readiness_score_current;
                return (
                  <button
                    key={r.id}
                    onClick={() => setDrawer(r)}
                    className="w-full text-left p-4 hover:bg-accent flex items-center gap-4"
                  >
                    <Badge className={STATUS_COLOR[r.status] || "bg-muted"}>{r.status}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{name}</div>
                      <div className="text-xs text-muted-foreground">
                        Proposed {formatDistanceToNow(new Date(r.proposed_at), { addSuffix: true })}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      {cur != null && <div>Score: <span className="font-medium">{cur}</span></div>}
                      {delta != null && <div className={delta >= 0 ? "text-emerald-600" : "text-red-600"}>Δ {delta > 0 ? "+" : ""}{delta}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)}>
        <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Readiness Proposal</SheetTitle>
          </SheetHeader>
          {drawer && (
            <div className="mt-4 space-y-4">
              <div>
                <Badge className={STATUS_COLOR[drawer.status] || "bg-muted"}>{drawer.status}</Badge>
                <div className="mt-2 font-medium">
                  {[drawer.clients?.first_name, drawer.clients?.last_name].filter(Boolean).join(" ") || drawer.clients?.email}
                </div>
                <div className="text-xs text-muted-foreground">{drawer.clients?.email}</div>
              </div>

              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Readiness Delta</div>
                <pre className="text-xs bg-muted p-3 rounded overflow-auto">{JSON.stringify(drawer.readiness_delta_json, null, 2)}</pre>
              </div>

              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Recommended Actions</div>
                <ul className="space-y-1 text-sm">
                  {(drawer.recommended_actions_json ?? []).map((a, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <Badge variant="outline" className="text-[10px]">{a.priority}</Badge>
                      <span>{a.label}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {drawer.status === "pending" && (
                <>
                  <div className="pt-4 border-t space-y-2">
                    <Textarea placeholder="Rejection reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    <div className="flex gap-2">
                      <Button className="flex-1 gap-2" onClick={() => approve(drawer.id)}><Check className="h-4 w-4" /> Approve</Button>
                      <Button variant="destructive" className="flex-1 gap-2" onClick={() => reject(drawer.id)}><X className="h-4 w-4" /> Reject</Button>
                    </div>
                  </div>
                </>
              )}

              {drawer.rejection_reason && (
                <div className="text-xs text-muted-foreground">Rejected: {drawer.rejection_reason}</div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
