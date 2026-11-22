import assert from "node:assert/strict";
import { prepareProtectedSoloOwner } from "./solo-beta-prepare-protected-owner.ts";

const reference = "6d3144a8-7603-4db3-9709-8d0df788f9c0";
const owner = "5976ed4b-d93b-4d5b-b71b-168abbd489e0";
const email = "owner@example.invalid";

Deno.test("an authoritative existing owner is rebound without creating a second Auth user", async () => {
  const result = await prepareProtectedSoloOwner(reference, {
    read: () => Promise.resolve({ primaryEmail: email, ownerUserId: owner, emailVerified: false, signedCheckout: true }),
    create: () => { throw new Error("cannot create a duplicate identity"); },
    bind: (id) => { assert.equal(id, owner); return Promise.resolve(true); },
  });
  assert.deepEqual(result, { ok: true, emailVerified: false });
});

Deno.test("requires protected authority before contacting Auth", async () => {
  const result = await prepareProtectedSoloOwner(reference, {
    read: () => Promise.resolve(null),
    create: () => { throw new Error("unauthorized"); },
    bind: () => { throw new Error("unauthorized"); },
  });
  assert.deepEqual(result, { ok: false, code: "owner_preparation_unavailable" });
});

Deno.test("a recorded Stripe trial alone cannot create or bind an Auth owner", async () => {
  let authCalls = 0;
  const result = await prepareProtectedSoloOwner(reference, {
    read: () => Promise.resolve({ primaryEmail: email, ownerUserId: null, emailVerified: false, signedCheckout: false }),
    create: async () => { authCalls++; },
    bind: async () => { authCalls++; return true; },
  });
  assert.deepEqual(result, { ok: false, code: "owner_preparation_unavailable" });
  assert.equal(authCalls, 0);
});

Deno.test("recovers a lost Auth response without returning user identity or a session", async () => {
  let persisted: string | null = null;
  let creates = 0;
  const result = await prepareProtectedSoloOwner(reference, {
    read: () => Promise.resolve({ primaryEmail: email, ownerUserId: persisted, emailVerified: false, signedCheckout: true }),
    create: (input) => {
      creates++;
      assert.deepEqual(input, { email, email_confirm: false, app_metadata: { solo_beta_protected_reference: reference } });
      persisted = owner;
      throw new Error("lost response");
    },
    bind: (id) => { assert.equal(id, owner); return Promise.resolve(true); },
  });
  assert.equal(creates, 1);
  assert.deepEqual(result, { ok: true, emailVerified: false });
});
