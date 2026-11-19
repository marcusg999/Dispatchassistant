-- ─────────────────────────────────────────────────────────────────────────────
-- Private photo bucket.
--   • Not public. No anon access.
--   • Only the submit function (service role) uploads. There is no INSERT/UPDATE policy.
--   • Admins can SELECT (needed to mint short-lived signed URLs) and DELETE (hard delete).
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('suggestion-photos', 'suggestion-photos', false, 1500000, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy suggestion_photos_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'suggestion-photos' and (select private.is_admin()));

create policy suggestion_photos_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'suggestion-photos' and (select private.is_admin()));
