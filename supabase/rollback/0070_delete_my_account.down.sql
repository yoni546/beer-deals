-- Undo 0070: the in-app deletion goes away (accounts already deleted stay deleted).
drop function if exists public.delete_my_account();
