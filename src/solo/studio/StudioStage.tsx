// The stage: whatever the project is working on, rendered the way a visitor will see it. Forms draw
// from their working copy (draft_schema_json) on a lit sheet in the tenant's brand; pages render
// through the same GrowthBlocks the published page uses (LivePreview, honest breakpoints in an
// iframe); a funnel shows its steps and the selected one; images show the files. Nothing here
// submits or publishes, and the preview's fields are not focus stops.
import React from "react";
import { LivePreview } from "@/components/admin/studio/LivePreview";
import { DocumentPreview } from "@/components/admin/studio/DocumentPreview";
import { loadDocument, type StudioDocument } from "@/components/admin/studio/studio";
import { plainError, type ArtifactRef, type FormField, type StudioForm, type StudioFunnel, type StudioPage } from "./studio-data";
import { loadArtifact, type Brand, type Device, type LoadedArtifact } from "./artifact-state";
import type { BuildStep, DraftPreview } from "./useStudioChat";
import { shapeFromSteps, type BuildShape } from "./artifact-state";
import type { GrowthBlock, GrowthPageTheme } from "@/lib/growth";

const TYPE_HINT: Record<string, string> = {
  email: "you@company.com", tel: "Phone number", number: "0", date: "", textarea: "", text: "",
};

function Question({ field }: { field: FormField }) {
  const id = `vs-q-${field.key}`;
  const req = field.required ? <em aria-hidden="true"> *</em> : null;
  if (field.type === "radio" || field.type === "checkbox") {
    return (
      <div className="vs-q" role="group" aria-labelledby={`${id}-l`}>
        <span id={`${id}-l`}>{field.label}{req}</span>
        <div className="vs-q-options">
          {field.options.map((o) => (
            <span key={o}><i aria-hidden="true" data-square={field.type === "checkbox" ? "" : undefined} />{o}</span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="vs-q">
      <label htmlFor={id}>{field.label}{req}</label>
      {field.type === "select" ? (
        <select id={id} disabled defaultValue=""><option value="">Choose one</option>{field.options.map((o) => <option key={o}>{o}</option>)}</select>
      ) : field.type === "textarea" ? (
        <textarea id={id} rows={3} readOnly tabIndex={-1} placeholder={field.placeholder ?? ""} />
      ) : (
        <input id={id} readOnly tabIndex={-1} type={field.type === "email" || field.type === "tel" || field.type === "number" || field.type === "date" ? field.type : "text"} placeholder={field.placeholder ?? TYPE_HINT[field.type] ?? ""} />
      )}
    </div>
  );
}

function BrandMark({ brand }: { brand: Brand }) {
  const name = brand.name ?? "Your business";
  return (
    <div className="vs-sheet-brand">
      {brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : <span style={{ background: brand.floor.primary ?? "var(--vs-violet)" }} aria-hidden="true">{name.charAt(0)}</span>}
      {name}
    </div>
  );
}

export function FormSheet({ form, brand, device }: { form: StudioForm; brand: Brand; device: Device }) {
  return (
    <article className="vs-sheet" data-device={device} aria-label={`${form.name}, as visitors see it`}>
      <BrandMark brand={brand} />
      <h1>{form.name}</h1>
      {form.intro && <p className="vs-sheet-intro">{form.intro}</p>}
      {form.fields.length === 0 ? (
        <p className="vs-sheet-intro">This form has no questions yet. Tell Paige what to ask.</p>
      ) : form.fields.map((f) => <Question key={f.key} field={f} />)}
      <button type="button" className="vs-sheet-submit" style={{ background: brand.floor.primary ?? "var(--vs-violet)" }} tabIndex={-1} aria-hidden="true">{form.submitLabel}</button>
      {form.thankYou && <p className="vs-sheet-thanks">After sending: “{form.thankYou}”</p>}
    </article>
  );
}

function PageView({ page, brand, device, tenantId }: { page: StudioPage; brand: Brand; device: Device; tenantId: string }) {
  if (page.blocks.length === 0) return <div className="vs-stage-empty"><b>This page is empty</b>Tell Paige what it should say.</div>;
  return (
    <div className="vs-page-frame" style={device === "phone" ? { width: 390 } : undefined}>
      <LivePreview blocks={page.blocks} theme={page.theme ?? undefined} brandFloor={brand.floor} tenantId={tenantId} device={device === "phone" ? "mobile" : "desktop"} />
    </div>
  );
}

function FunnelView({ funnel, brand, device, tenantId }: { funnel: StudioFunnel; brand: Brand; device: Device; tenantId: string }) {
  const [rawActive, setActive] = React.useState(0);
  const active = Math.min(rawActive, Math.max(funnel.steps.length - 1, 0));
  const [step, setStep] = React.useState<LoadedArtifact | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const current = funnel.steps[active];
  React.useEffect(() => {
    let live = true;
    setStep(null); setError(null);
    if (!current || current.type === "thankyou" || current.type === "payment" || current.type === "booking") return;
    const ref: ArtifactRef | null = current.type === "form" && current.formId
      ? { kind: "form", id: current.formId, title: "" }
      : current.pageId ? { kind: "page", id: current.pageId, title: "" } : null;
    if (!ref) { setError("This step has nothing attached to it yet."); return; }
    loadArtifact(ref).then((a) => { if (live) setStep(a); }).catch((e) => { if (live) setError(plainError(e, "This step couldn't be loaded. Try again in a moment.")); });
    return () => { live = false; };
  }, [current]);
  const WORD = { page: "Page", form: "Form", payment: "Payment", booking: "Booking", thankyou: "Thank you" } as const;
  const label = (s: StudioFunnel["steps"][number], i: number) => `${i + 1} ${WORD[s.type]}`;
  return (
    <>
      <nav className="vs-steps-strip" aria-label="Funnel steps">
        {funnel.steps.map((s, i) => (
          <button key={s.id} type="button" aria-pressed={i === active} onClick={() => setActive(i)}>{label(s, i)}</button>
        ))}
      </nav>
      {error && <p className="vs-alert" role="alert">{error}</p>}
      {current?.type === "thankyou" && <div className="vs-stage-empty"><b>Thank-you step</b>Visitors land here after the last step.</div>}
      {(current?.type === "payment" || current?.type === "booking") && <div className="vs-stage-empty"><b>{WORD[current.type]} step</b>{current.type === "payment" ? "Visitors pay here with the checkout you've connected." : "Visitors pick a time on your calendar here."}</div>}
      {step?.kind === "form" && <FormSheet form={step.form} brand={brand} device={device} />}
      {step?.kind === "page" && <PageView page={step.page} brand={brand} device={device} tenantId={tenantId} />}
      {!step && !error && current && (current.type === "page" || current.type === "form") && <Building />}
    </>
  );
}

function DocumentView({ id, tenantId }: { id: string; tenantId: string }) {
  const [doc, setDoc] = React.useState<StudioDocument | null | undefined>(undefined);
  React.useEffect(() => {
    let live = true;
    setDoc(undefined);
    loadDocument(tenantId, id).then((d) => { if (live) setDoc(d); }).catch(() => { if (live) setDoc(null); });
    return () => { live = false; };
  }, [id, tenantId]);
  if (doc === undefined) return <Building />;
  if (doc === null) return <div className="vs-stage-empty"><b>This document is empty</b>Tell Paige what it should cover.</div>;
  return <div className="vs-doc-frame"><DocumentPreview document={doc} /></div>;
}

export function Building() {
  return <div className="vs-building" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>;
}

// ── The build view ─────────────────────────────────────────────────────────────────────────────
// While Paige works, the stage shows the sheet the work will land on, assembling. Its shape comes
// only from the steps the stream has actually sent (a fixed server vocabulary): before the first
// one it is a neutral sheet; once she is designing a page it becomes a page, and so on. Nothing here
// plays a script the stream did not report.
const SHAPE_WORD: Record<BuildShape, string> = {
  sheet: "Paige is getting started", page: "Paige is building your page", form: "Paige is building your form",
  funnel: "Paige is building your funnel", image: "Paige is making your image",
};

function Wire({ shape, brand }: { shape: BuildShape; brand: Brand }) {
  const accent = { background: brand.floor.primary ?? "var(--vs-violet)" };
  if (shape === "page") {
    return (
      <div className="vs-wire vs-wire-page">
        <i className="vs-w-nav" /><div className="vs-w-hero" style={accent}><i /><i /><i className="vs-w-cta" /></div>
        <div className="vs-w-cols"><span><i /><i /><i /></span><span><i /><i /><i /></span><span><i /><i /><i /></span></div>
        <i className="vs-w-line" /><i className="vs-w-line vs-w-short" /><i className="vs-w-btn" style={accent} />
      </div>
    );
  }
  if (shape === "form") {
    return (
      <div className="vs-wire vs-wire-form">
        <i className="vs-w-title" /><i className="vs-w-line vs-w-short" />
        {[0, 1, 2, 3].map((n) => <span key={n} className="vs-w-field"><i /><b /></span>)}
        <i className="vs-w-btn" style={accent} />
      </div>
    );
  }
  if (shape === "funnel") {
    return (
      <div className="vs-wire vs-wire-funnel">
        {["Page", "Form", "Thank you"].map((w, n) => (
          <React.Fragment key={w}>
            {n > 0 && <i className="vs-w-link" />}
            <span className="vs-w-mini"><i style={n === 0 ? accent : undefined} /><i /><i /><small>{w}</small></span>
          </React.Fragment>
        ))}
      </div>
    );
  }
  if (shape === "image") return <div className="vs-wire vs-wire-image"><span /></div>;
  return <div className="vs-wire vs-wire-sheet"><i className="vs-w-title" /><i className="vs-w-line" /><i className="vs-w-line" /><i className="vs-w-line vs-w-short" /></div>;
}

/** The stage while Paige works and nothing is on it yet. */
export function BuildView({ steps, status, brand }: { steps: BuildStep[]; status: string | null; brand: Brand }) {
  const shape = shapeFromSteps(steps);
  const latest = steps[steps.length - 1];
  const caption = latest?.label ?? status ?? SHAPE_WORD[shape];
  const done = steps.slice(0, -1).slice(-3);
  return (
    <div className="vs-build" data-shape={shape}>
      <div className="vs-build-sheet" aria-hidden="true">
        <Wire key={shape} shape={shape} brand={brand} />
        <span className="vs-build-light" />
      </div>
      <div className="vs-build-caption" role="status" aria-live="polite">
        <span className="vs-build-orb" aria-hidden="true" />
        <span key={caption} className="vs-build-now">{caption}</span>
      </div>
      {done.length > 0 && (
        <ul className="vs-build-done" aria-label="Done so far">
          {done.map((s) => <li key={s.id}>{s.label}</li>)}
        </ul>
      )}
    </div>
  );
}

/** A page Paige designed this turn but did not save: shown honestly, as not saved. */
function PreviewView({ preview, waiting, brand, device, tenantId }: { preview: DraftPreview; waiting: boolean; brand: Brand; device: Device; tenantId: string }) {
  return (
    <>
      <p className="vs-unsaved" role="status">
        <b>Designed, not saved yet.</b>
        {waiting ? " Approve the save in the chat to keep it." : " Ask Paige to save it to keep it in this project."}
      </p>
      <div className="vs-page-frame" style={device === "phone" ? { width: 390 } : undefined}>
        <LivePreview blocks={preview.blocks as GrowthBlock[]} theme={(preview.theme as GrowthPageTheme | null) ?? undefined} brandFloor={brand.floor} tenantId={tenantId} device={device === "phone" ? "mobile" : "desktop"} />
      </div>
    </>
  );
}

export function StudioStage({ artifact, brand, device, tenantId, building, steps = [], status = null, preview = null, waitingApproval = false }: {
  artifact: LoadedArtifact | null; brand: Brand; device: Device; tenantId: string; building: boolean;
  steps?: BuildStep[]; status?: string | null; preview?: DraftPreview | null; waitingApproval?: boolean;
}) {
  // Working on something already on the stage: it stays visible, with the light passing over it.
  const reworking = building && !!artifact;
  return (
    <div className="vs-stage-inner" data-reworking={reworking || undefined}>
      {reworking && (
        <p className="vs-working" role="status" aria-live="polite">
          <span className="vs-build-orb" aria-hidden="true" />
          <span key={steps[steps.length - 1]?.label ?? status ?? ""}>Paige is working: {steps[steps.length - 1]?.label ?? status ?? "on your changes"}</span>
        </p>
      )}
      {!artifact ? (
        building ? <BuildView steps={steps} status={status} brand={brand} />
        : preview ? <PreviewView preview={preview} waiting={waitingApproval} brand={brand} device={device} tenantId={tenantId} />
        : <div className="vs-stage-empty"><b>Nothing on the stage yet</b>Tell Paige what to build, and it appears here as she makes it.</div>
      ) : artifact.kind === "form" ? (
        <FormSheet form={artifact.form} brand={brand} device={device} />
      ) : artifact.kind === "page" ? (
        <PageView page={artifact.page} brand={brand} device={device} tenantId={tenantId} />
      ) : artifact.kind === "funnel" ? (
        <FunnelView funnel={artifact.funnel} brand={brand} device={device} tenantId={tenantId} />
      ) : artifact.image.contentKind === "document" ? (
        <DocumentView id={artifact.image.id} tenantId={tenantId} />
      ) : artifact.image.contentKind === "copy" ? (
        <article className="vs-sheet vs-copy" data-device={device} aria-label={artifact.image.title}>
          <h1>{artifact.image.title}</h1>
          {artifact.image.body ? artifact.image.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>) : <p className="vs-sheet-intro">No words saved yet.</p>}
        </article>
      ) : (
        <div className="vs-images">
          <figure className="vs-image" style={{ margin: 0 }}>
            {artifact.image.imageUrl ? <img src={artifact.image.imageUrl} alt={artifact.image.title} /> : <div>This image has no file yet.</div>}
            <figcaption><div><span className="vs-trunc">{artifact.image.title}</span>{artifact.image.live && <span>Live</span>}</div></figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
