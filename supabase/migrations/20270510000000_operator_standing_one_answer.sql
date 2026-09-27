-- Platform Operator shell, slice G1 — ONE server answer to "is this person an operator, and at
-- which tier", and one DATA-DRIVEN answer to "may this operator do X".
--
-- WHY. Before this migration "operator" had no single answer: four SQL helpers (two predicates
-- under four names), literal role checks in 113 migration files, about 60 edge-function gates in
-- four shapes, and client-side role lists. Some admitted platform_admin and some refused it, and
-- nobody had decided which was right. The owner's R0 ruling (2026-09-27, revised the same day)
-- decides it; these tables record it, and every later gate derives from the two functions below
-- instead of keeping a list.
--
-- DATA, NEVER CODE — a stated future requirement, not a hypothetical. The owner will configure
-- operator role access himself later, so adding a role, re-ranking one, or granting or withdrawing
-- a capability is an INSERT/UPDATE on these tables, never a code change or rebuild:
--   platform_operator_roles             which roles are operator tiers, their rank, and whether a
--                                       role holds capabilities that are not (yet) in the catalogue
--   platform_operator_capabilities      the catalogue of named operator capabilities
--   platform_operator_role_capabilities which role holds which capability
-- operator_standing() and operator_may() contain no role name and no capability name.
--
-- THE DEFAULT RULE (R0), AS DATA. A capability not in the catalogue is held only by a role whose
-- holds_unlisted flag is true — today, super_admin alone. A capability in the catalogue is held
-- only by the roles it is granted to. So anything unruled is super_admin only, and a capability
-- widens deliberately, by a row, never by omission.
--
-- ADDITIVE ONLY. Nothing existing reads these yet. is_platform_owner / is_platform_admin /
-- is_platform_operator, every policy and every edge gate are untouched in this slice; they move
-- onto this answer in G2 (client), G3 (helpers) and G4 (edge), and each of those slices deletes
-- what it replaces.

-- ── Roles ────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_operator_roles (
  role text PRIMARY KEY CHECK (role ~ '^[a-z][a-z0-9_]*$'),
  -- Higher outranks lower. The seat slice uses it for "grant peers and below, never above".
  rank integer NOT NULL UNIQUE CHECK (rank > 0),
  -- Holds every capability that is not in the catalogue (the R0 default rule).
  holds_unlisted boolean NOT NULL DEFAULT false,
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  ruling text NOT NULL CHECK (length(btrim(ruling)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_operator_roles IS
  'The platform operator tiers, as data. A role listed here is an operator role; the caller''s tier '
  'is the highest-ranked listed role they hold. holds_unlisted = true means the role holds every '
  'capability not in platform_operator_capabilities — the R0 default rule that anything unruled is '
  'super_admin only. Adding or re-ranking an operator role is a row change, never a code change.';

-- ── Capability catalogue ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_operator_capabilities (
  capability text PRIMARY KEY
    CHECK (capability ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  ruling text NOT NULL CHECK (length(btrim(ruling)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_operator_capabilities IS
  'The named platform operator capabilities (owner ruling R0, 2026-09-27, revised the same day). '
  'DEFAULT RULE: a capability with no row here is held only by an operator role whose '
  'holds_unlisted is true (super_admin). A capability listed here is held only by the roles '
  'platform_operator_role_capabilities grants it to. A capability widens deliberately, by a row, '
  'never by omission. Read through operator_may(); never keep a role list anywhere else.';

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_operator_role_capabilities (
  role text NOT NULL REFERENCES public.platform_operator_roles(role) ON DELETE CASCADE,
  capability text NOT NULL REFERENCES public.platform_operator_capabilities(capability) ON DELETE CASCADE,
  ruling text NOT NULL CHECK (length(btrim(ruling)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, capability)
);

COMMENT ON TABLE public.platform_operator_role_capabilities IS
  'Which operator role holds which listed capability. A listed capability no role is granted is '
  'held by nobody except a holds_unlisted role. Granting or withdrawing is a row change.';

-- No policies and no grants on any of the three: nobody reads or writes them directly, service_role
-- included. The functions below read them as their owner.
ALTER TABLE public.platform_operator_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_operator_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_operator_role_capabilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_operator_roles FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.platform_operator_capabilities FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.platform_operator_role_capabilities FROM PUBLIC, anon, authenticated, service_role;

-- ── The R0 ruling, as rows ───────────────────────────────────────────────────────────────────
INSERT INTO public.platform_operator_roles (role, rank, holds_unlisted, description, ruling) VALUES
  ('super_admin', 100, true,
   'The platform owner tier. Holds every capability, listed or not.',
   'R0, owner ruling 2026-09-27; CLAUDE.md §53'),
  ('platform_admin', 50, false,
   'The delegated operator tier. Holds the capabilities granted to it and nothing else.',
   'R0, owner ruling 2026-09-27; CLAUDE.md §53')
ON CONFLICT (role) DO NOTHING;

INSERT INTO public.platform_operator_capabilities (capability, description, ruling) VALUES
  ('console.enter', 'Enter the Platform Operator console.', 'R0, owner ruling 2026-09-27'),
  ('fleet.directory.read', 'See every tenant''s name, status, kind and topology.', 'R0, owner ruling 2026-09-27'),
  ('tenant.act_as', 'Act as a tenant, audited on entry and exit.', 'R0, owner ruling 2026-09-27'),
  ('platform.health.read', 'See platform health, alerts and the systems check.', 'R0, owner ruling 2026-09-27'),
  ('tenant.provision', 'Provision a tenant.', 'R0, owner ruling 2026-09-27'),
  ('tenant.status.set', 'Change a tenant''s status.', 'R0, owner ruling 2026-09-27'),
  ('billing.read',
   'See billing, MRR and revenue classification. Reading only; writing revenue classification is not listed.',
   'R0, owner ruling 2026-09-27'),
  ('capability.administer',
   'Administer capabilities and autonomy within the ceiling. Raising posture above the ceiling and renewing a rung are listed separately.',
   'R0, owner ruling 2026-09-27'),
  ('operator.seat.platform_admin.grant', 'Grant a platform_admin seat.', 'R0 revised, owner ruling 2026-09-27'),
  ('operator.seat.platform_admin.revoke', 'Revoke a platform_admin seat.', 'R0 revised, owner ruling 2026-09-27'),
  ('operator.seat.super_admin.grant',
   'Grant a super_admin seat. Nobody below super_admin may mint an account equal to the owner''s.',
   'R0 revised, owner ruling 2026-09-27; CLAUDE.md §53 as superseded by it'),
  ('operator.seat.super_admin.revoke', 'Revoke a super_admin seat.',
   'R0 revised, owner ruling 2026-09-27; CLAUDE.md §53 as superseded by it'),
  -- G3 decision packet, ruled 2026-09-27 (owner): a platform_admin MAY raise the posture above the
  -- ceiling, and only super_admin may re-attest. A raise is capped at 24 hours; re-attesting is what
  -- would turn that cap into no cap, so keeping it at the top makes the 24 hours a real ceiling.
  -- Lowering is not listed: any operator may lower, as today.
  ('autonomy.posture.raise', 'Raise the daily autonomy posture above the ceiling, for at most 24 hours.',
   'G3 decision 1, owner ruling 2026-09-27; CLAUDE.md §67'),
  ('autonomy.rung.renew', 'Re-attest (renew) platform authority, extending a raise beyond its cap.',
   'G3 decision 1, owner ruling 2026-09-27; CLAUDE.md §68'),
  -- G3 decision 2, owner ruling 2026-09-27: the standing bird's-eye view across every customer
  -- (seats, client counts, revenue class in the directory) is a different act from entering one
  -- customer with your name on the audit row. Listed, and granted to nobody below super_admin:
  -- switched off, so widening it later is one row, never a rebuild.
  ('fleet.directory.detail', 'See seats, client counts and revenue class across the whole fleet directory.',
   'G3 decision 2, owner ruling 2026-09-27'),
  -- G3 decision 6, owner ruling 2026-09-27: inside an entered tenant both tiers hold the same
  -- powers, every act audited. Withdrawing this row from a tier makes that tier read-only inside
  -- tenants.
  ('tenant.act_as.write', 'Inside an entered tenant, act with that tenant administrator''s powers; every act audited.',
   'G3 decision 6, owner ruling 2026-09-27')
ON CONFLICT (capability) DO NOTHING;

-- super_admin holds everything through holds_unlisted AND through explicit rows for every listed
-- capability, so the owner's tier never depends on a flag alone and reads plainly in the table.
INSERT INTO public.platform_operator_role_capabilities (role, capability, ruling)
SELECT 'super_admin', c.capability, 'R0, owner ruling 2026-09-27'
FROM public.platform_operator_capabilities c
ON CONFLICT (role, capability) DO NOTHING;

INSERT INTO public.platform_operator_role_capabilities (role, capability, ruling) VALUES
  ('platform_admin', 'console.enter', 'R0, owner ruling 2026-09-27'),
  ('platform_admin', 'fleet.directory.read', 'R0, owner ruling 2026-09-27'),
  ('platform_admin', 'tenant.act_as', 'R0, owner ruling 2026-09-27'),
  ('platform_admin', 'platform.health.read', 'R0, owner ruling 2026-09-27'),
  ('platform_admin', 'tenant.provision', 'R0, owner ruling 2026-09-27'),
  ('platform_admin', 'tenant.status.set', 'R0, owner ruling 2026-09-27'),
  ('platform_admin', 'billing.read', 'R0, owner ruling 2026-09-27'),
  ('platform_admin', 'capability.administer', 'R0, owner ruling 2026-09-27'),
  ('platform_admin', 'operator.seat.platform_admin.grant', 'R0 revised, owner ruling 2026-09-27'),
  ('platform_admin', 'operator.seat.platform_admin.revoke', 'R0 revised, owner ruling 2026-09-27'),
  ('platform_admin', 'autonomy.posture.raise', 'G3 decision 1, owner ruling 2026-09-27'),
  ('platform_admin', 'tenant.act_as.write', 'G3 decision 6, owner ruling 2026-09-27')
ON CONFLICT (role, capability) DO NOTHING;

-- ── The one answer ───────────────────────────────────────────────────────────────────────────
-- Keyed on auth.uid() only: a caller learns their own standing and nobody else's (§59). The tier
-- is the highest-ranked operator role the caller holds. A non-operator, and a caller with no
-- subject, get (NULL, NULL, false).
--
-- holds_unlisted is that tier's flag from platform_operator_roles: the owner tier, which holds
-- every capability. Reported so no client has to name the owner role to recognise it — the owner
-- tier is data here like everything else.
--
-- active_tenant_id is the operator's session scope: profiles.active_tenant_id, the value every
-- query in the app is scoped by. For an operator a set value means acting inside that tenant. It
-- is reported only to an operator. It is NOT proof that the audited act-as set it: until slice A2
-- refuses direct writes, the sign-in reset and guard_active_tenant_membership's operator arm can
-- still change it without an audit row. It is named for what it is, not for what A2 will make it.
CREATE OR REPLACE FUNCTION public.operator_standing()
RETURNS TABLE (tier text, active_tenant_id uuid, holds_unlisted boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH top AS (
    SELECT o.role, o.holds_unlisted
    FROM public.user_roles r
    JOIN public.platform_operator_roles o ON o.role = r.role::text
    WHERE r.user_id = auth.uid()
    ORDER BY o.rank DESC
    LIMIT 1
  )
  SELECT t.role,
         CASE WHEN t.role IS NOT NULL
              THEN (SELECT p.active_tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
         END,
         COALESCE(t.holds_unlisted, false)
  FROM (SELECT 1) one LEFT JOIN top t ON true;
$$;

COMMENT ON FUNCTION public.operator_standing() IS
  'The one server answer to "is the caller a platform operator, and at which tier" (the highest-'
  'ranked platform_operator_roles role they hold, or NULL), plus, for an operator, the tenant '
  'their session is scoped to. Every operator gate derives from this or from operator_may(); none '
  'keeps its own role list.';

-- May the caller do this? Entirely from the tables: the caller holds an operator role that is
-- granted the capability, or the capability is not listed and one of their operator roles holds
-- unlisted capabilities. A NULL capability: never, for anyone (a caller bug must not admit). An
-- unknown, misspelled or wrong-case capability is unlisted, so only a holds_unlisted role holds it.
-- In a policy, call it as (SELECT public.operator_may('...')) so it runs once per statement.
CREATE OR REPLACE FUNCTION public.operator_may(_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT _capability IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_roles r
    JOIN public.platform_operator_roles o ON o.role = r.role::text
    WHERE r.user_id = auth.uid()
      AND (
        EXISTS (SELECT 1 FROM public.platform_operator_role_capabilities g
                WHERE g.role = o.role AND g.capability = _capability)
        OR (o.holds_unlisted
            AND NOT EXISTS (SELECT 1 FROM public.platform_operator_capabilities c
                            WHERE c.capability = _capability))
      )
  );
$$;

COMMENT ON FUNCTION public.operator_may(text) IS
  'Whether the caller holds the named operator capability, read entirely from '
  'platform_operator_roles / _capabilities / _role_capabilities. An unlisted capability is held '
  'only by a holds_unlisted role (R0 default rule: super_admin only).';

REVOKE ALL ON FUNCTION public.operator_standing() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operator_may(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_standing() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.operator_may(text) TO authenticated, service_role;
