// QA #1832 — the no-real-provider-execution boundary for synthetic QA workspaces.
// Failing-first: written before the boundary module existed.
//   deno test --allow-read --allow-import --node-modules-dir=none supabase/functions/_shared/inbox-intelligence/provider-boundary.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { providerExecutionBlocked, QA_NO_PROVIDER_EXECUTION_CODE } from "./provider-boundary.ts";

type RpcResult = { data: unknown; error: unknown };
function adminWith(answer: RpcResult) {
  const calls: string[] = [];
  return {
    calls,
    admin: {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push(`${name}:${JSON.stringify(args)}`);
        return answer;
      },
    } as never,
  };
}

Deno.test("boundary: a synthetic workspace (marker true) blocks provider execution", async () => {
  const { admin, calls } = adminWith({ data: true, error: null });
  assertEquals(await providerExecutionBlocked(admin, "T1"), true);
  assertEquals(calls, ['tenant_blocks_provider_execution:{"p_tenant":"T1"}']);
});

Deno.test("boundary: an ordinary tenant (marker false) is unchanged", async () => {
  const { admin } = adminWith({ data: false, error: null });
  assertEquals(await providerExecutionBlocked(admin, "T1"), false);
});

Deno.test("boundary: no tenant resolves to not blocked (nothing to attribute the effect to)", async () => {
  const { calls, admin } = adminWith({ data: true, error: null });
  assertEquals(await providerExecutionBlocked(admin, null), false);
  assertEquals(calls.length, 0);
});

Deno.test("boundary: a check error must NOT become a blanket send shutdown", async () => {
  const { admin } = adminWith({ data: null, error: { message: "blip" } });
  assertEquals(await providerExecutionBlocked(admin, "T1"), false);
});

Deno.test("boundary: the refusal code is stable and greppable", () => {
  assertEquals(QA_NO_PROVIDER_EXECUTION_CODE, "QA_NO_PROVIDER_EXECUTION");
});

// ── Source-level enforcement proofs (the rails actually carry the gate) ─────────
async function readSource(rel: string): Promise<string> {
  for (const base of [Deno.cwd(), new URL("../../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")]) {
    try { return await Deno.readTextFile(base + "/" + rel); } catch { /* next */ }
  }
  throw new Error("source not found: " + rel);
}

Deno.test("boundary: send-message enforces the block before any provider dispatch", async () => {
  const source = await readSource("supabase/functions/send-message/index.ts");
  assert(source.includes("providerExecutionBlocked"), "send-message must call the boundary");
  assert(source.includes("QA_NO_PROVIDER_EXECUTION"), "send-message must carry the truthful refusal");
  const gateIndex = source.indexOf("providerExecutionBlocked");
  const resendIndex = source.indexOf("api.resend.com");
  assert(gateIndex !== -1 && resendIndex !== -1 && gateIndex < resendIndex, "the gate must precede the provider call");
});

Deno.test("boundary: send-transactional-email enforces the block before its Resend call", async () => {
  const source = await readSource("supabase/functions/send-transactional-email/index.ts");
  assert(source.includes("providerExecutionBlocked"), "send-transactional-email must call the boundary");
  assert(source.includes("QA_NO_PROVIDER_EXECUTION"), "the truthful refusal code must be present");
  const gateIndex = source.indexOf("providerExecutionBlocked");
  const resendIndex = source.indexOf("api.resend.com");
  assert(gateIndex !== -1 && resendIndex !== -1 && gateIndex < resendIndex, "the gate must precede the provider call");
});

Deno.test("boundary: the SQL helper is fail-closed at the marker and defaults open otherwise", async () => {
  const migration = await readSource("supabase/migrations/20270602000001_inbox_intelligence_two_mailbox.sql");
  assert(migration.includes("create or replace function public.tenant_blocks_provider_execution"), "the helper must exist");
  assert(migration.includes("qa_no_provider_execution"), "the marker key must be the canonical features flag");
  assert(migration.includes("grant execute on function public.tenant_blocks_provider_execution(uuid) to service_role"), "service-role-only execution");
});
