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

export function StudioStage({ artifact, brand, device, tenantId, building }: {
  artifact: LoadedArtifact | null; brand: Brand; device: Device; tenantId: string; building: boolean;
}) {
  return (
    <div className="vs-stage-inner">
      {!artifact ? (
        building ? <Building /> : <div className="vs-stage-empty"><b>Nothing on the stage yet</b>Tell Paige what to build, and it appears here as she makes it.</div>
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
