import { confirmFingerprint } from "../confirm-fingerprint.ts";
import { classifyAction } from "../action-risk.ts";
import { canonicalizePersonName } from "../canonical-person-name.ts";
import { CRM_PATCH_FIELDS } from "./patch-fields.generated.ts";
import { normalizeClientRef } from "../client-ref.ts";

export const CRM_ACTION_CAPABILITY = {
  "contact.create": "crm_create_contact", "contact.update": "crm_update_contact",
  "contact.archive": "crm_archive_contact", "contact.restore": "crm_restore_contact",
  "contact.link_company": "crm_link_contact_company", "contact.unlink_company": "crm_unlink_contact_company",
  "contact.assign_coach": "crm_assign_coach", "contact.assign_owner": "crm_assign_contact_owner",
  "contact.merge": "crm_merge_contacts", "contact.hard_delete": "crm_hard_delete_contact",
  "contact.bulk_update": "crm_bulk_update_contacts",
  "company.create": "crm_create_company", "company.update": "crm_update_company",
  "company.archive": "crm_archive_company", "company.restore": "crm_restore_company",
  "task.create": "crm_create_task", "task.update": "crm_update_task", "task.assign": "crm_assign_task",
  "task.reschedule": "crm_reschedule_task", "task.complete": "crm_complete_task",
  "task.reopen": "crm_reopen_task", "task.cancel": "crm_cancel_task", "task.delete": "crm_delete_task",
  "activity.log": "crm_log_activity",
  "deal.create": "deal_create", "deal.update": "crm_update_deal",
  "deal.assign_owner": "crm_assign_deal_owner", "deal.assign_contact": "crm_assign_deal_contact",
  "deal.move": "deal_move_stage", "deal.close": "crm_close_deal",
  "deal.reopen": "crm_reopen_deal", "deal.delete": "crm_delete_deal",
} as const;

export type CrmAction = keyof typeof CRM_ACTION_CAPABILITY;
export type CrmCapability = typeof CRM_ACTION_CAPABILITY[CrmAction];
export const CRM_TOOL_TO_ACTION = Object.freeze(Object.fromEntries(
  Object.entries(CRM_ACTION_CAPABILITY).map(([action, capability]) => [capability, action]),
)) as Readonly<Record<CrmCapability, CrmAction>>;

/**
 * The actions crm-command never executes from a full command after approval: it binds a preview and
 * stores the proposal as `{ action, preview_id }` instead. ONE home (§18) — the door decides with it,
 * and the chat's approval resume (C4b) reads it to leave these proposals on their existing path,
 * because the door's request contract cannot take a preview binding back as a command.
 */
export const CRM_PREVIEW_REQUIRED_ACTIONS: ReadonlySet<CrmAction> = new Set<CrmAction>([
  "contact.merge", "contact.hard_delete", "contact.bulk_update", "task.delete", "deal.delete",
]);
export const CRM_COMMAND_TOOL_NAMES = new Set<CrmCapability>(Object.keys(CRM_TOOL_TO_ACTION) as CrmCapability[]);

declare const canonicalCrmCommandBrand: unique symbol;
export type CanonicalCrmCommand<T extends Record<string, unknown> = Record<string, unknown>> =
  T & { readonly [canonicalCrmCommandBrand]: true };
export const CRM_COMMAND_CANONICAL_IDENTITY_FIELD = "__paige_canonical_identity_v1" as const;
export const CRM_COMMAND_LEGACY_DISPLAY_FIELD = "__paige_legacy_display_v1" as const;

const CONTACT_NAME_FIELDS = ["first_name", "last_name"] as const;
const fingerprintArgsByCanonicalCommand = new WeakMap<object, Record<string, unknown>>();

function buildCrmCommandFingerprintArgs(command: Record<string, unknown>): Record<string, unknown> {
  const args = Object.fromEntries(Object.entries(command).filter(([key]) => key !== "action"));
  if (command.action !== "contact.create") return Object.freeze(args);
  const sourcePatch = args.patch;
  if (!sourcePatch || typeof sourcePatch !== "object" || Array.isArray(sourcePatch)) {
    return Object.freeze(args);
  }
  const patch = { ...sourcePatch as Record<string, unknown> };
  for (const field of CONTACT_NAME_FIELDS) {
    const canonicalName = canonicalizePersonName(patch[field]);
    if (canonicalName) patch[field] = canonicalName.identity;
  }
  return Object.freeze({ ...args, patch: Object.freeze(patch) });
}

function markCanonicalCrmCommand<T extends Record<string, unknown>>(command: T): CanonicalCrmCommand<T> {
  const frozen = Object.freeze(command);
  fingerprintArgsByCanonicalCommand.set(frozen, buildCrmCommandFingerprintArgs(frozen));
  return frozen as CanonicalCrmCommand<T>;
}

/**
 * Returns the precomputed hash projection for a command issued by the
 * canonical command boundary. Raw/model arguments are rejected at runtime,
 * and the branded parameter prevents an uncanonicalized call at compile time.
 */
export function crmCommandFingerprintArgs(command: CanonicalCrmCommand): Record<string, unknown> {
  const args = fingerprintArgsByCanonicalCommand.get(command);
  if (!args) throw new TypeError("CRM_COMMAND_NOT_CANONICAL");
  return args;
}

/**
 * Adds the server-derived identity projection consumed only by the database
 * replay hash. The executable command remains the canonical display form.
 * Raw/model commands fail here because only canonicalizeCrmCommand registers
 * the WeakMap marker used by crmCommandFingerprintArgs.
 */
export function crmCommandLegacyReplaySource(
  command: CanonicalCrmCommand,
  source: Record<string, unknown> | null | undefined,
): Readonly<Record<string, unknown>> | null {
  if (command.action !== "contact.create" || !source) return null;
  const contextualSource = command.approval_channel === undefined
    ? source
    : { ...source, approval_channel: command.approval_channel };
  const canonicalSource = canonicalizeCrmCommand(contextualSource);
  const expectedIdentity = stableCommandValue({
    action: command.action,
    ...crmCommandFingerprintArgs(command),
  });
  const sourceIdentity = stableCommandValue({
    action: canonicalSource.action,
    ...crmCommandFingerprintArgs(canonicalSource),
  });
  if (JSON.stringify(sourceIdentity) !== JSON.stringify(expectedIdentity)) {
    throw new TypeError("CRM_COMMAND_LEGACY_REPLAY_MISMATCH");
  }
  return Object.freeze(stableCommandValue(contextualSource) as Record<string, unknown>);
}

export type CrmCommandIdempotencyContext = Readonly<{
  thread_id: string | null;
  user_turn_ordinal: number;
  user_turn: unknown;
  tool_name: string;
}>;

/**
 * Settles both sides of the contact-create retry-identity rollout.
 *
 * The current key is the only key used for a new proposal or mutation. The
 * legacy key is the exact value an older Chat bundle derived from the
 * pre-normalization arguments, and is therefore a readback-only candidate.
 * The legacy command must first canonicalize to the same complete identity,
 * so an unrelated raw command cannot acquire a compatibility key here.
 */
export async function crmCommandFallbackIdempotencyKeys(
  command: CanonicalCrmCommand,
  source: Record<string, unknown> | null | undefined,
  context: CrmCommandIdempotencyContext,
): Promise<Readonly<{
  current: string;
  legacy: string | null;
  legacyCommand: Readonly<Record<string, unknown>> | null;
}>> {
  const current = await confirmFingerprint("crm_command_idempotency", {
    ...context,
    arguments: crmCommandFingerprintArgs(command),
  });
  const legacyCommand = crmCommandLegacyReplaySource(command, source);
  if (!legacyCommand) return Object.freeze({ current, legacy: null, legacyCommand: null });
  const legacyArguments = Object.fromEntries(
    Object.entries(legacyCommand).filter(([key]) => key !== "action"),
  );
  const legacy = await confirmFingerprint("crm_command_idempotency", {
    ...context,
    arguments: legacyArguments,
  });
  return Object.freeze({
    current,
    legacy: legacy === current ? null : legacy,
    legacyCommand,
  });
}

export function crmCommandExecutionPayload(
  command: CanonicalCrmCommand,
  legacySource?: Record<string, unknown> | null,
): Record<string, unknown> {
  const fingerprintArgs = crmCommandFingerprintArgs(command);
  // Contact creation is the only command whose executable display spelling intentionally differs
  // from its retry identity. Leaving every other action byte-for-byte unchanged also preserves the
  // existing preview hashes used by destructive commands.
  if (command.action !== "contact.create") return command;
  const identity = Object.freeze({ action: command.action, ...fingerprintArgs });
  const legacyDisplay = crmCommandLegacyReplaySource(command, legacySource);
  return Object.freeze({
    ...command,
    [CRM_COMMAND_CANONICAL_IDENTITY_FIELD]: identity,
    ...(legacyDisplay ? { [CRM_COMMAND_LEGACY_DISPLAY_FIELD]: legacyDisplay } : {}),
  });
}

function stableCommandValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCommandValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
      .map((key) => [key, stableCommandValue((value as Record<string, unknown>)[key])]));
  }
  return value;
}

const LEGACY_CONTACT_LIFECYCLE: Readonly<Record<string, string>> = Object.freeze({
  lead: "new_lead",
  mql: "qualified",
  sql: "hot_lead",
  opportunity: "negotiating",
  customer: "client_active",
  evangelist: "client_alumni",
  churned: "client_churned",
  archived: "client_alumni",
});

// #1234 replaced the original create-contact arguments with a generic patch object. Existing
// model turns can therefore still carry the historical display-name field and pre-V3 lifecycle
// values. Normalize only those proven aliases; every other unknown or malformed field remains in
// place so the canonical executor rejects it rather than silently guessing.
export function canonicalizeCrmCommand<T extends Record<string, unknown>>(command: T): CanonicalCrmCommand<T> {
  if (command.action !== "contact.create") return markCanonicalCrmCommand({ ...command } as T);
  const sourcePatch = command.patch;
  if (!sourcePatch || typeof sourcePatch !== "object" || Array.isArray(sourcePatch)) {
    return markCanonicalCrmCommand({ ...command } as T);
  }

  const patch = { ...sourcePatch as Record<string, unknown> };
  for (const field of CONTACT_NAME_FIELDS) {
    const canonicalName = canonicalizePersonName(patch[field]);
    if (canonicalName) patch[field] = canonicalName.display;
  }
  const legacyName = canonicalizePersonName(patch.name);
  if (legacyName) {
    const presentCanonicalNameFields = CONTACT_NAME_FIELDS.filter((field) =>
      Object.prototype.hasOwnProperty.call(patch, field)
    );
    const malformedCanonicalNameFields = presentCanonicalNameFields.filter((field) =>
      canonicalizePersonName(patch[field]) === null
    );
    for (const field of malformedCanonicalNameFields) delete patch[field];
    const splitAt = legacyName.display.lastIndexOf(" ");
    const legacyFirstName = splitAt > 0 ? legacyName.display.slice(0, splitAt) : legacyName.display;
    const legacyLastName = splitAt > 0 ? legacyName.display.slice(splitAt + 1) : null;
    if (!canonicalizePersonName(patch.first_name)) patch.first_name = legacyFirstName;
    if (legacyLastName && !canonicalizePersonName(patch.last_name)) patch.last_name = legacyLastName;
    // A canonical value wins only when it is actually usable. Malformed canonical values are
    // removed before the decision, so a valid legacy alias can fill each rejected part instead of
    // being discarded merely because a canonical key existed.
    delete patch.name;
  }

  if (typeof patch.lifecycle_stage === "string"
    && Object.prototype.hasOwnProperty.call(LEGACY_CONTACT_LIFECYCLE, patch.lifecycle_stage)) {
    const canonicalStage = LEGACY_CONTACT_LIFECYCLE[patch.lifecycle_stage];
    if (canonicalStage) patch.lifecycle_stage = canonicalStage;
  }

  return markCanonicalCrmCommand({ ...command, patch: Object.freeze(patch) } as T);
}

export function crmContactCreateNameIssue(
  command: Record<string, unknown>,
): "first_name" | "last_name" | null {
  if (command.action !== "contact.create") return null;
  const patch = command.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return "first_name";
  const namePatch = patch as Record<string, unknown>;
  if (!canonicalizePersonName(namePatch.first_name)) return "first_name";
  if (!canonicalizePersonName(namePatch.last_name)) return "last_name";
  return null;
}


// Canonical stable subject used only to disambiguate one command inside the operator's already-
// approved same-tool set. The subject is always a required opaque record id (or the exact bulk set)
// when the action has one. Consequential argument drift is safe because the stored proposal executes;
// two approved effects for the same subject deliberately remain ambiguous and fail closed. Create
// actions have no pre-existing record id, so they fall back to the normalized full proposed command.
export async function crmApprovalSubject(action: CrmAction, command: Record<string, unknown>): Promise<string> {
  const canonicalCommand = canonicalizeCrmCommand(command);
  // A contact is named by the client_ref Paige was shown, or by its id. The reference wins when
  // present so the proposing call (Paige's arguments) and the approving call (the same arguments,
  // before crm-command resolves them) key on the same value.
  const contact = normalizeClientRef(canonicalCommand.client_ref) ?? canonicalCommand.contact_id ?? null;
  let identity: unknown;
  if (action === "contact.bulk_update") {
    identity = Array.isArray(canonicalCommand.target_client_refs)
      ? [...canonicalCommand.target_client_refs].map((ref) => normalizeClientRef(ref) ?? String(ref)).sort()
      : Array.isArray(canonicalCommand.target_ids) ? [...canonicalCommand.target_ids].map(String).sort() : null;
  } else if (action.startsWith("contact.") && !["contact.create"].includes(action)) {
    identity = contact;
  } else if (action === "company.create") {
    identity = contact;
  } else if (action.startsWith("company.")) {
    identity = canonicalCommand.company_id ?? null;
  } else if (action.startsWith("task.") && action !== "task.create") {
    identity = canonicalCommand.task_id ?? null;
  } else if (action === "activity.log") {
    identity = contact;
  } else if (action.startsWith("deal.") && action !== "deal.create") {
    identity = canonicalCommand.deal_id ?? null;
  } else if (action === "deal.create" && normalizeClientRef(canonicalCommand.client_ref)) {
    // Reference resolution adds the UUID on the server. It must not change the
    // subject Chat uses to find that exact stored proposal. The resolver rejects
    // a mismatched supplied UUID; execution still uses the full stored command.
    const args = { ...crmCommandFingerprintArgs(canonicalCommand) };
    delete args.contact_id;
    identity = stableCommandValue({ action, ...args, client_ref: contact });
  } else {
    identity = stableCommandValue({ action, ...crmCommandFingerprintArgs(canonicalCommand) });
  }
  return await confirmFingerprint(`crm_approval_subject:${action}`, { identity });
}

const CONTACT_LIFECYCLE_STAGES = [
  "new_lead", "qualified", "nurturing", "hot_lead", "negotiating", "won",
  "client_active", "client_paused", "client_churned", "client_funded", "client_alumni",
] as const;

// INT-140: contact creation requires both name parts and tells the model how to split a full
// name - never to invent a missing part. The field allowlist stays the generated registry
// (patchSchemaFor) so the schema cannot drift from the executor's accepted fields.
function contactCreatePatchSchema() {
  // contact.create always has registry fields, so the union's bare-fallback arm is unreachable
  // here; narrow once rather than weakening patchSchemaFor's return type for every action.
  const base = patchSchemaFor("contact.create") as {
    type: string;
    description?: string;
    additionalProperties?: boolean;
    properties: Record<string, Record<string, unknown>>;
  };
  return {
    ...base,
    required: ["first_name", "last_name"],
    properties: Object.fromEntries(Object.entries(base.properties).map(([name, spec]) => {
      if (name === "first_name") return [name, { ...spec, type: "string", description: "First name. Split a supplied full person name into first_name and last_name." }];
      if (name === "last_name") return [name, { ...spec, type: "string", description: "Last name. Ask the operator when it was not supplied; never invent a placeholder." }];
      if (name === "lifecycle_stage") return [name, { ...spec, type: "string", enum: CONTACT_LIFECYCLE_STAGES }];
      return [name, spec];
    })),
  };
}

const properties = {
  idempotency_key: { type: "string", maxLength: 192, description: "Optional stable retry key. Paige may omit it; the server settles one." },
  unlinked_reason: { type: "string", enum: ["anonymous_prospect", "early_stage_prospect", "import_pending_identity"], description: "Deal creation only: explicitly unlinked prospect intent. Never use this to bypass resolving a named client. Omit when client_ref/contact_id is present." },
  client_ref: { type: "string", description: "The contact's client_ref, exactly as crm_search_contacts returned it. This is how you name a contact." },
  loser_client_ref: { type: "string", description: "The losing contact's client_ref for a merge, exactly as crm_search_contacts returned it." },
  contact_id: { type: ["string", "null"], description: "Only when a read gave you a contact's UUID rather than its client_ref (a deal's contact_client_id). Otherwise name the contact with client_ref." },
  loser_contact_id: { type: "string", description: "Only when a read gave you the losing contact's UUID. Otherwise use loser_client_ref." },
  company_id: { type: "string", description: "Exact company UUID from a current CRM read." },
  task_id: { type: "string", description: "Exact task UUID from a current CRM read." },
  deal_id: { type: "string", description: "Exact deal UUID from a current Pipeline read." },
  pipeline_id: { type: "string" }, stage_id: { type: "string" }, target_stage_id: { type: "string" },
  owner_user_id: { type: ["string", "null"], description: "Exact active member UUID. Null unassigns only where supported." },
  expected_updated_at: { type: "string", description: "Exact updated_at returned by the latest read of this record (crm_search_contacts returns it for a contact)." },
  expected_loser_updated_at: { type: "string", description: "Exact losing-contact updated_at returned by the latest read." },
  expected_version: { type: "integer", minimum: 1 }, expected_target_version: { type: "integer", minimum: 1 },
  target_client_refs: { type: "array", minItems: 1, maxItems: 200, items: { type: "string" }, description: "The client_refs of every contact a bulk update touches, exactly as crm_search_contacts returned them." },
  target_ids: { type: "array", minItems: 1, maxItems: 200, items: { type: "string" }, description: "Only when a read gave you contact UUIDs. Otherwise use target_client_refs; never send both." },
  resolutions: { type: "object", additionalProperties: { type: "string", enum: ["survivor", "loser"] } },
  // The OPEN patch, kept only for the actions whose database branch enforces no allowlist —
  // `task.assign`, `task.reschedule` and `activity.log` read specific keys and ignore the rest, so
  // closing them here would invent a constraint prod does not have. Every action that DOES carry an
  // allowlist gets a closed, derived schema instead; see `patchSchemaFor` below.
  patch: { type: "object", description: "Only fields the operator asked to change." },
  title: { type: "string" }, value_cents: { type: "integer", minimum: 0 }, currency: { type: "string" },
  expected_close_date: { type: "string" }, offer_type: { type: "string" }, tags: { type: "array", items: { type: "string" } },
  notes: { type: "string" }, outcome_type: { type: "string", enum: ["won", "lost", "not_fit", "closed_without_decision"] },
  outcome_date: { type: "string" }, reason: { type: "string" },
} as const;

const required: Record<CrmAction, string[]> = {
  "contact.create": ["patch"], "contact.update": ["client_ref","expected_updated_at","patch"],
  "contact.archive": ["client_ref","expected_updated_at"], "contact.restore": ["client_ref","expected_updated_at"],
  "contact.link_company": ["client_ref","company_id","expected_updated_at"], "contact.unlink_company": ["client_ref","expected_updated_at"],
  "contact.assign_coach": ["client_ref","owner_user_id","expected_updated_at"], "contact.assign_owner": ["client_ref","owner_user_id","expected_updated_at"],
  "contact.merge": ["client_ref","loser_client_ref","expected_updated_at","expected_loser_updated_at"],
  "contact.hard_delete": ["client_ref","expected_updated_at"], "contact.bulk_update": ["target_client_refs","patch"],
  "company.create": ["client_ref","patch"], "company.update": ["company_id","expected_updated_at","patch"],
  "company.archive": ["company_id","expected_updated_at"], "company.restore": ["company_id","expected_updated_at"],
  "task.create": ["patch"], "task.update": ["task_id","expected_updated_at","patch"], "task.assign": ["task_id","expected_updated_at","patch"],
  "task.reschedule": ["task_id","expected_updated_at","patch"], "task.complete": ["task_id","expected_updated_at"],
  "task.reopen": ["task_id","expected_updated_at"], "task.cancel": ["task_id","expected_updated_at"], "task.delete": ["task_id","expected_updated_at"],
  "activity.log": ["client_ref","patch"],
  "deal.create": ["title","pipeline_id","stage_id"], "deal.update": ["deal_id","expected_version"],
  "deal.assign_owner": ["deal_id","owner_user_id","expected_version"], "deal.assign_contact": ["deal_id","client_ref","expected_version"],
  "deal.move": ["deal_id","pipeline_id","target_stage_id","expected_version","expected_target_version"],
  "deal.close": ["deal_id","expected_version","outcome_type"], "deal.reopen": ["deal_id","expected_version","target_stage_id"],
  "deal.delete": ["deal_id","expected_version"],
};

/**
 * The operator-readable name of each action. Primarily the model-facing tool description, so some
 * entries carry a trailing "; <caveat>" clause. A surface quoting one to a PERSON takes the leading
 * clause only (`.split(";")[0]`) — see the CRM approval refusal in paige-ai-chat.
 */
export const CRM_ACTION_LABEL: Record<CrmAction, string> = {
  "contact.create":"create a contact", "contact.update":"edit a contact", "contact.archive":"archive a contact", "contact.restore":"restore a contact",
  "contact.link_company":"link a contact to a company", "contact.unlink_company":"unlink a contact from a company", "contact.assign_coach":"change a contact's coach",
  "contact.assign_owner":"change a contact's owner", "contact.merge":"merge two contacts after reviewing conflicts and dependencies",
  "contact.hard_delete":"permanently delete an eligible contact", "contact.bulk_update":"update an exact set of contacts",
  "company.create":"create a company", "company.update":"edit a company", "company.archive":"archive a company", "company.restore":"restore a company",
  "task.create":"create a task; company and deal links are supported, while contact linking remains unavailable until the canonical task model owns that relationship", "task.update":"edit a task", "task.assign":"assign a task", "task.reschedule":"reschedule a task",
  "task.complete":"complete a task", "task.reopen":"reopen a task", "task.cancel":"cancel a task while retaining its history", "task.delete":"permanently delete a task",
  "activity.log":"log an internal CRM activity; this never sends email or SMS and never places a call",
  "deal.create":"create a deal; persist the resolved canonical client_ref, or explicitly state unlinked prospect intent. Ask when a named client is unresolved or ambiguous", "deal.update":"edit reversible deal fields", "deal.assign_owner":"change a deal's owner",
  "deal.assign_contact":"change a deal's contact", "deal.move":"move a deal stage", "deal.close":"close a deal",
  "deal.reopen":"reopen a deal", "deal.delete":"permanently delete a deal",
};

/**
 * The `patch` schema for one action, built from the database's OWN allowlist.
 *
 * On 2026-09-25 an approved contact create reached the executor and threw
 * `CRM_PATCH_FIELDS_INVALID:company_name,zip`. Paige had sent `company_name` and `zip`; the
 * database accepts `entity_name` and `zip_code`. The schema above described `patch` as a bare
 * `{ type: "object" }`, so she had no way to learn the real names and used the ones a person would.
 *
 * The field names below are GENERATED from the `k not in (...)` allowlist inside the plpgsql
 * function that enforces them (`scripts/ci/crm-patch-field-gen.mjs`), never hand-typed here, and
 * `npm run lint:crm-patch-fields` fails if the two drift apart. The seven allowlists are NOT one
 * list — `contact.create` takes `notes` where `contact.update` takes `current_notes`, and
 * `task.create` takes six fields `task.update` rejects — so each action is looked up separately.
 *
 * NAMES ONLY, DELIBERATELY. The allowlist yields field names, not types, so no `type` is asserted
 * per field. Guessing types here would put a constraint in front of the database that the database
 * does not impose, and a wrong guess would refuse a legitimate patch at the schema boundary — a
 * worse failure than the one being fixed, because it would be invisible to the executor's errors.
 *
 * An action with no entry keeps the open patch: its database branch has no allowlist at all.
 */
function patchSchemaFor(action: CrmAction) {
  const fields = CRM_PATCH_FIELDS[action];
  if (!fields?.length) return properties.patch;
  return {
    type: "object",
    description:
      "Only fields the operator asked to change. These exact field names are the complete set the "
      + "server accepts for this action; any other key is refused. Map what the operator said onto "
      + "these names rather than inventing one.",
    properties: Object.fromEntries(
      fields.map((field) => [field.name, field.description ? { description: field.description } : {}]),
    ),
    additionalProperties: false,
  };
}

export const CRM_COMMAND_TOOLS = (Object.entries(CRM_ACTION_CAPABILITY) as [CrmAction, CrmCapability][]).map(([action, capability]) => ({
  type: "function",
  function: {
    name: capability,
    description: `Governed CRM: ${CRM_ACTION_LABEL[action]}. Resolve exact IDs and version fields from a current read. Tenant, actor, role, account, authority and approval are always resolved by the server. Returns durable readback, receipt state and a route locator; destructive and ownership operations require the rendered approval card.`,
    parameters: {
      type: "object",
      properties: {
        ...properties,
        patch: action === "contact.create" ? contactCreatePatchSchema() : patchSchemaFor(action),
        confirm: {
          type: "boolean",
          description: classifyAction(capability) === "high"
            ? "Set true only after the operator has explicitly approved this exact action. The model saying so is not enough on its own; the server requires the single-use rendered approval card."
            : "Set true only after the operator has explicitly approved this exact action. Omit or false on the proposal call; server policy and stored approval remain authoritative.",
        },
      },
      required: required[action],
      // `crm-command` validates that deal.update carries at least one reversible field before
      // execution. Keep that invariant at the authoritative executor: Anthropic rejects a
      // top-level schema combinator in a tool input_schema, which otherwise rejects every Chat
      // turn before the model can answer.
      additionalProperties: false,
    },
  },
}));
