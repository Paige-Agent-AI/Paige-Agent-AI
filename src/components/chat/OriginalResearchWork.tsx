import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PaigeResearchCard, type PaigeResearchResult } from "@/components/paige/chat/PaigeResearchCard";
import { supabase } from "@/integrations/supabase/client";
import { readResearchHistoryRun } from "@/lib/paigeResearchReadback";
import { CHAT_CONTROL_HEADER, chatControlRetryDelay } from "../../../supabase/functions/_shared/paige-turn/control-transport";
import { readOriginalResearchWork, type OriginalResearchReference, type ResearchWorkRead } from "./researchWorkRecovery";

const labels = {
  pending: "The original research job is still in progress.",
  blocked: "The original research job is blocked. Check its existing instructions in this conversation.",
  failed: "The original research job failed.",
  cancelled: "The original research job was cancelled.",
  unknown: "The original report and receipt could not be verified. Check the same job again before taking further action.",
};
type Result = Exclude<ResearchWorkRead, { state: "verified" }>
  | { state: "verified"; receiptRef: string; report: PaigeResearchResult };

/** Read-only recovery. Mounting or checking never dispatches or publishes Research. */
export function OriginalResearchWork({ reference, actorId, tenantId, current }: {
  reference: OriginalResearchReference;
  actorId: string;
  tenantId: string;
  current(): boolean;
}) {
  const [result, setResult] = useState<Result | "checking">();
  const inFlight = useRef<AbortController | null>(null);
  const retryAt = useRef(0);
  useLayoutEffect(() => () => { inFlight.current?.abort(); inFlight.current = null; }, []);

  async function check() {
    if (!current() || inFlight.current) return;
    if (Date.now() < retryAt.current) { setResult({ state: "unknown" }); return; }
    const controller = new AbortController();
    inFlight.current = controller;
    const stillCurrent = () => current() && !controller.signal.aborted && inFlight.current === controller;
    const unknown = { state: "unknown" } as const;
    setResult("checking");
    try {
      const authority = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!stillCurrent() || session?.user.id !== actorId) return null;
        const workspace = await supabase.rpc("current_user_tenant_id").abortSignal(controller.signal);
        return stillCurrent() && !workspace.error && workspace.data === tenantId ? session : null;
      };
      const session = await authority();
      if (!stillCurrent()) return;
      if (!session) { setResult(unknown); return; }
      const status = async () => {
        const response = await supabase.functions.invoke("paige-ai-chat", {
          signal: controller.signal,
          headers: { [CHAT_CONTROL_HEADER]: "status", Authorization: `Bearer ${session.access_token}` },
          body: { threadId: reference.threadId, requestIntentId: reference.intentId,
            messages: [{ role: "user", content: "Status" }],
            interactive: { kind: "status", workId: reference.workId } },
        });
        const context = (response.error as { context?: Response } | null)?.context;
        if (context?.status === 429) retryAt.current = Date.now() + chatControlRetryDelay(context.headers.get("Retry-After"));
        return response.error ? unknown : readOriginalResearchWork(response.data, reference);
      };
      const first = await status();
      if (!stillCurrent()) return;
      if (!await authority()) { if (stillCurrent()) setResult(unknown); return; }
      if (!stillCurrent()) return;
      if (first.state !== "verified") { setResult(first); return; }
      const read = await supabase.rpc("get_workspace_research_run", { _run_id: first.resultRef })
        .abortSignal(controller.signal);
      if (!stillCurrent()) return;
      const report = read.error ? null : readResearchHistoryRun(read.data, first.resultRef);
      if (!report || !await authority()) { if (stillCurrent()) setResult(unknown); return; }
      if (!stillCurrent()) return;
      // Do not combine an earlier receipt with a later unrelated report read.
      const last = await status();
      if (!stillCurrent()) return;
      const authorized = await authority();
      if (!stillCurrent()) return;
      setResult(authorized && last.state === "verified" && last.resultRef === first.resultRef &&
        last.receiptRef === first.receiptRef
        ? { state: "verified", receiptRef: first.receiptRef, report: { ...report, saved: true } } : unknown);
    } catch { if (stillCurrent()) setResult(unknown); }
    finally { if (inFlight.current === controller) inFlight.current = null; }
  }

  return <section aria-label="Original research job" className="mt-3 border-t border-border pt-3">
    <Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal text-left"
      aria-disabled={result === "checking" || undefined} aria-busy={result === "checking" || undefined}
      onClick={() => void check()}>
      {result === "checking" ? "Checking research status…" : "Check original research status"}
    </Button>
    {result && result !== "checking" && (result.state === "verified" ? <div className="mt-2 space-y-2">
      <p role="status" className="break-words text-sm font-medium">Saved report and completion receipt verified at this check.</p>
      <p className="break-all text-xs text-muted-foreground">Original receipt {result.receiptRef}</p>
      <PaigeResearchCard result={result.report} />
    </div> : <p role="status" className="mt-2 text-sm text-muted-foreground">{labels[result.state]}</p>)}
  </section>;
}
