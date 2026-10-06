-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Two owners; the signup trigger creates their shops.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.my'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.my');

select is((select count(*)::int from public.shops), 2, 'signup trigger creates one shop per user');

-- Seed shop B with a product, sale and decision (as superuser).
insert into public.products (id, shop_id, name)
select 'bbbbbbbb-0000-0000-0000-000000000001', id, 'Milo 1kg' from public.shops
where owner_user_id = '22222222-2222-2222-2222-222222222222';
insert into public.sales (shop_id, product_id, date, qty)
select shop_id, id, '2026-10-01', 3 from public.products;
insert into public.decisions (id, shop_id, product_id, type, reason_json)
select 'dddddddd-0000-0000-0000-000000000001', shop_id, id, 'REORDER', '{}' from public.products;

-- Duplicate names merge on the normalised key.
select throws_ok(
  $$insert into public.products (shop_id, name) select shop_id, '  MILO   1KG ' from public.products$$,
  '23505', null, 'product names are unique per shop after normalising case and spaces');

-- Act as user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.shops), 1, 'A sees only own shop');
select is((select count(*)::int from public.products), 0, 'A cannot see B''s products');
select is((select count(*)::int from public.sales), 0, 'A cannot see B''s sales');
select is((select count(*)::int from public.decisions), 0, 'A cannot see B''s decisions');

select throws_ok(
  $$insert into public.products (shop_id, name)
    values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Sneaky')$$,
  '42501', null, 'A cannot insert products for another shop id');

select lives_ok(
  $$insert into public.products (shop_id, name) values (public.current_shop_id(), 'Gula 1kg')$$,
  'A can insert products into own shop');

select throws_ok(
  $$insert into public.sales (shop_id, product_id, date, qty)
    values (public.current_shop_id(), 'bbbbbbbb-0000-0000-0000-000000000001', '2026-10-01', 1)$$,
  '23503', null, 'A cannot attach sales to B''s product (composite FK)');

select throws_ok(
  $$insert into public.forecasts (shop_id, product_id, model_version_id, week_start, p10, p50, p90)
    values (public.current_shop_id(), gen_random_uuid(), gen_random_uuid(), '2026-10-05', 1, 2, 3)$$,
  '42501', null, 'users cannot write forecasts');

select throws_ok(
  $$insert into public.decision_feedback (shop_id, decision_id, action)
    values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'dddddddd-0000-0000-0000-000000000001', 'done')$$,
  '42501', null, 'A cannot leave feedback on another shop''s decision');

select throws_ok(
  $$update public.shops set owner_user_id = '22222222-2222-2222-2222-222222222222'$$,
  '42501', null, 'A cannot change shop ownership');

select lives_ok($$update public.shops set loan_rate_pct = 6.5$$, 'A can change own loan rate');

reset role;

-- Anonymous visitors get nothing.
set local role anon;
select throws_ok($$select * from public.products$$, '42501', null, 'anon has no table access');
reset role;

-- Modal's role reads across shops and cannot touch input data.
set local role ml_worker;
select is((select count(*)::int from public.sales), 1, 'ml_worker can read sales');
select throws_ok($$delete from public.sales$$, '42501', null, 'ml_worker cannot write sales');
reset role;

select * from finish();
rollback;
