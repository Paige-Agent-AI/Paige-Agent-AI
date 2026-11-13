import React, { useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { GrowthBlock } from "@/lib/growth";
import {
  CONVERSION_LIMITS,
  normalizeConversionDestination,
  type ConversionDestination,
  type ConversionDestinationResult,
  type ConversionMode,
} from "../../../supabase/functions/_shared/growth/conversion-destination";
import { parseExternalConversionInput } from "./conversion-input";
import "./PageConversionSettings.css";

export type PageConversionBlock = Extract<GrowthBlock, { type: "conversion" }>;
export type ConversionOptionsStatus = "loading" | "ready" | "unavailable";
export interface PageConversionSettingsProps {
  value?: PageConversionBlock;
  /** Options come from the caller's original scoped readers; this panel grants no access. */
  forms: readonly { id: string; title: string }[];
  bookingLinks: readonly { slug: string; title: string }[];
  formsStatus?: ConversionOptionsStatus;
  bookingLinksStatus?: ConversionOptionsStatus;
  onSave: (block: PageConversionBlock) => void | Promise<void>;
  onClose: () => void;
  saving?: boolean;
  error?: string | null;
}
type Kind = ConversionDestination["kind"];
interface Draft {
  kind: Kind; formId: string; bookingSlug: string; input: string; mode: ConversionMode;
  title: string; description: string; label: string;
}
type Candidate = { ok: true; block: PageConversionBlock } | { ok: false; message: string; canUseLink?: boolean };

function seed(value?: PageConversionBlock): Draft {
  const destination = value?.destination;
  const external = destination?.kind === "external_form" || destination?.kind === "external_booking";
  return {
    kind: destination?.kind ?? "native_form",
    formId: destination?.kind === "native_form" ? destination.formId : "",
    bookingSlug: destination?.kind === "native_booking" ? destination.slug : "",
    input: external ? destination.url : "", mode: external ? destination.mode : "link",
    title: value?.title ?? "", description: value?.description ?? "", label: value?.label ?? "",
  };
}
function defaultLabel(kind: Kind, mode: ConversionMode): string {
  const booking = kind === "native_booking" || kind === "external_booking";
  return `${(kind === "external_form" || kind === "external_booking") && mode === "embed" ? "Load" : "Open"} ${booking ? "booking" : "form"}`;
}

/** A local draft only. The caller saves through the original page/version writer and
 *  keys this panel by tenant + page so input never crosses a resource/context switch. */
export function PageConversionSettings({ value, forms, bookingLinks, formsStatus = "ready", bookingLinksStatus = "ready", onSave, onClose, saving = false, error }: PageConversionSettingsProps) {
  const [draft, setDraft] = useState(() => seed(value));
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savePending = useRef(false);
  const sourceRef = useRef<HTMLSelectElement | HTMLTextAreaElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const id = useId();
  const busy = saving || pending;
  const external = draft.kind === "external_form" || draft.kind === "external_booking";
  const actionLabel = defaultLabel(draft.kind, draft.mode);
  const candidate = useMemo<Candidate>(() => {
    let normalized: ConversionDestinationResult;
    if (draft.kind === "native_form") {
      if (formsStatus !== "ready") return { ok: false, message: formsStatus === "loading" ? "Wait for the form list to finish loading." : "The form list could not be loaded. Close these settings and try again." };
      if (!draft.formId) return { ok: false, message: "Choose a PAIGE form from this workspace." };
      if (!forms.some((form) => form.id === draft.formId)) return { ok: false, message: "This form is not currently available. Choose a PAIGE form from this workspace." };
      normalized = normalizeConversionDestination({ kind: draft.kind, formId: draft.formId });
    } else if (draft.kind === "native_booking") {
      if (bookingLinksStatus !== "ready") return { ok: false, message: bookingLinksStatus === "loading" ? "Wait for the booking list to finish loading." : "The booking list could not be loaded. Close these settings and try again." };
      if (!draft.bookingSlug) return { ok: false, message: "Choose a PAIGE booking link from this workspace." };
      if (!bookingLinks.some((link) => link.slug === draft.bookingSlug)) return { ok: false, message: "This booking link is not currently available. Choose one from this workspace." };
      normalized = normalizeConversionDestination({ kind: draft.kind, slug: draft.bookingSlug });
    } else {
      normalized = parseExternalConversionInput({ kind: draft.kind, mode: draft.mode, input: draft.input });
      if (normalized.ok === false) {
        const link = draft.mode === "embed" && normalized.code === "unsupported_embed"
          ? parseExternalConversionInput({ kind: draft.kind, mode: "link", input: draft.input }) : null;
        return { ok: false, message: normalized.message, canUseLink: link?.ok === true };
      }
    }
    if (normalized.ok === false) return { ok: false, message: normalized.message };
    const title = draft.title.trim().slice(0, 160);
    const description = draft.description.trim().slice(0, 400);
    const label = draft.label.trim().slice(0, 60) || defaultLabel(draft.kind, draft.mode);
    return { ok: true, block: {
      type: "conversion", destination: normalized.destination,
      ...(title ? { title } : {}), ...(description ? { description } : {}),
      ...(draft.kind !== "native_form" ? { label } : {}),
    } };
  }, [draft, forms, bookingLinks, formsStatus, bookingLinksStatus]);
  const validation = attempted && candidate.ok === false ? candidate : null;
  const validationId = `${id}-validation`;
  const helpId = `${id}-source-help`;
  const sourceDescriptions = [helpId, validation ? validationId : null].filter(Boolean).join(" ");

  function change<K extends keyof Draft>(key: K, next: Draft[K]) {
    setDraft((current) => {
      const result = { ...current, [key]: next };
      if ((key === "kind" || key === "mode") && current.label === defaultLabel(current.kind, current.mode)) result.label = "";
      return result;
    });
    setSaveError(null);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || savePending.current) return;
    setAttempted(true); setSaveError(null);
    if (candidate.ok === false) {
      if (sourceRef.current && !sourceRef.current.disabled) sourceRef.current.focus();
      else errorRef.current?.focus();
      return;
    }
    savePending.current = true; setPending(true);
    try { await onSave(candidate.block); }
    catch { setSaveError("Could not save this conversion. Your input is still here. Try again."); }
    finally { savePending.current = false; setPending(false); }
  }

  return <aside className="vs-inspector vs-page-conversion" aria-label="Page conversion settings" aria-busy={busy}>
    <header><b>Page conversion</b><button type="button" className="vs-icon-btn" aria-label="Close conversion settings" onClick={onClose}><X size={16} /></button></header>
    <form onSubmit={save} className="vs-page-conversion-form" noValidate>
      <div className="vs-inspector-body">
        <div className="vs-field">
          <label htmlFor={`${id}-kind`}>Destination</label>
          <select id={`${id}-kind`} value={draft.kind} required disabled={busy} onChange={(event) => change("kind", event.target.value as Kind)}>
            <option value="native_form">PAIGE form</option><option value="native_booking">PAIGE booking</option>
            <option value="external_form">External form</option><option value="external_booking">External booking</option>
          </select>
        </div>
        {draft.kind === "native_form" ? <div className="vs-field">
          <label htmlFor={`${id}-form`}>PAIGE form</label>
          <select ref={(node) => { sourceRef.current = node; }} id={`${id}-form`} value={draft.formId} required
            disabled={busy || formsStatus !== "ready" || forms.length === 0} aria-invalid={validation ? true : undefined} aria-describedby={sourceDescriptions}
            onChange={(event) => change("formId", event.target.value)}>
            <option value="">Choose a form</option>
            {draft.formId && !forms.some((form) => form.id === draft.formId) && <option value={draft.formId} disabled>{formsStatus === "ready" ? "Previously selected form unavailable" : "Current form selection"}</option>}
            {forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}
          </select>
          <p id={helpId} className="vs-page-conversion-help" role={formsStatus === "loading" ? "status" : undefined}>
            {formsStatus === "loading" ? "Loading your forms…" : formsStatus === "unavailable" ? "Your form list could not be loaded. Close these settings and try again."
              : forms.length === 0 ? "No native forms to select. Create a form in Studio, then return." : "Uses the selected form's existing fields and submission settings."}
          </p>
        </div> : draft.kind === "native_booking" ? <div className="vs-field">
          <label htmlFor={`${id}-booking`}>PAIGE booking link</label>
          <select ref={(node) => { sourceRef.current = node; }} id={`${id}-booking`} value={draft.bookingSlug} required
            disabled={busy || bookingLinksStatus !== "ready" || bookingLinks.length === 0} aria-invalid={validation ? true : undefined} aria-describedby={sourceDescriptions}
            onChange={(event) => change("bookingSlug", event.target.value)}>
            <option value="">Choose a booking link</option>
            {draft.bookingSlug && !bookingLinks.some((link) => link.slug === draft.bookingSlug) && <option value={draft.bookingSlug} disabled>{bookingLinksStatus === "ready" ? "Previously selected link unavailable" : "Current booking selection"}</option>}
            {bookingLinks.map((link) => <option key={link.slug} value={link.slug}>{link.title}</option>)}
          </select>
          <p id={helpId} className="vs-page-conversion-help" role={bookingLinksStatus === "loading" ? "status" : undefined}>
            {bookingLinksStatus === "loading" ? "Loading your booking links…" : bookingLinksStatus === "unavailable" ? "Your booking list could not be loaded. Close these settings and try again."
              : bookingLinks.length === 0 ? "No booking links to select. Set one up in Calendar, then return." : "Visitors continue to this booking link's original PAIGE page."}
          </p>
        </div> : <>
          <fieldset className="vs-page-conversion-mode" disabled={busy}>
            <legend>On the page</legend>
            <div>{([['link', 'Open link'], ['embed', 'Embed after click']] as const).map(([option, label]) => <label key={option} htmlFor={`${id}-${option}`}>
              <input id={`${id}-${option}`} type="radio" name={`${id}-mode`} value={option} checked={draft.mode === option} onChange={() => change("mode", option)} />{label}
            </label>)}</div>
          </fieldset>
          <div className="vs-field">
            <label htmlFor={`${id}-input`}>Public URL or embed code</label>
            <textarea ref={(node) => { sourceRef.current = node; }} id={`${id}-input`} value={draft.input} maxLength={CONVERSION_LIMITS.html} required
              disabled={busy} spellCheck={false} autoCapitalize="off" autoComplete="off" aria-invalid={validation ? true : undefined} aria-describedby={sourceDescriptions}
              onChange={(event) => change("input", event.target.value)} />
            <p id={helpId} className="vs-page-conversion-help">Use a public HTTPS URL or a supported iframe/Jotform embed code. It won’t run in settings.</p>
          </div>
        </>}
        {validation && <div className="vs-page-conversion-validation">
          <p ref={errorRef} id={validationId} className="vs-page-conversion-error" role="alert" tabIndex={-1}>{validation.message}</p>
          {validation.canUseLink && <button type="button" className="vs-link" onClick={() => change("mode", "link")}>Use a link instead</button>}
        </div>}
        <div className="vs-field"><label htmlFor={`${id}-title`}>Section title</label><input id={`${id}-title`} value={draft.title} maxLength={160} disabled={busy} onChange={(event) => change("title", event.target.value)} /></div>
        <div className="vs-field"><label htmlFor={`${id}-description`}>Description</label><textarea id={`${id}-description`} className="vs-page-conversion-description" value={draft.description} maxLength={400} disabled={busy} onChange={(event) => change("description", event.target.value)} /></div>
        {draft.kind !== "native_form" && <div className="vs-field"><label htmlFor={`${id}-label`}>Button label</label><input id={`${id}-label`} value={draft.label} placeholder={actionLabel} maxLength={60} disabled={busy} onChange={(event) => change("label", event.target.value)} /></div>}
        {external && <p className="vs-page-conversion-help">{draft.mode === "embed" ? "Visitors choose when to load the widget." : "Visitors open the destination in a new tab."} External submissions are handled by the provider.</p>}
        {(saveError || error) && <p role="alert" className="vs-page-conversion-error">{saveError || error}</p>}
      </div>
      <div className="vs-inspector-foot vs-page-conversion-foot">
        <button type="button" className="vs-btn vs-btn-quiet" onClick={onClose}>{busy ? "Close" : "Cancel"}</button>
        <button type="submit" className="vs-btn vs-btn-violet" disabled={busy}>{busy ? "Saving…" : "Save conversion"}</button>
      </div>
    </form>
  </aside>;
}
