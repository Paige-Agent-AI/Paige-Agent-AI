/**
 * team-vocabulary — the one home (§18) for the word PAIGE uses for what a business calls its people.
 *
 * Owner ruling, 2026-09-26: roles authorize, titles describe. The platform role answers "can they?";
 * the title answers "who are they and what do they do?". The display word "title" is final (owner
 * ruling, 2026-09-27, decision log). "Customized role" was rejected: anyone reading "role" assumes it
 * grants something, which is the exact ambiguity a title must never carry.
 *
 * This constant governs every place PAIGE reads or offers the word: the TEAM CONTEXT block
 * (_shared/team-context.ts, its JSON key and its guidance), and in paige-ai-chat the work-details tool
 * description, the approval card for a work-details change, and the note after an access change. The
 * Team screen (src/solo/team-workspace.tsx) writes the same word in its own sentences, held there by
 * src/solo/team-title-copy.test.tsx. The tool argument key `job_title` stays: it is internal, and
 * approvals already queued carry it.
 * A TypeScript property renamed to this word must join TS_WORK_IDENTITY in
 * scripts/ci/title-authority-guard.mjs in the same PR, or the guard stops seeing the title it carries.
 */
export const TITLE_WORD = "title";
