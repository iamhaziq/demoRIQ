-- Live accuracy: each complete week's stored forecast vs what actually sold (written by Modal).
create table public.forecast_scores (
  shop_id uuid not null references public.shops (id) on delete cascade,
  week_start date not null,
  model_version_id uuid,
  wape numeric(8, 5),           -- forecast P50 vs actual, products without stock-outs that week
  baseline_wape numeric(8, 5),  -- "same as last week" vs actual, same products
  products integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (shop_id, week_start),
  foreign key (shop_id, model_version_id) references public.model_versions (shop_id, id)
);

alter table public.forecast_scores enable row level security;
grant select on public.forecast_scores to authenticated;
create policy forecast_scores_select_own on public.forecast_scores for select to authenticated
  using (shop_id = (select public.current_shop_id()));

grant select, insert, update on public.forecast_scores to ml_worker;
create policy ml_worker_all on public.forecast_scores for all to ml_worker using (true) with check (true);
