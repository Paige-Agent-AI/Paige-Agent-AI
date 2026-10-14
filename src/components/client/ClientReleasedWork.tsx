import { useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { useClientDeliveryPortal } from './client-delivery-portal-context';

const status = { awaiting_client: 'Ready for your review', accepted: 'Acceptance recorded', client_revision_requested: 'Changes requested' };

/** Metadata projection only. Every selected version reuses the exact Operations reader. */
export function ClientReleasedWork() {
  const portal = useClientDeliveryPortal();
  const outlet = useOutletContext<{ session?: Session | null }>();
  const actorId = outlet?.session?.user.id ?? null;
  const attachList = portal?.attachList;
  useEffect(() => { if (actorId && attachList) return attachList(actorId); }, [actorId, attachList]);
  if (!portal) return null;
  const result = portal.work.actorId === actorId ? portal.work.result : null;
  const loading = portal.work.actorId !== actorId || portal.work.loading;
  return <section className="client-released-work" aria-labelledby="client-released-work-title">
    <h2 id="client-released-work-title">Released work</h2>
    {portal.preview ? <p>Open your own client session to review released work.</p> : !actorId ? <p>Sign in to view your released work.</p>
      : loading ? <p role="status">Loading your released work…</p>
      : result?.kind === 'ready' ? <>
        {(result.unavailableCount > 0 || result.hasMore) && <p role="status" className="client-delivery-list-status">This list is partial.{result.unavailableCount > 0 ? ' Some released work is unavailable.' : ''}{result.hasMore ? ' More released work may exist beyond this list.' : ''}</p>}
        {!result.releases.length ? <p>{result.unavailableCount > 0 || result.hasMore ? 'No released versions could be shown in this list.' : 'No work has been released for your review.'}</p>
          : <ul>{result.releases.map(release => <li key={release.release_id}>
            <div><h3>{release.title}</h3><p>Version {release.revision_no} · {status[release.state]}</p></div>
            <button type="button" disabled={portal.opening !== null} aria-label={`Review ${release.title}, version ${release.revision_no}`}
              onClick={event => { void portal.open(actorId, release.release_id, event.currentTarget); }}>
              {portal.opening === release.release_id ? 'Opening…' : `Review version ${release.revision_no}`}
            </button>
          </li>)}</ul>}
        <button type="button" disabled={portal.opening !== null} onClick={() => portal.refresh(actorId)}>Check released work again</button>
      </> : <div role="status">
        <p>{result?.kind === 'unlinked' ? 'Your client link could not be found. Ask your delivery team to check access.'
          : result?.kind === 'ambiguous' ? 'Your client access could not be resolved safely. Ask your delivery team to check access.'
            : 'Released work could not be read with your current access. Check your connection or ask your delivery team to check access.'}</p>
        <button type="button" onClick={() => portal.refresh(actorId)}>Check released work again</button>
      </div>}
    {portal.notice && <p role="status" className="client-delivery-list-status">{portal.notice}</p>}
  </section>;
}
