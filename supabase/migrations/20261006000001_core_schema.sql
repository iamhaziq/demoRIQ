-- RetailIQ core schema. Every app table carries shop_id; money is numeric(12,2) in RM.

create extension if not exists pg_trgm with schema extensions;

-- Shops: one per account. Rates feed the True Cost of Stock rule.
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null default 'My shop',
  language text not null default 'ms' check (language in ('ms', 'en')),
  loan_rate_pct numeric(6, 3) not null default 8 check (loan_rate_pct between 0 and 100),
  opportunity_rate_pct numeric(6, 3) not null default 15 check (opportunity_rate_pct between 0 and 100),
  risk_rate_pct numeric(6, 3) not null default 3 check (risk_rate_pct between 0 and 100),
  rent_per_month numeric(12, 2) not null default 0 check (rent_per_month >= 0),
  storage_share_of_rent numeric(5, 4) not null default 0.15 check (storage_share_of_rent between 0 and 1),
  shelf_area numeric(10, 2) check (shelf_area > 0),
  handling_per_month numeric(12, 2) not null default 0 check (handling_per_month >= 0),
  review_days integer not null default 7 check (review_days between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  sku text,
  name text not null check (length(trim(name)) > 0),
  name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  category text,
  unit_cost numeric(12, 2) check (unit_cost >= 0),
  unit_price numeric(12, 2) check (unit_price >= 0),
  supplier text,
  lead_time_days integer not null default 7 check (lead_time_days between 0 and 365),
  pack_size integer not null default 1 check (pack_size >= 1),
  shelf_space numeric(10, 2) check (shelf_space >= 0),
  risk_rate_pct numeric(6, 3) check (risk_rate_pct between 0 and 100), -- null = shop default
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name_key),
  unique (shop_id, id)
);
create unique index products_shop_sku_key on public.products (shop_id, sku) where sku is not null;
create index products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);

create table public.sales (
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null,
  date date not null,
  qty numeric(12, 3) not null check (qty >= 0),
  revenue numeric(12, 2) check (revenue >= 0),
  primary key (shop_id, product_id, date),
  foreign key (shop_id, product_id) references public.products (shop_id, id) on delete cascade
);
create index sales_shop_date on public.sales (shop_id, date);

create table public.stock_snapshots (
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null,
  date date not null,
  on_hand numeric(12, 3) not null check (on_hand >= 0),
  on_order numeric(12, 3) not null default 0 check (on_order >= 0),
  received_date date,
  primary key (shop_id, product_id, date),
  foreign key (shop_id, product_id) references public.products (shop_id, id) on delete cascade
);

create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  kind text not null check (kind in ('sales', 'stock', 'products')),
  storage_path text not null,
  original_filename text,
  column_map_json jsonb,
  rows_ok integer not null default 0,
  rows_rejected integer not null default 0,
  rejected_json jsonb,
  health_json jsonb,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index uploads_shop on public.uploads (shop_id, created_at desc);

-- Reference data shared by all shops.
create table public.holidays (
  date date not null,
  name text not null,
  region text not null default 'national',
  kind text not null default 'public' check (kind in ('public', 'festival', 'school')),
  primary key (date, name, region)
);

create table public.ml_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  type text not null check (type in ('train', 'predict', 'score')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  modal_call_id text,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index ml_jobs_shop on public.ml_jobs (shop_id, created_at desc);

create table public.model_versions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  version integer not null check (version >= 1),
  model_type text not null,
  volume_path text,
  data_snapshot_path text,
  wape numeric(8, 5),
  baseline_wape numeric(8, 5),
  metrics_json jsonb,
  status text not null default 'candidate' check (status in ('candidate', 'champion', 'retired')),
  created_at timestamptz not null default now(),
  unique (shop_id, version),
  unique (shop_id, id)
);
create unique index model_versions_one_champion on public.model_versions (shop_id) where status = 'champion';

create table public.forecasts (
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null,
  model_version_id uuid not null,
  week_start date not null,
  p10 numeric(12, 3) not null check (p10 >= 0),
  p50 numeric(12, 3) not null check (p50 >= p10),
  p90 numeric(12, 3) not null check (p90 >= p50),
  low_confidence boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (shop_id, product_id, week_start),
  foreign key (shop_id, product_id) references public.products (shop_id, id) on delete cascade,
  foreign key (shop_id, model_version_id) references public.model_versions (shop_id, id) on delete cascade
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  product_id uuid not null,
  model_version_id uuid,
  type text not null check (type in ('REORDER', 'CLEAR', 'HOLD')),
  qty numeric(12, 3),
  value_rm numeric(12, 2),
  reason_json jsonb not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (shop_id, id),
  foreign key (shop_id, product_id) references public.products (shop_id, id) on delete cascade,
  foreign key (shop_id, model_version_id) references public.model_versions (shop_id, id)
);
create index decisions_current on public.decisions (shop_id, value_rm desc) where superseded_at is null;

create table public.decision_feedback (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  decision_id uuid not null,
  action text not null check (action in ('done', 'not_now', 'wrong')),
  note text,
  at timestamptz not null default now(),
  foreign key (shop_id, decision_id) references public.decisions (shop_id, id) on delete cascade
);
create index decision_feedback_decision on public.decision_feedback (decision_id);

-- Keep updated_at honest.
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger shops_updated_at before update on public.shops
  for each row execute function public.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
