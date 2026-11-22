-- PREPARATION ONLY: read-only catalog for original immutable Social34.
-- No release invocation, ledger repair, business rows, credentials or provider calls.
WITH targets(signature) AS (VALUES
 ('public.content_publication_bind(uuid,uuid,uuid,text,uuid,uuid,jsonb)'),
 ('public.content_publication_list(uuid,uuid)'),
 ('public.content_publication_record(uuid,uuid,text,text,text,text,text,jsonb)'),
 ('public._team_hub_card_scope_guard()'),
 ('public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)'),
 ('public.team_hub_post_agent_message(uuid,uuid,text,text,uuid,uuid,uuid,text,text,boolean,uuid,text,jsonb,text)'),
 ('public.team_hub_settle_card(uuid,uuid,uuid,jsonb)'),
 ('public.team_hub_card_states(uuid,uuid,uuid[])')
), functions AS (
 SELECT t.signature,md5(p.prosrc) body_md5,
  md5(((to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object(
   'defaults_ast',regexp_replace(p.proargdefaults::text,':location -?[0-9]+',':location -1','g'),
   'defaults_expr',pg_get_expr(p.proargdefaults,0)))::text) metadata_md5,
  p.proowner::regrole::text owner,p.prosecdef definer,p.provolatile::text volatility,
  p.proconfig config,p.proacl::text acl,pg_get_expr(p.proargdefaults,0) defaults
 FROM targets t LEFT JOIN pg_proc p ON p.oid=to_regprocedure(t.signature)
)
SELECT jsonb_build_object(
 'frontier',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'prerequisites',(SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,
  'statements_md5',md5(array_to_string(statements,E'\n'))) ORDER BY version),'[]'::jsonb)
  FROM supabase_migrations.schema_migrations
  WHERE version IN ('20271133000033','20271133000034','20271133000037','20271133000038','20271133000039')),
 'ledger_without34',(SELECT md5(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements)
  ORDER BY version)::text) FROM supabase_migrations.schema_migrations WHERE version<>'20271133000034'),
 'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY signature) FROM functions f),
 'private_history',(SELECT jsonb_build_object('body_md5',md5(prosrc),'metadata_md5',md5((to_jsonb(p)-'prosrc')::text))
  FROM pg_proc p WHERE oid=to_regprocedure('public._team_hub_planning_read_annotations(public.team_hub_agent_turns)')),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('relation',conrelid::regclass::text,'name',conname,
  'type',contype,'validated',convalidated,'definition',pg_get_constraintdef(oid)) ORDER BY conname)
  FROM pg_constraint WHERE (conrelid='public.content_publications'::regclass AND conname='content_publications_status_check')
   OR (conrelid='public.team_hub_message_cards'::regclass AND conname='team_hub_message_cards_kind_chk')),
 'nexus_seed',(SELECT jsonb_build_object('count',count(*),'config_without_tools',
   md5(jsonb_agg(config#-'{capability_scope,tools}' ORDER BY id)::text),
   'tools',jsonb_agg(config#>'{capability_scope,tools}' ORDER BY id))
  FROM public.paige_subagents WHERE tenant_id IS NULL AND slug='nexus'),
 'roster_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
  'definition',pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text,'body_md5',md5(p.prosrc)) ORDER BY t.tgname),'[]'::jsonb)
  FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.paige_subagents'::regclass AND NOT t.tgisinternal)
) AS contract;
