import { object, UUID } from "../sales-collections/primitives.ts";
import {
  type AgreementFieldIssue,
  prepareAgreementFields,
} from "./field-preparation.ts";
import {
  type OwnerPreparationCaller,
  type OwnerPreparationService,
  OwnerPreparationUnavailable,
  readOwnerPreparation,
  readOwnerPreparationPdf,
} from "./owner-preparation.ts";
import { PreparationArtifactUnavailable } from "./preparation-artifact.ts";
import { canonicalPresentationJson } from "./preparation-json.ts";
import { sha256Hex } from "./token.ts";

/** An owner-only READ proposal. This is never an approval, token, send or receipt. */
export type PreparedSignatureReviewIntent = {
  tenant_id: string;
  agreement_id: string;
  preparation_id: string;
  preparation_sha256: string;
  expected_source: { client_id: string; version: number; updated_at: string };
};
export type PreparedSignatureReview = Readonly<{
  kind: "prepared_signature_review";
  request: PreparedSignatureReviewIntent;
  title: string;
  document: Readonly<
    { sha256: string; byte_length: number; page_count: number }
  >;
  signers: ReadonlyArray<
    Readonly<
      {
        id: string;
        full_name: string;
        email: string;
        signer_role: "counterparty" | "tenant_signatory" | "witness";
        signing_order: number;
        field_count: number;
      }
    >
  >;
  ready_for_review: boolean;
  issues: ReadonlyArray<AgreementFieldIssue>;
  review_sha256: string;
  approval: "not_requested";
  sending: "not_connected";
}>;
export class PreparedSignatureReviewUnavailable extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "ACCESS_UNVERIFIED"
      | "SOURCE_CHANGED"
      | "DOCUMENT_UNVERIFIED"
      | "UNCONFIRMED",
  ) {
    super("PREPARED_SIGNATURE_REVIEW_" + code);
  }
}
const fail = (code: PreparedSignatureReviewUnavailable["code"]): never => {
  throw new PreparedSignatureReviewUnavailable(code);
};
const record = (value: unknown): Record<string, unknown> =>
  object(value) ? value : fail("UNCONFIRMED");
const uuid = (value: unknown): string =>
  typeof value === "string" && UUID.test(value) && value === value.toLowerCase()
    ? value
    : fail("INVALID_REQUEST");
const closed = (value: unknown, keys: string[]) => {
  if (
    !object(value) || Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) return fail("INVALID_REQUEST");
  return value;
};
export function parsePreparedSignatureReviewIntent(
  value: unknown,
): PreparedSignatureReviewIntent {
  let captured: unknown;
  try {
    captured = structuredClone(value);
  } catch {
    return fail("INVALID_REQUEST");
  }
  const v = closed(captured, [
    "tenant_id",
    "agreement_id",
    "preparation_id",
    "preparation_sha256",
    "expected_source",
  ]);
  const source = closed(v.expected_source, [
    "client_id",
    "version",
    "updated_at",
  ]);
  if (
    typeof v.preparation_sha256 !== "string" ||
    !(/^[a-f0-9]{64}$/).test(v.preparation_sha256) ||
    !Number.isSafeInteger(source.version) || Number(source.version) < 1 ||
    typeof source.updated_at !== "string" ||
    !(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/)
      .test(source.updated_at) ||
    !Number.isFinite(Date.parse(source.updated_at))
  ) return fail("INVALID_REQUEST");
  const day = new Date(source.updated_at.slice(0, 10) + "T00:00:00Z");
  if (
    !Number.isFinite(day.valueOf()) ||
    day.toISOString().slice(0, 10) !== source.updated_at.slice(0, 10)
  ) return fail("INVALID_REQUEST");
  return Object.freeze({
    tenant_id: uuid(v.tenant_id),
    agreement_id: uuid(v.agreement_id),
    preparation_id: uuid(v.preparation_id),
    preparation_sha256: v.preparation_sha256,
    expected_source: Object.freeze({
      client_id: uuid(source.client_id),
      version: Number(source.version),
      updated_at: source.updated_at,
    }),
  });
}
function verifySource(view: unknown, intent: PreparedSignatureReviewIntent) {
  const v = record(view), p = record(v.preparation), source = record(v.source);
  if (
    v.state !== "retained" || v.can_edit !== true ||
    source.status !== "draft" || p.is_selected !== true ||
    p.source_matches !== true ||
    p.id !== intent.preparation_id ||
    p.preparation_sha256 !== intent.preparation_sha256 ||
    p.agreement_id !== intent.agreement_id ||
    p.client_id !== intent.expected_source.client_id ||
    source.tenant_id !== intent.tenant_id ||
    source.agreement_id !== intent.agreement_id ||
    source.client_id !== intent.expected_source.client_id ||
    source.version !== intent.expected_source.version ||
    source.updated_at !== intent.expected_source.updated_at ||
    p.source_version !== intent.expected_source.version ||
    p.source_updated_at !== intent.expected_source.updated_at
  ) return fail("SOURCE_CHANGED");
  if (
    typeof v.title !== "string" || !v.title.trim() ||
    canonicalPresentationJson(v.document_signers) !==
      canonicalPresentationJson(source.signers)
  ) return fail("UNCONFIRMED");
  const manifest = record(p.manifest);
  if (manifest.schema_version !== 1 && manifest.schema_version !== 2) {
    return fail("UNCONFIRMED");
  }
  if (manifest.schema_version === 2) {
    const commercial = record(manifest.commercial),
      readback = record(v.commercial_readback),
      payload = record(commercial.payload),
      commercialSource = record(payload.source);
    if (
      readback.state !== "current" ||
      readback.payload_digest !== commercial.payload_digest ||
      readback.invoice_id !== commercialSource.invoice_id
    ) return fail("SOURCE_CHANGED");
  }
  return { view: v, preparation: p, source, manifest };
}
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
): Promise<PreparedSignatureReview> {
  const intent = parsePreparedSignatureReviewIntent(value);
  try {
    const actor = await actorOf(caller);
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
    const { view, preparation, source, manifest } = verifySource(first, intent);
    if (
      await sha256Hex(canonicalPresentationJson(manifest)) !==
        intent.preparation_sha256
    ) return fail("SOURCE_CHANGED");
    const checked = await prepareAgreementFields(
      source,
      manifest.document,
      manifest.fields,
    );
    const { commercial: _commercial, ...fieldManifest } = manifest;
    void _commercial;
    if (
      canonicalPresentationJson({ ...fieldManifest, schema_version: 1 }) !==
        canonicalPresentationJson(checked.manifest)
    ) return fail("SOURCE_CHANGED");
    const pdf = await readOwnerPreparationPdf(
      intent.tenant_id,
      intent.agreement_id,
      intent.preparation_id,
      guarded,
      service,
    );
    if (
      pdf.sha256 !== checked.manifest.document.sha256 ||
      pdf.bytes.length !== checked.manifest.document.byte_length ||
      preparation.document_sha256 !== pdf.sha256 ||
      preparation.document_byte_length !== pdf.bytes.length
    ) return fail("DOCUMENT_UNVERIFIED");
    const parties = source.signers as Record<string, unknown>[];
    const signers = Object.freeze(checked.manifest.signers.map((signer) => {
      const party = parties.find((party) => party.id === signer.id);
      if (!party) return fail("SOURCE_CHANGED");
      return Object.freeze({
        id: signer.id,
        full_name: String(party.full_name),
        email: String(party.email),
        signer_role: signer.signer_role,
        signing_order: signer.signing_order,
        field_count: checked.manifest.fields.filter((field) =>
          field.signer_id === signer.id
        ).length,
      });
    }));
    const packet = Object.freeze({
      kind: "prepared_signature_review" as const,
      request: intent,
      title: view.title as string,
      document: Object.freeze({
        sha256: pdf.sha256,
        byte_length: pdf.bytes.length,
        page_count: checked.manifest.document.pages.length,
      }),
      signers,
      ready_for_review: checked.ready_for_review,
      issues: checked.issues,
      approval: "not_requested" as const,
      sending: "not_connected" as const,
    });
    const digest = await sha256Hex(canonicalPresentationJson(packet));
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
    verifySource(final, intent);
    if (canonicalPresentationJson(first) !== canonicalPresentationJson(final)) {
      return fail("SOURCE_CHANGED");
    }
    return Object.freeze({ ...packet, review_sha256: digest });
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
