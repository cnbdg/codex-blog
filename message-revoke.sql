-- cnbdg 消息撤回功能
-- 在 Supabase SQL Editor 完整执行一次；可重复执行，不删除消息或用户。
-- 私信与群聊消息支持“发送者 2 分钟内撤回”：撤回后消息内容不再展示，
-- 前端显示“xx 撤回了一条消息”，被引用的已撤回消息显示“消息已被撤回”。

-- 1. 私信表增加撤回时间字段
alter table public.direct_messages
  add column if not exists revoked_at timestamptz;

-- 2. 群聊消息表增加撤回时间字段
alter table public.group_chat_messages
  add column if not exists revoked_at timestamptz;

-- 3. 私信撤回
create or replace function public.revoke_direct_message(p_message_id bigint)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  message_row public.direct_messages%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into message_row from public.direct_messages where id = p_message_id;
  if message_row.id is null then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if message_row.sender_id <> auth.uid() then raise exception 'CANNOT_REVOKE_OTHER'; end if;
  if message_row.revoked_at is not null then return false; end if;
  if now() - message_row.created_at > interval '2 minutes' then
    raise exception 'REVOKE_WINDOW_EXPIRED';
  end if;
  update public.direct_messages set revoked_at = now() where id = p_message_id;
  return true;
end;
$$;

-- 4. 群聊消息撤回
create or replace function public.revoke_group_chat_message(p_message_id bigint)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  message_row public.group_chat_messages%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into message_row from public.group_chat_messages where id = p_message_id;
  if message_row.id is null then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if message_row.sender_id <> auth.uid() then raise exception 'CANNOT_REVOKE_OTHER'; end if;
  if not public.is_group_chat_member(message_row.group_id, auth.uid()) then
    raise exception 'GROUP_MEMBERSHIP_REQUIRED';
  end if;
  if message_row.revoked_at is not null then return false; end if;
  if now() - message_row.created_at > interval '2 minutes' then
    raise exception 'REVOKE_WINDOW_EXPIRED';
  end if;
  update public.group_chat_messages set revoked_at = now() where id = p_message_id;
  return true;
end;
$$;

-- 发送函数重载（与 message-quote.sql 保持一致，本脚本可独立执行修复）
drop function if exists public.send_direct_message(uuid, text);
drop function if exists public.send_direct_message(uuid, text, text);
drop function if exists public.send_direct_message(uuid, text, bigint);
drop function if exists public.send_direct_message(uuid, text, text, bigint);

create function public.send_direct_message(
  recipient_user uuid,
  message_content text,
  message_image_path text,
  p_reply_to_id bigint
)
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
  if p_reply_to_id is not null and not exists(
    select 1 from public.direct_messages
    where id = p_reply_to_id
      and ((sender_id = auth.uid() and recipient_id = recipient_user)
        or (sender_id = recipient_user and recipient_id = auth.uid()))
  ) then raise exception 'INVALID_REPLY_TARGET'; end if;
  insert into public.direct_messages(sender_id, recipient_id, content, image_path, reply_to_id)
  values (auth.uid(), recipient_user, clean_content, clean_media_path, p_reply_to_id) returning id into new_id;
  return new_id;
end;
$$;

create function public.send_direct_message(recipient_user uuid, message_content text, message_image_path text)
returns bigint language sql security definer set search_path = public as $$
  select public.send_direct_message(recipient_user, message_content, message_image_path, null);
$$;

create function public.send_direct_message(recipient_user uuid, message_content text)
returns bigint language sql security definer set search_path = public as $$
  select public.send_direct_message(recipient_user, message_content, null, null);
$$;

create function public.send_direct_message(recipient_user uuid, message_content text, p_reply_to_id bigint)
returns bigint language sql security definer set search_path = public as $$
  select public.send_direct_message(recipient_user, message_content, null, p_reply_to_id);
$$;

drop function if exists public.send_group_chat_message(uuid, text);
drop function if exists public.send_group_chat_message(uuid, text, text);
drop function if exists public.send_group_chat_message(uuid, text, bigint);
drop function if exists public.send_group_chat_message(uuid, text, text, bigint);

create function public.send_group_chat_message(
  p_group_id uuid,
  p_content text,
  p_media_path text,
  p_reply_to_id bigint
)
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
  if p_reply_to_id is not null and not exists(
    select 1 from public.group_chat_messages
    where id = p_reply_to_id and group_id = p_group_id
  ) then raise exception 'INVALID_REPLY_TARGET'; end if;
  insert into public.group_chat_messages(group_id, sender_id, content, media_path, reply_to_id)
  values (p_group_id, auth.uid(), clean_content, clean_media_path, p_reply_to_id) returning id into new_message_id;
  update public.group_chat_members set last_read_at = now() where group_id = p_group_id and user_id = auth.uid();
  return new_message_id;
end;
$$;

create function public.send_group_chat_message(p_group_id uuid, p_content text, p_media_path text)
returns bigint language sql security definer set search_path = public as $$
  select public.send_group_chat_message(p_group_id, p_content, p_media_path, null);
$$;

create function public.send_group_chat_message(p_group_id uuid, p_content text)
returns bigint language sql security definer set search_path = public as $$
  select public.send_group_chat_message(p_group_id, p_content, null, null);
$$;

create function public.send_group_chat_message(p_group_id uuid, p_content text, p_reply_to_id bigint)
returns bigint language sql security definer set search_path = public as $$
  select public.send_group_chat_message(p_group_id, p_content, null, p_reply_to_id);
$$;

-- 5. 列表接口返回撤回状态
drop function if exists public.list_direct_messages(uuid);
create function public.list_direct_messages(other_user uuid)
returns table (
  id bigint,
  sender_id uuid,
  recipient_id uuid,
  content text,
  image_path text,
  created_at timestamptz,
  revoked_at timestamptz,
  reply_to_id bigint,
  reply_sender_id uuid,
  reply_sender_name text,
  reply_content text,
  reply_image_path text,
  reply_created_at timestamptz,
  reply_revoked_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.can_send_direct_media_path(other_user::text) then raise exception 'MUTUAL_FOLLOW_REQUIRED'; end if;
  return query
  select m.id, m.sender_id, m.recipient_id, m.content, m.image_path, m.created_at, m.revoked_at,
    quoted.id as reply_to_id, quoted.sender_id as reply_sender_id,
    coalesce(quoted_sender.username, '社区用户') as reply_sender_name,
    quoted.content as reply_content, quoted.image_path as reply_image_path, quoted.created_at as reply_created_at,
    quoted.revoked_at as reply_revoked_at
  from public.direct_messages m
  left join public.direct_messages quoted on quoted.id = m.reply_to_id
  left join public.profiles quoted_sender on quoted_sender.id = quoted.sender_id
  where (m.sender_id = auth.uid() and m.recipient_id = other_user)
     or (m.sender_id = other_user and m.recipient_id = auth.uid())
  order by m.created_at asc;
end;
$$;

drop function if exists public.list_group_chat_messages(uuid, integer);
create function public.list_group_chat_messages(p_group_id uuid, p_limit integer default 120)
returns table (
  id bigint,
  group_id uuid,
  sender_id uuid,
  content text,
  media_path text,
  created_at timestamptz,
  sender_username text,
  sender_avatar_url text,
  sender_uid bigint,
  sender_title text,
  revoked_at timestamptz,
  reply_to_id bigint,
  reply_sender_id uuid,
  reply_sender_name text,
  reply_content text,
  reply_media_path text,
  reply_created_at timestamptz,
  reply_revoked_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_group_chat_member(p_group_id, auth.uid()) then raise exception 'GROUP_MEMBERSHIP_REQUIRED'; end if;
  return query
  select ordered.id, ordered.group_id, ordered.sender_id, ordered.content, ordered.media_path, ordered.created_at,
    ordered.sender_username, ordered.sender_avatar_url, ordered.sender_uid, ordered.sender_title, ordered.revoked_at,
    quoted.id as reply_to_id, quoted.sender_id as reply_sender_id,
    coalesce(quoted_sender.username, '社区用户') as reply_sender_name,
    quoted.content as reply_content, quoted.media_path as reply_media_path, quoted.created_at as reply_created_at,
    quoted.revoked_at as reply_revoked_at
  from (
    select message.id, message.group_id, message.sender_id, message.content, message.media_path, message.created_at, message.reply_to_id, message.revoked_at,
      coalesce(sender.username, '社区用户') as sender_username, sender.avatar_url as sender_avatar_url,
      sender.user_uid as sender_uid, sender.display_title as sender_title
    from public.group_chat_messages message
    left join public.profiles sender on sender.id = message.sender_id
    where message.group_id = p_group_id
    order by message.created_at desc
    limit least(greatest(coalesce(p_limit, 120), 1), 200)
  ) ordered
  left join public.group_chat_messages quoted on quoted.id = ordered.reply_to_id
  left join public.profiles quoted_sender on quoted_sender.id = quoted.sender_id
  order by ordered.created_at asc;
end;
$$;

-- 6. 权限
revoke all on function public.revoke_direct_message(bigint) from public;
revoke all on function public.revoke_group_chat_message(bigint) from public;
revoke all on function public.list_direct_messages(uuid) from public;
revoke all on function public.list_group_chat_messages(uuid, integer) from public;
revoke all on function public.send_direct_message(uuid, text) from public;
revoke all on function public.send_direct_message(uuid, text, text) from public;
revoke all on function public.send_direct_message(uuid, text, bigint) from public;
revoke all on function public.send_direct_message(uuid, text, text, bigint) from public;
revoke all on function public.send_group_chat_message(uuid, text) from public;
revoke all on function public.send_group_chat_message(uuid, text, text) from public;
revoke all on function public.send_group_chat_message(uuid, text, bigint) from public;
revoke all on function public.send_group_chat_message(uuid, text, text, bigint) from public;
grant execute on function public.revoke_direct_message(bigint) to authenticated;
grant execute on function public.revoke_group_chat_message(bigint) to authenticated;
grant execute on function public.list_direct_messages(uuid) to authenticated;
grant execute on function public.list_group_chat_messages(uuid, integer) to authenticated;
grant execute on function public.send_direct_message(uuid, text) to authenticated;
grant execute on function public.send_direct_message(uuid, text, text) to authenticated;
grant execute on function public.send_direct_message(uuid, text, bigint) to authenticated;
grant execute on function public.send_direct_message(uuid, text, text, bigint) to authenticated;
grant execute on function public.send_group_chat_message(uuid, text) to authenticated;
grant execute on function public.send_group_chat_message(uuid, text, text) to authenticated;
grant execute on function public.send_group_chat_message(uuid, text, bigint) to authenticated;
grant execute on function public.send_group_chat_message(uuid, text, text, bigint) to authenticated;

-- 刷新 PostgREST schema 缓存，让前端立即可调用新的 RPC 签名
notify pgrst, 'reload schema';
