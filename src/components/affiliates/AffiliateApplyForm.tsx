// src/components/affiliates/AffiliateApplyForm.tsx
// Reusable application form. Used on the public /affiliates page AND
// inside the staff dashboard for self-application.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  submitAffiliateApplication,
  type RequestedTierKey,
} from "@/lib/affiliates/applications";
import { recordAcceptances } from "@/lib/legal/useLegalDocuments";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2 } from "lucide-react";
import { trackEvent } from "@/hooks/useAnalytics";
import {
  CommunicationsConsent,
  EMPTY_COMMS_CONSENT,
  type CommsConsentState,
} from "@/components/legal/CommunicationsConsent";

const BROKER_AGREEMENT_SLUG = "broker-agreement";

interface Props {
  /** If the applicant is signed in, pass their auth user id so admin can match later. */
  userId?: string | null;
  /** Defaults to "external" — set to "coach"/"admin" for staff self-apply. */
  requestedTier?: RequestedTierKey;
  /** Pre-fill name/email if known (e.g. signed-in user). */
  defaultName?: string;
  defaultEmail?: string;
  /** Show the persona + tier selectors used on the public landing page. */
  showTierAndPersona?: boolean;
  onSubmitted?: () => void;
}

const PERSONA_OPTIONS = [
  "Credit Coach",
  "Financial Advisor",
  "Real Estate Investor",
  "Business Consultant",
  "Content Creator",
  "Entrepreneur",
  "Other",
];

const HEAR_ABOUT_OPTIONS = [
  "Search engine",
  "Social media",
  "Friend or colleague",
  "Podcast",
  "Newsletter",
  "Existing PaigeAgent user",
  "Other",
];

export default function AffiliateApplyForm({
  userId,
  requestedTier = "external",
  defaultName = "",
  defaultEmail = "",
  showTierAndPersona = false,
  onSubmitted,
}: Props) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [autoApproved, setAutoApproved] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [commsConsent, setCommsConsent] = useState<CommsConsentState>(EMPTY_COMMS_CONSENT);

  const [form, setForm] = useState({
    full_name: defaultName,
    email: defaultEmail,
    phone: "",
    website_url: "",
    social_links: "",
    audience_description: "",
    why_join: "",
    persona: "",
    hear_about: "",
    selected_tier: showTierAndPersona ? "external" : requestedTier,
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim() || !form.email.trim()) {
      toast({
        title: "Missing info",
        description: "Name and email are required.",
        variant: "destructive",
      });
      return;
    }
    if (!agreementAccepted) {
      toast({
        title: "Agreement required",
        description: "Please accept the Broker / Affiliate Producer Agreement before submitting.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const tierKey = (form.selected_tier || requestedTier) as RequestedTierKey;
      // Resolve the live broker-agreement version so it ends up in the
      // application audit trail even before the broker has a user account.
      const { data: agreementDoc } = await supabase
        .from("legal_documents")
        .select("slug,version")
        .eq("slug", BROKER_AGREEMENT_SLUG)
        .eq("is_current", true)
        .maybeSingle();

      // Bundle persona + hear-about + agreement attestation into audience_description
      // for storage without requiring a schema change.
      const audienceWithMeta = [
        form.persona ? `Persona: ${form.persona}` : "",
        form.hear_about ? `Heard via: ${form.hear_about}` : "",
        form.audience_description.trim(),
        agreementDoc
          ? `Broker Agreement accepted: ${agreementDoc.slug} v${agreementDoc.version} @ ${new Date().toISOString()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

      await submitAffiliateApplication({
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        website_url: form.website_url,
        social_links: form.social_links,
        audience_description: audienceWithMeta,
        why_join: form.why_join,
        requested_tier_key: tierKey,
        user_id: userId ?? null,
      }, commsConsent);

      // If the applicant is signed in, also write the versioned legal_acceptance
      // row immediately. Anonymous applicants get their acceptance recorded by
      // broker-auto-approve once their user account is created.
      if (userId && agreementDoc) {
        try {
          await recordAcceptances(userId, [{
            slug: agreementDoc.slug,
            version: agreementDoc.version,
            context: { source: "affiliate_apply_form", tier: tierKey },
          }]);
        } catch { /* non-blocking audit-trail write */ }
      }

      // Affiliate Partner tier (external) is the instant-approval lane on
      // the public landing page. Coach tier always goes to admin review.
      const instant = showTierAndPersona && tierKey === "external";
      setAutoApproved(instant);
      setDone(true);
      void trackEvent("affiliate_application_submit", "acquisition", {
        tier: tierKey,
        instant_approved: instant,
      });
      toast({
        title: instant ? "You're approved!" : "Application submitted",
        description: instant
          ? "Welcome aboard — check your email for next steps."
          : "We'll email you once an admin reviews it.",
      });
      onSubmitted?.();
    } catch (err) {
      toast({
        title: "Submission failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-[#d4a574]/40 bg-[#d4a574]/5 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-[#d4a574]" />
        <h3 className="text-lg font-semibold text-[#1a2840]">
          {autoApproved ? "You're in — welcome!" : "Application received"}
        </h3>
        <p className="mt-1 text-sm text-[#1a2840]/70">
          {autoApproved
            ? "Your Affiliate Partner account is approved. We'll email your unique referral link and dashboard access within a few minutes."
            : "We'll review your Coach Partner application and get back to you within 24 hours by email."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="aff-name">Full name *</Label>
          <Input
            id="aff-name"
            value={form.full_name}
            onChange={(e) => update("full_name", e.target.value)}
            required
            disabled={submitting}
          />
        </div>
        <div>
          <Label htmlFor="aff-email">Email *</Label>
          <Input
            id="aff-email"
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            required
            disabled={submitting}
          />
        </div>
        <div>
          <Label htmlFor="aff-phone">Phone</Label>
          <Input
            id="aff-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            disabled={submitting}
          />
        </div>
        <div>
          <Label htmlFor="aff-website">Website</Label>
          <Input
            id="aff-website"
            type="url"
            placeholder="https://"
            value={form.website_url}
            onChange={(e) => update("website_url", e.target.value)}
            disabled={submitting}
          />
        </div>
      </div>

      {showTierAndPersona && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="aff-persona">How would you describe yourself?</Label>
              <Select
                value={form.persona}
                onValueChange={(v) => update("persona", v)}
                disabled={submitting}
              >
                <SelectTrigger id="aff-persona">
                  <SelectValue placeholder="Select one" />
                </SelectTrigger>
                <SelectContent>
                  {PERSONA_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="aff-tier">Which partner tier?</Label>
              <Select
                value={form.selected_tier}
                onValueChange={(v) => update("selected_tier", v)}
                disabled={submitting}
              >
                <SelectTrigger id="aff-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="external">
                    Affiliate Partner — 25% (instant)
                  </SelectItem>
                  <SelectItem value="coach">
                    Certified Coach Partner — 30% (24-hour review)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="aff-hear">How did you hear about us?</Label>
            <Select
              value={form.hear_about}
              onValueChange={(v) => update("hear_about", v)}
              disabled={submitting}
            >
              <SelectTrigger id="aff-hear">
                <SelectValue placeholder="Select one" />
              </SelectTrigger>
              <SelectContent>
                {HEAR_ABOUT_OPTIONS.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div>
        <Label htmlFor="aff-social">Social handles / channels</Label>
        <Input
          id="aff-social"
          placeholder="@yourhandle on Instagram, YouTube channel, etc."
          value={form.social_links}
          onChange={(e) => update("social_links", e.target.value)}
          disabled={submitting}
        />
      </div>

      <div>
        <Label htmlFor="aff-audience">Tell us about your audience</Label>
        <Textarea
          id="aff-audience"
          rows={3}
          placeholder="Who do you reach? Size? Niche?"
          value={form.audience_description}
          onChange={(e) => update("audience_description", e.target.value)}
          disabled={submitting}
        />
      </div>

      <div>
        <Label htmlFor="aff-why">Why do you want to promote PaigeAgent?</Label>
        <Textarea
          id="aff-why"
          rows={3}
          value={form.why_join}
          onChange={(e) => update("why_join", e.target.value)}
          disabled={submitting}
        />
      </div>

      <label className="flex items-start gap-2 text-sm cursor-pointer rounded border border-[#d4a574]/30 bg-[#d4a574]/5 p-3">
        <input
          type="checkbox"
          checked={agreementAccepted}
          onChange={(e) => setAgreementAccepted(e.target.checked)}
          disabled={submitting}
          className="mt-0.5"
          required
        />
        <span>
          I have read and agree to the{" "}
          <a
            href="/legal/broker-agreement"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline text-[#1a2840]"
          >
            Broker / Affiliate Producer Agreement
          </a>
          , including the independent-contractor terms, RESPA flow-down, anti-poach,
          and W-9 requirements. I understand commissions are paid only on qualifying
          subscriptions per the agreement.
        </span>
      </label>

      <CommunicationsConsent
        value={commsConsent}
        onChange={setCommsConsent}
        showSms={!!form.phone}
      />



      <Button
        type="submit"
        disabled={submitting}
        className="w-full bg-[#1a2840] text-white hover:bg-[#1a2840]/90 md:w-auto"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…
          </>
        ) : (
          "Submit application"
        )}
      </Button>
    </form>
  );
}
