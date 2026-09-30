-- THE RECEIPT SEAM LOST ITS LOCK TO AN OVERLOAD.
--
-- `public.record_capability_run` is the one write path into `paige_workspace_events`, a table
-- that is otherwise sealed: FORCE ROW LEVEL SECURITY, and `REVOKE ALL ... FROM PUBLIC,anon,
-- authenticated` (20261201000200:17-20). The SECURITY DEFINER functions are the ONLY way in.
-- That lockdown is the defence, and it is load-bearing.
--
-- The 6-argument signature was locked correctly, twice:
--   20261212000000:491-493  REVOKE ALL ... FROM PUBLIC,anon,authenticated; GRANT ... TO service_role
--   20261220000000:265-267  (identical, after a redefinition)
--
-- Then 20270107000000:94 created a TEN-argument overload — four optional trailing params for
-- correlation and detail. An overload is a NEW `pg_proc` entry, not a replacement, so it did not
-- inherit the older signature's ACL. That migration issues no GRANT and no REVOKE for it. Its one
-- ACL statement (:90) is for a different function, `_record_workspace_rail_event`.
--
-- With no ACL of its own, the new signature falls to PostgreSQL's default for functions:
-- EXECUTE TO PUBLIC. In this database PUBLIC includes `anon` and `authenticated`, and PostgREST
-- exposes `public`-schema functions to both. A caller supplying all ten named arguments binds to
-- this overload unambiguously, so the still-revoked 6-arg function does not shield it.
--
-- WHY NOTHING CAUGHT IT. The migration's own header says "existing grants and callers unchanged"
-- (20270107000000:23-24) — true of the existing grants, and irrelevant to the new function. The
-- §9/§37 guard `scripts/ci/definer-fn-lint.mjs` matches an EXPLICIT `GRANT ... TO anon|public`;
-- an implicit default grant is invisible to it. And name-level auditing reports this function as
-- ACL'd, because the NAME is — only a signature-level check surfaces it.
--
-- THAT BLIND SPOT IS NOW CLOSED, in `scripts/ci/definer-signature-acl.mjs`, which runs behind the
-- same `npm run lint:definer-fns` command. It is cross-file and signature-level: it fails any public
-- non-trigger SECURITY DEFINER function created after the last blanket sweep (20260629200234) that
-- carries no GRANT and no REVOKE anywhere in the corpus. Proven to bite on this exact defect —
-- remove this migration and the guard names `record_capability_run(uuid,uuid,text,text,uuid,text,
-- text,uuid,text,jsonb)` and exits 1. Its self-test covers the overload case specifically: granting
-- `f(uuid)` does not clear `f(uuid,text)`.
--
-- (An earlier draft of this header claimed the widening had already landed when it had not. That was
-- a promise stated as a fact, inside a migration whose whole subject is a claim that stopped being
-- true. Recorded rather than quietly overwritten.)
--
-- THE REPO ALREADY KNEW. 20261201000800:542-543, thirty-seven days earlier, on the sibling writer:
--   "LOAD-BEARING. DROP FUNCTION above discarded the ACL and the recreated function defaults to
--    PUBLIC EXECUTE. Without these two lines `anon` can reach the trusted service-caller branch."
--
-- WHAT THE BODY DOES NOT DO. It never calls `auth.uid()`. Its only caller-shaped check asks
-- whether the actor named in the argument is an active member of the tenant named in the argument
-- (20270107000000:133-138) — it constrains the SUBJECT, not the CALLER, and both values arrive
-- from the request. So an ungated caller who knows any active (tenant_id, user_id) pair could
-- write a receipt attributing any capability key, any outcome including `capability_succeeded`,
-- and up to 16KB of `_detail` — and `_record_workspace_rail_event` broadcasts the forged row to
-- that tenant's Rail subscribers live via `realtime.send`.
--
-- THE FIX IS THE GRANT, AND THAT IS THE RIGHT FIX HERE (§59). Normally "the grant is never the
-- guard" — but that rule is about functions reachable by `authenticated`, which must re-prove the
-- caller in-body (`record_rail_event` is granted to `authenticated` and therefore carries a full
-- `auth.uid()` + server-resolved-tenant guard, 20261201000800:399-447; it is the class-A model).
-- This function is service_role-only by design, matching the 6-arg posture that shipped and was
-- accepted. A service-role caller is trusted by construction and `auth.uid()` is NULL for it, so
-- an in-body auth check would refuse every legitimate caller. The grant IS the boundary here,
-- which is precisely why its absence was the hole. No in-body change is made.
--
-- SAFE WHICHEVER STATE PRODUCTION IS IN. Prod SQL access was not available to the session that
-- found this, so `pg_proc.proacl` was never read back; the finding rests on migration source plus
-- PostgreSQL's documented default plus the in-repo comment above confirming this team has observed
-- that default in this database. These two statements are correct either way — a no-op if the
-- signature is somehow already sealed, the fix if it is not. They are idempotent and re-runnable.
--
-- RENUMBERED TWICE, and the second time is the one worth reading.
--
-- (1) 20270411000000 -> 20270412000000 on 2026-09-24, when a base merge brought in
-- 20270411000000_paige_live_resume_admitted_state.sql at the same version. `schema_migrations` is
-- keyed on the version alone, so two files sharing one version means exactly one is ever applied —
-- and the loser is SKIPPED SILENTLY, with every gate still green. The other file reached `main`
-- first, so this one moved; the rule is never to renumber a migration that is already applied.
-- Caught by `lint:migration-versions` on the merge.
--
-- (2) 20270412000000 -> 20270416000000 on 2026-09-24, and this collision was with a branch, not
-- with `main`. `claude/agreements-blank-pdf` carries four migrations at 20270412 through 20270415,
-- the first of them 20270412000000_commercial_terms_refusals_reach_the_operator.sql. Neither branch
-- could see the other: `lint:migration-versions` resolves its base as `origin/main`
-- (scripts/ci/migration-version-collision-lint.mjs:97), so BOTH branches pass their own lint, both
-- merge cleanly because the filenames differ, and whichever lands second is silently skipped by
-- `supabase db push`. This file moved clear of their contiguous block rather than splitting it.
--
-- Recorded here because this migration's entire subject is a lock that looked applied and was not,
-- and shipping it under a version that would never run would have been the same defect twice. The
-- guard's blind spot to branch-vs-branch collisions is filed separately; it is a real gap and it
-- found this one by hand.

-- READBACK DONE, 2026-09-24, and it REVERSED the premise above. `pg_proc.proacl` on prod returns
-- `{postgres=X/postgres,service_role=X/postgres}` for the ten-argument signature. It is NOT open to
-- PUBLIC and it was not opened by anything in this repository: `20270107000000`, which created it,
-- carries no GRANT and no REVOKE, this migration is not applied, and 111 functions in `public` still
-- sit at `proacl = NULL`, so no blanket policy explains it. `20270411090000` (the lane that dropped
-- the six-arg) independently observed the same thing and says so in its own header: "stays
-- service_role-only. No grant is added here."
--
-- So this migration is NOT closing a live hole. Its job is REPRODUCIBILITY: prod carries an ACL that
-- the migration history cannot regenerate, so a rebuild from migrations alone would come up open.
-- Filed as the general case in #1427.

REVOKE ALL ON FUNCTION public.record_capability_run(
  uuid, uuid, text, text, uuid, text, text, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_capability_run(
  uuid, uuid, text, text, uuid, text, text, uuid, text, jsonb)
  TO service_role;

-- The six-argument signature is EXISTENCE-GUARDED, and that guard is load-bearing rather than
-- defensive. `20270411090000_one_record_capability_run_not_two.sql` DROPs it, and merged to main
-- while this branch was open. An unguarded REVOKE against a dropped function raises 42883 and takes
-- the whole deploy-migrations run down with it, so the earlier comment here -- "both signatures
-- still exist (no DROP FUNCTION for either appears in any migration)" -- is now false and is
-- replaced rather than left to mislead.
--
-- The lock is still asserted WHERE THE FUNCTION EXISTS, because merge order between the two branches
-- is not fixed: if this lands first the six-arg is still there and must be locked; if the other
-- lands first there is nothing to lock and this is correctly a no-op. Either order is safe.
DO $$
BEGIN
  IF to_regprocedure('public.record_capability_run(uuid, uuid, text, text, uuid, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.record_capability_run(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_capability_run(uuid, uuid, text, text, uuid, text) TO service_role';
  END IF;
END $$;
