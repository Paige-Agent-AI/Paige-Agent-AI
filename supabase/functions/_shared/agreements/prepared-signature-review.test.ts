import assert from "node:assert/strict";
import * as candidate from "./prepared-signature-review.ts";
import type {
  PreparedSignatureReview,
  PreparedSignatureReviewIntent,
} from "./prepared-signature-review.ts";
import {
  executeOwnerPreparation,
  type OwnerPreparationCaller,
  type OwnerPreparationService,
  readOwnerPreparationPdf,
  reviewOwnerCommercialPreparation,
} from "./owner-preparation.ts";
import {
  actor,
  agreement,
  at,
  client,
  commercialFixture,
  field,
  fixture,
  next,
  prepare,
  save,
  signer,
  tenant,
} from "./test-fixtures/owner-preparation.ts";

type Reader = (
  intent: unknown,
  caller: OwnerPreparationCaller,
  service: OwnerPreparationService,
) => Promise<PreparedSignatureReview>;
const reader = () => {
  const fn = (candidate as unknown as { readPreparedSignatureReview?: Reader })
    .readPreparedSignatureReview;
  assert.equal(
    typeof fn,
    "function",
    "Missing original prepared-signature review integration",
  );
  return fn!;
};
const refuses = (code: string) => (error: unknown) =>
  error instanceof candidate.PreparedSignatureReviewUnavailable &&
  error.code === code;
async function seeded(fields: unknown[] = [field()]) {
  const f = await fixture();
  await executeOwnerPreparation(prepare(), f.caller, f.service);
  await executeOwnerPreparation(save(fields), f.caller, f.service);
  const intent: PreparedSignatureReviewIntent = {
    tenant_id: tenant,
    agreement_id: agreement,
    preparation_id: next,
    preparation_sha256: String(f.rows.get(next)!.preparation_sha256),
    expected_source: { client_id: client, version: 1, updated_at: at },
  };
  return { f, intent };
}
const effects = (f: Awaited<ReturnType<typeof fixture>>) => ({
  writes: f.calls.write,
  uploads: f.calls.upload,
  rows: f.rows.size,
  objects: f.objects.size,
});

Deno.test("original selected preparation really renders and retains a verified PDF before the new review is exercised", async () => {
  const { f } = await seeded(), before = effects(f);
  const pdf = await readOwnerPreparationPdf(
    tenant,
    agreement,
    next,
    f.caller,
    f.service,
  );
  assert.equal(new TextDecoder().decode(pdf.bytes.subarray(0, 5)), "%PDF-");
  assert.match(pdf.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(effects(f), before);
});
Deno.test("review reuses original native readers and exact PDF without creating any operation, approval, link or send", async () => {
  const { f, intent } = await seeded(),
    before = effects(f),
    review = await reader()(intent, f.caller, f.service);
  assert.equal(review.kind, "prepared_signature_review");
  assert.deepEqual(review.request, intent);
  assert.equal(review.ready_for_review, true);
  assert.deepEqual(review.issues, []);
  assert.equal(review.document.sha256, f.rows.get(next)!.document_sha256);
  assert.equal(review.document.page_count, 1);
  assert.equal(review.signers[0].id, signer);
  assert.equal(review.signers[0].email, f.parties[0].email);
  assert.equal(review.request.expected_source.updated_at, at);
  assert.equal(review.approval, "not_requested");
  assert.equal(review.sending, "not_connected");
  assert.match(review.review_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(effects(f), before);
  assert(f.calls.download > 0);
  assert(!JSON.stringify(review).includes("content_storage_key"));
  assert(!JSON.stringify(review).includes("token"));
});
Deno.test("identical source reviews keep their digest and return an immutable reviewed snapshot", async () => {
  const { f, intent } = await seeded(),
    first = await reader()(intent, f.caller, f.service),
    again = await reader()(intent, f.caller, f.service);
  assert.equal(first.review_sha256, again.review_sha256);
  assert(Object.isFrozen(first));
  assert(Object.isFrozen(first.request));
  assert(Object.isFrozen(first.request.expected_source));
  assert(Object.isFrozen(first.signers));
  assert(Object.isFrozen(first.signers[0]));
});
Deno.test("partial field work is honestly unready and cannot manufacture missing signature placement", async () => {
  const { f, intent } = await seeded([]),
    review = await reader()(intent, f.caller, f.service);
  assert.equal(review.ready_for_review, false);
  assert(
    review.issues.some((issue) =>
      issue.code === "missing_signature" && issue.signer_id === signer
    ),
  );
  assert.equal(review.approval, "not_requested");
});
Deno.test("overlapping assigned fields remain a genuine correction requirement", async () => {
  const { f, intent } = await seeded([
      field(),
      field("22222222-0000-4000-8000-000000000002"),
    ]),
    review = await reader()(intent, f.caller, f.service);
  assert.equal(review.ready_for_review, false);
  assert(review.issues.some((issue) => issue.code === "overlapping_fields"));
  assert(Object.isFrozen(review.issues));
  for (const issue of review.issues) {
    assert(Object.isFrozen(issue));
    if (issue.code === "overlapping_fields") {
      assert(Object.isFrozen(issue.field_ids));
    }
  }
});
for (
  const change of [
    "client",
    "version",
    "timestamp",
    "preparation digest",
  ] as const
) {
  Deno.test(
    "refuses changed expected " + change +
      " instead of reviewing a different original record",
    async () => {
      const { f, intent } = await seeded(),
        bad = structuredClone(intent),
        before = effects(f);
      if (change === "client") {
        bad.expected_source.client_id = "dddddddd-0000-4000-8000-000000000002";
      }
      if (change === "version") bad.expected_source.version++;
      if (change === "timestamp") {
        bad.expected_source.updated_at = "2026-10-22T12:00:00.123Z";
      }
      if (change === "preparation digest") {
        bad.preparation_sha256 = "f".repeat(64);
      }
      await assert.rejects(
        () => reader()(bad, f.caller, f.service),
        refuses("SOURCE_CHANGED"),
      );
      assert.deepEqual(effects(f), before);
    },
  );
}
for (
  const key of ["actor_user_id", "approved", "signers", "manifest"] as const
) {
  Deno.test(
    "refuses request-authored " + key +
      " before reading or selecting authority",
    async () => {
      const { f, intent } = await seeded(), before = structuredClone(f.calls);
      await assert.rejects(
        () => reader()({ ...intent, [key]: actor }, f.caller, f.service),
        refuses("INVALID_REQUEST"),
      );
      assert.deepEqual(f.calls, before);
    },
  );
}
Deno.test("retired historical preparation remains inspectable history but is not the selected signing source", async () => {
  const { f, intent } = await seeded();
  await executeOwnerPreparation(
    {
      ...save(),
      request_id: "11111111-0000-4000-8000-000000000003",
      source_preparation_id: next,
    },
    f.caller,
    f.service,
  );
  const before = effects(f);
  await assert.rejects(
    () => reader()(intent, f.caller, f.service),
    refuses("SOURCE_CHANGED"),
  );
  assert.deepEqual(effects(f), before);
});
for (const change of ["actor", "workspace", "signer identity"] as const) {
  Deno.test(
    "retires the review when " + change + " changes during the actual PDF read",
    async () => {
      const { f, intent } = await seeded(), before = effects(f);
      f.state.onDownload = () => {
        if (change === "actor") {
          f.state.actor = "cccccccc-0000-4000-8000-000000000002";
        } else if (change === "workspace") {
          f.state.activeTenant = "aaaaaaaa-0000-4000-8000-000000000002";
        } else f.parties[0].email = "changed@example.test";
      };
      await assert.rejects(
        () => reader()(intent, f.caller, f.service),
        refuses(
          change === "signer identity" ? "SOURCE_CHANGED" : "ACCESS_UNVERIFIED",
        ),
      );
      assert.deepEqual(effects(f), before);
    },
  );
}
Deno.test("captures the initial actor across separate original-reader calls, rather than accepting another valid owner", async () => {
  const { f, intent } = await seeded(),
    get = f.caller.auth.getUser.bind(f.caller.auth);
  let reads = 0;
  f.caller.auth.getUser = async function () {
    if (++reads === 2) f.state.actor = "cccccccc-0000-4000-8000-000000000002";
    return await get();
  };
  await assert.rejects(
    () => reader()(intent, f.caller, f.service),
    refuses("ACCESS_UNVERIFIED"),
  );
});
Deno.test("corrupt private PDF never becomes a verified signing review", async () => {
  const { f, intent } = await seeded(), before = effects(f);
  f.state.corrupt = true;
  await assert.rejects(
    () => reader()(intent, f.caller, f.service),
    refuses("DOCUMENT_UNVERIFIED"),
  );
  assert.deepEqual(effects(f), before);
});
Deno.test("captures caller intent before awaits so edits cannot combine source revisions", async () => {
  const { f, intent } = await seeded(),
    original = structuredClone(intent),
    get = f.caller.auth.getUser.bind(f.caller.auth);
  let release!: () => void, first = true;
  f.caller.auth.getUser = async function () {
    assert.equal(this, f.caller.auth);
    if (first) {
      first = false;
      await new Promise<void>((resolve) => release = resolve);
    }
    return await get();
  };
  const work = reader()(intent, f.caller, f.service);
  intent.expected_source.version = 999;
  intent.preparation_sha256 = "f".repeat(64);
  release();
  const review = await work;
  assert.deepEqual(review.request, original);
});
Deno.test("commercial review preserves the original reviewed economics source and refuses a later changed obligation", async () => {
  const f = await commercialFixture(),
    commercial = await reviewOwnerCommercialPreparation(
      tenant,
      agreement,
      f.commercial.invoiceId,
      f.caller,
      f.service,
    );
  await executeOwnerPreparation(
    {
      ...prepare(),
      action: "prepare_commercial_document",
      invoice_id: f.commercial.invoiceId,
      commercial_payload_digest: commercial.payload_digest,
    },
    f.caller,
    f.service,
  );
  await executeOwnerPreparation(save(), f.caller, f.service);
  const intent = {
      tenant_id: tenant,
      agreement_id: agreement,
      preparation_id: next,
      preparation_sha256: String(f.rows.get(next)!.preparation_sha256),
      expected_source: { client_id: client, version: 1, updated_at: at },
    },
    before = effects(f);
  const review = await reader()(intent, f.caller, f.service);
  assert.equal(review.ready_for_review, true);
  assert.deepEqual(effects(f), before);
  f.commercial.terms.starts_on = "2026-10-23";
  await assert.rejects(
    () => reader()(intent, f.caller, f.service),
    refuses("SOURCE_CHANGED"),
  );
  assert.deepEqual(effects(f), before);
});
for (const change of ["profile", "admin"] as const) {
  Deno.test(
    "the original native " + change +
      " floor remains authoritative after PDF work",
    async () => {
      const { f, intent } = await seeded(), before = effects(f);
      f.state.onDownload = () => {
        f.state[change] = false;
      };
      await assert.rejects(
        () => reader()(intent, f.caller, f.service),
        refuses("ACCESS_UNVERIFIED"),
      );
      assert.deepEqual(effects(f), before);
    },
  );
}
Deno.test("an anonymous actor cannot borrow a synthetic owner membership or read private preparation data", async () => {
  const { f, intent } = await seeded(), before = structuredClone(f.calls);
  f.state.anonymous = true;
  await assert.rejects(
    () => reader()(intent, f.caller, f.service),
    refuses("ACCESS_UNVERIFIED"),
  );
  assert.deepEqual(f.calls, before);
});
Deno.test("missing signers stay missing instead of inventing a recipient or signing order", async () => {
  const f = await fixture();
  f.parties.length = 0;
  await executeOwnerPreparation(prepare(), f.caller, f.service);
  await executeOwnerPreparation(save([]), f.caller, f.service);
  const intent = {
      tenant_id: tenant,
      agreement_id: agreement,
      preparation_id: next,
      preparation_sha256: String(f.rows.get(next)!.preparation_sha256),
      expected_source: { client_id: client, version: 1, updated_at: at },
    },
    before = effects(f);
  const review = await reader()(intent, f.caller, f.service);
  assert.equal(review.ready_for_review, false);
  assert.deepEqual(review.signers, []);
  assert(review.issues.some((issue) => issue.code === "missing_signer"));
  assert.deepEqual(effects(f), before);
});
for (const order of [1, 2]) {
  Deno.test(
    "preserves original " + (order === 1 ? "parallel" : "sequential") +
      " signing roles and order without renumbering",
    async () => {
      const f = await fixture(),
        second = "eeeeeeee-0000-4000-8000-000000000002";
      f.parties.push({
        id: second,
        full_name: "Controlled Business Signer",
        email: "business@example.test",
        signer_role: "tenant_signatory",
        signing_order: order,
        status: "pending",
        signed_at: null,
        declined_at: null,
      });
      await executeOwnerPreparation(prepare(), f.caller, f.service);
      await executeOwnerPreparation(
        save([field(), {
          ...field("22222222-0000-4000-8000-000000000002"),
          signer_id: second,
          y: 145,
        }]),
        f.caller,
        f.service,
      );
      const intent = {
          tenant_id: tenant,
          agreement_id: agreement,
          preparation_id: next,
          preparation_sha256: String(f.rows.get(next)!.preparation_sha256),
          expected_source: { client_id: client, version: 1, updated_at: at },
        },
        before = effects(f),
        review = await reader()(intent, f.caller, f.service);
      assert.equal(review.ready_for_review, true);
      assert.deepEqual(review.signers.map((p) => p.signing_order), [1, order]);
      assert.deepEqual(
        review.signers.map((p) => p.signer_role),
        ["counterparty", "tenant_signatory"],
      );
      assert.deepEqual(effects(f), before);
    },
  );
}
