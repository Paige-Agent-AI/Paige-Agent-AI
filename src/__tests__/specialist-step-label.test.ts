// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { specialistStepLabel } from '../../supabase/functions/_shared/paige-turn/specialist-step-label';
const roster = [{ slug: 'email-composer', displayName: 'Correspondence desk' }];
describe('scoped specialist steps', () => {
 it('uses dynamic tenant-safe label at start', () => expect(specialistStepLabel('email-composer', roster, null)).toBe('Bringing in Correspondence desk'));
 it('reports synchronous completion truthfully', () => expect(specialistStepLabel('email-composer', roster, { ok: true, runtime: 'soft' })).toBe('Heard back from Correspondence desk'));
 it('reports refusal without success', () => expect(specialistStepLabel('email-composer', roster, { ok: false })).toBe('Could not hear back from Correspondence desk'));
 it('does not claim durable dispatch completed', () => expect(specialistStepLabel('email-composer', roster, { ok: true, runtime: 'langgraph' })).toBe('Dispatched work to Correspondence desk'));
 it('uses generic label for missing or ambiguous roster', () => { expect(specialistStepLabel('foreign', roster, null)).toBe('Bringing in a specialist'); expect(specialistStepLabel('email-composer', [...roster,...roster], null)).toBe('Bringing in a specialist'); });
 it('does not trust provider or argument labels', () => expect(specialistStepLabel('foreign', [], { ok: true, name: 'Secret agent' })).toBe('Heard back from a specialist'));
 it('unknown response never manufactures completion', () => expect(specialistStepLabel('email-composer', roster, {})).toBe('Could not confirm the response from Correspondence desk'));
 it('bounds and rejects markup/control labels', () => { expect(specialistStepLabel('email-composer', [{ slug:'email-composer',displayName:'<script>x</script>' }], null)).toBe('Bringing in a specialist'); });
});
