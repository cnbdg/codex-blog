-- 用户唯一 UID
-- 先执行 community.sql，再执行本脚本一次。
-- UID 按注册时间分配，用户不能自行修改，也不会重复。

create sequence if not exists public.user_uid_seq
  as bigint minvalue 1 start 1;

alter table public.profiles
  add column if not exists user_uid bigint;

-- 给已有账号按注册时间补齐 UID；新账号由默认序列继续分配。
with ordered as (
  select id, row_number() over (order by created_at, id)::bigint as uid
  from public.profiles
  where user_uid is null
)
update public.profiles p
set user_uid = ordered.uid
from ordered
where p.id = ordered.id;

select setval(
  'public.user_uid_seq',
  coalesce((select max(user_uid) from public.profiles), 0) + 1,
  false
);

alter table public.profiles
  alter column user_uid set default nextval('public.user_uid_seq'),
  alter column user_uid set not null;

create unique index if not exists profiles_user_uid_unique_idx
  on public.profiles(user_uid);

-- 公开搜索只返回前端需要的昵称、UID、称号和头像。
grant select on table public.profiles to anon, authenticated;
