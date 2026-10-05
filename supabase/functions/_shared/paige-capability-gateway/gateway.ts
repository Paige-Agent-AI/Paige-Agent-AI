/**
 * THE PAIGE CAPABILITY GATEWAY — what Chat is even allowed to reach, decided from the truth.
 *
 * WHERE THIS SITS IN THE GRAND DESIGN
 * -----------------------------------
 *   domains own capabilities
 *     → the Spine declares each one's governed contract (registry.ts + contracts.ts)
 *       → the capability-status resolver says what is true for THIS tenant right now
 *         → **this gateway exposes only the admissible capabilities to Chat**
 *           → Chat selects a governed action / draft / question / explanation
 *             → the domain tool/RPC runs through the shared seam (decideGovernedExecution)
 *               → canonical write/provider → fresh readback → receipt + Rail → truthful result
 *
 * So the gateway is the ADMISSIBILITY step, and only that. It decides, per registered capability,
 * what Chat may do with it — hand the model an executable tool, route it through an approval card,
 * explain a setup step, explain why it is unavailable, or expose nothing at all. It does NOT decide
 * whether a given invocation actually runs: that re-resolves at execution through
 * `decideGovernedExecution`, which now carries the SAME capability status this module reads
 * (`GovernedCapability.availability`), so a capability this gateway hides cannot be reached through
 * another door either. Admissibility here; the governed decision there; neither replaces the other.
 *
 * WHAT IT IS NOT (§00). It has no opinion about how Chat LOOKS or reads. It emits tool definitions
 * and a machine-readable disposition; presentation is the frontend's. And it invents no capability:
 * every entry it can emit traces to a registered Spine capability or to the gateway's own discovery
 * verb, never to a hopeful string.
 *
 * WHY THE CORE IS PURE. `decideGatewayEntry` takes resolved facts and returns a disposition with no
 * I/O, so the whole admissibility matrix is a unit test rather than an integration ceremony — the
 * same discipline as the resolver it composes with and the seam it feeds.
 */
import type { CapabilityAvailability, CapabilityActionKind } from "../paige-capability-status/resolver.ts";

/**
 * What Chat may do with a capability, in the owner's terms. This is the per-entry decision the
 * owner named: an executable tool, a drafted-for-approval path, a connection explanation, an
 * honest unavailable explanation, or nothing.
 *
 *   tool                 — executable now. The model may call it; the shared seam does the rest.
 *   approval_card        — exposed, but a mutation that is drafted and routed through approval
 *                          (the workspace lane is confirm/off). The model may invoke it; the seam
 *                          returns `propose` and Chat renders the approval, rather than executing.
 *   setup_explanation    — NOT executable. A connection/setup step is required first; Paige explains
 *                          it instead of handing the model a tool that would only fail.
 *   planned_explanation  — NOT executable. A real capability that is not built yet; Paige says so.
 *   tier_explanation     — NOT executable. Not available for this account type.
 *   unavailable          — NOT executable. Cannot be confirmed for this workspace, so Paige must
 *                          not claim it (§13/§947).
 *   none                 — nothing to expose: the capability has no Chat verb at all.
 */
export type GatewayDisposition =
  | "tool"
  | "approval_card"
  | "setup_explanation"
  | "planned_explanation"
  | "tier_explanation"
  | "unavailable"
  | "none";

export interface GatewayEntryInput {
  /** The tenant availability resolved by the capability-status resolver for THIS caller. */
  availability: CapabilityAvailability;
  /** The capability's governed action kind (read/draft/create/update/configure/external_effect). */
  actionKind: CapabilityActionKind;
  /** Does the capability declare a Chat tool name at all? A capability with none is never a tool. */
  hasChatTool: boolean;
}

export interface GatewayEntry {
  disposition: GatewayDisposition;
  /** True only when the gateway hands the model a callable tool definition. */
  emitTool: boolean;
}

/**
 * Decide what Chat may do with ONE capability, from its resolved availability. Most-restrictive
 * truth wins, exactly as the resolver composed it — the gateway never cheers up a status the
 * resolver reported (§13). A capability with no Chat verb is `none` before anything else, because
 * there is no tool to emit regardless of how available it is.
 */
export function decideGatewayEntry(input: GatewayEntryInput): GatewayEntry {
  if (!input.hasChatTool) return { disposition: "none", emitTool: false };

  switch (input.availability) {
    case "not_for_tier":
      return { disposition: "tier_explanation", emitTool: false };
    case "unavailable":
      return { disposition: "unavailable", emitTool: false };
    case "proof_owed":
    case "no_applicable_capability":
      // Neither state authorizes a callable tool. proof_owed is restricted to its bounded proof
      // lane; no_applicable_capability is request-level truth and must never manufacture an entry.
      // Until the gateway has a dedicated non-executable presentation for either, fail closed with
      // the existing truthful unavailable disposition.
      return { disposition: "unavailable", emitTool: false };
    case "planned":
      return { disposition: "planned_explanation", emitTool: false };
    case "needs_setup":
      return { disposition: "setup_explanation", emitTool: false };

    case "needs_approval":
      // Admissible, but consequential: exposed so the owner can approve it. The model may invoke it;
      // the shared seam returns `propose` (the lane is confirm/off) and Chat renders the approval.
      return { disposition: "approval_card", emitTool: true };
    case "live":
      return { disposition: "tool", emitTool: true };
  }
}

/**
 * Map the gateway's disposition to the availability the shared seam must re-resolve for this entry
 * at EXECUTION time. This is the single place the two vocabularies meet, so the gateway's "what I
 * exposed" and the seam's "what I will run" can never silently disagree: an entry the gateway
 * exposed as a `tool`/`approval_card` re-resolves to an executable availability at the seam, and an
 * entry the gateway withheld re-resolves to the matching refusal. A caller that has not wired the
 * resolver passes `"unknown"` (see `GovernedCapability.availability`); this helper is for callers
 * that HAVE resolved it.
 */
export function gatewayAvailabilityForSeam(availability: CapabilityAvailability): CapabilityAvailability {
  return availability; // identity today — the seam's gate speaks the resolver's own vocabulary.
}

// ── The Chat tool definitions this gateway owns ──────────────────────────────────────────────────
//
// These are the capabilities the Chat workstream has migrated OFF the inline handler array and onto
// the gateway adapter, per the owner ruling (2026-09-01): domains own features, the Spine owns
// governance, Chat is a consumer. They are emitted by `buildGatewayToolDefs`, spread into the
// handler's tool list, and therefore carry no inline `name:` declaration in the handler — which is
// how the chat-tool-registry ratchet descends rather than grows.
//
// The SHAPE matches the handler's other tool defs exactly (OpenAI function-tool schema); moving them
// is a pure relocation, byte-for-byte, so nothing a caller sees changes (§58). The dispatch for each
// stays in the handler and is unchanged by this slice.

/** OpenAI-style function tool definition, as the Chat model consumes it. */
export interface ChatToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * `capability_status` — the gateway's OWN discovery verb. It is not a domain capability; it is how
 * Chat asks the gateway "what can I truthfully do for this workspace right now?", so it lives here
 * rather than in any one domain. Always a read, and admissible for any caller the gateway serves.
 */
export const CAPABILITY_STATUS_TOOL: ChatToolDef = {
  type: "function",
  function: {
    name: "capability_status",
    description:
      "Report truthfully what you can actually do for THIS workspace and THIS person right now — every tool you hold this turn, grouped by area, plus your specialist team. Each comes back with an honest availability: live (do it now), needs_approval (you prepare it, the owner approves), needs_setup (a connection is required first), proof_owed (you can attempt it, but it is not proven here yet — offer to try, never promise the result), planned (not something you can do here yet), not_for_tier (needs the workspace's owner or an admin, or not for this account type), or unavailable (can't be confirmed yet). Call this BEFORE claiming you can do something, so you never promise a capability you don't truly have. Follow the result's note on what the person tells you. Resolved server-side from the tools you were given, this workspace's approval settings and connections, and this person's role — never guessed.",
    parameters: { type: "object", properties: {} },
  },
};

/**
 * `contact.event_status` — a registered contact-domain READ (Spine key contact.event_status,
 * chatTool contact_event_status). It reports whether the contact.created native event fired and
 * reached its subscribers. Its honest-partial degrade (#1147 blocks its substrate migration on prod)
 * lives INSIDE the read, which returns available:false rather than throwing — so the gateway exposes
 * it as a normal read tool and the truthful "not available yet" is the read's answer, never a broken
 * invocation (owner Correction 4).
 */
export const CONTACT_EVENT_STATUS_TOOL: ChatToolDef = {
  type: "function",
  function: {
    name: "contact_event_status",
    description:
      "Check whether the contact.created event actually fired for a new contact, and whether it reached its subscribers — so you can report the truth, never a hoped-for 'it was sent.' Returns each recent new-contact event with its delivery state: how many subscribers it reached, how many were delivered, any errors, and whether it is still processing. Pass contact_id to check one contact, or omit it for the most recent new contacts. No external notification (e.g. a text) is sent yet — this reports the recorded delivery, and you must say so plainly rather than imply a message went out.",
    parameters: {
      type: "object",
      properties: {
        contact_id: {
          type: "string",
          description:
            "Optional. The contact's id (a uuid, e.g. from a prior contact lookup) to check just that contact. Omit to see the most recent new-contact events.",
        },
      },
    },
  },
};

/** The capabilities the gateway owns and decides emission for. Both are tenant-book READS whose
 *  honest degrade lives inside the read itself (the read answers "not available yet"), so their
 *  availability at emission time is `live` — the truth the gateway exposes is "you can ASK"; the
 *  read returns the truthful answer. */
interface GatewayOwnedCapability {
  def: ChatToolDef;
  actionKind: CapabilityActionKind;
  availability: CapabilityAvailability;
}

const GATEWAY_OWNED: readonly GatewayOwnedCapability[] = [
  { def: CAPABILITY_STATUS_TOOL, actionKind: "read", availability: "live" },
  { def: CONTACT_EVENT_STATUS_TOOL, actionKind: "read", availability: "live" },
];

/**
 * The tool definitions the gateway contributes to Chat's tool list. The handler spreads these into
 * `toolDefs`; because they are objects rather than inline literals, they carry no `name:`
 * declaration in the handler and so descend the chat-tool-registry ratchet (10 → 8), which was the
 * observable trigger for this work.
 *
 * Emission runs through `decideGatewayEntry`, so the gateway's own decision core governs what it
 * hands the model rather than a hand-maintained list. Both reads resolve `live` → `tool` → emitted,
 * which is BYTE-IDENTICAL to the static array they replaced — this slice changes nothing a caller
 * sees (§58). The dispatch for each tool stays in the handler, unchanged, and still owns the
 * per-role refusal (a client seat is refused there today, exactly as before).
 *
 * HONEST ON THE RATCHET (§13): moving these two took `chat-tool-registry-lint` from 10 `added` to 8
 * — real progress, but NOT green. That lint fails on ANY `added > 0` ("must not grow"), so it still
 * EXITS NON-ZERO at 8: the eight remaining inline tools are the owner-sanctioned interim migration
 * register, not baselined away (see `docs/brain/decision-log.md` 2026-09-12). 10 → 8 descends the
 * register; it does not clear the check.
 *
 * PER-CALLER, AVAILABILITY-AWARE WITHHOLDING — the gateway hiding a tool whose status is
 * `needs_setup`/`planned`/`not_for_tier`/`unavailable` for this tenant — is the decision core's
 * designed purpose and is tested across every availability. It is deliberately NOT yet wired into
 * emission for these two reads: doing so changes what each TIER sees and is a §51/§58 change that
 * owes per-tier authenticated verification, so it is the next increment, not a silent behaviour
 * change folded into this one (§13).
 */
export function buildGatewayToolDefs(): ChatToolDef[] {
  const defs: ChatToolDef[] = [];
  for (const cap of GATEWAY_OWNED) {
    const entry = decideGatewayEntry({
      availability: cap.availability,
      actionKind: cap.actionKind,
      hasChatTool: true,
    });
    if (entry.emitTool) defs.push(cap.def);
  }
  return defs;
}
