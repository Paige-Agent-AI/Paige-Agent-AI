import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Globe, RefreshCw, Trash2, Plus, Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/useConfirm";
import { resolveFunctionError } from "@/lib/integrations/connectError";

type DomainDnsRecord = { type?: string; record?: string; name?: string; value?: string };
type Domain = {
  id: string;
  tenant_id: string;
  domain: string;
  from_email_local: string;
  from_name: string;
  status: string;
  is_default: boolean;
  dns_records: DomainDnsRecord[];
  verified_at: string | null;
};

function errorMessage(error: unknown): string | undefined {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : undefined;
}

const statusColor = (s: string) =>
  s === "verified" ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
  : s === "failed" ? "bg-red-500/20 text-red-700 dark:text-red-300"
  : "bg-amber-500/20 text-amber-700 dark:text-amber-300";

export function EmailDomainsPanel() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ domain: "", from_email_local: "no-reply", from_name: "" });
  const { confirm, dialog: confirmDialog } = useConfirm();

  const call = async (verb: string, payload: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke<{ domains?: Domain[]; error?: unknown }>("manage-tenant-domain", { body: { verb, ...payload } });
    if (error || data?.error) {
      const { message } = await resolveFunctionError({ error, data, action: "manage sending domains" });
      throw new Error(message);
    }
    return data;
  };

  const load = async () => {
    setLoading(true);
    try {
      const d = await call("list");
      setDomains(d?.domains ?? []);
    } catch (e: unknown) {
      toast.error(errorMessage(e) || "Failed to load domains");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!form.domain || !form.from_name) { toast.error("Domain and From name are required"); return; }
    setBusy("add");
    try { await call("add", form); toast.success("Domain registered — verify DNS to activate"); setShowAdd(false); setForm({ domain: "", from_email_local: "no-reply", from_name: "" }); await load(); }
    catch (e: unknown) { toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  };

  const refresh = async (id: string) => { setBusy(id); try { await call("refresh", { id }); await load(); toast.success("Status refreshed"); } catch (e: unknown) { toast.error(errorMessage(e)); } finally { setBusy(null); } };
  const setDefault = async (id: string) => { setBusy(id); try { await call("set_default", { id }); await load(); } catch (e: unknown) { toast.error(errorMessage(e)); } finally { setBusy(null); } };
  const remove = async (id: string) => {
    const ok = await confirm({
      title: "Remove this sender domain?",
      description: "Paige can no longer send from it until you register and verify it again.",
      actionLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    setBusy(id); try { await call("remove", { id }); await load(); } catch (e: unknown) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  const copy = (v: string) => { navigator.clipboard.writeText(v); toast.success("Copied"); };

  return (
    <div className="space-y-4">
      {confirmDialog}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Globe className="w-4 h-4" /> Sender Domains</CardTitle>
              <CardDescription>
                Send emails from your own brand. The platform default for all tenants is <code className="text-xs">no-reply@paigeagent.ai</code>. Add a domain below to send as your own brand instead.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAdd((v) => !v)}><Plus className="w-3.5 h-3.5 mr-1" /> Add domain</Button>
          </div>
        </CardHeader>
        {showAdd && (
          <CardContent className="border-t border-border space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label className="text-xs">Domain (e.g. mybrand.com)</Label><Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="mybrand.com" /></div>
              <div><Label className="text-xs">From name</Label><Input value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} placeholder="My Brand" /></div>
              <div><Label className="text-xs">From mailbox</Label><Input value={form.from_email_local} onChange={(e) => setForm({ ...form, from_email_local: e.target.value })} placeholder="no-reply" /></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" onClick={add} disabled={busy === "add"}>{busy === "add" ? "Registering…" : "Register & get DNS"}</Button>
            </div>
          </CardContent>
        )}
      </Card>

      {loading ? <div className="text-sm text-muted-foreground">Loading…</div> : domains.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          No custom domains yet. Sends will use the platform default <code>no-reply@paigeagent.ai</code>.
        </CardContent></Card>
      ) : domains.map((d) => (
        <Card key={d.id}>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex items-center gap-2">
                <div className="font-medium">{d.from_email_local}@{d.domain}</div>
                <Badge variant="outline">{d.from_name}</Badge>
                <Badge className={statusColor(d.status)}>{d.status}</Badge>
                {d.is_default && <Badge variant="secondary"><Check className="w-3 h-3 mr-1" />Default</Badge>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => refresh(d.id)} disabled={busy === d.id}><RefreshCw className="w-3.5 h-3.5" /></Button>
                {!d.is_default && d.status === "verified" && <Button size="sm" variant="outline" onClick={() => setDefault(d.id)}>Make default</Button>}
                <Button size="sm" variant="ghost" onClick={() => remove(d.id)} disabled={busy === d.id}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
            {Array.isArray(d.dns_records) && d.dns_records.length > 0 && d.status !== "verified" && (
              <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
                <div className="text-xs font-medium">Add these DNS records at your registrar, then click refresh:</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground"><tr><th className="text-left py-1">Type</th><th className="text-left py-1">Name</th><th className="text-left py-1">Value</th><th></th></tr></thead>
                    <tbody>
                      {d.dns_records.map((r, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="py-1 pr-2 font-mono">{r.type || r.record}</td>
                          <td className="py-1 pr-2 font-mono break-all">{r.name}</td>
                          <td className="py-1 pr-2 font-mono break-all">{r.value}</td>
                          <td><Button size="sm" variant="ghost" onClick={() => copy(r.value)}><Copy className="w-3 h-3" /></Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
