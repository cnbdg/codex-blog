-- 社区图片存储。Supabase Dashboard 的 Storage 也会显示 community-media 桶。
insert into storage.buckets (id, name, public) values ('community-media','community-media',true)
on conflict (id) do update set public=true;
create policy "Community images are publicly readable" on storage.objects for select using (bucket_id='community-media');
create policy "Signed-in users upload community images" on storage.objects for insert to authenticated with check (bucket_id='community-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users delete own community images" on storage.objects for delete to authenticated using (bucket_id='community-media' and owner_id = auth.uid()::text);
