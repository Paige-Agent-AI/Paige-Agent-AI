-- The preview migration history already contains the original account-controls
-- migration. Reassert its least-privilege grants after production ACL replay.
REVOKE ALL ON FUNCTION public.operator_read_account_details(uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.operator_edit_account_details(uuid,text,text,text) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.operator_preview_account_deletion(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operator_read_account_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_edit_account_details(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_preview_account_deletion(uuid) TO authenticated;
