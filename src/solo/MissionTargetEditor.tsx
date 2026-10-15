import React, { useEffect, useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BUSINESS_METRIC_KEYS } from "../../supabase/functions/_shared/analytics-metrics/keys";
import { localDateInZone } from "../../supabase/functions/_shared/paige-context/snapshot";
import { validMissionTarget, type MissionTarget } from "../../supabase/functions/_shared/business-mission-targets/contract";
import { currentMetricVersion, type MetricRequestIdentity } from "@/lib/analytics/metric-contract";
import type { TargetMetricRead } from "./mission-target-client";
import type { TargetAttempt } from "./mission-target-recovery";
import { formatTargetValue, targetPeriod, targetValue } from "./mission-target-form";

type Props = { actorId: string; tenantId: string; missionId: string; missionRevision: number; target: MissionTarget | null; busy: boolean;
  readMetric: (query: { metricKey: string; rangeKey: MetricRequestIdentity["rangeKey"]; rangeStart: string; rangeEnd: string }) => Promise<TargetMetricRead>;
  onSave(attempt: TargetAttempt): Promise<void>; onCancel(): void };
const metricName = (key: string) => key.split(".").map(part => part.replace(/_/g, " ")).join(" / ");
export function MissionTargetEditor({ actorId, tenantId, missionId, missionRevision, target, busy, readMetric, onSave, onCancel }: Props) {
  const labelId = useId(), titleRef = useRef<HTMLInputElement>(null), series = useRef(0);
  const initialZone = target?.period.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localDateInZone(Date.now(), initialZone) ?? new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(target?.title ?? ""), [key, setKey] = useState(target?.metric.key ?? "business.active_clients_current");
  const [range, setRange] = useState(target?.metric.range_key ?? "quarter"), [zone, setZone] = useState(initialZone);
  const [start, setStart] = useState(target ? localDateInZone(Date.parse(target.period.start), initialZone) ?? today : today);
  const [through, setThrough] = useState(target ? localDateInZone(Date.parse(target.period.end) - 1, initialZone) ?? today : today);
  const [comparison, setComparison] = useState<MissionTarget["comparison"]>(target?.comparison ?? "at_least");
  const inputValue = (value: string) => target?.metric.value_kind === "currency_totals"
    ? formatTargetValue(value, target.metric.value_kind, target.metric.currency).slice(4) : value;
  const [desired, setDesired] = useState(target ? inputValue(target.desired_value) : ""), [upper, setUpper] = useState(target?.upper_value ? inputValue(target.upper_value) : "");
  const [currency, setCurrency] = useState(target?.metric.currency ?? ""), [reason, setReason] = useState("");
  const [measurement, setMeasurement] = useState<TargetMetricRead | null>(null), [checking, setChecking] = useState(false), [error, setError] = useState<string | null>(null);
  const [refreshDefinition, setRefreshDefinition] = useState(0);
  const readRef = useRef(readMetric); readRef.current = readMetric;
  useEffect(() => { titleRef.current?.focus(); }, []);
  useEffect(() => {
    const current = ++series.current; let active = true;
    setMeasurement(null); setChecking(true);
    // Definition evidence is queried independently of a future target period.
    // This never pretends that today's snapshot proves a future/past actual.
    const end = new Date(); if (key.startsWith("sales.")) end.setUTCHours(0, 0, 0, 0);
    const from = new Date(end); from.setUTCDate(from.getUTCDate() - ({ week: 7, month: 30, quarter: 90, year: 365 }[range]));
    void readRef.current({ metricKey: key, rangeKey: range, rangeStart: from.toISOString(), rangeEnd: end.toISOString() }).then(result => {
      if (!active || series.current !== current) return;
      setMeasurement(result); setChecking(false);
    }).catch(() => { if (active && series.current === current) { setMeasurement({ kind: "unavailable" }); setChecking(false); } });
    return () => { active = false; };
  }, [key, range, refreshDefinition]);
  const metric = measurement?.kind === "ready" ? measurement.metric : null;
  const kind = metric?.values?.kind;
  const numeric = kind === "count" || kind === "decimal" || kind === "currency_totals";
  const currencies = metric?.values?.kind === "currency_totals" ? metric.values.by_currency.map(row => row.currency) : [];
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    const period = targetPeriod(start, through, zone);
    if (title.trim().length < 3) { setError("Give this target a title of at least three characters."); titleRef.current?.focus(); return; }
    if (!period) { setError("Choose valid dates and a calendar that resolves both days. The end date includes that whole day."); return; }
    if (!metric || !numeric || Date.parse(metric.reference_expires_at) <= Date.now()) { setError("Refresh the measurement definition before saving this target."); return; }
    const selectedCurrency = kind === "currency_totals" ? currency : null;
    if (kind === "currency_totals" && !currencies.includes(currency)) { setError("Choose one of the measurement's recorded currencies. Currencies are never combined."); return; }
    const desiredValue = targetValue(desired, kind, selectedCurrency), upperValue = comparison === "within_range" ? targetValue(upper, kind, selectedCurrency) : null;
    if (desiredValue === null || comparison === "within_range" && upperValue === null || !reason.trim()) { setError("Enter a valid target value and a reason. Counts use whole numbers; currency precision follows the selected currency."); return; }
    const definition = { title: title.trim(), metric: { key, version: currentMetricVersion(key), unit: metric.unit, value_kind: kind,
      currency: selectedCurrency, dimensions: metric.dimensions, range_key: range, semantics: metric.range.semantics, business_time_zone: metric.business_time_zone?.zone ?? null },
      period, comparison, desired_value: desiredValue, upper_value: upperValue };
    const requestKey = crypto.randomUUID();
    if (!validMissionTarget({ ...definition, id: target?.id ?? requestKey, tenant_id: tenantId, mission_id: missionId, revision: target?.revision ?? 1, state: target?.state ?? "active" } as MissionTarget)) {
      setError("Check the target bounds and measurement units. A range's upper value must be at least its lower value."); return;
    }
    setError(null);
    await onSave({ version: 1, scope: { actorId, tenantId, missionId }, tool: "mission_target_save", args: {
      request_key: requestKey, mission_id: missionId, expected_mission_revision: missionRevision, target_id: target?.id ?? null,
      expected_target_revision: target?.revision ?? null, definition, metric_evidence_ref: metric.evidence_ref, reason: reason.trim() } });
  };
  return <form className="mgt-editor" onSubmit={event => void submit(event)} aria-labelledby={labelId}>
    <div className="mgt-heading"><h4 id={labelId}>{target ? "Revise target" : "Add measured target"}</h4><button type="button" className="sd-btn sd-btn-sm" onClick={onCancel}><X /> Cancel</button></div>
    <fieldset disabled={busy}><legend className="sr-only">Target definition</legend>
      <label className="ov-field"><span>Title</span><input ref={titleRef} className="fin" value={title} maxLength={180} required onChange={e => setTitle(e.target.value)} /></label>
      <label className="ov-field"><span>Measurement</span><Select value={key} onValueChange={setKey}><SelectTrigger aria-label="Measurement" className="fin"><SelectValue /></SelectTrigger><SelectContent>{BUSINESS_METRIC_KEYS.map(item => <SelectItem key={item} value={item}>{metricName(item)}</SelectItem>)}</SelectContent></Select></label>
      <div className="mgt-definition" role="status">{checking ? "Checking the measurement definition." : metric ? <><b>{metric.label}</b><p>{metric.definition}</p>{!numeric && <p>This source does not currently provide a numeric measurement for a target.</p>}</> : "This measurement could not be verified."}</div>
      <button type="button" className="sd-btn sd-btn-sm" disabled={busy || checking} onClick={() => setRefreshDefinition(v => v + 1)}>Refresh measurement definition</button>
      <div className="mgt-fields"><label className="ov-field"><span>Start date</span><input className="fin" type="date" value={start} required onChange={e => setStart(e.target.value)} /></label><label className="ov-field"><span>Through date, included</span><input className="fin" type="date" value={through} required onChange={e => setThrough(e.target.value)} /></label></div>
      <label className="ov-field"><span>Calendar</span><input className="fin" value={zone} required maxLength={100} onChange={e => setZone(e.target.value)} aria-describedby={`${labelId}-calendar`} /><small id={`${labelId}-calendar`}>Use a named time zone, such as America/New_York or UTC. Saved dates retain this calendar.</small></label>
      <label className="ov-field"><span>Reporting range</span><Select value={range} onValueChange={value => setRange(value as typeof range)}><SelectTrigger className="fin" aria-label="Reporting range"><SelectValue /></SelectTrigger><SelectContent>{["week", "month", "quarter", "year"].map(item => <SelectItem key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</SelectItem>)}</SelectContent></Select></label>
      <label className="ov-field"><span>Comparison</span><Select value={comparison} onValueChange={value => setComparison(value as MissionTarget["comparison"])}><SelectTrigger className="fin" aria-label="Comparison"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="at_least">At least</SelectItem><SelectItem value="at_most">At most</SelectItem><SelectItem value="within_range">Within range</SelectItem></SelectContent></Select></label>
      {kind === "currency_totals" && <label className="ov-field"><span>Currency</span><Select value={currency} onValueChange={setCurrency}><SelectTrigger className="fin" aria-label="Currency"><SelectValue placeholder="Choose currency" /></SelectTrigger><SelectContent>{currencies.map(item => <SelectItem key={item} value={item}>{item.toUpperCase()}</SelectItem>)}</SelectContent></Select></label>}
      <div className="mgt-fields"><label className="ov-field"><span>{comparison === "within_range" ? "Lower target" : "Target value"}{kind === "currency_totals" && currency ? ` (${currency.toUpperCase()})` : metric ? ` (${metric.unit})` : ""}</span><input className="fin" inputMode="decimal" value={desired} required maxLength={64} onChange={e => setDesired(e.target.value)} /></label>{comparison === "within_range" && <label className="ov-field"><span>Upper target</span><input className="fin" inputMode="decimal" value={upper} required maxLength={64} onChange={e => setUpper(e.target.value)} /></label>}</div>
      <label className="ov-field"><span>Why this target</span><textarea className="fin" value={reason} required maxLength={1200} onChange={e => setReason(e.target.value)} /></label>
    </fieldset>
    {error && <p className="ov-err" role="alert">{error}</p>}
    <p className="mgt-caption">Saving changes this Play's target. Actual performance is measured separately from business records.</p>
    <div className="mgt-actions"><button type="submit" className="sd-btn sd-btn-sm sd-act" disabled={busy || checking || !numeric}><Check />{busy ? "Verifying change" : target ? "Save target revision" : "Save target"}</button></div>
  </form>;
}
