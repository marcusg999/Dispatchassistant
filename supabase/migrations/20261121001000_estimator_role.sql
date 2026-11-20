-- Phase 3 · New staff role for pricing work. (Enum values must be committed before use,
-- so this lives in its own migration.)
alter type public.staff_role add value if not exists 'estimator';
