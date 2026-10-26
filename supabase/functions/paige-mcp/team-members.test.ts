// EXP08 stage 0 — MCP `list_team_members` lists the connection's OWN workspace only.
//
//   deno test --allow-read=supabase/functions --node-modules-dir=none --deny-net \
//     supabase/functions/paige-mcp/team-members.test.ts
//
// It used to return every person on the platform from the global `user_roles` table to any
// connection holding `admin.read` (auto-granted to a workspace owner/admin connection). A recording
// client stands in for the service-role client; ids are fictional.

import assert from "node:assert/strict";
import { listWorkspaceTeam } from "./team-members.ts";

const TENANT_A = "aaaaaaaa-1111-4111-8111-11111111111a";
const TENANT_B = "bbbbbbbb-2222-4222-8222-22222222222b";

type Row = Record<string, unknown>;
const SEATS: Row[] = [
  { tenant_id: TENANT_A, user_id: "u-a-owner", role: "owner", status: "active", job_title: "Founder", joined_at: "2026-01-01" },
  { tenant_id: TENANT_A, user_id: "u-a-member", role: "member", status: "suspended", job_title: null, joined_at: "2026-02-01" },
  { tenant_id: TENANT_A, user_id: "u-a-gone", role: "admin", status: "archived", job_title: null, joined_at: "2026-03-01" },
  { tenant_id: TENANT_B, user_id: "u-b-owner", role: "owner", status: "active", job_title: null, joined_at: "2026-01-05" },
];
const PROFILES: Row[] = [
  { user_id: "u-a-owner", full_name: "Avery Example", suspended_at: null },
  { user_id: "u-a-member", full_name: "Blake Example", suspended_at: null },
  { user_id: "u-b-owner", full_name: "Casey Example", suspended_at: null },
];

function recordingClient(failOn?: string) {
  const tables: string[] = [];
  const filters: Array<[string, string, unknown]> = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const src = table === "tenant_members" ? SEATS : table === "profiles" ? PROFILES : [];
      let rows = [...src];
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => (filters.push([table, `eq:${c}`, v]), rows = rows.filter((r) => r[c] === v), b),
        in: (c: string, v: unknown[]) => (filters.push([table, `in:${c}`, v]), rows = rows.filter((r) => v.includes(r[c])), b),
        order: () => b,
        limit: (n: number) => (rows = rows.slice(0, n), b),
        then: (res: (v: unknown) => void) =>
          res(failOn === table ? { data: null, error: { message: `${table} failed` } } : { data: rows, error: null }),
      };
      return b;
    },
  };
  return { client, tables, filters };
}

Deno.test("lists only the resolved workspace's current seats, never user_roles", async () => {
  const { client, tables, filters } = recordingClient();
  const r = await listWorkspaceTeam(client, TENANT_A, {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.items.map((i) => i.user_id), ["u-a-owner", "u-a-member"]);
  assert.equal(r.items.some((i) => i.user_id === "u-b-owner"), false, "another workspace's people never appear");
  assert.equal(tables.includes("user_roles"), false);
  assert.deepEqual(filters.find((f) => f[1] === "eq:tenant_id"), ["tenant_members", "eq:tenant_id", TENANT_A]);
  assert.equal(r.items.find((i) => i.user_id === "u-a-member")?.suspended, true);
  assert.equal(r.items.find((i) => i.user_id === "u-a-owner")?.full_name, "Avery Example");
});

Deno.test("no resolved workspace is a refusal, with no read", async () => {
  const { client, tables } = recordingClient();
  assert.deepEqual(await listWorkspaceTeam(client, null, {}), { ok: false, error: "tenant_not_resolved" });
  assert.deepEqual(tables, []);
});

Deno.test("role filters on the seat role; a non-seat role returns nothing and says why", async () => {
  const { client } = recordingClient();
  const owners = await listWorkspaceTeam(client, TENANT_A, { role: "owner" });
  assert.ok(owners.ok && owners.items.length === 1 && owners.items[0].role === "owner");
  const { client: c2, tables } = recordingClient();
  const bad = await listWorkspaceTeam(c2, TENANT_A, { role: "super_admin" });
  assert.ok(bad.ok && bad.items.length === 0 && /role must be one of/.test(bad.note ?? ""));
  assert.deepEqual(tables, []);
});

Deno.test("a read error is reported, never an empty team", async () => {
  const { client } = recordingClient("tenant_members");
  assert.deepEqual(await listWorkspaceTeam(client, TENANT_A, {}), { ok: false, error: "tenant_members failed" });
  const { client: c2 } = recordingClient("profiles");
  assert.deepEqual(await listWorkspaceTeam(c2, TENANT_A, {}), { ok: false, error: "profiles failed" });
});

Deno.test("the MCP tool resolves the workspace server-side and delegates to this helper", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const start = src.indexOf('mcp.tool("list_team_members", {');
  const end = src.indexOf('mcp.tool("assign_coach", {');
  const tool = src.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(tool, /listWorkspaceTeam\(admin, await actorTenantId\(\), args\)/);
  assert.doesNotMatch(tool, /user_roles/);
});
