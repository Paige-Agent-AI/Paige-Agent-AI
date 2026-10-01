-- Assigned-staff relationships belong to exactly one tenant.
--
-- `coach_clients` records which staff member is assigned to which client. Its name predates the
-- platform's staff model; everything this migration introduces is named for what it is (an
-- assignee, a relationship) and the table itself is not renamed here.
--
-- After this migration:
--   * every relationship carries the tenant that holds the client;
--   * the client must be linked in that tenant — structurally, by a composite foreign key to
--     clients(tenant_id, linked_user_id);
--   * the assignee must qualify in that tenant (active member, or a manager of it through its
--     agency) — validated on every write by a trigger, because membership is not a key;
--   * losing that standing suspends the relationship and regaining it restores it, so nobody loses
--     assignments across a suspension (every dependent policy honours status = 'active');
--   * relationships are written only by the assignment path, never directly by a signed-in user;
--   * the helper's assignment branch and the invitations policy apply the same tenant rule.

-- Step 0: abort if the starting state is not the one this migration was written against. The only
-- relationship no client record can place is the recorded one, and it is self-assigned (removed in
-- step 3); every other relationship must resolve to exactly one tenant.
DO $$
DECLARE
  _unresolved int;
  _orphans int;
  _ambiguous int;
  _dup int;
BEGIN
  SELECT count(*) FILTER (WHERE cc.coach_user_id <> cc.client_user_id),
         count(*) FILTER (WHERE cc.coach_user_id = cc.client_user_id)
    INTO _unresolved, _orphans
    FROM public.coach_clients cc
   WHERE NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.linked_user_id = cc.client_user_id);
  IF _unresolved > 0 OR _orphans > 1 THEN
    RAISE EXCEPTION 'assigned-staff scope: % relationship(s) cannot be resolved to a tenant; re-derive this migration', _unresolved + _orphans;
  END IF;
  SELECT count(*) INTO _ambiguous FROM public.coach_clients cc
   WHERE (SELECT count(DISTINCT c.tenant_id) FROM public.clients c
           WHERE c.linked_user_id = cc.client_user_id) > 1;
  IF _ambiguous > 0 THEN
    RAISE EXCEPTION 'assigned-staff scope: % relationship(s) resolve to more than one tenant; re-derive this migration', _ambiguous;
  END IF;
  SELECT count(*) INTO _dup FROM (
    SELECT tenant_id, linked_user_id FROM public.clients
     WHERE linked_user_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) d;
  IF _dup > 0 THEN
    RAISE EXCEPTION 'assigned-staff scope: % duplicate (tenant_id, linked_user_id) pair(s) in clients', _dup;
  END IF;
END $$;

-- Step 1: the per-tenant client key the relationship references.
ALTER TABLE public.clients
  ADD CONSTRAINT clients_tenant_linked_user_key UNIQUE (tenant_id, linked_user_id);

-- Step 2: the tenant column, nullable while it is filled.
ALTER TABLE public.coach_clients
  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Step 3: the one recorded relationship no client record can place is removed, per owner ruling
-- (recorded in the Delivery Evidence Register before removal). Step 0 proved it is the only such
-- row and that it is self-assigned; absent (as on a replayed database) this removes nothing.
DELETE FROM public.coach_clients cc
 WHERE cc.coach_user_id = cc.client_user_id
   AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.linked_user_id = cc.client_user_id);

-- Step 4: fill the tenant from the client record.
UPDATE public.coach_clients cc
   SET tenant_id = c.tenant_id
  FROM public.clients c
 WHERE c.linked_user_id = cc.client_user_id
   AND cc.tenant_id IS NULL;

-- Step 5: 'suspended' is the status membership changes use, distinct from a deliberate 'inactive',
-- so restoring standing restores exactly what it suspended and nothing else.
ALTER TABLE public.coach_clients DROP CONSTRAINT coach_clients_status_check;
ALTER TABLE public.coach_clients ADD CONSTRAINT coach_clients_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'pending'::text, 'suspended'::text]));

-- Step 6: contract. Tenant required; client structurally linked in it; one relationship per
-- tenant, assignee and client.
ALTER TABLE public.coach_clients ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.coach_clients
  ADD CONSTRAINT coach_clients_client_linked_in_tenant_fkey
  FOREIGN KEY (tenant_id, client_user_id)
  REFERENCES public.clients (tenant_id, linked_user_id)
  ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.coach_clients DROP CONSTRAINT coach_clients_coach_user_id_client_user_id_key;
ALTER TABLE public.coach_clients
  ADD CONSTRAINT coach_clients_tenant_assignee_client_key UNIQUE (tenant_id, coach_user_id, client_user_id);

-- Step 7: who qualifies as an assignee in a tenant. One rule, used by the write check and by
-- every lifecycle refresh. Role-neutral: any active member, or a manager through the agency.
CREATE OR REPLACE FUNCTION public.tenant_assignee_qualifies(_tenant_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _tenant_id IS NOT NULL AND _user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.tenant_members m
             WHERE m.tenant_id = _tenant_id AND m.user_id = _user_id AND m.status = 'active')
    OR public.agency_can_manage_child(_tenant_id, _user_id)
  );
$$;
REVOKE ALL ON FUNCTION public.tenant_assignee_qualifies(uuid, uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.tenant_assignee_qualifies(uuid, uuid) IS
  'Whether a user may hold an assigned-staff relationship in a tenant: an active member, or a manager of it through its agency. Role-neutral. Used by the coach_clients write check and lifecycle refresh.';

-- Step 8: validate every active relationship on write.
CREATE OR REPLACE FUNCTION public.enforce_assigned_relationship_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'active' AND NOT public.tenant_assignee_qualifies(NEW.tenant_id, NEW.coach_user_id) THEN
    RAISE EXCEPTION 'ASSIGNEE_NOT_QUALIFIED: the assignee does not qualify in this tenant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_assigned_relationship_scope() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enforce_assigned_relationship_scope
  BEFORE INSERT OR UPDATE OF tenant_id, coach_user_id, client_user_id, status ON public.coach_clients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assigned_relationship_scope();

-- Step 9: keep relationships in step with standing. Suspends what no longer qualifies and restores
-- what qualifies again. Never deletes.
CREATE OR REPLACE FUNCTION public.refresh_assigned_relationships(_tenant_ids uuid[], _user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.coach_clients cc SET status = 'suspended', updated_at = now()
   WHERE cc.status = 'active'
     AND cc.tenant_id = ANY (_tenant_ids)
     AND (_user_id IS NULL OR cc.coach_user_id = _user_id)
     AND NOT public.tenant_assignee_qualifies(cc.tenant_id, cc.coach_user_id);
  UPDATE public.coach_clients cc SET status = 'active', updated_at = now()
   WHERE cc.status = 'suspended'
     AND cc.tenant_id = ANY (_tenant_ids)
     AND (_user_id IS NULL OR cc.coach_user_id = _user_id)
     AND public.tenant_assignee_qualifies(cc.tenant_id, cc.coach_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_assigned_relationships(uuid[], uuid) FROM PUBLIC, anon, authenticated;

-- Membership changes: the tenant itself, and the tenants it manages as an agency.
CREATE OR REPLACE FUNCTION public.refresh_assigned_relationships_on_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN _tenant := OLD.tenant_id; _user := OLD.user_id;
  ELSE _tenant := NEW.tenant_id; _user := NEW.user_id; END IF;
  PERFORM public.refresh_assigned_relationships(
    ARRAY(SELECT _tenant UNION SELECT t.id FROM public.tenants t WHERE t.parent_tenant_id = _tenant),
    _user);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_assigned_relationships_on_membership() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_refresh_assigned_relationships
  AFTER INSERT OR UPDATE OF status, role OR DELETE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.refresh_assigned_relationships_on_membership();

-- Agency team changes: the tenants that agency manages.
CREATE OR REPLACE FUNCTION public.refresh_assigned_relationships_on_agency_team()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _agency uuid; _user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN _agency := OLD.agency_tenant_id; _user := OLD.user_id;
  ELSE _agency := NEW.agency_tenant_id; _user := NEW.user_id; END IF;
  PERFORM public.refresh_assigned_relationships(
    ARRAY(SELECT t.id FROM public.tenants t WHERE t.parent_tenant_id = _agency),
    _user);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_assigned_relationships_on_agency_team() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_refresh_assigned_relationships
  AFTER INSERT OR UPDATE OF status, agency_role, scoped_subaccounts OR DELETE ON public.agency_team_members
  FOR EACH ROW EXECUTE FUNCTION public.refresh_assigned_relationships_on_agency_team();

-- Tenant structure changes: the tenant and the tenants beneath it.
CREATE OR REPLACE FUNCTION public.refresh_assigned_relationships_on_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.refresh_assigned_relationships(
    ARRAY(SELECT NEW.id UNION SELECT t.id FROM public.tenants t WHERE t.parent_tenant_id = NEW.id),
    NULL);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_assigned_relationships_on_tenant() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_refresh_assigned_relationships
  AFTER UPDATE OF parent_tenant_id, account_type ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.refresh_assigned_relationships_on_tenant();

-- Step 10: the assignment path writes the tenant, and an explicit reassignment re-activates.
CREATE OR REPLACE FUNCTION public.sync_assigned_coach_to_coach_clients()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.assigned_coach_user_id IS NOT NULL
     AND NEW.linked_user_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.assigned_coach_user_id IS DISTINCT FROM NEW.assigned_coach_user_id
       OR OLD.linked_user_id IS DISTINCT FROM NEW.linked_user_id
     )
  THEN
    INSERT INTO public.coach_clients (tenant_id, coach_user_id, client_user_id, status)
    VALUES (NEW.tenant_id, NEW.assigned_coach_user_id, NEW.linked_user_id, 'active')
    ON CONFLICT (tenant_id, coach_user_id, client_user_id)
      DO UPDATE SET status = 'active', updated_at = now()
      WHERE public.coach_clients.status <> 'active';
  END IF;
  RETURN NEW;
END;
$$;

-- Step 10b: clearing a client's link ends its relationships. (A relink is carried by the foreign
-- key's ON UPDATE CASCADE; an unlink cannot be, because a relationship without a client is not one.)
CREATE OR REPLACE FUNCTION public.end_assigned_relationships_on_unlink()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.linked_user_id IS NOT NULL AND NEW.linked_user_id IS NULL THEN
    DELETE FROM public.coach_clients
     WHERE tenant_id = OLD.tenant_id AND client_user_id = OLD.linked_user_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.end_assigned_relationships_on_unlink() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_end_assigned_relationships_on_unlink
  BEFORE UPDATE OF linked_user_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.end_assigned_relationships_on_unlink();

-- Step 11: the helper's assignment branch applies the same tenant rule.
CREATE OR REPLACE FUNCTION public.coach_can_access_user(_coach uuid, _user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coach_clients cc
    WHERE cc.coach_user_id = _coach AND cc.client_user_id = _user AND cc.status = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM public.clients c
    WHERE c.linked_user_id = _user
      AND public.tenant_assignee_qualifies(c.tenant_id, _coach)
      AND (
        c.assigned_coach_user_id = _coach
        OR EXISTS (
          SELECT 1 FROM public.paige_coach_assignments pca
          WHERE pca.contact_id = c.id AND pca.rep_user_id = _coach AND pca.active = true
            AND (pca.tenant_id IS NULL OR pca.tenant_id = c.tenant_id)
        )
      )
  );
$$;

-- Step 12: invitations are matched to an assignee only within the assignment's tenant.
ALTER POLICY "Coaches can read assigned client invitations" ON public.invitations
  USING (
    has_role(auth.uid(), 'coach'::app_role) AND EXISTS (
      SELECT 1
        FROM public.coach_clients cc
        JOIN public.clients c ON c.linked_user_id = cc.client_user_id AND c.tenant_id = cc.tenant_id
       WHERE cc.coach_user_id = auth.uid()
         AND cc.status = 'active'::text
         AND c.email = invitations.email
         AND c.tenant_id = invitations.tenant_id)
  );

-- Step 13: relationships are written only through assignment.
DROP POLICY IF EXISTS "Coaches can add clients" ON public.coach_clients;
DROP POLICY IF EXISTS "Coaches can update own clients" ON public.coach_clients;
REVOKE INSERT, UPDATE, DELETE ON public.coach_clients FROM anon, authenticated;

COMMENT ON TABLE public.coach_clients IS
  'Assigned-staff relationships. Each row belongs to one tenant: the client is linked in that tenant (composite FK to clients) and the assignee qualifies there (validated on write by tenant_assignee_qualifies). Rows are suspended, never deleted, when the assignee loses standing, and restored when it returns. Written only by the assignment path.';
