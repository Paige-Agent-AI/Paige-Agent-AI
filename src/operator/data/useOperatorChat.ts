/**
 * ─── THE OPERATOR CHAT, WIRED TO THE ENGINE THAT ALREADY EXISTS (§18) ────────────────────────
 *
 * The defect this closes, found 2026-08-24 against the owner's side-by-side: the spine is a
 * fully-ported chat surface with NOTHING behind it. `OperatorSpine` takes `transcript` and
 * `onSend` as props and — correctly, per its own docblock — refuses to own an engine:
 *
 *   "NOT PORTED (§18, deliberately): any chat engine. The platform already has one. Nothing here
 *    stores a thread, sends a message, streams a token or calls a model."
 *
 * That was the right call and it was never finished. Nothing in `src/operator/` passed either
 * prop, so the operator could type into a live-looking composer and nothing happened — a control
 * that looks live and silently does nothing is the exact §13/§36 failure the doctrine names.
 *
 * This is the missing half: the caller. It does NOT reimplement the engine — it POSTs the same
 * `paige-ai-chat` seam the app and Studio chats already use, with the operator's own JWT.
 *
 * WHY THE OPERATOR PERSONA NEEDS NO ARGUMENT HERE (§52). `paige-ai-chat` composes the operator
 * briefing SERVER-side, gated on `is_platform_operator()` derived from the verified JWT — never
 * from anything a caller sends. So passing the operator's token is the whole of it: she opens
 * already briefed, and a tenant token through this same seam gets the tenant persona instead. A
 * client-supplied "I am the operator" flag would be a §588 hole; there is deliberately none.
 *
 * ─── THE APPROVAL PLATE (2026-09-24) ─────────────────────────────────────────────────────────
 *
 * Paige's autonomy gate refuses to run a mutating action until the person approves the EXACT
 * call, and it proves which call by issuing a fingerprint the surface must echo back. Until now
 * this surface dropped those frames on the floor: the SSE loop read only
 * `choices[0].delta.content`, so a `paige_confirm` frame — valid JSON with no `choices` — became
 * `undefined` and fell out of the loop. Not caught, not logged, just gone.
 *
 * The consequence was worse than a missing card. For an action the risk policy classes `high`,
 * the server REFUSES the model's own "they said yes" channel outright and tells it to point the
 * operator at "the Needs your OK card in this conversation" — a card this surface did not draw.
 * So every high-risk action was permanently unreachable here, and the operator was told to click
 * something that did not exist. That is the §70 dead end this closes.
 *
 * WHAT THE ECHO IS, AND WHY TEXT WILL NOT DO. Approving by sending the sentence alone does not
 * approve nothing — it silently falls back to the model's assertion, which is by SCOPE rather
 * than by call ("something was approved", not "this was"). So the fingerprints ride the ordinary
 * next POST as `approvedConfirmations`, and a refusal rides it as `declinedConfirmations` —
 * a prose-only "no" leaves the proposal redeemable for its whole window.
 *
 * The fingerprints are a PARAMETER of `run`, never component state. They are content-derived and
 * therefore stable forever, so a surface that remembered one and echoed it on every later request
 * would silently auto-approve the next identical proposal without anybody clicking.
 *
 * HONEST FAILURE (§13). A refused or broken stream lands in the transcript as a turn that says
 * what failed. It never disappears, and it never leaves a half-written answer looking complete.
 */
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SpineTurn } from "@/operator/shell/spine/spineContract";
import { readPaigeStream } from "@/lib/paige-stream";

/** The server's own shape for a fingerprint: `z.array(z.string().regex(...)).max(16)`. A single
 *  malformed entry fails the WHOLE request body, taking the operator's message down with the
 *  approval, so the shape is enforced here rather than hoped for. */
// The server's confirm gate returns BOTH forms: a bare 16-hex fingerprint, and the scoped
// `${fingerprint}:${requestNonce}` token a freshly-created proposal carries. Filtering on the
// bare form alone drops every fresh card's token, leaving the plate to render summaries with no
// Approve control — the high-risk action becomes unreachable (§70). Accept the full shape the
// request schema itself models.
const FINGERPRINT_RE = /^[0-9a-f]{16}(?::[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;
const MAX_FINGERPRINTS = 16;

type EngineMessage = { role: "user" | "assistant"; content: string };

/** One pending action, exactly as the wire carries it (`paige_confirm`). */
type PendingConfirm = { tool: string; summary: string; fingerprint?: string };

/** The fingerprints of the calls THIS surface drew, echoed on the turn that decides them. */
type Approvals = { approved?: readonly string[]; declined?: readonly string[] };

export type OperatorChat = {
  readonly transcript: readonly SpineTurn[];
  /** True while a turn is in flight — the composer disables itself rather than queueing. */
  readonly busy: boolean;
  readonly send: (text: string) => void;
};

/**
 * `who` follows the pack's own transcript fixture (L10831–L10837): the operator is `You`, she is
 * `Paige`. Not a label choice — a port.
 */
function turn(id: string, mine: boolean, body: string, extra: Partial<SpineTurn> = {}): SpineTurn {
  return { id, who: mine ? "You" : "Paige", mine, body, ...extra };
}

export function useOperatorChat(enabled: boolean = true): OperatorChat {
  const [transcript, setTranscript] = useState<readonly SpineTurn[]>([]);
  const [busy, setBusy] = useState(false);
  // The engine wants the whole exchange, and reading it off `transcript` would rebuild prose that
  // has already been styled. Kept separately so what is SENT stays exactly what was said.
  const history = useRef<EngineMessage[]>([]);
  const seq = useRef(0);
  // THE GUARD IS REF-BACKED SO THE RUNNER CAN BE IDENTITY-STABLE. An approve handler is created
  // inside the async body of an earlier turn; if the guard read `busy` from that render's closure
  // it would read a value captured minutes ago, and a click during a later stream would fire a
  // second concurrent request straight past it — two turns writing the same bubble.
  const busyRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  /** Returns whether the turn was actually STARTED. The plate clears itself only on `true`, so a
   *  refused click never wipes a live card that sent nothing. */
  const run = useCallback((text: string, approvals?: Approvals): boolean => {
    const body = text.trim();
    if (!enabledRef.current || !body || busyRef.current) return false;

    const mineId = `u${(seq.current += 1)}`;
    const hersId = `a${(seq.current += 1)}`;
    history.current = [...history.current, { role: "user", content: body }];

    setTranscript((prev) => [
      ...prev,
      turn(mineId, true, body),
      // Her turn opens EMPTY and streaming, which is what makes the caret honest: it is there
      // because tokens are actually arriving, not as decoration on a request that may fail.
      turn(hersId, false, "", { streaming: true }),
    ]);
    setBusy(true);
    busyRef.current = true;

    void (async () => {
      const settle = (patch: Partial<SpineTurn>) =>
        setTranscript((prev) =>
          prev.map((t) => (t.id === hersId ? { ...t, streaming: false, ...patch } : t)),
        );

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          settle({
            body: "You are not signed in any more, so nothing was sent. Sign in and say it again.",
            tone: "negative",
          });
          return;
        }

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paige-ai-chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            // The keys are OMITTED when empty rather than sent as `[]`, because the moment a
            // request echoes ANY fingerprint the server disables the by-scope fallback for every
            // tool in that request. An empty array would switch it off while approving nothing.
            // No `threadId` is sent, deliberately — proposals are recorded and matched against a
            // null thread, and the two turns must agree or the claim silently never binds.
            body: JSON.stringify({
              messages: history.current,
              ...(approvals?.approved?.length ? { approvedConfirmations: approvals.approved } : {}),
              ...(approvals?.declined?.length ? { declinedConfirmations: approvals.declined } : {}),
            }),
          },
        );

        if (!res.ok || !res.body) {
          // The status is named rather than swallowed — "something went wrong" is what sends
          // the next session guessing (§32: a failure must be loud).
          settle({
            body: `She could not be reached — the request came back ${res.status}. Nothing was sent.`,
            tone: "negative",
          });
          return;
        }

        let answer = "";
        const confirmThisTurn: PendingConfirm[] = [];

        // The shared reader (src/lib/paige-stream) owns the framing — a chunk that splits mid-line
        // carries its tail, so a cut never silently truncates her answer. As this loop always did,
        // `[DONE]` does not end the read and a line that is not JSON is skipped: one unparseable
        // frame is not a failed answer.
        for await (const frame of readPaigeStream(res.body, { stopAtDone: false, malformed: "skip" })) {
          // ROUTE ON THE FRAME KIND. Reading `choices[0].delta.content` directly is what dropped
          // every structured frame the engine sends: they parse cleanly, have no `choices`, and
          // evaluated to `undefined` with no branch to catch them.
          const pending = frame.type === "confirm"
            ? (frame.confirm as { tool?: unknown; summary?: unknown; fingerprint?: unknown })
            : undefined;
          if (pending && typeof pending.summary === "string") {
            // One frame per gated call. A frame with no fingerprint is un-approvable by echo
            // and is still LISTED, so the operator sees what she is asking for — but it
            // cannot open the gate, and the plate refuses to draw Approve over an empty set.
            const next: PendingConfirm = {
              tool: String(pending.tool ?? "action"),
              summary: pending.summary,
              ...(typeof pending.fingerprint === "string"
                ? { fingerprint: pending.fingerprint }
                : {}),
            };
            // ONE ROW PER ACTION. The agent can gate the same tool across several rounds
            // inside a single turn, and each gated result emits its own frame — so without
            // this the plate lists one action twice and asks for it twice. The fingerprint
            // identifies the exact call; a frame without one falls back to its sentence.
            const already = confirmThisTurn.some((c) =>
              next.fingerprint ? c.fingerprint === next.fingerprint : c.summary === next.summary,
            );
            if (!already) confirmThisTurn.push(next);
            continue;
          }

          if (frame.type === "content" && frame.text) {
            answer += frame.text;
            setTranscript((prev) =>
              prev.map((t) => (t.id === hersId ? { ...t, body: answer } : t)),
            );
          }
        }

        // A turn that is ALL proposal and no prose is a real turn, not an empty one. Stamping the
        // negative over it would print a false failure on top of a true request (§13).
        if (!answer.trim() && confirmThisTurn.length === 0) {
          settle({
            body: "The connection held but she sent nothing back. Nothing was saved.",
            tone: "negative",
          });
          return;
        }

        // WHAT THE NEXT TURN CAN READ BACK. Conversation history crosses a turn boundary as
        // `{ role, content }` only — tool calls and tool results do not — so on the approving turn
        // the model has nothing but prose to reason from. A turn that was all proposal would
        // otherwise leave NO assistant entry at all, and the operator's "Approved — run it." would
        // follow their own previous message with no record in between of what was proposed.
        // Recording the summaries keeps the binding on something the model can actually reproduce.
        const spokenRecord = answer.trim()
          ? answer
          : confirmThisTurn.length === 1
            ? `I need your OK before I do this: ${confirmThisTurn[0].summary}`
            : `I need your OK before I do these: ${confirmThisTurn.map((c) => `— ${c.summary}`).join(" ")}`;
        if (spokenRecord.trim()) {
          history.current = [...history.current, { role: "assistant", content: spokenRecord }];
        }

        const fingerprints = confirmThisTurn
          .map((c) => c.fingerprint)
          .filter((f): f is string => typeof f === "string" && FINGERPRINT_RE.test(f))
          .slice(0, MAX_FINGERPRINTS);

        const plateId = `c${(seq.current += 1)}`;
        // Clearing removes `act` itself, not merely its handlers: the act button is a gold plate
        // with no disabled treatment, so dropping only `onAct` would leave a button that still
        // looks completely live and does nothing — the dead control this file exists to end.
        const clear = () =>
          setTranscript((prev) =>
            prev.map((t) =>
              t.id === plateId ? { ...t, act: null, onAct: undefined, onDismiss: undefined } : t,
            ),
          );
        // Start the turn FIRST and clear only if it actually began. Clearing first and having the
        // guard refuse would wipe a live card on a request that never left the browser.
        const decide = (say: string, approvals: Approvals) => {
          if (run(say, approvals)) clear();
        };

        // ONE COMMIT: settle her turn and append the plate together, so the conversation's scroll
        // effect fires once rather than twice.
        setTranscript((prev) => {
          const spoke = answer.trim().length > 0;
          // A turn that was ALL proposal leaves her bubble with nothing in it. Rendering a bare
          // "Paige" label above the plate is noise, not honesty — the plate is what she said.
          const next = spoke
            ? prev.map((t) => (t.id === hersId ? { ...t, streaming: false, body: answer } : t))
            : prev.filter((t) => t.id !== hersId);
          if (!confirmThisTurn.length) return next;
          return [
            ...next,
            turn(plateId, false, "", {
              who:
                confirmThisTurn.length > 1
                  ? `Paige — needs your OK · ${confirmThisTurn.length} actions`
                  : "Paige — needs your OK",
              tone: "gold",
              actItems: confirmThisTurn.map((c) => c.summary),
              // No fingerprint reached us, so nothing here can be approved by echo. Listing the
              // summaries without an Approve button is the honest state: a button that silently
              // downgrades to the model's own word is worse than no button (§13/§70).
              ...(fingerprints.length
                ? {
                    act: confirmThisTurn.length > 1 ? "Approve all" : "Approve",
                    onAct: () => decide("Approved — run it.", { approved: fingerprints }),
                    onDismiss: () =>
                      decide("Hold off — skip that one.", { declined: fingerprints }),
                  }
                : {}),
            }),
          ];
        });
      } catch (e) {
        settle({
          body: `She could not be reached — ${e instanceof Error ? e.message : String(e)}. Nothing was sent.`,
          tone: "negative",
        });
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    })();

    return true;
  }, []);

  const send = useCallback((text: string) => { run(text); }, [run]);

  return { transcript, busy, send };
}
