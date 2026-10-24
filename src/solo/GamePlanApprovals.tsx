// @ts-nocheck
// GamePlanApprovals — the owner's "what needs my yes" running list, embedded in the
// Business Game Plan rail (the owner's compact-UI ruling, 2026-09-11: no additional
// subtabs — capability lives where the user already is). A dismissible card: hide
// the log and it stays hidden until NEW work lands (dismissal is a visual affordance,
// never a data mutation — the queue itself is untouched).
//
// USER-RELEVANCE (owner ruling, 2026-09-11): the list is scoped to the signed-in
// user — items assigned to them, the general (unassigned) queue, and items whose
// requires_role / visible_to_roles match their tenant role. A sales hire sees the
// sales desk's work; support sees support; the header says whose desk this is.
//
// §18 one home: each row is the proven ApprovalRow (approve-and-acts via the
// execute-approval seam; decline records the reviewer's reason). This component
// owns only the embedding: the dismissible frame, viewer scoping, the states, and
// the returns-when-new-work-lands contract.
import React, { useEffect, useRef, useState } from "react";
import { BellRing, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePendingApprovals, isNativeOwnerTaskApproval } from "@/hooks/usePendingApprovals";
import { useTenantContext } from "@/hooks/useTenantContext";
import { ApprovalRow } from "@/components/paige/ApprovalRow";

/** Row fields the queue view carries beyond the typed projection (defensive: absent = unscoped). */
type RoleFields = { assigned_to_user_id?: string | null; requires_role?: string | null; visible_to_roles?: string[] | string | null };

export function GamePlanApprovals() {
  const { items, loading, error, refresh } = usePendingApprovals();
  const { activeTenantId, activeUserId } = useTenantContext();
  const [seat, setSeat] = useState<{tenant:string;user:string;role:string|null}|null>(null);
  const myRole=seat?.tenant===activeTenantId && seat?.user===activeUserId ? seat.role:null;

  // Resolve the viewer's tenant role once per workspace — the relevance lane key.
  useEffect(() => {
    let alive = true;
    setSeat(null);
    if (!activeTenantId || !activeUserId) return;
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("tenant_members")
          .select("role")
          .eq("tenant_id", activeTenantId)
          .eq("user_id", activeUserId)
          .eq("status", "active")
          .maybeSingle();
        if (alive) setSeat({tenant:activeTenantId,user:activeUserId,role:error?null:(data as { role?: string } | null)?.role ?? null});
      } catch {
        if(alive) setSeat(null);
      }
    })();
    return () => { alive = false; };
  }, [activeTenantId, activeUserId]);

  // Viewer-relevant items: assigned to me, the general queue, or role-targeted at me.
  const relevant = items.filter((a) => {
    // Same narrow native family as the server's ordinary-seat exception. Never
    // translate an owner seat into a global admin for unrelated approval types.
    if(isNativeOwnerTaskApproval(a)) return a.tenant_id===activeTenantId && ["owner","admin"].includes(myRole ?? "");
    const r = a as RoleFields;
    if (r.assigned_to_user_id) return r.assigned_to_user_id === activeUserId;
    if (r.requires_role) return r.requires_role === myRole;
    if (Array.isArray(r.visible_to_roles) && r.visible_to_roles.length) return r.visible_to_roles.includes(myRole ?? "");
    return true; // unscoped = the general queue this owner/coach can act on
  });
  const roleTargeted = relevant.some((a) => !!(a as RoleFields).requires_role);

  // Dismissal contract: remember the count at dismissal; the card returns the moment
  // the queue GROWS (a new draft landed). Hiding is session-local — no data changes.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const prevCount = useRef<number | null>(null);

  useEffect(() => {
    if (prevCount.current !== null && relevant.length > prevCount.current) setDismissedAt(null);
    prevCount.current = relevant.length;
  }, [relevant.length]);

  if (loading) return null; // the rail stays quiet while resolving — no phantom card
  if (dismissedAt !== null && relevant.length <= dismissedAt) return null;
  if (error) {
    return (
      <section className="sd-card" aria-label="Approvals">
        <div className="sd-card-hd"><span className="sd-eyebrow"><BellRing /> Approvals</span></div>
        <div className="sd-todo"><span>Couldn't load your approvals right now.</span>
          <button className="sd-btn sd-btn-sm" onClick={() => void refresh()}>Retry</button>
        </div>
      </section>
    );
  }
  if (relevant.length === 0) return null; // quiet when nothing needs this viewer

  const onResolved = () => { void refresh(); };

  return (
    <section className="sd-card" aria-label={`Approvals — ${relevant.length} waiting for you`}>
      <div className="sd-card-hd">
        <span className="sd-eyebrow">
          <BellRing /> Waiting on you — {relevant.length}{roleTargeted && myRole ? ` · ${myRole} desk` : ""}
        </span>
        <button
          type="button"
          className="oh-x"
          aria-label="Hide the approvals list until new work lands"
          onClick={() => setDismissedAt(relevant.length)}
        >
          <X />
        </button>
      </div>
      <p className="gp-ap-note">Actions Paige's team prepared for you{myRole ? ` (${myRole})` : ""}. Approve the reviewed action; decline with a reason when it needs to change.</p>
      <div className="gp-ap-list">
        {relevant.map((a) => (
          <ApprovalRow key={a.id} a={a} showDecline onResolved={onResolved} />
        ))}
      </div>
    </section>
  );
}
