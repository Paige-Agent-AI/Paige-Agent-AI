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
const exactRequestReader = () => {
  const fn = (candidate as unknown as { readExactPreparedSignatureRequest?: ReviewBuilder })
    .readExactPreparedSignatureRequest;
  assert.equal(typeof fn, "function", "Missing exact reviewed-request preflight before consequential admission");
  return fn!;
};
// The canonical approval/execution integration must never silently adopt a new
// message, sending identity or operation after this complete request was reviewed.
Deno.test("exact request preflight reuses the original reviewed document and messages without issuing approval", async () => {
  const x = await requestSeed(), reviewed = await x.run(), before = effects(x.f);
  const result = await exactRequestReader()({ ...x.input, expected_request_sha256: reviewed.request_sha256 },
    x.f.caller, x.f.service, actor, x.emailPorts);
  assert.deepEqual(result, reviewed);
  assert.equal(result.approval, "not_requested");
  assert.equal(result.execution, "unavailable");
  assert.deepEqual(effects(x.f), before);
});
for (const change of ["message", "sender", "operation"] as const) {
  Deno.test("exact request preflight refuses a newly valid " + change + " instead of renewing the reviewed request", async () => {
    const x = await requestSeed(), reviewed = await x.run(), before = effects(x.f);
    if (change === "message") x.input.messages[0].body_text = "A different valid message\n" + signingLinkMarker;
    if (change === "sender") x.state.connector.from_name = "Changed business display name";
    if (change === "operation") x.input.operation_id = next;
    await assert.rejects(() => exactRequestReader()({ ...x.input, expected_request_sha256: reviewed.request_sha256 },
      x.f.caller, x.f.service, actor, x.emailPorts), refuses("REVIEW_CHANGED"));
    assert.deepEqual(effects(x.f), before);
  });
}
Deno.test("exact request preflight captures its whole request and expected digest before asynchronous reads", async () => {
  const x = await requestSeed(), reviewed = await x.run();
  const input = { ...x.input, expected_request_sha256: reviewed.request_sha256 };
  x.f.state.onDownload = () => {
    input.expected_request_sha256 = "0".repeat(64);
    input.messages[0].subject = "Changed during the read";
  };
  const result = await exactRequestReader()(input, x.f.caller, x.f.service, actor, x.emailPorts);
  assert.deepEqual(result, reviewed);
});
Deno.test("exact request digest cannot introduce request-authored approval or authority", async () => {
  const x = await requestSeed(), reviewed = await x.run(), before = { ...x.f.calls };
  for (const extra of [{ approved: true }, { governance: { approved_fingerprint: reviewed.request_sha256 } },
    { actor_user_id: actor }, { approval_cycle_nonce: operation }]) {
    await assert.rejects(() => exactRequestReader()({ ...x.input, expected_request_sha256: reviewed.request_sha256, ...extra },
      x.f.caller, x.f.service, actor, x.emailPorts), refuses("INVALID_REQUEST"));
  }
  assert.deepEqual(x.f.calls, before);
});
Deno.test("exact request preflight refuses malformed or missing request digests before private reads", async () => {
  const x = await requestSeed(), before = { ...x.f.calls };
  for (const hash of [undefined, null, "A".repeat(64), "a".repeat(63), "a".repeat(65)]) {
    await assert.rejects(() => exactRequestReader()({ ...x.input, expected_request_sha256: hash },
      x.f.caller, x.f.service, actor, x.emailPorts), refuses("INVALID_REQUEST"));
  }
  assert.deepEqual(x.f.calls, before);
});
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
            then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
              if (table === "channel_connectors") { state.connectorReads++; state.onConnectorRead?.(state.connectorReads); }
              state.reads.push({ table, filters: { ...filters } });
              const rows = table === "channel_connectors" ? [state.connector] : [];
              return Promise.resolve({ data: rows.filter(row => Object.entries(filters)
                .every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value)).map(row => structuredClone(row)),
                error: state.readError ? { message: "private provider detail" } : null }).then(resolve, reject);
            },
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
  "NUL subject": { subject: "Review\u0000Hidden" },
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


Deno.test("original agreement-send mounts private request review before legacy provider or effects", async t => {
  const x = await requestSeed(), before = effects(x.f);
  const previousServe = Deno.serve, previousEnv = Deno.env.get, previousFetch = globalThis.fetch;
  let handler!: (request: Request) => Promise<Response>;
  let limited = false;
  let limitUnavailable = false;
  let legacyProviderConfigured = false;
  const rateCalls: Array<Record<string, unknown>> = [];
  const unexpected: string[] = [];
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value),
    { status, headers: { "Content-Type": "application/json" } });
  const project = (row: Record<string, unknown>, url: URL) =>
    Object.fromEntries((url.searchParams.get("select") ?? "").split(",").map(k => [k, row[k]]));
  try {
    Deno.serve = ((fn: typeof handler) => { handler = fn; return {} as never; }) as unknown as typeof Deno.serve;
    Deno.env.get = name => ({
      SUPABASE_URL: "https://request-review.invalid",
      SUPABASE_ANON_KEY: "synthetic-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
      SENDGRID_MAIL_SEND_API_KEY: "synthetic-sendgrid-key",
      RESEND_API_KEY: legacyProviderConfigured ? "synthetic-legacy-key" : undefined,
    } as Record<string, string>)[name];
    globalThis.fetch = async (input, init) => {
      const req = new Request(input, init), url = new URL(req.url);
      assert.equal(url.origin, "https://request-review.invalid", "No external provider or customer request");
      if (url.pathname === "/auth/v1/user") {
        assert.equal(req.headers.get("apikey"), "synthetic-anon-key");
        assert.equal(req.headers.get("authorization"), "Bearer synthetic-owner");
        return json((await x.f.caller.auth.getUser()).data.user);
      }
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.slice("/rest/v1/rpc/".length);
        const args = await req.json() as Record<string, unknown>;
        const native = ["check_public_rate_limit", "tenant_sender_identity",
          "_read_agreement_document_preparation"].includes(name);
        assert.equal(req.headers.get("apikey"), native ? "synthetic-service-key" : "synthetic-anon-key");
        assert.equal(req.headers.get("authorization"), native
          ? "Bearer synthetic-service-key" : "Bearer synthetic-owner");
        if (name === "check_public_rate_limit") {
          rateCalls.push(args);
          assert.equal(args._window_seconds, 3600);
          if (args._bucket === `agreement-review:${tenant}:${actor}`) assert.equal(args._max, 120);
          else { assert.equal(args._bucket, `agreement-send:${tenant}`); assert.equal(args._max, 20); }
          return limitUnavailable ? json({ message: "private limiter fault" }, 500) : json(!limited);
        }
        if (name === "tenant_sender_identity") return json((await x.emailPorts.admin.rpc(name, args)).data);
        if (name === "_read_agreement_document_preparation") {
          const r = await x.f.service.rpc(name, args);
          return json(r.error ?? r.data, r.error ? 403 : 200);
        }
        if (["current_user_tenant_id", "is_tenant_admin", "read_paige_agreement_preparation"].includes(name)) {
          const r = await x.f.caller.rpc(name, args);
          return json(r.error ?? r.data, r.error ? 403 : 200);
        }
      }
      assert.equal(req.headers.get("apikey"), "synthetic-service-key");
      assert.equal(req.headers.get("authorization"), "Bearer synthetic-service-key");
      if (req.method === "GET" && url.pathname === "/rest/v1/tenants") {
        assert.equal(url.searchParams.get("id"), "eq." + tenant);
        return json({ name: "Controlled Studio", account_type: "solo", parent_tenant_id: null });
      }
      if (req.method === "GET" && ["channel_connectors", "tenant_email_domains"].some(
        name => url.pathname === "/rest/v1/" + name)) {
        const table = url.pathname.slice("/rest/v1/".length);
        const value = table === "channel_connectors" ? x.state.connector : x.state.domain;
        assert.equal(url.searchParams.get("tenant_id"), "eq." + tenant);
        if (x.state.readError) return json({ message: "private provider detail" }, 500);
        const many = table === "channel_connectors" && !url.searchParams.has("id");
        return json(many ? (x.state.connector.active ? [project(value, url)] : []) : project(value, url));
      }
      if (req.method === "GET" && url.pathname === "/rest/v1/clients") {
        assert.equal(url.searchParams.get("tenant_id"), "eq." + tenant);
        return json({ dnd_active: false, dnd_until: null, dnd_reason: null, timezone: "UTC" });
      }
      if (req.method === "GET" && url.pathname === "/rest/v1/paige_suppressions") {
        assert.equal(url.searchParams.get("tenant_id"), "eq." + tenant);
        return json([]);
      }
      if (req.method === "GET" && url.pathname === "/rest/v1/tenant_comms_preferences") {
        assert.equal(url.searchParams.get("tenant_id"), "eq." + tenant);
        return json(null);
      }
      if (req.method === "GET" && url.pathname.startsWith("/storage/v1/object/")) {
        let rest = url.pathname.slice("/storage/v1/object/".length);
        const info = rest.startsWith("info/");
        if (info) rest = rest.slice(5);
        if (rest.startsWith("authenticated/")) rest = rest.slice("authenticated/".length);
        const [bucket, ...key] = rest.split("/");
        const store = x.f.service.storage.from(bucket);
        if (info) {
          const result = await store.info(decodeURIComponent(key.join("/")));
          return json(result.error ?? result.data, result.error ? 404 : 200);
        }
        const result = await store.download(decodeURIComponent(key.join("/")));
        return result.error || !result.data ? json({ error: "not found" }, 404)
          : new Response(await result.data.arrayBuffer(), { headers: { "Content-Type": "application/pdf" } });
      }
      unexpected.push(req.method + " " + url.pathname);
      throw new Error("Unexpected request-review transport: " + req.method + " " + url.pathname);
    };
    await import("../../agreement-send/index.ts");
    assert.equal(typeof handler, "function");
    const invoke = (value: unknown = x.input, query = "?review=prepared-request",
      headers: Record<string, string> = {}) => handler(new Request("https://request-review.invalid/agreement-send" + query,
      { method: "POST", headers: { Authorization: "Bearer synthetic-owner", "Content-Type": "application/json", ...headers },
        body: JSON.stringify(value) }));
    await t.step("eligible owner reads exact sender/messages with no Resend key or send", async () => {
      const response = await invoke();
      assert.equal(response.status, 200);
      assert.equal(rateCalls.length, 1);
      assert.equal(rateCalls[0]._bucket, `agreement-review:${tenant}:${actor}`);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      assert.equal(response.headers.get("vary"), "Authorization");
      const wire = await response.text(), data = JSON.parse(wire);
      assert.equal(data.ok, true);
      assert.equal(data.review.kind, "prepared_signature_request_review");
      assert.equal(data.review.approval, "not_requested");
      assert.equal(data.review.execution, "unavailable");
      assert(!wire.includes("credentials_vault_ref") && !wire.includes("content_storage_key"));
      assert.deepEqual(effects(x.f), before);
    });
    await t.step("original read door lists verified current-business sender choices without messaging", async () => {
      const response = await invoke(listInput(x), "?review=senders");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      const data = await response.json();
      assert.equal(data.review.kind, "prepared_signature_sender_choices");
      assert.equal(data.review.provider_execution_verified, false);
      assert.equal(rateCalls.length, 2);
      assert.equal(rateCalls[1]._bucket, `agreement-review:${tenant}:${actor}`);
      assert.deepEqual(data.review.senders, [{ connector_id: connectorId, from_address: x.state.connector.from_address,
        state: "ready", reason: null }]);
      assert.deepEqual(effects(x.f), before);
    });
    await t.step("sender lookup failure remains unavailable instead of falsely reporting no connection", async () => {
      x.state.readError = true;
      try { const response = await invoke(listInput(x), "?review=senders");
        assert.equal(response.status, 503);
        const text = await response.text();
        assert(text.includes("sender_choices_unverified") && !text.includes("private provider detail"));
      } finally { x.state.readError = false; }
    });
    await t.step("foreign business is refused before private source reads", async () => {
      const reads = x.f.calls.source;
      const response = await invoke({ ...x.input, review: { ...x.input.review, tenant_id: operation } });
      assert.equal(response.status, 403);
      assert.equal(x.f.calls.source, reads);
    });
    await t.step("missing ordinary role cannot read prepared source", async () => {
      x.f.state.admin = false;
      const reads = x.f.calls.source;
      try { assert.equal((await invoke()).status, 403); assert.equal(x.f.calls.source, reads); }
      finally { x.f.state.admin = true; }
    });
    await t.step("anonymous identity cannot use a nominal admin result", async () => {
      x.f.state.anonymous = true;
      try { assert.equal((await invoke()).status, 403); }
      finally { x.f.state.anonymous = false; }
    });
    await t.step("existing fail-closed read limit returns a retryable refusal", async () => {
      limited = true;
      const reads = x.f.calls.source;
      try { assert.equal((await invoke()).status, 429); assert.equal(x.f.calls.source, reads); }
      finally { limited = false; }
    });
    await t.step("unavailable review limiter fails closed without private reads or sends", async () => {
      limitUnavailable = true;
      const reads = x.f.calls.source;
      try {
        const response = await invoke();
        assert.equal(response.status, 429);
        assert.equal(x.f.calls.source, reads);
        assert(!(await response.text()).includes("private limiter fault"));
      } finally { limitUnavailable = false; }
    });
    await t.step("legacy send keeps its workspace cap before source, rendering, minting or mailing", async () => {
      legacyProviderConfigured = true; limited = true;
      const reads = x.f.calls.source, calls = rateCalls.length;
      try {
        const response = await invoke({ agreementId: x.input.review.agreement_id }, "");
        assert.equal(response.status, 429);
        assert.equal(x.f.calls.source, reads);
        assert.equal(rateCalls.length, calls + 1);
        assert.deepEqual(rateCalls.at(-1), { _bucket: `agreement-send:${tenant}`, _max: 20, _window_seconds: 3600 });
        assert.deepEqual(unexpected, []);
        assert.deepEqual(effects(x.f), before);
      } finally { legacyProviderConfigured = false; limited = false; }
    });
    await t.step("cross-door token and duplicate mode never fall through to legacy sending", async () => {
      assert.equal((await invoke(x.input, "?review=prepared-request&token=forbidden")).status, 400);
      assert.equal((await invoke(x.input, "?review=prepared-request&review=prepared-request")).status, 400);
    });
    await t.step("review uses the original bounded JSON parser", async () => {
      assert.equal((await invoke(x.input, "?review=prepared-request", { "Content-Type": "text/plain" })).status, 400);
      const response = await handler(new Request("https://request-review.invalid/agreement-send?review=prepared-request",
        { method: "POST", headers: { Authorization: "Bearer synthetic-owner", "Content-Type": "application/json" },
          body: " ".repeat(1048577) + "{}" }));
      assert.equal(response.status, 400);
    });
    await t.step("no caller credential cannot reach original authority reads", async () => {
      assert.equal((await invoke(x.input, "?review=prepared-request", { Authorization: "" })).status, 401);
    });
    await t.step("the original private read rechecks the exact reviewed request without admitting a send", async () => {
      const initial = await invoke();
      assert.equal(initial.status, 200);
      const original = await initial.json();
      const exact = { ...x.input, expected_request_sha256: original.review.request_sha256 };
      const verified = await invoke(exact);
      assert.equal(verified.status, 200, "The original review door must consume complete-request preflight");
      const current = await verified.json();
      assert.deepEqual(current, original);
      assert.equal(current.review.approval, "not_requested");
      assert.equal(current.review.execution, "unavailable");
      try {
        x.input.messages[0].subject = "A different valid invitation";
        const changed = await invoke(exact);
        assert.equal(changed.status, 409);
        assert.equal((await changed.json()).code, "source_changed");
        assert.deepEqual(effects(x.f), before);
        assert.deepEqual(unexpected, []);
      } finally { x.input.messages[0].subject = exact.messages[0].subject = "Please review your service agreement"; }
    });
    assert.deepEqual(unexpected, []);
    assert.deepEqual(effects(x.f), before);
  } finally {
    Deno.serve = previousServe; Deno.env.get = previousEnv; globalThis.fetch = previousFetch;
  }
});

const senderChoices = () => {
  const fn = (candidate as unknown as { readPreparedSignatureSenders?: ReviewBuilder }).readPreparedSignatureSenders;
  assert.equal(typeof fn, "function", "Missing original agreement sender choices");
  return fn!;
};
const listInput = (x: Awaited<ReturnType<typeof requestSeed>>) => ({
  operation_id: x.input.operation_id, review: x.input.review,
  expected_review_sha256: x.input.expected_review_sha256,
});
Deno.test("sender choices preserve exact saved source, use canonical email policy and perform no effects", async () => {
  const x = await requestSeed(), before = effects(x.f);
  const result = await senderChoices()(listInput(x), x.f.caller, x.f.service, actor, x.emailPorts) as unknown as Record<string, unknown>;
  assert.equal(result.kind, "prepared_signature_sender_choices");
  assert.equal(result.review_sha256, x.packet.review_sha256);
  assert.deepEqual(result.senders, [{ connector_id: connectorId, from_address: x.state.connector.from_address,
    state: "ready", reason: null }]);
  assert.equal(result.provider_execution_verified, false);
  assert.equal(result.approval, "not_requested");
  assert.equal(result.execution, "unavailable");
  assert.deepEqual(effects(x.f), before);
  assert.deepEqual(x.state.preSendCalls, []);
  assert.equal(x.state.identityReads, 0);
});
Deno.test("sender choices distinguish truly empty from unreadable and unconfigured", async () => {
  const x = await requestSeed(), read = () => senderChoices()(listInput(x), x.f.caller, x.f.service, actor, x.emailPorts) as unknown as Promise<Record<string, unknown>>;
  x.state.connector.active = false;
  assert.deepEqual((await read()).senders, []);
  x.state.connector.active = true; x.state.configured = false;
  assert.deepEqual((await read()).senders, [{ connector_id: connectorId, from_address: x.state.connector.from_address,
    state: "needs_setup", reason: "EMAIL_PROVIDER_NOT_CONFIGURED" }]);
  x.state.readError = true;
  await assert.rejects(read(), refuses("SENDER_CHOICES_UNVERIFIED"));
});
Deno.test("sender choices do not expose another person's private mailbox", async () => {
  const x = await requestSeed();
  x.state.connector.mailbox_class = "personal"; x.state.connector.mailbox_owner_user_id = operation;
  const result = await senderChoices()(listInput(x), x.f.caller, x.f.service, actor, x.emailPorts) as unknown as Record<string, unknown>;
  assert.deepEqual(result.senders, []);
  assert(!JSON.stringify(result).includes(x.state.connector.from_address));
});
Deno.test("sender choices recheck actual actor after the final private read", async () => {
  const x = await requestSeed();
  x.state.onConnectorRead = read => { if (read === 4) x.f.state.admin = false; };
  await assert.rejects(senderChoices()(listInput(x), x.f.caller, x.f.service, actor, x.emailPorts));
});
Deno.test("sender choices refuse a connector changed during the list without adopting its new identity", async () => {
  const x = await requestSeed();
  x.state.onConnectorRead = read => { if (read === 3) x.state.connector.from_address = "changed@studio.example.test"; };
  await assert.rejects(senderChoices()(listInput(x), x.f.caller, x.f.service, actor, x.emailPorts), refuses("SENDER_CHANGED"));
});
Deno.test("sender choices reject forged tenant and sender inputs before private reads", async () => {
  const x = await requestSeed(), before = x.state.reads.length;
  await assert.rejects(senderChoices()(x.input, x.f.caller, x.f.service, actor, x.emailPorts), refuses("INVALID_REQUEST"));
  assert.equal(x.state.reads.length, before);
});
