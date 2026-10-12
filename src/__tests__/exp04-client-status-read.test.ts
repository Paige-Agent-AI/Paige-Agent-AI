import { beforeEach, describe, expect, it, vi } from 'vitest';
import source from './fixtures/exp04-client-status-source.json';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/hooks/useTenantContext', () => ({ useTenantContext: () => ({ activeTenantId: null, accountContextLoading: false }) }));

import { ClientStatusRefused, readClientEngagementStatus } from '@/solo/engagement/useClientEngagementStatus';

// The read seam the Engagement panel will mount on. The server's own refusal (42501) must surface as
// a refusal the person cannot retry their way out of; anything else is an honest "could not be read".
describe('Experience 04 · client status read seam', () => {
  const tenant = (source as { tenant_id: string }).tenant_id;
  const contact = (source as { contact_id: string }).contact_id;
  beforeEach(() => rpc.mockReset());

  it('reads through the session RPC and composes the result', async () => {
    rpc.mockResolvedValue({ data: structuredClone(source), error: null });
    const status = await readClientEngagementStatus(tenant, contact);
    expect(rpc).toHaveBeenCalledWith('read_client_engagement_status', { _expected_tenant_id: tenant, _contact_id: contact });
    expect(status.money.outstanding_minor).toBe(302000);
  });

  it('turns the server refusal into a refusal, not a retryable error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not permitted' } });
    await expect(readClientEngagementStatus(tenant, contact)).rejects.toBeInstanceOf(ClientStatusRefused);
  });

  it('reports any other failure as unreadable', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    const err = await readClientEngagementStatus(tenant, contact).catch(e => e);
    expect(err).not.toBeInstanceOf(ClientStatusRefused);
    expect(err.message).toMatch(/could not be read/);
  });

  it('never lets an internal code reach the screen when the answer is malformed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: { ...structuredClone(source), invoices: 'nope' }, error: null });
    const err = await readClientEngagementStatus(tenant, contact).catch(e => e);
    expect(err.message).toBe('This client’s status could not be read.');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('refuses to show an answer for a different workspace or client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: { ...structuredClone(source), tenant_id: '00000000-0000-0000-0000-000000000001' }, error: null });
    await expect(readClientEngagementStatus(tenant, contact)).rejects.toThrow(/could not be read/);
  });
});
