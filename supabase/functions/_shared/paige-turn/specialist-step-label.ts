export interface SpecialistStepIdentity { slug: string; displayName: string }
/** Only server-scoped roster names may label a specialist; no argument/result name fallback. */
function specialistName(slug: unknown, roster: readonly SpecialistStepIdentity[]): string {
 const matches = typeof slug === 'string' ? roster.filter(r => r.slug === slug) : [];
 const candidate = matches.length === 1 ? matches[0].displayName : '';
 return typeof candidate === 'string' && candidate.trim() && candidate.length <= 80 && !/[<>\u0000-\u001f\u007f]/.test(candidate) ? candidate.trim() : 'a specialist';
}
export function specialistStepLabel(slug: unknown, roster: readonly SpecialistStepIdentity[], result: unknown): string {
 const who = specialistName(slug, roster);
 if (result === null || result === undefined) return `Bringing in ${who}`;
 const out = typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {};
 if (out.ok === false || out.success === false || typeof out.error === 'string') return `Could not hear back from ${who}`;
 if (out.ok === true || out.success === true) return out.runtime === 'langgraph' ? `Dispatched work to ${who}` : `Heard back from ${who}`;
 return `Could not confirm the response from ${who}`;
}

/** Approval copy only. A proposed brief is not permission or an execution result. */
export function specialistAssignmentSummary(args: unknown, roster: readonly SpecialistStepIdentity[]): string {
 const a = args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {};
 const input = a.input && typeof a.input === 'object' && !Array.isArray(a.input) ? a.input as Record<string, unknown> : {};
 const who = specialistName(typeof a.slug === 'string' ? a.slug : a.subagent_slug, roster);
 const request = typeof input.request === 'string' ? input.request : a.task;
 const text = typeof request === 'string'
   ? request.slice(0, 1024).replace(/[\uD800-\uDBFF]$/u, '').replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim() : '';
 const characters = Array.from(text);
 const brief = characters.length
   ? characters.slice(0, 180).join('') + (characters.length > 180 || typeof request === 'string' && request.length > 1024 ? '…' : '') : '';
 return brief ? `Request an assignment from ${who}: “${brief}”`
   : `Request an assignment from ${who}. Review its scope before approving.`;
}
