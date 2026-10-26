// EXP08 stage 0 — who may approve-and-act on an approval (execute-approval/admission.ts).
//
//   deno test --allow-import --allow-env --allow-read=supabase/functions --node-modules-dir=none \
//     --deny-net supabase/functions/execute-approval/admission_test.ts
//
// Owner ruling 2026-10-26: being owner/admin of one business never gives admin power in another. The
// door used to admit the GLOBAL `admin` row (written for an owner/admin seat in ANY workspace) plus ANY
// active seat in the approval's workspace — so X, owner of A and a plain member of B, could execute
// B's approvals. These drive the REAL resolveWorkspaceAuthorityAs over a fake service client whose
// answers depend on the workspace asked about, and the handler source is checked to be wired to it.

import assert from "node:assert/strict";
import { approvalAdmission, isApprovalOperator } from "./admission.ts";

const X = "0e0e0e0e-1111-4111-8111-111111111111";
const A = "1a1a1a1a-2222-4222-8222-222222222222";
const B = "1b1b1b1b-2222-4222-8222-222222222222";
const CHILD = "1c1c1c1c-2222-4222-8222-222222222222";

type Seat = { tenant: string; role: string; status: string };
function fakeService(o: {
  seats?: Seat[]; roles?: string[]; agencyChildren?: string[]; fail?: string; operator?: boolean | "error";
} = {}) {
  const asked: Array<{ name: string; args: Record<string, unknown> }> = [];
  const seats = o.seats ?? [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      asked.push({ name, args });
      if (o.fail === name) return { data: null, error: { message: "boom" } };
      if (name === "is_tenant_admin_as") {
        return { data: seats.some((s) => s.tenant === args._tenant && s.status === "active" && ["owner", "admin"].includes(s.role)), error: null };
      }
      if (name === "agency_can_manage_child") return { data: (o.agencyChildren ?? []).includes(args._child as string), error: null };
      if (name === "is_platform_owner") {
        return o.operator === "error" ? { data: null, error: { message: "boom" } } : { data: o.operator === true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters[k] = v; return q; },
        maybeSingle: async () => {
          if (o.fail === table) return { data: null, error: { message: "boom" } };
          const s = seats.find((x) => x.tenant === filters.tenant_id && x.status === filters.status);
          return { data: s ? { role: s.role, status: s.status } : null, error: null };
        },
        then: (ok: (v: unknown) => unknown) => {
          if (o.fail === table) return Promise.resolve({ data: null, error: { message: "boom" } }).then(ok);
          return Promise.resolve({ data: (o.roles ?? []).map((role) => ({ role })), error: null }).then(ok);
        },
      };
      return q;
    },
  };
  return { client, asked };
}

// X: owner of A (so production also gave X the global `admin` row), plain member of B.
const xSeats: Seat[] = [{ tenant: A, role: "owner", status: "active" }, { tenant: B, role: "member", status: "active" }];

Deno.test("X, owner of A and member of B, is refused B's approval despite the global admin row", async () => {
  const { client } = fakeService({ seats: xSeats, roles: ["admin"] });
  assert.equal(await approvalAdmission(client, X, B, false), "refuse");
});

Deno.test("X is admitted to A's approval (full power inside their own business)", async () => {
  const { client, asked } = fakeService({ seats: xSeats, roles: ["admin"] });
  assert.equal(await approvalAdmission(client, X, A, false), "admit");
  assert.ok(asked.some((c) => c.name === "is_tenant_admin_as" && c.args._tenant === A && c.args._actor === X));
  assert.equal(asked.some((c) => c.name === "has_role"), false, "the global admin row is never asked");
});

Deno.test("an admin seat admits; a member, suspended or missing seat refuses", async () => {
  for (const [seat, want] of [
    [{ tenant: A, role: "admin", status: "active" }, "admit"],
    [{ tenant: A, role: "member", status: "active" }, "refuse"],
    [{ tenant: A, role: "owner", status: "suspended" }, "refuse"],
  ] as Array<[Seat, string]>) {
    const { client } = fakeService({ seats: [seat], roles: ["admin"] });
    assert.equal(await approvalAdmission(client, X, A, false), want, JSON.stringify(seat));
  }
  const { client } = fakeService({ roles: ["admin"] });
  assert.equal(await approvalAdmission(client, X, A, false), "refuse");
});

Deno.test("the agency managing a child workspace is admitted there", async () => {
  const { client } = fakeService({ agencyChildren: [CHILD] });
  assert.equal(await approvalAdmission(client, X, CHILD, false), "admit");
});

Deno.test("the Platform Operator is admitted anywhere, including an approval with no workspace", async () => {
  const { client } = fakeService();
  assert.equal(await approvalAdmission(client, X, B, true), "admit");
  assert.equal(await approvalAdmission(client, X, null, true), "admit");
  const sa = fakeService({ roles: ["super_admin"] });
  assert.equal(await approvalAdmission(sa.client, X, B, false), "admit", "super_admin read through the resolver");
});

Deno.test("an approval with no (or a malformed) workspace is refused to everyone but the operator", async () => {
  const { client, asked } = fakeService({ seats: xSeats, roles: ["admin"] });
  for (const t of [null, undefined, "", "not-a-uuid"]) assert.equal(await approvalAdmission(client, X, t, false), "refuse");
  assert.equal(asked.length, 0);
});

Deno.test("an authority read failure is 'unavailable', never a guessed admit or refuse", async () => {
  for (const fail of ["is_tenant_admin_as", "agency_can_manage_child", "user_roles", "tenant_members"]) {
    const { client } = fakeService({ seats: xSeats, roles: ["admin"], fail });
    assert.equal(await approvalAdmission(client, X, A, false), "unavailable", fail);
  }
});

Deno.test("isApprovalOperator asks is_platform_owner for the caller and fails closed", async () => {
  const yes = fakeService({ operator: true });
  assert.equal(await isApprovalOperator(yes.client, X), true);
  assert.deepEqual(yes.asked[0], { name: "is_platform_owner", args: { _user_id: X } });
  assert.equal(await isApprovalOperator(fakeService({ operator: false }).client, X), false);
  assert.equal(await isApprovalOperator(fakeService({ operator: "error" }).client, X), false);
});

Deno.test("the handler admits through admission.ts and no longer reads the global admin row", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert.match(src, /import \{ approvalAdmission, isApprovalOperator \} from "\.\/admission\.ts";/);
  assert.doesNotMatch(src, /has_role/);
  assert.doesNotMatch(src, /legacyAdmin/);
  const admitted = src.indexOf("const admission = await approvalAdmission(admin, user.id, approval.tenant_id, operator);");
  assert.ok(admitted > 0, "admission is asked about the approval's own workspace");
  assert.ok(admitted < src.indexOf(".update({ claimed_at: claimAt"), "admission runs before the claim");
  assert.match(src, /if \(admission === "unavailable"\) return json\(503/);
});
