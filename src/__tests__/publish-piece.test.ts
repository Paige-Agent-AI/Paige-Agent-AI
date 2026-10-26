// The publish affordance's PURE projections (src/solo/publish-piece.tsx) — EXP07 row 10's customer
// surface. The panel's contract is that it renders EXACTLY what the governed door said, in the
// door's own words, with the right next step for each refusal. These tests drive every face the
// door can produce, so a regression that swaps a truthful state for a friendlier one fails here.
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

import { classifyPublishNetworks, doorFace, defaultCaption, PUBLICATION_STATUS_WORDS } from '@/solo/publish-piece';

const NETWORKS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'x', label: 'X' },
];

describe('EXP07 · publish affordance · network readiness', () => {
  it('renders each network from the presence read alone — never a guess from a handle', () => {
    const rows = classifyPublishNetworks(NETWORKS, [
      { network: 'instagram', status: 'connected' },
      { network: 'facebook', status: 'needs_reauth' },
      { network: 'x', status: 'error' },
    ]);
    expect(rows[0]).toEqual({ key: 'instagram', label: 'Instagram', readiness: 'connected', note: 'Connected' });
    expect(rows[1]).toMatchObject({ readiness: 'needs_reauth', note: 'Needs you to sign in again' });
    expect(rows[2]).toMatchObject({ readiness: 'not_connected', note: 'Not connected' });
  });

  it('a network with no connection row at all is not connected, not "probably fine"', () => {
    const rows = classifyPublishNetworks(NETWORKS, []);
    expect(rows.every((row) => row.readiness === 'not_connected')).toBe(true);
  });
});

describe('EXP07 · publish affordance · door faces', () => {
  const approval = {
    ok: false,
    state: 'approval_required',
    approval: {
      fingerprint: '0123456789abcdef',
      summary: 'Publish “Launch image” to instagram (Main St. Bakery). Nothing else is included, and nothing is scheduled.',
      expires_at: '2026-10-26T12:30:00.000Z',
    },
    preview: { piece_id: 'p1', piece_title: 'Launch image', platform: 'instagram', channel_label: 'Main St. Bakery', caption: 'Grand opening Saturday!' },
  };

  it('the door’s own preview becomes the approval face, verbatim', () => {
    const face = doorFace(approval, null);
    expect(face).toMatchObject({
      face: 'approval_required',
      fingerprint: '0123456789abcdef',
      summary: approval.approval.summary,
      channelLabel: 'Main St. Bakery',
      caption: 'Grand opening Saturday!',
    });
  });

  it('an approval without a usable fingerprint is unreachable — never a half-preview', () => {
    const face = doorFace({ state: 'approval_required', approval: { summary: 'x' } }, null);
    expect(face.face).toBe('unreachable');
  });

  it('published carries the post link and the receipt id', () => {
    const face = doorFace({ ok: true, state: 'published', post_url: 'https://instagram.com/p/1', publication_id: 'pub-1' }, null);
    expect(face).toEqual({ face: 'published', url: 'https://instagram.com/p/1', publicationId: 'pub-1' });
  });

  it('partial and outcome_unknown state exactly what happened', () => {
    expect(doorFace({ ok: true, state: 'partial', post_url: null, publication_id: 'pub-2' }, null)).toMatchObject({ face: 'partial', publicationId: 'pub-2' });
    expect(doorFace({ ok: false, state: 'outcome_unknown', error: 'It may have posted — check the channel.', publication_id: 'pub-3' }, null))
      .toMatchObject({ face: 'outcome_unknown', sentence: 'It may have posted — check the channel.', publicationId: 'pub-3' });
  });

  it('declined and failed map to their own faces', () => {
    expect(doorFace({ ok: true, state: 'declined' }, null)).toEqual({ face: 'declined' });
    expect(doorFace(null, { ok: false, state: 'failed', error: 'The channel refused the post. Nothing was published.', publication_id: 'pub-4' }))
      .toMatchObject({ face: 'failed' });
  });

  it('refusals keep the door’s sentence; access_denied is permission, the rest are refusals', () => {
    expect(doorFace(null, { ok: false, state: 'refused', code: 'connection_no_longer_connected', error: 'That channel’s connection changed.' }))
      .toEqual({ face: 'refused', sentence: 'That channel’s connection changed.' });
    expect(doorFace(null, { ok: false, state: 'refused', code: 'access_denied', message: 'Only an owner or admin may publish.' }))
      .toEqual({ face: 'not_permitted', sentence: 'Only an owner or admin may publish.' });
  });

  it('each pre-approval refusal gets the face that offers the right next step', () => {
    expect(doorFace(null, { code: 'NO_CONNECTION', error: 'That channel isn’t connected yet.' }).face).toBe('channel_blocked');
    expect(doorFace(null, { code: 'NEEDS_REAUTH', error: 'sign in again' }).face).toBe('channel_blocked');
    expect(doorFace(null, { code: 'PUBLISHING_NOT_CONFIGURED', error: 'not configured' }).face).toBe('not_configured');
    expect(doorFace(null, { code: 'RETRY_PENDING_RECONCILIATION', error: 'never reported an outcome' }).face).toBe('retry_blocked');
    expect(doorFace(null, { code: 'NOT_AUTHENTICATED', error: 'Sign in, then try again.' }).face).toBe('signed_out');
    expect(doorFace(null, { code: 'CALLER_NOT_OWNER', error: 'nope' }).face).toBe('not_permitted');
    expect(doorFace(null, { code: 'CONTENT_NOT_FOUND', error: 'not in this workspace' }).face).toBe('not_permitted');
  });

  it('the framework’s non-2xx constant is never shown to a person', () => {
    const face = doorFace(null, { error: 'Edge Function returned a non-2xx status code' });
    expect(face.face).toBe('unreachable');
    expect(face.sentence).not.toMatch(/non-2xx/i);
  });

  it('no body at all claims nothing', () => {
    expect(doorFace(null, null).face).toBe('unreachable');
  });
});

describe('EXP07 · publish affordance · caption and receipt words', () => {
  it('the words that will post come from the piece itself', () => {
    expect(defaultCaption({ body: 'Grand opening Saturday!', title: 'Launch image' } as never)).toBe('Grand opening Saturday!');
    expect(defaultCaption({ body: '', title: 'Launch image' } as never)).toBe('Launch image');
  });

  it('a caption longer than the door accepts is trimmed to the door’s own limit', () => {
    const long = defaultCaption({ body: 'x'.repeat(3000), title: 't' } as never);
    expect(long.length).toBe(2200);
  });

  it('every status the door can leave on a receipt has words for a person', () => {
    for (const status of ['registered', 'approved', 'publishing', 'published', 'partial', 'failed', 'outcome_unknown', 'refused']) {
      expect(PUBLICATION_STATUS_WORDS[status]).toBeTruthy();
    }
  });
});
