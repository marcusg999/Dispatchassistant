-- ─────────────────────────────────────────────────────────────────────────────
-- Dispatch Bro · Phase 1 · Anonymous suggestion box: core schema
--
-- Anonymity by construction: the suggestions table has NO column that could
-- identify a submitter (no name, email, phone, employee id, user id, IP or
-- user-agent). Submissions are inserted only by the server function using the
-- secret key; there is no client-side insert path at all.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.suggestion_category as enum (
  'safety', 'trucks_equipment', 'scheduling_dispatch', 'crating_shop', 'pay_policy', 'other'
);

-- Declared in ascending urgency, so `order by admin_tag desc` sorts by priority.
create type public.priority_tag as enum ('important', 'urgent', 'crucial');

create type public.suggestion_status as enum ('new', 'reviewing', 'planned', 'done', 'declined');

-- ── suggestions ──────────────────────────────────────────────────────────────
create table public.suggestions (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  body               text not null,
  category           public.suggestion_category not null,
  submitter_tag      public.priority_tag not null,
  admin_tag          public.priority_tag not null,
  status             public.suggestion_status not null default 'new',
  public_reply       text,
  published_to_board boolean not null default false,
  board_summary      text,
  photo_path         text,
  tracking_hash      text not null unique,
  deleted_at         timestamptz,
  search             tsvector generated always as (
                       to_tsvector('english',
                         coalesce(body, '') || ' ' || coalesce(public_reply, '') || ' ' || coalesce(board_summary, ''))
                     ) stored,

  constraint body_length        check (char_length(btrim(body)) between 10 and 4000),
  constraint public_reply_len   check (public_reply is null or char_length(public_reply) <= 4000),
  constraint board_summary_len  check (board_summary is null or char_length(board_summary) <= 1000),
  constraint board_needs_summary check (not published_to_board or char_length(btrim(coalesce(board_summary, ''))) > 0),
  constraint tracking_hash_fmt  check (tracking_hash ~ '^[0-9a-f]{64}$'),
  -- Photos are stored under a random object name; nothing about the submitter is in the path.
  constraint photo_path_fmt     check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}\.(webp|jpg)$')
);

comment on table public.suggestions is
  'Anonymous suggestions. Intentionally has no submitter-identifying columns.';
comment on column public.suggestions.tracking_hash is
  'SHA-256 (hex) of the submitter''s tracking code, computed in their browser. The code itself is never sent or stored.';
comment on column public.suggestions.submitter_tag is 'Priority chosen by the submitter. Never changes.';
comment on column public.suggestions.admin_tag is 'Current priority (starts equal to submitter_tag; admins can re-tag).';

create index suggestions_status_idx     on public.suggestions (status);
create index suggestions_admin_tag_idx  on public.suggestions (admin_tag);
create index suggestions_category_idx   on public.suggestions (category);
create index suggestions_created_at_idx on public.suggestions (created_at desc);
create index suggestions_search_idx     on public.suggestions using gin (search);
create index suggestions_board_idx      on public.suggestions (updated_at desc)
  where published_to_board and deleted_at is null;

-- ── admin_notes ──────────────────────────────────────────────────────────────
create table public.admin_notes (
  id            uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null references public.suggestions (id) on delete cascade,
  author_email  text not null default '',  -- always overwritten by the notes_before trigger
  body          text not null,
  created_at    timestamptz not null default now(),
  constraint note_body_length check (char_length(btrim(body)) between 1 and 4000)
);
create index admin_notes_suggestion_idx on public.admin_notes (suggestion_id, created_at);

-- ── admins (allow-list) ──────────────────────────────────────────────────────
create table public.admins (
  email      text primary key,
  added_by   text,
  created_at timestamptz not null default now(),
  constraint admin_email_lower check (email = lower(btrim(email))),
  constraint admin_email_fmt   check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- ── audit_log (append-only) ──────────────────────────────────────────────────
create table public.audit_log (
  id            bigint generated always as identity primary key,
  actor_email   text not null,
  action        text not null,
  suggestion_id uuid,           -- deliberately no FK: the log outlives hard-deleted rows
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_created_idx    on public.audit_log (created_at desc);
create index audit_log_suggestion_idx on public.audit_log (suggestion_id);
