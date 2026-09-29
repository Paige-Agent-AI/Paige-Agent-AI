// Public form renderer — standalone hosted form at /form/:id and embeddable
// inside landing pages via <GrowthFormEmbed>.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import type { GrowthField, GrowthSubmitOutcome, PublicGrowthForm } from "@/lib/growth";
import { loadPublicGrowthForm, submitGrowthForm, readUtm, growthOptionValue, growthOptionLabel } from "@/lib/growth";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type FormRow = PublicGrowthForm;

/** The real uploaded file's own name, recovered from its Storage URL
 *  (<tenant_id>/<uuid>-<name>) — never a fabricated label (§13). Falls back to a generic
 *  label only if the URL doesn't carry a recognizable filename tail. */
function filenameFromDownloadUrl(url: string): string {
  try {
    const tail = decodeURIComponent(url.split("/").pop() ?? "");
    const withoutUuidPrefix = tail.replace(/^[0-9a-f-]{36}-/i, "");
    return withoutUuidPrefix || "file";
  } catch {
    return "file";
  }
}

export default function GrowthFormPage() {
  const { id } = useParams();
  const [form, setForm] = useState<FormRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setForm(await loadPublicGrowthForm({ formId: id }));
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => { if (form?.name) document.title = form.name; }, [form?.name]);

  if (loading) {
    return (
      <div className="min-h-dvh bg-background py-12 px-4">
        <div className="mx-auto max-w-2xl space-y-4" aria-busy="true" aria-label="Loading form">
          <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40 motion-reduce:animate-none" />
        </div>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center px-4">
        <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="font-display text-xl font-semibold text-foreground">This form isn't available</h1>
          <p className="mt-2 text-sm text-muted-foreground">The link may be broken, or the form was unpublished. Check with whoever shared it.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">{form.name}</h1>
        <FormBody form={form} />
      </div>
    </div>
  );
}

/** A form embedded in a page or funnel step, found by id or by the page's business and the form's
 *  slug. While it loads it shows `loading` (nothing by default); if the form isn't available it
 *  calls `onUnavailable` and shows nothing, so a caller that can move on (a funnel) can say so. */
export function GrowthFormEmbed({ formId, tenantId, formSlug, accent, onComplete, loading, onUnavailable }: {
  formId?: string; tenantId?: string; formSlug?: string; accent?: string; onComplete?: () => void;
  loading?: ReactNode; onUnavailable?: () => void;
}) {
  const [form, setForm] = useState<FormRow | null | undefined>(undefined);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  useEffect(() => {
    let cancelled = false;
    setForm(undefined);
    (async () => {
      const found = formId
        ? await loadPublicGrowthForm({ formId })
        : tenantId && formSlug ? await loadPublicGrowthForm({ tenantId, slug: formSlug }) : null;
      if (cancelled) return;
      setForm(found);
      if (!found) unavailable.current?.();
    })();
    return () => { cancelled = true; };
  }, [formId, tenantId, formSlug]);
  if (form === undefined) return <>{loading ?? null}</>;
  if (!form) return null;
  return (
    // §6 brand continuity + dark-AA: the embed rides the surrounding page's --gp-* palette so it
    // reads as one system with the rest of the published site (and the chatbot block), instead of a
    // foreign white card. Falls back to theme-aware shadcn card tokens when rendered outside a
    // --gp-* context, so the shadcn Select/Checkbox/Radio inside never land dark-on-white.
    <div
      className="rounded-lg shadow-xl p-6 md:p-8"
      style={{ background: "var(--gp-surface, hsl(var(--card)))", color: "var(--gp-text, hsl(var(--card-foreground)))" }}
    >
      <h2 className="text-2xl font-bold mb-2 text-center" style={{ color: accent || "var(--gp-accent-ink)" }}>{form.name}</h2>
      <FormBody form={form} accent={accent} onComplete={onComplete} />
    </div>
  );
}

// A field counts as "answered" per its own type — a boolean checkbox must be TRUE, a
// checkbox group must have at least one choice, everything else must be a non-empty value.
// (A plain `!== ""` check would wrongly pass an unchecked required consent box, whose value
// is `false`/`undefined`.)
/** One answer as the form holds it: text, a number, a checkbox, or a group of choices. */
type Answer = string | number | boolean | string[] | undefined;

function fieldAnswered(field: GrowthField, value: Answer): boolean {
  if (field.type === "checkbox") {
    if (field.options?.length) return Array.isArray(value) && value.length > 0;
    return value === true;
  }
  if (typeof value === "string") return value.trim() !== "";
  return value !== undefined && value !== null;
}

/** The answers as they are sent: text trimmed, and blank answers left out — the server refuses a
 *  blank one rather than ignoring it, so one stray space must never block a submission. */
function answersToSend(data: Record<string, Answer>): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) out[key] = trimmed;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function FormBody({ form, accent, onComplete }: { form: FormRow; accent?: string; onComplete?: () => void }) {
  const schema = form.schema_json ?? { sections: [] };
  const totalSteps = schema.sections.length;
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Record<string, Answer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The bot trap: a field people never see or reach. Real visitors leave it empty.
  const [trap, setTrap] = useState("");
  const startedAt = useRef(Date.now());

  const section = schema.sections[step];
  const progress = totalSteps > 0 ? Math.round(((step + 1) / totalSteps) * 100) : 100;

  const setField = (k: string, v: Answer) => setData((d) => ({ ...d, [k]: v }));

  const requiredOk = (s: typeof section) => s.fields.every((f) => !f.required || fieldAnswered(f, data[f.key]));

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    const outcome = await submitGrowthForm({
      formId: form.id, answers: answersToSend(data), utm: readUtm(), trap, startedAt: startedAt.current,
    });
    setSubmitting(false);
    if (!outcome.ok) { setSubmitError(submitErrorMessage(outcome, schema.sections.flatMap((s) => s.fields))); return; }
    // A download_url wins over an immediate redirect — navigating straight away would strand
    // the visitor before they ever see the download button (additive: pages with ONLY
    // redirect_url set, which is every page today, behave exactly as before).
    if (form.success_action_json?.redirect_url && !form.success_action_json?.download_url) {
      window.location.href = form.success_action_json.redirect_url;
      return;
    }
    // Embedded in a funnel with a next step: hand control back to the step machine so the
    // visitor advances to the thankyou/next step instead of dead-ending on this form's own
    // success card. Standalone (/form/:id) and landing-embed have no onComplete, so they keep
    // showing the authored success state exactly as before. A download_url is the one
    // exception — advancing the funnel immediately would strand the visitor before they ever
    // see the deliverable, so the success card (with its download button) wins here too.
    if (onComplete && !form.success_action_json?.download_url) { onComplete(); return; }
    setDone(true);
  };

  if (done) {
    const success = form.success_action_json;
    return <div className="text-center py-12 space-y-4">
      <div className="text-3xl mb-2">✓</div>
      <p className="text-lg">{success?.message ?? "Thanks — we'll be in touch."}</p>
      {success?.download_url && (
        <Button asChild>
          <a href={success.download_url} target="_blank" rel="noopener noreferrer" download>
            Download {filenameFromDownloadUrl(success.download_url)}
          </a>
        </Button>
      )}
      {success?.redirect_url && (
        <p className="text-sm">
          <a href={success.redirect_url} className="underline">Continue</a>
        </p>
      )}
    </div>;
  }

  if (!section) return <p>No fields configured.</p>;

  return (
    <div className="space-y-6">
      {totalSteps > 1 && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span>Step {step + 1} of {totalSteps}</span>
            <span>{progress}% Completed</span>
          </div>
          <div className="h-2 rounded bg-gray-200 overflow-hidden">
            <div className="h-full transition-all" style={{ width: `${progress}%`, background: accent ?? "#cfae70" }} />
          </div>
        </div>
      )}

      <div>
        <h3 className="text-lg font-semibold">{section.title}</h3>
        {section.description && <p className="text-sm text-gray-600 mt-1">{section.description}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {section.fields.map((f) => <FieldRenderer key={f.key} field={f} value={data[f.key]} onChange={(v) => setField(f.key, v)} />)}
      </div>

      {submitError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {submitError}
        </div>
      )}

      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor={`gf-hp-${form.id}`}>Leave this empty</label>
        {/* A name with no meaning, so browser and password-manager autofill never fill it. */}
        <input id={`gf-hp-${form.id}`} type="text" name="gf_hp_x7" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </div>

      <div className="flex justify-between pt-2">
        {step > 0 ? <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Back</Button> : <div />}
        {step < totalSteps - 1 ? (
          <Button disabled={!requiredOk(section)} onClick={() => setStep((s) => s + 1)} style={{ background: accent }}>Next Step →</Button>
        ) : (
          <Button disabled={!requiredOk(section) || submitting} onClick={submit} style={{ background: accent }}>
            {submitting ? "Submitting…" : (schema.submit_label ?? "Submit")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** What to tell a visitor when their answers were not saved — specific where the server said why. */
function submitErrorMessage(outcome: GrowthSubmitOutcome, fields: GrowthField[]): string {
  if ("reason" in outcome && outcome.reason === "invalid") {
    const label = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
    const keys = [...new Set([...outcome.missing, ...outcome.invalid])];
    return keys.length
      ? `Please check ${keys.map(label).join(", ")} and try again.`
      : "Please check your answers and try again.";
  }
  if ("reason" in outcome && outcome.reason === "rate_limited") return "Lots of responses are coming in right now. Please wait a minute and try again.";
  if ("reason" in outcome && outcome.reason === "unavailable") return "This form isn't taking responses any more.";
  if ("reason" in outcome && outcome.reason === "empty") return "Please answer at least one question before sending.";
  if ("reason" in outcome && outcome.reason === "refused") return "This form can't accept responses from this page. Please contact the business directly.";
  return "We couldn't submit your responses just now. Please try again in a moment.";
}

function FieldRenderer({ field, value, onChange }: { field: GrowthField; value: Answer; onChange: (v: Answer) => void }) {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const fid = `gf-${field.key}`;
  const help = field.help ? <p className="text-xs text-muted-foreground mt-1">{field.help}</p> : null;
  const req = field.required ? <span className="text-destructive"> *</span> : null;

  // A single boolean checkbox (a consent line, no options) reads as its own row: the field
  // label IS the checkbox's clickable label, so we don't stack a separate heading above it.
  const isBoolean = field.type === "checkbox" && !field.options?.length;
  const span =
    ["textarea", "home_address", "business_address", "use_of_funds"].includes(field.type) ||
    field.type === "checkbox" ||
    field.key.includes("address")
      ? "md:col-span-2"
      : "";

  if (field.type === "checkbox" && isBoolean) {
    return (
      <div className={span}>
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={fid}
            checked={value === true}
            onCheckedChange={(c) => onChange(c === true)}
            aria-required={field.required || undefined}
            className="mt-0.5"
          />
          <label htmlFor={fid} className="text-sm font-medium leading-snug cursor-pointer">
            {field.label}{req}
          </label>
        </div>
        {help}
      </div>
    );
  }

  return (
    <div className={span}>
      <label htmlFor={field.type === "textarea" || field.type === "select" ? fid : undefined} className="text-sm font-medium block mb-1">
        {field.label}{req}
      </label>
      {field.type === "checkbox" ? (
        <div className="space-y-2 mt-1" role="group" aria-label={field.label} aria-required={field.required || undefined}>
          {field.options?.map((o) => {
            const v = growthOptionValue(o);
            const arr: string[] = Array.isArray(value) ? value : [];
            const on = arr.includes(v);
            return (
              <div key={v} className="flex items-center gap-2.5">
                <Checkbox
                  id={`${fid}-${v}`}
                  checked={on}
                  onCheckedChange={(c) => onChange(c === true ? [...arr, v] : arr.filter((x) => x !== v))}
                />
                <label htmlFor={`${fid}-${v}`} className="text-sm cursor-pointer">{growthOptionLabel(o)}</label>
              </div>
            );
          })}
        </div>
      ) : field.type === "textarea" ? (
        <Textarea id={fid} value={text} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
      ) : field.type === "select" ? (
        <Select value={text || undefined} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={fid}>
            <SelectValue placeholder={field.placeholder ?? "Select…"} />
          </SelectTrigger>
          <SelectContent>
            {/* Radix Select/RadioGroup THROW on an empty-string value (the placeholder owns ""),
                so an empty option value would white-screen the whole public form — filter defensively. */}
            {field.options?.filter((o) => growthOptionValue(o) !== "").map((o) => { const v = growthOptionValue(o); return <SelectItem key={v} value={v}>{growthOptionLabel(o)}</SelectItem>; })}
          </SelectContent>
        </Select>
      ) : field.type === "radio" ? (
        <RadioGroup value={text} onValueChange={(v) => onChange(v)} aria-label={field.label} aria-required={field.required || undefined} className="mt-1">
          {field.options?.filter((o) => growthOptionValue(o) !== "").map((o) => {
            const v = growthOptionValue(o);
            return (
              <div key={v} className="flex items-center gap-2.5">
                <RadioGroupItem id={`${fid}-${v}`} value={v} />
                <label htmlFor={`${fid}-${v}`} className="text-sm cursor-pointer">{growthOptionLabel(o)}</label>
              </div>
            );
          })}
        </RadioGroup>
      ) : (
        <Input
          id={fid}
          type={field.type === "ssn4" ? "text" : field.type === "currency" || field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "tel" ? "tel" : "text"}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          maxLength={field.type === "ssn4" ? 4 : undefined}
          placeholder={field.placeholder}
        />
      )}
      {help}
    </div>
  );
}
