-- cnbdg 聊天发送接口急救脚本
-- 用途：修复“群消息发送失败：消息引用功能尚未启用”等问题。
-- 只重建私信/群聊的发送函数（含“文本+引用”重载），不影响任何消息数据。
-- 在 Supabase SQL Editor 完整执行一次即可；可重复执行。

-- 1. 私信发送：重建全部重载（纯文本 / 文本+媒体 / 文本+引用 / 全量）
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

-- 2. 群聊发送：重建全部重载
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

-- 3. 权限：只允许登录用户调用
revoke all on function public.send_direct_message(uuid, text) from public;
revoke all on function public.send_direct_message(uuid, text, text) from public;
revoke all on function public.send_direct_message(uuid, text, bigint) from public;
revoke all on function public.send_direct_message(uuid, text, text, bigint) from public;
revoke all on function public.send_group_chat_message(uuid, text) from public;
revoke all on function public.send_group_chat_message(uuid, text, text) from public;
revoke all on function public.send_group_chat_message(uuid, text, bigint) from public;
revoke all on function public.send_group_chat_message(uuid, text, text, bigint) from public;
grant execute on function public.send_direct_message(uuid, text) to authenticated;
grant execute on function public.send_direct_message(uuid, text, text) to authenticated;
grant execute on function public.send_direct_message(uuid, text, bigint) to authenticated;
grant execute on function public.send_direct_message(uuid, text, text, bigint) to authenticated;
grant execute on function public.send_group_chat_message(uuid, text) to authenticated;
grant execute on function public.send_group_chat_message(uuid, text, text) to authenticated;
grant execute on function public.send_group_chat_message(uuid, text, bigint) to authenticated;
grant execute on function public.send_group_chat_message(uuid, text, text, bigint) to authenticated;

-- 4. 刷新 PostgREST schema 缓存，让新签名立即生效
notify pgrst, 'reload schema';
