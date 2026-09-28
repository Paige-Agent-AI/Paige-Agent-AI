import { useEffect, useRef, useState } from "react";

/**
 * Time given back — a week as blocks, crowded before, cleared after. Illustrative, and labelled so
 * in words: no hours saved are claimed. Client calls stay put in both views; the work between
 * them is what changes. The switch is a two-button group; the blocks recompose with a short
 * clip/opacity change that reduced motion turns into an instant cut.
 */
type Block = { day: number; start: number; dur: number; kind: "client" | "admin" | "review"; label: string };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const OPEN = 8;
const CLOSE = 18;

const CLIENT: Block[] = [
  { day: 0, start: 10, dur: 1, kind: "client", label: "Client call" },
  { day: 0, start: 13, dur: 1, kind: "client", label: "Client call" },
  { day: 1, start: 9, dur: 1, kind: "client", label: "Client call" },
  { day: 1, start: 14.5, dur: 1, kind: "client", label: "Client call" },
  { day: 2, start: 10, dur: 1.5, kind: "client", label: "Client workshop" },
  { day: 3, start: 9, dur: 1, kind: "client", label: "Client call" },
  { day: 3, start: 13.5, dur: 1, kind: "client", label: "Discovery call" },
  { day: 4, start: 11, dur: 1, kind: "client", label: "Client call" },
];

const BEFORE: Block[] = [
  { day: 0, start: 8, dur: 1.5, kind: "admin", label: "Inbox" },
  { day: 0, start: 11, dur: 1.5, kind: "admin", label: "Follow-ups" },
  { day: 0, start: 14.5, dur: 2, kind: "admin", label: "Proposal" },
  { day: 1, start: 10.5, dur: 1, kind: "admin", label: "Scheduling back-and-forth" },
  { day: 1, start: 12, dur: 1.5, kind: "admin", label: "Onboarding paperwork" },
  { day: 1, start: 16, dur: 1.5, kind: "admin", label: "Session notes" },
  { day: 2, start: 8, dur: 1.5, kind: "admin", label: "Inbox" },
  { day: 2, start: 12, dur: 1.5, kind: "admin", label: "Proposal" },
  { day: 2, start: 14, dur: 2, kind: "admin", label: "Social posts" },
  { day: 3, start: 10.5, dur: 2, kind: "admin", label: "Client records" },
  { day: 3, start: 15, dur: 2, kind: "admin", label: "Follow-ups" },
  { day: 4, start: 8, dur: 2.5, kind: "admin", label: "Admin catch-up" },
  { day: 4, start: 12.5, dur: 2, kind: "admin", label: "Week wrap-up" },
];

// With Paige, the work between meetings arrives done; what stays is the part she can't take yet
// (reading the inbox and onboarding paperwork are in build), kept on the week honestly.
const AFTER: Block[] = [
  ...DAYS.map((_, day) => ({ day, start: 8.5, dur: 0.5, kind: "review" as const, label: "Paige's work, ready" })),
  { day: 0, start: 16, dur: 0.75, kind: "admin", label: "Inbox" },
  { day: 1, start: 12, dur: 1, kind: "admin", label: "Onboarding paperwork" },
  { day: 3, start: 16, dur: 0.75, kind: "admin", label: "Inbox" },
];

type Placed = Block & { phase: "both" | "before" | "after" };
// Every block is always in the DOM with a stable key, so switching views can animate the work
// between meetings folding away and Paige's finished work arriving, instead of a hard swap.
const ALL: Placed[] = [
  ...CLIENT.map((b) => ({ ...b, phase: "both" as const })),
  ...BEFORE.map((b) => ({ ...b, phase: "before" as const })),
  ...AFTER.map((b) => ({ ...b, phase: "after" as const })),
];

export function WeekScore() {
  const [view, setView] = useState<"before" | "after">("before");
  const touched = useRef(false);
  const ref = useRef<HTMLElement>(null);

  // Plays its own story once: shown crowded, then — unless the visitor has already chosen —
  // the week clears. Reduced motion never auto-switches; the buttons stay the visitor's.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        timer = window.setTimeout(() => {
          if (!touched.current) setView("after");
        }, 1800);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const choose = (v: "before" | "after") => {
    touched.current = true;
    setView(v);
  };

  return (
    <figure className="pa-week" data-view={view} ref={ref}>
      <div className="pa-week__switch" role="group" aria-label="Show the week">
        <button type="button" aria-pressed={view === "before"} onClick={() => choose("before")}>
          Before Paige
        </button>
        <button type="button" aria-pressed={view === "after"} onClick={() => choose("after")}>
          With Paige
        </button>
      </div>
      <p className="pa-sr">
        {view === "before"
          ? "An illustrative week before Paige: client calls surrounded by inbox time, follow-ups, proposals, scheduling, paperwork and admin on every day."
          : "The same illustrative week with Paige: the same client calls, and each day starts with half an hour going through the work Paige has ready. Inbox time and onboarding paperwork remain, because those are still in build. The rest of the time is open."}
      </p>
      <div className="pa-week__scroll">
      <div className="pa-week__grid" aria-hidden="true">
        <div className="pa-week__hours">
          {[8, 10, 12, 14, 16].map((h) => (
            <span key={h} style={{ top: `${((h - OPEN) / (CLOSE - OPEN)) * 100}%` }}>
              {h > 12 ? h - 12 : h}
              {h >= 12 ? "pm" : "am"}
            </span>
          ))}
        </div>
        {DAYS.map((d, day) => (
          <div key={d} className="pa-week__day">
            <span className="pa-week__dayname">{d}</span>
            <div className="pa-week__col">
              {ALL.filter((b) => b.day === day).map((b, n) => (
                  <span
                    key={`${b.phase}-${b.kind}-${b.start}`}
                    className={`pa-week__block pa-week__block--${b.kind}`}
                    data-shown={b.phase === "both" || b.phase === view}
                    style={{
                      top: `${((b.start - OPEN) / (CLOSE - OPEN)) * 100}%`,
                      height: `${(b.dur / (CLOSE - OPEN)) * 100}%`,
                      ["--n" as string]: n,
                    }}
                  >
                    <span>{b.label}</span>
                  </span>
                ))}
            </div>
          </div>
        ))}
      </div>
      </div>
      <figcaption className="pa-week__caption">
        <span className="pa-week__key pa-week__key--client">Client work</span>
        <span className="pa-week__key pa-week__key--admin">Work between meetings</span>
        <span className="pa-week__key pa-week__key--review">Paige's work, ready for you</span>
        <span className="pa-small">An illustrative week, not a measurement. Inbox reading and onboarding paperwork are in build.</span>
      </figcaption>
    </figure>
  );
}
