-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2 · Conflict detection (warn, don't block). One source of truth for the
-- UI and the tests. Office roles only.
--
-- Codes:
--   crew_overlap         crew member on another overlapping job
--   crew_time_off        crew member assigned during time off
--   asset_double_booked  asset on another overlapping job
--   asset_unavailable    asset out of service / in maintenance / inactive
--   two_person_short     item needs two people, fewer than 2 crew assigned
--   skill_missing        handling needs a skill nobody assigned has
--   cert_expired         assigned crew has an expired cert the job relies on
--   checklist_incomplete scheduled job starts within 24h with unchecked items
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.job_conflicts_raw(p_job uuid)
returns table (code text, message text, crew_member_id uuid, asset_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with j as (
    select * from public.jobs where id = p_job and deleted_at is null and status <> 'cancelled'
  ),
  tz as (select private.app_tz() as z),
  crew as (
    select a.crew_member_id, c.display_name from public.job_assignments a
    join public.crew_members c on c.id = a.crew_member_id
    where a.job_id = p_job
  ),
  others as (
    select o.* from public.jobs o, j
    where o.id <> j.id and o.deleted_at is null and o.status <> 'cancelled'
      and o.start_at < j.end_at and o.end_at > j.start_at
  ),
  flags as (
    select coalesce(array_agg(distinct f), '{}') as all_flags,
           bool_or('two_person' = any (i.handling_flags)) as two_person
    from public.job_items i left join lateral unnest(i.handling_flags) f on true
    where i.job_id = p_job
  ),
  crew_skills as (
    select distinct s.skill from public.crew_skills s join crew on crew.crew_member_id = s.crew_member_id
  ),
  vehicles as (
    select s.* from public.job_assets x join public.assets s on s.id = x.asset_id where x.job_id = p_job
  ),
  needed as (
    select 'art_handler'::text as skill, 'Handling flags need an art handler' as why
      from flags where cardinality(all_flags) > 0
    union all
    select 'installer', 'Install work needs an installer' from j where j.job_type in ('install', 'deinstall')
    union all
    select 'crater', 'Crating work needs a crater' from j where j.job_type = 'crating'
    union all
    select 'driver', 'A vehicle is assigned but no driver'
      where exists (select 1 from vehicles where kind in ('truck', 'van', 'trailer'))
  )
  -- crew on overlapping jobs
  select 'crew_overlap', format('%s is also on %s (%s)', crew.display_name, o.job_number, o.title),
         crew.crew_member_id, null::uuid
  from crew join public.job_assignments oa on oa.crew_member_id = crew.crew_member_id
  join others o on o.id = oa.job_id
  union all
  -- crew during time off
  select 'crew_time_off', format('%s is unavailable %s', crew.display_name,
           case when t.start_date = t.end_date then to_char(t.start_date, 'Mon DD')
                else to_char(t.start_date, 'Mon DD') || '–' || to_char(t.end_date, 'Mon DD') end),
         crew.crew_member_id, null
  from crew join public.time_off t on t.crew_member_id = crew.crew_member_id, j, tz
  where (
    t.start_time is null
    and t.start_date <= (j.end_at at time zone tz.z)::date and t.end_date >= (j.start_at at time zone tz.z)::date
  ) or (
    t.start_time is not null
    and ((t.start_date + t.start_time) at time zone tz.z) < j.end_at
    and ((t.end_date + t.end_time) at time zone tz.z) > j.start_at
  )
  union all
  -- asset double-booked
  select 'asset_double_booked', format('%s is also on %s', v.name, o.job_number), null, v.id
  from vehicles v join public.job_assets ox on ox.asset_id = v.id join others o on o.id = ox.job_id
  union all
  -- asset unavailable
  select 'asset_unavailable', format('%s is %s', v.name, case when not v.active then 'inactive' when v.status = 'maintenance' then 'in maintenance' else 'out of service' end), null, v.id
  from vehicles v where v.status <> 'in_service' or not v.active
  union all
  -- two-person minimum
  select 'two_person_short', 'An item needs two people; fewer than 2 crew assigned', null, null
  from flags where two_person and (select count(*) from crew) < 2
  union all
  -- missing skills
  select 'skill_missing', n.why, null, null
  from needed n where not exists (select 1 from crew_skills s where s.skill = n.skill)
    and exists (select 1 from j)
  union all
  -- expired certifications the job relies on
  select 'cert_expired', format('%s: %s expired %s', crew.display_name, ct.label, to_char(cc.expires_on, 'Mon DD, YYYY')),
         crew.crew_member_id, null
  from crew
  join public.crew_certifications cc on cc.crew_member_id = crew.crew_member_id
  join public.certification_types ct on ct.slug = cc.type, j, tz
  where cc.expires_on is not null and cc.expires_on < (j.end_at at time zone tz.z)::date
    and (
      (cc.type = 'drivers_license' and exists (select 1 from vehicles where kind in ('truck', 'van', 'trailer'))
         and exists (select 1 from public.crew_skills s where s.crew_member_id = crew.crew_member_id and s.skill in ('driver', 'cdl')))
      or (cc.type = 'cdl' and exists (select 1 from vehicles where 'requires_cdl' = any (capabilities))
         and exists (select 1 from public.crew_skills s where s.crew_member_id = crew.crew_member_id and s.skill = 'cdl'))
      or (cc.type = 'forklift' and exists (select 1 from vehicles where 'forklift' = any (capabilities)))
      or (cc.type = 'aerial_lift' and exists (select 1 from vehicles where 'lift' = any (capabilities)))
    )
  union all
  -- checklist incomplete close to start
  select 'checklist_incomplete', format('%s checklist item(s) open; starts within 24 hours', count(*)), null, null
  from j join public.job_checklist_items ci on ci.job_id = j.id
  where j.status = 'scheduled' and ci.checked_at is null and j.start_at <= now() + interval '24 hours'
  group by j.id
  having count(*) > 0;
$$;
revoke all on function private.job_conflicts_raw(uuid) from public, anon, authenticated;

create or replace function private.job_conflicts(p_job uuid)
returns table (code text, message text, crew_member_id uuid, asset_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_office() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select distinct * from private.job_conflicts_raw(p_job);
end;
$$;
revoke all on function private.job_conflicts(uuid) from public, anon;
grant execute on function private.job_conflicts(uuid) to authenticated;
create or replace function public.job_conflicts(p_job uuid)
returns table (code text, message text, crew_member_id uuid, asset_id uuid)
language sql stable security invoker set search_path = ''
as $$ select * from private.job_conflicts(p_job); $$;
revoke all on function public.job_conflicts(uuid) from public, anon;
grant execute on function public.job_conflicts(uuid) to authenticated;

-- Board-level: conflicts for every job overlapping a time range.
create or replace function private.board_conflicts(p_from timestamptz, p_to timestamptz)
returns table (job_id uuid, code text, message text, crew_member_id uuid, asset_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_office() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select distinct j.id, c.code, c.message, c.crew_member_id, c.asset_id
    from public.jobs j, lateral private.job_conflicts_raw(j.id) c
    where j.deleted_at is null and j.start_at < p_to and j.end_at > p_from;
end;
$$;
revoke all on function private.board_conflicts(timestamptz, timestamptz) from public, anon;
grant execute on function private.board_conflicts(timestamptz, timestamptz) to authenticated;
create or replace function public.board_conflicts(p_from timestamptz, p_to timestamptz)
returns table (job_id uuid, code text, message text, crew_member_id uuid, asset_id uuid)
language sql stable security invoker set search_path = ''
as $$ select * from private.board_conflicts(p_from, p_to); $$;
revoke all on function public.board_conflicts(timestamptz, timestamptz) from public, anon;
grant execute on function public.board_conflicts(timestamptz, timestamptz) to authenticated;

-- Saving over a warning requires a short reason; recorded in the audit log with the conflicts.
create or replace function private.record_conflict_override(p_job uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_conflicts jsonb;
begin
  if not private.is_dispatcher() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'Please give a short reason (3–500 characters).' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'message', message)), '[]'::jsonb)
    into v_conflicts from (select distinct * from private.job_conflicts_raw(p_job)) c;
  perform private.audit('dispatch_conflict_override', p_job, jsonb_build_object('conflicts', v_conflicts),
    jsonb_build_object('reason', btrim(p_reason)));
end;
$$;
revoke all on function private.record_conflict_override(uuid, text) from public, anon;
grant execute on function private.record_conflict_override(uuid, text) to authenticated;
create or replace function public.record_conflict_override(p_job uuid, p_reason text)
returns void language sql security invoker set search_path = ''
as $$ select private.record_conflict_override(p_job, p_reason); $$;
revoke all on function public.record_conflict_override(uuid, text) from public, anon;
grant execute on function public.record_conflict_override(uuid, text) to authenticated;

-- Exports of dispatch sheets are generated in the browser and logged here.
create or replace function private.log_dispatch_export(p_format text, p_scope jsonb, p_include_office_notes boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_office() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_format not in ('xlsx', 'docx', 'print') then raise exception 'unknown export format'; end if;
  perform private.audit('dispatch_export', null, null,
    jsonb_build_object('format', p_format, 'scope', coalesce(p_scope, '{}'::jsonb), 'office_notes', coalesce(p_include_office_notes, false)));
end;
$$;
revoke all on function private.log_dispatch_export(text, jsonb, boolean) from public, anon;
grant execute on function private.log_dispatch_export(text, jsonb, boolean) to authenticated;
create or replace function public.log_dispatch_export(p_format text, p_scope jsonb, p_include_office_notes boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.log_dispatch_export(p_format, p_scope, p_include_office_notes); $$;
revoke all on function public.log_dispatch_export(text, jsonb, boolean) from public, anon;
grant execute on function public.log_dispatch_export(text, jsonb, boolean) to authenticated;
