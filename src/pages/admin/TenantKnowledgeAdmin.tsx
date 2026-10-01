// Tenant-private Knowledge Base admin.
// Each tenant manages their own corpus here. Docs are RLS-scoped to their
// tenant. Opt-in `share_to_network` flag routes the doc into the platform-
// owner review queue (Network Insights) for potential promotion to global canon.
import { useEffect, useState, useCallback, useRef } from "react";
import { knowledgeInvokeOutcome, type KnowledgeIngestOutcome } from "@/lib/knowledge/ingest-outcome";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useConfirm } from "@/hooks/useConfirm";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Brain, Plus, Trash2, Share2, Clock, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface TenantDoc {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  tags: string[] | null;
  source: string;
  share_to_network: boolean;
  network_review_status: "none" | "pending" | "approved" | "rejected";
  chunk_count: number;
  created_at: string;
}

const REVIEW_BADGE: Record<string, { label: string; cls: string; icon: any }> = {
  none:     { label: "Private",          cls: "bg-muted text-muted-foreground", icon: Brain },
  pending:  { label: "Pending review",   cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Clock },
  approved: { label: "In global canon",  cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  rejected: { label: "Not promoted",     cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300", icon: XCircle },
};

export default function TenantKnowledgeAdmin() {
  const { activeTenant, activeTenantId } = useTenantContext();
  const [docs, setDocs] = useState<TenantDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tenant_knowledge_docs" as any)
      .select("id, title, summary, category, tags, source, share_to_network, network_review_status, chunk_count, created_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setDocs((data as any) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, activeTenantId]);

  const toggleShare = async (doc: TenantDoc, next: boolean) => {
    const { error } = await supabase
      .from("tenant_knowledge_docs" as any)
      .update({
        share_to_network: next,
        network_review_status: next ? "pending" : "none",
      })
      .eq("id", doc.id);
    if (error) return toast.error(error.message);
    toast.success(next ? "Submitted for network review" : "Removed from network queue");
    load();
  };

  const remove = async (doc: TenantDoc) => {
    const ok = await confirm({
      title: `Delete "${doc.title}"?`,
      description: "This removes the document and every embedded chunk. Paige will no longer draw on it.",
      actionLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("tenant_knowledge_docs" as any).delete().eq("id", doc.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    load();
  };

  return (
    <div className="space-y-6 p-6">
      {confirmDialog}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Brain className="w-6 h-6" /> Knowledge Base
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeTenant
              ? `Private docs Paige uses to answer questions inside ${activeTenant.name}. Toggle "Share to Network" to contribute back to the shared network canon.`
              : "Your private knowledge corpus."}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-1.5" /> Add Document</Button>
          </DialogTrigger>
          <AddDocDialog tenantId={activeTenantId ?? undefined} onClose={() => { setOpen(false); load(); }} />
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Documents ({docs.length})</CardTitle>
          <CardDescription>
            Embedded chunks: {docs.reduce((s, d) => s + (d.chunk_count ?? 0), 0)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : docs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p>No documents yet. Add SOPs, scripts, reference docs, or playbooks Paige should know about.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Network</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-[140px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => {
                  const b = REVIEW_BADGE[d.network_review_status] ?? REVIEW_BADGE.none;
                  const Icon = b.icon;
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <div className="font-medium">{d.title}</div>
                        {d.summary && (
                          <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{d.summary}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        {d.category ? <Badge variant="outline">{d.category}</Badge> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{d.chunk_count}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${b.cls}`}>
                          <Icon className="w-3 h-3" /> {b.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="flex items-center gap-2 justify-end">
                        <div className="flex items-center gap-1.5" title="Share to Network">
                          <Share2 className="w-3.5 h-3.5 text-muted-foreground" />
                          <Switch
                            checked={d.share_to_network}
                            onCheckedChange={(v) => toggleShare(d, v)}
                            disabled={d.network_review_status === "approved"}
                          />
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => remove(d)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type AddMode = "paste" | "url" | "file";

/**
 * Add-document dialog. Three honest modes: "Paste" (kb-ingest-doc), "From a
 * link" (kb-ingest-url — fetches the page server-side), and "Upload" (uploads to
 * the tenant-knowledge bucket, then kb-ingest-file extracts text — PDF/txt/md +
 * image OCR — and chunks + embeds). Reused by the Knowledge panel in Your Paige.
 * `onIngested` fires after a successful add so the workspace can pulse the vitals
 * chip and show the "Paige just indexed …" banner. `tenantId` is required for the
 * Upload path (the file lands under <tenant_id>/… so bucket RLS scopes it).
 */
export function AddDocDialog({
  onClose,
  onIngested,
  onReview,
  initialMode = "paste",
  tenantId,
}: {
  onClose: () => void;
  onIngested?: (title: string, docId?: string) => void;
  onReview?: () => void;
  initialMode?: AddMode;
  tenantId?: string;
}) {
  const [mode, setMode] = useState<AddMode>(initialMode);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<KnowledgeIngestOutcome | null>(null);
  const currentTenant = useRef({ tenantId });
  if (currentTenant.current.tenantId !== tenantId) currentTenant.current = { tenantId };
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const tagList = () => tags.split(",").map((t) => t.trim()).filter(Boolean);

  const present = async (data: unknown, error: unknown, label: string, submittedTenant: typeof currentTenant.current) => {
    const result = await knowledgeInvokeOutcome(data, error);
    if (!mounted.current || currentTenant.current !== submittedTenant) return;
    setOutcome(result);
    if (result.kind === "complete") {
      toast.success(result.message);
      onIngested?.(label, result.docId);
      onClose();
    }
  };

  const submitPaste = async () => {
    if (pending.current) return;
    if (!title.trim() || !content.trim()) return toast.error("Title and content required");
    pending.current = true;
    const submittedTenant = currentTenant.current;
    setOutcome(null);
    setBusy(true);
    setProgress("Teaching Paige…");
    try {
      const { data, error } = await supabase.functions.invoke("kb-ingest-doc", {
        body: {
          title: title.trim(),
          content,
          summary: summary.trim() || undefined,
          category: category.trim() || undefined,
          tags: tagList(),
          source: "paste",
          share_to_network: share,
        },
      });
      await present(data, error, title.trim(), submittedTenant);
    } catch (error: unknown) {
      await present(null, error, title.trim(), submittedTenant);
    } finally {
      pending.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  const submitUrl = async () => {
    if (pending.current) return;
    const u = url.trim();
    if (!u) return toast.error("Add a link to fetch");
    if (!/^https:\/\//i.test(u)) return toast.error("Only secure https:// links can be added");
    pending.current = true;
    const submittedTenant = currentTenant.current;
    setOutcome(null);
    setBusy(true);
    setProgress("Fetching and indexing…");
    try {
      const { data, error } = await supabase.functions.invoke("kb-ingest-url", {
        body: {
          url: u,
          title: title.trim() || undefined,
          category: category.trim() || undefined,
          tags: tagList(),
          share_to_network: share,
        },
      });
      await present(data, error, title.trim() || u, submittedTenant);
    } catch (error: unknown) {
      await present(null, error, title.trim() || u, submittedTenant);
    } finally {
      pending.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  const submitFile = async () => {
    if (pending.current) return;
    if (!file) return toast.error("Choose a file to upload");
    if (!tenantId) return toast.error("Switch into a workspace first — there's nowhere to store this.");
    if (file.size > 26214400) return toast.error("That file is over 25 MB — try a smaller one.");
    pending.current = true;
    const submittedTenant = currentTenant.current;
    setOutcome(null);
    setBusy(true);
    setProgress("Uploading…");
    const safe = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${tenantId}/${crypto.randomUUID()}_${safe}`;
    let ingestionStarted = false;
    try {
      const { error: upErr } = await supabase.storage.from("tenant-knowledge").upload(path, file);
      if (upErr) throw upErr;
      if (!mounted.current || currentTenant.current !== submittedTenant) return;
      setProgress("Reading the file…");
      ingestionStarted = true;
      const { data, error } = await supabase.functions.invoke("kb-ingest-file", {
        body: {
          path,
          mime: file.type || undefined,
          filename: file.name,
          title: title.trim() || undefined,
          category: category.trim() || undefined,
          tags: tagList(),
          share_to_network: share,
        },
      });
      await present(data, error, title.trim() || file.name, submittedTenant);
    } catch (error: unknown) {
      // A failed acknowledgement may follow a committed save. Keep the source;
      // storage cleanup belongs to a reconciled lifecycle, not a browser catch.
      await present(ingestionStarted ? null : { ok: false, error: "ingestion_not_started" }, ingestionStarted ? error : null, title.trim() || file.name, submittedTenant);
    } finally {
      pending.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  const submit = mode === "url" ? submitUrl : mode === "file" ? submitFile : submitPaste;
  const review = () => { onReview?.(); onClose(); };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader><DialogTitle>Teach Paige something new</DialogTitle></DialogHeader>
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="inline-flex rounded-lg border p-0.5 bg-muted/40">
          <button
            type="button"
            onClick={() => setMode("paste")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === "paste" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
          >
            Paste text
          </button>
          <button
            type="button"
            onClick={() => setMode("url")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === "url" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
          >
            From a link
          </button>
          <button
            type="button"
            onClick={() => setMode("file")}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === "file" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}
          >
            Upload a file
          </button>
        </div>

        {mode === "url" ? (
          <div>
            <Label>Link *</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/your-methodology" />
            <p className="text-xs text-muted-foreground mt-1">Paige fetches the page, then chunks and learns it. Secure https links only.</p>
          </div>
        ) : null}

        {mode === "file" ? (
          <div>
            <Label>File *</Label>
            <Input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              PDF (max 24 MB), scan/image (png · jpg · webp, max 5 MB), or text (txt · md · csv). Paige
              reads it — scans and images are transcribed automatically — then chunks and learns it.
            </p>
          </div>
        ) : null}

        <div>
          <Label>Title {mode === "paste" ? "*" : "(optional)"}</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Discovery call script" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. onboarding" />
          </div>
          <div>
            <Label>Tags (comma separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="intake, discovery, methodology" />
          </div>
        </div>
        {mode === "paste" && (
          <>
            <div>
              <Label>Summary (optional)</Label>
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One-line summary used in search results" />
            </div>
            <div>
              <Label>Content *</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                placeholder="Paste the doc body — Paige chunks and learns it automatically."
              />
            </div>
          </>
        )}
        <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/40">
          <div>
            <div className="font-medium text-sm">Share to the network</div>
            <p className="text-xs text-muted-foreground">
              Submit this doc for review. If approved it joins the shared canon every practice can draw on.
            </p>
          </div>
          <Switch checked={share} onCheckedChange={setShare} />
        </div>
        {outcome && outcome.kind !== "complete" && <p role="status" className="text-sm text-foreground">{outcome.message}</p>}
        <div className="flex items-center justify-end gap-2">
          {progress && <span role="status" className="text-xs text-muted-foreground mr-auto">{progress}</span>}
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={outcome?.kind === "partial" || outcome?.kind === "unknown" ? review : submit} disabled={busy}>{busy ? (progress ?? "Working…") : outcome?.kind === "partial" || outcome?.kind === "unknown" ? "Review knowledge" : "Add & teach"}</Button>
        </div>
      </div>
    </DialogContent>
  );
}
