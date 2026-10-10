// Marketing › Overview charts. Loaded lazily by growth2.tsx so recharts never sits on the path to
// Marketing's first paint; the numbers beside each chart render without it.
//
// Colours are read from the Solo --chart-* tokens (solo-chart-tokens.css) at runtime (recharts writes SVG attributes, which do not
// resolve CSS variables) and re-read when the theme flips. The categorical order is fixed and was
// validated for both themes with the dataviz palette checker: violet, aqua, orange, blue. Grey is
// reserved for "Other sources" and "No tracking tag"; gold is never used in a chart (§11).
import React from "react";
import { Area, AreaChart, Bar, BarChart, Brush, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint } from "./marketing-overview-model";

const TOKENS = ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-other", "--chart-untagged", "--ok", "--warn", "--bad", "--surface", "--line-soft", "--ink", "--ink-2", "--ink-3"] as const;
type Token = (typeof TOKENS)[number];
export type ChartColors = Record<Token, string>;

const FALLBACK: ChartColors = {
  "--chart-1": "#5B3FD6", "--chart-2": "#1BAF7A", "--chart-3": "#EB6834", "--chart-4": "#2A78D6",
  "--chart-other": "#7E7995", "--chart-untagged": "#CFCADB", "--ok": "#1B7A52", "--warn": "#B4700A", "--bad": "#B93E37",
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
  // Layout effect: read the theme before the first paint, so dark mode never flashes light colours.
  React.useLayoutEffect(() => {
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

export type DonutSlice = { key: string; label: string; count: number; colorToken: Token };

/**
 * A part-to-whole ring. The highlighted slice is controlled by the page, so hovering or focusing a
 * legend row and hovering the ring light the same slice; clicking a slice opens what it stands for.
 */
export function Donut({ slices, total, caption, label, activeKey, onActiveKey, onSelect }: { slices: DonutSlice[]; total: number | string; caption: string; label: string; activeKey?: string | null; onActiveKey?: (key: string | null) => void; onSelect?: (slice: DonutSlice) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const colors = useChartColors(ref);
  const reduced = useReducedMotion();
  const shown = slices.filter((slice) => slice.count > 0);
  const active = shown.find((slice) => slice.key === activeKey) ?? null;
  return <div ref={ref} className="mo-donut" role="img" aria-label={`${label}: ${shown.map((slice) => `${slice.label} ${slice.count}`).join(", ") || "none"}`}>
    <ResponsiveContainer width="100%" height="100%">
      <PieChart accessibilityLayer={false}>
        <Pie data={shown.length ? shown : [{ key: "none", label: "None", count: 1, colorToken: "--line-soft" }]} dataKey="count" nameKey="label" innerRadius="70%" outerRadius="100%" paddingAngle={shown.length > 1 ? 1.5 : 0} stroke={colors["--surface"]} strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={!reduced}
          cursor={onSelect && shown.length ? "pointer" : undefined}
          onMouseEnter={(_data, index) => shown[index] && onActiveKey?.(shown[index].key)}
          onMouseLeave={() => onActiveKey?.(null)}
          onClick={(_data, index) => shown[index] && onSelect?.(shown[index])}>
          {(shown.length ? shown : [{ key: "none", colorToken: "--line-soft" as Token }]).map((slice) => <Cell key={slice.key} fill={colors[slice.colorToken]} fillOpacity={!active || active.key === slice.key ? 1 : 0.32} />)}
        </Pie>
        {/* No hover box: the centre already names the slice under the pointer, and a box drawn over the
            ring covers that very number (seen live on Audience, 2026-10-04). */}
      </PieChart>
    </ResponsiveContainer>
    <div className="mo-donut-center" aria-hidden="true">{active ? <><strong>{active.count}</strong><span>{active.label}</span></> : <><strong>{total}</strong><span>{caption}</span></>}</div>
  </div>;
}

// ── Marketing › Audience ──────────────────────────────────────────────────────────────────────────

export type StageBar = { key: string; label: string; count: number; colorToken: Token };

/** Contacts per lifecycle stage, first contact to last, each bar labelled with its count. */
// A stage name is one or two words; each word gets its own line so neighbouring names never run together.
function WrapTick({ x = 0, y = 0, payload, fill }: { x?: number; y?: number; payload?: { value: string }; fill: string }) {
  const words = String(payload?.value ?? "").split(" ");
  return <text x={x} y={y + 4} textAnchor="middle" fill={fill} fontSize={11}>
    {words.map((word, index) => <tspan key={index} x={x} dy={index === 0 ? "0.71em" : "1.15em"}>{word}</tspan>)}
  </text>;
}

export function StageBars({ bars, label }: { bars: StageBar[]; label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const colors = useChartColors(ref);
  const reduced = useReducedMotion();
  return <div ref={ref} className="mo-chart ma-chart-stages" role="img" aria-label={`${label}: ${bars.map((bar) => `${bar.label} ${bar.count}`).join(", ")}`}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart accessibilityLayer={false} data={bars} margin={{ top: 22, right: 4, bottom: 0, left: -18 }} barCategoryGap="24%">
        <CartesianGrid vertical={false} stroke={colors["--line-soft"]} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} height={34} tick={<WrapTick fill={colors["--ink-3"]} />} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
        <Tooltip cursor={{ fill: colors["--line-soft"], opacity: 0.6 }}
          content={({ active, payload }) => active && payload?.length
            ? <TipBox rows={(payload as unknown as { payload: StageBar }[]).map((row) => ({ label: row.payload.label, value: row.payload.count, color: colors[row.payload.colorToken] }))} />
            : null} />
        <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={56} isAnimationActive={!reduced}>
          {bars.map((bar) => <Cell key={bar.key} fill={colors[bar.colorToken]} />)}
          <LabelList dataKey="count" position="top" fill={colors["--ink"]} fontSize={11.5} fontWeight={600} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

export type GrowthPointView = { day: number; label: string; total: number; added: number };

/** The running number of contacts across the period; hover for a day's total and how many arrived. */
export function GrowthArea({ points, label }: { points: GrowthPointView[]; label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const colors = useChartColors(ref);
  const reduced = useReducedMotion();
  const gradient = React.useId().replace(/:/g, "");
  const last = points[points.length - 1];
  return <div ref={ref} className="mo-chart ma-chart-growth" role="img" aria-label={`${label}: ${points[0]?.total ?? 0} at the start, ${last?.total ?? 0} now`}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart accessibilityLayer={false} data={points} margin={{ top: 10, right: 10, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors["--chart-1"]} stopOpacity={0.32} />
            <stop offset="100%" stopColor={colors["--chart-1"]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={colors["--line-soft"]} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={22} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} domain={[0, "auto"]} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
        <Tooltip cursor={{ stroke: colors["--line-soft"] }}
          content={({ active, payload, label: day }) => active && payload?.length
            ? <TipBox title={String(day)} rows={[
              { label: "Contacts", value: (payload[0] as unknown as { payload: GrowthPointView }).payload.total, color: colors["--chart-1"] },
              { label: "Added that day", value: (payload[0] as unknown as { payload: GrowthPointView }).payload.added },
            ]} />
            : null} />
        <Area type="monotone" dataKey="total" stroke={colors["--chart-1"]} strokeWidth={2} fill={`url(#${gradient})`} isAnimationActive={!reduced}
          dot={false} activeDot={{ r: 4, stroke: colors["--surface"], strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

export type EmailRatePointView = { day: string; label: string; sent: number; openRate: number | null; clickRate: number | null };

/**
 * Marketing › Email: open rate and click rate on each day email went out. A day with nothing sent has
 * no point (never a 0%); hover any day for its rates and how many were sent.
 */
export function EmailRatesChart({ points, label }: { points: EmailRatePointView[]; label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const colors = useChartColors(ref);
  const reduced = useReducedMotion();
  const id = React.useId().replace(/:/g, "");
  const measured = points.filter((p) => p.openRate !== null);
  const top = Math.max(10, ...measured.map((p) => p.openRate ?? 0));
  const ceiling = Math.min(100, Math.ceil(top / 20) * 20);
  const ticks = [0, ceiling / 4, ceiling / 2, (ceiling * 3) / 4, ceiling];
  // Sends land on a few days; the line runs between the days that were measured and every measured day
  // carries a dot, so a reader sees exactly where a rate came from. Days with nothing sent stay empty.
  const dot = (token: "--chart-1" | "--chart-2") => ({ r: 3, fill: colors[token], stroke: colors["--surface"], strokeWidth: 2 });
  return <div ref={ref} className="mo-chart me-chart-rates" role="img"
    aria-label={`${label}. ${measured.length ? `${measured.length} day${measured.length === 1 ? "" : "s"} with emails that report opens.` : "No emails that report opens in this period."}`}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart accessibilityLayer={false} data={points} margin={{ top: 10, right: 10, bottom: 0, left: -12 }}>
        <defs>
          <linearGradient id={`${id}-o`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors["--chart-1"]} stopOpacity={0.26} />
            <stop offset="100%" stopColor={colors["--chart-1"]} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={`${id}-c`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors["--chart-2"]} stopOpacity={0.24} />
            <stop offset="100%" stopColor={colors["--chart-2"]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={colors["--line-soft"]} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
        <YAxis tickLine={false} axisLine={false} width={44} domain={[0, ceiling]} ticks={ticks} tickFormatter={(v: number) => `${v}%`} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
        <Tooltip cursor={{ stroke: colors["--line-soft"] }}
          content={({ active, payload, label: day }) => {
            if (!active || !payload?.length) return null;
            const point = (payload[0] as unknown as { payload: EmailRatePointView }).payload;
            return <TipBox title={String(day)} rows={point.openRate === null
              ? [{ label: "Sent", value: point.sent }, { label: "Opens", value: point.sent ? "Not reported" : "No email sent" }]
              : [
                { label: "Open rate", value: `${point.openRate}%`, color: colors["--chart-1"] },
                { label: "Click rate", value: `${point.clickRate}%`, color: colors["--chart-2"] },
                { label: "Sent", value: point.sent },
              ]} />;
          }} />
        <Area type="monotone" dataKey="openRate" connectNulls stroke={colors["--chart-1"]} strokeWidth={2} fill={`url(#${id}-o)`}
          isAnimationActive={!reduced} dot={dot("--chart-1")}
          activeDot={{ r: 4, stroke: colors["--surface"], strokeWidth: 2 }} />
        <Area type="monotone" dataKey="clickRate" connectNulls stroke={colors["--chart-2"]} strokeWidth={2} fill={`url(#${id}-c)`}
          isAnimationActive={!reduced} dot={dot("--chart-2")}
          activeDot={{ r: 4, stroke: colors["--surface"], strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

// ── Marketing › Analytics ─────────────────────────────────────────────────────────────────────────

export type LeadTrendPointView = { key: string; label: string; leads: number; opportunities: number };

/**
 * Leads received in each day (or week, for a quarter) as bars, with the opportunities they became as a
 * line over them. Hover any bar for its date, leads and opportunities.
 */
export function LeadsTrend({ points, step, label }: { points: LeadTrendPointView[]; step: "day" | "week"; label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const colors = useChartColors(ref);
  const reduced = useReducedMotion();
  const total = points.reduce((sum, point) => sum + point.leads, 0);
  const busiest = points.reduce((top, point) => (point.leads > (top?.leads ?? 0) ? point : top), null as LeadTrendPointView | null);
  return <div ref={ref} className="mo-chart mva-chart-trend" role="img"
    aria-label={`${label}: ${total} leads${busiest ? `, the busiest ${step} ${busiest.label} with ${busiest.leads}` : ""}.`}>
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart accessibilityLayer={false} data={points} margin={{ top: 12, right: 8, bottom: 0, left: -18 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={colors["--line-soft"]} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={18} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} domain={[0, "auto"]} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
        <Tooltip cursor={{ fill: colors["--line-soft"], opacity: 0.6 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const point = (payload[0] as unknown as { payload: LeadTrendPointView }).payload;
            return <TipBox title={step === "week" ? `Week of ${point.label}` : point.label} rows={[
              { label: "Leads", value: point.leads, color: colors["--chart-1"] },
              { label: "Became opportunities", value: point.opportunities, color: colors["--chart-2"] },
            ]} />;
          }} />
        <Bar dataKey="leads" fill={colors["--chart-1"]} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={!reduced} />
        <Line type="monotone" dataKey="opportunities" stroke={colors["--chart-2"]} strokeWidth={2.25} isAnimationActive={!reduced}
          dot={{ r: 2.5, fill: colors["--chart-2"], stroke: colors["--surface"], strokeWidth: 1.5 }} activeDot={{ r: 4, stroke: colors["--surface"], strokeWidth: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}
