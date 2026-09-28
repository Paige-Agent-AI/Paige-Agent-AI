import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Mark, type MarkState } from "./Mark";

/**
 * The hero's one loop, as a four-beat measure (8s):
 *   1 Handed in — a client message arrives in Paige's chat
 *   2 Read      — Paige reads it (the mark charges)
 *   3 Written   — the reply writes itself, in the owner's voice, while you watch
 *   4 Your call — Send or Edit; the owner presses Send, the mark executes, RUN EVERYTHING strikes
 *
 * Honest by construction: the message is handed to Paige (inbox reading is in build), the owner
 * sends it, and the whole surface is labelled illustrative. Reduced motion shows the composed
 * beat-four state with nothing moving; the loop pauses off-screen, when the tab is hidden, and on
 * the visitor's command (WCAG 2.2.2).
 */

const LOOP = 8000;
const T_READ = 900;
const T_WRITE = 1900;
const T_DECIDE = 5600;
const T_SEND = 6700;
const T_FADE = 7750;

const INCOMING =
  "Hi! Something came up Thursday. Can we move our session to next week? And could you resend the prep questions?";
const REPLY = [
  "Hi Dana, of course.",
  "Next week I have Tuesday at 10 or Wednesday at 2. Grab whichever works on my booking page and it's yours.",
  "The prep questions are below so they're right here when you need them.",
  "Talk soon, Jordan",
];

const BEATS = ["Handed in", "Read", "Written", "Your call"];

/** The playhead keeps time with the beats: each beat's slice of the loop owns one quarter of the staff. */
const EDGES = [0, T_READ, T_WRITE, T_DECIDE, LOOP];
function playhead(t: number) {
  for (let i = 0; i < 4; i++) {
    if (t < EDGES[i + 1]) return (i + (t - EDGES[i]) / (EDGES[i + 1] - EDGES[i])) / 4;
  }
  return 1;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export function HeroMeasure({ children, honest }: { children: ReactNode; honest: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const [userPaused, setUserPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [t, setT] = useState(reduced ? T_SEND - 1 : 0);
  const ref = useRef<HTMLDivElement>(null);
  const clock = useRef({ last: 0, t: 0 });

  const words = useMemo(() => REPLY.map((line) => line.split(" ")), []);
  const totalWords = useMemo(() => words.reduce((n, w) => n + w.length, 0), [words]);

  // Pause when off-screen or the tab is hidden: no CPU spent on a loop nobody sees.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const running = !reduced && !userPaused && visible;

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    clock.current.last = performance.now();
    const tick = (now: number) => {
      if (document.hidden) {
        clock.current.last = now;
      } else {
        clock.current.t = (clock.current.t + (now - clock.current.last)) % LOOP;
        clock.current.last = now;
        setT(clock.current.t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // Reduced motion: hold the composed decision moment, nothing moving, nothing "sent".
  const now = reduced ? T_SEND - 1 : t;
  const beat = now < T_READ ? 0 : now < T_WRITE ? 1 : now < T_DECIDE ? 2 : 3;
  const writeProgress = Math.min(1, Math.max(0, (now - T_WRITE) / (T_DECIDE - T_WRITE - 250)));
  const shownWords = beat < 2 ? 0 : Math.round(writeProgress * totalWords);
  const sent = now >= T_SEND;
  const fading = now >= T_FADE;

  const markState: MarkState = sent ? "executed" : beat >= 1 ? "charged" : "dormant";
  const status = sent
    ? "Sent, 9:42"
    : beat === 0
      ? "New message"
      : beat === 1
        ? "Reading"
        : beat === 2
          ? "Writing in your voice"
          : "Ready for you";

  let remaining = shownWords;
  const renderedLines = words.map((lineWords, i) => {
    const take = Math.max(0, Math.min(lineWords.length, remaining));
    remaining -= take;
    return { i, text: lineWords.slice(0, take).join(" "), done: take === lineWords.length, started: take > 0 };
  });
  const writing = beat === 2 && shownWords < totalWords;

  return (
    <div className="pa-hero__stage" ref={ref}>
      <div className="pa-wrap pa-hero__grid">
        <div className="pa-hero__copy">{children}</div>
        <figure className="pa-measure">
          <p className="pa-sr">
            Illustration: a client asks to move a session and resend prep questions. You hand the
            message to Paige, she reads it, writes the reply in your voice, and waits. You choose
            Send or Edit.
          </p>
          <div className={`pa-measure__plane${fading ? " is-fading" : ""}`} aria-hidden="true">
            <div className="pa-measure__bar">
              <span className="pa-measure__who">
                <Mark state={markState} size={26} key={markState === "charged" ? "c" : markState} />
                <span className="pa-measure__name">Paige</span>
                <span className="pa-measure__status" data-beat={beat} data-sent={sent}>
                  {status}
                </span>
              </span>
              <span className="pa-measure__tag">Illustrative</span>
            </div>

            <div className="pa-thread">
              <p className="pa-handoff">You handed Paige a message from Dana, a client</p>
              <div className="pa-msg pa-msg--in">
                <span className="pa-msg__from">Dana</span>
                <span className={`pa-msg__text${beat === 1 ? " is-reading" : ""}`}>{INCOMING}</span>
              </div>
              <div className={`pa-msg pa-msg--out${shownWords > 0 ? " is-in" : ""}`}>
                <span className="pa-msg__from">Your reply, drafted by Paige</span>
                <span className="pa-msg__body">
                  {renderedLines.map((l) =>
                    l.started ? (
                      <span key={l.i} className="pa-msg__line">
                        {l.text}
                        {writing && !l.done ? <span className="pa-caret" /> : null}
                      </span>
                    ) : (
                      <span key={l.i} className="pa-msg__line pa-msg__line--ghost" />
                    ),
                  )}
                </span>
              </div>
            </div>

            <div className={`pa-decide${beat === 3 ? " is-in" : ""}`}>
              <span className={`pa-decide__send${sent ? " is-pressed" : ""}`}>{sent ? "Sent" : "Send"}</span>
              <span className="pa-decide__edit">Edit</span>
              <span className="pa-decide__note">{sent ? "You sent it." : "Nothing goes out until you choose."}</span>
            </div>
          </div>
          <figcaption className="pa-measure__foot">
            <span className="pa-small">{honest}</span>
            {!reduced ? (
              <button
                type="button"
                className="pa-measure__pause"
                onClick={() => setUserPaused((p) => !p)}
                aria-pressed={userPaused}
              >
                {userPaused ? "Play" : "Pause"}
                <span className="pa-sr"> the illustration</span>
              </button>
            ) : null}
          </figcaption>
        </figure>
      </div>

      {/* The whole first screen is one measure: the staff runs edge to edge under it. */}
      <div className="pa-beats" aria-hidden="true">
        <div className="pa-wrap pa-beats__inner">
          <span className="pa-staff pa-beats__staff" />
          <span className="pa-beats__head" style={{ transform: `translateX(${playhead(now) * 100}%)` }} />
          <ol className="pa-beats__list">
            {BEATS.map((label, i) => (
              <li key={label} data-state={i < beat ? "past" : i === beat ? "now" : "next"}>
                <span className="pa-beats__note" />
                <span className="pa-beats__label">{label}</span>
              </li>
            ))}
          </ol>
          <span className="pa-beats__final" />
        </div>
        <div className="pa-wrap">
          <p className={`pa-run${sent || reduced ? " is-struck" : ""}`}>Run everything.</p>
        </div>
      </div>
    </div>
  );
}
