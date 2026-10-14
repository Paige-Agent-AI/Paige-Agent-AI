import { useId } from "react";

import { CheckLinks } from "@/components/chat/CheckLinks";
import { workspaceLinkTargets, type WorkspaceLinkTenant } from "@/lib/links/workspaceLinks";
import type { ReadRecordLink } from "../../../supabase/functions/_shared/paige-turn/record-links";

/**
 * Experience 04 E4-S3 — "See it, then verify it". The records an answer drew on, beside the answer, so
 * the owner can open them and check. A way to verify, never a claim of change: no check mark, no
 * "updated", no state pill, and no gold (gold is spent on Approve alone). The links reuse the approval
 * card's renderer unchanged; this row only adds its own lead line and spacing.
 *
 * The addresses are built here, from the CURRENT account (the turn stores references only), and the
 * destination re-reads the record under its own session — so a reload, an account switch or a tier
 * that mounts no such surface simply shows fewer links, or none.
 */
export function PaigeRecordLinks({ links, account }: { links: readonly ReadRecordLink[]; account: WorkspaceLinkTenant | null | undefined }) {
  const leadId = useId();
  const targets = workspaceLinkTargets(links, account);
  if (!targets.length) return null;
  // A group, not a navigation landmark: every answer with links would otherwise add another identical
  // landmark to the transcript. Its name IS the visible lead line, so what is heard is what is shown.
  return (
    <div
      role="group"
      aria-labelledby={leadId}
      data-paige-record-links=""
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 [&>a]:min-h-6 [&>a]:py-1"
    >
      <span id={leadId} className="text-xs text-muted-foreground">See it in your workspace</span>
      <CheckLinks links={targets} />
    </div>
  );
}
