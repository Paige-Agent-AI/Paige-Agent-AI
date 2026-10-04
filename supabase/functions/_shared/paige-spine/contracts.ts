import type { ReadinessResolverId } from "../paige-capability-status/readiness.ts";

export const SPINE_ACTION_CLASSIFICATIONS = ["read", "mutate", "external_effect"] as const;
export type SpineActionClassification = (typeof SPINE_ACTION_CLASSIFICATIONS)[number];
export type SpineApprovalAuthority = "chat-canonical" | "none";
export type SpineRiskPolicy = "read_only" | "ordinary" | "high";
export type SpineFact = boolean | number | string | null;

export type SpineCapability = {
  readonly key: string;
  readonly domain: string;
  readonly owner: string;
  readonly humanSurface: string;
  /**
   * What this capability depends on being there before PAIGE can use it (C0a). Read by the per-turn
   * capability projection; a capability that declares a provider resolver reads "needs setup" when
   * that provider is not ready. Required for every NEW capability with a chat tool (CI:
   * capability-discovery-lint); existing ones without it are a shrink-only baseline.
   */
  readonly readiness?: ReadinessResolverId;
  readonly evidence?: {
    readonly signalKinds: readonly string[];
    readonly adapter: string;
    readonly audience: string;
    readonly freshness: string;
    /** Visibility window for the safe projection; source retention stays domain-owned. */
    readonly staleAfterDays: number;
    readonly projectionWindowDays: number;
    readonly sourceSystem: string;
    readonly sourceActorTypes: readonly string[];
    readonly classification: string;
    readonly lifecycle: string;
    readonly safeSummary: string;
    readonly referencePrefix: string;
    readonly factValues: Readonly<Record<string, readonly SpineFact[]>>;
  };
  readonly action?: {
    readonly classification: SpineActionClassification;
    readonly executor: string;
    readonly chatTool?: string;
    readonly idempotency: string;
    readonly riskPolicyKey: SpineRiskPolicy;
    readonly approvalAuthority: SpineApprovalAuthority;
  };
  readonly outcome?: {
    readonly kinds: readonly string[];
    readonly projector: string;
    readonly railVisibility: string;
  };
  readonly chatBinding: "LIVE" | "PARTIAL" | "UNAVAILABLE";
  readonly mindBinding: "LIVE" | "PARTIAL" | "UNAVAILABLE";
  readonly sharedPrimitiveChange: "NONE" | `SCR-${string}`;
  readonly maturity: "LIVE" | "PARTIAL" | "UNAVAILABLE";
};

export type SpineSignal = {
  readonly signal_id: string;
  readonly kind: string;
  /** Server-consumer scope evidence. It is not presentation copy. */
  readonly tenant_id: string;
  readonly subject_type: string;
  readonly subject_ref: string;
  readonly occurred_at: string;
  readonly recorded_at: string;
  readonly source_system: string;
  readonly source_record_ref: string;
  readonly source_actor_type: string;
  readonly availability: "available" | "stale";
  readonly classification: string;
  readonly lifecycle: string;
  readonly safe_summary: string;
  readonly facts: Readonly<Record<string, SpineFact>>;
  readonly audience: string;
  readonly schema_version: number;
  readonly expires_at: string;
  readonly outcome_ref: string;
};
