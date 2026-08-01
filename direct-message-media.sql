-- 私信图片功能初始化（可重复执行）。
-- 请先确认已执行 private-chat.sql、social-inbox.sql 与 chat-realtime.sql，
-- 然后将本文件完整复制到 Supabase Dashboard → SQL Editor 执行一次。
-- 图片存储在私有的 direct-message-media 桶中；仅私信双方可取得短时签名链接。

alter table public.direct_messages
  add column if not exists image_path text;

-- 旧约束只允许纯文本。升级后允许“文字、图片或两者同时发送”，但仍拒绝空消息。
alter table public.direct_messages
  drop constraint if exists direct_messages_content_check;
alter table public.direct_messages
  drop constraint if exists direct_messages_content_or_image_check;
alter table public.direct_messages
  add constraint direct_messages_content_or_image_check
  check (
    char_length(trim(content)) between 1 and 2000
    or (image_path is not null and char_length(trim(image_path)) between 1 and 500)
  );

-- Storage 策略无法安全地把任意文本直接转换为 UUID，交给安全函数验证对方身份与互相关注关系。
create or replace function public.can_send_direct_media_path(target_user_text text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  target_user uuid;
begin
  if auth.uid() is null then return false; end if;
  begin
    target_user := target_user_text::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if target_user = auth.uid() then return false; end if;
  return exists (
    select 1 from public.user_follows
    where follower_id = auth.uid() and following_id = target_user
  ) and exists (
    select 1 from public.user_follows
    where follower_id = target_user and following_id = auth.uid()
  );
end;
$$;

revoke all on function public.can_send_direct_media_path(text) from public;
grant execute on function public.can_send_direct_media_path(text) to authenticated;

-- 同时保留旧的两参数入口，确保升级前后的纯文字私信调用都不会中断。
drop function if exists public.send_direct_message(uuid, text);
drop function if exists public.send_direct_message(uuid, text, text);
create function public.send_direct_message(
  recipient_user uuid,
  message_content text,
  message_image_path text
)
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  new_id bigint;
  clean_content text := trim(coalesce(message_content, ''));
  clean_image_path text := nullif(trim(coalesce(message_image_path, '')), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if recipient_user = auth.uid() then raise exception 'CANNOT_MESSAGE_SELF'; end if;
  if char_length(clean_content) > 2000 then raise exception 'INVALID_MESSAGE'; end if;
  if clean_content = '' and clean_image_path is null then raise exception 'INVALID_MESSAGE'; end if;
  if not (
    exists(select 1 from public.user_follows where follower_id = auth.uid() and following_id = recipient_user)
    and exists(select 1 from public.user_follows where follower_id = recipient_user and following_id = auth.uid())
  ) then raise exception 'MUTUAL_FOLLOW_REQUIRED'; end if;

  if clean_image_path is not null then
    if char_length(clean_image_path) > 500
      or clean_image_path !~ ('^' || auth.uid()::text || '/' || recipient_user::text || '/[^/]+$') then
      raise exception 'INVALID_MESSAGE_IMAGE';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'direct-message-media'
        and name = clean_image_path
        and owner_id = auth.uid()::text
    ) then
      raise exception 'INVALID_MESSAGE_IMAGE';
    end if;
  end if;

  insert into public.direct_messages(sender_id, recipient_id, content, image_path)
  values (auth.uid(), recipient_user, clean_content, clean_image_path)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.send_direct_message(uuid, text, text) from public;
grant execute on function public.send_direct_message(uuid, text, text) to authenticated;

create function public.send_direct_message(recipient_user uuid, message_content text)
returns bigint
language sql security definer set search_path = public
as $$
  select public.send_direct_message(recipient_user, message_content, null);
$$;

revoke all on function public.send_direct_message(uuid, text) from public;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

-- 返回存储路径而非公开 URL，浏览器再按当前会话权限换取签名链接。
drop function if exists public.list_direct_messages(uuid);
create function public.list_direct_messages(other_user uuid)
returns table (
  id bigint,
  sender_id uuid,
  recipient_id uuid,
  content text,
  image_path text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (
    exists(select 1 from public.user_follows where follower_id = auth.uid() and following_id = other_user)
    and exists(select 1 from public.user_follows where follower_id = other_user and following_id = auth.uid())
  ) then raise exception 'MUTUAL_FOLLOW_REQUIRED'; end if;
  return query
    select m.id, m.sender_id, m.recipient_id, m.content, m.image_path, m.created_at
    from public.direct_messages m
    where (m.sender_id = auth.uid() and m.recipient_id = other_user)
       or (m.sender_id = other_user and m.recipient_id = auth.uid())
    order by m.created_at asc;
end;
$$;

revoke all on function public.list_direct_messages(uuid) from public;
grant execute on function public.list_direct_messages(uuid) to authenticated;

-- 私有桶：不能使用 public URL，前端会在读取消息时生成短时签名 URL。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'direct-message-media',
  'direct-message-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Direct message participants can read media" on storage.objects;
drop policy if exists "Mutual followers upload direct message media" on storage.objects;
drop policy if exists "Message senders delete their own media" on storage.objects;

create policy "Direct message participants can read media"
on storage.objects for select to authenticated
using (
  bucket_id = 'direct-message-media'
  and array_length(storage.foldername(name), 1) = 2
  and (
    (
      (storage.foldername(name))[1] = (select auth.uid()::text)
      and public.can_send_direct_media_path((storage.foldername(name))[2])
    ) or (
      (storage.foldername(name))[2] = (select auth.uid()::text)
      and public.can_send_direct_media_path((storage.foldername(name))[1])
    )
  )
);

create policy "Mutual followers upload direct message media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'direct-message-media'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and public.can_send_direct_media_path((storage.foldername(name))[2])
);

create policy "Message senders delete their own media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'direct-message-media'
  and owner_id = (select auth.uid()::text)
);

-- 更新私信通知预览：纯图片消息也会展示明确提示，而不是空白。
create or replace function public.notify_direct_message_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender_name text;
  sender_avatar_url text;
  preview_text text;
begin
  select username, avatar_url into sender_name, sender_avatar_url
  from public.profiles where id = new.sender_id;

  preview_text := case
    when nullif(trim(coalesce(new.content, '')), '') is not null
      then left(regexp_replace(new.content, '[[:space:]]+', ' ', 'g'), 80)
    when new.image_path is not null then '[图片]'
    else '给你发来一条新消息'
  end;

  insert into public.notifications(recipient_id, actor_id, kind, target_type, target_id, payload)
  values (
    new.recipient_id,
    new.sender_id,
    'direct_message',
    'direct_message',
    new.id,
    jsonb_build_object(
      'message', case when new.image_path is not null and nullif(trim(coalesce(new.content, '')), '') is null
        then '给你发来一张图片' else '给你发来一条私信' end,
      'preview', preview_text,
      'sender_name', coalesce(sender_name, '社区用户'),
      'sender_avatar_url', sender_avatar_url
    )
  );
  return new;
end;
$$;

drop trigger if exists after_direct_message_created on public.direct_messages;
create trigger after_direct_message_created
  after insert on public.direct_messages
  for each row execute procedure public.notify_direct_message_created();

notify pgrst, 'reload schema';
