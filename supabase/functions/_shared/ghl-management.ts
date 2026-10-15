// _shared/ghl-management.ts — the Chat-owner ADAPTER for the GHL governed lane (GHL-1).
//
// The chat-tool-registry ruling: domains own features, the Spine owns governance, Chat is a
// consumer. A new Paige tool is registered by its domain (the Spine declarations in
// paige-spine/domains/ghl_management.ts) and enters Chat through THIS adapter — the same
// shape as n8n-management.ts: the catalog of tool schemas is derived here and spread into
// the handler's toolDefs; the handler's dispatch (the else-if branch keyed on these names)
// routes to the canonical mcp-gateway and never re-declares a schema inline.
//
// The two tools, and what they honestly do:
//   ghl_list_actions — read-only: the connection check + the REAL discovered catalogue
//     (approved AND unapproved tools NAMED, never a bare count) through the gateway's
//     tools action. Resolve tool names here BEFORE running one.
//   ghl_run_action   — the consequential dispatch through the gateway's execute action:
//     propose-first; live execution additionally requires the owner's execute gate
//     (MCP_GATEWAY_EXECUTE_ENABLED) and the specific tool's durable approval.
type JsonSchema = { type: string; description?: string; [k: string]: unknown };

type Spec = { description: string; properties: Record<string, JsonSchema>; required: string[] };

const specs: Record<string, Spec> = {
  ghl_list_actions: {
    description:
      "Admin only. Check the workspace's GoHighLevel (GHL) MCP connection and list its REAL tool catalogue — both the approved tools (ready to run) and the unapproved ones (waiting on the operator's approval, NAMED, never just a count). Read-only: a catalogue read through the canonical gateway, never a provider tool call. Resolve the exact tool_name here BEFORE running one with ghl_run_action. If the workspace has no canonical GHL connection the tool says so honestly — point to Settings → Integrations (the HighLevel tile).",
    properties: {},
    required: [],
  },
  ghl_run_action: {
    description:
      "Admin only. RUN a GoHighLevel (GHL) tool — your hands in the tenant's CRM: contacts (get/search/create/update), conversations (read/send), opportunities, calendars, payments. Resolve the exact tool_name from ghl_list_actions first, then pass the arguments that tool expects. Dispatch goes through the canonical MCP gateway: the specific tool must carry the workspace's durable approval (Settings → Integrations), and LIVE execution additionally requires the owner's gateway execute gate to be on — until then the call returns the honest prepare result (what WOULD run), not a fabricated outcome. Governed by the autonomy policy: unless the workspace set this to auto, PROPOSE first and call again with confirm:true once the operator approves. Writes to the CRM are real: running is doing — you report what GHL returned, never a hoped-for outcome. If no GHL connection exists the tool says so.",
    properties: {
      tool_name: { type: "string", description: "The exact GHL tool name to run (from ghl_list_actions)." },
      arguments: { type: "object", description: "The inputs the tool expects (whatever ghl_list_actions describes for it)." },
    },
    required: ["tool_name"],
  },
};

export const GHL_MANAGEMENT_TOOLS = Object.entries(specs).map(([name, s]) => ({
  type: "function" as const,
  function: {
    name,
    description: s.description,
    parameters: { type: "object", properties: s.properties, required: s.required, additionalProperties: false },
  },
}));

export const GHL_MANAGEMENT_TOOL_NAMES = new Set(GHL_MANAGEMENT_TOOLS.map((tool) => tool.function.name));
