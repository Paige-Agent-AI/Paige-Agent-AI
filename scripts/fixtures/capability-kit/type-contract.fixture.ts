import {
  defineCapability,
  objectInputSchema,
  ownerGrantablePermission,
  type CapabilityAvailability,
  type CapabilityDefinition,
  type DefinedCapability,
} from "../../../supabase/functions/_shared/capability-kit/mod.ts";
import type { CallerAuthority } from "../../../supabase/functions/_shared/mcp-gateway/authority.ts";
import type {
  PerCapabilityAvailability,
} from "../../../supabase/functions/_shared/paige-capability-status/resolver.ts";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
const exactAvailabilityVocabulary: Equal<CapabilityAvailability, PerCapabilityAvailability> = true;
void exactAvailabilityVocabulary;

const input = objectInputSchema({
  properties: { id: { type: "string" } },
  required: ["id"],
});

const valid: CapabilityDefinition = {
  identity: {
    id: "knowledge.documents.read",
    version: 1,
    domain: "knowledge",
    owner: "Knowledge",
    humanSurface: null,
    description: "Read one governed document.",
  },
  input,
  effect: "read",
  governance: {
    actionRiskKey: null,
    risk: "read_only",
    approval: "none",
    requiredPermission: ownerGrantablePermission("knowledge.documents.read"),
  },
  tenantScope: {
    source: "server",
    tenantResolver: "current_user_tenant_id",
    actorResolver: "authenticated_user",
    // ALL THREE authority seams. `defineCapability()` requires every one
    // (defineCapability.ts:178-183); a subset throws "Capability tenant scope must revalidate at
    // every authority seam." This read `["before_execution"]` from the day it shipped, so the one
    // worked example in the repo — the file a first adopter copies — did not construct. It was
    // invisible because `CapabilityTenantScope.revalidateAt` is typed as a plain readonly array
    // (types.ts:59-63) rather than a 3-tuple, so the type contract accepted it; because this file
    // lives under `scripts/` and the lint's SCAN_ROOTS are `supabase/functions` and `src`, so no
    // rule ever read it; and because nothing imports it, so `defineCapability(valid)` at the bottom
    // was never EXECUTED — only typechecked. Three layers of checking, none of which ran the
    // constructor. The paired-invariant test now does exactly that, so this cannot silently rot again.
    revalidateAt: ["before_availability", "before_execution", "before_receipt"],
  },
  availability: { resolver: "paige-capability-status", states: ["live", "unavailable"] },
  providerBinding: { kind: "internal", operation: "documents.read", connectionResolver: null },
  idempotency: { mode: "not_applicable" },
  receipt: {
    rail: true,
    recorder: "record_capability_run",
    redaction: "tenant_safe",
    visibility: "owner_internal",
  },
  outcome: { projector: "capability-record" },
};

defineCapability(valid);

// Owner-grantable permission keys fit the shipped tenant-bound MCP CallerAuthority shape.
const mcpAuthority: CallerAuthority = {
  kind: "capabilities",
  tenantId: "00000000-0000-0000-0000-000000000001",
  capabilities: [valid.governance.requiredPermission.key],
};
void mcpAuthority;

const noncanonicalTenantResolver = {
  ...valid,
  tenantScope: { ...valid.tenantScope, tenantResolver: "request_body_tenant" },
};
// @ts-expect-error resolver identifiers are closed to canonical implementations
defineCapability(noncanonicalTenantResolver);

// Root combinators are not members of the builder's root contract.
objectInputSchema({
  properties: {},
  // @ts-expect-error top-level anyOf is forbidden
  anyOf: [],
});

// A plain string cannot impersonate an owner-grantable permission.
const rawPermissionDefinition = {
  ...valid,
  governance: { ...valid.governance, requiredPermission: "owner" },
};
// @ts-expect-error requiredPermission is nominal and constructor-issued
defineCapability(rawPermissionDefinition);

// Mutation declarations cannot omit the required idempotency contract.
const { idempotency: _ignored, ...withoutIdempotency } = {
  ...valid,
  effect: "mutation" as const,
};
// @ts-expect-error mutations require idempotency
defineCapability(withoutIdempotency);

// Structurally similar objects cannot fabricate the DefinedCapability brand.
// @ts-expect-error DefinedCapability is nominal and constructor-issued
const fabricated: DefinedCapability = valid;
void fabricated;
