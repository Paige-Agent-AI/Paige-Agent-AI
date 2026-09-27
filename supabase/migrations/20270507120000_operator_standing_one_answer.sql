-- Platform Operator shell, slice G1 — ONE server answer to "is this person an operator, and at
-- which tier", and one table-driven answer to "may this operator do X".
--
-- WHY. Before this migration "operator" had no single answer: four SQL helpers (two predicates
-- under four names), literal role checks in 113 migration files, about 60 edge-function gates in
-- four shapes, and client-side role lists. Some admitted platform_admin and some refused it, and
-- nobody had decided which was right. The owner's R0 ruling (2026-09-27) decides it; this table
-- records it, and every later gate derives from these two functions instead of keeping a list.
--
-- ADDITIVE ONLY. Nothing existing reads these yet. is_platform_owner / is_platform_admin /
-- is_platform_operator, every policy and every edge gate are untouched; they move onto this
-- answer in later slices (G2 client, G3 helpers, G4 edge), each one reviewed on its own.
--
-- THE DEFAULT RULE (R0). A capability with no row in platform_operator_capabilities is
-- super_admin only. A capability widens deliberately, by a migration adding or changing its row,
-- never by omission. That rule is enforced by operator_may() below and stated on the table.

CREATE TABLE public.platform_operator_capabilities (
  capability text PRIMARY KEY
    CHECK (capability ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  -- super_admin may every capability. This column is the only thing that varies by tier.
  platform_admin_may boolean NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  ruling text NOT NULL CHECK (length(btrim(ruling)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_operator_capabilities IS
  'What each platform operator tier may do (owner ruling R0, 2026-09-27). super_admin may every '
  'capability. platform_admin may a capability only where its row says platform_admin_may = true. '
  'DEFAULT RULE: a capability with no row here is super_admin only. A capability widens '
  'deliberately, by a migration that adds or changes its row, never by omission. Read through '
  'operator_may(); never keep a role list anywhere else.';
COMMENT ON COLUMN public.platform_operator_capabilities.platform_admin_may IS
  'Whether the delegated platform_admin tier may this capability. super_admin always may.';
COMMENT ON COLUMN public.platform_operator_capabilities.ruling IS
  'Who ruled this row and when. A row without a ruling does not belong in this table.';

ALTER TABLE public.platform_operator_capabilities ENABLE ROW LEVEL SECURITY;
-- No policies: nobody reads or writes the table directly. operator_may() reads it as its owner,
-- and a ruling changes it only through a migration.
REVOKE ALL ON TABLE public.platform_operator_capabilities FROM PUBLIC, anon, authenticated;

INSERT INTO public.platform_operator_capabilities (capability, platform_admin_may, description, ruling) VALUES
  ('console.enter', true,
   'Enter the Platform Operator console.',
   'R0, owner ruling 2026-09-27'),
  ('fleet.directory.read', true,
   'See every tenant''s name, status, kind and topology.',
   'R0, owner ruling 2026-09-27'),
  ('tenant.act_as', true,
   'Act as a tenant, audited on entry and exit.',
   'R0, owner ruling 2026-09-27'),
  ('platform.health.read', true,
   'See platform health, alerts and the systems check.',
   'R0, owner ruling 2026-09-27'),
  ('tenant.provision', true,
   'Provision a tenant.',
   'R0, owner ruling 2026-09-27'),
  ('tenant.status.set', true,
   'Change a tenant''s status.',
   'R0, owner ruling 2026-09-27'),
  ('billing.read', true,
   'See billing, MRR and revenue classification. Reading only; writing revenue classification is not granted.',
   'R0, owner ruling 2026-09-27'),
  ('capability.administer', true,
   'Administer capabilities and autonomy.',
   'R0, owner ruling 2026-09-27'),
  ('operator.seat.grant', false,
   'Grant an operator seat. The delegated tier can run the platform but cannot create another operator.',
   'R0, owner ruling 2026-09-27; CLAUDE.md §53'),
  ('operator.seat.revoke', false,
   'Revoke an operator seat.',
   'R0, owner ruling 2026-09-27; CLAUDE.md §53');

-- The one answer. Keyed on auth.uid() only: a caller learns their own standing and nobody
-- else's (§59). A caller who holds both roles is super_admin. A non-operator, and an anonymous
-- caller, get (NULL, NULL): acting_tenant_id is reported only to an operator, because it is only
-- an act-as for an operator.
CREATE FUNCTION public.operator_standing()
RETURNS TABLE (tier text, acting_tenant_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH standing AS (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM public.user_roles r
                   WHERE r.user_id = auth.uid() AND r.role::text = 'super_admin') THEN 'super_admin'
      WHEN EXISTS (SELECT 1 FROM public.user_roles r
                   WHERE r.user_id = auth.uid() AND r.role::text = 'platform_admin') THEN 'platform_admin'
    END AS tier
  )
  SELECT s.tier,
         CASE WHEN s.tier IS NOT NULL
              THEN (SELECT p.active_tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
         END
  FROM standing s;
$$;

COMMENT ON FUNCTION public.operator_standing() IS
  'The one server answer to "is the caller a platform operator, and at which tier" (super_admin, '
  'platform_admin, or NULL), plus the tenant they are acting as. Every operator gate derives from '
  'this or from operator_may(); none keeps its own role list.';

-- May the caller do this? super_admin: always. platform_admin: only where the capability's row
-- grants it — an unknown or misspelled capability is refused, which is the default rule.
-- Anyone else: never.
CREATE FUNCTION public.operator_may(_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE (SELECT s.tier FROM public.operator_standing() s)
    WHEN 'super_admin' THEN true
    WHEN 'platform_admin' THEN COALESCE(
      (SELECT c.platform_admin_may FROM public.platform_operator_capabilities c
       WHERE c.capability = _capability),
      false)
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.operator_may(text) IS
  'Whether the calling operator may the named capability, from platform_operator_capabilities. '
  'A capability with no row is super_admin only (R0 default rule).';

REVOKE ALL ON FUNCTION public.operator_standing() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operator_may(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_standing() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.operator_may(text) TO authenticated, service_role;
