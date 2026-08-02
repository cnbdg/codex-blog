-- cnbdg 永久站长保护
-- 作用：把已核对的 Cnbdg 账号 UUID 锁定为永久站长。
-- 本脚本可重复执行，不删除任何用户、内容、举报或操作日志。
-- 前置：已经成功执行 community.sql 与 governance.sql。

begin;

alter table public.profiles
  add column if not exists is_owner boolean not null default false;

-- 升级时临时移除保护触发器，确保脚本在需要修复标记时仍可重复执行。
drop trigger if exists protect_permanent_owner_trigger on public.profiles;
drop trigger if exists protect_owner_moderation_trigger on public.user_moderation;

do $$
declare
  owner_user_id constant uuid := 'fec1e98c-1b1b-4057-9a94-d14bc4b89b99';
  owner_username text;
begin
  if not exists (select 1 from auth.users u where u.id = owner_user_id) then
    raise exception 'OWNER_ACCOUNT_NOT_FOUND: %', owner_user_id;
  end if;

  select p.username
  into owner_username
  from public.profiles p
  where p.id = owner_user_id;

  if owner_username is null then
    raise exception 'OWNER_PROFILE_NOT_FOUND: 请先让该账号正常登录一次，再重新执行本脚本';
  end if;

  if lower(trim(owner_username)) <> lower('Cnbdg') then
    raise exception 'OWNER_IDENTITY_MISMATCH: 账号昵称为“%”，预期为“Cnbdg”', owner_username;
  end if;

  -- 绑定到不可变的用户 UUID；以后修改邮箱或昵称不会解除保护。
  update public.profiles
  set is_owner = (id = owner_user_id),
      is_admin = case when id = owner_user_id then true else is_admin end,
      title_locked = case when id = owner_user_id then true else title_locked end
  where is_owner = true or id = owner_user_id;

  -- 永久站长不应残留任何站内限制。
  update public.user_moderation
  set active = false,
      banned_until = now(),
      updated_at = now(),
      updated_by = owner_user_id
  where user_id = owner_user_id and active = true;
end
$$;

-- 普通客户端只能修改公开资料，不能修改 UID、管理员或永久站长标记。
revoke update on table public.profiles from anon, authenticated;
grant update (username, avatar_url, display_title) on table public.profiles to authenticated;

create or replace function public.protect_permanent_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_owner then raise exception 'OWNER_PROTECTED'; end if;
    return old;
  end if;

  if old.is_owner and (
    new.is_owner is distinct from true
    or new.is_admin is distinct from true
  ) then
    raise exception 'OWNER_PROTECTED';
  end if;

  -- 其他站内管理员不能借旧版 RPC 修改永久站长的头衔或任何资料字段。
  if old.is_owner and (select auth.uid()) is distinct from old.id then
    raise exception 'OWNER_PROTECTED';
  end if;

  if not old.is_owner and new.is_owner then
    raise exception 'OWNER_FIELD_LOCKED';
  end if;

  return new;
end;
$$;

create trigger protect_permanent_owner_trigger
  before update or delete on public.profiles
  for each row execute function public.protect_permanent_owner();

create or replace function public.protect_owner_moderation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.is_owner = true)
     and coalesce(new.active, true)
     and (new.banned_until is null or new.banned_until > now()) then
    raise exception 'OWNER_PROTECTED';
  end if;
  return new;
end;
$$;

create trigger protect_owner_moderation_trigger
  before insert or update on public.user_moderation
  for each row execute function public.protect_owner_moderation();

create or replace function public.current_user_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_owner = true
      and p.is_admin = true
  );
$$;

-- 独立 V2 接口增加永久站长状态；保留 governance.sql 的旧接口，避免以后重复执行治理脚本时发生返回类型冲突。
create or replace function public.admin_get_member_by_uid_v2(requested_uid bigint)
returns table (
  user_id uuid,
  user_uid bigint,
  username text,
  avatar_url text,
  display_title text,
  is_admin boolean,
  is_owner boolean,
  created_at timestamptz,
  restricted boolean,
  restricted_until timestamptz,
  restriction_reason text,
  strike_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.current_user_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  return query
  select p.id, p.user_uid, p.username, p.avatar_url, p.display_title, p.is_admin, p.is_owner, p.created_at,
    coalesce(m.active and (m.banned_until is null or m.banned_until > now()), false),
    m.banned_until, m.reason,
    (select count(*) from public.moderation_strikes s where s.user_id = p.id)
  from public.profiles p
  left join public.user_moderation m on m.user_id = p.id
  where p.user_uid = requested_uid
  limit 1;
end;
$$;

-- 覆盖治理脚本中的成员管理函数：任何其他管理员都不能修改永久站长。
create or replace function public.admin_manage_member(
  target_user uuid,
  new_title text,
  role_action text default 'keep'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_is_admin boolean;
  target_is_owner boolean;
  admin_count bigint;
begin
  if not public.current_user_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if role_action not in ('keep', 'promote', 'demote') then raise exception 'INVALID_ROLE_ACTION'; end if;
  if char_length(trim(new_title)) not between 1 and 30 then raise exception 'INVALID_TITLE'; end if;

  select p.is_admin, p.is_owner
  into target_is_admin, target_is_owner
  from public.profiles p
  where p.id = target_user
  for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  if target_is_owner and target_user <> (select auth.uid()) then
    raise exception 'OWNER_PROTECTED';
  end if;
  if role_action <> 'keep' and target_user = (select auth.uid()) then
    raise exception 'CANNOT_CHANGE_SELF_ROLE';
  end if;
  if role_action = 'demote' and target_is_owner then
    raise exception 'OWNER_PROTECTED';
  end if;
  if role_action = 'demote' and target_is_admin then
    select count(*) into admin_count from public.profiles p where p.is_admin = true;
    if admin_count <= 1 then raise exception 'CANNOT_DEMOTE_LAST_ADMIN'; end if;
  end if;

  update public.profiles p
  set display_title = trim(new_title),
      title_locked = true,
      is_admin = case role_action when 'promote' then true when 'demote' then false else p.is_admin end
  where p.id = target_user;

  insert into public.moderation_actions(actor_id, action, target_user_id, details)
  values ((select auth.uid()), 'manage_member', target_user,
    jsonb_build_object(
      'title', trim(new_title),
      'role_action', role_action,
      'previous_admin', target_is_admin,
      'permanent_owner', target_is_owner
    ));
  return true;
end;
$$;

revoke all on function public.protect_permanent_owner() from public;
revoke all on function public.protect_owner_moderation() from public;
revoke all on function public.current_user_is_owner() from public;
revoke all on function public.admin_get_member_by_uid_v2(bigint) from public;
revoke all on function public.admin_manage_member(uuid, text, text) from public;

grant execute on function public.current_user_is_owner() to authenticated;
grant execute on function public.admin_get_member_by_uid_v2(bigint) to authenticated;
grant execute on function public.admin_manage_member(uuid, text, text) to authenticated;

-- 最终断言：脚本只有在目标账号确实被锁定时才允许提交事务。
do $$
begin
  if not exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = 'fec1e98c-1b1b-4057-9a94-d14bc4b89b99'::uuid
      and lower(trim(p.username)) = lower('Cnbdg')
      and p.is_owner = true
      and p.is_admin = true
      and p.title_locked = true
  ) then
    raise exception 'OWNER_PROTECTION_VERIFICATION_FAILED';
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
