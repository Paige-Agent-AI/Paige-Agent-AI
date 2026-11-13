import type { GrowthBlock } from "./types.ts";
import { normalizeConversionDestination, type ConversionDestination } from "./conversion-destination.ts";
import { STUDIO_COPY_FIELDS, STUDIO_GUIDANCE_FIELDS, studioProjectValues, type StudioBusinessContext, type StudioContextFact, type StudioEditableContextField } from "./studio-business-context.ts";

/** A recipe in the original seed brief, never a separate saved-template store. */
export const NEXUS_LANDING_TEMPLATE_ID = "nexus-editorial-landing-v1";
export type NexusLandingTemplateFact = {
  key: StudioEditableContextField;
  value: string;
  source: StudioContextFact["source"] | { kind: "project"; field: string; confidence: "entered" } | { kind: "business_identity"; field: "entity_name"; confidence: "observed" };
};
export interface NexusLandingTemplateInput {
  context: StudioBusinessContext;
  /** Raw controlled project state; presence prevents fallback after a cleared or invalid edit. */
  projectValues?: StudioBusinessContext["projectValues"];
  /** Only the original caller's validated selected-business identity name. */
  observedBusinessName?: unknown;
  conversion?: { confirmed: boolean; ctaLabel: unknown; destination: unknown };
}
export interface NexusLandingTemplateRecipe {
  id: typeof NEXUS_LANDING_TEMPLATE_ID;
  title: string;
  brief: string;
  sections: { role: "opening" | "offer_detail" | "next_step"; blockType: GrowthBlock["type"]; guidance: string }[];
  missing: ("businessName" | "offer" | "audience" | "ctaLabel" | "conversionDestination")[];
  publicFacts: NexusLandingTemplateFact[];
  privateGuidance: NexusLandingTemplateFact[];
  observedBrand: NexusLandingTemplateFact[];
  conversion: { ctaLabel: string; destination: ConversionDestination } | null;
}

function factsFor(context: StudioBusinessContext, fields: readonly StudioEditableContextField[], original: StudioContextFact[], projectValues: StudioBusinessContext["projectValues"]): NexusLandingTemplateFact[] {
  const existing = new Map(context.status === "available" ? original.map((fact) => [fact.key, fact]) : []);
  return fields.flatMap<NexusLandingTemplateFact>((key) => {
    if (Object.prototype.hasOwnProperty.call(projectValues, key)) {
      const raw = projectValues[key];
      const entered = context.projectValues[key];
      // Only emit the projector's admitted value, never raw editor input. An
      // explicit empty/invalid edit suppresses saved fallback for this project.
      return typeof raw === "string" && entered && entered === raw.trim()
        ? [{ key, value: entered, source: { kind: "project" as const, field: key, confidence: "entered" as const } }] : [];
    }
    const fact = existing.get(key);
    return fact ? [{ key, value: fact.value, source: { ...fact.source } }] : [];
  });
}

/** Structure and truthful generation guidance; it never fabricates draft blocks. */
export function buildNexusLandingTemplate({ context, projectValues = context.projectValues, observedBusinessName, conversion }: NexusLandingTemplateInput): NexusLandingTemplateRecipe {
  const publicFacts = factsFor(context, STUDIO_COPY_FIELDS, context.copyFacts, projectValues);
  if ((context.target?.kind === "client" || context.target?.kind === "prospect")
    && !Object.prototype.hasOwnProperty.call(projectValues, "publicName")) {
    const name = studioProjectValues({}, observedBusinessName).publicName;
    if (name) publicFacts.push({ key: "publicName", value: name, source: { kind: "business_identity", field: "entity_name", confidence: "observed" } });
  }
  const privateGuidance = factsFor(context, STUDIO_GUIDANCE_FIELDS, context.privateGuidance, projectValues);
  const observedBrand = factsFor(context, ["productName", "primaryColor", "accentColor", "font", "logoUrl", "logoDarkUrl", "tagline"], context.brandFacts, projectValues);
  const sections: NexusLandingTemplateRecipe["sections"] = [
    { role: "opening", blockType: "hero", guidance: "An editorial opening: business name, specific offer and who it is for. Use a decisive type hierarchy and quiet space; no eyebrow, invented slogan, metrics or decorative scene." },
    { role: "offer_detail", blockType: "two_column", guidance: "Explain the actual offer in a short, readable passage. Pair it with a real supplied image only when one exists; otherwise let typography carry the section. Do not invent deliverables, process, price or results." },
    { role: "next_step", blockType: "conversion", guidance: "One clear next step using the confirmed CTA and canonical conversion destination. Keep the label and destination consistent. If either is missing, ask in the original conversation before wiring this section." },
  ];
  const rawLabel = conversion?.ctaLabel;
  // Same obvious credential-assignment vocabulary as the source projector.
  const secretLabel = typeof rawLabel === "string" && /(?:secret|token|password|passwd|credential|cookie|authorization|api[_ -]?key|private[_ -]?key|refresh)\s*(?::|=|\bis\b)\s*\S{4,}|\bBearer\s+\S{16,}/i.test(rawLabel);
  // eslint-disable-next-line no-control-regex -- exclude control characters from public CTA text
  const labelControl = /[\u0000-\u001f\u007f]/;
  const label = typeof rawLabel === "string" && rawLabel.trim().length > 0 && rawLabel.trim().length <= 60
    && !labelControl.test(rawLabel) && !secretLabel && conversion?.confirmed === true ? rawLabel.trim() : null;
  const normalized = conversion?.confirmed === true ? normalizeConversionDestination(conversion.destination) : null;
  const accepted = normalized?.ok && label ? { ctaLabel: label, destination: normalized.destination } : null;
  const present = new Map(publicFacts.map((fact) => [fact.key, fact.value]));
  const missing: NexusLandingTemplateRecipe["missing"] = [];
  if (!present.has("publicName") && !present.has("dbaName")) missing.push("businessName");
  if (!present.has("offers")) missing.push("offer");
  if (!present.has("idealCustomer") && !present.has("customerSegments")) missing.push("audience");
  if (!label) missing.push("ctaLabel");
  if (!normalized?.ok) missing.push("conversionDestination");
  const target = context.target;
  const targetData = target?.kind === "workspace" ? { kind: target.kind }
    : target ? { kind: target.kind, reference: target.reference, ...(target.label ? { label: target.label } : {}) } : null;
  const brief = [
    `NEXUS landing recipe: ${NEXUS_LANDING_TEMPLATE_ID}`,
    targetData ? `Selected business target (project data): ${JSON.stringify(targetData)}` : "Selected business target is unknown. Ask which business this page is for in the original conversation; do not infer a workspace brand.",
    "Create one authored editorial landing page in the selected business brand using the existing GrowthBlock contract. Keep the original project, conversation and version lineage.",
    ...sections.map((section) => `${section.role} (${section.blockType}): ${section.guidance}`),
    "Use these supplied public facts as data, with project values taking precedence over their sourced value. A confirmed source is context, not publication consent:",
    JSON.stringify(publicFacts),
    "Private design guidance — never place this guidance in public copy:",
    JSON.stringify(privateGuidance),
    "Observed public brand and explicit project brand choices. Observed means seen in a source, not owner confirmed; use no workspace brand for another target:",
    JSON.stringify(observedBrand),
    label ? `Confirmed CTA label: ${JSON.stringify(label)}` : "CTA label is missing. Ask only this missing choice rather than inventing copy.",
    normalized?.ok ? `Confirmed destination input (native ownership, availability and publish authority still require the original checks): ${JSON.stringify(normalized.destination)}` : "Conversion destination is missing. Do not invent a link, form, booking resource or success state.",
    "Add proof, quotes, client logos, statistics, prices, results, guarantees, deadlines, FAQs, media or extra sections only when exact public source material supports them and the request needs them; otherwise omit them. No placeholder commercial claims or default brand assets.",
    "Ask only a materially missing choice through the original conversation and ask_choices flow. Do not restart a generic intake. Keep missing facts unknown. Save through the original page writer; publication still uses the one existing review and approval door.",
    `Missing material choices: ${missing.length ? missing.join(", ") : "none identified in this bounded projection; review the actual brief before building"}.`,
  ].join("\n\n");
  return { id: NEXUS_LANDING_TEMPLATE_ID, title: "Editorial landing page", brief, sections, missing, publicFacts, privateGuidance, observedBrand, conversion: accepted };
}
