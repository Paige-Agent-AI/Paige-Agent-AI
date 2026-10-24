import { CheckCircle2, ExternalLink } from "lucide-react";
import { workspaceLinkTarget, workspaceLinkTier, type WorkspaceLinkTenant } from "@/lib/links/workspaceLinks";
import { crmResultRecordReference, type CrmResultMetadata } from "../../../supabase/functions/_shared/paige-turn/crm-result-reference";

export type PaigeCrmResult = CrmResultMetadata & {
  readback?: Record<string, unknown> | null;
  record_locator?: {
    record_id?: string | null;
    surface_url?: string | null;
    deep_link?: string | null;
    deep_link_status?: "exact" | "surface_only" | "unavailable" | string;
  } | null;
  external_effect?: boolean;
};

export function PaigeCrmResultCard({ result, account }: { result: PaigeCrmResult; account?: WorkspaceLinkTenant | null }) {
  const absent = result.readback?.absent === true;
  // A create is a new record, so it reads "Added" — "Updated: contact create" described an edit
  // that never happened (owner ruling, 2026-09-26). Every *.create the executor runs inserts a new
  // row, and contact.create refuses outright when the contact already existed, so this is true
  // whenever the receipt is shown.
  const created = !absent && result.action.endsWith(".create");
  const label = result.action.replace(/\./g, " ");
  const soloTaskOrDeal = workspaceLinkTier(account) === "solo" && /^(task|deal)\./.test(result.action);
  const projected = crmResultRecordReference(result);
  // New Task/Deal history recovery is Solo-only; other live tiers keep their
  // incumbent native locator contract, without adopting a new Work reference.
  const reference = result.action.startsWith("contact.") || soloTaskOrDeal ? projected : null;
  const target = reference ? workspaceLinkTarget(reference, account) : null;
  // The history reader never hydrates locators. Managed Solo references always
  // rebuild addresses from the current workspace, never a stored/live URL.
  const liveLocator = !result.action.startsWith("contact.") && !soloTaskOrDeal ? result.record_locator : null;
  const href = target?.to || liveLocator?.deep_link || liveLocator?.surface_url || null;
  const exact = target?.status === "exact" || (!target && liveLocator?.deep_link_status === "exact");
  const record = String(reference?.subject || result.readback?.client_ref || result.readback?.title || result.record_locator?.record_id || "CRM record");
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30 p-3" data-paige-crm-result>
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium capitalize">{created ? "Added" : `${absent ? "Removed" : "Updated"}: ${label}`}</p>
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{record}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.receipt_recorded ? "Recorded in Paige activity." : "Receipt was not confirmed."}
            {result.action === "activity.log" && result.external_effect === false ? " Logged internally only; nothing was sent or called." : ""}
          </p>
          {href && (
            <a className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline" href={href}>
              {target && soloTaskOrDeal ? (reference?.destination === "operations_work" && !exact ? "Open Work" : target.label)
                : exact ? "Open exact record" : "Open CRM surface"}<ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
