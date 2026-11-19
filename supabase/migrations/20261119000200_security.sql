-- ─────────────────────────────────────────────────────────────────────────────
-- Access control: is_admin(), RLS policies, column grants, last-admin guard,
-- and the before-user-created auth hook.
--
-- Model:
--   anon                      → nothing (the portal never talks to Supabase directly)
--   authenticated, non-admin  → nothing
--   authenticated + is_admin()→ read/triage suggestions, notes, manage admins, read audit log
--   service_role              → used only inside Netlify Functions (insert submissions, upload photos)
-- ─────────────────────────────────────────────────────────────────────────────

-- Privileged helpers live in a schema PostgREST does NOT expose, so they can be
-- used by policies and triggers but never called directly over the REST API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ── is_admin() ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can read public.admins without granting clients SELECT
-- on the allow-list. Compares the verified JWT email claim, case-insensitively.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  and coalesce(auth.jwt() ->> 'role', '') = 'authenticated';
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

-- Public, SECURITY INVOKER wrapper: lets the console ask "am I an admin?" for UX only.
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_admin(); $$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Email of the signed-in user, for audit rows and note authorship.
create or replace function private.current_email()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', 'system'));
$$;
revoke all on function private.current_email() from public, anon;
grant execute on function private.current_email() to authenticated, service_role;

-- ── Table privileges (defense in depth beneath RLS) ──────────────────────────
-- Supabase grants broad table privileges to anon/authenticated by default and
-- relies on RLS. We remove them so a missing policy can never become a leak.
-- TRUNCATE is not covered by RLS, so it is revoked everywhere.
revoke all on public.suggestions, public.admin_notes, public.admins, public.audit_log from anon, authenticated;

grant select on public.suggestions to authenticated;
-- Admins may change only the triage fields. Body, original tag, photo and hash are immutable.
grant update (admin_tag, status, public_reply, published_to_board, board_summary, deleted_at)
  on public.suggestions to authenticated;

grant select, insert, update, delete on public.admin_notes to authenticated;
grant select, insert, delete on public.admins to authenticated;
grant select on public.audit_log to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.suggestions enable row level security;
alter table public.admin_notes enable row level security;
alter table public.admins      enable row level security;
alter table public.audit_log   enable row level security;

-- (Not FORCE: the SECURITY DEFINER helpers run as the table owner and must read the allow-list.)

-- suggestions: admins read and update. No insert (server only), no delete (RPC only).
create policy suggestions_admin_select on public.suggestions
  for select to authenticated using ((select private.is_admin()));
create policy suggestions_admin_update on public.suggestions
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- admin_notes: full access for admins.
create policy notes_admin_select on public.admin_notes
  for select to authenticated using ((select private.is_admin()));
create policy notes_admin_insert on public.admin_notes
  for insert to authenticated with check ((select private.is_admin()));
create policy notes_admin_update on public.admin_notes
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy notes_admin_delete on public.admin_notes
  for delete to authenticated using ((select private.is_admin()));

-- admins: admins can list, add and remove (the last-admin guard below protects the final row).
create policy admins_admin_select on public.admins
  for select to authenticated using ((select private.is_admin()));
create policy admins_admin_insert on public.admins
  for insert to authenticated with check ((select private.is_admin()));
create policy admins_admin_delete on public.admins
  for delete to authenticated using ((select private.is_admin()));

-- audit_log: read-only for admins. There is NO insert/update/delete policy for anyone;
-- rows are written only by SECURITY DEFINER triggers and RPCs.
create policy audit_admin_select on public.audit_log
  for select to authenticated using ((select private.is_admin()));

-- ── Forced fields ────────────────────────────────────────────────────────────
create or replace function private.tg_suggestions_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.admin_tag := coalesce(new.admin_tag, new.submitter_tag);
    new.status := 'new';
    new.published_to_board := false;
    new.board_summary := null;
    new.public_reply := null;
    new.deleted_at := null;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger suggestions_before
  before insert or update on public.suggestions
  for each row execute function private.tg_suggestions_before();

-- Note author is always the signed-in admin; it can't be spoofed or edited.
create or replace function private.tg_notes_before()
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
    new.suggestion_id := old.suggestion_id;
  end if;
  return new;
end;
$$;
create trigger notes_before
  before insert or update on public.admin_notes
  for each row execute function private.tg_notes_before();

create or replace function private.tg_admins_before_insert()
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
create trigger admins_before_insert
  before insert on public.admins
  for each row execute function private.tg_admins_before_insert();

-- ── Last-admin guard ─────────────────────────────────────────────────────────
-- A statement-level lock serialises concurrent removals; the AFTER check then
-- sees every committed delete, so two admins removing each other at the same
-- moment cannot leave the table empty.
create or replace function private.tg_admins_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.admins:last-admin-guard'));
  return null;
end;
$$;

create or replace function private.tg_admins_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.admins) then
    raise exception 'Cannot remove the last admin.' using errcode = 'P0001', hint = 'last_admin';
  end if;
  return null;
end;
$$;

create trigger admins_lock_before_delete
  before delete on public.admins
  for each statement execute function private.tg_admins_lock();
create trigger admins_guard_after_delete
  after delete on public.admins
  for each statement execute function private.tg_admins_guard();

-- ── Before-user-created auth hook ────────────────────────────────────────────
-- Google accounts that are not on the allow-list never become users at all.
-- Enable in production: Dashboard → Authentication → Hooks → "Before User Created"
-- → Postgres function public.hook_before_user_created (see SETUP_CHECKLIST.md).
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
  if v_email <> '' and exists (select 1 from public.admins where email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This account is not allowed to sign in.'
    )
  );
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- Lock down every trigger function from direct RPC calls.
revoke all on function private.tg_suggestions_before() from public, anon, authenticated;
revoke all on function private.tg_notes_before() from public, anon, authenticated;
revoke all on function private.tg_admins_before_insert() from public, anon, authenticated;
revoke all on function private.tg_admins_lock() from public, anon, authenticated;
revoke all on function private.tg_admins_guard() from public, anon, authenticated;
