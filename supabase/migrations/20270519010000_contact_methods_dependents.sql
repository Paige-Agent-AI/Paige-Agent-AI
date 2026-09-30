-- Contact methods (20270515000000): every database object that still read or wrote a client's
-- single address columns now reads and writes `client_contact_methods` instead, so the pull request
-- that drops `clients.email` / `clients.phone` / `profiles.work_email` / `profiles.phone` breaks
-- nothing here. Non-destructive: no column, table or row is dropped.
--
-- ════ DEPLOY ORDER — READ BEFORE MERGING ════════════════════════════════════════════════════
-- This migration makes upsert_contact REFUSE the `email` / `phone` patch keys
-- (CONTACT_ADDRESS_FIELDS_RETIRED). deploy-migrations.yml applies it to production the moment it
-- reaches main, so it must reach production only AFTER every producer that still sends those keys
-- is deployed:
--   * paige-ai-chat's crm_update_contact moved to contact_methods in #1585, already on
--     main at aca4dd99. Source parity is not deployment proof: verify that edge change is
--     deployed (deploy-edge-functions.yml, the `edge-live` tag) before this file merges.
--     Applied before that edge deploy, email changes in Paige chat fail with 22023.
--   * the People editor (contactUpsert / PeopleContactEditor) already sends only contact_methods
--     (main, #1564).
-- It must also merge BEFORE the pull request that drops the four columns: without it that drop
-- fails on the invitations policy and the three views below.
-- It runs after 20270519000000_contact_methods_concurrency.sql and restates two of that file's
-- functions (upsert_contact, and handle_data_subject_request's use of its checked writer); both keep
-- 20270519000000's lost-update protection intact — see each section.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- The authoritative list is production's, read-only on 2026-09-29 (pg_depend on the four columns,
-- plus pg_proc.prosrc, pg_get_viewdef and pg_policies searched for email / phone / work_email and
-- every hit read). Apart from the rollout mirror (20270515000000, deleted with the columns), the
-- objects that depend on the columns are exactly:
--
--   contact_readiness_rollup  view     `email` is the contact's primary email
--   paige_approval_queue_v    view     `contact_email` is the contact's primary email
--   paige_unassigned_queue    view     `email` is the contact's primary email
--   "Assigned staff read their clients' invitations"  policy on invitations: matches ANY of the
--                             client's email addresses, by match key (case and spacing no longer
--                             matter), instead of the single column
--   upsert_contact            the `email` / `phone` patch keys are refused by name; the complete
--                             address list, `contact_methods`, is the only address input; its
--                             `expected_contact_methods` check (20270519000000) is kept
--   update_contact            (no callers; it forwarded p_email/p_phone to upsert_contact) sets the
--                             given address as the primary of its kind, exactly as a write to the
--                             old column did through the mirror, naming the list it read
--   handle_data_subject_request  rewritten onto contact methods (owner ruling 2026-09-28), and
--                             callable by its one producer, Paige's MCP tool (service role): see
--                             its own header — every call failed on production before this
--   lookup_client_by_account_number  `email` / `phone` are the primaries (no callers; kept)
--   create_internal_booking   the guest email defaults to the contact's primary email
--   seed_agreement_counterparty  the counterparty signer is the contact's primary email
--   start_client_impersonation   the display-name fallback is the primary email
--   trg_clients_apollo_enrich REMOVED, with its trigger (evidence in its section below)
--
-- And one concurrency repair that does not touch the columns: _add_client_contact_methods
-- (20270516000000) now locks the contact before reading its address list, so an address another
-- transaction was writing at that moment is no longer dropped (see its section).
--
-- Checked and deliberately NOT changed:
--   growth_page_upsert        'maps_to', 'clients.email' is a form-field mapping label, not a column
--                             read. Its one consumer (growth-process-submission extractIdentity)
--                             keys on the last segment, `email`, and the same label is the value
--                             vocabulary of the Studio form picker and _shared/growth-forms.ts, so
--                             it moves (if ever) with those, not alone here.
--   get_profile_with_pii_log  RETURNS SETOF profiles / SELECT *: it names no address column, so it
--                             keeps working; its result simply loses the two columns at the drop.
--                             Its reader (ProfileSettings) belongs to the frontend lane.
--   accept_tenant_invite, create_tenant_invite_token, execute_crm_command(_reversible),
--   preview_crm_command, tg_comms_file_outbound_draft, set_contact_channel_suppression,
--   enforce_platform_user_consent_evidence, notify_new_user_onboarding: their email/phone
--   references are other tables' columns (agency_team_members, tenant_invite_tokens,
--   platform user consents, auth.users) or channel names, not the four columns.
--
-- Every function below is restated WHOLE from its live production definition
-- (pg_get_functiondef, 2026-09-29; md5(prosrc) recorded per function) — or, for upsert_contact, from
-- 20270519000000's restatement of it — with only the lines named in its header changed. Each keeps its live signature, owner, SECURITY DEFINER and search_path, and
-- its live grants are restated so the ACL is reproducible from the repository.
--
-- A primary address is read the one way the model defines it: the row of that kind flagged
-- is_primary (exactly one exists whenever any address of the kind exists). The SECURITY DEFINER
-- functions read it through public.client_primary_address(_client_id, _kind) (20270516000000), the
-- one home for that read. The views and the invitations policy deliberately do NOT: they run as the
-- caller (security_invoker / row security), and client_primary_address is itself SECURITY DEFINER
-- and granted to service_role only — calling it from a view would either fail for every signed-in
-- reader or, if granted, bypass row security on client_contact_methods. So they read the table
-- directly, and row security — which delegates to the caller's own access to the contact — decides
-- what a viewer sees, as it did for the column.

-- migration-lint-ignore: pattern-2 -- every INSERT here is inside a function body and runs when the
-- function is called, never while this migration applies; the SELECTs it matches are sub-selects
-- that build values (ARRAY(SELECT ...), the primary-address reads), and this file seeds no rows.

-- ─── Views ──────────────────────────────────────────────────────────────────────────────────
-- Each is restated from pg_get_viewdef with the address column's source changed and nothing else:
-- same columns, names, types and order (CREATE OR REPLACE VIEW requires it), and the live option
-- security_invoker=true restated, since CREATE OR REPLACE VIEW does not carry it forward.
CREATE OR REPLACE VIEW public.contact_readiness_rollup
WITH (security_invoker = true) AS
 SELECT c.id AS contact_id,
    c.linked_user_id,
    c.assigned_coach_user_id,
    c.first_name,
    c.last_name,
    (SELECT m.value FROM public.client_contact_methods m
      WHERE m.client_id = c.id AND m.kind = 'email' AND m.is_primary
      ORDER BY m.position LIMIT 1) AS email,
    c.entity_name,
    c.lifecycle_stage,
    c.funding_goal,
    c.tags,
    c.last_contacted_at,
    oc.bureau AS owner_bureau,
    oc.score AS owner_fico,
    oc.pulled_at AS owner_pulled_at,
    bc.scores AS business_scores,
    bc.last_pulled_at AS business_pulled_at,
    cf.avg_daily_balance_cents,
    cf.runway_days,
    cf.funding_readiness_score AS cash_flow_readiness,
    cf.period_end AS cash_flow_period_end,
    COALESCE(b.bank_connections, (0)::bigint) AS bank_connections,
    COALESCE(b.bank_connections_active, (0)::bigint) AS bank_connections_active,
    b.last_bank_sync_at,
    COALESCE(s.envelopes_total, (0)::bigint) AS envelopes_total,
    COALESCE(s.envelopes_completed, (0)::bigint) AS envelopes_completed,
    COALESCE(s.envelopes_pending, (0)::bigint) AS envelopes_pending,
    s.last_signed_at,
    frs.overall_score AS stored_overall_score,
    frs.last_calculated_at AS stored_score_at,
    public.compute_contact_readiness(c.id) AS readiness_score
   FROM ((((((public.clients c
     LEFT JOIN public._latest_owner_credit oc ON ((oc.contact_id = c.id)))
     LEFT JOIN public.paige_business_credit_profiles bc ON ((bc.contact_id = c.id)))
     LEFT JOIN public._latest_cash_flow cf ON ((cf.contact_id = c.id)))
     LEFT JOIN public._bank_rollup b ON ((b.contact_id = c.id)))
     LEFT JOIN public._signature_rollup s ON ((s.contact_id = c.id)))
     LEFT JOIN public.funding_readiness_scores frs ON ((frs.user_id = c.linked_user_id)));

CREATE OR REPLACE VIEW public.paige_approval_queue_v
WITH (security_invoker = true) AS
 SELECT a.id,
    a.type,
    a.category,
    a.status,
    a.priority,
    a.risk_level,
    a.summary,
    a.source,
    a.requires_role,
    a.tenant_id,
    a.contact_id,
    a.conversation_id,
    a.assigned_to_user_id,
    a.submitted_by_user_id,
    a.visible_to_roles,
    a.sla_due_at,
    a.created_at,
    a.reviewed_at,
    a.sent_at,
    a.draft_content,
    a.metadata,
    c.first_name AS contact_first_name,
    c.last_name AS contact_last_name,
    (SELECT m.value FROM public.client_contact_methods m
      WHERE m.client_id = c.id AND m.kind = 'email' AND m.is_primary
      ORDER BY m.position LIMIT 1) AS contact_email,
    c.lifecycle_stage AS contact_lifecycle_stage,
    (EXTRACT(epoch FROM (now() - a.created_at)))::integer AS age_seconds,
        CASE
            WHEN (a.status <> 'pending'::text) THEN 'closed'::text
            WHEN (a.sla_due_at IS NULL) THEN 'unscheduled'::text
            WHEN (a.sla_due_at < now()) THEN 'overdue'::text
            WHEN (a.sla_due_at < (now() + '02:00:00'::interval)) THEN 'due_soon'::text
            ELSE 'on_track'::text
        END AS sla_state
   FROM (public.paige_pending_approvals a
     LEFT JOIN public.clients c ON ((c.id = a.contact_id)));
-- The view now reads client_contact_methods, which `anon` holds no privilege on (by design,
-- 20270515000000), so an anonymous read would stop returning its empty result and raise instead.
-- Nothing anonymous reads the approval queue (paige_pending_approvals has no anon policy, so the
-- answer was always empty); the grant is withdrawn so the view's reach matches its purpose.
REVOKE SELECT ON public.paige_approval_queue_v FROM anon;

CREATE OR REPLACE VIEW public.paige_unassigned_queue
WITH (security_invoker = true) AS
 SELECT c.id,
    (SELECT m.value FROM public.client_contact_methods m
      WHERE m.client_id = c.id AND m.kind = 'email' AND m.is_primary
      ORDER BY m.position LIMIT 1) AS email,
    c.first_name,
    c.last_name,
    c.tier,
    c.ghl_contact_id,
    c.created_at,
    c.last_mirrored_at,
    (EXTRACT(epoch FROM (now() - c.created_at)) / 3600.0) AS unassigned_for_hours,
        CASE c.tier
            WHEN 'vip'::text THEN 1
            WHEN 'premium'::text THEN 2
            WHEN 'internal'::text THEN 3
            WHEN 'staff'::text THEN 3
            WHEN 'standard'::text THEN 4
            WHEN 'lead'::text THEN 5
            ELSE 6
        END AS priority_rank,
    c.tenant_id
   FROM public.clients c
  WHERE ((c.status <> 'archived'::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.paige_coach_assignments pca
          WHERE ((pca.contact_id = c.id) AND (pca.active = true) AND (pca.assigned_role = ANY (ARRAY['lead_owner'::text, 'cs_primary'::text])) AND (pca.rep_user_id IS NOT NULL))))))
  ORDER BY
        CASE c.tier
            WHEN 'vip'::text THEN 1
            WHEN 'premium'::text THEN 2
            WHEN 'internal'::text THEN 3
            WHEN 'staff'::text THEN 3
            WHEN 'standard'::text THEN 4
            WHEN 'lead'::text THEN 5
            ELSE 6
        END, c.created_at DESC;

-- ─── Policy: an assignee reads their clients' invitations, sent to ANY of the client's addresses ─
-- Live (20270502000000): FOR SELECT TO public, `c.email = invitations.email`. Two changes only:
--   * the address test reads the client's methods by match key, so an invitation sent to a
--     client's second address, or in another case, is recognised;
--   * TO authenticated. The expression requires `cc.coach_user_id = auth.uid()`, which no anonymous
--     caller can satisfy, so the policy has never admitted `anon`. It now reads
--     client_contact_methods, which `anon` holds no privilege on, and a policy that names a table
--     the caller cannot read makes the caller's whole query fail rather than filter. Scoping it to
--     the role it has only ever served keeps an anonymous read of invitations exactly as before.
ALTER POLICY "Assigned staff read their clients' invitations" ON public.invitations
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.coach_clients cc
      JOIN public.clients c ON c.linked_user_id = cc.client_user_id AND c.tenant_id = cc.tenant_id
     WHERE cc.coach_user_id = auth.uid() AND cc.status = 'active'
       AND c.tenant_id = invitations.tenant_id
       AND EXISTS (
         SELECT 1 FROM public.client_contact_methods m
          WHERE m.client_id = c.id AND m.kind = 'email'
            AND m.match_key = public.contact_method_match_key('email', invitations.email))));

-- ─── Shared: make one address the primary of its kind in an address list ────────────────────
-- What a write to the old single column did through the rollout mirror, expressed on a list
-- [{kind, value, label, is_primary}] and returned as a new list:
--   * the contact already holds that address (by match key) → it becomes the primary, written as
--     given; the previous primary stays, as a secondary address;
--   * otherwise the current primary's address is REPLACED by the given one (its label is kept);
--   * a contact with no address of that kind gains it as its primary.
-- An empty or NULL value returns the list unchanged. Pure: it reads no table, so the caller decides
-- whose list it is and writes it through a writer that authorises and validates.
CREATE FUNCTION public.contact_methods_with_primary(_methods jsonb, _kind text, _value text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  _v text := NULLIF(pg_catalog.btrim(_value), '');
  _list jsonb := COALESCE(_methods, '[]'::jsonb);
  _target bigint;
BEGIN
  IF _v IS NULL THEN
    RETURN _list;
  END IF;
  IF _kind IS NULL OR _kind NOT IN ('email', 'phone') THEN
    RAISE EXCEPTION 'CONTACT_METHOD_BAD_KIND' USING ERRCODE = '22023';
  END IF;

  SELECT t.o INTO _target
    FROM pg_catalog.jsonb_array_elements(_list) WITH ORDINALITY AS t(e, o)
   WHERE t.e->>'kind' = _kind
     AND public.contact_method_match_key(_kind, t.e->>'value') = public.contact_method_match_key(_kind, _v)
   ORDER BY t.o LIMIT 1;
  IF _target IS NULL THEN
    SELECT t.o INTO _target
      FROM pg_catalog.jsonb_array_elements(_list) WITH ORDINALITY AS t(e, o)
     WHERE t.e->>'kind' = _kind AND COALESCE((t.e->>'is_primary')::boolean, false)
     ORDER BY t.o LIMIT 1;
  END IF;

  IF _target IS NULL THEN
    RETURN COALESCE((
      SELECT pg_catalog.jsonb_agg(
               CASE WHEN t.e->>'kind' = _kind THEN t.e || '{"is_primary": false}'::jsonb ELSE t.e END
               ORDER BY t.o)
        FROM pg_catalog.jsonb_array_elements(_list) WITH ORDINALITY AS t(e, o)), '[]'::jsonb)
      || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('kind', _kind, 'value', _v, 'is_primary', true));
  END IF;

  RETURN (
    SELECT pg_catalog.jsonb_agg(
             CASE WHEN t.e->>'kind' <> _kind THEN t.e
                  WHEN t.o = _target THEN t.e || pg_catalog.jsonb_build_object('value', _v, 'is_primary', true)
                  ELSE t.e || '{"is_primary": false}'::jsonb END
             ORDER BY t.o)
      FROM pg_catalog.jsonb_array_elements(_list) WITH ORDINALITY AS t(e, o));
END;
$$;
REVOKE ALL ON FUNCTION public.contact_methods_with_primary(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contact_methods_with_primary(jsonb, text, text) TO service_role;

-- ─── _add_client_contact_methods: lock the contact BEFORE reading its list ──────────────────
-- Restated from production's live definition (pg_get_functiondef, 2026-09-29, md5(prosrc)
-- dd41f8084aeb32d88480920daa172a96, identical to 20270516000000's text). ONE change: the contact's
-- row is locked (FOR UPDATE, by id AND tenant) before the held list is read, and a contact that is
-- not in _tenant_id is refused there with CONTACT_NOT_FOUND_OR_FORBIDDEN (42501) — the refusal
-- _replace_client_contact_methods already gave, now given before anything is read.
--
-- Why: the live body read the held list (the `cur` CTE) BEFORE _replace_client_contact_methods took
-- that lock. A writer holding the lock at that moment (another add, a checked whole-list replace, or
-- any direct address write such as an inbound-recognition attach, which takes it through
-- 20270519000000's client_contact_methods_touch_client) committed an address this add never saw,
-- and the whole-list write
-- that followed deleted it. Under READ COMMITTED each statement takes a fresh snapshot, so once the
-- lock is granted the read below sees what the other writer committed. The later lock taken by
-- _replace_client_contact_methods is the same row in the same transaction, so it is a no-op.
-- Proof: scripts/proof/contact-methods-add-race.mjs (two sessions; CI paige-spine-contract).
--
-- Unchanged: signature, SECURITY DEFINER, search_path, the canonical-shape check (still first, so a
-- malformed list is refused as before whatever the contact), the merge rule, the result, and the
-- grants (service_role only). Its callers — execute_crm_command's add_contact_methods, Paige's MCP
-- update_contact and proposals, and the create path that adds to a contact it just inserted — pass
-- the same arguments; the lock they may already hold on that row is their own.
CREATE OR REPLACE FUNCTION public._add_client_contact_methods(_tenant_id uuid, _client_id uuid, _methods jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _combined jsonb;
BEGIN
  -- Shape, format, duplicates and two-primaries are refused exactly as for a full list.
  PERFORM public.contact_methods_canonical(_methods);

  -- The contact's row lock is taken before its list is read, so an address another writer holds
  -- uncommitted is read once that writer commits — never merged around and then deleted.
  PERFORM 1 FROM public.clients AS c WHERE c.id = _client_id AND c.tenant_id = _tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  WITH cur AS (
         SELECT m.kind, m.value, m.label, m.is_primary, m.position, m.match_key, 0 AS src
           FROM public.client_contact_methods AS m WHERE m.client_id = _client_id),
       added AS (
         SELECT e->>'kind' AS kind, pg_catalog.btrim(e->>'value') AS value,
                NULLIF(pg_catalog.btrim(e->>'label'), '') AS label,
                COALESCE((e->>'is_primary')::boolean, false) AS is_primary, o::int AS position,
                public.contact_method_match_key(e->>'kind', e->>'value') AS match_key, 1 AS src
           FROM pg_catalog.jsonb_array_elements(_methods) WITH ORDINALITY AS t(e, o)),
       promoted AS (SELECT a.kind, a.match_key FROM added AS a WHERE a.is_primary),
       merged AS (
         SELECT cur.kind, cur.value, cur.label, cur.is_primary, cur.position, cur.match_key, cur.src FROM cur
         UNION ALL
         SELECT a.kind, a.value, a.label, a.is_primary, a.position, a.match_key, a.src FROM added AS a
          WHERE NOT EXISTS (SELECT 1 FROM cur WHERE cur.kind = a.kind AND cur.match_key = a.match_key))
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'kind', m.kind, 'value', m.value, 'label', m.label,
           'is_primary', CASE WHEN EXISTS (SELECT 1 FROM promoted AS p WHERE p.kind = m.kind)
                              THEN EXISTS (SELECT 1 FROM promoted AS p WHERE p.kind = m.kind AND p.match_key = m.match_key)
                              ELSE m.is_primary END)
           ORDER BY m.kind, m.src, m.position)
    INTO _combined
    FROM merged AS m;

  RETURN public._replace_client_contact_methods(_tenant_id, _client_id, COALESCE(_combined, '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public._add_client_contact_methods(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._add_client_contact_methods(uuid, uuid, jsonb) TO service_role;

-- ─── upsert_contact ─────────────────────────────────────────────────────────────────────────
-- Restated from its definition in 20270519000000_contact_methods_concurrency.sql, which runs
-- immediately before this migration and is the one production will hold when this applies (that
-- file restated production's live body, md5(prosrc) 254699314f892603c89b7f6c4fbb37c3). KEPT
-- exactly as 20270519000000 wrote it: the `expected_contact_methods` key, the refusal
-- CONTACT_METHODS_EXPECTED_REQUIRED when an existing contact's list is replaced without it, and the
-- CONTACT_METHODS_STALE comparison under the contact's row lock — removing any of them would
-- silently re-open the lost-update hole that migration closed (§58). Changed, and nothing else:
--   * `email` and `phone` leave the allowlist and are refused BY NAME with
--     CONTACT_ADDRESS_FIELDS_RETIRED, so a caller still sending them learns what to send instead;
--   * CONTACT_METHODS_AMBIGUOUS is gone (there is nothing left to be ambiguous with);
--   * the INSERT and UPDATE no longer write the two columns; the new contact's name fallback reads
--     the primary email of `contact_methods`, as it already did.
CREATE OR REPLACE FUNCTION public.upsert_contact(p_patch jsonb, p_contact_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid, p_actor_user_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _actor uuid := COALESCE(auth.uid(), p_actor_user_id);
  _tenant uuid;
  _contact_id uuid := p_contact_id;
  _email text;
  _methods jsonb;
  _unknown text[];
  _retired text[];
  _action text;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'CONTACT_EMPTY_PATCH' USING ERRCODE = '22023';
  END IF;

  -- A contact holds several addresses; the single-address keys cannot say which one they mean.
  SELECT array_agg(key ORDER BY key)
    INTO _retired
    FROM jsonb_object_keys(p_patch) AS retired(key)
   WHERE key IN ('email', 'phone');
  IF _retired IS NOT NULL THEN
    RAISE EXCEPTION 'CONTACT_ADDRESS_FIELDS_RETIRED: % — send contact_methods, the complete address list', array_to_string(_retired, ',')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key)
    INTO _unknown
    FROM jsonb_object_keys(p_patch) AS allowed(key)
   WHERE key <> ALL (ARRAY[
     'first_name','last_name','contact_methods','expected_contact_methods','entity_name','entity_type','title',
     'website','linkedin_url','street_address','city','state','zip_code',
     'lifecycle_stage','source','tags','primary_offer','current_notes','status',
     'assigned_coach_user_id','do_not_contact'
   ]);
  IF _unknown IS NOT NULL THEN
    RAISE EXCEPTION 'CONTACT_FIELDS_FORBIDDEN: %', array_to_string(_unknown, ',')
      USING ERRCODE = '22023';
  END IF;

  IF _actor IS NULL OR NOT public.has_any_role(_actor, ARRAY['admin','super_admin']) THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;

  IF _caller IS NULL THEN
    _tenant := p_tenant_id;
  ELSE
    _tenant := public.current_user_tenant_id();
    IF public.is_platform_owner() AND p_tenant_id IS NOT NULL THEN
      _tenant := p_tenant_id;
    ELSIF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION 'CONTACT_TENANT_MISMATCH' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'assigned_coach_user_id'
     AND NULLIF(p_patch->>'assigned_coach_user_id', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.tenant_members AS tm
        WHERE tm.tenant_id = _tenant
          AND tm.user_id = (p_patch->>'assigned_coach_user_id')::uuid
          AND tm.status = 'active'
          AND public.has_any_role(tm.user_id, ARRAY['admin','super_admin'])
     ) THEN
    RAISE EXCEPTION 'CONTACT_ASSIGNEE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'status'
     AND COALESCE(p_patch->>'status', '') NOT IN ('pending','active','inactive','archived') THEN
    RAISE EXCEPTION 'CONTACT_BAD_STATUS' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'lifecycle_stage'
     AND COALESCE(p_patch->>'lifecycle_stage', '') NOT IN (
       'new_lead','qualified','nurturing','hot_lead','negotiating','won',
       'client_active','client_paused','client_churned','client_funded','client_alumni'
     ) THEN
    RAISE EXCEPTION 'CONTACT_BAD_LIFECYCLE' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'tags' AND jsonb_typeof(COALESCE(p_patch->'tags', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'CONTACT_BAD_TAGS' USING ERRCODE = '22023';
  END IF;
  IF p_channel IS NOT NULL AND p_channel NOT IN ('manual','api') THEN
    RAISE EXCEPTION 'CONTACT_BAD_CHANNEL' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'expected_contact_methods' AND jsonb_typeof(p_patch->'expected_contact_methods') <> 'array' THEN
    RAISE EXCEPTION 'CONTACT_METHODS_EXPECTED_REQUIRED: send the list you loaded' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'contact_methods' THEN
    -- Validated before any write, so a bad list never leaves a half-made contact behind.
    _methods := public.contact_methods_canonical(p_patch->'contact_methods');
    SELECT e->>'value' INTO _email
      FROM jsonb_array_elements(_methods) AS e
     WHERE e->>'kind' = 'email' AND (e->>'is_primary')::boolean
     LIMIT 1;
  END IF;

  IF _contact_id IS NULL THEN
    INSERT INTO public.clients (
      first_name, last_name, entity_name, entity_type, title,
      website, linkedin_url, street_address, city, state, zip_code,
      lifecycle_stage, source, tags, primary_offer, current_notes, status,
      assigned_coach_user_id, do_not_contact, created_by, tenant_id, created_by_channel_type
    ) VALUES (
      COALESCE(NULLIF(btrim(p_patch->>'first_name'), ''), NULLIF(split_part(COALESCE(_email, ''), '@', 1), ''), 'New'),
      COALESCE(NULLIF(btrim(p_patch->>'last_name'), ''), 'Contact'),
      NULLIF(btrim(p_patch->>'entity_name'), ''),
      NULLIF(btrim(p_patch->>'entity_type'), ''),
      NULLIF(btrim(p_patch->>'title'), ''),
      NULLIF(btrim(p_patch->>'website'), ''),
      NULLIF(btrim(p_patch->>'linkedin_url'), ''),
      NULLIF(btrim(p_patch->>'street_address'), ''),
      NULLIF(btrim(p_patch->>'city'), ''),
      NULLIF(btrim(p_patch->>'state'), ''),
      NULLIF(btrim(p_patch->>'zip_code'), ''),
      COALESCE(NULLIF(p_patch->>'lifecycle_stage', ''), 'new_lead'),
      COALESCE(NULLIF(btrim(p_patch->>'source'), ''), CASE WHEN p_channel = 'api' THEN 'paige' ELSE 'manual' END),
      CASE WHEN p_patch ? 'tags' THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_patch->'tags', '[]'::jsonb))) ELSE '{}'::text[] END,
      NULLIF(btrim(p_patch->>'primary_offer'), ''),
      NULLIF(btrim(p_patch->>'current_notes'), ''),
      COALESCE(NULLIF(p_patch->>'status', ''), 'active'),
      NULLIF(p_patch->>'assigned_coach_user_id', '')::uuid,
      COALESCE((p_patch->>'do_not_contact')::boolean, false),
      _actor,
      _tenant,
      p_channel
    )
    RETURNING id INTO _contact_id;
    _action := 'create_contact';
  ELSE
    PERFORM 1 FROM public.clients AS c
     WHERE c.id = _contact_id AND c.tenant_id = _tenant
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Replacing an existing contact's list needs the list the caller loaded; checked under the
    -- contact's row lock, before anything is written.
    IF p_patch ? 'contact_methods' AND NOT p_patch ? 'expected_contact_methods' THEN
      RAISE EXCEPTION 'CONTACT_METHODS_EXPECTED_REQUIRED: send the list you loaded' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'contact_methods'
       AND public.contact_methods_fingerprint(public._client_contact_methods_payload(_contact_id))
           IS DISTINCT FROM public.contact_methods_fingerprint(p_patch->'expected_contact_methods') THEN
      RAISE EXCEPTION 'CONTACT_METHODS_STALE: this list changed since it was loaded' USING ERRCODE = '40001';
    END IF;

    UPDATE public.clients AS c SET
      first_name = CASE WHEN p_patch ? 'first_name' THEN COALESCE(NULLIF(btrim(p_patch->>'first_name'), ''), 'New') ELSE c.first_name END,
      last_name = CASE WHEN p_patch ? 'last_name' THEN COALESCE(NULLIF(btrim(p_patch->>'last_name'), ''), 'Contact') ELSE c.last_name END,
      entity_name = CASE WHEN p_patch ? 'entity_name' THEN NULLIF(btrim(p_patch->>'entity_name'), '') ELSE c.entity_name END,
      entity_type = CASE WHEN p_patch ? 'entity_type' THEN NULLIF(btrim(p_patch->>'entity_type'), '') ELSE c.entity_type END,
      title = CASE WHEN p_patch ? 'title' THEN NULLIF(btrim(p_patch->>'title'), '') ELSE c.title END,
      website = CASE WHEN p_patch ? 'website' THEN NULLIF(btrim(p_patch->>'website'), '') ELSE c.website END,
      linkedin_url = CASE WHEN p_patch ? 'linkedin_url' THEN NULLIF(btrim(p_patch->>'linkedin_url'), '') ELSE c.linkedin_url END,
      street_address = CASE WHEN p_patch ? 'street_address' THEN NULLIF(btrim(p_patch->>'street_address'), '') ELSE c.street_address END,
      city = CASE WHEN p_patch ? 'city' THEN NULLIF(btrim(p_patch->>'city'), '') ELSE c.city END,
      state = CASE WHEN p_patch ? 'state' THEN NULLIF(btrim(p_patch->>'state'), '') ELSE c.state END,
      zip_code = CASE WHEN p_patch ? 'zip_code' THEN NULLIF(btrim(p_patch->>'zip_code'), '') ELSE c.zip_code END,
      lifecycle_stage = CASE WHEN p_patch ? 'lifecycle_stage' THEN p_patch->>'lifecycle_stage' ELSE c.lifecycle_stage END,
      source = CASE WHEN p_patch ? 'source' THEN NULLIF(btrim(p_patch->>'source'), '') ELSE c.source END,
      tags = CASE WHEN p_patch ? 'tags' THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_patch->'tags', '[]'::jsonb))) ELSE c.tags END,
      primary_offer = CASE WHEN p_patch ? 'primary_offer' THEN NULLIF(btrim(p_patch->>'primary_offer'), '') ELSE c.primary_offer END,
      current_notes = CASE WHEN p_patch ? 'current_notes' THEN NULLIF(btrim(p_patch->>'current_notes'), '') ELSE c.current_notes END,
      status = CASE WHEN p_patch ? 'status' THEN p_patch->>'status' ELSE c.status END,
      assigned_coach_user_id = CASE WHEN p_patch ? 'assigned_coach_user_id' THEN NULLIF(p_patch->>'assigned_coach_user_id', '')::uuid ELSE c.assigned_coach_user_id END,
      do_not_contact = CASE WHEN p_patch ? 'do_not_contact' THEN COALESCE((p_patch->>'do_not_contact')::boolean, false) ELSE c.do_not_contact END,
      updated_at = now()
    WHERE c.id = _contact_id AND c.tenant_id = _tenant;
    _action := 'update_contact';
  END IF;

  IF p_patch ? 'contact_methods' THEN
    PERFORM public._replace_client_contact_methods(_tenant, _contact_id, p_patch->'contact_methods');
  END IF;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'client', _action, _contact_id,
          jsonb_build_object('tenant_id', _tenant, 'fields', ARRAY(SELECT jsonb_object_keys(p_patch - 'expected_contact_methods')), 'channel', p_channel));
  RETURN _contact_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.upsert_contact(jsonb, uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_contact(jsonb, uuid, uuid, uuid, text) TO authenticated, service_role;

-- ─── update_contact ─────────────────────────────────────────────────────────────────────────
-- Live md5(prosrc) 7434f28352c4ada0fd7901cc01f20940. A thin wrapper over upsert_contact with no
-- caller in the repository (src/__tests__/paige-contact-upsert-contract.test.ts asserts Paige's
-- handler does not call it). It forwarded p_email / p_phone as the retired keys, so it would now
-- fail on any address. Changed: an address becomes a `contact_methods` list — the contact's current
-- addresses with the given one made primary (contact_methods_with_primary), which is what a write
-- to the old column did through the mirror. upsert_contact still authorises the caller, the
-- workspace and the contact before anything is written; the current list is read only from the
-- caller's workspace, never returned, and sent back as `expected_contact_methods`, so a concurrent
-- change to the list refuses this write (20270519000000) instead of being overwritten.
CREATE OR REPLACE FUNCTION public.update_contact(p_contact_id uuid, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_entity_name text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_lifecycle_stage text DEFAULT NULL::text, p_primary_offer text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_assigned_coach_user_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _patch jsonb;
  _methods jsonb;
  _expected jsonb;
BEGIN
  _patch := jsonb_strip_nulls(jsonb_build_object(
    'first_name', p_first_name,
    'last_name', p_last_name,
    'entity_name', p_entity_name,
    'title', p_title,
    'lifecycle_stage', p_lifecycle_stage,
    'primary_offer', p_primary_offer,
    'current_notes', p_notes,
    'status', p_status,
    'assigned_coach_user_id', p_assigned_coach_user_id
  ));

  IF NULLIF(btrim(p_email), '') IS NOT NULL OR NULLIF(btrim(p_phone), '') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', m.kind, 'value', m.value, 'label', m.label, 'is_primary', m.is_primary)
                              ORDER BY m.kind, m.position), '[]'::jsonb)
      INTO _expected
      FROM public.client_contact_methods AS m
     WHERE m.client_id = p_contact_id
       AND m.tenant_id = public.current_user_tenant_id();
    _methods := public.contact_methods_with_primary(_expected, 'email', p_email);
    _methods := public.contact_methods_with_primary(_methods, 'phone', p_phone);
    -- The list just read is the list this write replaces: if another save lands between this read
    -- and upsert_contact's row lock, the save is refused as CONTACT_METHODS_STALE, never merged.
    _patch := _patch || jsonb_build_object('contact_methods', _methods, 'expected_contact_methods', _expected);
  END IF;

  PERFORM public.upsert_contact(
    _patch,
    p_contact_id,
    public.current_user_tenant_id(),
    auth.uid(),
    NULL
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.update_contact(uuid, text, text, text, text, text, text, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_contact(uuid, text, text, text, text, text, text, text, text, text, text, uuid) TO authenticated;

-- ─── handle_data_subject_request ────────────────────────────────────────────────────────────
-- Live md5(prosrc) 98cbbb516f52dbd95ae6ee83e959a263 (20260701200503). Rewritten onto contact
-- methods, and made to run at all (owner ruling 2026-09-28: the correct and delete branches must
-- work). Measured against production's tables before writing, every branch raised before this:
--   * pii_access_log has no user_id / accessed_by / column_name / action / reason — its columns are
--     accessed_user_id, accessor_user_id, table_name, field_names text[], access_type ('read' or
--     'update'). The first statement of every branch therefore failed.
--   * export: client_notes, client_files are keyed on contact_id (not client_id); deals on
--     contact_client_id (not contact_id).
--   * correct / delete: clients has no zip, address_line1, address_line2 or ssn_last_4; its address
--     is street_address, city, state, zip_code.
--   * delete: lifecycle_stage 'archived' fails both of clients' lifecycle checks; the contact is
--     archived by status, as the CRM's own archive does. And data_deletion_requests.user_id is a
--     foreign key to auth.users, so writing a contact id there could never succeed — and a row
--     there requests deletion of a platform ACCOUNT, which this does not do. The request's durable
--     record is the paige_audit_log row (7-year retention) and the pii_access_log row.
--
-- WHO MAY CALL IT. Its one producer is Paige's MCP tool handle_data_subject_request, which calls
-- with the SERVICE ROLE, so auth.uid() is NULL there and the old body refused every call. Two paths
-- now, each with the same authority test (platform owner, or an active owner/admin of the tenant):
--   * a signed-in caller acts as themselves: auth.uid() is the actor, and a `_actor_user_id` naming
--     anyone else is refused, never honoured (§59);
--   * the service role (auth.role() = 'service_role' and no auth.uid(), the detection used across
--     this repository's migrations) passes the tenant it resolved from its caller in `_tenant_id`
--     and the person it acts for in `_actor_user_id`. That person must hold the same authority in
--     that tenant, re-checked here, so the trusted path widens nothing: it only lets the caller be
--     named when there is no session to name it. A call with no person is refused
--     (actor_required): the access log records who exercised the request, and a GDPR erasure with
--     no accountable person is not one this function performs.
--   Anyone else — anonymous, or a signed-in non-admin — is refused as before.
-- The signature gains `_actor_user_id uuid DEFAULT NULL`, so the 5-argument function is dropped
-- first: CREATE OR REPLACE with a new argument list would add an overload, not replace it. Callers
-- using named arguments (the only kind in the repository) keep working unchanged.
--
-- Contact methods:
--   * export / portability return the contact's addresses as `contact_methods`;
--   * correct takes `email` / `phone` and makes that address the primary of its kind, exactly as
--     a write to the old column did (contact_methods_with_primary), through the checked writer:
--     the list it read is the list it replaces, so a save that lands in between is refused as
--     CONTACT_METHODS_STALE rather than overwritten (20270519000000). The other fields are the
--     contact's real columns, and the old names `zip` / `address_line1` are still accepted for
--     zip_code / street_address. `applied` lists only what was changed; keys that change nothing
--     (a JSON null, or a blank email/phone) and keys that are not correctable are returned under
--     `ignored`, so a caller never reads an unapplied correction as applied;
--   * delete removes every one of the contact's addresses.
-- The audit row carries its tenant explicitly: left to stamp_tenant_id it took the CALLER's
-- workspace, the wrong one when the platform owner acts for a tenant.
-- `anon` loses EXECUTE: every branch requires the platform owner or a tenant admin, which an
-- anonymous caller can never be, so the grant only ever reached the refusal.
DROP FUNCTION IF EXISTS public.handle_data_subject_request(uuid, uuid, text, jsonb, text);
CREATE FUNCTION public.handle_data_subject_request(_tenant_id uuid, _contact_id uuid, _request_type text, _corrections jsonb DEFAULT NULL::jsonb, _reason text DEFAULT NULL::text, _actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _service boolean := auth.uid() IS NULL AND auth.role() = 'service_role';
  _actor uuid;
  _is_platform_owner boolean := false;
  _is_tenant_admin boolean := false;
  _contact record;
  _export jsonb;
  _allowed_correction_fields text[] := ARRAY[
    'first_name','last_name','email','phone','entity_name',
    'street_address','city','state','zip_code'
  ];
  _aliases jsonb := '{"zip":"zip_code","address_line1":"street_address"}'::jsonb;
  _patch jsonb := '{}'::jsonb;
  _ignored text[] := '{}'::text[];
  _k text;
  _field text;
  _v jsonb;
  _expected jsonb;
  _methods jsonb;
  _removed integer;
BEGIN
  IF _caller IS NOT NULL THEN
    IF _actor_user_id IS NOT NULL AND _actor_user_id <> _caller THEN
      RAISE EXCEPTION 'forbidden: a signed-in caller acts only as themselves';
    END IF;
    _actor := _caller;
    _is_platform_owner := public.is_platform_owner();
    _is_tenant_admin := public.is_tenant_admin(_tenant_id);
  ELSIF _service THEN
    IF _actor_user_id IS NULL THEN
      RAISE EXCEPTION 'actor_required: name the person this data subject request is handled for';
    END IF;
    _actor := _actor_user_id;
    _is_platform_owner := public.is_platform_owner(_actor);
    _is_tenant_admin := EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = _tenant_id AND tm.user_id = _actor
         AND tm.status = 'active' AND tm.role IN ('owner','admin'));
  END IF;

  IF NOT (_is_platform_owner OR _is_tenant_admin) THEN
    RAISE EXCEPTION 'forbidden: only tenant admins may handle data subject requests';
  END IF;

  IF _request_type NOT IN ('export','delete','correct','portability') THEN
    RAISE EXCEPTION 'invalid_request_type: %', _request_type;
  END IF;

  SELECT * INTO _contact FROM public.clients
   WHERE id = _contact_id AND tenant_id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact_not_found_in_tenant';
  END IF;

  IF _request_type = 'correct' THEN
    IF _corrections IS NULL OR jsonb_typeof(_corrections) <> 'object' THEN
      RAISE EXCEPTION 'corrections_required_for_correct';
    END IF;
    FOR _k, _v IN SELECT key, value FROM jsonb_each(_corrections) ORDER BY key LOOP
      _field := COALESCE(_aliases->>_k, _k);
      IF NOT (_field = ANY(_allowed_correction_fields))
         OR jsonb_typeof(_v) = 'null'
         OR (_field IN ('email','phone') AND NULLIF(btrim(_v #>> '{}'), '') IS NULL) THEN
        _ignored := _ignored || _k;
      -- A field's own name wins over its old alias when both are sent.
      ELSIF _k = _field OR NOT (_patch ? _field) THEN
        _patch := _patch || jsonb_build_object(_field, _v);
      ELSE
        _ignored := _ignored || _k;
      END IF;
    END LOOP;
    IF _patch = '{}'::jsonb THEN
      RAISE EXCEPTION 'no_allowed_correction_fields_present';
    END IF;
  END IF;

  -- Log to pii_access_log (7-year retention marker in payload)
  INSERT INTO public.pii_access_log (accessed_user_id, accessor_user_id, table_name, field_names, access_type)
  VALUES (
    COALESCE(_contact.linked_user_id, _actor),
    _actor,
    'clients',
    CASE _request_type
      WHEN 'correct' THEN ARRAY(SELECT jsonb_object_keys(_patch) ORDER BY 1)
      WHEN 'delete' THEN ARRAY['first_name','last_name','contact_methods','street_address','city','state','zip_code']
      ELSE ARRAY['clients','contact_methods','notes','deals','files','memory']
    END,
    CASE WHEN _request_type IN ('export','portability') THEN 'read' ELSE 'update' END
  );

  INSERT INTO public.paige_audit_log (actor_user_id, actor_role, action, target_type, target_id, tenant_id, payload)
  VALUES (
    _actor,
    CASE WHEN _is_platform_owner THEN 'platform_owner' ELSE 'tenant_admin' END,
    'dsr.' || _request_type,
    'clients',
    _contact_id,
    _tenant_id,
    jsonb_build_object(
      'tenant_id', _tenant_id,
      'reason', _reason,
      'via', CASE WHEN _service THEN 'service' ELSE 'session' END,
      'retention_years', 7,
      'retention_expires_at', (now() + interval '7 years')
    )
  );

  IF _request_type IN ('export','portability') THEN
    SELECT jsonb_build_object(
      'contact', to_jsonb(_contact) - 'ssn_encrypted',
      'contact_methods', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', m.kind, 'value', m.value, 'label', m.label, 'is_primary', m.is_primary, 'position', m.position) ORDER BY m.kind, m.position)
                                     FROM public.client_contact_methods m WHERE m.client_id = _contact_id), '[]'::jsonb),
      'notes', COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM public.client_notes n WHERE n.contact_id = _contact_id), '[]'::jsonb),
      'deals', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM public.deals d WHERE d.contact_client_id = _contact_id), '[]'::jsonb),
      'files', COALESCE((SELECT jsonb_agg(to_jsonb(f)) FROM public.client_files f WHERE f.contact_id = _contact_id), '[]'::jsonb),
      'memory', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM public.client_memory m WHERE m.client_id = _contact_id), '[]'::jsonb)
    ) INTO _export;
    RETURN jsonb_build_object(
      'ok', true,
      'request_type', _request_type,
      'format', CASE WHEN _request_type = 'portability' THEN 'json_portable' ELSE 'json' END,
      'data', _export
    );
  END IF;

  IF _request_type = 'correct' THEN
    IF _patch ? 'email' OR _patch ? 'phone' THEN
      _expected := public._client_contact_methods_payload(_contact_id);
      _methods := public.contact_methods_with_primary(_expected, 'email', _patch->>'email');
      _methods := public.contact_methods_with_primary(_methods, 'phone', _patch->>'phone');
      PERFORM public._replace_client_contact_methods_checked(_tenant_id, _contact_id, _methods, _expected);
    END IF;
    UPDATE public.clients c
       SET first_name     = COALESCE(_patch->>'first_name', c.first_name),
           last_name      = COALESCE(_patch->>'last_name', c.last_name),
           entity_name    = COALESCE(_patch->>'entity_name', c.entity_name),
           street_address = COALESCE(_patch->>'street_address', c.street_address),
           city           = COALESCE(_patch->>'city', c.city),
           state          = COALESCE(_patch->>'state', c.state),
           zip_code       = COALESCE(_patch->>'zip_code', c.zip_code),
           updated_at     = now()
     WHERE c.id = _contact_id AND c.tenant_id = _tenant_id;
    RETURN jsonb_build_object('ok', true, 'request_type','correct','applied', _patch, 'ignored', to_jsonb(_ignored));
  END IF;

  IF _request_type = 'delete' THEN
    -- Serialize with the canonical address writers before taking the DELETE snapshot.
    -- Otherwise a replacement can commit while DELETE waits on an old address tuple:
    -- the old tuple is skipped and its newly inserted replacement is never seen.
    PERFORM 1 FROM public.clients
     WHERE id = _contact_id AND tenant_id = _tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'contact_not_found_in_tenant';
    END IF;
    -- Soft delete: null PII and mark deletion; keeps audit trail intact.
    DELETE FROM public.client_contact_methods m
     WHERE m.client_id = _contact_id AND m.tenant_id = _tenant_id;
    GET DIAGNOSTICS _removed = ROW_COUNT;
    UPDATE public.clients
       SET first_name = 'REDACTED', last_name = 'REDACTED',
           street_address = NULL, city = NULL, state = NULL, zip_code = NULL,
           status = 'archived',
           updated_at = now()
     WHERE id = _contact_id AND tenant_id = _tenant_id;
    RETURN jsonb_build_object('ok', true, 'request_type','delete','redacted', true, 'addresses_removed', _removed);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error','unhandled');
END;
$function$;
REVOKE ALL ON FUNCTION public.handle_data_subject_request(uuid, uuid, text, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_data_subject_request(uuid, uuid, text, jsonb, text, uuid) TO authenticated, service_role;

-- ─── lookup_client_by_account_number ────────────────────────────────────────────────────────
-- Live md5(prosrc) 06efc2db5b2dadb76b68cf97a69c574e. No caller in the repository; kept, with its
-- output columns unchanged. Changed: `email` / `phone` are the contact's primary addresses.
CREATE OR REPLACE FUNCTION public.lookup_client_by_account_number(_account_number text)
 RETURNS TABLE(id uuid, tenant_id uuid, account_number text, linked_user_id uuid, first_name text, last_name text, email text, phone text, entity_name text, lifecycle_stage text, status text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id, c.tenant_id, c.account_number, c.linked_user_id,
         c.first_name, c.last_name,
         public.client_primary_address(c.id, 'email'),
         public.client_primary_address(c.id, 'phone'),
         c.entity_name, c.lifecycle_stage::text, c.status::text, c.created_at
  FROM public.clients c
  WHERE c.account_number = _account_number
    AND (public.is_platform_owner() OR c.tenant_id = public.current_user_tenant_id())
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.lookup_client_by_account_number(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_client_by_account_number(text) TO authenticated, service_role;

-- ─── create_internal_booking ────────────────────────────────────────────────────────────────
-- Live md5(prosrc) 22b7f7db25a7af1fddc0a381dc125b46. Changed: with a contact named and no guest
-- email given, the booking's guest email is the contact's PRIMARY email.
CREATE OR REPLACE FUNCTION public.create_internal_booking(_title text, _start_at timestamp with time zone, _end_at timestamp with time zone, _timezone text DEFAULT 'UTC'::text, _contact_id uuid DEFAULT NULL::uuid, _host_user_id uuid DEFAULT NULL::uuid, _guest_name text DEFAULT NULL::text, _guest_email text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _location text DEFAULT NULL::text, _tenant_id uuid DEFAULT NULL::uuid, _calendar_id uuid DEFAULT NULL::uuid, _appointment_type jsonb DEFAULT NULL::jsonb, _intake_answers jsonb DEFAULT NULL::jsonb, _guest_phone text DEFAULT NULL::text, _status text DEFAULT 'scheduled'::text, _source text DEFAULT 'paige'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := COALESCE(_tenant_id, public.current_user_tenant_id());
  _host uuid := COALESCE(_host_user_id, auth.uid());
  _id uuid; _gname text; _gemail text; _found boolean;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN: auth required' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_platform_owner()
          OR (_tenant IS NOT NULL AND public.is_tenant_admin(_tenant))
          OR (_tenant IS NOT NULL AND public.is_tenant_member(_tenant)
              AND public.has_any_role(_caller, ARRAY['admin','super_admin']))) THEN
    RAISE EXCEPTION 'BOOKING_FORBIDDEN: staff of this tenant required' USING ERRCODE='42501';
  END IF;
  IF _end_at <= _start_at THEN RAISE EXCEPTION 'BOOKING_BAD_TIME: end must be after start' USING ERRCODE='22023'; END IF;
  IF COALESCE(btrim(_title), '') = '' THEN RAISE EXCEPTION 'BOOKING_TITLE_REQUIRED' USING ERRCODE='22023'; END IF;
  IF _calendar_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.calendars c WHERE c.id = _calendar_id AND c.tenant_id IS NOT DISTINCT FROM _tenant
     ) THEN
    RAISE EXCEPTION 'BOOKING_BAD_CALENDAR: calendar not in this tenant' USING ERRCODE='22023';
  END IF;
  IF _host IS NOT NULL AND _host <> _caller THEN
    IF _tenant IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = _tenant AND tm.user_id = _host AND tm.status = 'active'
       ) THEN
      RAISE EXCEPTION 'BOOKING_BAD_HOST: host is not a member of this tenant' USING ERRCODE='22023';
    END IF;
  END IF;

  IF _contact_id IS NOT NULL THEN
    SELECT COALESCE(_guest_name, btrim(concat_ws(' ', cl.first_name, cl.last_name))),
           COALESCE(_guest_email, public.client_primary_address(cl.id, 'email')),
           true
      INTO _gname, _gemail, _found
      FROM public.clients cl WHERE cl.id = _contact_id AND cl.tenant_id IS NOT DISTINCT FROM _tenant;
    IF NOT COALESCE(_found, false) THEN
      RAISE EXCEPTION 'BOOKING_BAD_CONTACT: contact not in this tenant' USING ERRCODE='22023';
    END IF;
  ELSE
    _gname := _guest_name; _gemail := _guest_email;
  END IF;

  INSERT INTO public.internal_bookings (
    tenant_id, calendar_id, host_user_id, contact_id, guest_name, guest_email, guest_phone,
    title, notes, location, start_at, end_at, timezone,
    status, source, booking_kind, appointment_type, intake_answers, reminder_state
  ) VALUES (
    _tenant, _calendar_id, _host, _contact_id, _gname, _gemail, _guest_phone,
    btrim(_title), _notes, _location, _start_at, _end_at, COALESCE(NULLIF(btrim(_timezone), ''), 'UTC'),
    COALESCE(NULLIF(btrim(_status), ''), 'scheduled'), COALESCE(NULLIF(btrim(_source), ''), 'paige'),
    'single', _appointment_type, _intake_answers, '{}'::jsonb
  )
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'internal_booking', 'create_internal_booking', _id,
          jsonb_build_object('tenant_id', _tenant, 'host_user_id', _host, 'contact_id', _contact_id,
                             'calendar_id', _calendar_id, 'start_at', _start_at));
  RETURN _id;
END $function$;
REVOKE ALL ON FUNCTION public.create_internal_booking(text, timestamp with time zone, timestamp with time zone, text, uuid, uuid, text, text, text, text, uuid, uuid, jsonb, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_internal_booking(text, timestamp with time zone, timestamp with time zone, text, uuid, uuid, text, text, text, text, uuid, uuid, jsonb, jsonb, text, text, text) TO authenticated, service_role;

-- ─── seed_agreement_counterparty (trigger on paige_agreements) ──────────────────────────────
-- Live md5(prosrc) 08c42ad2e9f7a76c5cdbee7b665a7c0d (20270405000000). Changed: the counterparty
-- signer's address is the contact's PRIMARY email. scripts/agreements/run-integrity-proof.sh
-- applies this definition on top of the migrations it replays, so the proof exercises it.
CREATE OR REPLACE FUNCTION public.seed_agreement_counterparty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _email text;
  _name  text;
BEGIN
  SELECT btrim(coalesce(public.client_primary_address(c.id, 'email'), '')),
         btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''))
    INTO _email, _name
    FROM public.clients c
   WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id;

  -- No address means no signer, and the send path's refusal is then the truth rather than a dead
  -- end: the owner adds one explicitly. Never invent an address to make a flow appear to work.
  IF _email IS NULL OR position('@' in _email) < 2 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.paige_agreement_signers
    (agreement_id, tenant_id, full_name, email, signer_role, signing_order)
  VALUES
    (NEW.id, NEW.tenant_id,
     CASE WHEN coalesce(_name,'') = '' THEN split_part(_email, '@', 1) ELSE _name END,
     _email, 'counterparty', 1)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ─── start_client_impersonation ─────────────────────────────────────────────────────────────
-- Live md5(prosrc) f926e3457b5209943c19b3cd052b5300. Changed: a contact with no name is labelled
-- by its PRIMARY email.
CREATE OR REPLACE FUNCTION public.start_client_impersonation(p_contact_id uuid)
 RETURNS TABLE(contact_id uuid, linked_user_id uuid, client_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_row    record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.can_access_contact(v_caller, p_contact_id) THEN
    RAISE EXCEPTION 'not authorized for this contact';
  END IF;

  SELECT c.id, c.linked_user_id, c.agreement_signed_at, c.onboarding_stage,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
                  public.client_primary_address(c.id, 'email'),
                  'Client') AS name
    INTO v_row
  FROM public.clients c
  WHERE c.id = p_contact_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact not found';
  END IF;

  IF v_row.linked_user_id IS NULL THEN
    RAISE EXCEPTION 'client has not accepted their invite yet';
  END IF;

  IF v_row.agreement_signed_at IS NULL THEN
    RAISE EXCEPTION 'client has not signed the agreement yet';
  END IF;

  IF v_row.onboarding_stage <> 'completed' THEN
    RAISE EXCEPTION 'client has not completed onboarding (stage: %)', v_row.onboarding_stage;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, data)
  VALUES (v_caller, 'impersonation.start', 'client', v_row.id,
          jsonb_build_object('linked_user_id', v_row.linked_user_id, 'client_name', v_row.name));

  contact_id := v_row.id;
  linked_user_id := v_row.linked_user_id;
  client_name := v_row.name;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public.start_client_impersonation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_client_impersonation(uuid) TO authenticated, service_role;

-- ─── trg_clients_apollo_enrich: removed ─────────────────────────────────────────────────────
-- An AFTER INSERT trigger on clients that read NEW.email. Moving it to client_contact_methods was
-- considered and rejected on the evidence, read on production 2026-09-29:
--   * it POSTs to a Supabase project that is not this one (ref bfmyebsjyuoecmjskqhs; ours is
--     xygzykjyynhzqytbqnzu) — the same foreign host 20260926000000 purged from two other functions;
--   * it authenticates with that project's hard-coded anon key, while this repository's
--     apollo-enrich-person accepts only the exact service-role bearer as an internal call
--     (docs/audits/phase2b-privileged-function-audit-2026-07-25.md §2 records the mismatch);
--   * so it has never enriched a contact here, and while paige_config.apollo_auto_enrich is true
--     (it is) every new client with an email sends that email and the contact's id to the other
--     project.
-- Owner approved retirement on 2026-09-29. Enrichment on demand is unchanged; the retired switch
-- and its config writer are removed, and the Apollo settings/catalogue explicitly say automatic
-- enrichment is unavailable. The foreign URL and key are deliberately not reproduced here.
DROP TRIGGER IF EXISTS trg_clients_apollo_enrich ON public.clients;
DROP FUNCTION IF EXISTS public.trg_clients_apollo_enrich();
