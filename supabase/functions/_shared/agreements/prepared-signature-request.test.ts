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
