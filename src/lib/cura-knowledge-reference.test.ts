import { expect, it } from 'vitest';
import { curaKnowledgeReferenceKey, readCuraKnowledgeReference } from './cura-knowledge-reference';
const doc = 'b3b60300-0000-4000-8000-000000000001';
it('opens only the existing explicit Knowledge view and retains no authority fields', () => {
  expect(readCuraKnowledgeReference(new URLSearchParams('source='+doc))).toBeNull();
  expect(readCuraKnowledgeReference(new URLSearchParams('view=other&source='+doc))).toBeNull();
  expect(readCuraKnowledgeReference(new URLSearchParams('view=knowledge&source='+doc.toUpperCase()+'&actor=other&tenant=other'))).toEqual({documentId:doc,invalid:false});
  expect(curaKnowledgeReferenceKey(null)).toBe('');
});
it('supports the inventory destination without pretending it identifies a source', () => {
  const reference=readCuraKnowledgeReference(new URLSearchParams('view=knowledge'));
  expect(reference).toEqual({documentId:null,invalid:false});
  expect(curaKnowledgeReferenceKey(reference)).toBe('all');
});
it.each(['view=knowledge&source=', 'view=knowledge&source=not-a-document', 'view=knowledge&source='+doc+'&source='+doc, 'view=knowledge&view=other&source='+doc, 'view=other&view=knowledge&source='+doc])('refuses malformed or ambiguous reference %s', value => {
  const reference=readCuraKnowledgeReference(new URLSearchParams(value));
  expect(reference).toEqual({documentId:null,invalid:true});
  expect(curaKnowledgeReferenceKey(reference)).toBe('invalid');
});
