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
