// Pieces Marketing's dashboard views share (Overview, Audience): one home, so they look and behave alike.
import React from "react";
import { Ic as SharedIcons } from "./_shared";

// The shared icon set is untyped; these views pass only a size.
const Ic = SharedIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>;

function ChartSkeleton({ className }: { className?: string }) {
  return <div className={`${className ?? ""} mo-skel`} aria-hidden="true"/>;
}

// A chart is an enhancement over numbers already on the page: if its code fails to load (a stale
// deploy, a dropped connection) it says so in place and logs why, and the rest of Marketing stays up.
export class ChartBoundary extends React.Component<{ className?: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("[marketing] chart failed to render", error); }
  render() {
    if (this.state.failed) return <p className={`${this.props.className ?? ""} mo-chart-failed`}>This chart couldn’t load. The figures beside it are still current; reload the page to try again.</p>;
    return <React.Suspense fallback={<ChartSkeleton className={this.props.className}/>}>{this.props.children}</React.Suspense>;
  }
}

type Delta = { change: number; percent: number | null } | null;

// A comparison only when the read covers the whole previous period.
// `against` names what the figure is compared with when it is not the previous period (a running total).
export function DeltaLine({ delta, periodDays, fallback, against }: { delta: Delta; periodDays: number; fallback: React.ReactNode; against?: string }) {
  if (!delta) return <span className="mo-delta">{fallback}</span>;
  const span = against ?? `previous ${periodDays} days`;
  if (delta.change === 0) return <span className="mo-delta">Same as the {span}</span>;
  const up = delta.change > 0;
  const amount = delta.percent === null ? `${up ? "+" : ""}${delta.change}` : `${up ? "+" : ""}${delta.percent}%`;
  return <span className={`mo-delta ${up ? "is-up" : "is-down"}`}><Ic.arrow size={12}/>{amount} vs {span}</span>;
}

// Ask PAIGE about one chart. The question carries only figures already on the page; PAIGE's composer
// is prefilled and nothing is sent until the owner sends it.
export function AskPaige({ prompt }: { prompt: string }) {
  return <button type="button" className="mo-ask" onClick={() => window.dispatchEvent(new CustomEvent("paige:open", { detail: { prompt } }))}><Ic.spark size={12}/>Ask PAIGE</button>;
}

export function OverviewStat({ icon, tone, label, value, foot, link, onLink }: { icon: React.ReactNode; tone: string; label: string; value: React.ReactNode; foot?: React.ReactNode; link?: string; onLink?: () => void }) {
  return <section className="mo-stat" aria-label={label}>
    <span className={`mo-plate ${tone}`} aria-hidden="true">{icon}</span>
    <div className="mo-stat-body">
      <h3>{label}</h3>
      <strong className="mo-stat-value">{value}</strong>
      <div className="mo-stat-foot">{foot}{link && <button className="mo-link" onClick={onLink}>{link}<Ic.arrow size={12}/></button>}</div>
    </div>
  </section>;
}
