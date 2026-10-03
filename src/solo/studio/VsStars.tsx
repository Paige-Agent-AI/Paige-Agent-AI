// The Studio's ambient star field. Reduced motion renders it static.
import React from "react";

export const VsStars = ({ n = 260 }: { n?: number }) => {
  // Reduced motion: the ambient field renders STATIC (no SMIL twinkle).
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    // Defensive probe: older browsers/jsdom lack matchMedia -> no motion path.
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const h = () => setReduced(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  const stars = React.useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const r = (s => () => ((s = (s * 16807) % 2147483647) / 2147483647))(i * 7919 + 13);
        return { x: r() * 100, y: r() * 100, s: r() * 1.5 + 0.3, o: r() * 0.7 + 0.15, d: r() * 6 };
      }),
    [n],
  );
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} preserveAspectRatio="none" aria-hidden="true">
      {stars.map((s, i) => (
        <circle key={i} cx={s.x + "%"} cy={s.y + "%"} r={s.s} fill={i % 9 === 0 ? "#F5C266" : "#fff"} opacity={s.o}>
          {!reduced && (
            <animate attributeName="opacity" values={`${s.o};${s.o * 0.25};${s.o}`} dur={`${4 + s.d}s`} repeatCount="indefinite" />
          )}
        </circle>
      ))}
    </svg>
  );
};
