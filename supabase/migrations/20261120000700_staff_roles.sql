-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2 · Roles: admin · dispatcher · viewer · crew  (one role per email)
--
-- Compatibility (see DECISIONS.md): public.admins stays a real table and remains
-- the source of truth for the admin role, so private.is_admin() and every Phase 1
-- policy/test are untouched. staff_roles holds ALL roles; admin rows are kept in
-- sync with public.admins in both directions by triggers.
-- HR (hr_staff / is_hr) stays completely separate and is not a staff role.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.staff_role as enum ('admin', 'dispatcher', 'viewer', 'crew');

create table public.staff_roles (
  email      text primary key,
  role       public.staff_role not null,
  added_by   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_email_lower check (email = lower(btrim(email))),
  constraint staff_email_fmt   check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
comment on table public.staff_roles is
  'One role per email. Admin rows mirror public.admins (kept in sync by triggers).';

-- Backfill existing admins.
insert into public.staff_roles (email, role, added_by, created_at)
select email, 'admin', added_by, created_at from public.admins
on conflict (email) do nothing;

-- ── Role helpers ─────────────────────────────────────────────────────────────
-- current_role is a reserved SQL word, so the helper is current_staff_role().
create or replace function private.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then null
    when private.is_admin() then 'admin'::public.staff_role
    else (select s.role from public.staff_roles s
          where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
            and s.role <> 'admin')
  end;
$$;
revoke all on function private.current_staff_role() from public, anon;
grant execute on function private.current_staff_role() to authenticated;

create or replace function private.has_role(variadic roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role()::text = any (roles), false);
$$;
revoke all on function private.has_role(text[]) from public, anon;
grant execute on function private.has_role(text[]) to authenticated;

-- Shorthands used by dispatch policies.
create or replace function private.is_office()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_role('admin', 'dispatcher', 'viewer'); $$;
create or replace function private.is_dispatcher()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_role('admin', 'dispatcher'); $$;
revoke all on function private.is_office() from public, anon;
revoke all on function private.is_dispatcher() from public, anon;
grant execute on function private.is_office() to authenticated;
grant execute on function private.is_dispatcher() to authenticated;

-- UX only: lets the console route by role. RLS is the real gate.
create or replace function public.my_staff_role()
returns text language sql stable security invoker set search_path = ''
as $$ select private.current_staff_role()::text; $$;
revoke all on function public.my_staff_role() from public, anon;
grant execute on function public.my_staff_role() to authenticated;

-- ── Privileges + RLS: only admins manage roles ──────────────────────────────
revoke all on public.staff_roles from anon, authenticated;
grant select, insert, update, delete on public.staff_roles to authenticated;
alter table public.staff_roles enable row level security;

create policy staff_roles_select on public.staff_roles for select to authenticated using ((select private.is_admin()));
create policy staff_roles_insert on public.staff_roles for insert to authenticated with check ((select private.is_admin()));
create policy staff_roles_update on public.staff_roles for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy staff_roles_delete on public.staff_roles for delete to authenticated using ((select private.is_admin()));

-- ── Forced fields ────────────────────────────────────────────────────────────
create or replace function private.tg_staff_roles_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.email := lower(btrim(new.email));
  if tg_op = 'INSERT' then
    new.added_by := coalesce(nullif(private.current_email(), 'system'), new.added_by, 'system');
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger staff_roles_before before insert or update on public.staff_roles
  for each row execute function private.tg_staff_roles_before();

-- ── Two-way sync with public.admins ──────────────────────────────────────────
create or replace function private.tg_staff_roles_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'admin' then
    if not exists (select 1 from public.admins where email = new.email) then
      insert into public.admins (email) values (new.email);
    end if;
  end if;
  if (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin')
     or (tg_op = 'DELETE' and old.role = 'admin') then
    if exists (select 1 from public.admins where email = old.email) then
      delete from public.admins where email = old.email;  -- last-admin guard applies here
    end if;
  end if;
  return null;
end;
$$;
create trigger staff_roles_sync after insert or update or delete on public.staff_roles
  for each row execute function private.tg_staff_roles_sync();

create or replace function private.tg_admins_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.staff_roles (email, role, added_by)
    values (new.email, 'admin', new.added_by)
    on conflict (email) do update set role = 'admin'
      where public.staff_roles.role is distinct from 'admin';
  else
    delete from public.staff_roles where email = old.email and role = 'admin';
  end if;
  return null;
end;
$$;
create trigger admins_sync after insert or delete on public.admins
  for each row execute function private.tg_admins_sync();

-- Belt-and-braces: after any change, at least one admin must remain.
create or replace function private.tg_staff_roles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.staff_roles where role = 'admin') then
    raise exception 'Cannot remove the last admin.' using errcode = 'P0001', hint = 'last_admin';
  end if;
  return null;
end;
$$;
create trigger staff_roles_lock before delete or update on public.staff_roles
  for each statement execute function private.tg_admins_lock();
create trigger staff_roles_guard after delete or update on public.staff_roles
  for each statement execute function private.tg_staff_roles_guard();

-- ── Audit (admin rows are already audited as admin_added/admin_removed) ──────
create or replace function private.tg_staff_roles_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.role <> 'admin' then
    perform private.audit('dispatch_role_added', null, null, jsonb_build_object('email', new.email, 'role', new.role));
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    perform private.audit('dispatch_role_changed', null,
      jsonb_build_object('email', old.email, 'role', old.role), jsonb_build_object('email', new.email, 'role', new.role));
  elsif tg_op = 'DELETE' and old.role <> 'admin' then
    perform private.audit('dispatch_role_removed', null, jsonb_build_object('email', old.email, 'role', old.role), null);
  end if;
  return null;
end;
$$;
create trigger staff_roles_audit after insert or update or delete on public.staff_roles
  for each row execute function private.tg_staff_roles_audit();

revoke all on function private.tg_staff_roles_before() from public, anon, authenticated;
revoke all on function private.tg_staff_roles_sync() from public, anon, authenticated;
revoke all on function private.tg_admins_sync() from public, anon, authenticated;
revoke all on function private.tg_staff_roles_guard() from public, anon, authenticated;
revoke all on function private.tg_staff_roles_audit() from public, anon, authenticated;

-- ── Sign-in hook admits staff roles too ──────────────────────────────────────
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
    or exists (select 1 from public.staff_roles where email = v_email)
    or exists (select 1 from public.hr_staff where email = v_email)
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This account is not allowed to sign in.'));
end;
$$;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
