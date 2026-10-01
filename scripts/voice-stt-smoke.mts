// §32 headless guard for #140 B1 (paige-stt live-call co-pilot pipe). The media-stream endpoint
// cannot be driven by a live Twilio call + real Deepgram audio in CI, so this exercises the PURE,
// key-free logic it is built on and asserts it does not throw and produces the correct output:
//   • the Twilio media-frame parser (connected/start/media/stop/mark/unknown) + μ-law base64 decode
//   • the STT route-picker: the Deepgram Nova-3 cell + URL when configured; needs_config when the
//     DEEPGRAM_API_KEY is absent (honest degrade, never a wrong-provider substitution)
//   • the stream-token mint↔verify round-trip: a valid token verifies; a TAMPERED signature, a
//     WRONG secret, an EXPIRED token, and a CALL-SID MISMATCH all reject — this is the §9 gate
//   • the voice-twiml <Start><Stream> XML: present when a stream URL is given, absent when not
//
// Run:  npm run smoke:voice-stt (the repository's Node-20 TypeScript loader)
// Exit: 0 = the pure pipe logic behaves; non-zero = a defect (fix before shipping).
//
// §13 HONEST — what this CANNOT verify (owed to a deployed call): the LIVE Deepgram Nova-3
// round-trip (needs the real DEEPGRAM_API_KEY, a Supabase edge secret absent here, + real 8 kHz
// μ-law audio), the Twilio Media Stream connecting to the deployed wss endpoint, the Realtime
// broadcast reaching a B2 subscriber, and the platform_usage_events meter row landing on prod.
// Those are the OWED live checks (§32) — this smoke does NOT fake a passing Deepgram round-trip.

// stt-router → env-key.ts reads Deno.env (get + toObject); shim BOTH so the module imports in Node.
const env: Record<string, string | undefined> = {};
(globalThis as unknown as { Deno?: unknown }).Deno = {
  env: {
    get: (k: string) => env[k],
    toObject: () => ({ ...env }) as Record<string, string>,
  },
};

const { parseTwilioFrame, decodeMediaPayload, TWILIO_MEDIA_FRAME_MS } = await import(
  "../supabase/functions/_shared/twilio-media.ts"
);
const { planSttStream, resolveSttRoute, buildDeepgramStreamUrl, sttConfigured, extractDeepgramTranscript, extractDeepgramFluxTurn, openDeepgramSocket } =
  await import("../supabase/functions/_shared/stt-router.ts");
const { mintStreamToken, verifyStreamToken } = await import(
  "../supabase/functions/_shared/voice-stream-token.ts"
);
const { buildStreamStart, buildOutboundTwiml, buildInboundTwiml } = await import(
  "../supabase/functions/voice-twiml/twiml.ts"
);

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const T = "11111111-1111-1111-1111-111111111111";
const U = "22222222-2222-2222-2222-222222222222";
const CALL = "CA00000000000000000000000000000001";
const STREAM = "MZ00000000000000000000000000000001";
const SECRET = "test_stream_secret_ABC123";

console.log("voice-stt (B1) smoke\n");

// ── Twilio media-frame parser ────────────────────────────────────────────────
console.log("twilio-media parser:");
const connected = parseTwilioFrame(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
check("connected frame", connected.event === "connected");

const startRaw = JSON.stringify({
  event: "start",
  streamSid: STREAM,
  start: {
    streamSid: STREAM,
    callSid: CALL,
    accountSid: "ACxxxx",
    tracks: ["inbound"],
    customParameters: { streamToken: "tok.abc.def", tenantId: T, callSid: CALL },
    mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
  },
});
const start = parseTwilioFrame(startRaw);
check("start frame event", start.event === "start");
check(
  "start extracts callSid",
  start.event === "start" && start.start.callSid === CALL,
  start.event === "start" ? start.start.callSid : "",
);
check(
  "start exposes customParameters.streamToken",
  start.event === "start" && start.start.customParameters.streamToken === "tok.abc.def",
);
check("start customParameters always an object", start.event === "start" && typeof start.start.customParameters === "object");

// μ-law payload decode: base64 → exact bytes.
const rawBytes = new Uint8Array([0xff, 0x7f, 0x00, 0x80, 0x2a]);
const b64 = Buffer.from(rawBytes).toString("base64");
const mediaRaw = JSON.stringify({ event: "media", streamSid: STREAM, media: { track: "inbound", payload: b64 } });
const media = parseTwilioFrame(mediaRaw);
check("media frame event", media.event === "media");
const decoded = media.event === "media" ? decodeMediaPayload(media.media.payload) : new Uint8Array();
check(
  "media payload decodes to exact μ-law bytes",
  decoded.length === rawBytes.length && rawBytes.every((v, i) => decoded[i] === v),
  `[${Array.from(decoded).join(",")}]`,
);
check("decodeMediaPayload('') → empty (no throw)", decodeMediaPayload("").length === 0);
check("decodeMediaPayload(bad base64) → empty (no throw)", decodeMediaPayload("!!!not base64!!!").length === 0);

const stop = parseTwilioFrame(JSON.stringify({ event: "stop", streamSid: STREAM, stop: { callSid: CALL } }));
check("stop frame event", stop.event === "stop");
check("mark frame parses", parseTwilioFrame(JSON.stringify({ event: "mark", streamSid: STREAM, mark: { name: "x" } })).event === "mark");
check("garbage → unknown (no throw)", parseTwilioFrame("}{not json").event === "unknown");
check("unrecognized event → unknown", parseTwilioFrame(JSON.stringify({ event: "whatever" })).event === "unknown");
check("frame-ms constant is 20", TWILIO_MEDIA_FRAME_MS === 20);

// ── STT route-picker (mirrors model-router: cell when configured, needs_config when not) ──
console.log("stt-router:");
delete env.DEEPGRAM_API_KEY; // ensure absent for the needs_config assertion
check("sttConfigured() false when key absent", sttConfigured() === false);
const planUnset = planSttStream("nova-realtime", {});
check(
  "planSttStream → needs_config when DEEPGRAM_API_KEY absent",
  planUnset.ok === false && "needs_config" in planUnset && planUnset.needs_config === true,
  JSON.stringify(planUnset),
);

env.DEEPGRAM_API_KEY = "dg_test_key_headless"; // simulate the secret being present
check("sttConfigured() true when key present", sttConfigured() === true);
const planSet = planSttStream("nova-realtime", {});
check("planSttStream ok when key present", planSet.ok === true, JSON.stringify(planSet));
check("plan targets deepgram nova-3", planSet.ok === true && planSet.provider === "deepgram" && planSet.model === "nova-3");
check(
  "plan URL is Deepgram Nova-3 μ-law/8k/mono",
  planSet.ok === true &&
    planSet.url.startsWith("wss://api.deepgram.com/v1/listen?") &&
    planSet.url.includes("model=nova-3") &&
    planSet.url.includes("encoding=mulaw") &&
    planSet.url.includes("sample_rate=8000") &&
    planSet.url.includes("channels=1"),
  planSet.ok === true ? planSet.url : "",
);
check("plan URL never contains the key (§13)", planSet.ok === true && !planSet.url.includes("dg_test_key_headless"));
const cell = resolveSttRoute("nova-realtime");
check("resolveSttRoute returns the deepgram cell", !!cell && cell.provider === "deepgram");
check("buildDeepgramStreamUrl is pure/deterministic", cell ? buildDeepgramStreamUrl(cell) === buildDeepgramStreamUrl(cell) : false);
const fluxCell = resolveSttRoute("flux-realtime");
check("Flux resolves through the one STT router", !!fluxCell && fluxCell.host === "wss://api.deepgram.com/v2/listen" && fluxCell.model === "flux-general-en");
const fluxPlan = planSttStream("flux-realtime", { encoding: "linear16", sampleRate: 16000 });
check("Flux plan carries PCM format and mandatory MIP opt-out", fluxPlan.ok === true && fluxPlan.url.includes("encoding=linear16") && fluxPlan.url.includes("sample_rate=16000") && new URL(fluxPlan.url).searchParams.get("mip_opt_out") === "true");
check("Nova plan also carries mandatory MIP opt-out", planSet.ok === true && new URL(planSet.url).searchParams.get("mip_opt_out") === "true");
const oldSocket = globalThis.WebSocket;
let openedUrl = "";
let openedProtocols: string[] = [];
(globalThis as unknown as { WebSocket: unknown }).WebSocket = class {
  constructor(url: string, protocols: string[]) { openedUrl = url; openedProtocols = protocols; }
};
try {
  openDeepgramSocket("wss://api.deepgram.com/v2/listen?model=flux-general-en&mip_opt_out=false");
  check("socket opener overrides a caller's false MIP flag", new URL(openedUrl).searchParams.get("mip_opt_out") === "true");
  openDeepgramSocket("wss://api.deepgram.com/v1/listen?model=nova-3");
  check("socket opener adds absent MIP flag", new URL(openedUrl).searchParams.get("mip_opt_out") === "true");
  check("socket opener keeps server-side token auth", openedProtocols[0] === "token" && openedProtocols[1] === "dg_test_key_headless");
  check("socket opener never sends the key to another host", openDeepgramSocket("wss://example.test/v2/listen") === null);
  check("socket opener fails closed on malformed URL", openDeepgramSocket("not-a-url") === null);
} finally { (globalThis as unknown as { WebSocket: unknown }).WebSocket = oldSocket; }
delete env.DEEPGRAM_API_KEY; // leave env clean for downstream

// Deepgram transcript extractor: real Results → transcript; control frames → null.
console.log("deepgram transcript extractor:");
const dgResults = JSON.stringify({
  type: "Results",
  is_final: true,
  speech_final: true,
  channel: { alternatives: [{ transcript: "hello there", confidence: 0.98 }] },
});
const tr = extractDeepgramTranscript(dgResults);
check("extracts final transcript", !!tr && tr.transcript === "hello there" && tr.isFinal === true);
check("Metadata control frame → null", extractDeepgramTranscript(JSON.stringify({ type: "Metadata" })) === null);
check("empty transcript → null (no broadcast)", extractDeepgramTranscript(JSON.stringify({ type: "Results", channel: { alternatives: [{ transcript: "" }] } })) === null);
check("garbage → null (no throw)", extractDeepgramTranscript("}{") === null);
const fluxPartial = extractDeepgramFluxTurn(JSON.stringify({ type: "TurnInfo", event: "Update", turn_index: 2, sequence_id: 7, transcript: "hello" }));
check("Flux Update is partial", fluxPartial?.transcript === "hello" && fluxPartial?.isFinal === false && fluxPartial?.turnIndex === 2);
const fluxFinal = extractDeepgramFluxTurn(JSON.stringify({ type: "TurnInfo", event: "EndOfTurn", turn_index: 2, sequence_id: 8, transcript: "hello there" }));
check("Flux EndOfTurn is final", fluxFinal?.transcript === "hello there" && fluxFinal?.isFinal === true && fluxFinal?.sequenceId === 8);
check("Flux control frame is ignored", extractDeepgramFluxTurn(JSON.stringify({ type: "Connected", sequence_id: 0 })) === null);
check("Flux JSON null is ignored without throwing", extractDeepgramFluxTurn("null") === null);
check("Flux JSON array is ignored without throwing", extractDeepgramFluxTurn("[]") === null);

// ── Stream-token mint↔verify: the §9 gate ────────────────────────────────────
console.log("stream-token (§9 gate):");
const token = await mintStreamToken({ secret: SECRET, tenantId: T, callSid: CALL });
check("token has 3 dot-parts (v1.payload.sig)", token.split(".").length === 3 && token.startsWith("v1."));

const good = await verifyStreamToken(SECRET, token, { expectedCallSid: CALL });
check("valid token verifies", good.ok === true, JSON.stringify(good));
check("verified tenantId matches (derived from token, not body)", good.ok === true && good.tenantId === T);
check("verified callSid matches", good.ok === true && good.callSid === CALL);
// #140 B3 FIX-1 — a token minted WITHOUT a contactId yields contactId=null (backward-compatible:
// byte-identical pre-B3 payload; the copilot no-ops contact-linking on null, §13).
check("token WITHOUT ct → verified contactId is null", good.ok === true && good.contactId === null, JSON.stringify(good));

// A token minted WITH a contactId round-trips it through the SIGNED payload (§9 — non-forgeable;
// paige-stt derives the client link from the verified token, never a raw stream parameter).
const CONTACT = "33333333-3333-3333-3333-333333333333";
const tokenWithContact = await mintStreamToken({ secret: SECRET, tenantId: T, callSid: CALL, contactId: CONTACT });
const withContact = await verifyStreamToken(SECRET, tokenWithContact, { expectedCallSid: CALL });
check("token WITH ct verifies", withContact.ok === true, JSON.stringify(withContact));
check("verified contactId round-trips from the signed token", withContact.ok === true && withContact.contactId === CONTACT);
check("ct token still binds tenant + call", withContact.ok === true && withContact.tenantId === T && withContact.callSid === CALL);
// A blank/empty contactId is treated as absent (never stamps an empty ct) → contactId null.
const tokenBlankContact = await mintStreamToken({ secret: SECRET, tenantId: T, callSid: CALL, contactId: "" });
const blankContact = await verifyStreamToken(SECRET, tokenBlankContact, { expectedCallSid: CALL });
check("blank contactId minted as absent → verified contactId null", blankContact.ok === true && blankContact.contactId === null);
// Tampering a ct-bearing token still rejects (the contact link is inside the HMAC-signed payload).
const tamperedCt = tokenWithContact.slice(0, -3) + (tokenWithContact.slice(-3) === "AAA" ? "BBB" : "AAA");
check("TAMPERED ct token rejects (contact link is signed)", (await verifyStreamToken(SECRET, tamperedCt, { expectedCallSid: CALL })).ok === false);

const tampered = token.slice(0, -3) + (token.slice(-3) === "AAA" ? "BBB" : "AAA");
const tamperedRes = await verifyStreamToken(SECRET, tampered, { expectedCallSid: CALL });
check("TAMPERED signature rejects", tamperedRes.ok === false, JSON.stringify(tamperedRes));

const wrongSecret = await verifyStreamToken("some_other_secret", token, { expectedCallSid: CALL });
check("WRONG secret rejects", wrongSecret.ok === false && wrongSecret.reason === "bad_signature");

const wrongCall = await verifyStreamToken(SECRET, token, { expectedCallSid: "CAdifferentcallsid" });
check("CALL-SID MISMATCH rejects", wrongCall.ok === false && wrongCall.reason === "call_sid_mismatch");

// Expired: mint with a clock in the past so exp <= now.
const expiredToken = await mintStreamToken({ secret: SECRET, tenantId: T, callSid: CALL, ttlSeconds: 60, nowMs: Date.now() - 3_600_000 });
const expiredRes = await verifyStreamToken(SECRET, expiredToken, { expectedCallSid: CALL });
check("EXPIRED token rejects", expiredRes.ok === false && expiredRes.reason === "expired");

check("empty token rejects", (await verifyStreamToken(SECRET, "", {})).ok === false);
check("empty secret rejects", (await verifyStreamToken("", token, {})).ok === false);
check("malformed token rejects", (await verifyStreamToken(SECRET, "not-a-token", {})).ok === false);
// mint MUST refuse to sign an unbound token (would defeat the §9 gate).
let threwOnBlankTenant = false;
try { await mintStreamToken({ secret: SECRET, tenantId: "", callSid: CALL }); } catch { threwOnBlankTenant = true; }
check("mint refuses blank tenantId (never an unbound token)", threwOnBlankTenant);

// ── voice-twiml <Start><Stream> XML: present when flagged, absent when not (§37 contract) ──
console.log("voice-twiml <Start><Stream> fork:");
const streamXml = buildStreamStart("wss://ref.functions.supabase.co/functions/v1/paige-stt", {
  streamToken: token,
  tenantId: T,
  callSid: CALL,
});
check("buildStreamStart emits <Start><Stream>", streamXml.startsWith("<Start><Stream url=") && streamXml.endsWith("</Stream></Start>"));
check("stream carries the token <Parameter>", streamXml.includes('<Parameter name="streamToken"'));
check("buildStreamStart('') → '' (no URL, no fork)", buildStreamStart("") === "");
check("empty param values dropped (no unauth stream)", !buildStreamStart("wss://x", { streamToken: "" }).includes("streamToken"));

// Builders: fork present when streamXml passed, and ABSENT (byte-identical A3 output) when not.
const outWith = buildOutboundTwiml("+14155550100", "+14155559999", streamXml);
const outWithout = buildOutboundTwiml("+14155550100", "+14155559999");
check("outbound WITH stream contains the fork before <Dial>", outWith.includes("<Start><Stream") && outWith.indexOf("<Start>") < outWith.indexOf("<Dial"));
check("outbound WITHOUT stream has NO <Start> (OFF = unchanged)", !outWithout.includes("<Start>"));
check("outbound WITHOUT stream still bridges", outWithout.includes("<Dial") && outWithout.includes("<Number>+14155559999</Number>"));

const inWith = buildInboundTwiml([`${T}.${U}`], streamXml);
const inWithout = buildInboundTwiml([`${T}.${U}`]);
check("inbound WITH stream contains the fork before <Dial>", inWith.includes("<Start><Stream") && inWith.indexOf("<Start>") < inWith.indexOf("<Dial"));
check("inbound WITHOUT stream has NO <Start> (OFF = unchanged)", !inWithout.includes("<Start>"));

// Live Conversation attaches to the same Flux router. The opener below is fake:
// these checks must never create a provider socket or send real audio.
console.log("live Flux ears adapter:");
const { openFluxEars } = await import("../supabase/functions/_shared/paige-live-flux-ears.ts");
const missingEars = await openFluxEars({ startOfTurn() {}, partial() {}, final() {}, unavailable() {} });
check("live ears fail closed without the server key", !missingEars.ok && missingEars.code === "stt_not_configured");
env.DEEPGRAM_API_KEY = "local-presence-only";
const previousWebSocket = globalThis.WebSocket;
class FakeFluxSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeFluxSocket.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; wasClean: boolean }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readonly sent: Array<string | ArrayBuffer> = [];
  send(value: string | ArrayBuffer) { this.sent.push(value); }
  close(code = 1000, wasClean = true) { this.readyState = FakeFluxSocket.CLOSED; this.onclose?.({ code, wasClean }); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeFluxSocket;
const fakeFlux = new FakeFluxSocket();
const seenFlux: string[] = [];
let plannedFluxUrl = "";
const opening = openFluxEars({
  startOfTurn(text) { seenFlux.push(`start:${text}`); },
  partial(text) { seenFlux.push(`partial:${text}`); },
  final(text) { seenFlux.push(`final:${text}`); },
  unavailable() { seenFlux.push("unavailable"); },
}, { opener(url) { plannedFluxUrl = url; queueMicrotask(() => fakeFlux.onopen?.()); return fakeFlux as unknown as WebSocket; } });
const openedFlux = await opening;
check("live ears reuse Flux /v2 with mandatory MIP opt-out", openedFlux.ok && new URL(plannedFluxUrl).pathname === "/v2/listen" && new URL(plannedFluxUrl).searchParams.get("mip_opt_out") === "true");
if (openedFlux.ok) {
  check("live ears send 80 ms PCM and meter only observed audio", openedFlux.ears.sendPcm(new ArrayBuffer(2560)) === 80 && fakeFlux.sent[0] instanceof ArrayBuffer);
  check("a tiny accepted PCM frame never reports zero duration", openedFlux.ears.sendPcm(new ArrayBuffer(2))! > 0);
  check("live ears reject malformed PCM before provider send", openedFlux.ears.sendPcm(new ArrayBuffer(3)) === null && fakeFlux.sent.length === 2);
  fakeFlux.receive({ type: "TurnInfo", event: "StartOfTurn", turn_index: 0, sequence_id: 1, transcript: "Hello" });
  fakeFlux.receive({ type: "TurnInfo", event: "Update", turn_index: 0, sequence_id: 2, transcript: "Hello Paige" });
  fakeFlux.receive({ type: "TurnInfo", event: "EndOfTurn", turn_index: 0, sequence_id: 3, transcript: "Hello Paige." });
  fakeFlux.receive({ type: "TurnInfo", event: "EndOfTurn", turn_index: 0, sequence_id: 3, transcript: "duplicate" });
  check("Flux start, partial and final preserve ordering without duplicate turns", seenFlux.join("|") === "start:Hello|partial:Hello Paige|final:Hello Paige.");
  // BARGE-IN. Flux announces StartOfTurn the moment a speaker begins, BEFORE a word is
  // transcribed, so the event necessarily carries an empty transcript. The extractor used to
  // require non-empty text and dropped every one, which made the ears' startOfTurn dispatch dead
  // code: Paige kept talking until Deepgram had transcribed actual words. This is the assertion
  // that the earliest possible "they started speaking" signal now reaches the turn state machine.
  fakeFlux.receive({ type: "TurnInfo", event: "StartOfTurn", turn_index: 1, sequence_id: 4, transcript: "" });
  check("empty StartOfTurn reaches the bridge, so barge-in fires on speech not on transcription",
    seenFlux[seenFlux.length - 1] === "start:");
  // The relaxation is scoped to StartOfTurn only. An empty Update or EndOfTurn still carries
  // nothing and must not be promoted into a turn.
  const beforeEmpty = seenFlux.length;
  fakeFlux.receive({ type: "TurnInfo", event: "Update", turn_index: 1, sequence_id: 5, transcript: "   " });
  fakeFlux.receive({ type: "TurnInfo", event: "EndOfTurn", turn_index: 1, sequence_id: 6, transcript: "" });
  check("an empty Update or EndOfTurn is still dropped", seenFlux.length === beforeEmpty);
  // Turn detection is no longer left at the provider's defaults.
  check("Flux turn detection is explicitly bounded, not left implicit",
    new URL(plannedFluxUrl).searchParams.get("eot_threshold") === "0.6" &&
    new URL(plannedFluxUrl).searchParams.get("eot_timeout_ms") === "2000");
  openedFlux.ears.close();
  check("clean end sends Flux CloseStream without treating it as a provider failure", fakeFlux.sent.some((value) => value === '{"type":"CloseStream"}') && !seenFlux.includes("unavailable"));
  // sequence_id 7 because the barge-in assertions above legitimately consume 4-6; Flux sequence
  // ids are monotonic per socket, so a trailing flush necessarily follows them.
  fakeFlux.receive({ type: "TurnInfo", event: "Update", turn_index: 1, sequence_id: 7, transcript: "Trailing thought" });
  fakeFlux.close(1005, true);
  check("CloseStream flush Update becomes one final utterance on close", seenFlux.at(-1) === "final:Trailing thought");
}
const cancelledFlux = new FakeFluxSocket();
const cancelledSeen: string[] = [];
const cancelledOpening = openFluxEars({
  startOfTurn() {}, partial(text) { cancelledSeen.push(`partial:${text}`); },
  final(text) { cancelledSeen.push(`final:${text}`); }, unavailable() {},
}, { opener() { queueMicrotask(() => cancelledFlux.onopen?.()); return cancelledFlux as unknown as WebSocket; } });
const cancelledResult = await cancelledOpening;
if (cancelledResult.ok) {
  cancelledFlux.receive({ type: "TurnInfo", event: "Update", turn_index: 0, sequence_id: 1, transcript: "Interrupted" });
  cancelledResult.ears.close();
  cancelledResult.ears.cancel();
  cancelledFlux.close();
}
check("cancel after CloseStream discards buffered partial instead of finalizing it", !cancelledSeen.some((item) => item.startsWith("final:")));
const droppedFlux = new FakeFluxSocket();
const droppedSeen: string[] = [];
const droppedOpening = openFluxEars({
  startOfTurn() {}, partial() {}, final(text) { droppedSeen.push(text); }, unavailable() {},
}, { opener() { queueMicrotask(() => droppedFlux.onopen?.()); return droppedFlux as unknown as WebSocket; } });
const droppedResult = await droppedOpening;
if (droppedResult.ok) {
  droppedFlux.receive({ type: "TurnInfo", event: "Update", turn_index: 0, sequence_id: 1, transcript: "Unflushed" });
  droppedResult.ears.close();
  droppedFlux.close(1006, false);
}
check("close without a post-CloseStream Update never invents a final", droppedSeen.length === 0);
const failedCloseFlux = new FakeFluxSocket();
const failedCloseSeen: string[] = [];
const failedCloseOpening = openFluxEars({
  startOfTurn() {}, partial() {}, final(text) { failedCloseSeen.push(text); }, unavailable() {},
}, { opener() { queueMicrotask(() => failedCloseFlux.onopen?.()); return failedCloseFlux as unknown as WebSocket; } });
const failedCloseResult = await failedCloseOpening;
if (failedCloseResult.ok) {
  const originalSend = failedCloseFlux.send.bind(failedCloseFlux);
  failedCloseFlux.send = (value) => {
    if (value === '{"type":"CloseStream"}') throw new Error("fake send failure");
    originalSend(value);
  };
  failedCloseResult.ears.close();
  failedCloseFlux.receive({ type: "TurnInfo", event: "Update", turn_index: 0, sequence_id: 1, transcript: "Never flushed" });
}
check("failed CloseStream send cannot earn final text", failedCloseSeen.length === 0 && failedCloseFlux.readyState === FakeFluxSocket.CLOSED);
const uncleanFlushSocket = new FakeFluxSocket();
const uncleanFlushSeen: string[] = [];
const uncleanFlushOpening = openFluxEars({
  startOfTurn() {}, partial() {}, final(text) { uncleanFlushSeen.push(text); }, unavailable() {},
}, { opener() { queueMicrotask(() => uncleanFlushSocket.onopen?.()); return uncleanFlushSocket as unknown as WebSocket; } });
const uncleanFlushResult = await uncleanFlushOpening;
if (uncleanFlushResult.ok) {
  uncleanFlushResult.ears.close();
  uncleanFlushSocket.receive({ type: "TurnInfo", event: "Update", turn_index: 0, sequence_id: 1, transcript: "Dropped after flush" });
  uncleanFlushSocket.close(1006, false);
}
check("unclean upstream close never promotes interim text", uncleanFlushSeen.length === 0);
const errorCodeFlux = new FakeFluxSocket();
const errorCodeSeen: string[] = [];
const errorCodeOpening = openFluxEars({
  startOfTurn() {}, partial() {}, final(text) { errorCodeSeen.push(`final:${text}`); },
  unavailable() { errorCodeSeen.push("unavailable"); },
}, { opener() { queueMicrotask(() => errorCodeFlux.onopen?.()); return errorCodeFlux as unknown as WebSocket; } });
const errorCodeResult = await errorCodeOpening;
if (errorCodeResult.ok) {
  errorCodeResult.ears.close();
  errorCodeFlux.receive({ type: "TurnInfo", event: "Update", turn_index: 0, sequence_id: 1, transcript: "Not confirmed" });
  errorCodeFlux.close(1011, true);
}
check("clean handshake with provider error code fails instead of finalizing", errorCodeSeen.join("|") === "unavailable");
const timedOutFlux = new FakeFluxSocket();
const timedOutSeen: string[] = [];
const timedOutOpening = openFluxEars({
  startOfTurn() {}, partial() {}, final(text) { timedOutSeen.push(`final:${text}`); },
  unavailable() { timedOutSeen.push("unavailable"); },
}, { opener() { queueMicrotask(() => timedOutFlux.onopen?.()); return timedOutFlux as unknown as WebSocket; }, closeTimeoutMs: 1 });
const timedOutResult = await timedOutOpening;
if (timedOutResult.ok) {
  timedOutResult.ears.close();
  timedOutFlux.receive({ type: "TurnInfo", event: "Update", turn_index: 0, sequence_id: 1, transcript: "Partial flush" });
  await new Promise((resolve) => setTimeout(resolve, 10));
}
check("local forced close cannot impersonate Deepgram's clean settlement", timedOutSeen.join("|") === "unavailable" && timedOutFlux.readyState === FakeFluxSocket.CLOSED);
const thrownOpening = await openFluxEars(
  { startOfTurn() {}, partial() {}, final() {}, unavailable() {} },
  { opener() { throw new Error("fake constructor failure"); } },
);
check("socket constructor failure returns typed open failure", !thrownOpening.ok && thrownOpening.code === "stt_open_failed");
const errorFlux = new FakeFluxSocket();
const errorOpening = openFluxEars(
  { startOfTurn() {}, partial() {}, final() {}, unavailable() {} },
  { opener() { queueMicrotask(() => errorFlux.onerror?.()); return errorFlux as unknown as WebSocket; } },
);
const errorResult = await errorOpening;
check("open-time socket error closes its provider resource", !errorResult.ok && errorFlux.readyState === FakeFluxSocket.CLOSED);
(globalThis as unknown as { WebSocket: unknown }).WebSocket = previousWebSocket;
delete env.DEEPGRAM_API_KEY;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
