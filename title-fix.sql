-- 头衔功能独立修复：可重复执行。
alter table public.profiles
  add column if not exists display_title text not null default '社区成员';

alter table public.profiles
  drop constraint if exists profiles_display_title_check;

alter table public.profiles
  add constraint profiles_display_title_check
  check (char_length(trim(display_title)) between 1 and 30);

-- UID 2 的指定头衔；没有该用户时不会修改任何行。
update public.profiles
set display_title = '罗布乐思小鸡鸡'
where user_uid = 2;

notify pgrst, 'reload schema';
