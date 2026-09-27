-- The retired title role stops granting anything where it sat beside the admin branch.
--
-- "Coach" is a title a business gives its people. It never grants permission. 71 policies outside the
-- finance tables let the platform-wide `coach` role in beside the admin branch. After this migration:
--   * 62 policies drop the role (three of them, on the archived social posts table and the
--     generated files bucket, only where they exist) and keep every other branch unchanged: the business's admins, the
--     platform owner, the other roles named beside it, and the row's own author, sender or owner;
--   * 3 read policies where the role opened an assigned client's records (browser sessions, business
--     verifications, conversations) now grant READ access through the assignment plus active
--     membership of the business the record belongs to, with no role;
--   * on goals and chat embeddings the role's branch is removed and not replaced: those rows carry no
--     business, so an assignment cannot be limited to the business it was made in;
--   * the role's write paths on goals and conversations are removed and not replaced, exactly as for
--     clients, deals and tasks in 20270502000000. Whether an assigned member may write is a product
--     decision, and this migration does not make it;
--   * the read of a person's own sub-agent proposals is removed: it restated the admin policy for
--     admins and gave the role holder their own rows, and a member gains nothing new;
--   * policies whose names carried the title are renamed to what they grant.
--
-- The finance tables (credit, funding, lender, banking, business certifications, outreach drafts) are
-- the next slice. The database functions that read the role are a separate change.
--
-- Who is affected on production today: 0 membership seats hold coach. The 4 people who hold the
-- platform-wide coach role also hold admin or above and keep every row through the admin branches.

-- Step 1: drop the role and keep every other branch.
ALTER POLICY businesses_tenant_staff_insert ON public.businesses
  WITH CHECK ((is_platform_owner() OR (owner_user_id = auth.uid()) OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales_rep'::app_role)))));
ALTER POLICY businesses_tenant_staff_select ON public.businesses
  USING ((is_platform_owner() OR (owner_user_id = auth.uid()) OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales_rep'::app_role) OR has_role(auth.uid(), 'cs_rep'::app_role) OR has_role(auth.uid(), 'finance'::app_role) OR has_role(auth.uid(), 'viewer'::app_role)))));
ALTER POLICY businesses_tenant_staff_update ON public.businesses
  USING ((is_platform_owner() OR (owner_user_id = auth.uid()) OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales_rep'::app_role)))))
  WITH CHECK ((is_platform_owner() OR (owner_user_id = auth.uid()) OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'sales_rep'::app_role)))));
ALTER POLICY channel_connectors_select ON public.channel_connectors
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY "Staff insert files" ON public.client_files
  WITH CHECK (((uploaded_by_user_id = auth.uid()) AND (is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role)) AND (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = client_files.contact_id) AND (c.tenant_id = current_user_tenant_id()))))))));
ALTER POLICY "Staff can create notes" ON public.client_notes
  WITH CHECK (((author_user_id = auth.uid()) AND (is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role)) AND (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = client_notes.contact_id) AND (c.tenant_id = current_user_tenant_id()))))))));
ALTER POLICY client_types_insert ON public.client_types
  WITH CHECK (((created_by = auth.uid()) AND (is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text])))));
ALTER POLICY marketing_content_tenant_manage ON public.marketing_content
  USING ((((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])) OR is_platform_owner()))
  WITH CHECK ((((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])) OR is_platform_owner()));
ALTER POLICY messages_insert ON public.messages
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY messages_select ON public.messages
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY messages_update ON public.messages
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))))
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY pa_tenant_staff_read ON public.paige_actions
  USING ((((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])) OR is_platform_owner()));
ALTER POLICY approval_comments_insert ON public.paige_approval_comments
  WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM paige_pending_approvals a
  WHERE ((a.id = paige_approval_comments.approval_id) AND ((a.assigned_to_user_id = auth.uid()) OR (a.submitted_by_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)))))));
ALTER POLICY approval_comments_read ON public.paige_approval_comments
  USING ((EXISTS ( SELECT 1
   FROM paige_pending_approvals a
  WHERE ((a.id = paige_approval_comments.approval_id) AND ((a.assigned_to_user_id = auth.uid()) OR (a.submitted_by_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))))));
ALTER POLICY policies_read_for_routing ON public.paige_approval_policies
  USING (((active = true) AND (is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role))))));
ALTER POLICY pce_staff_read ON public.paige_client_events
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text]))));
ALTER POLICY "Admins and coaches write coach assignments" ON public.paige_coach_assignments
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role)))))
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role)))));
ALTER POLICY "Admins and coaches write coach assignments" ON public.paige_coach_assignments
  RENAME TO "Admins write staff assignments";
ALTER POLICY paige_consent_events_insert ON public.paige_consent_events
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY paige_consent_events_select ON public.paige_consent_events
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY pcl_write ON public.paige_conversation_labels
  USING (((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])))
  WITH CHECK (((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])));
ALTER POLICY pca_tenant_staff_read ON public.paige_customer_actions
  USING (((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role) OR is_platform_owner())));
ALTER POLICY pcr_tenant_staff_read ON public.paige_customer_responses
  USING ((EXISTS ( SELECT 1
   FROM paige_customer_actions a
  WHERE ((a.id = paige_customer_responses.action_id) AND (a.tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role) OR is_platform_owner())))));
ALTER POLICY pip_owner_read ON public.paige_improvement_proposals
  USING (((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])));
ALTER POLICY pip_owner_write ON public.paige_improvement_proposals
  WITH CHECK (((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])));
ALTER POLICY pml_write ON public.paige_message_labels
  USING ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = paige_message_labels.message_id) AND (m.tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])))));
ALTER POLICY "Staff insert skill runs" ON public.paige_skill_runs
  WITH CHECK ((is_platform_owner() OR tenant_staff_owns_contact(auth.uid(), contact_id)));
ALTER POLICY paige_suppressions_delete ON public.paige_suppressions
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY paige_suppressions_insert ON public.paige_suppressions
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY paige_suppressions_select ON public.paige_suppressions
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY "Admins and coaches insert runs" ON public.paige_workflow_runs
  WITH CHECK (((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role)))) AND (triggered_by_user_id = auth.uid())));
ALTER POLICY "Admins and coaches insert runs" ON public.paige_workflow_runs RENAME TO "Admins insert runs";
ALTER POLICY plan_items_read ON public.plan_items
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text]) OR (assigned_to_user_id = auth.uid()) OR (created_by = auth.uid())))));
ALTER POLICY plans_read ON public.plans
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text]) OR (owner_user_id = auth.uid()) OR (created_by = auth.uid())))));
ALTER POLICY "Authenticated read published RAG docs" ON public.rag_documents
  USING (((is_published = true) AND ((client_id IS NULL) OR (client_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))));
ALTER POLICY signatures_delete ON public.signatures
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY signatures_insert ON public.signatures
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY signatures_select ON public.signatures
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY signatures_update ON public.signatures
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))))
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY snippets_insert ON public.snippets
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]) AND ((user_id = auth.uid()) OR ((user_id IS NULL) AND has_role(auth.uid(), 'admin'::app_role))))));
ALTER POLICY snippets_select ON public.snippets
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY studio_deliverable_tenant_manage ON public.studio_deliverable
  USING ((((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])) OR is_platform_owner()))
  WITH CHECK ((((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])) OR is_platform_owner()));
ALTER POLICY studio_library_items_tenant_manage ON public.studio_library_items
  USING ((((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])) OR is_platform_owner()))
  WITH CHECK ((((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])) OR is_platform_owner()));
ALTER POLICY handoff_delete ON public.team_handoff_queue
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_any_role(auth.uid(), ARRAY['admin'::text, 'manager'::text]) OR (from_user_id = auth.uid())))));
ALTER POLICY handoff_insert ON public.team_handoff_queue
  WITH CHECK (((from_user_id = auth.uid()) AND (is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'manager'::text])))));
ALTER POLICY handoff_select ON public.team_handoff_queue
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_any_role(auth.uid(), ARRAY['admin'::text, 'manager'::text]) OR (from_user_id = auth.uid()) OR (to_user_id_target = auth.uid()) OR (accepted_by = auth.uid())))));
ALTER POLICY handoff_update ON public.team_handoff_queue
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND (has_any_role(auth.uid(), ARRAY['admin'::text, 'manager'::text]) OR (from_user_id = auth.uid()) OR (to_user_id_target = auth.uid()) OR (accepted_by = auth.uid())))));
ALTER POLICY scoreboard_delete ON public.team_scoreboard_metrics
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'manager'::text]))));
ALTER POLICY scoreboard_insert ON public.team_scoreboard_metrics
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'manager'::text])) OR (user_id = auth.uid())));
ALTER POLICY scoreboard_select ON public.team_scoreboard_metrics
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'manager'::text])) OR (user_id = auth.uid())));
ALTER POLICY scoreboard_update ON public.team_scoreboard_metrics
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'manager'::text]))));
ALTER POLICY tenant_a2p_registrations_insert ON public.tenant_a2p_registrations
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY tenant_a2p_registrations_select ON public.tenant_a2p_registrations
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY tenant_a2p_registrations_update ON public.tenant_a2p_registrations
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))))
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY tenant_comms_preferences_select ON public.tenant_comms_preferences
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY tenant_phone_numbers_insert ON public.tenant_phone_numbers
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY tenant_phone_numbers_select ON public.tenant_phone_numbers
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY tenant_phone_numbers_update ON public.tenant_phone_numbers
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))))
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY threads_insert ON public.threads
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY threads_select ON public.threads
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));
ALTER POLICY threads_update ON public.threads
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))))
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_any_role(auth.uid(), ARRAY['admin'::text]))));

-- The archived social posts table exists only where the social migration took its newer shape; a
-- database rebuilt from migrations archives it under another name. Change the policy where it exists.
DO $$
BEGIN
  IF to_regclass('private.paige_social_posts_legacy_20270117') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('private.paige_social_posts_legacy_20270117')
                                          AND polname = 'psp_write') THEN
    ALTER POLICY psp_write ON private.paige_social_posts_legacy_20270117
      USING (((tenant_id = public.current_user_tenant_id()) AND public.has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])))
      WITH CHECK (((tenant_id = public.current_user_tenant_id()) AND public.has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])));
  END IF;
END $$;

-- The generated-files bucket policies were created outside migrations; change them where they exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'paige_generated_staff_update') THEN
    ALTER POLICY paige_generated_staff_update ON storage.objects
      USING (((bucket_id = 'paige-generated'::text) AND public.has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'storage.objects'::regclass AND polname = 'paige_generated_staff_write') THEN
    ALTER POLICY paige_generated_staff_write ON storage.objects
      WITH CHECK (((bucket_id = 'paige-generated'::text) AND public.has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])));
  END IF;
END $$;

-- Step 2: where the role opened an assigned client's records, the assignment plus membership of the
-- business now gives read access to them.
ALTER POLICY "Authorized tenant staff view browser sessions" ON public.browser_use_sessions
  USING (is_platform_owner() OR is_tenant_admin(tenant_id) OR agency_can_manage_child(tenant_id)
         OR (related_contact_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.clients c
                WHERE c.id = browser_use_sessions.related_contact_id
                  AND c.tenant_id = browser_use_sessions.tenant_id
                  AND c.assigned_coach_user_id = auth.uid()
                  AND public.is_tenant_member(c.tenant_id))));

ALTER POLICY "View verifications via run access" ON public.business_verifications
  USING (EXISTS (
    SELECT 1 FROM public.business_verification_runs r
     WHERE r.id = business_verifications.run_id
       AND (is_platform_owner()
            OR has_role(auth.uid(), 'admin'::app_role)
            OR (r.contact_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.clients c
                   WHERE c.id = r.contact_id
                     AND c.assigned_coach_user_id = auth.uid()
                     AND public.is_tenant_member(c.tenant_id)))
            OR (r.business_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM public.businesses b
                   WHERE b.id = r.business_id AND b.owner_user_id = auth.uid())))));

ALTER POLICY "Coaches read assigned contact conversations" ON public.paige_conversations
  USING (tenant_id = current_user_tenant_id()
         AND public.is_tenant_member(tenant_id)
         AND EXISTS (SELECT 1 FROM public.clients c
                      WHERE c.id = paige_conversations.contact_id
                        AND c.tenant_id = paige_conversations.tenant_id
                        AND (c.assigned_coach_user_id = auth.uid()
                             OR public.is_assigned_to_client(auth.uid(), c.id, 'coach'))));
ALTER POLICY "Coaches read assigned contact conversations" ON public.paige_conversations
  RENAME TO "Assigned staff read their contacts' conversations";

-- Step 3: where the records carry no business, the role's branch is removed and not replaced. A goal
-- and a chat embedding are keyed on the person alone, and the same person can be a client of more than
-- one business, so an assignment in one business cannot be limited to that business's rows. The
-- business's admins and the person themself keep their access.
ALTER POLICY "Users can read their own chat embeddings" ON public.chat_message_embeddings
  USING ((auth.uid() = user_id) OR (auth.uid() = client_user_id) OR has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY "Admins view all goals, coaches view assigned" ON public.client_goals
  USING (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY "Admins view all goals, coaches view assigned" ON public.client_goals
  RENAME TO "Admins view all goals";

-- Step 4: the role's write paths on goals and conversations, and a policy that only restated admin
-- access plus the holder's own rows.
ALTER POLICY "Admins update all goals, coaches update assigned" ON public.client_goals
  USING (has_role(auth.uid(), 'admin'::app_role));
ALTER POLICY "Admins update all goals, coaches update assigned" ON public.client_goals
  RENAME TO "Admins update all goals";
DROP POLICY "Coaches update assigned contact conversations" ON public.paige_conversations;
DROP POLICY "Coaches write assigned contact conversations" ON public.paige_conversations;
DROP POLICY "coaches read own proposals" ON public.paige_subagent_proposals;
