-- Same original disposable native fixture; presentation caps never erase sources.
SAVEPOINT e5_links;
INSERT INTO public.plans(id,tenant_id,created_by,owner_user_id,title) VALUES
 ('e5000000-0000-4000-8000-000000000201',:'ta',:'u3',:'u3','Link group A'),
 ('e5000000-0000-4000-8000-000000000202',:'ta',:'u3',:'u3','Link group B');
INSERT INTO public.plan_items(id,tenant_id,plan_id,item_type,created_by,assigned_to_user_id,title)
 SELECT ('e5000000-0000-4000-8000-'||lpad((300+n)::text,12,'0'))::uuid,:'ta'::uuid,
 CASE WHEN n<=4 THEN 'e5000000-0000-4000-8000-000000000201' ELSE 'e5000000-0000-4000-8000-000000000202' END::uuid,
 'task',:'u3'::uuid,:'u3'::uuid,'Original link-group item '||n FROM generate_series(1,8) n;
SELECT pg_temp.post(:'u3',:'ta',:'e5dm','Review eight original Planning items')->'message'->>'id' AS e5linkq \gset
SELECT pg_temp.accept(:'ta',:'u3',:'e5dm',:'e5linkq','zion','dm',pg_temp.tok('E5-links')) AS e5linkturn \gset
SELECT pg_temp.planning_binding(:'u3',:'ta','{"plan_id":"e5000000-0000-4000-8000-000000000201"}') AS e5linka \gset
SELECT pg_temp.planning_binding(:'u3',:'ta','{"plan_id":"e5000000-0000-4000-8000-000000000202"}') AS e5linkb \gset
SELECT jsonb_agg(jsonb_build_object('destination','operations_work','record_id',i->'id','record_kind','planning_item') ORDER BY i->>'id') AS e5linksa
 FROM jsonb_array_elements((:'e5linka')::jsonb#>'{source,plans}') p CROSS JOIN LATERAL jsonb_array_elements(p->'items') i \gset
SELECT jsonb_agg(jsonb_build_object('destination','operations_work','record_id',i->'id','record_kind','planning_item') ORDER BY i->>'id') AS e5linksb
 FROM jsonb_array_elements((:'e5linkb')::jsonb#>'{source,plans}') p CROSS JOIN LATERAL jsonb_array_elements(p->'items') i \gset
SELECT pg_temp.check(jsonb_array_length((:'e5linksa')::jsonb)=4 AND jsonb_array_length((:'e5linksb')::jsonb)=4,
 'EXP05 two permitted Planning reads each provide four original navigation links');
SELECT pg_temp.planning_stage((:'e5linkturn')::jsonb->>'turn_id',pg_temp.tok('E5-links'),(:'e5linka')::jsonb,(:'e5linksa')::jsonb) AS e5linkfirst \gset
SELECT pg_temp.check((:'e5linkfirst')::jsonb->>'ok'='true','EXP05 first four-link Planning stage succeeds');
SELECT pg_temp.planning_stage((:'e5linkturn')::jsonb->>'turn_id',pg_temp.tok('E5-links'),(:'e5linkb')::jsonb,(:'e5linksb')::jsonb) AS e5linksecond \gset
SELECT pg_temp.check((:'e5linksecond')::jsonb->>'ok'='true',
 'EXP05 valid second Planning read must cap navigation without rejecting full sources: '||:'e5linksecond');
-- The ORIGINAL plan-id query also returns its permitted loose items. Preserve
-- that complete union rather than assuming only the eight navigation targets.
SELECT jsonb_agg(DISTINCT id ORDER BY id) AS e5linkitems FROM (
 SELECT i->'id' id FROM jsonb_array_elements(jsonb_build_array((:'e5linka')::jsonb,(:'e5linkb')::jsonb)) b
 CROSS JOIN LATERAL jsonb_array_elements(b#>'{source,plans}') p CROSS JOIN LATERAL jsonb_array_elements(p->'items') i
 UNION ALL SELECT i->'id' FROM jsonb_array_elements(jsonb_build_array((:'e5linka')::jsonb,(:'e5linkb')::jsonb)) b
 CROSS JOIN LATERAL jsonb_array_elements(b#>'{source,loose_items}') i) actual_sources \gset
SELECT pg_temp.check((SELECT jsonb_array_length(read_context->'record_links')=6
 AND read_context#>'{planning,items}'=(:'e5linkitems')::jsonb AND jsonb_array_length(read_context#>'{planning,observations}')=2
 FROM public.team_hub_agent_turns WHERE id=((:'e5linkturn')::jsonb->>'turn_id')::uuid),
 'EXP05 six navigation links retain the complete original source union and both observations');
SELECT read_context AS e5linkcontext FROM public.team_hub_agent_turns WHERE id=((:'e5linkturn')::jsonb->>'turn_id')::uuid \gset
SELECT pg_temp.check(pg_temp.planning_stage((:'e5linkturn')::jsonb->>'turn_id',pg_temp.tok('E5-links'),(:'e5linkb')::jsonb,(:'e5linksb')::jsonb)->>'ok'='true'
 AND (SELECT read_context->'record_links'=(:'e5linkcontext')::jsonb->'record_links'
 AND read_context->'planning'=(:'e5linkcontext')::jsonb->'planning' FROM public.team_hub_agent_turns
 WHERE id=((:'e5linkturn')::jsonb->>'turn_id')::uuid),'EXP05 repeated staged read neither loses sources nor adds navigation links');
SELECT read_context AS e5beforebadlink FROM public.team_hub_agent_turns WHERE id=((:'e5linkturn')::jsonb->>'turn_id')::uuid \gset
SELECT pg_temp.check(pg_temp.planning_stage((:'e5linkturn')::jsonb->>'turn_id',pg_temp.tok('E5-links'),(:'e5linkb')::jsonb,
 (:'e5linksb')::jsonb||'[{"destination":"operations_work","record_id":"e5000000-0000-4000-8000-000000000012","record_kind":"planning_item"}]')->>'ok'='false'
 AND (SELECT read_context=(:'e5beforebadlink')::jsonb FROM public.team_hub_agent_turns
 WHERE id=((:'e5linkturn')::jsonb->>'turn_id')::uuid),'EXP05 foreign navigation still refuses before capping, with no staged change');
SELECT gen_random_uuid()::text AS e5linkrequest \gset
SELECT pg_temp.apost(:'u3',:'ta',:'e5dm','zion','Eight original Planning items reviewed.',:'e5linkrequest',NULL,:'e5linkq','dm',pg_temp.tok('E5-links')) AS e5linkposted \gset
SELECT pg_temp.check((:'e5linkposted')::jsonb->>'ok'='true','EXP05 multi-read capped navigation permits original publication');
SELECT pg_temp.check(pg_temp.apost(:'u3',:'ta',:'e5dm','zion','Eight original Planning items reviewed.',:'e5linkrequest',NULL,:'e5linkq','dm',pg_temp.tok('E5-links'))#>>'{message,id}'
 =(:'e5linkposted')::jsonb#>>'{message,id}','EXP05 multi-read lost acknowledgment returns the same original reply');
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5dm')) AS e5linkhistory \gset
SELECT pg_temp.check((:'e5linkhistory') LIKE '%Eight original Planning items reviewed.%','EXP05 original multi-read answer reopens');
SELECT sources.value#>>'{}' AS e5unlinked FROM public.team_hub_agent_turns t
 CROSS JOIN LATERAL jsonb_array_elements(t.read_context#>'{planning,items}') AS sources(value)
 WHERE t.id=((:'e5linkturn')::jsonb->>'turn_id')::uuid AND sources.value#>>'{}' LIKE 'e5000000-0000-4000-8000-0000000003%'
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(t.read_context->'record_links') l WHERE l->'record_id'=sources.value)
 ORDER BY sources.value LIMIT 1 \gset
UPDATE public.plan_items SET created_by=:'u2',assigned_to_user_id=:'u2' WHERE id=:'e5unlinked'::uuid;
SELECT pg_temp.j(:'u3',format('public.team_hub_list_messages(%L::uuid,%L::uuid)',:'ta',:'e5dm')) AS e5unlinkedhistory \gset
SELECT pg_temp.check((:'e5unlinkedhistory') NOT LIKE '%Eight original Planning items reviewed.%' AND (:'e5unlinkedhistory') LIKE '%source_unavailable%',
 'EXP05 source revocation beyond the six navigation links still masks the complete answer');
SELECT pg_temp.j(:'u3',format('public.team_hub_search(%L::uuid,''eight'')',:'ta')) AS e5unlinkedsearch \gset
SELECT pg_temp.check(NOT EXISTS(SELECT 1 FROM jsonb_array_elements((:'e5unlinkedsearch')::jsonb->'results') r
 WHERE r->>'message_id'=(:'e5linkposted')::jsonb#>>'{message,id}'),'EXP05 unlinked source revocation still removes original Search result');
ROLLBACK TO e5_links;
\echo 'PASS: EXP05 accumulated navigation caps at six without dropping sources, accepting foreign links or duplicating/revealing a revoked reply'
