import {useId, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {readKnowledgeDocumentSourceEvidence, type ExtractionClient, type ExtractionReview,
  type ExtractionScope, type KnowledgeDocumentSourceEvidence} from '@/lib/knowledge-extraction-service';

type Props = {client: ExtractionClient; scope: ExtractionScope; review: ExtractionReview};
type Incarnation = {key: string; extracted: string | undefined; reviewed: string | null | undefined};
type View = {incarnation: Incarnation; phase: 'closed' | 'loading' | 'unavailable' | 'available'; evidence?: KnowledgeDocumentSourceEvidence};
const PAGE_SIZE = 10;
const EXCERPT_LIMIT = 1200;

/** Read-only disclosure of the original extraction snapshot. It never grants
 * authority, confirms facts, signs terms, downloads a file or changes a review.
 */
export function KnowledgeSourceEvidencePanel({client, scope, review}: Props) {
  const id = useId(), lifetime = useRef({live: true, generation: 0});
  const key = JSON.stringify([scope.tenantId, review.tenant_id, review.document_id, review.revision, review.extraction_work_id, review.extraction_source_binding]);
  const incarnationRef = useRef<Incarnation>({key, extracted: review.pending_review?.extracted_content, reviewed: review.pending_review?.reviewed_content});
  if (incarnationRef.current.key !== key || incarnationRef.current.extracted !== review.pending_review?.extracted_content
    || incarnationRef.current.reviewed !== review.pending_review?.reviewed_content) {
    incarnationRef.current = {key, extracted: review.pending_review?.extracted_content, reviewed: review.pending_review?.reviewed_content};
    lifetime.current.generation++;
  }
  const incarnation = incarnationRef.current;
  const [view, setView] = useState<View>({incarnation, phase: 'closed'});
  const [offset, setOffset] = useState(0);
  const previousButton = useRef<HTMLButtonElement>(null), nextButton = useRef<HTMLButtonElement>(null);
  const paginationFocus = useRef<'previous' | 'next' | null>(null);
  useLayoutEffect(() => {const captured = lifetime.current; captured.live = true; return () => {captured.live = false; captured.generation++;};}, []);
  const currentView: View = view.incarnation === incarnation && scope.isCurrent() ? view : {incarnation, phase: 'closed' as const};
  const open = currentView.phase !== 'closed';

  const toggle = async () => {
    const run = ++lifetime.current.generation;
    if (open) {setView({incarnation, phase: 'closed'}); return;}
    const expected = {...review, extraction_source_binding: review.extraction_source_binding ? {...review.extraction_source_binding} : null,
      pending_review: review.pending_review ? {...review.pending_review} : null};
    const requestScope = {tenantId: scope.tenantId, isCurrent: () => lifetime.current.live && lifetime.current.generation === run
      && incarnationRef.current === incarnation && scope.isCurrent()};
    if (!requestScope.isCurrent()) return;
    setOffset(0); setView({incarnation, phase: 'loading'});
    try {
      if (expected.tenant_id !== requestScope.tenantId || !expected.pending_review) throw new Error('source unavailable');
      const read = await readKnowledgeDocumentSourceEvidence(client, requestScope, expected.document_id, expected.revision);
      if (!requestScope.isCurrent()) return;
      const evidence = read.extractionEvidence, pending = read.review.pending_review;
      const source = expected.extraction_source_binding, actualSource = read.review.extraction_source_binding;
      const sourceKeys = ['bucket', 'object_id', 'object_name', 'sha256', 'byte_size', 'mime_type', 'bound_at'] as const;
      if (!evidence || read.review.extraction_work_id !== expected.extraction_work_id || read.review.record_state !== expected.record_state
        || !source || !actualSource || sourceKeys.some(field => source[field] !== actualSource[field])
        || !pending || pending.extracted_content !== expected.pending_review.extracted_content
        || pending.extraction_version !== expected.pending_review.extraction_version || pending.coverage !== expected.pending_review.coverage) {
        setView({incarnation, phase: 'unavailable'}); return;
      }
      setView({incarnation, phase: 'available', evidence});
    } catch {
      if (requestScope.isCurrent()) setView({incarnation, phase: 'unavailable'});
    }
  };
  const evidence = currentView.evidence;
  useLayoutEffect(() => {
    const requested = paginationFocus.current;
    paginationFocus.current = null;
    if (currentView.phase !== 'available' || !requested) return;
    const button = requested === 'previous' ? previousButton.current : nextButton.current;
    if (button && !button.disabled) button.focus();
  }, [offset, currentView.phase]);
  return <section className="space-y-3">
    {review.pending_review?.coverage==='partial'&&<p className="text-sm" role="status">Full document coverage is not verified. The extracted text is ready for review; compare it with your original before publishing. Open source references to check reading limits.</p>}
    <Button type="button" variant="outline" aria-expanded={open} aria-controls={id} onClick={() => void toggle()}>
      {open ? 'Hide source references' : 'View source references'}
    </Button>
    {open && <div id={id} className="space-y-3 text-sm">
      {currentView.phase === 'loading' && <p role="status">Checking this source revision…</p>}
      {currentView.phase === 'unavailable' && <p role="status">Source references unavailable. The current source, access or extraction evidence could not be verified. Your editable review is unchanged. Close these references and reopen them to check again.</p>}
      {evidence && <>
        <p>{evidence.format.toUpperCase()} · Revision {review.revision} · {evidence.coverage === 'partial' ? 'Partial reading' : 'Extracted text'}</p>
        <p>These are extracted source excerpts, not confirmed business facts. Edits in your review do not change these excerpts.</p>
        {evidence.format === 'pdf' && <p>Text layer only; no OCR. Some pages or content may be missing.</p>}
        {evidence.format === 'docx' && <p>Main document text only. Paragraph references are not page numbers; other document elements may be missing.</p>}
        {evidence.format === 'pdf' && <p>Readable page references: {evidence.segments.filter(segment=>segment.kind==='page').length}. This is not a total page count.</p>}
        {evidence.limits.includes('PAGE_LIMIT') && <p>The reading reached its page limit.</p>}
        {evidence.limits.includes('TEXT_LIMIT') && <p>The reader reached its text limit. Some source text was not extracted.</p>}
        {evidence.limits.includes('EMPTY_PDF_PAGES') && <p>Some pages had no readable text.</p>}
        <ol className="space-y-3">
          {evidence.segments.slice(offset, offset + PAGE_SIZE).map(segment => {
            const characters = Array.from(evidence.extracted_content.slice(segment.start, segment.end));
            const excerpt = characters.slice(0, EXCERPT_LIMIT).join('');
            return <li key={`${segment.kind}:${segment.ordinal}`} className="space-y-1">
              <p className="font-medium">{segment.kind === 'page' ? 'Page' : segment.kind === 'paragraph' ? 'Paragraph' : 'Text section'} {segment.ordinal}</p>
              <blockquote className="whitespace-pre-wrap break-words">{excerpt}</blockquote>
              {characters.length > EXCERPT_LIMIT && <p>Excerpt shortened for display.</p>}
            </li>;
          })}
        </ol>
        {evidence.segments.length > PAGE_SIZE && <div className="flex flex-wrap items-center gap-2">
          <p role="status">References {offset + 1}–{Math.min(offset + PAGE_SIZE, evidence.segments.length)} of {evidence.segments.length}</p>
          <Button ref={previousButton} type="button" variant="outline" disabled={offset === 0} onClick={() => {
            if (offset <= PAGE_SIZE) paginationFocus.current = 'next';
            setOffset(n => Math.max(0, n - PAGE_SIZE));
          }}>Previous references</Button>
          <Button ref={nextButton} type="button" variant="outline" disabled={offset + PAGE_SIZE >= evidence.segments.length} onClick={() => {
            if (offset + PAGE_SIZE * 2 >= evidence.segments.length) paginationFocus.current = 'previous';
            setOffset(n => n + PAGE_SIZE);
          }}>Next references</Button>
        </div>}
      </>}
    </div>}
  </section>;
}
