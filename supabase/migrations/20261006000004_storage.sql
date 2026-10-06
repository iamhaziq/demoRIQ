-- Private buckets. raw-uploads: original files, stored under <shop_id>/<file>.
-- training-snapshots: Parquet per model version; no user access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('raw-uploads', 'raw-uploads', false, 20971520, array[
    'text/csv', 'text/plain', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]),
  ('training-snapshots', 'training-snapshots', false, 524288000, null)
on conflict (id) do nothing;

create policy raw_uploads_select_own on storage.objects for select to authenticated
  using (bucket_id = 'raw-uploads'
         and (storage.foldername(name))[1] = (select public.current_shop_id())::text);
create policy raw_uploads_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'raw-uploads'
              and (storage.foldername(name))[1] = (select public.current_shop_id())::text);
