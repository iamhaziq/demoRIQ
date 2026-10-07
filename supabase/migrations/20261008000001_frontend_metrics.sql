-- Numbers the app screens show, written by Modal each prediction run (docs/frontend.md).
-- The UI only formats them.

-- Current figures for every product with stock and cost (replaced each run).
create table public.product_metrics (
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null,
  model_version_id uuid,
  as_of date not null,
  on_hand numeric(12, 3) not null,
  stock_value numeric(12, 2) not null,
  days_of_cover numeric(10, 2),          -- null = no forecast demand
  age_days integer,                      -- days since the last delivery, if known
  cost_components jsonb not null,        -- annual RM: financing, space, service, risk, opportunity
  annual_cost numeric(12, 2) not null,
  carrying_rate numeric(8, 4) not null,  -- annual cost / stock value
  cost_per_day numeric(12, 2) not null,
  cost_30d numeric(12, 2) not null,
  cost_180d numeric(12, 2) not null,
  forecast_p10 numeric(12, 1),           -- next 28 days, units
  forecast_p50 numeric(12, 1),
  forecast_p90 numeric(12, 1),
  low_confidence boolean not null default false,
  slow_stock boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (shop_id, product_id),
  foreign key (shop_id, product_id) references public.products (shop_id, id) on delete cascade,
  foreign key (shop_id, model_version_id) references public.model_versions (shop_id, id)
);

-- Daily forecast for the chart (28 days per product, replaced each run). Weekly rows in
-- public.forecasts stay for the agent and live scoring.
create table public.forecast_daily (
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null,
  model_version_id uuid,
  date date not null,
  p10 numeric(12, 3) not null,
  p50 numeric(12, 3) not null,
  p90 numeric(12, 3) not null,
  low_confidence boolean not null default false,
  primary key (shop_id, product_id, date),
  foreign key (shop_id, product_id) references public.products (shop_id, id) on delete cascade,
  foreign key (shop_id, model_version_id) references public.model_versions (shop_id, id)
);

-- Today screen tiles. security_invoker: RLS on product_metrics applies to the caller.
create view public.shop_kpis with (security_invoker = true) as
select shop_id,
       max(as_of) as as_of,
       sum(stock_value) as stock_value,
       round(sum(annual_cost) / 12, 2) as carrying_cost_per_month,
       coalesce(sum(stock_value) filter (where slow_stock), 0) as cash_trapped,
       count(*) filter (where slow_stock)::int as slow_products
from public.product_metrics
group by shop_id;

alter table public.product_metrics enable row level security;
alter table public.forecast_daily enable row level security;
grant select on public.product_metrics, public.forecast_daily, public.shop_kpis to authenticated;
create policy product_metrics_select_own on public.product_metrics for select to authenticated
  using (shop_id = (select public.current_shop_id()));
create policy forecast_daily_select_own on public.forecast_daily for select to authenticated
  using (shop_id = (select public.current_shop_id()));

grant select, insert, update, delete on public.product_metrics, public.forecast_daily to ml_worker;
create policy ml_worker_all on public.product_metrics for all to ml_worker using (true) with check (true);
create policy ml_worker_all on public.forecast_daily for all to ml_worker using (true) with check (true);
