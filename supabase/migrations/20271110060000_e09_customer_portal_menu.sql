-- E09 Slice M: per-tenant customer portal menu.
--
-- Two restatements, two small new functions and one catalogue row. No table, column, policy, index or
-- trigger is added, and no existing grant is widened.
--
-- 1. get_client_portal_config() — the customer's read — additionally returns `_catalog`, the
--    server-authored inputs the portal needs to build THIS tenant's menu catalog (the starter slug,
--    whether the tenant's authored Playbook is usable, and its portal module {key,label} list). A
--    customer is not a tenant member, so RLS denies their direct read of `tenants` and their
--    catalog has always fallen back to the generic default (§57 drift). `_catalog` is concatenated
--    LAST so a key a tenant once stored under that name can never shadow the server's projection,
--    and it carries no persona, intake, probing or other Playbook field.
-- 2. set_tenant_portal_config(uuid,jsonb) — the one writer — validates the shape of every module
--    overlay entry before the merge, reserves `_catalog`, keeps Home and Messages always on and
--    unrenamed (owner ruling 2026-10-18), refuses a name carrying a control, bidi-override/isolate or
--    zero-width character, and stores labels trimmed. Authority (the double
--    can_manage_tenant_brand check around FOR UPDATE), the shallow merge, the assistant deep-merge,
--    the owner and the ACL are unchanged.
--
-- 3. portal_menu_catalog(jsonb) — NEW, pure (IMMUTABLE, reads no table): the ONE definition of the
--    `_catalog` projection, used by both readers so the customer and the owner can never disagree.
-- 4. read_tenant_portal_menu(uuid) — NEW, SECURITY INVOKER: the owner's read of their own current
--    business's stored menu overlay plus the same `_catalog`, for Paige (client.portal_menu_read) and
--    for her readback after a write. Runs under tenants RLS and re-proves the current workspace and
--    can_manage_tenant_brand in its body; it returns nothing else from `features`.
-- 5. list_tool_autonomy — metadata only (the 20271110030000 wrapper pattern): portal_menu_update
--    becomes a catalogue row the owner can see and switch off.
--
-- The two restated functions are leased against the exact source they replace (production and the replayed schema agree:
-- md5(prosrc) 8d25fdaab326be70ba5e9556dbdfa39d and dbdcbdfc702339db5a643dc373d7e985, read
-- 2026-10-18), so a concurrent restatement fails this migration loudly instead of being overwritten.
--
-- Stored data stays valid: the production overlay holds key/visible/order only, Home visible, and no
-- labels (SELECT-only aggregate, 2026-10-18). The only producer (src/hooks/usePortalConfig.ts) sends
-- that shape, an `assistant` object or `welcome`.
BEGIN;
DO $source_lease$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.get_client_portal_config()')
      AND md5(p.prosrc)='8d25fdaab326be70ba5e9556dbdfa39d'
      AND pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef AND p.provolatile='s'
      AND p.proconfig=ARRAY['search_path=public, pg_temp']::text[]
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
      AND cardinality(p.proacl)=2
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
        WHERE a.grantor<>p.proowner OR a.is_grantable OR a.privilege_type<>'EXECUTE'
          OR a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='authenticated')))
  ) THEN
    RAISE EXCEPTION 'Customer portal configuration read changed; review before composition'
      USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.set_tenant_portal_config(uuid,jsonb)')
      AND md5(p.prosrc)='dbdcbdfc702339db5a643dc373d7e985'
      AND pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef AND p.proconfig=ARRAY['search_path=public']::text[]
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
      AND cardinality(p.proacl)=2
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
        WHERE a.grantor<>p.proowner OR a.is_grantable OR a.privilege_type<>'EXECUTE'
          OR a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='authenticated')))
  ) THEN
    RAISE EXCEPTION 'Portal configuration source changed; review before composition'
      USING ERRCODE='42501';
  END IF;
END $source_lease$;

-- ── 3. The one `_catalog` projection ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.portal_menu_catalog(_features jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT jsonb_build_object(
    'slug', CASE WHEN jsonb_typeof(_features->'playbook')='string' THEN left(_features->>'playbook', 80) END,
    -- Exactly coercePlaybook's non-null test (src/lib/playbook/resolve.ts).
    'authored_usable', COALESCE(
         jsonb_typeof(_features->'playbook_config')='object'
     AND jsonb_typeof(_features#>'{playbook_config,persona}')='object'
     AND jsonb_typeof(_features#>'{playbook_config,persona,name}')='string'
     AND jsonb_typeof(_features#>'{playbook_config,persona,greeting}')='string', false),
    -- {key,label} only, both strings, authored order, at most 40 entries of at most 80 characters.
    'modules', CASE WHEN jsonb_typeof(_features#>'{playbook_config,portal,modules}')='array' THEN (
       SELECT COALESCE(jsonb_agg(jsonb_build_object('key', x.k, 'label', x.l) ORDER BY x.ord), '[]'::jsonb)
       FROM (
         SELECT left(m->>'key', 80) AS k, left(m->>'label', 80) AS l, ord
         FROM jsonb_array_elements(_features#>'{playbook_config,portal,modules}') WITH ORDINALITY AS e(m, ord)
         WHERE jsonb_typeof(m)='object'
           AND jsonb_typeof(m->'key')='string' AND jsonb_typeof(m->'label')='string'
         ORDER BY ord
         LIMIT 40
       ) x
     ) END
  );
$$;
-- Pure over its argument; no table is read, so executing it grants nothing.
REVOKE ALL ON FUNCTION public.portal_menu_catalog(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_menu_catalog(jsonb) TO authenticated;
COMMENT ON FUNCTION public.portal_menu_catalog(jsonb) IS
  'Pure projection of a tenant features object to the customer portal menu catalog inputs (starter slug, authored-Playbook usability, portal module key/label list). Reads no table.';

-- ── 1. The customer's read ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_client_portal_config()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT c.tenant_id AS tid
    FROM public.clients c
    WHERE c.id = public.client_portal_relationship_id()
  )
  SELECT COALESCE(
    (SELECT
       -- Stored presentation first; the server's `_catalog` LAST, so it always wins.
       (CASE WHEN jsonb_typeof(t.features->'portal_config')='object'
             THEN t.features->'portal_config' ELSE '{}'::jsonb END)
       || jsonb_build_object('_catalog', public.portal_menu_catalog(t.features))
     FROM public.tenants t
     JOIN me ON me.tid = t.id),
    '{}'::jsonb
  );
$$;
REVOKE ALL ON FUNCTION public.get_client_portal_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_portal_config() TO authenticated;
COMMENT ON FUNCTION public.get_client_portal_config() IS
  'Presentation-only overlay from the canonical active client relationship, plus a server-authored _catalog (starter slug, authored-Playbook usability, portal module key/label list; nothing else from the Playbook). Ambiguous relationships refuse; this overlay never grants module/record authority.';

-- ── 2. The one writer ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_tenant_portal_config(_tenant_id uuid, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _current jsonb; _merged jsonb; _assistant jsonb; _m jsonb; _keys text[] := '{}'; _clean jsonb := '[]'::jsonb; _label text;
BEGIN
  IF _patch IS NULL OR jsonb_typeof(_patch)<>'object' THEN
    RAISE EXCEPTION 'portal config patch must be a JSON object' USING ERRCODE='22023';
  END IF;
  -- `_catalog` is the read's server-authored key; a tenant can never store its own.
  IF _patch ? '_catalog' THEN
    RAISE EXCEPTION 'invalid_portal_config' USING ERRCODE='22023';
  END IF;
  IF _patch ? 'modules' THEN
    IF jsonb_typeof(_patch->'modules')<>'array' OR jsonb_array_length(_patch->'modules')>40 THEN
      RAISE EXCEPTION 'invalid_portal_config' USING ERRCODE='22023';
    END IF;
    FOR _m IN SELECT e FROM jsonb_array_elements(_patch->'modules') e LOOP
      IF jsonb_typeof(_m)<>'object'
         OR jsonb_typeof(_m->'key') IS DISTINCT FROM 'string'
         OR (_m->>'key') !~ '^[a-z0-9_-]{1,40}$'
         OR (_m->>'key') = ANY(_keys)
         OR EXISTS (SELECT 1 FROM jsonb_object_keys(_m) k WHERE k NOT IN ('key','visible','order','label'))
         OR (_m ? 'visible' AND jsonb_typeof(_m->'visible')<>'boolean')
         -- CASE, not OR: the numeric cast must only ever see a JSON number.
         OR (_m ? 'order' AND CASE WHEN jsonb_typeof(_m->'order')='number'
               THEN (_m->>'order')::numeric NOT BETWEEN 0 AND 1000 ELSE true END)
         OR (_m ? 'label' AND jsonb_typeof(_m->'label')<>'string')
      THEN
        RAISE EXCEPTION 'invalid_portal_config' USING ERRCODE='22023';
      END IF;
      -- Home and Messages are always on and keep their names (owner ruling 2026-10-18). A stored
      -- {key, visible:true, order} for them stays valid, as production holds today.
      IF (_m->>'key') IN ('home','messages')
         AND (_m->'visible' = 'false'::jsonb OR _m ? 'label') THEN
        RAISE EXCEPTION 'invalid_portal_config' USING ERRCODE='22023';
      END IF;
      IF _m ? 'label' THEN
        _label := btrim(_m->>'label');
        -- No control character (C0, DEL, C1), and none of the invisible characters that change how a
        -- name reads without being seen: zero-width space/non-joiner/joiner, the left-to-right and
        -- right-to-left marks, the bidi embedding/override controls U+202A-U+202E, the word joiner, the
        -- bidi isolates U+2066-U+2069 and the byte-order mark. The same set as the chat executor's
        -- LABEL_FORBIDDEN (_shared/client-portal-menu.ts).
        IF char_length(_label) NOT BETWEEN 1 AND 40 OR _label ~ '[[:cntrl:]]'
           OR _label ~ '[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]' THEN
          RAISE EXCEPTION 'invalid_portal_config' USING ERRCODE='22023';
        END IF;
        _m := jsonb_set(_m, '{label}', to_jsonb(_label));
      END IF;
      _keys := _keys || (_m->>'key');
      _clean := _clean || jsonb_build_array(_m);
    END LOOP;
    _patch := jsonb_set(_patch, '{modules}', _clean);
  END IF;
  IF NOT public.can_manage_tenant_brand(_tenant_id) THEN
    RAISE EXCEPTION 'portal_config_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(features->'portal_config','{}'::jsonb) INTO _current
    FROM public.tenants WHERE id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant % not found',_tenant_id USING ERRCODE='P0002';
  END IF;
  -- Recheck after waiting for the canonical row, before changing saved state.
  IF NOT public.can_manage_tenant_brand(_tenant_id) THEN
    RAISE EXCEPTION 'portal_config_forbidden' USING ERRCODE='42501';
  END IF;
  _merged := _current || _patch;
  IF jsonb_typeof(_patch->'assistant')='object' THEN
    _assistant := CASE WHEN jsonb_typeof(_current->'assistant')='object'
      THEN _current->'assistant' ELSE '{}'::jsonb END;
    _merged := jsonb_set(_merged,'{assistant}',_assistant || (_patch->'assistant'),true);
  END IF;
  UPDATE public.tenants SET features=COALESCE(features,'{}'::jsonb)
    || jsonb_build_object('portal_config',_merged) WHERE id=_tenant_id;
  RETURN _merged;
END $$;
-- CREATE OR REPLACE retains the existing owner and exact authenticated-only ACL.

-- ── 4. The owner's read of their own business's menu ──────────────────────────────────────────
-- SECURITY INVOKER: tenants RLS applies on top of the in-body checks. The tenant is the caller's
-- CURRENT workspace, named explicitly so a workspace switch mid-request refuses instead of answering
-- for the other business.
CREATE OR REPLACE FUNCTION public.read_tenant_portal_menu(p_expected_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE _features jsonb; _cfg jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE='42501';
  END IF;
  IF p_expected_tenant_id IS NULL OR p_expected_tenant_id IS DISTINCT FROM public.current_user_tenant_id() THEN
    RAISE EXCEPTION 'portal_config_forbidden' USING ERRCODE='42501';
  END IF;
  IF NOT public.can_manage_tenant_brand(p_expected_tenant_id) THEN
    RAISE EXCEPTION 'portal_config_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT t.features INTO _features FROM public.tenants t WHERE t.id = p_expected_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'portal_config_forbidden' USING ERRCODE='42501';
  END IF;
  _cfg := CASE WHEN jsonb_typeof(_features->'portal_config')='object' THEN _features->'portal_config' ELSE '{}'::jsonb END;
  RETURN jsonb_build_object(
    'tenant_id', p_expected_tenant_id,
    'modules', COALESCE(_cfg->'modules', 'null'::jsonb),
    'catalog', public.portal_menu_catalog(_features)
  );
END $$;
REVOKE ALL ON FUNCTION public.read_tenant_portal_menu(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_tenant_portal_menu(uuid) TO authenticated;
COMMENT ON FUNCTION public.read_tenant_portal_menu(uuid) IS
  'Owner/admin read of the current business''s stored customer portal menu overlay and its catalog inputs. Invoker rights; returns nothing else from tenants.features.';

-- ── 5. list_tool_autonomy: the owner can see and turn off the new chat control ────────────────
-- Metadata only, in the 20271110030000 pattern: delegate to the complete incumbent first so its
-- authorization and rows survive. No autonomy setting, provider permission or activation changes.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_portal_menu(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_portal_menu;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_portal_menu(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_portal_menu(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_portal_menu(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('portal_menu_update','Change what clients see in their portal menu','Business')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
   FROM catalog c LEFT JOIN public.tenant_tool_autonomy a
    ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

COMMIT;
