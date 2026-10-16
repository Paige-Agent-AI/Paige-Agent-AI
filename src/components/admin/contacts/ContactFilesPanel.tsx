import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Trash2, Download, FileText, Eye, Share2, Lock } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useConfirm } from "@/hooks/useConfirm";

type Visibility = "internal" | "shared" | "client_upload";

type FileRow = {
  id: string;
  contact_id: string;
  uploaded_by_user_id: string;
  storage_path: string;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  visibility: Visibility;
  description: string | null;
  created_at: string;
  upload_state?: "pending" | "ready";
};

const LABEL: Record<Visibility, string> = {
  internal: "Internal",
  shared: "Shared with client",
  client_upload: "Client uploads",
};

const ICON: Record<Visibility, JSX.Element> = {
  internal: <Lock className="h-3.5 w-3.5" />,
  shared: <Share2 className="h-3.5 w-3.5" />,
  client_upload: <Upload className="h-3.5 w-3.5" />,
};

export function ContactFilesPanel({ contactId, tenantId }: { contactId: string; tenantId?: string | null }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [tab, setTab] = useState<Visibility>("internal");
  const [busy, setBusy] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("client_files")
      .select("*")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false });
    setFiles((data as FileRow[]) || []);
  }, [contactId]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`client_files:${contactId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_files", filter: `contact_id=eq.${contactId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [contactId, load]);

  const upload = async (file: File, visibility: Visibility) => {
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const safe = file.name.replace(/[^\w.-]/g, "_");
      const t = tenantId || "default";
      const path = `${t}/${contactId}/${visibility}/${Date.now()}_${safe}`;

      const { error: upErr } = await supabase.storage.from("client-files").upload(path, file);
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("client_files").insert({
        contact_id: contactId,
        tenant_id: tenantId ?? null,
        uploaded_by_user_id: user.id,
        storage_path: path,
        original_filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        visibility,
      });
      if (insErr) throw insErr;
      toast.success(`Uploaded to ${LABEL[visibility]}`);
    } catch (e: unknown) {
      toast.error(e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const download = async (f: FileRow) => {
    if (f.upload_state === "pending") return;
    const { data, error } = await supabase.storage.from("client-files").createSignedUrl(f.storage_path, 300);
    if (error || !data) return toast.error(error?.message || "Download failed");
    window.open(data.signedUrl, "_blank");
  };

  const remove = async (f: FileRow) => {
    const ok = await confirm({
      title: `Delete ${f.original_filename}?`,
      description: "The file is removed from storage for good — this can't be undone.",
      actionLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await supabase.storage.from("client-files").remove([f.storage_path]);
    const { error } = await supabase.from("client_files").delete().eq("id", f.id);
    if (error) toast.error(error.message);
  };

  const toggleShare = async (f: FileRow) => {
    const next: Visibility = f.visibility === "shared" ? "internal" : "shared";
    if (f.visibility === "client_upload") return; // client uploads stay where they are
    const { error } = await supabase.from("client_files").update({ visibility: next }).eq("id", f.id);
    if (error) toast.error(error.message);
    else toast.success(next === "shared" ? "Now visible to client" : "Set to internal");
  };

  const list = files.filter(f => f.visibility === tab);

  return (
    <Card><CardContent className="p-4 space-y-4">
      {confirmDialog}
      <Tabs value={tab} onValueChange={(v) => setTab(v as Visibility)}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <TabsList>
            {(["internal", "shared", "client_upload"] as Visibility[]).map(v => (
              <TabsTrigger key={v} value={v}>
                {ICON[v]}<span className="ml-1.5">{LABEL[v]}</span>
                <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                  {files.filter(f => f.visibility === v).length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          {tab !== "client_upload" && (
            <label className="cursor-pointer">
              <input
                type="file"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f, tab);
                  e.target.value = "";
                }}
              />
              <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90">
                <Upload className="h-4 w-4" /> Upload to {LABEL[tab]}
              </span>
            </label>
          )}
        </div>

        {(["internal", "shared", "client_upload"] as Visibility[]).map(v => (
          <TabsContent key={v} value={v} className="mt-3">
            {list.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">
                {v === "client_upload"
                  ? "No client uploads yet — clients can upload from their workspace."
                  : `No ${LABEL[v].toLowerCase()} files yet.`}
              </div>
            ) : (
              <div className="space-y-2">
                {list.map(f => (
                  <div key={f.id} className="flex items-center justify-between gap-2 border border-border rounded p-3 text-sm">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{f.original_filename}</div>
                        <div className="text-xs text-muted-foreground">
                          {f.upload_state === "pending" ? "Upload incomplete" : f.mime_type || "file"} · {f.size_bytes ? `${(f.size_bytes / 1024).toFixed(1)} KB` : ""} · {formatDistanceToNow(new Date(f.created_at), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" className="h-7" disabled={f.upload_state === "pending"} aria-label={`Download ${f.original_filename}`} onClick={() => download(f)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      {f.visibility !== "client_upload" && (
                        <Button variant="ghost" size="sm" className="h-7" onClick={() => toggleShare(f)}
                                title={f.visibility === "shared" ? "Make internal" : "Share with client"}>
                          {f.visibility === "shared" ? <Lock className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => remove(f)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </CardContent></Card>
  );
}
