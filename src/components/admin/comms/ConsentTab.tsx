// Comms C-2s-C — email consent-enforcement toggle. Extends the CommunicationsAdmin hub as
// its "Consent" tab (§18: one home per capability — the tenant comms hub already exists at
// /admin/communications; no redundant settings surface is scaffolded, exactly as NumbersTab /
// A2PTab did in the earlier C-2 surface slices).
//
// WHAT IT DOES: a single per-tenant switch that reads/writes
// tenant_comms_preferences.email_consent_enforced. When ON, a follow-up wiring of the pre-send
// pipeline will require an explicit consent record before Paige emails a client — the higher
// bar for tenants with EU/UK/CA/AU audiences (where opt-in is legally required) or as a
// deliverability play. OFF by default: US email is opt-out (CAN-SPAM), and the consent ledger
// starts empty, so turning it on before consent is seeded would block a tenant's own mail —
// the helper copy says exactly that (§13/§36 honest, plain-language framing).
//
// §9: the flag lives on the tenant's OWN tenant_comms_preferences row; the row's tenant_id is
// set SERVER-SIDE by the table's BEFORE-INSERT trigger from current_user_tenant_id() — this
// client NEVER sends a tenant_id. The read is RLS-scoped to the caller's tenant; the write on an
// existing row is filtered by the tenant_id we read back (RLS already guards it), and a first
// write inserts a row and lets the trigger stamp the tenant (mirrors SnippetsTab/SignaturesTab).
// §11: a plain toggle is NOT an act/approve/on moment, so it writes on change with an optimistic
// update + honest revert-on-error — NO gold Save button. Rings stay indigo; tokens only.
// §2: coaching-generic — zero finance/credit vocabulary in any label or helper copy.
//
// tenant_comms_preferences isn't in the generated types, so its read/write go through
// (supabase as any) with the eslint-disable, matching the NumbersTab / A2PTab pattern.
import { useCallback, useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SectionCard, GlyphPlate } from "@/components/ui/page";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/** The one field this surface owns on tenant_comms_preferences (not in generated types). */
interface CommsPrefsRow {
  tenant_id: string;
  email_consent_enforced: boolean;
}

export function ConsentTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enforced, setEnforced] = useState(false);
  // The tenant_id of the caller's existing row (if any) — used only as the UPDATE filter so a
  // write targets exactly that row; never sent on INSERT (the trigger stamps it, §9).
  const [rowTenantId, setRowTenantId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // RLS scopes this to the caller's own tenant (§9); .limit(1) guards the one case where a
    // platform-owner's select policy spans >1 row so maybeSingle() takes the first instead of
    // erroring. No row yet → the flag defaults false (matches the column default).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("tenant_comms_preferences")
      .select("tenant_id, email_consent_enforced")
      .limit(1)
      .maybeSingle();
    const row = (data as CommsPrefsRow | null) ?? null;
    setEnforced(Boolean(row?.email_consent_enforced));
    setRowTenantId(row?.tenant_id ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      // Optimistic — reflect the intent immediately, revert honestly if the write fails (§13).
      const prev = enforced;
      setEnforced(next);
      setSaving(true);
      try {
        if (rowTenantId) {
          // Existing row — update exactly it. RLS + this filter both scope to the tenant (§9).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (supabase as any)
            .from("tenant_comms_preferences")
            .update({ email_consent_enforced: next })
            .eq("tenant_id", rowTenantId);
          if (error) throw error;
        } else {
          // First write for this tenant — INSERT; the BEFORE-INSERT trigger stamps tenant_id
          // server-side, so we never pass it (§9). Then re-read to capture the new tenant_id.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any)
            .from("tenant_comms_preferences")
            .insert({ email_consent_enforced: next })
            .select("tenant_id")
            .maybeSingle();
          if (error) throw error;
          setRowTenantId((data as { tenant_id: string } | null)?.tenant_id ?? null);
        }
        toast({
          title: next ? "Consent required for email" : "Consent no longer required for email",
          description: next
            ? "Paige will only email clients who've given explicit consent."
            : "Paige will email clients per standard opt-out rules.",
        });
      } catch {
        setEnforced(prev); // revert — the switch shows the real persisted state, never a hoped-for one
        toast({
          title: "Couldn't save that setting",
          description: "Give it another moment and try again.",
          variant: "destructive",
        });
      } finally {
        setSaving(false);
      }
    },
    [enforced, rowTenantId, toast],
  );

  return (
    <div className="space-y-6">
      <SectionCard
        title="Email consent"
        description="Control the bar Paige clears before emailing your clients."
      >
        {loading ? (
          <div className="h-20 animate-pulse rounded-lg bg-muted/50 motion-reduce:animate-none" />
        ) : (
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <GlyphPlate icon={MailCheck} size="sm" ring="indigo" className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <Label htmlFor="email-consent-enforced" className="text-sm font-medium">
                  Require explicit consent before emailing clients
                </Label>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Off by default — Paige emails your clients under standard opt-out rules. This
                  setting records that you want the higher bar (explicit opt-in, expected for
                  clients in the EU, UK, Canada or Australia).
                </p>
                {/* §13 (E09 Slice 6, D8): the pre-send gate does not read this flag yet. Say so. */}
                <p className="mt-2 text-xs leading-relaxed text-foreground" data-testid="consent-enforcement-truth">
                  It doesn't change sends yet: Paige still emails under opt-out rules whether it's on or off.
                </p>
              </div>
            </div>
            {/* Plain toggle — writes on change, no gold act (§11). Ring is indigo via the primitive. */}
            <Switch
              id="email-consent-enforced"
              checked={enforced}
              disabled={saving}
              onCheckedChange={(v) => void handleToggle(v)}
              aria-label="Require explicit consent before emailing clients"
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}
