-- 站长面板：只能由已有管理员调用，权限在数据库内校验。
create or replace function public.admin_update_member(target_user uuid, new_title text, promote boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id=auth.uid() and is_admin=true) then raise exception 'ADMIN_REQUIRED'; end if;
  if target_user = auth.uid() then raise exception 'CANNOT_CHANGE_SELF'; end if;
  if not exists (select 1 from public.profiles where id=target_user) then raise exception 'USER_NOT_FOUND'; end if;
  update public.profiles set display_title=coalesce(nullif(trim(new_title),''),'社区成员'), is_admin=coalesce(promote,false) where id=target_user;
  return true;
end; $$;
revoke all on function public.admin_update_member(uuid,text,boolean) from public;
grant execute on function public.admin_update_member(uuid,text,boolean) to authenticated;
notify pgrst, 'reload schema';
