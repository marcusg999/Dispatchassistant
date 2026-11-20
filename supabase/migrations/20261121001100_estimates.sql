-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 · Estimates and quotes.
--
-- Who sees money: ONLY admin and estimator (private.is_estimating()).
--   • rate cards: estimators read, admins edit
--   • dispatcher / viewer / crew: nothing in this file. Dispatchers see only the
--     cached estimate number + accepted date copied onto a converted job.
--   • anon: nothing; clients reach a quote only through Netlify Functions with a
--     valid, unexpired, unrevoked link token (service role, explicit fields).
-- Prices are computed by the shared TypeScript engine. Totals, lines, status and
-- the rate snapshot are written ONLY by the server functions (service role) after
-- a recompute; signed-in users can edit inputs, never totals.
-- No foreign keys into suggestions / admin_notes / hr_*.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function private.is_estimating()
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_role('admin', 'estimator'); $$;
revoke all on function private.is_estimating() from public, anon;
grant execute on function private.is_estimating() to authenticated;

create type public.client_kind as enum ('museum', 'gallery', 'collector', 'designer', 'corporate', 'other');
create type public.rate_card_status as enum ('draft', 'active', 'archived');
create type public.estimate_status as enum
  ('draft', 'pending_approval', 'approved', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted');

-- ── Clients ──────────────────────────────────────────────────────────────────
create table public.clients (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(btrim(name)) between 2 and 140),
  kind                 public.client_kind not null default 'other',
  billing_address      text check (billing_address is null or char_length(billing_address) <= 400),
  default_discount_bp  int not null default 0 check (default_discount_bp between 0 and 5000),
  notes                text check (notes is null or char_length(notes) <= 4000),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create table public.client_contacts (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 100),
  role       text check (role is null or char_length(role) <= 80),
  email      text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone      text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index client_contacts_client_idx on public.client_contacts (client_id);
create unique index client_contacts_one_primary on public.client_contacts (client_id) where is_primary;

-- Jobs: optional client link + cached estimate reference (dispatchers see these, never prices).
alter table public.jobs
  add column client_id uuid references public.clients (id) on delete set null,
  add column source_estimate_number text,
  add column estimate_accepted_at timestamptz;
create index jobs_client_idx on public.jobs (client_id);

-- ── Rate cards (versioned; rates are typed JSONB validated by the shared zod schema) ──
create table public.rate_cards (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(btrim(name)) between 2 and 100),
  status          public.rate_card_status not null default 'draft',
  effective_from  date,
  rates           jsonb not null,
  is_sample       boolean not null default false,
  reviewed_at     timestamptz,
  reviewed_by     text,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint rates_shape check (
    jsonb_typeof(rates) = 'object' and rates ->> 'schema_version' = '1'
    and rates ? 'labor' and rates ? 'vehicles' and rates ? 'equipment' and rates ? 'distance_tiers'
    and rates ? 'shipping' and rates ? 'crating' and rates ? 'removal' and rates ? 'insurance'
    and rates ? 'access' and rates ? 'addons' and rates ? 'premiums' and rates ? 'policy')
);
create unique index rate_cards_one_active on public.rate_cards (status) where status = 'active';

-- Editable rule tables (copied into each estimate's snapshot).
create table public.packing_rules (
  id           uuid primary key default gen_random_uuid(),
  medium_match text not null check (char_length(btrim(medium_match)) between 1 and 80),
  condition    text not null check (condition in ('any', 'local', 'long_haul', 'glazed', 'heavy', 'small')),
  method       text not null check (method in ('soft_pack', 'travel_frame', 'standard_crate', 'padded_crate', 'custom_crate',
                                                'skid_bracing', 'double_boxed', 'rolled', 'flat_crate')),
  note         text not null default '' check (char_length(note) <= 200),
  position     int not null default 0
);
create table public.crew_size_rules (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('base', 'min_if_flat_over_sqft', 'add_per_weight_band', 'min_if_flag', 'add_if_access', 'equipment_over_weight')),
  crew          int not null default 0 check (crew between 0 and 20),
  param         text not null default '' check (char_length(param) <= 60),
  equipment_key text check (equipment_key is null or equipment_key ~ '^[a-z0-9_]{2,40}$'),
  note          text not null default '' check (char_length(note) <= 200),
  position      int not null default 0
);
create table public.terms_versions (
  id          uuid primary key default gen_random_uuid(),
  version     int not null unique,
  title       text not null default 'Quote terms',
  body        text not null check (char_length(btrim(body)) between 10 and 40000),
  is_current  boolean not null default false,
  created_by  text,
  created_at  timestamptz not null default now()
);
create unique index terms_one_current on public.terms_versions (is_current) where is_current;

-- ── Estimates ────────────────────────────────────────────────────────────────
create sequence public.estimate_number_seq;

create table public.estimates (
  id                  uuid primary key default gen_random_uuid(),
  estimate_number     text not null default ('Q-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.estimate_number_seq')::text, 4, '0')),
  revision            int not null default 1 check (revision between 1 and 999),
  client_id           uuid references public.clients (id) on delete restrict,
  contact_id          uuid references public.client_contacts (id) on delete set null,
  title               text not null check (char_length(btrim(title)) between 2 and 140),
  service_type        public.job_type not null default 'delivery',
  status              public.estimate_status not null default 'draft',
  requested_date      date,
  valid_until         date,
  rate_card_id        uuid references public.rate_cards (id) on delete restrict,
  rate_snapshot       jsonb,
  terms_version_id    uuid references public.terms_versions (id) on delete restrict,
  inputs              jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  notes_internal      text check (notes_internal is null or char_length(notes_internal) <= 4000),
  notes_client        text check (notes_client is null or char_length(notes_client) <= 4000),
  is_template         boolean not null default false,
  template_name       text check (template_name is null or char_length(template_name) <= 100),
  -- Server-computed (service role only):
  subtotal_cents      bigint not null default 0,
  discount_bp         int not null default 0,
  discount_cents      bigint not null default 0,
  tax_cents           bigint not null default 0,
  total_cents         bigint not null default 0,
  cost_cents          bigint not null default 0,
  margin_cents        bigint not null default 0,
  margin_bp           int not null default 0,
  suggested_crew      int,
  needs_approval      boolean not null default false,
  approval_reasons    text[] not null default '{}',
  computed_at         timestamptz,
  approved_by         text,
  approved_at         timestamptz,
  approved_total_cents bigint,
  approval_note       text check (approval_note is null or char_length(approval_note) <= 1000),
  sent_at             timestamptz,
  accepted_at         timestamptz,
  declined_at         timestamptz,
  decline_reason      text check (decline_reason is null or char_length(decline_reason) <= 1000),
  converted_job_id    uuid references public.jobs (id) on delete set null,
  estimator_email     text,
  version             int not null default 1,
  deleted_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (estimate_number, revision)
);
create index estimates_status_idx on public.estimates (status) where deleted_at is null;
create index estimates_client_idx on public.estimates (client_id);
create index estimates_number_idx on public.estimates (estimate_number, revision desc);
create index estimates_rate_card_idx on public.estimates (rate_card_id);
create index estimates_contact_idx on public.estimates (contact_id);
create index estimates_terms_idx on public.estimates (terms_version_id);
create index estimates_job_idx on public.estimates (converted_job_id);

create table public.estimate_stops (
  id                  uuid primary key default gen_random_uuid(),
  estimate_id         uuid not null references public.estimates (id) on delete cascade,
  position            int not null default 0,
  kind                public.stop_kind not null default 'stop',
  site_name           text check (site_name is null or char_length(site_name) <= 140),
  address             text not null check (char_length(btrim(address)) between 3 and 300),
  contact_name        text check (contact_name is null or char_length(contact_name) <= 100),
  contact_phone       text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  window_start        timestamptz,
  window_end          timestamptz,
  access_flags        text[] not null default '{}' check (private.valid_flags(access_flags, array[
                        'loading_dock', 'stairs', 'freight_elevator', 'elevator_reservation', 'coi_required',
                        'street_parking_only', 'security_checkin', 'timed_access'])),
  access_notes        text check (access_notes is null or char_length(access_notes) <= 2000),
  -- Manually entered in Phase 3; a future maps lookup can fill this column without schema changes.
  miles_from_previous numeric(6, 1) check (miles_from_previous is null or miles_from_previous between 0 and 5000)
);
create index estimate_stops_idx on public.estimate_stops (estimate_id, position);

create table public.estimate_items (
  id                    uuid primary key default gen_random_uuid(),
  estimate_id           uuid not null references public.estimates (id) on delete cascade,
  position              int not null default 0,
  description           text not null check (char_length(btrim(description)) between 2 and 300),
  artist_title          text check (artist_title is null or char_length(artist_title) <= 200),
  medium                text check (medium is null or char_length(medium) <= 120),
  height_in             numeric(7, 2) check (height_in is null or (height_in > 0 and height_in <= 1200)),
  width_in              numeric(7, 2) check (width_in is null or (width_in > 0 and width_in <= 1200)),
  depth_in              numeric(7, 2) check (depth_in is null or (depth_in > 0 and depth_in <= 1200)),
  weight_lbs            numeric(8, 1) check (weight_lbs is null or (weight_lbs > 0 and weight_lbs <= 40000)),
  quantity              int not null default 1 check (quantity between 1 and 999),
  declared_value_cents  bigint check (declared_value_cents is null or declared_value_cents between 0 and 100000000000),
  handling_flags        text[] not null default '{}' check (private.valid_flags(handling_flags, array[
                          'upright', 'top_heavy', 'fragile', 'glass', 'loose_parts', 'keep_flat', 'no_stack',
                          'climate_sensitive', 'two_person'])),
  packing_method        text check (packing_method is null or packing_method in ('soft_pack', 'travel_frame', 'standard_crate',
                          'padded_crate', 'custom_crate', 'skid_bracing', 'double_boxed', 'rolled', 'flat_crate')),
  packing_override_reason text check (packing_override_reason is null or char_length(packing_override_reason) <= 300),
  -- Written by the server on recompute (the engine's suggestion for this item).
  packing_suggested     text,
  constraint packing_override_needs_reason check (packing_method is null or char_length(btrim(coalesce(packing_override_reason, ''))) >= 3)
);
create index estimate_items_idx on public.estimate_items (estimate_id, position);

-- Lines: written only by the server after a recompute.
create table public.estimate_lines (
  id                uuid primary key default gen_random_uuid(),
  estimate_id       uuid not null references public.estimates (id) on delete cascade,
  sort              int not null default 0,
  key               text not null,
  category          text not null check (category in ('transport', 'packing_crating', 'labor', 'equipment', 'insurance', 'access',
                                                      'addons', 'storage', 'discount', 'tax', 'other')),
  description       text not null,
  qty               numeric(12, 2) not null,
  unit              text not null default '',
  unit_cost_cents   bigint not null,
  unit_price_cents  bigint not null,
  amount_cents      bigint not null,
  cost_cents        bigint not null,
  source            text not null check (source in ('calc', 'manual')),
  client_visible    boolean not null default true,
  estimate_item_id  uuid references public.estimate_items (id) on delete set null,
  overridden        boolean not null default false,
  original          jsonb,
  override_reason   text,
  trace             text not null default ''
);
create index estimate_lines_idx on public.estimate_lines (estimate_id, sort);
create index estimate_lines_item_idx on public.estimate_lines (estimate_item_id);

-- Quote links: only the SHA-256 of the 128-bit token is stored.
create table public.quote_links (
  id              uuid primary key default gen_random_uuid(),
  estimate_id     uuid not null references public.estimates (id) on delete cascade,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at  timestamptz,
  view_count      int not null default 0,
  created_by      text,
  created_at      timestamptz not null default now()
);
create index quote_links_estimate_idx on public.quote_links (estimate_id);

-- Acceptances: a NAMED business record (the quote page says so).
create table public.quote_acceptances (
  id               uuid primary key default gen_random_uuid(),
  estimate_id      uuid not null unique references public.estimates (id) on delete restrict,
  revision         int not null,
  quote_link_id    uuid references public.quote_links (id) on delete set null,
  accepted_name    text not null check (char_length(btrim(accepted_name)) between 2 and 120),
  accepted_title   text check (accepted_title is null or char_length(accepted_title) <= 120),
  accepted_email   text not null check (accepted_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  signature_text   text not null check (char_length(btrim(signature_text)) between 2 and 120),
  agreed_to_terms  boolean not null check (agreed_to_terms),
  terms_version_id uuid references public.terms_versions (id) on delete restrict,
  total_cents      bigint not null,
  accepted_at      timestamptz not null default now(),
  ip               text,
  user_agent       text check (user_agent is null or char_length(user_agent) <= 500)
);
create index quote_acceptances_link_idx on public.quote_acceptances (quote_link_id);
create index quote_acceptances_terms_idx on public.quote_acceptances (terms_version_id);

-- ── Privileges + RLS ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['clients', 'client_contacts', 'rate_cards', 'packing_rules', 'crew_size_rules', 'terms_versions',
    'estimates', 'estimate_stops', 'estimate_items', 'estimate_lines', 'quote_links', 'quote_acceptances']
  loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_estimating()))', t || '_estimating_read', t);
  end loop;

  -- Estimating roles edit clients, contacts, estimate stops and items.
  foreach t in array array['clients', 'client_contacts', 'estimate_stops', 'estimate_items'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_estimating()))', t || '_est_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_estimating())) with check ((select private.is_estimating()))', t || '_est_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_estimating()))', t || '_est_delete', t);
  end loop;

  -- Admins edit rates, rules and terms.
  foreach t in array array['rate_cards', 'packing_rules', 'crew_size_rules', 'terms_versions'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.is_admin()))', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()))', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.is_admin()))', t || '_admin_delete', t);
  end loop;
end $$;

-- Estimates: users edit INPUTS only. Totals, lines, status, snapshot, approvals,
-- links and acceptances are written by the server functions (service role).
grant insert (client_id, contact_id, title, service_type, requested_date, inputs, notes_internal, notes_client, is_template, template_name)
  on public.estimates to authenticated;
grant update (client_id, contact_id, title, service_type, requested_date, inputs, notes_internal, notes_client, is_template, template_name, deleted_at)
  on public.estimates to authenticated;
create policy estimates_est_insert on public.estimates for insert to authenticated with check ((select private.is_estimating()));
create policy estimates_est_update on public.estimates for update to authenticated
  using ((select private.is_estimating())) with check ((select private.is_estimating()));

-- ── Forced fields ────────────────────────────────────────────────────────────
create or replace function private.tg_estimates_before()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_card public.rate_cards%rowtype;
begin
  if tg_op = 'INSERT' then
    new.estimator_email := coalesce(nullif(private.current_email(), 'system'), new.estimator_email);
    new.version := 1;
    if new.rate_card_id is null then
      select * into v_card from public.rate_cards where status = 'active';
      if found then
        new.rate_card_id := v_card.id;
        new.rate_snapshot := jsonb_build_object(
          'rates', v_card.rates,
          'packing_rules', coalesce((select jsonb_agg(to_jsonb(p) - 'id' order by p.position) from public.packing_rules p), '[]'::jsonb),
          'crew_rules', coalesce((select jsonb_agg(to_jsonb(c) - 'id' order by c.position) from public.crew_size_rules c), '[]'::jsonb));
      end if;
    end if;
    if new.terms_version_id is null then
      select id into new.terms_version_id from public.terms_versions where is_current;
    end if;
  else
    new.estimate_number := old.estimate_number;
    new.revision := old.revision;
    new.version := old.version + 1;
    new.updated_at := now();
    -- Any input change after approval needs a fresh approval (server recompute decides).
  end if;
  return new;
end;
$$;
create trigger estimates_before before insert or update on public.estimates
  for each row execute function private.tg_estimates_before();

create trigger clients_touch before update on public.clients for each row execute function private.tg_touch();
create trigger rate_cards_touch before update on public.rate_cards for each row execute function private.tg_touch();

create or replace function private.tg_rate_cards_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(nullif(private.current_email(), 'system'), new.created_by);
    new.reviewed_at := null;
    new.reviewed_by := null;
    if new.status = 'active' and private.current_email() <> 'system' then
      raise exception 'Create rate cards as drafts, then activate them.' using errcode = '22023';
    end if;
  elsif new.rates is distinct from old.rates then
    if old.status <> 'draft' then
      raise exception 'Only draft rate cards can be edited. Duplicate the card as a new draft.' using errcode = '22023';
    end if;
    new.reviewed_at := null;
    new.reviewed_by := null;
  end if;
  return new;
end;
$$;
create trigger rate_cards_before before insert or update on public.rate_cards
  for each row execute function private.tg_rate_cards_before();

create or replace function private.tg_terms_before()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    raise exception 'Terms are versioned: add a new version instead of editing.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then new.created_by := private.current_email(); end if;
  return new;
end;
$$;
create trigger terms_before before insert or update on public.terms_versions
  for each row execute function private.tg_terms_before();

-- ── Admin RPCs: activate a rate card, mark reviewed, make terms current ─────
create or replace function private.activate_rate_card(p_card uuid, p_effective date)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.rate_cards where id = p_card and status = 'draft') then
    raise exception 'Only a draft card can be activated.' using errcode = '22023';
  end if;
  update public.rate_cards set status = 'archived' where status = 'active';
  update public.rate_cards set status = 'active', effective_from = coalesce(p_effective, current_date) where id = p_card;
  perform private.audit('estimate_rate_card_activated', null, null, jsonb_build_object('rate_card_id', p_card, 'effective_from', p_effective));
end;
$$;
create or replace function private.mark_rate_card_reviewed(p_card uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.rate_cards set reviewed_at = now(), reviewed_by = private.current_email(), is_sample = false where id = p_card;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.audit('estimate_rate_card_reviewed', null, null, jsonb_build_object('rate_card_id', p_card));
end;
$$;
create or replace function private.make_terms_current(p_terms uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.terms_versions set is_current = false where is_current;
  update public.terms_versions set is_current = true where id = p_terms;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
end;
$$;

-- Convert an accepted estimate into a DRAFT dispatch job. No prices are copied.
create or replace function private.convert_estimate_to_job(p_estimate uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare e public.estimates%rowtype; v_job uuid; v_client text; v_start timestamptz;
begin
  if not private.is_estimating() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into e from public.estimates where id = p_estimate and deleted_at is null for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if e.status <> 'accepted' then raise exception 'Only an accepted estimate can be converted.' using errcode = '22023'; end if;
  select name into v_client from public.clients where id = e.client_id;
  v_start := coalesce((e.requested_date + time '09:00') at time zone private.app_tz(), date_trunc('day', now()) + interval '1 day 9 hours');
  insert into public.jobs (title, client_name, client_id, job_type, status, start_at, end_at, crew_notes,
                           source_estimate_number, estimate_accepted_at)
  values (e.title, v_client, e.client_id, e.service_type, 'draft', v_start, v_start + interval '4 hours',
          case when e.suggested_crew is not null then format('Suggested crew from estimate: %s.', e.suggested_crew) end,
          e.estimate_number || case when e.revision > 1 then ' rev ' || e.revision else '' end, e.accepted_at)
  returning id into v_job;
  insert into public.job_stops (job_id, position, kind, site_name, address, contact_name, contact_phone, window_start, window_end, access_flags, access_notes)
  select v_job, position, kind, site_name, address, contact_name, contact_phone, window_start, window_end, access_flags, access_notes
  from public.estimate_stops where estimate_id = e.id order by position;
  insert into public.job_items (job_id, position, description, artist_title, medium, height_in, width_in, depth_in, weight_lbs, quantity, packing, handling_flags)
  select v_job, i.position, i.description, i.artist_title, i.medium, i.height_in, i.width_in, i.depth_in, i.weight_lbs, i.quantity,
         case when coalesce(i.packing_method, i.packing_suggested) in ('soft_pack', 'rolled', 'travel_frame') then 'soft_pack'::public.packing_kind
              else 'crated'::public.packing_kind end,
         i.handling_flags
  from public.estimate_items i
  where i.estimate_id = e.id order by i.position;
  update public.estimates set status = 'converted', converted_job_id = v_job where id = e.id;
  return v_job;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['activate_rate_card(uuid, date)', 'mark_rate_card_reviewed(uuid)', 'make_terms_current(uuid)', 'convert_estimate_to_job(uuid)'] loop
    execute format('revoke all on function private.%s from public, anon', f);
    execute format('grant execute on function private.%s to authenticated', f);
  end loop;
end $$;
create or replace function public.activate_rate_card(p_card uuid, p_effective date)
returns void language sql security invoker set search_path = '' as $$ select private.activate_rate_card(p_card, p_effective); $$;
create or replace function public.mark_rate_card_reviewed(p_card uuid)
returns void language sql security invoker set search_path = '' as $$ select private.mark_rate_card_reviewed(p_card); $$;
create or replace function public.make_terms_current(p_terms uuid)
returns void language sql security invoker set search_path = '' as $$ select private.make_terms_current(p_terms); $$;
create or replace function public.convert_estimate_to_job(p_estimate uuid)
returns uuid language sql security invoker set search_path = '' as $$ select private.convert_estimate_to_job(p_estimate); $$;
do $$
declare f text;
begin
  foreach f in array array['activate_rate_card(uuid, date)', 'mark_rate_card_reviewed(uuid)', 'make_terms_current(uuid)', 'convert_estimate_to_job(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Exports of quotes / internal sheets are generated in the browser and logged here.
create or replace function private.log_estimate_export(p_estimate uuid, p_format text, p_internal boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_estimating() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_format not in ('pdf', 'docx', 'xlsx', 'xlsx_internal', 'build_sheet') then raise exception 'unknown export format'; end if;
  perform private.audit('estimate_export', p_estimate, null, jsonb_build_object('format', p_format, 'internal', coalesce(p_internal, false)));
end;
$$;
revoke all on function private.log_estimate_export(uuid, text, boolean) from public, anon;
grant execute on function private.log_estimate_export(uuid, text, boolean) to authenticated;
create or replace function public.log_estimate_export(p_estimate uuid, p_format text, p_internal boolean)
returns void language sql security invoker set search_path = '' as $$ select private.log_estimate_export(p_estimate, p_format, p_internal); $$;
revoke all on function public.log_estimate_export(uuid, text, boolean) from public, anon;
grant execute on function public.log_estimate_export(uuid, text, boolean) to authenticated;

-- ── Audit (actions prefixed estimate_) ───────────────────────────────────────
create or replace function private.tg_estimate_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_row jsonb := coalesce(v_new, v_old);
  v_est uuid;
  v_action text := 'estimate_' || tg_table_name || '_' || lower(tg_op);
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at' - 'version') = (v_new - 'updated_at' - 'version') then return null; end if;
  v_est := case when tg_table_name = 'estimates' then (v_row ->> 'id')::uuid
                when v_row ? 'estimate_id' then (v_row ->> 'estimate_id')::uuid end;
  if tg_table_name = 'estimates' and tg_op = 'UPDATE' and v_old ->> 'status' is distinct from v_new ->> 'status' then
    v_action := 'estimate_status';
    perform private.audit(v_action, v_est, jsonb_build_object('status', v_old ->> 'status'),
      jsonb_build_object('status', v_new ->> 'status', 'total_cents', v_new -> 'total_cents', 'approval_note', v_new ->> 'approval_note'));
    return null;
  end if;
  -- Server-written lines change on every recompute: log the recompute on estimates instead.
  if tg_table_name = 'estimate_lines' then return null; end if;
  perform private.audit(v_action, v_est, v_old, v_new);
  return null;
end;
$$;
revoke all on function private.tg_estimate_audit() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['clients', 'client_contacts', 'rate_cards', 'packing_rules', 'crew_size_rules', 'terms_versions',
    'estimates', 'estimate_stops', 'estimate_items', 'quote_links', 'quote_acceptances']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.tg_estimate_audit()', t || '_audit', t);
  end loop;
end $$;

revoke all on function private.tg_estimates_before() from public, anon, authenticated;
revoke all on function private.tg_rate_cards_before() from public, anon, authenticated;
revoke all on function private.tg_terms_before() from public, anon, authenticated;

-- ── Server-only write path (Netlify Functions, service role) ─────────────────
-- The functions recompute with the shared engine, then call these so every write
-- is atomic and the audit log names the real actor (app.actor).
create or replace function private.current_email()
returns text language sql stable set search_path = ''
as $$
  select lower(coalesce(nullif(current_setting('app.actor', true), ''), auth.jwt() ->> 'email', 'system'));
$$;

create or replace function public.server_apply_estimate(p_estimate uuid, p_actor text, p_patch jsonb, p_lines jsonb, p_packing jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);
  update public.estimates set
    subtotal_cents   = coalesce((p_patch ->> 'subtotal_cents')::bigint, subtotal_cents),
    discount_bp      = coalesce((p_patch ->> 'discount_bp')::int, discount_bp),
    discount_cents   = coalesce((p_patch ->> 'discount_cents')::bigint, discount_cents),
    tax_cents        = coalesce((p_patch ->> 'tax_cents')::bigint, tax_cents),
    total_cents      = coalesce((p_patch ->> 'total_cents')::bigint, total_cents),
    cost_cents       = coalesce((p_patch ->> 'cost_cents')::bigint, cost_cents),
    margin_cents     = coalesce((p_patch ->> 'margin_cents')::bigint, margin_cents),
    margin_bp        = coalesce((p_patch ->> 'margin_bp')::int, margin_bp),
    suggested_crew   = coalesce((p_patch ->> 'suggested_crew')::int, suggested_crew),
    needs_approval   = coalesce((p_patch ->> 'needs_approval')::boolean, needs_approval),
    approval_reasons = coalesce(array(select jsonb_array_elements_text(p_patch -> 'approval_reasons')), approval_reasons),
    computed_at      = case when p_patch ? 'subtotal_cents' then now() else computed_at end,
    status           = coalesce((p_patch ->> 'status')::public.estimate_status, status),
    approved_by      = case when p_patch ? 'approved_by' then p_patch ->> 'approved_by' else approved_by end,
    approved_at      = case when p_patch ? 'approved_at' then (p_patch ->> 'approved_at')::timestamptz else approved_at end,
    approved_total_cents = case when p_patch ? 'approved_total_cents' then (p_patch ->> 'approved_total_cents')::bigint else approved_total_cents end,
    approval_note    = case when p_patch ? 'approval_note' then p_patch ->> 'approval_note' else approval_note end,
    sent_at          = case when p_patch ? 'sent_at' then (p_patch ->> 'sent_at')::timestamptz else sent_at end,
    valid_until      = case when p_patch ? 'valid_until' then (p_patch ->> 'valid_until')::date else valid_until end,
    accepted_at      = case when p_patch ? 'accepted_at' then (p_patch ->> 'accepted_at')::timestamptz else accepted_at end,
    declined_at      = case when p_patch ? 'declined_at' then (p_patch ->> 'declined_at')::timestamptz else declined_at end,
    decline_reason   = case when p_patch ? 'decline_reason' then p_patch ->> 'decline_reason' else decline_reason end,
    rate_card_id     = case when p_patch ? 'rate_card_id' then (p_patch ->> 'rate_card_id')::uuid else rate_card_id end,
    rate_snapshot    = case when p_patch ? 'rate_snapshot' then p_patch -> 'rate_snapshot' else rate_snapshot end
  where id = p_estimate;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_lines is not null then
    delete from public.estimate_lines where estimate_id = p_estimate;
    insert into public.estimate_lines (estimate_id, sort, key, category, description, qty, unit, unit_cost_cents, unit_price_cents,
      amount_cents, cost_cents, source, client_visible, estimate_item_id, overridden, original, override_reason, trace)
    select p_estimate, (l.ord - 1)::int, l.v ->> 'key', l.v ->> 'category', l.v ->> 'description', (l.v ->> 'qty')::numeric, coalesce(l.v ->> 'unit', ''),
      (l.v ->> 'unit_cost_cents')::bigint, (l.v ->> 'unit_price_cents')::bigint, (l.v ->> 'amount_cents')::bigint, (l.v ->> 'cost_cents')::bigint,
      l.v ->> 'source', (l.v ->> 'client_visible')::boolean,
      (select i.id from public.estimate_items i where i.estimate_id = p_estimate and i.id::text = l.v ->> 'item_id'),
      coalesce((l.v ->> 'overridden')::boolean, false), l.v -> 'original', l.v ->> 'override_reason', coalesce(l.v ->> 'trace', '')
    from jsonb_array_elements(p_lines) with ordinality as l(v, ord);
  end if;
  if p_packing is not null then
    update public.estimate_items i set packing_suggested = x.v ->> 'suggested'
    from jsonb_array_elements(p_packing) as x(v)
    where i.estimate_id = p_estimate and i.id::text = x.v ->> 'item_id';
  end if;
end;
$$;

create or replace function public.server_create_quote_link(p_estimate uuid, p_actor text, p_token_hash text, p_expires timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v uuid;
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);
  -- One live link per estimate: sending again retires the previous link.
  update public.quote_links set revoked_at = now() where estimate_id = p_estimate and revoked_at is null;
  insert into public.quote_links (estimate_id, token_hash, expires_at, created_by) values (p_estimate, p_token_hash, p_expires, p_actor)
  returning id into v;
  return v;
end;
$$;

create or replace function public.server_revoke_quote_links(p_estimate uuid, p_actor text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.actor', coalesce(p_actor, 'system'), true);
  update public.quote_links set revoked_at = now() where estimate_id = p_estimate and revoked_at is null;
end;
$$;

create or replace function public.server_record_quote_view(p_link uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.actor', 'client', true);
  update public.quote_links set view_count = view_count + 1, last_viewed_at = now(), first_viewed_at = coalesce(first_viewed_at, now())
  where id = p_link;
  update public.estimates e set status = 'viewed' from public.quote_links l
  where l.id = p_link and e.id = l.estimate_id and e.status = 'sent';
end;
$$;

-- Accept: refuses a second acceptance (unique estimate_id) and anything not open.
create or replace function public.server_accept_quote(p_link uuid, p_name text, p_title text, p_email text, p_signature text,
  p_terms uuid, p_total bigint, p_ip text, p_ua text)
returns void language plpgsql security definer set search_path = ''
as $$
declare e public.estimates%rowtype;
begin
  perform set_config('app.actor', 'client:' || lower(btrim(p_email)), true);
  select es.* into e from public.estimates es join public.quote_links l on l.estimate_id = es.id where l.id = p_link for update of es;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if e.status not in ('sent', 'viewed') then raise exception 'This quote is no longer open.' using errcode = '22023'; end if;
  if e.total_cents <> p_total then raise exception 'Quote total changed.' using errcode = '22023'; end if;
  insert into public.quote_acceptances (estimate_id, revision, quote_link_id, accepted_name, accepted_title, accepted_email, signature_text,
    agreed_to_terms, terms_version_id, total_cents, ip, user_agent)
  values (e.id, e.revision, p_link, btrim(p_name), nullif(btrim(p_title), ''), lower(btrim(p_email)), btrim(p_signature),
    true, p_terms, p_total, p_ip, left(p_ua, 500));
  update public.estimates set status = 'accepted', accepted_at = now() where id = e.id;
end;
$$;

create or replace function public.server_decline_quote(p_link uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('app.actor', 'client', true);
  update public.estimates e set status = 'declined', declined_at = now(), decline_reason = left(nullif(btrim(p_reason), ''), 1000)
  from public.quote_links l where l.id = p_link and e.id = l.estimate_id and e.status in ('sent', 'viewed');
  if not found then raise exception 'This quote is no longer open.' using errcode = '22023'; end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'server_apply_estimate(uuid, text, jsonb, jsonb, jsonb)', 'server_create_quote_link(uuid, text, text, timestamptz)',
    'server_revoke_quote_links(uuid, text)', 'server_record_quote_view(uuid)',
    'server_accept_quote(uuid, text, text, text, text, uuid, bigint, text, text)', 'server_decline_quote(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
