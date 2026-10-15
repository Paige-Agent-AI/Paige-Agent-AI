import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { routeLinkTarget } from '@/lib/links/workspaceLinks';
import { formatMissionTargetValue, type MissionTargetSnapshot } from '../../supabase/functions/_shared/business-mission-targets/presentation';
import { formatReviewInstant } from './executive-review';

export function ExecutiveTargets({ targets, account }: { targets: readonly MissionTargetSnapshot[]; account?: string | null }) {
  const [at, setAt] = useState(Date.now);
  useEffect(() => {
    const now = Date.now(), times = targets.flatMap(row => row.observation.state === 'unavailable' ? [] : [Date.parse(row.observation.reference_expires_at),
      ...(row.target.metric.semantics !== 'event_timestamp_cohort' ? [Date.parse(row.target.period.end) + 1] : [])])
      .filter(expiry => expiry > now);
    if (!times.length) return;
    const timer = window.setTimeout(() => setAt(Date.now()), Math.min(...times) - now + 1);
    return () => window.clearTimeout(timer);
  }, [targets, at]);
  if (!targets.length) return <p className="exec-note">No numeric targets are saved. Your Strategic Plays and business direction can still exist without a numeric target.</p>;
  return <ul className="exec-targets" aria-label="Measured Play targets">{targets.map(row => {
    const target = row.target, raw = row.observation;
    const instant = Math.max(at, Date.now());
    const observation = raw.state !== 'unavailable' && Date.parse(raw.reference_expires_at) <= instant
      ? { state: 'unavailable' as const, reason: 'evidence_unverified' as const }
      : raw.state !== 'unavailable' && target.metric.semantics !== 'event_timestamp_cohort' && instant > Date.parse(target.period.end)
        ? { state: 'unavailable' as const, reason: 'historical_snapshot_unavailable' as const } : raw;
    const value = (v: string) => formatMissionTargetValue(v, target.metric.value_kind, target.metric.currency);
    const desired = target.comparison === 'within_range' ? `${value(target.desired_value)}–${value(target.upper_value!)}` : value(target.desired_value);
    const link = routeLinkTarget({ destination: 'business_game_plan', record_id: target.mission_id }, 'solo', account);
    const attainment = observation.state === 'unavailable' || observation.attainment === 'unknown' ? 'Attainment unverified'
      : observation.attainment === 'met' ? observation.period_complete ? 'Target met' : 'At target now'
        : target.comparison === 'at_most' ? 'Above limit' : target.comparison === 'within_range' ? 'Outside target range' : 'Below target';
    return <li key={target.id}>
      <div className="exec-section-head"><h4>{target.title}</h4><span className="exec-state">{target.state} · revision {target.revision}</span></div>
      <p>{target.comparison === 'within_range' ? 'Within' : target.comparison === 'at_most' ? 'At most' : 'At least'} <strong>{desired}</strong></p>
      <p className="exec-note">{row.mission.title} · {formatReviewInstant(target.period.start, target.period.time_zone)}–{formatReviewInstant(new Date(Date.parse(target.period.end) - 1).toISOString(), target.period.time_zone)} · {target.period.time_zone}</p>
      {observation.state === 'unavailable' ? <p className="exec-note">{observation.reason === 'historical_snapshot_unavailable'
        ? "A current snapshot cannot verify this past period's actual."
        : target.state === 'paused' ? 'Target paused. Its saved definition and history are preserved.'
          : target.state === 'retired' ? 'Target retired. Its saved history is preserved.'
            : 'Actual unavailable. No zero or attainment is assumed.'}</p>
        : <><dl className="exec-target-values"><div><dt>Actual</dt><dd>{value(observation.actual)}</dd></div><div><dt>Variance</dt><dd>{observation.variance === null ? 'Unverified' : value(observation.variance)}</dd></div></dl>
          <p className="exec-note">{attainment} · {observation.state === 'partial' ? 'Partial coverage' : 'Verified measurement'} · {formatReviewInstant(observation.as_of, target.period.time_zone, true)}</p>
          {observation.caveats.length > 0 && <details className="exec-provenance"><summary>Measurement caveats</summary>{observation.caveats.map((note, index) => <p key={index}>{note}</p>)}</details>}</>}
      {link ? <Link className="exec-link" to={link.to}>Open owning Play<ArrowRight size={14} aria-hidden="true" /></Link>
        : <span className="exec-unresolved">Resolve this workspace to open the owning Play.</span>}
    </li>;
  })}</ul>;
}
