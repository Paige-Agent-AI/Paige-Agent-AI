// Tool-result DATA projection tests (2026-11-06 owner incident).
//
// The closed outcome vocabulary alone left a successful read unconfirmable: the owner approved
// PAIGE's HighLevel lookup, the Rail recorded capability_succeeded, and PAIGE still told him
// "couldn't confirm whether it went through" because nothing that was READ ever reached her.
// `projectToolResultData` reopens exactly that channel, and these tests pin its three guarantees:
// the input gate (unvalidated/errored payloads NEVER project), the content rules (text blocks +
// structuredContent, non-text contributes nothing), and the bounds (control-strip, cap with an
// explicit truncation marker, null — never an empty string).
import { assertEquals } from "jsr:@std/assert@1";
import { projectToolResultData, validateToolResult } from "./result.ts";

Deno.test("projectToolResultData carries text blocks of a clean recognized result", () => {
  const raw = { content: [{ type: "text", text: "Antonio Cook <antonio@example.com>" }] };
  const check = validateToolResult(raw);
  assertEquals(check.recognized && !check.isError, true);
  assertEquals(projectToolResultData(raw), "Antonio Cook <antonio@example.com>");
});

Deno.test("projectToolResultData includes structuredContent as JSON alongside text", () => {
  const raw = {
    content: [{ type: "text", text: "1 contact" }],
    structuredContent: { contact: { id: "c1", name: "Antonio" } },
  };
  assertEquals(projectToolResultData(raw), '1 contact\n{"contact":{"id":"c1","name":"Antonio"}}');
});

Deno.test("projectToolResultData returns null for an isError result — never echo a failure payload", () => {
  const raw = { content: [{ type: "text", text: "boom" }], isError: true };
  assertEquals(projectToolResultData(raw), null);
});

Deno.test("projectToolResultData returns null for a malformed non-boolean isError", () => {
  assertEquals(projectToolResultData({ content: [{ type: "text", text: "x" }], isError: "true" }), null);
});

Deno.test("projectToolResultData returns null for an unrecognized shape", () => {
  assertEquals(projectToolResultData({ not_content: "whatever" }), null);
  assertEquals(projectToolResultData("text"), null);
  assertEquals(projectToolResultData(null), null);
});

Deno.test("projectToolResultData ignores non-text blocks and non-string text", () => {
  const raw = {
    content: [
      { type: "image", data: "AAAA" },
      { type: "text", text: 42 },
      { type: "text", text: "real" },
    ],
  };
  assertEquals(projectToolResultData(raw), "real");
});

Deno.test("projectToolResultData strips control characters but keeps newlines and tabs", () => {
  assertEquals(projectToolResultData({ content: [{ type: "text", text: "a\u0000b\u0007c\td\ne" }] }), "abc\td\ne");
});

Deno.test("projectToolResultData caps the projection with an explicit truncation marker", () => {
  const big = "x".repeat(10_000);
  const out = projectToolResultData({ content: [{ type: "text", text: big }] });
  assertEquals(typeof out, "string");
  assertEquals(out!.length, 4_000 + "\n[truncated]".length);
  assertEquals(out!.endsWith("\n[truncated]"), true);
});

Deno.test("projectToolResultData returns null when nothing projectable survives", () => {
  assertEquals(projectToolResultData({ content: [] }), null);
  assertEquals(projectToolResultData({ content: [{ type: "image", data: "AAAA" }] }), null);
  assertEquals(projectToolResultData({ content: [{ type: "text", text: "   " }] }), null);
});
