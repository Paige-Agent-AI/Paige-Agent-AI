import type {ExtractionReference, ExtractionStatus, ExtractionSubmission, KnowledgePublicationAssociation} from '@/lib/knowledge-extraction-service';

/** Data-only notifications, not durable host acknowledgments or write authority.
 * Hosts must recheck their original actor/resource/CAS and this negative-only
 * lifetime after awaits, using their existing authorized persistence door.
 */
export type KnowledgeFlowContext = Readonly<{isCurrent: () => boolean; selectionIndex?: number}>;
export type KnowledgeExtractionAcknowledged = Readonly<{
  reference: Readonly<ExtractionReference>; status: ExtractionStatus; replayed: boolean;
}>;
export type KnowledgePublicationVerified = Readonly<{
  tenantId: string; documentId: string; revision: number; workId: string; generationId: string;
  outcome: NonNullable<KnowledgePublicationAssociation['outcome']>;
}>;
export type KnowledgeFlowObserver<T> = (value: T, context: KnowledgeFlowContext) => void | Promise<void>;
export type KnowledgeFlowObservers = {
  onExtractionAcknowledged?: KnowledgeFlowObserver<KnowledgeExtractionAcknowledged>;
  onPublicationVerified?: KnowledgeFlowObserver<KnowledgePublicationVerified>;
};

export function knowledgeExtractionAcknowledgment(submission: ExtractionSubmission): KnowledgeExtractionAcknowledged {
  const ref = submission.reference;
  return Object.freeze({reference: Object.freeze({tenantId: ref.tenantId, documentId: ref.documentId,
    workId: ref.workId, intentId: ref.intentId, ...(ref.revision === undefined ? {} : {revision: ref.revision})}),
  status: submission.status, replayed: submission.replayed});
}

/** An observer failure is a missing host link, never a reason to repeat a native
 * effect or to turn verified Knowledge publication into a failed publication.
 * There is no transport, retry, persistence, authority or receipt in this helper.
 */
export function notifyKnowledgeObserver<T>(observer: KnowledgeFlowObserver<T> | undefined, value: T, context: KnowledgeFlowContext): void {
  try {
    if (!observer || !context.isCurrent()) return;
    void Promise.resolve(observer(value, Object.freeze(context))).catch(() => {});
  } catch { /* Native effect handling and host notification are independent. */ }
}
