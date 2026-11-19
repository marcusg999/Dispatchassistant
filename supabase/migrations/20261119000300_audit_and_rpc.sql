-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log (written by triggers so it can't be skipped) and admin RPCs.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.audit(p_action text, p_suggestion uuid, p_before jsonb, p_after jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_email, action, suggestion_id, before, after)
  values (private.current_email(), p_action, p_suggestion, p_before, p_after);
$$;
revoke all on function private.audit(text, uuid, jsonb, jsonb) from public, anon, authenticated;

-- ── suggestions: one audit row per kind of change ────────────────────────────
create or replace function private.tg_suggestions_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Never copy the body or photo into the log: a hard delete must actually remove them.
    perform private.audit('hard_delete', old.id,
      jsonb_build_object('category', old.category, 'status', old.status, 'admin_tag', old.admin_tag,
                         'created_at', old.created_at, 'had_photo', old.photo_path is not null),
      null);
    return old;
  end if;

  if new.admin_tag is distinct from old.admin_tag then
    perform private.audit('retag', new.id,
      jsonb_build_object('admin_tag', old.admin_tag), jsonb_build_object('admin_tag', new.admin_tag));
  end if;
  if new.status is distinct from old.status then
    perform private.audit('status_change', new.id,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  if new.public_reply is distinct from old.public_reply then
    perform private.audit('public_reply', new.id,
      jsonb_build_object('public_reply', old.public_reply), jsonb_build_object('public_reply', new.public_reply));
  end if;
  if new.published_to_board is distinct from old.published_to_board then
    perform private.audit(case when new.published_to_board then 'publish' else 'unpublish' end, new.id,
      jsonb_build_object('published_to_board', old.published_to_board, 'board_summary', old.board_summary),
      jsonb_build_object('published_to_board', new.published_to_board, 'board_summary', new.board_summary));
  elsif new.board_summary is distinct from old.board_summary then
    perform private.audit('board_summary', new.id,
      jsonb_build_object('board_summary', old.board_summary), jsonb_build_object('board_summary', new.board_summary));
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    perform private.audit(case when new.deleted_at is null then 'restore' else 'soft_delete' end, new.id,
      jsonb_build_object('deleted_at', old.deleted_at), jsonb_build_object('deleted_at', new.deleted_at));
  end if;
  return new;
end;
$$;
create trigger suggestions_audit
  after update or delete on public.suggestions
  for each row execute function private.tg_suggestions_audit();

-- ── notes ────────────────────────────────────────────────────────────────────
create or replace function private.tg_notes_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('note_added', new.suggestion_id, null,
      jsonb_build_object('note_id', new.id, 'body', new.body));
  elsif tg_op = 'UPDATE' then
    perform private.audit('note_edited', new.suggestion_id,
      jsonb_build_object('note_id', old.id, 'body', old.body), jsonb_build_object('note_id', new.id, 'body', new.body));
  else
    -- Cascade deletes from a hard delete are already covered by 'hard_delete'.
    if exists (select 1 from public.suggestions where id = old.suggestion_id) then
      perform private.audit('note_deleted', old.suggestion_id, jsonb_build_object('note_id', old.id, 'body', old.body), null);
    end if;
  end if;
  return null;
end;
$$;
create trigger notes_audit
  after insert or update or delete on public.admin_notes
  for each row execute function private.tg_notes_audit();

-- ── admins ───────────────────────────────────────────────────────────────────
create or replace function private.tg_admins_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.audit('admin_added', null, null, jsonb_build_object('email', new.email));
  else
    perform private.audit('admin_removed', null, jsonb_build_object('email', old.email), null);
  end if;
  return null;
end;
$$;
create trigger admins_audit
  after insert or delete on public.admins
  for each row execute function private.tg_admins_audit();

revoke all on function private.tg_suggestions_audit() from public, anon, authenticated;
revoke all on function private.tg_notes_audit() from public, anon, authenticated;
revoke all on function private.tg_admins_audit() from public, anon, authenticated;

-- ── RPC: log an export or backup (generated in the browser) ──────────────────
create or replace function private.log_export(p_format text, p_filters jsonb, p_row_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_format not in ('xlsx', 'docx', 'backup_json') then
    raise exception 'unknown export format';
  end if;
  perform private.audit(case when p_format = 'backup_json' then 'backup' else 'export' end, null, null,
    jsonb_build_object('format', p_format, 'filters', coalesce(p_filters, '{}'::jsonb), 'rows', p_row_count));
end;
$$;
revoke all on function private.log_export(text, jsonb, integer) from public, anon;
grant execute on function private.log_export(text, jsonb, integer) to authenticated;

create or replace function public.log_export(p_format text, p_filters jsonb, p_row_count integer)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.log_export(p_format, p_filters, p_row_count); $$;
revoke all on function public.log_export(text, jsonb, integer) from public, anon;
grant execute on function public.log_export(text, jsonb, integer) to authenticated;

-- ── RPC: hard delete ─────────────────────────────────────────────────────────
-- Returns the photo path so the console can remove the Storage object first.
-- (Supabase doesn't allow deleting storage objects from SQL; the console calls the
-- Storage API, which the admin delete policy on storage.objects permits.)
create or replace function private.hard_delete_suggestion(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.suggestions where id = p_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function private.hard_delete_suggestion(uuid) from public, anon;
grant execute on function private.hard_delete_suggestion(uuid) to authenticated;

create or replace function public.hard_delete_suggestion(p_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.hard_delete_suggestion(p_id); $$;
revoke all on function public.hard_delete_suggestion(uuid) from public, anon;
grant execute on function public.hard_delete_suggestion(uuid) to authenticated;

-- ── Public read paths used ONLY by the server functions (service role) ───────
-- Explicit column lists guarantee that status and board can never leak body, photo or tags.
-- SECURITY INVOKER + execute granted only to service_role: anon/authenticated can't call them.
create or replace function public.portal_status(p_hash text)
returns table (status public.suggestion_status, public_reply text, updated_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.status, s.public_reply, s.updated_at
  from public.suggestions s
  where s.tracking_hash = p_hash and s.deleted_at is null
  limit 1;
$$;

create or replace function public.portal_board(p_limit integer default 100)
returns table (board_summary text, category public.suggestion_category, status public.suggestion_status, date timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.board_summary, s.category, s.status, s.updated_at
  from public.suggestions s
  where s.published_to_board and s.deleted_at is null
  order by s.updated_at desc
  limit least(greatest(p_limit, 1), 200);
$$;

revoke all on function public.portal_status(text) from public, anon, authenticated;
revoke all on function public.portal_board(integer) from public, anon, authenticated;
grant execute on function public.portal_status(text) to service_role;
grant execute on function public.portal_board(integer) to service_role;

-- Trivial query for the free-plan keep-alive job.
create or replace function public.keep_alive()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$ select 1; $$;
revoke all on function public.keep_alive() from public, anon, authenticated;
grant execute on function public.keep_alive() to service_role;
