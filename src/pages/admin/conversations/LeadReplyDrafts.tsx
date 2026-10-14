import { useEffect, useState } from "react";
import { usePendingApprovals, type ApprovalQueueRow } from "@/hooks/usePendingApprovals";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

/** A contextual entry to the existing composer; the approval queue remains the draft's home. */
export function LeadReplyDrafts({ tenantId, contactId, onEdit, disabled }: {
  tenantId: string;
  contactId: string;
  onEdit: (approval: ApprovalQueueRow, draft: { subject: string; body: string }) => void;
  disabled: boolean;
}) {
  const approvals = usePendingApprovals({ contactId });
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => {
    let current = true;
    setCanEdit(false);
    void (async () => {
      const { data, error } = await supabase.rpc("is_tenant_admin" as never, { _tenant: tenantId } as never);
      if (current) setCanEdit(!error && data === true);
    })();
    return () => { current = false; };
  }, [tenantId]);
  const drafts = approvals.items.filter((a) => a.tenant_id === tenantId && a.contact_id === contactId && a.status === "pending" && a.category === "owner.lead_followup");
  if (approvals.error) return <p role="status" className="text-sm text-muted-foreground">Reply drafts couldn't load. <button type="button" className="underline" onClick={() => { void approvals.refresh(); }}>Try again</button></p>;
  if (!drafts.length) return null;
  return <section aria-label="PAIGE lead replies" className="space-y-3 border-t border-border pt-3">
    {drafts.map((approval) => {
      const raw: unknown = approval.draft_content;
      const draft = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
      const ready = draft?.channel === "email" && typeof draft.subject === "string" && draft.subject.trim() && typeof draft.body === "string" && draft.body.trim();
      return <div key={approval.id} className="space-y-2">
        <p className="text-sm font-medium">{ready ? "PAIGE prepared a reply" : "Reply draft needs attention"}</p>
        {ready ? <>
          <p className="break-words text-sm text-muted-foreground">{draft.subject as string}</p>
          {canEdit ? <Button variant="outline" size="sm" disabled={disabled} onClick={() => onEdit(approval, { subject: draft.subject as string, body: draft.body as string })}>Edit and review reply</Button>
            : <p className="text-xs text-muted-foreground">An owner or admin can review and approve this reply.</p>}
        </> : <p className="text-sm text-muted-foreground">No complete email draft is available. Nothing was sent by this draft.</p>}
      </div>;
    })}
  </section>;
}
