// Marketing › Overview charts. Loaded lazily by growth2.tsx so recharts never sits on the path to
// Marketing's first paint; the numbers beside each chart render without it.
//
// Colours are read from the Solo --chart-* tokens (solo-chart-tokens.css) at runtime (recharts writes SVG attributes, which do not
// resolve CSS variables) and re-read when the theme flips. The categorical order is fixed and was
// validated for both themes with the dataviz palette checker: violet, aqua, orange, blue. Grey is
// reserved for "Other sources" and "No tracking tag"; gold is never used in a chart (§11).
import React from "react";
import { Bar, Brush, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

const dayReadout = (point: DailyPoint) => `${point.label}: ${point.leads} lead${point.leads === 1 ? "" : "s"}, ${point.opportunities} became ${point.opportunities === 1 ? "an opportunity" : "opportunities"}`;

/**
 * Leads per day with the opportunities line. Interactive four ways, all optional to the reader:
 * hover for a day's values; drag the range handle under the chart to zoom into any stretch of days;
 * Tab in and step day by day with the arrow keys (Home/End jump, Enter opens the day's leads);
 * click a bar to open where the leads are listed.
 */
export function LeadsOverTimeChart({ daily, onOpenDay }: { daily: DailyPoint[]; onOpenDay?: (point: DailyPoint) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const colors = useChartColors(ref);
  const reduced = useReducedMotion();
  const [chosen, setRange] = React.useState({ start: 0, end: daily.length - 1 });
  const [focused, setFocused] = React.useState<number | null>(null);
  // A new period, or a new day rolling in, means new days: reset the zoom and the keyboard position.
  const firstDay = daily[0]?.day;
  React.useEffect(() => { setRange({ start: 0, end: daily.length - 1 }); setFocused(null); }, [daily.length, firstDay]);
  // Clamped on every render, so a stale range can never index past the data before that reset runs.
  const last = Math.max(0, daily.length - 1);
  const range = { start: Math.min(chosen.start, last), end: Math.min(Math.max(chosen.end, chosen.start), last) };
  const visible = range.end - range.start + 1;
  const dense = visible > 14;
  const brushable = daily.length > 7;
  const onKeyDown = (event: React.KeyboardEvent) => {
    // The first arrow press lands on the latest visible day rather than skipping it.
    const at = focused ?? range.end;
    const next = focused === null && (event.key === "ArrowLeft" || event.key === "ArrowRight") ? range.end
      : event.key === "ArrowLeft" ? Math.max(range.start, at - 1)
      : event.key === "ArrowRight" ? Math.min(range.end, at + 1)
        : event.key === "Home" ? range.start
          : event.key === "End" ? range.end
            : null;
    if (next !== null) { event.preventDefault(); setFocused(next); return; }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (focused === null) setFocused(range.end); // first Enter selects the latest day; the next opens it
      else onOpenDay?.(daily[focused]);
    }
    if (event.key === "Escape") setFocused(null);
  };
  const focusedPoint = focused !== null ? daily[focused] : null;
  return <div className="mo-chart-wrap">
    <div ref={ref} className={`mo-chart mo-chart-time${brushable ? " has-brush" : ""}`} tabIndex={0} role="group"
      aria-label="Leads over time. Use the left and right arrow keys to move between days, Enter to open that day's leads."
      aria-describedby="mo-time-readout" onKeyDown={onKeyDown} onBlur={() => setFocused(null)}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart accessibilityLayer={false} data={daily} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap={dense ? "22%" : "34%"}>
          <CartesianGrid vertical={false} stroke={colors["--line-soft"]} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={dense ? 2 : 0} minTickGap={8} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} tick={{ fill: colors["--ink-3"], fontSize: 11 }} />
          <Tooltip
            cursor={{ fill: colors["--line-soft"], opacity: 0.6 }}
            content={({ active, payload, label }) => active && payload?.length
              ? <TipBox title={String(label)} rows={(payload as unknown as TipRow[]).map((row) => ({ label: row.dataKey === "leads" ? "Leads" : "Became opportunities", value: row.value, color: row.dataKey === "leads" ? colors["--chart-1"] : colors["--chart-2"] }))} />
              : null}
          />
          <Bar dataKey="leads" fill={colors["--chart-1"]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={!reduced} cursor={onOpenDay ? "pointer" : undefined} onClick={(_data, index) => onOpenDay?.(daily[range.start + index])}>
            {/* recharts indexes cells and clicks from the start of the zoomed range, not the whole period */}
            {daily.slice(range.start, range.end + 1).map((point, index) => <Cell key={point.day} fill={colors["--chart-1"]} fillOpacity={focused === null || focused === range.start + index ? 1 : 0.38} />)}
          </Bar>
          <Line dataKey="opportunities" type="monotone" stroke={colors["--chart-2"]} strokeWidth={2} dot={{ r: 3, fill: colors["--chart-2"], stroke: colors["--surface"], strokeWidth: 2 }} activeDot={{ r: 5, stroke: colors["--surface"], strokeWidth: 2 }} isAnimationActive={!reduced} />
          {brushable && <Brush dataKey="label" height={22} travellerWidth={10} startIndex={range.start} endIndex={range.end}
            stroke={colors["--chart-1"]} fill={colors["--surface"]} tickFormatter={() => ""}
            onChange={(next) => { if (typeof next?.startIndex === "number" && typeof next?.endIndex === "number") { setRange({ start: next.startIndex, end: next.endIndex }); setFocused(null); } }} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    <p id="mo-time-readout" className="mo-readout" aria-live="polite">
      {focusedPoint ? dayReadout(focusedPoint) : brushable ? (visible < daily.length ? `Showing ${daily[range.start].label} to ${daily[range.end].label}. Drag the handles below the chart to change the range.` : "Drag the handles below the chart to zoom into any stretch of days.") : ""}
    </p>
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
        {shown.length > 0 && <Tooltip content={({ active: on, payload }) => on && payload?.length
          ? <TipBox rows={(payload as unknown as TipRow[]).map((row) => ({ label: String(row.name), value: row.value, color: row.payload?.colorToken ? colors[row.payload.colorToken] : undefined }))} />
          : null} />}
      </PieChart>
    </ResponsiveContainer>
    <div className="mo-donut-center" aria-hidden="true">{active ? <><strong>{active.count}</strong><span>{active.label}</span></> : <><strong>{total}</strong><span>{caption}</span></>}</div>
  </div>;
}
