-- INT-298 / INT-342 MBC slice 3a — campaign ↔ asset links.
--
-- A campaign brief (20261225000000) has said what content it NEEDS (free text), never what content it
-- HAS: no page, form, funnel, email or library piece could be attached to a brief, so Campaigns could
-- not show a campaign's real composition (plan docs/product/int342-marketing-convergence.md §I/§L.3).
-- This adds one Marketing-owned link table instead of a brief column on six tables owned by Growth,
-- Mail and Content, so no other lane's table changes. Social posts already carry their own
-- `campaign_brief_id` (20270122000000) and are read alongside, never duplicated here.
--
-- Contract: docs/delivery/campaign-asset-links-contract.md.
--   * Writes go only through `configure_campaign_brief_assets`, modelled on `configure_campaign_brief`:
--     tenant re-resolved from auth (§9/§59), owner/admin seat (§53), idempotent through the brief's own
--     command ledger, audited. A link never changes the brief's version, so an editor's open brief
--     never conflicts with someone attaching a page to it.
--   * A link is a planning fact ("this page is part of that campaign"), never proof of a send, a
--     publish, reach or attribution.
--   * Integrity is checked by trigger on every insert, whoever writes: the brief and the asset both
--     belong to the link's tenant, and the brief is not archived.
--   * An asset deleted later leaves its link behind; the read drops links whose asset is gone.
--   * Members read links to pages, forms, funnels and social posts by name; links to email campaigns,
--     email series and library pieces carry their kind only, because members cannot read those rows.

CREATE TABLE IF NOT EXISTS public.campaign_brief_asset_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  brief_id uuid NOT NULL REFERENCES public.campaign_briefs(id) ON DELETE CASCADE,
  asset_kind text NOT NULL CHECK (asset_kind IN ('page','form','funnel','email_campaign','email_series','content')),
  asset_id uuid NOT NULL,
  created_through text NOT NULL CHECK (created_through IN ('human','paige')),
  linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brief_id, asset_kind, asset_id)
);
CREATE INDEX IF NOT EXISTS campaign_brief_asset_links_tenant_asset ON public.campaign_brief_asset_links (tenant_id, asset_kind, asset_id);

ALTER TABLE public.campaign_brief_asset_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_brief_asset_links_tenant_read ON public.campaign_brief_asset_links;
CREATE POLICY campaign_brief_asset_links_tenant_read ON public.campaign_brief_asset_links FOR SELECT TO authenticated
  USING (public.is_platform_owner() OR tenant_id = public.current_user_tenant_id());
REVOKE ALL ON public.campaign_brief_asset_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.campaign_brief_asset_links TO authenticated;
GRANT ALL ON public.campaign_brief_asset_links TO service_role;

-- Does this asset exist in this tenant (and is it not archived)? One home for the six kinds.
CREATE OR REPLACE FUNCTION public._campaign_asset_live(_tenant uuid, _kind text, _id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE _kind
    WHEN 'page' THEN EXISTS(SELECT 1 FROM public.growth_pages a WHERE a.id=_id AND a.tenant_id=_tenant AND a.status<>'archived')
    WHEN 'form' THEN EXISTS(SELECT 1 FROM public.growth_forms a WHERE a.id=_id AND a.tenant_id=_tenant AND a.status<>'archived')
    WHEN 'funnel' THEN EXISTS(SELECT 1 FROM public.growth_funnels a WHERE a.id=_id AND a.tenant_id=_tenant AND a.status<>'archived')
    -- A series' own per-step emails are part of the series, never campaigns on their own (Mail's rule).
    WHEN 'email_campaign' THEN EXISTS(SELECT 1 FROM public.email_campaigns a WHERE a.id=_id AND a.tenant_id=_tenant AND a.sequence_id IS NULL AND a.status<>'cancelled')
    WHEN 'email_series' THEN EXISTS(SELECT 1 FROM public.email_sequences a WHERE a.id=_id AND a.tenant_id=_tenant AND a.status<>'stopped')
    WHEN 'content' THEN EXISTS(SELECT 1 FROM public.marketing_content a WHERE a.id=_id AND a.tenant_id=_tenant AND a.status<>'archived')
    ELSE false END
$$;
REVOKE ALL ON FUNCTION public._campaign_asset_live(uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Integrity on every insert, whoever writes (the writer RPC, service role or a migration).
CREATE OR REPLACE FUNCTION public._campaign_brief_asset_link_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'CAMPAIGN_ASSET_LINK_IMMUTABLE' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.campaign_briefs b WHERE b.id=NEW.brief_id AND b.tenant_id=NEW.tenant_id AND b.lifecycle_status<>'archived') THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_NOT_FOUND' USING ERRCODE='22023';
  END IF;
  IF NOT public._campaign_asset_live(NEW.tenant_id, NEW.asset_kind, NEW.asset_id) THEN
    RAISE EXCEPTION 'CAMPAIGN_ASSET_NOT_FOUND' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._campaign_brief_asset_link_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS campaign_brief_asset_link_guard ON public.campaign_brief_asset_links;
CREATE TRIGGER campaign_brief_asset_link_guard BEFORE INSERT OR UPDATE ON public.campaign_brief_asset_links
  FOR EACH ROW EXECUTE FUNCTION public._campaign_brief_asset_link_guard();

-- ── governed write seam ──────────────────────────────────────────────────────────────────────
-- Commands: {type:'attach_asset'|'detach_asset', briefId, assetKind, assetId}. Attaching what is
-- already attached, or detaching what is not, succeeds and says so; nothing is ever guessed.
CREATE OR REPLACE FUNCTION public.configure_campaign_brief_assets(
  _tenant_id uuid,
  _command jsonb,
  _idempotency_key text,
  _actor_kind text DEFAULT 'human'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := coalesce(_tenant_id, public.current_user_tenant_id());
  _action text := replace(coalesce(_command->>'type',''),'-','_');
  _hash text := md5('campaign_brief_assets:'||coalesce(_command,'{}'::jsonb)::text);
  _cached public.campaign_brief_command_results%ROWTYPE;
  _brief uuid;
  _kind text := btrim(coalesce(_command->>'assetKind',''));
  _asset uuid;
  _result jsonb;
  _removed integer;
BEGIN
  IF _caller IS NULL OR _tenant IS NULL OR NOT (public.is_platform_owner() OR _tenant = public.current_user_tenant_id()) THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF NOT (public.is_platform_owner() OR public.is_tenant_admin(_tenant)) THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF _actor_kind IS NULL OR _actor_kind NOT IN ('human','paige') THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_ACTOR_INVALID' USING ERRCODE='22023'; END IF;
  IF coalesce(btrim(_idempotency_key),'')='' THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_IDEMPOTENCY_REQUIRED' USING ERRCODE='22023'; END IF;
  IF _action NOT IN ('attach_asset','detach_asset') THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_ACTION_INVALID' USING ERRCODE='22023'; END IF;
  IF _kind NOT IN ('page','form','funnel','email_campaign','email_series','content') THEN RAISE EXCEPTION 'CAMPAIGN_ASSET_KIND_INVALID' USING ERRCODE='22023'; END IF;
  BEGIN
    _brief := nullif(btrim(coalesce(_command->>'briefId','')),'')::uuid;
    _asset := nullif(btrim(coalesce(_command->>'assetId','')),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'CAMPAIGN_ASSET_ARGUMENTS_INVALID' USING ERRCODE='22023';
  END;
  IF _brief IS NULL OR _asset IS NULL THEN RAISE EXCEPTION 'CAMPAIGN_ASSET_ARGUMENTS_INVALID' USING ERRCODE='22023'; END IF;

  -- The brief's own ledger: the hash is namespaced, so a key reused across the two writers conflicts.
  PERFORM pg_advisory_xact_lock(hashtextextended('campaign_brief_command:'||_tenant::text||':'||_idempotency_key, 0));
  SELECT * INTO _cached FROM public.campaign_brief_command_results WHERE tenant_id=_tenant AND idempotency_key=_idempotency_key;
  IF FOUND THEN
    IF _cached.command_hash <> _hash THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023'; END IF;
    RETURN _cached.result;
  END IF;

  PERFORM 1 FROM public.campaign_briefs b WHERE b.id=_brief AND b.tenant_id=_tenant AND b.lifecycle_status<>'archived' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAMPAIGN_BRIEF_NOT_FOUND' USING ERRCODE='22023'; END IF;

  IF _action='attach_asset' THEN
    IF NOT public._campaign_asset_live(_tenant, _kind, _asset) THEN RAISE EXCEPTION 'CAMPAIGN_ASSET_NOT_FOUND' USING ERRCODE='22023'; END IF;
    INSERT INTO public.campaign_brief_asset_links(tenant_id, brief_id, asset_kind, asset_id, created_through, linked_by)
    VALUES (_tenant, _brief, _kind, _asset, _actor_kind, _caller)
    ON CONFLICT (brief_id, asset_kind, asset_id) DO NOTHING;
    _result := jsonb_build_object('ok',true,'outcome',CASE WHEN FOUND THEN 'attached' ELSE 'already_attached' END,
      'brief_id',_brief,'asset_kind',_kind,'asset_id',_asset,
      'message',CASE WHEN FOUND THEN 'Attached to the campaign. Nothing is sent or published.' ELSE 'Already part of this campaign.' END);
  ELSE
    DELETE FROM public.campaign_brief_asset_links l WHERE l.brief_id=_brief AND l.tenant_id=_tenant AND l.asset_kind=_kind AND l.asset_id=_asset;
    GET DIAGNOSTICS _removed = ROW_COUNT;
    _result := jsonb_build_object('ok',true,'outcome',CASE WHEN _removed>0 THEN 'detached' ELSE 'not_attached' END,
      'brief_id',_brief,'asset_kind',_kind,'asset_id',_asset,
      'message',CASE WHEN _removed>0 THEN 'Removed from the campaign. The piece itself is unchanged.' ELSE 'It was not part of this campaign.' END);
  END IF;

  INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
  VALUES (_caller, 'campaign_brief', 'campaign_brief.assets', _brief,
    jsonb_build_object('tenant_id',_tenant,'actor_kind',_actor_kind,'command',_action,'asset_kind',_kind,'asset_id',_asset,
      'idempotency_key',_idempotency_key,'outcome',_result->>'outcome'));
  INSERT INTO public.campaign_brief_command_results(tenant_id, idempotency_key, command_hash, actor_user_id, actor_kind, result)
  VALUES (_tenant, _idempotency_key, _hash, _caller, _actor_kind, _result);
  RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public.configure_campaign_brief_assets(uuid,jsonb,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.configure_campaign_brief_assets(uuid,jsonb,text,text) TO authenticated;

-- ── read seam ────────────────────────────────────────────────────────────────────────────────
-- Every live link on the tenant's non-archived briefs (or one brief), plus social posts that name a
-- brief themselves, each with what the caller may see. For an owner/admin, `available` lists what
-- could be attached (up to 200 of each kind, newest first), so the picker and Paige read one source.
CREATE OR REPLACE FUNCTION public.get_campaign_brief_assets(_tenant_id uuid, _brief_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := coalesce(_tenant_id, public.current_user_tenant_id());
  _admin boolean;
  _links jsonb;
  _available jsonb := '[]'::jsonb;
BEGIN
  IF _caller IS NULL OR _tenant IS NULL OR NOT (public.is_platform_owner() OR _tenant = public.current_user_tenant_id()) THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  _admin := public.is_platform_owner() OR public.is_tenant_admin(_tenant);

  WITH briefs AS (
    SELECT b.id FROM public.campaign_briefs b
    WHERE b.tenant_id=_tenant AND b.lifecycle_status<>'archived' AND (_brief_id IS NULL OR b.id=_brief_id)
  ), assets AS (
    SELECT l.brief_id, l.asset_kind kind, l.asset_id id, l.created_through, l.created_at linked_at,
      coalesce(p.title, f.name, u.name, e.name, s.name, c.title) name,
      coalesce(p.status, f.status, u.status, e.status, s.status, c.status) status,
      coalesce(p.slug, f.slug, u.slug) slug,
      CASE WHEN l.asset_kind='content' THEN c.channel END channel
    FROM public.campaign_brief_asset_links l
    JOIN briefs ON briefs.id=l.brief_id
    LEFT JOIN public.growth_pages p ON l.asset_kind='page' AND p.id=l.asset_id AND p.tenant_id=_tenant
    LEFT JOIN public.growth_forms f ON l.asset_kind='form' AND f.id=l.asset_id AND f.tenant_id=_tenant
    LEFT JOIN public.growth_funnels u ON l.asset_kind='funnel' AND u.id=l.asset_id AND u.tenant_id=_tenant
    LEFT JOIN public.email_campaigns e ON l.asset_kind='email_campaign' AND e.id=l.asset_id AND e.tenant_id=_tenant AND e.sequence_id IS NULL
    LEFT JOIN public.email_sequences s ON l.asset_kind='email_series' AND s.id=l.asset_id AND s.tenant_id=_tenant
    LEFT JOIN public.marketing_content c ON l.asset_kind='content' AND c.id=l.asset_id AND c.tenant_id=_tenant
    WHERE l.tenant_id=_tenant
    UNION ALL
    SELECT sp.campaign_brief_id, 'social_post', sp.id, CASE WHEN sp.created_by_agent IS NOT NULL THEN 'paige' ELSE 'human' END, sp.created_at, sp.title, sp.status, NULL, NULL
    FROM public.paige_social_posts sp JOIN briefs ON briefs.id=sp.campaign_brief_id
    WHERE sp.tenant_id=_tenant AND sp.status NOT IN ('archived','abandoned')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'brief_id', a.brief_id, 'kind', a.kind, 'id', a.id,
      -- What a member cannot read stays a kind without a name (§9).
      'name', CASE WHEN _admin OR a.kind IN ('page','form','funnel','social_post') THEN a.name END,
      'status', CASE WHEN _admin OR a.kind IN ('page','form','funnel','social_post') THEN a.status END,
      'slug', a.slug, 'channel', CASE WHEN _admin THEN a.channel END,
      'created_through', a.created_through, 'linked_at', a.linked_at,
      'detachable', _admin AND a.kind<>'social_post'
    ) ORDER BY a.brief_id, a.linked_at, a.kind, a.id), '[]'::jsonb)
  INTO _links FROM assets a WHERE a.name IS NOT NULL;  -- a deleted asset has no row, so no name

  IF _admin THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'id', x.id, 'name', x.name, 'status', x.status, 'channel', x.channel)
      ORDER BY x.kind, x.updated_at DESC, x.id), '[]'::jsonb) INTO _available
    FROM (
      (SELECT 'page' kind, id, title name, status, NULL::text channel, updated_at FROM public.growth_pages WHERE tenant_id=_tenant AND status<>'archived' ORDER BY updated_at DESC LIMIT 200)
      UNION ALL (SELECT 'form', id, name, status, NULL, updated_at FROM public.growth_forms WHERE tenant_id=_tenant AND status<>'archived' ORDER BY updated_at DESC LIMIT 200)
      UNION ALL (SELECT 'funnel', id, name, status, NULL, updated_at FROM public.growth_funnels WHERE tenant_id=_tenant AND status<>'archived' ORDER BY updated_at DESC LIMIT 200)
      UNION ALL (SELECT 'email_campaign', id, name, status, NULL, updated_at FROM public.email_campaigns WHERE tenant_id=_tenant AND sequence_id IS NULL AND status<>'cancelled' ORDER BY updated_at DESC LIMIT 200)
      UNION ALL (SELECT 'email_series', id, name, status, NULL, updated_at FROM public.email_sequences WHERE tenant_id=_tenant AND status<>'stopped' ORDER BY updated_at DESC LIMIT 200)
      UNION ALL (SELECT 'content', id, title, status, channel, updated_at FROM public.marketing_content WHERE tenant_id=_tenant AND status<>'archived' ORDER BY updated_at DESC LIMIT 200)
    ) x;
  END IF;

  RETURN jsonb_build_object('can_manage', _admin, 'links', _links, 'available', _available);
END $$;
REVOKE ALL ON FUNCTION public.get_campaign_brief_assets(uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_campaign_brief_assets(uuid,uuid) TO authenticated;

-- ── account retirement: the links go with the account, like the briefs they belong to ─────────
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF at=0 OR position('''campaign_brief_command_results''' IN body)=0 OR position('campaign_brief_asset_links' IN body)>0 THEN
  RAISE EXCEPTION 'Canonical retirement policy requires reconciliation before registering campaign_brief_asset_links'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''campaign_brief_asset_links'','||substr(body,at+length(anchor));
END $$;
