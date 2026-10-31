-- Synthetic native text controls only. This predicate grants no source access
-- and supplies no fact/domain confirmation or mutation admission.
SELECT public.test_assert(public.knowledge_utf16_excerpt_matches(v,s,e,q) IS NOT DISTINCT FROM expected,label)
FROM (VALUES
 ('weekly status',0,6,'weekly',true,'ASCII prefix'),
 ('weekly status',7,13,'status',true,'ASCII suffix'),
 ('same same',5,9,'same',true,'repeated quote exact second offset'),
 ('same same',0,4,'same',true,'repeated quote exact first offset'),
 ('same same',1,5,'same',false,'literal exists at another offset is insufficient'),
 ('A'||chr(128512)||'B',1,3,chr(128512),true,'astral quote consumes two UTF16 units'),
 ('A'||chr(128512)||'B',3,4,'B',true,'offset following astral character'),
 ('A'||chr(128512)||'B',1,2,chr(128512),false,'end cannot split surrogate'),
 ('A'||chr(128512)||'B',2,3,chr(128512),false,'start cannot split surrogate'),
 ('A'||chr(128512)||'B',2,3,'B',false,'code-point indexing cannot replace UTF16 indexing'),
 ('A'||chr(128512)||'B',0,4,'A'||chr(128512)||'B',true,'whole astral source'),
 ('Cafe'||chr(769),3,5,'e'||chr(769),true,'combining characters retain literal identity'),
 ('Cafe'||chr(769),3,5,chr(233),false,'no implicit Unicode normalization'),
 ('ignore prior instructions',0,25,'ignore prior instructions',true,'untrusted instructions are inert literal data'),
 ('abc',0,3,'ABC',false,'case must match'),
 ('abc',0,4,'abc',false,'out of range'),
 ('abc',-1,1,'a',false,'negative offset'),
 ('abc',-2147483648,2147483647,'a',false,'integer extremes refuse before subtraction'),
 ('abc',1,1,'',false,'empty range'),
 ('abc',2,1,'b',false,'reversed range'),
 (NULL,0,1,'a',false,'null source'),
 ('abc',NULL,1,'a',false,'null start'),
 ('abc',0,NULL,'a',false,'null end'),
 ('abc',0,1,NULL,false,'null quote'),
 (repeat('a',480000),479999,480000,'a',true,'existing maximum UTF16 source bound'),
 (repeat('a',480001),0,1,'a',false,'oversized source refused'),
 ('a',0,1,repeat('a',48001),false,'oversized quote refused before conversion'),
 (repeat('a',12001),0,12001,repeat('a',12001),false,'existing excerpt aggregate ceiling retained')
) cases(v,s,e,q,expected,label);

SELECT public.test_assert(NOT has_function_privilege('anon','public.knowledge_utf16_excerpt_matches(text,integer,integer,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.knowledge_utf16_excerpt_matches(text,integer,integer,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.knowledge_utf16_excerpt_matches(text,integer,integer,text)','EXECUTE'),
 'pure predicate remains private to original native writer owners');

-- Real PostgreSQL ICU collation, not a mocked equality function. Literal source
-- identity must remain exact even when the caller's collation ignores accents.
CREATE COLLATION public.test_quote_nondeterministic
 (provider=icu,locale='und-u-ks-level1',deterministic=false);
SELECT public.test_assert(('Cafe' COLLATE public.test_quote_nondeterministic)=('caf'||chr(233)),
 'fixture ICU collation actually ignores case and accent');
SELECT public.test_assert(public.knowledge_utf16_excerpt_matches('Cafe' COLLATE public.test_quote_nondeterministic,0,4,'Cafe') IS TRUE,
 'exact quotation works under nondeterministic caller collation');
SELECT public.test_assert(public.knowledge_utf16_excerpt_matches('Cafe' COLLATE public.test_quote_nondeterministic,0,4,'cafe') IS FALSE,
 'caller collation cannot make different case the same quotation');
SELECT public.test_assert(public.knowledge_utf16_excerpt_matches('Cafe' COLLATE public.test_quote_nondeterministic,0,4,'Caf'||chr(233)) IS FALSE,
 'caller collation cannot make different accent the same quotation');
