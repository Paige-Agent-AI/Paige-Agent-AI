export interface SpecialistStepIdentity { slug: string; displayName: string }
/** Only server-scoped roster names may label a specialist; no argument/result name fallback. */
export function specialistStepLabel(slug: unknown, roster: readonly SpecialistStepIdentity[], result: unknown): string {
 const matches = typeof slug === 'string' ? roster.filter(r => r.slug === slug) : [];
 const candidate = matches.length === 1 ? matches[0].displayName : '';
 const who = typeof candidate === 'string' && candidate.trim() && candidate.length <= 80 && !/[<>\u0000-\u001f\u007f]/.test(candidate) ? candidate.trim() : 'a specialist';
 if (result === null || result === undefined) return `Bringing in ${who}`;
 const out = typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {};
 if (out.ok === false || out.success === false || typeof out.error === 'string') return `Could not hear back from ${who}`;
 if (out.ok === true || out.success === true) return out.runtime === 'langgraph' ? `Dispatched work to ${who}` : `Heard back from ${who}`;
 return `Could not confirm the response from ${who}`;
}
