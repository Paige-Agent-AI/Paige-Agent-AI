-- Owner-ruled defect fix (R5, 2026-09-27): tenant-less memory recall has never worked.
--
-- match_paige_owner_memory filtered `m.tenant_id = _tenant_id`. A platform operator belongs to no
-- tenant, so their memory rows carry tenant_id NULL, and `NULL = NULL` is never true: semantic
-- recall for a tenant-less operator returned nothing, by construction. get_paige_memory,
-- record_paige_memory and forget_paige_memory already compare with IS NOT DISTINCT FROM; this
-- brings the one outlier into line. Nothing else changes: the authorization block, the grants, the
-- search_path (pgvector's <=> lives in `extensions`) and every other predicate are as they were.
--
-- Scope stays the caller's own: the user filter is unchanged, and a JWT caller is still confined to
-- (auth.uid(), current_user_tenant_id()). A NULL tenant now matches exactly the rows that carry no
-- tenant for that same user — never another tenant's rows, and never another user's.
--
-- And a JWT caller with no tenant must be the platform owner, exactly as get_paige_memory,
-- record_paige_memory, forget_paige_memory and paige_owner_memory's own RLS already require
-- (PAIGE_MEMORY_NO_WORKSPACE). Without it, this DEFINER seam would let any signed-in user with no
-- workspace recall tenant-less rows a service writer had filed under them, past the table's
-- owner-only RLS. Which operator tiers hold tenant-less memory moves with the rest of the memory
-- fabric when the operator helpers move onto operator_standing() (G3), not here.
CREATE OR REPLACE FUNCTION public.match_paige_owner_memory(
  _query_embedding vector,
  _tenant_id       uuid,
  _user_id         uuid,
  _match_threshold double precision DEFAULT 0.7,
  _match_count     integer DEFAULT 8
)
RETURNS TABLE(id uuid, memory_type text, content text, similarity double precision, created_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- §9 authorization: a JWT caller is confined to their own tenant + own user; service_role trusts
  -- the server-resolved args it passes. Anything else is refused — no cross-tenant/user reads.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS DISTINCT FROM _user_id
       OR _tenant_id IS DISTINCT FROM public.current_user_tenant_id() THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;
    IF _tenant_id IS NULL AND NOT public.is_platform_owner() THEN
      RAISE EXCEPTION 'PAIGE_MEMORY_NO_WORKSPACE' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT m.id, m.memory_type, m.content,
         1 - (m.embedding <=> _query_embedding) AS similarity,
         m.created_at
  FROM public.paige_owner_memory m
  WHERE m.is_active = true
    AND m.embedding IS NOT NULL
    AND m.tenant_id IS NOT DISTINCT FROM _tenant_id
    AND m.user_id = _user_id
    AND 1 - (m.embedding <=> _query_embedding) >= _match_threshold
  ORDER BY m.embedding <=> _query_embedding
  LIMIT _match_count;
END;
$function$;
