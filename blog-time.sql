-- 博客发布时间精确到秒升级
-- 在 Supabase SQL Editor 中执行一次；脚本可重复执行。

do $$
begin
  if to_regclass('public.posts') is null then
    raise exception 'public.posts 不存在，请先执行 cms.sql';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'posts'
      and column_name = 'published_at'
      and data_type = 'date'
  ) then
    alter table public.posts alter column published_at drop default;
    alter table public.posts alter column published_at type timestamptz
      using (published_at::timestamp at time zone 'Asia/Shanghai');
  end if;
end;
$$;

alter table public.posts alter column published_at set default now();

comment on column public.posts.published_at is
  '文章发布时间，包含日期、时分秒和时区；前端统一按 Asia/Shanghai 显示。';

notify pgrst, 'reload schema';
