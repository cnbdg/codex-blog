-- 社区图片存储修复（可重复执行）。
-- 已确认线上 community-media 桶不存在时，Storage 会返回 404 NoSuchBucket，
-- 上传会在写入论坛话题前失败。请将本文件完整复制到 Supabase SQL Editor 后执行一次。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-media',
  'community-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 公开桶可以直接通过 public URL 展示图片；这里不开放对象列表，
-- 只允许用户读取、上传和删除自己 UUID 目录中的对象。
drop policy if exists "Community images are publicly readable" on storage.objects;
drop policy if exists "Signed-in users upload community images" on storage.objects;
drop policy if exists "Users delete own community images" on storage.objects;
drop policy if exists "Users can read their own community image metadata" on storage.objects;

create policy "Users can read their own community image metadata"
on storage.objects for select to authenticated
using (
  bucket_id = 'community-media'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);

create policy "Signed-in users upload community images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'community-media'
  and (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);

create policy "Users delete own community images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'community-media'
  and owner_id = (select auth.uid()::text)
);
