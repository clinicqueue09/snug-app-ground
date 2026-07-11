
REVOKE EXECUTE ON FUNCTION public.current_clinic_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_clinic_id() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_token_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
