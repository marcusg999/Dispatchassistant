-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2 · Dispatch board: crew, assets, time off, jobs, stops, items,
-- assignments, checklists, incidents.
--
-- Access model:
--   office read  = admin, dispatcher, viewer      (private.is_office())
--   office write = admin, dispatcher              (private.is_dispatcher())
--   crew         = NO direct table access. Crew read/write only through
--                  SECURITY DEFINER RPCs that return their own assigned jobs with an
--                  explicit column list (no office notes, no other jobs, no rosters).
-- Isolation: no foreign keys into suggestions / admin_notes / hr_*; none of these
-- policies grant anything on those tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Settings (timezone used for day boundaries in conflict checks) ──────────
create table public.app_settings (
  key   text primary key,
  value text not null
);
insert into public.app_settings (key, value) values ('timezone', 'America/Los_Angeles');

create or replace function private.app_tz()
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select value from public.app_settings where key = 'timezone'), 'UTC'); $$;
revoke all on function private.app_tz() from public, anon;
grant execute on function private.app_tz() to authenticated;

-- ── Vocabulary ───────────────────────────────────────────────────────────────
create type public.job_type as enum
  ('pickup', 'delivery', 'install', 'deinstall', 'crating', 'shuttle', 'storage_in', 'storage_out', 'site_survey');
create type public.job_status as enum ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled');
create type public.crew_position as enum ('driver', 'art_handler', 'crater', 'installer', 'lead', 'other');
create type public.asset_kind as enum ('truck', 'van', 'trailer', 'equipment');
create type public.asset_status as enum ('in_service', 'out_of_service', 'maintenance');
create type public.stop_kind as enum ('origin', 'destination', 'stop');
create type public.packing_kind as enum ('crated', 'soft_pack');
create type public.incident_status as enum ('open', 'under_review', 'closed');

-- Fixed flag vocabularies (validated with CHECK; labels live in the app).
create or replace function private.valid_flags(flags text[], allowed text[])
returns boolean language sql immutable set search_path = ''
as $$ select coalesce(flags, '{}'::text[]) <@ allowed and cardinality(coalesce(flags, '{}')) = cardinality(array(select distinct unnest(coalesce(flags, '{}')))); $$;

-- Admin-editable lookups.
create table public.skills (
  slug     text primary key check (slug ~ '^[a-z0-9_]{2,40}$'),
  label    text not null check (char_length(btrim(label)) between 1 and 60),
  position int not null default 0
);
create table public.certification_types (
  slug     text primary key check (slug ~ '^[a-z0-9_]{2,40}$'),
  label    text not null check (char_length(btrim(label)) between 1 and 60),
  position int not null default 0
);
insert into public.skills (slug, label, position) values
  ('driver', 'Driver', 1), ('cdl', 'CDL', 2), ('art_handler', 'Art handler', 3), ('crater', 'Crater', 4),
  ('installer', 'Installer', 5), ('rigging', 'Rigging', 6), ('forklift', 'Forklift', 7),
  ('lift', 'Lift / scissor lift', 8), ('team_lead', 'Team lead', 9);
insert into public.certification_types (slug, label, position) values
  ('drivers_license', 'Driver’s license', 1), ('cdl', 'CDL', 2), ('forklift', 'Forklift', 3),
  ('aerial_lift', 'Aerial lift', 4), ('osha_10', 'OSHA 10', 5);

-- ── Crew ─────────────────────────────────────────────────────────────────────
create table public.crew_members (
  id                 uuid primary key default gen_random_uuid(),
  display_name       text not null check (char_length(btrim(display_name)) between 2 and 80),
  phone              text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  sms_opt_in         boolean not null default false,
  sms_opt_in_at      timestamptz,
  sms_opt_in_method  text check (sms_opt_in_method is null or char_length(sms_opt_in_method) <= 120),
  email              text unique check (email is null or (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  position           public.crew_position not null default 'art_handler',
  lift_capacity_lbs  int check (lift_capacity_lbs is null or lift_capacity_lbs between 0 and 500),
  active             boolean not null default true,
  office_notes       text check (office_notes is null or char_length(office_notes) <= 4000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint sms_consent_needs_phone check (not sms_opt_in or (phone is not null and sms_opt_in_at is not null))
);
comment on column public.crew_members.phone is 'E.164, e.g. +13235551234 (ready for the future SMS phase).';

create table public.crew_skills (
  crew_member_id uuid not null references public.crew_members (id) on delete cascade,
  skill          text not null references public.skills (slug) on update cascade,
  primary key (crew_member_id, skill)
);
create index crew_skills_skill_idx on public.crew_skills (skill);

create table public.crew_certifications (
  id             uuid primary key default gen_random_uuid(),
  crew_member_id uuid not null references public.crew_members (id) on delete cascade,
  type           text not null references public.certification_types (slug) on update cascade,
  expires_on     date,
  created_at     timestamptz not null default now()
);
create index crew_certs_member_idx on public.crew_certifications (crew_member_id);

-- "Unavailable": no reason is ever asked for. note is office-only, for logistics.
create table public.time_off (
  id             uuid primary key default gen_random_uuid(),
  crew_member_id uuid not null references public.crew_members (id) on delete cascade,
  start_date     date not null,
  end_date       date not null,
  start_time     time,
  end_time       time,
  note           text check (note is null or char_length(note) <= 500),
  created_at     timestamptz not null default now(),
  constraint time_off_order check (end_date >= start_date),
  constraint time_off_partial check ((start_time is null) = (end_time is null)),
  constraint time_off_partial_order check (start_time is null or start_date <> end_date or end_time > start_time)
);
create index time_off_member_idx on public.time_off (crew_member_id, start_date, end_date);

-- ── Assets ───────────────────────────────────────────────────────────────────
create table public.assets (
  id           uuid primary key default gen_random_uuid(),
  kind         public.asset_kind not null,
  name         text not null unique check (char_length(btrim(name)) between 1 and 60),
  capabilities text[] not null default '{}' check (private.valid_flags(capabilities, array[
                 'air_ride', 'climate_controlled', 'liftgate', 'gps_tracked', 'panel_cart', 'a_frame',
                 'gantry', 'lift', 'forklift', 'pallet_jack', 'requires_cdl'])),
  length_ft    numeric(5, 1) check (length_ft is null or length_ft between 1 and 80),
  status       public.asset_status not null default 'in_service',
  active       boolean not null default true,
  notes        text check (notes is null or char_length(notes) <= 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Jobs ─────────────────────────────────────────────────────────────────────
create sequence public.job_number_seq;

create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  job_number    text not null unique default (
                  'J-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.job_number_seq')::text, 4, '0')),
  title         text not null check (char_length(btrim(title)) between 2 and 140),
  client_name   text check (client_name is null or char_length(client_name) <= 140),
  job_type      public.job_type not null,
  status        public.job_status not null default 'draft',
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  call_time     timestamptz,
  call_location text check (call_location is null or char_length(call_location) <= 200),
  team_lead_id  uuid references public.crew_members (id) on delete set null,
  office_notes  text check (office_notes is null or char_length(office_notes) <= 4000),
  crew_notes    text check (crew_notes is null or char_length(crew_notes) <= 4000),
  version       int not null default 1,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint job_time_order check (end_at > start_at),
  constraint job_length check (end_at - start_at <= interval '31 days')
);
create index jobs_range_idx on public.jobs (start_at, end_at) where deleted_at is null;
create index jobs_status_idx on public.jobs (status);

create table public.job_stops (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete cascade,
  position      int not null default 0,
  kind          public.stop_kind not null default 'stop',
  site_name     text check (site_name is null or char_length(site_name) <= 140),
  address       text not null check (char_length(btrim(address)) between 3 and 300),
  contact_name  text check (contact_name is null or char_length(contact_name) <= 100),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  window_start  timestamptz,
  window_end    timestamptz,
  access_flags  text[] not null default '{}' check (private.valid_flags(access_flags, array[
                  'loading_dock', 'stairs', 'freight_elevator', 'elevator_reservation', 'coi_required',
                  'street_parking_only', 'security_checkin', 'timed_access'])),
  access_notes  text check (access_notes is null or char_length(access_notes) <= 2000),
  constraint stop_window_order check (window_start is null or window_end is null or window_end >= window_start)
);
create index job_stops_job_idx on public.job_stops (job_id, position);

create table public.job_items (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id) on delete cascade,
  position       int not null default 0,
  description    text not null check (char_length(btrim(description)) between 2 and 300),
  artist_title   text check (artist_title is null or char_length(artist_title) <= 200),
  medium         text check (medium is null or char_length(medium) <= 120),
  height_in      numeric(7, 2) check (height_in is null or (height_in > 0 and height_in <= 1200)),
  width_in       numeric(7, 2) check (width_in is null or (width_in > 0 and width_in <= 1200)),
  depth_in       numeric(7, 2) check (depth_in is null or (depth_in > 0 and depth_in <= 1200)),
  weight_lbs     numeric(8, 1) check (weight_lbs is null or (weight_lbs > 0 and weight_lbs <= 40000)),
  quantity       int not null default 1 check (quantity between 1 and 999),
  packing        public.packing_kind,
  handling_flags text[] not null default '{}' check (private.valid_flags(handling_flags, array[
                   'upright', 'top_heavy', 'fragile', 'glass', 'loose_parts', 'keep_flat', 'no_stack',
                   'climate_sensitive', 'two_person'])),
  created_at     timestamptz not null default now()
);
comment on table public.job_items is 'Inches and pounds. Phase 3 estimates reuse these dimensions and weights.';
create index job_items_job_idx on public.job_items (job_id, position);

create table public.job_assignments (
  job_id             uuid not null references public.jobs (id) on delete cascade,
  crew_member_id     uuid not null references public.crew_members (id) on delete restrict,
  role_on_job        text check (role_on_job is null or char_length(role_on_job) <= 60),
  call_time_override timestamptz,
  created_at         timestamptz not null default now(),
  primary key (job_id, crew_member_id)
);
create index job_assignments_crew_idx on public.job_assignments (crew_member_id);

create table public.job_assets (
  job_id     uuid not null references public.jobs (id) on delete cascade,
  asset_id   uuid not null references public.assets (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (job_id, asset_id)
);
create index job_assets_asset_idx on public.job_assets (asset_id);

-- Checklists: admin-editable templates per job type, copied onto each new job.
create table public.checklist_templates (
  id       uuid primary key default gen_random_uuid(),
  job_type public.job_type not null,
  label    text not null check (char_length(btrim(label)) between 2 and 120),
  position int not null default 0,
  unique (job_type, label)
);
insert into public.checklist_templates (job_type, label, position)
select t, l.label, l.position
from unnest(enum_range(null::public.job_type)) as t
cross join (values
  ('Origin ready', 1), ('Destination ready', 2), ('Path and route clear', 3), ('Equipment confirmed', 4),
  ('COI received', 5), ('Elevator / dock reserved', 6), ('Team lead briefed', 7),
  ('Handling flags reviewed with crew', 8)) as l(label, position);

create table public.job_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs (id) on delete cascade,
  label      text not null check (char_length(btrim(label)) between 2 and 120),
  position   int not null default 0,
  checked_at timestamptz,
  checked_by text
);
create index job_checklist_job_idx on public.job_checklist_items (job_id, position);

-- ── Incidents (NAMED, not anonymous) ─────────────────────────────────────────
create table public.incident_reports (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs (id) on delete restrict,
  job_item_id         uuid references public.job_items (id) on delete set null,
  reported_by         text not null default '',
  occurred_at         timestamptz not null,
  handlers_involved   text check (handlers_involved is null or char_length(handlers_involved) <= 500),
  description         text not null check (char_length(btrim(description)) between 10 and 4000),
  supervisor_notified boolean not null default false,
  supervisor_name     text check (supervisor_name is null or char_length(supervisor_name) <= 100),
  fragments_retained  boolean not null default false,
  packing_kept        boolean not null default false,
  status              public.incident_status not null default 'open',
  office_followup     text check (office_followup is null or char_length(office_followup) <= 4000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index incidents_job_idx on public.incident_reports (job_id);

create table public.incident_photos (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incident_reports (id) on delete cascade,
  path        text not null unique check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg)$'),
  created_at  timestamptz not null default now()
);

-- ── Privileges + RLS ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['app_settings', 'skills', 'certification_types', 'crew_members', 'crew_skills',
    'crew_certifications', 'time_off', 'assets', 'jobs', 'job_stops', 'job_items', 'job_assignments',
    'job_assets', 'checklist_templates', 'job_checklist_items', 'incident_reports', 'incident_photos']
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_office()))',
      t || '_office_read', t);
  end loop;

  -- Office-writable tables (admin + dispatcher).
  foreach t in array array['crew_members', 'crew_skills', 'crew_certifications', 'time_off', 'assets', 'jobs',
    'job_stops', 'job_items', 'job_assignments', 'job_assets', 'job_checklist_items', 'incident_reports']
  loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_dispatcher()))',
      t || '_office_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_dispatcher())) with check ((select private.is_dispatcher()))',
      t || '_office_update', t);
  end loop;

  -- Admin-editable lookups and settings.
  foreach t in array array['app_settings', 'skills', 'certification_types', 'checklist_templates'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_admin()))', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))', t || '_admin_delete', t);
  end loop;
end $$;

-- Deletes: children by dispatchers; jobs hard delete by admins only (dispatchers soft delete).
create policy crew_members_office_delete on public.crew_members for delete to authenticated using ((select private.is_dispatcher()));
create policy crew_skills_office_delete on public.crew_skills for delete to authenticated using ((select private.is_dispatcher()));
create policy crew_certifications_office_delete on public.crew_certifications for delete to authenticated using ((select private.is_dispatcher()));
create policy time_off_office_delete on public.time_off for delete to authenticated using ((select private.is_dispatcher()));
create policy assets_office_delete on public.assets for delete to authenticated using ((select private.is_dispatcher()));
create policy job_stops_office_delete on public.job_stops for delete to authenticated using ((select private.is_dispatcher()));
create policy job_items_office_delete on public.job_items for delete to authenticated using ((select private.is_dispatcher()));
create policy job_assignments_office_delete on public.job_assignments for delete to authenticated using ((select private.is_dispatcher()));
create policy job_assets_office_delete on public.job_assets for delete to authenticated using ((select private.is_dispatcher()));
create policy job_checklist_items_office_delete on public.job_checklist_items for delete to authenticated using ((select private.is_dispatcher()));
create policy jobs_admin_delete on public.jobs for delete to authenticated using ((select private.is_admin()));
create policy incident_reports_admin_delete on public.incident_reports for delete to authenticated using ((select private.is_admin()));
-- Photos are written only by the incident-photo function (service role).

-- ── Forced fields / housekeeping ─────────────────────────────────────────────
create or replace function private.tg_touch()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
create trigger crew_members_touch before update on public.crew_members for each row execute function private.tg_touch();
create trigger assets_touch before update on public.assets for each row execute function private.tg_touch();
create trigger incidents_touch before update on public.incident_reports for each row execute function private.tg_touch();

create or replace function private.tg_jobs_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.job_number := old.job_number;
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
create trigger jobs_before before insert or update on public.jobs for each row execute function private.tg_jobs_before();

create or replace function private.tg_jobs_copy_checklist()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.job_checklist_items (job_id, label, position)
  select new.id, t.label, t.position from public.checklist_templates t where t.job_type = new.job_type;
  return null;
end;
$$;
create trigger jobs_copy_checklist after insert on public.jobs for each row execute function private.tg_jobs_copy_checklist();

create or replace function private.tg_checklist_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.checked_at is not null and (tg_op = 'INSERT' or old.checked_at is null) then
    new.checked_at := now();
    -- Signed-in users can't spoof this; seed/service writes may supply a name.
    new.checked_by := case when private.current_email() = 'system' then coalesce(new.checked_by, 'system')
                           else private.current_email() end;
  elsif new.checked_at is null then
    new.checked_by := null;
  else
    new.checked_by := old.checked_by;
    new.checked_at := old.checked_at;
  end if;
  return new;
end;
$$;
create trigger checklist_before before insert or update on public.job_checklist_items
  for each row execute function private.tg_checklist_before();

create or replace function private.tg_incident_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.reported_by := case when private.current_email() = 'system' and new.reported_by <> '' then new.reported_by
                            else private.current_email() end;
    new.status := 'open';
    new.created_at := now();
  else
    new.reported_by := old.reported_by;
    new.job_id := old.job_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;
create trigger incident_before before insert or update on public.incident_reports
  for each row execute function private.tg_incident_before();

create or replace function private.tg_crew_sms_consent()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.sms_opt_in and (tg_op = 'INSERT' or not old.sms_opt_in) and new.sms_opt_in_at is null then
    new.sms_opt_in_at := now();
  end if;
  if not new.sms_opt_in then
    new.sms_opt_in_at := null;
  end if;
  return new;
end;
$$;
create trigger crew_sms_consent before insert or update on public.crew_members
  for each row execute function private.tg_crew_sms_consent();

-- ── Audit: every dispatch change goes through private.audit() ────────────────
-- Action names are dispatch_<table>_<op>; suggestion_id carries the job id where there is one.
create or replace function private.tg_dispatch_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_row jsonb := coalesce(v_new, v_old);
  v_job uuid;
  v_action text;
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at' - 'version') = (v_new - 'updated_at' - 'version') then
    return null;
  end if;
  v_job := case
    when tg_table_name = 'jobs' then (v_row ->> 'id')::uuid
    when v_row ? 'job_id' then (v_row ->> 'job_id')::uuid
    else null end;
  v_action := 'dispatch_' || tg_table_name || '_' || lower(tg_op);
  if tg_table_name = 'jobs' and tg_op = 'UPDATE' then
    if v_old ->> 'status' is distinct from v_new ->> 'status' then v_action := 'dispatch_jobs_status';
    elsif v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then v_action := 'dispatch_jobs_soft_delete';
    end if;
  end if;
  perform private.audit(v_action, v_job, v_old, v_new);
  return null;
end;
$$;
revoke all on function private.tg_dispatch_audit() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['crew_members', 'crew_skills', 'crew_certifications', 'time_off', 'assets', 'jobs',
    'job_stops', 'job_items', 'job_assignments', 'job_assets', 'job_checklist_items', 'incident_reports',
    'incident_photos', 'checklist_templates', 'skills', 'certification_types', 'app_settings']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.tg_dispatch_audit()',
      t || '_audit', t);
  end loop;
end $$;

-- ── Crew self-service (no direct table access) ───────────────────────────────
create or replace function private.my_crew_id()
returns uuid language sql stable security definer set search_path = ''
as $$
  select c.id from public.crew_members c
  where private.has_role('crew') and c.active
    and c.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;
revoke all on function private.my_crew_id() from public, anon;
grant execute on function private.my_crew_id() to authenticated;

-- My jobs: today .. +14 days by default. Explicit column list; no office notes,
-- client name, other jobs or roster. Teammates' phones are visible (product decision).
create or replace function private.my_jobs(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := private.my_crew_id();
  v_tz text := private.app_tz();
begin
  if v_me is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(j order by (j ->> 'start_at'))
    from (
      select jsonb_build_object(
        'id', jb.id, 'job_number', jb.job_number, 'title', jb.title, 'job_type', jb.job_type, 'status', jb.status,
        'start_at', jb.start_at, 'end_at', jb.end_at,
        'call_time', coalesce(a.call_time_override, jb.call_time), 'call_location', jb.call_location,
        'crew_notes', jb.crew_notes, 'is_lead', jb.team_lead_id = v_me,
        'team_lead', (select jsonb_build_object('name', c.display_name, 'phone', c.phone)
                      from public.crew_members c where c.id = jb.team_lead_id),
        'teammates', coalesce((select jsonb_agg(jsonb_build_object(
                         'name', c.display_name, 'phone', c.phone, 'role_on_job', ja.role_on_job,
                         'is_lead', c.id = jb.team_lead_id, 'is_me', c.id = v_me) order by c.display_name)
                       from public.job_assignments ja join public.crew_members c on c.id = ja.crew_member_id
                       where ja.job_id = jb.id), '[]'::jsonb),
        'assets', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'name', s.name) order by s.name)
                    from public.job_assets x join public.assets s on s.id = x.asset_id where x.job_id = jb.id), '[]'::jsonb),
        'stops', coalesce((select jsonb_agg(jsonb_build_object(
                    'kind', st.kind, 'site_name', st.site_name, 'address', st.address, 'contact_name', st.contact_name,
                    'contact_phone', st.contact_phone, 'window_start', st.window_start, 'window_end', st.window_end,
                    'access_flags', st.access_flags, 'access_notes', st.access_notes) order by st.position)
                   from public.job_stops st where st.job_id = jb.id), '[]'::jsonb),
        'items', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', it.id, 'description', it.description, 'artist_title', it.artist_title, 'medium', it.medium,
                    'height_in', it.height_in, 'width_in', it.width_in, 'depth_in', it.depth_in,
                    'weight_lbs', it.weight_lbs, 'quantity', it.quantity, 'packing', it.packing,
                    'handling_flags', it.handling_flags) order by it.position)
                   from public.job_items it where it.job_id = jb.id), '[]'::jsonb),
        'checklist', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', ci.id, 'label', ci.label, 'checked_at', ci.checked_at) order by ci.position)
                       from public.job_checklist_items ci where ci.job_id = jb.id), '[]'::jsonb)
      ) as j
      from public.jobs jb
      join public.job_assignments a on a.job_id = jb.id and a.crew_member_id = v_me
      where jb.deleted_at is null
        and jb.status in ('scheduled', 'in_progress', 'completed')
        and (jb.end_at at time zone v_tz)::date >= p_from
        and (jb.start_at at time zone v_tz)::date <= p_to
    ) s
  ), '[]'::jsonb);
end;
$$;
revoke all on function private.my_jobs(date, date) from public, anon;
grant execute on function private.my_jobs(date, date) to authenticated;
create or replace function public.my_jobs(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_jobs(p_from, p_to); $$;
revoke all on function public.my_jobs(date, date) from public, anon;
grant execute on function public.my_jobs(date, date) to authenticated;

-- Team lead ticks checklist items on their own job.
create or replace function private.crew_set_checklist(p_item uuid, p_checked boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := private.my_crew_id();
begin
  if v_me is null or not exists (
    select 1 from public.job_checklist_items ci
    join public.jobs j on j.id = ci.job_id
    where ci.id = p_item and j.team_lead_id = v_me and j.deleted_at is null
      and exists (select 1 from public.job_assignments a where a.job_id = j.id and a.crew_member_id = v_me)
  ) then
    raise exception 'Only the team lead on this job can tick its checklist.' using errcode = '42501';
  end if;
  update public.job_checklist_items set checked_at = case when p_checked then now() else null end where id = p_item;
end;
$$;
revoke all on function private.crew_set_checklist(uuid, boolean) from public, anon;
grant execute on function private.crew_set_checklist(uuid, boolean) to authenticated;
create or replace function public.crew_set_checklist(p_item uuid, p_checked boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.crew_set_checklist(p_item, p_checked); $$;
revoke all on function public.crew_set_checklist(uuid, boolean) from public, anon;
grant execute on function public.crew_set_checklist(uuid, boolean) to authenticated;

-- Crew files a NAMED incident on a job they are assigned to.
create or replace function private.crew_report_incident(
  p_job uuid, p_item uuid, p_occurred_at timestamptz, p_handlers text, p_description text,
  p_supervisor_notified boolean, p_supervisor_name text, p_fragments boolean, p_packing boolean)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := private.my_crew_id(); v_id uuid;
begin
  if v_me is null or not exists (select 1 from public.job_assignments where job_id = p_job and crew_member_id = v_me) then
    raise exception 'You can only report incidents on your own jobs.' using errcode = '42501';
  end if;
  if p_item is not null and not exists (select 1 from public.job_items where id = p_item and job_id = p_job) then
    raise exception 'That item is not on this job.' using errcode = '22023';
  end if;
  insert into public.incident_reports (job_id, job_item_id, occurred_at, handlers_involved, description,
    supervisor_notified, supervisor_name, fragments_retained, packing_kept)
  values (p_job, p_item, p_occurred_at, nullif(btrim(p_handlers), ''), p_description,
    coalesce(p_supervisor_notified, false), nullif(btrim(p_supervisor_name), ''), coalesce(p_fragments, false), coalesce(p_packing, false))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.crew_report_incident(uuid, uuid, timestamptz, text, text, boolean, text, boolean, boolean) from public, anon;
grant execute on function private.crew_report_incident(uuid, uuid, timestamptz, text, text, boolean, text, boolean, boolean) to authenticated;
create or replace function public.crew_report_incident(
  p_job uuid, p_item uuid, p_occurred_at timestamptz, p_handlers text, p_description text,
  p_supervisor_notified boolean, p_supervisor_name text, p_fragments boolean, p_packing boolean)
returns uuid language sql security invoker set search_path = ''
as $$ select private.crew_report_incident(p_job, p_item, p_occurred_at, p_handlers, p_description,
  p_supervisor_notified, p_supervisor_name, p_fragments, p_packing); $$;
revoke all on function public.crew_report_incident(uuid, uuid, timestamptz, text, text, boolean, text, boolean, boolean) from public, anon;
grant execute on function public.crew_report_incident(uuid, uuid, timestamptz, text, text, boolean, text, boolean, boolean) to authenticated;

create or replace function private.my_incidents()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'job_number', j.job_number, 'occurred_at', r.occurred_at, 'description', r.description,
    'status', r.status, 'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
  from public.incident_reports r join public.jobs j on j.id = r.job_id
  where private.has_role('crew') and r.reported_by = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
revoke all on function private.my_incidents() from public, anon;
grant execute on function private.my_incidents() to authenticated;
create or replace function public.my_incidents()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_incidents(); $$;
revoke all on function public.my_incidents() from public, anon;
grant execute on function public.my_incidents() to authenticated;

-- Used by the incident-photo function (called with the user's own token).
create or replace function private.can_attach_incident_photo(p_incident uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.incident_reports r
    where r.id = p_incident
      and (private.is_dispatcher()
           or (private.has_role('crew') and r.reported_by = lower(coalesce(auth.jwt() ->> 'email', ''))))
  );
$$;
revoke all on function private.can_attach_incident_photo(uuid) from public, anon;
grant execute on function private.can_attach_incident_photo(uuid) to authenticated;
create or replace function public.can_attach_incident_photo(p_incident uuid)
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.can_attach_incident_photo(p_incident); $$;
revoke all on function public.can_attach_incident_photo(uuid) from public, anon;
grant execute on function public.can_attach_incident_photo(uuid) to authenticated;

-- ── Incident photo bucket (private; office reads via signed URLs) ────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('incident-photos', 'incident-photos', false, 1500000, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy incident_photos_office_read on storage.objects
  for select to authenticated using (bucket_id = 'incident-photos' and (select private.is_office()));
create policy incident_photos_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'incident-photos' and (select private.is_admin()));

-- ── Realtime (RLS applies to subscribers) ────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.jobs, public.job_assignments, public.job_assets, public.time_off;
  end if;
end $$;

-- Covering indexes for foreign keys (advisor).
create index crew_certs_type_idx on public.crew_certifications (type);
create index incident_photos_incident_idx on public.incident_photos (incident_id);
create index incidents_item_idx on public.incident_reports (job_item_id);
create index jobs_team_lead_idx on public.jobs (team_lead_id);

-- Office time zone for any signed-in staff/crew UI (not secret; crew can't read app_settings).
create or replace function public.app_timezone()
returns text language sql stable security invoker set search_path = ''
as $$ select private.app_tz(); $$;
revoke all on function public.app_timezone() from public, anon;
grant execute on function public.app_timezone() to authenticated;
