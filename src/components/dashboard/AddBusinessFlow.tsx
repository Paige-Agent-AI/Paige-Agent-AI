import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useNavigate } from "react-router-dom";
import { Building2, Sparkles, ArrowRight, Lock, Upload } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  useBusinessContext,
  entityRoleLabel,
  ENTITY_ROLE_LABELS,
} from "@/contexts/BusinessContext";
import { useAssistantName } from "@/lib/portal/customerIdentity";

/**
 * AddBusinessFlow — three-step modal for adding a business entity.
 *
 *  1. Limit gate — if user is at their plan limit, show upgrade / add-slot CTAs.
 *  2. Details form — collects everything we need to populate the entity profile.
 *  3. Confirmation — points the user at uploading a business credit report.
 *
 * Mounts the AddBusinessSlotPaywall sub-component for purchasing extra slots
 * (Stripe wiring is staged for Part 4 — UI is built but the checkout call
 * is gated behind a soft warning if the price ID isn't configured yet).
 */

const formSchema = z.object({
  legal_name: z.string().min(1, "Legal name is required").max(255),
  entity_type: z.enum(["llc", "corporation", "s_corp", "c_corp", "partnership", "sole_proprietorship"]),
  entity_role: z.enum([
    "holdco",
    "opco",
    "asset_co",
    "management_co",
    "real_estate_co",
    "media_co",
    "other",
  ]),
  ein: z.string().optional(),
  state_of_formation: z.string().max(2).optional(),
  formation_date: z.string().optional(),
  is_subsidiary: z.boolean().default(false),
  parent_business_id: z.string().optional(),
  website: z.string().optional(),
  revenue_band: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const REVENUE_BANDS = [
  { value: "pre_revenue", label: "Pre-revenue" },
  { value: "under_50k", label: "Under $50K" },
  { value: "50k_150k", label: "$50K – $150K" },
  { value: "150k_500k", label: "$150K – $500K" },
  { value: "500k_1m", label: "$500K – $1M" },
  { value: "1m_5m", label: "$1M – $5M" },
  { value: "over_5m", label: "Over $5M" },
];

interface AddBusinessFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "gate" | "form" | "confirm";

export function AddBusinessFlow({ open, onOpenChange }: AddBusinessFlowProps) {
  const assistant = useAssistantName();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { businesses, limit, refetch, setActiveBusinessId } = useBusinessContext();
  const [step, setStep] = useState<Step>("gate");
  const [submitting, setSubmitting] = useState(false);
  const [createdBusiness, setCreatedBusiness] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Reset to step 1 each time the modal reopens; pick gate vs form based on limit.
  useEffect(() => {
    if (!open) return;
    setCreatedBusiness(null);
    if (limit?.at_limit) {
      setStep("gate");
    } else {
      setStep("form");
    }
  }, [open, limit?.at_limit]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      legal_name: "",
      entity_type: "llc",
      entity_role: "opco",
      ein: "",
      state_of_formation: "",
      formation_date: "",
      is_subsidiary: false,
      parent_business_id: undefined,
      website: "",
      revenue_band: undefined,
    },
  });

  const isSubsidiary = form.watch("is_subsidiary");

  // Eligible parents = active businesses owned by the user (cannot self-parent;
  // first add will have none). Holdcos and parents are the natural choices.
  const parentOptions = useMemo(
    () => businesses.filter((b) => b.is_active),
    [businesses]
  );

  const onSubmit = async (values: FormValues) => {
    try {
      setSubmitting(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const parentId = values.is_subsidiary ? values.parent_business_id || null : null;

      const insertPayload = {
        owner_user_id: user.id,
        legal_name: values.legal_name.trim(),
        entity_type: values.entity_type,
        entity_role: values.entity_role,
        ein: values.ein?.trim() || null,
        state_of_formation: values.state_of_formation?.trim().toUpperCase() || null,
        formation_date: values.formation_date || null,
        website: values.website?.trim() || null,
        revenue_band: values.revenue_band || null,
        parent_business_id: parentId,
        organizational_level: parentId ? 1 : 0,
        business_type: parentId ? "subsidiary" : "standalone",
        // First business becomes primary automatically.
        is_primary: businesses.length === 0,
        is_active: true,
        display_order: businesses.length,
      };

      const { data, error } = await supabase
        // Cast: dynamic shape combines several optional bureau columns
        // we don't need to spell out here.
        .from("businesses")
        .insert(insertPayload as never)
        .select("id, legal_name")
        .single();

      if (error) throw error;

      toast({
        title: "Business added",
        description: `${data.legal_name} is now part of your portfolio.`,
      });

      await refetch();
      setActiveBusinessId(data.id);
      setCreatedBusiness({ id: data.id, name: data.legal_name });
      setStep("confirm");
      form.reset();
    } catch (err) {
      console.error("Failed to add business:", err);
      toast({
        title: "Could not add business",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const [slotLoading, setSlotLoading] = useState(false);

  const startSlotCheckout = async () => {
    try {
      setSlotLoading(true);
      const { data, error } = await supabase.functions.invoke(
        "add-business-slot-checkout",
        { body: {} },
      );
      if (error) throw error;
      const url = (data as { url?: string })?.url;
      if (!url) throw new Error("No checkout URL returned");
      window.location.href = url;
    } catch (err) {
      console.error("Slot checkout failed:", err);
      toast({
        title: "Could not start checkout",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSlotLoading(false);
    }
  };

  const renderGate = () => {
    // Detect plan tier by current max_businesses (1 = Starter, 3 = Pro, 999 = Elite)
    const max = limit?.max_businesses ?? 1;
    const isStarter = max <= 1;
    const isPro = max === 3;

    const title = isStarter ? "Unlock Multiple Businesses" : "Add More Entities";
    const body = isStarter
      ? "Your Starter plan includes 1 business. To build the full capital multiplication strategy across multiple entities you need to upgrade. Pro gives you 3 businesses at $67/month — your founding Beta rate locked for life."
      : isPro
      ? "You have used all 3 business slots on your Pro plan. Add individual slots at $10/month each, or upgrade to Elite for unlimited businesses and full consultant access."
      : `Your current plan includes ${max} business${max === 1 ? "" : "es"}. Add a slot for $10/month to expand your portfolio.`;

    const primaryCta = isStarter
      ? { label: "Upgrade to Pro — $67/mo", action: () => { onOpenChange(false); navigate("/pricing"); } }
      : { label: "Add a Slot — $10/mo", action: startSlotCheckout, loading: slotLoading };

    const secondaryCta = isStarter
      ? { label: "Add 1 Slot — $10/mo", action: startSlotCheckout, loading: slotLoading }
      : { label: "Upgrade to Elite — $297/mo", action: () => { onOpenChange(false); navigate("/pricing"); } };

    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/10 p-4">
          <Lock className="h-5 w-5 text-accent-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-semibold">{title}</h4>
            <p className="text-sm text-muted-foreground">{body}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            variant="default"
            className="h-auto flex-col items-start gap-1 py-4 text-left whitespace-normal"
            onClick={primaryCta.action}
            disabled={primaryCta.loading}
          >
            <span className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-4 w-4" /> {primaryCta.loading ? "Opening checkout…" : primaryCta.label}
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 py-4 text-left whitespace-normal"
            onClick={secondaryCta.action}
            disabled={secondaryCta.loading}
          >
            <span className="flex items-center gap-2 font-semibold">
              <Building2 className="h-4 w-4" /> {secondaryCta.loading ? "Opening checkout…" : secondaryCta.label}
            </span>
          </Button>
        </div>
      </div>
    );
  };

  const renderForm = () => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="legal_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Business name *</FormLabel>
              <FormControl>
                <Input placeholder="ABC Holdings LLC" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="entity_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Entity type *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="sole_proprietorship">Sole Proprietor</SelectItem>
                    <SelectItem value="llc">LLC</SelectItem>
                    <SelectItem value="s_corp">S-Corp</SelectItem>
                    <SelectItem value="c_corp">C-Corp</SelectItem>
                    <SelectItem value="corporation">Corporation</SelectItem>
                    <SelectItem value="partnership">Partnership</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="entity_role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Entity role *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.entries(ENTITY_ROLE_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">
                  How this entity functions in your portfolio.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="ein"
            render={({ field }) => (
              <FormItem>
                <FormLabel>EIN</FormLabel>
                <FormControl>
                  <Input placeholder="XX-XXXXXXX" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="state_of_formation"
            render={({ field }) => (
              <FormItem>
                <FormLabel>State</FormLabel>
                <FormControl>
                  <Input placeholder="DE" maxLength={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="formation_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Formed on</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="website"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Website</FormLabel>
              <FormControl>
                <Input placeholder="https://example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="revenue_band"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Annual revenue range</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select revenue range" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {REVENUE_BANDS.map((b) => (
                    <SelectItem key={b.value} value={b.value}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {parentOptions.length > 0 && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <FormField
              control={form.control}
              name="is_subsidiary"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-2 space-y-0">
                  <div>
                    <FormLabel>Is this a subsidiary?</FormLabel>
                    <FormDescription className="text-xs">
                      Link it to a parent entity in your portfolio.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            {isSubsidiary && (
              <FormField
                control={form.control}
                name="parent_business_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Parent business *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select parent" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {parentOptions.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.legal_name}{" "}
                            {b.entity_role ? `· ${entityRoleLabel(b.entity_role)}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting} className="gap-2">
            {submitting ? "Saving..." : "Add business"}
            {!submitting && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </Form>
  );

  const renderConfirm = () => (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Building2 className="h-6 w-6 text-primary" />
      </div>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{createdBusiness?.name} is on board</h3>
        <p className="text-sm text-muted-foreground">
          Upload your business credit report for{" "}
          <span className="font-medium text-foreground">{createdBusiness?.name}</span> so {assistant}
          can calculate their Commercial Fundability Score.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button
          variant="outline"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Done
        </Button>
        <Button
          className="gap-2"
          onClick={() => {
            onOpenChange(false);
            navigate("/app/credit#bureau-dnb");
          }}
        >
          <Upload className="h-4 w-4" />
          Upload business credit report
        </Button>
      </div>
    </div>
  );

  const titleByStep: Record<Step, string> = {
    gate: "Add another business",
    form: "Add a business entity",
    confirm: "Business added",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {titleByStep[step]}
            {limit && step === "form" && (
              <Badge variant="outline" className="ml-2">
                {limit.current_count} / {limit.effective_limit === 999 ? "∞" : limit.effective_limit}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {step === "form"
              ? `Each business gets its own fundability scores, business credit reports, and ${assistant} context.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {step === "gate" && renderGate()}
        {step === "form" && renderForm()}
        {step === "confirm" && renderConfirm()}
      </DialogContent>
    </Dialog>
  );
}
