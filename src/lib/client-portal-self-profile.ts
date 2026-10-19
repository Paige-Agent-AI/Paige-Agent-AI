/** Validates canonical server readback, never grants customer or tenant authority. */
export interface ClientPortalSelfProfile {
  id: string;
  tenant_id: string;
  linked_user_id: string;
  first_name: string | null;
  last_name: string | null;
  entity_name: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  onboarding_stage: string | null;
  is_signup_contact: boolean;
  paige_shared_context_consent: boolean;
  paige_shared_context_consent_updated_at: string | null;
  updated_at: string | null;
  email: string | null;
  phone: string | null;
  contact_methods: Array<{ kind: "email" | "phone"; value: string; is_primary: boolean }>;
}

const nullableStrings = ["first_name", "last_name", "entity_name", "street_address", "city", "state", "zip_code",
  "onboarding_stage", "email", "phone", "updated_at", "paige_shared_context_consent_updated_at"] as const;
const fields = new Set<string>(["id", "tenant_id", "linked_user_id", ...nullableStrings,
  "is_signup_contact", "paige_shared_context_consent", "contact_methods"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readClientPortalSelfProfile(value: unknown, actorId: string, tenantId?: string): ClientPortalSelfProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !uuid.test(actorId)) return null;
  const row = value as Record<string, unknown>;
  // Refuse a widened/foreign contract instead of letting private fields ride a spread.
  if (Object.keys(row).length !== fields.size || Object.keys(row).some(key => !fields.has(key))
    || row.linked_user_id !== actorId || typeof row.id !== "string" || !uuid.test(row.id)
    || typeof row.tenant_id !== "string" || !uuid.test(row.tenant_id)
    || (tenantId !== undefined && row.tenant_id !== tenantId)
    || nullableStrings.some(key => row[key] !== null && typeof row[key] !== "string")
    || typeof row.is_signup_contact !== "boolean" || typeof row.paige_shared_context_consent !== "boolean"
    || !Array.isArray(row.contact_methods)) return null;
  const methods: ClientPortalSelfProfile["contact_methods"] = [];
  for (const item of row.contact_methods) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const method = item as Record<string, unknown>;
    if (Object.keys(method).length !== 3 || !Object.keys(method).every(key => ["kind", "value", "is_primary"].includes(key))
      || (method.kind !== "email" && method.kind !== "phone") || typeof method.value !== "string"
      || typeof method.is_primary !== "boolean") return null;
    methods.push({ kind: method.kind, value: method.value, is_primary: method.is_primary });
  }
  return { id: row.id, tenant_id: row.tenant_id, linked_user_id: actorId,
    first_name: row.first_name as string | null, last_name: row.last_name as string | null,
    entity_name: row.entity_name as string | null, street_address: row.street_address as string | null,
    city: row.city as string | null, state: row.state as string | null, zip_code: row.zip_code as string | null,
    onboarding_stage: row.onboarding_stage as string | null, is_signup_contact: row.is_signup_contact,
    paige_shared_context_consent: row.paige_shared_context_consent,
    paige_shared_context_consent_updated_at: row.paige_shared_context_consent_updated_at as string | null,
    updated_at: row.updated_at as string | null, email: row.email as string | null, phone: row.phone as string | null,
    contact_methods: methods };
}
