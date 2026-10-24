import { canonicalPresentationJson } from "./preparation-json.ts";
import { sha256Hex } from "./token.ts";
import { commsEmailBodyHtml, normalizeCommsEmailAddress } from "../comms-email/contract.ts";
import { readEmailSenderFacts, emailSenderReadiness, listCommsEmailSenders, type CommsEmailAdmin,
  type EmailProviderEnvironment } from "../comms-email/readiness.ts";
import { senderDisplayName } from "../email/sender-display-name.ts";
import { decideContentRead } from "../inbox-intelligence/policy.ts";
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
      | "FIELD_CORRECTIONS_REQUIRED"
      | "MESSAGE_INVALID"
      | "SENDER_UNVERIFIED"
      | "SENDER_CHOICES_UNVERIFIED"
      | "SENDER_CHANGED"
      | "RECIPIENT_HELD",
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


export const PREPARED_SIGNING_LINK_MARKER = "[[PAIGE_AGREEMENT_SIGNING_LINK]]";
type MessageDraft = { signer_id: string; subject: string; body_text: string };
type BoundSender = { connector_id: string; provider: "sendgrid"; from_address: string;
  from_name: string | null; reply_to: string | null };
/** Original authenticated server factories only. No request-authored environment,
 * credentials, recipient permission, approval or send implementation is accepted. */
export type PreparedSignatureEmailPorts = {
  admin: CommsEmailAdmin & {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  };
  environment(): EmailProviderEnvironment;
  preSend(input: { tenantId: string; channel: "email"; to: string;
    contactId: string | null }): PromiseLike<{ proceed: boolean; outcome: string }>;
};
function exactUnicode(value: string): boolean {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
}
function containsSigningCredential(value: string): boolean {
  // Decode valid percent-encoded runs exactly once, as the signing route does.
  // A stray human "%" must not conceal another valid encoded credential URL.
  const decoded = value.replace(/(?:%[a-f0-9]{2})+/gi, part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  return /\/sign\/[a-f0-9]{64}/i.test(decoded);
}
function captureMessage(value: unknown): MessageDraft {
  if (!object(value) || Object.keys(value).length !== 3 ||
    Object.keys(value).some(k => !["signer_id", "subject", "body_text"].includes(k)) ||
    typeof value.signer_id !== "string" || !UUID.test(value.signer_id) ||
    value.signer_id !== value.signer_id.toLowerCase()) return fail("MESSAGE_INVALID");
  const { subject, body_text } = value;
  if (typeof subject !== "string" || !subject.trim() || subject.length > 200 ||
    (/[\r\n]/.test(subject) || subject.includes("\u0000")) || subject.includes(PREPARED_SIGNING_LINK_MARKER) ||
    containsSigningCredential(subject) ||
    !exactUnicode(subject) || typeof body_text !== "string" || !body_text.trim() ||
    body_text.length > 10000 || body_text.includes("\u0000") || !exactUnicode(body_text) ||
    body_text.split(PREPARED_SIGNING_LINK_MARKER).length !== 2 ||
    containsSigningCredential(body_text)) return fail("MESSAGE_INVALID");
  return { signer_id: value.signer_id, subject, body_text };
}
function captureEmailReview(value: unknown) {
  let copy: unknown;
  try { copy = structuredClone(value); } catch { return fail("INVALID_REQUEST"); }
  if (!object(copy) || Object.keys(copy).length !== 5 ||
    Object.keys(copy).some(k => !["operation_id", "review", "expected_review_sha256",
      "connector_id", "messages"].includes(k)) ||
    typeof copy.connector_id !== "string" || !UUID.test(copy.connector_id) ||
    copy.connector_id !== copy.connector_id.toLowerCase()) return fail("INVALID_REQUEST");
  const source = capture({ operation_id: copy.operation_id, review: copy.review,
    expected_review_sha256: copy.expected_review_sha256 });
  if (!Array.isArray(copy.messages) || copy.messages.length < 1 || copy.messages.length > 100) {
    return fail("MESSAGE_INVALID");
  }
  const messages = copy.messages.map(captureMessage);
  if (new Set(messages.map(m => m.signer_id)).size !== messages.length) return fail("MESSAGE_INVALID");
  return { ...source, connector_id: copy.connector_id, messages };
}
const optionalIdentityText = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || (/[\r\n<>]/.test(value) || value.includes("\u0000")) || !exactUnicode(value)) {
    return fail("SENDER_UNVERIFIED");
  }
  return value;
};
async function boundRequestSender(ports: PreparedSignatureEmailPorts, tenantId: string,
  connectorId: string, actorId: string): Promise<BoundSender> {
  try {
    // Reuse the one canonical mailbox permission and provider/domain readiness
    // opinion. This new prepared PAIGE Email path has no platform/default sender.
    const facts = await readEmailSenderFacts(ports.admin, tenantId, connectorId, actorId);
    if (!facts || facts.provider !== "sendgrid" || emailSenderReadiness(facts, ports.environment())) {
      return fail("SENDER_UNVERIFIED");
    }
    const result = await ports.admin.from("channel_connectors")
      .select("id,tenant_id,channel_type,provider,status,active,from_address,from_name,reply_to,mailbox_class,mailbox_owner_user_id")
      .eq("tenant_id", tenantId).eq("id", connectorId).eq("channel_type", "email").maybeSingle();
    const row = result.data;
    if (result.error || !object(row) || row.id !== connectorId || row.tenant_id !== tenantId ||
      row.provider !== "sendgrid" || row.channel_type !== "email" || row.status !== "active" ||
      row.active !== true) return fail("SENDER_UNVERIFIED");
    // The exact identity row must still satisfy the original mailbox policy:
    // facts may have been read just before a connection became private.
    if (!decideContentRead({ callerUserId: actorId, callerTenantId: tenantId,
      mailboxTenantId: String(row.tenant_id), mailbox: {
        mailbox_class: row.mailbox_class, mailbox_owner_user_id: row.mailbox_owner_user_id,
        active: row.active, status: row.status, mailbox_scopes: null,
      } }).allowed) return fail("SENDER_UNVERIFIED");
    const address = normalizeCommsEmailAddress(row.from_address);
    if (!address || address !== normalizeCommsEmailAddress(facts.fromAddress)) return fail("SENDER_UNVERIFIED");
    const identity = await ports.admin.rpc("tenant_sender_identity", { _tenant_id: tenantId });
    if (identity.error || !object(identity.data)) return fail("SENDER_UNVERIFIED");
    const name = optionalIdentityText(row.from_name) || optionalIdentityText(identity.data.from_name);
    const tenantName = optionalIdentityText(identity.data.tenant_name);
    const rawReply = optionalIdentityText(row.reply_to) || optionalIdentityText(identity.data.reply_to);
    const reply = rawReply ? normalizeCommsEmailAddress(rawReply) : null;
    if (rawReply && !reply) return fail("SENDER_UNVERIFIED");
    return { connector_id: connectorId, provider: "sendgrid", from_address: address,
      from_name: senderDisplayName({ fromName: name, tenantName }), reply_to: reply };
  } catch {
    // No credential, raw provider failure or private connection data in errors.
    return fail("SENDER_UNVERIFIED");
  }
}
/** READ ONLY in the ORIGINAL agreement capability. This is the whole review
 * input for a FUTURE canonical HIGH request, never a yes, issued confirmation,
 * token, message, claim, send or execution receipt. The actual admission/claim
 * must independently re-read source, sender, recipient policy and authority.
 *
 * The exact message body retains only a marker. A future original governed
 * sender may replace it transiently AFTER the native hash-only token/message
 * claim. A signing credential must never be persisted in this review/history. */
export async function prepareSignatureRequestReview(
  value: unknown, caller: OwnerPreparationCaller, service: OwnerPreparationService,
  expectedActorId: string, ports: PreparedSignatureEmailPorts,
) {
  const intent = captureEmailReview(value);
  const sourceInput = { operation_id: intent.operation_id, review: intent.review,
    expected_review_sha256: intent.expected_review_sha256 };
  const source = await prepareSignatureRequestInput(sourceInput, caller, service, expectedActorId);
  const recipients = source.args.recipients;
  const drafts = new Map(intent.messages.map(m => [m.signer_id, m]));
  if (drafts.size !== recipients.length || recipients.some(r => !drafts.has(r.id))) {
    return fail("MESSAGE_INVALID");
  }
  const sender = await boundRequestSender(ports, source.args.expectedTenantId,
    intent.connector_id, expectedActorId);
  const messages = [];
  for (const recipient of recipients) {
    const draft = drafts.get(recipient.id)!;
    try {
      const gate = await ports.preSend({ tenantId: source.args.expectedTenantId, channel: "email",
        to: recipient.email, contactId: recipient.signer_role === "counterparty"
          ? source.args.source.client_id : null });
      if (gate?.proceed !== true || gate.outcome !== "proceed") return fail("RECIPIENT_HELD");
    } catch {
      return fail("RECIPIENT_HELD");
    }
    messages.push({ signer_id: recipient.id, to: recipient.email, subject: draft.subject,
      body_text: draft.body_text, body_html: commsEmailBodyHtml(draft.body_text) });
  }
  // Original native readers re-prove actor, business, source and actual PDF
  // AFTER all sender/recipient work. A stale review never adopts new facts.
  const finalSender = await boundRequestSender(ports, source.args.expectedTenantId,
    intent.connector_id, expectedActorId);
  const finalSource = await prepareSignatureRequestInput(sourceInput, caller, service, expectedActorId);
  if (canonicalPresentationJson(source.args) !== canonicalPresentationJson(finalSource.args)) {
    return fail("REVIEW_CHANGED");
  }
  if (canonicalPresentationJson(sender) !== canonicalPresentationJson(finalSender)) {
    return fail("SENDER_CHANGED");
  }
  const args = { ...structuredClone(source.args), requestSchemaVersion: 1 as const, sender, messages };
  return frozen({ kind: "prepared_signature_request_review" as const,
    tool: "agreement_send" as const, args,
    request_sha256: await sha256Hex(canonicalPresentationJson(args)),
    approval: "not_requested" as const, execution: "unavailable" as const });
}


/** Authorized sender metadata for the same exact saved request. These choices
 * are a read, not sender approval or proof of delivery. Unlike the generic
 * email party resolver, this preserves agreement witnesses/business signers. */
export async function readPreparedSignatureSenders(
  value: unknown, caller: OwnerPreparationCaller, service: OwnerPreparationService,
  expectedActorId: string, ports: PreparedSignatureEmailPorts,
) {
  const intent = capture(value);
  const initial = await prepareSignatureRequestInput(intent, caller, service, expectedActorId);
  const readChoices = async () => {
    try {
      const list = await listCommsEmailSenders(ports.admin,
        { tenantId: initial.args.expectedTenantId, actorUserId: expectedActorId }, ["sendgrid"]);
      const choices = [];
      for (const identity of list) {
        const facts = await readEmailSenderFacts(ports.admin, initial.args.expectedTenantId,
          identity.connector_id, expectedActorId);
        if (!facts || facts.provider !== "sendgrid" ||
          normalizeCommsEmailAddress(facts.fromAddress) !== identity.from_address) {
          return fail("SENDER_CHANGED");
        }
        const setup = emailSenderReadiness(facts, ports.environment());
        choices.push({ ...identity, state: setup?.state ?? "ready" as const, reason: setup?.reason ?? null });
      }
      return choices;
    } catch (error) {
      if (error instanceof PreparedSignatureRequestUnavailable) throw error;
      return fail("SENDER_CHOICES_UNVERIFIED");
    }
  };
  const choices = await readChoices();
  const finalChoices = await readChoices();
  // The actual authenticated actor/source is always the LAST private read.
  const final = await prepareSignatureRequestInput(intent, caller, service, expectedActorId);
  if (canonicalPresentationJson(initial.args) !== canonicalPresentationJson(final.args)) return fail("REVIEW_CHANGED");
  if (canonicalPresentationJson(choices) !== canonicalPresentationJson(finalChoices)) return fail("SENDER_CHANGED");
  return frozen({ kind: "prepared_signature_sender_choices" as const,
    review_sha256: initial.args.reviewSha256, senders: choices,
    provider_execution_verified: false as const, approval: "not_requested" as const,
    execution: "unavailable" as const });
}
