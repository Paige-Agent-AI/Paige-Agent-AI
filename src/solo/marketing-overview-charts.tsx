// Marketing › Overview charts. Loaded lazily by growth2.tsx so recharts never sits on the path to
// Marketing's first paint; the numbers beside each chart render without it.
//
// Colours are read from the Solo tokens at runtime (recharts writes SVG attributes, which do not
// resolve CSS variables) and re-read when the theme flips. The categorical order is fixed and was
// validated for both themes with the dataviz palette checker: violet, aqua, orange, blue. Grey is
// reserved for "Other sources" and "No tracking tag"; gold is never used in a chart (§11).
import React from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint } from "./marketing-overview-model";

const TOKENS = ["--mk-s1", "--mk-s2", "--mk-s3", "--mk-s4", "--mk-other", "--mk-untagged", "--ok", "--warn", "--bad", "--surface", "--line-soft", "--ink", "--ink-2", "--ink-3"] as const;
type Token = (typeof TOKENS)[number];
export type ChartColors = Record<Token, string>;

const FALLBACK: ChartColors = {
  "--mk-s1": "#5B3FD6", "--mk-s2": "#1baf7a", "--mk-s3": "#eb6834", "--mk-s4": "#2a78d6",
  "--mk-other": "#7E7995", "--mk-untagged": "#C9C4D6", "--ok": "#1B7A52", "--warn": "#B4700A", "--bad": "#B93E37",
  "--surface": "#FFFFFF", "--line-soft": "#EFECE4", "--ink": "#171331", "--ink-2": "#4A4566", "--ink-3": "#7E7995",
};

function readColors(element: Element | null): ChartColors {
  if (!element || typeof getComputedStyle !== "function") return FALLBACK;
  const style = getComputedStyle(element);
  return Object.fromEntries(TOKENS.map((token) => [token, style.getPropertyValue(token).trim() || FALLBACK[token]])) as ChartColors;
}

/** The Solo theme tokens as concrete colours, kept current when the owner switches theme. */
function useChartColors(ref: React.RefObject<Element | null>): ChartColors {
  const [colors, setColors] = React.useState<ChartColors>(FALLBACK);
  React.useEffect(() => {
    const element = ref.current;
    setColors(readColors(element));
    const themed = element?.closest("[data-theme]");
    if (!themed || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setColors(readColors(element)));
    observer.observe(themed, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [ref]);
  return colors;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listen = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener?.("change", listen);
    return () => query.removeEventListener?.("change", listen);
  }, []);
  return reduced;
}

type TipRow = { name?: string | number; value?: unknown; color?: string; dataKey?: unknown; payload?: { label?: string; colorToken?: Token } };

function TipBox({ title, rows }: { title?: string; rows: { label: string; value: unknown; color?: string }[] }) {
  return <div className="mo-tip">
    {title && <strong>{title}</strong>}
    {rows.map((row) => <span key={row.label}><i style={{ background: row.color }} aria-hidden="true" />{row.label}<b>{String(row.value)}</b></span>)}
  </div>;
}

export function LeadsOverTimeChart({ daily }: { daily: DailyPoint[] }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const colors = useChartColors(ref);
  const reduced = useReducedMotion();
  const dense = daily.length > 14;
  return <div ref={ref} className="mo-chart mo-chart-time">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap={dense ? "22%" : "34%"}>
        <CartesianGrid vertical={false} stroke={colors["--line-soft"]} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={dense ? 2 : 0} minTickGap={8} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
        <Tooltip
          cursor={{ fill: colors["--line-soft"], opacity: 0.6 }}
          content={({ active, payload, label }) => active && payload?.length
            ? <TipBox title={String(label)} rows={(payload as unknown as TipRow[]).map((row) => ({ label: row.dataKey === "leads" ? "Leads" : "Became opportunities", value: row.value, color: row.dataKey === "leads" ? colors["--mk-s1"] : colors["--mk-s2"] }))} />
            : null}
        />
        <Bar dataKey="leads" fill={colors["--mk-s1"]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={!reduced} />
        <Line dataKey="opportunities" type="monotone" stroke={colors["--mk-s2"]} strokeWidth={2} dot={{ r: 3, fill: colors["--mk-s2"], stroke: colors["--surface"], strokeWidth: 2 }} activeDot={{ r: 5, stroke: colors["--surface"], strokeWidth: 2 }} isAnimationActive={!reduced} />
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}

export type DonutSlice = { key: string; label: string; count: number; colorToken: Token };

export function Donut({ slices, total, caption, label }: { slices: DonutSlice[]; total: number; caption: string; label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const colors = useChartColors(ref);
  const reduced = useReducedMotion();
  const shown = slices.filter((slice) => slice.count > 0);
  return <div ref={ref} className="mo-donut" role="img" aria-label={`${label}: ${shown.map((slice) => `${slice.label} ${slice.count}`).join(", ") || "none"}`}>
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={shown.length ? shown : [{ key: "none", label: "None", count: 1, colorToken: "--line-soft" }]} dataKey="count" nameKey="label" innerRadius="70%" outerRadius="100%" paddingAngle={shown.length > 1 ? 1.5 : 0} stroke={colors["--surface"]} strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={!reduced}>
          {(shown.length ? shown : [{ key: "none", colorToken: "--line-soft" as Token }]).map((slice) => <Cell key={slice.key} fill={colors[slice.colorToken]} />)}
        </Pie>
        {shown.length > 0 && <Tooltip content={({ active, payload }) => active && payload?.length
          ? <TipBox rows={(payload as unknown as TipRow[]).map((row) => ({ label: String(row.name), value: row.value, color: row.payload?.colorToken ? colors[row.payload.colorToken] : undefined }))} />
          : null} />}
      </PieChart>
    </ResponsiveContainer>
    <div className="mo-donut-center" aria-hidden="true"><strong>{total}</strong><span>{caption}</span></div>
  </div>;
}

