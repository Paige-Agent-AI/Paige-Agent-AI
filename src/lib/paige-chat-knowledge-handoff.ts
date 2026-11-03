import {
  captureChatKnowledgeAttachment, inspectChatKnowledgeIntake, inspectChatKnowledgeLink,
  prepareChatKnowledgeIntake, prepareChatKnowledgeLink,
  type ChatKnowledgeIntakeReference, type ChatKnowledgeIntakeSelection, type ChatKnowledgePort, type ChatKnowledgeScope,
} from './paige-chat-knowledge-service';
import type {
  KnowledgeExtractionAcknowledged, KnowledgeFlowContext, KnowledgePublicationVerified,
} from '@/solo/knowledge/knowledge-flow-observers';

export type ChatKnowledgeHandoffRow = Readonly<{
  index: number; name: string; documentId: string; extractionWorkId: string;
  canRetryIntake: boolean;
  phase: 'linking' | 'reading_linked' | 'published_linked' | 'link_unconfirmed' | 'link_absent' | 'publication_unlinked';
}>;

/** Ephemeral UI handoff only. Original Knowledge work and the original native
 * Chat links own persistence. Observer failure never repeats a file effect. */
export function createChatKnowledgeHandoff(
  port: ChatKnowledgePort, origin: ChatKnowledgeScope, selected: readonly File[],
  changed: () => void, beforeFirstValue?: (input:ChatKnowledgeIntakeSelection)=>boolean,
) {
  const files = Object.freeze([...selected]);
  let threadId = origin.threadId;
  let tail: Promise<void> = Promise.resolve();
  type Row = Omit<ChatKnowledgeHandoffRow,'canRetryIntake'> & {
    intake?: ChatKnowledgeIntakeReference; publication?: KnowledgePublicationVerified;
    intakeInput?: ChatKnowledgeIntakeSelection;
  };
  const rows = new Map<number, Row>();
  const unresolvedFirstValue = (except:number) => threadId === null && [...rows.values()].some(row =>
    row.index !== except && row.intakeInput && !row.intake && (row.phase === 'link_unconfirmed' || row.phase === 'linking'));
  const current = () => { try { return origin.isCurrent() === true; } catch { return false; } };
  const scope = (context?: KnowledgeFlowContext): ChatKnowledgeScope => ({
    actorId: origin.actorId, tenantId: origin.tenantId, threadId,
    isCurrent: () => current() && (!context || context.isCurrent() === true),
  });
  const update = (index: number, value: Partial<Row>) => {
    const row = rows.get(index);
    if (current() && row) { rows.set(index, {...row, ...value}); changed(); }
  };
  const adopt = (id: string) => {
    if (threadId !== null && threadId !== id) throw Error('Conversation changed');
    threadId = id;
  };
  const enqueue = (action: () => Promise<void>) => {
    const result = tail.then(action);
    // Serializes this UI's annotations; it is neither a worker nor a retry loop.
    tail = result.catch(() => {});
    return result;
  };
  const indexFor = (context: KnowledgeFlowContext) => {
    const index = context.selectionIndex ?? (files.length === 1 ? 0 : -1);
    if (!Number.isInteger(index) || index < 0 || index >= files.length) throw Error('Selection changed');
    return index;
  };
  const acknowledgeExtraction = (value: KnowledgeExtractionAcknowledged, context: KnowledgeFlowContext) => {
    // Snapshot before any await. Never read a later selection into an older work.
    const ref = {...value.reference};
    return enqueue(async () => {
      if (!current() || !context.isCurrent()) return;
      const index = indexFor(context), file = files[index];
      if (ref.tenantId !== origin.tenantId || rows.has(index)) return;
      rows.set(index, {index, name: file.name, documentId: ref.documentId,
        extractionWorkId: ref.workId, phase: 'linking'});
      changed();
      try {
        const capturedScope = scope(context);
        const source = await captureChatKnowledgeAttachment(port, capturedScope, file);
        if (!capturedScope.isCurrent()) {update(index,{phase:'link_unconfirmed'});return;}
        const intakeInput: ChatKnowledgeIntakeSelection = {
          extractionWorkId: ref.workId, extractionIntentId: ref.intentId,
          documentId: ref.documentId, expectedSourceRevision: ref.revision ?? null,
          sourceSha256: source.sourceSha256, turnId: null, expectedLinkRevision: 0,
        };
        update(index, {intakeInput});
        // A previous first-value call may have committed without returning its
        // thread. A second constructor would fork the same bulk selection.
        // Keep this stored reading for explicit inspection instead.
        if (unresolvedFirstValue(index)) {
          update(index, {phase:'link_unconfirmed'}); return;
        }
        if(threadId===null&&(!beforeFirstValue||!beforeFirstValue(intakeInput)))throw Error('Recovery unavailable');
        const handle = prepareChatKnowledgeIntake(port, capturedScope, intakeInput);
        const result = await handle.stage();
        if (!capturedScope.isCurrent()) {update(index,{phase:'link_unconfirmed'});return;}
        if (result.status !== 'recorded' || !result.current) throw Error('Link unconfirmed');
        adopt(result.reference.threadId);
        update(index, {intake: result.reference, phase: 'reading_linked'});
      } catch { update(index, {phase: 'link_unconfirmed'}); }
    });
  };
  const verifyPublication = (value: KnowledgePublicationVerified, context: KnowledgeFlowContext) => {
    const publication = {...value};
    return enqueue(async () => {
      if (!current() || !context.isCurrent()) return;
      const index = indexFor(context), row = rows.get(index);
      if (!row || publication.tenantId !== origin.tenantId || row.documentId !== publication.documentId) return;
      update(index, {publication});
      if (!row.intake || row.intake.linkRevision !== 1) { update(index, {phase: 'link_unconfirmed'}); return; }
      try {
        const capturedScope = scope(context);
        const handle = prepareChatKnowledgeLink(port, capturedScope, {
          publicationWorkId: publication.workId, documentId: publication.documentId,
          documentRevision: publication.revision, extractionIntentId: row.intake.extractionIntentId,
          sourceSha256: row.intake.sourceSha256, turnId: row.intake.turnId,
          expectedLinkRevision: 1,
        });
        const result = await handle.save();
        if (!capturedScope.isCurrent()) {update(index,{phase:'link_unconfirmed'});return;}
        if (result.status !== 'recorded' || !result.current) throw Error('Link unconfirmed');
        adopt(result.reference.threadId);
        update(index, {phase: 'published_linked'});
      } catch { update(index, {phase: 'link_unconfirmed'}); }
    });
  };
  const inspect = () => enqueue(async () => {
    for (const [index, row] of rows) {
      if (!current()) return;
      try {
        if (row.publication) {
          const published = await inspectChatKnowledgeLink(port, scope(), row.publication.workId);
          if (!current()) return;
          if (published.status === 'recorded' && published.current) {
            adopt(published.reference.threadId); update(index, {phase:'published_linked'}); continue;
          }
          if (published.status === 'recorded') { update(index, {phase:'link_unconfirmed'}); continue; }
        }
        // A fresh current read may reconcile an old, now-closed review. No write,
        // upload, extraction or publication is replayed by this inspection.
        const result = await inspectChatKnowledgeIntake(port, scope(), row.extractionWorkId);
        if (!current()) return;
        if (result.status === 'recorded' && result.current) {
          adopt(result.reference.threadId);
          update(index, {intake: result.reference, phase: 'reading_linked'});
        } else { update(index, {phase: result.status === 'absent_at_read' ? 'link_absent' : 'link_unconfirmed'}); continue; }
        if (row.publication) update(index, {phase:'publication_unlinked'});
      } catch { update(index, {phase: 'link_unconfirmed'}); }
    }
  });
  const retryIntake = (index: number) => enqueue(async () => {
    const row = rows.get(index);
    // Explicit same-operation retry only after authoritative absence inspection.
    // It never repeats Storage, extraction, review or publication.
    if (!current() || row?.phase !== 'link_absent' || !row.intakeInput || unresolvedFirstValue(index)) return;
    update(index, {phase: 'linking'});
    try {
      if(threadId===null&&(!beforeFirstValue||!beforeFirstValue(row.intakeInput)))throw Error('Recovery unavailable');
      const result = await prepareChatKnowledgeIntake(port, scope(), row.intakeInput).stage();
      if (!current()) return;
      if (result.status !== 'recorded' || !result.current) throw Error('Link unconfirmed');
      adopt(result.reference.threadId);
      update(index, {intake: result.reference, phase: row.publication ? 'publication_unlinked' : 'reading_linked'});
    } catch { update(index, {phase: 'link_unconfirmed'}); }
  });
  const retryPublication = (index: number) => enqueue(async () => {
    const row = rows.get(index), publication = row?.publication, intake = row?.intake;
    if (!current() || row?.phase !== 'publication_unlinked' || !publication || !intake || intake.linkRevision !== 1) return;
    update(index, {phase: 'linking'});
    try {
      const result = await prepareChatKnowledgeLink(port, scope(), {
        publicationWorkId: publication.workId, documentId: publication.documentId,
        documentRevision: publication.revision, extractionIntentId: intake.extractionIntentId,
        sourceSha256: intake.sourceSha256, turnId: intake.turnId, expectedLinkRevision: 1,
      }).save();
      if (!current()) return;
      if (result.status !== 'recorded' || !result.current) throw Error('Link unconfirmed');
      adopt(result.reference.threadId); update(index, {phase: 'published_linked'});
    } catch { update(index, {phase: 'link_unconfirmed'}); }
  });
  return {
    acknowledgeExtraction, verifyPublication, inspect, retryIntake, retryPublication,
    getThreadId: () => threadId,
    getRows: (): readonly ChatKnowledgeHandoffRow[] => [...rows.values()].map(({index,name,documentId,extractionWorkId,phase,intakeInput}) =>
      ({index,name,documentId,extractionWorkId,phase,canRetryIntake:!!intakeInput})),
  };
}
