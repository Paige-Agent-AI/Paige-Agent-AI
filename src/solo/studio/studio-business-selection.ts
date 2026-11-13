import type { StudioBusinessTarget, StudioProjectContext } from "./studio-data";

/** Keep authored choices separate from the selected record's expected revision. */
export function applyStudioBusinessSelection(context: StudioProjectContext, business: StudioBusinessTarget | null, manualReference: string): StudioProjectContext {
  if (context.target.kind !== "client" && context.target.kind !== "prospect") return context;
  const { business_source: _previous, business_name: _previousName, ...rest } = context;
  if (!business) return { ...rest, target: { kind: context.target.kind, reference: manualReference } };
  return { ...rest,
    target: { kind: context.target.kind, reference: business.id, ...(business.entity_name.length <= 200 ? { label: business.entity_name } : {}) },
    business_name: business.entity_name,
    business_source: { id: business.id, updated_at: business.updated_at },
  };
}
