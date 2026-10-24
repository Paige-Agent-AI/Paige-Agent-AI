import { object, UUID } from "../sales-collections/primitives.ts";
import type {
  OwnerPreparationCaller,
  OwnerPreparationService,
} from "./owner-preparation.ts";
import {
  parsePreparedSignatureReviewIntent,
  type PreparedSignatureReviewIntent,
  PreparedSignatureReviewUnavailable,
  readPreparedSignatureReview,
} from "./prepared-signature-review.ts";

/** Server-internal exact argument preparation for the ORIGINAL declared HIGH
 * agreement_send capability. This neither creates a proposal nor proves yes.
 * Only the original Kit/confirmation gate may issue/claim its own fingerprint.
 * No token, sender, native write, provider effect or runtime caller is added. */
export class PreparedSignatureRequestUnavailable extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "REVIEW_CHANGED"
      | "FIELD_CORRECTIONS_REQUIRED",
  ) {
    super("PREPARED_SIGNATURE_REQUEST_" + code);
  }
}
const fail = (code: PreparedSignatureRequestUnavailable["code"]): never => {
  throw new PreparedSignatureRequestUnavailable(code);
};
type Intent = {
  operation_id: string;
  review: PreparedSignatureReviewIntent;
  expected_review_sha256: string;
};
function capture(value: unknown): Intent {
  let copy: unknown;
  try {
    copy = structuredClone(value);
  } catch {
    return fail("INVALID_REQUEST");
  }
  if (
    !object(copy) || Object.keys(copy).length !== 3 ||
    Object.keys(copy).some((k) =>
      !["operation_id", "review", "expected_review_sha256"].includes(k)
    ) ||
    typeof copy.operation_id !== "string" || !UUID.test(copy.operation_id) ||
    copy.operation_id !== copy.operation_id.toLowerCase() ||
    typeof copy.expected_review_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(copy.expected_review_sha256)
  ) return fail("INVALID_REQUEST");
  return {
    operation_id: copy.operation_id,
    review: parsePreparedSignatureReviewIntent(copy.review),
    expected_review_sha256: copy.expected_review_sha256,
  };
}
function frozen<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
/** expectedActorId is the ORIGINAL authenticated handler's server-only subject,
 * not a body field. Original native readers revalidate all actual authority.
 * A prior review digest can only refuse a changed read, never authorize an act.
 * This captures SOURCE INPUT ONLY. A future caller must bind the original
 * verified sender and exact message revision before the one canonical gate
 * hashes/stores its COMPLETE call. No source-only input may admit execution.
 * This result must not be exposed as a model approval or execution receipt. */
export async function prepareSignatureRequestInput(
  value: unknown,
  caller: OwnerPreparationCaller,
  service: OwnerPreparationService,
  expectedActorId: string,
) {
  const intent = capture(value);
  if (
    typeof expectedActorId !== "string" || !UUID.test(expectedActorId) ||
    expectedActorId !== expectedActorId.toLowerCase()
  ) throw new PreparedSignatureReviewUnavailable("ACCESS_UNVERIFIED");
  const reviewed = await readPreparedSignatureReview(
    intent.review,
    caller,
    service,
    expectedActorId,
  );
  if (reviewed.review_sha256 !== intent.expected_review_sha256) {
    return fail("REVIEW_CHANGED");
  }
  if (!reviewed.ready_for_review || reviewed.issues.length !== 0) {
    return fail("FIELD_CORRECTIONS_REQUIRED");
  }
  return frozen({
    kind: "prepared_signature_request_input" as const,
    tool: "agreement_send" as const,
    args: {
      agreementId: reviewed.request.agreement_id,
      expectedTenantId: reviewed.request.tenant_id,
      operationId: intent.operation_id,
      preparationId: reviewed.request.preparation_id,
      preparationSha256: reviewed.request.preparation_sha256,
      reviewSha256: reviewed.review_sha256,
      source: structuredClone(reviewed.request.expected_source),
      title: reviewed.title,
      document: structuredClone(reviewed.document),
      recipients: structuredClone(reviewed.signers),
    },
    approval: "not_requested" as const,
    execution: "unavailable" as const,
  });
}
