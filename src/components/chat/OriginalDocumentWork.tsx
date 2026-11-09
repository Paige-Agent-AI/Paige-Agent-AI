import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PaigeArtifactCard, type PaigeArtifact } from "@/components/paige/chat/PaigeArtifactCard";
import { supabase } from "@/integrations/supabase/client";
import { CHAT_CONTROL_HEADER, chatControlRetryDelay } from "../../../supabase/functions/_shared/paige-turn/control-transport";
import { readOriginalDocumentWork, type DocumentWorkRead, type OriginalDocumentReference } from "./documentWorkRecovery";

const labels = {
  pending: "The original document job is still in progress.",
  approval: "The original job is waiting for approval. Review its existing approval in this conversation.",
  blocked: "The original job is blocked. Check its existing instructions in this conversation.",
  failed: "The original document job failed.",
  cancelled: "The original document job was cancelled.",
  unknown: "The original document and receipt could not be verified. Check the original status again.",
};

export function OriginalDocumentWork({ reference, actorId, tenantId, current, artifacts }: {
  reference: OriginalDocumentReference;
  actorId: string;
  tenantId: string;
  current(): boolean;
  artifacts: readonly PaigeArtifact[];
}) {
  const [result, setResult] = useState<DocumentWorkRead | "checking">();
  const inFlight = useRef<AbortController | null>(null);
  const retryAt = useRef(0);
  useLayoutEffect(() => () => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  async function check() {
    if (!current() || inFlight.current) return;
    if (Date.now() < retryAt.current) {
      setResult({ state: "unknown" });
      return;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    const stillCurrent = () => current() && !controller.signal.aborted && inFlight.current === controller;
    setResult("checking");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!stillCurrent()) return;
      if (session?.user.id !== actorId) {
        setResult({ state: "unknown" });
        return;
      }
      const { data, error } = await supabase.functions.invoke("paige-ai-chat", {
        signal: controller.signal,
        headers: { [CHAT_CONTROL_HEADER]: "status", Authorization: `Bearer ${session.access_token}` },
        body: {
          threadId: reference.threadId,
          requestIntentId: reference.intentId,
          messages: [{ role: "user", content: "Status" }],
          interactive: { kind: "status", workId: reference.workId },
        },
      });
      if (!stillCurrent()) return;
      const context = (error as { context?: Response } | null)?.context;
      if (context?.status === 429) retryAt.current = Date.now() + chatControlRetryDelay(context.headers.get("Retry-After"));
      const { data: after } = await supabase.auth.getSession();
      if (!stillCurrent()) return;
      setResult(error || after.session?.user.id !== actorId
        ? { state: "unknown" } : readOriginalDocumentWork(data, reference));
    } catch {
      if (stillCurrent()) setResult({ state: "unknown" });
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  const existing = result && result !== "checking" && result.state === "verified"
    ? artifacts.find(artifact => artifact.id === result.resultRef && artifact.artifactType === "document" &&
      (artifact.tenantId === undefined || artifact.tenantId === tenantId))
    : undefined;
  return (
    <section aria-label="Original document job" className="mt-3 border-t border-border pt-3">
      <Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal text-left"
        aria-disabled={result === "checking" || undefined} aria-busy={result === "checking" || undefined}
        onClick={() => void check()}>
        {result === "checking" ? "Checking document status…" : "Check original document status"}
      </Button>
      {result && result !== "checking" && (result.state === "verified" ? (
        <div className="mt-2 space-y-2">
          <p role="status" className="break-words text-sm font-medium">
            {existing ? `Verified document: ${existing.title}` : "Original document verified"}
          </p>
          <p className="break-all text-xs text-muted-foreground">Original receipt {result.receiptRef}</p>
          {!existing && <PaigeArtifactCard tenantId={tenantId}
            artifact={{ id: result.resultRef, artifactType: "document", title: "Original document" }} />}
        </div>
      ) : <p role="status" className="mt-2 text-sm text-muted-foreground">{labels[result.state]}</p>)}
    </section>
  );
}
