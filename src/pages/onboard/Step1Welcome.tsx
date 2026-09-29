import { useEffect, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { usePlaybook } from "@/lib/playbook";
import type { IntakeField } from "@/lib/playbook";
import { readableTextOn } from "@/lib/brand/contrast";
import type { OnboardClient } from "./useOnboardingClient";
import type { Tables } from "@/integrations/supabase/types";
import { advanceOnboardingStage } from "./useOnboardingClient";
import type { OnboardBrand } from "./OnboardLayout";

type Ctx = { client: OnboardClient; refresh: () => void; brand: OnboardBrand | null };

/** The postal address columns of the contact row, read when the onboarding record carries them. */
type ClientPostalAddress = Partial<Pick<Tables<"clients">, "street_address" | "city" | "state" | "zip_code">>;

const STEPS = ["Your info", "Agreement"];

// Contact identity is captured by the fields above, so a tenant's Playbook intake
// shouldn't re-ask these — we render only the vertical-specific questions here.
const CONTACT_KEYS = new Set(["full_name", "first_name", "last_name", "name", "email", "phone"]);

function ProgressHeader({ stepIndex, title, subtitle }: { stepIndex: number; title: string; subtitle: string }) {
  const pct = Math.round(((stepIndex + 1) / STEPS.length) * 100);
  return (
    <div className="mb-6">
      <span className="onboard-step-chip">Step {stepIndex + 1} of {STEPS.length} · {STEPS[stepIndex]}</span>
      <h1 className="onboard-h1">{title}</h1>
      <p className="onboard-sub">{subtitle}</p>
      <div className="onboard-progress"><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** Renders one tenant-authored Playbook intake question by its type. */
function IntakeQuestion({ field, value, onChange }: {
  field: IntakeField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const v = (value ?? "") as string;
  return (
    <div className="space-y-2">
      <Label>
        {field.label}
        {!field.required && <span className="text-xs ml-1" style={{ color: "rgba(8,20,40,0.5)" }}>(optional)</span>}
      </Label>
      {field.type === "longtext" ? (
        <Textarea value={v} onChange={(e) => onChange(e.target.value)} rows={3} />
      ) : field.type === "select" ? (
        <select
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-10 rounded-md border px-3 text-sm bg-white"
          style={{ borderColor: "rgba(8,20,40,0.2)", color: "#081428" }}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : (
        <Input
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          value={v}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export default function Step1Welcome() {
  const { client, refresh, brand } = useOutletContext<Ctx>();
  const navigate = useNavigate();
  const pb = usePlaybook();
  const [busy, setBusy] = useState(false);

  const [firstName, setFirstName] = useState(client.first_name ?? "");
  const [lastName, setLastName] = useState(client.last_name ?? "");
  const [phone, setPhone] = useState<string>(client.phone ?? "");
  const postal = client as OnboardClient & ClientPostalAddress;
  const [street, setStreet] = useState<string>(postal.street_address ?? "");
  const [city, setCity] = useState<string>(postal.city ?? "");
  const [stateRegion, setStateRegion] = useState<string>(postal.state ?? "");
  const [zip, setZip] = useState<string>(postal.zip_code ?? "");

  // The tenant's Playbook drives the intake — never a hardcoded (funding) set.
  const questions = (pb.intake ?? []).filter((f) => !CONTACT_KEYS.has(f.key));
  const [answers, setAnswers] = useState<Record<string, unknown>>({});

  // Hydrate any previously-saved answers so the client can resume.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("paige_client_intake_submissions")
        .select("payload")
        .eq("client_id", client.id)
        .eq("section", "playbook_intake")
        .maybeSingle();
      // Only hydrate if the client hasn't started typing (don't clobber input).
      if (!cancelled && data?.payload) {
        setAnswers((prev) => (Object.keys(prev).length ? prev : (data.payload as Record<string, unknown>)));
      }
    })();
    return () => { cancelled = true; };
  }, [client.id]);

  const missingRequired = questions.some(
    (f) => f.required && !String(answers[f.key] ?? "").trim(),
  );

  const canContinue =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    phone.trim().length >= 7 &&
    !missingRequired &&
    !busy;

  const begin = async () => {
    if (!canContinue) return;
    setBusy(true);
    try {
      const { error: updErr } = await supabase
        .from("clients")
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          // The phone is NOT written here: a contact's phones live in its contact methods, and a
          // linked client has no seam that writes their own (upsert_contact is staff-only). A
          // client-self address RPC is the missing backend piece; until it exists the number is
          // collected and not stored — as it already was for a linked client, whose UPDATE on
          // `clients` matches no policy and changes no row.
          street_address: street.trim() || null,
          city: city.trim() || null,
          state: stateRegion.trim() || null,
          zip_code: zip.trim() || null,
        })
        .eq("id", client.id);
      if (updErr) throw updErr;

      // Persist the Playbook intake answers (upsert; resumable) so the tenant's
      // team + Paige have the client's context from the first minute.
      if (questions.length > 0) {
        const { error: intakeErr } = await supabase
          .from("paige_client_intake_submissions")
          .upsert(
            {
              client_id: client.id,
              section: "playbook_intake",
              payload: answers,
              submitted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "client_id,section" },
          );
        if (intakeErr) throw intakeErr;
      }

      const { error } = await advanceOnboardingStage(client.id, "signing_agreement");
      if (error) throw error;
      await refresh();
      navigate("/onboard/agreement");
    } catch (e) {
      toast.error((e as { message?: string } | null | undefined)?.message || "Couldn't save your info — please try again.");
      setBusy(false);
    }
  };

  const accent = brand?.primary_color || null;
  const workspace = brand?.tenant_name || "your workspace";

  return (
    <>
      <ProgressHeader
        stepIndex={0}
        title={`Welcome, ${client.first_name ?? "there"}.`}
        subtitle={`A couple of quick things: confirm your details${questions.length ? " and tell us a bit about you" : ""}, then sign your agreement. After that you're in — and ${pb.persona.name} takes it from there.`}
      />
      <div className="onboard-card p-6 sm:p-8 space-y-6">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: "rgba(8,20,40,0.5)" }}>Account on file</div>
          <div className="text-sm" style={{ color: "rgba(8,20,40,0.7)" }}>{client.email}</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>First name</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Last name</Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Phone number</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Street address <span className="text-xs" style={{ color: "rgba(8,20,40,0.5)" }}>(optional)</span></Label>
            <Input value={street} onChange={(e) => setStreet(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>City <span className="text-xs" style={{ color: "rgba(8,20,40,0.5)" }}>(optional)</span></Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>State <span className="text-xs" style={{ color: "rgba(8,20,40,0.5)" }}>(optional)</span></Label>
            <Input value={stateRegion} onChange={(e) => setStateRegion(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>ZIP <span className="text-xs" style={{ color: "rgba(8,20,40,0.5)" }}>(optional)</span></Label>
            <Input value={zip} onChange={(e) => setZip(e.target.value)} />
          </div>
        </div>

        {questions.length > 0 && (
          <div className="space-y-5 pt-2 border-t" style={{ borderColor: "rgba(8,20,40,0.1)" }}>
            <div>
              <div className="text-sm font-semibold" style={{ color: "#081428" }}>A bit about you</div>
              <div className="text-xs" style={{ color: "rgba(8,20,40,0.6)" }}>
                This helps {workspace} and {pb.persona.name} tailor everything to you.
              </div>
            </div>
            {questions.map((f) => (
              <IntakeQuestion
                key={f.key}
                field={f}
                value={answers[f.key]}
                onChange={(v) => setAnswers((a) => ({ ...a, [f.key]: v }))}
              />
            ))}
          </div>
        )}

        <div
          className="rounded-lg p-4"
          style={{
            background: accent ? `color-mix(in srgb, ${accent} 12%, transparent)` : "rgba(207,174,112,0.12)",
            border: `1px solid ${accent ? `color-mix(in srgb, ${accent} 35%, transparent)` : "rgba(207,174,112,0.35)"}`,
          }}
        >
          <div className="font-semibold mb-1">What happens next</div>
          <p className="text-sm" style={{ color: "rgba(8,20,40,0.78)" }}>
            Once you sign your agreement you'll go straight into your portal. {pb.persona.name} will walk you
            through everything else from there.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={begin}
            disabled={!canContinue}
            style={accent ? { backgroundColor: accent, color: readableTextOn(accent) } : undefined}
          >
            {busy ? "Saving…" : "Continue to agreement"}
          </Button>
        </div>
      </div>
    </>
  );
}
