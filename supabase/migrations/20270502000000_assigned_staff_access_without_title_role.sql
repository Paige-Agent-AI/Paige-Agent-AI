-- Assigned staff reach what they are assigned through the business, not through a title role.
--
-- "Coach" is a title a business gives its people. It never grants permission. Until now 25 policies
-- outside the finance tables let a person in only if they held the platform-wide `coach` role. That
-- role carries no business at all.
--
-- After this migration:
--   * the 16 policies that gate access on an assignment grant it on the assignment plus active
--     membership of the business the record belongs to. No role is needed. An assignment to a client
--     of a business the person does not belong to grants nothing;
--   * the 9 policies that gated only the holder's own rows or their business are removed. The admin
--     policies on the same tables already give that access to a business's owners and admins, and a
--     member gains nothing from the removal. What a member should reach on deals, pipelines,
--     invitations and research is a product decision, and this migration does not make it;
--   * on `clients`, an assignment lets the assignee read and update the client, but no longer delete
--     it. Deleting a client stays with the business's owners and admins. Access through "created it"
--     is dropped, because creating a client is not an assignment;
--   * policies whose names carried the title are renamed to what they grant.
--
-- Who is affected on production today: 0 membership seats hold coach. The 4 people who hold the
-- platform-wide coach role also hold admin or above and keep every row through the admin policies.
-- Every assigned staff member named on a client is an active member of that client's business.
-- The 'coach' kept in is_assigned_to_client(..., 'coach') is an assignment kind (a data label on
-- paige_coach_assignments), not a role.

-- Step 1: assignment plus membership of the record's business.
ALTER POLICY "Coaches view verifications for their clients" ON public.business_verification_runs
  USING (contact_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.id = business_verification_runs.contact_id
       AND c.assigned_coach_user_id = auth.uid()
       AND public.is_tenant_member(c.tenant_id)));
ALTER POLICY "Coaches view verifications for their clients" ON public.business_verification_runs
  RENAME TO "Assigned staff view verifications for their clients";

DROP POLICY clients_coaches_assigned ON public.clients;
CREATE POLICY clients_assigned_staff_read ON public.clients
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id)
         AND (assigned_coach_user_id = auth.uid() OR public.is_assigned_to_client(auth.uid(), id, 'coach')));
CREATE POLICY clients_assigned_staff_update ON public.clients
  FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id)
         AND (assigned_coach_user_id = auth.uid() OR public.is_assigned_to_client(auth.uid(), id, 'coach')))
  WITH CHECK (public.is_tenant_member(tenant_id)
              AND (assigned_coach_user_id = auth.uid() OR public.is_assigned_to_client(auth.uid(), id, 'coach')));

-- An assignment row is admitted only for an assignee who qualifies in its business (20270427000000).
ALTER POLICY "Coaches can view own clients" ON public.coach_clients
  USING (auth.uid() = coach_user_id);
ALTER POLICY "Coaches can view own clients" ON public.coach_clients
  RENAME TO "Assigned staff view their own assignments";

ALTER POLICY deal_activities_coach_read ON public.deal_activities
  USING (EXISTS (
    SELECT 1 FROM public.deals d
     WHERE d.id = deal_activities.deal_id
       AND public.is_tenant_member(d.tenant_id)
       AND (d.owner_user_id = auth.uid()
            OR EXISTS (SELECT 1 FROM public.clients c
                        WHERE c.id = d.contact_client_id
                          AND c.tenant_id = d.tenant_id
                          AND c.assigned_coach_user_id = auth.uid()))));
ALTER POLICY deal_activities_coach_read ON public.deal_activities RENAME TO deal_activities_assigned_staff_read;

ALTER POLICY deals_coach_select ON public.deals
  USING (public.is_tenant_member(tenant_id)
         AND (owner_user_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.clients c
                          WHERE c.id = deals.contact_client_id
                            AND c.tenant_id = deals.tenant_id
                            AND c.assigned_coach_user_id = auth.uid())));
ALTER POLICY deals_coach_select ON public.deals RENAME TO deals_assigned_staff_select;

ALTER POLICY deals_coach_update ON public.deals
  USING (public.is_tenant_member(tenant_id)
         AND (owner_user_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.clients c
                          WHERE c.id = deals.contact_client_id
                            AND c.tenant_id = deals.tenant_id
                            AND c.assigned_coach_user_id = auth.uid())))
  WITH CHECK (public.is_tenant_member(tenant_id)
              AND (owner_user_id = auth.uid()
                   OR EXISTS (SELECT 1 FROM public.clients c
                               WHERE c.id = deals.contact_client_id
                                 AND c.tenant_id = deals.tenant_id
                                 AND c.assigned_coach_user_id = auth.uid())));
ALTER POLICY deals_coach_update ON public.deals RENAME TO deals_assigned_staff_update;

ALTER POLICY "Coaches can read assigned client invitations" ON public.invitations
  USING (EXISTS (
    SELECT 1 FROM public.coach_clients cc
      JOIN public.clients c ON c.linked_user_id = cc.client_user_id AND c.tenant_id = cc.tenant_id
     WHERE cc.coach_user_id = auth.uid() AND cc.status = 'active'
       AND c.email = invitations.email AND c.tenant_id = invitations.tenant_id));
ALTER POLICY "Coaches can read assigned client invitations" ON public.invitations
  RENAME TO "Assigned staff read their clients' invitations";

ALTER POLICY "Coaches manage assigned client outreach drafts" ON public.outreach_drafts
  USING (EXISTS (SELECT 1 FROM public.coach_clients cc
                  WHERE cc.coach_user_id = auth.uid()
                    AND cc.client_user_id = outreach_drafts.client_user_id
                    AND cc.status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.coach_clients cc
                       WHERE cc.coach_user_id = auth.uid()
                         AND cc.client_user_id = outreach_drafts.client_user_id
                         AND cc.status = 'active'));
ALTER POLICY "Coaches manage assigned client outreach drafts" ON public.outreach_drafts
  RENAME TO "Assigned staff manage their clients' outreach drafts";

ALTER POLICY "Admins and coaches read health" ON public.paige_health_snapshots
  USING (public.tenant_staff_owns_contact(auth.uid(), contact_id)
         OR (contact_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.clients c
                WHERE c.id = paige_health_snapshots.contact_id
                  AND c.assigned_coach_user_id = auth.uid()
                  AND public.is_tenant_member(c.tenant_id))));
ALTER POLICY "Admins and coaches read health" ON public.paige_health_snapshots
  RENAME TO "Admins and assigned staff read health";

ALTER POLICY "Admins and coaches write health" ON public.paige_health_snapshots
  USING (public.tenant_staff_owns_contact(auth.uid(), contact_id)
         OR (contact_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.clients c
                WHERE c.id = paige_health_snapshots.contact_id
                  AND c.assigned_coach_user_id = auth.uid()
                  AND public.is_tenant_member(c.tenant_id))))
  WITH CHECK (public.tenant_staff_owns_contact(auth.uid(), contact_id)
              OR (contact_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM public.clients c
                     WHERE c.id = paige_health_snapshots.contact_id
                       AND c.assigned_coach_user_id = auth.uid()
                       AND public.is_tenant_member(c.tenant_id))));
ALTER POLICY "Admins and coaches write health" ON public.paige_health_snapshots
  RENAME TO "Admins and assigned staff write health";

ALTER POLICY "Coaches view audit for assigned contacts" ON public.paige_messages_audit
  USING (contact_id IS NOT NULL
         AND public.is_assigned_to_client(auth.uid(), contact_id)
         AND EXISTS (SELECT 1 FROM public.clients c
                      WHERE c.id = paige_messages_audit.contact_id
                        AND public.is_tenant_member(c.tenant_id)));
ALTER POLICY "Coaches view audit for assigned contacts" ON public.paige_messages_audit
  RENAME TO "Assigned staff view audit for their contacts";

ALTER POLICY "Coaches view runs for their contacts" ON public.paige_skill_runs
  USING (contact_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.clients c
     WHERE c.id = paige_skill_runs.contact_id
       AND c.assigned_coach_user_id = auth.uid()
       AND public.is_tenant_member(c.tenant_id)));
ALTER POLICY "Coaches view runs for their contacts" ON public.paige_skill_runs
  RENAME TO "Assigned staff view runs for their contacts";

ALTER POLICY "Users view own QB connection" ON public.quickbooks_connections
  USING (auth.uid() = user_id
         OR public.tenant_staff_owns_user(auth.uid(), user_id)
         OR EXISTS (SELECT 1 FROM public.clients c
                     WHERE c.linked_user_id = quickbooks_connections.user_id
                       AND c.assigned_coach_user_id = auth.uid()
                       AND public.is_tenant_member(c.tenant_id)));

ALTER POLICY "Users view own QB financials" ON public.quickbooks_financials
  USING (auth.uid() = user_id
         OR public.tenant_staff_owns_user(auth.uid(), user_id)
         OR EXISTS (SELECT 1 FROM public.clients c
                     WHERE c.linked_user_id = quickbooks_financials.user_id
                       AND c.assigned_coach_user_id = auth.uid()
                       AND public.is_tenant_member(c.tenant_id)));

ALTER POLICY "Users view own QB transactions" ON public.quickbooks_transactions
  USING (auth.uid() = user_id
         OR public.tenant_staff_owns_user(auth.uid(), user_id)
         OR EXISTS (SELECT 1 FROM public.clients c
                     WHERE c.linked_user_id = quickbooks_transactions.user_id
                       AND c.assigned_coach_user_id = auth.uid()
                       AND public.is_tenant_member(c.tenant_id)));

ALTER POLICY "Coaches manage assigned client tasks" ON public.tasks
  USING (EXISTS (SELECT 1 FROM public.clients c
                  WHERE c.linked_user_id = tasks.user_id
                    AND c.tenant_id = tasks.tenant_id
                    AND c.assigned_coach_user_id = auth.uid()
                    AND public.is_tenant_member(c.tenant_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c
                       WHERE c.linked_user_id = tasks.user_id
                         AND c.tenant_id = tasks.tenant_id
                         AND c.assigned_coach_user_id = auth.uid()
                         AND public.is_tenant_member(c.tenant_id)));
ALTER POLICY "Coaches manage assigned client tasks" ON public.tasks
  RENAME TO "Assigned staff manage their clients' tasks";

-- Step 2: policies that only restated admin access to the holder's own rows or business.
DROP POLICY deal_activities_coach_insert ON public.deal_activities;
DROP POLICY deals_coach_insert ON public.deals;
DROP POLICY "Coaches can create assigned client invitations" ON public.invitations;
DROP POLICY "Coaches view own runs" ON public.paige_workflow_runs;
DROP POLICY pipeline_stages_coach_read ON public.pipeline_stages;
DROP POLICY pipelines_coach_read ON public.pipelines;
DROP POLICY "Coaches can manage own research runs" ON public.research_runs;
DROP POLICY "Coaches can manage own research sources" ON public.research_sources;
DROP POLICY "Coaches can insert feedback" ON public.response_quality_feedback;
