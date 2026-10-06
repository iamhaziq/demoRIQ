-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'a@test.my');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Stock file first: sets lead time and cost.
select is(
  public.ingest_commit(
    '[{"name":"Milo 1kg","unit_cost":18.5,"lead_time_days":3,"pack_size":12}]',
    '[]',
    '[{"product":"Milo 1kg","date":"2026-10-01","on_hand":0,"on_order":24}]'),
  '{"products":1,"sales":0,"stock":1}'::jsonb,
  'stock upload writes product and snapshot');

-- Sales file: different case, no lead time. 70 days of history for Milo, 10 for Gula.
select is(
  public.ingest_commit(
    '[{"name":"MILO 1KG","unit_price":21},{"name":"Gula 1kg","unit_price":2.85}]',
    (select jsonb_agg(x) from (
       select 'milo 1kg' as product, d::date as date, 2 as qty, 42 as revenue
       from generate_series('2026-07-24'::date, '2026-10-01', interval '1 day') d
       union all
       select 'Gula 1kg', d::date, 5, 14.25
       from generate_series('2026-09-22'::date, '2026-10-01', interval '1 day') d) x),
    '[]'),
  '{"products":2,"sales":80,"stock":0}'::jsonb,
  'sales upload matches products case-insensitively');

select is((select count(*)::int from public.products), 2, 'no duplicate product for a different spelling');
select is((select name from public.products where name_key = 'milo 1kg'), 'Milo 1kg', 'first spelling kept');
select is((select lead_time_days from public.products where name_key = 'milo 1kg'), 3,
  'upload without lead time keeps the existing one');
select is((select unit_price from public.products where name_key = 'milo 1kg'), 21.00::numeric,
  'later upload fills in unit price');

-- Re-upload the same day with a new qty: replaced, not added.
select public.ingest_commit('[]', '[{"product":"Gula 1kg","date":"2026-10-01","qty":7,"revenue":19.95}]', '[]');
select is((select qty from public.sales s join public.products p on p.id = s.product_id
           where p.name_key = 'gula 1kg' and s.date = '2026-10-01'), 7.000::numeric,
  're-upload replaces the day''s row');

select is(
  public.shop_data_health() - 'first_date' - 'last_date',
  '{"products":2,"products_with_sales":2,"days_of_history":70,"pct_products_8_weeks":50.0,
    "stockout_days":1,"enough_history":false}'::jsonb,
  'health summary');

reset role;
set local role anon;
select throws_ok($$select public.ingest_commit('[]','[]','[]')$$, '42501', null, 'anon cannot ingest');
reset role;

-- A signed-in user without a shop gets a clear error.
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
select throws_ok($$select public.ingest_commit('[]','[]','[]')$$, '42501', 'no shop for this user',
  'user without a shop cannot ingest');
reset role;

select * from finish();
rollback;
