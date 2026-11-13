import * as React from "react";
import { ChevronRight } from "lucide-react";
import { studioProjectValues, type StudioBusinessContext, type StudioContextFact, type StudioContextTarget, type StudioEditableContextField } from "./business-context";
import "./studio-business-context.css";

type ProjectValues = StudioBusinessContext["projectValues"];
export interface StudioBusinessContextPanelProps {
  projection: StudioBusinessContext;
  /** Original project field state, including incomplete input during editing. */
  projectValues?: ProjectValues;
  onChange: (projectValues: ProjectValues) => void;
  /** Selection only. The caller must resolve any reference and its access. */
  onTargetChange: (kind: StudioContextTarget["kind"]) => void;
  disabled?: boolean;
  businessSelection?: React.ReactNode;
  selectedBusinessName?: string;
}

const TARGETS = [
  ["workspace", "My business"], ["custom", "Custom"], ["client", "Client"], ["prospect", "Prospect"],
] as const;
const EDITORS: { key: StudioEditableContextField; label: string; private?: boolean }[] = [
  { key: "publicName", label: "Business name" },
  { key: "offers", label: "Offer" },
  { key: "idealCustomer", label: "Audience" },
  { key: "brandVoice", label: "Brand voice", private: true },
  { key: "primaryColor", label: "Primary color" },
  { key: "accentColor", label: "Accent color" },
];

function sourceLabel(fact: StudioContextFact): string {
  return fact.source.kind === "public_brand" ? "Observed public brand"
    : fact.source.kind === "setup" ? "Confirmed in Setup" : "Confirmed for selected brand";
}

function contextMessage(projection: StudioBusinessContext): string | null {
  if (projection.reason === "read_pending") return "Reading saved context. You can still enter project details.";
  if (projection.status === "conflict") return "Saved context has conflicting versions. Review its source before using it.";
  if (projection.target?.kind !== "workspace" && projection.status !== "available") return "Workspace context is not used for this brand. Enter any missing project details below.";
  if (projection.status !== "available") return "Saved context is unavailable. Enter only the details needed for this project.";
  if (projection.issues.some((issue) => issue.code === "brand_unavailable" || issue.code === "brand_scope_mismatch")) return "Saved business facts are available; public branding is unavailable for this target.";
  return null;
}

/** A project-only editor. It has no reader, authorization, save or publish seam. */
export function StudioBusinessContextPanel({ projection, projectValues = projection.projectValues, onChange, onTargetChange, disabled = false, businessSelection, selectedBusinessName }: StudioBusinessContextPanelProps) {
  const uid = React.useId();
  const facts = [...projection.copyFacts, ...projection.privateGuidance, ...projection.brandFacts];
  const byField = new Map(facts.map((fact) => [fact.key, fact]));
  const ownValue = (field: StudioEditableContextField) => Object.prototype.hasOwnProperty.call(projectValues, field);
  const defaultName = studioProjectValues({}, selectedBusinessName).publicName;
  const businessName = ownValue("publicName") ? projectValues.publicName : byField.get("publicName")?.value ?? defaultName;
  const target = projection.target;
  const targetLabel = target?.kind === "workspace" ? "My business"
    : target ? `${target.kind === "custom" ? "Custom" : target.kind === "client" ? "Client" : "Prospect"}${target.label ? ` · ${target.label}` : " brand"}` : "Choose a brand";
  const message = contextMessage(projection);
  const extraFacts = facts.filter((fact) => !EDITORS.some((editor) => editor.key === fact.key));
  const hasEdits = Object.keys(projectValues).length > 0;

  return <details className="vs-business-context">
    <summary>
      <ChevronRight aria-hidden="true" className="vs-context-chevron" />
      <span className="vs-context-summary"><strong>Project context{businessName ? ` · ${businessName}` : ""}</strong><span>{targetLabel}</span></span>
      <span className="vs-context-summary-action">Review & edit</span>
    </summary>
    <div className="vs-context-body">
      <fieldset className="vs-context-target" disabled={disabled}>
        <legend>Brand for this project</legend>
        <div className="vs-context-targets">
          {TARGETS.map(([kind, label]) => <button key={kind} type="button" aria-pressed={target?.kind === kind} onClick={() => onTargetChange(kind)} disabled={disabled}>{label}</button>)}
        </div>
      </fieldset>
      {businessSelection}
      {message && <p className="vs-context-notice" role="status">{message}</p>}
      <p className="vs-context-note">Edits apply to this project. Setup stays unchanged.</p>
      <div className="vs-context-fields">
        {EDITORS.map((editor) => {
          const fact = byField.get(editor.key);
          const isEdit = ownValue(editor.key);
          const issue = projection.issues.find((item) => item.source === "project" && item.field === editor.key);
          const selectedName = editor.key === "publicName" ? defaultName : undefined;
          const hint = isEdit ? "Project edit" : fact ? sourceLabel(fact) : selectedName ? "Selected business name" : "Not provided";
          const id = `${uid}-${editor.key}`;
          return <div className="vs-context-field" key={editor.key}>
            <label htmlFor={id}>{editor.label}</label>
            <input id={id} type="text" value={isEdit ? projectValues[editor.key] ?? "" : fact?.value ?? selectedName ?? ""}
              maxLength={editor.key === "primaryColor" || editor.key === "accentColor" ? 7 : 4000}
              disabled={disabled} autoComplete="off" aria-describedby={`${id}-source`} aria-invalid={issue ? true : undefined}
              onChange={(event) => onChange({ ...projectValues, [editor.key]: event.target.value })} />
            <span id={`${id}-source`} className="vs-context-source">{editor.private ? "Private guidance · " : ""}{issue ? issue.code === "sensitive_value" ? "Remove sensitive details" : "Check this project value" : hint}</span>
          </div>;
        })}
      </div>
      {extraFacts.length > 0 && <details className="vs-context-sources">
        <summary>Other source context <span>{extraFacts.length}</span></summary>
        <dl>{extraFacts.map((fact) => <div key={fact.key}><dt>{fact.label}{fact.key === "doNotAssume" ? " · Private guidance" : ""}</dt><dd>{fact.value}<span>{sourceLabel(fact)}</span></dd></div>)}</dl>
      </details>}
      {hasEdits && <button type="button" className="vs-context-reset" disabled={disabled} onClick={() => onChange({})}>Clear project edits</button>}
    </div>
  </details>;
}
