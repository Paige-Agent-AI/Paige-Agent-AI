/**
 * The model-call deadline — a stalled provider call must fail fast, not hang the turn.
 *
 * Production incident (2026-10-02, 23:34 UTC): the owner sent a large multi-part directive
 * ("archive everything you feel like you need to and then scope everything inside n8n…").
 * The turn ran two model rounds (the second capped at exactly the 2048 max-tokens default),
 * then the third call stalled with NO signal anywhere on the model-call chain —
 * gatewayCompat → chatCompletionCompat / streamAnthropicAsOpenAI → callClaude. The turn hung
 * silently; the UI's six-minute interactive window expired (the owner's error), and the edge's
 * ~400s wall clock then killed the invocation. Because the assistant turn persists only at the
 * close decision, EVERYTHING from the turn was lost — no assistant row, zero Rail tool events
 * (no tool ever completed), only the two completed-round traces remain.
 *
 * This suite pins the fix: every model fetch is bounded by a deadline; a caller-provided
 * signal still wins.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const root = join(__dirname, "..", "..");
const claude = readFileSync(join(root, "supabase/functions/_shared/claude.ts"), "utf8");

describe("the per-call model deadline exists", () => {
  it("the constant is defined with the incident rationale", () => {
    expect(claude).toContain("const MODEL_CALL_DEADLINE_MS = 120_000;");
    expect(claude).toContain("2026-10-02 incident");
  });

  it("the non-stream callClaude fetch is deadline-bounded, caller signal winning", () => {
    expect(claude).toContain("signal: opts.signal ?? AbortSignal.timeout(MODEL_CALL_DEADLINE_MS)");
  });

  it("the streaming fetch is deadline-bounded (body consumption included)", () => {
    expect(claude).toMatch(/body: JSON\.stringify\(\{ \.\.\.reqBody, stream: true \}\),\s*\n\s*\/\/ The fetch signal bounds the stream's body consumption too[\s\S]{0,200}signal: AbortSignal\.timeout\(MODEL_CALL_DEADLINE_MS\),/);
  });

  it("a caller-provided signal is still honored (the workflow abort site keeps its control)", () => {
    // opts.signal first in the nullish chain — a provided signal (e.g. the wfController in
    // paige-ai-chat) remains the call's authority; the deadline is only the default floor.
    expect(claude).toContain("opts.signal ?? AbortSignal.timeout");
    expect(claude).toContain("A caller-provided signal always wins.");
  });
});

describe("the failure surfaces honestly when the deadline trips", () => {
  it("a timed-out non-stream call traces as an error row (no silent hang)", () => {
    // gatewayCompat's catch writes status error with the error name — AbortSignal.timeout
    // aborts carry the name TimeoutError, so the trace records the timeout class.
    expect(claude).toContain("error_class: (e as Error)?.name ?? \"error\"");
  });

  it("a stalled stream terminates with the honest interrupted status", () => {
    expect(claude).toContain("streamErrored = true");
    expect(claude).toContain('error_class: streamErrored ? "stream_interrupted" : null');
  });
});
