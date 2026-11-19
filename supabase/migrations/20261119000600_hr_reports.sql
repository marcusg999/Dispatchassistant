-- ─────────────────────────────────────────────────────────────────────────────
-- "HR eyes only": NAMED personal-issue reports, readable only by the HR list.
--
-- Deliberately a separate table so the anonymous `suggestions` table keeps
-- having no identity columns at all. Regular admins cannot read anything here;
-- the audit log records HR actions without names or text.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── HR allow-list ────────────────────────────────────────────────────────────
-- Managed by HR members themselves (not by admins). The first HR email is added
-- with SQL (see SETUP_CHECKLIST.md).
create table public.hr_staff (
  email      text primary key,
  added_by   text,
  created_at timestamptz not null default now(),
  constraint hr_email_lower check (email = lower(btrim(email))),
  constraint hr_email_fmt   check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

create or replace function private.is_hr()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hr_staff h
    where h.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  and coalesce(auth.jwt() ->> 'role', '') = 'authenticated';
$$;
revoke all on function private.is_hr() from public, anon;
grant execute on function private.is_hr() to authenticated;

create or replace function public.is_hr()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_hr(); $$;
revoke all on function public.is_hr() from public, anon;
grant execute on function public.is_hr() to authenticated;

-- ── hr_reports ───────────────────────────────────────────────────────────────
create table public.hr_reports (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  full_name     text not null,
  contact       text,
  body          text not null,
  status        public.suggestion_status not null default 'new',
  public_reply  text,
  tracking_hash text not null unique,
  deleted_at    timestamptz,
  search        tsvector generated always as (
                  to_tsvector('english', coalesce(full_name, '') || ' ' || coalesce(body, '') || ' ' || coalesce(public_reply, ''))
                ) stored,
  constraint hr_name_len    check (char_length(btrim(full_name)) between 2 and 120),
  constraint hr_contact_len check (contact is null or char_length(btrim(contact)) between 3 and 200),
  constraint hr_body_len    check (char_length(btrim(body)) between 10 and 4000),
  constraint hr_reply_len   check (public_reply is null or char_length(public_reply) <= 4000),
  constraint hr_hash_fmt    check (tracking_hash ~ '^[0-9a-f]{64}$')
);
comment on table public.hr_reports is 'Named personal-issue reports. Readable ONLY by public.hr_staff (not by admins).';
create index hr_reports_created_idx on public.hr_reports (created_at desc);
create index hr_reports_status_idx  on public.hr_reports (status);
create index hr_reports_search_idx  on public.hr_reports using gin (search);

create table public.hr_notes (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.hr_reports (id) on delete cascade,
  author_email text not null default '',
  body         text not null,
  created_at   timestamptz not null default now(),
  constraint hr_note_len check (char_length(btrim(body)) between 1 and 4000)
);
create index hr_notes_report_idx on public.hr_notes (report_id, created_at);

-- ── Privileges + RLS ─────────────────────────────────────────────────────────
revoke all on public.hr_staff, public.hr_reports, public.hr_notes from anon, authenticated;
grant select, insert, delete on public.hr_staff to authenticated;
grant select on public.hr_reports to authenticated;
grant update (status, public_reply, deleted_at) on public.hr_reports to authenticated;
grant select, insert, update, delete on public.hr_notes to authenticated;

alter table public.hr_staff   enable row level security;
alter table public.hr_reports enable row level security;
alter table public.hr_notes   enable row level security;

create policy hr_staff_select on public.hr_staff for select to authenticated using ((select private.is_hr()));
create policy hr_staff_insert on public.hr_staff for insert to authenticated with check ((select private.is_hr()));
create policy hr_staff_delete on public.hr_staff for delete to authenticated using ((select private.is_hr()));

create policy hr_reports_select on public.hr_reports for select to authenticated using ((select private.is_hr()));
create policy hr_reports_update on public.hr_reports for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));

create policy hr_notes_select on public.hr_notes for select to authenticated using ((select private.is_hr()));
create policy hr_notes_insert on public.hr_notes for insert to authenticated with check ((select private.is_hr()));
create policy hr_notes_update on public.hr_notes for update to authenticated
  using ((select private.is_hr())) with check ((select private.is_hr()));
create policy hr_notes_delete on public.hr_notes for delete to authenticated using ((select private.is_hr()));

-- Audit log: admins keep seeing everything (HR rows carry no names or text);
-- HR members see only HR rows.
drop policy audit_admin_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using ((select private.is_admin()) or ((select private.is_hr()) and action like 'hr\_%'));

-- ── Forced fields ────────────────────────────────────────────────────────────
create or replace function private.tg_hr_reports_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'new';
    new.public_reply := null;
    new.deleted_at := null;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger hr_reports_before before insert or update on public.hr_reports
  for each row execute function private.tg_hr_reports_before();

create or replace function private.tg_hr_notes_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_email := private.current_email();
    new.created_at := now();
  else
    new.author_email := old.author_email;
    new.created_at := old.created_at;
    new.report_id := old.report_id;
  end if;
  return new;
end;
$$;
revoke all on function private.tg_hr_notes_before() from public, anon, authenticated;

create trigger hr_notes_before before insert or update on public.hr_notes
  for each row execute function private.tg_hr_notes_before();

create or replace function private.tg_hr_staff_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  new.added_by := private.current_email();
  new.created_at := now();
  return new;
end;
$$;
create trigger hr_staff_before_insert before insert on public.hr_staff
  for each row execute function private.tg_hr_staff_before_insert();

-- Keep at least one HR member (same serialised pattern as the admins guard).
create or replace function private.tg_hr_staff_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.hr_staff) then
    raise exception 'Cannot remove the last HR member.' using errcode = 'P0001', hint = 'last_hr';
  end if;
  return null;
end;
$$;
create trigger hr_staff_lock_before_delete before delete on public.hr_staff
  for each statement execute function private.tg_admins_lock();
create trigger hr_staff_guard_after_delete after delete on public.hr_staff
  for each statement execute function private.tg_hr_staff_guard();

-- ── Audit (actions only: never names, contact details or text) ───────────────
create or replace function private.tg_hr_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'hr_reports' then
    if tg_op = 'DELETE' then
      perform private.audit('hr_hard_delete', old.id, jsonb_build_object('status', old.status), null);
      return old;
    end if;
    if new.status is distinct from old.status then
      perform private.audit('hr_status_change', new.id,
        jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
    end if;
    if new.public_reply is distinct from old.public_reply then
      perform private.audit('hr_reply', new.id, null, jsonb_build_object('reply_set', new.public_reply is not null));
    end if;
    if new.deleted_at is distinct from old.deleted_at then
      perform private.audit(case when new.deleted_at is null then 'hr_restore' else 'hr_soft_delete' end, new.id, null, null);
    end if;
    return new;
  elsif tg_table_name = 'hr_notes' then
    if tg_op = 'INSERT' then
      perform private.audit('hr_note_added', new.report_id, null, null);
    elsif tg_op = 'DELETE' and exists (select 1 from public.hr_reports where id = old.report_id) then
      perform private.audit('hr_note_deleted', old.report_id, null, null);
    end if;
    return null;
  else -- hr_staff
    if tg_op = 'INSERT' then
      perform private.audit('hr_member_added', null, null, jsonb_build_object('email', new.email));
    else
      perform private.audit('hr_member_removed', null, jsonb_build_object('email', old.email), null);
    end if;
    return null;
  end if;
end;
$$;
create trigger hr_reports_audit after update or delete on public.hr_reports
  for each row execute function private.tg_hr_audit();
create trigger hr_notes_audit after insert or delete on public.hr_notes
  for each row execute function private.tg_hr_audit();
create trigger hr_staff_audit after insert or delete on public.hr_staff
  for each row execute function private.tg_hr_audit();

revoke all on function private.tg_hr_reports_before() from public, anon, authenticated;
revoke all on function private.tg_hr_staff_before_insert() from public, anon, authenticated;
revoke all on function private.tg_hr_staff_guard() from public, anon, authenticated;
revoke all on function private.tg_hr_audit() from public, anon, authenticated;

-- ── HR RPCs: hard delete and export logging ──────────────────────────────────
create or replace function private.hr_hard_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_hr() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.hr_reports where id = p_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function private.hr_hard_delete(uuid) from public, anon;
grant execute on function private.hr_hard_delete(uuid) to authenticated;
create or replace function public.hr_hard_delete(p_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.hr_hard_delete(p_id); $$;
revoke all on function public.hr_hard_delete(uuid) from public, anon;
grant execute on function public.hr_hard_delete(uuid) to authenticated;

create or replace function private.hr_log_export(p_format text, p_row_count integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_hr() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_format not in ('xlsx', 'backup_json') then raise exception 'unknown export format'; end if;
  perform private.audit(case when p_format = 'backup_json' then 'hr_backup' else 'hr_export' end, null, null,
    jsonb_build_object('format', p_format, 'rows', p_row_count));
end;
$$;
revoke all on function private.hr_log_export(text, integer) from public, anon;
grant execute on function private.hr_log_export(text, integer) to authenticated;
create or replace function public.hr_log_export(p_format text, p_row_count integer)
returns void language sql security invoker set search_path = ''
as $$ select private.hr_log_export(p_format, p_row_count); $$;
revoke all on function public.hr_log_export(text, integer) from public, anon;
grant execute on function public.hr_log_export(text, integer) to authenticated;

-- ── Status lookup now covers HR reports too (same three columns only) ────────
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
  union all
  select h.status, h.public_reply, h.updated_at
  from public.hr_reports h
  where h.tracking_hash = p_hash and h.deleted_at is null
  limit 1;
$$;
revoke all on function public.portal_status(text) from public, anon, authenticated;
grant execute on function public.portal_status(text) to service_role;

-- ── The sign-in hook must also let HR members create their account ───────────
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if v_email <> '' and (
       exists (select 1 from public.admins where email = v_email)
    or exists (select 1 from public.hr_staff where email = v_email)
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This account is not allowed to sign in.'));
end;
$$;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
