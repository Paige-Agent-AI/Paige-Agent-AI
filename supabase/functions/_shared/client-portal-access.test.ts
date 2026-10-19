// E09 Slice 7 — the client portal access executor, its Chat declarations, and the edge doors that read
// the link directly.
// Run: deno test --allow-read --allow-import --node-modules-dir=none --deny-net --deny-env --deny-write \
//        --deny-run --deny-ffi --deny-sys supabase/functions/_shared/client-portal-access.test.ts
// (--allow-read: the door and migration checks read the repo tree.)
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parsePortalAccessRequest, portalAccessConfirmSummary, portalUnseenNote, readPortalAccess, readPortalShareAccess, setPortalAccess,
  PORTAL_ACCESS_MESSAGES, PORTAL_ACCESS_REASONS, type PortalAccessCaller,
} from "./client-portal-access.ts";
import {
  PORTAL_ACCESS_TOOLS, PORTAL_ACCESS_SET_CAPABILITY, PORTAL_ACCESS_READ_CAPABILITY, PORTAL_ACCESS_SET, PORTAL_ACCESS_READ,
} from "./paige-spine/domains/client_portal.ts";
import { PAIGE_SPINE_CAPABILITIES } from "./paige-spine/registry.ts";
import { classifyAction, clampLaneByRisk, mutatingTools, riskReason } from "./action-risk.ts";
import { confirmFingerprint } from "./confirm-fingerprint.ts";

const TENANT = "c0a1e000-0000-4000-8000-00000000000a";
const FORGED = "c0a1e000-0000-4000-8000-0000000000ff";
const ACTOR = "c0a1e000-0000-4000-8000-0000000000a1";
const CONTACT = "c0a1e000-0000-4000-8000-0000000000c1";
const SINCE = "2026-10-18T10:00:00.000000+00:00";

type Call = { name: string; args: Record<string, unknown> };
const view = (state: string, extra: Record<string, unknown> = {}) => ({
  ok: true, contact_id: CONTACT, state, joined: state !== "ended", since: SINCE, changed_by_name: "Avery Owner",
  reason: state === "open" ? null : "payment", note: "PRIVATE OWNER NOTE", invitation: { status: "accepted" },
  can: { pause: state === "open", restore: state === "paused", end: state !== "ended", invite: state === "ended" },
  restore_blocked_by: null, ...extra,
});
/** A caller over one stored access row. */
function fakeCaller(opts: {
  state?: string; readError?: unknown; writeError?: unknown; writeThrows?: boolean; writeReply?: unknown;
  readAfter?: unknown; readRefusal?: string;
} = {}) {
  const calls: Call[] = [];
  let state = opts.state ?? "open";
  let reads = 0;
  const caller: PortalAccessCaller = {
    rpc(name, args) {
      calls.push({ name, args });
      if (name === "read_client_portal_access") {
        reads++;
        if (opts.readError) return Promise.resolve({ data: null, error: opts.readError });
        if (opts.readRefusal) return Promise.resolve({ data: { ok: false, error: opts.readRefusal }, error: null });
        if (reads > 1 && opts.readAfter !== undefined) return Promise.resolve({ data: opts.readAfter, error: null });
        return Promise.resolve({ data: view(state), error: null });
      }
      if (name === "set_client_portal_access") {
        if (opts.writeThrows) return Promise.reject(new Error("gateway"));
        if (opts.writeError) return Promise.resolve({ data: null, error: opts.writeError });
        if (opts.writeReply !== undefined) return Promise.resolve({ data: opts.writeReply, error: null });
        const target = { pause: "paused", restore: "open", end: "ended" }[String(args.p_action)] ?? state;
        const replayed = target === state;
        // The real writer answers a landed repeat first, then refuses a version it was not handed.
        if (!replayed && args.p_expected_changed_at !== SINCE) return Promise.resolve({ data: { ok: false, error: "ACCESS_CHANGED", state, since: SINCE }, error: null });
        state = target;
        return Promise.resolve({ data: { ...view(state), replayed }, error: null });
      }
      return Promise.resolve({ data: null, error: { code: "42883", message: "unknown" } });
    },
  };
  return { caller, calls };
}

Deno.test("pause: the tenant and actor are the server's, the version is the one the card was built from, and the note is never sent", async () => {
  const { caller, calls } = fakeCaller();
  const r = await setPortalAccess({ caller, expectedTenantId: TENANT, actorId: ACTOR,
    args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE, tenant_id: FORGED, note: "model wrote this" } });
  assert(r.success);
  assertEquals(r.view.state, "paused");
  assertEquals(r.replayed, false);
  const write = calls.find((c) => c.name === "set_client_portal_access")!;
  assertEquals(write.args, { p_expected_actor_id: ACTOR, p_expected_tenant_id: TENANT, p_contact_id: CONTACT,
    p_action: "pause", p_reason: "payment", p_note: null, p_expected_changed_at: SINCE });
  assert(calls.every((c) => !JSON.stringify(c.args).includes(FORGED)), "a forged tenant never reaches the database");
  assertEquals(calls.map((c) => c.name), ["read_client_portal_access", "set_client_portal_access", "read_client_portal_access"]);
});

Deno.test("the model never reads the owner's internal note", async () => {
  const { caller } = fakeCaller({ state: "paused" });
  const r = await readPortalAccess({ caller, expectedTenantId: TENANT, args: { contact_id: CONTACT } });
  assert(r.success);
  assert(!JSON.stringify(r).includes("PRIVATE OWNER NOTE"));
  assert(!("note" in r.view));
  const w = await setPortalAccess({ caller, expectedTenantId: TENANT, actorId: ACTOR, args: { contact_id: CONTACT, action: "end", reason: "engagement_ended", access_version: SINCE } });
  assert(w.success);
  assert(!JSON.stringify(w).includes("PRIVATE OWNER NOTE"));
});

Deno.test("restore carries no reason; pause and end need one from the fixed set", () => {
  assertEquals(parsePortalAccessRequest({ contact_id: CONTACT, action: "restore", reason: "payment", access_version: "none" }),
    { ok: true, request: { contactId: CONTACT, action: "restore", reason: null, expectedChangedAt: null } });
  assertEquals(parsePortalAccessRequest({ contact_id: CONTACT, action: "pause" }).ok, false);
  assertEquals(parsePortalAccessRequest({ contact_id: CONTACT, action: "end", reason: "because" }).ok, false);
  assertEquals(parsePortalAccessRequest({ contact_id: CONTACT.slice(0, 8), action: "pause", reason: "payment", access_version: SINCE }).ok, false);
  assertEquals(parsePortalAccessRequest({ contact_id: CONTACT, action: "suspend", reason: "payment" }).ok, false);
  assertEquals(parsePortalAccessRequest(null).ok, false);
});

Deno.test("the version is required, and is either the read's own timestamp or none", () => {
  assertEquals(parsePortalAccessRequest({ contact_id: CONTACT, action: "pause", reason: "payment" }).ok, false, "no version, no change");
  for (const bad of ["", "yesterday", 42, null, "2026-10-18", `${SINCE}; DROP`]) {
    assertEquals(parsePortalAccessRequest({ contact_id: CONTACT, action: "pause", reason: "payment", access_version: bad }).ok, false, String(bad));
  }
  const ok = parsePortalAccessRequest({ contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE });
  assert(ok.ok && ok.request.expectedChangedAt === SINCE);
  const never = parsePortalAccessRequest({ contact_id: CONTACT, action: "pause", reason: "payment", access_version: "none" });
  assert(never.ok && never.request.expectedChangedAt === null);
});

Deno.test("a stale approval is refused: a change that landed after the card was built writes nothing", async () => {
  // The card was built from an earlier read; someone changed the access since (the store is at SINCE).
  const EARLIER = "2026-10-17T09:00:00.000000+00:00";
  const { caller, calls } = fakeCaller();
  const r = await setPortalAccess({ caller, expectedTenantId: TENANT, actorId: ACTOR,
    args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: EARLIER } });
  assert(!r.success && r.reason === "changed" && !r.writeAttempted);
  assertEquals(r.message, PORTAL_ACCESS_MESSAGES.changed);
  const write = calls.find((c) => c.name === "set_client_portal_access")!;
  assertEquals(write.args.p_expected_changed_at, EARLIER, "the writer is handed the card's version, never one re-read at execution");
  // Never changed (since is null) is "none", and a card built on it is stale once anything lands.
  const fresh = await setPortalAccess({ caller: fakeCaller().caller, expectedTenantId: TENANT, actorId: ACTOR,
    args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: "none" } });
  assert(!fresh.success && fresh.reason === "changed");
});

Deno.test("no workspace or no verified actor: nothing is read or written", async () => {
  for (const [tenant, actor] of [[null, ACTOR], ["not-a-uuid", ACTOR], [TENANT, null]] as const) {
    const { caller, calls } = fakeCaller();
    const r = await setPortalAccess({ caller, expectedTenantId: tenant, actorId: actor, args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE } });
    assert(!r.success && r.reason === "no_workspace" && !r.writeAttempted);
    assertEquals(calls.length, 0);
  }
});

Deno.test("structured refusals map to the owner's words and are never 'unknown'", async () => {
  const cases: Array<[unknown, string, string?]> = [
    [{ ok: false, error: "ACCESS_CHANGED", state: "paused" }, "changed"],
    [{ ok: false, error: "NOT_JOINED", state: "ended" }, "not_joined"],
    [{ ok: false, error: "CONTACT_NOT_FOUND" }, "not_found"],
    [{ ok: false, error: "PORTAL_ACCESS_UNAVAILABLE" }, "not_for_tier"],
    [{ ok: false, error: "INVALID_REQUEST" }, "bad_request"],
    [{ ok: false, error: "ACCESS_RESTORE_UNAVAILABLE", reason: "contact_merged" }, "restore_unavailable", "contact_merged"],
    [{ ok: false, error: "SOMETHING_NEW" }, "refused"],
  ];
  for (const [reply, reason, detail] of cases) {
    const { caller } = fakeCaller({ writeReply: reply });
    const r = await setPortalAccess({ caller, expectedTenantId: TENANT, actorId: ACTOR, args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE } });
    assert(!r.success, reason);
    assertEquals(r.reason, reason);
    assertEquals(r.writeAttempted, false, `${reason} is a refusal before any write`);
    if (detail) { assertEquals(r.detail, detail); assert(r.message.includes("merged")); }
    else assertEquals(r.message, PORTAL_ACCESS_MESSAGES[r.reason]);
  }
});

Deno.test("a SQLSTATE refusal is not applied; a gateway error is unknown", async () => {
  const notAuth = await setPortalAccess({ caller: fakeCaller({ writeError: { code: "42501", message: "PORTAL_ACCESS_NOT_AUTHORIZED" } }).caller,
    expectedTenantId: TENANT, actorId: ACTOR, args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE } });
  assert(!notAuth.success && notAuth.reason === "forbidden" && !notAuth.writeAttempted);
  const scope = await setPortalAccess({ caller: fakeCaller({ writeError: { code: "42501", message: "PORTAL_ACCESS_SCOPE_CHANGED" } }).caller,
    expectedTenantId: TENANT, actorId: ACTOR, args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE } });
  assert(!scope.success && scope.reason === "no_workspace" && !scope.writeAttempted);
  const gateway = await setPortalAccess({ caller: fakeCaller({ writeError: { message: "upstream timeout" } }).caller,
    expectedTenantId: TENANT, actorId: ACTOR, args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE } });
  assert(!gateway.success && gateway.reason === "outcome_unknown" && gateway.writeAttempted);
  const thrown = await setPortalAccess({ caller: fakeCaller({ writeThrows: true }).caller,
    expectedTenantId: TENANT, actorId: ACTOR, args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE } });
  assert(!thrown.success && thrown.reason === "outcome_unknown" && thrown.writeAttempted);
});

Deno.test("success is a readback: a read that disagrees is outcome_unknown, never success", async () => {
  const { caller } = fakeCaller({ readAfter: view("open") });
  const r = await setPortalAccess({ caller, expectedTenantId: TENANT, actorId: ACTOR, args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE } });
  assert(!r.success && r.reason === "outcome_unknown" && r.writeAttempted);
  const other = fakeCaller({ readAfter: { ...view("paused"), contact_id: FORGED } });
  const r2 = await setPortalAccess({ caller: other.caller, expectedTenantId: TENANT, actorId: ACTOR, args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE } });
  assert(!r2.success && r2.reason === "outcome_unknown");
});

Deno.test("a repeat of a change that already landed reports the replay", async () => {
  const { caller } = fakeCaller({ state: "paused" });
  const r = await setPortalAccess({ caller, expectedTenantId: TENANT, actorId: ACTOR, args: { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE } });
  assert(r.success && r.replayed);
});

Deno.test("read refusals: forbidden, not found, wrong tier, malformed", async () => {
  assertEquals((await readPortalAccess({ caller: fakeCaller({ readError: { code: "42501" } }).caller, expectedTenantId: TENANT, args: { contact_id: CONTACT } })).success === false
    && (await readPortalAccess({ caller: fakeCaller({ readError: { code: "42501" } }).caller, expectedTenantId: TENANT, args: { contact_id: CONTACT } }) as { reason: string }).reason, "forbidden");
  const nf = await readPortalAccess({ caller: fakeCaller({ readRefusal: "CONTACT_NOT_FOUND" }).caller, expectedTenantId: TENANT, args: { contact_id: CONTACT } });
  assert(!nf.success && nf.reason === "not_found");
  const tier = await readPortalAccess({ caller: fakeCaller({ readRefusal: "PORTAL_ACCESS_UNAVAILABLE" }).caller, expectedTenantId: TENANT, args: { contact_id: CONTACT } });
  assert(!tier.success && tier.reason === "not_for_tier");
  const bad = await readPortalAccess({ caller: fakeCaller().caller, expectedTenantId: TENANT, args: { contact_id: "nope" } });
  assert(!bad.success && bad.reason === "bad_request");
});

Deno.test("the approval card fingerprint covers the contact, the action, the reason and the version", async () => {
  const base = { contact_id: CONTACT, action: "pause", reason: "payment", access_version: SINCE };
  const fp = await confirmFingerprint("client_portal_access_set", base);
  assertEquals(fp, await confirmFingerprint("client_portal_access_set", { access_version: SINCE, reason: "payment", action: "pause", contact_id: CONTACT, confirm: true }));
  assertNotEquals(fp, await confirmFingerprint("client_portal_access_set", { ...base, access_version: "none" }), "the card is bound to the version it was built from");
  assertNotEquals(fp, await confirmFingerprint("client_portal_access_set", { ...base, contact_id: FORGED }));
  assertNotEquals(fp, await confirmFingerprint("client_portal_access_set", { ...base, action: "end" }));
  assertNotEquals(fp, await confirmFingerprint("client_portal_access_set", { ...base, reason: "security" }));
});

Deno.test("the consequence line never claims a send or a deletion, and names what End stops showing", () => {
  const pause = portalAccessConfirmSummary({ contact_id: CONTACT, action: "pause", reason: "payment" });
  const end = portalAccessConfirmSummary({ contact_id: CONTACT, action: "end", reason: "engagement_ended" });
  const restore = portalAccessConfirmSummary({ contact_id: CONTACT, action: "restore" });
  for (const s of [pause, end, restore]) { assert(/won't be emailed/.test(s)); assert(!/deleted/i.test(s)); }
  assert(/new invitation/.test(end) && /stops showing here/.test(end));
  assert(/Emails and texts you send them aren't affected/.test(pause));
  assert(pause.includes("Reason: Payment"), "the card names the reason whether or not the version token is present");
  // Round 3 (security 1): pause and end revoke a signing link the portal issued, which had replaced the
  // emailed one — the card says so and tells the owner to resend; restore revokes nothing.
  const signing = "A signing link they opened from your portal stops working; resend it if they still need to sign.";
  assert(pause.includes(signing) && end.includes(signing), "pause and end name the signing link they stop");
  assert(!/signing link/.test(restore));
});

Deno.test("the write is high and can never run unattended; the read is not a mutation", () => {
  assertEquals(classifyAction("client_portal_access_set"), "high");
  assertEquals(clampLaneByRisk("auto", "client_portal_access_set"), "confirm");
  assert(riskReason("client_portal_access_set")?.includes("new invitation"));
  assert(mutatingTools().has("client_portal_access_set"));
  assert(!mutatingTools().has("read_client_portal_access"));
  assertEquals(classifyAction("read_client_portal_access"), "unclassified");
});

Deno.test("Spine: both declarations registered, the read named after its executor and bound by reference", () => {
  assert(PAIGE_SPINE_CAPABILITIES.some((c) => c === PORTAL_ACCESS_SET));
  assert(PAIGE_SPINE_CAPABILITIES.some((c) => c === PORTAL_ACCESS_READ));
  const [read, set] = PORTAL_ACCESS_TOOLS;
  assertEquals(read.function.name, "read_client_portal_access");
  assertEquals(`public.${read.function.name}`, PORTAL_ACCESS_READ.action.executor);
  assert(read.function.parameters === PORTAL_ACCESS_READ_CAPABILITY.input, "the read carries its declaration's own input");
  assertEquals(set.function.name, PORTAL_ACCESS_SET.action.chatTool);
  assert(set.function.parameters !== PORTAL_ACCESS_SET_CAPABILITY.input, "the gated writer gets a writable copy");
  assertEquals(JSON.parse(JSON.stringify(set.function.parameters)), JSON.parse(JSON.stringify(PORTAL_ACCESS_SET_CAPABILITY.input)));
  const props = (set.function.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
  assertEquals(Object.keys(props).sort(), ["access_version", "action", "contact_id", "reason"], "no tenant and no note in the model's input");
  assertEquals((set.function.parameters as { required: string[] }).required, ["contact_id", "action", "access_version"]);
  assertEquals(props.reason.enum, [...PORTAL_ACCESS_REASONS]);
  assertEquals(PORTAL_ACCESS_SET_CAPABILITY.governance.actionRiskKey, "client_portal_access_set");
});

// The two edge doors that read clients.linked_user_id themselves (service role) must apply the same
// predicate as the resolver. Structural: they are inline in their entry points.
Deno.test("paige-mcp actorClient and paige-mcp-consent grant nothing for a relationship that is not open", () => {
  const mcp = Deno.readTextFileSync(new URL("../paige-mcp/index.ts", import.meta.url));
  const actor = mcp.slice(mcp.indexOf("async function actorClient()"), mcp.indexOf("mcp.tool(\"me_whoami\""));
  for (const f of ['.eq("linked_user_id", a.user_id)', '.eq("status", "active")', '.is("merged_into_contact_id", null)', '.eq("portal_access_state", "open")', '.eq("tenants.status", "active")']) {
    assert(actor.includes(f), `actorClient: ${f}`);
  }
  const consent = Deno.readTextFileSync(new URL("../paige-mcp-consent/index.ts", import.meta.url));
  const tier = consent.slice(consent.indexOf("// 5. Client (end-user)"), consent.indexOf("// 6. Anyone else"));
  for (const f of ['.eq("linked_user_id", userId)', '.eq("status", "active")', '.is("merged_into_contact_id", null)', '.eq("portal_access_state", "open")', '.eq("tenants.status", "active")', 'tenants!inner(status)']) {
    assert(tier.includes(f), `consent client tier: ${f}`);
  }
});

Deno.test("the resolver restatement is the incumbent body plus exactly one predicate", () => {
  const root = new URL("../../migrations/", import.meta.url);
  const body = (file: string) => {
    const src = Deno.readTextFileSync(new URL(file, root));
    const start = src.indexOf("CREATE OR REPLACE FUNCTION public.client_portal_relationship_id(");
    return src.slice(start, src.indexOf("$$;", start));
  };
  const before = body("20271102120000_e09_client_self_projection.sql");
  const after = body("20271110240000_e09_customer_portal_access.sql");
  assertEquals(after.replace("\n    AND c.portal_access_state = 'open'", ""), before);
  assertEquals(after.split("portal_access_state").length - 1, 1);
});

// E09 Slice 7 round 2 (compliance 1, §37 consumers): a share answer's portal_access names why a client
// cannot see what was shared. Paige never confirms "they can open it now" when the writer says they can't.
Deno.test("the share answer's access state is read strictly, and the unseen note says why", () => {
  assertEquals(readPortalShareAccess("paused"), "paused");
  assertEquals(readPortalShareAccess("ended"), "ended");
  assertEquals(readPortalShareAccess("not_joined"), "not_joined");
  assertEquals(readPortalShareAccess("open"), "open");
  assertEquals(readPortalShareAccess("suspended"), null);
  assertEquals(readPortalShareAccess(undefined), null);
  assertEquals(portalUnseenNote({ portalConnected: true, portalAccess: "open" }), "");
  // Round 3 (security 2): no portal_connected in the answer is unknown — never silence that reads as "can see".
  assertEquals(portalUnseenNote({ portalConnected: null, portalAccess: null }), " Whether they can see it in their portal right now wasn't confirmed, so don't say they can.");
  assertEquals(portalUnseenNote({ portalConnected: null, portalAccess: "open" }), " Whether they can see it in their portal right now wasn't confirmed, so don't say they can.");
  assertEquals(portalUnseenNote({ portalConnected: false, portalAccess: "paused" }), " Their portal access is paused, so they can't see it until the business restores it.");
  assertEquals(portalUnseenNote({ portalConnected: false, portalAccess: "ended" }), " Their portal access has ended, so they will see it only if they are invited back and accept.");
  assertEquals(portalUnseenNote({ portalConnected: false, portalAccess: "not_joined" }), " This client hasn't joined their portal yet, so they'll see it once they do.");
  assertEquals(portalUnseenNote({ portalConnected: false, portalAccess: null }), " This client hasn't joined their portal yet, so they'll see it once they do.");
});

Deno.test("chat never tells the owner a client can open a share the writer says they cannot", () => {
  const chat = Deno.readTextFileSync(new URL("../paige-ai-chat/index.ts", import.meta.url));
  for (const claim of ["they can now open it in their portal", "visible to them in their portal — say that plainly", "the client can now see this item's title"]) {
    const at = chat.indexOf(claim);
    assert(at > 0, claim);
    // Each "can see it now" sentence sits on the connected branch of a portalConnected !== true test, so an
    // answer with no portal_connected (null, e.g. a replay) takes the unseen branch (round 3, security 2).
    const before = chat.slice(Math.max(0, at - 400), at);
    assert(/portalConnected !== true/.test(before), `"${claim}" is not guarded by portalConnected !== true`);
    assert(!/portalConnected === false\s*\n?\s*\?/.test(before), `"${claim}" is guarded by === false, which lets null claim visibility`);
  }
  assertEquals((chat.match(/portalUnseenNote\(/g) ?? []).length, 3);
});
