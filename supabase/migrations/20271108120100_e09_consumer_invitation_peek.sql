-- CLI-created forward correction above the recorded Preview/production frontier.
-- Retain the preceding migration exactly as recorded; no branch reset or data change.
BEGIN;

-- Consumer acceptance has always been single-use, including legacy tokens with
-- max_uses=NULL. The existing public reader must offer login-only recovery once
-- consumed. Keep staff/agency limits and the complete existing brand/ACL intact.
DO $consumer_peek$
DECLARE
  _def text := pg_get_functiondef('public.peek_tenant_invite(text)'::regprocedure);
  _old text := $peekold$  is_valid      := (_tok.revoked_at IS NULL)
                   AND (_tok.expires_at > now())
                   AND (_tok.max_uses IS NULL OR _tok.uses < _tok.max_uses);$peekold$;
  _new text := $peeknew$  -- E09_CONSUMER_INVITE_PEEK_V1
  is_valid      := (_tok.revoked_at IS NULL)
                   AND (_tok.expires_at > now())
                   AND (_tok.max_uses IS NULL OR _tok.uses < _tok.max_uses)
                   AND (_tok.kind <> 'consumer' OR (_tok.uses = 0 AND _tok.last_used_at IS NULL));$peeknew$;
BEGIN
  IF strpos(_def,'E09_CONSUMER_INVITE_PEEK_V1') = 0 THEN
    IF strpos(_def,_old) = 0
      OR (length(_def)-length(replace(_def,_old,'')))/length(_old) <> 1 THEN
      RAISE EXCEPTION 'public invitation validity predecessor changed; reconcile before customer entry';
    END IF;
    EXECUTE replace(_def,_old,_new);
  END IF;
END;
$consumer_peek$;

COMMIT;
