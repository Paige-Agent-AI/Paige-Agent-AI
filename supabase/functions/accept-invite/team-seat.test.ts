// accept-invite — what accepting a team invitation writes, and in which order (EXP08 lifecycle, B3).
//
// Drives the REAL team-seat.ts against a recording fake of the service-role client. The fake keeps
// the two tables the path writes and plays the database's own rules on them, as production has them:
//   - the consent trigger's rule (1): a service-role write never lifts 'suspended' to 'active';
//   - rule 1b: a role change on a suspended seat raises 42501 and changes nothing;
//   - sync_tenant_member_to_user_roles: an active seat grants its mapped global role, a suspended
//     non-owner seat holds none.
// So "a suspended member never ends up holding global admin" is an assertion over what the fake
// database holds after the real calls, not over a reading of the source.
//
// Run: deno test --allow-import=deno.land --node-modules-dir=none --deny-net --deny-env --deny-read \
//        --deny-write --deny-run --deny-ffi --deny-sys supabase/functions/accept-invite/team-seat.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkTeamSeat, grantTeamSeat, landedTenantRole, type ExistingSeat } from "./team-seat.ts";

const TENANT = "20000000-0000-4000-8000-00000000000a";
const PERSON = "10000000-0000-4000-8000-000000000053";
const ACTIVE_ADMIN = "10000000-0000-4000-8000-000000000051";
const NOW = "2026-10-26T12:00:00.000Z";

type Seat = { id: string; tenant_id: string; user_id: string; role: string; status: string; is_owner: boolean };
type Role = { id: string; user_id: string; role: string };
type Call = { table: string; op: string; args: unknown[] };

interface Db {
  tenant_members: Seat[];
  user_roles: Role[];
  calls: Call[];
  /** Injected failures by "<table>.<op>" (op: select, upsert, delete, update). Nth = 1-based. */
  fail: Record<string, { message: string; code?: string; nth?: number }>;
  counts: Record<string, number>;
  /** Runs after the Nth successful write of "<table>.<op>": a concurrent act landing in between. */
  after: Record<string, { nth: number; run: (db: Db) => void }>;
  /** A database rule that lands a written seat in another status than asked (as rule (1) does). */
  holdSeatAs?: string;
}

function db(seats: Partial<Seat>[] = [], roles: Partial<Role>[] = []): Db {
  return {
    tenant_members: seats.map((s, i) => ({
      id: `seat-${i}`, tenant_id: TENANT, user_id: PERSON, role: "member", status: "active", is_owner: false, ...s,
    })),
    user_roles: roles.map((r, i) => ({ id: `role-${i}`, user_id: PERSON, role: "user", ...r })),
    calls: [],
    fail: {},
    counts: {},
    after: {},
  };
}

const mapped = (tenantRole: string): string | null =>
  ({ owner: "admin", admin: "admin", member: "user", coach: "user" } as Record<string, string>)[tenantRole] ?? null;

function grantRole(d: Db, user: string, role: string) {
  if (!d.user_roles.some((r) => r.user_id === user && r.role === role)) {
    d.user_roles.push({ id: `role-${d.user_roles.length}-${role}`, user_id: user, role });
  }
}
function dropRole(d: Db, user: string, role: string | null) {
  if (!role || role === "user") return;
  const stillGranted = d.tenant_members.some((s) => s.user_id === user && s.status === "active" && mapped(s.role) === role);
  if (!stillGranted) d.user_roles = d.user_roles.filter((r) => !(r.user_id === user && r.role === role));
}
/** sync_tenant_member_to_user_roles, reduced to the cases this path reaches. */
function syncSeat(d: Db, before: Seat | null, after: Seat | null) {
  if (after && after.status === "active") {
    const m = mapped(after.role);
    if (m) grantRole(d, after.user_id, m);
  }
  if (before && (!after || before.role !== after.role || after.status !== "active")) {
    dropRole(d, before.user_id, mapped(before.role));
  }
  if (after && after.status === "suspended" && !after.is_owner) dropRole(d, after.user_id, mapped(after.role));
}

class Query {
  private filters: [string, unknown][] = [];
  private op = "select";
  private payload: Record<string, unknown> | null = null;
  private returning = false;
  constructor(private d: Db, private table: "tenant_members" | "user_roles") {}
  select(_cols: string) { if (this.op === "select") this.op = "select"; else this.returning = true; return this; }
  upsert(row: Record<string, unknown>, _o: unknown) { this.op = "upsert"; this.payload = row; return this; }
  update(row: Record<string, unknown>) { this.op = "update"; this.payload = row; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, val: unknown) { this.filters.push([col, val]); return this; }
  maybeSingle() { return this.run(); }
  single() { return this.run(); }
  then<T>(ok: (v: { data: unknown; error: unknown }) => T, bad?: (e: unknown) => T) { return this.run().then(ok, bad); }

  private rows(): Record<string, unknown>[] {
    return (this.d[this.table] as unknown as Record<string, unknown>[])
      .filter((r) => this.filters.every(([c, v]) => r[c] === v));
  }

  private run(): Promise<{ data: unknown; error: unknown }> {
    const key = `${this.table}.${this.op}`;
    this.d.calls.push({ table: this.table, op: this.op, args: [this.payload, [...this.filters]] });
    this.d.counts[key] = (this.d.counts[key] ?? 0) + 1;
    const f = this.d.fail[key];
    if (f && (!f.nth || f.nth === this.d.counts[key])) return Promise.resolve({ data: null, error: { message: f.message, code: f.code } });
    const out = this.apply();
    if (out.error) return Promise.resolve(out);
    const a = this.d.after[key];
    if (a && a.nth === this.d.counts[key]) a.run(this.d);
    return Promise.resolve(out);
  }

  private apply(): { data: unknown; error: unknown } {
    const d = this.d;
    if (this.op === "select") { const r = this.rows()[0]; return { data: r ? { ...r } : null, error: null }; }
    if (this.table === "user_roles") {
      if (this.op === "upsert") { grantRole(d, String(this.payload!.user_id), String(this.payload!.role)); return { data: null, error: null }; }
      if (this.op === "delete") { const keep = new Set(this.rows()); d.user_roles = d.user_roles.filter((r) => !keep.has(r)); return { data: null, error: null }; }
    }
    if (this.op === "upsert") {
      const p = this.payload as Record<string, unknown>;
      const old = d.tenant_members.find((s) => s.tenant_id === p.tenant_id && s.user_id === p.user_id) ?? null;
      if (!old) {
        const row: Seat = {
          id: "seat-new", tenant_id: String(p.tenant_id), user_id: String(p.user_id), role: String(p.role),
          status: d.holdSeatAs ?? String(p.status), is_owner: false,
        };
        d.tenant_members.push(row);
        syncSeat(d, null, row);
        return { data: this.returning ? { ...row } : null, error: null };
      }
      const next: Seat = { ...old, role: String(p.role), status: String(p.status) };
      if (old.status === "suspended" && next.status === "active") next.status = "suspended"; // rule (1)
      if (old.status === "suspended" && next.role !== old.role) {                           // rule 1b
        return { data: null, error: { code: "42501", message: "only the workspace owner can change a suspended teammate's role or seat; nothing was changed" } };
      }
      const before = { ...old };
      Object.assign(old, next);
      syncSeat(d, before, old);
      return { data: this.returning ? { ...old } : null, error: null };
    }
    if (this.op === "update") {
      for (const s of this.rows() as Seat[]) { const before = { ...s }; Object.assign(s, this.payload); syncSeat(d, before, s); }
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      for (const s of this.rows() as Seat[]) { d.tenant_members = d.tenant_members.filter((x) => x !== s); syncSeat(d, s, null); }
      return { data: null, error: null };
    }
    throw new Error(`fake: unsupported ${this.table}.${this.op}`);
  }
}

const client = (d: Db) => ({ from: (t: string) => new Query(d, t as "tenant_members" | "user_roles") });
const has = (d: Db, user: string, role: string) => d.user_roles.some((r) => r.user_id === user && r.role === role);
const seat = (d: Db, user = PERSON) => d.tenant_members.find((s) => s.tenant_id === TENANT && s.user_id === user);
const writes = (d: Db) => d.calls.filter((c) => c.op !== "select");

async function accept(d: Db, appRole = "admin", tenantId: string | null = TENANT) {
  const c = client(d);
  const check = await checkTeamSeat(c, { userId: PERSON, tenantId });
  if (!check.ok) return check;
  return grantTeamSeat(c, {
    userId: PERSON, tenantId, appRole, invitedRole: appRole === "admin" ? "admin" : "member",
    invitedAt: NOW, nowIso: NOW, existing: check.existing,
  });
}

Deno.test("B3: a suspended member with an admin invitation is refused 409 before any write, and holds no global admin", async () => {
  const d = db([{ role: "member", status: "suspended" }], [{ role: "user" }]);
  const r = await accept(d, "admin");
  assertEquals(r.ok, false);
  if (r.ok) return;
  assertEquals([r.status, r.code], [409, "seat_not_active"]);
  assert(r.error.includes("on hold") && r.error.includes("reinstate"));
  assertEquals(writes(d), []);
  assertEquals(has(d, PERSON, "admin"), false);
  assertEquals(seat(d)!.status, "suspended");
});

Deno.test("B3 control: a suspended ADMIN (no role change) is refused too; the edge no longer writes to a held seat", async () => {
  const d = db([{ role: "admin", status: "suspended" }], [{ role: "user" }]);
  const r = await accept(d, "admin");
  assertEquals(r.ok ? 0 : r.status, 409);
  assertEquals(writes(d), []);
  assertEquals(has(d, PERSON, "admin"), false);
});

for (const status of ["pending", "revoked", "archived"]) {
  Deno.test(`a ${status} seat is refused 409 with nothing written`, async () => {
    const d = db([{ role: "member", status }]);
    const r = await accept(d, "sales_rep");
    assertEquals(r.ok ? 0 : r.status, 409);
    if (!r.ok) assert(r.error.includes("isn't active"));
    assertEquals(writes(d), []);
  });
}

Deno.test("a new person: the seat is written FIRST, then the global role; both land", async () => {
  const d = db();
  const r = await accept(d, "admin");
  assertEquals(r.ok, true);
  const w = writes(d).map((c) => `${c.table}.${c.op}`);
  assertEquals(w, ["tenant_members.upsert", "user_roles.upsert"]);
  assertEquals([seat(d)!.status, seat(d)!.role], ["active", "admin"]);
  assertEquals(has(d, PERSON, "admin"), true);
});

Deno.test("a new person with a staff role gets a member seat and that global role", async () => {
  const d = db();
  const r = await accept(d, "sales_rep");
  assertEquals(r.ok, true);
  assertEquals(seat(d)!.role, "member");
  assertEquals(has(d, PERSON, "sales_rep"), true);
});

Deno.test("an already-active member accepting an admin invitation is raised to admin", async () => {
  const d = db([{ role: "member", status: "active" }], [{ role: "user" }]);
  const r = await accept(d, "admin");
  assertEquals(r.ok, true);
  assertEquals(seat(d)!.role, "admin");
  assertEquals(has(d, PERSON, "admin"), true);
});

Deno.test("an already-active admin accepting a staff invitation is never lowered, and its seat is not rewritten", async () => {
  const d = db([{ role: "admin", status: "active" }], [{ role: "admin" }]);
  const r = await accept(d, "cs_rep");
  assertEquals(r.ok, true);
  assertEquals(seat(d)!.role, "admin");
  assertEquals(writes(d).map((c) => `${c.table}.${c.op}`), ["user_roles.upsert"]);
  assertEquals(has(d, PERSON, "cs_rep"), true);
});

Deno.test("an active owner's seat is never rewritten by an invitation", async () => {
  const d = db([{ role: "owner", status: "active", is_owner: true }], [{ role: "admin" }]);
  const r = await accept(d, "admin");
  assertEquals(r.ok, true);
  assertEquals([seat(d)!.role, seat(d)!.is_owner], ["owner", true]);
  assert(!writes(d).some((c) => c.table === "tenant_members"));
});

Deno.test("no workspace on the invitation: only the global role is written, and its failure is reported", async () => {
  const d = db();
  assertEquals((await accept(d, "user", null)).ok, true);
  assertEquals(has(d, PERSON, "user"), true);
  const e = db();
  e.fail["user_roles.upsert"] = { message: "boom" };
  const r = await accept(e, "user", null);
  assertEquals(r.ok ? 0 : r.status, 500);
});

Deno.test("the seat check failing to read refuses 500 with nothing written", async () => {
  const d = db();
  d.fail["tenant_members.select"] = { message: "timeout" };
  const r = await accept(d, "admin");
  assertEquals(r.ok ? "" : r.code, "seat_check_failed");
  assertEquals(writes(d), []);
});

Deno.test("race: the seat is suspended between the check and the seat write; 1b refuses it, the role is never written", async () => {
  const d = db([{ role: "member", status: "active" }], [{ role: "user" }]);
  const c = client(d);
  const check = await checkTeamSeat(c, { userId: PERSON, tenantId: TENANT });
  assert(check.ok);
  seat(d)!.status = "suspended"; // an owner's suspension lands
  const r = await grantTeamSeat(c, {
    userId: PERSON, tenantId: TENANT, appRole: "admin", invitedRole: "admin", invitedAt: NOW, nowIso: NOW,
    existing: check.ok ? check.existing : null,
  });
  assertEquals(r.ok ? 0 : r.status, 409);
  assert(!r.ok && r.error.includes("on hold"));
  assertEquals(d.calls.filter((x) => x.table === "user_roles" && x.op === "upsert").length, 0);
  assertEquals(has(d, PERSON, "admin"), false);
});

Deno.test("race: a suspension lands between the seat write and the role write; the role this call added is taken back", async () => {
  const d = db([{ role: "member", status: "active" }], [{ role: "user" }]);
  // The suspension lands after the seat write; its sync strips the mapped admin, then the edge's
  // own role write would put it back if nothing read the seat again.
  d.after["tenant_members.upsert"] = { nth: 1, run: (x) => { const s = seat(x)!; const b = { ...s }; s.status = "suspended"; syncSeat(x, b, s); } };
  const r = await accept(d, "admin");
  assertEquals(r.ok ? 0 : r.status, 409);
  assertEquals(has(d, PERSON, "admin"), false);
});

Deno.test("a seat the database lands as anything but active is refused, and the role is never written", async () => {
  const d = db();
  d.holdSeatAs = "pending";
  const r = await accept(d, "admin");
  assertEquals(r.ok ? 0 : r.status, 409);
  assertEquals(d.calls.filter((x) => x.table === "user_roles" && x.op === "upsert").length, 0);
  assertEquals(has(d, PERSON, "admin"), false);
});

Deno.test("the seat write failing (not a refusal) reports 500 and never writes the role", async () => {
  const d = db();
  d.fail["tenant_members.upsert"] = { message: "connection reset" };
  const r = await accept(d, "admin");
  assertEquals(r.ok ? "" : r.code, "seat_write_failed");
  assertEquals(d.calls.filter((x) => x.table === "user_roles" && x.op === "upsert").length, 0);
  assertEquals(has(d, PERSON, "admin"), false);
});

Deno.test("another membership guard (42501 on an active seat) is a 403, not 'on hold'", async () => {
  const d = db();
  d.fail["tenant_members.upsert"] = { message: "archived workspace", code: "42501" };
  const r = await accept(d, "admin");
  assertEquals(r.ok ? 0 : r.status, 403);
});

Deno.test("the role write failing undoes a seat this call created", async () => {
  const d = db();
  d.fail["user_roles.upsert"] = { message: "boom" };
  const r = await accept(d, "sales_rep");
  assertEquals(r.ok ? "" : r.code, "role_write_failed");
  assertEquals(seat(d), undefined);
});

Deno.test("the role write failing puts back the role this call raised on an existing seat", async () => {
  const d = db([{ role: "member", status: "active" }], [{ role: "user" }]);
  d.fail["user_roles.upsert"] = { message: "boom" };
  const r = await accept(d, "admin");
  assertEquals(r.ok ? "" : r.code, "role_write_failed");
  assertEquals(seat(d)!.role, "member");
  assertEquals(has(d, PERSON, "admin"), false);
});

Deno.test("the role write failing and the undo failing says so (partial), never 'unchanged'", async () => {
  const d = db();
  d.fail["user_roles.upsert"] = { message: "boom" };
  d.fail["tenant_members.delete"] = { message: "boom" };
  const r = await accept(d, "admin");
  assertEquals(r.ok ? "" : r.code, "partial_accept");
});

Deno.test("an unreadable seat after the writes is reported, and nothing is taken back on a guess", async () => {
  const d = db();
  d.fail["tenant_members.select"] = { message: "timeout", nth: 2 };
  const r = await accept(d, "admin");
  assertEquals(r.ok ? "" : r.code, "seat_readback_failed");
  assertEquals(has(d, PERSON, "admin"), true);
});

Deno.test("landedTenantRole: never lower than the seat already is", () => {
  const s = (role: ExistingSeat["role"], is_owner = false): ExistingSeat => ({ id: "x", status: "active", role, is_owner });
  assertEquals(landedTenantRole("admin", null), "admin");
  assertEquals(landedTenantRole("member", null), "member");
  assertEquals(landedTenantRole("member", s("admin")), "admin");
  assertEquals(landedTenantRole("admin", s("member")), "admin");
  assertEquals(landedTenantRole("admin", s("owner", true)), "owner");
  assertEquals(landedTenantRole("member", s("member", true)), "member");
});

// X7's precondition, at the edge: whatever invitation a suspended member holds, an ACTIVE admin of
// the same workspace is untouched by accepting it.
Deno.test("X7 at the edge: a suspended member's accept touches no other seat", async () => {
  const d = db([{ role: "member", status: "suspended" }, { user_id: ACTIVE_ADMIN, role: "admin", status: "active" }]);
  await accept(d, "admin");
  assertEquals(seat(d, ACTIVE_ADMIN)!.role, "admin");
  assertEquals(writes(d), []);
});
