/**
 * team-vocabulary — the one home (§18) for the word PAIGE uses for what a business calls its people.
 *
 * Owner ruling, 2026-09-26: roles authorize, titles describe. The platform role answers "can they?";
 * the title answers "who are they and what do they do?". The display word "title" is a coordinator
 * ruling pending the owner's final word (decision log, 2026-09-26); the alternative on record is
 * "customized role".
 *
 * Today this constant governs the TEAM CONTEXT block (_shared/team-context.ts): its JSON key and every
 * sentence that names the word. The Team tool descriptions and approval cards in paige-ai-chat, and the
 * Team screen copy, still spell "job title"; they move onto this constant in their own slice.
 * A TypeScript property renamed to this word must join TS_WORK_IDENTITY in
 * scripts/ci/title-authority-guard.mjs in the same PR, or the guard stops seeing the title it carries.
 */
export const TITLE_WORD = "title";
