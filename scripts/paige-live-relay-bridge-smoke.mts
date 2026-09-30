/** Real WebCrypto + final SSE + relay, with fake ears/mouth and NO network. */
import { LiveRelayAdmission, PaigeLiveRelayBridge, type LiveEarsEvents } from "../supabase/functions/_shared/paige-live-relay-bridge.ts";
import { createLiveRuntimeProof, liveRuntimeDigest, type LiveRuntimeScope } from "../supabase/functions/_shared/paige-live-runtime-proof.ts";
import type { UsageEvent } from "../supabase/functions/_shared/paige-live-relay-contract.ts";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { z } from "zod";
import { isLiveAudioPilotEnabled, issueRelayTicket, liveContextEpochTenant, validateRelayTicket } from "../supabase/functions/_shared/paige-live-ticket.ts";
let pass = 0;
let fail = 0;
const check = (name: string, okay: boolean) => { console.log(`${okay ? "PASS" : "FAIL"} ${name}`); okay ? pass++ : fail++; };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
let networkCalls = 0;
globalThis.fetch = (async () => { networkCalls++; throw new Error("network_forbidden"); }) as typeof fetch;
globalThis.WebSocket = class { constructor() { networkCalls++; throw new Error("network_forbidden"); } } as typeof WebSocket;
const proof = createLiveRuntimeProof("fake-only-never-a-server-secret-0123456789");
const base = { sessionId: "session-1", tenantId: "tenant-1", actorId: "user-1", threadId: "thread-1", epoch: "epoch-1" };
const outputTokens = async (scope: LiveRuntimeScope, content = "I hear you. Let me help") => {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } });
  const signed = await new Response(proof.outputStream(source, scope)).text();
  return signed.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)))
    .filter((event) => event.paige_live_output).map((event) => event.paige_live_output as string);
};
async function fixture(authorize: (force?: boolean) => Promise<boolean> = async () => true,
  mouth?: (text: string, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>) {
  const sent: Array<string | ArrayBuffer> = [];
  const usage: UsageEvent[] = [];
  const spoken: string[] = [];
  let ears!: LiveEarsEvents;
  let resolveDispatch!: (value: { turn_id: string; challenge: string }) => void;
  const dispatchReady = new Promise<{ turn_id: string; challenge: string }>((resolve) => { resolveDispatch = resolve; });
  let closes = 0;
  const bridge = new PaigeLiveRelayBridge({
    sessionId: base.sessionId, epoch: base.epoch,
    authorize,
    send(frame) { sent.push(frame); if (typeof frame === "string") { const f = JSON.parse(frame); if (f.type === "runtime.dispatch") resolveDispatch(f); } },
    close() { closes++; },
    openEars: async (events) => { ears = events; return { ok: true, ears: { sendPcm: (b) => b.byteLength / 32, close() {}, cancel() {} } }; },
    openMouth: mouth ?? (async (text) => { spoken.push(text); return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.of(1, 2, 3)); c.enqueue(Uint8Array.of(4, 5, 6)); c.close(); } }); }),
    runtimeProof: { issue: (turnId, text) => proof.issue({ ...base, turnId }, text), readOutput: proof.readOutput },
    usage: { emit(event) { usage.push(event); } },
  });
  await bridge.open();
  check("ears open alone does not grant microphone readiness", sent.length === 0);
  bridge.ready(); bridge.receive(JSON.stringify({ type: "start", sampleRate: 16000 }));
  await bridge.receive(new ArrayBuffer(2560));
  ears.startOfTurn("Hello", 0); ears.partial("Hello Paige", 0); ears.final("Hello Paige.", 0);
  const dispatch = await dispatchReady;
  const scope = (await proof.readChallenge(dispatch.challenge))!;
  return { bridge, sent, spoken, usage, dispatch, scope, ears, closes: () => closes };
}
const f = await fixture();
check("challenge binds exact observed final transcript", f.scope.transcriptHash === await liveRuntimeDigest("Hello Paige."));
check("challenge cannot be used as output", await proof.readOutput(f.dispatch.challenge) === null);
const tokens = await outputTokens(f.scope);
for (const token of tokens.slice(0, -1)) await f.bridge.receive(JSON.stringify({ type: "runtime.proof", turn_id: f.scope.turnId, proof: token }));
await tick();
check("signed first sentence speaks before runtime completion", f.spoken[0] === "I hear you." && !f.sent.some((s) => typeof s === "string" && s.includes('"type":"runtime.done"')));
check("provider PCM chunks are even-byte reframed", f.sent.filter((s) => s instanceof ArrayBuffer).every((s) => (s as ArrayBuffer).byteLength % 2 === 0));
await f.bridge.receive(JSON.stringify({ type: "runtime.proof", turn_id: f.scope.turnId, proof: tokens.at(-1) }));
await tick(); await tick();
check("signed done waits for mouth completion", f.sent.some((s) => typeof s === "string" && s.includes('"type":"runtime.done"')));
f.bridge.receive(JSON.stringify({ type: "playback.complete" }));
check("observed playback settles to idle", f.bridge.phase === "idle");
check("UsageSink records observed neutral units only", ["stt_audio_ms", "llm_turn", "tts_chars"].every((kind) => f.usage.some((u) => u.kind === kind)));
f.bridge.end(); f.bridge.end(); check("end remains idempotent", f.closes() === 1);

for (const attack of ["unsigned", "tamper", "replay", "gap", "wrong-scope", "after-cancel"] as const) {
  const a = await fixture();
  const valid = await outputTokens(a.scope, "Must not speak.");
  const send = (token: string) => a.bridge.receive(JSON.stringify({ type: "runtime.proof", turn_id: a.scope.turnId, proof: token }));
  if (attack === "unsigned") {
    a.bridge.receive(JSON.stringify({ type: "runtime.dispatched", turn_id: a.scope.turnId }));
    a.bridge.receive(JSON.stringify({ type: "runtime.chunk", turn_id: a.scope.turnId, text: "Forged sentence." }));
  } else if (attack === "tamper") await send(valid[0].slice(0, -3) + "bad");
  else if (attack === "replay") { await send(valid[0]); await send(valid[0]); await send(valid[1]); }
  else if (attack === "gap") await send(valid[1]);
  else if (attack === "wrong-scope") { for (const t of await outputTokens({ ...a.scope, tenantId: "other" })) await send(t); }
  else { a.bridge.receive(JSON.stringify({ type: "interrupt" })); for (const t of valid) await send(t); }
  await tick(); check(`${attack}: no mouth call`, a.spoken.length === 0);
  a.bridge.end();
}
let mouthAborted = false;
const barrier = await fixture(undefined, async (_text, signal) => new ReadableStream<Uint8Array>({ start(c) {
  c.enqueue(Uint8Array.of(1, 2));
  signal.addEventListener('abort', () => { mouthAborted = true; c.error(new Error('fixture_cancelled')); }, { once: true });
} }));
for (const token of await outputTokens(barrier.scope, 'An answer.')) {
  await barrier.bridge.receive(JSON.stringify({ type: 'runtime.proof', turn_id: barrier.scope.turnId, proof: token }));
}
await tick();
check('interrupt barrier fixture has actual in-flight mouth audio', barrier.sent.some(frame => frame instanceof ArrayBuffer));
check('completed runtime still waits while mouth audio is in flight', !barrier.sent.some(frame =>
  typeof frame === 'string' && JSON.parse(frame).type === 'runtime.done'));
barrier.bridge.receive(JSON.stringify({ type: 'interrupt', request_id: 1 }));
const barrierFrames = barrier.sent.filter((frame): frame is string => typeof frame === 'string').map(frame => JSON.parse(frame));
const ackIndex = barrierFrames.findIndex(frame => frame.type === 'interrupt.ack' && frame.request_id === 1);
check('interrupt acknowledgement follows mouth abort and playback clear', mouthAborted && ackIndex >= 0 &&
  barrierFrames.findIndex(frame => frame.type === 'clear_playback') < ackIndex);
barrier.bridge.receive(JSON.stringify({ type: 'interrupt', request_id: 2 }));
check('already-interrupted turn still acknowledges the latest barrier', barrier.sent.some(frame =>
  typeof frame === 'string' && JSON.parse(frame).type === 'interrupt.ack' && JSON.parse(frame).request_id === 2));
await tick(); await tick();
check('cancelled mouth cleanup cannot emit runtime completion after the acknowledgement', !barrier.sent.some(frame =>
  typeof frame === 'string' && JSON.parse(frame).type === 'runtime.done'));
barrier.bridge.end();
for (const request_id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
  const bad = await fixture();
  bad.bridge.receive(JSON.stringify({ type: 'interrupt', request_id }));
  check('invalid provided interrupt request ID fails closed: ' + JSON.stringify(request_id), bad.closes() === 1 &&
    bad.sent.some(frame => typeof frame === 'string' && JSON.parse(frame).type === 'unavailable') &&
    !bad.sent.some(frame => typeof frame === 'string' && JSON.parse(frame).type === 'interrupt.ack'));
  bad.bridge.end();
}
const expired = createLiveRuntimeProof("fake-only-never-a-server-secret-0123456789", () => Date.now() + 121000);
check("expired challenge rejected", await expired.readChallenge(f.dispatch.challenge) === null);
const unknown = createLiveRuntimeProof("different-fake-secret-01234567890123456789");
check("different signing key rejected", await unknown.readChallenge(f.dispatch.challenge) === null);
const truncated = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')); c.close(); } });
let incomplete = false;
try { await new Response(proof.outputStream(truncated, f.scope)).text(); } catch { incomplete = true; }
check("SSE EOF without DONE is not success", incomplete);
const chat = readFileSync(new URL("../supabase/functions/paige-ai-chat/index.ts", import.meta.url), "utf8");
check("canonical chat consumes challenge before any user-turn write", chat.indexOf('error: claimError') < chat.indexOf('p_role: "user"'));
check("canonical chat scopes claim to actor tenant thread and epoch", ['.eq("actor_user_id", user.id)', '.eq("thread_id", scope.threadId)', '.eq("context_epoch", scope.epoch)', '.eq("tenant_id", scope.tenantId)'].every((s) => chat.includes(s)));
check("spoken approval and substitute transcript are rejected", chat.includes('validatedData.approvedConfirmations?.length') && chat.includes('await liveRuntimeDigest(input[0].content) !== scope.transcriptHash'));
check("proof wraps only final caller-visible SSE, not withheld upstream data", chat.includes('liveOutput(finalStream)') && chat.includes('liveOutput(stream)') && !chat.includes('liveOutput(response.body'));
// Execute the real pure history assignment extracted from the Edge handler;
// the parser spy proves it rejoins the existing schema rather than bypassing it.
const historyAssignment = chat.slice(chat.indexOf('const liveHistory ='), chat.indexOf('// Context comes from the verified thread'))
  .replaceAll(': { role: string; content: string }', '').replaceAll(': { role: string }', '');
let schemaCalls = 0;
const hydrate = new Function('history', 'input', 'messageSchema', 'validatedData', historyAssignment);
const fiftyRows = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i + 1}` }));
const hydrated: { messages?: Array<{ role: string; content: string }> } = {};
hydrate(fiftyRows.slice(-49).reverse(), [{ role: 'user', content: 'Current spoken turn' }],
  { shape: { messages: { parse: (value: unknown) => { schemaCalls++; return value; } } } }, hydrated);
check("long-thread Live history starts with user and keeps the current utterance", schemaCalls === 1 &&
  hydrated.messages?.[0]?.role === 'user' && hydrated.messages?.at(-1)?.content === 'Current spoken turn');
let clock = 0, permitted = true, reads = 0, denied = 0;
const admission = new LiveRelayAdmission(async () => { reads++; return permitted; }, () => { denied++; }, () => clock);
check("live authority initially proves permission", await admission.check());
await admission.check();
check("fresh authority is reused without a second resolver", reads === 1);
permitted = false; clock = 500;
check("revocation blocks the first expired authority check", !await admission.check() && denied === 1);
permitted = true;
check("revoked socket never silently regains admission", !await admission.check(true) && reads === 2);
const unavailableAdmission = new LiveRelayAdmission(async () => { throw new Error("database unavailable"); }, () => {});
check("authority store failure is fail closed", !await unavailableAdmission.check());
let completeRead!: (value: boolean) => void;
const checkingAdmission = new LiveRelayAdmission(() => new Promise<boolean>((resolve) => { completeRead = resolve; }), () => {});
const waiting = checkingAdmission.check(); await tick();
check("parallel PCM checks await the same in-flight decision", checkingAdmission.check() === waiting);
checkingAdmission.stop(); completeRead(true);
check("late authority completion cannot reopen a closed socket", !await waiting);
let enabled = true;
const revoking = await fixture(async () => enabled);
const observedBefore = revoking.usage.filter((event) => event.kind === "stt_audio_ms").length;
enabled = false;
await revoking.bridge.receive(new ArrayBuffer(2560));
check("revoked capture forwards no new PCM and closes honestly", revoking.closes() === 1 &&
  revoking.usage.filter((event) => event.kind === "stt_audio_ms").length === observedBefore &&
  revoking.sent.some((frame) => typeof frame === "string" && JSON.parse(frame).type === "unavailable"));
let openAllowed = true, cancelledEars = 0;
const midOpenFrames: Array<string | ArrayBuffer> = [];
const midOpen = new PaigeLiveRelayBridge({
  sessionId: base.sessionId, epoch: base.epoch, authorize: async () => openAllowed,
  send: (frame) => midOpenFrames.push(frame), close() {},
  openEars: async () => { openAllowed = false; return { ok: true, ears: { sendPcm: () => 0, close() {}, cancel() { cancelledEars++; } } }; },
  openMouth: async () => { throw new Error("must_not_open"); }, usage: { emit() {} },
  runtimeProof: { issue: (turnId, text) => proof.issue({ ...base, turnId }, text), readOutput: proof.readOutput },
});
const opened = await midOpen.open(); midOpen.ready();
check("revoked during ears open never earns ready and cancels ears", !opened && cancelledEars === 1 &&
  !midOpenFrames.some((frame) => typeof frame === "string" && JSON.parse(frame).type === "ready"));
const edge = readFileSync(new URL("../supabase/functions/paige-live-relay/index.ts", import.meta.url), "utf8").replace(/\r/g, '');
// Execute the production admission body with a database double. PostgreSQL
// proof/role semantics are separately exercised by the pilot pgTAP suite.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const admissionBody = edge.slice(edge.indexOf('const checkCurrentAdmission = async (recheckProvider = true): Promise<Response | null> => {') +
  'const checkCurrentAdmission = async (recheckProvider = true): Promise<Response | null> => {'.length,
  edge.indexOf('  };\n  // Initial identity')).replace(': string | null', '');
const resolveAdmission = new AsyncFunction('admin', 'session', 'markUnavailable',
  'hasLiveWorkspaceStanding', 'isLiveWorkspaceCurrent', 'isLiveAudioPilotEnabled', 'readProviderAdmission', 'recheckProvider = true', admissionBody);
const approvedVoice = 'g6xIsTj2HwM6VR4iXFCw';
let providerRows: Record<string, Record<string, unknown>>;
const resetProviderRows = () => { providerRows = {
  paige_voice_profiles: { provider: 'elevenlabs', provider_voice_ref: approvedVoice, revision: 'elevenlabs-jessica-take5-r1',
    active: false },
}; };
resetProviderRows();
let providerReadError = false;
const providerDb = { from(table: string) {
  if (table !== 'paige_voice_profiles') throw new Error('unexpected legacy provider proof read');
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({
    error: providerReadError ? { code: 'fixture' } : null, data: providerRows[table],
  }) }; return q;
} };
const readerMarker = 'const readProviderAdmission = async () => {';
const readerStart = edge.indexOf(readerMarker);
const providerReaderBody = readerStart < 0 ? 'return { unavailableCode: null };' :
  edge.slice(readerStart + readerMarker.length, edge.indexOf('\n  };', readerStart));
const readProviderAdmission = () => new AsyncFunction('admin', 'APPROVED_PAIGE_ELEVENLABS_VOICE_ID',
  'resolveElevenLabsModel', 'envKey', providerReaderBody)(providerDb, approvedVoice, () => 'eleven_v3_conversational',
    (key: string) => ['ELEVENLABS_API_KEY', 'DEEPGRAM_API_KEY', 'PAIGE_LIVE_STREAM_SIGNING_KEY'].includes(key)
      ? 'fake-only-config-012345678901234567890123456789' : null);
let pilotAuthorized: boolean | undefined = false;
let pilotReadError = false;
let checkedSession = { id: base.sessionId, tenant_id: base.tenantId, actor_user_id: base.actorId };
const admissionDb = {
  async rpc(name: string, args: Record<string, string>) {
    if (name !== 'paige_live_pilot_authorized_internal') throw new Error('unexpected admission RPC');
    return { error: pilotReadError ? { code: 'fixture' } : null, data: pilotAuthorized === true &&
      args._actor_user_id === base.actorId && args._tenant_id === base.tenantId };
  },
  from(table: string) {
  if (table === 'paige_voice_readiness' || table === 'paige_voice_provider_verifications') throw new Error('unexpected legacy admission proof read');
  const query = { select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ error: null, data: table === 'profiles'
      ? { active_tenant_id: base.tenantId } : { id: 'valid', enabled: true } }) };
  return query;
} };
let masterDenied = 0;
const masterCheck = async () => (await resolveAdmission(admissionDb,
  checkedSession,
  async () => { masterDenied++; return true; }, () => true, () => true, () => true, readProviderAdmission)) === null;
for (const value of [false, undefined]) {
  pilotAuthorized = value;
  check(`scoped pilot ${String(value)} refuses admission without exact authorization`, !await masterCheck());
}
pilotAuthorized = true;
check('exact scoped pilot admits default retention without legacy transport or proof flags', await masterCheck());
for (const role of ['member', 'admin', 'owner', 'platform']) {
  checkedSession = { ...checkedSession, actor_user_id: `other-${role}` };
  check(`other ${role} account refused before adapters`, !await masterCheck());
}
checkedSession = { ...checkedSession, actor_user_id: base.actorId, tenant_id: 'other-tenant' };
check('same account in a different tenant is refused', !await masterCheck());
checkedSession = { id: base.sessionId, tenant_id: base.tenantId, actor_user_id: base.actorId };
pilotReadError = true;
check('authorization store error fails closed', !await masterCheck());
pilotReadError = false;
pilotAuthorized = false;
let blockedOpens = 0;
const disabledBridge = new PaigeLiveRelayBridge({
  sessionId: base.sessionId, epoch: base.epoch, authorize: masterCheck, send() {}, close() {},
  openEars: async () => { blockedOpens++; return { ok: false, code: 'must_not_open' }; },
  openMouth: async () => { blockedOpens++; throw new Error('must_not_open'); }, usage: { emit() {} },
  runtimeProof: { issue: (turnId, text) => proof.issue({ ...base, turnId }, text), readOutput: proof.readOutput },
});
await disabledBridge.open();
check('disabled scoped pilot opens neither provider adapter', blockedOpens === 0 && masterDenied >= 3);

pilotAuthorized = true;
for (const [table, field, bad] of [
  ['paige_voice_profiles', 'provider_voice_ref', 'wrong-voice'],
  ['paige_voice_profiles', 'provider', 'wrong-provider'],
  ['paige_voice_profiles', 'active', true],
  ['paige_voice_profiles', 'revision', 'unapproved-revision'],
] as [string, string, unknown][]) {
  resetProviderRows();
  check(`approval present before revoking ${table}.${field}`, await masterCheck());
  providerRows[table][field] = bad;
  check(`recurring admission rejects revoked ${table}.${field}`, !await masterCheck());
}
resetProviderRows(); providerReadError = true;
check('provider approval read failure is closed', !await masterCheck());
providerReadError = false;
resetProviderRows();
providerRows.paige_voice_profiles.provider_voice_ref = 'wrong-voice';
const initialStart = edge.indexOf('  const admissionFailure = await checkCurrentAdmission');
const initialEnd = edge.indexOf('\n  const { socket, response } = Deno.upgradeWebSocket(req);\n  const markLive', initialStart);
const initialBody = edge.slice(initialStart, initialEnd).replace('new Promise<void>', 'new Promise');
const initialFrames: string[] = [];
let initialUpgrades = 0;
const initialSocket = { onopen: null as (() => void) | null, onclose: null as (() => void) | null,
  onmessage: null as (() => void) | null, send: (frame: string) => initialFrames.push(frame), close() {} };
const initialResponse = await new AsyncFunction('checkCurrentAdmission', 'readProviderAdmission', 'markUnavailable',
  'Deno', 'req', 'waitUntil', 'setTimeout', initialBody)(
    (...args: unknown[]) => resolveAdmission(admissionDb,
      { id: base.sessionId, tenant_id: base.tenantId, actor_user_id: base.actorId },
      async () => true, () => true, () => true, () => true, readProviderAdmission, ...args),
    readProviderAdmission, async () => true,
    { upgradeWebSocket() { initialUpgrades++; return { socket: initialSocket, response: 'upgraded' }; } },
    {}, () => {}, () => {});
initialSocket.onopen?.();
check('initial provider refusal upgrades only to deliver the honest unavailable frame',
  initialResponse === 'upgraded' && initialUpgrades === 1 && initialFrames.length === 1 &&
  JSON.parse(initialFrames[0]).type === 'unavailable' && JSON.parse(initialFrames[0]).code === 'approved_voice_unavailable');
resetProviderRows();
check('held final transcript can issue its authenticated runtime challenge',
  /\.eq\("availability", "LIVE"\)\.in\("state", \[[^\]]*"held"/.test(edge));
check('held in-flight runtime can consume its authenticated one-use claim',
  /\.eq\("availability", "LIVE"\)\.in\("state", \[[^\]]*"held"/.test(chat));

// Run the actual socket close callback. Durable minimize/restore/end belongs to
// the existing authenticated control plane, independent of close delivery order.
const closeBody = edge.slice(edge.indexOf('socket.onclose = () => {', edge.indexOf('const bridge =')) +
  'socket.onclose = () => {'.length, edge.indexOf('    socket.onerror =', edge.indexOf('const bridge =')))
  .replace(/\r/g, '').replace(/\s*};\s*$/, '');
for (const minimizeFirst of [false, true]) {
  let state = minimizeFirst ? 'minimized' : 'listening';
  let durableWrites = 0, cleaned = 0, finished!: () => void;
  const finishedClose = new Promise<void>((resolve) => { finished = resolve; });
  const closeDb = { from() {
    const query = { update(value: { state: string }) { state = value.state; durableWrites++; return query; },
      eq: () => query, neq: () => query };
    return query;
  } };
  new Function('admin', 'session', 'admissionTimer', 'admission', 'bridge', 'failureWrite', 'resolve', closeBody)
    (closeDb, {}, undefined, { stop() { cleaned++; } }, { end() { cleaned++; } }, null, finished);
  await finishedClose;
  // The existing control-plane transition refuses ended sessions.
  if (!minimizeFirst && state !== 'ended') state = 'minimized';
  check(`minimize ${minimizeFirst ? 'before' : 'after'} socket close remains resumable`,
    state === 'minimized' && durableWrites === 0 && cleaned === 2);
}
check("production reuses admission resolver before ready and throughout capture", edge.includes('async () => (await checkCurrentAdmission()) === null') &&
  edge.includes('authorize: (force) => admission.check(force)') && edge.includes('setInterval(() => { waitUntil(admission.check(true)); }, 500)'));
// Capture the complete production request handler; only imported platform boundaries are supplied.
const sessionSource = readFileSync(new URL('../supabase/functions/paige-live-session/index.ts', import.meta.url), 'utf8');
type SessionHandler = (request: Request) => Promise<Response>;
function sessionHandler(createClient: (...args: any[]) => unknown, source = sessionSource): SessionHandler {
  let captured: SessionHandler | undefined;
  const code = transformSync(source.replace(/^import .*;\r?$/gm, ''), { loader: 'ts', format: 'esm', target: 'es2022' }).code;
  new Function('serve', 'createClient', 'z', 'Deno', 'isLiveAudioPilotEnabled', 'issueRelayTicket', 'liveContextEpochTenant', code)(
    (handler: SessionHandler) => { captured = handler; }, createClient, z,
    { env: { get: (key: string) => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service' }[key]) } },
    isLiveAudioPilotEnabled, issueRelayTicket, liveContextEpochTenant,
  );
  if (!captured) throw new Error('session_handler_not_captured');
  return captured;
}
const sessionActor = '11111111-1111-4111-8111-111111111111';
const sessionTenant = '22222222-2222-4222-8222-222222222222';
const sessionThread = '33333333-3333-4333-8333-333333333333';
const sessionRowId = '44444444-4444-4444-8444-444444444444';
const sessionBody = { action: 'relay', thread_id: sessionThread,
  context_epoch: JSON.stringify([sessionTenant, sessionActor, '', '']), entry_mode: 'embedded' };
async function driveSession(options: { actor?: string; authorization?: unknown; authorizationError?: boolean; tenantError?: boolean;
  authenticated?: boolean; header?: boolean; thread?: boolean; enabled?: boolean; writeError?: boolean; body?: Record<string, unknown>; source?: string } = {}) {
  const events: string[] = [];
  const calls: Array<{ client: string; name: string; args?: Record<string, unknown> }> = [];
  const writes: Array<{ table: string; value: Record<string, unknown> }> = [];
  const clients: Array<{ key: string; auth: string | undefined }> = [];
  const actor = options.actor ?? sessionActor;
  const createClient = (_url: string, key: string, config?: any) => {
    const client = key === 'fixture-anon' ? 'caller' : 'service';
    clients.push({ key, auth: config?.global?.headers?.Authorization });
    return {
      auth: { getUser: async () => { events.push('authenticated'); return { data: { user: options.authenticated === false ? null : { id: actor } }, error: null }; } },
      rpc: async (name: string, args?: Record<string, unknown>) => {
        calls.push({ client, name, args }); events.push(name);
        if (name === 'current_user_tenant_id') return { data: sessionTenant, error: options.tenantError ? { code: 'fixture' } : null };
        if (name === 'paige_live_pilot_authorized_internal') return {
          data: Object.hasOwn(options, 'authorization') ? options.authorization : args?._actor_user_id === sessionActor && args?._tenant_id === sessionTenant,
          error: options.authorizationError ? { code: 'fixture' } : null,
        };
        throw new Error('unexpected session RPC ' + name);
      },
      from(table: string) {
        const filters: Array<[string, unknown]> = [];
        let write = false;
        const result = async () => {
          if (table === 'paige_chat_threads') return { error: null, data: options.thread !== false &&
            filters.some(([key, value]) => key === 'caller_user_id' && value === actor) &&
            filters.some(([key, value]) => key === 'tenant_id' && value === sessionTenant) &&
            filters.some(([key, value]) => key === 'id' && value === sessionThread) ? { id: sessionThread } : null };
          if (table === 'paige_live_tenant_availability') return { error: null, data: { enabled: options.enabled !== false } };
          if (table === 'paige_live_sessions' && write) return { error: options.writeError ? { code: 'fixture' } : null, data: options.writeError ? null : { id: sessionRowId } };
          throw new Error('unexpected session table ' + table);
        };
        const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
          neq: () => query, insert: (value: Record<string, unknown>) => { write = true; writes.push({ table, value }); events.push('ticket-write'); return query; },
          update: (value: Record<string, unknown>) => { write = true; writes.push({ table, value }); events.push('ticket-write'); return query; },
          maybeSingle: result, single: result };
        return query;
      },
    };
  };
  const response = await sessionHandler(createClient, options.source)(new Request('https://fixture.invalid/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(options.header === false ? {} : { Authorization: 'Bearer fixture-only' }) },
    body: JSON.stringify({ ...sessionBody, ...options.body }),
  }));
  return { status: response.status, body: await response.json(), events, calls, writes, clients };
}
const ticketed = await driveSession();
const checkedTicket = await validateRelayTicket(ticketed.body.ticket);
check('session handler issues a digest-backed ticket only after exact scoped admission', ticketed.status === 200 && ticketed.body.code === 'relay_ticket_issued'
  && ticketed.body.availability === 'PROOF OWED' && ticketed.writes.length === 1 && !!checkedTicket
  && ticketed.writes[0].value.provider_session_ref === checkedTicket.storedDigest
  && ticketed.events.indexOf('paige_live_pilot_authorized_internal') < ticketed.events.indexOf('ticket-write'));
check('session caller identity is authenticated with the forwarded bearer', ticketed.clients[0].auth === 'Bearer fixture-only'
  && ticketed.events[0] === 'authenticated' && ticketed.calls[0].client === 'caller');
const otherAccount = await driveSession({ actor: '55555555-5555-4555-8555-555555555555', body: { actor_user_id: sessionActor, tenant_id: 'forged-tenant' } });
check('session handler refuses another account in the same workspace before ticket insertion', otherAccount.body.availability === 'UNAVAILABLE'
  && otherAccount.writes.length === 0 && otherAccount.calls.some((call) => call.name === 'paige_live_pilot_authorized_internal'
    && call.args?._actor_user_id === '55555555-5555-4555-8555-555555555555' && call.args?._tenant_id === sessionTenant));
for (const value of [false, null, 'true', 1, {}]) {
  const result = await driveSession({ authorization: value });
  check('session admission requires literal RPC true: ' + JSON.stringify(value), result.body.availability === 'UNAVAILABLE' && result.writes.length === 0 && !result.body.ticket);
}
const brokenAdmission = await driveSession({ authorization: true, authorizationError: true });
check('session authorization RPC error prevents ticket insertion', brokenAdmission.body.availability === 'UNAVAILABLE' && brokenAdmission.writes.length === 0);
// The availability row is no longer read here (§18: the predicate owns the admission question and
// honours BOTH of that row's meanings — enabled=true admits outright, enabled=false is a kill
// switch). A disabled workspace is still refused; it is refused because the PREDICATE refuses it,
// against the real table, which the pgTAP suite proves. This asserts the seam that replaced the
// old short-circuit: the handler consults the predicate and does not substitute its own answer.
const workspaceDisabled = await driveSession({ enabled: false, authorization: false });
check('a workspace the predicate refuses issues no ticket', workspaceDisabled.body.availability === 'UNAVAILABLE'
  && workspaceDisabled.writes.length === 0
  && workspaceDisabled.calls.some((call) => call.name === 'paige_live_pilot_authorized_internal'));
// `enabled:false` beside an admitting predicate is not a reachable production state — the predicate
// reads that row itself. It exists here only to prove the stale second gate is gone: were it still
// present, this would short-circuit and never reach the predicate at all.
const availabilityNotSecondGuessed = await driveSession({ enabled: false, authorization: true });
check('the handler no longer short-circuits on the availability row', availabilityNotSecondGuessed.calls
  .some((call) => call.name === 'paige_live_pilot_authorized_internal'));
const suppliedScope = await driveSession({ body: { actor_user_id: 'forged-actor', tenant_id: 'forged-tenant' } });
check('session request cannot replace canonical actor or tenant', suppliedScope.writes.length === 1 && suppliedScope.writes[0].value.actor_user_id === sessionActor
  && suppliedScope.writes[0].value.tenant_id === sessionTenant);
for (const [label, options, status] of [
  ['no bearer', { header: false }, 401], ['invalid identity', { authenticated: false }, 401],
  ['unresolved tenant', { tenantError: true }, 409], ['unowned thread', { thread: false }, 403],
  ['stale epoch', { body: { context_epoch: 'another-tenant|scope' } }, 409],
] as const) {
  const result = await driveSession(options);
  check('session ' + label + ' cannot issue a ticket', result.status === status && result.writes.length === 0 && !result.body.ticket);
}
const failedTicket = await driveSession({ writeError: true });
check('session failed ticket persistence does not expose a usable ticket', failedTicket.status === 409 && !failedTicket.body.ticket && failedTicket.body.code === 'relay_ticket_unavailable');
const guard = 'if (authorizationError || authorizedPilot !== true)';
if (!sessionSource.includes(guard)) throw new Error('session_negative_control_guard_not_found');
const guardRemoved = await driveSession({ authorization: false, source: sessionSource.replace(guard, 'if (false)') });
check('session negative control detects a removed admission guard', guardRemoved.body.availability !== 'UNAVAILABLE'
  && guardRemoved.writes.length === 1 && !!guardRemoved.body.ticket);
check("no real network or provider call occurred", networkCalls === 0);
globalThis.fetch = originalFetch; globalThis.WebSocket = originalWebSocket;
console.log(`\n${pass} passed, ${fail} failed; network/provider calls=${networkCalls}`);
process.exit(fail ? 1 : 0);
