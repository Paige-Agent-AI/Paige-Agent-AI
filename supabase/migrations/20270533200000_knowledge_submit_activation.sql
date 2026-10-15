-- Activate the Knowledge publication submit seam for authenticated callers.
--
-- Prerequisite is met and live: the native worker adoption (20270533100000) drives
-- knowledge-publish work start->embed->stage->complete, submit itself wakes the worker at
-- creation, and recover requeues missed wakes / reconciles lost acknowledgements — all
-- production-verified. The fake-provider worker contract is pinned by
-- src/__tests__/knowledge-publication-worker.test.ts (14 tests, mutation-checked).
--
-- submit stays a JWT-caller RPC per the packet contract: PostgreSQL derives the actor from
-- the caller's session (auth.uid()) and re-checks tenant authority inside the function
-- (lock_knowledge_extraction_authority: real user + tenant + membership + user_roles +
-- selected active tenant + knowledge_actor_authorized). There is no caller-actor parameter
-- and no service-role impersonation path. start/stage/complete/settle/recover remain
-- service-only worker seams; anon and PUBLIC stay revoked.

GRANT EXECUTE ON FUNCTION public.submit_tenant_knowledge_publication(uuid,uuid,uuid,integer,uuid,text) TO authenticated;
