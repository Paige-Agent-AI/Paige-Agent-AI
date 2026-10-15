import { isOwnerGrantablePermissionKey, snapshotOwnerGrantablePermission } from "./permission.ts";
import { isCapabilityInputSchema, snapshotCapabilityInputSchema } from "./schema.ts";
import { snapshotPlainData } from "./snapshot.ts";
import { CAPABILITY_SEAM_IDS } from "./seams.ts";
import { classifyAction } from "../action-risk.ts";
import {
  CAPABILITY_AVAILABILITY_STATES,
  EVIDENCE_STATES,
  EXECUTION_OUTCOMES,
  type CapabilityDefinition,
  type DefinedCapability,
} from "./types.ts";

const DEFINED_CAPABILITY = Symbol("paige.defined-capability");
const DEFINED_CAPABILITIES = new WeakSet<object>();
const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const EFFECTS = new Set(["read", "mutation", "external_effect"]);
const RISKS = new Set(["read_only", "ordinary", "high", "owner_only"]);
const APPROVALS = new Set(["none", "confirm", "owner_only"]);
const AVAILABILITY_STATES = new Set<string>(CAPABILITY_AVAILABILITY_STATES);
const REVALIDATION_SEAMS = new Set([
  "before_availability", "before_execution", "before_receipt",
]);
const REQUIRED_REVALIDATION_SEAMS = [...REVALIDATION_SEAMS];

const EXPECTED_KEYS = Object.freeze({
  definition: [
    "identity",
    "input",
    "effect",
    "governance",
    "tenantScope",
    "availability",
    "providerBinding",
    "idempotency",
    "receipt",
    "outcome",
  ],
  identity: ["id", "version", "domain", "owner", "humanSurface", "description"],
  governance: ["actionRiskKey", "risk", "approval", "requiredPermission"],
  tenantScope: ["source", "tenantResolver", "actorResolver", "revalidateAt"],
  availability: ["resolver", "states"],
  providerBinding: ["kind", "operation", "connectionResolver"],
  readIdempotency: ["mode"],
  effectIdempotency: ["mode", "key", "readback", "replay"],
  receipt: ["rail", "recorder", "redaction", "visibility"],
  outcome: ["projector"],
} as const);

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new TypeError(`${label} must be a plain object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: unknown, expected: readonly string[], label: string): Record<string, unknown> {
  const record = plainRecord(value, label);
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
  return record;
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

export function defineCapability(definition: CapabilityDefinition): DefinedCapability {
  const declaration = snapshotPlainData(definition, "Capability definition", (value) => {
    if (isCapabilityInputSchema(value)) return { value: snapshotCapabilityInputSchema(value) };
    if (isOwnerGrantablePermissionKey(value)) return { value: snapshotOwnerGrantablePermission(value) };
    return undefined;
  });
  const root = exactKeys(declaration, EXPECTED_KEYS.definition, "Capability definition");
  const identity = exactKeys(root.identity, EXPECTED_KEYS.identity, "Capability identity");
  const governance = exactKeys(root.governance, EXPECTED_KEYS.governance, "Capability governance");
  const tenantScope = exactKeys(root.tenantScope, EXPECTED_KEYS.tenantScope, "Capability tenant scope");
  const availability = exactKeys(root.availability, EXPECTED_KEYS.availability, "Capability availability");
  const providerBinding = exactKeys(root.providerBinding, EXPECTED_KEYS.providerBinding, "Capability provider binding");
  const receipt = exactKeys(root.receipt, EXPECTED_KEYS.receipt, "Capability receipt");
  const outcome = exactKeys(root.outcome, EXPECTED_KEYS.outcome, "Capability outcome");

  if (!isCapabilityInputSchema(root.input)) {
    throw new TypeError("Capability input must come from objectInputSchema().");
  }
  if (!isOwnerGrantablePermissionKey(governance.requiredPermission)) {
    throw new TypeError("requiredPermission must come from ownerGrantablePermission().");
  }
  if (!EFFECTS.has(String(root.effect))) throw new TypeError("Capability effect is invalid.");
  if (!RISKS.has(String(governance.risk))) throw new TypeError("Capability risk is invalid.");
  if (!APPROVALS.has(String(governance.approval))) throw new TypeError("Capability approval class is invalid.");
  if (root.effect === "read") {
    if (governance.actionRiskKey !== null || governance.risk !== "read_only" || governance.approval !== "none") {
      throw new TypeError("Read capabilities must declare no action-risk key, read_only risk, and no approval.");
    }
  } else {
    /**
     * THE CANONICAL ACTION-RISK POLICY DECIDES WHAT IS AN ACTION HERE — NOT A VERB PATTERN.
     * `classifyAction()` is a lookup into a hand-curated table in which every entry carries a written
     * rationale, so any verdict other than "unclassified" means a person has already decided that this
     * key names an action and how dangerous it is. `MUTATION_VERB` infers the same thing from spelling,
     * and it is a FAIL-SAFE FLOOR for the keys that table does NOT cover: `unclassifiedWriteReason()`
     * consults it only after `RISK_BY_TOOL` misses, the MCP gateway's `server_name_floor` uses it to
     * RAISE approval on an unclassified provider tool, and `lint:action-risk` uses it to demand a class
     * for a write-shaped name in CI. Every one of those raises the floor under a key nobody classified.
     * Requiring it HERE inverted that — the weaker proxy vetoing the stronger authority — and refused
     * curated actions the vocabulary happens not to spell: `crm_merge_contacts`, `crm_close_deal` and
     * `booking_preset_revise` are all classified `high` and match no verb, so a declaration CI reported
     * as complete threw the moment its module was imported. Do not re-add the test, and do not widen the
     * vocabulary to compensate; either way a spelling check ends up standing in front of a decision that
     * has already been made, and the vocabulary has genuinely missed real verbs twice in production.
     *
     * `read_only` is refused outright rather than left to the risk comparison below. `ActionRisk` cannot
     * express it and no entry classifies one, so that comparison happens to reject it today — but that
     * is the table's present composition doing the work rather than a rule, and an effect that writes or
     * reaches outside the platform must never be able to declare itself unapproved.
     */
    nonEmpty(governance.actionRiskKey, "governance.actionRiskKey");
    if (governance.risk === "read_only") {
      throw new TypeError(
        "Mutation and external-effect capabilities cannot declare read_only risk.",
      );
    }
    const canonicalRisk = classifyAction(governance.actionRiskKey);
    if (canonicalRisk === "unclassified") {
      throw new TypeError(
        "Mutation action-risk keys must exist in the canonical action-risk policy: classify this key there first, with its rationale, then declare the capability.",
      );
    }
    if (governance.risk !== canonicalRisk) {
      throw new TypeError("Capability risk must match the canonical action-risk policy.");
    }
    const canonicalApproval = canonicalRisk === "owner_only" ? "owner_only" : "confirm";
    if (governance.approval !== canonicalApproval) {
      throw new TypeError("Capability approval must match the canonical action-risk policy.");
    }
    if (root.effect === "external_effect" && governance.risk !== "high") {
      throw new TypeError("external_effect capabilities must declare the canonical high risk class.");
    }
  }
  if (!IDENTIFIER.test(String(identity.id))) throw new TypeError("Capability identity.id is invalid.");
  if (!Number.isInteger(identity.version) || Number(identity.version) < 1) {
    throw new TypeError("Capability identity.version must be a positive integer.");
  }
  for (const [label, value] of [
    ["identity.domain", identity.domain],
    ["identity.owner", identity.owner],
    ["identity.description", identity.description],
    ["providerBinding.operation", providerBinding.operation],
  ] as const) nonEmpty(value, label);

  for (const [label, actual, canonical] of [
    ["tenantScope.tenantResolver", tenantScope.tenantResolver, CAPABILITY_SEAM_IDS.tenantResolver],
    ["tenantScope.actorResolver", tenantScope.actorResolver, CAPABILITY_SEAM_IDS.actorResolver],
    ["availability.resolver", availability.resolver, CAPABILITY_SEAM_IDS.availabilityResolver],
    ["receipt.recorder", receipt.recorder, CAPABILITY_SEAM_IDS.receiptRecorder],
    ["outcome.projector", outcome.projector, CAPABILITY_SEAM_IDS.outcomeProjector],
  ] as const) {
    if (actual !== canonical) throw new TypeError(`${label} must name the canonical governance seam.`);
  }

  if (tenantScope.source !== "server") {
    throw new TypeError("Capability tenant authority must be server-derived.");
  }
  const revalidateAt = tenantScope.revalidateAt;
  if (!Array.isArray(revalidateAt) ||
    revalidateAt.some((seam) => !REVALIDATION_SEAMS.has(String(seam))) ||
    REQUIRED_REVALIDATION_SEAMS.some((seam) => !revalidateAt.includes(seam))) {
    throw new TypeError("Capability tenant scope must revalidate at every authority seam.");
  }
  if (!Array.isArray(availability.states) || availability.states.length === 0 ||
    availability.states.some((state) => !AVAILABILITY_STATES.has(String(state))) ||
    new Set(availability.states).size !== availability.states.length) {
    throw new TypeError("Capability availability must declare at least one state.");
  }
  if (!["internal", "mcp", "partner"].includes(String(providerBinding.kind))) {
    throw new TypeError("Capability provider binding kind is invalid.");
  }
  if (providerBinding.kind === "internal" && providerBinding.connectionResolver !== null) {
    throw new TypeError("Internal provider bindings cannot declare a connection resolver.");
  }
  if (providerBinding.kind !== "internal" &&
    providerBinding.connectionResolver !== CAPABILITY_SEAM_IDS.connectionResolver) {
    throw new TypeError("External provider bindings must name the canonical connection resolver.");
  }
  if (providerBinding.kind !== "internal" && providerBinding.connectionResolver === null) {
    throw new TypeError("External provider bindings require a connection resolver.");
  }
  if (receipt.rail !== true || receipt.redaction !== "tenant_safe") {
    throw new TypeError("Capability receipts must use the tenant-safe Rail contract.");
  }
  if (!["owner_internal", "tenant_member", "platform_operator"].includes(String(receipt.visibility))) {
    throw new TypeError("Capability receipt visibility is invalid.");
  }

  const effect = root.effect;
  const idempotency = effect === "read"
    ? exactKeys(root.idempotency, EXPECTED_KEYS.readIdempotency, "Read idempotency")
    : exactKeys(root.idempotency, EXPECTED_KEYS.effectIdempotency, "Effect idempotency");
  if (effect === "read") {
    if (idempotency.mode !== "not_applicable") {
      throw new TypeError("Read capabilities must declare idempotency as not_applicable.");
    }
  } else {
    if (effect !== "mutation" && effect !== "external_effect") {
      throw new TypeError("Capability effect is invalid.");
    }
    if (idempotency.mode !== "required") {
      throw new TypeError("Mutation and external-effect capabilities require idempotency.");
    }
    nonEmpty(idempotency.key, "idempotency.key");
    nonEmpty(idempotency.readback, "idempotency.readback");
    if (!["return_recorded_result", "reconcile_then_return"].includes(String(idempotency.replay))) {
      throw new TypeError("Capability idempotency replay policy is invalid.");
    }
  }

  const capability = {
    ...declaration,
    executionOutcomes: EXECUTION_OUTCOMES,
    evidenceStates: EVIDENCE_STATES,
  } as DefinedCapability;
  Object.defineProperty(capability, DEFINED_CAPABILITY, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  const frozen = freezeDeep(capability);
  DEFINED_CAPABILITIES.add(frozen);
  return frozen;
}

export function isDefinedCapability(value: unknown): value is DefinedCapability {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as Record<PropertyKey, unknown>)[DEFINED_CAPABILITY] === true &&
      DEFINED_CAPABILITIES.has(value as object) &&
      Object.isFrozen(value),
  );
}
