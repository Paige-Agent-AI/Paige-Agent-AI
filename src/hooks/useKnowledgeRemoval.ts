import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { deleteKnowledge, readKnowledge, type KnowledgeDocument } from '@/lib/knowledge-service';

type Intent = { document: KnowledgeDocument; isCurrent: () => boolean };
type State = { message: string; uncertain: boolean; busy: boolean; intent: Intent | null };
const empty: State = { message: '', uncertain: false, busy: false, intent: null };
export const knowledgeRemovalDescription = 'This removes the document and its indexed sections from future Knowledge reads. Original uploaded files are retained. This cannot be undone here.';
/** Shared interaction state only; the existing JWT RPC owns authority and revision CAS. */
export function useKnowledgeRemoval(tenantId: string | null | undefined, isCurrent: () => boolean, reload: () => Promise<void>) {
  const scope = useRef({ isCurrent, state: empty });
  if (scope.current.isCurrent !== isCurrent) scope.current = { isCurrent, state: empty };
  const current = scope.current;
  const [, render] = useState(0);
  const publish = (state: State) => { if (isCurrent()) { current.state = state; render(value => value + 1); } };
  const begin = (document: KnowledgeDocument): Intent | null => {
    if (!tenantId || document.tenant_id !== tenantId || !isCurrent() || current.state.busy || current.state.uncertain) return null;
    const intent = { document, isCurrent };
    publish({ message: '', uncertain: false, busy: true, intent });
    return intent;
  };
  const cancel = (intent: Intent) => { if (intent.isCurrent() && current.state.intent === intent && !current.state.message) publish(empty); };
  const remove = async (intent: Intent) => {
    if (!tenantId || !intent.isCurrent() || current.state.intent !== intent || current.state.uncertain) return;
    // Consume the confirmation once. A repeated handler invocation cannot send another write.
    if (current.state.message) return;
    publish({ ...current.state, message: 'Removing document…' });
    try {
      const result = await deleteKnowledge(supabase, tenantId, intent.document.id, intent.document.revision);
      if (!intent.isCurrent()) return;
      publish({ intent: null, busy: false, uncertain: false, message: `Document removed. Original uploaded files were retained.${result.outcome === 'capability_completed_unrecorded' ? ' The outcome receipt could not be recorded; do not repeat the deletion.' : ''}` });
      await reload();
    } catch {
      if (intent.isCurrent()) publish({ intent, busy: false, uncertain: true, message: 'The removal could not be confirmed. Check document status before taking another action.' });
    }
  };
  const check = async () => {
    const { intent, uncertain, busy } = current.state;
    if (!tenantId || !intent || !uncertain || busy || !intent.isCurrent()) return;
    publish({ ...current.state, busy: true });
    try {
      const rows = await readKnowledge(supabase, tenantId, { documentId: intent.document.id });
      if (!intent.isCurrent()) return;
      if (rows.length > 1 || rows.some(doc => doc.id !== intent.document.id)) throw Error('Unexpected document');
      await reload();
      if (!intent.isCurrent()) return;
      publish({ intent: null, busy: false, uncertain: false, message: rows.length ? 'The document is still in Knowledge. Review its current details before starting a new removal.' : 'This document is no longer in Knowledge. The earlier operation and its receipt could not be confirmed.' });
    } catch {
      if (intent.isCurrent()) publish({ intent, busy: false, uncertain: true, message: 'Document status could not be read. Check your workspace and connection, then check again.' });
    }
  };
  return { ...current.state, begin, cancel, remove, check, blocked: current.state.busy || current.state.uncertain };
}
