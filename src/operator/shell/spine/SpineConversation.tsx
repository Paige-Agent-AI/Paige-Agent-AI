/**
 * The chat face — `v3.dc.html` L4064–L4140. The Trust Compass strip, the transcript, and the
 * presence line, inside the one scroll region the pack gives them
 * (`data-chat-scroll`, `flex:1; min-height:0; overflow:auto; padding:18px 16px 8px`, L4065).
 *
 * §18 — THIS IS NOT A CHAT ENGINE AND MUST NOT BECOME ONE. The platform already has one. There
 * is no thread store here, no send path, no streaming client, no persistence and no model call.
 * `turns` arrives as a prop, every callback goes back out, and the only state this component
 * owns is which collapsed reasoning strip is open — which is chrome, not conversation.
 *
 * NOTHING IN THE PACK'S TRANSCRIPT IS PORTED. `transcript` at L10691–L10714 is fixture: the
 * two tenant ids, the sweep prose, the three decision options, `took:'4s'`. What comes over is
 * the SHAPE and the authored chrome around it — the speaker line, the collapsed
 * `Thought for …` strip, the decision block's `Pick one and she continues` /
 * `Or just tell her in the composer.`, `Not now`, and the presence sentences. With no turns
 * the component renders the strip only; with no trust read it renders nothing at all, which is
 * what makes `spineHasContent()` honest.
 *
 * WHY THE PACK'S `took` DEFAULT IS DROPPED. `traceLabel` reads
 * `'Thought for ' + (t.took || '3s')` (L11087). `'3s'` is a fabricated duration and does not
 * come over; a trace with no measured duration reads `Thought for —`, the designed absence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type {
  SpineAskOption,
  SpinePresence,
  SpineTrust,
  SpineTrustLevel,
  SpineTurn,
} from "@/operator/shell/spine/spineContract";
import { TRUST_LEVELS } from "@/operator/shell/spine/SpineHeader";
import { ACT_BUTTON } from "@/operator/shell/spine/spineStyles";

/**
 * `trustSteps` — L4631–L4640. The readout IS the control: a 15×20 hit area around a 6px bar
 * keeps the graphic quiet while staying reachable, and the level name lives in the label.
 */
function stepBarStyle(i: number, level: SpineTrustLevel): React.CSSProperties {
  const lit = i <= level;
  return {
    width: "6px",
    height: `${6 + i * 2.5}px`,
    background: lit
      ? i === level
        ? "var(--pg-gold)"
        : "var(--pg-gold-deep)"
      : "var(--pg-line-strong)",
    opacity: lit ? 1 : 0.55,
    transition: "background 140ms ease, opacity 140ms ease",
  };
}

/**
 * `trustLine` — L11074–L11076. Two authored sentences; both figures come from a real tally.
 * No tally, no line (§13) — a count of capabilities at a ceiling is a governance claim.
 */
function trustLine(tally: readonly [number, number, number, number] | null | undefined): string | null {
  if (!tally) return null;
  if (tally[3]) {
    return `All ${tally[3]} capabilities held at this ceiling. She reads and reports, and acts on nothing.`;
  }
  return `${tally[0]} autonomous · ${tally[1]} ask first · ${tally[2]} draft only`;
}

export type SpineConversationProps = {
  readonly trust?: SpineTrust | null;
  readonly turns?: readonly SpineTurn[];
  readonly presence?: SpinePresence | null;
};

export default function SpineConversation({ trust, turns = [], presence }: SpineConversationProps) {
  const reduce = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [traceOpen, setTraceOpen] = useState<Record<string, boolean>>({});

  /**
   * `chatSig` + `stickChat` — L4249–L4266. New conversation content must be visible without
   * being hunted for. Normally the newest thing is the bottom; while she is thinking the live
   * block is the subject, so its top aligns to the top of the pane.
   */
  const signature = useMemo(
    () =>
      turns
        .map((t) => `${t.id}:${t.trace?.length ?? 0}:${t.body?.length ?? 0}:${t.live ? 1 : 0}`)
        .join("|"),
    [turns],
  );
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const live = el.querySelector<HTMLElement>("[data-live-block]");
    if (live) {
      el.scrollTop = Math.max(0, live.offsetTop - 14);
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [signature]);

  const toggleTrace = useCallback((id: string) => {
    setTraceOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const line = trustLine(trust?.tally);
  /**
   * `showPresence` — L11137. Only while you are writing, or while she is working with nothing
   * else to show. A live trace or a streaming answer already says she is thinking, and two
   * indicators for one state is noise.
   */
  const hasLive = turns.some((t) => t.live || t.streaming);
  const showPresence = !!presence && (presence.writing || (presence.running && !hasLive));

  return (
    <div
      ref={scrollRef}
      data-chat-scroll="1"
      className="min-h-0 min-w-0 flex-1 overflow-auto px-4 pb-2 pt-[18px]"
    >
      {/* ── the ceiling · L4067–L4079 ──────────────────────────────────────────────────────
          It reads ABOVE the conversation: it is a control, and the newest turn must own the
          scroll bottom. */}
      {trust ? (
        <div
          id="pg-trust-inline"
          data-trust="1"
          className="mb-4 border-b border-[var(--pg-line-soft)] pb-3"
        >
          <div className="flex items-center gap-[10px]">
            <span className="flex flex-none items-end gap-px">
              {TRUST_LEVELS.map((lv, i) => (
                <button
                  key={lv.label}
                  type="button"
                  title={lv.label}
                  aria-label={lv.label}
                  onClick={trust.onPick ? () => trust.onPick?.(i as SpineTrustLevel) : undefined}
                  disabled={!trust.onPick}
                  className="grid h-[20px] w-[15px] flex-none place-items-end justify-items-center border-0 bg-transparent p-0 disabled:cursor-not-allowed"
                >
                  <i aria-hidden style={stepBarStyle(i, trust.level)} />
                </button>
              ))}
            </span>
            <b className="min-w-0 truncate text-[length:var(--pg-t-label)] font-medium text-[var(--pg-gold-deep)]">
              Trust Compass — {TRUST_LEVELS[trust.level].label}
            </b>
            <button
              type="button"
              onClick={trust.onOpenPanel}
              disabled={!trust.onOpenPanel}
              className="ml-auto min-h-[24px] flex-none border-0 bg-transparent px-[2px] text-[length:var(--pg-t-label)] text-[var(--pg-faint)] disabled:cursor-not-allowed"
            >
              Full panel
            </button>
          </div>
          {line ? (
            <p className="mt-1.5 max-w-[46ch] text-[length:var(--pg-t-label)] leading-[1.5] text-[var(--pg-faint)]">
              {line}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── the transcript · L4081–L4127 ───────────────────────────────────────────────── */}
      {turns.map((t) => {
        const open = t.live || !!traceOpen[t.id];
        return (
          <div
            key={t.id}
            data-live-block={t.live ? "1" : undefined}
            style={wrapStyle(t)}
          >
            <small
              className="block text-[length:var(--pg-t-label)] font-medium tracking-[0.02em]"
              style={{ color: toneColor(t.tone) }}
            >
              {t.who}
            </small>

            {/* a reasoning trace is her working, not her answer · L4085–L4097 */}
            {t.trace ? (
              <>
                <button
                  type="button"
                  onClick={() => toggleTrace(t.id)}
                  className="inline-flex min-h-[26px] items-center gap-2 border-0 bg-transparent p-0 font-mono text-[length:var(--pg-t-label)] font-normal tracking-[0.02em]"
                  style={{ color: t.live ? "var(--pg-violet)" : "var(--pg-faint)" }}
                  aria-expanded={open}
                >
                  <i
                    aria-hidden
                    style={{
                      width: "5px",
                      height: "5px",
                      rotate: "45deg",
                      background: t.live ? "var(--pg-violet)" : "var(--pg-line-strong)",
                      animation: t.live && !reduce ? "pg-think 1.15s ease-in-out infinite" : "none",
                    }}
                  />
                  {t.live ? "Thinking" : `Thought for ${t.took ?? "—"}`}
                  <span
                    aria-hidden
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRight: "1px solid currentColor",
                      borderBottom: "1px solid currentColor",
                      transform: open ? "rotate(45deg)" : "rotate(-45deg)",
                      opacity: t.live ? 0 : 0.8,
                    }}
                  />
                </button>
                {open ? (
                  <div className="mt-[9px] border-l border-[var(--pg-line-strong)] pl-[11px]">
                    {t.trace.map((step, si) => (
                      <p
                        key={`${t.id}-step-${si}`}
                        className="max-w-[40ch] text-[length:var(--pg-t-body)] font-normal leading-[1.55] text-[var(--pg-muted)] [text-wrap:pretty]"
                        style={{
                          margin: si ? "7px 0 0" : 0,
                          animation: reduce ? "none" : "pg-reveal 260ms cubic-bezier(.22,1,.36,1) both",
                          animationDelay: `${si * 90}ms`,
                        }}
                      >
                        {step}
                      </p>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}

            {/* her voice is set in the editorial face; yours stays in the UI face · L4099–L4101 */}
            {t.body ? (
              <p style={bodyStyle(t)} className={t.mine ? undefined : "font-serif"}>
                {t.body}
                <i
                  aria-hidden
                  style={
                    t.streaming
                      ? {
                          display: "inline-block",
                          width: "2px",
                          height: "1em",
                          marginLeft: "3px",
                          verticalAlign: "-2px",
                          background: "var(--pg-gold)",
                          animation: reduce ? "none" : "pg-caret 900ms steps(1) infinite",
                        }
                      : { display: "none" }
                  }
                />
              </p>
            ) : null}

            {/* a question card: she asks rather than guesses · L4103–L4118 */}
            {t.ask?.length ? (
              <div className="mt-3 border-t border-[var(--pg-line-soft)] pt-[11px]">
                <small className="block text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">
                  {t.askNote ?? "Pick one and she continues"}
                </small>
                <div className="mt-[9px] flex flex-col gap-px">
                  {t.ask.map((op) => (
                    <button
                      key={op.label}
                      type="button"
                      onClick={t.onAnswer ? () => t.onAnswer?.(op as SpineAskOption) : undefined}
                      disabled={!t.onAnswer}
                      className="flex w-full min-w-0 items-center gap-[11px] px-3 py-2 text-[var(--pg-ink)] disabled:cursor-not-allowed"
                      style={{
                        // L11122-L11126, written inline rather than as `border-0 border-t` so the
                        // one-sided hairline cannot depend on Tailwind's utility emission order.
                        border: 0,
                        borderTop: "1px solid var(--pg-line-soft)",
                        minHeight: "46px",
                        borderRadius: t.answered === op.label ? "var(--pg-r-chip)" : 0,
                        background: t.answered === op.label ? "var(--pg-lift)" : "transparent",
                      }}
                    >
                      <span className="flex min-w-0 flex-col text-left">
                        <b className="text-[length:var(--pg-t-body)] font-medium">{op.label}</b>
                        <small className="mt-0.5 text-[length:var(--pg-t-label)] text-[var(--pg-faint)] [text-wrap:pretty]">
                          {op.note}
                        </small>
                      </span>
                      <span
                        aria-hidden
                        style={{
                          marginLeft: "auto",
                          flex: "none",
                          width: "7px",
                          height: "7px",
                          rotate: "45deg",
                          background: t.answered === op.label ? "var(--pg-gold)" : "transparent",
                          outline: t.answered === op.label ? "none" : "1px solid var(--pg-line-strong)",
                        }}
                      />
                    </button>
                  ))}
                </div>
                <p className="mt-[9px] text-[length:var(--pg-t-label)] text-[var(--pg-faint)]">
                  {t.askFoot ?? "Or just tell her in the composer."}
                </p>
              </div>
            ) : null}

            {/* WHAT the act covers, one line each. Not a pack block — see `actItems` in
                spineContract.ts for why this exists and why it borrows the ask row's type spec
                (hairline-topped, label weight) so it reads as one system with the block above. */}
            {t.actItems?.length ? (
              <ul className="mt-[9px] flex flex-col gap-px">
                {t.actItems.map((line, i) => (
                  <li
                    key={`${t.id}-item-${i}`}
                    className="flex min-w-0 gap-[9px] py-2 text-[var(--pg-ink)] [text-wrap:pretty]"
                    style={{
                      // Inline, not `border-t`, for the reason the ask row states above: a
                      // one-sided hairline must not depend on Tailwind's utility emission order.
                      borderTop: "1px solid var(--pg-line-soft)",
                      fontSize: "var(--pg-t-body)",
                      fontWeight: 500,
                      lineHeight: 1.5,
                    }}
                  >
                    <span aria-hidden className="flex-none text-[var(--pg-faint)]">·</span>
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* the act a turn carries · L4120–L4125 */}
            {t.act ? (
              <div className="mt-[11px] flex flex-wrap gap-1.5">
                <button type="button" onClick={t.onAct} disabled={!t.onAct} style={ACT_BUTTON}>
                  {t.act}
                </button>
                <button
                  type="button"
                  onClick={t.onDismiss}
                  disabled={!t.onDismiss}
                  className="min-h-[30px] border-0 bg-transparent px-[11px] text-[length:var(--pg-t-label)] text-[var(--pg-faint)] disabled:cursor-not-allowed"
                >
                  Not now
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      {/* ── presence · L4129–L4138 ─────────────────────────────────────────────────────────
          The small inference that she is aware of you between turns. Three states, and never a
          claim — she is either reading you, listening, or acting. */}
      {showPresence && presence ? (
        <div className="mt-[18px] flex items-center gap-[9px] border-t border-[var(--pg-line-soft)] pt-[13px]">
          <span className="flex items-center gap-[3px]">
            {[0, 1, 2].map((i) => (
              <i
                key={i}
                aria-hidden
                style={{
                  width: "4px",
                  height: "4px",
                  rotate: "45deg",
                  background: presence.writing ? "var(--pg-gold-deep)" : "var(--pg-violet)",
                  animation: reduce ? "none" : "pg-think 1.15s ease-in-out infinite",
                  animationDelay: `${i * 140}ms`,
                }}
              />
            ))}
          </span>
          <span className="min-w-0 font-serif text-[length:var(--pg-t-body)] italic leading-[1.5] text-[var(--pg-muted)]">
            {presence.writing
              ? `She is holding while you write${presence.running ? " — and still working" : ""}`
              : presence.listening
                ? "Listening"
                : "Working on it — keep talking"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** `t.tone` — L11109. The pack's two toned speakers; everything else is `--pg-faint`. */
function toneColor(tone: SpineTurn["tone"]): string {
  if (tone === "negative") return "var(--pg-negative)";
  if (tone === "gold") return "var(--pg-gold-deep)";
  return "var(--pg-faint)";
}

/**
 * `wrapStyle` — L11115–L11120. Three shapes: your turn takes a left rail, a turn carrying an
 * act takes a plate with a gold left edge, everything else is bare.
 *
 * ELEVATION: the act plate carries `--pg-lift-1`, so it RISES → `--pg-raised` in both themes.
 * The pack writes `--pg-surface` there (L11118); see `spineStyles.ts` for the measurement and
 * the reason one token carries the rising role across this column.
 */
function wrapStyle(t: SpineTurn): React.CSSProperties {
  if (t.mine) {
    return { marginLeft: "22px", padding: "9px 0 9px 14px", borderLeft: "1px solid var(--pg-line-strong)" };
  }
  if (t.act) {
    return {
      marginTop: "14px",
      padding: "14px 15px",
      background: "var(--pg-raised)",
      borderRadius: "var(--pg-r-plate)",
      boxShadow: "var(--pg-lift-1)",
      borderLeft: "1px solid var(--pg-gold-deep)",
    };
  }
  return { padding: "16px 2px 6px" };
}

/** `bodyStyle` — L11111–L11113. Yours in the UI face at 13/1.6, hers editorial at 15/1.62. */
function bodyStyle(t: SpineTurn): React.CSSProperties {
  return t.mine
    ? {
        maxWidth: "44ch",
        marginTop: "6px",
        color: "var(--pg-ink-2)",
        fontWeight: 400,
        fontSize: "var(--pg-t-body)",
        lineHeight: 1.6,
        textWrap: "pretty",
      }
    : {
        maxWidth: "42ch",
        marginTop: "8px",
        color: "var(--pg-ink)",
        fontWeight: 400,
        fontSize: "var(--pg-t-lead)",
        lineHeight: 1.62,
        textWrap: "pretty",
      };
}
