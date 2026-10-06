-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.my'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.my');

-- Shop B gets one product with metrics, as Modal would write them.
insert into public.products (id, shop_id, name)
select 'bbbbbbbb-0000-0000-0000-000000000001', id, 'Milo 1kg' from public.shops
where owner_user_id = '22222222-2222-2222-2222-222222222222';
insert into public.product_metrics (shop_id, product_id, as_of, on_hand, stock_value, cost_components,
  annual_cost, carrying_rate, cost_per_day, cost_30d, cost_180d, slow_stock)
select shop_id, id, '2026-10-06', 175, 1540, '{}', 610.2, 0.3962, 1.67, 50.15, 300.92, true
from public.products where id = 'bbbbbbbb-0000-0000-0000-000000000001';
insert into public.forecast_daily (shop_id, product_id, date, p10, p50, p90)
select shop_id, id, '2026-10-07', 1, 2, 3 from public.products where id = 'bbbbbbbb-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select stock_value from public.shop_kpis), 1540.00::numeric, 'owner sees their KPI totals');
select is((select cash_trapped from public.shop_kpis), 1540.00::numeric, 'slow stock counts as cash trapped');

set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.product_metrics), 0, 'other users see no metrics');
select is((select count(*)::int from public.forecast_daily), 0, 'other users see no daily forecast');
select is((select count(*)::int from public.shop_kpis), 0, 'the KPI view respects RLS (security invoker)');
select throws_ok($$delete from public.product_metrics$$, '42501', null, 'users cannot write metrics');
reset role;

select * from finish();
rollback;
