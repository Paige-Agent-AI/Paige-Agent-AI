import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { readKnowledge, type KnowledgeDocument } from '@/lib/knowledge-service';

const PAGE_SIZE = 100;
/** A scope incarnation, rather than tenant equality, also fences A → B → A. */
export function useKnowledgeDocuments(tenantId: string | null | undefined, documentId?: string | null) {
  const scope = useRef({ tenantId, documentId });
  if (scope.current.tenantId !== tenantId || scope.current.documentId !== documentId) scope.current = { tenantId, documentId };
  const current = scope.current;
  const sequence = useRef(0);
  const mounted = useRef(true);
  const [state, setState] = useState({ scope: current, docs: [] as KnowledgeDocument[], loading: true, error: null as string | null, hasMore: false, offset: 0 });
  const snapshot = useRef(state);
  snapshot.current = state;

  const fetchPage = useCallback(async (append: boolean) => {
    if (scope.current !== current || !mounted.current) return;
    const previous = snapshot.current.scope === current ? snapshot.current.docs : [];
    const offset = append && snapshot.current.scope === current ? snapshot.current.offset : 0;
    const mine = ++sequence.current;
    if (!tenantId) {
      setState({ scope: current, docs: [], loading: false, error: 'Select a workspace to read Knowledge.', hasMore: false, offset: 0 });
      return;
    }
    setState({ scope: current, docs: append ? previous : [], loading: true, error: null, hasMore: false, offset });
    try {
      const rows = await readKnowledge(supabase, tenantId, { limit: PAGE_SIZE, offset, ...(documentId ? { documentId } : {}) });
      if (documentId && rows.some(doc => doc.id !== documentId)) throw new Error('Requested Knowledge source did not match.');
      if (!mounted.current || scope.current !== current || mine !== sequence.current) return;
      // Pagination can overlap when another author inserts a document. Never render duplicate keys.
      const docs = Array.from(new Map([...(append ? previous : []), ...rows].map(doc => [doc.id, doc])).values());
      setState({ scope: current, docs, loading: false, error: null, hasMore: rows.length === PAGE_SIZE, offset: offset + rows.length });
    } catch {
      if (!mounted.current || scope.current !== current || mine !== sequence.current) return;
      setState({ scope: current, docs: append ? previous : [], loading: false, error: 'Knowledge could not be read. Check your workspace and connection, then reload.', hasMore: append, offset });
    }
  }, [tenantId, documentId, current]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reload = useCallback(() => fetchPage(false), [fetchPage]);
  const loadMore = useCallback(() => fetchPage(true), [fetchPage]);
  useEffect(() => { void reload(); }, [reload]);
  const visible = state.scope === current ? state : { docs: [], loading: !!tenantId, error: tenantId ? null : 'Select a workspace to read Knowledge.', hasMore: false };
  const isCurrent = useCallback(() => mounted.current && scope.current === current, [current]);
  const docs: KnowledgeDocument[] = visible.docs;
  return { docs, loading: visible.loading, error: visible.error, hasMore: visible.hasMore, reload, loadMore, isCurrent };
}
