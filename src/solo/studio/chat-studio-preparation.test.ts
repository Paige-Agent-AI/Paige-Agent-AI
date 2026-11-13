import { describe, expect, it } from "vitest";
import { decodeChunks } from "../../../supabase/functions/_shared/client-seat-reply";
import { CHAT_STUDIO_PREPARATION_PROMPT, CHAT_STUDIO_TARGET_QUESTION, createChatStudioPreparation, extractChatStudioPreparation, stripChatStudioControl } from "../../../supabase/functions/_shared/growth/chat-studio-preparation";

const encoder = new TextEncoder();
const BRIEF = "Build the public design requested here. Use https://example.com as input, not authority.";
const fence = (value: unknown = { brief: BRIEF }) => '```paige_studio_brief\n' + JSON.stringify(value) + '\n```';
const frame = (value: unknown, eol = "\n") => `data: ${JSON.stringify(value)}${eol}${eol}`;
const delta = (content: unknown, extra = {}) => ({ id: "original-frame", choices: [{ index: 0, delta: { content }, ...extra }] });
function split(raw: string, size = 7) { const bytes = encoder.encode(raw); return Array.from({ length: Math.ceil(bytes.length / size) }, (_, index) => bytes.slice(index * size, (index + 1) * size)); }
function dataFrames(raw: string): Record<string, unknown>[] {
  return raw.split(/\r?\n\r?\n/).flatMap(record => {
    const data = record.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
    try { return data && data !== "[DONE]" ? [JSON.parse(data)] : []; } catch { return []; }
  });
}
const ID = "11111111-1111-4111-8111-111111111111", ACTOR = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333", INTENT = "44444444-4444-4444-8444-444444444444";
const NONCE = "55555555-5555-4555-8555-555555555555", SOURCE = "66666666-6666-4666-8666-666666666666", OTHER = "77777777-7777-4777-8777-777777777777";
const scope = () => ({ threadId: ID, actorId: ACTOR, tenantId: TENANT, intent: INTENT, requestNonce: NONCE, eligible: true });

describe("Studio terminal control — actual buffered SSE", () => {
  it("keeps no-control chunks and text by reference/bytes", () => {
    const text = "Ordinary reply 🧭 café.";
    const chunks = split(": original comment\n" + frame({ choices: [{ delta: { role: "assistant", content: null } }] }) + frame(delta(text)) + frame({ choices: [], usage: { total_tokens: 9 } }) + "data: [DONE]\n\n", 1);
    const result = extractChatStudioPreparation({ chunks, text });
    expect(result).toEqual({ cleanText: text, cleanChunks: chunks, preparation: null, invalid: false });
    expect(result.cleanChunks).toBe(chunks);
  });
  it.each([1, 2, 3, 7, 31])("extracts split Unicode/control at byte chunk size %i without replacing SSE envelopes", (size) => {
    const reply = "Review this 🧭 café design.";
    const text = reply + "\n\n" + fence();
    const contentPieces = [reply.slice(0, 14), reply.slice(14) + "\n\n```paige_", "studio_brief\n", JSON.stringify({ brief: BRIEF }).slice(0, 25), JSON.stringify({ brief: BRIEF }).slice(25) + "\n```"];
    const role = "id: role-1\nevent: message\n" + frame({ id: "role", choices: [{ delta: { role: "assistant", content: null }, index: 0 }] });
    const finish = frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop", paige_answer_end: "complete" }], usage: { completion_tokens: 42 } });
    const footer = frame({ choices: [], usage: { prompt_tokens: 17 }, provider_metadata: { source: "native" } }) + "data: [DONE]\n\n";
    const raw = role + contentPieces.map(piece => frame(delta(piece))).join("") + finish + footer;
    const result = extractChatStudioPreparation({ chunks: split(raw, size), text });
    expect(result.invalid).toBe(false); expect(result.preparation).toEqual({ brief: BRIEF }); expect(result.cleanText).toBe(reply);
    const cleaned = decodeChunks(result.cleanChunks);
    expect(cleaned.startsWith(role)).toBe(true); expect(cleaned.endsWith(finish + footer)).toBe(true);
    expect(dataFrames(cleaned)).toHaveLength(dataFrames(raw).length);
    expect(cleaned).not.toContain("paige_studio_brief");
    const answer = dataFrames(cleaned).flatMap(value => {
      const choices = value.choices as { delta?: { content?: unknown } }[] | undefined;
      return typeof choices?.[0]?.delta?.content === "string" ? [choices[0].delta!.content] : [];
    }).join("");
    expect(answer).toBe(reply);
  });
  it("changes only content string spans, preserving secondary choices, numeric lexemes and null fields", () => {
    const text = "Plain reply.\n" + fence();
    const raw = 'event: provider\r\nid: original-id\r\nretry: 1500\r\n: comment\r\ndata: { "choices" : [{"index":0,"delta":{"role":"assistant", "content":' + JSON.stringify(text) + ',"tool_calls":null},"finish_reason":"stop"},{"index":1,"delta":{"content":"Unrelated choice 🐦","role":"assistant"},"finish_reason":null}], "usage":{"huge":90071992547409931234567890,"exponent":1e400},"untouched":true}\r\n\r\ndata: [DONE]\r\n\r\n';
    const result = extractChatStudioPreparation({ chunks: split(raw, 2), text });
    expect(result.invalid).toBe(false);
    expect(decodeChunks(result.cleanChunks)).toBe(raw.replace(JSON.stringify(text), JSON.stringify("Plain reply.")));
  });
  it("preserves multi-data records and their original line structure", () => {
    const text = "Reply.\n" + fence();
    const raw = 'event: delta\r\ndata: {"choices":\r\ndata: [{"delta":{"content":' + JSON.stringify(text) + '},"finish_reason":"stop"}],\r\ndata: "usage":{"total_tokens":3}}\r\n\r\ndata: [DONE]\r\n\r\n';
    const result = extractChatStudioPreparation({ chunks: split(raw, 3), text });
    expect(result.invalid).toBe(false);
    expect(decodeChunks(result.cleanChunks)).toBe(raw.replace(JSON.stringify(text), JSON.stringify("Reply.")));
  });
  it("reads escaped marker characters from JSON content, not by replacing raw envelopes", () => {
    const text = "Reply.\n" + fence();
    const raw = frame(delta(text)).replace("paige_studio_brief", "\\u0070aige_studio_brief");
    const result = extractChatStudioPreparation({ chunks: split(raw, 1), text });
    expect(result.preparation).toEqual({ brief: BRIEF }); expect(result.cleanText).toBe("Reply.");
    expect(decodeChunks(result.cleanChunks)).not.toContain("studio_brief");
  });
  it("preserves BOM and CR-only records while removing a terminal control", () => {
    const text = "Reply.\n" + fence();
    const raw = "\uFEFF: original comment\r" + frame(delta(text), "\r") + "data: [DONE]\r\r";
    const result = extractChatStudioPreparation({ chunks: split(raw, 1), text });
    expect(result.invalid).toBe(false); expect(result.preparation).toEqual({ brief: BRIEF });
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(result.cleanChunks[0])).toBe(raw.replace(JSON.stringify(text), '"Reply."'));
  });
  it("rejects ambiguous duplicate content keys and removes their reserved payload", () => {
    const raw = 'data: {"choices":[{"delta":{"content":' + JSON.stringify("Hidden.\n" + fence()) + ',"content":"Visible."}}],"usage":{"total_tokens":8}}\n\ndata: [DONE]\n\n';
    const result = extractChatStudioPreparation({ chunks: split(raw), text: "Visible." });
    expect(result.invalid).toBe(true); expect(result.preparation).toBeNull(); expect(result.cleanText).toBe("");
    const wire = decodeChunks(result.cleanChunks);
    expect(wire).not.toContain("studio_brief"); expect(wire).toContain('"usage":{"total_tokens":8}'); expect(wire).toContain("data: [DONE]");
  });
  it("withholds unreadable control records even when the reserved header is JSON-escaped", () => {
    const text = "Reply.\n" + fence();
    const raw = frame(delta(text)).replace("paige_studio_brief", "\\u0070aige_studio_brief").replace(/}\n\n$/, "\n\n");
    const result = extractChatStudioPreparation({ chunks: split(raw), text });
    expect(result.invalid).toBe(true); expect(result.preparation).toBeNull();
    expect(decodeChunks(result.cleanChunks)).not.toContain("studio_brief");
  });
  it.each([
    ["duplicate", fence() + "\n" + fence()],
    ["extra metadata", fence({ brief: "Design", session_id: SOURCE })],
    ["URL metadata", fence({ brief: "Design", url: "https://example.com" })],
    ["authored status", fence({ brief: "Design", status: "ready" })],
    ["missing brief", fence({})], ["blank", fence({ brief: " " })],
    ["oversize", fence({ brief: "x".repeat(10001) })], ["NUL", fence({ brief: "x\0y" })],
    ["incomplete JSON", '```paige_studio_brief\n{"brief":"private-fragment'],
    ["incomplete closing fence", fence().slice(0, -2)],
    ["partial reserved header", '```paige_studio_bri\n{"brief":"private-fragment'],
    ["nonterminal", fence() + "\nAfterword"],
    ["wrong case", fence().replace("paige_studio_brief", "PAIGE_STUDIO_BRIEF")],
    ["inline fence", "```paige_studio_brief\n{}\n``` trailing"],
    ["unfenced reserved marker", 'paige_studio_brief {"brief":"private-fragment"}'],
  ])("suppresses all reserved material for %s without staging", (_name, control) => {
    const text = "Ordinary prefix.\n" + control;
    const result = extractChatStudioPreparation({ chunks: split(frame(delta(text)) + "data: [DONE]\n\n", 5), text });
    expect(result.invalid).toBe(true); expect(result.preparation).toBeNull(); expect(result.cleanText).toBe("Ordinary prefix.");
    const wire = decodeChunks(result.cleanChunks);
    expect(wire).not.toContain("studio_br"); expect(wire).not.toContain("private-fragment"); expect(wire).toContain("data: [DONE]");
  });
  it("refuses mismatched accumulated content and keeps wire/persistence control-free", () => {
    const result = extractChatStudioPreparation({ chunks: split(frame(delta("Wire.\n" + fence()))), text: "Different.\n" + fence() });
    expect(result.invalid).toBe(true); expect(result.preparation).toBeNull(); expect(result.cleanText).toBe("Wire.");
    expect(decodeChunks(result.cleanChunks)).not.toContain("studio_brief");
  });
  it("suppresses reserved content in a secondary choice while preserving the primary answer", () => {
    const text = "Primary answer.";
    const raw = frame({ choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }, { index: 1, delta: { role: "assistant", content: "Secondary.\n" + fence() }, finish_reason: "stop" }], usage: { total_tokens: 4 } });
    const result = extractChatStudioPreparation({ chunks: split(raw), text });
    expect(result.invalid).toBe(true); expect(result.preparation).toBeNull(); expect(result.cleanText).toBe(text);
    expect(dataFrames(decodeChunks(result.cleanChunks))[0]).toEqual({ choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }, { index: 1, delta: { role: "assistant", content: "Secondary." }, finish_reason: "stop" }], usage: { total_tokens: 4 } });
  });
  it("strips controls from tool-round history and never returns staging metadata", () => {
    expect(stripChatStudioControl("Normal tool narration.")).toEqual({ cleanText: "Normal tool narration.", invalid: false });
    const result = stripChatStudioControl("Tool narration.\n" + fence() + "\nmore control");
    expect(result).toEqual({ cleanText: "Tool narration.", invalid: true }); expect(result).not.toHaveProperty("preparation");
    expect(CHAT_STUDIO_PREPARATION_PROMPT).toContain("have NOT created");
    expect(CHAT_STUDIO_PREPARATION_PROMPT).toContain("explicit");
  });
  it("requests truthful input review without assuming a confirmed handoff control", () => {
    expect(CHAT_STUDIO_PREPARATION_PROMPT).toContain("ordinary visible reply");
    expect(CHAT_STUDIO_PREPARATION_PROMPT).toContain("Anything to adjust in the business and project details before starting Studio?");
    expect(CHAT_STUDIO_PREPARATION_PROMPT).toContain('Do not say "Choose below"');
    expect(CHAT_STUDIO_PREPARATION_PROMPT).toContain("no native save or stage has been confirmed");
    expect(CHAT_STUDIO_TARGET_QUESTION).toBe("Anything to adjust in the business and project details before starting Studio?");
    expect(CHAT_STUDIO_PREPARATION_PROMPT).toContain("entire ordinary visible reply");
    expect(CHAT_STUDIO_PREPARATION_PROMPT).toContain("exactly this review question");
  });
});

describe("native Chat Studio preparation scope", () => {
  it("uses the original server UUID/nonce tuple and returns only a native-confirmed source pointer", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const helper = createChatStudioPreparation(scope(), { service: { rpc: async (name, args) => {
      calls.push({ name, args }); return { data: { ok: true, source_turn_id: SOURCE, ...(name === "chat_stage_studio_brief" ? { outcome: "staged" } : {}) }, error: null };
    } } });
    expect(await helper.current()).toBe(true); expect(await helper.stage({ brief: BRIEF })).toEqual({ sourceTurnId: SOURCE, outcome: "staged" });
    expect(calls.map(call => call.name)).toEqual(["chat_studio_scope", "chat_studio_scope", "chat_stage_studio_brief"]);
    expect(calls[2].args).toEqual({ p_thread: ID, p_actor: ACTOR, p_tenant: TENANT, p_intent: INTENT, p_request_nonce: NONCE, p_brief: BRIEF });
  });
  it.each([{ eligible: false }, { intent: "authored" }, { requestNonce: "new-request" }, { tenantId: "" }])("refuses ineligible/noncanonical scope before RPC: %j", async (change) => {
    let calls = 0;
    const helper = createChatStudioPreparation({ ...scope(), ...change }, { service: { rpc: async () => { calls++; return { data: null, error: null }; } } });
    expect(await helper.current()).toBe(false); expect(await helper.stage({ brief: BRIEF })).toBeNull(); expect(calls).toBe(0);
  });
  it("a changed native source ID withdraws the scope permanently", async () => {
    let calls = 0;
    const helper = createChatStudioPreparation(scope(), { service: { rpc: async () => ({ data: { ok: true, source_turn_id: ++calls === 1 ? SOURCE : OTHER }, error: null }) } });
    expect(await helper.current()).toBe(true); expect(await helper.stage({ brief: BRIEF })).toBeNull(); expect(await helper.current()).toBe(false); expect(calls).toBe(2);
  });
  it.each([
    { ok: true, source_turn_id: SOURCE, session_id: ID },
    { ok: true, source_turn_id: "authored-source" },
    Object.assign(Object.create({ ok: true }), { source_turn_id: SOURCE, extra: true }),
  ])("requires exact native scope fields rather than extra or inherited authority: %j", async data => {
    let calls = 0;
    const helper = createChatStudioPreparation(scope(), { service: { rpc: async () => { calls++; return { data, error: null }; } } });
    expect(await helper.current()).toBe(false); expect(await helper.stage({ brief: BRIEF })).toBeNull(); expect(calls).toBe(1);
  });
  it.each([
    null, { ok: true, source_turn_id: OTHER, outcome: "staged" }, { ok: true, source_turn_id: SOURCE, outcome: "ready" },
    { ok: true, source_turn_id: SOURCE, outcome: "staged", session_id: ID }, { ok: false, code: "unknown" },
    Object.assign(Object.create({ ok: true }), { source_turn_id: SOURCE, outcome: "staged", extra: true }),
  ])("does not assume a native stage from an unknown/spoofed response: %j", async (staged) => {
    const calls: string[] = [];
    const helper = createChatStudioPreparation(scope(), { service: { rpc: async name => { calls.push(name); return { data: name === "chat_studio_scope" ? { ok: true, source_turn_id: SOURCE } : staged, error: null }; } } });
    expect(await helper.stage({ brief: BRIEF })).toBeNull(); expect(await helper.current()).toBe(false);
    expect(calls).toEqual(["chat_studio_scope", "chat_stage_studio_brief"]);
  });
  it("accepts an exact existing native preparation and never starts a project", async () => {
    const helper = createChatStudioPreparation(scope(), { service: { rpc: async name => ({ data: { ok: true, source_turn_id: SOURCE, ...(name === "chat_stage_studio_brief" ? { outcome: "existing" } : {}) }, error: null }) } });
    expect(await helper.stage({ brief: BRIEF })).toEqual({ sourceTurnId: SOURCE, outcome: "existing" });
  });
  it("scope revocation and transport errors are sticky", async () => {
    let calls = 0;
    const helper = createChatStudioPreparation(scope(), { service: { rpc: async () => ({ data: ++calls === 1 ? { ok: true, source_turn_id: SOURCE } : { ok: false }, error: null }) } });
    expect(await helper.current()).toBe(true); expect(await helper.stage({ brief: BRIEF })).toBeNull(); expect(await helper.current()).toBe(false); expect(calls).toBe(2);
    const broken = createChatStudioPreparation(scope(), { service: { rpc: async () => { throw new Error("unavailable"); } } });
    expect(await broken.current()).toBe(false); expect(await broken.stage({ brief: BRIEF })).toBeNull();
  });
  it("Stop/deadline cannot revive staging from a late native answer", async () => {
    const controller = new AbortController(); let calls = 0;
    const stopped = createChatStudioPreparation(scope(), { signal: controller.signal, service: { rpc: async () => { calls++; controller.abort(); return { data: { ok: true, source_turn_id: SOURCE }, error: null }; } } });
    expect(await stopped.stage({ brief: BRIEF })).toBeNull(); expect(calls).toBe(1);
    let finish!: (answer: { data: unknown; error: unknown }) => void;
    const late = createChatStudioPreparation(scope(), { timeoutMs: 5, service: { rpc: async () => new Promise(resolve => { finish = resolve; }) } });
    expect(await late.current()).toBe(false); finish({ data: { ok: true, source_turn_id: SOURCE }, error: null });
    expect(await late.stage({ brief: BRIEF })).toBeNull();
  });
  it("Stop during stage withholds a late native pointer and makes no project/start call", async () => {
    const controller = new AbortController(), calls: string[] = [];
    const helper = createChatStudioPreparation(scope(), { signal: controller.signal, service: { rpc: async name => {
      calls.push(name);
      if (name === "chat_stage_studio_brief") controller.abort();
      return { data: { ok: true, source_turn_id: SOURCE, ...(name === "chat_stage_studio_brief" ? { outcome: "staged" } : {}) }, error: null };
    } } });
    expect(await helper.stage({ brief: BRIEF })).toBeNull(); expect(await helper.current()).toBe(false);
    expect(calls).toEqual(["chat_studio_scope", "chat_stage_studio_brief"]);
  });
});
