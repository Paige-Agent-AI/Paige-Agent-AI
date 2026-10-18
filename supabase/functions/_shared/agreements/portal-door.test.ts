// deno test --allow-import --node-modules-dir=none --deny-net --deny-env --deny-read supabase/functions/_shared/agreements/portal-door.test.ts
//
// agreement-document door three, driven with injected clients: no network, no environment, no files.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { isPortalDoorRequest, resolvePortalDocument } from "./portal-door.ts";

const AGREEMENT = "a6090000-0000-4000-8000-000000000004";
const TENANT = "a0900000-0000-4000-8000-000000000001";
const OTHER_TENANT = "a0900000-0000-4000-8000-000000000002";
const USER = "0a090000-0000-4000-8000-000000000002";

type Call = { kind: string; name?: string; args?: unknown };

function harness(over: {
  users?: Array<string | null>;
  userError?: unknown;
  scope?: { data: unknown; error: unknown };
  row?: { data: unknown; error: unknown };
} = {}) {
  const calls: Call[] = [];
  const users = [...(over.users ?? [USER, USER])];
  const caller = {
    auth: {
      getUser: () => {
        calls.push({ kind: "getUser" });
        const id = users.length ? users.shift()! : USER;
        return Promise.resolve({ data: { user: id ? { id } : null }, error: over.userError ?? null });
      },
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ kind: "rpc", name, args });
      return Promise.resolve(over.scope ?? { data: { agreement_id: AGREEMENT, tenant_id: TENANT, title: "Synthetic agreement 4" }, error: null });
    },
  };
  const service = {
    from: (table: string) => {
      calls.push({ kind: "from", name: table });
      return {
        select: (columns: string) => {
          calls.push({ kind: "select", args: columns });
          const filters: Array<[string, unknown]> = [];
          const step = (c: string, v: unknown) => { filters.push([c, v]); calls.push({ kind: "eq", args: [c, v] }); };
          return {
            eq: (c1: string, v1: unknown) => { step(c1, v1); return {
              eq: (c2: string, v2: unknown) => { step(c2, v2); return {
                eq: (c3: string, v3: unknown) => { step(c3, v3); return {
                  maybeSingle: () => Promise.resolve(over.row ?? {
                    data: { id: AGREEMENT, title: "Synthetic agreement 4", status: "completed", sealed_storage_key: "tenant/sealed-4.pdf" },
                    error: null,
                  }),
                }; },
              }; },
            }; },
          };
        },
      };
    },
  };
  return { calls, caller, service };
}

const params = (q: Record<string, string>) => new URLSearchParams({ portal: "1", agreementId: AGREEMENT, ...q });
const AUTH = "Bearer customer-session";

Deno.test("door three is addressed only by portal=1", () => {
  assert(isPortalDoorRequest(new URLSearchParams("portal=1&agreementId=x")));
  assert(!isPortalDoorRequest(new URLSearchParams("agreementId=x")));
  assert(!isPortalDoorRequest(new URLSearchParams("portal=true&agreementId=x")));
  assert(!isPortalDoorRequest(new URLSearchParams("token=abc")));
});

Deno.test("a signed-in customer gets their own sealed copy, inline by default", async () => {
  const h = harness();
  const out = await resolvePortalDocument(params({}), AUTH, h.caller, h.service);
  assertEquals(out, { sealedKey: "tenant/sealed-4.pdf", title: "Synthetic agreement 4", disposition: "inline" });
});

Deno.test("download=1 asks for an attachment", async () => {
  const h = harness();
  const out = await resolvePortalDocument(params({ download: "1" }), AUTH, h.caller, h.service);
  assertEquals(out?.disposition, "attachment");
});

Deno.test("the JWT is required: no Authorization, no call at all", async () => {
  const h = harness();
  assertEquals(await resolvePortalDocument(params({}), "", h.caller, h.service), null);
  assertEquals(h.calls, []);
});

Deno.test("a malformed agreement or tenant id is refused before any call", async () => {
  for (const q of [{ agreementId: "not-a-uuid" }, { agreementId: "" }, { tenantId: "x" }] as Array<Record<string, string>>) {
    const h = harness();
    assertEquals(await resolvePortalDocument(params(q), AUTH, h.caller, h.service), null);
    assertEquals(h.calls, []);
  }
});

Deno.test("no user on the session: refused, the scope is never asked", async () => {
  const h = harness({ users: [null] });
  assertEquals(await resolvePortalDocument(params({}), AUTH, h.caller, h.service), null);
  assertEquals(h.calls.map((c) => c.kind), ["getUser"]);
});

Deno.test("the scope RPC is called with the CALLER client and only the request's two ids", async () => {
  const h = harness();
  await resolvePortalDocument(params({}), AUTH, h.caller, h.service);
  assertEquals(h.calls.filter((c) => c.kind === "rpc"), [{
    kind: "rpc", name: "client_portal_agreement_document_scope", args: { p_agreement_id: AGREEMENT, p_tenant_id: null },
  }]);
  const h2 = harness();
  await resolvePortalDocument(params({ tenantId: TENANT }), AUTH, h2.caller, h2.service);
  assertEquals(h2.calls.find((c) => c.kind === "rpc")?.args, { p_agreement_id: AGREEMENT, p_tenant_id: TENANT });
});

Deno.test("a refused scope reads nothing with the service role", async () => {
  for (const scope of [
    { data: null, error: { code: "42501", message: "CLIENT_AGREEMENT_UNAVAILABLE" } },
    { data: null, error: null },
    { data: [], error: null },
    { data: "x", error: null },
  ]) {
    const h = harness({ scope });
    assertEquals(await resolvePortalDocument(params({}), AUTH, h.caller, h.service), null);
    assert(!h.calls.some((c) => c.kind === "from"));
  }
});

Deno.test("a scope answer with any extra key, or a different agreement, is refused", async () => {
  for (const data of [
    { agreement_id: AGREEMENT, tenant_id: TENANT, title: "t", sealed_storage_key: "k" },
    { agreement_id: AGREEMENT, tenant_id: TENANT },
    { agreement_id: "a6090000-0000-4000-8000-000000000002", tenant_id: TENANT, title: "t" },
    { agreement_id: AGREEMENT, tenant_id: "not-a-uuid", title: "t" },
  ]) {
    const h = harness({ scope: { data, error: null } });
    assertEquals(await resolvePortalDocument(params({}), AUTH, h.caller, h.service), null);
    assert(!h.calls.some((c) => c.kind === "from"));
  }
});

Deno.test("a forged tenantId for another business is refused", async () => {
  const h = harness();
  assertEquals(await resolvePortalDocument(params({ tenantId: OTHER_TENANT }), AUTH, h.caller, h.service), null);
  assert(!h.calls.some((c) => c.kind === "from"));
});

Deno.test("the session must be the same person after the scope read", async () => {
  for (const users of [[USER, "0a090000-0000-4000-8000-000000000099"], [USER, null]]) {
    const h = harness({ users });
    assertEquals(await resolvePortalDocument(params({}), AUTH, h.caller, h.service), null);
    assert(!h.calls.some((c) => c.kind === "from"));
  }
});

Deno.test("the service read is one literal select, filtered to the scoped id, business and completed", async () => {
  const h = harness();
  await resolvePortalDocument(params({}), AUTH, h.caller, h.service);
  assertEquals(h.calls.filter((c) => ["from", "select", "eq"].includes(c.kind)), [
    { kind: "from", name: "paige_agreements" },
    { kind: "select", args: "id,title,status,sealed_storage_key" },
    { kind: "eq", args: ["id", AGREEMENT] },
    { kind: "eq", args: ["tenant_id", TENANT] },
    { kind: "eq", args: ["status", "completed"] },
  ]);
  assertEquals(h.calls.map((c) => c.kind).filter((k) => k === "getUser").length, 2);
});

Deno.test("no row, a non-completed row, or a row without a sealed key is refused", async () => {
  for (const row of [
    { data: null, error: null },
    { data: null, error: { message: "boom" } },
    { data: { id: AGREEMENT, title: "t", status: "sent", sealed_storage_key: "k" }, error: null },
    { data: { id: AGREEMENT, title: "t", status: "completed", sealed_storage_key: null }, error: null },
    { data: { id: "a6090000-0000-4000-8000-000000000002", title: "t", status: "completed", sealed_storage_key: "k" }, error: null },
  ]) {
    const h = harness({ row });
    assertEquals(await resolvePortalDocument(params({}), AUTH, h.caller, h.service), null);
  }
});
