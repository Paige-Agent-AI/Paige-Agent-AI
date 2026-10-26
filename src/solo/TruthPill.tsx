import type { ReactNode } from "react";

/** The workspace's truth-state pill. A tiny shared atom (its own module so the
 * workspace's static import of it cannot pin the lazily-loaded panel modules —
 * the build explicitly warns "dynamic import will not move module into another
 * chunk" when a module is both). */
export const TruthPill = ({ tone = "neutral", children }: { tone?: "live" | "partial" | "unavailable" | "proposed" | "neutral"; children: ReactNode }) => (
  <span className={`spw-truth spw-truth-${tone}`}>{children}</span>
);
