-- 私聊实时同步与未读提醒迁移。
-- 适用于已经执行过 private-chat.sql 与 social-inbox.sql 的项目。
-- 在 Supabase Dashboard → SQL Editor 中完整执行一次即可；可重复执行。

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('follow', 'forum_like', 'comment_like', 'direct_message'));

grant select on public.direct_messages, public.notifications to authenticated;

drop policy if exists "Private message participants can receive messages" on public.direct_messages;
create policy "Private message participants can receive messages"
  on public.direct_messages for select to authenticated
  using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);

drop policy if exists "Recipients can receive their notifications" on public.notifications;
create policy "Recipients can receive their notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = recipient_id);

create or replace function public.notify_direct_message_created()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender_name text;
  sender_avatar_url text;
begin
  select username, avatar_url into sender_name, sender_avatar_url
  from public.profiles where id = new.sender_id;

  insert into public.notifications(recipient_id, actor_id, kind, target_type, target_id, payload)
  values (
    new.recipient_id,
    new.sender_id,
    'direct_message',
    'direct_message',
    new.id,
    jsonb_build_object(
      'message', '给你发来一条私信',
      'preview', left(regexp_replace(new.content, '[[:space:]]+', ' ', 'g'), 80),
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

drop function if exists public.mark_notifications_read();
create function public.mark_notifications_read()
returns void language sql security definer set search_path = public as $$
  update public.notifications
  set read_at = now()
  where recipient_id = auth.uid()
    and read_at is null
    and kind <> 'direct_message';
$$;

create or replace function public.mark_direct_messages_read(sender_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.notifications
  set read_at = now()
  where recipient_id = auth.uid()
    and actor_id = sender_user
    and kind = 'direct_message'
    and read_at is null;
$$;

revoke all on function public.mark_notifications_read(), public.mark_direct_messages_read(uuid) from public;
grant execute on function public.mark_notifications_read(), public.mark_direct_messages_read(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
