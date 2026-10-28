-- EXP09 private booking: durable request provenance ON THE ORIGINAL APPOINTMENT.
-- WIP: not an independently releasable migration. The original scheduling engine
-- and server-verified caller adapter must compose with the native commit below.
BEGIN;

DO $lease$
DECLARE expected jsonb; actual jsonb;
BEGIN
 FOR expected IN SELECT value FROM pg_catalog.jsonb_array_elements($contracts$[
  {"signature":"_client_portal_lock_relationship(uuid,text)","body":"416002c40cb71ed54cc4c3387c37563f","owner":"postgres","definer":true,"volatility":"v","language":"plpgsql","config":["search_path=\"\""],"acl":["postgres:EXECUTE:false"]},
  {"signature":"_client_portal_lock_verified_customer(uuid,uuid,uuid)","body":"2092a38c5d5b3810fd93fad108ccb19c","owner":"postgres","definer":true,"volatility":"v","language":"plpgsql","config":["search_path=\"\""],"acl":["postgres:EXECUTE:false"]},
  {"signature":"create_class_booking(uuid,uuid,uuid,timestamptz,timestamptz,text,integer,text,text,text,text,text,text,text,jsonb,text,uuid)","body":"8dee4ee76b1b4de00d52573fa7a8cb09","owner":"postgres","definer":true,"volatility":"v","language":"plpgsql","config":["search_path=public"],"acl":["postgres:EXECUTE:false","service_role:EXECUTE:false"]},
  {"signature":"operator_can_permanently_delete_accounts()","body":"f7f5281162f757fcbaa67ea088049208","owner":"postgres","definer":true,"volatility":"s","language":"sql","config":["search_path=public"],"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"]}
 ]$contracts$::jsonb) LOOP
  SELECT pg_catalog.jsonb_build_object('signature',expected->>'signature','body',pg_catalog.md5(p.prosrc),
   'owner',pg_catalog.pg_get_userbyid(p.proowner),'definer',p.prosecdef,'volatility',p.provolatile,
   'language',l.lanname,'config',p.proconfig,
   'acl',(SELECT pg_catalog.jsonb_agg(
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END
    ||':'||a.privilege_type||':'||a.is_grantable::text
    ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END)
    FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a))
  INTO actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE p.oid=pg_catalog.to_regprocedure('public.'||(expected->>'signature'));
  IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'Original private booking authority contract changed; reconcile' USING ERRCODE='42501';
  END IF;
 END LOOP;
END $lease$;

-- No legacy row is backfilled or given a customer authority it did not have.
ALTER TABLE public.internal_bookings
 ADD COLUMN portal_request_id uuid,
 ADD COLUMN portal_actor_user_id uuid,
 ADD COLUMN portal_origin_contact_id uuid,
 ADD COLUMN portal_request_intent jsonb,
 ADD COLUMN portal_group_size integer;
ALTER TABLE public.internal_bookings ADD CONSTRAINT internal_bookings_portal_request_shape CHECK (
 (portal_request_id IS NULL AND portal_actor_user_id IS NULL AND portal_origin_contact_id IS NULL
  AND portal_request_intent IS NULL AND portal_group_size IS NULL)
 OR (portal_request_id IS NOT NULL AND portal_actor_user_id IS NOT NULL AND portal_origin_contact_id IS NOT NULL
  AND portal_request_intent IS NOT NULL AND jsonb_typeof(portal_request_intent)='object'
  AND octet_length(portal_request_intent::text)<=65536 AND portal_group_size IS NOT NULL AND portal_group_size BETWEEN 1 AND 1000
  AND booking_kind IN ('single','collective','class_seat')));
CREATE UNIQUE INDEX internal_bookings_portal_request_host
 ON public.internal_bookings(portal_request_id,host_user_id) WHERE portal_request_id IS NOT NULL;

-- Original host CRUD permissions remain. A host cannot forge/change trusted
-- request provenance. New Portal appointments are cancelled, retaining the
-- native request receipt; deleting it must not make an old request executable.
-- This never changes deletion of a historical/unmarked appointment.
CREATE FUNCTION public._client_portal_booking_request_seal() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $seal$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.portal_request_id IS NOT NULL OR (OLD.booking_kind='class_session' AND EXISTS(
   SELECT 1 FROM public.internal_bookings seat WHERE seat.class_session_id=OLD.id AND seat.portal_request_id IS NOT NULL)) THEN
   -- Owner-authorized compatibility correction, October27: preserve the
   -- ORIGINAL governed permanent-account retirement, without a new writer,
   -- permission, approval path or body/GUC bypass. Its protected `deleting`
   -- state is visible only inside the original atomic retirement operation.
   IF public.operator_can_permanently_delete_accounts() AND EXISTS(
    SELECT 1 FROM public.operator_account_archives r WHERE r.state='deleting'
     AND OLD.tenant_id=ANY(r.scope_ids)) THEN RETURN OLD; END IF;
   RAISE EXCEPTION 'Cancel customer bookings to retain the original request receipt' USING ERRCODE='42501';
  END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.portal_request_id IS NOT NULL THEN
  IF ROW(NEW.portal_request_id,NEW.portal_actor_user_id,NEW.portal_origin_contact_id,
    NEW.portal_request_intent,NEW.portal_group_size,NEW.tenant_id)
   IS DISTINCT FROM ROW(OLD.portal_request_id,OLD.portal_actor_user_id,OLD.portal_origin_contact_id,
    OLD.portal_request_intent,OLD.portal_group_size,OLD.tenant_id) THEN
   RAISE EXCEPTION 'Original customer request provenance cannot change' USING ERRCODE='42501';
  END IF;
 ELSIF NEW.portal_request_id IS NOT NULL THEN
  -- SECURITY DEFINER changes current_user, not the original PostgreSQL request
  -- role. API callers cannot SET ROLE service_role. No user-set custom flag or
  -- actor/email value is used to create trusted native provenance.
  IF coalesce(pg_catalog.current_setting('role',true),'') NOT IN ('service_role','postgres','none') THEN
   RAISE EXCEPTION 'Customer request provenance requires the original server writer' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $seal$;
REVOKE ALL ON FUNCTION public._client_portal_booking_request_seal() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_client_portal_booking_request_seal BEFORE INSERT OR UPDATE OR DELETE
 ON public.internal_bookings FOR EACH ROW EXECUTE FUNCTION public._client_portal_booking_request_seal();

-- Serialize roster edits with the SAME parent calendar locked by private
-- admission. Readers need not lock child rows (avoids child->parent inversion).
-- Existing rows, roles, roster writers and public availability logic remain.
CREATE FUNCTION public._client_portal_booking_roster_lock() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $roster$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM public.calendars c WHERE c.id=NEW.calendar_id FOR UPDATE;
 ELSIF TG_OP='DELETE' THEN
  PERFORM 1 FROM public.calendars c WHERE c.id=OLD.calendar_id FOR UPDATE;
 ELSE
  PERFORM 1 FROM public.calendars c WHERE c.id IN (OLD.calendar_id,NEW.calendar_id) ORDER BY c.id FOR UPDATE;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $roster$;
REVOKE ALL ON FUNCTION public._client_portal_booking_roster_lock() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_client_portal_booking_roster_lock BEFORE INSERT OR UPDATE OR DELETE
 ON public.calendar_hosts FOR EACH ROW EXECUTE FUNCTION public._client_portal_booking_roster_lock();

CREATE FUNCTION public._client_portal_booking_original_receipt(
 p_actor_id uuid,p_tenant_id uuid,p_client_id uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $receipt$
DECLARE n integer; expected integer; groups integer; shape_count integer; b public.internal_bookings%ROWTYPE; result jsonb; public_title text;
BEGIN
 result:=pg_catalog.jsonb_build_object('schema_version',1,'actor_id',p_actor_id,'tenant_id',p_tenant_id,
  'client_id',p_client_id,'request_id',p_request_id,'state','not_found','booking',NULL);
 SELECT count(*),min(portal_group_size),count(DISTINCT portal_group_size),
  count(DISTINCT ROW(start_at,end_at,timezone,status,calendar_id,appointment_type->>'name',booking_kind,collective_group_id))
 INTO n,expected,groups,shape_count FROM public.internal_bookings
 WHERE portal_request_id=p_request_id AND portal_actor_user_id=p_actor_id
  AND tenant_id=p_tenant_id AND portal_origin_contact_id=p_client_id AND contact_id=p_client_id;
 -- Partial collective work, moved linkage or inconsistent work remains unknown.
 -- Neither missing work nor an audit row authorizes another native create.
 IF n=0 OR n IS DISTINCT FROM expected OR groups<>1 OR shape_count<>1 THEN RETURN result; END IF;
 SELECT * INTO b FROM public.internal_bookings
 WHERE portal_request_id=p_request_id AND portal_actor_user_id=p_actor_id
  AND tenant_id=p_tenant_id AND portal_origin_contact_id=p_client_id AND contact_id=p_client_id
 ORDER BY id LIMIT 1;
 -- Match ORIGINAL client_portal_sessions presentation: an internal staff
 -- booking title is not customer-visible knowledge, including after a reload.
 SELECT coalesce(nullif(pg_catalog.btrim(b.appointment_type->>'name'),''),
  nullif(pg_catalog.btrim(c.title),''),'Session') INTO public_title
 FROM (SELECT 1) anchor LEFT JOIN public.calendars c ON c.id=b.calendar_id AND c.tenant_id=b.tenant_id;
 RETURN result||pg_catalog.jsonb_build_object('state','saved','booking',pg_catalog.jsonb_build_object(
  'id',b.id,'title',public_title,'start_at',b.start_at,'end_at',b.end_at,'timezone',b.timezone,'status',b.status));
END $receipt$;
REVOKE ALL ON FUNCTION public._client_portal_booking_original_receipt(uuid,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Customer recovery is an ordinary read on the actual original JWT. No actor
-- body argument, owner session, identity substitution or service-role fallback.
CREATE FUNCTION public.client_portal_booking_request(p_tenant_id uuid,p_expected_client_id uuid,p_request_id uuid)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $readback$
DECLARE customer uuid;
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_expected_client_id IS NULL OR p_request_id IS NULL THEN
  RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501';
 END IF;
 customer:=public._client_portal_lock_relationship(p_tenant_id,'share');
 IF customer IS DISTINCT FROM p_expected_client_id THEN
  RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501';
 END IF;
 RETURN public._client_portal_booking_original_receipt(auth.uid(),p_tenant_id,customer,p_request_id);
END $readback$;
REVOKE ALL ON FUNCTION public.client_portal_booking_request(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_booking_request(uuid,uuid,uuid) TO authenticated;

-- Original server adapter's exact-intent lookup BEFORE re-running availability.
-- An old appointment can still be recovered when its calendar later fills or
-- closes. This function only reads; missing/uncertain results never execute.
CREATE FUNCTION public.client_portal_reconcile_booking(
 p_verified_actor_id uuid,p_tenant_id uuid,p_expected_client_id uuid,p_request_id uuid,p_expected_intent jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $reconcile$
DECLARE customer uuid; original public.internal_bookings%ROWTYPE; answer jsonb;
BEGIN
 customer:=public._client_portal_lock_verified_customer(p_verified_actor_id,p_tenant_id,p_expected_client_id);
 IF p_request_id IS NULL OR p_expected_intent IS NULL OR pg_catalog.jsonb_typeof(p_expected_intent)<>'object'
  OR pg_catalog.octet_length(p_expected_intent::text)>65536 THEN
  RAISE EXCEPTION 'invalid booking request' USING ERRCODE='22023';
 END IF;
 answer:=pg_catalog.jsonb_build_object('schema_version',1,'actor_id',p_verified_actor_id,'tenant_id',p_tenant_id,
  'client_id',customer,'request_id',p_request_id,'state','not_found','booking',NULL,'replayed',true,'execution',NULL);
 SELECT * INTO original FROM public.internal_bookings b WHERE b.portal_request_id=p_request_id ORDER BY b.id LIMIT 1;
 IF NOT FOUND THEN RETURN answer; END IF;
 IF original.portal_actor_user_id IS DISTINCT FROM p_verified_actor_id
  OR original.portal_origin_contact_id IS DISTINCT FROM customer OR original.tenant_id IS DISTINCT FROM p_tenant_id
  OR original.portal_request_intent IS DISTINCT FROM p_expected_intent THEN
  RETURN answer||pg_catalog.jsonb_build_object('state','conflict');
 END IF;
 answer:=answer||public._client_portal_booking_original_receipt(p_verified_actor_id,p_tenant_id,customer,p_request_id);
 IF answer->>'state'='not_found' THEN answer:=answer||pg_catalog.jsonb_build_object('state','unverified'); END IF;
 RETURN answer;
END $reconcile$;
REVOKE ALL ON FUNCTION public.client_portal_reconcile_booking(uuid,uuid,uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_reconcile_booking(uuid,uuid,uuid,uuid,jsonb) TO service_role;

-- The existing public-booking engine must verify actual Auth, resolve the
-- selected original CRM relationship, validate availability/intake/policy and
-- prepare this exact plan BEFORE calling this service-only native commit.
-- No caller-JWT role may invoke this function or supply its verified actor.
CREATE FUNCTION public.client_portal_commit_booking(
 p_verified_actor_id uuid,p_tenant_id uuid,p_expected_client_id uuid,p_request_id uuid,
 p_request_intent jsonb,p_plan jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $commit$
DECLARE calendar public.calendars%ROWTYPE; current_source jsonb; current_roster jsonb;
 customer uuid; hosts uuid[]; host uuid; member_count integer; wanted_kind text;
 starts timestamptz; ends timestamptz; group_id uuid; written public.internal_bookings%ROWTYPE;
 receipt jsonb; representative uuid; existing_intent jsonb; existing_actor uuid;
 existing_contact uuid; existing_tenant uuid; email_count integer; actual_email text; phone_count integer; actual_phone text;
BEGIN
 customer:=public._client_portal_lock_verified_customer(p_verified_actor_id,p_tenant_id,p_expected_client_id);
 IF p_request_id IS NULL OR p_request_intent IS NULL OR pg_catalog.jsonb_typeof(p_request_intent)<>'object'
  OR pg_catalog.octet_length(p_request_intent::text)>65536 THEN
  RAISE EXCEPTION 'invalid booking request' USING ERRCODE='22023';
 END IF;
 -- A request serializes before looking for its original native result. A
 -- missing receipt during a concurrent transaction is never a create permit.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('portal_booking:'||p_request_id::text,0));
 SELECT b.portal_request_intent,b.portal_actor_user_id,b.portal_origin_contact_id,b.tenant_id
 INTO existing_intent,existing_actor,existing_contact,existing_tenant
 FROM public.internal_bookings b WHERE b.portal_request_id=p_request_id ORDER BY b.id LIMIT 1;
 IF FOUND THEN
  IF existing_actor IS DISTINCT FROM p_verified_actor_id OR existing_contact IS DISTINCT FROM customer
   OR existing_tenant IS DISTINCT FROM p_tenant_id OR existing_intent IS DISTINCT FROM p_request_intent THEN
   RAISE EXCEPTION 'booking request conflicts with its original intent' USING ERRCODE='22023';
  END IF;
  receipt:=public._client_portal_booking_original_receipt(p_verified_actor_id,p_tenant_id,customer,p_request_id);
  RETURN receipt||pg_catalog.jsonb_build_object('replayed',true,'execution',NULL);
 END IF;
 IF p_plan IS NULL OR pg_catalog.jsonb_typeof(p_plan)<>'object' OR pg_catalog.octet_length(p_plan::text)>100000
  OR pg_catalog.jsonb_typeof(p_plan->'calendar_source') IS DISTINCT FROM 'object'
  OR pg_catalog.jsonb_typeof(p_plan->'hosts_source') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_typeof(p_plan->'host_ids') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'invalid booking plan' USING ERRCODE='22023';
 END IF;
 -- Destination comes from this verified customer's ORIGINAL primary contact
 -- methods, never a typed guest address. Serialize existing primary methods
 -- with the native write and refuse absent/ambiguous/changed recipients.
 PERFORM cm.id FROM public.client_contact_methods cm WHERE cm.tenant_id=p_tenant_id AND cm.client_id=customer
  AND cm.kind IN ('email','phone') AND cm.is_primary ORDER BY cm.id FOR SHARE;
 SELECT count(*) FILTER(WHERE cm.kind='email'),max(pg_catalog.lower(pg_catalog.btrim(cm.value))) FILTER(WHERE cm.kind='email'),
  count(*) FILTER(WHERE cm.kind='phone'),max(pg_catalog.btrim(cm.value)) FILTER(WHERE cm.kind='phone')
 INTO email_count,actual_email,phone_count,actual_phone FROM public.client_contact_methods cm
 WHERE cm.tenant_id=p_tenant_id AND cm.client_id=customer AND cm.kind IN ('email','phone') AND cm.is_primary;
 IF email_count<>1 OR coalesce(actual_email,'')='' OR phone_count>1
  OR actual_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_plan->>'guest_email'))
  OR nullif(actual_phone,'') IS DISTINCT FROM nullif(pg_catalog.btrim(p_plan->>'guest_phone'),'') THEN
  RAISE EXCEPTION 'booking recipient changed or unavailable' USING ERRCODE='40001';
 END IF;
 SELECT c.* INTO calendar FROM public.calendars c
 WHERE c.id=(p_plan->>'calendar_id')::uuid AND c.tenant_id=p_tenant_id AND c.enabled IS TRUE FOR SHARE;
 IF NOT FOUND OR (p_request_intent->>'calendar_id')::uuid IS DISTINCT FROM calendar.id THEN
  RAISE EXCEPTION 'booking calendar unavailable' USING ERRCODE='42501';
 END IF;
 -- Exact raw source selected by the ORIGINAL calendar loader. A service or
 -- host-policy change after engine validation must refuse and require a fresh
 -- plan. The roster trigger serializes child changes on this parent lock.
 SELECT pg_catalog.jsonb_object_agg(k,pg_catalog.to_jsonb(calendar)->k) INTO current_source
 FROM pg_catalog.unnest(ARRAY['id','tenant_id','type','title','description','logo_url','accent','duration_min',
  'buffer_before_min','buffer_after_min','min_notice_min','timezone','availability_json','enabled','theme',
  'subtitle','show_company_name','location_type','location_value','notify_config','location_options',
  'booking_horizon_days','redirect_url','intake_questions','appointment_types','date_overrides','capacity','assignment_strategy']) AS k;
 SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user_id',h.user_id,'priority',h.priority,
  'availability_json',h.availability_json,'timezone',h.timezone) ORDER BY h.user_id),'[]'::jsonb)
 INTO current_roster FROM public.calendar_hosts h WHERE h.calendar_id=calendar.id;
 IF current_source IS DISTINCT FROM p_plan->'calendar_source' OR current_roster IS DISTINCT FROM p_plan->'hosts_source'
  OR pg_catalog.jsonb_array_length(current_roster)=0 THEN
  RAISE EXCEPTION 'booking policy changed' USING ERRCODE='40001';
 END IF;
 -- Every roster host must still be an active member of the same business.
 -- Hold membership rows through the commit, so a suspension cannot race it.
 PERFORM m.user_id FROM public.tenant_members m
 WHERE m.tenant_id=p_tenant_id AND m.status='active'
  AND m.user_id IN (SELECT h.user_id FROM public.calendar_hosts h WHERE h.calendar_id=calendar.id)
 ORDER BY m.user_id FOR SHARE;
 GET DIAGNOSTICS member_count=ROW_COUNT;
 IF member_count<>pg_catalog.jsonb_array_length(current_roster) THEN
  RAISE EXCEPTION 'booking hosts unavailable' USING ERRCODE='42501';
 END IF;
 -- Preserve the original engine's priority order, including its primary host
 -- for the existing notification/meeting-link tail. UUID sorting is not policy.
 SELECT pg_catalog.array_agg(h.value::uuid ORDER BY h.ordinality) INTO hosts
 FROM pg_catalog.jsonb_array_elements_text(p_plan->'host_ids') WITH ORDINALITY AS h(value,ordinality);
 IF hosts IS NULL OR pg_catalog.cardinality(hosts)>1000
  OR (SELECT count(DISTINCT h) FROM pg_catalog.unnest(hosts) AS h)<>pg_catalog.cardinality(hosts)
  OR EXISTS(SELECT 1 FROM pg_catalog.unnest(hosts) AS h WHERE NOT EXISTS(
   SELECT 1 FROM public.calendar_hosts ch WHERE ch.calendar_id=calendar.id AND ch.user_id=h)) THEN
  RAISE EXCEPTION 'booking hosts unavailable' USING ERRCODE='42501';
 END IF;
 wanted_kind:=CASE WHEN calendar.type::text='event' THEN 'class_seat'
  WHEN calendar.type::text='collective' AND pg_catalog.jsonb_array_length(current_roster)>1 THEN 'collective' ELSE 'single' END;
 IF p_plan->>'booking_kind' IS DISTINCT FROM wanted_kind
  OR (wanted_kind<>'collective' AND pg_catalog.cardinality(hosts)<>1)
  OR (wanted_kind='collective' AND pg_catalog.cardinality(hosts)<>pg_catalog.jsonb_array_length(current_roster)) THEN
  RAISE EXCEPTION 'booking model changed' USING ERRCODE='40001';
 END IF;
 starts:=(p_plan->>'start_at')::timestamptz;ends:=(p_plan->>'end_at')::timestamptz;
 IF starts IS NULL OR ends IS NULL OR NOT pg_catalog.isfinite(starts) OR NOT pg_catalog.isfinite(ends)
  OR ends<=starts OR starts<=pg_catalog.clock_timestamp()
  OR starts IS DISTINCT FROM (p_request_intent->>'start')::timestamptz
  OR coalesce(pg_catalog.btrim(p_plan->>'title'),'')='' OR pg_catalog.length(p_plan->>'title')>500
  OR coalesce(pg_catalog.btrim(p_plan->>'guest_name'),'')='' OR pg_catalog.length(p_plan->>'guest_name')>120
  OR coalesce(pg_catalog.btrim(p_plan->>'guest_email'),'')='' OR pg_catalog.length(p_plan->>'guest_email')>200 THEN
  RAISE EXCEPTION 'invalid booking plan' USING ERRCODE='22023';
 END IF;
 -- Recheck the original notice/horizon policy at the actual write, after all
 -- Auth, source and lock waits. This is admission, not another slot engine.
 IF starts<pg_catalog.clock_timestamp()+pg_catalog.make_interval(mins=>greatest(0,coalesce(calendar.min_notice_min,60)))
  OR starts>pg_catalog.clock_timestamp()+pg_catalog.make_interval(days=>greatest(1,coalesce(calendar.booking_horizon_days,60))) THEN
  RAISE EXCEPTION 'booking policy window changed' USING ERRCODE='40001';
 END IF;

 IF wanted_kind='class_seat' THEN
  -- Preserve the original race-safe marker/seat/capacity writer and its17-arg
  -- ABI. Stamp request provenance in THIS transaction, before any provider IO.
  written:=public.create_class_booking(calendar.id,hosts[1],p_tenant_id,starts,ends,
   coalesce(nullif(calendar.timezone,''),'America/New_York'),greatest(1,coalesce(calendar.capacity,8)),
   p_plan->>'title',p_plan->>'guest_name',p_plan->>'guest_email',p_plan->>'guest_phone',p_plan->>'notes',
   p_plan->>'location_type',p_plan->>'location_value',p_plan->'intake_answers','booking_page',customer);
  IF NOT EXISTS(SELECT 1 FROM public.internal_bookings s WHERE s.id=written.class_session_id
   AND s.calendar_id=calendar.id AND s.host_user_id=hosts[1] AND s.start_at=starts AND s.end_at=ends
   AND s.timezone=coalesce(nullif(calendar.timezone,''),'America/New_York') AND s.status='scheduled') THEN
   RAISE EXCEPTION 'booking class changed' USING ERRCODE='40001';
  END IF;
  UPDATE public.internal_bookings SET portal_request_id=p_request_id,portal_actor_user_id=p_verified_actor_id,
   portal_origin_contact_id=customer,portal_request_intent=p_request_intent,portal_group_size=1,
   appointment_type=p_plan->'appointment_type' WHERE id=written.id;
 ELSE
  IF wanted_kind='collective' THEN group_id:=pg_catalog.gen_random_uuid(); END IF;
  FOREACH host IN ARRAY hosts LOOP
   INSERT INTO public.internal_bookings(tenant_id,host_user_id,calendar_id,contact_id,booking_kind,collective_group_id,
    title,guest_name,guest_email,guest_phone,notes,start_at,end_at,timezone,status,source,
    location_type,location_value,intake_answers,appointment_type,
    portal_request_id,portal_actor_user_id,portal_origin_contact_id,portal_request_intent,portal_group_size)
   VALUES(p_tenant_id,host,calendar.id,customer,wanted_kind,group_id,p_plan->>'title',p_plan->>'guest_name',
    p_plan->>'guest_email',p_plan->>'guest_phone',p_plan->>'notes',starts,ends,
    coalesce(nullif(calendar.timezone,''),'America/New_York'),'scheduled','booking_page',
    p_plan->>'location_type',p_plan->>'location_value',p_plan->'intake_answers',p_plan->'appointment_type',
    p_request_id,p_verified_actor_id,customer,p_request_intent,pg_catalog.cardinality(hosts));
  END LOOP;
 END IF;
 receipt:=public._client_portal_booking_original_receipt(p_verified_actor_id,p_tenant_id,customer,p_request_id);
 IF receipt->>'state' IS DISTINCT FROM 'saved' THEN
  RAISE EXCEPTION 'booking could not be verified' USING ERRCODE='40001';
 END IF;
 representative:=(receipt#>>'{booking,id}')::uuid;
 INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
 VALUES(p_verified_actor_id,'internal_booking','client_portal_create',representative,
  pg_catalog.jsonb_build_object('tenant_id',p_tenant_id,'client_id',customer,'portal_request_id',p_request_id,
   'booking_kind',wanted_kind,'host_legs',pg_catalog.cardinality(hosts)));
 RETURN receipt||pg_catalog.jsonb_build_object('replayed',false,'execution',pg_catalog.jsonb_build_object(
  'booking_kind',wanted_kind,'host_ids',hosts,'collective_group_id',group_id));
END $commit$;
REVOKE ALL ON FUNCTION public.client_portal_commit_booking(uuid,uuid,uuid,uuid,jsonb,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_commit_booking(uuid,uuid,uuid,uuid,jsonb,jsonb) TO service_role;

COMMIT;
