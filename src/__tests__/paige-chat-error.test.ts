/**
 * #587 / INT-346 — the structured chat-error mapper the Solo surface shows instead of a
 * generic toast. Pinned here because two of its rows are load-bearing truth contracts:
 *
 *  - INTERACTIVE_EFFECTS_UNAVAILABLE (the 409 while the interactive rollout is staged):
 *    an Approve/Not-now decision cannot be consumed, and the person must be told actions
 *    are PAUSED — not that their message failed. The decision stays on its card.
 *  - The ASK_* family (C4c): each refusal names what happened to the answer, never a
 *    generic failure.
 *
 * Also pins the degradation contract: a missing/non-JSON/legacy body never throws and falls
 * back to the generic message, so this mapper can never itself break error surfacing.
 */
import { describe, expect, it } from "vitest";
import { parsePaigeChatError } from "@/lib/paigeChatError";

const jsonResponse = (body: unknown, status = 400) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("parsePaigeChatError — INT-346 conversational-mode refusal", () => {
  it("maps INTERACTIVE_EFFECTS_UNAVAILABLE to the actions-paused title with the server's reason", async () => {
    const display = await parsePaigeChatError(
      jsonResponse({
        code: "INTERACTIVE_EFFECTS_UNAVAILABLE",
        reason: "Governed actions are paused while a platform update finishes.",
        recommendation: "Your choice is still on its card.",
      }, 409),
    );
    expect(display.title).toBe("Actions are paused");
    expect(display.description).toBe("Governed actions are paused while a platform update finishes. Your choice is still on its card.");
  });

  it("mutation check — without the mapping the generic title would surface for the staged refusal", async () => {
    // The mapper's TITLE_BY_CODE is the single source of these titles; prove the test bites
    // by feeding an unmapped code and seeing the generic fallback (the same thing that
    // would render if the INT-346 row were deleted).
    const display = await parsePaigeChatError(
      jsonResponse({ code: "SOME_UNMAPPED_CODE", reason: "Anything." }, 409),
    );
    expect(display.title).toBe("Something went wrong");
  });
});

describe("parsePaigeChatError — C4c answer-binding refusals keep their closed titles", () => {
  it.each([
    ["ASK_NOT_OPEN", "That question is closed"],
    ["ASK_ALREADY_ANSWERED", "PAIGE already has your answer"],
    ["ASK_ANSWER_IN_PROGRESS", "PAIGE already has your answer"],
    ["ASK_REOPENED", "PAIGE asked again"],
  ])("maps %s", async (code, expectedTitle) => {
    const display = await parsePaigeChatError(jsonResponse({ code, reason: "r" }));
    expect(display.title).toBe(expectedTitle);
  });
});

describe("parsePaigeChatError — degradation never throws", () => {
  it("falls back to the generic message on a non-JSON body", async () => {
    const display = await parsePaigeChatError(new Response(" gateway html ", { status: 502 }));
    expect(display.title).toBe("Error");
    expect(display.description).toBe("Failed to send message. Please try again.");
  });

  it("falls back when the JSON body carries only the legacy generic error string", async () => {
    const display = await parsePaigeChatError(jsonResponse({ error: "An error occurred" }));
    expect(display.title).toBe("Error");
    expect(display.description).toBe("Failed to send message. Please try again.");
  });

  it("accepts the legacy string-only error field when it carries a specific reason", async () => {
    const display = await parsePaigeChatError(jsonResponse({ error: "Specific provider failure." }));
    expect(display.description).toBe("Specific provider failure.");
  });

  it("reads the body via clone(), leaving the caller's own body reading undisturbed", async () => {
    const response = jsonResponse({ code: "chat_unavailable", reason: "Down" });
    await parsePaigeChatError(response);
    // The original body is still consumable exactly once by its owner.
    const data = (await response.json()) as { reason: string };
    expect(data.reason).toBe("Down");
  });
});
