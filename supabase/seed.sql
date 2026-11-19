-- Local development seed data. Never runs against production (`supabase db push` doesn't apply seeds).
-- Seeded tracking codes (for trying the status screen locally):
--   BRAVE-CANYON-ORBIT-MAPLE-1001   (planned, with reply, on the board)
--   CLEVER-HARBOR-PILOT-STONE-2002  (new)
--   DAWN-FOREST-LUMBER-OCEAN-3003   (done, on the board)

insert into public.admins (email) values ('admin@example.com'), ('second-admin@example.com');

with rows (body, category, tag, code, created) as (
  values
  ('The lift gate on the 26-foot box truck sticks when it is cold. Twice this week we had to hand-carry a crated canvas down the ramp.',
   'trucks_equipment'::public.suggestion_category, 'urgent'::public.priority_tag, 'BRAVE-CANYON-ORBIT-MAPLE-1001', now() - interval '9 days'),
  ('Could the weekly schedule go out earlier? Finding out Friday night about a Saturday install makes childcare really hard.',
   'scheduling_dispatch', 'important', 'CLEVER-HARBOR-PILOT-STONE-2002', now() - interval '2 days'),
  ('We keep running out of 2-inch foam for soft-wrapping framed works. The shop should have a minimum stock level.',
   'crating_shop', 'important', 'DAWN-FOREST-LUMBER-OCEAN-3003', now() - interval '20 days'),
  ('The A-frame cart strap is frayed. Someone could get hurt or a large panel could tip during a load-in.',
   'safety', 'crucial', 'EAGLE-GARDEN-MIRROR-NOBLE-4004', now() - interval '1 day'),
  ('Overtime on long-haul museum courier trips is calculated differently from local jobs and nobody can explain why.',
   'pay_policy', 'urgent', 'FABRIC-GLOVE-HUNTER-ISLAND-5005', now() - interval '5 days'),
  ('Break room fridge has been broken for two weeks.',
   'other', 'important', 'JACKET-KITTEN-LEMON-MOTOR-6006', now() - interval '12 days')
)
insert into public.suggestions (body, category, submitter_tag, tracking_hash, created_at)
select body, category, tag, encode(sha256(convert_to(code, 'UTF8')), 'hex'), created from rows;

update public.suggestions
   set status = 'planned', admin_tag = 'crucial',
       public_reply = 'Thanks for flagging this. The lift gate is booked for service on Monday.',
       published_to_board = true,
       board_summary = 'Lift gate on the large box truck is being serviced, and a second pallet jack is on order.'
 where tracking_hash = encode(sha256(convert_to('BRAVE-CANYON-ORBIT-MAPLE-1001', 'UTF8')), 'hex');

update public.suggestions
   set status = 'done',
       public_reply = 'Done: there is now a minimum stock level and the shop lead owns reordering.',
       published_to_board = true,
       board_summary = 'Foam stock for soft-wrapping now has a minimum reorder level, owned by the shop lead.'
 where tracking_hash = encode(sha256(convert_to('DAWN-FOREST-LUMBER-OCEAN-3003', 'UTF8')), 'hex');

update public.suggestions set status = 'reviewing'
 where tracking_hash = encode(sha256(convert_to('EAGLE-GARDEN-MIRROR-NOBLE-4004', 'UTF8')), 'hex');

insert into public.admin_notes (suggestion_id, body)
select id, 'Called the truck vendor. Earliest slot is Monday.'
from public.suggestions
where tracking_hash = encode(sha256(convert_to('BRAVE-CANYON-ORBIT-MAPLE-1001', 'UTF8')), 'hex');

-- HR eyes only (named reports; readable only by hr_staff). Seeded code: KNIGHT-LADDER-MEADOW-NOVEL-7007
insert into public.hr_staff (email) values ('hr@example.com'), ('second-hr@example.com');
insert into public.hr_reports (full_name, contact, body, tracking_hash)
values ('Sample Person', 'call after 5pm', 'I need to talk to someone about a scheduling conflict with a family medical appointment.',
        encode(sha256(convert_to('KNIGHT-LADDER-MEADOW-NOVEL-7007', 'UTF8')), 'hex'));

-- ═════════════════════════════════════════════════════════════════════════════
-- Phase 2 · Dispatch demo data (fictional; no real companies, venues or artists).
-- Dates are relative to "today" so every conflict rule is visible whenever you reset.
-- Staff logins (create a password with "First time?" locally; emails land in Mailpit):
--   dispatcher@example.com (dispatcher) · viewer@example.com (viewer)
--   crew@example.com (crew, Avery Lane) · crew2@example.com (crew, Gray Patel)
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.staff_roles (email, role) values
  ('dispatcher@example.com', 'dispatcher'), ('viewer@example.com', 'viewer'),
  ('crew@example.com', 'crew'), ('crew2@example.com', 'crew');

create temporary table seed_ids (k text primary key, id uuid) on commit drop;
create or replace function pg_temp.d(day_offset int, hhmm text) returns timestamptz language sql as
  $$ select ((current_date + day_offset) + hhmm::time) at time zone 'America/Los_Angeles' $$;

with c(k, name, phone, email, pos, lift) as (values
  ('avery', 'Avery Lane',   '+13235550101', 'crew@example.com',  'lead',        75),
  ('bo',    'Bo Kimura',    '+13235550102', null,                'driver',      60),
  ('casey', 'Casey Ortiz',  '+13235550103', null,                'art_handler', 60),
  ('dana',  'Dana Reyes',   '+13235550104', null,                'installer',   50),
  ('eli',   'Eli Brooks',   '+13235550105', null,                'art_handler', 70),
  ('frank', 'Frankie Moss', '+13235550106', null,                'crater',      55),
  ('gray',  'Gray Patel',   '+13235550107', 'crew2@example.com', 'driver',      65),
  ('harp',  'Harper Quinn', '+13235550108', null,                'art_handler', 50)
), ins as (
  insert into public.crew_members (display_name, phone, email, position, lift_capacity_lbs)
  select name, phone, email, pos::public.crew_position, lift from c returning id, display_name
)
insert into seed_ids select c.k, ins.id from c join ins on ins.display_name = c.name;

insert into public.crew_skills (crew_member_id, skill)
select s.id, sk from seed_ids s, lateral unnest(case s.k
  when 'avery' then array['team_lead','art_handler','installer','driver']
  when 'bo'    then array['driver','cdl']
  when 'casey' then array['art_handler','crater']
  when 'dana'  then array['installer','rigging','lift']
  when 'eli'   then array['art_handler','forklift']
  when 'frank' then array['crater']
  when 'gray'  then array['driver','art_handler']
  when 'harp'  then array['art_handler','installer'] end) sk;

insert into public.crew_certifications (crew_member_id, type, expires_on)
select s.id, x.type, x.exp from seed_ids s join (values
  ('avery', 'drivers_license', current_date + 700), ('bo', 'drivers_license', current_date - 20),
  ('bo', 'cdl', current_date + 300), ('dana', 'aerial_lift', current_date + 10),
  ('eli', 'forklift', current_date + 200), ('gray', 'drivers_license', current_date + 400)
) as x(k, type, exp) on x.k = s.k;

insert into public.time_off (crew_member_id, start_date, end_date)
select id, current_date + 1, current_date + 2 from seed_ids where k = 'frank';
insert into public.time_off (crew_member_id, start_date, end_date, start_time, end_time)
select id, current_date + 4, current_date + 4, '12:00', '17:00' from seed_ids where k = 'harp';

with a(k, kind, name, caps, len, status) as (values
  ('t26', 'truck', 'Truck 26', array['air_ride','climate_controlled','liftgate','gps_tracked'], 26, 'in_service'),
  ('t20', 'truck', 'Truck 20', array['air_ride','liftgate'], 20, 'in_service'),
  ('van', 'van', 'Sprinter 1', array['gps_tracked'], 14, 'in_service'),
  ('trl', 'trailer', 'Trailer 1', array['requires_cdl','air_ride'], 28, 'in_service'),
  ('lift', 'equipment', 'Scissor Lift', array['lift'], null, 'maintenance')
), ins as (
  insert into public.assets (kind, name, capabilities, length_ft, status)
  select kind::public.asset_kind, name, caps, len, status::public.asset_status from a returning id, name
)
insert into seed_ids select a.k, ins.id from a join ins on ins.name = a.name;

with j(k, title, type, status, s, e, call_off, call_loc, lead, crew_notes, office) as (values
  ('A', 'Deliver framed works to a private residence', 'delivery', 'scheduled', pg_temp.d(0,'08:00'), pg_temp.d(0,'14:00'), pg_temp.d(0,'07:00'), 'Shop, bay 2', 'avery',
   'Client asks for shoe covers inside. Park on the street side.', 'Invoice after placement.'),
  ('B', 'Hang a three-panel work in a lobby', 'install', 'scheduled', pg_temp.d(0,'09:00'), pg_temp.d(0,'12:00'), pg_temp.d(0,'08:15'), 'Shop, bay 1', null,
   'Bring the panel cart and laser level.', null),
  ('C', 'Crate two sculptures for storage', 'crating', 'scheduled', pg_temp.d(1,'08:00'), pg_temp.d(1,'16:00'), pg_temp.d(1,'07:30'), 'Crate shop', null,
   null, 'Lumber delivery expected at 9.'),
  ('D', 'Shuttle works between two galleries', 'shuttle', 'scheduled', pg_temp.d(2,'10:00'), pg_temp.d(2,'15:00'), null, null, null,
   null, null),
  ('E', 'Pick up a framed print from a design studio', 'pickup', 'scheduled', pg_temp.d(3,'09:00'), pg_temp.d(3,'11:00'), pg_temp.d(3,'08:30'), 'Shop, bay 2', 'avery',
   null, null),
  ('F', 'Site survey for a rooftop install', 'site_survey', 'draft', pg_temp.d(4,'13:00'), pg_temp.d(4,'14:30'), null, null, null,
   null, 'Measure the freight elevator.'),
  ('G', 'De-install a hanging mobile', 'deinstall', 'scheduled', pg_temp.d(5,'08:00'), pg_temp.d(5,'13:00'), pg_temp.d(5,'07:30'), 'Shop, bay 1', null,
   null, null)
), ins as (
  insert into public.jobs (title, job_type, status, start_at, end_at, call_time, call_location, team_lead_id, crew_notes, office_notes, client_name)
  select j.title, j.type::public.job_type, j.status::public.job_status, j.s, j.e, j.call_off, j.call_loc,
         (select id from seed_ids where k = j.lead), j.crew_notes, j.office, 'Sample client'
  from j returning id, title
)
insert into seed_ids select 'job_' || j.k, ins.id from j join ins on ins.title = j.title;

insert into public.job_stops (job_id, position, kind, site_name, address, contact_name, contact_phone, access_flags, access_notes)
select (select id from seed_ids where k = x.job), x.pos, x.kind::public.stop_kind, x.site, x.addr, x.cname, x.cphone, x.flags, x.notes
from (values
  ('job_A', 0, 'origin', 'Warehouse', '1200 Example Ave, Los Angeles, CA', 'Warehouse desk', '+13235550190', array['loading_dock'], 'Dock 3.'),
  ('job_A', 1, 'destination', 'Private residence', '45 Sample Canyon Rd, Los Angeles, CA', 'House manager', '+13235550191', array['stairs','street_parking_only'], '12 steps to the front door.'),
  ('job_B', 0, 'origin', 'Warehouse', '1200 Example Ave, Los Angeles, CA', null, null, array['loading_dock'], null),
  ('job_B', 1, 'destination', 'Office lobby', '800 Placeholder Blvd, Los Angeles, CA', 'Building manager', '+13235550192', array['freight_elevator','coi_required','security_checkin'], 'Check in at the front desk; freight elevator booked 9–10.'),
  ('job_C', 0, 'origin', 'Crate shop', '1200 Example Ave, Los Angeles, CA', null, null, array['loading_dock'], null),
  ('job_D', 0, 'origin', 'Gallery one', '10 Demo St, Los Angeles, CA', 'Registrar', '+13235550193', array['timed_access'], 'Load-out 10–11 only.'),
  ('job_D', 1, 'destination', 'Gallery two', '20 Demo St, Los Angeles, CA', 'Registrar', '+13235550194', array['elevator_reservation'], null),
  ('job_E', 0, 'origin', 'Design studio', '5 Mock Ln, Los Angeles, CA', 'Studio manager', '+13235550195', array['street_parking_only'], null),
  ('job_E', 1, 'destination', 'Warehouse', '1200 Example Ave, Los Angeles, CA', null, null, array['loading_dock'], null),
  ('job_G', 0, 'origin', 'Atrium', '300 Example Plaza, Los Angeles, CA', 'Facilities', '+13235550196', array['timed_access','security_checkin'], 'Before opening hours.')
) as x(job, pos, kind, site, addr, cname, cphone, flags, notes);

insert into public.job_items (job_id, position, description, artist_title, medium, height_in, width_in, depth_in, weight_lbs, quantity, packing, handling_flags)
select (select id from seed_ids where k = x.job), x.pos, x.descr, x.at, x.medium, x.h, x.w, x.d, x.wt, x.q, x.pack::public.packing_kind, x.flags
from (values
  ('job_A', 0, 'Large framed painting', 'Untitled (Blue), 2019', 'Oil on canvas, glazed', 72, 96, 4, 140, 1, 'soft_pack', array['glass','fragile','two_person','upright']),
  ('job_A', 1, 'Small framed drawings', null, 'Graphite on paper', 18, 24, 2, 8, 4, 'soft_pack', array['glass','no_stack']),
  ('job_B', 0, 'Three-panel work', 'Triptych, 2021', 'Acrylic on panel', 60, 40, 2, 45, 3, 'soft_pack', array['two_person','keep_flat']),
  ('job_C', 0, 'Bronze sculpture', null, 'Bronze', 48, 20, 20, 380, 1, 'crated', array['top_heavy','two_person','upright']),
  ('job_C', 1, 'Ceramic vessel', null, 'Glazed stoneware', 22, 14, 14, 30, 1, 'crated', array['fragile']),
  ('job_E', 0, 'Framed print', null, 'Screenprint', 30, 40, 2, 15, 1, 'soft_pack', array['glass']),
  ('job_G', 0, 'Hanging mobile', null, 'Steel and aluminum', 96, 120, 120, 60, 1, null, array['loose_parts','fragile','two_person'])
) as x(job, pos, descr, at, medium, h, w, d, wt, q, pack, flags);

insert into public.job_assignments (job_id, crew_member_id)
select (select id from seed_ids where k = x.job), (select id from seed_ids where k = x.crew)
from (values ('job_A','avery'), ('job_A','bo'), ('job_A','casey'),     -- Bo: expired license + truck
             ('job_B','casey'), ('job_B','dana'),                      -- Casey double-booked
             ('job_C','frank'),                                        -- time off; two-person short
             ('job_D','gray'), ('job_D','harp'),
             ('job_E','avery'), ('job_E','gray'),
             ('job_G','eli'), ('job_G','gray')                         -- no installer on a de-install
) as x(job, crew);

insert into public.job_assets (job_id, asset_id)
select (select id from seed_ids where k = x.job), (select id from seed_ids where k = x.asset)
from (values ('job_A','t26'), ('job_B','t26'),                         -- Truck 26 double-booked
             ('job_C','t20'), ('job_D','van'), ('job_D','lift'),       -- lift in maintenance
             ('job_E','van'), ('job_G','t20')) as x(job, asset);

-- Tick a few checklist items so progress bars aren't all empty.
update public.job_checklist_items set checked_at = now(), checked_by = 'dispatcher@example.com'
where job_id in (select id from seed_ids where k in ('job_A', 'job_E')) and position <= 3;
