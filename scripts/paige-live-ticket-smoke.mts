import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { consumeRelayTicket, issueRelayTicket, validateRelayTicket, isLiveAudioPilotEnabled, hasLiveWorkspaceStanding, isLiveWorkspaceCurrent, liveContextEpochTenant } from "../supabase/functions/_shared/paige-live-ticket.ts";
import { composerScopeIdentityKey } from "../src/lib/paigeComposerScopeState.ts";

let network = 0;
globalThis.fetch = (async () => { network++; throw new Error("network forbidden"); }) as typeof fetch;
Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  value: class { constructor() { network++; throw new Error("provider socket forbidden"); } },
});

const sessionId = "11111111-1111-4111-8111-111111111111";
const issued = await issueRelayTicket(1_000_000_000_000);
let stored: string | null = issued.storedDigest;
const store = {
  async consume(_sessionId: string, digest: string): Promise<{ tenant: string } | null> {
    await Promise.resolve();
    if (_sessionId !== sessionId || stored !== digest) return null;
    stored = null;
    return { tenant: "server-resolved" };
  },
};
assert.equal((await validateRelayTicket(issued.value, 1_000_000_001_000))?.storedDigest, issued.storedDigest);
assert.equal(await validateRelayTicket(issued.value, issued.expiresAt), null);
assert.equal(await consumeRelayTicket(issued.value + "a", sessionId, store, 1_000_000_001_000), null);
assert.equal(await consumeRelayTicket(issued.value, "not-a-uuid", store, 1_000_000_001_000), null);
const [first, second] = await Promise.all([
  consumeRelayTicket(issued.value, sessionId, store, 1_000_000_001_000),
  consumeRelayTicket(issued.value, sessionId, store, 1_000_000_001_000),
]);
assert.equal(Number(first !== null) + Number(second !== null), 1, "one claim wins the concurrent race");
assert.equal(await consumeRelayTicket(issued.value, sessionId, store, 1_000_000_001_000), null, "replay loses");
assert.equal(isLiveAudioPilotEnabled({}), false, "pilot defaults off for every tenant");
assert.equal(isLiveAudioPilotEnabled(null), false, "missing feature record fails closed");
assert.equal(isLiveAudioPilotEnabled({ enabled: "true" }), false, "string truthiness never enables audio");
assert.equal(isLiveAudioPilotEnabled({ enabled: true }), true, "only explicit platform-stored boolean enables audio");
assert.equal(hasLiveWorkspaceStanding(true, false, null, false), true, "active direct member enters");
assert.equal(hasLiveWorkspaceStanding(false, true, null, false), true, "authorized agency child manager enters without child roster row");
assert.equal(hasLiveWorkspaceStanding(false, false, "agency_specialist", false), true, "active agency team member enters own agency workspace");
assert.equal(hasLiveWorkspaceStanding(false, false, null, true), true, "canonical platform standing remains recognized");
assert.equal(hasLiveWorkspaceStanding(false, false, null, false), false, "removed agency and absent membership are denied");
assert.equal(hasLiveWorkspaceStanding(false, false, undefined, false), false, "missing agency role never grants access");
assert.equal(hasLiveWorkspaceStanding(false, false, "", false), false, "empty agency role never grants access");
assert.equal(isLiveWorkspaceCurrent("tenant-a", "tenant-a", true, null), true, "matching active workspace remains current");
assert.equal(isLiveWorkspaceCurrent("tenant-a", "tenant-b", true, "tenant-a"), false, "valid active workspace switch revokes old ticket");
assert.equal(isLiveWorkspaceCurrent("tenant-b", "tenant-a", false, "tenant-b"), true, "stale unauthorized active workspace falls back to the first active membership");
assert.equal(isLiveWorkspaceCurrent("tenant-a", "tenant-a", false, "tenant-b"), false, "stale active workspace never authorizes its old ticket");
assert.equal(isLiveWorkspaceCurrent("tenant-a", null, false, null), false, "operator exit with no direct-member fallback revokes ticket");
assert.equal(isLiveWorkspaceCurrent("tenant-a", null, false, "tenant-a"), true, "canonical first-member fallback remains usable");
assert.equal(isLiveWorkspaceCurrent("tenant-a", null, false, "tenant-b"), false, "fallback to another workspace revokes ticket");
const currentComposerEpoch = composerScopeIdentityKey({ tenantId: "tenant-a", userId: "user-a", focusedClientId: "none", focusedBusinessMissionId: "none" });
assert.equal(liveContextEpochTenant(currentComposerEpoch), "tenant-a", "actual composer scope resolves the tenant");
assert.equal(liveContextEpochTenant("tenant-a|client-a|mission-a"), "tenant-a", "older deployed composer scope remains compatible");
assert.equal(liveContextEpochTenant('["tenant-a",'), null, "malformed JSON scope never authorizes a workspace");
assert.equal(liveContextEpochTenant('["tenant-a"]'), null, "incomplete JSON scope never authorizes a workspace");

const relay = readFileSync(new URL("../supabase/functions/paige-live-relay/index.ts", import.meta.url), "utf8");
const session = readFileSync(new URL("../supabase/functions/paige-live-session/index.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
assert.match(config, /\[functions\.paige-live-relay\]\s*verify_jwt = false/);
assert.ok(relay.indexOf("consumeRelayTicket(") < relay.indexOf("Deno.upgradeWebSocket(req)"), "claim precedes upgrade");
assert.match(relay, /\.eq\("provider_session_ref", storedDigest\)/);
assert.match(relay, /\.eq\("tenant_id", session.tenant_id\)/);
assert.match(relay, /state: "unavailable", availability: "UNAVAILABLE", failure_code: code/, "terminal provider-free state is durable");
assert.ok(relay.indexOf("markUnavailable(unavailableCode)") < relay.indexOf("Deno.upgradeWebSocket(req)"), "terminal state precedes unavailable socket");
assert.ok(session.indexOf('rpc("current_user_tenant_id")') < session.indexOf("issueRelayTicket()"));
assert.match(session, /liveContextEpochTenant\(parsed\.data\.context_epoch\)/, "ticket admission understands the current composer scope format");
assert.ok(session.indexOf('from("paige_chat_threads")') < session.indexOf("issueRelayTicket()"));
// The admission question has ONE home, and it is the database predicate (§18). These used to pin a
// SECOND, weaker gate in each function — a direct paige_live_tenant_availability read that refused
// on a missing row. That second answer contradicted the predicate as soon as a missing row came to
// mean "follow the rollout scope", so it was removed and these assertions now pin the real gate:
// the predicate is consulted, and anything short of an explicit `true` refuses. The predicate reads
// that same table itself and still honours both of its meanings, which the pgTAP suite proves.
assert.ok(session.indexOf('rpc("paige_live_pilot_authorized_internal"') < session.indexOf("issueRelayTicket()"), "scoped admission is decided before a ticket is issued");
assert.match(session, /authorizationError \|\| authorizedPilot !== true/, "session ticket refuses anything short of an explicit admission");
assert.doesNotMatch(session, /from\("paige_live_tenant_availability"\)/, "no second availability gate may reappear beside the predicate");
assert.ok(relay.indexOf('rpc("paige_live_pilot_authorized_internal"') < relay.indexOf("Deno.upgradeWebSocket(req)"), "relay decides scoped admission before upgrade");
assert.match(relay, /authorizationError \|\| authorizedPilot !== true/, "relay admission refuses anything short of an explicit admission");
assert.doesNotMatch(relay, /from\("paige_live_tenant_availability"\)/, "no second availability gate may reappear beside the predicate");
assert.ok(relay.indexOf('return new Response("live_audio_not_enabled", { status: 403 })') < relay.indexOf("Deno.upgradeWebSocket(req)"), "revoked or missing pilot rejects before socket upgrade");
assert.match(relay, /from\("tenant_members"\)[\s\S]*?\.eq\("user_id", session\.actor_user_id\)\.eq\("status", "active"\)/, "relay rechecks the signed-in user's active membership, independent of role label");
assert.match(relay, /rpc\("agency_can_manage_child"/, "relay preserves canonical agency child access");
assert.match(relay, /rpc\("agency_team_role"/, "relay preserves canonical agency team access");
assert.match(relay, /rpc\("is_platform_admin"/, "relay preserves canonical platform standing without granting tenant writes");
assert.match(relay, /from\("profiles"\)[\s\S]*?active_tenant_id/, "relay rejects a stale ticket after active workspace switch");
assert.match(relay, /order\("joined_at", \{ ascending: true \}\)/, "null active workspace uses the canonical first-active-member fallback");
assert.match(relay, /hasLiveWorkspaceStanding\(false, activeChildAccess\.data, activeAgencyRole\.data, activePlatformRole\.data\)/, "non-null active workspace must prove standing before suppressing fallback");
const pilotMigration = readFileSync(new URL("../supabase/migrations/20270409000000_paige_live_pilot_feature_guard.sql", import.meta.url), "utf8");
assert.match(pilotMigration, /CREATE TABLE IF NOT EXISTS public\.paige_live_tenant_availability/, "rollout decision has a platform-owned table");
assert.match(pilotMigration, /REVOKE ALL ON TABLE public\.paige_live_tenant_availability FROM PUBLIC, anon, authenticated/, "tenant roles have no table write route");
assert.doesNotMatch(relay + session, /from\("tenants"\)\.select\("features"\)/, "tenant-writable feature JSON never controls Live audio");
assert.doesNotMatch(relay + session, /daily_ceiling|concurrent_session_limit|reserve_paige_voice|allowance_gate/i);
// S4 intentionally joins real adapters. Admission still precedes ANY adapter
// open, and canonical privacy proof is independent of pilot availability.
assert.ok(relay.indexOf('if (unavailableCode)') < relay.indexOf('openEars: (events) => openFluxEars(events)'), 'provider readiness refuses before ears open');
const chat = readFileSync(new URL("../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");
for (const source of [session, relay, chat]) {
  assert.match(source, /rpc\("paige_live_pilot_authorized_internal", \{\s*_actor_user_id: [^,]+, _tenant_id: [^,]+,/, 'every entry scopes the one canonical pilot predicate');
  assert.match(source, /authorizationError \|\| authorizedPilot !== true/, 'missing and errored authorization always refuses');
}
assert.ok(session.indexOf('rpc("paige_live_pilot_authorized_internal"') < session.indexOf('issueRelayTicket()'), 'account authorization precedes ticket creation');
assert.ok(chat.indexOf('rpc("paige_live_pilot_authorized_internal"') < chat.indexOf('const { data: claimed, error: claimError }'), 'account authorization precedes signed runtime claim');
assert.doesNotMatch(relay, /DEEPGRAM_MIP_ACCOUNT_VERIFIED/, 'no nonexistent project-level opt-out setting');
assert.doesNotMatch(session, /elevenlabsSpeechStream|openFluxEars/, 'ticket issuance never opens providers');
assert.equal(network, 0);
console.log("✅ relay ticket smoke: expiry, tamper, concurrent one-use, replay, server-scope, pre-upgrade gate, zero network/provider calls");
