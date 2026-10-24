import { UUID } from "../sales-collections/primitives.ts";
import {
  type OwnerPreparationCaller,
  type OwnerPreparationService,
  OwnerPreparationUnavailable,
  readOwnerPreparation,
  readOwnerPreparationPdf,
} from "./owner-preparation.ts";
import { PreparationArtifactUnavailable } from "./preparation-artifact.ts";
import { canonicalPresentationJson } from "./preparation-json.ts";

import {
  parsePreparedSignatureReviewIntent,
  type PreparedSignatureReview,
  PreparedSignatureReviewUnavailable,
  projectPreparedSignatureReview,
} from "./prepared-signature-review-contract.ts";
export {
  parsePreparedSignatureReviewIntent,
  type PreparedSignatureReview,
  type PreparedSignatureReviewIntent,
  PreparedSignatureReviewUnavailable,
} from "./prepared-signature-review-contract.ts";
const fail = (code: PreparedSignatureReviewUnavailable["code"]): never => {
  throw new PreparedSignatureReviewUnavailable(code);
};
async function actorOf(caller: OwnerPreparationCaller): Promise<string> {
  try {
    const result = await caller.auth.getUser(), user = result.data?.user;
    if (
      result.error || !user || typeof user.id !== "string" ||
      !UUID.test(user.id) || user.is_anonymous === true
    ) return fail("ACCESS_UNVERIFIED");
    return user.id;
  } catch {
    return fail("ACCESS_UNVERIFIED");
  }
}
/** READ ONLY. These ports come from the original server caller/service factories,
 * never request-authored credentials. The actor fence only refuses changes; the
 * original owner readers/native floors remain the permission authority. */
export async function readPreparedSignatureReview(
  value: unknown,
  caller: OwnerPreparationCaller,
  service: OwnerPreparationService,
  expectedActorId?: string,
): Promise<PreparedSignatureReview> {
  const intent = parsePreparedSignatureReviewIntent(value);
  try {
    const actor = await actorOf(caller);
    if (expectedActorId !== undefined && actor !== expectedActorId) {
      return fail("ACCESS_UNVERIFIED");
    }
    const guarded: OwnerPreparationCaller = {
      auth: {
        getUser: async () => {
          const result = await caller.auth.getUser(), user = result.data?.user;
          if (
            result.error || !user || user.id !== actor ||
            user.is_anonymous === true
          ) return fail("ACCESS_UNVERIFIED");
          return result;
        },
      },
      rpc: (name, args) => caller.rpc(name, args),
      ...(typeof caller.from === "function"
        ? { from: caller.from.bind(caller) }
        : {}),
    };
    const first = structuredClone(
      await readOwnerPreparation(
        intent.tenant_id,
        intent.agreement_id,
        intent.preparation_id,
        guarded,
        service,
      ),
    );
    if (first.state !== "retained") return fail("SOURCE_CHANGED");
    const packet = await projectPreparedSignatureReview(intent, first);
    const pdf = await readOwnerPreparationPdf(
      intent.tenant_id,
      intent.agreement_id,
      intent.preparation_id,
      guarded,
      service,
    );
    if (
      pdf.sha256 !== packet.document.sha256 ||
      pdf.bytes.length !== packet.document.byte_length ||
      first.preparation.document_sha256 !== pdf.sha256 ||
      first.preparation.document_byte_length !== pdf.bytes.length
    ) return fail("DOCUMENT_UNVERIFIED");
    // Recheck AFTER all PDF/hash work. Original native authority and selection,
    // recipient identity, fields and current commercial source must all survive.
    const final = structuredClone(
      await readOwnerPreparation(
        intent.tenant_id,
        intent.agreement_id,
        intent.preparation_id,
        guarded,
        service,
      ),
    );
    if (canonicalPresentationJson(first) !== canonicalPresentationJson(final)) {
      return fail("SOURCE_CHANGED");
    }
    return packet;
  } catch (error) {
    if (error instanceof PreparedSignatureReviewUnavailable) throw error;
    if (error instanceof OwnerPreparationUnavailable) {
      if (error.code === "ACCESS_UNVERIFIED") return fail("ACCESS_UNVERIFIED");
      if (
        error.code === "SOURCE_CHANGED" ||
        error.code === "COMMERCIAL_REVIEW_REQUIRED"
      ) return fail("SOURCE_CHANGED");
      if (error.code === "INVALID_REQUEST") return fail("INVALID_REQUEST");
    }
    if (error instanceof PreparationArtifactUnavailable) {
      return fail(
        error.code === "CONTEXT_RETIRED"
          ? "ACCESS_UNVERIFIED"
          : "DOCUMENT_UNVERIFIED",
      );
    }
    return fail("UNCONFIRMED");
  }
}
