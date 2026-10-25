import { object, UUID } from "../sales-collections/primitives.ts";
import { canonicalPresentationJson } from "./preparation-json.ts";
import { sha256Hex } from "./token.ts";
import { confirmFingerprint } from "../confirm-fingerprint.ts";
import { decideDeclaredCapability } from "../capability-kit/decision.ts";
import { AGREEMENT_SEND_CAPABILITY } from "../paige-spine/domains/agreement.ts";
import type { CapabilityAvailability } from "../paige-capability-status/resolver.ts";
import type { prepareSignatureRequestReview } from "./prepared-signature-request.ts";

type RequestReview = Awaited<ReturnType<typeof prepareSignatureRequestReview>>;
type Scope = { actorId: string; tenantId: string; role: "owner" | "admin"; principal: "person" };
type Args = Record<string, unknown>;
type Decision = ReturnType<typeof decideDeclaredCapability>;
type DecisionAudit = Pick<Decision, "kind" | "risk" | "audit">;

/** Server-handler factories only. These ports are NOT request data or proof
 * that authority was checked. Their concrete native/SDK implementations must
 * establish current identity, canonical agreement.send.execute permission,
 * tenant/tier eligibility, an atomic ORIGINAL pending-confirmation claim,
 * actual audit persistence and canonical domain/provider readback.
 *
 * This domain adapter consumes the ONE existing gate and pending store. It
 * creates no approval mechanism, durable-work engine, sender or recovery loop.
 * It must remain unmounted until those actual implementations are available. */
export type PreparedSignatureCommandPorts = {
  authorizeCurrent(): Promise<Scope | null>;
  availability(scope: Scope): Promise<CapabilityAvailability | "unknown">;
  autonomy(scope: Scope): Promise<"auto" | "confirm" | "off" | "unresolved">;
  readCurrentRequest(value: unknown, scope: Scope): Promise<RequestReview>;
  readOriginalOutcome(scope: Scope, operation: string, digest: string): Promise<unknown>;
  pending: {
    find(operation: string): Promise<unknown>;
    issue(value: { fingerprint: string; args: Args; summary: string; issuedInRequest: string }): Promise<{ expires_at: string }>;
    claim(value: { fingerprint: string; requestNonce: string }): Promise<unknown>;
  };
  audit(value: { scope: Scope; agreementId: string; requestDigest: string; decision: DecisionAudit }): Promise<string | null>;
  executeOriginal(value: {
    scope: Scope; request: RequestReview; args: Args; fingerprint: string;
    confirmationId: string; requestNonce: string; auditId: string;
  }): Promise<void>;
  nonce(): string;
};
const key = "agreement_send";
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value) && value === value.toLowerCase();
const fingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{16}$/.test(value);
const refuse = (code: string) => ({ state: "refused" as const, code });
const unknown = (operation: string) => ({ state: "outcome_unknown" as const,
  code: "ORIGINAL_REQUEST_READBACK_REQUIRED", operation_id: operation });
const sameScope = (left: Scope | null, right: Scope) => !!left && left.principal === "person"
  && ["owner", "admin"].includes(left.role) && left.actorId === right.actorId && left.tenantId === right.tenantId;

/** Shape/scope checks cannot prove provider provenance. The concrete reader
 * must derive this projection from ORIGINAL work/messages/provider receipts;
 * an execution callback or a request-authored success object is never readback. */
function originalOutcome(value: unknown, scope: Scope, operation: string, hash: string, agreement: string) {
  if (!object(value) || value.kind !== "prepared_signature_request_result"
    || value.tenant_id !== scope.tenantId || value.actor_id !== scope.actorId
    || value.operation_id !== operation || value.request_sha256 !== hash || value.agreement_id !== agreement
    || !uuid(value.work_id) || !["prepared", "provider_accepted", "provider_partial", "not_sent", "outcome_unknown"].includes(String(value.state))) return null;
  const receipt = uuid(value.receipt_id) ? value.receipt_id : null;
  if (["provider_accepted", "provider_partial"].includes(String(value.state)) && !receipt) return null;
  return { kind: "prepared_signature_request_result" as const, state: String(value.state),
    tenant_id: scope.tenantId, actor_id: scope.actorId, operation_id: operation,
    request_sha256: hash, agreement_id: agreement, work_id: value.work_id, receipt_id: receipt };
}

/** Admission for the originating Sales workflow. Existing Chat/Live admission
 * is unchanged. No native effect or provider call is implemented in this file. */
export async function admitPreparedSignatureRequest(value: unknown, ports: PreparedSignatureCommandPorts) {
  let copy: unknown;
  try { copy = structuredClone(value); } catch { return refuse("INVALID_REQUEST"); }
  const required = ["operation_id", "review", "expected_review_sha256", "connector_id", "messages", "expected_request_sha256"];
  if (!object(copy) || required.some(k => !Object.prototype.hasOwnProperty.call(copy, k))
    || Object.keys(copy).some(k => !required.includes(k) && k !== "approved_fingerprint")
    || !uuid(copy.operation_id) || !digest(copy.expected_request_sha256)
    || !object(copy.review) || !uuid(copy.review.tenant_id) || !uuid(copy.review.agreement_id)
    || (Object.prototype.hasOwnProperty.call(copy, "approved_fingerprint") && !fingerprint(copy.approved_fingerprint))) return refuse("INVALID_REQUEST");
  const operation = copy.operation_id, expected = copy.expected_request_sha256;
  const approvedFingerprint = fingerprint(copy.approved_fingerprint) ? copy.approved_fingerprint : undefined;
  const agreement = copy.review.agreement_id, expectedTenant = copy.review.tenant_id;
  const preflight = Object.fromEntries(required.map(k => [k, copy[k]]));
  let originalWorkMayExist = true;
  try {
    const resolved = await ports.authorizeCurrent();
    if (!resolved || resolved.principal !== "person" || !["owner", "admin"].includes(resolved.role)
      || !uuid(resolved.actorId) || resolved.tenantId !== expectedTenant) return refuse("ACCESS_UNVERIFIED");
    const scope = Object.freeze({ actorId: resolved.actorId, tenantId: resolved.tenantId,
      role: resolved.role, principal: resolved.principal });
    // Historical readback precedes current draft/provider eligibility. A lost
    // acknowledgement can never become another claim or another external send.
    const prior = await ports.readOriginalOutcome(scope, operation, expected);
    if (prior !== null) {
      if (!sameScope(await ports.authorizeCurrent(), scope)) return refuse("ACCESS_UNVERIFIED");
      return originalOutcome(prior, scope, operation, expected, agreement) ?? unknown(operation);
    }
    originalWorkMayExist = false;
    const reviewed = await ports.readCurrentRequest(preflight, scope);
    if (reviewed.kind !== "prepared_signature_request_review" || reviewed.tool !== key
      || reviewed.approval !== "not_requested" || reviewed.execution !== "unavailable"
      || reviewed.request_sha256 !== expected || reviewed.args.expectedTenantId !== scope.tenantId
      || reviewed.args.agreementId !== agreement || reviewed.args.operationId !== operation
      || await sha256Hex(canonicalPresentationJson(reviewed.args)) !== expected) return refuse("REVIEW_CHANGED");
    if (!sameScope(await ports.authorizeCurrent(), scope)) return refuse("ACCESS_UNVERIFIED");
    const available = await ports.availability(scope), lane = await ports.autonomy(scope);
    if (available === "unknown") return refuse("CAPABILITY_UNAVAILABLE");
    if (!sameScope(await ports.authorizeCurrent(), scope)) return refuse("ACCESS_UNVERIFIED");
    const gateInput = {
      caller: { authenticated: true, userId: scope.actorId, principal: scope.principal,
        tenantId: scope.tenantId, tenantSource: "server" as const, door: "other" as const,
        access: { allowed: true, reason: "Current authenticated agreement owner/admin context." } },
      capability: { id: key, effect: "mutate" as const, outcomeChannel: "record_capability_run", availability: available },
    };
    const eligibility = decideDeclaredCapability(AGREEMENT_SEND_CAPABILITY, {
      ...gateInput, approval: { autonomyLane: lane }, requestArgs: {},
    });
    if (eligibility.kind === "refuse") return refuse(eligibility.code);
    const requestNonce = ports.nonce();
    if (!uuid(requestNonce)) return refuse("SERVER_REQUEST_UNVERIFIED");
    let claimed: Args | null | undefined;
    let confirmationId: string | null = null;
    let cycle: unknown;
    if (approvedFingerprint !== undefined) {
      const origin = await ports.pending.claim({ fingerprint: approvedFingerprint, requestNonce });
      claimed = null;
      if (object(origin) && uuid(origin.confirmation_id) && origin.request_nonce === requestNonce && object(origin.args)) {
        claimed = structuredClone(origin.args); confirmationId = origin.confirmation_id;
        if (await confirmFingerprint(key, claimed) !== approvedFingerprint) return refuse("APPROVAL_CLAIM_INVALID");
      }
      if (!claimed || !confirmationId) return refuse("APPROVAL_CLAIM_UNVERIFIED");
      cycle = claimed?.approval_cycle_nonce;
    } else {
      const live = await ports.pending.find(operation);
      if (live !== null && !object(live)) return refuse("APPROVAL_CYCLE_INVALID");
      cycle = object(live) ? live.approval_cycle_nonce : ports.nonce();
      if (object(live) && (canonicalPresentationJson(live.request) !== canonicalPresentationJson(reviewed.args)
        || live.request_sha256 !== expected || live.operation_id !== operation || live.expected_tenant_id !== scope.tenantId
        || live.approval_subject !== "agreement.prepared_signature_request:" + agreement + ":" + operation
        || Object.keys(live).sort().join(",") !== "approval_cycle_nonce,approval_subject,expected_tenant_id,operation_id,request,request_sha256"
        || !uuid(cycle))) return refuse("APPROVAL_CYCLE_INVALID");
    }
    // Invalid claims already exited. The original gate can propose again when
    // no usable claim exists; this request must instead retain an explicit
    // refusal, never silently renew a submitted approval or fabricate its args.
    if (!uuid(cycle)) return refuse("APPROVAL_CYCLE_INVALID");
    const args: Args = { request: structuredClone(reviewed.args), request_sha256: expected,
      operation_id: operation, expected_tenant_id: scope.tenantId,
      approval_subject: "agreement.prepared_signature_request:" + agreement + ":" + operation,
      approval_cycle_nonce: cycle };
    if (claimed && canonicalPresentationJson(claimed) !== canonicalPresentationJson(args)) return refuse("APPROVAL_CLAIM_INVALID");
    const decision = decideDeclaredCapability(AGREEMENT_SEND_CAPABILITY, {
      ...gateInput,
      approval: { autonomyLane: lane, ...(claimed !== undefined ? { claimedArgs: claimed, claimedFor: key } : {}) },
      requestArgs: args,
    });
    if (decision.kind === "refuse") return refuse(decision.code);
    const auditId = await ports.audit({ scope, agreementId: agreement, requestDigest: expected,
      decision: { kind: decision.kind, risk: decision.risk, audit: structuredClone(decision.audit) } });
    if (!uuid(auditId)) return refuse("DECISION_AUDIT_UNVERIFIED");
    if (!sameScope(await ports.authorizeCurrent(), scope)) return refuse("ACCESS_UNVERIFIED");
    if (decision.kind === "propose") {
      const fp = await confirmFingerprint(key, args);
      const summary = "Request signatures on the exact reviewed agreement from " + reviewed.args.recipients.length
        + " recipient(s), using the reviewed business email and messages. Sending does not authorize a payment.";
      const issued = await ports.pending.issue({ fingerprint: fp, args, summary, issuedInRequest: requestNonce });
      if (!issued || !Number.isFinite(Date.parse(issued.expires_at))) return refuse("APPROVAL_STORE_UNVERIFIED");
      return { state: "approval_required" as const, capability: key, fingerprint: fp,
        operation_id: operation, request_sha256: expected, summary, expires_at: issued.expires_at };
    }
    if (!claimed || !confirmationId || !approvedFingerprint
      || canonicalPresentationJson(decision.args) !== canonicalPresentationJson(claimed)) return refuse("APPROVAL_CLAIM_INVALID");
    // The concrete callback must revalidate source/scope at native act time,
    // use original work/message/token claims and preserve prepared field holds.
    // Its resolution is NOT a successful send. Read only the original result.
    originalWorkMayExist = true;
    try { await ports.executeOriginal({ scope, request: reviewed, args: claimed,
      fingerprint: approvedFingerprint, confirmationId, requestNonce, auditId }); }
    catch { /* No retry: reconcile the original work after any interruption. */ }
    const outcome = await ports.readOriginalOutcome(scope, operation, expected);
    // Withhold retired-scope data, but never imply an already-attempted effect
    // was refused or did not happen. Its original work must be reconciled.
    if (!sameScope(await ports.authorizeCurrent(), scope)) return unknown(operation);
    return originalOutcome(outcome, scope, operation, expected, agreement) ?? unknown(operation);
  } catch {
    // No credentials, provider details, document wording or fabricated result.
    return originalWorkMayExist ? unknown(operation) : refuse("REQUEST_ADMISSION_UNVERIFIED");
  }
}
