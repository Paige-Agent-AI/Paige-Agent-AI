// Frame typing for the paige-ai-chat stream: one data payload in, one named frame out.
//
// docs/delivery/paige-conversational-loop-c1.md decision 6. This NAMES a frame; it does not decide
// what a surface does with it. Every structured payload is passed through exactly as sent, and each
// consumer keeps its own checks on it (Studio requires a fingerprint on a confirm, the operator
// spine does not), so moving a surface onto this reader changes none of its handling.
//
// The server writes one top-level key per frame. The order below only matters for a frame carrying
// several; it keeps every consumer's own branch order (step before phase before content, confirm
// before content). A known key whose value is falsy is passed over, as every consumer's
// `if (parsed.key)` did.
import { isTurnFrame, TURN_FRAME_KEY, type TurnFrame } from "../../../supabase/functions/_shared/paige-turn/contract";

export type PaigeFrame =
  | { type: "done" }
  /** choices[0].delta.content — the answer's words. */
  | { type: "content"; text: string }
  | { type: "step"; step: unknown }
  | { type: "phase"; phase: unknown }
  | { type: "confirm"; confirm: unknown }
  | { type: "approval_outcome"; outcome: unknown }
  | { type: "choices"; choices: unknown }
  | { type: "artifact"; artifact: unknown }
  | { type: "preview"; preview: unknown }
  | { type: "sync_status"; syncStatus: unknown }
  | { type: "withheld" }
  /** The turn contract (paige_turn), read defensively: a frame outside the contract is "unknown". */
  | { type: "turn"; turn: TurnFrame }
  /** Not JSON at all. The reader's `malformed` option decides what happens next. */
  | { type: "malformed" }
  /** Valid JSON this reader does not name. Every surface drops it: no state, nothing rendered. */
  | { type: "unknown"; frame: unknown };

/** Never throws: anything it cannot name is "unknown", anything it cannot parse is "malformed". */
export function decodePaigeFrame(payload: string): PaigeFrame {
  if (payload === "[DONE]") return { type: "done" };
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { return { type: "malformed" }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { type: "unknown", frame: parsed };
  const o = parsed as Record<string, unknown>;

  if (isTurnFrame(o[TURN_FRAME_KEY])) return { type: "turn", turn: o[TURN_FRAME_KEY] as TurnFrame };
  if (o.paige_step) return { type: "step", step: o.paige_step };
  if (o.paige_phase) return { type: "phase", phase: o.paige_phase };
  if (o.paige_choices) return { type: "choices", choices: o.paige_choices };
  if (o.paige_artifact) return { type: "artifact", artifact: o.paige_artifact };
  if (o.paige_confirm) return { type: "confirm", confirm: o.paige_confirm };
  if (o.paige_approval_outcome) return { type: "approval_outcome", outcome: o.paige_approval_outcome };
  if (o.paige_preview) return { type: "preview", preview: o.paige_preview };
  if (o.sync_status) return { type: "sync_status", syncStatus: o.sync_status };
  if (o.paige_withheld === true) return { type: "withheld" };
  const text = (o.choices as Array<{ delta?: { content?: unknown } }> | undefined)?.[0]?.delta?.content;
  if (typeof text === "string") return { type: "content", text };
  return { type: "unknown", frame: parsed };
}
