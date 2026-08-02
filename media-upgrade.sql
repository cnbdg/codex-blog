-- 全站图片、GIF 与视频功能升级（可重复执行）。
-- 前置要求：community-media.sql、direct-message-media.sql、group-chat.sql 已执行。
-- 在 Supabase Dashboard → SQL Editor 中完整执行本文件一次，然后刷新网站。
-- 图片/GIF 上限由前端限制为 10MB，视频上限为 30MB；Storage 统一使用 30MB 硬限制。

-- 整个升级作为一个原子事务运行。先按网站实际访问顺序统一取得锁，
-- 避免“消息表 → Storage”与发送请求的“Storage → 消息表”形成死锁。
begin;
set local lock_timeout = '30s';
set local statement_timeout = '180s';
select pg_advisory_xact_lock(hashtextextended('cnbdg-media-upgrade-v1', 0));
lock table storage.buckets in access exclusive mode;
lock table storage.objects in access exclusive mode;
lock table public.direct_messages in access exclusive mode;
lock table public.group_chat_messages in access exclusive mode;

-- 1. 扩展社区与私信媒体桶的格式和容量。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('community-media', 'community-media', true, 31457280,
    array['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/webm','video/quicktime']),
  ('direct-message-media', 'direct-message-media', false, 31457280,
    array['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/webm','video/quicktime']),
  ('group-chat-media', 'group-chat-media', false, 31457280,
    array['image/jpeg','image/png','image/gif','image/webp','image/avif','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- 2. 私信继续使用兼容字段 image_path，但现在也可以保存 GIF/视频路径。
alter table public.direct_messages add column if not exists image_path text;
alter table public.direct_messages drop constraint if exists direct_messages_content_check;
alter table public.direct_messages drop constraint if exists direct_messages_content_or_image_check;
alter table public.direct_messages add constraint direct_messages_content_or_image_check check (
  char_length(trim(content)) <= 2000
  and (
    char_length(trim(content)) >= 1
    or (image_path is not null and char_length(trim(image_path)) between 1 and 500)
  )
);

create or replace function public.can_send_direct_media_path(target_user_text text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare target_user uuid;
begin
  if auth.uid() is null then return false; end if;
  begin target_user := target_user_text::uuid;
  exception when invalid_text_representation then return false;
  end;
  if target_user = auth.uid() then return false; end if;
  return exists(select 1 from public.user_follows where follower_id = auth.uid() and following_id = target_user)
    and exists(select 1 from public.user_follows where follower_id = target_user and following_id = auth.uid());
end;
$$;

drop policy if exists "Direct message participants can read media" on storage.objects;
drop policy if exists "Mutual followers upload direct message media" on storage.objects;
drop policy if exists "Message senders delete their own media" on storage.objects;
create policy "Direct message participants can read media" on storage.objects for select to authenticated using (
  bucket_id = 'direct-message-media'
  and array_length(storage.foldername(name), 1) = 2
  and (
    ((storage.foldername(name))[1] = (select auth.uid()::text) and public.can_send_direct_media_path((storage.foldername(name))[2]))
    or ((storage.foldername(name))[2] = (select auth.uid()::text) and public.can_send_direct_media_path((storage.foldername(name))[1]))
  )
);
create policy "Mutual followers upload direct message media" on storage.objects for insert to authenticated with check (
  bucket_id = 'direct-message-media'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and public.can_send_direct_media_path((storage.foldername(name))[2])
);
create policy "Message senders delete their own media" on storage.objects for delete to authenticated using (
  bucket_id = 'direct-message-media' and owner_id = (select auth.uid()::text)
);

drop function if exists public.send_direct_message(uuid, text);
drop function if exists public.send_direct_message(uuid, text, text);
create function public.send_direct_message(recipient_user uuid, message_content text, message_image_path text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  new_id bigint;
  clean_content text := trim(coalesce(message_content, ''));
  clean_media_path text := nullif(trim(coalesce(message_image_path, '')), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if recipient_user = auth.uid() then raise exception 'CANNOT_MESSAGE_SELF'; end if;
  if char_length(clean_content) > 2000 or (clean_content = '' and clean_media_path is null) then raise exception 'INVALID_MESSAGE'; end if;
  if not public.can_send_direct_media_path(recipient_user::text) then raise exception 'MUTUAL_FOLLOW_REQUIRED'; end if;
  if clean_media_path is not null then
    if char_length(clean_media_path) > 500
      or clean_media_path !~ ('^' || auth.uid()::text || '/' || recipient_user::text || '/[^/]+\.(jpg|png|gif|webp|avif|mp4|webm|mov)$')
      or not exists(select 1 from storage.objects where bucket_id = 'direct-message-media' and name = clean_media_path and owner_id = auth.uid()::text)
    then raise exception 'INVALID_MESSAGE_MEDIA'; end if;
  end if;
  insert into public.direct_messages(sender_id, recipient_id, content, image_path)
  values (auth.uid(), recipient_user, clean_content, clean_media_path) returning id into new_id;
  return new_id;
end;
$$;
create function public.send_direct_message(recipient_user uuid, message_content text)
returns bigint language sql security definer set search_path = public as $$
  select public.send_direct_message(recipient_user, message_content, null);
$$;

drop function if exists public.list_direct_messages(uuid);
create function public.list_direct_messages(other_user uuid)
returns table (id bigint, sender_id uuid, recipient_id uuid, content text, image_path text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_send_direct_media_path(other_user::text) then raise exception 'MUTUAL_FOLLOW_REQUIRED'; end if;
  return query select m.id, m.sender_id, m.recipient_id, m.content, m.image_path, m.created_at
  from public.direct_messages m
  where (m.sender_id = auth.uid() and m.recipient_id = other_user)
     or (m.sender_id = other_user and m.recipient_id = auth.uid())
  order by m.created_at asc;
end;
$$;

-- 3. 群聊新增私有媒体路径，并允许“纯媒体”消息。
alter table public.group_chat_messages add column if not exists media_path text;
alter table public.group_chat_messages drop constraint if exists group_chat_messages_content_check;
alter table public.group_chat_messages drop constraint if exists group_chat_messages_content_or_media_check;
alter table public.group_chat_messages add constraint group_chat_messages_content_or_media_check check (
  char_length(trim(content)) <= 2000
  and (
    char_length(trim(content)) >= 1
    or (media_path is not null and char_length(trim(media_path)) between 1 and 500)
  )
);

create or replace function public.is_group_chat_media_member(group_id_text text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare requested_group uuid;
begin
  begin requested_group := group_id_text::uuid;
  exception when invalid_text_representation then return false;
  end;
  return public.is_group_chat_member(requested_group, auth.uid());
end;
$$;

drop policy if exists "Group members can read chat media" on storage.objects;
drop policy if exists "Group members upload chat media" on storage.objects;
drop policy if exists "Group senders delete chat media" on storage.objects;
create policy "Group members can read chat media" on storage.objects for select to authenticated using (
  bucket_id = 'group-chat-media'
  and array_length(storage.foldername(name), 1) = 2
  and public.is_group_chat_media_member((storage.foldername(name))[1])
);
create policy "Group members upload chat media" on storage.objects for insert to authenticated with check (
  bucket_id = 'group-chat-media'
  and array_length(storage.foldername(name), 1) = 2
  and public.is_group_chat_media_member((storage.foldername(name))[1])
  and (storage.foldername(name))[2] = (select auth.uid()::text)
);
create policy "Group senders delete chat media" on storage.objects for delete to authenticated using (
  bucket_id = 'group-chat-media' and owner_id = (select auth.uid()::text)
);

drop function if exists public.list_group_chat_messages(uuid, integer);
create function public.list_group_chat_messages(p_group_id uuid, p_limit integer default 120)
returns table (
  id bigint, group_id uuid, sender_id uuid, content text, media_path text, created_at timestamptz,
  sender_username text, sender_avatar_url text, sender_uid bigint, sender_title text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_group_chat_member(p_group_id, auth.uid()) then raise exception 'GROUP_MEMBERSHIP_REQUIRED'; end if;
  return query
  select ordered.id, ordered.group_id, ordered.sender_id, ordered.content, ordered.media_path, ordered.created_at,
    ordered.sender_username, ordered.sender_avatar_url, ordered.sender_uid, ordered.sender_title
  from (
    select message.id, message.group_id, message.sender_id, message.content, message.media_path, message.created_at,
      coalesce(sender.username, '社区用户') as sender_username, sender.avatar_url as sender_avatar_url,
      sender.user_uid as sender_uid, sender.display_title as sender_title
    from public.group_chat_messages message
    left join public.profiles sender on sender.id = message.sender_id
    where message.group_id = p_group_id
    order by message.created_at desc
    limit least(greatest(coalesce(p_limit, 120), 1), 200)
  ) ordered order by ordered.created_at asc;
end;
$$;

drop function if exists public.send_group_chat_message(uuid, text);
drop function if exists public.send_group_chat_message(uuid, text, text);
create function public.send_group_chat_message(p_group_id uuid, p_content text, p_media_path text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  new_message_id bigint;
  clean_content text := trim(coalesce(p_content, ''));
  clean_media_path text := nullif(trim(coalesce(p_media_path, '')), '');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_group_chat_member(p_group_id, auth.uid()) then raise exception 'GROUP_MEMBERSHIP_REQUIRED'; end if;
  if char_length(clean_content) > 2000 or (clean_content = '' and clean_media_path is null) then raise exception 'INVALID_MESSAGE'; end if;
  if clean_media_path is not null then
    if char_length(clean_media_path) > 500
      or clean_media_path !~ ('^' || p_group_id::text || '/' || auth.uid()::text || '/[^/]+\.(jpg|png|gif|webp|avif|mp4|webm|mov)$')
      or not exists(select 1 from storage.objects where bucket_id = 'group-chat-media' and name = clean_media_path and owner_id = auth.uid()::text)
    then raise exception 'INVALID_MESSAGE_MEDIA'; end if;
  end if;
  insert into public.group_chat_messages(group_id, sender_id, content, media_path)
  values (p_group_id, auth.uid(), clean_content, clean_media_path) returning id into new_message_id;
  update public.group_chat_members set last_read_at = now() where group_id = p_group_id and user_id = auth.uid();
  return new_message_id;
end;
$$;
create function public.send_group_chat_message(p_group_id uuid, p_content text)
returns bigint language sql security definer set search_path = public as $$
  select public.send_group_chat_message(p_group_id, p_content, null);
$$;

create or replace function public.list_my_group_chats()
returns table (
  group_id uuid, group_name text, group_description text, group_avatar_url text, owner_id uuid,
  group_role text, member_count bigint, unread_count bigint, last_message text,
  last_message_at timestamptz, last_sender_name text
)
language sql stable security definer set search_path = public as $$
  select g.id, g.name, g.description, g.avatar_url, g.owner_id, mine.role,
    (select count(*) from public.group_chat_members members where members.group_id = g.id),
    (select count(*) from public.group_chat_messages unread where unread.group_id = g.id
      and unread.sender_id <> auth.uid() and unread.created_at > mine.last_read_at),
    case
      when nullif(trim(coalesce(latest.content, '')), '') is not null then latest.content
      when lower(coalesce(latest.media_path, '')) ~ '\.(mp4|webm|mov)$' then '[视频]'
      when lower(coalesce(latest.media_path, '')) ~ '\.gif$' then '[GIF]'
      when latest.media_path is not null then '[图片]'
      else null
    end,
    latest.created_at, latest.sender_name
  from public.group_chat_members mine
  join public.group_chats g on g.id = mine.group_id
  left join lateral (
    select message.content, message.media_path, message.created_at, coalesce(sender.username, '社区用户') as sender_name
    from public.group_chat_messages message left join public.profiles sender on sender.id = message.sender_id
    where message.group_id = g.id order by message.created_at desc limit 1
  ) latest on true
  where mine.user_id = auth.uid()
  order by coalesce(latest.created_at, g.created_at) desc;
$$;

-- 4. 通知预览会区分图片、GIF 与视频。
create or replace function public.chat_media_label(path text)
returns text language sql immutable set search_path = public as $$
  select case
    when lower(coalesce(path, '')) ~ '\.(mp4|webm|mov)$' then '[视频]'
    when lower(coalesce(path, '')) ~ '\.gif$' then '[GIF]'
    when nullif(trim(coalesce(path, '')), '') is not null then '[图片]'
    else null
  end;
$$;

create or replace function public.notify_direct_message_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare sender_name text; sender_avatar_url text; preview_text text;
begin
  select username, avatar_url into sender_name, sender_avatar_url from public.profiles where id = new.sender_id;
  preview_text := coalesce(
    nullif(left(regexp_replace(new.content, '[[:space:]]+', ' ', 'g'), 80), ''),
    public.chat_media_label(new.image_path), '给你发来一条新消息'
  );
  insert into public.notifications(recipient_id, actor_id, kind, target_type, target_id, payload)
  values (new.recipient_id, new.sender_id, 'direct_message', 'direct_message', new.id,
    jsonb_build_object('message', '给你发来一条私信', 'preview', preview_text,
      'sender_name', coalesce(sender_name, '社区用户'), 'sender_avatar_url', sender_avatar_url));
  return new;
end;
$$;

create or replace function public.notify_group_chat_message_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare sender_name text; sender_avatar text; current_group_name text; preview_text text;
begin
  select username, avatar_url into sender_name, sender_avatar from public.profiles where id = new.sender_id;
  select name into current_group_name from public.group_chats where id = new.group_id;
  preview_text := coalesce(
    nullif(left(regexp_replace(new.content, '[[:space:]]+', ' ', 'g'), 80), ''),
    public.chat_media_label(new.media_path), '发送了一条新消息'
  );
  insert into public.notifications(recipient_id, actor_id, kind, target_type, payload)
  select member.user_id, new.sender_id, 'group_message', 'group_chat',
    jsonb_build_object('message', '在群聊中发送了新消息', 'preview', preview_text,
      'group_id', new.group_id, 'group_name', coalesce(current_group_name, '群聊'),
      'sender_name', coalesce(sender_name, '社区用户'), 'sender_avatar_url', sender_avatar)
  from public.group_chat_members member
  where member.group_id = new.group_id and member.user_id <> new.sender_id;
  return new;
end;
$$;

revoke all on function public.can_send_direct_media_path(text), public.is_group_chat_media_member(text),
  public.chat_media_label(text), public.send_direct_message(uuid,text), public.send_direct_message(uuid,text,text),
  public.list_direct_messages(uuid), public.list_group_chat_messages(uuid,integer),
  public.send_group_chat_message(uuid,text), public.send_group_chat_message(uuid,text,text),
  public.list_my_group_chats() from public;
grant execute on function public.can_send_direct_media_path(text), public.is_group_chat_media_member(text),
  public.send_direct_message(uuid,text), public.send_direct_message(uuid,text,text),
  public.list_direct_messages(uuid), public.list_group_chat_messages(uuid,integer),
  public.send_group_chat_message(uuid,text), public.send_group_chat_message(uuid,text,text),
  public.list_my_group_chats() to authenticated;

notify pgrst, 'reload schema';
commit;
