import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Mark, type MarkState } from "./Mark";
import { usePrefersReducedMotion } from "./motion";
import "./command.css";

/**
 * Paige gives the command; the page writes it. The Command Mark is the cursor: it rides the end
 * of the line while the letters swipe up into place behind it, then executes — its two ghost
 * slashes stream back across the words it just wrote.
 *
 * Accessible by construction: the heading's text is always present for assistive tech (a
 * visually hidden copy), and the letters are decoration over it. Reduced motion shows the finished
 * line with nothing moving. Layout never shifts while typing: every letter is laid out from the
 * start and only revealed, and the cursor is positioned without taking space.
 */

export type CommandPart = string | { accent: string };

type Glyph = { ch: string; accent: boolean };
type Token = { kind: "word"; glyphs: { g: Glyph; i: number }[] } | { kind: "space"; i: number };

const plain = (parts: CommandPart[]) => parts.map((p) => (typeof p === "string" ? p : p.accent)).join("");

function tokenize(parts: CommandPart[]): { tokens: Token[]; total: number } {
  const glyphs: Glyph[] = [];
  for (const p of parts) {
    const accent = typeof p !== "string";
    for (const ch of typeof p === "string" ? p : p.accent) glyphs.push({ ch, accent });
  }
  const tokens: Token[] = [];
  let word: { g: Glyph; i: number }[] = [];
  glyphs.forEach((g, i) => {
    if (g.ch === " ") {
      if (word.length) tokens.push({ kind: "word", glyphs: word });
      word = [];
      tokens.push({ kind: "space", i });
    } else word.push({ g, i });
  });
  if (word.length) tokens.push({ kind: "word", glyphs: word });
  return { tokens, total: glyphs.length };
}

/** A little human irregularity, but the same every visit: longer after a word or a comma. */
function stepDelay(parts: string, i: number, speed: number) {
  const prev = parts[i - 1];
  const jitter = 0.72 + ((i * 37) % 11) / 18;
  return speed * jitter + (prev === " " ? speed * 0.8 : 0) + (prev === "," ? speed * 4 : 0);
}

function Letters({
  parts,
  shown,
  caret,
  caretKey,
  caretOut,
  leaving,
}: {
  parts: CommandPart[];
  /** How many characters are revealed. */
  shown: number;
  /** The cursor's state, or null for no cursor. */
  caret: MarkState | null;
  caretKey?: string;
  caretOut?: boolean;
  leaving?: boolean;
}) {
  const { tokens, total } = useMemo(() => tokenize(parts), [parts]);
  const at = Math.min(shown, total);
  // The cursor hangs off the last revealed character (or before the first, when nothing is).
  const host = at === 0 ? firstGlyph(tokens) : lastGlyphAtOrBefore(tokens, at - 1);
  const cursor =
    caret === null ? null : (
      <span className="pa-cmd__caret" data-at={at === 0 ? "start" : "end"} data-out={caretOut || undefined}>
        <Mark state={caret} size={48} key={caretKey} />
      </span>
    );

  return (
    <span className="pa-cmd__line" data-leaving={leaving || undefined}>
      {tokens.map((t) =>
        t.kind === "space" ? (
          " "
        ) : (
          <span key={t.glyphs[0].i} className="pa-cmd__word">
            {t.glyphs.map(({ g, i }) => (
              <span
                key={i}
                className={`pa-cmd__ch${g.accent ? " pa-accent" : ""}`}
                data-on={i < at || undefined}
                style={{ ["--o" as string]: i } as CSSProperties}
              >
                <span className="pa-cmd__g">{g.ch}</span>
                {i === host ? cursor : null}
              </span>
            ))}
          </span>
        ),
      )}
    </span>
  );
}

function firstGlyph(tokens: Token[]) {
  for (const t of tokens) if (t.kind === "word") return t.glyphs[0].i;
  return -1;
}
function lastGlyphAtOrBefore(tokens: Token[], index: number) {
  let found = -1;
  for (const t of tokens) {
    if (t.kind !== "word") continue;
    for (const { i } of t.glyphs) if (i <= index) found = i;
  }
  return found;
}

/** Types `total` characters once `start` is true; calls `onDone` when the line is written. */
function useTyping(text: string, start: boolean, speed: number, onDone?: () => void) {
  // The count is kept with the text it counts, so a new line never flashes in fully written.
  const [state, setState] = useState({ text: "", n: 0 });
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!start) return;
    setState({ text, n: 0 });
    let i = 0;
    let timer = 0;
    const tick = () => {
      i += 1;
      // Spaces are revealed with the letter after them, so the cursor never pauses on nothing.
      while (text[i - 1] === " " && i < text.length) i += 1;
      setState({ text, n: i });
      if (i >= text.length) {
        done.current?.();
        return;
      }
      timer = window.setTimeout(tick, stepDelay(text, i, speed));
    };
    timer = window.setTimeout(tick, speed);
    return () => window.clearTimeout(timer);
  }, [text, start, speed]);
  return state.text === text ? state.n : 0;
}

/**
 * A heading Paige writes on arrival: typed by the mark, which executes when the line is done and
 * then steps aside so the headline reads clean.
 */
export function CommandHeading({
  as: Tag = "h1",
  id,
  className,
  parts,
  delay = 280,
  speed = 30,
}: {
  as?: "h1" | "h2";
  id?: string;
  className?: string;
  parts: CommandPart[];
  delay?: number;
  speed?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const text = plain(parts);
  const [start, setStart] = useState(false);
  const [phase, setPhase] = useState<"typing" | "executed" | "gone">("typing");

  useEffect(() => {
    if (reduced) return;
    const t = window.setTimeout(() => setStart(true), delay);
    return () => window.clearTimeout(t);
  }, [reduced, delay]);

  const shown = useTyping(text, start && !reduced, speed, () => setPhase("executed"));

  useEffect(() => {
    if (phase !== "executed") return;
    const t = window.setTimeout(() => setPhase("gone"), 1100);
    return () => window.clearTimeout(t);
  }, [phase]);

  return (
    <Tag id={id} className={`${className ?? ""} pa-cmd`}>
      <span className="pa-sr">{text}</span>
      <span aria-hidden="true">
        {reduced ? (
          <Letters parts={parts} shown={text.length} caret={null} />
        ) : (
          <Letters
            parts={parts}
            shown={shown}
            caret={phase === "typing" ? "charged" : "executed"}
            caretKey={phase === "typing" ? "c" : "x"}
            caretOut={phase === "gone"}
          />
        )}
      </span>
    </Tag>
  );
}

/**
 * The close: Paige works through a run of commands. Each is written by the mark, executed, and
 * swept up and away for the next, until the last one stays — with the mark's orb as its full
 * stop. Starts when the line is well into view; plays once.
 */
export function CommandSequence({
  id,
  className,
  commands,
  label,
  speed = 46,
  hold = 620,
}: {
  id?: string;
  className?: string;
  /** Written in order; the last one stays. */
  commands: string[];
  /** What the heading says to assistive tech: the command it lands on. */
  label: string;
  speed?: number;
  hold?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLHeadingElement>(null);
  const [inView, setInView] = useState(false);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"typing" | "executed" | "leaving">("typing");
  const last = index === commands.length - 1;
  const partsList = useMemo(() => commands.map((c) => [c] as CommandPart[]), [commands]);

  useEffect(() => {
    const el = ref.current;
    if (reduced || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  const shown = useTyping(commands[index], inView && phase === "typing", speed, () => setPhase("executed"));

  useEffect(() => {
    if (phase === "executed" && !last) {
      const t = window.setTimeout(() => setPhase("leaving"), hold);
      return () => window.clearTimeout(t);
    }
    if (phase === "leaving") {
      const t = window.setTimeout(() => {
        setIndex((i) => i + 1);
        setPhase("typing");
      }, 480);
      return () => window.clearTimeout(t);
    }
  }, [phase, last, hold]);

  const final = commands[commands.length - 1];

  return (
    <h2 id={id} ref={ref} className={`${className ?? ""} pa-cmd pa-cmd--sequence`}>
      <span className="pa-sr">{label}</span>
      <span className="pa-cmd__stack" aria-hidden="true">
        {/* Every command laid out invisibly in one cell, so the line never changes size. */}
        {commands.map((c) => (
          <span key={c} className="pa-cmd__reserve">
            <Letters parts={[c]} shown={c.length} caret={null} />
          </span>
        ))}
        <span className="pa-cmd__live">
          {reduced ? (
            <Letters parts={[final]} shown={final.length} caret="spectral" />
          ) : (
            <Letters
              key={index}
              parts={partsList[index]}
              shown={inView ? shown : 0}
              caret={!inView ? "dormant" : phase === "typing" ? "charged" : "executed"}
              caretKey={`${index}-${phase === "typing" ? "c" : "x"}`}
              leaving={phase === "leaving"}
            />
          )}
        </span>
      </span>
    </h2>
  );
}

/**
 * An accent word in a section heading, set letter by letter so it can swipe up into place once
 * its heading has landed (see the reveal rules in home.css). Reads as one word to assistive tech.
 */
export function Accent({ children }: { children: string }) {
  const { tokens } = useMemo(() => tokenize([children]), [children]);
  return (
    <span className="pa-accent">
      <span className="pa-sr">{children}</span>
      <span aria-hidden="true">
        {tokens.map((t) =>
          t.kind === "space" ? (
            " "
          ) : (
            <span key={t.glyphs[0].i} className="pa-cmd__word">
              {t.glyphs.map(({ g, i }) => (
                <span key={i} className="pa-cmd__g" style={{ ["--k" as string]: i } as CSSProperties}>
                  {g.ch}
                </span>
              ))}
            </span>
          ),
        )}
      </span>
    </span>
  );
}
