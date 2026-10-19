import "./paige-command-mark.css";

/**
 * PaigeCommandMark — the CURRENT Paige mark (the Command Mark), as a surface-agnostic brand
 * component usable ANYWHERE: marketing, auth, onboarding, product chrome, emails-as-markup.
 *
 * Why this exists separately from `src/operator/shell/CommandMark.tsx`: that one is the operator
 * plate variant, and its colours come from the `--pg-*` / `--cm-*` operator tokens which only
 * resolve inside a `data-pg` shell (OperatorShell / TenantCommandCenterShell). On a marketing or
 * auth page there is no `data-pg`, so those tokens are undefined and the mark would render with no
 * colour. This component carries its OWN theme-aware colours, so the Command Mark reads correctly
 * on every surface, with or without a shell. The operator `CommandMark` is unchanged and stays the
 * shell's mark (§00 — its pack geometry is locked).
 *
 * This REPLACES the retired orbital `PaigeMark` (gold orb + ring + companion spark), owner-ruled
 * 2026-09-06: "Command Mark = current Paige platform/product identity. Legacy orbital PaigeMark =
 * retired and prohibited from active use." The slash-and-orb geometry below is the CD pack's, exact
 * (docs/design-references/cd-packs/super-admin-shell-v3/docs/handoff/design-system-port.md §3),
 * matching the operator mark so the identity is one system (§6).
 *
 * API is a drop-in superset of the retired PaigeMark so migration is a swap:
 * - `className` sizes the whole mark (e.g. `h-8 w-8`), same as before.
 * - `animated` turns on a subtle, reduced-motion-safe breathe (used by the Studio cutscene / hero).
 * - `label` names it for assistive tech; `label={null}` makes it decorative (aria-hidden).
 * - `plated` (default true) draws the recognizable rounded tile the menu/shell render; pass
 *   `plated={false}` for a bare inline glyph (bylines, tiny affordances).
 */
export function PaigeCommandMark({
  className = "",
  animated = false,
  label = "Paige", // customer-identity-exempt: the platform mark's default label; customer chrome shows the business brand (AppNav PortalLogo) and no customer page passes PageHeader mark
  plated = true,
}: {
  className?: string;
  animated?: boolean;
  /** `null` renders the mark decorative (aria-hidden) — use when adjacent text already says "Paige". */
  label?: string | null;
  /** Draw the rounded plate (default). `false` = bare slash-and-orb glyph. */
  plated?: boolean;
}) {
  const glyph = (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      className="pcm-glyph"
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <polygon points="21,13.6 30.5,13.6 21,34.4 11.5,34.4" className="pcm-slash" />
      <circle cx="34.5" cy="30.5" r="5.5" className="pcm-orb" />
    </svg>
  );
  const cls = `pcm ${plated ? "pcm--plated" : "pcm--bare"}${animated ? " pcm--animated" : ""} ${className}`.trim();
  if (!plated) return <span className={cls}>{glyph}</span>;
  return (
    <span className={cls}>
      <span className="pcm-plate" aria-hidden="true" />
      {glyph}
    </span>
  );
}

export default PaigeCommandMark;
