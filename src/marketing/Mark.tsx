import "./mark.css";

export type MarkState = "spectral" | "dormant" | "charged" | "executed";

/**
 * The Command Mark, flat. Geometry is the approved 48×48 grid from
 * docs/brand/paige-brand-identity.md §1 — slash `21,13.6 30.5,13.6 21,34.4 11.5,34.4` with a
 * round-joined 3.2 stroke, orb at (34.5, 30.5) r5.5. Rendered as crisp 2D so it reads in half a
 * second at any size; no plate, no bevel, no drop shadow.
 *
 * `state` drives the only sequence the mark performs (§3 of the identity doc):
 *   dormant  → graphite, at rest
 *   charged  → champagne crossfade (180ms) + one bloom
 *   executed → two ghost slashes stream off (520ms); the act stays legible
 * `spectral` is the static brand treatment for headers and lockups.
 */
export function Mark({
  state = "spectral",
  size = 32,
  title,
  className = "",
}: {
  state?: MarkState;
  size?: number;
  /** Accessible name. Omit when adjacent text already says "Paige". */
  title?: string;
  className?: string;
}) {
  // Below 16px the identity doc grows the orb so it never reads as noise.
  const orbR = size <= 16 ? 6.5 : 5.5;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={`pa-mark pa-mark--${state} ${className}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g className="pa-mark__ghosts" aria-hidden="true">
        <polygon className="pa-mark__ghost pa-mark__ghost--1" points="21,13.6 30.5,13.6 21,34.4 11.5,34.4" />
        <polygon className="pa-mark__ghost pa-mark__ghost--2" points="21,13.6 30.5,13.6 21,34.4 11.5,34.4" />
      </g>
      <polygon className="pa-mark__slash" points="21,13.6 30.5,13.6 21,34.4 11.5,34.4" />
      <circle className="pa-mark__orb" cx="34.5" cy="30.5" r={orbR} />
    </svg>
  );
}

/** Mark + PAIGE wordmark, separated by one orb diameter (identity doc §1 lockup). */
export function Lockup({ size = 30, label = true }: { size?: number; label?: boolean }) {
  return (
    <span className="pa-lockup">
      <Mark size={size} />
      {label ? (
        <span className="pa-wordmark" style={{ fontSize: size * 0.42 }}>
          Paige
        </span>
      ) : null}
    </span>
  );
}
