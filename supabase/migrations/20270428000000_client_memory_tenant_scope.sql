-- Client memory belongs to exactly one tenant.
--
-- `client_memory` holds what Paige remembers about a person and reads back into later
-- conversations. Until now a row was tied to a tenant only indirectly — through its client record
-- when it had one, otherwise through whichever tenant the person happened to belong to — so a
-- person who belongs to two tenants had their memory visible to both.
--
-- After this migration:
--   * every row carries the tenant it was written in;
--   * a row that names a client record takes that record's tenant and may take no other;
--   * otherwise it takes the signed-in writer's active tenant; with neither, it is refused;
--   * a row about a person without a client record may only sit in a tenant that person belongs to;
--   * a signed-in writer may only write into a tenant they act in;
--   * the tenant cannot be changed once written;
--   * admin and assignee access is limited to the row's tenant, and the admin policy no longer rests
--     on a global role that carries no tenant.
--
-- There is deliberately no fallback to "the person's own client record": that resolves only while
-- one person has at most one client record, a rule this platform is removing. A writer with no client
-- record and no active tenant must supply the tenant explicitly (the service-role writers do).

-- Step 0: abort unless every existing row resolves to exactly one tenant.
-- Existing rows are placed by their client record where they have one, otherwise by their subject's
-- single active membership. The membership source is a recorded deviation from the classification's
-- documented source (the client record): on 2026-09-26 no existing row had a client record, and every
-- subject had exactly one active membership.
DO $$
DECLARE _unplaceable int;
BEGIN
  SELECT count(*) INTO _unplaceable FROM public.client_memory m
   WHERE m.client_id IS NULL
     AND (SELECT count(DISTINCT tm.tenant_id) FROM public.tenant_members tm
           WHERE tm.user_id = m.client_user_id AND tm.status = 'active') <> 1;
  IF _unplaceable > 0 THEN
    RAISE EXCEPTION 'client memory scope: % row(s) cannot be placed in exactly one tenant; re-derive this migration', _unplaceable;
  END IF;
END $$;

-- Step 1: the tenant column, nullable while it is filled.
ALTER TABLE public.client_memory
  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Step 2: fill it.
UPDATE public.client_memory m
   SET tenant_id = c.tenant_id
  FROM public.clients c
 WHERE c.id = m.client_id AND m.tenant_id IS NULL;
UPDATE public.client_memory m
   SET tenant_id = tm.tenant_id
  FROM public.tenant_members tm
 WHERE m.client_id IS NULL AND m.tenant_id IS NULL
   AND tm.user_id = m.client_user_id AND tm.status = 'active';

ALTER TABLE public.client_memory ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX client_memory_tenant_id_idx ON public.client_memory (tenant_id);
COMMENT ON COLUMN public.client_memory.tenant_id IS
  'The tenant this memory was written in. Filled from the client record or the signed-in writer''s active tenant; validated on write; immutable.';

-- Step 3: fill, validate and fix the tenant on every write.
CREATE OR REPLACE FUNCTION public.enforce_client_memory_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _client_tenant uuid;
  _caller uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'MEMORY_TENANT_IMMUTABLE: a memory''s tenant cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    SELECT c.tenant_id INTO _client_tenant FROM public.clients c WHERE c.id = NEW.client_id;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(_client_tenant,
                              CASE WHEN _caller IS NOT NULL THEN public.current_user_tenant_id() END);
  END IF;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'MEMORY_TENANT_UNRESOLVED: no client record or active tenant to place this memory in'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    IF _client_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'MEMORY_TENANT_MISMATCH: a memory takes its client record''s tenant'
        USING ERRCODE = '23514';
    END IF;
  ELSIF (TG_OP = 'INSERT' OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id
         OR NEW.client_id IS DISTINCT FROM OLD.client_id)
        AND NOT (public.tenant_assignee_qualifies(NEW.tenant_id, NEW.client_user_id)
             OR EXISTS (SELECT 1 FROM public.clients c
                         WHERE c.tenant_id = NEW.tenant_id AND c.linked_user_id = NEW.client_user_id)) THEN
    RAISE EXCEPTION 'MEMORY_SUBJECT_NOT_IN_TENANT: the person this memory is about does not belong to its tenant'
      USING ERRCODE = '23514';
  END IF;

  -- Standing is checked where a row is placed, not on every later edit: maintenance (deactivation,
  -- re-embedding, deletion processing) must keep working after a person leaves the tenant.
  IF TG_OP = 'INSERT' AND _caller IS NOT NULL
     AND NOT public.tenant_assignee_qualifies(NEW.tenant_id, _caller)
     AND NOT public.is_platform_operator()
     AND NOT (_caller = NEW.client_user_id
              AND EXISTS (SELECT 1 FROM public.clients c
                           WHERE c.tenant_id = NEW.tenant_id AND c.linked_user_id = _caller)) THEN
    RAISE EXCEPTION 'MEMORY_WRITER_NOT_IN_TENANT: the writer does not act in this memory''s tenant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_client_memory_tenant() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_enforce_client_memory_tenant
  BEFORE INSERT OR UPDATE ON public.client_memory
  FOR EACH ROW EXECUTE FUNCTION public.enforce_client_memory_tenant();

-- Step 4: access follows the row's tenant.
-- The restrictive policy: a row is reachable in its own tenant, by the person it is about, or by a
-- platform operator. This replaces two indirect derivations (through the client record, or through
-- the subject's membership of the caller's tenant) that let a person's memory in one tenant surface
-- in any other tenant they belonged to.
ALTER POLICY tenant_isolation ON public.client_memory
  USING (is_platform_operator() OR tenant_id = current_user_tenant_id() OR client_user_id = auth.uid())
  WITH CHECK (is_platform_operator() OR tenant_id = current_user_tenant_id() OR client_user_id = auth.uid());

-- The admin policy rested on a global role with no tenant; it now rests on administering the row's
-- tenant (directly or through its agency), or on platform operation.
ALTER POLICY "Admins have full access to client_memory" ON public.client_memory
  USING (is_platform_operator() OR is_tenant_admin(tenant_id) OR agency_can_manage_child(tenant_id));

-- Assignees reach a client's memory only within the tenant that holds the assignment.
ALTER POLICY "Coaches can view assigned client memory" ON public.client_memory
  USING (EXISTS (SELECT 1 FROM public.coach_clients cc
                  WHERE cc.coach_user_id = auth.uid() AND cc.client_user_id = client_memory.client_user_id
                    AND cc.tenant_id = client_memory.tenant_id AND cc.status = 'active'::text));
ALTER POLICY "Coaches can update assigned client memory" ON public.client_memory
  USING (EXISTS (SELECT 1 FROM public.coach_clients cc
                  WHERE cc.coach_user_id = auth.uid() AND cc.client_user_id = client_memory.client_user_id
                    AND cc.tenant_id = client_memory.tenant_id AND cc.status = 'active'::text));
ALTER POLICY "Coaches can insert memory for assigned clients" ON public.client_memory
  WITH CHECK (EXISTS (SELECT 1 FROM public.coach_clients cc
                       WHERE cc.coach_user_id = auth.uid() AND cc.client_user_id = client_memory.client_user_id
                         AND cc.tenant_id = client_memory.tenant_id AND cc.status = 'active'::text));
