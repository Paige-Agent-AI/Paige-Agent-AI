// "What Paige knows" — the payoff tier of the Customize Paige console (spec §1.6).
// Folds in BOTH tenant-KB (the "Knowledge" tab) and Knowledge Review / network
// curation (the "Review" tab, reusing NetworkKbInsights). The KB tab re-skins the
// old TenantKnowledgeAdmin table into doc cards framed as feeding Paige, with an
// honest ingest status, a gold "she got smarter" pulse, and a live tie-back
// footer. Knowledge commits per-doc immediately — never gated behind the header
// Save (spec §1.7).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileText, Link2, Paperclip, MoreHorizontal, Trash2, Share2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { AddDocDialog } from "@/pages/admin/TenantKnowledgeAdmin";
import { usePaigeWorkspace } from "./PaigeWorkspaceContext";

// Tenant-facing label for a shared doc's network-review status. This is the
// tenant's OWN view of what they contributed — never the operator approval
// queue (that stays platform-level, §9).
const NETWORK_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Pending review", tone: "text-muted-foreground" },
  approved: { label: "In shared canon", tone: "text-accent" },
  rejected: { label: "Not accepted", tone: "text-muted-foreground" },
};

type TenantDoc = Pick<Database["public"]["Tables"]["tenant_knowledge_docs"]["Row"],
  "id" | "title" | "summary" | "category" | "tags" | "source" |
  "share_to_network" | "network_review_status" | "chunk_count" | "created_at"
>;

const SOURCE_GLYPH: Record<string, typeof FileText> = {
  paste: FileText,
  url: Link2,
  upload: Paperclip,
  scan: Paperclip,
  sync: FileText,
};

export function KnowledgePanel({ tenantName }: { tenantName: string }) {
  const { counts, notifyKnowledgeAdded, refreshCounts, activeTenantId } = usePaigeWorkspace();
  const [docs, setDocs] = useState<TenantDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [fileOpen, setFileOpen] = useState(false);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TenantDoc | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenant_knowledge_docs")
      .select("id, title, summary, category, tags, source, share_to_network, network_review_status, chunk_count, created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setDocs(data ?? []);
    setLoading(false);
    refreshCounts();
  }, [refreshCounts]);

  useEffect(() => { load(); }, [load]);

  const toggleShare = async (doc: TenantDoc, next: boolean) => {
    const { error } = await supabase
      .from("tenant_knowledge_docs")
      .update({ share_to_network: next, network_review_status: next ? "pending" : "none" })
      .eq("id", doc.id);
    if (error) return toast.error(error.message);
    toast.success(next ? "Submitted for network review" : "Removed from network queue");
    load();
  };

  const confirmDelete = async () => {
    const doc = pendingDelete;
    if (!doc) return;
    setPendingDelete(null);
    const { error } = await supabase.from("tenant_knowledge_docs").delete().eq("id", doc.id);
    if (error) return toast.error(error.message);
    toast.success("Removed from what Paige knows");
    load();
  };

  // On a successful add: pulse the new card, tell the workspace (vitals + banner).
  const handleIngested = (title: string, docId?: string) => {
    notifyKnowledgeAdded(title);
    load();
    if (docId) {
      setPulseId(docId);
      setTimeout(() => setPulseId((cur) => (cur === docId ? null : cur)), 900);
    }
  };

  return (
    <Tabs defaultValue="knowledge" className="space-y-4">
      <TabsList>
        <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
        <TabsTrigger value="review">Review</TabsTrigger>
      </TabsList>

      {/* ── KB tab ─────────────────────────────────────────────── */}
      <TabsContent value="knowledge" className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">What Paige knows</h3>
          <p className="text-sm text-muted-foreground">
            Paige answers {tenantName}'s clients from what you teach her here. Add your
            playbooks, scripts, and reference docs — she uses them the moment they finish indexing.
          </p>
        </div>

        {/* Entry chips */}
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <FileText className="w-4 h-4 mr-1.5" /> Paste text
              </Button>
            </DialogTrigger>
            {pasteOpen && <AddDocDialog
              key={activeTenantId}
              initialMode="paste"
              tenantId={activeTenantId ?? undefined}
              onClose={() => setPasteOpen(false)}
              onIngested={handleIngested}
              onReview={load}
            />}
          </Dialog>

          <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Link2 className="w-4 h-4 mr-1.5" /> Add a link
              </Button>
            </DialogTrigger>
            {linkOpen && <AddDocDialog
              key={activeTenantId}
              initialMode="url"
              tenantId={activeTenantId ?? undefined}
              onClose={() => setLinkOpen(false)}
              onIngested={handleIngested}
              onReview={load}
            />}
          </Dialog>

          <Dialog open={fileOpen} onOpenChange={setFileOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Paperclip className="w-4 h-4 mr-1.5" /> Upload a file
              </Button>
            </DialogTrigger>
            {fileOpen && <AddDocDialog
              key={activeTenantId}
              initialMode="file"
              tenantId={activeTenantId ?? undefined}
              onClose={() => setFileOpen(false)}
              onIngested={handleIngested}
              onReview={load}
            />}
          </Dialog>
        </div>

        {/* Doc cards */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading what Paige knows…
          </div>
        ) : docs.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Paige doesn't have any source material yet. Give her your first playbook, script,
            or reference doc and she'll start drawing on it.
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((d) => {
              const Glyph = SOURCE_GLYPH[d.source] ?? FileText;
              const ready = (d.chunk_count ?? 0) > 0;
              return (
                <div
                  key={d.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 transition-shadow",
                    pulseId === d.id && "ring-2 ring-accent",
                  )}
                >
                  <Glyph className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{d.title}</span>
                      {ready ? (
                        <span className="inline-flex items-center gap-1 text-xs text-accent">
                          <span className="h-1.5 w-1.5 rounded-full bg-gradient-gold" />
                          Ready · {d.chunk_count} {d.chunk_count === 1 ? "passage" : "passages"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin" /> Teaching Paige…
                        </span>
                      )}
                    </div>
                    {d.summary && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{d.summary}</p>}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {d.category && <Badge variant="outline" className="text-[10px]">{d.category}</Badge>}
                      {(d.tags ?? []).slice(0, 4).map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                      ))}
                      {d.share_to_network && (
                        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
                          <Share2 className="w-3 h-3" />
                          {d.network_review_status === "approved" ? "In shared canon" : "Shared for review"}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Document options">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <div className="flex items-center justify-between px-2 py-1.5 text-sm">
                        <span className="flex items-center gap-2"><Share2 className="w-3.5 h-3.5" /> Share to network</span>
                        <Switch
                          checked={d.share_to_network}
                          onCheckedChange={(v) => toggleShare(d, v)}
                          disabled={d.network_review_status === "approved"}
                        />
                      </div>
                      <DropdownMenuItem className="text-destructive" onClick={() => setPendingDelete(d)}>
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}

        {/* Tie-back footer */}
        <div className="border-t pt-3 space-y-0.5">
          <p className="text-sm">
            Paige has indexed <span className="font-medium">{counts.docs}</span> {counts.docs === 1 ? "source" : "sources"}{" "}
            (<span className="font-medium">{counts.chunks}</span> passages) she can draw on.
          </p>
          <p className="text-xs text-muted-foreground">Knowledge saves as you add it — no need to hit Save.</p>
        </div>
      </TabsContent>

      {/* ── Review (KR) tab — the tenant's OWN network contributions ──────── */}
      {/* Read-only status of docs this tenant shared to the network. The operator
          approval queue (approve into the global canon) stays platform-level (§9)
          — a tenant only sees where their own submissions stand. */}
      <TabsContent value="review" className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Shared to the network</h3>
          <p className="text-sm text-muted-foreground">
            Docs you've offered to the shared network canon, and where each one stands in review.
            Toggle "Share to network" on any doc in the Knowledge tab to contribute it.
          </p>
        </div>
        {(() => {
          const shared = docs.filter((d) => d.share_to_network);
          if (loading) {
            return (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading your contributions…
              </div>
            );
          }
          if (shared.length === 0) {
            return (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                You haven't shared anything to the network yet. When you do, it'll show here with its review status.
              </div>
            );
          }
          return (
            <div className="space-y-2">
              {shared.map((d) => {
                const status = NETWORK_STATUS[d.network_review_status] ?? NETWORK_STATUS.pending;
                const Glyph = SOURCE_GLYPH[d.source] ?? FileText;
                return (
                  <div key={d.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <Glyph className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium text-sm truncate flex-1">{d.title}</span>
                    <span className={cn("inline-flex items-center gap-1 text-xs shrink-0", status.tone)}>
                      <Share2 className="w-3 h-3" /> {status.label}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </TabsContent>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this from what Paige knows?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `"${pendingDelete.title}" and everything Paige learned from it will be removed. This can't be undone.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
