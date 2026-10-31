// node --test supabase/functions/_shared/growth-publish-command/chat-tools.test.ts   (also: deno test)
// EXP08 A2b (plan S2, review A4) — EXTRACTION PARITY for the `growth_page_publish` tool definition.
//
// `CHAT_LITERAL_BEFORE` is the object literal paige-ai-chat carried in its tool list at 6d8e5c56a
// (index.ts lines 7986-7999), transcribed verbatim. The chat now calls growthPagePublishToolDef()
// in that slot. The model must read exactly the same JSON, and because the chat writes into its tool
// definitions every request (the approval loops add `parameters.properties.confirm`), every call
// must hand out a NEW object, as the inline literal did.
//
// EVIDENCE CLASS: automated unit test of the moved definition.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROWTH_PAGE_PUBLISH_TOOL_NAME, growthPagePublishToolDef } from "./chat-tools.ts";
// node:test's describe/it are not in Deno 2.1's node compat; this keeps one file runnable by both
// `node --test` and `deno test` (flat tests named "suite > case").
let suite = "";
const describe = (name: string, body: () => void) => { const prev = suite; suite = name; body(); suite = prev; };
const it = (name: string, fn: () => unknown) => { test(`${suite} > ${name}`, async () => { await fn(); }); };

const CHAT_LITERAL_BEFORE = () => (
          {
            type: "function",
            function: {
              name: "growth_page_publish",
              description: "Team only. Publish a saved landing page so it goes LIVE at its public URL. This is a going-live action — always confirm with the operator first, and on success report back the REAL public URL the publish returns (never claim it's live without the link). The page must already be saved as a draft (growth_page_save) and free of unfilled [PLACEHOLDER] prompts, which the publish step rejects.",
              parameters: {
                type: "object",
                properties: {
                  page_id: { type: "string", description: "The growth page id to publish (from growth_list or growth_page_save)." }
                },
                required: ["page_id"]
              }
            }
          }
);

/** The chat's own approval-schema loop (index.ts "Approval-path hardening"), applied to a tool list. */
// deno-lint-ignore no-explicit-any
function chatApprovalLoop(toolDefs: any[]) {
  for (const t of toolDefs) {
    const props = t.function?.parameters?.properties;
    if (!props) continue;
    props.confirm = { type: "boolean", description: "Compatibility field only." };
  }
  return toolDefs;
}

describe("growth_page_publish tool definition moved to _shared/growth-publish-command/chat-tools.ts", () => {
  it("is byte-identical to the chat's former literal, key order included", () => {
    assert.equal(JSON.stringify(growthPagePublishToolDef()), JSON.stringify(CHAT_LITERAL_BEFORE()));
    assert.deepStrictEqual(growthPagePublishToolDef(), CHAT_LITERAL_BEFORE());
  });
  it("is still byte-identical after the chat's approval loop writes into it", () => {
    assert.equal(JSON.stringify(chatApprovalLoop([growthPagePublishToolDef()])), JSON.stringify(chatApprovalLoop([CHAT_LITERAL_BEFORE()])));
  });
  it("hands out a new object every call, so one request's edits never reach the next one or Team Hub", () => {
    const first = growthPagePublishToolDef();
    chatApprovalLoop([first]);
    const second = growthPagePublishToolDef();
    assert.notEqual(second, first);
    assert.equal("confirm" in second.function.parameters.properties, false);
    assert.equal(JSON.stringify(second), JSON.stringify(CHAT_LITERAL_BEFORE()));
  });
  it("names the tool by the one key the publish door files it under", () => {
    assert.equal(GROWTH_PAGE_PUBLISH_TOOL_NAME, "growth_page_publish");
    assert.equal(growthPagePublishToolDef().function.name, GROWTH_PAGE_PUBLISH_TOOL_NAME);
  });
});
