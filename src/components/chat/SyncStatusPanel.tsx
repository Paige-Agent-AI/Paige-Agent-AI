import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export interface SyncStatus {
  success: boolean;
  scores_synced?: { equifax?: number | null; experian?: number | null; transunion?: number | null };
  negative_items_synced?: number;
  positive_accounts_synced?: number;
  disputes_created?: number;
  credit_factors_recalculated?: boolean;
  funding_readiness_recalculated?: boolean;
  /** On a failure, a sentence written for the person who uploaded the report, when `uploader_sentence`
   *  says so (R3b). An older server sent the pipeline's own text here instead; that is never drawn. */
  error?: string;
  /** Set by a server that writes `error` for the uploader. Without it a failure's `error` is not shown. */
  uploader_sentence?: boolean;
  /** The document was read and a proposal is waiting on a person. Not a failure. */
  awaiting_review?: boolean;
}

/** What the panel says when a failure's text was not written for the uploader: a frame from an older
 *  server, carrying the pipeline's own error. It is the server's did-not-finish sentence without the
 *  business's name (which the panel does not have), so it claims nothing about what was saved. */
export const SYNC_FAILURE_FALLBACK =
  "I read your report, but I couldn't finish pulling out its details for you to review. You can ask the team you're working with to take a look.";

interface SyncStatusPanelProps {
  syncStatus: SyncStatus | null;
  isLoading?: boolean;
}

export function SyncStatusPanel({ syncStatus, isLoading }: SyncStatusPanelProps) {
  if (isLoading) {
    return (
      <div className="bg-muted/30 border border-border rounded-lg p-3 mt-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Syncing credit data to your profile...</span>
        </div>
      </div>
    );
  }

  if (!syncStatus) return null;

  // AN EXTRACTION WAITING ON A PERSON IS NOT A FAILED SYNC, AND MUST NOT BE DRAWN AS ONE.
  //
  // This panel's contract is binary: `success` true renders "✅ Profile Sync Complete", false
  // renders "⚠️ Sync Incomplete" with six red crosses and the message prefixed "Error:". Since the
  // document path stopped auto-writing extracted fields, there is a third outcome — read
  // correctly, nothing saved, waiting on you — and it was arriving here as `success: false` and
  // being shown to the person as a six-way failure of something that had in fact worked.
  //
  // `success` stays false, because no sync happened and this panel's other readers are entitled to
  // that. What changes is only that the failure TREATMENT is not applied to a non-failure. The
  // sentence still renders, because on the client portal and the floating widget this panel is the
  // only surface that shows it — dropping it would trade a misleading message for a missing one.
  //
  // OWED TO CLAUDE DESIGN: this reuses the neutral container already defined for the loading state
  // in this file rather than introducing a new one. Whether "waiting on you" deserves its own
  // treatment — an icon, a colour, an affordance to act on it — is CD's call, not ours; what is
  // ours is that it must not be drawn as an error.
  if (syncStatus.awaiting_review) {
    if (!syncStatus.error) return null;
    return (
      <div className="bg-muted/30 border border-border rounded-lg p-3 mt-2">
        <div className="text-xs text-muted-foreground">{syncStatus.error}</div>
      </div>
    );
  }

  // Only a sentence the server marks as written for the uploader is drawn; anything else in `error` is
  // an older server's pipeline text, replaced by the fallback rather than shown.
  const failureText = syncStatus.error
    ? (syncStatus.uploader_sentence === true ? syncStatus.error : SYNC_FAILURE_FALLBACK)
    : undefined;
  const scores = syncStatus.scores_synced;
  const items = [
    {
      label: `Scores synced${scores ? ` — EQ: ${scores.equifax || '—'} | EX: ${scores.experian || '—'} | TU: ${scores.transunion || '—'}` : ''}`,
      ok: syncStatus.success && !!scores,
    },
    {
      label: `Negative items synced (${syncStatus.negative_items_synced || 0})`,
      ok: syncStatus.success,
    },
    {
      label: `Positive accounts synced (${syncStatus.positive_accounts_synced || 0})`,
      ok: syncStatus.success,
    },
    {
      label: `Disputes created (${syncStatus.disputes_created || 0})`,
      ok: syncStatus.success,
    },
    {
      label: "Credit factors recalculated",
      ok: syncStatus.credit_factors_recalculated === true,
    },
    {
      label: "Funding readiness updated",
      ok: syncStatus.funding_readiness_recalculated === true,
    },
  ];

  return (
    <div className={`border rounded-lg p-3 mt-2 ${syncStatus.success ? 'bg-fundability-excellent/5 border-fundability-excellent/30' : 'bg-destructive/5 border-destructive/30'}`}>
      <div className="text-xs font-semibold mb-2 text-foreground">
        {syncStatus.success ? '✅ Profile Sync Complete' : '⚠️ Sync Incomplete'}
      </div>
      <div className="space-y-1">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {item.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-fundability-excellent flex-shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />
            )}
            <span className={item.ok ? 'text-foreground' : 'text-destructive'}>{item.label}</span>
          </div>
        ))}
      </div>
      {failureText && <div className="mt-2 text-xs text-destructive">{failureText}</div>}
    </div>
  );
}
