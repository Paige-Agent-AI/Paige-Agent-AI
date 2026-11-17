import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PaigeResearchCard, type PaigeResearchResult } from "@/components/paige/chat/PaigeResearchCard";
import { supabase } from "@/integrations/supabase/client";
import { readResearchHistoryRun } from "@/lib/paigeResearchReadback";
import { keepPrivateResearchWork } from "@/lib/privateDocumentWorkHandoff";
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

/** Status remains read-only. Publication recovery requires a separate explicit action. */
export function OriginalResearchWork({ reference, actorId, tenantId, current, surface = "chat" }: {
  reference: OriginalResearchReference;
  actorId: string;
  tenantId: string;
  current(): boolean;
  surface?: "chat" | "team-hub";
}) {
  const [result, setResult] = useState<Result | "checking">();
  const [handoffSaved, setHandoffSaved] = useState<boolean>();
  const [keeping, setKeeping] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const retryAt = useRef(0);
  useLayoutEffect(() => () => { inFlight.current?.abort(); inFlight.current = null; }, []);

  async function check(resume = false, keep = false) {
    if (!current() || inFlight.current) return;
    if (Date.now() < retryAt.current) { setResult({ state: "unknown" }); return; }
    const controller = new AbortController();
    inFlight.current = controller;
    const stillCurrent = () => current() && !controller.signal.aborted && inFlight.current === controller;
    const unknown = { state: "unknown" } as const;
    setResult("checking");
    setHandoffSaved(undefined);
    setKeeping(keep);
    const keepCurrentReference = () => {
      if (keep && surface === "chat" && stillCurrent())
        setHandoffSaved(keepPrivateResearchWork(actorId, tenantId, reference));
    };
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
      let first = await status();
      if (!stillCurrent()) return;
      if (!await authority()) { if (stillCurrent()) setResult(unknown); return; }
      if (!stillCurrent()) return;
      if (resume && first.state === "pending") {
        // Fresh same-job inspection precedes the explicit mutation. This body
        // cannot carry a replacement question, approval or fresh request intent.
        try {
          const response = await supabase.functions.invoke("paige-ai-chat", {
            signal: controller.signal,
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: { threadId: reference.threadId, requestIntentId: reference.intentId,
              messages: [{ role: "user", content: "Resume original research" }],
              interactive: { kind: "message" }, researchResume: { workId: reference.workId } },
          });
          if (!stillCurrent()) return;
          const context = (response.error as { context?: Response } | null)?.context;
          if (context?.status === 429) {
            retryAt.current = Date.now() + chatControlRetryDelay(context.headers.get("Retry-After"));
            setResult(unknown); return;
          }
        } catch { /* UNKNOWN: inspect the same job once below, never repeat this mutation. */ }
        if (!await authority()) { if (stillCurrent()) setResult(unknown); return; }
        if (!stillCurrent()) return;
        first = await status();
        if (!stillCurrent()) return;
        if (!await authority()) { if (stillCurrent()) setResult(unknown); return; }
        if (!stillCurrent()) return;
      }
      if (first.state !== "verified") {
        if (first.state === "pending") keepCurrentReference();
        setResult(first); return;
      }
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
      const verified = authorized && last.state === "verified" && last.resultRef === first.resultRef &&
        last.receiptRef === first.receiptRef;
      if (verified) keepCurrentReference();
      setResult(verified
        ? { state: "verified", receiptRef: first.receiptRef, report: { ...report, saved: true } } : unknown);
    } catch { if (stillCurrent()) setResult(unknown); }
    finally {
      if (stillCurrent()) setKeeping(false);
      if (inFlight.current === controller) inFlight.current = null;
    }
  }

  return <section aria-label="Original research job" className="mt-3 border-t border-border pt-3">
    <Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal text-left"
      aria-disabled={result === "checking" || undefined} aria-busy={result === "checking" || undefined}
      onClick={() => void check()}>
      {result === "checking" ? "Checking research status…" : "Check original research status"}
    </Button>
    {result && result !== "checking" && result.state === "pending" &&
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">If research was interrupted, recover this job from its saved checkpoint. This does not start new research.</p>
        <Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal text-left"
          onClick={() => void check(true)}>Recover original research</Button>
      </div>}
    {result && result !== "checking" && (result.state === "verified" ? <div className="mt-2 space-y-2">
      <p role="status" className="break-words text-sm font-medium">Saved report and completion receipt verified at this check.</p>
      <p className="break-all text-xs text-muted-foreground">Original receipt {result.receiptRef}</p>
      <PaigeResearchCard result={result.report} />
    </div> : <p role="status" className="mt-2 text-sm text-muted-foreground">{labels[result.state]}</p>)}
    {surface === "chat" && (keeping || (result && result !== "checking" &&
      (result.state === "pending" || result.state === "verified"))) && <div className="mt-2 space-y-2">
        <Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full whitespace-normal text-left"
          aria-disabled={keeping || undefined} aria-busy={keeping || undefined}
          onClick={() => void check(false, true)}>{keeping ? "Checking original research…" : "Keep in Team Hub"}</Button>
        {handoffSaved !== undefined && <p role="status" className="text-xs text-muted-foreground">
          {handoffSaved ? "Saved in this tab. In Team Hub, open Saved PAIGE work."
            : "This tab could not save the reference. Try again."}
        </p>}
      </div>}
  </section>;
}
