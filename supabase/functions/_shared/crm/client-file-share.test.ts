// E09 Documents: crm_file_document's routing and the share executor it calls.
// deno test --allow-read=supabase/functions --node-modules-dir=none supabase/functions/_shared/crm/client-file-share.test.ts (CI: ci.yml)
import assert from "node:assert/strict";
import { refileClientDocument, routeFileDocument, shareClientFile, type ClientFileRefileCaller, type ClientFileShareCaller } from "./client-file-share.ts";

const ACTOR = "e0941000-0000-4000-8000-000000000001";
const TENANT = "e0942000-0000-4000-8000-000000000001";
const FORGED_TENANT = "e0942000-0000-4000-8000-000000000002";
const CONTACT = "e0943000-0000-4000-8000-000000000002";
const OTHER_CONTACT = "e0943000-0000-4000-8000-000000000003";
const FILE = "e0944000-0000-4000-8000-000000000021";
const VERSION = "2027-01-01T00:00:00+00:00";
const NEW_VERSION = "2027-01-02T00:00:00.123456+00:00";

type Call = { name: string; args: Record<string, unknown> };
function caller(opts: {
  reply?: { data: unknown; error: unknown } | (() => never);
  row?: Record<string, unknown> | null;
} = {}): { caller: ClientFileShareCaller; calls: Call[]; reads: Array<[string, string]> } {
  const calls: Call[] = [], reads: Array<[string, string]> = [];
  return {
    calls, reads,
    caller: {
      rpc: (name, args) => {
        calls.push({ name, args });
        if (typeof opts.reply === "function") return opts.reply();
        return Promise.resolve(opts.reply ?? { data: { ok: true, replayed: false, file_id: FILE, shared: true,
          shared_at: NEW_VERSION, updated_at: NEW_VERSION, portal_connected: true }, error: null });
      },
      readFile: (fileId, tenantId) => {
        reads.push([fileId, tenantId]);
        return Promise.resolve({ data: opts.row === undefined
          ? { id: FILE, tenant_id: TENANT, visibility: "shared", shared_at: NEW_VERSION, updated_at: NEW_VERSION }
          : opts.row, error: null });
      },
    },
  };
}
const share = (c: ClientFileShareCaller, over: Record<string, unknown> = {}) => shareClientFile({
  caller: c, expectedActorId: ACTOR, expectedTenantId: TENANT, fileId: FILE, shared: true, expectedUpdatedAt: VERSION, ...over,
} as Parameters<typeof shareClientFile>[0]);

Deno.test("a visibility-only change on the same client routes to the share writer", () => {
  assert.equal(routeFileDocument({ id: FILE, contact_id: CONTACT, visibility: "internal" }, CONTACT, undefined), "share");
  assert.equal(routeFileDocument({ id: FILE, contact_id: CONTACT, visibility: "shared" }, CONTACT.toUpperCase(), ""), "share");
});

Deno.test("re-filing onto another client, or rewriting the description, stays on the direct path", () => {
  assert.equal(routeFileDocument({ id: FILE, contact_id: CONTACT, visibility: "internal" }, OTHER_CONTACT, undefined), "refile");
  assert.equal(routeFileDocument({ id: FILE, contact_id: CONTACT, visibility: "internal" }, CONTACT, "Signed scope"), "refile");
});

Deno.test("a client's own upload is refused on every route", () => {
  assert.equal(routeFileDocument({ id: FILE, contact_id: CONTACT, visibility: "client_upload" }, CONTACT, undefined), "refuse_client_upload");
  assert.equal(routeFileDocument({ id: FILE, contact_id: CONTACT, visibility: "client_upload" }, OTHER_CONTACT, "x"), "refuse_client_upload");
});

Deno.test("the share writer gets the version that was read, the verified actor and the server tenant", async () => {
  const c = caller();
  const r = await share(c.caller);
  assert.equal(r.success, true);
  assert.deepEqual(c.calls, [{ name: "client_file_set_client_share", args: {
    p_expected_actor_id: ACTOR, p_expected_tenant_id: TENANT, p_file_id: FILE, p_shared: true, p_expected_updated_at: VERSION } }]);
  assert.deepEqual(c.reads, [[FILE, TENANT]]);
  if (r.success) {
    assert.equal(r.sharedAt, NEW_VERSION);
    assert.equal(r.updatedAt, NEW_VERSION);
    assert.equal(r.portalConnected, true);
    assert.equal(r.replayed, false);
  }
});

Deno.test("a forged tenant_id in the model's arguments never reaches the writer", async () => {
  // The executor has no args input at all; the only tenant it can send is the server-resolved one.
  const c = caller();
  await shareClientFile({ caller: c.caller, expectedActorId: ACTOR, expectedTenantId: TENANT, fileId: FILE, shared: true,
    expectedUpdatedAt: VERSION, ...({ tenant_id: FORGED_TENANT, p_expected_tenant_id: FORGED_TENANT } as Record<string, unknown>) } as Parameters<typeof shareClientFile>[0]);
  assert.equal(c.calls[0].args.p_expected_tenant_id, TENANT);
  assert.ok(!JSON.stringify(c.calls).includes(FORGED_TENANT));
  // And the chat dispatch hands it the persona tenant and the verified user, never an argument.
  const chat = await Deno.readTextFile(new URL("../../paige-ai-chat/index.ts", import.meta.url));
  const branch = chat.slice(chat.indexOf('routeFileDocument(docRow, docContactId, args.description) === "share"'));
  const call = branch.slice(0, branch.indexOf("});") + 3);
  assert.match(call, /expectedActorId: user\.id,/);
  assert.match(call, /expectedTenantId: crmTenantId,/);
  assert.match(call, /expectedUpdatedAt: docRow\.updated_at,/);
  assert.doesNotMatch(call, /args\.tenant_id|args\.p_expected/);
});

Deno.test("no workspace or a malformed request sends nothing", async () => {
  for (const over of [{ expectedTenantId: null }, { expectedActorId: "not-a-uuid" }, { fileId: "x" }, { shared: "yes" }, { expectedUpdatedAt: null }]) {
    const c = caller();
    const r = await share(c.caller, over);
    assert.equal(r.success, false);
    assert.equal(c.calls.length, 0);
    if (!r.success) assert.equal(r.writeAttempted, false);
  }
});

Deno.test("named refusals map to plain reasons and are never 'unknown'", async () => {
  const cases: Array<[string, string]> = [["FILE_NOT_FOUND", "not_found"], ["FILE_IS_CLIENT_UPLOAD", "client_upload"],
    ["FILE_NOT_READY", "not_ready"], ["CONTACT_NOT_FOUND", "client_not_found"], ["CLIENT_FILES_UNAVAILABLE", "not_for_account"],
    ["INVALID_REQUEST", "bad_request"], ["SOMETHING_NEW", "refused"]];
  for (const [code, reason] of cases) {
    const r = await share(caller({ reply: { data: { ok: false, error: code }, error: null } }).caller);
    assert.equal(r.success, false);
    if (!r.success) { assert.equal(r.reason, reason); assert.equal(r.writeAttempted, false); }
  }
  const stale = await share(caller({ reply: { data: { ok: false, error: "FILE_CHANGED", updated_at: NEW_VERSION }, error: null } }).caller);
  assert.equal(stale.success, false);
  if (!stale.success) { assert.equal(stale.reason, "changed"); assert.equal(stale.currentUpdatedAt, NEW_VERSION); }
});

Deno.test("an answered SQL refusal is not applied; a transport failure is unknown", async () => {
  const scope = await share(caller({ reply: { data: null, error: { code: "42501", message: "FILE_SCOPE_CHANGED" } } }).caller);
  assert.equal(scope.success, false);
  if (!scope.success) { assert.equal(scope.reason, "scope_changed"); assert.equal(scope.writeAttempted, false); }
  const gateway = await share(caller({ reply: { data: null, error: { message: "upstream timeout" } } }).caller);
  if (!gateway.success) { assert.equal(gateway.reason, "outcome_unknown"); assert.equal(gateway.writeAttempted, true); }
  const thrown = await share(caller({ reply: () => { throw new Error("network"); } }).caller);
  if (!thrown.success) { assert.equal(thrown.reason, "outcome_unknown"); assert.equal(thrown.writeAttempted, true); }
});

Deno.test("success is reported only when the stored row agrees", async () => {
  for (const row of [null, { id: FILE, tenant_id: TENANT, visibility: "internal", shared_at: null, updated_at: NEW_VERSION },
    { id: FILE, tenant_id: FORGED_TENANT, visibility: "shared", shared_at: NEW_VERSION, updated_at: NEW_VERSION },
    { id: FILE, tenant_id: TENANT, visibility: "shared", shared_at: null, updated_at: NEW_VERSION },
    { id: FILE, tenant_id: TENANT, visibility: "internal", shared_at: NEW_VERSION, updated_at: NEW_VERSION }]) {
    const r = await share(caller({ row }).caller);
    assert.equal(r.success, false, JSON.stringify(row));
    if (!r.success) assert.equal(r.reason, "outcome_unknown");
  }
  const mismatched = await share(caller({ reply: { data: { ok: true, replayed: false, file_id: FILE, shared: false }, error: null } }).caller);
  assert.equal(mismatched.success, false);
});

Deno.test("unsharing is verified against an unshared row", async () => {
  const r = await share(caller({
    reply: { data: { ok: true, replayed: true, file_id: FILE, shared: false, shared_at: null, updated_at: VERSION, portal_connected: false }, error: null },
    row: { id: FILE, tenant_id: TENANT, visibility: "internal", shared_at: null, updated_at: VERSION },
  }).caller, { shared: false });
  assert.equal(r.success, true);
  if (r.success) { assert.equal(r.replayed, true); assert.equal(r.sharedAt, null); assert.equal(r.portalConnected, false); }
});

// ── Re-filing (round 2): the direct write never touches visibility; any change that ends shared or
// unshared goes through the share writer at the version the move produced. A file moved to another
// client arrives private (the database trigger), so "move and share" is move, then share.
type Move = { fileId: string; tenantId: string; patch: Record<string, unknown> };
function refiler(opts: {
  moved?: { data: unknown; error: unknown } | (() => never);
  share?: { data: unknown; error: unknown };
  row?: Record<string, unknown> | null;
} = {}) {
  const base = caller({ reply: opts.share, row: opts.row });
  const moves: Move[] = [];
  const c: ClientFileRefileCaller = {
    ...base.caller,
    moveFile: (fileId, tenantId, patch) => {
      moves.push({ fileId, tenantId, patch: { ...patch } });
      if (typeof opts.moved === "function") return opts.moved();
      return Promise.resolve(opts.moved ?? { data: { id: FILE, contact_id: OTHER_CONTACT, visibility: "internal", updated_at: NEW_VERSION }, error: null });
    },
  };
  return { caller: c, moves, calls: base.calls, reads: base.reads };
}
const refile = (c: ClientFileRefileCaller, over: Record<string, unknown> = {}) => refileClientDocument({
  caller: c, expectedActorId: ACTOR, expectedTenantId: TENANT, fileId: FILE, fromContactId: CONTACT,
  toContactId: OTHER_CONTACT, description: undefined, visibility: "shared", ...over,
} as Parameters<typeof refileClientDocument>[0]);

Deno.test("a move never writes visibility; sharing on the new client goes through the share writer at the moved version", async () => {
  const r = refiler();
  const out = await refile(r.caller);
  assert.deepEqual(r.moves, [{ fileId: FILE, tenantId: TENANT, patch: { contact_id: OTHER_CONTACT } }]);
  assert.deepEqual(r.calls, [{ name: "client_file_set_client_share", args: {
    p_expected_actor_id: ACTOR, p_expected_tenant_id: TENANT, p_file_id: FILE, p_shared: true, p_expected_updated_at: NEW_VERSION } }]);
  assert.equal(out.success, true);
  if (out.success) {
    assert.equal(out.contactId, OTHER_CONTACT);
    assert.equal(out.movedFromContactId, CONTACT);
    assert.equal(out.shared, true);
    assert.equal(out.share?.portalConnected, true);
  }
});

Deno.test("a move that should stay private sends no share call", async () => {
  const r = refiler();
  const out = await refile(r.caller, { visibility: "internal" });
  assert.equal(r.calls.length, 0);
  assert.equal(out.success, true);
  if (out.success) { assert.equal(out.shared, false); assert.equal(out.share, null); }
});

Deno.test("a description change on the same client that also unshares goes through the share writer", async () => {
  const r = refiler({
    moved: { data: { id: FILE, contact_id: CONTACT, visibility: "shared", updated_at: NEW_VERSION }, error: null },
    share: { data: { ok: true, replayed: false, file_id: FILE, shared: false, shared_at: null, updated_at: NEW_VERSION, portal_connected: true }, error: null },
    row: { id: FILE, tenant_id: TENANT, visibility: "internal", shared_at: null, updated_at: NEW_VERSION },
  });
  const out = await refile(r.caller, { toContactId: CONTACT, description: "  Signed scope  ", visibility: "internal" });
  assert.deepEqual(r.moves[0].patch, { contact_id: CONTACT, description: "Signed scope" });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].args.p_shared, false);
  assert.equal(out.success, true);
  if (out.success) { assert.equal(out.shared, false); assert.equal(out.movedFromContactId, null); }
});

Deno.test("a description change that keeps an already-shared file shared sends no share call", async () => {
  const r = refiler({ moved: { data: { id: FILE, contact_id: CONTACT, visibility: "shared", updated_at: NEW_VERSION }, error: null } });
  const out = await refile(r.caller, { toContactId: CONTACT, description: "x".repeat(600) });
  assert.equal((r.moves[0].patch.description as string).length, 500);
  assert.equal(r.calls.length, 0);
  assert.equal(out.success, true);
});

Deno.test("a refused move changes nothing and shares nothing; a lost reply is unknown", async () => {
  const refused = refiler({ moved: { data: null, error: { code: "42501", message: "denied" } } });
  const a = await refile(refused.caller);
  assert.equal(a.success, false);
  if (!a.success) { assert.equal(a.moved, false); assert.equal(a.outcomeUnknown, false); }
  assert.equal(refused.calls.length, 0);
  const lost = refiler({ moved: () => { throw new Error("network"); } });
  const b = await refile(lost.caller);
  if (!b.success) { assert.equal(b.moved, null); assert.equal(b.outcomeUnknown, true); }
  assert.equal(lost.calls.length, 0);
  const gateway = refiler({ moved: { data: null, error: { message: "upstream timeout" } } });
  const g = await refile(gateway.caller);
  if (!g.success) { assert.equal(g.moved, null); assert.equal(g.outcomeUnknown, true); }
  assert.equal(gateway.calls.length, 0);
  const missing = refiler({ moved: { data: null, error: null } });
  const c = await refile(missing.caller);
  if (!c.success) { assert.equal(c.moved, false); }
  assert.equal(missing.calls.length, 0);
});

Deno.test("a moved row that does not read back as the requested move is unknown, and nothing is shared", async () => {
  for (const data of [{ id: FILE, contact_id: CONTACT, visibility: "internal", updated_at: NEW_VERSION },
    { id: FILE, contact_id: OTHER_CONTACT, visibility: "client_upload", updated_at: NEW_VERSION },
    { id: FILE, contact_id: OTHER_CONTACT, visibility: "internal", updated_at: "yesterday" }]) {
    const r = refiler({ moved: { data, error: null } });
    const out = await refile(r.caller);
    assert.equal(out.success, false, JSON.stringify(data));
    if (!out.success) assert.equal(out.outcomeUnknown, true);
    assert.equal(r.calls.length, 0);
  }
});

Deno.test("a share refused after the move says the file moved and is still private", async () => {
  const r = refiler({ share: { data: null, error: { code: "42501", message: "FILE_SCOPE_CHANGED" } } });
  const out = await refile(r.caller);
  assert.equal(out.success, false);
  if (!out.success) {
    assert.equal(out.moved, true);
    assert.equal(out.shared, false);
    assert.equal(out.outcomeUnknown, false);
    assert.equal(out.reason, "scope_changed");
    assert.match(out.message, /team can see it/);
  }
  const lost = refiler({ share: { data: null, error: { message: "upstream timeout" } } });
  const unknown = await refile(lost.caller);
  if (!unknown.success) { assert.equal(unknown.moved, true); assert.equal(unknown.shared, null); assert.equal(unknown.outcomeUnknown, true); }
});

Deno.test("a malformed request moves nothing", async () => {
  for (const over of [{ expectedTenantId: null }, { fileId: "x" }, { toContactId: "x" }, { visibility: "client_upload" }]) {
    const r = refiler();
    const out = await refile(r.caller, over);
    assert.equal(out.success, false);
    assert.equal(r.moves.length, 0);
  }
});

Deno.test("the chat re-file branch moves through the caller's client without visibility, then the helper", async () => {
  const chat = await Deno.readTextFile(new URL("../../paige-ai-chat/index.ts", import.meta.url));
  const start = chat.indexOf("const refiled = await refileClientDocument({");
  assert.ok(start > 0, "the re-file branch calls refileClientDocument");
  const call = chat.slice(start, chat.indexOf("});", start) + 3);
  assert.match(call, /expectedActorId: user\.id,/);
  assert.match(call, /expectedTenantId: crmTenantId,/);
  assert.match(call, /supabaseClient\.from\("client_files"\)/);
  assert.doesNotMatch(call, /visibility:\s*docVisibility\s*,\s*\.\.\./);
  assert.doesNotMatch(call, /args\.tenant_id|supabase\.from|update\(\{[^}]*visibility/);
  // The direct update that used to write visibility is gone from the tool.
  const tool = chat.slice(chat.indexOf('tc.function.name === "crm_file_document"'), chat.indexOf('tc.function.name === "team_set_work_profile"'));
  assert.doesNotMatch(tool, /\.update\(\{\s*contact_id: docContactId,\s*tenant_id: crmTenantId,\s*visibility/);
});
