import { useEffect, useId, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantContext } from "@/hooks/useTenantContext";
import { readBusinessTimeZone } from "@/solo/data/useBusinessTimeZone";
import { keepPrivateOpportunity, type PrivateOpportunityReference } from "@/lib/privateDocumentWorkHandoff";
import { workspaceLinkTarget } from "@/lib/links/workspaceLinks";

type Receipt = { correlation: string; recordedAt: string; savedVersion: number; currentVersion: number };
type Props = { dealId: string; correlationId: string; accountNumber: string | number; surface?: "chat" | "team-hub" };
const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const uuid = (v: unknown) => typeof v === "string" && v.length === 36
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v.toLowerCase() : null;

function parseReceipt(data: unknown, dealId: string, correlation: string): Receipt | null {
  const answer = object(data), r = object(answer?.receipt);
  if (answer?.ok !== true || answer.outcome !== "recorded" || r?.action !== "deal.update"
    || uuid(r.correlation_id) !== correlation || uuid(r.record_id) !== dealId
    || !Number.isInteger(r.result_version) || Number(r.result_version) < 1
    || !Number.isInteger(answer.current_version) || Number(answer.current_version) < Number(r.result_version)
    || typeof r.recorded_at !== "string" || !Number.isFinite(Date.parse(r.recorded_at))) return null;
  return { correlation, recordedAt: r.recorded_at, savedVersion: Number(r.result_version), currentVersion: Number(answer.current_version) };
}

/** A disclosure of the original receipt, never a retry or approval control. */
export function OpportunityResultReceipt(props: Props) {
  const scope = useTenantContext();
  if (scope.accountContextLoading || scope.accountContextStatus !== "ready" || !scope.activeUserId
    || !scope.activeTenantId || scope.activeTenant?.id !== scope.activeTenantId
    || String(scope.activeTenant.account_number) !== String(props.accountNumber)) return null;
  return <CurrentReceipt key={`${scope.activeUserId}:${scope.activeTenantId}:${props.dealId}:${props.correlationId}`}
    {...props} tenantId={scope.activeTenantId} actorId={scope.activeUserId} />;
}

export function SavedOpportunityResult({ reference, actorId, tenantId }: {
  reference: PrivateOpportunityReference; actorId: string; tenantId: string;
}) {
  const scope = useTenantContext();
  if (scope.activeUserId !== actorId || scope.activeTenantId !== tenantId || !scope.activeTenant
    || scope.activeTenant.account_number == null) return null;
  return <OpportunityResultReceipt dealId={reference.dealId} correlationId={reference.correlationId}
    accountNumber={scope.activeTenant.account_number} surface="team-hub" />;
}

function CurrentReceipt({ dealId, correlationId, tenantId, actorId, accountNumber, surface = "chat" }: Props & { tenantId: string; actorId: string }) {
  const [state, setState] = useState<{ kind: "closed" | "loading" | "error" | "ready"; receipt?: Receipt; zone?: string; notice?: string }>({ kind: "closed" });
  const [kept, setKept] = useState<boolean>();
  const request = useRef(0), alive = useRef(true), pending = useRef(false), abort = useRef<AbortController | null>(null);
  const sectionId = useId();
  useEffect(() => {
    const mounted = alive, sequence = request, pendingRead = abort;
    mounted.current = true;
    return () => { mounted.current = false; sequence.current++; pendingRead.current?.abort(); };
  }, []);
  const close = () => {
    request.current++; abort.current?.abort(); pending.current = false; setState({ kind: "closed" }); setKept(undefined);
  };
  const read = async () => {
    if (pending.current) return;
    pending.current = true;
    setKept(undefined);
    const id = ++request.current, controller = new AbortController(); abort.current = controller;
    const timeout = setTimeout(() => {
      controller.abort();
      if (alive.current && request.current === id) {
        request.current++; pending.current = false;
        setState({ kind: "error", notice: "The receipt check timed out. You can check again; no update was run." });
      }
    }, 15_000);
    setState({ kind: "loading" });
    try {
      const answer = await supabase.functions.invoke("crm-command", { body: { expected_tenant_id: tenantId,
        inspect_opportunity_result: { deal_id: dealId, correlation_id: correlationId } }, signal: controller.signal });
      if (!alive.current || request.current !== id) return;
      let data: unknown = answer.data;
      if (answer.error && "context" in answer.error && answer.error.context instanceof Response) {
        try { data = await answer.error.context.json(); } catch { data = null; }
      }
      if (!alive.current || request.current !== id) return;
      const receipt = controller.signal.aborted ? null : parseReceipt(data, dealId, correlationId);
      if (receipt) {
        setState({ kind: "ready", receipt, zone: "UTC" });
        // Optional clock formatting never holds the original receipt hostage.
        // Late workspace/user responses still belong to this retired read only.
        void readBusinessTimeZone(tenantId).then(timeZone => {
          if (!alive.current || request.current !== id) return;
          const zone = timeZone.status === "ready" && timeZone.value.state === "configured" ? timeZone.value.zone : null;
          if (zone) setState({ kind: "ready", receipt, zone });
        }).catch(() => { /* The explicit UTC time remains truthful. */ });
      } else {
        const outcome = object(data)?.outcome;
        setState({ kind: "error", notice: outcome === "refused"
          ? "This receipt isn't available with your current workspace access."
          : outcome === "not_found" ? "The original receipt wasn't found. This check didn't run an update."
          : "Couldn't check the original receipt. Try the read again; no update was run." });
      }
    } catch {
      if (alive.current && request.current === id) setState({ kind: "error", notice: "Couldn't check the original receipt. Try the read again; no update was run." });
    } finally {
      clearTimeout(timeout);
      if (request.current === id) pending.current = false;
    }
  };
  const open = state.kind !== "closed", receipt = state.receipt;
  const target = workspaceLinkTarget({ destination: "pipeline", record_id: dealId },
    { account_type: "standalone", parent_tenant_id: null, account_number: accountNumber });
  let recorded = "";
  if (receipt) {
    const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "long", timeZone: state.zone || "UTC" };
    try { recorded = new Intl.DateTimeFormat(undefined, options).format(new Date(receipt.recordedAt)); }
    catch { recorded = new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(new Date(receipt.recordedAt)); }
  }
  const control = "inline-flex min-h-9 items-center rounded-sm py-1 text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return <div className="mt-1 min-w-0">
    <button type="button" className={control} aria-expanded={open} aria-controls={sectionId} onClick={open ? close : () => { void read(); }}>
      {open ? "Hide receipt" : "View saved receipt"}
    </button>
    {open && <div id={sectionId} className="min-w-0 space-y-2" aria-busy={state.kind === "loading"}>
      {state.kind === "loading" && <p role="status" className="text-sm text-muted-foreground">Checking the original receipt…</p>}
      {state.kind === "error" && <>
        <p role="alert" className="text-sm text-muted-foreground">{state.notice}</p>
        <button type="button" className={control} onClick={() => { void read(); }}>Check receipt again</button>
      </>}
      {state.kind === "ready" && receipt && <div role="status" className="min-w-0 space-y-1 text-sm">
        <p className="font-medium">Original update receipt</p>
        <p>Saved version {receipt.savedVersion} · current version {receipt.currentVersion}</p>
        <p className="text-muted-foreground">Recorded <time dateTime={receipt.recordedAt}>{recorded}</time></p>
        <p className="text-xs text-muted-foreground">Receipt reference</p>
        <p className="break-words text-xs text-muted-foreground">{receipt.correlation}</p>
        {target?.status === "exact" && <a className={control} href={target.to}>{target.label}</a>}
        {surface === "chat" && <>
          <button type="button" className={control} onClick={() => setKept(keepPrivateOpportunity(actorId, tenantId, dealId, correlationId))}>
            Keep in Team Hub
          </button>
          {kept !== undefined && <p role="status" className="text-sm text-muted-foreground">{kept
            ? "Kept privately in this tab's Team Hub. Your last kept reference was replaced."
            : "Couldn't keep this reference. The original update and receipt are unchanged."}</p>}
        </>}
      </div>}
    </div>}
  </div>;
}
