import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commsProviderExecutionAllowed } from "./comms-provider-boundary.ts";
describe("provider execution authority floor", () => {
  for (const data of [false, null, undefined, "true", 1, [], { allowed: true }]) {
    it(`does not invoke provider for non-true RPC result ${JSON.stringify(data)}`, async () => {
      let effects = 0;
      if (await commsProviderExecutionAllowed({ rpc: async () => ({ data, error: null }) }, { tenantId: "tenant" })) effects++;
      assert.equal(effects, 0);
    });
  }
  it("preserves payload and invokes ordinary allowed provider exactly once", async () => {
    const payload = { to: "recipient@example.test", subject: "unchanged" };
    const effects: unknown[] = [];
    let args: unknown;
    const allowed = await commsProviderExecutionAllowed({ rpc: async (_name, input) => { args = input; return { data: true, error: null }; } }, { tenantId: "tenant", actorUserId: "actor", recipientEmail: payload.to });
    if (allowed) effects.push(payload);
    assert.deepEqual(effects, [payload]);
    assert.deepEqual(args, { _tenant_id: "tenant", _actor_user_id: "actor", _recipient_email: payload.to });
  });
  it("refuses RPC errors and exceptions even with a true data value", async () => {
    assert.equal(await commsProviderExecutionAllowed({ rpc: async () => ({ data: true, error: new Error("unavailable") }) }, { tenantId: "tenant" }), false);
    assert.equal(await commsProviderExecutionAllowed({ rpc: async () => { throw new Error("network"); } }, { tenantId: "tenant" }), false);
  });
  it("refuses absent scope before requesting server permission", async () => {
    let calls = 0;
    assert.equal(await commsProviderExecutionAllowed({ rpc: async () => { calls++; return { data: true, error: null }; } }, {}), false);
    assert.equal(calls, 0);
  });
});

