import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExecutiveTargets } from './ExecutiveTargets';
import type { MissionTargetSnapshot } from '../../supabase/functions/_shared/business-mission-targets/presentation';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const now = Date.parse('2026-10-14T12:00:00Z');
const row = (): MissionTargetSnapshot => ({ mission: { id: '33333333-3333-4333-8333-333333333333', title: 'Grow sustainably', revision: 3, state: 'active' },
  target: { id: '22222222-2222-4222-8222-222222222222', tenant_id: '11111111-1111-4111-8111-111111111111', mission_id: '33333333-3333-4333-8333-333333333333', revision: 1, state: 'active', title: 'Active clients target',
    metric: { key: 'business.active_clients_current', version: '1.0.0', unit: 'count', value_kind: 'count', currency: null, dimensions: {}, range_key: 'month', semantics: 'current_snapshot', business_time_zone: null },
    period: { start: '2026-10-01T00:00:00Z', end: '2026-11-01T00:00:00Z', time_zone: 'UTC' }, comparison: 'at_least', desired_value: '10', upper_value: null },
  observation: { state: 'available', actual: '12', variance: '2', attainment: 'met', period_complete: false, as_of: new Date(now).toISOString(), source_revision_ref: 'sr_v1_' + 'a'.repeat(64), reference_expires_at: new Date(now + 60000).toISOString(), caveats: [] } });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(now)); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const render = async (targets: MissionTargetSnapshot[]) => { await act(async () => root.render(<MemoryRouter><ExecutiveTargets targets={targets} account="42" /></MemoryRouter>)); };
it('shows exact compatible actual/variance and opens the owning Play through the current-account resolver', async () => {
  await render([row()]);
  expect([...host.querySelectorAll('dd')].map(n => n.textContent)).toEqual(['12', '2']);
  expect(host.textContent).toContain('At target now'); expect(host.textContent).not.toContain('Target met');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/solo/42/command-center/business-game-plan?play=33333333-3333-4333-8333-333333333333');
});
it('keeps a partial actual visible while withholding variance and attainment', async () => {
  const data = row(); data.observation = { ...data.observation, state: 'partial', actual: '12', variance: null, attainment: 'unknown' } as MissionTargetSnapshot['observation'];
  await render([data]);
  expect([...host.querySelectorAll('dd')].map(n => n.textContent)).toEqual(['12', 'Unverified']);
  expect(host.textContent).toContain('Attainment unverified'); expect(host.textContent).toContain('Partial coverage');
});
it.each(['expiry', 'period'])('retires the performance claim at %s while retaining the saved target and navigation', async kind => {
  const data = row();
  if (kind === 'period') data.target.period.end = new Date(now + 1000).toISOString();
  await render([data]);
  await act(async () => { vi.advanceTimersByTime(kind === 'period' ? 1002 : 60002); });
  expect(host.querySelectorAll('dd')).toHaveLength(0); expect(host.textContent).toContain('At least 10');
  expect(host.textContent).not.toContain('At target now'); expect(host.querySelector('a')).not.toBeNull();
});
it('keeps missing numeric targets separate from the company direction', async () => {
  await render([]); expect(host.textContent).toContain('business direction can still exist'); expect(host.textContent).not.toContain('0');
});
