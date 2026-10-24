-- MENTOR role remap contract (20271111000000) — verifies the forward-only
-- correction took the exact owner-directed shape, and reconciles a real
-- replay/live parenting drift it surfaced. Same isolated, rolled-back
-- pg_temp shim convention as its neighbor operations_scoped_task_creation.sql
-- (this proof runs through plain psql in the spine-contract job, where pgTAP
-- is not provisioned). Never customer data.
begin;
create function pg_temp.check_true(v boolean, label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %', label; end if;
raise notice 'PASS: %', label; end $$;

-- The remapped remit: discovery/education/strategy, EXP01-serving.
select pg_temp.check_true(
  (select domain from public.paige_subagents where slug = 'mentor') = 'discovery_education_strategy',
  'mentor domain remapped to the discovery/education/strategy tag');
select pg_temp.check_true(
  (select role from public.paige_subagents where slug = 'mentor') = 'VP Discovery, Education & Strategy',
  'mentor role label remapped');
select pg_temp.check_true(
  (select description from public.paige_subagents where slug = 'mentor') like 'VP Discovery, Education & Strategy.%',
  'mentor description carries the remapped remit');

-- No authority surface changed: the row stays display metadata in the same
-- runtime shape the mount seeded.
select pg_temp.check_true(
  (select enabled and runtime = 'soft' and display_order = 4
     from public.paige_subagents where slug = 'mentor'),
  'mentor runtime shape unchanged (soft, enabled, order 4)');

-- The clearly operational child re-parented to ZION per the code-layer
-- canonical operations owner; the knowledge/discovery children stay.
select pg_temp.check_true(
  (select parent_subagent_slug from public.paige_subagents where slug = 'scheduling-coordinator') = 'zion',
  'scheduling-coordinator parented under zion (operations)');
select pg_temp.check_true(
  (select parent_subagent_slug from public.paige_subagents where slug = 'problem-reverse-engineer') = 'mentor',
  'problem-reverse-engineer under mentor (replay/live drift reconciled by this migration)');
select pg_temp.check_true(
  (select parent_subagent_slug from public.paige_subagents where slug = 'daily-brief-anchor') = 'mentor',
  'daily-brief-anchor under mentor');
select pg_temp.check_true(
  (select parent_subagent_slug from public.paige_subagents where slug = 'review-designer') = 'mentor',
  'review-designer under mentor');

rollback;
