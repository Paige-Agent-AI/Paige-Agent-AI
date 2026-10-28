// THE `growth_page_publish` TOOL DEFINITION — one home for every Paige chat that offers it.
//
// EXP08 A2b (plan S2, review A4): moved out of paige-ai-chat's tool list, byte for byte, so the Team
// Hub agent turn offers the model the exact schema the chat does instead of a second copy that drifts
// (§18). The tool redeems through the one publish door (./door.ts, via ../growth-publish-chat.ts);
// this file is only the description the model reads.
//
// A FACTORY, NOT A SHARED CONSTANT, on purpose. paige-ai-chat writes into its tool definitions every
// request (the approval loops add `parameters.properties.confirm` to every mutating tool). The
// object used to be a fresh literal per request; a module-level constant would carry one request's
// edits into the next and into Team Hub, and a frozen one would throw. Each call returns a new object,
// which is exactly what the inline literal gave. ./chat-tools.test.ts pins both properties.

export const GROWTH_PAGE_PUBLISH_TOOL_NAME = "growth_page_publish";

/** A fresh `growth_page_publish` tool definition, identical to the chat's former inline literal. */
export function growthPagePublishToolDef() {
  return {
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
  };
}
