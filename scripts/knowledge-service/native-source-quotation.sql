-- LOCAL unversioned private predicate. Not a source reader, approval receipt,
-- public RPC, production carrier or permission grant. The owning original writer
-- must separately lock/revalidate permitted source identity/version/SHA and the
-- original domain confirmation/approved intent before committing any effect.
BEGIN;
CREATE FUNCTION public.knowledge_utf16_excerpt_matches(
 p_content text,p_start integer,p_end integer,p_quote text
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path='' AS $quote$
DECLARE
 units integer; chars integer; requested integer; low integer; high integer;
 midpoint integer; prefix_units integer; matched integer; boundaries integer[]:='{}';
BEGIN
 IF p_content IS NULL OR p_start IS NULL OR p_end IS NULL OR p_quote IS NULL
  OR p_start<0 OR p_end<=p_start THEN RETURN false; END IF;
 IF p_end-p_start>12000 OR octet_length(p_content)>2097152
  OR octet_length(p_quote)>48000 THEN RETURN false; END IF;
 units:=public.knowledge_utf16_length(p_content COLLATE pg_catalog."C");
 IF units NOT BETWEEN 1 AND 480000 OR p_end>units
  OR public.knowledge_utf16_length(p_quote COLLATE pg_catalog."C")<>p_end-p_start THEN RETURN false; END IF;
 chars:=char_length(p_content);
 -- PostgreSQL indexes Unicode code points; existing JS evidence indexes UTF16.
 -- Locate exact code-point boundaries via the ORIGINAL UTF16 length helper.
 -- No rounding can turn a split surrogate pair into a different citation.
 FOREACH requested IN ARRAY ARRAY[p_start,p_end] LOOP
  low:=0; high:=chars; matched:=NULL;
  WHILE low<=high LOOP
   midpoint:=low+(high-low)/2;
   prefix_units:=public.knowledge_utf16_length(left(p_content,midpoint) COLLATE pg_catalog."C");
   IF prefix_units=requested THEN matched:=midpoint; EXIT;
   ELSIF prefix_units<requested THEN low:=midpoint+1;
   ELSE high:=midpoint-1;
   END IF;
  END LOOP;
  IF matched IS NULL THEN RETURN false; END IF;
  boundaries:=array_append(boundaries,matched);
 END LOOP;
 RETURN convert_to(substring(p_content FROM boundaries[1]+1 FOR boundaries[2]-boundaries[1]),'UTF8')=convert_to(p_quote,'UTF8');
END $quote$;
REVOKE ALL ON FUNCTION public.knowledge_utf16_excerpt_matches(text,integer,integer,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
