import assert from "node:assert/strict";
import * as candidate from "./prepared-signature-request.ts";
import { confirmFingerprint } from "../confirm-fingerprint.ts";
import {
  executeOwnerPreparation,
  type OwnerPreparationCaller,
  type OwnerPreparationService,
} from "./owner-preparation.ts";
import {
  type PreparedSignatureReviewIntent,
  readPreparedSignatureReview,
} from "./prepared-signature-review.ts";
import {
  actor,
  agreement,
  at,
  client,
  field,
  fixture,
  next,
  prepare,
  save,
  tenant,
} from "./test-fixtures/owner-preparation.ts";

type Input = {
  operation_id: string;
  review: PreparedSignatureReviewIntent;
  expected_review_sha256: string;
};
type Proposal = {
  kind: "prepared_signature_request_input";
  tool: "agreement_send";
  args: Record<string, unknown>;
  approval: "not_requested";
  execution: "unavailable";
};
type Builder = (
  input: unknown,
  caller: OwnerPreparationCaller,
  service: OwnerPreparationService,
  expectedActorId: string,
) => Promise<Proposal>;
const builder = () => {
  const fn =
    (candidate as unknown as { prepareSignatureRequestInput?: Builder })
      .prepareSignatureRequestInput;
  assert.equal(
    typeof fn,
    "function",
    "Missing exact original saved-source approval-input adapter",
  );
  return fn!;
};
const operation = "99999999-0000-4000-8000-000000000001";
async function seeded(fields: unknown[] = [field()]) {
  const f = await fixture();
  await executeOwnerPreparation(prepare(), f.caller, f.service);
  await executeOwnerPreparation(save(fields), f.caller, f.service);
  const review: PreparedSignatureReviewIntent = {
    tenant_id: tenant,
    agreement_id: agreement,
    preparation_id: next,
    preparation_sha256: String(f.rows.get(next)!.preparation_sha256),
    expected_source: { client_id: client, version: 1, updated_at: at },
  };
  const packet = await readPreparedSignatureReview(
    review,
    f.caller,
    f.service,
    actor,
  );
  const input: Input = {
    operation_id: operation,
    review,
    expected_review_sha256: packet.review_sha256,
  };
  return { f, input, packet };
}
const effects = (f: Awaited<ReturnType<typeof fixture>>) => ({
  writes: f.calls.write,
  uploads: f.calls.upload,
  rows: f.rows.size,
  objects: f.objects.size,
});
const refuses = (code: string) => (e: unknown) =>
  e instanceof candidate.PreparedSignatureRequestUnavailable && e.code === code;

Deno.test("original control: current review retains and verifies the actual PDF before input construction", async () => {
  const { f, packet } = await seeded();
  assert.equal(packet.ready_for_review, true);
  assert.equal(packet.document.page_count, 1);
  assert.equal(f.rows.size, 2);
  assert.equal(packet.approval, "not_requested");
  assert.equal(packet.sending, "not_connected");
});
Deno.test("binds the actual saved document and all reviewed parties using the original confirmation fingerprint, without effects", async () => {
  const { f, input, packet } = await seeded(), before = effects(f);
  const p = await builder()(input, f.caller, f.service, actor);
  assert.equal(p.kind, "prepared_signature_request_input");
  assert.equal(p.tool, "agreement_send");
  assert.equal(p.approval, "not_requested");
  assert.equal(p.execution, "unavailable");
  assert.equal(p.args.agreementId, agreement);
  assert.equal(p.args.expectedTenantId, tenant);
  assert.equal(p.args.operationId, operation);
  assert.equal(p.args.preparationId, next);
  assert.equal(p.args.preparationSha256, input.review.preparation_sha256);
  assert.equal(p.args.reviewSha256, packet.review_sha256);
  assert.deepEqual(p.args.source, input.review.expected_source);
  assert.deepEqual(p.args.document, packet.document);
  assert.deepEqual(p.args.recipients, packet.signers);
  assert.equal(p.args.title, packet.title);
  assert.match(
    await confirmFingerprint("agreement_send", p.args),
    /^[a-f0-9]{16}$/,
  );
  assert.equal("fingerprint" in p, false);
  assert.deepEqual(effects(f), before);
  assert(
    !/token|provider|delivered|signature_recorded|approved_fingerprint|decision_receipt/
      .test(JSON.stringify(p)),
  );
});
Deno.test("captures operation, source and expected reviewed identity before the first await", async () => {
  const { f, input, packet } = await seeded();
  let changed = false;
  f.state.onDownload = () => {
    if (changed) return;
    changed = true;
    input.operation_id = "99999999-0000-4000-8000-000000000002";
    input.expected_review_sha256 = "0".repeat(64);
    input.review.expected_source.updated_at =
      "2026-10-22T12:00:00.123457+00:00";
  };
  const p = await builder()(input, f.caller, f.service, actor);
  assert(changed);
  assert.equal(p.args.operationId, operation);
  assert.equal(p.args.reviewSha256, packet.review_sha256);
  assert.deepEqual(p.args.source, {
    client_id: client,
    version: 1,
    updated_at: at,
  });
});
for (
  const [label, extra] of Object.entries({
    actor: { actor_id: actor },
    approval: { approved_fingerprint: "0123456789abcdef" },
    governance: { governance: { decision_receipt_recorded: true } },
    sender: { from_address: "other@example.test" },
    recipients: { recipients: [] },
    provider: { provider: "sendgrid" },
    receipt: { receipt_id: operation },
    execution: { execute: true },
  })
) {
  Deno.test(
    "refuses request-authored " + label + " before private reads",
    async () => {
      const { f, input } = await seeded(), before = { ...f.calls };
      await assert.rejects(
        () => builder()({ ...input, ...extra }, f.caller, f.service, actor),
        refuses("INVALID_REQUEST"),
      );
      assert.deepEqual(f.calls, before);
    },
  );
}
for (
  const invalid of [
    null,
    [],
    {},
    "",
    "AAAAAAAA-0000-4000-8000-000000000001",
    "not-an-operation",
  ]
) {
  Deno.test(
    "refuses noncanonical operation identity " + JSON.stringify(invalid),
    async () => {
      const { f, input } = await seeded(), before = { ...f.calls };
      await assert.rejects(
        () =>
          builder()(
            { ...input, operation_id: invalid },
            f.caller,
            f.service,
            actor,
          ),
        refuses("INVALID_REQUEST"),
      );
      assert.deepEqual(f.calls, before);
    },
  );
}
Deno.test("does not silently adopt a different reviewed identity even when the original source is still readable", async () => {
  const { f, input } = await seeded(), before = effects(f);
  await assert.rejects(
    () =>
      builder()(
        { ...input, expected_review_sha256: "0".repeat(64) },
        f.caller,
        f.service,
        actor,
      ),
    refuses("REVIEW_CHANGED"),
  );
  assert.deepEqual(effects(f), before);
});
Deno.test("withholds approval input when original field validation requires corrections", async () => {
  const { f, input } = await seeded([]), before = effects(f);
  await assert.rejects(
    () => builder()(input, f.caller, f.service, actor),
    refuses("FIELD_CORRECTIONS_REQUIRED"),
  );
  assert.deepEqual(effects(f), before);
});
Deno.test("original authority is rechecked after private PDF work; a different actor is never adopted", async () => {
  const { f, input } = await seeded(), before = effects(f);
  f.state.onDownload = () => {
    f.state.actor = "cccccccc-0000-4000-8000-000000000002";
  };
  await assert.rejects(
    () => builder()(input, f.caller, f.service, actor),
    (e) =>
      e instanceof Error &&
      e.message === "PREPARED_SIGNATURE_REVIEW_ACCESS_UNVERIFIED",
  );
  assert.deepEqual(effects(f), before);
});
Deno.test("missing server-authenticated actor cannot fall back to adopting the current session", async () => {
  const { f, input } = await seeded(), before = { ...f.calls };
  await assert.rejects(
    () => builder()(input, f.caller, f.service, undefined as unknown as string),
    (e) =>
      e instanceof Error &&
      e.message === "PREPARED_SIGNATURE_REVIEW_ACCESS_UNVERIFIED",
  );
  assert.deepEqual(f.calls, before);
});
Deno.test("a read-only review digest never overrides original native profile withdrawal", async () => {
  const { f, input } = await seeded(), before = effects(f);
  f.state.profile = false;
  await assert.rejects(
    () => builder()(input, f.caller, f.service, actor),
    (e) =>
      e instanceof Error &&
      e.message === "PREPARED_SIGNATURE_REVIEW_ACCESS_UNVERIFIED",
  );
  assert.deepEqual(effects(f), before);
});
Deno.test("freezes nested exact arguments before the original confirmation gate consumes them", async () => {
  const { f, input } = await seeded();
  const p = await builder()(input, f.caller, f.service, actor);
  const fingerprint = await confirmFingerprint("agreement_send", p.args);
  const frozen = (v: unknown): void => {
    if (v && typeof v === "object") {
      assert(Object.isFrozen(v));
      for (const child of Object.values(v)) frozen(child);
    }
  };
  frozen(p);
  assert.throws(() => {
    (p.args.document as Record<string, unknown>).sha256 = "0".repeat(64);
  }, TypeError);
  assert.equal(fingerprint, await confirmFingerprint("agreement_send", p.args));
});
Deno.test("all consequential source and recipient changes affect the unchanged canonical confirmation fingerprint", async () => {
  const { f, input } = await seeded();
  const p = await builder()(input, f.caller, f.service, actor);
  const fingerprint = await confirmFingerprint("agreement_send", p.args);
  const mutations: Array<(a: Record<string, unknown>) => void> = [
    (a) => {
      a.agreementId = operation;
    },
    (a) => {
      a.expectedTenantId = operation;
    },
    (a) => {
      a.operationId = next;
    },
    (a) => {
      a.preparationId = operation;
    },
    (a) => {
      a.preparationSha256 = "0".repeat(64);
    },
    (a) => {
      a.reviewSha256 = "0".repeat(64);
    },
    (a) => {
      a.title = "Changed reviewed wording title";
    },
    (a) => {
      (a.source as Record<string, unknown>).client_id = operation;
    },
    (a) => {
      (a.source as Record<string, unknown>).version = 2;
    },
    (a) => {
      (a.source as Record<string, unknown>).updated_at =
        "2026-10-22T12:00:00.123457+00:00";
    },
    (a) => {
      (a.document as Record<string, unknown>).sha256 = "0".repeat(64);
    },
    (a) => {
      (a.document as Record<string, unknown>).byte_length = 5;
    },
    (a) => {
      (a.document as Record<string, unknown>).page_count = 2;
    },
    (a) => {
      (a.recipients as Record<string, unknown>[])[0].id = operation;
    },
    (a) => {
      (a.recipients as Record<string, unknown>[])[0].email =
        "changed@example.test";
    },
    (a) => {
      (a.recipients as Record<string, unknown>[])[0].full_name =
        "Changed recipient";
    },
    (a) => {
      (a.recipients as Record<string, unknown>[])[0].signer_role = "witness";
    },
    (a) => {
      (a.recipients as Record<string, unknown>[])[0].signing_order = 2;
    },
    (a) => {
      (a.recipients as Record<string, unknown>[])[0].field_count = 2;
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(p.args);
    mutate(changed);
    assert.notEqual(
      await confirmFingerprint("agreement_send", changed),
      fingerprint,
    );
  }
});
Deno.test("preserves separate client, business and witness identities and parallel/sequential signing steps", async () => {
  const f = await fixture();
  const witness = "eeeeeeee-0000-4000-8000-000000000002",
    business = "eeeeeeee-0000-4000-8000-000000000003";
  f.parties.push({
    ...f.parties[0],
    id: witness,
    full_name: "Controlled Witness",
    email: "witness@example.test",
    signer_role: "witness",
    signing_order: 1,
  }, {
    ...f.parties[0],
    id: business,
    full_name: "Controlled Business Signer",
    email: "business@example.test",
    signer_role: "tenant_signatory",
    signing_order: 2,
  });
  await executeOwnerPreparation(prepare(), f.caller, f.service);
  await executeOwnerPreparation(
    save([field(), {
      ...field("22222222-0000-4000-8000-000000000002"),
      signer_id: witness,
      y: 150,
    }, {
      ...field("22222222-0000-4000-8000-000000000003"),
      signer_id: business,
      y: 220,
    }]),
    f.caller,
    f.service,
  );
  const review: PreparedSignatureReviewIntent = {
    tenant_id: tenant,
    agreement_id: agreement,
    preparation_id: next,
    preparation_sha256: String(f.rows.get(next)!.preparation_sha256),
    expected_source: { client_id: client, version: 1, updated_at: at },
  };
  const packet = await readPreparedSignatureReview(
      review,
      f.caller,
      f.service,
      actor,
    ),
    before = effects(f);
  const p = await builder()(
    {
      operation_id: operation,
      review,
      expected_review_sha256: packet.review_sha256,
    },
    f.caller,
    f.service,
    actor,
  );
  assert.deepEqual(p.args.recipients, packet.signers);
  const recipients = p.args.recipients;
  assert.equal(recipients.length, 3);
  assert.deepEqual(recipients.map((r) => r.signer_role), [
    "counterparty",
    "witness",
    "tenant_signatory",
  ]);
  assert.deepEqual(recipients.map((r) => r.signing_order), [1, 1, 2]);
  assert.deepEqual(effects(f), before);
});


// C35: the original source input must bind the actual verified sender and the
// exact recipient messages before a future canonical HIGH request is possible.
const signingLinkMarker = "[[PAIGE_AGREEMENT_SIGNING_LINK]]";
const connectorId = "dddddddd-0000-4000-8000-000000000001";
type RequestReview = {
  kind: "prepared_signature_request_review";
  tool: "agreement_send";
  args: Record<string, unknown>;
  request_sha256: string;
  approval: "not_requested";
  execution: "unavailable";
};
type ReviewBuilder = (input: unknown, caller: OwnerPreparationCaller,
  service: OwnerPreparationService, actorId: string, emailPorts: unknown) => Promise<RequestReview>;
const reviewBuilder = () => {
  const fn = (candidate as unknown as { prepareSignatureRequestReview?: ReviewBuilder })
    .prepareSignatureRequestReview;
  assert.equal(typeof fn, "function", "Missing original sender-and-message request review");
  return fn!;
};
async function requestSeed() {
  const seed = await seeded();
  const signerId = seed.packet.signers[0].id;
  const input = { ...seed.input, connector_id: connectorId,
    messages: [{ signer_id: signerId, subject: "Please review your service agreement",
      body_text: "Review the exact document before signing.\n" + signingLinkMarker }] };
  const state = {
    connector: { id: connectorId, tenant_id: tenant, provider: "sendgrid",
      channel_type: "email", active: true, status: "active",
      from_address: "hello@studio.example.test", from_name: "Studio Team",
      reply_to: "support@studio.example.test", mailbox_class: "shared_support",
      mailbox_owner_user_id: null as string | null, credentials_vault_ref: null, config: {} },
    domain: { tenant_id: tenant, domain: "studio.example.test", sendgrid_status: "verified",
      sendgrid_domain_id: "controlled-domain", sendgrid_verified_at: at },
    identity: { from_name: "Original business", from_address: "original@studio.example.test",
      reply_to: "original-reply@studio.example.test", tenant_name: "Controlled Studio" },
    configured: true, readError: false,
    preSend: { proceed: true, outcome: "proceed" },
    preSendCalls: [] as Array<Record<string, unknown>>,
    onPreSend: null as (() => void) | null,
    onIdentity: null as ((read: number) => void) | null, identityReads: 0,
    onConnectorRead: null as ((read: number) => void) | null, connectorReads: 0,
    reads: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  };
  const emailPorts = {
    admin: {
      from(table: string) {
        return { select(_columns: string) {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(key: string, value: unknown) { filters[key] = value; return query; },
            async maybeSingle() {
              if (table === "channel_connectors") { state.connectorReads++; state.onConnectorRead?.(state.connectorReads); }
              state.reads.push({ table, filters: { ...filters } });
              return { data: structuredClone(table === "channel_connectors"
                ? state.connector : table === "tenant_email_domains" ? state.domain : null),
                error: state.readError ? { message: "private provider detail" } : null };
            },
          };
          return query;
        } };
      },
      async rpc(name: string, args: Record<string, unknown>) {
        assert.equal(name, "tenant_sender_identity", "No approval or message RPC in a review");
        assert.deepEqual(args, { _tenant_id: tenant });
        state.identityReads++; state.onIdentity?.(state.identityReads);
        return { data: structuredClone(state.identity), error: null };
      },
    },
    environment: () => ({ resendConfigured: false, googleConfigured: false,
      sendgridConfigured: state.configured }),
    async preSend(input: Record<string, unknown>) {
      state.preSendCalls.push(structuredClone(input));
      state.onPreSend?.();
      return { ...state.preSend };
    },
  };
  return { ...seed, input, state, emailPorts,
    run: () => reviewBuilder()(input, seed.f.caller, seed.f.service, actor, emailPorts) };
}
Deno.test("request review binds original PDF, actual verified sender and exact messages without approval or effects", async () => {
  const x = await requestSeed(), before = effects(x.f);
  const result = await x.run();
  assert.equal(result.kind, "prepared_signature_request_review");
  assert.equal(result.tool, "agreement_send");
  assert.equal(result.approval, "not_requested");
  assert.equal(result.execution, "unavailable");
  assert.match(result.request_sha256, /^[a-f0-9]{64}$/);
  const args = result.args as Record<string, unknown>;
  assert.equal(args.agreementId, agreement);
  assert.equal(args.preparationId, next);
  assert.deepEqual(args.recipients, x.packet.signers);
  assert.deepEqual(args.document, x.packet.document);
  const sender = args.sender as Record<string, unknown>;
  assert.equal(sender.connector_id, connectorId);
  assert.equal(sender.from_address, x.state.connector.from_address);
  assert.equal(sender.from_name, "Studio Team");
  assert.equal(sender.reply_to, "support@studio.example.test");
  const messages = args.messages as Array<Record<string, unknown>>;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].signer_id, x.packet.signers[0].id);
  assert.equal(messages[0].to, x.packet.signers[0].email);
  assert.equal(messages[0].subject, x.input.messages[0].subject);
  assert.equal(messages[0].body_text, x.input.messages[0].body_text);
  assert.equal(messages[0].body_html, "<p>Review the exact document before signing.<br>" + signingLinkMarker + "</p>");
  assert.deepEqual(x.state.preSendCalls, [{ tenantId: tenant, channel: "email",
    to: x.packet.signers[0].email, contactId: client }]);
  assert(x.state.reads.every(r => r.filters.tenant_id === tenant));
  assert.deepEqual(effects(x.f), before);
  assert(Object.isFrozen(result) && Object.isFrozen(args) && Object.isFrozen(sender));
  assert(!("approved_fingerprint" in result) && !("receipt_id" in result));
});
Deno.test("request review captures messages and sender choice before the first await", async () => {
  const x = await requestSeed(), original = structuredClone(x.input);
  x.f.state.onDownload = () => {
    x.input.connector_id = operation;
    x.input.messages[0].body_text = "Changed";
  };
  const result = await x.run();
  assert.equal((result.args.sender as Record<string, unknown>).connector_id, connectorId);
  assert.equal((result.args.messages as Array<Record<string, unknown>>)[0].body_text,
    original.messages[0].body_text);
});
for (const [label, change] of Object.entries({
  "missing signing link": { body_text: "Please sign" },
  "repeated signing link": { body_text: signingLinkMarker + signingLinkMarker },
  "subject line break": { subject: "Review\r\nHidden header" },
  "subject marker": { subject: signingLinkMarker },
  "empty body": { body_text: " " },
  "oversize body": { body_text: "a".repeat(10001) + signingLinkMarker },
  "NUL body": { body_text: "\u0000" + signingLinkMarker },
  "unretained Unicode": { body_text: "\ud800" + signingLinkMarker },
  "live signing secret": { body_text: "https://paigeagent.ai/sign/" + "a".repeat(64) + "\n" + signingLinkMarker },
  "recipient override": { to: "another@example.test" },
  "live secret in subject": { subject: "https://paigeagent.ai/sign/" + "a".repeat(64) },
  "encoded live secret": { body_text: "https://paigeagent.ai/%73ign/" + "%61".repeat(64) + "\n" + signingLinkMarker },
})) {
  Deno.test("request review refuses " + label + " before private reads", async () => {
    const x = await requestSeed(), before = { ...x.f.calls };
    x.input.messages[0] = { ...x.input.messages[0], ...change };
    await assert.rejects(x.run, refuses("MESSAGE_INVALID"));
    assert.deepEqual(x.f.calls, before);
    assert.equal(x.state.reads.length, 0);
  });
}
for (const [label, change] of Object.entries({
  "foreign tenant": { tenant_id: operation },
  "inactive connection": { active: false },
  "revoked connection": { status: "revoked" },
  "unapproved provider": { provider: "resend" },
  "private mailbox owned by another actor": { mailbox_class: "personal", mailbox_owner_user_id: operation },
  "malformed mailbox": { mailbox_class: "unknown" },
  "unverified From": { from_address: "other@another.example.test" },
  "header name injection": { from_name: "Studio\r\nHidden" },
})) {
  Deno.test("request review withholds " + label + " using original sender policy", async () => {
    const x = await requestSeed(), before = effects(x.f);
    Object.assign(x.state.connector, change);
    await assert.rejects(x.run, refuses("SENDER_UNVERIFIED"));
    assert.deepEqual(effects(x.f), before);
  });
}
Deno.test("request review requires actual business-domain verification and current platform readiness", async () => {
  const x = await requestSeed();
  x.state.domain.sendgrid_status = "pending";
  await assert.rejects(x.run, refuses("SENDER_UNVERIFIED"));
  x.state.domain.sendgrid_status = "verified";
  x.state.configured = false;
  await assert.rejects(x.run, refuses("SENDER_UNVERIFIED"));
  x.state.configured = true;
  x.state.readError = true;
  await assert.rejects(x.run, refuses("SENDER_UNVERIFIED"));
});
for (const outcome of ["blocked_suppressed", "blocked_client_dnd", "queued_tenant_dnd", "error"]) {
  Deno.test("request review preserves canonical recipient hold " + outcome, async () => {
    const x = await requestSeed(), before = effects(x.f);
    x.state.preSend = { proceed: false, outcome };
    await assert.rejects(x.run, refuses("RECIPIENT_HELD"));
    assert.deepEqual(effects(x.f), before);
  });
}
Deno.test("request review refuses missing, duplicate or foreign assigned signer messages", async () => {
  for (const mode of ["missing", "duplicate", "foreign"]) {
    const x = await requestSeed(), before = effects(x.f);
    if (mode === "missing") x.input.messages = [];
    if (mode === "duplicate") x.input.messages.push({ ...x.input.messages[0] });
    if (mode === "foreign") x.input.messages[0].signer_id = operation;
    await assert.rejects(x.run, refuses("MESSAGE_INVALID"));
    assert.deepEqual(effects(x.f), before);
  }
});
Deno.test("request review rejects changed sender identity after recipient work without adopting it", async () => {
  const x = await requestSeed(), before = effects(x.f);
  x.state.onPreSend = () => { x.state.connector.from_name = "Another name"; };
  await assert.rejects(x.run, refuses("SENDER_CHANGED"));
  assert.deepEqual(effects(x.f), before);
});
Deno.test("request review revalidates the original actor after sender and recipient work", async () => {
  const x = await requestSeed(), before = effects(x.f);
  x.state.onPreSend = () => { x.f.state.actor = operation; };
  await assert.rejects(x.run, e => e instanceof Error &&
    e.message === "PREPARED_SIGNATURE_REVIEW_ACCESS_UNVERIFIED");
  assert.deepEqual(effects(x.f), before);
});
Deno.test("every approved sender or message value changes the original canonical confirmation fingerprint", async () => {
  const x = await requestSeed(), result = await x.run();
  const fingerprint = await confirmFingerprint("agreement_send", result.args);
  for (const key of ["from_address", "from_name", "reply_to", "connector_id", "provider"]) {
    const changed = structuredClone(result.args);
    (changed.sender as Record<string, unknown>)[key] = "changed";
    assert.notEqual(await confirmFingerprint("agreement_send", changed), fingerprint);
  }
  for (const key of ["signer_id", "to", "subject", "body_text", "body_html"]) {
    const changed = structuredClone(result.args);
    (changed.messages as Array<Record<string, unknown>>)[0][key] = "changed";
    assert.notEqual(await confirmFingerprint("agreement_send", changed), fingerprint);
  }
});


Deno.test("request review rechecks authority after the LAST private sender read", async () => {
  const x = await requestSeed(), before = effects(x.f);
  x.state.onIdentity = n => { if (n === 2) x.f.state.actor = operation; };
  await assert.rejects(x.run, e => e instanceof Error &&
    e.message === "PREPARED_SIGNATURE_REVIEW_ACCESS_UNVERIFIED");
  assert.deepEqual(effects(x.f), before);
});
Deno.test("request review cannot adopt a newly private mailbox between canonical facts and exact identity reads", async () => {
  const x = await requestSeed(), before = effects(x.f);
  x.state.onConnectorRead = n => {
    if (n === 4) {
      x.state.connector.mailbox_class = "personal";
      x.state.connector.mailbox_owner_user_id = operation;
    }
  };
  await assert.rejects(x.run, refuses("SENDER_UNVERIFIED"));
  assert.deepEqual(effects(x.f), before);
});
Deno.test("request review retains valid Unicode including an initial BOM without replacement", async () => {
  const x = await requestSeed();
  x.input.messages[0].body_text = "\ufeffHello \u{1f44b}\n" + signingLinkMarker;
  const result = await x.run();
  assert.equal((result.args.messages as Array<Record<string, unknown>>)[0].body_text,
    x.input.messages[0].body_text);
});
