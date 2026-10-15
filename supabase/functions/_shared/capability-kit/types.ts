import {
  PER_CAPABILITY_AVAILABILITY_STATES,
  type PerCapabilityAvailability,
} from "../paige-capability-status/resolver.ts";
import type { OwnerGrantablePermissionKey } from "./permission.ts";
import type { CapabilityInputSchema } from "./schema.ts";
import type {
  CapabilityActorResolverId,
  CapabilityAvailabilityResolverId,
  CapabilityConnectionResolverId,
  CapabilityOutcomeProjectorId,
  CapabilityReceiptRecorderId,
  CapabilityTenantResolverId,
} from "./seams.ts";

export const EXECUTION_OUTCOMES = Object.freeze([
  "succeeded",
  "failed",
  "refused",
  "unreachable",
  "outcome_unknown",
  "completed_unrecorded",
] as const);

export const EVIDENCE_STATES = Object.freeze([
  "recorded",
  "no_evidence",
  "unavailable",
] as const);

export type ExecutionOutcome = (typeof EXECUTION_OUTCOMES)[number];
export type EvidenceState = (typeof EVIDENCE_STATES)[number];
export type CapabilityEffect = "read" | "mutation" | "external_effect";
export type CapabilityRisk = "read_only" | "ordinary" | "high" | "owner_only";
export type CapabilityApproval = "none" | "confirm" | "owner_only";
export const CAPABILITY_AVAILABILITY_STATES = PER_CAPABILITY_AVAILABILITY_STATES;
export type CapabilityAvailability = PerCapabilityAvailability;

export type CapabilityIdentity = Readonly<{
  id: string;
  version: number;
  domain: string;
  owner: string;
  humanSurface: string | null;
  description: string;
}>;

export type CapabilityGovernance = Readonly<{
  actionRiskKey: string | null;
  risk: CapabilityRisk;
  approval: CapabilityApproval;
  requiredPermission: OwnerGrantablePermissionKey;
}>;

export type CapabilityTenantScope = Readonly<{
  source: "server";
  tenantResolver: CapabilityTenantResolverId;
  actorResolver: CapabilityActorResolverId;
  revalidateAt: readonly (
    | "before_availability"
    | "before_execution"
    | "before_receipt"
  )[];
}>;

export type CapabilityAvailabilityContract = Readonly<{
  resolver: CapabilityAvailabilityResolverId;
  states: readonly CapabilityAvailability[];
}>;

export type CapabilityProviderBinding = Readonly<{
  kind: "internal" | "mcp" | "partner";
  operation: string;
  connectionResolver: CapabilityConnectionResolverId | null;
}>;

export type CapabilityReceipt = Readonly<{
  rail: true;
  recorder: CapabilityReceiptRecorderId;
  redaction: "tenant_safe";
  visibility: "owner_internal" | "tenant_member" | "platform_operator";
}>;

export type CapabilityOutcomeContract = Readonly<{
  projector: CapabilityOutcomeProjectorId;
}>;

export type ReadIdempotency = Readonly<{
  mode: "not_applicable";
}>;

export type EffectIdempotency = Readonly<{
  mode: "required";
  key: string;
  readback: string;
  replay: "return_recorded_result" | "reconcile_then_return";
}>;

type CapabilityDefinitionBase = Readonly<{
  identity: CapabilityIdentity;
  input: CapabilityInputSchema;
  governance: CapabilityGovernance;
  tenantScope: CapabilityTenantScope;
  availability: CapabilityAvailabilityContract;
  providerBinding: CapabilityProviderBinding;
  receipt: CapabilityReceipt;
  outcome: CapabilityOutcomeContract;
}>;

export type CapabilityDefinition =
  | (CapabilityDefinitionBase & Readonly<{
      effect: "read";
      idempotency: ReadIdempotency;
    }>)
  | (CapabilityDefinitionBase & Readonly<{
      effect: "mutation" | "external_effect";
      idempotency: EffectIdempotency;
    }>);

declare const definedCapabilityBrand: unique symbol;

export type DefinedCapability = Readonly<CapabilityDefinition & {
  executionOutcomes: typeof EXECUTION_OUTCOMES;
  evidenceStates: typeof EVIDENCE_STATES;
  readonly [definedCapabilityBrand]: true;
}>;
