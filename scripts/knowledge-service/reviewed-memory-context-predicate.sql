  AND (
    NOT (m.metadata ? 'reviewed_save')
    OR (
      (SELECT public.knowledge_actor_authorized(v_uid,v_tenant))
      AND m.metadata#>'{reviewed_save,schema_version}'='1'::jsonb
      AND m.metadata#>>'{reviewed_save,expected_actor}'=v_uid::text
      AND m.metadata#>>'{reviewed_save,expected_tenant}'=v_tenant::text
      AND m.metadata#>'{reviewed_save,source_reference,contractVersion}'='1'::jsonb
      AND m.metadata#>>'{reviewed_save,source_reference,tenantId}'=v_tenant::text
      AND EXISTS (
        SELECT 1 FROM public.tenant_knowledge_docs d
        WHERE d.tenant_id=v_tenant AND d.record_state='canonical'
          AND d.id=CASE WHEN (m.metadata#>>'{reviewed_save,source_reference,documentId}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (m.metadata#>>'{reviewed_save,source_reference,documentId}')::uuid ELSE NULL::uuid END
          AND d.revision::text=m.metadata#>>'{reviewed_save,source_reference,revision}'
          AND encode(sha256(convert_to(d.content,'UTF8')),'hex')=m.metadata#>>'{reviewed_save,source_reference,contentSha256}'
          AND char_length(m.metadata#>>'{reviewed_save,source_quote}') BETWEEN 1 AND 2000
          AND strpos(d.content,m.metadata#>>'{reviewed_save,source_quote}')>0
      )
    )
  )
