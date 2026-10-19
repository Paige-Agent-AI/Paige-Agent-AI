/* eslint-disable @typescript-eslint/no-explicit-any -- pre-existing legacy `any` debt in this
   file (untyped Supabase reads, stale generated types). The E09 Customer Portal identity change
   (CURA, never PAIGE, on customer surfaces) only edited copy here and introduced ZERO new `any`s;
   retyping is tracked separately (#234). */
import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Upload, Search, FileText, Building2, Target, X, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "@/hooks/useAnalytics";
import { useTenantFeature } from "@/hooks/useTenantFeature";
import { useCustomerIdentity } from "@/lib/portal/customerIdentity";

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  route: string;
  check: () => Promise<boolean>;
}

/**
 * `financePortal` (E09 F2, from the /app shell's one answer): the viewer's business is finance-entitled (or the
 * viewer is staff, Q5). The credit-first steps need it AND `funding_readiness`; without it every viewer gets the
 * neutral steps. Defaults to false, so a mount that does not know never shows credit steps.
 */
export const OnboardingChecklist = ({ userId, financePortal = false }: { userId: string; financePortal?: boolean }) => {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Credit/funding onboarding steps are opt-in per tenant (§2/§9). Fail-closed:
  // a coaching-generic tenant never sees credit-report/business-credit steps;
  // it gets a neutral, coaching-generic checklist instead. Only a tenant that
  // turned on the funding preset gets the credit-building steps.
  const { enabled: fundingReadiness, loading: featureLoading } = useTenantFeature("funding_readiness");
  const fundingEnabled = fundingReadiness && financePortal;
  // The customer's agent (Cura, or the business's own name for it). Never PAIGE, the owner's COO.
  const { agentName: coachName, frame } = useCustomerIdentity();
  // A customer's own Documents scope (E09 F2): their business and their record there, from the frame — exactly what
  // useClientDocuments reads, so a file they upload on /app/documents ticks this step (§70).
  const documentScope = frame ? { tenant: frame.profile.tenant_id, contact: frame.profile.id, actor: frame.actorId } : null;
  const scopeKey = documentScope ? `${documentScope.tenant}:${documentScope.contact}:${documentScope.actor}` : "";

  const items: ChecklistItem[] = useMemo(() => {
    if (fundingEnabled) {
      return [
        {
          id: "upload_report",
          label: "Upload a Credit Report",
          description: "Upload your first credit report to see your insights",
          icon: Upload,
          route: "/app/credit",
          check: async () => {
            const { count } = await supabase
              .from("credit_report_uploads")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId);
            return (count ?? 0) > 0;
          },
        },
        {
          id: "review_accounts",
          label: "Review Your Accounts",
          description: "Check your tradelines and account details across all bureaus",
          icon: Search,
          route: "/app/credit",
          check: async () => {
            const { count } = await supabase
              .from("credit_accounts")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId);
            return (count ?? 0) > 0;
          },
        },
        // [§194] "Start Your First Dispute" step removed — monitoring-only surface.
        {
          id: "add_business",
          label: "Set Up Your Business Profile",
          description: "Add your business to start building business credit",
          icon: Building2,
          route: "/app/business",
          check: async () => {
            const { count } = await supabase
              .from("businesses")
              .select("id", { count: "exact", head: true })
              .eq("owner_user_id", userId);
            return (count ?? 0) > 0;
          },
        },
      ];
    }

    // Coaching-generic default (every tenant that hasn't opted into funding).
    // Uses only universal, tenant-agnostic tables (profiles / client_goals /
    // documents) and real client routes (/app/settings, /app/documents) — the
    // same ones ClientHomeTiles relies on for coaching clients.
    return [
      {
        id: "complete_profile",
        label: "Complete Your Profile",
        description: "Add your name and contact details so we can personalize your experience",
        icon: FileText,
        route: "/app/settings",
        check: async () => {
          const { data } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", userId)
            .maybeSingle();
          return !!data?.full_name?.trim();
        },
      },
      {
        id: "set_goal",
        label: "Set Your First Goal",
        description: `Tell ${coachName} what you're working toward. ${coachName} will help you map the path.`,
        icon: Target,
        route: "/app/settings",
        check: async () => {
          const { count } = await supabase
            .from("client_goals" as any)
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId);
          return (count ?? 0) > 0;
        },
      },
      {
        id: "upload_document",
        label: "Upload Your First Document",
        description: "Keep your important files in one place for easy reference",
        icon: FileText,
        // Documents, where the business's shared files live; not the funding business profile (§2).
        route: "/app/documents",
        check: async () => {
          if (documentScope) {
            // The customer's own saved uploads in their Documents (client_files, upload_state 'ready'): the same
            // business and record /app/documents saves to. Row-level security also limits this to their own.
            const { count } = await supabase
              .from("client_files" as any)
              .select("id", { count: "exact", head: true })
              .eq("tenant_id", documentScope.tenant)
              .eq("contact_id", documentScope.contact)
              .eq("uploaded_by_user_id", documentScope.actor)
              .eq("upload_state", "ready");
            return (count ?? 0) > 0;
          }
          // Not a customer of one business (staff viewing /app, no active access): the legacy count, unchanged (§58).
          const { count } = await supabase
            .from("documents" as any)
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId);
          return (count ?? 0) > 0;
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- documentScope is keyed by scopeKey
  }, [fundingEnabled, userId, coachName, scopeKey]);

  const firedStepsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Wait for the tenant funding flag to resolve before checking, so a funding
    // tenant is never briefly measured against the coaching-generic step set
    // (the flag is fail-closed while loading).
    if (featureLoading) return;

    const dismissKey = `onboarding_dismissed_${userId}`;
    if (localStorage.getItem(dismissKey) === "true") {
      setDismissed(true);
      setLoading(false);
      return;
    }

    const checkAll = async () => {
      const results: Record<string, boolean> = {};
      await Promise.all(
        items.map(async (item) => {
          try {
            results[item.id] = await item.check();
          } catch {
            results[item.id] = false;
          }
        })
      );

      // Fire onboarding_step_complete once per newly-completed step (per browser/user).
      const firedKey = `onboarding_steps_fired_${userId}`;
      const alreadyFired: string[] = JSON.parse(localStorage.getItem(firedKey) || "[]");
      const firedSet = new Set(alreadyFired);
      items.forEach((item, idx) => {
        if (results[item.id] && !firedSet.has(item.id)) {
          firedSet.add(item.id);
          firedStepsRef.current.add(item.id);
          void trackEvent("onboarding_step_complete", "activation", {
            step: item.id,
            step_label: item.label,
            step_number: idx + 1,
          });
        }
      });
      localStorage.setItem(firedKey, JSON.stringify(Array.from(firedSet)));

      setCompleted(results);
      setLoading(false);

      // Auto-dismiss if all complete
      if (Object.values(results).every(Boolean)) {
        localStorage.setItem(dismissKey, "true");
        setDismissed(true);
      }
    };
    checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, fundingEnabled, featureLoading, scopeKey]);

  if (dismissed || loading) return null;

  const completedCount = Object.values(completed).filter(Boolean).length;
  const progress = (completedCount / items.length) * 100;

  return (
    <Card className="border-accent/20 bg-gradient-to-br from-accent/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <CardTitle className="text-base">Getting Started</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => {
              localStorage.setItem(`onboarding_dismissed_${userId}`, "true");
              setDismissed(true);
            }}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-3 mt-1">
          {/* Track on muted: the Progress default track (--secondary) is near-black in light, so 0/3 read as a full bar (round 3 render). */}
          <Progress value={progress} className="h-1.5 flex-1 bg-muted" />
          <span className="text-xs text-muted-foreground font-medium">{completedCount}/{items.length}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {items.map((item) => {
          const done = completed[item.id];
          return (
            <button
              key={item.id}
              onClick={() => !done && navigate(item.route)}
              className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all ${
                done
                  ? "opacity-60"
                  : "hover:bg-accent/5 cursor-pointer"
              }`}
              disabled={done}
            >
              {done ? (
                <CheckCircle2 className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-muted-foreground/40 mt-0.5 flex-shrink-0" />
              )}
              <div>
                <p className={`text-sm font-medium ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                  {item.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
};
