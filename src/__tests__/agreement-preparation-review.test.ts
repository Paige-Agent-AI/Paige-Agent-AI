// @vitest-environment node
import {it,expect} from 'vitest';
import {e04CommercialFixture,e04Id} from '../test/fixtures/e04-commercial-presentation';
import {preparationReviewDocument,readPreparationReviewDocument} from '../../supabase/functions/_shared/agreements/preparation-review';

it('binds the whole displayed document and consequence to the closed approved source digest',async()=>{
 const f=await e04CommercialFixture(),dto=await preparationReviewDocument(f.proposed);
 const consequence={...f.command,kind:'retain_signing_document',principal_minor:350000,currency:'usd',engagement:f.proposed.presentation.payload.engagement};
 expect(await readPreparationReviewDocument(dto,f.command,consequence)).toBe(f.proposed.presented_body_markdown);
 expect(dto.body_markdown).toBe(f.rows.paige_agreements.body_markdown);
 for(const change of [{body_markdown:'Different legal wording'},{presented_body_markdown:'Different displayed document'},{payload_digest:'b'.repeat(64)},{approved:true}])expect(await readPreparationReviewDocument({...dto,...change},f.command,consequence)).toBeNull();
 for(const change of [{principal_minor:350001},{currency:'eur'},{engagement:{...consequence.engagement,starts_on:'2026-11-02'}},{client_id:e04Id(99)}])expect(await readPreparationReviewDocument(dto,f.command,{...consequence,...change})).toBeNull();
 const moved=structuredClone(dto);moved.payload.source.agreement_id=e04Id(99);expect(await readPreparationReviewDocument(moved,f.command,consequence)).toBeNull();
});
it('cannot manufacture original wording from a noncanonical concatenation',async()=>{
 const f=await e04CommercialFixture();await expect(preparationReviewDocument({...f.proposed,presented_body_markdown:f.proposed.presented_body_markdown+' extra'})).rejects.toThrow('PREPARATION_REVIEW_UNAVAILABLE');
});
