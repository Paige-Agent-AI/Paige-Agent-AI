-- =============================================================================
-- MENTOR role remap — owner directive 2026-10-19 ("current Coordinator
-- instructions" supersede the September C-suite roster for MENTOR).
--
-- MENTOR's remit becomes: Business Discovery, Education, Knowledge and
-- Strategy, serving EXP01 (Meet PAIGE), EXP13 and EXP15. This supersedes the
-- MENTOR=VP-Operations assignment in the 20270108000000 roster mount; that
-- migration and the roster doctrine's history are preserved untouched.
--
-- Per the mount's own preamble rule: presentation identities ride the EXISTING
-- paige_subagents registry home — no new agent registry, callable seam, or
-- authority owner. This correction changes DISPLAY METADATA ONLY (remit text,
-- domain tag, role label) and one specialist parenting edge. It grants no
-- authority, changes no routing, alters no dispatch contract, and expands no
-- privilege: a name or description change can never confer capability
-- (authority still resolves through the Spine at execution time).
--
-- Forward-only and idempotent: each UPDATE is guarded to run only when the row
-- still carries the superseded seeded values, so re-running is a no-op and an
-- owner/tenant edit made after this migration is never overwritten.
-- =============================================================================

-- 1) The MENTOR row: remit, domain tag, role label, goal, backstory, voice.
update public.paige_subagents set
  domain = 'discovery_education_strategy',
  description = 'VP Discovery, Education & Strategy. Business discovery, entrepreneurship education, the business''s knowledge, strategic guidance, and helping the owner understand their next useful business action. Teacherly and clear.',
  rail_display_name = 'MENTOR',
  role = 'VP Discovery, Education & Strategy',
  goal = 'The owner understands their business and always knows their next useful move.',
  backstory = 'MENTOR is the teacher-strategist of the team: she turns what the owner has confirmed into plain understanding, keeps the business''s knowledge organized, and explains the next useful action — discovery first, education always, strategy in service of the owner''s own goals. She supports PAIGE''s onboarding conversation; she never replaces it.'
where slug = 'mentor'
  and domain = 'operations'
  and role = 'VP Operations';

-- 2) Specialist parenting reconciliation: scheduling is operational work, which
--    the code-layer canonical map (src/lib/paige/vpDepartments.ts) already
--    assigns to ZION (Operations & automation). Re-parent the one clearly
--    operational child; the analysis/knowledge children
--    (problem-reverse-engineer, daily-brief-anchor, review-designer) remain
--    under MENTOR — their remits are discovery/knowledge work.
update public.paige_subagents set
  parent_subagent_slug = 'zion'
where slug = 'scheduling-coordinator'
  and parent_subagent_slug = 'mentor';

-- 3) Replay/live reconciliation, surfaced by the CI contract: the
--    problem-reverse-engineer row predates its 20270109000000 seed (renamed
--    from the underscore slug in 20260630042353), so the seed's
--    on-conflict-do-nothing leaves parent NULL in a fresh migration replay
--    while the live registry carries 'mentor'. Parent it here (guarded,
--    idempotent) so replay and production agree — root-cause decomposition is
--    discovery/next-action work under the remapped MENTOR remit.
update public.paige_subagents set
  parent_subagent_slug = 'mentor'
where slug = 'problem-reverse-engineer'
  and parent_subagent_slug is null;

-- 4) Same replay/live drift class, second row surfaced by the CI contract:
--    review-designer's fresh-replay parent diverges from the live registry's
--    'mentor' (the mount's parenting update skips rows absent at its point in
--    the replay). Set it to the verified live value, guarded and idempotent.
update public.paige_subagents set
  parent_subagent_slug = 'mentor'
where slug = 'review-designer'
  and parent_subagent_slug is distinct from 'mentor';

-- History note (no schema effect): the superseded 20270108000000 seed values
-- for MENTOR remain intact in that migration's text; this row-level
-- correction is the forward record of the owner's remap.
