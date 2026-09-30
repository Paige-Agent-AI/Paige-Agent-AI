import { CheckCircle2, ExternalLink } from "lucide-react";

export type PaigeCrmResult = {
  action: string;
  outcome: string;
  readback: Record<string, unknown> | null;
  receipt_recorded: boolean;
  record_locator: {
    record_id?: string | null;
    surface_url?: string | null;
    deep_link?: string | null;
    deep_link_status?: "exact" | "surface_only" | "unavailable" | string;
  } | null;
  external_effect?: boolean;
};

export function PaigeCrmResultCard({ result }: { result: PaigeCrmResult }) {
  const absent = result.readback?.absent === true;
  // A create is a new record, so it reads "Added" — "Updated: contact create" described an edit
  // that never happened (owner ruling, 2026-09-26). Every *.create the executor runs inserts a new
  // row, and contact.create refuses outright when the contact already existed, so this is true
  // whenever the receipt is shown.
  const created = !absent && result.action.endsWith(".create");
  const label = result.action.replace(/\./g, " ");
  const href = result.record_locator?.deep_link || result.record_locator?.surface_url || null;
  const exact = result.record_locator?.deep_link_status === "exact";
  const record = String(result.readback?.client_ref || result.readback?.title || result.record_locator?.record_id || "CRM record");
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
              {exact ? "Open exact record" : "Open CRM surface"}<ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}