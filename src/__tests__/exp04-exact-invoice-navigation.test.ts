// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/exp04-client-status-source.json';
import { composeClientEngagementStatus, type ClientEngagementSource } from '../../supabase/functions/_shared/client-engagement/status';
import { standingRecordLinks } from '../../supabase/functions/_shared/client-engagement/labels';
import { mergeRecordLinks, readRecordLinks } from '../../supabase/functions/_shared/paige-turn/record-links';
import { workspaceLinkTargets } from '../lib/links/workspaceLinks';

const INVOICE = 'e4000000-0000-4000-8000-0000000a0001';
const tenant = { account_type: 'standalone', parent_tenant_id: null, account_number: 3123 };
const source = () => structuredClone(fixture) as ClientEngagementSource;

describe('a saved invoice reference remains verifiable after a turn reload', () => {
  it('keeps only the invoice UUID, then resolves it against the current workspace address', () => {
    const frame = [{ destination: 'sales_invoices', record_id: INVOICE.toUpperCase(), subject: 'Private invoice text', url: 'https://untrusted.example' }];
    const reloaded = readRecordLinks(JSON.parse(JSON.stringify({ paige_record_links: frame })).paige_record_links);
    expect(reloaded).toEqual([{ destination: 'sales_invoices', record_id: INVOICE }]);
    expect(workspaceLinkTargets(reloaded, tenant)).toEqual([{
      label: 'Open invoice', status: 'exact', to: `/solo/3123/sales/payments?view=invoices&invoice=${INVOICE}`,
    }]);
    expect(workspaceLinkTargets(reloaded, { ...tenant, account_number: 9786 })[0]?.to)
      .toBe(`/solo/9786/sales/payments?view=invoices&invoice=${INVOICE}`);
    expect(mergeRecordLinks(reloaded, reloaded)).toHaveLength(1);
  });

  it('keeps malformed invoice references at the list and never carries a supplied address', () => {
    for (const id of ['../other', `${INVOICE}?tenant=other`, '', null]) {
      const links = readRecordLinks([{ destination: 'sales_invoices', record_id: id, path: '/other' }]);
      expect(workspaceLinkTargets(links, tenant)).toEqual([{
        label: 'Open invoices', status: 'surface_only', to: '/solo/3123/sales/payments?view=invoices',
      }]);
    }
  });

  it('does not invent record focus on other department links or unsupported tiers', () => {
    for (const destination of ['sales_agreements', 'sales_collections', 'business_time_zone'] as const) {
      expect(readRecordLinks([{ destination, record_id: INVOICE }])).toEqual([{ destination, record_id: null }]);
    }
    const links = readRecordLinks([{ destination: 'sales_invoices', record_id: INVOICE }]);
    for (const account_type of ['sub_account', 'agency', 'enterprise']) {
      expect(workspaceLinkTargets(links, { ...tenant, account_type })).toEqual([]);
    }
  });

  it('preserves supported Task focus without changing invoice or account boundaries', () => {
    const task = 'e4000000-0000-4000-8000-0000000a0003';
    const links = readRecordLinks([{ destination: 'operations_work', record_id: task }]);
    expect(links).toEqual([{ destination: 'operations_work', record_id: task }]);
    expect(workspaceLinkTargets(links, tenant)).toEqual([{
      label: 'Open task', status: 'exact', to: `/solo/3123/operations/work?task=${task}`,
    }]);
    expect(workspaceLinkTargets(readRecordLinks([{ destination: 'operations_work', record_id: null }]), tenant))
      .toEqual([{ label: 'Open delivery work', status: 'surface_only', to: '/solo/3123/operations/work' }]);
    for (const account_type of ['sub_account', 'agency', 'enterprise']) {
      expect(workspaceLinkTargets(links, { ...tenant, account_type })).toEqual([]);
    }
  });
});

describe('client standing links only an unambiguous managed invoice', () => {
  it('links one complete managed record exactly without changing payment evidence', () => {
    const input = source();
    input.invoices = [{ ...input.invoices[0], id: INVOICE, status: 'issued' }];
    input.invoices_has_more = false;
    const status = composeClientEngagementStatus(input);
    const before = structuredClone(status);
    expect(standingRecordLinks(status).find(link => link.destination === 'sales_invoices'))
      .toEqual({ destination: 'sales_invoices', record_id: INVOICE });
    expect(status).toEqual(before);
  });

  it('keeps a partial invoice list, several invoices and legacy records at the register', () => {
    for (const kind of ['partial', 'multiple', 'legacy'] as const) {
      const input = source();
      input.invoices = [{ ...input.invoices[0], id: INVOICE, status: kind === 'legacy' ? 'sent' : 'issued' }];
      input.invoices_has_more = kind === 'partial';
      if (kind === 'multiple') input.invoices.push({ ...input.invoices[0], id: 'e4000000-0000-4000-8000-0000000a0002' });
      expect(standingRecordLinks(composeClientEngagementStatus(input)).find(link => link.destination === 'sales_invoices'))
        .toEqual({ destination: 'sales_invoices', record_id: null });
    }
  });
});
