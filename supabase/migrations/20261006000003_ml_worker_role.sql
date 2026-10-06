-- Dedicated role for Modal, instead of the service-role key.
-- Created NOLOGIN; enable it by hand with a password kept out of git:
--   alter role ml_worker with login password '...';
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ml_worker') then
    create role ml_worker nologin;
  end if;
end $$;

grant usage on schema public to ml_worker;

grant select on public.shops, public.products, public.sales, public.stock_snapshots,
  public.holidays to ml_worker;
grant select, insert, update, delete on public.forecasts, public.decisions to ml_worker;
grant select, insert, update on public.model_versions, public.ml_jobs to ml_worker;

-- ml_worker works across shops (nightly jobs), so it gets full-row policies on exactly the
-- tables it is granted. Its code still filters every query by shop_id.
create policy ml_worker_read on public.shops for select to ml_worker using (true);
create policy ml_worker_read on public.products for select to ml_worker using (true);
create policy ml_worker_read on public.sales for select to ml_worker using (true);
create policy ml_worker_read on public.stock_snapshots for select to ml_worker using (true);
create policy ml_worker_read on public.holidays for select to ml_worker using (true);
create policy ml_worker_all on public.forecasts for all to ml_worker using (true) with check (true);
create policy ml_worker_all on public.decisions for all to ml_worker using (true) with check (true);
create policy ml_worker_all on public.model_versions for all to ml_worker using (true) with check (true);
create policy ml_worker_all on public.ml_jobs for all to ml_worker using (true) with check (true);
