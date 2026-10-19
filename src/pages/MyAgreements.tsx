// src/pages/MyAgreements.tsx
// "Your agreements" — per-user audit list of every legal acceptance, with
// view/print links. Honors E-Sign §4 "obtain a record" promise.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, ExternalLink, ShieldCheck } from "lucide-react";

type AcceptanceRow = {
  id: string;
  document_slug: string;
  document_version: number;
  accepted_at: string;
  user_agent: string | null;
  context: Record<string, unknown> | null;
};

type DocMeta = { slug: string; title: string; version: number };

export default function MyAgreements() {
  const [rows, setRows] = useState<AcceptanceRow[]>([]);
  const [docs, setDocs] = useState<Record<string, DocMeta>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        setLoading(false);
        return;
      }
      const [{ data: acc }, { data: dd }] = await Promise.all([
        supabase
          .from("legal_acceptances")
          .select("id, document_slug, document_version, accepted_at, user_agent, context")
          .eq("user_id", uid)
          .order("accepted_at", { ascending: false }),
        supabase
          .from("legal_documents")
          .select("slug, title, version")
          .eq("is_current", true),
      ]);
      setRows((acc as AcceptanceRow[]) ?? []);
      const map: Record<string, DocMeta> = {};
      for (const d of (dd as DocMeta[]) ?? []) map[d.slug] = d;
      setDocs(map);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-6 w-6 text-primary mt-1" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your Agreements</h1>
          <p className="text-sm text-muted-foreground">
            {/* customer-identity-exempt: platform legal entity — these are the platform's own Terms and policies the person accepted */}
            Every legal document you've accepted on PaigeAgent, with the exact version,
            timestamp, and device used. Use the View link to open the version you signed
            and print it for your records.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No acceptances on file yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const meta = docs[r.document_slug];
            const isCurrent = meta?.version === r.document_version;
            return (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <FileText className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <CardTitle className="text-base">
                          {meta?.title || r.document_slug}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Version {r.document_version} • Accepted{" "}
                          {new Date(r.accepted_at).toLocaleString()}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isCurrent ? (
                        <Badge variant="secondary">Current</Badge>
                      ) : (
                        <Badge variant="outline">Superseded</Badge>
                      )}
                      <Button asChild size="sm" variant="ghost">
                        <Link to={`/legal/${r.document_slug}`} target="_blank">
                          View <ExternalLink className="h-3 w-3 ml-1" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {(r.context && Object.keys(r.context).length > 0) || r.user_agent ? (
                  <CardContent className="pt-0">
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer hover:text-foreground">
                        Audit details
                      </summary>
                      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                        {r.user_agent && (
                          <>
                            <dt className="text-muted-foreground/80">Device</dt>
                            <dd className="break-all">{r.user_agent}</dd>
                          </>
                        )}
                        {r.context &&
                          Object.entries(r.context).map(([k, v]) => (
                            <div key={k} className="contents">
                              <dt className="text-muted-foreground/80 capitalize">
                                {k.replace(/_/g, " ")}
                              </dt>
                              <dd className="break-all font-mono">
                                {typeof v === "object" && v !== null
                                  ? JSON.stringify(v)
                                  : String(v)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </details>
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground border-t pt-4">
        Per E-SIGN §7001(c), you may request a paper copy of any agreement by emailing{" "}
        <a href="mailto:support@paigeagent.ai" className="underline">
          support@paigeagent.ai
        </a>
        .
      </p>
    </div>
  );
}
