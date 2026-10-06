-- Settings for the True Cost of Stock and hold-or-clear rules (docs/decisions.md).

alter table public.shops
  add column loan_outstanding numeric(12, 2) not null default 0 check (loan_outstanding >= 0),
  add column utilities_per_month numeric(12, 2) not null default 0 check (utilities_per_month >= 0),
  add column service_rate_pct numeric(6, 3) not null default 3 check (service_rate_pct between 0 and 100),
  add column holding_days integer not null default 60 check (holding_days between 1 and 365),
  -- handling is the service rate (a share of stock value), as in the prototype
  drop column handling_per_month;

-- Phase 1 set the risk default to 3%, which is the service rate. Risk (spoilage, damage) for
-- groceries is 12% in the prototype. No real shops exist yet, so existing rows are corrected too.
alter table public.shops alter column risk_rate_pct set default 12;
update public.shops set risk_rate_pct = 12 where risk_rate_pct = 3;

-- Per-product selling window (e.g. 180 days for seasonal goods); null = shop default.
alter table public.products
  add column holding_days integer check (holding_days between 1 and 365);

grant update (loan_outstanding, utilities_per_month, service_rate_pct, holding_days)
  on public.shops to authenticated;
