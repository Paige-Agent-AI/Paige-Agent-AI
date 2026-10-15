// deno test --allow-import --node-modules-dir=none supabase/functions/_shared/paige-turn/round.test.ts
//
// INT-334 R3 — the R7 invariant (round.ts): a tool call runs only from a model round that finished.
// The six owner-mandated cases, in the chat-shaped stream BOTH converters emit (Anthropic's and
// OpenAI's terminal mappings differ, so each case is stated in each provider's own mapping):
//   partial tool call → transport failure · complete arguments → failed response · complete
//   arguments → cancellation · complete arguments → token-limit truncation · refusal after a partial
//   call · a normal tool-use stop. Only the last may execute.
// The real converters are driven end to end through this gate by scripts/model-fabric/round-gate-check.mjs.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { executableToolCalls, readModelRound, wholeArguments } from "./round.ts";

const f = (delta: Record<string, unknown>, finish: string | null = null) => JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] });
const ROLE = f({ role: "assistant" });
const OPEN = f({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "crm_contact_lookup", arguments: "" } }] });
const HALF = f({ tool_calls: [{ index: 0, function: { arguments: "{\"q\":\"Ac" } }] });
const REST = f({ tool_calls: [{ index: 0, function: { arguments: "me\"}" } }] });
const DONE = "[DONE]";

// What each converter puts on the wire for each case (no finish = the converter saw a failure).
const CASES: Record<string, { anthropic: string[]; openai: string[]; transportFailed?: boolean; executes: boolean }> = {
  "partial tool call, then the transport fails": {
    anthropic: [ROLE, OPEN, HALF], openai: [ROLE, OPEN, HALF], transportFailed: true, executes: false,
  },
  "complete arguments, then the response fails": {
    // Anthropic: an `error` event, no message_stop → no finish. OpenAI: response.failed → no finish.
    anthropic: [ROLE, OPEN, HALF, REST, DONE], openai: [ROLE, OPEN, HALF, REST, DONE], executes: false,
  },
  "complete arguments, then the response is cancelled": {
    // OpenAI: a terminal status other than completed/incomplete → no finish. Anthropic has no cancel
    // event; a cut stream (no message_stop) is the same wire.
    anthropic: [ROLE, OPEN, HALF, REST, DONE], openai: [ROLE, OPEN, HALF, REST, DONE], executes: false,
  },
  "complete arguments, then the token limit": {
    // Anthropic maps max_tokens to "stop"; OpenAI maps an incomplete max_output_tokens to "length".
    anthropic: [ROLE, OPEN, HALF, REST, f({}, "stop"), DONE], openai: [ROLE, OPEN, HALF, REST, f({}, "length"), DONE], executes: false,
  },
  "a refusal after a partial tool call": {
    // Anthropic maps refusal to "stop"; OpenAI to "content_filter".
    anthropic: [ROLE, OPEN, HALF, f({}, "stop"), DONE], openai: [ROLE, OPEN, HALF, f({}, "content_filter"), DONE], executes: false,
  },
  "complete arguments, then a refusal": {
    // The end rule alone must hold here: the call is whole, so only the refusal stops it.
    anthropic: [ROLE, OPEN, HALF, REST, f({}, "stop"), DONE], openai: [ROLE, OPEN, HALF, REST, f({}, "content_filter"), DONE], executes: false,
  },
  "a complete-looking tool-use stop whose reader failed": {
    anthropic: [ROLE, OPEN, HALF, REST, f({}, "tool_calls"), DONE], openai: [ROLE, OPEN, HALF, REST, f({}, "tool_calls"), DONE], transportFailed: true, executes: false,
  },
  "a normal tool-use stop": {
    anthropic: [ROLE, OPEN, HALF, REST, f({}, "tool_calls"), DONE], openai: [ROLE, OPEN, HALF, REST, f({}, "tool_calls"), DONE], executes: true,
  },
};

for (const [name, c] of Object.entries(CASES)) {
  for (const provider of ["anthropic", "openai"] as const) {
    Deno.test(`${provider}: ${name} → ${c.executes ? "executes" : "executes nothing"}`, () => {
      const round = readModelRound(c[provider], !!c.transportFailed);
      const run = executableToolCalls(round);
      if (c.executes) {
        assertEquals(run.map((x) => [x.id, x.name, x.arguments]), [["call_1", "crm_contact_lookup", "{\"q\":\"Acme\"}"]]);
      } else {
        assertEquals(run, [], `${provider} ${name}: ${round.end}`);
        assert(round.toolCalls.length === 1, "the call was visible on the wire — and still does not run");
        assert(round.end !== "tool_use", "the round did not end in a normal tool-use stop");
      }
    });
  }
}

Deno.test("within a finished round, the gate passes every named call; whole arguments are checked per call", () => {
  const second = f({ tool_calls: [{ index: 1, id: "call_2", type: "function", function: { name: "ping", arguments: "{\"x\":" } }] });
  const round = readModelRound([ROLE, OPEN, HALF, REST, second, f({}, "tool_calls"), DONE]);
  assertEquals(round.end, "tool_use");
  const run = executableToolCalls(round);
  assertEquals(run.map((c) => c.id), ["call_1", "call_2"]);
  assertEquals(run.map((c) => wholeArguments(c.arguments)), [true, false], "the dispatcher refuses the malformed one alone");
});

Deno.test("wholeArguments: an object or nothing; never cut-off JSON, an array or a scalar", () => {
  for (const ok of ["", "  \n ", "{}", "{\"q\":\"Acme\"}"]) assert(wholeArguments(ok), JSON.stringify(ok));
  for (const bad of ["{\"q\":\"Ac", "[1]", "1", "\"x\"", "null", "{"]) assert(!wholeArguments(bad), bad);
  assert(wholeArguments(undefined), "absent arguments read as {}");
});

Deno.test("a call needs a name; an id may be synthesised by the server", () => {
  const noName = f({ tool_calls: [{ index: 0, id: "c", type: "function", function: { arguments: "{}" } }] });
  assertEquals(executableToolCalls(readModelRound([noName, f({}, "tool_calls"), DONE])), []);
  const noId = f({ tool_calls: [{ index: 0, type: "function", function: { name: "ping", arguments: "{}" } }] });
  assertEquals(executableToolCalls(readModelRound([noId, f({}, "tool_calls"), DONE])).length, 1);
  const noInput = f({ tool_calls: [{ index: 0, id: "c", type: "function", function: { name: "ping", arguments: "" } }] });
  assertEquals(executableToolCalls(readModelRound([noInput, f({}, "tool_calls"), DONE])).length, 1, "a no-input tool in a finished round runs");
  assertEquals(executableToolCalls(readModelRound([noInput, f({}, "stop"), DONE])).length, 0, "…but never from an unfinished one");
});

Deno.test("a finish without [DONE] is unfinished; a finish before an error frame still needs [DONE]", () => {
  assertEquals(readModelRound([OPEN, HALF, REST, f({}, "tool_calls")]).end, "unfinished");
  assertEquals(executableToolCalls(readModelRound([OPEN, HALF, REST, f({}, "tool_calls")])), []);
});

Deno.test("parallel calls join by index and run together", () => {
  const b = f({ tool_calls: [{ index: 1, id: "call_2", type: "function", function: { name: "ping", arguments: "" } }] });
  const bArgs = f({ tool_calls: [{ index: 1, function: { arguments: "{}" } }] });
  const run = executableToolCalls(readModelRound([OPEN, b, HALF, bArgs, REST, f({}, "tool_calls"), DONE]));
  assertEquals(run.map((x) => x.id), ["call_1", "call_2"]);
});

Deno.test("text is collected; an answer round runs nothing", () => {
  const r = readModelRound([ROLE, f({ content: "Hi" }), f({ content: " there" }), f({}, "stop"), DONE]);
  assertEquals([r.end, r.text, executableToolCalls(r)], ["end_turn", "Hi there", []]);
});
