import { describe, expect, it } from 'vitest';
import { parseStudioDocument } from '@/components/admin/studio/studio-document';
import { documentCover } from '@/solo/marketing-content-model';
import { validateDocumentBrief } from '../../supabase/functions/_shared/document-production';

describe('original saved business-review document classification', () => {
  it('keeps the real type and original title in the existing library/card presentation', () => {
    const blocks = [{ type: 'cover', title: 'Recorded business review' },
      { type: 'callout', body: 'Historical captured evidence; read current information before a new decision.', variant: 'definition' }];
    const doc = parseStudioDocument('test-original-report', 'Recorded business review', JSON.stringify({ docType: 'business_review', blocks }));
    expect(doc?.docType).toBe('business_review');
    expect(documentCover(doc)).toMatchObject({ title: 'Recorded business review', type: 'Business review' });
    expect(doc?.blocks).toEqual(blocks);
  });
  it('does not admit a report into the public legacy document submission contract', () => {
    expect(validateDocumentBrief({ version: 1, doc_type: 'business_review', title: 'Review', brief: 'Read original evidence.' }))
      .toMatchObject({ ok: false, code: 'document_type_invalid' });
  });
  it.each(['{bad', JSON.stringify({ docType: 'business_review', blocks: [] }), null])('does not invent report content for %j', body => {
    expect(parseStudioDocument('test-original-report', 'Review', body)).toBeNull();
  });
  it('retains the incumbent unknown-document fallback and legacy type', () => {
    const body = (docType: string) => JSON.stringify({ docType, blocks: [{ type: 'prose', markdown: 'Recorded original text.' }] });
    expect(parseStudioDocument('test-guide', 'Guide', body('unknown'))?.docType).toBe('guide');
    expect(parseStudioDocument('test-agreement', 'Agreement', body('agreement_draft'))?.docType).toBe('agreement_draft');
  });
});
